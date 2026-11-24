// Isolated world: render a passive HUD and relay captured notifications.
(() => {
  'use strict';
  const CHANNEL = 'majsoul-hud-v1';
  // The content script survives a service worker restart. Keep a bounded,
  // in-memory copy of the current round so a new backend can rebuild state.
  const active = new Map();
  const MAX_JOURNAL_BYTES = 8 * 1024 * 1024, MAX_JOURNAL_FRAMES = 4096;
  let port;
  let current = null;
  let root;
  let status;
  let action;
  let highlight;
  let policy = {style:'default', intensity:1};
  let policyRevision = 0;
  let display = {best:true, danger:false, theme:'dark'};
  let lastSuggestion = null;
  let card;
  function showSuggestion(value) {
    const labels = {dahai:'Discard', reach:'Riichi', hora:'Win', ryukyoku:'Draw', chi:'Chi', pon:'Pon', daiminkan:'Open kan', ankan:'Closed kan', kakan:'Added kan', none:'Pass'};
    if (!Object.hasOwn(labels, value.type)) return;
    const tile = typeof value.pai === 'string' && /^(?:[1-9][mps]r?|[ESWNPFC]|\?)$/.test(value.pai) ? ` ${value.pai}` : '';
    const consumed = Array.isArray(value.consumed) && value.consumed.every(x => typeof x === 'string' && /^(?:[1-9][mps]r?|[ESWNPFC])$/.test(x)) ? `\nUse: ${value.consumed.join(' ')}` : '';
    const shanten = Number.isInteger(value.shanten) ? `\nShanten: ${value.shanten}` : '';
    const demo = value.source === 'demo' ? '\nDemo mode' : '';
    let warning = '';
    if (display.danger && (value.type === 'dahai' || Number.isInteger(value.riichi_threats) || Array.isArray(value.danger_tiles))) {
      if (value.riichi_threats === 0 && value.risk_scope !== 'all') warning = '\n危險牌：尚無對手立直';
      else if (!Array.isArray(value.danger_tiles)) {
        warning = Number.isInteger(value.riichi_threats) ? '\n危險牌：無法確認手牌位置' : '\n危險牌功能需要更新橋接程式';
      }
      else {
        const seats = {1:'下家',2:'對家',3:'上家'};
        const reasons = {unsuji:'無筋',half_suji:'半筋',suji:'筋牌',honor:'字牌',narrow:'嵌張或邊張',pair:'單騎或雙碰',tanki:'只剩單騎'};
        const threats = {riichi:'立直',open:'多副露',late:'後段可能聽牌'};
        const groups = {high:new Set(), medium:new Set()};
        for (const item of value.danger_tiles.slice(0, 14)) {
          if (typeof item?.pai !== 'string' || !/^(?:[1-9][mps]r?|[ESWNPFC])$/.test(item.pai)
            || !Object.hasOwn(seats, item.threat) || !Object.hasOwn(reasons, item.reason)) continue;
          const group = item.level === 'medium' ? groups.medium : groups.high;
          const dora = item.dora === true ? '，寶牌' : '';
          const threat = Object.hasOwn(threats, item.threat_type) ? threats[item.threat_type] : threats.riichi;
          group.add(`${item.pai}（${seats[item.threat]}${threat}，${reasons[item.reason]}${dora}）`);
        }
        if (groups.high.size) warning += `\n高風險：${[...groups.high].join('、')}`;
        if (groups.medium.size) warning += `\n中風險：${[...groups.medium].join('、')}`;
        if (!warning) warning = '\n危險牌：本手未達提示門檻';
      }
    }
    render('Suggestion', `${labels[value.type]}${tile}${consumed}${shanten}${demo}${warning}`);
    highlight?.show(value, display);
  }
  function updateDisplay(value) {
    display = value;
    if (card) card.className = `card theme-${value.theme}`;
    if (lastSuggestion) showSuggestion(lastSuggestion);
  }
  function render(state, detail = '') {
    if (!root) return;
    status.textContent = state;
    action.textContent = detail;
    if (state !== 'Suggestion') { lastSuggestion = null; highlight?.clear(); }
  }
  function mount() {
    if (!document.documentElement || root) return;
    const host = document.createElement('div');
    host.id = 'majsoul-ai-hud';
    Object.assign(host.style, {position:'fixed', top:'12px', right:'12px', zIndex:'2147483647', pointerEvents:'none'});
    const shadow = host.attachShadow({mode:'closed'});
    const style = document.createElement('style');
    style.textContent = ':host{all:initial} .card{--mj-text:#eefaf2;--mj-bg:rgba(9,23,24,.94);--mj-border:#66c88b;--mj-title:#91e0ad;--mj-control:#16372a;font:13px/1.45 system-ui,sans-serif;color:var(--mj-text);background:var(--mj-bg);border:1px solid var(--mj-border);border-radius:9px;padding:9px 12px;min-width:175px;box-shadow:0 3px 16px #0006}.theme-white{--mj-text:#17222a;--mj-bg:#fff;--mj-border:#82919c;--mj-title:#25495a;--mj-control:#eef3f5}.theme-pastel{--mj-text:#293442;--mj-bg:#fff0f7;--mj-border:#83bada;--mj-title:#375777;--mj-control:#e1f2ff}.title{font-weight:700;color:var(--mj-title)}.status{color:var(--mj-text)}.action{font-weight:700;font-size:17px;white-space:pre-line;color:var(--mj-text)}';
    card = document.createElement('div'); card.className = 'card theme-dark';
    const panelStyle = document.createElement('style');
    panelStyle.textContent = '.card{box-sizing:border-box;max-width:min(360px,calc((100vw - 20px)/1.5))}.hud-header{display:flex;align-items:center;gap:5px}.hud-drag{flex:1;pointer-events:auto;cursor:move;touch-action:none;user-select:none}.hud-body{max-height:55vh;overflow:auto;overflow-wrap:anywhere}.hud-body[hidden]{display:none}.hud-header button,.hud-body>button{pointer-events:auto;cursor:pointer;border:1px solid var(--mj-border);border-radius:4px;background:var(--mj-control);color:var(--mj-text)}.hud-body>button{margin-top:6px}';
    const header = document.createElement('div'); header.className = 'hud-header';
    const body = document.createElement('div'); body.className = 'hud-body';
    const title = document.createElement('div'); title.className = 'title'; title.textContent = 'mjai · read only';
    status = document.createElement('div'); status.className = 'status';
    action = document.createElement('div'); action.className = 'action';
    header.append(title); body.append(status, action); card.append(header, body);
    shadow.append(style, panelStyle, card); document.documentElement.append(host);
    highlight = globalThis.MajsoulHighlight?.create(body);
    globalThis.MajsoulPolicyUI?.create(body, updatePolicy);
    root = host;
    globalThis.MajsoulDisplaySettings?.create(body, updateDisplay);
    globalThis.MajsoulPanel?.create(host, header, title, body);
    globalThis.MjaiI18n?.create(card, body);
    render('Waiting for game traffic');
  }
  mount();
  if (!root) new MutationObserver((_, observer) => { mount(); if (root) observer.disconnect(); }).observe(document, {childList:true, subtree:true});
  function send(message) { try { port?.postMessage(message); } catch (_) {} }
  function sendPolicy(id, entry) {
    entry.pendingPolicy = policyRevision;
    send({kind:'policy', id, style:policy.style, intensity:policy.intensity, revision:policyRevision});
  }
  function updatePolicy(value) {
    if (!value || value.style === policy.style && value.intensity === policy.intensity) return;
    policy = value;
    policyRevision++;
    current = null;
    render('Style updated; applies at next decision');
    for (const [id, entry] of active) if (entry.connected) sendPolicy(id, entry);
  }
  function connect() {
    try {
      port = chrome.runtime.connect({name: CHANNEL});
    } catch (_) {
      port = null;
      render('Extension updated or unavailable; reload this game tab');
      return false;
    }
    port.onMessage.addListener(message => {
      if (message.kind === 'connection') {
        if (message.state === 'disconnected') { const entry = active.get(message.id); if (entry) entry.connected = false; if (!current || current === message.id) { current = null; render('Bridge disconnected; retrying'); } }
        else if (message.state === 'connected') {
          const entry = active.get(message.id);
          if (!entry) return;
          entry.connected = true; entry.replaying = true;
          render('Rebuilding game state');
          send({kind:'replay-start', id:message.id});
          sendPolicy(message.id, entry);
          if (entry.seat !== null) send({kind:'seat', id:message.id, seat:entry.seat});
          if (entry.valid) for (const data of entry.journal) send({kind:'frame', id:message.id, data});
          send({kind:'replay-end', id:message.id});
        } else if (message.state === 'ready') {
          const entry = active.get(message.id); if (entry) entry.replaying = false;
          if (!current) render('Bridge connected; waiting for game');
        }
        return;
      }
      if (message.kind !== 'suggestion' || !message.data || typeof message.data !== 'object') return;
      const value = message.data;
      const entry = active.get(message.id);
      if (value.type === 'status' && value.status === 'policy_updated') {
        // A late acknowledgement for an older selection must not unlock the UI.
        if (entry && value.revision === entry.pendingPolicy && value.revision === policyRevision) {
          entry.pendingPolicy = null;
          if (!entry.replaying) { current = null; render('Style updated; applies at next decision'); }
        }
        return;
      }
      if (value.type !== 'status' && entry?.pendingPolicy != null) return;
      if (value.type === 'status') {
        if (value.status === 'clear') { current = message.id; render('Analyzing'); }
        else if (value.status === 'needs_seat') { current = null; render('Seat not detected; reload the game'); }
        else if (value.status === 'seat_mismatch') { current = null; render('Seat changed; reload the game'); }
        else if (value.status === 'desynchronized') {
          const entry = active.get(message.id); current = null;
          if (entry && entry.valid && !entry.recoveryAttempted) {
            entry.recoveryAttempted = true; entry.connected = false;
            render('Recovering game state'); send({kind:'restart', id:message.id});
          } else render('Game state incomplete; reload the game');
        }
        return;
      }
      current = message.id;
      lastSuggestion = value;
      showSuggestion(value);
    });
    port.onDisconnect.addListener(() => {
      port = null; current = null; for (const entry of active.values()) entry.connected = false; render('Extension disconnected; retrying');
      setTimeout(() => { if (connect()) for (const id of active.keys()) send({kind:'open', id}); }, 2000);
    });
    return true;
  }
  connect();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || !event.data || event.data.channel !== CHANNEL) return;
    const {kind, id, buffer} = event.data;
    if (typeof id !== 'string' || !/^\d{1,12}$/.test(id)) return;
    if (kind === 'open') {
      if (!active.has(id)) active.set(id, {seat:null, journal:[], bytes:0, valid:true, connected:false, replaying:false, pendingPolicy:null, recoveryAttempted:false, pendingRestores:new Map()});
      send({kind, id});
    } else if (kind === 'close' || kind === 'reset') {
      active.delete(id); send({kind, id});
      if (current === id) { current = null; render('Waiting for game traffic'); }
    } else if (kind === 'seat' && active.has(id) && Number.isInteger(event.data.seat) && event.data.seat >= 0 && event.data.seat <= 3) {
      const entry = active.get(id), changed = entry.seat !== event.data.seat;
      entry.seat = event.data.seat;
      if (entry.connected && changed) {
        entry.connected = false; entry.recoveryAttempted = false;
        render('Rebuilding game state'); send({kind:'restart', id});
      }
    } else if (kind === 'frame' && active.has(id) && buffer instanceof ArrayBuffer && buffer.byteLength <= 1024 * 1024 + 4096) {
      const bytes = new Uint8Array(buffer), entry = active.get(id);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const data = btoa(binary);
      if (event.data.newRound === true) {
        // Preserve unpaired restore requests: their responses can arrive after a round starts.
        entry.journal = [...entry.pendingRestores.values()];
        entry.bytes = entry.journal.reduce((n, item) => n + item.length, 0);
        entry.valid = true; entry.recoveryAttempted = false;
      }
      if (Number.isInteger(event.data.restoreRequest)) {
        if (entry.pendingRestores.size >= 256) entry.pendingRestores.clear();
        entry.pendingRestores.set(event.data.restoreRequest, data);
        if (!entry.valid) { entry.journal = []; entry.bytes = 0; entry.valid = true; }
      }
      if (Number.isInteger(event.data.restoreResponse)) entry.pendingRestores.delete(event.data.restoreResponse);
      if (entry.valid) {
        if (entry.journal.length >= MAX_JOURNAL_FRAMES || entry.bytes + data.length > MAX_JOURNAL_BYTES) {
          entry.journal = []; entry.bytes = 0; entry.valid = false;
        } else { entry.journal.push(data); entry.bytes += data.length; }
      }
      if (entry.connected) send({kind:'frame', id, data});
    }

  });
})();
