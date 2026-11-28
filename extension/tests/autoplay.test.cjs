'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
const ctx=vm.createContext({TextEncoder,Uint8Array});
for(const f of ['autoplay.js','confirmation.js','transport.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
const {resolve,createController}=ctx.MjaiAutoplay, {confirm}=ctx.MjaiConfirmation;
function value(input){return input && JSON.parse(JSON.stringify(input))}
test('maps exact chi and pon options including red tiles',()=>{
 const options={seat:0,called:'4s',callSource:'discard',operations:[{type:2,combination:['2s|3s','3s|5s','3s|0s','5s|6s','0s|6s']}]};
 assert.deepEqual(value(resolve(options,{actor:0,source:'model',type:'chi',pai:'4s',consumed:['3s','5sr']})),{method:'inputChiPengGang',type:2,index:2});
 assert.equal(resolve({...options,called:'3s'},{actor:0,source:'model',type:'chi',pai:'4s',consumed:['3s','5sr']}),null);
 const pon={seat:0,called:'5s',callSource:'discard',operations:[{type:3,combination:['5s|5s','5s|0s']}]};
 assert.deepEqual(value(resolve(pon,{actor:0,source:'model',type:'pon',pai:'5s',consumed:['5s','5sr']})),{method:'inputChiPengGang',type:3,index:1});
});
test('selects exact kan tiles and refuses forbidden discards',()=>{
 const snapshot={seat:0,operations:[{type:4,combination:['5s|5s|5s|0s']},{type:1,combination:['2m']}],hand:['2m','1m']};
 assert.deepEqual(value(resolve(snapshot,{type:'ankan',actor:0,source:'model',consumed:['5s','5s','5s','5sr']})),{method:'inputChiPengGang',type:4,index:0});
 assert.equal(resolve(snapshot,{type:'dahai',actor:0,source:'model',pai:'2m'}),null);
 assert.equal(confirm(snapshot,{method:'inputChiPengGang',type:4,index:0},{type:'ActionAnGangAddGang',seat:0,meldType:3,tile:'5s'}),'match');
});
test('never sends after user takes back control or a timer fires early',()=>{
 let task, sends=0, time=1000;
 const bot=createController({now:()=>time,random:()=>0,schedule:fn=>(task=fn,1),cancel:()=>{},send:()=>{sends++;return 1},status:()=>{}});
 const snapshot={seat:0,key:'a',openedAt:1000,deadline:6000,operations:[{type:1,combination:[]}],hand:['1s']};
 const advice={type:'dahai',actor:0,source:'model',pai:'1s'};
 bot.start();bot.offer(snapshot,advice);const old=task;bot.stop('off');time=2000;old();assert.equal(sends,0);
 bot.start();time=1000;bot.offer(snapshot,advice);task();assert.equal(sends,0);
});

test('slow inference still waits 1–3 seconds and a missed decision leaves autoplay enabled',()=>{
 let time=3500, tasks=[], sends=0, states=[];
 const bot=createController({now:()=>time,random:()=>0,schedule:(fn,delay)=>{const t={fn,delay};tasks.push(t);return t},cancel:t=>{t.cancelled=true},send:()=>++sends,status:s=>states.push(s)});
 const snapshot={seat:0,key:'a',openedAt:1000,deadline:10000,operations:[{type:1,combination:[]}],hand:['1s']};
 const advice={type:'dahai',actor:0,source:'model',pai:'1s'};
 bot.start();bot.offer(snapshot,advice);assert.equal(tasks.at(-1).delay,1000);
 time=4500;tasks.at(-1).fn();assert.equal(sends,1);
 bot.observed('a',true);assert.equal(states.at(-1),'confirmed');
 time=9800;bot.offer({...snapshot,key:'b'},advice);assert.equal(states.at(-1),'missed');
 time=11000;bot.offer({...snapshot,key:'c',openedAt:11000,deadline:16000},advice);
 assert.equal(states.at(-1),'scheduled');time=12000;tasks.at(-1).fn();assert.equal(sends,2);
});

test('stale callback cannot disable a later session and timer jitter cannot send expired actions',()=>{
 let time=1000,tasks=[],sends=0,states=[];
 const bot=createController({now:()=>time,random:()=>0,schedule:(fn,delay)=>{let t={fn,delay};tasks.push(t);return t},cancel:t=>{t.cancelled=true},send:()=>++sends,status:s=>states.push(s)});
 const snapshot={seat:0,key:'a',openedAt:1000,deadline:10000,operations:[{type:1}],hand:['1s']};
 const advice={type:'dahai',actor:0,source:'model',pai:'1s'};
 bot.start();bot.offer(snapshot,advice);const old=tasks.at(-1);bot.stop('off');bot.start();bot.offer(snapshot,advice);
 const current=tasks.at(-1);time=2000;old.fn();assert.equal(states.at(-1),'scheduled');current.fn();assert.equal(sends,1);
 bot.observed('a',true);time=3000;bot.offer({...snapshot,key:'b'},advice);time=9800;tasks.at(-1).fn();
 assert.equal(sends,1);assert.equal(states.at(-1),'missed');
 bot.offer({...snapshot,key:'c',openedAt:9800,deadline:15000},advice);assert.equal(states.at(-1),'scheduled');
});

test('unknown response waits for an exact event; explicit error still stops',()=>{
 let time=1000,tasks=[],states=[];
 const bot=createController({now:()=>time,random:()=>0,schedule:(fn,delay)=>{let t={fn,delay};tasks.push(t);return t},cancel:t=>{t.cancelled=true},send:()=>1,status:s=>states.push(s)});
 const snapshot={seat:0,key:'a',openedAt:1000,deadline:10000,operations:[{type:1}],hand:['1s']};
 const advice={type:'dahai',actor:0,source:'model',pai:'1s'};
 bot.start();bot.offer(snapshot,advice);time=2000;tasks.at(-1).fn();bot.response(1,null);
 assert.equal(states.at(-1),'response_unknown');bot.observed('a',true);assert.equal(states.at(-1),'confirmed');
 bot.offer({...snapshot,key:'b'},advice);time=3000;tasks.at(-1).fn();bot.response(1,{ok:false,code:7});assert.equal(states.at(-1),'rejected');
});

test('response decoder tolerates protobuf extensions without concealing actual errors',()=>{
 const parse=ctx.MjaiTransport.parseResponse;
 const frame=bytes=>new Uint8Array([3,7,0,...bytes]);
 assert.deepEqual(value(parse(frame([10,0,18,7,10,5,18,3,102,111,111]),7)),{ok:true,code:0});
 assert.deepEqual(value(parse(frame([18,9,10,7,8,7,18,3,102,111,111]),7)),{ok:false,code:7});
 assert.equal(parse(frame([18,2,10,8]),7),null);
});

test('chooses tsumo and ron from the offered operations despite stale model target',()=>{
 for(const [type,target] of [[8,2],[9,0]]) {
  const snapshot={seat:0,operations:[{type}]};
  assert.deepEqual(value(resolve(snapshot,{source:'model',type:'hora',actor:0,target})),{method:'inputOperation',type});
 }
 assert.equal(resolve({seat:0,operations:[{type:8},{type:9}]},{source:'model',type:'hora',actor:0,target:0}),null);
 assert.equal(resolve({seat:0,operations:[{type:1}]},{source:'model',type:'hora',actor:0,target:0}),null);
});

test('uses verified highlighted discard immediately when there is not enough time for one second',()=>{
 let time=9300,tasks=[],sent=[],states=[];
 const bot=createController({now:()=>time,random:()=>0,schedule:(fn,delay)=>{const t={fn,delay};tasks.push(t);return t},cancel:t=>{t.cancelled=true},send:(key,command)=>{sent.push({key,command});return 1},status:s=>states.push(s)});
 const snapshot={seat:0,key:'current',openedAt:1000,deadline:10000,operations:[{type:1,combination:[]}],hand:['1s','2s']};
 bot.start();bot.offer(snapshot,{source:'model',type:'dahai',actor:0,pai:'2s'});
 assert.equal(states.at(-1),'fallback');assert.equal(tasks.at(-1).delay,0);tasks.at(-1).fn();
 assert.deepEqual(value(sent[0]),{key:'current',command:{method:'inputOperation',type:1,tile:'2s',moqie:false}});
});
