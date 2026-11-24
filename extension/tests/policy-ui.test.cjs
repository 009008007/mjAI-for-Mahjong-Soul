const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
class Element {
 constructor(tag){this.tagName=tag;this.style={};this.children=[];this.handlers={};this.value='';this.textContent='';}
 append(...items){this.children.push(...items)}
 setAttribute(){}
 addEventListener(name,callback){this.handlers[name]=callback}
 fire(name){this.handlers[name]?.()}
}
test('style choices and intensity are validated and persisted',()=>{
 const changed=[],saved=[];let getCallback;
 const document={createElement(tag){return new Element(tag)}};
 const chrome={storage:{local:{get(_key,cb){getCallback=cb},set(x){saved.push(x)}}}};
 const ctx={document,chrome};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../policy-ui.js'),'utf8'),ctx);
 assert.equal(ctx.MajsoulPolicyUI.sanitize({style:'unexpected',intensity:99}).style,'default');
 const card=new Element('div');ctx.MajsoulPolicyUI.create(card,p=>changed.push(p));
 const wrap=card.children[0], style=wrap.children[0].children[0], slider=wrap.children[1].children[1];
 getCallback({hudPolicy:{style:'SuperTurtle',intensity:1.4}});
 assert.equal(style.value,'SuperTurtle');assert.equal(slider.value,'1.4');
 style.value='CallManiac';slider.value='1.7';style.fire('change');
 assert.equal(saved.at(-1).hudPolicy.style,'CallManiac');assert.equal(saved.at(-1).hudPolicy.intensity,1.7);
 assert.equal(changed.at(-1).style,'CallManiac');
 // An asynchronous read cannot undo a user's newer choice.
 getCallback({hudPolicy:{style:'SuperTurtle',intensity:0.3}});
 assert.equal(style.value,'CallManiac');
});
