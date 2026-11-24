// Move and scale the HUD independently of the markers on the game canvas.
(() => {
  'use strict';
  const defaults = {x:null, y:12, scale:1, collapsed:false};
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  function sanitize(value) {
    return {
      x:Number.isFinite(value?.x) ? Math.max(0, value.x) : null,
      y:Number.isFinite(value?.y) ? Math.max(0, value.y) : 12,
      scale:Number.isFinite(value?.scale) ? clamp(value.scale, .75, 1.5) : 1,
      collapsed:value?.collapsed === true,
    };
  }
  function create(host, header, title, body) {
    let layout = {...defaults};
    let drag = null;
    let changed = false;
    const button = (parent, label, text, callback) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.textContent = text;
      node.title = label;
      node.setAttribute('aria-label', label);
      node.addEventListener('click', callback);
      parent.append(node);
      return node;
    };
    const smaller = button(header, '縮小 HUD', '−', () => scaleBy(-.125));
    const larger = button(header, '放大 HUD', '+', () => scaleBy(.125));
    const collapse = button(header, '收合或展開 HUD', '−', () => {
      layout.collapsed = !layout.collapsed;
      commit();
    });
    button(body, '重設 HUD 位置和大小', '重設位置與大小', () => {
      layout = {...defaults};
      commit();
    });
    title.title = '拖曳移動 HUD，或按方向鍵移動';
    title.tabIndex = 0;
    title.classList.add('hud-drag');

    function render() {
      body.hidden = layout.collapsed;
      collapse.textContent = layout.collapsed ? '▸' : '▾';
      collapse.setAttribute('aria-expanded', String(!layout.collapsed));
      smaller.disabled = layout.scale <= .75;
      larger.disabled = layout.scale >= 1.5;
      const maxWidth = Math.max(1, window.innerWidth - 16);
      host.style.maxWidth = `${maxWidth}px`;
      header.parentElement.style.zoom = String(layout.scale);
      const rect = host.getBoundingClientRect();
      const y = clamp(layout.y, 0, Math.max(0, window.innerHeight - rect.height));
      const x = layout.x === null ? null : clamp(layout.x, 0, Math.max(0, window.innerWidth - rect.width));
      host.style.top = `${y}px`;
      host.style.left = x === null ? 'auto' : `${x}px`;
      host.style.right = x === null ? '12px' : 'auto';
    }
    function commit() {
      changed = true;
      render();
      try { chrome.storage.local.set({hudLayout:layout}); } catch (_) {}
    }
    function scaleBy(amount) {
      layout.scale = clamp(layout.scale + amount, .75, 1.5);
      commit();
    }
    function moveTo(x, y) {
      const rect = host.getBoundingClientRect();
      layout.x = clamp(x, 0, Math.max(0, window.innerWidth - rect.width));
      layout.y = clamp(y, 0, Math.max(0, window.innerHeight - rect.height));
      render();
    }
    title.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      const rect = host.getBoundingClientRect();
      drag = {id:event.pointerId, x:event.clientX - rect.left, y:event.clientY - rect.top};
      changed = true;
      title.setPointerCapture(event.pointerId);
    });
    title.addEventListener('pointermove', event => {
      if (drag?.id === event.pointerId) moveTo(event.clientX - drag.x, event.clientY - drag.y);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      title.addEventListener(name, event => {
        if (drag?.id !== event.pointerId) return;
        drag = null;
        commit();
      });
    }
    title.addEventListener('keydown', event => {
      const delta = {ArrowLeft:[-12,0], ArrowRight:[12,0], ArrowUp:[0,-12], ArrowDown:[0,12]}[event.key];
      if (!Array.isArray(delta)) return;
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      moveTo(rect.left + delta[0], rect.top + delta[1]);
      commit();
    });
    window.addEventListener('resize', render);
    if (typeof ResizeObserver === 'function') new ResizeObserver(render).observe(host);
    render();
    try {
      chrome.storage.local.get('hudLayout', result => {
        if (!changed) { layout = sanitize(result?.hudLayout); render(); }
      });
    } catch (_) {}
  }
  globalThis.MajsoulPanel = {create};
})();
