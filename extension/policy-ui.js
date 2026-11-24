// Controls only the recommendation style; never sends input to the game.
(() => {
  'use strict';
  const allowed = new Set(['default', 'CallManiac', 'SuperTurtle']);
  const defaults = Object.freeze({style:'default', intensity:1});
  function sanitize(value) {
    return {
      style: allowed.has(value?.style) ? value.style : defaults.style,
      intensity: typeof value?.intensity === 'number' && Number.isFinite(value.intensity)
        && value.intensity >= 0 && value.intensity <= 2 ? value.intensity : defaults.intensity
    };
  }
  function create(card, onChange) {
    let changed = false;
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {marginTop:'8px', pointerEvents:'auto', font:'12px system-ui', color:'var(--mj-text)'});
    const styleLabel = document.createElement('label');
    styleLabel.textContent = 'AI style / 風格 ';
    const style = document.createElement('select');
    style.setAttribute('aria-label', 'AI style');
    for (const [value, label] of [['default','Default · 預設'], ['CallManiac','CallManiac · 副露速攻'], ['SuperTurtle','SuperTurtle · 防守']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; style.append(option);
    }
    style.value = defaults.style;
    styleLabel.append(style); wrap.append(styleLabel);
    const strengthLabel = document.createElement('label');
    Object.assign(strengthLabel.style, {display:'block', marginTop:'6px'});
    const caption = document.createElement('span');
    const slider = document.createElement('input');
    slider.type='range'; slider.min='0'; slider.max='2'; slider.step='0.1'; slider.value='1';
    slider.setAttribute('aria-label', 'AI style intensity');
    Object.assign(slider.style, {display:'block',width:'100%',accentColor:'#56e48d'});
    strengthLabel.append(caption, slider); wrap.append(strengthLabel); card.append(wrap);
    function captionUpdate() { caption.textContent = `Intensity / 強度: ${Number(slider.value).toFixed(1)}`; }
    function commit() {
      changed = true;
      const value = sanitize({style:style.value,intensity:Number(slider.value)});
      style.value = value.style; slider.value = String(value.intensity); captionUpdate();
      try { chrome.storage.local.set({hudPolicy:value}); } catch (_) {}
      onChange(value);
    }
    captionUpdate();
    style.addEventListener('change', commit);
    slider.addEventListener('input', captionUpdate);
    slider.addEventListener('change', commit);
    try {
      chrome.storage.local.get('hudPolicy', result => {
        // Never overwrite a selection made while storage was being read.
        if (changed) return;
        const value = sanitize(result?.hudPolicy);
        style.value = value.style; slider.value = String(value.intensity); captionUpdate();
        onChange(value);
      });
    } catch (_) { /* Default policy is already active. */ }
  }
  globalThis.MajsoulPolicyUI = {defaults, sanitize, create};
})();
