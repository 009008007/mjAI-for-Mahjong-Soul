//! Conservative checks for CallManiac's open-hand decisions.
//! The near-tenpai check uses the actual scoring calculator; earlier hands
//! use limited, explicitly recognized routes rather than claiming certainty.
use riichi::{algo::{agari::AgariCalculator, shanten}, mjai::Event, state::PlayerState};

fn value_honor(tile: usize, winds: (u8, u8)) -> bool {
    (31..=33).contains(&tile) || tile == winds.0 as usize || tile == winds.1 as usize
}

fn fixed_yakuhai(state: &PlayerState) -> bool {
    let winds = state.tactical_winds();
    state.pons().iter().chain(state.minkans()).chain(state.ankans())
        .any(|&tile| value_honor(tile as usize, winds))
}

fn fixed_tanyao(state: &PlayerState) -> bool {
    state.chis().iter().all(|&start| (1..=5).contains(&(start % 9)))
        && state.pons().iter().chain(state.minkans()).chain(state.ankans())
            .all(|&tile| tile < 27 && (1..=7).contains(&(tile % 9)))
}

/// Check actual available winning tiles, excluding situational-only yaku.
fn has_scoring_wait(state: &PlayerState, hand: &[u8; 34], div3: u8) -> bool {
    let seen = state.tactical_tiles_seen();
    let (bakaze, jikaze) = state.tactical_winds();
    for tile in 0..34 {
        if seen[tile] >= 4 || hand[tile] >= 4 { continue; }
        let mut complete = *hand;
        complete[tile] += 1;
        if shanten::calc_normal(&complete, div3) != -1 { continue; }
        let calc = AgariCalculator {
            tehai: &complete, is_menzen: false, chis: state.chis(), pons: state.pons(),
            minkans: state.minkans(), ankans: state.ankans(), bakaze, jikaze,
            winning_tile: tile as u8, is_ron: true,
        };
        if calc.has_yaku() { return true; }
    }
    false
}

/// Whether this 3n+1 hand has a concrete near-term route to an open yaku.
fn viable(state: &PlayerState, hand: &[u8; 34]) -> bool {
    let count: usize = hand.iter().map(|&n| n as usize).sum();
    if count % 3 != 1 { return false; }
    let div3 = (count / 3) as u8;
    let normal = shanten::calc_normal(hand, div3);
    if normal == 0 { return has_scoring_wait(state, hand, div3); }
    if fixed_yakuhai(state) { return true; }

    let seen = state.tactical_tiles_seen();
    let winds = state.tactical_winds();
    // A complete concealed value-honor triplet already scores; a pair needs
    // at least one unseen copy to become a triplet.
    if (27..34).any(|t| value_honor(t, winds)
        && (hand[t] >= 3 || hand[t] == 2 && seen[t] < 4)) {
        return true;
    }
    // Require an all-simples plan within one extra draw of the ordinary hand.
    if fixed_tanyao(state) {
        let mut simples = *hand;
        for (tile, count) in simples.iter_mut().enumerate() {
            if tile >= 27 || matches!(tile % 9, 0 | 8) { *count = 0; }
        }
        if shanten::calc_normal(&simples, div3) <= normal + 1 { return true; }
    }
    // Honitsu/chinitsu remains possible only when every exposed set uses the
    // same suit (honor triplets are permitted for honitsu).
    for suit in 0..3 {
        if state.chis().iter().any(|&t| t as usize / 9 != suit)
            || state.pons().iter().chain(state.minkans()).chain(state.ankans())
                .any(|&t| t < 27 && t as usize / 9 != suit) {
            continue;
        }
        let mut flush = *hand;
        for (tile, count) in flush.iter_mut().enumerate() {
            if tile < 27 && tile / 9 != suit { *count = 0; }
        }
        if shanten::calc_normal(&flush, div3) <= normal + 1 { return true; }
    }
    false
}

/// Check a call after applying it to a clone, including each legal discard.
pub fn call_has_yaku_route(state: &PlayerState, action: &Event) -> bool {
    let before_hand = state.tehai();
    let before_div3 = (before_hand.iter().map(|&n| n as usize).sum::<usize>() / 3) as u8;
    let before = shanten::calc_normal(&before_hand, before_div3);
    let mut after = state.clone();
    if after.update(action).is_err() { return false; }
    let hand = after.tehai();
    if after.last_cans().can_discard {
        after.discard_candidates().iter().enumerate().any(|(tile, &allowed)| {
            if !allowed || hand[tile] == 0 { return false; }
            let mut remaining = hand;
            remaining[tile] -= 1;
            let div3 = (remaining.iter().map(|&n| n as usize).sum::<usize>() / 3) as u8;
            shanten::calc_normal(&remaining, div3) <= before && viable(&after, &remaining)
        })
    } else {
        // Daiminkan waits for a replacement draw.
        let div3 = (hand.iter().map(|&n| n as usize).sum::<usize>() / 3) as u8;
        shanten::calc_normal(&hand, div3) <= before && viable(&after, &hand)
    }
}

/// When already open, preserve a recognized route where one is available.
pub fn useful_discards(state: &PlayerState) -> [bool; 34] {
    let mut result = [false; 34];
    if state.chis().is_empty() && state.pons().is_empty() && state.minkans().is_empty() {
        return result;
    }
    let hand = state.tehai();
    for (tile, &allowed) in state.discard_candidates().iter().enumerate() {
        if allowed && hand[tile] > 0 {
            let mut remaining = hand;
            remaining[tile] -= 1;
            result[tile] = viable(state, &remaining);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn response(hand: [&str; 13], discard: &str) -> PlayerState {
        let mut state = PlayerState::new(0);
        let hidden = ["?"; 13];
        let start = json!({"type":"start_kyoku","bakaze":"E","dora_marker":"9s",
            "kyoku":1,"honba":0,"kyotaku":0,"oya":3,"scores":[25000,25000,25000,25000],
            "tehais":[hand,hidden,hidden,hidden]});
        state.update(&serde_json::from_value(start).unwrap()).unwrap();
        state.update(&serde_json::from_value(json!({"type":"tsumo","actor":3,"pai":"?"})).unwrap()).unwrap();
        state.update(&serde_json::from_value(json!({"type":"dahai","actor":3,"pai":discard,"tsumogiri":true})).unwrap()).unwrap();
        state
    }

    #[test]
    fn rejects_terminal_chi_without_yaku_route() {
        let state = response(["2m","3m","4p","5p","6p","7s","8s","9s","5p","5p","7p","8p","E"], "1m");
        let chi = crate::action::decode(&state, 0, 38, None).unwrap();
        assert!(!call_has_yaku_route(&state, &chi));
    }

    #[test]
    fn accepts_tanyao_chi_with_real_scoring_wait() {
        let state = response(["2m","3m","3p","4p","5p","4s","5s","6s","6p","7p","8p","5s","5s"], "4m");
        let chi = crate::action::decode(&state, 0, 40, None).unwrap();
        assert!(call_has_yaku_route(&state, &chi));
    }

    #[test]
    fn accepts_value_honor_pon_but_not_non_value_wind() {
        let hand = ["P","P","1m","2m","3m","4p","5p","6p","7s","8s","9s","2s","3s"];
        let state = response(hand, "P");
        assert!(call_has_yaku_route(&state, &crate::action::decode(&state, 0, 41, None).unwrap()));
        let non_value = response(["W","W","1m","2m","3m","4p","5p","6p","7s","8s","9s","2s","3s"], "W");
        assert!(!call_has_yaku_route(&non_value, &crate::action::decode(&non_value, 0, 41, None).unwrap()));
    }

    #[test]
    fn protects_open_hand_with_a_scoring_wait() {
        let mut state = response(["2m","3m","3p","4p","5p","4s","5s","6s","6p","7p","8p","5s","5s"], "4m");
        let chi = crate::action::decode(&state, 0, 40, None).unwrap();
        state.update(&chi).unwrap();
        let useful = useful_discards(&state);
        assert!(useful.iter().any(|&v| v));
        assert!(useful[22]); // discard 5s; the remaining wait has tanyao.
    }
}
