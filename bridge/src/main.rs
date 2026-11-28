mod action;
mod converter;
mod decoder;
mod inference;
mod policy;
mod yaku_guard;
mod highlight;
mod state;
pub mod majsoul_proto { include!(concat!(env!("OUT_DIR"), "/lq.rs")); }

use std::{env, path::PathBuf, sync::Arc, time::Duration};
use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use tokio::{net::{TcpListener, TcpStream}, time::timeout};
use tokio_tungstenite::{accept_hdr_async, tungstenite::{handshake::server::{Request, Response, ErrorResponse}, http::StatusCode, Message}};
use crate::{inference::Inference, state::BridgeState};

struct Config { seat: Option<u8>, model: Option<PathBuf>, origin: Option<String> }
struct Worker { bridge: BridgeState, inference: Inference, decoder: decoder::Decoder, last_action: Option<majsoul_proto::ActionPrototype>, during_restore: std::collections::HashMap<u16, Vec<majsoul_proto::ActionPrototype>> }
impl Worker {
    fn process(&mut self, bytes: bytes::Bytes) -> Result<Vec<serde_json::Value>> {
        let decoded = match self.decoder.decode(bytes) {
            Ok(decoded) => decoded,
            Err(e) => { self.bridge.desynchronize(); self.inference.reset(); self.during_restore.clear(); self.decoder = decoder::Decoder::default(); anyhow::bail!(e); }
        };
        let (actions, restoring) = match decoded {
            decoder::Decoded::Ignore => return Ok(vec![]),
            decoder::Decoded::SyncBegin(id) => { if self.during_restore.len() >= 32 { self.during_restore.clear(); } self.during_restore.insert(id, Vec::new()); return Ok(vec![]); }
            decoder::Decoded::SyncEnd(id) => { self.during_restore.remove(&id); return Ok(vec![]); }
            decoder::Decoded::Live(action) => {
                for pending in self.during_restore.values_mut() {
                    if pending.len() >= 1000 { self.bridge.desynchronize(); self.inference.reset(); anyhow::bail!("too many actions during restore"); }
                    pending.push(action.clone());
                }
                if self.last_action.as_ref() == Some(&action) && self.bridge.active { return Ok(vec![]); }
                (vec![action], false)
            },
            decoder::Decoded::Restore(id, mut actions) => {
                let following = self.during_restore.remove(&id).unwrap_or_default();
                if following.iter().any(|a| a.name.trim_start_matches(".lq.") == "ActionNewRound") {
                    // The game has already moved to a newer round than this response.
                    return Ok(vec![]);
                }
                let last_step = actions.last().map(|a| a.step).unwrap_or(0);
                for action in following {
                    if let Some(restored) = actions.iter().find(|a| a.step == action.step) {
                        if restored != &action { self.bridge.desynchronize(); self.inference.reset(); anyhow::bail!("restore conflicts with live action"); }
                    } else if action.step > last_step { actions.push(action); }
                }
                let start = actions.iter().rposition(|a| a.name.trim_start_matches(".lq.") == "ActionNewRound").ok_or_else(|| {
                    self.bridge.desynchronize(); self.inference.reset(); anyhow::anyhow!("restore lacks a round start")
                })?;
                self.bridge.desynchronize();
                self.inference.reset();
                self.last_action = None;
                (actions.into_iter().skip(start).collect(), true)
            }
        };
        let action_count = actions.len();
        let mut all_events = Vec::new();
        for (action_index, action) in actions.into_iter().enumerate() {
            let snapshot = action.clone();
            let events = match converter::convert_action(&mut self.bridge, action) {
                Ok(events) => events,
                Err(e) => { self.bridge.desynchronize(); self.inference.reset(); anyhow::bail!(e); }
            };
            self.last_action = Some(snapshot);
            let count = events.len();
            all_events.extend(events.into_iter().enumerate().map(|(i, event)| (event, action_index + 1 == action_count && i + 1 == count)));
        }
        let mut suggestions = vec![serde_json::json!({"type":"status","status":"clear"})];
        for (event, is_last) in all_events {
            let value = serde_json::to_value(event)?;
            if value["synthetic_opening_draw"] == true { self.inference.mark_synthetic_draw(); }
            let event = serde_json::from_value(value)?;
            match self.inference.process(event, is_last) {
                Ok(Some(mut suggestion)) => {
                    if let Some(ops) = self.last_action.as_ref().and_then(highlight::operation) {
                        if ops.seat == u32::from(self.bridge.seat) {
                            if let Some(hand) = self.inference.current_hand() {
                                let operations: Vec<_> = ops.operation_list.iter().map(|op| serde_json::json!({
                                    "type": op.r#type, "combination": op.combination
                                })).collect();
                                suggestion["opportunity"] = serde_json::json!({
                                    "seat": self.bridge.seat,
                                    "step": self.last_action.as_ref().unwrap().step,
                                    "source": self.last_action.as_ref().unwrap().name,
                                    "time_fixed": ops.time_fixed,
                                    "time_add": ops.time_add,
                                    "hand": hand,
                                    "drawn": self.inference.current_draw(),
                                    "operations": operations
                                });
                            }
                        }
                        let kind = suggestion["type"].as_str().unwrap_or("").to_owned();
                        if kind == "chi" {
                            if let Some(choices) = highlight::chi_choices(&ops, self.bridge.seat) {
                                let count = suggestion["hand_count"].as_u64().unwrap_or(0) as usize;
                                if let Some(references) = self.inference.chi_references(&choices, count) {
                                    suggestion["chi_choices"] = serde_json::json!(choices);
                                    suggestion["chi_references"] = serde_json::json!(references);
                                }
                            }
                        }
                        if kind == "reach" && ops.seat == u32::from(self.bridge.seat) {
                            let mut offered = ops.operation_list.iter().filter(|op| op.r#type == 7);
                            if let (Some(operation), None) = (offered.next(), offered.next()) {
                                if let Ok((tile, index, count, drawn)) = self.inference.riichi_discard(&operation.combination) {
                                    suggestion["riichi_discard"] = tile.into();
                                    suggestion["riichi_hand_index"] = index.into();
                                    suggestion["hand_count"] = count.into();
                                    if let Some(drawn) = drawn { suggestion["drawn_index"] = drawn.into(); }
                                }
                            }
                        }
                        if let Some((index, count)) = highlight::button(&ops, self.bridge.seat, suggestion["type"].as_str().unwrap_or("")) {
                            suggestion["button_index"] = index.into();
                            suggestion["button_count"] = count.into();
                        }
                    }
                    if suggestion["type"] == "kakan" {
                        if let Some(tile) = suggestion["pai"].as_str() {
                            let base = tile.trim_end_matches('r');
                            if let Some((_, tiles)) = self.bridge.pons.iter().find(|(owner, tiles)| *owner == self.bridge.seat && tiles.iter().all(|t| t.trim_end_matches('r') == base)) {
                                suggestion["consumed"] = serde_json::json!(tiles);
                            }
                        }
                    }
                    suggestions.push(suggestion)
                },
                Ok(None) => {},
                Err(e) => { self.bridge.desynchronize(); self.inference.reset(); return Err(e); }
            }
        }
        if restoring { suggestions.insert(0, serde_json::json!({"type":"status","status":"restored"})); }
        Ok(suggestions)
    }
}
async fn make_worker(seat: u8, model: Option<PathBuf>) -> Result<Worker> {
    tokio::task::spawn_blocking(move || -> Result<Worker> {
        Ok(Worker { bridge: BridgeState::new(seat).map_err(anyhow::Error::msg)?, inference: Inference::new(seat, model.as_deref())?, decoder: decoder::Decoder::default(), last_action: None, during_restore: std::collections::HashMap::new() })
    }).await?
}
async fn connection(socket: TcpStream, config: Arc<Config>, mut shutdown: tokio::sync::watch::Receiver<bool>) -> Result<()> {
    let origin = config.origin.clone();
    let mut ws = timeout(Duration::from_secs(10), accept_hdr_async(socket, move |req: &Request, response: Response| {
        if let Some(value) = req.headers().get("origin") {
            if origin.as_deref() != value.to_str().ok() {
                let mut error = ErrorResponse::new(Some("Origin not allowed; set --allow-origin".into()));
                *error.status_mut() = StatusCode::FORBIDDEN;
                return Err(error);
            }
        }
        Ok(response)
    })).await.context("handshake timed out")??;
    let mut worker: Option<Worker> = None;
    let mut selected_style = policy::Style::Default;
    let mut selected_intensity = 1.0_f32;
    let mut frame_serial: Option<u64> = None;
    if let Some(seat) = config.seat {
        worker = Some(make_worker(seat, config.model.clone()).await?);
    }
    loop {
        let msg = tokio::select! {
            changed = shutdown.changed() => { let _ = changed; break; }
            msg = ws.next() => match msg { Some(msg) => msg?, None => break },
        };
        match msg {
            Message::Binary(data) => {
                let serial = frame_serial.take();
                let Some(mut current) = worker.take() else {
                    ws.send(Message::Text(serde_json::json!({"type":"status","status":"needs_seat"}).to_string().into())).await?;
                    continue;
                };
                let (returned_worker, result) = tokio::task::spawn_blocking(move || {
                    let result = current.process(data);
                    (current, result)
                }).await?;
                worker = Some(returned_worker);
                match result {
                    Ok(suggestions) => for mut suggestion in suggestions {
                        if let Some(serial) = serial { suggestion["frame_serial"] = serial.into(); }
                        ws.send(Message::Text(suggestion.to_string().into())).await?;
                    },
                    Err(e) => { eprintln!("connection desynchronized: {e:#}"); ws.send(Message::Text(serde_json::json!({"type":"status","status":"desynchronized","reason":e.to_string()}).to_string().into())).await?; }
                }
            },
            Message::Text(text) => {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    if value["type"] == "frame_meta" {
                        frame_serial = value["serial"].as_u64();
                    } else if value["type"] == "policy" {
                        let revision = value["revision"].as_u64().unwrap_or(0);
                        let style = match value["style"].as_str() {
                            Some("default") => Some(policy::Style::Default),
                            Some("CallManiac") => Some(policy::Style::CallManiac),
                            Some("SuperTurtle") => Some(policy::Style::SuperTurtle),
                            _ => None,
                        };
                        let strength = value["intensity"].as_f64().filter(|x| x.is_finite() && (0.0..=2.0).contains(x));
                        if let (Some(style), Some(strength)) = (style, strength) {
                            selected_style = style;
                            selected_intensity = strength as f32;
                            if let Some(worker) = worker.as_mut() { worker.inference.set_policy(style, selected_intensity); }
                            ws.send(Message::Text(serde_json::json!({"type":"status","status":"policy_updated","style":value["style"],"intensity":selected_intensity,"revision":revision}).to_string().into())).await?;
                        } else {
                            ws.send(Message::Text(serde_json::json!({"type":"status","status":"policy_error","revision":revision}).to_string().into())).await?;
                        }
                    } else if value["type"] == "seat" {
                        if let Some(seat) = value["seat"].as_u64().filter(|n| *n <= 3) {
                            let seat = seat as u8;
                            if let Some(manual) = config.seat {
                                if manual != seat { worker = None; ws.send(Message::Text(serde_json::json!({"type":"status","status":"seat_mismatch","seat":seat}).to_string().into())).await?; continue; }
                            }
                            if worker.as_ref().map(|w| w.bridge.seat) != Some(seat) {
                                let mut next = make_worker(seat, config.model.clone()).await?;
                                next.inference.set_policy(selected_style, selected_intensity);
                                worker = Some(next);
                            }
                            ws.send(Message::Text(serde_json::json!({"type":"status","status":"seat_detected","seat":seat}).to_string().into())).await?;
                        }
                    } else if value["type"] == "replay_end" {
                        ws.send(Message::Text(serde_json::json!({"type":"status","status":"replay_complete"}).to_string().into())).await?;
                    }
                }
            },
            Message::Close(_) => break,
            Message::Ping(data) => ws.send(Message::Pong(data)).await?,
            _ => {},
        }
    }
    Ok(())
}
#[tokio::main]
async fn main() -> Result<()> {
    let mut seat = None;
    let mut model = None;
    let mut origin = None;
    let mut demo = false;
    let mut self_test = false;
    let mut listen = String::from("127.0.0.1:23410");
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--seat" => seat = Some(args.next().context("--seat requires a value")?.parse::<u8>()?),
            "--model" => model = Some(PathBuf::from(args.next().context("--model requires a path")?)),
            "--allow-origin" => origin = Some(args.next().context("--allow-origin requires an exact origin")?),
            "--demo" => demo = true,
            "--self-test" => self_test = true,
            "--listen" => listen = args.next().context("--listen requires a loopback address")?,
            "--help" | "-h" => { println!("Usage: majsoul-bridge-server [--seat 0..3] (--model PATH | --demo) [--allow-origin ORIGIN]"); return Ok(()); },
            _ => anyhow::bail!("unknown argument: {arg}"),
        }
    }
    anyhow::ensure!(seat.map_or(true, |s| s <= 3), "seat must be between 0 and 3");
    anyhow::ensure!(demo != model.is_some(), "specify exactly one of --model or --demo");
    if let Some(path) = &model { anyhow::ensure!(path.is_file(), "model file not found: {}", path.display()); }
    if self_test {
        inference::self_test(model.as_deref().context("--self-test requires --model")?)?;
        println!("Model inference OK");
        return Ok(());
    }
    let bind_addr: std::net::SocketAddr = listen.parse().context("invalid listen address")?;
    anyhow::ensure!(bind_addr.ip().is_loopback(), "listen address must be loopback");
    let listener = TcpListener::bind(bind_addr).await?;
    let config = Arc::new(Config { seat, model, origin });
    eprintln!("listening on ws://{}", listener.local_addr()?);
    let (shutdown, _) = tokio::sync::watch::channel(false);
    let mut clients = tokio::task::JoinSet::new();
    // Keep one signal listener across accept/completion iterations. Recreating
    // it in the select loop can lose a shutdown signal between iterations.
    let ctrl_c = tokio::signal::ctrl_c();
    tokio::pin!(ctrl_c);
    let result = loop {
        tokio::select! {
            result = &mut ctrl_c => { break result.context("cannot listen for shutdown signal"); }
            accepted = listener.accept() => match accepted {
                Ok((socket, _)) => {
                    let config = Arc::clone(&config);
                    let receiver = shutdown.subscribe();
                    clients.spawn(async move { if let Err(e) = connection(socket, config, receiver).await { eprintln!("connection closed: {e:#}"); } });
                }
                Err(e) => break Err(e.into()),
            },
            Some(_) = clients.join_next(), if !clients.is_empty() => {},
        }
    };
    let _ = shutdown.send(true);
    while clients.join_next().await.is_some() {}
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::{connect_async, tungstenite::client::IntoClientRequest};

    fn wire_action<M: prost::Message>(step: u32, name: &str, payload: &M) -> bytes::Bytes {
        use prost::Message as _;
        let key = [0x84u8, 0x5e, 0x4e, 0x42, 0x39, 0xa2, 0x1f, 0x60, 0x1c];
        let data = payload.encode_to_vec();
        let base = 23usize ^ data.len();
        let encrypted: Vec<u8> = data.iter().enumerate().map(|(i, &b)| b ^ base.wrapping_add(i.wrapping_mul(5)).wrapping_add(key[i % 9] as usize) as u8).collect();
        let action = majsoul_proto::ActionPrototype { step, name: name.into(), data: encrypted.into() };
        let wrapper = majsoul_proto::Wrapper { name: ".lq.ActionPrototype".into(), data: action.encode_to_vec().into() };
        let mut frame = vec![1]; frame.extend(wrapper.encode_to_vec()); frame.into()
    }

    #[test]
    fn complete_frames_keep_state_after_pon() {
        use majsoul_proto::{ActionNewRound, ActionDiscardTile, ActionChiPengGang, ActionDealTile};
        let mut w = Worker { bridge: BridgeState::new(1).unwrap(), inference: Inference::new(1, None).unwrap(), decoder: decoder::Decoder::default(), last_action: None, during_restore: std::collections::HashMap::new() };
        let round = ActionNewRound { chang:0, ju:0, ben:0, tiles:["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","1z","1z"].iter().map(|s| s.to_string()).collect(), doras:vec!["2z".into()], scores:vec![25000; 4], ..Default::default() };
        w.process(wire_action(0, "ActionNewRound", &round)).unwrap();
        let discard = ActionDiscardTile { seat:0, tile:"1z".into(), ..Default::default() };
        w.process(wire_action(1, "ActionDiscardTile", &discard)).unwrap();
        let pon = ActionChiPengGang { seat:1, r#type:1, tiles:vec!["1z".into(),"1z".into(),"1z".into()], froms:vec![1,1,0], ..Default::default() };
        let result = w.process(wire_action(2, "ActionChiPengGang", &pon)).unwrap();
        assert!(result.iter().any(|r| r["type"] == "dahai"));
        let discard = ActionDiscardTile { seat:1, tile:"1p".into(), ..Default::default() };
        w.process(wire_action(3, "ActionDiscardTile", &discard)).unwrap();
        let draw = ActionDealTile { seat:2, ..Default::default() };
        w.process(wire_action(4, "ActionDealTile", &draw)).unwrap();
        assert!(w.bridge.active);
    }

    #[test]
    fn chi_recommendation_carries_the_two_matching_hand_positions() {
        use majsoul_proto::{ActionNewRound, ActionDiscardTile, OptionalOperation, OptionalOperationList};
        let mut w = Worker { bridge: BridgeState::new(1).unwrap(), inference: Inference::new(1, None).unwrap(), decoder: decoder::Decoder::default(), last_action: None, during_restore: Default::default() };
        let round = ActionNewRound {
            tiles:["1m","2m","3m","1p","2p","3p","1s","2s","4s","0s","5s","1z","2z"].map(String::from).to_vec(),
            doras:vec!["6m".into()], scores:vec![25000; 4], ..Default::default()
        };
        w.process(wire_action(0, "ActionNewRound", &round)).unwrap();
        // 3s allows 123s and 345s. Demo scores tie and select 345s with the red five.
        let discard = ActionDiscardTile {
            seat:0, tile:"3s".into(), operation:Some(OptionalOperationList {
                seat:1, operation_list:vec![OptionalOperation { r#type:2,
                    combination:["1s|2s", "4s|0s", "4s|5s"].map(String::from).to_vec() }], ..Default::default()
            }), ..Default::default()
        };
        let result = w.process(wire_action(1, "ActionDiscardTile", &discard)).unwrap();
        let chi = result.iter().find(|entry| entry["type"] == "chi").unwrap();
        assert_eq!(chi["pai"], "3s");
        assert_eq!(chi["consumed"], serde_json::json!(["4s", "5sr"]));
        assert_eq!(chi["chi_hand_indices"], serde_json::json!([8, 9]));
        assert_eq!(chi["hand_count"], 13);
        assert_eq!(chi["button_index"], 1);
        assert_eq!(chi["chi_choices"], serde_json::json!([["1s","2s"],["4s","5sr"],["4s","5s"]]));
        assert_eq!(chi["chi_references"], serde_json::json!({"1s":6,"2s":7,"4s":8,"5sr":9,"5s":10}));
        assert_eq!(chi["opportunity"]["step"], 1);
        assert_eq!(chi["opportunity"]["seat"], 1);
        assert_eq!(chi["opportunity"]["operations"][0]["combination"], serde_json::json!(["1s|2s","4s|0s","4s|5s"]));
        assert_eq!(chi["opportunity"]["hand"].as_array().unwrap().len(), 13);
    }

    #[test]
    fn complete_frames_continue_after_riichi() {
        use majsoul_proto::{ActionNewRound, ActionDiscardTile, ActionDealTile, LiQiSuccess};
        let mut w = Worker { bridge: BridgeState::new(1).unwrap(), inference: Inference::new(1, None).unwrap(), decoder: decoder::Decoder::default(), last_action: None, during_restore: std::collections::HashMap::new() };
        let round = ActionNewRound { tiles:["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","1z","1z"].iter().map(|s| s.to_string()).collect(), doras:vec!["2z".into()], scores:vec![25000; 4], ..Default::default() };
        w.process(wire_action(0, "ActionNewRound", &round)).unwrap();
        let discard = ActionDiscardTile { seat:0, tile:"3z".into(), is_liqi:true, ..Default::default() };
        w.process(wire_action(1, "ActionDiscardTile", &discard)).unwrap();
        let draw = ActionDealTile { seat:1, tile:"3p".into(), liqi:Some(LiQiSuccess { seat:0, ..Default::default() }), ..Default::default() };
        let result = w.process(wire_action(2, "ActionDealTile", &draw)).unwrap();
        assert!(result.iter().any(|r| r["type"] == "dahai" || r["type"] == "reach" || r["type"] == "hora"));
        assert!(w.bridge.active);
    }

    #[test]
    fn historical_sync_response_restores_full_round() {
        use prost::Message as _;
        let mut w = Worker { bridge: BridgeState::new(3).unwrap(), inference: Inference::new(3, None).unwrap(), decoder: decoder::Decoder::default(), last_action: None, during_restore: std::collections::HashMap::new() };
        let request = majsoul_proto::Wrapper { name: ".lq.FastTest.syncGame".into(), data: Default::default() };
        let mut request_frame = vec![2, 0x34, 0x12]; request_frame.extend(request.encode_to_vec());
        w.process(request_frame.into()).unwrap();
        let output = w.process(bytes::Bytes::from_static(include_bytes!("../tests/fixtures/sync_response.bin"))).unwrap();
        assert_eq!(w.bridge.last_step, Some(31));
        assert!(w.bridge.active);
        assert!(output.iter().any(|v| v["type"] == "status" && v["status"] == "restored"));
        assert!(output.iter().any(|v| v["type"] == "dahai" || v["type"] == "reach" || v["type"] == "hora"));
        let discard = majsoul_proto::ActionDiscardTile { seat:3, tile:"7s".into(), moqie:true, ..Default::default() };
        let frame = wire_action(32, "ActionDiscardTile", &discard);
        w.process(frame.clone()).unwrap();
        assert!(w.process(frame).unwrap().is_empty());
        assert_eq!(w.bridge.last_step, Some(32));
    }

    #[test]
    fn recovery_response_does_not_erase_newer_live_action() {
        use prost::Message as _;
        let mut w = Worker { bridge: BridgeState::new(3).unwrap(), inference: Inference::new(3, None).unwrap(), decoder: decoder::Decoder::default(), last_action: None, during_restore: Default::default() };
        let request = majsoul_proto::Wrapper { name: ".lq.FastTest.syncGame".into(), data: Default::default() };
        let mut frame = vec![2, 0x34, 0x12]; frame.extend(request.encode_to_vec());
        let response = bytes::Bytes::from_static(include_bytes!("../tests/fixtures/sync_response.bin"));
        w.process(frame.clone().into()).unwrap();
        w.process(response.clone()).unwrap();
        w.process(frame.into()).unwrap();
        let discard = majsoul_proto::ActionDiscardTile { seat:3, tile:"7s".into(), moqie:true, ..Default::default() };
        w.process(wire_action(32, "ActionDiscardTile", &discard)).unwrap();
        assert_eq!(w.bridge.last_step, Some(32));
        w.process(response).unwrap();
        assert_eq!(w.bridge.last_step, Some(32));
        assert!(w.bridge.active);
        let draw = majsoul_proto::ActionDealTile { seat:0, ..Default::default() };
        w.process(wire_action(33, "ActionDealTile", &draw)).unwrap();
    }

    #[test]
    fn truncated_restore_does_not_produce_advice() {
        use prost::Message as _;
        let mut w = Worker { bridge: BridgeState::new(3).unwrap(), inference: Inference::new(3, None).unwrap(), decoder: decoder::Decoder::default(), last_action: None, during_restore: std::collections::HashMap::new() };
        let request = majsoul_proto::Wrapper { name: ".lq.FastTest.syncGame".into(), data: Default::default() };
        let mut frame = vec![2, 0x34, 0x12]; frame.extend(request.encode_to_vec());
        w.process(frame.into()).unwrap();
        let original = include_bytes!("../tests/fixtures/sync_response.bin");
        let wrapper = majsoul_proto::Wrapper::decode(&original[3..]).unwrap();
        let mut response = majsoul_proto::GameSyncResponse::decode(wrapper.data).unwrap();
        response.step += 1;
        let wrapper = majsoul_proto::Wrapper { name: String::new(), data: response.encode_to_vec().into() };
        let mut frame = vec![3, 0x34, 0x12]; frame.extend(wrapper.encode_to_vec());
        assert!(w.process(frame.into()).is_err());
        assert!(!w.bridge.active);
    }

    #[tokio::test]
    async fn detects_seat_and_recovers_over_websocket() {
        use prost::Message as _;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let config = Arc::new(Config { seat: None, model: None, origin: None });
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let (tx, rx) = tokio::sync::watch::channel(false);
            let _keep = tx;
            connection(socket, config, rx).await.unwrap();
        });
        let (mut client, _) = connect_async(format!("ws://{address}")).await.unwrap();
        client.send(Message::Text(r#"{"type":"policy","style":"SuperTurtle","intensity":1.5,"revision":7}"#.into())).await.unwrap();
        let status: serde_json::Value = serde_json::from_str(client.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(status["status"], "policy_updated");
        assert_eq!(status["style"], "SuperTurtle");
        assert_eq!(status["intensity"], 1.5);
        assert_eq!(status["revision"], 7);
        client.send(Message::Text(r#"{"type":"policy","style":"CallManiac","intensity":3,"revision":8}"#.into())).await.unwrap();
        let status: serde_json::Value = serde_json::from_str(client.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(status["status"], "policy_error");
        assert_eq!(status["revision"], 8);
        client.send(Message::Text(r#"{"type":"seat","seat":3}"#.into())).await.unwrap();
        let status: serde_json::Value = serde_json::from_str(client.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(status["status"], "seat_detected");
        let request = majsoul_proto::Wrapper { name: ".lq.FastTest.syncGame".into(), data: Default::default() };
        let mut frame = vec![2, 0x34, 0x12]; frame.extend(request.encode_to_vec());
        client.send(Message::Binary(frame.into())).await.unwrap();
        client.send(Message::Binary(bytes::Bytes::from_static(include_bytes!("../tests/fixtures/sync_response.bin")))).await.unwrap();
        client.send(Message::Text(r#"{"type":"replay_end"}"#.into())).await.unwrap();
        let mut restored = false; let mut recommended = false;
        loop {
            let message = timeout(Duration::from_secs(10), client.next()).await.unwrap().unwrap().unwrap();
            let value: serde_json::Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
            if value["status"] == "restored" { restored = true; }
            if value["type"] == "dahai" || value["type"] == "hora" || value["type"] == "reach" { recommended = true; }
            if value["status"] == "replay_complete" { break; }
        }
        assert!(restored && recommended);
        client.close(None).await.unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn websocket_clients_are_isolated_and_origins_checked() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let config = Arc::new(Config { seat: Some(0), model: None, origin: Some("https://example.test".into()) });
        let server = tokio::spawn(async move {
            for _ in 0..3 {
                let (socket, _) = listener.accept().await.unwrap();
                let config = config.clone();
                let (tx, rx) = tokio::sync::watch::channel(false);
                tokio::spawn(async move { let _keep_open = tx; let _ = connection(socket, config, rx).await; });
            }
        });
        let url = format!("ws://{address}");
        let mut bad = url.clone().into_client_request().unwrap();
        bad.headers_mut().insert("origin", "https://untrusted.test".parse().unwrap());
        assert!(connect_async(bad).await.is_err());
        let (mut a, _) = connect_async(&url).await.unwrap();
        let (mut b, _) = connect_async(&url).await.unwrap();
        for client in [&mut a, &mut b] {
            client.send(Message::Binary(vec![255].into())).await.unwrap();
            let reply = timeout(Duration::from_secs(5), client.next()).await.unwrap().unwrap().unwrap();
            let value: serde_json::Value = serde_json::from_str(reply.to_text().unwrap()).unwrap();
            assert_eq!(value["status"], "desynchronized");
        }
        server.await.unwrap();
    }
}
