const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
test('replays before live updates and suppresses old suggestions until barrier', () => {
 let listener; const sockets=[], messages=[];
 const hooks=()=>({listeners:[],addListener(fn){this.listeners.push(fn)},fire(value){for(const fn of this.listeners)fn(value)}});
 const port={name:'majsoul-hud-v1',sender:{tab:{id:1},frameId:0},onMessage:hooks(),onDisconnect:hooks(),postMessage(x){messages.push(x)},disconnect(){throw Error('unexpected disconnect')}};
 class WS { static OPEN=1; constructor(url){this.readyState=0;this.bufferedAmount=0;this.sent=[];sockets.push(this)} open(){this.readyState=1;this.onopen()} send(data){this.sent.push(data)} close(){this.readyState=3;this.onclose?.()} }
 const chrome={runtime:{onConnect:{addListener(fn){listener=fn}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{chrome,WebSocket:WS,Uint8Array,atob,setTimeout,clearTimeout,setInterval:()=>1,clearInterval});
 listener(port); port.onMessage.fire({kind:'open',id:'1'}); sockets[0].open();
 port.onMessage.fire({kind:'frame',id:'1',data:btoa('ignored before replay')});
 port.onMessage.fire({kind:'replay-start',id:'1'});
 port.onMessage.fire({kind:'policy',id:'1',style:'CallManiac',intensity:1.5,revision:2});
 port.onMessage.fire({kind:'seat',id:'1',seat:2});
 port.onMessage.fire({kind:'frame',id:'1',data:btoa('history')});
 port.onMessage.fire({kind:'replay-end',id:'1'});
 sockets[0].onmessage({data:JSON.stringify({type:'dahai',pai:'1m'})});
 assert.equal(messages.filter(x=>x.kind==='suggestion').length,0);
 sockets[0].onmessage({data:JSON.stringify({type:'status',status:'replay_complete'})});
 sockets[0].onmessage({data:JSON.stringify({type:'dahai',pai:'2m'})});
 assert.equal(messages.filter(x=>x.kind==='suggestion').length,2);
 assert.equal(messages.filter(x=>x.kind==='suggestion')[0].data.pai,'1m');
 assert.equal(sockets[0].sent[0],'{"type":"policy","style":"CallManiac","intensity":1.5,"revision":2}');
 assert.equal(sockets[0].sent[1],'{"type":"seat","seat":2}');
 assert.equal(Buffer.from(sockets[0].sent[2]).toString(),'history');
 assert.equal(sockets[0].sent[3],'{"type":"replay_end"}');
 port.onDisconnect.fire();
});

test('forwards policy acknowledgement during replay and drops the previous cached suggestion',()=>{
 let listener;const sockets=[],messages=[];
 const hooks=()=>({listeners:[],addListener(fn){this.listeners.push(fn)},fire(v){for(const fn of this.listeners)fn(v)}});
 const port={name:'majsoul-hud-v1',sender:{tab:{id:1},frameId:0},onMessage:hooks(),onDisconnect:hooks(),postMessage(x){messages.push(x)},disconnect(){}};
 class WS{static OPEN=1;constructor(){this.readyState=0;this.bufferedAmount=0;sockets.push(this)}open(){this.readyState=1;this.onopen()}send(){}close(){this.readyState=3;this.onclose?.()}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{chrome:{runtime:{onConnect:{addListener(fn){listener=fn}}}},WebSocket:WS,Uint8Array,atob,setTimeout,clearTimeout,setInterval:()=>1,clearInterval});
 listener(port);port.onMessage.fire({kind:'open',id:'1'});sockets[0].open();port.onMessage.fire({kind:'replay-start',id:'1'});
 sockets[0].onmessage({data:JSON.stringify({type:'dahai',pai:'1m'})});
 sockets[0].onmessage({data:JSON.stringify({type:'status',status:'policy_updated',style:'SuperTurtle',intensity:1,revision:3})});
 assert.equal(messages.at(-1).data.status,'policy_updated');
 sockets[0].onmessage({data:JSON.stringify({type:'status',status:'replay_complete'})});
 assert.equal(messages.filter(x=>x.kind==='suggestion' && x.data.type==='dahai').length,0);
 port.onDisconnect.fire();
});
