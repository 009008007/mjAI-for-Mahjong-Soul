//! Optional, bounded tactical adjustments to Mortal's legal action scores.
//!
//! The values are heuristics in model-Q units, not probabilities. A river tile
//! is genbutsu only against its owner, and suji is only a weak risk indicator.

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum Style {
    #[default]
    Default,
    CallManiac,
    SuperTurtle,
}

/// Read-only information from a single player's perspective. Index zero is self.
/// `tiles_seen` includes one's own concealed tiles and uses de-red tile indices.
#[derive(Clone, Debug)]
pub struct PolicyState {
    pub tehai: [u8; 34],
    pub tiles_seen: [u8; 34],
    pub dora_factor: [u8; 34],
    pub riichi: [bool; 4],
    pub rivers: [[bool; 34]; 4],
    pub tiles_left: u8,
}

fn base_tile(action: usize) -> Option<usize> {
    match action {
        0..=33 => Some(action),
        34 => Some(4),
        35 => Some(13),
        36 => Some(22),
        _ => None,
    }
}

fn is_isolated_terminal(tile: usize, hand: &[u8; 34]) -> bool {
    if tile >= 27 || !matches!(tile % 9, 0 | 8) || hand[tile] != 1 {
        return false;
    }
    let rank = tile % 9;
    let suit = tile - rank;
    let neighbors: [usize; 2] = if rank == 0 { [suit + 1, suit + 2] } else { [suit + 6, suit + 7] };
    neighbors.iter().all(|&other| hand[other] == 0)
}

/// Whether the tile is genbutsu against every riichi opponent, not necessarily
/// against non-riichi opponents. Without a riichi opponent this is false.
fn riichi_genbutsu(state: &PolicyState, tile: usize) -> bool {
    let threats = (1..4).filter(|&seat| state.riichi[seat]);
    let mut any = false;
    for seat in threats {
        any = true;
        if !state.rivers[seat][tile] { return false; }
    }
    any
}

/// Basic two-sided-wait suji against every riichi player, or all opponents in
/// a late round without riichi. This is not a guarantee against ron.
fn suji(state: &PolicyState, tile: usize) -> bool {
    if tile >= 27 { return false; }
    let rank = tile % 9;
    let suit = tile - rank;
    let any_riichi = state.riichi[1..].iter().any(|&active| active);
    let mut any = false;
    for seat in 1..4 {
        if any_riichi && !state.riichi[seat] { continue; }
        any = true;
        if rank >= 3 && !state.rivers[seat][suit + rank - 3] { return false; }
        if rank + 3 < 9 && !state.rivers[seat][suit + rank + 3] { return false; }
    }
    any
}

/// Adjust only finite legal Q-values. `intensity` must be in 0..=2; invalid
/// values are ignored as a defensive fallback, and should be rejected by the
/// configuration boundary. Kan tile-selection uses a different action space
/// and is deliberately left untouched.
pub fn apply_bias(scores: &mut [f32; 46], mask: &[bool; 46], style: Style, intensity: f32, state: &PolicyState, kan_select: bool) {
    if style == Style::Default || intensity == 0.0 || kan_select || !intensity.is_finite() || !(0.0..=2.0).contains(&intensity) { return; }
    let threats = state.riichi[1..].iter().any(|&active| active);
    let late = state.tiles_left <= 40;
    let factor = if threats { 2.0 } else if late { 1.5 } else { 0.0 };

    for action in 0..46 {
        if !mask[action] || !scores[action].is_finite() { continue; }
        let bias = match style {
            Style::Default => 0.0,
            Style::CallManiac => match action {
                37 => -5.0,
                38..=40 => 5.0,
                41 => 6.0,
                42 => 5.0,
                45 => -5.0,
                _ => match base_tile(action) {
                    Some(tile) if tile >= 27 && state.tehai[tile] == 1 => 4.0,
                    Some(tile) if is_isolated_terminal(tile, &state.tehai) => 3.0,
                    Some(tile) if tile < 27 && (2..=6).contains(&(tile % 9)) => -1.5,
                    _ => 0.0,
                },
            },
            Style::SuperTurtle if factor > 0.0 => match action {
                37 => -7.0 * factor,
                38..=42 => -6.0 * factor,
                _ => match base_tile(action) {
                    Some(tile) => {
                        let mut value = 0.0;
                        let genbutsu = riichi_genbutsu(state, tile);
                        let is_suji = suji(state, tile);
                        let visible = state.tiles_seen[tile].saturating_sub(state.tehai[tile]);
                        if genbutsu { value += 12.0; }
                        if tile >= 27 {
                            if visible >= 3 { value += 11.0; }
                            else if visible == 2 { value += 5.0; }
                        } else {
                            if is_suji { value += 4.0; }
                            if !genbutsu && !is_suji && (3..=5).contains(&(tile % 9)) { value -= 4.0; }
                        }
                        if state.dora_factor[tile] > 0 && visible == 0 { value -= 6.0; }
                        if (34..=36).contains(&action) { value -= 6.0; }
                        value * factor
                    }
                    None => 0.0,
                },
            },
            Style::SuperTurtle => 0.0,
        };
        if bias == 0.0 { continue; }
        // Compute in f64 to prevent an extreme finite model score becoming inf.
        let adjusted = f64::from(scores[action]) + f64::from(bias) * f64::from(intensity);
        scores[action] = adjusted.clamp(-(f32::MAX as f64), f32::MAX as f64) as f32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> PolicyState {
        PolicyState { tehai: [0; 34], tiles_seen: [0; 34], dora_factor: [0; 34],
            riichi: [false; 4], rivers: [[false; 34]; 4], tiles_left: 69 }
    }
    fn apply(style: Style, state: &PolicyState) -> [f32; 46] {
        let mut values = [0.0; 46];
        apply_bias(&mut values, &[true; 46], style, 1.0, state, false);
        values
    }
    #[test]
    fn default_zero_and_kan_selection_preserve_every_bit() {
        let mut original = [0.0_f32; 46];
        original[0] = -0.0; original[1] = f32::NEG_INFINITY; original[2] = f32::NAN;
        for (style, intensity, kan) in [(Style::Default, 1.0, false), (Style::CallManiac, 0.0, false), (Style::SuperTurtle, 1.0, true)] {
            let mut actual = original;
            apply_bias(&mut actual, &[true; 46], style, intensity, &state(), kan);
            assert!(actual.iter().zip(original).all(|(a,b)| a.to_bits() == b.to_bits()));
        }
    }
    #[test]
    fn masks_and_nonfinite_scores_are_never_changed() {
        let mut values = [0.0_f32; 46]; values[38] = f32::INFINITY; values[39] = f32::NAN;
        let mut mask = [true; 46]; mask[41] = false;
        apply_bias(&mut values, &mask, Style::CallManiac, 2.0, &state(), false);
        assert!(values[38].is_infinite() && values[39].is_nan());
        assert_eq!(values[41], 0.0);
        assert_eq!(values[40], 10.0);
        assert_eq!(values[43], 0.0); assert_eq!(values[44], 0.0);
    }
    #[test]
    fn call_maniac_boosts_calls_and_only_isolated_terminals() {
        let mut s = state(); s.tehai[0] = 1; s.tehai[8] = 1; s.tehai[7] = 1;
        s.tehai[27] = 1; s.tehai[28] = 2; s.tehai[3] = 1;
        let q = apply(Style::CallManiac, &s);
        assert!(q[38] > q[45] && q[41] > q[37]);
        assert!(q[0] > q[8] && q[27] > q[28]);
        assert!(q[3] < 0.0);
    }
    #[test]
    fn turtle_activates_on_riichi_or_late_round_and_never_changes_win() {
        let mut s = state(); assert_eq!(apply(Style::SuperTurtle, &s), [0.0; 46]);
        s.riichi[2] = true; let q = apply(Style::SuperTurtle, &s);
        assert!(q[37] < 0.0 && q[38..=42].iter().all(|&v| v < 0.0));
        assert_eq!(q[43], 0.0); assert_eq!(q[44], 0.0);
        s.riichi[2] = false; s.tiles_left = 40;
        assert!(apply(Style::SuperTurtle, &s)[37] < 0.0);
    }
    #[test]
    fn riichi_safety_requires_intersection_of_threatened_rivers() {
        let mut s = state(); s.riichi[1] = true; s.riichi[2] = true;
        s.rivers[1][0] = true;
        assert!(!riichi_genbutsu(&s, 0));
        s.rivers[2][0] = true;
        assert!(riichi_genbutsu(&s, 0));
        assert!(apply(Style::SuperTurtle, &s)[0] > apply(Style::SuperTurtle, &s)[8]);
    }
    #[test]
    fn honor_counts_exclude_the_players_hand() {
        let mut s = state(); s.riichi[1] = true;
        s.tehai[27] = 1; s.tiles_seen[27] = 4;
        s.tehai[28] = 1; s.tiles_seen[28] = 3;
        let q = apply(Style::SuperTurtle, &s);
        assert!(q[27] > q[28] && q[28] > q[29]);
        // Four known to the model can include four concealed; they are not four public tiles.
        s.tehai[27] = 4;
        assert_eq!(apply(Style::SuperTurtle, &s)[27], 0.0);
    }
    #[test]
    fn suji_is_rank_aware_and_requires_all_riichi_players() {
        let mut s = state(); s.riichi[1] = true; s.rivers[1][0] = true;
        assert!(!suji(&s, 3)); // 1m alone leaves the other two-sided wait.
        s.rivers[1][6] = true;
        assert!(suji(&s, 3)); // 1m and 7m cover both sides of 4m.
        assert!(!suji(&s, 12)); // different suit
        let q = apply(Style::SuperTurtle, &s);
        assert!(q[3] > q[4]); // 4m suji vs 5m unsuji
        s.riichi[2] = true;
        assert!(!suji(&s, 3));
        s.rivers[2][6] = true;
        assert!(!suji(&s, 3));
        s.rivers[2][0] = true;
        assert!(suji(&s, 3));
    }
    #[test]
    fn unseen_dora_and_red_fives_are_penalized() {
        let mut s = state(); s.riichi[1] = true;
        s.tehai[4] = 1; s.tiles_seen[4] = 1; s.dora_factor[4] = 1;
        let q = apply(Style::SuperTurtle, &s);
        assert!(q[4] < q[3]); assert!(q[34] < q[4]);
        s.tiles_seen[4] = 2;
        assert!(apply(Style::SuperTurtle, &s)[4] > q[4]);
    }
    #[test]
    fn intensity_scales_linearly_and_rejects_invalid_values() {
        let s = state(); let one = apply(Style::CallManiac, &s);
        let mut half = [0.0; 46]; apply_bias(&mut half, &[true;46], Style::CallManiac, 0.5, &s, false);
        assert_eq!(half[41], one[41] * 0.5);
        for intensity in [f32::NAN, f32::INFINITY, -0.1, 2.1] {
            let mut invalid = [0.0; 46]; apply_bias(&mut invalid, &[true;46], Style::CallManiac, intensity, &s, false);
            assert_eq!(invalid, [0.0;46]);
        }
    }
}
