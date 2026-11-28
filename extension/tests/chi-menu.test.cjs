const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
const load = name => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), context);
load('chi-menu.js');
const {setup, track} = context.MjaiChiMenu;
const geometry = {firstX:.142, tileY:.93, tileStep:.0496, tileHeight:.14};
const hand = {'1s':3, '2s':4, '3s':5, '4s':6, '5sr':7, '5s':8, '6s':9};
const patterns = {
  '1s':[[1,1],[1,2]],
  '2s':[[0,0],[2,3]],
  '3s':[[1,0],[0,3],[2,3]],
  '4s':[[0,0],[2,0],[0,3],[2,3]],
  '5s':[[0,0],[2,0],[1,1],[0,3],[2,3]],
  '5sr':[[0,0],[2,0],[1,1],[0,3],[2,3]],
  '6s':[[0,0],[2,0],[0,1],[2,1],[0,3],[2,3]],
};

function fixture(rows, {showHand = true, width = 720, wholePairs = true} = {}) {
  const height = Math.round(width * 9 / 16);
  const data = new Uint8ClampedArray(width * height * 4);
  function fill(x, y, w, h, rgb) {
    for (let dy = y; dy < y + h; dy++) {
      for (let dx = x; dx < x + w; dx++) data.set([...rgb, 255], (dy * width + dx) * 4);
    }
  }
  function face(name, x, y, w, h) {
    fill(x, y, w, h, [236, 232, 218]);
    const color = name === '5sr' ? [190, 32, 25] : [25, 78, 36];
    for (const [col,row] of patterns[name]) {
      fill(x + Math.round(w * (.23 + col * .20)), y + Math.round(h * (.15 + row * .17)),
        Math.round(w * .15), Math.round(h * .14), color);
    }
  }
  if (showHand) {
    for (const [name, index] of Object.entries(hand)) {
      const w = Math.round(width * .032), h = Math.round(height * .098);
      const x = Math.round(width * (geometry.firstX + index * geometry.tileStep) - w / 2);
      face(name, x, Math.round(height * geometry.tileY - h / 2), w, h);
    }
  }
  const boxes = new Map();
  rows.forEach((options, row) => {
    const w = Math.round(width * .035), h = Math.round(height * .085);
    const gap = Math.round(width * .004), stride = w * 2 + gap * 4;
    const y = Math.round(height * .64) + row * (h + 6);
    options.forEach((pair, i) => {
      const x = Math.round(width / 2 - options.length * stride / 2) + i * stride;
      face(pair[0], x, y, w, h);
      if (wholePairs || i !== options.length - 1) face(pair[1], x + w + gap, y, w, h);
      boxes.set([...pair].sort().join('|'), {x, y, width:w * 2 + gap, height:h});
    });
  });
  return {data, width, height, boxes};
}

function spec(pai, choices, consumed) {
  return setup({type:'chi', pai, consumed, chi_choices:choices, chi_references:hand, hand_count:13});
}
function expectMatch(frame, candidates, pair) {
  const selected = track(candidates)(frame, geometry);
  assert.deepEqual({...selected}, frame.boxes.get([...pair].sort().join('|')));
}

test('matches 123s and 345s in both native display orders', () => {
  const choices = [['1s','2s'],['4s','5s']];
  for (const pairs of [choices, choices.toReversed()]) {
    for (const selected of choices) expectMatch(fixture([pairs]), spec('3s', choices, selected), selected);
  }
});

test('matches every position with four or five options and distinguishes red and plain fives', () => {
  const choices = [['2s','3s'],['3s','5s'],['3s','5sr'],['5s','6s'],['5sr','6s']];
  for (const count of [4,5]) {
    const offered = choices.slice(0,count);
    const displayed = offered.toReversed().map(pair => pair.toReversed());
    for (const selected of offered) {
      expectMatch(fixture([displayed]), spec('4s', offered, selected), selected);
      expectMatch(fixture([displayed.slice(0,2),displayed.slice(2)], {width:640}), spec('4s', offered, selected), selected);
    }
  }
});

test('keeps references between frames but refuses absent, incomplete, and duplicate visible choices', () => {
  const choices = [['1s','2s'],['4s','5s']];
  const detect = track(spec('3s', choices, choices[1]));
  assert.equal(detect(fixture([]), geometry), null);
  assert.ok(detect(fixture([choices], {showHand:false}), geometry));
  assert.equal(detect(fixture([choices], {wholePairs:false}), geometry), null);
  assert.equal(detect(fixture([[choices[0],choices[0]]]), geometry), null);
  assert.equal(detect(fixture([]), geometry), null);
  assert.equal(spec('3s', choices, ['4s','5sr']), null);
});

test('renders the native rectangle while scanning and removes it when the menu or decision closes', () => {
  const choices = [['1s','2s'],['4s','5s']];
  const suggestion = {
    type:'chi', pai:'3s', consumed:choices[1], chi_choices:choices, chi_references:hand,
    hand_count:13, chi_hand_indices:[6,8], button_index:1, button_count:2,
  };
  let frame = fixture([choices]);
  const animations = new Map();
  let next = 0;
  class Element {
    constructor() { this.style = {}; this.listeners = {}; this.children = []; }
    append(...nodes) { this.children.push(...nodes); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    remove() {}
  }
  const canvas = {
    width:720, height:405, isConnected:true,
    getBoundingClientRect:() => ({left:100, top:50, right:1540, bottom:860, width:1440, height:810}),
  };
  const document = {
    documentElement:new Element(), querySelectorAll:() => [canvas], addEventListener() {},
    createElement:tag => tag === 'canvas' ? {
      getContext:() => ({ clearRect() {}, drawImage() {}, getImageData:() => frame }),
    } : new Element(),
  };
  Object.assign(context, {
    document, window:{
      innerWidth:1600, innerHeight:900, getComputedStyle:() => ({display:'block',visibility:'visible'}),
      addEventListener() {},
      requestAnimationFrame(callback) { animations.set(++next, callback); return next; },
      cancelAnimationFrame(id) { animations.delete(id); },
    },
    chrome:{storage:{local:{get(_, callback) { callback({}); }}}},
    setInterval:() => 1, clearInterval() {},
  });
  load('highlight.js');
  const hud = context.MajsoulHighlight.create(new Element());
  function tick(time) {
    const [id, callback] = animations.entries().next().value;
    animations.delete(id);
    callback(time);
  }
  hud.show(suggestion);
  tick(0);
  const nodes = document.documentElement.children;
  const native = nodes.at(-1);
  const box = frame.boxes.get('4s|5s');
  assert.equal(native.style.left, `${100 + box.x * 2 - 3}px`);
  assert.equal(native.style.display, 'block');
  assert.equal(native.style.pointerEvents, 'none');
  assert.equal(nodes[0].style.display, 'none');
  frame = fixture([]);
  tick(140);
  assert.equal(native.style.display, 'none');
  assert.equal(nodes[0].style.display, 'block');
  frame = fixture([choices]);
  tick(280);
  assert.equal(native.style.display, 'block');
  hud.clear();
  assert.equal(native.style.display, 'none');
  assert.equal(animations.size, 0);
});
