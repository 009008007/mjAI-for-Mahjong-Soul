// Local display preferences, independent of the AI policy.
(() => {
  'use strict';
  const defaults = Object.freeze({best:true, danger:false, theme:'dark'});
  function sanitize(value) {
    return {best:typeof value?.best === 'boolean' ? value.best : true,
      danger:typeof value?.danger === 'boolean' ? value.danger : false,
      theme:['dark','white','pastel'].includes(value?.theme) ? value.theme : 'dark'};
  }
  function create(card, onChange) {
    let changed = false;
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {marginTop:'8px',pointerEvents:'auto',font:'12px system-ui',color:'var(--mj-text)'});
    const bestLabel = document.createElement('label');
    Object.assign(bestLabel.style, {display:'block'});
    const best = document.createElement('input'); best.type='checkbox'; best.checked=true;
    bestLabel.append(best, document.createTextNode(' 最佳牌顯示'));
    const dangerLabel = document.createElement('label');
    Object.assign(dangerLabel.style, {display:'block'});
    const danger = document.createElement('input'); danger.type='checkbox';
    dangerLabel.append(danger, document.createTextNode(' 危險牌顯示'));
    const themeLabel = document.createElement('label'); themeLabel.textContent='主題 ';
    const theme = document.createElement('select'); theme.setAttribute('aria-label','HUD 主題');
    for (const [value, label] of [['dark','黑綠'],['white','白色'],['pastel','淺粉 × 淺藍']]) {
      const option = document.createElement('option'); option.value=value; option.textContent=label; theme.append(option);
    }
    theme.value='dark'; themeLabel.append(theme); wrap.append(bestLabel,dangerLabel,themeLabel); card.append(wrap);
    function apply(value) {
      value=sanitize(value); best.checked=value.best; danger.checked=value.danger; theme.value=value.theme; onChange(value);
    }
    function commit() {
      changed=true; const value=sanitize({best:best.checked,danger:danger.checked,theme:theme.value});
      try { chrome.storage.local.set({hudDisplay:value}); } catch (_) {}
      apply(value);
    }
    best.addEventListener('change',commit); danger.addEventListener('change',commit); theme.addEventListener('change',commit);
    try { chrome.storage.local.get('hudDisplay', result => { if (!changed) apply(result?.hudDisplay); }); } catch (_) {}
  }
  globalThis.MajsoulDisplaySettings = {defaults,sanitize,create};
})();
