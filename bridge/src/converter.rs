//! Convert supported four-player Mahjong Soul actions into MJAI.
//!
//! The public gameplay schema uses *strings* such as `0m` and `1z` on the
//! wire, not tile IDs. A local 34-index representation is used only to check
//! duplicate tile counts; it is not a wire format assumption.
//! ActionPrototype.data must be deobfuscated by the framing layer before this
//! module is called. A missing or unsupported state-changing action quarantines
//! the incremental stream until a subsequent valid `ActionNewRound`.

use prost::Message;
use serde::Serialize;

use crate::{
    majsoul_proto::{ActionDealTile, ActionDiscardTile, ActionNewRound, ActionPrototype, ActionChiPengGang, ActionAnGangAddGang, LiQiSuccess},
    state::BridgeState,
};

fn parse_majsoul_tile(tile: &str) -> Result<(i32, bool), String> {
    let bytes = tile.as_bytes();
    if bytes.len() != 2 {
        return Err(format!("invalid Mahjong Soul tile {tile:?}"));
    }
    let rank = bytes[0];
    let suit = bytes[1];
    match suit {
        b'm' | b'p' | b's' => {
            let base: i32 = match suit { b'm' => 0, b'p' => 9, _ => 18 };
            if rank == b'0' {
                Ok((base + 4, true))
            } else if (b'1'..=b'9').contains(&rank) {
                Ok((base + i32::from(rank - b'1'), false))
            } else {
                Err(format!("invalid Mahjong Soul tile {tile:?}"))
            }
        }
        b'z' if (b'1'..=b'7').contains(&rank) => Ok((27 + i32::from(rank - b'1'), false)),
        _ => Err(format!("invalid Mahjong Soul tile {tile:?}")),
    }
}

pub fn majsoul_tile_to_mjai(tile: &str) -> Result<String, String> {
    // Majsoul sends textual tile names, not numeric IDs. Treat the hidden-tile
    // marker separately; callers that require a visible tile must reject it.
    let mapped = match tile.as_bytes() {
        b"?" => "?",
        b"0m" => "5mr", b"0p" => "5pr", b"0s" => "5sr",
        b"1z" => "E", b"2z" => "S", b"3z" => "W", b"4z" => "N",
        b"5z" => "P", b"6z" => "F", b"7z" => "C",
        [b'1'..=b'9', b'm' | b'p' | b's'] => tile,
        _ => return Err(format!("invalid Mahjong Soul tile {tile:?}")),
    };
    Ok(mapped.to_owned())
}

fn is_false(value: &bool) -> bool { !*value }

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MjaiEvent {
    StartGame { id: u8 },
    StartKyoku {
        bakaze: &'static str,
        kyoku: u32,
        honba: u32,
        kyotaku: u32,
        oya: u8,
        dora_marker: String,
        scores: [i32; 4],
        tehais: [Vec<String>; 4],
    },
    Tsumo {
        actor: u8,
        pai: String,
        // The 14th dealer tile is a representation choice, not a verified
        // physical draw. Existing MJAI readers may safely ignore extra fields.
        #[serde(skip_serializing_if = "is_false")]
        synthetic_opening_draw: bool,
    },
    Dahai { actor: u8, pai: String, tsumogiri: bool },
    Reach { actor: u8 },
    ReachAccepted { actor: u8 },
    Dora { dora_marker: String },
    Chi { actor: u8, target: u8, pai: String, consumed: Vec<String> },
    Pon { actor: u8, target: u8, pai: String, consumed: Vec<String> },
    Daiminkan { actor: u8, target: u8, pai: String, consumed: Vec<String> },
    Ankan { actor: u8, consumed: Vec<String> },
    Kakan { actor: u8, pai: String, consumed: Vec<String> },
    EndKyoku,

}

fn seat(id: u32) -> Result<u8, String> {
    if id > 3 { return Err(format!("invalid seat {id}; only four-player games are supported")); }
    Ok(id as u8)
}

fn append_doras(state: &mut BridgeState, wire_doras: &[String], events: &mut Vec<MjaiEvent>) -> Result<(), String> {
    if wire_doras.is_empty() { return Ok(()); }
    let converted = wire_doras.iter().map(|d| majsoul_tile_to_mjai(d)).collect::<Result<Vec<_>, _>>()?;
    if converted.iter().any(|d| d == "?") || !converted.starts_with(&state.doras) || converted.len() > 5 {
        return Err("inconsistent dora indicators".into());
    }
    for d in &converted[state.doras.len()..] { events.push(MjaiEvent::Dora { dora_marker: d.clone() }); }
    state.doras = converted;
    Ok(())
}
fn append_reach(liqi: Option<LiQiSuccess>, events: &mut Vec<MjaiEvent>) -> Result<(), String> {
    if let Some(liqi) = liqi {
        if liqi.liqi_type_beishuizhizhan != 0 || liqi.xia_ke_shang.is_some() { return Err("unsupported special-mode riichi".into()); }
        if !liqi.failed { events.push(MjaiEvent::ReachAccepted { actor: seat(liqi.seat)? }); }
    }
    Ok(())
}

fn start_round(state: &mut BridgeState, data: &[u8], step: u32) -> Result<Vec<MjaiEvent>, String> {
    let round = ActionNewRound::decode(data).map_err(|e| format!("ActionNewRound protobuf: {e}"))?;
    // Ordinary captures may include one empty `opens` entry per seat. Only
    // reject entries carrying actual open tiles/counts or special-mode state.
    if round.opens.iter().any(|opened| !opened.tiles.is_empty() || !opened.count.is_empty())
        || round.muyu.is_some() || round.field_spell != 0 || round.yongchang.is_some()
        || round.xia_ke_shang.is_some()
    {
        return Err("round contains unsupported opening/special-mode state".into());
    }
    let bakaze = match round.chang {
        0 => "E", 1 => "S", 2 => "W", 3 => "N",
        n => return Err(format!("invalid round wind {n}")),
    };
    let oya = seat(round.ju)?;
    let expected_tiles = if oya == state.seat { 14 } else { 13 };
    if round.tiles.len() != expected_tiles {
        return Err(format!("expected {expected_tiles} visible own starting tiles for seat {}, received {}", state.seat, round.tiles.len()));
    }

    let mut counts = [0_u8; 34];
    let mut red_fives = [false; 3];
    let mut own_hand = Vec::with_capacity(expected_tiles);
    for wire in &round.tiles {
        let (id, red) = parse_majsoul_tile(wire)?;
        let index = id as usize;
        counts[index] += 1;
        if counts[index] > 4 { return Err(format!("starting hand has too many {wire} tiles")); }
        if red {
            let suit = index / 9;
            if red_fives[suit] { return Err(format!("duplicate red five {wire}")); }
            red_fives[suit] = true;
        }
        own_hand.push(majsoul_tile_to_mjai(wire)?);
    }
    // The protocol supplies a 14-tile dealer hand but does not establish which
    // tile was drawn. Split it only as a deterministic representation of the
    // *same multiset*; the marked draw must not be treated as physical fact.
    let synthetic_opening = if oya == state.seat { own_hand.pop() } else { None };

    let dora_wire = if let Some(first) = round.doras.first() {
        if round.doras.len() != 1 {
            return Err("multiple starting dora indicators are unsupported".into());
        }
        if !round.dora.is_empty() && round.dora != *first {
            return Err("conflicting dora and doras fields".into());
        }
        first.as_str()
    } else if !round.dora.is_empty() {
        round.dora.as_str()
    } else {
        return Err("missing starting dora indicator".into());
    };
    let dora = majsoul_tile_to_mjai(dora_wire)?;
    if dora == "?" { return Err("starting dora indicator cannot be hidden".into()); }
    if round.scores.len() != 4 {
        return Err(format!("expected four scores, received {}; only four-player games are supported", round.scores.len()));
    }
    let scores = [round.scores[0], round.scores[1], round.scores[2], round.scores[3]];
    let mut tehais: [Vec<String>; 4] = std::array::from_fn(|_| vec!["?".to_owned(); 13]);
    tehais[usize::from(state.seat)] = own_hand;
    let mut events = Vec::with_capacity(3);
    if !state.announced {
        events.push(MjaiEvent::StartGame { id: state.seat });
    }
    events.push(MjaiEvent::StartKyoku {
        bakaze,
        kyoku: round.ju + 1,
        honba: round.ben,
        kyotaku: round.liqibang,
        oya,
        dora_marker: dora.clone(),
        scores,
        tehais,
    });
    // For a nondealer the dealer draw is hidden. For our own dealer, preserve
    // its 14 known tiles but explicitly mark the arbitrary split as synthetic.
    let is_synthetic = synthetic_opening.is_some();
    events.push(MjaiEvent::Tsumo {
        actor: oya,
        pai: synthetic_opening.unwrap_or_else(|| "?".to_owned()),
        synthetic_opening_draw: is_synthetic,
    });
    state.announced = true;
    state.active = true;
    state.last_step = Some(step);
    state.doras = vec![dora];
    state.pons.clear();
    Ok(events)
}

fn convert_inner(state: &mut BridgeState, action: &ActionPrototype) -> Result<Vec<MjaiEvent>, String> {
    let name = action.name.strip_prefix(".lq.").unwrap_or(&action.name);
    if name == "ActionNewRound" {
        return start_round(state, action.data.as_ref(), action.step);
    }
    if name == "ActionMJStart" {
        if state.active { return Err("unexpected ActionMJStart during a round".into()); }
        state.announced = false;
        return Ok(Vec::new());
    }
    if !state.active {
        return Err(format!("cannot map {name}: waiting for a complete, supported ActionNewRound"));
    }
    let expected = state.last_step.and_then(|n| n.checked_add(1)).ok_or("missing/overflowing action step")?;
    if action.step != expected {
        return Err(format!("action step gap: expected {expected}, received {}", action.step));
    }
    let mut events = Vec::new();
    match name {
        "ActionDealTile" => {
            let draw = ActionDealTile::decode(action.data.as_ref()).map_err(|e| format!("ActionDealTile protobuf: {e}"))?;
            if draw.tile_state != 0 || draw.muyu.is_some() || draw.hun_zhi_yi_ji_info.is_some() { return Err("draw contains unsupported special-mode state".into()); }
            append_reach(draw.liqi, &mut events)?;
            append_doras(state, &draw.doras, &mut events)?;
            let actor = seat(draw.seat)?;
            let pai = if draw.tile.is_empty() || draw.tile == "?" {
                if actor == state.seat { return Err("own draw has no visible tile".into()); }
                "?".to_owned()
            } else { majsoul_tile_to_mjai(&draw.tile)? };
            events.push(MjaiEvent::Tsumo { actor, pai, synthetic_opening_draw: false });
        }
        "ActionDiscardTile" => {
            let discard = ActionDiscardTile::decode(action.data.as_ref()).map_err(|e| format!("ActionDiscardTile protobuf: {e}"))?;
            append_doras(state, &discard.doras, &mut events)?;
            if discard.tile_state != 0 || discard.muyu.is_some() || discard.revealed || discard.yongchang.is_some() || discard.hun_zhi_yi_ji_info.is_some() || discard.liqi_type_beishuizhizhan != 0 { return Err("discard contains unsupported special-mode state".into()); }
            let pai = majsoul_tile_to_mjai(&discard.tile)?;
            if pai == "?" { return Err("discard tile cannot be hidden".into()); }
            let actor = seat(discard.seat)?;
            if discard.is_liqi || discard.is_wliqi { events.push(MjaiEvent::Reach { actor }); }
            events.push(MjaiEvent::Dahai { actor, pai, tsumogiri: discard.moqie });
        }
        "ActionChiPengGang" => {
            let call = ActionChiPengGang::decode(action.data.as_ref()).map_err(|e| format!("ActionChiPengGang protobuf: {e}"))?;
            if call.muyu.is_some() || call.yongchang.is_some() || call.hun_zhi_yi_ji_info.is_some() || call.tile_states.iter().any(|&n| n != 0) { return Err("call contains unsupported special-mode state".into()); }
            append_reach(call.liqi, &mut events)?;
            let actor = seat(call.seat)?;
            let count = match call.r#type { 0 | 1 => 3, 2 => 4, _ => return Err("unknown call type".into()) };
            if call.tiles.len() != count || call.froms.len() != count { return Err("invalid call tiles/froms".into()); }
            let mut target = None; let mut pai = None; let mut consumed = Vec::new();
            for (wire, from) in call.tiles.iter().zip(call.froms) {
                let tile = majsoul_tile_to_mjai(wire)?;
                if tile == "?" { return Err("hidden call tile".into()); }
                let from = seat(from)?;
                if from != actor { if target.replace(from).is_some() { return Err("multiple call targets".into()); } pai = Some(tile); } else { consumed.push(tile); }
            }
            let target = target.ok_or("call missing target")?; let pai = pai.ok_or("call missing tile")?;
            events.push(match call.r#type {
                0 => MjaiEvent::Chi { actor, target, pai, consumed },
                1 => { let mut pon = consumed.clone(); pon.push(pai.clone()); state.pons.push((actor, pon)); MjaiEvent::Pon { actor, target, pai, consumed } },
                2 => MjaiEvent::Daiminkan { actor, target, pai, consumed },
                _ => unreachable!(),
            });
        }
        "ActionAnGangAddGang" => {
            let call = ActionAnGangAddGang::decode(action.data.as_ref()).map_err(|e| format!("ActionAnGangAddGang protobuf: {e}"))?;
            if call.muyu.is_some() { return Err("kan contains unsupported special-mode state".into()); }
            append_doras(state, &call.doras, &mut events)?;
            let actor = seat(call.seat)?; let pai = majsoul_tile_to_mjai(&call.tiles)?;
            if pai == "?" { return Err("kan tile is hidden".into()); }
            let base = pai.trim_end_matches('r');
            match call.r#type {
                3 => {
                    let mut consumed = vec![base.to_owned(); 4];
                    if matches!(base, "5m" | "5p" | "5s") { consumed[0] = format!("{base}r"); }
                    events.push(MjaiEvent::Ankan { actor, consumed });
                }
                2 => {
                    let pos = state.pons.iter().position(|(owner, tiles)| *owner == actor && tiles.iter().all(|t| t.trim_end_matches('r') == base)).ok_or("added kan has no matching pon")?;
                    let (_, consumed) = state.pons.remove(pos);
                    events.push(MjaiEvent::Kakan { actor, pai, consumed });
                }
                _ => return Err("unknown kan type".into()),
            }
        }
        "ActionHule" | "ActionNoTile" | "ActionLiuJu" => { events.push(MjaiEvent::EndKyoku); state.active = false; }
        _ => return Err(format!("unsupported action {name}; state is no longer reliable")),
    }
    state.last_step = Some(action.step);
    Ok(events)
}

/// Convert one deobfuscated action. A decode/mapping error never panics and
/// invalidates the incremental state; caller logs the error and forwards the
/// unmodified WebSocket frame independently.
pub fn convert_action(state: &mut BridgeState, action: ActionPrototype) -> Result<Vec<MjaiEvent>, String> {
    let result = convert_inner(state, &action);
    if result.is_err() { state.desynchronize(); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn action<M: Message>(step: u32, name: &str, payload: &M) -> ActionPrototype {
        ActionPrototype { step, name: name.to_owned(), data: payload.encode_to_vec().into() }
    }

    fn round() -> ActionNewRound {
        ActionNewRound {
            chang: 0,
            ju: 0,
            ben: 0,
            tiles: ["1m", "2m", "3m", "4m", "0m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "1z"].iter().map(|x| (*x).to_owned()).collect(),
            dora: "".into(),
            doras: vec!["2z".into()],
            scores: vec![25000; 4],
            ..Default::default()
        }
    }

    #[test]
    fn wire_strings_are_mapped_exactly() {
        for suit in ['m', 'p', 's'] {
            for rank in 1..=9 {
                let tile = format!("{rank}{suit}");
                assert_eq!(majsoul_tile_to_mjai(&tile).unwrap(), tile);
            }
        }
        assert_eq!(majsoul_tile_to_mjai("0m").unwrap(), "5mr");
        assert_eq!(majsoul_tile_to_mjai("0p").unwrap(), "5pr");
        assert_eq!(majsoul_tile_to_mjai("0s").unwrap(), "5sr");
        assert_eq!(majsoul_tile_to_mjai("?").unwrap(), "?");
        for (i, name) in ["E", "S", "W", "N", "P", "F", "C"].iter().enumerate() {
            assert_eq!(majsoul_tile_to_mjai(&format!("{}z", i + 1)).unwrap(), *name);
        }
        for bad in ["", "10m", "8z", "0z", "1x", "1mr", "🀄"] {
            assert!(majsoul_tile_to_mjai(bad).is_err(), "accepted {bad}");
        }
    }

    #[test]
    fn round_draw_and_discard_are_phase1_compatible_json() {
        let mut state = BridgeState::new(1).unwrap();
        let events = convert_action(&mut state, action(1, "ActionNewRound", &round())).unwrap();
        assert_eq!(events.len(), 3);
        let start = serde_json::to_value(&events[1]).unwrap();
        assert_eq!(start["type"], "start_kyoku");
        assert_eq!(start["bakaze"], "E");
        assert_eq!(start["kyoku"], 1);
        assert_eq!(start["oya"], 0);
        assert_eq!(start["dora_marker"], "S");
        assert_eq!(start["tehais"][1][4], "5mr");
        assert_eq!(start["tehais"][0][0], "?");
        assert_eq!(serde_json::to_value(&events[2]).unwrap(), serde_json::json!({"type":"tsumo","actor":0,"pai":"?"}));
        let discard = ActionDiscardTile { seat: 0, tile: "2z".into(), moqie: false, ..Default::default() };
        let e = convert_action(&mut state, action(2, "ActionDiscardTile", &discard)).unwrap();
        assert_eq!(serde_json::to_value(&e[0]).unwrap(), serde_json::json!({"type":"dahai","actor":0,"pai":"S","tsumogiri":false}));
        let draw = ActionDealTile { seat: 1, tile: "0p".into(), ..Default::default() };
        let e = convert_action(&mut state, action(3, "ActionDealTile", &draw)).unwrap();
        assert_eq!(serde_json::to_value(&e[0]).unwrap(), serde_json::json!({"type":"tsumo","actor":1,"pai":"5pr"}));
    }

    #[test]
    fn unsupported_action_or_step_gap_quarantines_until_new_round() {
        let mut state = BridgeState::new(1).unwrap();
        convert_action(&mut state, action(1, "ActionNewRound", &round())).unwrap();
        let unknown = ActionPrototype { step: 2, name: "ActionChiPengGang".into(), data: Default::default() };
        assert!(convert_action(&mut state, unknown).is_err());
        assert!(!state.active);
        let draw = ActionDealTile { seat: 1, tile: "5m".into(), ..Default::default() };
        assert!(convert_action(&mut state, action(3, "ActionDealTile", &draw)).is_err());
        let recovered = convert_action(&mut state, action(0, "ActionNewRound", &round())).unwrap();
        assert_eq!(serde_json::to_value(&recovered[0]).unwrap(), serde_json::json!({"type":"start_game","id":1}));
        assert!(convert_action(&mut state, action(2, "ActionDealTile", &draw)).is_err());
        assert!(!state.active);
    }

    #[test]
    fn local_dealer_14_tiles_preserve_multiset_and_mark_synthetic_draw() {
        let mut state = BridgeState::new(0).unwrap();
        let mut deal = round();
        deal.tiles.push("4p".into());
        let events = convert_action(&mut state, action(1, "ActionNewRound", &deal)).unwrap();
        assert_eq!(events.len(), 3);
        let start = serde_json::to_value(&events[1]).unwrap();
        assert_eq!(start["tehais"][0].as_array().unwrap().len(), 13);
        assert_eq!(start["tehais"][0][4], "5mr");
        assert_eq!(serde_json::to_value(&events[2]).unwrap(), serde_json::json!({
            "type":"tsumo", "actor":0, "pai":"4p", "synthetic_opening_draw":true
        }));
        assert!(state.active);
        // A different authoritative tsumogiri is still passed through: the
        // synthetic tile does not establish the actual physical draw.
        let discard = ActionDiscardTile { seat: 0, tile: "1m".into(), moqie: true, ..Default::default() };
        let events = convert_action(&mut state, action(2, "ActionDiscardTile", &discard)).unwrap();
        assert_eq!(serde_json::to_value(&events[0]).unwrap(), serde_json::json!({"type":"dahai","actor":0,"pai":"1m","tsumogiri":true}));
    }

    #[test]
    fn incomplete_or_mismatched_dealer_hands_are_rejected() {
        let mut state = BridgeState::new(0).unwrap();
        let mut deal = round();
        assert!(convert_action(&mut state, action(1, "ActionNewRound", &deal)).is_err());
        let mut nondealer = BridgeState::new(1).unwrap();
        deal.tiles.push("4p".into());
        assert!(convert_action(&mut nondealer, action(1, "ActionNewRound", &deal)).is_err());
    }

    #[test]
    fn incomplete_or_three_player_scores_cannot_start_four_player_state() {
        let mut state = BridgeState::new(1).unwrap();
        let mut deal = round();
        deal.scores.clear();
        assert!(convert_action(&mut state, action(0, "ActionNewRound", &deal)).is_err());
        deal.scores = vec![25000; 3];
        assert!(convert_action(&mut state, action(0, "ActionNewRound", &deal)).is_err());
        assert!(!state.active);
    }

    #[test]
    fn riichi_dora_and_calls_are_converted() {
        let mut state = BridgeState::new(1).unwrap();
        convert_action(&mut state, action(0, "ActionNewRound", &round())).unwrap();
        let riichi = ActionDiscardTile { seat: 0, tile: "1m".into(), is_liqi: true, ..Default::default() };
        let e = convert_action(&mut state, action(1, "ActionDiscardTile", &riichi)).unwrap();
        assert_eq!(serde_json::to_value(&e[0]).unwrap(), serde_json::json!({"type":"reach","actor":0}));
        assert_eq!(serde_json::to_value(&e[1]).unwrap()["type"], "dahai");
        let draw = ActionDealTile { seat: 1, tile: "5m".into(), liqi: Some(LiQiSuccess { seat: 0, ..Default::default() }), doras: vec!["2z".into(), "3z".into()], ..Default::default() };
        let e = convert_action(&mut state, action(2, "ActionDealTile", &draw)).unwrap();
        assert_eq!(serde_json::to_value(&e[0]).unwrap(), serde_json::json!({"type":"reach_accepted","actor":0}));
        assert_eq!(serde_json::to_value(&e[1]).unwrap(), serde_json::json!({"type":"dora","dora_marker":"W"}));
        let pon = ActionChiPengGang { seat: 1, r#type: 1, tiles: vec!["5m".into(), "0m".into(), "5m".into()], froms: vec![1, 1, 0], ..Default::default() };
        let e = convert_action(&mut state, action(3, "ActionChiPengGang", &pon)).unwrap();
        assert_eq!(serde_json::to_value(&e[0]).unwrap(), serde_json::json!({"type":"pon","actor":1,"target":0,"pai":"5m","consumed":["5m","5mr"]}));
        let kan = ActionAnGangAddGang { seat: 1, r#type: 2, tiles: "5m".into(), ..Default::default() };
        let e = convert_action(&mut state, action(4, "ActionAnGangAddGang", &kan)).unwrap();
        assert_eq!(serde_json::to_value(&e[0]).unwrap(), serde_json::json!({"type":"kakan","actor":1,"pai":"5m","consumed":["5m","5mr","5m"]}));
        assert!(state.active);
    }
    #[test]
    fn closed_kan_and_round_end_are_converted() {
        let mut state = BridgeState::new(1).unwrap();
        convert_action(&mut state, action(0, "ActionNewRound", &round())).unwrap();
        let kan = ActionAnGangAddGang { seat: 0, r#type: 3, tiles: "5p".into(), ..Default::default() };
        let e = convert_action(&mut state, action(1, "ActionAnGangAddGang", &kan)).unwrap();
        assert_eq!(serde_json::to_value(&e[0]).unwrap(), serde_json::json!({"type":"ankan","actor":0,"consumed":["5pr","5p","5p","5p"]}));
        let end = ActionPrototype { step: 2, name: "ActionHule".into(), data: Default::default() };
        assert_eq!(serde_json::to_value(&convert_action(&mut state, end).unwrap()[0]).unwrap()["type"], "end_kyoku");
        assert!(!state.active);
    }

    #[test]
    fn round_allows_seat_only_opens_but_quarantines_special_state() {
        let mut state = BridgeState::new(1).unwrap();
        let mut deal = round();
        deal.opens.resize_with(4, Default::default);
        for (seat, opened) in deal.opens.iter_mut().enumerate() {
            opened.seat = seat as u32;
        }
        assert!(convert_action(&mut state, action(1, "ActionNewRound", &deal)).is_ok());
        deal.opens[2].tiles.push("1m".into());
        assert!(convert_action(&mut state, action(0, "ActionNewRound", &deal)).is_err());
        assert!(!state.active);
        deal.opens[2].tiles.clear();
        deal.opens[2].count.push(1);
        assert!(convert_action(&mut state, action(0, "ActionNewRound", &deal)).is_err());
        deal.opens[2].count.clear();
        deal.field_spell = 1;
        assert!(convert_action(&mut state, action(0, "ActionNewRound", &deal)).is_err());
    }

    #[test]
    fn special_draw_and_discard_quarantine() {
        let mut state = BridgeState::new(1).unwrap();
        convert_action(&mut state, action(0, "ActionNewRound", &round())).unwrap();
        let draw = ActionDealTile { seat: 1, tile: "1m".into(), tile_state: 1, ..Default::default() };
        assert!(convert_action(&mut state, action(1, "ActionDealTile", &draw)).is_err());
        assert!(!state.active);
        convert_action(&mut state, action(0, "ActionNewRound", &round())).unwrap();
        let discard = ActionDiscardTile { seat: 0, tile: "1m".into(), revealed: true, ..Default::default() };
        assert!(convert_action(&mut state, action(1, "ActionDiscardTile", &discard)).is_err());
        assert!(!state.active);
    }

    #[test]
    fn new_special_fields_quarantine_until_valid_new_round() {
        let mut state = BridgeState::new(1).unwrap();
        let mut deal = round();
        deal.xia_ke_shang = Some(Default::default());
        assert!(convert_action(&mut state, action(1, "ActionNewRound", &deal)).is_err());
        deal.xia_ke_shang = None;
        assert!(convert_action(&mut state, action(1, "ActionNewRound", &deal)).is_ok());
        let draw = ActionDealTile { seat: 1, tile: "1m".into(), hun_zhi_yi_ji_info: Some(Default::default()), ..Default::default() };
        assert!(convert_action(&mut state, action(2, "ActionDealTile", &draw)).is_err());
        assert!(!state.active);
        assert!(convert_action(&mut state, action(1, "ActionNewRound", &deal)).is_ok());
        let discard = ActionDiscardTile { seat: 0, tile: "1m".into(), liqi_type_beishuizhizhan: 1, ..Default::default() };
        assert!(convert_action(&mut state, action(2, "ActionDiscardTile", &discard)).is_err());
        assert!(!state.active);
    }

    #[test]
    fn hidden_tile_allowed_only_for_opponent_draws() {
        let mut state = BridgeState::new(1).unwrap();
        convert_action(&mut state, action(1, "ActionNewRound", &round())).unwrap();
        let draw = ActionDealTile { seat: 0, tile: "?".into(), ..Default::default() };
        let events = convert_action(&mut state, action(2, "ActionDealTile", &draw)).unwrap();
        assert_eq!(serde_json::to_value(&events[0]).unwrap(), serde_json::json!({"type":"tsumo","actor":0,"pai":"?"}));
        let discard = ActionDiscardTile { seat: 0, tile: "?".into(), ..Default::default() };
        assert!(convert_action(&mut state, action(3, "ActionDiscardTile", &discard)).is_err());
        convert_action(&mut state, action(1, "ActionNewRound", &round())).unwrap();
        let own = ActionDealTile { seat: 1, tile: "?".into(), ..Default::default() };
        assert!(convert_action(&mut state, action(2, "ActionDealTile", &own)).is_err());
    }
}
