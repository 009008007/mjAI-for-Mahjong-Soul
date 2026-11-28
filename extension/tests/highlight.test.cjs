const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const ctx={}; vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../highlight.js'),'utf8'),ctx);
const {rectFor}=ctx.MajsoulHighlight;
const canvas={left:100,top:50,width:1600,height:900};
const center=r=>({x:r.left+r.width/2,y:r.top+r.height/2});
test('places the first and drawn tile on the known canvas grid',()=>{
 const first=rectFor({type:'dahai',hand_count:14,hand_index:0},canvas);
 const drawn=rectFor({type:'dahai',hand_count:14,hand_index:13,drawn_index:13},canvas);
 assert.ok(first && drawn);
 assert.ok(Math.abs(center(first).x-(100+1600*.142))<.01);
 assert.ok(Math.abs(center(drawn).x-(100+1600*(.142+13*.0496+.016)))<.01);
 assert.ok(Math.abs(center(first).y-(50+900*.93))<.01);
});
test('refuses unverified tile positions and supports right-to-left action slots',()=>{
 assert.equal(rectFor({type:'dahai',pai:'1p'},canvas),null);
 assert.equal(rectFor({type:'dahai',hand_count:10,hand_index:0},canvas),null);
 assert.equal(rectFor({type:'dahai',hand_count:11,hand_index:10,drawn_index:8},canvas),null);
 const shortDraw=rectFor({type:'dahai',hand_count:11,hand_index:10,drawn_index:10},canvas);
 const afterCall=rectFor({type:'dahai',hand_count:11,hand_index:10},canvas);
 assert.ok(Math.abs(center(shortDraw).x-center(afterCall).x - 1600*.016)<.01);
 assert.equal(rectFor({type:'dahai',hand_count:14,hand_index:14},canvas),null);
 assert.equal(rectFor({type:'reach'},canvas),null);
 const pass=rectFor({type:'none',button_index:0,button_count:4},canvas);
 const call=rectFor({type:'pon',button_index:1,button_count:4},canvas);
 const upper=rectFor({type:'hora',button_index:3,button_count:4},canvas);
 assert.ok(pass && call && upper);
 assert.ok(center(pass).x>center(call).x);
 assert.ok(center(pass).y>center(upper).y);
});

test('renders a passive outline, hides stale suggestions, and follows canvas movement',()=>{
 class Element {
  constructor(tag) { this.tagName=tag; this.style={}; this.children=[]; this.listeners={}; this.value=''; }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(name,fn) { this.listeners[name]=fn; }
  remove() { this.removed=true; }
 }
 let viewport={left:100,top:50,right:1700,bottom:950,width:1600,height:900};
 const canvasEl={getBoundingClientRect:()=>viewport};
 const doc={documentElement:new Element('html'),createElement:tag=>new Element(tag),querySelectorAll:()=>[canvasEl],addEventListener(){}};
 const window={innerWidth:1920,innerHeight:1080,getComputedStyle:()=>({display:'block',visibility:'visible'}),addEventListener(){}};
 const context={document:doc,window,chrome:{storage:{local:{get(key,cb){cb({})},set(){}}}},setInterval:()=>7,clearInterval(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../highlight.js'),'utf8'),context);
 const hud=context.MajsoulHighlight.create(new Element('div'));
 const outline=doc.documentElement.children[0];
 hud.show({type:'dahai',hand_count:14,hand_index:0,drawn_index:13});
 assert.equal(outline.style.display,'block');
 assert.equal(outline.style.pointerEvents,'none');
 const before=parseFloat(outline.style.left);
 viewport={...viewport,left:200,right:1800};
 hud.show({type:'dahai',hand_count:14,hand_index:0,drawn_index:13});
 assert.equal(parseFloat(outline.style.left)-before,100);
 hud.clear(); assert.equal(outline.style.display,'none');
 hud.show({type:'reach'}); assert.equal(outline.style.display,'none');
 hud.destroy(); assert.equal(outline.removed,true);
});

test('renders independent red and green marks and resolves overlapping recommendations',()=>{
 class Element { constructor(){this.style={};this.children=[];this.listeners={};} append(...n){this.children.push(...n)} addEventListener(k,f){this.listeners[k]=f} remove(){} }
 const canvas={getBoundingClientRect:()=>({left:0,top:0,right:1600,bottom:900,width:1600,height:900})};
 const document={documentElement:new Element(),createElement:()=>new Element(),querySelectorAll:()=>[canvas],addEventListener(){}};
 const window={innerWidth:1920,innerHeight:1080,getComputedStyle:()=>({display:'block',visibility:'visible'}),addEventListener(){}};
 const context={document,window,chrome:{storage:{local:{get(_,cb){cb({})},set(){}}}},setInterval:()=>1,clearInterval(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../highlight.js'),'utf8'),context);
 const hud=context.MajsoulHighlight.create(new Element());
 const value={type:'dahai',hand_count:14,hand_index:0,drawn_index:13,danger_tiles:[{hand_index:0,level:'high'},{hand_index:13,level:'medium'}]};
 hud.show(value,{best:true,danger:true});
 assert.equal(document.documentElement.children[0].textContent,'⚠');
 assert.equal(document.documentElement.children[1].style.display,'block');
 assert.equal(document.documentElement.children[1].style.borderColor,'#ff9d28');
 hud.show(value,{best:false,danger:true});
 assert.equal(document.documentElement.children[0].style.display,'none');
 assert.equal(document.documentElement.children[1].style.display,'block');
 assert.equal(document.documentElement.children[1].style.borderColor,'#f04444');
 assert.equal(document.documentElement.children[2].style.display,'block');
 hud.show(value,{best:true,danger:false});
 assert.equal(document.documentElement.children[0].style.display,'block');
 assert.equal(document.documentElement.children[1].style.display,'none');
 hud.show(value,{best:false,danger:false});
 assert.equal(document.documentElement.children[0].style.display,'none');
 hud.clear(); assert.equal(document.documentElement.children[2].style.display,'none');
});

test('marks only the two tiles in the recommended chi and hides stale or invalid marks',()=>{
 class Element {
  constructor(){this.style={};this.children=[];this.listeners={};}
  append(...nodes){this.children.push(...nodes);}
  addEventListener(name,fn){this.listeners[name]=fn;}
  remove(){this.removed=true;}
 }
 const canvasEl={getBoundingClientRect:()=>({...canvas,right:1700,bottom:950})};
 const document={documentElement:new Element(),createElement:()=>new Element(),querySelectorAll:()=>[canvasEl],addEventListener(){}};
 const window={innerWidth:1920,innerHeight:1080,getComputedStyle:()=>({display:'block',visibility:'visible'}),addEventListener(){}};
 const context={document,window,chrome:{storage:{local:{get(_,cb){cb({})},set(){}}}},setInterval:()=>1,clearInterval(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../highlight.js'),'utf8'),context);
 const hud=context.MajsoulHighlight.create(new Element());
 const chi={type:'chi',button_index:1,button_count:2,hand_count:13,chi_hand_indices:[8,9]};
 hud.show(chi);
 const [button, first, second]=document.documentElement.children;
 assert.equal(button.style.display,'block');
 assert.equal(first.style.pointerEvents,'none');
 assert.equal(first.style.display,'block');
 assert.equal(second.style.display,'block');
 const previous=parseFloat(first.style.left);
 hud.show({...chi,chi_hand_indices:[6,7]});
 assert.ok(parseFloat(first.style.left)<previous);
 for(const indices of [[6,6],[6,13],[6,null],undefined]){
  hud.show({...chi,chi_hand_indices:indices});
  assert.equal(first.style.display,'none');
  assert.equal(second.style.display,'none');
 }
 hud.show(chi,{best:false});
 assert.equal(first.style.display,'none');
 hud.show({...chi,hand_count:10},{best:true});
 assert.equal(first.style.display,'block');
 hud.show({type:'none',button_index:0,button_count:2});
 assert.equal(first.style.display,'none');
 hud.show(chi);
 hud.clear();
 assert.equal(first.style.display,'none');
 assert.equal(second.style.display,'none');
 hud.destroy();
 assert.equal(first.removed,true);
 assert.equal(second.removed,true);
});

test('fallback target is the visible current green mark on the unobstructed game canvas',()=>{
 class Element{constructor(){this.style={};this.children=[];this.listeners={}} append(...n){this.children.push(...n)} addEventListener(k,f){this.listeners[k]=f} remove(){}}
 const canvas={getBoundingClientRect:()=>({left:0,top:0,right:1600,bottom:900,width:1600,height:900})};let atPoint=canvas;
 const document={documentElement:new Element(),createElement:()=>new Element(),querySelectorAll:()=>[canvas],elementFromPoint:()=>atPoint,addEventListener(){}};
 const window={innerWidth:1920,innerHeight:1080,getComputedStyle:()=>({display:'block',visibility:'visible'}),addEventListener(){}};
 const context={document,window,chrome:{storage:{local:{get(_,cb){cb({})},set(){}}}},setInterval:()=>1,clearInterval(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../highlight.js'),'utf8'),context);
 const hud=context.MajsoulHighlight.create(new Element());
 const choice={type:'dahai',hand_count:14,hand_index:2,drawn_index:13};hud.show(choice,{best:true});
 const target=hud.fallbackTarget(choice);assert.equal(target.canvas,canvas);
 assert.ok(Math.abs(target.x-(.142+2*.0496)*1600)<.01);assert.ok(Math.abs(target.y-(.93-.14*.1)*900)<.01);
 assert.equal(hud.fallbackTarget({...choice}),null);
 atPoint={};assert.equal(hud.fallbackTarget(choice),null);atPoint=canvas;
 hud.show(choice,{best:false});assert.equal(hud.fallbackTarget(choice),null);
 hud.show({type:'chi',button_index:1,button_count:2},{best:true});assert.equal(hud.fallbackTarget(choice),null);
 hud.clear();assert.equal(hud.fallbackTarget(choice),null);
});
