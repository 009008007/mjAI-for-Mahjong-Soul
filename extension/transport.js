(() => {
'use strict';

const encoder = new TextEncoder();
function varint(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw Error('invalid integer');
  const bytes = [];
  do {
    const low = value % 128;
    value = Math.floor(value / 128);
    bytes.push(low | (value ? 128 : 0));
  } while (value);
  return bytes;
}
function number(field, value) {
  return value ? [...varint(field * 8), ...varint(value)] : [];
}
function bytesField(field, value) {
  return [...varint(field * 8 + 2), ...varint(value.length), ...value];
}
function encodeRequest(id, action, timeuse) {
  if (!Number.isInteger(id) || id < 1 || id > 65535 ||
      !Number.isInteger(timeuse) || timeuse < 0 || timeuse > 60000 ||
      !action || !['inputOperation','inputChiPengGang'].includes(action.method)) throw Error('invalid request');
  let payload;
  if (action.method === 'inputOperation') {
    if (![1,7,8,9,10].includes(action.type)) throw Error('unsupported self operation');
    const needsTile = action.type === 1 || action.type === 7;
    if (needsTile && (typeof action.tile !== 'string' || !/^(?:[0-9][mps]|[1-7]z)$/.test(action.tile))) throw Error('missing tile');
    payload = [...number(1, action.type), ...(needsTile ? bytesField(3, encoder.encode(action.tile)) : []),
      ...number(5, action.moqie ? 1 : 0), ...number(6, timeuse)];
  } else {
    if (action.cancel_operation === true) payload = [...number(3, 1), ...number(6, timeuse)];
    else {
      if (![2,3,4,5,6].includes(action.type) || !Number.isInteger(action.index) || action.index < 0) throw Error('invalid call');
      payload = [...number(1, action.type), ...number(2, action.index), ...number(6, timeuse)];
    }
  }
  const method = encoder.encode('.lq.FastTest.' + action.method);
  return new Uint8Array([2, id & 255, id >> 8, ...bytesField(1, method), ...bytesField(2, payload)]);
}
function parseFields(bytes) {
  let position = 0;
  function readVarint() {
    let value = 0, factor = 1;
    for (let i=0; i<5 && position<bytes.length; i++) {
      const b = bytes[position++];
      value += (b & 127) * factor;
      if (!(b & 128)) return value;
      factor *= 128;
    }
    throw Error('invalid varint');
  }
  const fields = [];
  while (position < bytes.length) {
    const tag = readVarint(), id = Math.floor(tag / 8), wire = tag % 8;
    if (!id) throw Error('invalid tag');
    if (wire === 0) fields.push([id, wire, readVarint()]);
    else if (wire === 2) {
      const length = readVarint();
      if (length > bytes.length - position) throw Error('invalid length');
      fields.push([id, wire, bytes.slice(position, position + length)]);
      position += length;
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (size > bytes.length - position) throw Error('truncated field');
      fields.push([id, wire, bytes.slice(position, position + size)]);
      position += size;
    } else throw Error('unsupported wire type');
  }
  return fields;
}
function parseResponse(frame, expectedId) {
  try {
    if (!(frame instanceof Uint8Array) || frame.length < 3 || frame[0] !== 3 ||
        (frame[1] | frame[2] << 8) !== expectedId) return null;
    const envelope = parseFields(frame.subarray(3));
    const payloads = envelope.filter(([id]) => id === 2);
    if (payloads.length > 1 || payloads.some(([, wire]) => wire !== 2)) return null;
    const body = payloads.length ? parseFields(payloads[0][2]) : [];
    const errors = body.filter(([id]) => id === 1);
    if (!errors.length) return {ok:true};
    if (errors.length !== 1 || errors[0][1] !== 2) return null;
    const error = parseFields(errors[0][2]);
    const codes = error.filter(([id]) => id === 1);
    if (codes.length > 1 || codes.some(([, wire]) => wire !== 0)) return null;
    const code = codes.length ? codes[0][2] : 0;
    return {ok:code === 0, code};
  } catch (_) { return null; }
}
globalThis.MjaiTransport = {encodeRequest, parseResponse};

})();
