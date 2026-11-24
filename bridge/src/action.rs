//! Convert Mortal's action indices to validated MJAI reactions.
use anyhow::{bail, ensure, Context, Result};
use riichi::{mjai::Event, state::PlayerState, tile::Tile};

/// `kan_tile_index` is the best action under `encode_obs(4, true)` when an
/// ankan/kakan selection is needed. It is not used for daiminkan.
pub fn decode(state: &PlayerState, actor: u8, action_index: usize, kan_tile_index: Option<usize>) -> Result<Event> {
    let cans = state.last_cans();
    let aka = state.akas_in_hand();
    let hand_has_red = |tile: Tile| {
        let t = tile.deaka().as_usize();
        t < 27 && t % 9 == 4 && aka[t / 9]
    };
    let last_discard = || state.last_kawa_tile().context("no last discard for call");
    let reaction = match action_index {
        0..=36 => {
            let pai = Tile::try_from(action_index)?;
            Event::Dahai { actor, pai, tsumogiri: state.last_self_tsumo() == Some(pai) }
        }
        37 => Event::Reach { actor },
        38..=40 => {
            let pai = last_discard()?;
            let (first, second) = match action_index {
                38 => (pai.next(), pai.next().next()),
                39 => (pai.prev(), pai.next()),
                _ => (pai.prev().prev(), pai.prev()),
            };
            let consumed = [if hand_has_red(first) { first.akaize() } else { first },
                            if hand_has_red(second) { second.akaize() } else { second }];
            Event::Chi { actor, target: cans.target_actor, pai, consumed }
        }
        41 => {
            let pai = last_discard()?;
            let plain = pai.deaka();
            let consumed = if hand_has_red(plain) { [plain.akaize(), plain] } else { [plain; 2] };
            Event::Pon { actor, target: cans.target_actor, pai, consumed }
        }
        42 => {
            if cans.can_daiminkan {
                let pai = last_discard()?;
                let plain = pai.deaka();
                let consumed = if hand_has_red(plain) { [plain.akaize(), plain, plain] } else { [plain; 3] };
                Event::Daiminkan { actor, target: cans.target_actor, pai, consumed }
            } else {
                let tile = Tile::try_from(kan_tile_index.context("kan tile selection required")?)?.deaka();
                if cans.can_ankan && state.ankan_candidates().contains(&tile) {
                    let consumed = if hand_has_red(tile) { [tile.akaize(), tile, tile, tile] } else { [tile; 4] };
                    Event::Ankan { actor, consumed }
                } else if cans.can_kakan && state.kakan_candidates().contains(&tile) {
                    let (pai, consumed) = if hand_has_red(tile) {
                        (tile.akaize(), [tile; 3])
                    } else if tile.as_usize() < 27 && tile.as_usize() % 9 == 4 {
                        (tile, [tile.akaize(), tile, tile])
                    } else { (tile, [tile; 3]) };
                    Event::Kakan { actor, pai, consumed }
                } else { bail!("selected tile is not a kan candidate"); }
            }
        }
        43 => Event::Hora { actor, target: cans.target_actor, deltas: None, ura_markers: None },
        44 => Event::Ryukyoku { deltas: None },
        45 => { ensure!(cans.can_pass(), "pass is not a legal choice here"); Event::None },
        _ => bail!("unknown action index {action_index}"),
    };
    state.validate_reaction(&reaction).context("invalid model action")?;
    Ok(reaction)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn start(hand: [&str; 13], oya: u8) -> PlayerState {
        let hidden = ["?"; 13];
        let event: Event = serde_json::from_value(serde_json::json!({
            "type":"start_kyoku", "bakaze":"E", "dora_marker":"7s", "kyoku":1,
            "honba":0, "kyotaku":0, "oya":oya, "scores":[25000,25000,25000,25000],
            "tehais":[hand, hidden, hidden, hidden]
        })).unwrap();
        let mut state = PlayerState::new(0);
        state.update(&event).unwrap();
        state
    }
    fn update(state: &mut PlayerState, value: serde_json::Value) {
        state.update(&serde_json::from_value(value).unwrap()).unwrap();
    }
    #[test]
    fn chi_and_pass_use_live_discard() {
        let mut state = start(["4m","5mr","1p","2p","3p","4p","5p","6p","7s","8s","9s","E","E"], 3);
        update(&mut state, serde_json::json!({"type":"tsumo","actor":3,"pai":"?"}));
        update(&mut state, serde_json::json!({"type":"dahai","actor":3,"pai":"3m","tsumogiri":true}));
        assert_eq!(serde_json::to_value(decode(&state, 0, 38, None).unwrap()).unwrap(), serde_json::json!({"type":"chi","actor":0,"target":3,"pai":"3m","consumed":["4m","5mr"]}));
        assert!(matches!(decode(&state, 0, 45, None).unwrap(), Event::None));
    }
    #[test]
    fn ankan_uses_model_tile_selection() {
        let mut state = start(["5mr","5m","5m","1p","2p","3p","4p","6p","7p","8p","1s","2s","3s"], 0);
        update(&mut state, serde_json::json!({"type":"tsumo","actor":0,"pai":"5m"}));
        assert_eq!(serde_json::to_value(decode(&state, 0, 42, Some(4)).unwrap()).unwrap(), serde_json::json!({"type":"ankan","actor":0,"consumed":["5mr","5m","5m","5m"]}));
        assert!(decode(&state, 0, 42, Some(5)).is_err());
    }
}
