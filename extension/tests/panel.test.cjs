const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('HUD can move, resize, collapse and reset without losing its controls', () => {
  class Element {
    style = {};
    children = [];
    listeners = {};
    attributes = {};
    classList = {add() {}};
    append(node) { this.children.push(node); node.parentElement = this; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    setPointerCapture() {}
  }
  const host = new Element(), card = new Element(), header = new Element();
  const title = new Element(), body = new Element();
  host.append(card); card.append(header); header.append(title); card.append(body);
  const window = {innerWidth:800,innerHeight:600,addEventListener() {}};
  host.getBoundingClientRect = () => {
    const scale = Number(card.style.zoom || 1);
    const width = 200 * scale, height = (body.hidden ? 30 : 160) * scale;
    return {width,height,left:parseInt(host.style.left) || 0,top:parseInt(host.style.top) || 0};
  };
  let saved;
  const chrome = {storage:{local:{
    get(_key, callback) { callback({hudLayout:{x:950,y:900,scale:1,collapsed:false}}); },
    set(value) { saved = value.hudLayout; },
  }}};
  const context = {document:{createElement:() => new Element()},window,chrome};
  const source = fs.readFileSync(path.join(__dirname, '../panel.js'), 'utf8');
  vm.runInNewContext(source, context);
  context.MajsoulPanel.create(host, header, title, body);
  assert.equal(host.style.left, '600px');
  assert.equal(host.style.top, '440px');

  title.listeners.pointerdown({button:0,pointerId:1,clientX:610,clientY:450});
  title.listeners.pointermove({pointerId:1,clientX:170,clientY:110});
  title.listeners.pointerup({pointerId:1});
  assert.equal(saved.x, 160);
  assert.equal(saved.y, 100);

  const [, , larger, collapse] = header.children;
  larger.listeners.click();
  assert.equal(card.style.zoom, '1.125');
  collapse.listeners.click();
  assert.equal(body.hidden, true);
  assert.equal(collapse.attributes['aria-expanded'], 'false');
  collapse.listeners.click();
  assert.equal(body.hidden, false);
  body.children[0].listeners.click();
  assert.equal(host.style.right, '12px');
  assert.equal(card.style.zoom, '1');
});
