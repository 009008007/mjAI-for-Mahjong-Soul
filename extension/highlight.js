// Passive visual markers; positions are relative to the displayed game canvas.
(() => {
  'use strict';
  const defaults = Object.freeze({firstX:.142, tileY:.93, tileStep:.0496, tileWidth:.048, tileHeight:.14, drawGap:.016,
    buttonRight:.6796875, buttonY:.7777778, buttonStep:.13984375, buttonRow:.1222222, buttonWidth:.11, buttonHeight:.09});
  const specs = [
    ['firstX','First tile: left/right',0,.45,.002], ['tileY','Tiles: up/down',.65,.99,.002],
    ['tileStep','Tile spacing',.02,.09,.001], ['tileWidth','Tile highlight width',.01,.10,.001],
    ['tileHeight','Tile highlight height',.03,.25,.002], ['drawGap','Drawn tile gap',0,.07,.001],
    ['buttonRight','Rightmost action: left/right',.45,.99,.002], ['buttonY','Actions: up/down',.35,.95,.002],
    ['buttonStep','Action spacing',.03,.2,.002], ['buttonRow','Action row spacing',.03,.2,.002], ['buttonWidth','Action highlight width',.02,.18,.002],
    ['buttonHeight','Action highlight height',.02,.2,.002]
  ];
  function rectFor(value, canvas, geometry = defaults) {
    if (!value || !canvas || !(canvas.width > 0 && canvas.height > 0)) return null;
    let x, y, w, h;
    if (value.type === 'dahai' || value.type === 'chi-tile') {
      const chi = value.type === 'chi-tile';
      const expectedCounts = chi ? [4,7,10,13] : [2,5,8,11,14];
      if (!expectedCounts.includes(value.hand_count) || !Number.isInteger(value.hand_index)
        || value.hand_index < 0 || value.hand_index >= value.hand_count
        || (value.drawn_index != null && (chi || value.drawn_index !== value.hand_count - 1))) return null;
      x = geometry.firstX + value.hand_index * geometry.tileStep + (value.hand_index === value.drawn_index ? geometry.drawGap : 0);
      y = geometry.tileY; w = geometry.tileWidth; h = geometry.tileHeight;
    } else if (Number.isInteger(value.button_index) && Number.isInteger(value.button_count)
      && value.button_count > 0 && value.button_count <= 6 && value.button_index >= 0 && value.button_index < value.button_count) {
      x = geometry.buttonRight - (value.button_index % 3) * geometry.buttonStep;
      y = geometry.buttonY - Math.floor(value.button_index / 3) * geometry.buttonRow; w = geometry.buttonWidth; h = geometry.buttonHeight;
    } else return null;
    if (![x,y,w,h].every(Number.isFinite) || x-w/2 < 0 || x+w/2 > 1 || y-h/2 < 0 || y+h/2 > 1) return null;
    return {left:canvas.left + (x-w/2)*canvas.width, top:canvas.top + (y-h/2)*canvas.height,
      width:w*canvas.width, height:h*canvas.height};
  }
  function create(card) {
    let geometry = {...defaults}, current = null, preview = null, canvas = null;
    let options = {best:true, danger:false};
    const dangerMarks = [];
    const chiMarks = [];
    function recommendationMark() {
      const node = document.createElement('div');
      Object.assign(node.style,{position:'fixed',display:'none',pointerEvents:'none',zIndex:'2147483646',boxSizing:'border-box',border:'4px solid #45ff82',borderRadius:'9px',background:'rgba(44,255,104,.17)',boxShadow:'0 0 10px #15ff65, inset 0 0 9px #70ffa5'});
      document.documentElement.append(node);
      return node;
    }
    const mark = recommendationMark();
    let nativeMark, capture, captureContext, inspect, inspectedValue, inspectedCanvas, animation;
    let lastCapture = -Infinity;
    function stopNativeChi() {
      if (animation != null) window.cancelAnimationFrame(animation);
      animation = null;
      inspect = inspectedValue = inspectedCanvas = null;
      lastCapture = -Infinity;
      if (nativeMark) nativeMark.style.display = 'none';
    }
    function scanNativeChi(time) {
      animation = null;
      if (!inspect) return;
      if (time - lastCapture >= 130) {
        lastCapture = time;
        const source = inspectedCanvas;
        let selected, bounds;
        try {
          bounds = source.getBoundingClientRect();
          if (source.isConnected && bounds.width > 0 && bounds.height > 0 && source.width && source.height) {
            const height = Math.round(capture.width * source.height / source.width);
            if (height >= 200 && height <= 540) {
              if (capture.height !== height) capture.height = height;
              captureContext.clearRect(0, 0, capture.width, height);
              captureContext.drawImage(source, 0, 0, capture.width, height);
              selected = inspect(captureContext.getImageData(0, 0, capture.width, height), geometry);
            }
          }
        } catch (_) { /* A temporarily unreadable canvas has no verified target. */ }
        const wasVisible = nativeMark?.style.display === 'block';
        if (selected) {
          nativeMark ||= recommendationMark();
          const sx = bounds.width / capture.width, sy = bounds.height / capture.height;
          Object.assign(nativeMark.style,{
            display:'block', background:'transparent',
            left:`${bounds.left + selected.x * sx - 3}px`, top:`${bounds.top + selected.y * sy - 3}px`,
            width:`${selected.width * sx + 6}px`, height:`${selected.height * sy + 6}px`,
          });
        } else if (nativeMark) nativeMark.style.display = 'none';
        if (Boolean(selected) !== wasVisible) update();
      }
      if (inspect && animation == null) animation = window.requestAnimationFrame(scanNativeChi);
    }
    function updateNativeChi(value) {
      if (value === inspectedValue && canvas === inspectedCanvas) return;
      stopNativeChi();
      const spec = canvas && globalThis.MjaiChiMenu?.setup(value);
      if (!spec || typeof window.requestAnimationFrame !== 'function') return;
      if (!capture) {
        capture = document.createElement('canvas');
        capture.width = 720;
        captureContext = capture.getContext?.('2d', {willReadFrequently:true});
      }
      if (!captureContext) return;
      inspectedValue = value;
      inspectedCanvas = canvas;
      inspect = globalThis.MjaiChiMenu.track(spec);
      animation = window.requestAnimationFrame(scanNativeChi);
    }
    function updateChiMarks(value, bounds) {
      const indices = value?.chi_hand_indices;
      const rects = value?.type === 'chi' && options.best && Array.isArray(indices) &&
        indices.length === 2 && indices[0] !== indices[1]
        ? Array.from(indices, hand_index => rectFor({type:'chi-tile', hand_index, hand_count:value.hand_count}, bounds, geometry))
        : [];
      if (rects.length === 2 && rects.every(Boolean)) {
        for (const [i, rect] of rects.entries()) {
          const node = chiMarks[i] ?? (chiMarks[i] = recommendationMark());
          Object.assign(node.style, {display:'block',left:`${rect.left}px`,top:`${rect.top}px`,
            width:`${rect.width}px`,height:`${rect.height}px`});
        }
      } else {
        for (const node of chiMarks) node.style.display = 'none';
      }
    }
    function findCanvas() {
      return [...document.querySelectorAll('canvas')].filter(c => { const r=c.getBoundingClientRect(), css=window.getComputedStyle(c); return r.width >= 300 && r.height >= 200 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight && css.display !== 'none' && css.visibility !== 'hidden'; })
        .sort((a,b) => { const x=a.getBoundingClientRect(), y=b.getBoundingClientRect(); return y.width*y.height-x.width*x.height; })[0] || null;
    }
    function update() {
      canvas = findCanvas();
      updateNativeChi(!preview && options.best ? current : null);
      const target = preview === 'tile' ? {type:'dahai',hand_count:14,hand_index:0,drawn_index:13} : preview === 'button' ? {type:'none',button_count:3,button_index:0} : current;
      const bounds = canvas?.getBoundingClientRect();
      const bestVisible = preview || (target && (target.type !== 'dahai' || options.best));
      const rect = bounds && bestVisible && nativeMark?.style.display !== 'block' && rectFor(target, bounds, geometry);
      const dangers = !preview && options.danger && Array.isArray(current?.danger_tiles)
        ? current.danger_tiles.slice(0, 14).filter(item => Number.isInteger(item?.hand_index)) : [];
      const overlap = rect && target?.type === 'dahai' && dangers.find(item => item.hand_index === target.hand_index);
      mark.textContent = overlap ? '⚠' : '';
      Object.assign(mark.style, {display:rect?'block':'none', color:overlap?.level === 'medium' ? '#b24c00' : '#d90000', font:'bold 24px system-ui', textAlign:'right'});
      if (rect) Object.assign(mark.style, {left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,
        borderColor:preview?'#ffc54d':'#45ff82',background:preview?'rgba(255,193,45,.16)':'rgba(44,255,104,.17)',
        boxShadow:preview?'0 0 10px #ffd25c':'0 0 10px #15ff65, inset 0 0 9px #70ffa5'});
      updateChiMarks(preview ? null : current, bounds);
      let used = 0;
      for (const item of dangers) {
        if (overlap && item.hand_index === target.hand_index) continue;
        const dangerRect = bounds && rectFor({type:'dahai', hand_index:item.hand_index, hand_count:current.hand_count, drawn_index:current.drawn_index}, bounds, geometry);
        if (!dangerRect) continue;
        if (!dangerMarks[used]) {
          const node = document.createElement('div');
          Object.assign(node.style, {position:'fixed',pointerEvents:'none',zIndex:'2147483646',boxSizing:'border-box',border:'4px solid',borderRadius:'9px'});
          document.documentElement.append(node); dangerMarks.push(node);
        }
        const medium = item.level === 'medium';
        const color = medium ? '#ff9d28' : '#f04444';
        Object.assign(dangerMarks[used++].style, {
          display:'block',left:`${dangerRect.left}px`,top:`${dangerRect.top}px`,
          width:`${dangerRect.width}px`,height:`${dangerRect.height}px`,
          borderColor:color, background:medium ? 'rgba(255,157,40,.16)' : 'rgba(240,44,44,.16)',
          boxShadow:`0 0 10px ${color}`,
        });
      }
      for (let i=used; i<dangerMarks.length; i++) dangerMarks[i].style.display='none';
    }
    const toggle = document.createElement('button');
    toggle.type='button'; toggle.textContent='Adjust highlight';
    Object.assign(toggle.style,{pointerEvents:'auto',marginTop:'7px',padding:'4px 7px',border:'1px solid #8bd8a6',borderRadius:'5px',background:'var(--mj-control)' ,color:'var(--mj-text)' ,cursor:'pointer',font:'12px system-ui'});
    const panel = document.createElement('div');
    Object.assign(panel.style,{display:'none',pointerEvents:'auto',marginTop:'8px',width:'260px',maxHeight:'55vh',overflowY:'auto',font:'12px system-ui',color:'var(--mj-text)' });
    const hint = document.createElement('div'); hint.textContent='Yellow preview: align it with the chosen tile or action button.'; panel.append(hint);
    const selector=document.createElement('select');
    for (const [value,title] of [['tile','Preview first tile'],['button','Preview rightmost action']]) {
      const option=document.createElement('option'); option.value=value; option.textContent=title; selector.append(option);
    }
    Object.assign(selector.style,{display:'block',marginTop:'6px',pointerEvents:'auto'});
    selector.addEventListener('change',()=>{ preview=selector.value; update(); }); panel.append(selector);
    const inputs = new Map();
    for (const [key,title,min,max,step] of specs) {
      const label=document.createElement('label'); Object.assign(label.style,{display:'block',marginTop:'7px'}); label.textContent=title;
      const input=document.createElement('input'); input.type='range'; input.min=String(min); input.max=String(max); input.step=String(step); input.value=String(geometry[key]);
      Object.assign(input.style,{display:'block',width:'100%',accentColor:'#56e48d'});
      input.addEventListener('input',() => { geometry[key]=Number(input.value); update(); try { chrome.storage.local.set({hudGeometry:geometry}); } catch (_) {} });
      label.append(input); panel.append(label); inputs.set(key,input);
    }
    const reset=document.createElement('button'); reset.type='button'; reset.textContent='Reset positions';
    Object.assign(reset.style,{pointerEvents:'auto',marginTop:'8px',padding:'4px',cursor:'pointer'});
    reset.addEventListener('click',() => { geometry={...defaults}; for (const [key,input] of inputs) input.value=String(geometry[key]); update(); try { chrome.storage.local.set({hudGeometry:geometry}); } catch (_) {} });
    panel.append(reset); card.append(toggle,panel);
    toggle.addEventListener('click',() => { preview=preview ? null : selector.value; panel.style.display=preview?'block':'none'; toggle.textContent=preview?'Done adjusting':'Adjust highlight'; update(); });
    try { chrome.storage.local.get('hudGeometry', result => {
      if (result?.hudGeometry && typeof result.hudGeometry === 'object') for (const [key,,min,max] of specs) {
        const v=result.hudGeometry[key]; if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) { geometry[key]=v; inputs.get(key).value=String(v); }
      }
      update();
    }); } catch (_) {}
    window.addEventListener('resize',update); window.addEventListener('scroll',update,true); document.addEventListener('fullscreenchange',update);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    // The canvas can be inserted after the content script loads.
    let observed = null;
    const refresh = () => { const next=findCanvas(); if (next !== observed) { if (observed) observer?.unobserve(observed); observed=next; if (observed) observer?.observe(observed); } update(); };
    const timer=setInterval(refresh,1000);
    return {show(value, settings) { current=value; options=settings || options; refresh(); },
      fallbackTarget(value) {
        // Only a single highlighted tile or win button has an unambiguous click.
        if (preview || current !== value || !options.best || !['dahai','hora'].includes(value?.type)) return null;
        refresh();
        if (!canvas || mark.style.display !== 'block') return null;
        const rect = rectFor(value, canvas.getBoundingClientRect(), geometry);
        if (!rect) return null;
        const x = rect.left + rect.width / 2;
        // A selected tile lifts above the row. Aim inside the part of its
        // face shared by the resting and raised positions.
        const y = rect.top + rect.height * (value.type === 'dahai' ? 0.4 : 0.5);
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight ||
            document.elementFromPoint?.(x, y) !== canvas) return null;
        return {canvas, x, y};
      },
      clear() { current=null; stopNativeChi(); if (!preview) mark.style.display='none'; for (const node of [...chiMarks, ...dangerMarks]) node.style.display='none'; },
      destroy() { clearInterval(timer); observer?.disconnect(); stopNativeChi(); mark.remove(); nativeMark?.remove(); for (const node of [...chiMarks, ...dangerMarks]) node.remove(); }};
  }
  globalThis.MajsoulHighlight = {defaults, rectFor, create};
})();
