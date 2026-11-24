const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('translates risk explanations and controls in each supported language', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../i18n.js'), 'utf8'), context);
  const t = context.MjaiI18n.translate;
  assert.equal(t('危險牌顯示', 'zh-Hans'), '危险牌显示');
  assert.equal(t('危險牌顯示', 'en'), 'Show dangerous tiles');
  assert.equal(t('高風險：5m（上家立直，無筋，寶牌）', 'en'),
    'High risk: 5m（previous player riichi，unsuji，dora）');
  assert.equal(t('Bridge disconnected; retrying', 'zh-Hant'), '橋接程式已斷線，正在重試');
  assert.equal(t('Discard 5m', 'zh-Hans'), '切牌 5m');
});

test('restores, changes and saves the language while translating new status text', () => {
  class Node {
    constructor(type = 1) { this.nodeType=type; this.childNodes=[]; this.style={}; this.attrs={}; this.listeners={}; this.nodeValue=''; }
    append(node) { this.childNodes.push(node); }
    set textContent(value) { this.childNodes=[Object.assign(new Node(3), {nodeValue:value})]; }
    get textContent() { return this.childNodes.map(x => x.nodeValue).join(''); }
    setAttribute(key,value) { this.attrs[key]=value; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    addEventListener(key,fn) { this.listeners[key]=fn; }
  }
  let observer, saved;
  class Observer { constructor(fn) { this.fn=fn; observer=this; } disconnect() {} observe() {} }
  const context = {document:{createElement:() => new Node()},MutationObserver:Observer,chrome:{storage:{local:{
    get(_key, callback) { callback({hudLanguage:'en'}); },
    set(value) { saved=value; },
  }}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../i18n.js'), 'utf8'), context);
  const card=new Node(), status=new Node(); status.textContent='Waiting for game traffic'; card.append(status);
  context.MjaiI18n.create(card);
  assert.equal(status.textContent, 'Waiting for game traffic');
  const select=card.childNodes[1].childNodes[1];
  select.value='zh-Hans'; select.listeners.change();
  assert.equal(saved.hudLanguage, 'zh-Hans');
  assert.equal(status.textContent, '等待游戏数据');
  status.textContent='Bridge disconnected; retrying'; observer.fn();
  assert.equal(status.textContent, '桥接程序已断线，正在重试');
  select.value='zh-Hant'; select.listeners.change();
  assert.equal(status.textContent, '橋接程式已斷線，正在重試');
});
