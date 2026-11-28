// Read the visible picker from the canvas. A rectangle is returned only when
// every visible pair matches one distinct choice from the current game state.
(() => {
  'use strict';
  const tileName = /^(?:[1-9][mps]|5[mps]r)$/;
  const pairKey = pair => [...pair].sort().join('|');
  const centerY = box => box.y + box.height / 2;

  function setup(value) {
    const choices = value?.chi_choices;
    const references = value?.chi_references;
    if (value?.type !== 'chi' || !Array.isArray(choices) || choices.length < 2 || choices.length > 6 ||
      !references || !Array.isArray(value.consumed) || value.consumed.length !== 2 || !tileName.test(value.pai) ||
      ![4,7,10,13].includes(value.hand_count)) return null;
    const called = Number(value.pai[0]);
    const names = new Set();
    const keys = new Set();
    for (const pair of choices) {
      if (!Array.isArray(pair) || pair.length !== 2 ||
        !pair.every(name => typeof name === 'string' && tileName.test(name) && name[1] === value.pai[1])) return null;
      const ranks = [called, ...pair.map(name => Number(name[0]))].sort((a, b) => a - b);
      if (ranks[1] - ranks[0] !== 1 || ranks[2] - ranks[1] !== 1) return null;
      for (const name of pair) names.add(name);
      keys.add(pairKey(pair));
    }
    const selected = pairKey(value.consumed);
    if (keys.size !== choices.length || !keys.has(selected)) return null;
    const slots = new Map();
    for (const name of names) {
      const index = references[name];
      if (!Number.isInteger(index) || index < 0 || index >= value.hand_count) return null;
      slots.set(name, index);
    }
    if (new Set(slots.values()).size !== slots.size) return null;
    return {keys, selected, slots};
  }

  // Segment individual tile faces. The picker cards are high-contrast
  // rectangles even when the table underneath is dimmed.
  function faces(frame, topFraction, bottomFraction) {
    const {data, width, height} = frame;
    const top = Math.floor(height * topFraction);
    const bottom = Math.floor(height * bottomFraction);
    const mask = new Uint8Array(width * (bottom - top));
    for (let i = 0; i < mask.length; i++) {
      const p = (top * width + i) * 4;
      const lo = Math.min(data[p], data[p + 1], data[p + 2]);
      const hi = Math.max(data[p], data[p + 1], data[p + 2]);
      if (data[p + 3] >= 220 && lo >= 142 && hi - lo < 66) mask[i] = 1;
    }
    const result = [];
    const queue = [];
    function enqueue(index) {
      if (!mask[index]) return;
      mask[index] = 0;
      queue.push(index);
    }
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      queue.length = 0;
      queue.push(i);
      mask[i] = 0;
      let left = width, right = 0, upper = bottom, lower = top;
      for (let j = 0; j < queue.length; j++) {
        const point = queue[j], x = point % width, y = top + Math.floor(point / width);
        left = Math.min(left, x); right = Math.max(right, x);
        upper = Math.min(upper, y); lower = Math.max(lower, y);
        if (x > 0) enqueue(point - 1);
        if (x + 1 < width) enqueue(point + 1);
        enqueue(point - width);
        enqueue(point + width);
      }
      const w = right - left + 1, h = lower - upper + 1;
      if (w >= width * .016 && w <= width * .086 && h >= height * .037 && h <= height * .15 &&
        w / h >= .42 && w / h <= 1.4 && queue.length >= w * h * .43) {
        result.push({x:left, y:upper, width:w, height:h});
      }
    }
    return result;
  }

  const glyphWidth = 14, glyphHeight = 18;
  function glyph(frame, box) {
    const {data, width} = frame;
    const cells = new Uint8Array(glyphWidth * glyphHeight * 2);
    let ink = 0;
    for (let y = 0; y < glyphHeight; y++) {
      for (let x = 0; x < glyphWidth; x++) {
        const cell = (y * glyphWidth + x) * 2;
        for (const sy of [.17, .5, .83]) {
          for (const sx of [.17, .5, .83]) {
            const ix = Math.floor(box.x + box.width * (.12 + .76 * (x + sx) / glyphWidth));
            const iy = Math.floor(box.y + box.height * (.09 + .79 * (y + sy) / glyphHeight));
            const p = (iy * width + ix) * 4;
            const r = data[p], g = data[p + 1], b = data[p + 2];
            if (Math.min(r, g, b) >= 135 && Math.max(r, g, b) - Math.min(r, g, b) < 66) continue;
            const red = r >= 95 && r > g * 1.38 && r > b * 1.25;
            cells[cell + Number(red)]++;
            ink++;
          }
        }
      }
    }
    return ink >= 8 * 9 && ink < glyphWidth * glyphHeight * 9 * .65 ? cells : null;
  }

  function distance(a, b) {
    let best = 1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        let match = 0, union = 0;
        for (let y = 0; y < glyphHeight; y++) {
          for (let x = 0; x < glyphWidth; x++) {
            const tx = x + dx, ty = y + dy;
            const left = (y * glyphWidth + x) * 2;
            const right = tx >= 0 && tx < glyphWidth && ty >= 0 && ty < glyphHeight ? (ty * glyphWidth + tx) * 2 : -2;
            for (let color = 0; color < 2; color++) {
              const u = a[left + color], v = b[right + color] ?? 0;
              union += Math.max(u, v);
              match += Math.min(u, v);
            }
          }
        }
        if (union) best = Math.min(best, 1 - match / union);
      }
    }
    return best;
  }

  function handGlyphs(frame, slots, geometry) {
    const boxes = faces(frame, Math.max(.78, geometry.tileY - geometry.tileHeight * .65), 1);
    const known = new Map();
    for (const [name, index] of slots) {
      const x = frame.width * (geometry.firstX + index * geometry.tileStep);
      const y = frame.height * geometry.tileY;
      const near = boxes.filter(box => Math.abs(box.x + box.width / 2 - x) < frame.width * geometry.tileStep * .41 &&
        Math.abs(centerY(box) - y) < frame.height * geometry.tileHeight * .4);
      const image = near.length === 1 && glyph(frame, near[0]);
      if (!image) return null;
      known.set(name, image);
    }
    return known;
  }

  function rowsFor(frame, expectedTiles) {
    const rows = [];
    const boxes = faces(frame, .50, .86).sort((a, b) => centerY(a) - centerY(b));
    for (const box of boxes) {
      const row = rows.find(items => Math.abs(centerY(items[0]) - centerY(box)) < items[0].height * .20);
      if (row) row.push(box);
      else rows.push([box]);
    }
    const candidates = rows.filter(row => row.length >= 2 && row.length % 2 === 0 && row.length <= expectedTiles);
    const layouts = candidates.filter(row => row.length === expectedTiles).map(row => [row]);
    for (let i = 0; i < candidates.length - 1; i++) {
      const a = candidates[i], b = candidates[i + 1];
      const delta = centerY(b[0]) - centerY(a[0]);
      if (a.length + b.length === expectedTiles && delta >= a[0].height * .88 && delta < a[0].height * 1.55) layouts.push([a, b]);
    }
    return layouts;
  }

  function matchMenu(frame, spec, known) {
    const classify = box => {
      const image = glyph(frame, box);
      if (!image) return null;
      const scores = [...known].map(([name, sample]) => ({name, score:distance(image, sample)})).sort((a, b) => a.score - b.score);
      const [first, second] = scores;
      return first?.score <= .46 && second?.score - first.score >= .13 ? first.name : null;
    };

    let result = null;
    for (const layout of rowsFor(frame, spec.keys.size * 2)) {
      const seen = new Set();
      let selected = null, valid = true;
      for (const row of layout) {
        row.sort((a, b) => a.x - b.x);
        for (let i = 0; i < row.length; i += 2) {
          const a = row[i], b = row[i + 1];
          const gap = b.x - a.x - a.width;
          if (gap < 0 || gap > a.width * .58 || b.width / a.width < .75 || b.width / a.width > 1.32 ||
            b.height / a.height < .75 || b.height / a.height > 1.32) {
            valid = false;
            break;
          }
          const first = classify(a), second = classify(b);
          const key = first && second && pairKey([first, second]);
          if (!spec.keys.has(key) || seen.has(key)) {
            valid = false;
            break;
          }
          seen.add(key);
          if (key === spec.selected) {
            const top = Math.min(a.y, b.y), bottom = Math.max(a.y + a.height, b.y + b.height);
            selected = {x:a.x, y:top, width:b.x + b.width - a.x, height:bottom - top};
          }
        }
        if (!valid) break;
      }
      if (valid && selected && seen.size === spec.keys.size) {
        if (result) return null;
        result = selected;
      }
    }
    return result;
  }

  function track(spec) {
    let known = null;
    return (frame, geometry) => {
      const hand = handGlyphs(frame, spec.slots, geometry);
      if (hand) known = hand;
      return known ? matchMenu(frame, spec, known) : null;
    };
  }

  globalThis.MjaiChiMenu = {setup, track};
})();
