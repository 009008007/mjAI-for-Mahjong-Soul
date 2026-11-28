'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const enc = new TextEncoder();
function vint(n) { let a=[]; do { const b=n%128; n=Math.floor(n/128); a.push(b|(n?128:0)); } while(n); return a; }
function fld(n,data) { return [n*8+2,...vint(data.length),...data]; }
function num(n,value) { return value ? [n*8,...vint(value)] : []; }
function action(step,name,payload) {
 const key=[0x84,0x5e,0x4e,0x42,0x39,0xa2,0x1f,0x60,0x1c];
 const data=payload.map((b,i)=>b^(((23^payload.length)+5*i+key[i%9])&255));
 return new Uint8Array([1,...fld(1,enc.encode('.lq.ActionPrototype')),...fld(2,[...num(1,step),...fld(2,enc.encode(name)),...fld(3,data)])]);
}
function hooks() { return {listeners:[],addListener(f){this.listeners.push(f)},fire(v){for(const f of this.listeners)f(v)}}; }
function setup() {
 let clock=1000, timers=[], sent=[], messages=[], port, fallbackTarget=null;
 const listeners={};
 const location={origin:'https://game.maj-soul.com'};
 class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.handlers={};this.className='';this.textContent='';this.attrs={};this.checked=false;}
  setAttribute(k,v){this.attrs[k]=String(v)} getAttribute(k){return this.attrs[k]??null} removeAttribute(k){delete this.attrs[k]}
  append(...nodes){this.children.push(...nodes)}
  attachShadow(){this.shadow=new Element('shadow');return this.shadow}
  addEventListener(name,fn){this.handlers[name]=fn}
 }
 class WS extends EventTarget {
  constructor(){super();this.readyState=1}
  send(value){sent.push(value)}
 }
 const window={WebSocket:WS,addEventListener(name,fn){(listeners[name]??=[]).push(fn)},
  postMessage(data){queueMicrotask(()=>{for(const fn of listeners.message??[])fn({source:window,origin:location.origin,data})})}};
 const documentListeners={};
 const document={documentElement:new Element('html'),createElement:tag=>new Element(tag),
  addEventListener(name,fn){(documentListeners[name]??=[]).push(fn)}};
 const chrome={runtime:{connect(){port={onMessage:hooks(),onDisconnect:hooks(),sent:[],postMessage(x){this.sent.push(x)}};return port}}};
 const context=vm.createContext({window,document,location,chrome,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Blob,Promise,Reflect,Math,
  performance:{now:()=>clock}, MajsoulHighlight:{create:()=>({show(){},clear(){},fallbackTarget(){return fallbackTarget}})}, btoa, setTimeout(fn,delay){const item={fn,delay};timers.push(item);return item},
  clearTimeout(item){item.cancelled=true}, MutationObserver:class{}});
 const load=file=>vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
 for(const file of ['transport.js','autoplay.js','confirmation.js','hook.js','content.js']) load(file);
 const ws=new window.WebSocket('wss://game.example');
 function find(node,label) { if(node.textContent===label)return node; for(const c of node.children??[]){const hit=find(c,label);if(hit)return hit} }
 const shadow=document.documentElement.children[0].shadow;
 // attachShadow's return is captured by the script, so locate the button via created elements.
 function checkbox() { const label=find(shadow,'Enable autoplay'); return label && label.parentCheckbox; }
 function all(node) { return [node,...(node.children??[]).flatMap(all)]; }
 return {ws,port,sent,timers,context,window,location,document,documentListeners,setFallbackTarget:t=>fallbackTarget=t,clock:()=>clock,setClock:t=>clock=t,find,shadow,checkbox:()=>all(shadow).find(n=>n.tagName==='INPUT' && n.type==='checkbox')};
}

test('routes a timed riichi through game socket and waits for server and state', async () => {
 const x=setup();
 const wait=async()=>{await new Promise(r=>setTimeout(r,15))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'}); emit({kind:'seat',id:'1',seat:0}); await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});
 const start=x.checkbox(); assert.ok(start); start.checked=true; start.handlers.change();
 const draw=action(4,'ActionDealTile',[...num(1,0),...fld(2,enc.encode('0s'))]);
 x.ws.dispatchEvent(new MessageEvent('message',{data:draw.buffer})); await wait();
 const frame=x.port.sent.filter(v=>v.kind==='frame').at(-1); assert.equal(frame.serial,1);
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{
  type:'reach',actor:0,source:'model',riichi_discard:'5sr',riichi_hand_index:13,drawn_index:13,frame_serial:1,
  opportunity:{seat:0,step:4,source:'ActionDealTile',time_fixed:5000,time_add:0,hand:['5sr','5s'],drawn:'5sr',
   operations:[{type:7,combination:['0s','5s']}]}
 }});
 const timer=x.timers.find(t=>t.delay>=1000 && t.delay<=3000 && !t.cancelled); assert.ok(timer);
 x.setClock(1000+timer.delay); timer.fn(); await wait();
 assert.equal(x.sent.length,1);
 const request=new Uint8Array(x.sent[0]), id=request[1] | request[2]<<8;
 assert.ok(Buffer.from(request).includes(Buffer.from('0s')));
 const discard=action(5,'ActionDiscardTile',[...fld(2,enc.encode('0s')),...num(3,1)]);
 x.ws.dispatchEvent(new MessageEvent('message',{data:discard.buffer})); await wait();
 assert.ok(x.find(x.shadow,'Auto status: confirmed'));
 const response=new Uint8Array([3,id&255,id>>8,...fld(2,[])]);
 x.ws.dispatchEvent(new MessageEvent('message',{data:response.buffer})); await wait();
 assert.ok(x.find(x.shadow,'Auto status: confirmed'));
});

test('routes the selected red chi among five choices and confirms the exact meld', async () => {
 const x=setup();
 const wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'}); emit({kind:'seat',id:'1',seat:0}); await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});
 x.checkbox().checked=true; x.checkbox().handlers.change();
 const discard=action(8,'ActionDiscardTile',[...num(1,3),...fld(2,enc.encode('4s'))]);
 x.ws.dispatchEvent(new MessageEvent('message',{data:discard.buffer})); await wait();
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{
  type:'chi',actor:0,source:'model',pai:'4s',consumed:['3s','5sr'],frame_serial:1,
  opportunity:{seat:0,step:8,source:'ActionDiscardTile',time_fixed:5000,time_add:0,
   hand:['2s','3s','5s','5sr','6s'],drawn:null,
   operations:[{type:2,combination:['2s|3s','3s|5s','3s|0s','5s|6s','0s|6s']}]}
 }});
 const timer=x.timers.find(t=>t.delay>=1000 && t.delay<=3000 && !t.cancelled); assert.ok(timer);
 x.setClock(1000+timer.delay); timer.fn(); await wait();
 assert.equal(x.sent.length,1);
 const request=new Uint8Array(x.sent[0]), id=request[1] | request[2]<<8;
 assert.ok(Buffer.from(request).includes(Buffer.from([8,2,16,2])));
 const response=new Uint8Array([3,id&255,id>>8,...fld(2,[])]);
 x.ws.dispatchEvent(new MessageEvent('message',{data:response.buffer})); await wait();
 assert.ok(x.find(x.shadow,'Auto status: awaiting_confirmation'));
 const meld=action(9,'ActionChiPengGang',[...fld(3,enc.encode('4s')),...fld(3,enc.encode('0s')),...fld(3,enc.encode('3s'))]);
 x.ws.dispatchEvent(new MessageEvent('message',{data:meld.buffer})); await wait();
 assert.ok(x.find(x.shadow,'Auto status: confirmed'));
});

test('rejects an old recommendation after a newer game frame', async () => {
 const x=setup(), wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'}); emit({kind:'seat',id:'1',seat:0}); await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});
 x.checkbox().checked=true; x.checkbox().handlers.change();
 for(const step of [3,4]) { const frame=action(step,'ActionDealTile',fld(2,enc.encode('1s'))); x.ws.dispatchEvent(new MessageEvent('message',{data:frame.buffer})); await wait(); }
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{
  type:'dahai',actor:0,source:'model',pai:'1s',frame_serial:1,
  opportunity:{seat:0,step:3,source:'ActionDealTile',time_fixed:5000,time_add:0,hand:['1s'],
   operations:[{type:1,combination:[]}]}
 }});
 assert.equal(x.timers.filter(t=>t.delay>=1000 && t.delay<=3000 && !t.cancelled).length,0);
 assert.equal(x.sent.length,0);
});

test('stops after server rejection and never sends a second command', async () => {
 const x=setup(), wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'}); emit({kind:'seat',id:'1',seat:0}); await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});
 x.checkbox().checked=true; x.checkbox().handlers.change();
 const draw=action(2,'ActionDealTile',fld(2,enc.encode('1s')));
 x.ws.dispatchEvent(new MessageEvent('message',{data:draw.buffer})); await wait();
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{
  type:'dahai',actor:0,source:'model',pai:'1s',frame_serial:1,
  opportunity:{seat:0,step:2,source:'ActionDealTile',time_fixed:5000,time_add:0,hand:['1s'],
   operations:[{type:1,combination:[]}]}
 }});
 const timer=x.timers.find(t=>t.delay>=1000 && t.delay<=3000 && !t.cancelled);
 x.setClock(1000+timer.delay);timer.fn();await wait();
 const request=new Uint8Array(x.sent[0]), id=request[1] | request[2]<<8;
 x.ws.dispatchEvent(new MessageEvent('message',{data:new Uint8Array([3,id&255,id>>8,...fld(2,[...fld(1,num(1,7))])]).buffer})); await wait();
 assert.ok(x.find(x.shadow,'Auto status: rejected'));
 assert.equal(x.checkbox().checked,true);
 assert.equal(x.sent.length,1);
});

test('ignores other canvas clicks, confirms the actual discard without a response, and plays another turn', async () => {
 const x=setup(), wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'}); emit({kind:'seat',id:'1',seat:0}); await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});
 x.checkbox().checked=true; x.checkbox().handlers.change();
 for(const fn of x.documentListeners.pointerdown??[]) fn({isTrusted:true,target:{tagName:'CANVAS'}});
 for(const fn of x.documentListeners.keydown??[]) fn({isTrusted:true,target:{tagName:'CANVAS'}});
 assert.equal(x.checkbox().checked,true);
 async function turn(step,serial,tile) {
  const draw=action(step,'ActionDealTile',fld(2,enc.encode(tile)));
  x.ws.dispatchEvent(new MessageEvent('message',{data:draw.buffer})); await wait();
  // Inference takes two seconds; the random wait must begin after the advice arrives.
  x.setClock(x.clock()+2000);
  x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',actor:0,source:'model',pai:tile,frame_serial:serial,
   opportunity:{seat:0,step,source:'ActionDealTile',time_fixed:10000,time_add:0,hand:[tile],operations:[{type:1,combination:[]}]}}});
  const timer=x.timers.filter(t=>t.delay>=1000&&t.delay<=3000&&!t.cancelled).at(-1);assert.ok(timer);
  x.setClock(x.clock()+timer.delay);timer.fn();await wait();
  const request=new Uint8Array(x.sent.at(-1)),id=request[1]|request[2]<<8;
  const discarded=action(step+1,'ActionDiscardTile',fld(2,enc.encode(tile)));
  x.ws.dispatchEvent(new MessageEvent('message',{data:discarded.buffer}));await wait();
  assert.ok(x.find(x.shadow,'Auto status: confirmed'));return id;
 }
 const firstId=await turn(1,1,'1s');
 const secondId=await turn(3,3,'2s');
 assert.notEqual(firstId,secondId);assert.equal(x.sent.length,2);
 // A late reply to the first request cannot change or reject the second.
 x.ws.dispatchEvent(new MessageEvent('message',{data:new Uint8Array([3,firstId&255,firstId>>8,...fld(2,fld(1,num(1,7)))]).buffer}));await wait();
 assert.equal(x.checkbox().checked,true);assert.ok(x.find(x.shadow,'Auto status: confirmed'));
 // A manual move cancels the current decision but keeps the user's switch enabled.
 const method=enc.encode('.lq.FastTest.inputOperation');
 x.ws.send(new Uint8Array([2,42,0,...fld(1,method),...fld(2,[])]).buffer);await wait();
 assert.equal(x.checkbox().checked,true);
});

test('unrecognized reply is not reported as rejection and the matching event confirms it', async () => {
 const x=setup(), wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'});emit({kind:'seat',id:'1',seat:0});await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});x.checkbox().checked=true; x.checkbox().handlers.change();
 x.ws.dispatchEvent(new MessageEvent('message',{data:action(1,'ActionDealTile',fld(2,enc.encode('1s'))).buffer}));await wait();
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',actor:0,source:'model',pai:'1s',frame_serial:1,
  opportunity:{seat:0,step:1,source:'ActionDealTile',time_fixed:5000,time_add:0,hand:['1s'],operations:[{type:1,combination:[]}]}}});
 const timer=x.timers.find(t=>t.delay>=1000&&t.delay<=3000&&!t.cancelled);x.setClock(1000+timer.delay);timer.fn();await wait();
 const request=new Uint8Array(x.sent[0]),id=request[1]|request[2]<<8;
 // Valid wrapper but an unrecognized ResCommon representation.
 x.ws.dispatchEvent(new MessageEvent('message',{data:new Uint8Array([3,id&255,id>>8,...fld(2,[8,1])]).buffer}));await wait();
 assert.ok(x.find(x.shadow,'Auto status: response_unknown'));assert.equal(x.checkbox().checked,true);
 x.ws.dispatchEvent(new MessageEvent('message',{data:action(2,'ActionDiscardTile',fld(2,enc.encode('1s'))).buffer}));await wait();
 assert.ok(x.find(x.shadow,'Auto status: confirmed'));assert.equal(x.checkbox().checked,true);
});

test('unchecking before delivery blocks a queued submit, including after re-enabling', async () => {
 const x=setup(), wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'});emit({kind:'seat',id:'1',seat:0});await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});
 x.checkbox().checked=true;x.checkbox().handlers.change();
 x.ws.dispatchEvent(new MessageEvent('message',{data:action(1,'ActionDealTile',fld(2,enc.encode('1s'))).buffer}));await wait();
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',actor:0,source:'model',pai:'1s',frame_serial:1,
  opportunity:{seat:0,step:1,source:'ActionDealTile',time_fixed:5000,time_add:0,hand:['1s'],operations:[{type:1,combination:[]}]}}});
 const timer=x.timers.find(t=>t.delay>=1000&&t.delay<=3000&&!t.cancelled);x.setClock(1000+timer.delay);
 timer.fn(); // postMessage is queued; revoke and re-enable before it is delivered.
 x.checkbox().checked=false;x.checkbox().handlers.change();
 x.checkbox().checked=true;x.checkbox().handlers.change();await wait();
 assert.equal(x.sent.length,0);assert.equal(x.checkbox().checked,true);
 x.checkbox().checked=false;x.checkbox().handlers.change();
 timer.fn();await wait();assert.equal(x.sent.length,0);assert.equal(x.checkbox().checked,false);
});

test('ron and tsumo use offered type and match a real Hule event for a nonzero seat', async () => {
 for (const [op,target] of [[8,3],[9,1]]) {
  const x=setup(), wait=async()=>{await new Promise(r=>setTimeout(r,12))};
  const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
  emit({kind:'open',id:'1'});emit({kind:'seat',id:'1',seat:1});await wait();
  x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
  x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
  x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});x.checkbox().checked=true;x.checkbox().handlers.change();
  const source=op===8?'ActionDealTile':'ActionDiscardTile';
  x.ws.dispatchEvent(new MessageEvent('message',{data:action(1,source,[...num(1,op===8?1:3),...fld(2,enc.encode('1s'))]).buffer}));await wait();
  x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'hora',actor:1,target,source:'model',frame_serial:1,
   opportunity:{seat:1,step:1,source,time_fixed:5000,time_add:0,hand:['1s'],operations:[{type:op,combination:[]}]}}});
  const timer=x.timers.find(t=>t.delay>=1000&&t.delay<=3000&&!t.cancelled);assert.ok(timer);x.setClock(1000+timer.delay);timer.fn();await wait();
  const request=new Uint8Array(x.sent[0]);assert.ok(Buffer.from(request).includes(Buffer.from([8,op])));
  const hule=action(2,'ActionHule',fld(1,num(4,1)));
  x.ws.dispatchEvent(new MessageEvent('message',{data:hule.buffer}));await wait();
  assert.ok(x.find(x.shadow,'Auto status: confirmed'));assert.equal(x.checkbox().checked,true);
 }
});

test('turning the switch off and on cannot submit a second action for a decision already sent',async()=>{
 const x=setup(),wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'});emit({kind:'seat',id:'1',seat:0});await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});x.checkbox().checked=true;x.checkbox().handlers.change();
 x.ws.dispatchEvent(new MessageEvent('message',{data:action(1,'ActionDealTile',fld(2,enc.encode('1s'))).buffer}));await wait();
 const advice={type:'dahai',actor:0,source:'model',pai:'1s',frame_serial:1,
  opportunity:{seat:0,step:1,source:'ActionDealTile',time_fixed:10000,time_add:0,hand:['1s'],operations:[{type:1,combination:[]}]}};
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:advice});
 const timer=x.timers.find(t=>t.delay>=1000&&t.delay<=3000&&!t.cancelled);x.setClock(1000+timer.delay);timer.fn();await wait();assert.equal(x.sent.length,1);
 x.checkbox().checked=false;x.checkbox().handlers.change();x.checkbox().checked=true;x.checkbox().handlers.change();
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:advice});
 for(const t of x.timers.filter(t=>t!==timer&&!t.cancelled&&t.delay>=1000&&t.delay<=3000)){x.setClock(x.clock()+t.delay);t.fn()}
 await wait();assert.equal(x.sent.length,1);
});

test('server rejection leaves the checkbox enabled and a later decision can proceed',async()=>{
 const x=setup(),wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'});emit({kind:'seat',id:'1',seat:0});await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});x.checkbox().checked=true;x.checkbox().handlers.change();
 async function turn(step,serial,tile){
  x.ws.dispatchEvent(new MessageEvent('message',{data:action(step,'ActionDealTile',fld(2,enc.encode(tile))).buffer}));await wait();
  x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',actor:0,source:'model',pai:tile,frame_serial:serial,
   opportunity:{seat:0,step,source:'ActionDealTile',time_fixed:10000,time_add:0,hand:[tile],operations:[{type:1,combination:[]}]}}});
  const t=x.timers.filter(t=>t.delay>=1000&&t.delay<=3000&&!t.cancelled).at(-1);x.setClock(x.clock()+t.delay);t.fn();await wait();
 }
 await turn(1,1,'1s');const first=new Uint8Array(x.sent[0]),id=first[1]|first[2]<<8;
 x.ws.dispatchEvent(new MessageEvent('message',{data:new Uint8Array([3,id&255,id>>8,...fld(2,fld(1,num(1,7)))]).buffer}));await wait();
 assert.equal(x.checkbox().checked,true);assert.ok(x.find(x.shadow,'Auto status: rejected'));
 await turn(2,2,'2s');assert.equal(x.sent.length,2);assert.equal(x.checkbox().checked,true);
});

for (const scenario of ['first click', 'second click', 'cancelled']) {
test(`highlighted discard fallback: ${scenario}`, async()=>{
 const x=setup(),wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'});emit({kind:'seat',id:'1',seat:0});await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});x.checkbox().checked=true;x.checkbox().handlers.change();
 x.setFallbackTarget({x:321,y:654});
 x.ws.dispatchEvent(new MessageEvent('message',{data:action(1,'ActionDealTile',fld(2,enc.encode('1s'))).buffer}));await wait();
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',actor:0,source:'model',pai:'1s',hand_index:0,hand_count:14,frame_serial:1,
  opportunity:{seat:0,step:1,source:'ActionDealTile',time_fixed:10000,time_add:0,hand:['1s'],operations:[{type:1,combination:[]}]}}});
 const timer=x.timers.find(t=>t.delay>=1000&&t.delay<=3000&&!t.cancelled);x.setClock(x.clock()+timer.delay);timer.fn();await wait();
 assert.equal(x.sent.length,1);const watchdog=x.timers.at(-1);assert.ok(watchdog.delay<=1500);
 x.setClock(x.clock()+watchdog.delay);watchdog.fn();
 const begin=x.port.sent.at(-1);assert.equal(begin.kind,'fallback_begin');
 // Browser attachment can shift viewport geometry. Re-read the mark before input.
 x.setFallbackTarget({x:325,y:656});
 x.port.onMessage.fire({...begin,kind:'fallback_ready'});
 const point=x.port.sent.at(-1);assert.equal(point.kind,'fallback_target');
 assert.equal(point.x,325);assert.equal(point.y,656);
 x.port.onMessage.fire({...begin,kind:'fallback_result',state:'clicked'});
 assert.ok(x.find(x.shadow,'Auto status: fallback_click'));
 const second = x.timers.at(-1);
 assert.equal(second.delay,220);
 if (scenario === 'cancelled') {
   x.checkbox().checked=false;x.checkbox().handlers.change();
   second.fn();
   assert.equal(x.port.sent.filter(m=>m.kind==='fallback_begin').length,1);
   assert.ok(x.find(x.shadow,'Auto status: off'));
   return;
 }
 if (scenario === 'second click') {
   x.setClock(x.clock()+second.delay);second.fn();
   const retry=x.port.sent.at(-1);
   assert.equal(retry.kind,'fallback_begin');assert.notEqual(retry.token,begin.token);
   x.port.onMessage.fire({...retry,kind:'fallback_ready'});
   assert.equal(x.port.sent.at(-1).kind,'fallback_target');
   x.port.onMessage.fire({...retry,kind:'fallback_result',state:'clicked'});
 }
 const native=x.context.MjaiTransport.encodeRequest(41,{method:'inputOperation',type:1,tile:'1s'},1);
 x.ws.send(native);
 await wait();
 assert.ok(x.find(x.shadow,'Auto status: fallback_submitted'));
 if (scenario === 'first click') {
   second.fn();
   assert.equal(x.port.sent.filter(m=>m.kind==='fallback_begin').length,1);
 }
 x.ws.dispatchEvent(new MessageEvent('message',{data:action(2,'ActionDiscardTile',fld(2,enc.encode('1s'))).buffer}));await wait();
 assert.ok(x.find(x.shadow,'Auto status: fallback_confirmed'));assert.equal(x.checkbox().checked,true);
});
}

test('already-expired suggestion tries the visible highlight once; disabling blocks the watchdog',async()=>{
 const x=setup(),wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'});emit({kind:'seat',id:'1',seat:0});await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});x.checkbox().checked=true;x.checkbox().handlers.change();
 x.setFallbackTarget({x:10,y:20});
 x.ws.dispatchEvent(new MessageEvent('message',{data:action(1,'ActionDealTile',fld(2,enc.encode('1s'))).buffer}));await wait();
 x.setClock(7000);
 const advice={type:'dahai',actor:0,source:'model',pai:'1s',hand_index:0,hand_count:14,frame_serial:1,
  opportunity:{seat:0,step:1,source:'ActionDealTile',time_fixed:5000,time_add:0,hand:['1s'],operations:[{type:1,combination:[]}]}};
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:advice});
 const begin=x.port.sent.at(-1);assert.equal(begin.kind,'fallback_begin');assert.equal(x.sent.length,0);
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:advice});
 assert.equal(x.port.sent.filter(m=>m.kind==='fallback_begin').length,1);
 const pending=x.timers.at(-1);x.checkbox().checked=false;x.checkbox().handlers.change();pending.fn();
 x.port.onMessage.fire({...begin,kind:'fallback_ready'});
 assert.ok(x.find(x.shadow,'Auto status: off'));
 assert.equal(x.port.sent.some(m=>m.kind==='fallback_target'),false);
 assert.equal(x.port.sent.at(-1).kind,'fallback_cancel');
});

test('confirmation timeout without an actual visible target reports fallback unavailable',async()=>{
 const x=setup(),wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'});emit({kind:'seat',id:'1',seat:0});await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});x.checkbox().checked=true;x.checkbox().handlers.change();
 x.ws.dispatchEvent(new MessageEvent('message',{data:action(1,'ActionDealTile',fld(2,enc.encode('1s'))).buffer}));await wait();
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',actor:0,source:'model',pai:'1s',frame_serial:1,
  opportunity:{seat:0,step:1,source:'ActionDealTile',time_fixed:6000,time_add:0,hand:['1s'],operations:[{type:1,combination:[]}]}}});
 const timer=x.timers.find(t=>t.delay>=1000&&t.delay<=3000&&!t.cancelled);x.setClock(x.clock()+timer.delay);timer.fn();await wait();
 x.timers.at(-1).fn();assert.ok(x.find(x.shadow,'Auto status: fallback_unavailable'));assert.equal(x.checkbox().checked,true);
});

test('a native discard consumes the decision before a late model recommendation',async()=>{
 const x=setup(),wait=async()=>{await new Promise(r=>setTimeout(r,12))};
 const emit=data=>x.window.postMessage({channel:'majsoul-hud-v1',...data},x.location.origin);
 emit({kind:'open',id:'1'});emit({kind:'seat',id:'1',seat:0});await wait();
 x.port.onMessage.fire({kind:'connection',id:'1',state:'connected'});
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 x.port.onMessage.fire({kind:'connection',id:'1',state:'ready'});
 x.checkbox().checked=true;x.checkbox().handlers.change();
 x.ws.dispatchEvent(new MessageEvent('message',{data:action(1,'ActionDealTile',fld(2,enc.encode('1s'))).buffer}));await wait();
 x.ws.send(x.context.MjaiTransport.encodeRequest(41,{method:'inputOperation',type:1,tile:'1s'},1));
 await wait();
 x.port.onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',actor:0,source:'model',pai:'1s',frame_serial:1,
  opportunity:{seat:0,step:1,source:'ActionDealTile',time_fixed:5000,time_add:0,hand:['1s'],operations:[{type:1,combination:[]}]}}});
 assert.equal(x.timers.filter(t=>!t.cancelled&&t.delay>=1000&&t.delay<=3000).length,0);
 assert.equal(x.sent.length,1);
});
