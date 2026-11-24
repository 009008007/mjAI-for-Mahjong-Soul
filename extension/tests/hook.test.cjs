const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const enc = new TextEncoder();
function varint(n) { const out=[]; do { const x=n%128; n=Math.floor(n/128); out.push(x|(n?128:0)); } while(n); return out; }
function field(n, data) { return [n*8+2,...varint(data.length),...data]; }
function number(n, value) { return [n*8,...varint(value)]; }
function req(id, name, payload) { return new Uint8Array([2,id&255,id>>8,...field(1,enc.encode(name)),...field(2,payload)]); }
function res(id, payload) { return new Uint8Array([3,id&255,id>>8,...field(2,payload)]); }
function action(name) { return new Uint8Array([1,...field(1,enc.encode('.lq.ActionPrototype')),...field(2,field(2,enc.encode(name)))]); }
function runtime() {
 const sent=[],messages=[];
 class WS extends EventTarget { send(value) { sent.push(value); } }
 const location={origin:'https://game.maj-soul.com'};
 const window={WebSocket:WS, postMessage(data) { messages.push(data); }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../hook.js'),'utf8'),{window,location,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Blob,Promise,Reflect});
 return {window,sent,messages};
}
test('preserves game sends, filters traffic, and correlates restore responses without forwarding credentials', async () => {
 const {window,sent,messages}=runtime(), ws=new window.WebSocket('wss://game.example');
 const secret=enc.encode('sensitive-token');
 const auth=req(23,'.lq.FastTest.authGame',[...number(1,4321),...field(2,secret)]);
 ws.send(auth);
 ws.dispatchEvent(new MessageEvent('message',{data:res(23,field(3,[...varint(8),...varint(4321),...varint(9),...varint(10)])).buffer}));
 const sync=req(24,'.lq.FastTest.syncGame',field(2,secret)); ws.send(sync);
 const response=res(24,field(2,enc.encode('restore'))); ws.dispatchEvent(new MessageEvent('message',{data:response.buffer}));
 const first=action('ActionNewRound'); ws.dispatchEvent(new MessageEvent('message',{data:new Blob([first])}));
 ws.dispatchEvent(new Event('close'));
 await new Promise(r=>setTimeout(r,25));
 assert.equal(sent[0],auth); assert.equal(sent[1],sync);
 assert.deepEqual(messages.map(x=>x.kind),['open','seat','frame','frame','frame','close']);
 assert.equal(messages[1].seat,1);
 assert.equal(messages[2].restoreRequest,24); assert.equal(messages[3].restoreResponse,24);
 assert.equal(messages[4].newRound,true);
 assert.ok(!Buffer.from(messages[2].buffer).includes(Buffer.from(secret)));
 assert.ok(!messages.some(x=>x.buffer && Buffer.from(x.buffer).includes(Buffer.from('sensitive-token'))));
});
