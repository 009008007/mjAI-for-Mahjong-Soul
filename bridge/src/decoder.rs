use std::collections::HashSet;
use bytes::{Buf, Bytes};
use prost::Message;
use crate::majsoul_proto::{ActionPrototype, GameSyncResponse, Wrapper};

const KEY: [u8; 9] = [0x84, 0x5e, 0x4e, 0x42, 0x39, 0xa2, 0x1f, 0x60, 0x1c];
const MAX_BYTES: usize = 4 * 1024 * 1024;

fn live_action_xor(body: &[u8]) -> Bytes {
    let base = 23_usize ^ body.len();
    body.iter().enumerate().map(|(i, &byte)| {
        byte ^ base.wrapping_add(i.wrapping_mul(5)).wrapping_add(KEY[i % KEY.len()] as usize) as u8
    }).collect::<Vec<_>>().into()
}

pub enum Decoded { Ignore, SyncBegin(u16), SyncEnd(u16), Live(ActionPrototype), Restore(u16, Vec<ActionPrototype>) }
#[derive(Default)]
pub struct Decoder { pending: HashSet<u16> }
impl Decoder {
    pub fn decode(&mut self, mut frame: Bytes) -> Result<Decoded, &'static str> {
        if frame.is_empty() { return Err("empty Liqi frame"); }
        if frame.len() > MAX_BYTES { return Err("Liqi frame exceeds limit"); }
        let kind = frame.get_u8();
        let id = if kind == 2 || kind == 3 {
            if frame.len() < 2 { return Err("truncated request/response header"); }
            Some(frame.get_u16_le())
        } else if kind == 1 { None } else { return Err("unknown Liqi frame type"); };
        let envelope = Wrapper::decode(frame).map_err(|_| "invalid Liqi wrapper")?;
        match kind {
            1 => {
                if envelope.name.is_empty() { return Err("notification without a method"); }
                if envelope.name != ".lq.ActionPrototype" { return Ok(Decoded::Ignore); }
                let mut action = ActionPrototype::decode(envelope.data).map_err(|_| "invalid ActionPrototype")?;
                if action.data.len() > 1024 * 1024 { return Err("action body exceeds limit"); }
                action.data = live_action_xor(&action.data);
                Ok(Decoded::Live(action))
            }
            2 => {
                if matches!(envelope.name.as_str(), ".lq.FastTest.syncGame" | ".lq.FastTest.enterGame") {
                    if self.pending.len() >= 32 { self.pending.clear(); }
                    self.pending.insert(id.unwrap());
                    return Ok(Decoded::SyncBegin(id.unwrap()));
                }
                Ok(Decoded::Ignore)
            }
            3 => {
                if !self.pending.remove(&id.unwrap()) { return Ok(Decoded::Ignore); }
                if !envelope.name.is_empty() { return Err("unexpected response method"); }
                let response = GameSyncResponse::decode(envelope.data).map_err(|_| "invalid game restore response")?;
                if !response.error.is_empty() { return Err("game restore was unsuccessful"); }
                if response.is_end || response.game_restore.is_none() { return Ok(Decoded::SyncEnd(id.unwrap())); }
                let restore = response.game_restore.ok_or("game restore is missing")?;
                if restore.actions.is_empty() { return Ok(Decoded::SyncEnd(id.unwrap())); }
                if restore.actions.len() > 1000 { return Err("game restore action history exceeds limit"); }
                if response.step == 0 || restore.actions.last().and_then(|a| a.step.checked_add(1)) != Some(response.step) { return Err("incomplete restore action history"); }
                if restore.actions.iter().any(|a| a.data.len() > 1024 * 1024) { return Err("restored action exceeds limit"); }
                Ok(Decoded::Restore(id.unwrap(), restore.actions))
            }
            _ => unreachable!(),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn ignores_requests_and_rejects_bad_headers() {
        let mut d = Decoder::default();
        assert!(d.decode(Bytes::from_static(&[2, 1])).is_err());
        assert!(d.decode(Bytes::new()).is_err());
    }
    #[test] fn xor_is_involutive() {
        let payload = b"example action";
        assert_eq!(&live_action_xor(&live_action_xor(payload))[..], payload);
    }
}
