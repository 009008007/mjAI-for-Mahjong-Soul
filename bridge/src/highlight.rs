//! Map a recommendation to the offered action button. Positions are a client-layout heuristic.
use prost::Message;
use crate::majsoul_proto::{ActionPrototype, ActionNewRound, ActionDealTile, ActionDiscardTile, ActionChiPengGang, ActionAnGangAddGang, OptionalOperationList};

pub fn operation(action: &ActionPrototype) -> Option<OptionalOperationList> {
    let data = action.data.as_ref();
    match action.name.trim_start_matches(".lq.") {
        "ActionNewRound" => ActionNewRound::decode(data).ok()?.operation,
        "ActionDealTile" => ActionDealTile::decode(data).ok()?.operation,
        "ActionDiscardTile" => ActionDiscardTile::decode(data).ok()?.operation,
        "ActionChiPengGang" => ActionChiPengGang::decode(data).ok()?.operation,
        "ActionAnGangAddGang" => ActionAnGangAddGang::decode(data).ok()?.operation,
        _ => None,
    }
}
/// Indices start at the rightmost button (pass), then proceed left, row by row.
pub fn button(operation: &OptionalOperationList, seat: u8, recommendation: &str) -> Option<(usize, usize)> {
    if operation.seat != seat as u32 { return None; }
    let mut types = Vec::new();
    for op in &operation.operation_list {
        let t = op.r#type;
        if t == 1 { continue; } // A discard is made on a tile, not an action button.
        if !matches!(t, 2..=10) { return None; }
        if !types.contains(&t) { types.push(t); }
    }
    if types.is_empty() { return None; }
    let offered_ankan = types.contains(&4);
    // Closed and added kan share one UI button when both are offered.
    if offered_ankan && types.contains(&6) { types.retain(|&t| t != 4); }
    fn priority(t: u32) -> u8 { match t { 8 | 9 => 1, 5 | 7 => 2, 3 | 4 | 6 => 3, 2 => 4, 10 => 5, _ => 99 } }
    types.sort_by_key(|&t| priority(t));
    let selected = match recommendation {
        "none" => return Some((0, types.len() + 1)),
        "chi" => 2, "pon" => 3, "daiminkan" => 5,
        "ankan" if offered_ankan && types.contains(&6) => 6,
        "ankan" if offered_ankan => 4,
        "ankan" => return None, "kakan" => 6, "reach" => 7,
        "hora" if types.contains(&8) => 8,
        "hora" => 9, "ryukyoku" => 10,
        _ => return None,
    };
    Some((types.iter().position(|&t| t == selected)? + 1, types.len() + 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::majsoul_proto::OptionalOperation;
    #[test]
    fn buttons_use_offered_actions_not_fixed_action_names() {
        let options = OptionalOperationList { seat: 2, operation_list: [2, 3, 9].into_iter().map(|t| OptionalOperation { r#type:t, combination: vec![] }).collect() };
        assert_eq!(button(&options, 2, "none"), Some((0,4)));
        assert_eq!(button(&options, 2, "hora"), Some((1,4)));
        assert_eq!(button(&options, 2, "pon"), Some((2,4)));
        assert_eq!(button(&options, 2, "chi"), Some((3,4)));
        assert_eq!(button(&options, 1, "chi"), None);
        assert_eq!(button(&options, 2, "reach"), None);
    }
    #[test]
    fn reads_real_operation_field_from_wire_action() {
        let options = OptionalOperationList { seat: 1, operation_list: vec![OptionalOperation { r#type: 9, combination: vec![] }] };
        let data = ActionDiscardTile { seat: 0, tile: "1m".into(), operation: Some(options), ..Default::default() };
        let frame = ActionPrototype { step: 1, name: "ActionDiscardTile".into(), data: data.encode_to_vec().into() };
        assert_eq!(button(&operation(&frame).unwrap(), 1, "hora"), Some((1, 2)));
    }
    #[test]
    fn both_kan_types_share_a_button() {
        let options = OptionalOperationList { seat: 0, operation_list: [1,4,6,7].into_iter().map(|t| OptionalOperation { r#type:t, combination: vec![] }).collect() };
        assert_eq!(button(&options, 0, "reach"), Some((1,3)));
        assert_eq!(button(&options, 0, "ankan"), Some((2,3)));
        assert_eq!(button(&options, 0, "kakan"), Some((2,3)));
    }
}
