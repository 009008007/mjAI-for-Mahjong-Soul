// Observe game traffic in the page world. Never send credentials to the extension.
(() => {
  'use strict';
  const NativeWebSocket = window.WebSocket;
  if (typeof NativeWebSocket !== 'function') return;
  const CHANNEL = 'majsoul-hud-v1';
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  let nextId = 0;
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
        if (currentEpoch !== epoch || buffer.byteLength > 1024 * 1024 + 4096) return;
        const bytes = new Uint8Array(buffer); let frame;
        try { frame = parseFrame(bytes); } catch (_) { return; }
        if (direction === 'out' && frame.kind === 2) {
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
          emit(buffer, {newRound:actionName === 'ActionNewRound' || actionName === '.lq.ActionNewRound'});
        }
      }).catch(() => {
        epoch++; pendingRequests.clear(); account = null;
        if (announced) notify({kind:'reset', id}); announced = false;
      }).finally(() => { queued--; });
    }
    socket.addEventListener('message', event => enqueue(event.data, 'in'));
    const send = socket.send;
    socket.send = function(data) { enqueue(data, 'out'); return Reflect.apply(send, this, arguments); };
    socket.addEventListener('close', () => { queue.finally(() => { if (announced) notify({kind:'close', id}); }); });
  }
  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) { const socket = Reflect.construct(target, args, newTarget); watch(socket); return socket; }
  });
})();
