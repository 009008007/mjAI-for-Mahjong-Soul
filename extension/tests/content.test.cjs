const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function hooks(){return {fns:[],addListener(fn){this.fns.push(fn)},fire(v){for(const f of this.fns)f(v)}}}
test('replays the retained round after bridge and service worker reconnect',()=>{
 const ports=[], timers=[],listeners={};
 const win={addEventListener(type,fn){listeners[type]=fn}};
 const document={documentElement:{append(){}},createElement(){return {style:{},attachShadow(){return {append(){}}},append(){},set textContent(v){},set className(v){}}}};
 const chrome={runtime:{connect(){const p={onMessage:hooks(),onDisconnect:hooks(),sent:[],postMessage(v){this.sent.push(v)}};ports.push(p);return p}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),{window:win,document,chrome,location:{origin:'https://game.maj-soul.com'},Uint8Array,ArrayBuffer,Object,Number,btoa,MutationObserver:class{},setTimeout:fn=>timers.push(fn)});
 function page(data){listeners.message({source:win,origin:'https://game.maj-soul.com',data:{channel:'majsoul-hud-v1',...data}})}
 function frame(name,round=false){page({kind:'frame',id:'1',buffer:new TextEncoder().encode(name).buffer,newRound:round})}
 page({kind:'open',id:'1'}); page({kind:'seat',id:'1',seat:2}); frame('start',true); frame('discard');
 ports[0].onMessage.fire({kind:'connection',id:'1',state:'connected'});
 assert.deepEqual(ports[0].sent.map(x=>x.kind),['open','replay-start','policy','seat','frame','frame','replay-end']);
 assert.equal(atob(ports[0].sent[4].data),'start');
 ports[0].onMessage.fire({kind:'connection',id:'1',state:'disconnected'}); frame('missed-on-bridge');
 ports[0].onMessage.fire({kind:'connection',id:'1',state:'connected'});
 assert.deepEqual(ports[0].sent.slice(-7).map(x=>x.kind),['replay-start','policy','seat','frame','frame','frame','replay-end']);
 assert.equal(atob(ports[0].sent.at(-2).data),'missed-on-bridge');
 ports[0].onDisconnect.fire(); frame('while-worker-down'); timers.shift()();
 ports[1].onMessage.fire({kind:'connection',id:'1',state:'connected'});
 assert.equal(atob(ports[1].sent.at(-2).data),'while-worker-down');
 frame('new-round',true); ports[1].onMessage.fire({kind:'connection',id:'1',state:'disconnected'});
 ports[1].onMessage.fire({kind:'connection',id:'1',state:'connected'});
 assert.equal(atob(ports[1].sent.at(-2).data),'new-round');
 assert.equal(ports[1].sent.at(-3).kind,'seat');
 // A new round arriving between a restore request and its response must not erase the request.
 page({kind:'frame',id:'1',buffer:new TextEncoder().encode('restore-request').buffer,restoreRequest:17});
 frame('next-round',true);
 page({kind:'frame',id:'1',buffer:new TextEncoder().encode('restore-response').buffer,restoreResponse:17});
 ports[1].onMessage.fire({kind:'connection',id:'1',state:'disconnected'});
 ports[1].onMessage.fire({kind:'connection',id:'1',state:'connected'});
 assert.deepEqual(ports[1].sent.slice(-4,-1).map(x=>atob(x.data)),['restore-request','next-round','restore-response']);
 // Seat discovered after an initial replay must rebuild from the journal.
 page({kind:'seat',id:'1',seat:3});
 assert.equal(ports[1].sent.at(-1).kind,'restart');
 ports[1].onMessage.fire({kind:'connection',id:'1',state:'connected'});
 assert.equal(ports[1].sent.slice(-6).find(x=>x.kind==='seat').seat,3);
 // Only one automatic repair is attempted for a journal that stays broken.
 ports[1].onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'desynchronized'}});
 assert.equal(ports[1].sent.at(-1).kind,'restart');
 const count=ports[1].sent.length;
 ports[1].onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'desynchronized'}});
 assert.equal(ports[1].sent.length,count);
});

test('tells the user to reload when Chrome invalidates an old extension context',()=>{
 const timers=[], written=[];
 const win={addEventListener(){}};
 const document={documentElement:{append(){}},createElement(){return {style:{},attachShadow(){return {append(){}}},append(){},set textContent(v){written.push(v)},set className(v){}}}};
 const first={onMessage:hooks(),onDisconnect:hooks(),postMessage(){}};
 let count=0;
 const chrome={runtime:{connect(){if(count++ === 0)return first; throw Error('Extension context invalidated.')}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),{window:win,document,chrome,location:{origin:'https://game.maj-soul.com'},Uint8Array,ArrayBuffer,Object,Number,btoa,MutationObserver:class{},setTimeout:fn=>timers.push(fn)});
 first.onDisconnect.fire();
 timers.shift()();
 assert.ok(written.includes('Extension updated or unavailable; reload this game tab'));
 assert.equal(timers.length,0);
});

test('propagates policy to all connections and ignores stale recommendations until the latest acknowledgement',()=>{
 const ports=[],listeners={},written=[],marks=[]; let changePolicy;
 const win={addEventListener(type,fn){listeners[type]=fn}};
 const document={documentElement:{append(){}},createElement(){return {style:{},attachShadow(){return {append(){}}},append(){},set textContent(v){written.push(v)},set className(v){}}}};
 const chrome={runtime:{connect(){const p={onMessage:hooks(),onDisconnect:hooks(),sent:[],postMessage(v){this.sent.push(v)}};ports.push(p);return p}}};
 const MajsoulPolicyUI={create(_card,cb){changePolicy=cb}};
 const MajsoulHighlight={create(){return {show(v){marks.push(v)},clear(){}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),{window:win,document,chrome,MajsoulPolicyUI,MajsoulHighlight,location:{origin:'https://game.maj-soul.com'},Uint8Array,ArrayBuffer,Object,Number,btoa,MutationObserver:class{},setTimeout(){}});
 function page(data){listeners.message({source:win,origin:'https://game.maj-soul.com',data:{channel:'majsoul-hud-v1',...data}})}
 for(const id of ['1','2']){ page({kind:'open',id});ports[0].onMessage.fire({kind:'connection',id,state:'connected'}); }
 for(const id of ['1','2'])ports[0].onMessage.fire({kind:'suggestion',id,data:{type:'status',status:'policy_updated',revision:0}});
 changePolicy({style:'CallManiac',intensity:1.5});
 assert.deepEqual(ports[0].sent.filter(x=>x.kind==='policy').slice(-2).map(x=>x.id),['1','2']);
 const before=marks.length;
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',pai:'1m'}});
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',pai:'2m'}});
 assert.equal(marks.length,before);
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:1}});
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',pai:'3m'}});
 assert.equal(marks.at(-1).pai,'3m');
 // Second connection still awaits its own acknowledgement.
 ports[0].onMessage.fire({kind:'suggestion',id:'2',data:{type:'dahai',pai:'4m'}});
 assert.equal(marks.at(-1).pai,'3m');
});

test('display choices re-render the current advice and clear it on disconnect',()=>{
 const ports=[],listeners={},marks=[],written=[]; let displayChange;
 const win={addEventListener(type,fn){listeners[type]=fn}};
 const document={documentElement:{append(){}},createElement(){return {style:{},attachShadow(){return {append(){}}},append(){},set textContent(v){written.push(v)},set className(v){}}}};
 const chrome={runtime:{connect(){const p={onMessage:hooks(),onDisconnect:hooks(),sent:[],postMessage(v){this.sent.push(v)}};ports.push(p);return p}}};
 const MajsoulDisplaySettings={create(_card,cb){displayChange=cb}};
 const MajsoulHighlight={create(){return {show(v,s){marks.push({v,s})},clear(){marks.push('clear')}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),{window:win,document,chrome,MajsoulDisplaySettings,MajsoulHighlight,location:{origin:'https://game.maj-soul.com'},Uint8Array,ArrayBuffer,Object,Number,Set,btoa,MutationObserver:class{},setTimeout(){}});
 listeners.message({source:win,origin:'https://game.maj-soul.com',data:{channel:'majsoul-hud-v1',kind:'open',id:'1'}});
 ports[0].onMessage.fire({kind:'connection',id:'1',state:'connected'});
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'status',status:'policy_updated',revision:0}});
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',pai:'5m',hand_index:0,hand_count:14,danger_tiles:[{pai:'5m',hand_index:0,threat:3,reason:'unsuji'}]}});
 displayChange({best:false,danger:true,theme:'white'});
 assert.equal(marks.at(-1).s.danger,true); assert.ok(written.some(x=>String(x).includes('上家立直')));
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'reach',riichi_threats:0,danger_tiles:[]}});
 assert.ok(written.some(x=>String(x).includes('尚無對手立直')));
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{
  type:'dahai',risk_scope:'all',riichi_threats:0,
  danger_tiles:[{pai:'5m',hand_index:0,threat:3,reason:'unsuji',threat_type:'open',level:'medium'}]
 }});
 assert.ok(String(written.at(-1)).includes('上家多副露'));
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'dahai',riichi_threats:1,danger_tiles:[]}});
 assert.ok(written.some(x=>String(x).includes('未達提示門檻')));
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'reach',riichi_discard:'5sr'}});
 assert.ok(String(written.at(-1)).includes('Riichi discard: 5sr'));
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'chi',pai:'3s',consumed:['1s','2s']}});
 assert.equal(written.at(-1),'Chi 123 Bamboo\nUse: 1s 2s');
 ports[0].onMessage.fire({kind:'suggestion',id:'1',data:{type:'chi',pai:'3s',consumed:['5sr','4s'],chi_hand_indices:[9,8],hand_count:13}});
 assert.equal(written.at(-1),'Chi 345 Bamboo (red five)\nUse: 5sr 4s');
 assert.equal(marks.at(-1).v.chi_hand_indices.length,2);
 ports[0].onMessage.fire({kind:'connection',id:'1',state:'disconnected'});
 assert.equal(marks.at(-1),'clear');
 displayChange({best:true,danger:true,theme:'pastel'});
 assert.equal(marks.at(-1),'clear');
});
