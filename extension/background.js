'use strict';
// Backend sockets are per game socket; retained replay data lives in content.js.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'majsoul-hud-v1' || !port.sender?.tab || port.sender.frameId !== 0) { port.disconnect(); return; }
  const sockets = new Map(); let alive = true;
  function send(message) { try { if (alive) port.postMessage(message); } catch (_) {} }
  function close(id) {
    const entry = sockets.get(id); if (!entry) return;
    sockets.delete(id); entry.closed = true; clearTimeout(entry.timer); clearInterval(entry.heartbeat);
    if (entry.ws) entry.ws.close();
  }
  function open(id) {
    if (sockets.has(id) || sockets.size >= 8) return;
    const entry = {ws:null, timer:null, heartbeat:null, closed:false, replaying:true, initialized:false, latest:null}; sockets.set(id, entry);
    function connect() {
      if (entry.closed) return;
      const ws = new WebSocket('ws://127.0.0.1:23410'); entry.ws = ws; entry.replaying = true; entry.initialized = false; entry.latest = null;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        send({kind:'connection', id, state:'connected'});
        entry.heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 20000);
      };
      ws.onmessage = event => {
        if (entry.closed || entry.ws !== ws) return;
        if (typeof event.data !== 'string' || event.data.length > 16384) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'status' && data.status === 'policy_updated') {
            if (entry.replaying) entry.latest = null;
            send({kind:'suggestion', id, data}); return;
          }
          if (entry.replaying && data.type === 'status' && data.status === 'replay_complete') {
            entry.replaying = false; send({kind:'connection', id, state:'ready'}); if (entry.latest) send({kind:'suggestion', id, data:entry.latest}); entry.latest = null; return;
          }
          if (entry.replaying) {
            if (data.type === 'status') { if (data.status === 'clear') entry.latest = null; else if (['desynchronized','needs_seat','seat_mismatch'].includes(data.status) && !(entry.latest?.status === 'seat_mismatch' && data.status === 'needs_seat')) entry.latest = data; }
            else entry.latest = data;
          } else send({kind:'suggestion', id, data});
        } catch (_) {}
      };
      ws.onclose = () => {
        clearInterval(entry.heartbeat); if (entry.closed) return;
        entry.initialized = false; send({kind:'connection', id, state:'disconnected'});
        entry.timer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }
    connect();
  }
  port.onMessage.addListener(message => {
    if (!message || typeof message.id !== 'string' || !/^\d{1,12}$/.test(message.id)) return;
    const {kind,id} = message;
    if (kind === 'open') return open(id);
    if (kind === 'restart') { close(id); send({kind:'connection', id, state:'disconnected'}); open(id); return; }
    if (kind === 'close' || kind === 'reset') { close(id); send({kind:'connection', id, state:'disconnected'}); return; }
    const entry = sockets.get(id), ws = entry?.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      if (kind === 'replay-start') { entry.initialized = true; return; }
      if (!entry.initialized) return;
      if (ws.bufferedAmount > 8 * 1024 * 1024) { ws.close(); return; }
      if (kind === 'policy' && ['default','CallManiac','SuperTurtle'].includes(message.style)
        && typeof message.intensity === 'number' && Number.isFinite(message.intensity)
        && message.intensity >= 0 && message.intensity <= 2 && Number.isSafeInteger(message.revision) && message.revision >= 0) {
        ws.send(JSON.stringify({type:'policy',style:message.style,intensity:message.intensity,revision:message.revision}));
      } else if (kind === 'seat' && Number.isInteger(message.seat) && message.seat >= 0 && message.seat <= 3) {
        ws.send(JSON.stringify({type:'seat', seat:message.seat}));
      } else if (kind === 'replay-end') {
        ws.send(JSON.stringify({type:'replay_end'}));
      } else if (kind === 'frame' && typeof message.data === 'string' && message.data.length <= 1404000) {
        const binary = atob(message.data), bytes = new Uint8Array(binary.length);
        for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
        ws.send(bytes);
      }
    } catch (_) { ws.close(); }
  });
  port.onDisconnect.addListener(() => { alive = false; for (const id of sockets.keys()) close(id); });
});
