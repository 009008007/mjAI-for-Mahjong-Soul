use std::path::Path;
use anyhow::{Context, Result};
use ort::{session::{builder::GraphOptimizationLevel, Session}, value::TensorRef};
use riichi::{mjai::Event, state::PlayerState};

// ort 2.0.0-rc.10 retains its process-global environment forever. On macOS,
// ONNX Runtime 1.22 may destroy its C++ globals before that environment is
// released. Release it at orderly process exit, after normal session drops.
#[cfg(target_os = "macos")]
fn ensure_runtime_cleanup() -> Result<()> {
    use ort::AsPointer;
    use std::sync::{atomic::{AtomicPtr, Ordering}, OnceLock};
    static ENV: AtomicPtr<ort::sys::OrtEnv> = AtomicPtr::new(std::ptr::null_mut());
    static REGISTERED: OnceLock<Result<(), String>> = OnceLock::new();
    extern "C" fn cleanup() {
        let env = ENV.swap(std::ptr::null_mut(), Ordering::AcqRel);
        if !env.is_null() { unsafe { (ort::api().ReleaseEnv)(env) }; }
    }
    REGISTERED.get_or_init(|| {
        let env = ort::environment::get_environment().map_err(|e| e.to_string())?;
        ENV.store(env.ptr() as *mut _, Ordering::Release);
        if unsafe { libc::atexit(cleanup) } != 0 {
            ENV.store(std::ptr::null_mut(), Ordering::Release);
            return Err("failed to register ONNX Runtime cleanup".into());
        }
        Ok(())
    }).clone().map_err(anyhow::Error::msg)
}
#[cfg(not(target_os = "macos"))]
fn ensure_runtime_cleanup() -> Result<()> { Ok(()) }

pub struct Inference {
    seat: u8,
    state: PlayerState,
    synthetic_next_draw: bool,
    synthetic_draw: bool,
    session: Option<Session>,
    synchronized: bool,
    style: crate::policy::Style,
    intensity: f32,
}

impl Inference {
    pub fn current_hand(&self) -> Option<Vec<String>> {
        let count = self.state.tehai().iter().map(|&n| usize::from(n)).sum::<usize>();
        Some(sorted_hand(&self.state, count)?.into_iter().map(|tile| tile.to_string()).collect())
    }
    pub fn current_draw(&self) -> Option<String> {
        if self.synthetic_draw { None } else { self.state.last_self_tsumo().map(|tile| tile.to_string()) }
    }
    pub fn chi_references(&self, choices: &[[String; 2]], count: usize) -> Option<std::collections::BTreeMap<String, usize>> {
        if !matches!(count, 4 | 7 | 10 | 13) { return None; }
        let tiles: Vec<_> = sorted_hand(&self.state, count)?.into_iter().map(|tile| tile.to_string()).collect();
        if tiles.len() != count { return None; }
        let mut references = std::collections::BTreeMap::new();
        for name in choices.iter().flatten() {
            let index = tiles.iter().position(|tile| tile == name)?;
            references.insert(name.clone(), index);
        }
        Some(references)
    }
    pub fn new(seat: u8, model: Option<&Path>) -> Result<Self> {
        let session = if let Some(path) = model {
            ensure_runtime_cleanup()?;
            let session = Session::builder()?.with_optimization_level(GraphOptimizationLevel::Level3)?
                .with_intra_threads(1)?.with_inter_threads(1)?.commit_from_file(path)?;
            anyhow::ensure!(session.inputs.len() == 2 && session.outputs.len() == 1
                && session.inputs.iter().any(|i| i.name == "obs")
                && session.inputs.iter().any(|i| i.name == "mask")
                && session.outputs[0].name == "q", "model must have obs, mask inputs and q output");
            Some(session)
        } else { None };
        Ok(Self { seat, state: PlayerState::new(seat), synthetic_next_draw: false, synthetic_draw: false, session, synchronized: false, style: crate::policy::Style::Default, intensity: 1.0 })
    }
    pub fn reset(&mut self) { self.synchronized = false; self.synthetic_next_draw = false; self.synthetic_draw = false; self.state = PlayerState::new(self.seat); }
    pub fn mark_synthetic_draw(&mut self) { self.synthetic_next_draw = true; }
    pub fn set_policy(&mut self, style: crate::policy::Style, intensity: f32) {
        self.style = style;
        self.intensity = intensity;
    }
    pub fn riichi_discard(&mut self, choices: &[String]) -> Result<(String, usize, usize, Option<usize>)> {
        let original = self.state.clone();
        let result = (|| {
            self.state.update(&Event::Reach { actor: self.seat })?;
            let allowed: Vec<String> = choices.iter()
                .map(|tile| crate::converter::majsoul_tile_to_mjai(tile))
                .collect::<std::result::Result<_, _>>().map_err(anyhow::Error::msg)?;
            let index = self.choose_index_with_choices(false, Some(&allowed))?;
            let action = crate::action::decode(&self.state, self.seat, index, None)?;
            let Event::Dahai { pai, .. } = action else { anyhow::bail!("riichi action is not a discard"); };
            let (hand_index, hand_count, drawn_index) = discard_position(&self.state, &action, self.synthetic_draw)
                .context("cannot locate riichi discard")?;
            Ok((pai.to_string(), hand_index, hand_count, drawn_index))
        })();
        self.state = original;
        result
    }
    pub fn process(&mut self, event: Event, decide: bool) -> Result<Option<serde_json::Value>> {
        if matches!(event, Event::StartGame { .. }) { self.reset(); }
        let new_round = matches!(event, Event::StartKyoku { .. });
        if !self.synchronized && !new_round && !matches!(event, Event::StartGame { .. }) { return Ok(None); }
        if matches!(event, Event::Tsumo { actor, .. } if actor == self.seat) {
            self.synthetic_draw = self.synthetic_next_draw;
            self.synthetic_next_draw = false;
        }
        let cans = self.state.update(&event).context("state update failed")?;
        if new_round { self.synchronized = true; }
        let action = if decide && (cans.can_act() || cans.can_pass()) { self.decide()? } else { None };
        if let Some(action) = action {
            let position = discard_position(&self.state, &action, self.synthetic_draw);
            let mut json = serde_json::to_value(&action)?;
            if let Some(object) = json.as_object_mut() {
                if let Some((index, count, drawn_index)) = position {
                    object.insert("hand_index".into(), index.into());
                    object.insert("hand_count".into(), count.into());
                    if let Some(drawn_index) = drawn_index { object.insert("drawn_index".into(), drawn_index.into()); }
                }
                if let Event::Chi { consumed, .. } = action {
                    if let Some((indices, count)) = chi_positions(&self.state, consumed) {
                        object.insert("chi_hand_indices".into(), serde_json::json!(indices));
                        object.insert("hand_count".into(), count.into());
                    }
                }
                if cans.can_discard {
                    let riichi = self.state.tactical_riichi();
                    let threats = riichi[1..].iter().filter(|&&declared| declared).count();
                    object.insert("riichi_threats".into(), threats.into());
                    object.insert("risk_scope".into(), "all".into());
                    if let Some((tiles, drawn_index)) = display_hand(&self.state, self.synthetic_draw) {
                        object.insert("hand_count".into(), tiles.len().into());
                        if let Some(index) = drawn_index { object.insert("drawn_index".into(), index.into()); }
                        object.insert("danger_tiles".into(), danger_tiles(&self.state, &tiles, drawn_index).into());
                    }
                }
                object.insert("shanten".into(), self.state.shanten().into());
                object.insert("source".into(), if self.session.is_some() { "model" } else { "demo" }.into());
            }
            Ok(Some(json))
        } else { Ok(None) }
    }
    fn choose_index(&mut self, kan_select: bool) -> Result<usize> {
        self.choose_index_with_choices(kan_select, None)
    }
    fn choose_index_with_choices(&mut self, kan_select: bool, choices: Option<&[String]>) -> Result<usize> {
        let (obs, mask) = self.state.encode_obs(4, kan_select);
        let scores = if let Some(session) = &mut self.session {
            let obs = obs.as_standard_layout();
            let mask_view = mask.as_standard_layout();
            let t_obs = TensorRef::from_array_view(([1, 1012, 34], obs.as_slice().context("non-contiguous obs")?))?;
            let t_mask = TensorRef::from_array_view(([1, 46], mask_view.as_slice().context("non-contiguous mask")?))?;
            let outputs = session.run(ort::inputs!["obs" => t_obs, "mask" => t_mask])?;
            let (shape, values) = outputs["q"].try_extract_tensor::<f32>()?;
            anyhow::ensure!(**shape == [1, 46] && values.len() == 46, "unexpected q shape: {shape:?}");
            values.to_vec()
        } else { mask.iter().map(|&m| if m { 0.0 } else { f32::NEG_INFINITY }).collect() };
        let mut scores: [f32; 46] = scores.try_into().map_err(|_| anyhow::anyhow!("invalid model action count"))?;
        let mut allowed: [bool; 46] = std::array::from_fn(|i| mask[i]);
        if let Some(choices) = choices {
            for (index, permitted) in allowed.iter_mut().enumerate() {
                *permitted &= index < 37 && riichi::tile::Tile::try_from(index)
                    .map(|tile| choices.contains(&tile.to_string())).unwrap_or(false);
            }
        }
        if !kan_select && self.style == crate::policy::Style::CallManiac && self.intensity > 0.0 {
            // Never trade an available win for an aggressive call.
            if allowed[43] && scores[43].is_finite() { return Ok(43); }
            for index in 38..=42 {
                if !allowed[index] || (index == 42 && !self.state.last_cans().can_daiminkan) { continue; }
                allowed[index] = crate::action::decode(&self.state, self.seat, index, None)
                    .map(|event| crate::yaku_guard::call_has_yaku_route(&self.state, &event))
                    .unwrap_or(false);
            }
            if self.state.last_cans().can_discard {
                let useful = crate::yaku_guard::useful_discards(&self.state);
                if useful.iter().any(|&x| x) {
                    for index in 0..=36 {
                        let base = match index { 34 => 4, 35 => 13, 36 => 22, _ => index };
                        allowed[index] &= useful[base];
                    }
                }
            }
        }
        if !kan_select && self.style != crate::policy::Style::Default && self.intensity > 0.0 {
            let policy_state = crate::policy::PolicyState {
                tehai: self.state.tehai(),
                tiles_seen: self.state.tactical_tiles_seen(),
                dora_factor: self.state.tactical_dora_factor(),
                riichi: self.state.tactical_riichi(),
                rivers: self.state.tactical_rivers(),
                tiles_left: self.state.tactical_tiles_left(),
            };
            crate::policy::apply_bias(&mut scores, &allowed, self.style, self.intensity, &policy_state, kan_select);
        }
        scores.iter().enumerate().filter(|(i, q)| q.is_finite() && allowed[*i])
            .max_by(|(i, a), (j, b)| a.total_cmp(b).then_with(|| j.cmp(i)))
            .map(|(i, _)| i).context("no finite legal action")
    }
    fn decide(&mut self) -> Result<Option<Event>> {
        let index = self.choose_index(false)?;
        let cans = self.state.last_cans();
        let kan_tile = if index == 42 && !cans.can_daiminkan {
            Some(self.choose_index(true)?)
        } else { None };
        Ok(Some(crate::action::decode(&self.state, self.seat, index, kan_tile)?))
    }

}

fn sorted_hand(state: &PlayerState, count: usize) -> Option<Vec<riichi::tile::Tile>> {
    let counts = state.tehai();
    let reds = state.akas_in_hand();
    let mut tiles = Vec::with_capacity(count);
    for (i, &num) in counts.iter().enumerate() {
        let tile = riichi::tile::Tile::try_from(i).ok()?;
        let red = i < 27 && i % 9 == 4 && reds[i / 9];
        if red { tiles.push(tile.akaize()); }
        for _ in 0..num.checked_sub(u8::from(red))? { tiles.push(tile); }
    }
    Some(tiles)
}

/// Derive the standard sorted hand, preserving the separated drawn tile when present.
fn display_hand(state: &PlayerState, synthetic_draw: bool) -> Option<(Vec<riichi::tile::Tile>, Option<usize>)> {
    let count = state.tehai().iter().map(|&n| usize::from(n)).sum::<usize>();
    if !matches!(count, 2 | 5 | 8 | 11 | 14) { return None; }
    let mut tiles = sorted_hand(state, count)?;
    // The first dealer draw is synthetic; the game displays those tiles together.
    if !synthetic_draw {
        if let Some(draw) = state.last_self_tsumo() {
            let index = tiles.iter().position(|&t| t == draw)?;
            tiles.remove(index);
            tiles.push(draw);
            return Some((tiles, Some(count - 1)));
        }
    }
    Some((tiles, None))
}

/// A chi takes two tiles from the resting hand. Keep red and plain fives distinct.
fn chi_positions(state: &PlayerState, consumed: [riichi::tile::Tile; 2]) -> Option<([usize; 2], usize)> {
    let count = state.tehai().iter().map(|&n| usize::from(n)).sum::<usize>();
    if !matches!(count, 4 | 7 | 10 | 13) { return None; }
    let tiles = sorted_hand(state, count)?;
    let first = tiles.iter().position(|&tile| tile == consumed[0])?;
    let second = tiles.iter().position(|&tile| tile == consumed[1])?;
    (first != second).then_some(([first, second], count))
}

fn discard_position(state: &PlayerState, action: &Event, synthetic_draw: bool) -> Option<(usize, usize, Option<usize>)> {
    let Event::Dahai { pai, .. } = action else { return None };
    let (tiles, drawn) = display_hand(state, synthetic_draw)?;
    let index = if drawn.is_some() && state.last_self_tsumo() == Some(*pai) {
        drawn?
    } else {
        tiles.iter().position(|t| t == pai)?
    };
    Some((index, tiles.len(), drawn))
}

/// Rank plausible wait shapes using only known tiles. These weights order
/// warnings and are not calibrated probabilities.
fn discard_risk(tile: usize, river: &[bool; 34], seen: &[u8; 34]) -> (u8, &'static str) {
    if river[tile] { return (0, "genbutsu"); }
    let unseen = 4_u8.saturating_sub(seen[tile]);
    let single_or_pair = u8::from(unseen >= 1) + u8::from(unseen >= 2);
    if tile >= 27 {
        return (match unseen { 3.. => 6, 2 => 3, _ => single_or_pair }, "honor");
    }
    let rank = tile % 9;
    let suit = tile - rank;
    let mut two_sided = 0;
    let mut narrow = 0;
    let mut suji = false;
    for start in rank.saturating_sub(2)..=rank.min(6) {
        let mut needed = (start..start + 3).filter(|&r| r != rank);
        if !needed.all(|r| seen[suit + r] < 4) { continue; }
        let other_end = match rank - start {
            0 if rank + 3 < 9 => Some(rank + 3),
            2 if rank >= 3 => Some(rank - 3),
            _ => None,
        };
        match other_end {
            Some(other) if river[suit + other] => suji = true,
            Some(_) => two_sided += 1,
            None => narrow += 1,
        }
    }
    let reason = match (two_sided, suji, narrow) {
        (0, true, _) => "suji",
        (0, false, 0) => "pair",
        (0, false, _) => "narrow",
        (_, true, _) => "half_suji",
        _ => "unsuji",
    };
    ((3_u8 * two_sided + narrow + single_or_pair).saturating_sub(u8::from(suji)), reason)
}

fn danger_tiles(state: &PlayerState, tiles: &[riichi::tile::Tile], drawn: Option<usize>) -> Vec<serde_json::Value> {
    let riichi = state.tactical_riichi();
    let rivers = state.tactical_rivers();
    let seen = state.tactical_tiles_seen();
    let dora = state.tactical_dora_factor();
    let opponents = state.tactical_opponents();
    let legal = state.discard_candidates_aka();
    let mut result = Vec::new();
    for (index, tile) in tiles.iter().enumerate() {
        if !legal[tile.as_usize()] || (state.self_riichi_accepted() && Some(index) != drawn) { continue; }
        let base = tile.deaka().as_usize();
        let worst = (1..4).filter_map(|seat| {
            let (discards, open, closed) = opponents[seat];
            let (level, score, reason, threat_type) = threat_risk(
                base, &rivers[seat], &seen, riichi[seat], discards, open, closed,
            )?;
            Some((seat, level, score, reason, threat_type))
        }).max_by_key(|&(seat, level, score, _, threat_type)| (level, threat_type == "riichi", score, 4 - seat));
        if let Some((seat, level, _, reason, threat_type)) = worst {
            result.push(serde_json::json!({
                "hand_index": index, "pai": tile.to_string(), "threat": seat,
                "threat_type": threat_type, "reason": reason,
                "level": if level == 2 { "high" } else { "medium" },
                "dora": dora[base] > 0 || tile.as_usize() >= 34,
            }));
        }
    }
    result
}

/// Four fixed melds leave only a pair to complete. For other undeclared
/// hands, open melds and late discards are evidence of pressure, not tenpai.
fn threat_risk(
    tile: usize, river: &[bool; 34], seen: &[u8; 34], riichi: bool,
    discards: usize, open: usize, closed: usize,
) -> Option<(u8, u8, &'static str, &'static str)> {
    if river[tile] { return None; }
    let (score, reason) = discard_risk(tile, river, seen);
    let threat_type = if riichi { "riichi" } else if open >= 3 || (open >= 2 && discards >= 8) {
        "open"
    } else if discards >= 10 {
        "late"
    } else {
        return None;
    };
    if open + closed >= 4 {
        return (seen[tile] < 4).then_some((1, 3, "tanki", threat_type));
    }
    let (minimum, high) = match threat_type {
        "riichi" => (3, 6),
        "open" if open >= 3 => (4, u8::MAX),
        "open" => (6, u8::MAX),
        _ => (8, u8::MAX),
    };
    (score >= minimum).then_some((if score >= high { 2 } else { 1 }, score, reason, threat_type))
}

/// Verify the shipped model and runtime with a legal sample hand.
pub fn self_test(model: &Path) -> Result<()> {
    let mut engine = Inference::new(0, Some(model))?;
    let start: Event = serde_json::from_value(serde_json::json!({
        "type":"start_kyoku", "bakaze":"E", "dora_marker":"7s", "kyoku":1,
        "honba":0, "kyotaku":0, "oya":0, "scores":[25000,25000,25000,25000],
        "tehais":[["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","E"],
                   ["?","?","?","?","?","?","?","?","?","?","?","?","?"],
                   ["?","?","?","?","?","?","?","?","?","?","?","?","?"],
                   ["?","?","?","?","?","?","?","?","?","?","?","?","?"]]
    }))?;
    engine.process(start, false)?;
    let draw: Event = serde_json::from_value(serde_json::json!({"type":"tsumo","actor":0,"pai":"E"}))?;
    let suggestion = engine.process(draw, true)?.context("model returned no recommendation")?;
    anyhow::ensure!(suggestion["source"] == "model", "model inference was not used");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn riichi_discard_uses_only_offered_tiles_and_restores_state() {
        let mut engine = Inference::new(0, None).unwrap();
        engine.process(round(), false).unwrap();
        let draw = serde_json::from_value(serde_json::json!({"type":"tsumo","actor":0,"pai":"E"})).unwrap();
        engine.process(draw, false).unwrap();
        assert!(engine.state.last_cans().can_riichi);
        let before = engine.state.encode_obs(4, false).1;
        let (tile, index, count, _) = engine.riichi_discard(&["1m".into(), "1z".into()]).unwrap();
        assert_eq!((tile.as_str(), index, count), ("1m", 0, 14));
        let (tile, index, count, drawn) = engine.riichi_discard(&["1z".into()]).unwrap();
        assert_eq!((tile.as_str(), index, count, drawn), ("E", 13, 14, Some(13)));
        assert_eq!(engine.state.encode_obs(4, false).1, before);
        assert!(engine.riichi_discard(&["9z".into()]).is_err());
        assert_eq!(engine.state.encode_obs(4, false).1, before);
    }
    #[test]
    fn undeclared_threats_require_public_evidence() {
        let mut river = [false; 34];
        let mut seen = [0; 34];
        assert!(threat_risk(4, &river, &seen, false, 7, 0, 0).is_none());
        assert_eq!(threat_risk(4, &river, &seen, false, 10, 0, 0).unwrap().3, "late");
        assert_eq!(threat_risk(4, &river, &seen, false, 5, 3, 0).unwrap().0, 1);
        assert_eq!(threat_risk(4, &river, &seen, false, 5, 4, 0).unwrap().2, "tanki");
        seen[4] = 4;
        assert!(threat_risk(4, &river, &seen, false, 5, 4, 0).is_none());
        river[4] = true;
        assert!(threat_risk(4, &river, &seen, false, 12, 3, 0).is_none());
    }
    #[test]
    fn three_pon_events_produce_warnings_without_riichi() {
        let mut engine = Inference::new(0, None).unwrap();
        engine.process(round(), false).unwrap();
        for tile in ["P", "F", "C"] {
            for event in [
                serde_json::json!({"type":"tsumo","actor":3,"pai":"?"}),
                serde_json::json!({"type":"dahai","actor":3,"pai":tile,"tsumogiri":true}),
                serde_json::json!({"type":"pon","actor":1,"target":3,"pai":tile,"consumed":[tile,tile]}),
                serde_json::json!({"type":"dahai","actor":1,"pai":"9s","tsumogiri":false}),
            ] {
                engine.process(serde_json::from_value(event).unwrap(), false).unwrap();
            }
        }
        let draw = serde_json::from_value(serde_json::json!({"type":"tsumo","actor":0,"pai":"5m"})).unwrap();
        let result = engine.process(draw, true).unwrap().unwrap();
        assert_eq!(result["riichi_threats"], 0);
        assert!(result["danger_tiles"].as_array().unwrap().iter().any(|entry| {
            entry["pai"] == "5m" && entry["level"] == "medium" && entry["threat_type"] == "open"
        }));
    }
    #[test]
    fn danger_tracks_each_opponent_and_duplicate_positions() {
        let mut engine = Inference::new(0, None).unwrap();
        engine.process(round(), false).unwrap();
        let apply = |engine: &mut Inference, event: serde_json::Value| {
            engine.process(serde_json::from_value(event).unwrap(), false).unwrap();
        };
        apply(&mut engine, serde_json::json!({"type":"tsumo","actor":1,"pai":"?"}));
        apply(&mut engine, serde_json::json!({"type":"reach","actor":1}));
        apply(&mut engine, serde_json::json!({"type":"dahai","actor":1,"pai":"9s","tsumogiri":true}));
        apply(&mut engine, serde_json::json!({"type":"tsumo","actor":0,"pai":"5m"}));
        let (tiles, drawn) = display_hand(&engine.state, false).unwrap();
        let dangers = danger_tiles(&engine.state, &tiles, drawn);
        let fives: Vec<_> = dangers.iter().filter(|v| v["pai"] == "5m").collect();
        assert_eq!(fives.len(), 2);
        assert_ne!(fives[0]["hand_index"], fives[1]["hand_index"]);
        assert!(fives.iter().all(|v| v["threat"] == 1 && v["reason"] == "unsuji"));

        // Genbutsu against one opponent is not safe against another.
        apply(&mut engine, serde_json::json!({"type":"dahai","actor":0,"pai":"1m","tsumogiri":false}));
        apply(&mut engine, serde_json::json!({"type":"tsumo","actor":2,"pai":"?"}));
        apply(&mut engine, serde_json::json!({"type":"reach","actor":2}));
        apply(&mut engine, serde_json::json!({"type":"dahai","actor":2,"pai":"5m","tsumogiri":true}));
        apply(&mut engine, serde_json::json!({"type":"tsumo","actor":0,"pai":"E"}));
        let (tiles, drawn) = display_hand(&engine.state, false).unwrap();
        assert!(danger_tiles(&engine.state, &tiles, drawn).iter()
            .any(|v| v["pai"] == "5m" && v["threat"] == 1));
    }
    #[test]
    fn danger_omits_genbutsu_but_reports_half_suji_and_edge_ranks() {
        let mut engine = Inference::new(0, None).unwrap();
        engine.process(round(), false).unwrap();
        for value in [
            serde_json::json!({"type":"tsumo","actor":1,"pai":"?"}),
            serde_json::json!({"type":"reach","actor":1}),
            serde_json::json!({"type":"dahai","actor":1,"pai":"2m","tsumogiri":true}),
        ] {
            engine.process(serde_json::from_value(value).unwrap(), false).unwrap();
        }
        let result = engine.process(serde_json::from_value(serde_json::json!({"type":"tsumo","actor":0,"pai":"5m"})).unwrap(), true).unwrap().unwrap();
        let dangers = result["danger_tiles"].as_array().unwrap();
        assert!(dangers.iter().all(|v| v["pai"] != "2m"));
        assert!(dangers.iter().any(|v| v["pai"] == "5m" && v["reason"] == "half_suji"));
        assert!(dangers.iter().any(|v| v["pai"] == "1m" && v["level"] == "medium"));
        assert!(dangers.iter().any(|v| v["pai"] == "E" && v["reason"] == "honor"));
        assert_eq!(result["riichi_threats"], 1);
        assert_eq!(result["hand_count"], 14);
        assert_eq!(result["drawn_index"], 13);
    }
    fn round() -> Event {
        serde_json::from_value(serde_json::json!({"type":"start_kyoku", "bakaze":"E", "dora_marker":"7s", "kyoku":1, "honba":0, "kyotaku":0, "oya":0, "scores":[25000,25000,25000,25000], "tehais":[["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","E"],["?","?","?","?","?","?","?","?","?","?","?","?","?"],["?","?","?","?","?","?","?","?","?","?","?","?","?"],["?","?","?","?","?","?","?","?","?","?","?","?","?"]]})).unwrap()
    }
    #[test]
    fn intermediate_events_update_without_suggestions() {
        let mut engine = Inference::new(0, None).unwrap();
        engine.process(round(), false).unwrap();
        let draw = serde_json::from_value(serde_json::json!({"type":"tsumo", "actor":0, "pai":"E"})).unwrap();
        assert!(engine.process(draw, false).unwrap().is_none());
        let discard = serde_json::from_value(serde_json::json!({"type":"dahai", "actor":0, "pai":"E", "tsumogiri":true})).unwrap();
        assert!(engine.process(discard, true).unwrap().is_none());
    }
    #[test]
    fn tile_positions_keep_red_five_and_draw_separate() {
        let event: Event = serde_json::from_value(serde_json::json!({"type":"start_kyoku","bakaze":"E","dora_marker":"7s","kyoku":1,"honba":0,"kyotaku":0,"oya":0,"scores":[25000,25000,25000,25000],"tehais":[["4m","5mr","5m","6m","1p","2p","3p","4p","5p","6p","E","E","N"],["?","?","?","?","?","?","?","?","?","?","?","?","?"],["?","?","?","?","?","?","?","?","?","?","?","?","?"],["?","?","?","?","?","?","?","?","?","?","?","?","?"]]})).unwrap();
        let mut state = PlayerState::new(0); state.update(&event).unwrap();
        let draw: Event = serde_json::from_value(serde_json::json!({"type":"tsumo","actor":0,"pai":"2m"})).unwrap(); state.update(&draw).unwrap();
        let discard = |pai: &str| -> Event { serde_json::from_value(serde_json::json!({"type":"dahai","actor":0,"pai":pai,"tsumogiri":false})).unwrap() };
        assert_eq!(discard_position(&state, &discard("5mr"), false), Some((1,14,Some(13))));
        assert_eq!(discard_position(&state, &discard("5m"), false), Some((2,14,Some(13))));
        assert_eq!(discard_position(&state, &discard("2m"), false), Some((13,14,Some(13))));
        assert_eq!(discard_position(&state, &discard("2m"), true), Some((0,14,None)));
    }
    #[test]
    fn concurrent_model_sessions_can_be_created_and_dropped() {
        let Some(model) = std::env::var_os("MAJSOUL_TEST_MODEL") else { return };
        std::thread::scope(|scope| {
            let mut handles = Vec::new();
            for _ in 0..2 {
                let path = std::path::PathBuf::from(&model);
                handles.push(scope.spawn(move || {
                    let mut engine = Inference::new(0, Some(&path)).unwrap();
                    engine.process(round(), true).unwrap();
                    let draw = serde_json::from_value(serde_json::json!({"type":"tsumo", "actor":0, "pai":"E"})).unwrap();
                    assert!(engine.process(draw, true).unwrap().is_some());
                }));
            }
            for handle in handles { handle.join().unwrap(); }
        });
    }
    #[test]
    fn draw_generates_a_legal_suggestion() {
        let model = std::env::var_os("MAJSOUL_TEST_MODEL").map(std::path::PathBuf::from);
        let mut engine = Inference::new(0, model.as_deref()).unwrap();
        assert!(engine.process(round(), true).unwrap().is_none());
        let draw = serde_json::from_value(serde_json::json!({"type":"tsumo", "actor":0, "pai":"E"})).unwrap();
        let result = engine.process(draw, true).unwrap().unwrap();
        assert!(result["type"] == "dahai" || result["type"] == "reach" || result["type"] == "hora");
        assert!(result["shanten"].is_number());
        assert!(result.get("win_rate").is_none());
    }
    #[test]
    fn style_changes_legal_decision_and_survives_state_reset() {
        let mut engine = Inference::new(0, None).unwrap();
        let draw = || serde_json::from_value(serde_json::json!({"type":"tsumo", "actor":0, "pai":"N"})).unwrap();
        engine.process(round(), false).unwrap();
        let baseline = engine.process(draw(), true).unwrap().unwrap();
        engine.reset();
        engine.set_policy(crate::policy::Style::CallManiac, 1.0);
        engine.process(round(), false).unwrap();
        let aggressive = engine.process(draw(), true).unwrap().unwrap();
        assert_eq!(baseline["pai"], "1m");
        assert_eq!(aggressive["pai"], "E");
        engine.reset();
        engine.process(round(), false).unwrap();
        assert_eq!(engine.process(draw(), true).unwrap().unwrap()["pai"], "E");
        engine.reset();
        engine.set_policy(crate::policy::Style::CallManiac, 0.0);
        engine.process(round(), false).unwrap();
        assert_eq!(engine.process(draw(), true).unwrap().unwrap()["pai"], "1m");
    }
    fn response_engine_model(hand: [&str; 13], discard: &str, intensity: f32, model: Option<&Path>) -> serde_json::Value {
        let hidden = ["?"; 13];
        let mut engine = Inference::new(0, model).unwrap();
        engine.set_policy(crate::policy::Style::CallManiac, intensity);
        let start = serde_json::json!({"type":"start_kyoku","bakaze":"E","dora_marker":"9s",
            "kyoku":1,"honba":0,"kyotaku":0,"oya":3,"scores":[25000,25000,25000,25000],
            "tehais":[hand,hidden,hidden,hidden]});
        engine.process(serde_json::from_value(start).unwrap(), false).unwrap();
        engine.process(serde_json::from_value(serde_json::json!({"type":"tsumo","actor":3,"pai":"?"})).unwrap(), false).unwrap();
        engine.process(serde_json::from_value(serde_json::json!({"type":"dahai","actor":3,"pai":discard,"tsumogiri":true})).unwrap(), true).unwrap().unwrap()
    }
    fn response_engine(hand: [&str; 13], discard: &str, intensity: f32) -> serde_json::Value {
        response_engine_model(hand, discard, intensity, None)
    }
    #[test]
    fn call_maniac_passes_on_call_without_yaku() {
        let hand = ["2m","3m","4p","5p","6p","7s","8s","9s","5p","5p","7p","8p","E"];
        assert_eq!(response_engine(hand, "1m", 2.0)["type"], "none");
        assert_eq!(response_engine(hand, "1m", 0.0)["type"], "chi");
    }
    #[test]
    fn call_maniac_still_calls_for_tanyao() {
        let hand = ["2m","3m","3p","4p","5p","4s","5s","6s","6p","7p","8p","5s","6s"];
        assert_eq!(response_engine(hand, "4m", 1.0)["type"], "chi");
    }
    #[test]
    fn call_maniac_takes_ron_before_calling() {
        let hand = ["1m","2m","3m","2p","3p","4p","3s","4s","5s","E","E","E","5p"];
        assert_eq!(response_engine(hand, "5p", 2.0)["type"], "hora");
    }
    #[test]
    fn real_model_does_not_call_without_yaku_route() {
        let Some(model) = std::env::var_os("MAJSOUL_TEST_MODEL") else { return };
        let hand = ["2m","3m","4p","5p","6p","7s","8s","9s","5p","5p","7p","8p","E"];
        let result = response_engine_model(hand, "1m", 2.0, Some(std::path::Path::new(&model)));
        assert_eq!(result["source"], "model");
        assert_eq!(result["type"], "none");
    }
}
