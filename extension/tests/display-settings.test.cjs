const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'),vm=require('node:vm');
test('display options persist independently and ignore an old storage response',()=>{
 class Element {constructor(){this.style={};this.children=[];this.listeners={};this.value='';this.checked=false;} append(...items){this.children.push(...items)} addEventListener(event,cb){this.listeners[event]=cb} setAttribute(){}}
 const document={createElement:()=>new Element(),createTextNode:text=>({text})}; let load, saved, current;
 const chrome={storage:{local:{get(_,cb){load=cb},set(value){saved=value}}}};
 const ctx={document,chrome};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../display-settings.js'),'utf8'),ctx);
 const card=new Element();ctx.MajsoulDisplaySettings.create(card,value=>current=value);
 const wrap=card.children[0], best=wrap.children[0].children[0], danger=wrap.children[1].children[0], theme=wrap.children[2].children[0];
 best.checked=false;danger.checked=true;theme.value='pastel';danger.listeners.change();
 assert.equal(saved.hudDisplay.best,false); assert.equal(saved.hudDisplay.danger,true); assert.equal(saved.hudDisplay.theme,'pastel');
 load({hudDisplay:{best:true,danger:false,theme:'white'}});
 assert.equal(current.theme,'pastel'); assert.equal(current.best,false);
});
