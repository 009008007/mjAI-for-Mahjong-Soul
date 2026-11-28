// Observe game traffic in the page world. Never send credentials to the extension.
(() => {
  'use strict';
  const NativeWebSocket = window.WebSocket;
  if (typeof NativeWebSocket !== 'function') return;
  const CHANNEL = 'majsoul-hud-v1';
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  let nextId = 0;
  const watched = new Map();
  const notify = (message, transfer = []) => window.postMessage({channel: CHANNEL, ...message}, location.origin, transfer);
  function varint(data, pos) {
    let value = 0, factor = 1;
    for (let n = 0; n < 10 && pos < data.length; n++) {
      const b = data[pos++]; value += (b & 127) * factor;
      if (!(b & 128)) return [value, pos];
      factor *= 128;
    }
    throw Error('invalid protobuf varint');
  }
  function fields(data) {
    let pos = 0; const out = [];
    while (pos < data.length) {
      let tag; [tag, pos] = varint(data, pos);
      const id = Math.floor(tag / 8), wire = tag % 8;
      if (!id) throw Error('invalid protobuf tag');
      if (wire === 0) { let value; [value, pos] = varint(data, pos); out.push([id, wire, value]); }
      else if (wire === 2) { let n; [n, pos] = varint(data, pos); if (n > data.length - pos) throw Error('truncated protobuf'); out.push([id, wire, data.subarray(pos, pos + n)]); pos += n; }
      else if (wire === 1) { pos += 8; if (pos > data.length) throw Error('truncated protobuf'); }
      else if (wire === 5) { pos += 4; if (pos > data.length) throw Error('truncated protobuf'); }
      else throw Error('unsupported protobuf wire type');
    }
    return out;
  }
  const field = (list, id, wire) => list.find(x => x[0] === id && x[1] === wire)?.[2];
  function parseFrame(bytes) {
    const kind = bytes[0];
    if (![1,2,3].includes(kind) || (kind !== 1 && bytes.length < 3)) throw Error('invalid frame');
    const id = kind === 1 ? null : bytes[1] | (bytes[2] << 8);
    const wrapper = fields(bytes.subarray(kind === 1 ? 1 : 3));
    const nameBytes = field(wrapper, 1, 2), payload = field(wrapper, 2, 2) || new Uint8Array();
    return {kind, id, name: nameBytes ? decoder.decode(nameBytes) : '', payload};
  }
  function encodeVarint(n) { const b = []; do { let v = n % 128; n = Math.floor(n / 128); b.push(v | (n ? 128 : 0)); } while (n); return b; }
  function strippedRequest(id, name) {
    const n = encoder.encode(name);
    return new Uint8Array([2, id & 255, id >> 8, 10, ...encodeVarint(n.length), ...n]).buffer;
  }
  function copyData(data) {
    if (data instanceof ArrayBuffer) return Promise.resolve(data.slice(0));
    if (ArrayBuffer.isView(data)) return Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    if (data instanceof Blob) return data.arrayBuffer();
    return null;
  }
  function watch(socket) {
    const id = String(++nextId), pendingRequests = new Map();
    let serial = 0, pendingAuto = null, lastId = 65536;
    const recent = new Set();
    function allocate() {
      for (let i=0; i<2048; i++) {
        lastId = lastId <= 60000 ? 65535 : lastId - 1;
        if (!recent.has(lastId) && !pendingRequests.has(lastId)) return lastId;
      }
      return null;
    }
    const auto = {
      send(message) {
        if (typeof message.session !== 'string' || !message.session ||
            document.documentElement?.getAttribute('data-mjai-autoplay-session') !== message.session) return false;
        if (socket.readyState !== 1 || queued !== 0 || pendingAuto || message.serial !== serial) return false;
        const requestId = allocate();
        if (requestId === null) return false;
        try {
          const bytes = globalThis.MjaiTransport.encodeRequest(requestId, message.action, message.timeuse);
          pendingAuto = requestId;
          recent.add(requestId);
          if (recent.size > 4096) recent.delete(recent.values().next().value);
          Reflect.apply(send, socket, [bytes.buffer]);
          notify({kind:'auto_sent', id, serial, requestId, localId:message.localId});
          return true;
        } catch (_) {
          pendingAuto = null;
          return false;
        }
      },
      complete(requestId) {
        if (pendingAuto === requestId) pendingAuto = null;
      }
    };
    watched.set(id, auto);
    function summarize(action) {
      try {
        const list = fields(action), step = field(list, 1, 0) ?? 0;
        const name = decoder.decode(field(list, 2, 2) || new Uint8Array()).replace(/^\.lq\./, '');
        const encrypted = field(list, 3, 2) || new Uint8Array();
        const key = [0x84,0x5e,0x4e,0x42,0x39,0xa2,0x1f,0x60,0x1c];
        const body = Uint8Array.from(encrypted, (byte, i) => byte ^ (((23 ^ encrypted.length) + 5*i + key[i % 9]) & 255));
        const parts = fields(body);
        if (name === 'ActionDiscardTile') return {type:name,step,seat:field(parts,1,0) ?? 0,tile:decoder.decode(field(parts,2,2) || new Uint8Array()),is_liqi:Boolean(field(parts,3,0) || field(parts,9,0))};
        if (name === 'ActionChiPengGang') return {type:name,step,seat:field(parts,1,0) ?? 0,meldType:field(parts,2,0) ?? 0,tiles:parts.filter(([n,w])=>n===3 && w===2).map(([, ,v])=>decoder.decode(v))};
        if (name === 'ActionAnGangAddGang') return {type:name,step,seat:field(parts,1,0) ?? 0,meldType:field(parts,2,0) ?? 0,tile:decoder.decode(field(parts,3,2) || new Uint8Array())};
        if (name === 'ActionHule') return {type:name,step,winners:parts.filter(([n,w])=>n===1 && w===2).map(([, ,v])=>field(fields(v),4,0) ?? 0)};
        if (name === 'ActionLiuJu') return {type:name,step,seat:field(parts,3,0) ?? 0,reason:field(parts,1,0) ?? 0};
        return {type:name,step};
      } catch (_) { return null; }
    }
    let queue = Promise.resolve(), queued = 0, epoch = 0, announced = false, account = null;
    const emit = (buffer, extra = {}) => {
      if (!announced) { notify({kind:'open', id}); announced = true; }
      notify({kind:'frame', id, buffer, ...extra}, [buffer]);
    };
    function enqueue(data, direction) {
      const copied = copyData(data); if (!copied) return;
      if (queued >= 128) {
        epoch++; pendingRequests.clear(); account = null;
        if (announced) notify({kind:'reset', id}); announced = false; return;
      }
      const currentEpoch = epoch; queued++;
      queue = queue.then(async () => {
        const buffer = await copied;
        if (currentEpoch !== epoch) return;
        if (buffer.byteLength > 1024 * 1024 + 4096) {
          epoch++; pendingRequests.clear(); account = null;
          if (announced) notify({kind:'reset', id}); announced = false;
          return;
        }
        const bytes = new Uint8Array(buffer); let frame;
        try { frame = parseFrame(bytes); } catch (_) { return; }
        if (direction === 'out' && frame.kind === 2) {
          recent.add(frame.id);
          if (recent.size > 4096) recent.delete(recent.values().next().value);
          if (['.lq.FastTest.inputOperation','.lq.FastTest.inputChiPengGang'].includes(frame.name)) {
            const method = frame.name.split('.').at(-1);
            let command;
            try {
              const payload = fields(frame.payload);
              const tile = field(payload, 3, 2);
              command = {method, type:field(payload, 1, 0) ?? 0};
              if (method === 'inputOperation' && tile?.length === 2) command.tile = decoder.decode(tile);
            } catch (_) { /* A native action still supersedes pending automation. */ }
            notify({kind:'manual_operation', id, serial, command});
          }
          if (frame.name === '.lq.FastTest.authGame') {
            try { account = field(fields(frame.payload), 1, 0) ?? null; } catch (_) { account = null; }
            if (pendingRequests.size >= 256) pendingRequests.clear();
            pendingRequests.set(frame.id, 'auth');
          } else if (frame.name === '.lq.FastTest.syncGame' || frame.name === '.lq.FastTest.enterGame') {
            if (pendingRequests.size >= 256) pendingRequests.clear();
            pendingRequests.set(frame.id, 'restore');
            emit(strippedRequest(frame.id, frame.name), {restoreRequest:frame.id});
          }
        } else if (direction === 'in' && frame.kind === 3) {
          if (pendingAuto === frame.id) {
            const result = globalThis.MjaiTransport.parseResponse(bytes, frame.id);
            pendingAuto = null;
            notify({kind:'auto_response', id, requestId:frame.id, result});
          }
          const route = pendingRequests.get(frame.id); pendingRequests.delete(frame.id);
          if (route === 'auth') {
            try {
              const result = fields(frame.payload), seats = [];
              for (const [fieldId, wire, value] of result) if (fieldId === 3) {
                if (wire === 0) seats.push(value);
                else if (wire === 2) { let p = 0; while (p < value.length) { let v; [v,p] = varint(value,p); seats.push(v); } }
              }
              const seat = seats.indexOf(account);
              if (account !== null && seats.length === 4 && seat >= 0) {
                if (!announced) { notify({kind:'open', id}); announced = true; }
                notify({kind:'seat', id, seat});
              }
            } catch (_) { /* Ignore unexpected auth payloads; never forward them. */ }
            account = null;
          } else if (route === 'restore') emit(buffer, {restoreResponse:frame.id});
        } else if (direction === 'in' && frame.kind === 1 && frame.name === '.lq.ActionPrototype') {
          let actionName = '';
          try { const b = field(fields(frame.payload), 2, 2); if (b) actionName = decoder.decode(b); } catch (_) {}
          serial++;
          emit(buffer, {serial, summary:summarize(frame.payload), newRound:actionName === 'ActionNewRound' || actionName === '.lq.ActionNewRound'});
        }
      }).catch(() => {
        epoch++; pendingRequests.clear(); account = null;
        if (announced) notify({kind:'reset', id}); announced = false;
      }).finally(() => { queued--; });
    }
    socket.addEventListener('message', event => enqueue(event.data, 'in'));
    const send = socket.send;
    socket.send = function(data) { enqueue(data, 'out'); return Reflect.apply(send, this, arguments); };
    socket.addEventListener('close', () => { watched.delete(id); queue.finally(() => { if (announced) notify({kind:'close', id}); }); });
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'majsoul-auto-v1') return;
    const message = event.data, entry = watched.get(message.id);
    if (message.kind === 'submit' && (!entry || !entry.send(message))) notify({kind:'auto_send_failed', id:message.id, localId:message.localId});
    if (message.kind === 'complete' && Number.isInteger(message.requestId)) entry?.complete(message.requestId);
  });
  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) { const socket = Reflect.construct(target, args, newTarget); watch(socket); return socket; }
  });
})();
