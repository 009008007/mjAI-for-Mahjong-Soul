// Isolated world: render the HUD and coordinate recommendations and autoplay.
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
  let autoEnabled = false, autoTask = null, autoCounter = 0, autoCheckbox, autoStatus, deferredAuto, autoSession = '';
  let fallbackTask = null, fallbackTimer = null;
  const gateAttribute = 'data-mjai-autoplay-session';
  function armGate() {
    autoSession = `${Date.now()}-${Math.random()}-${++autoCounter}`;
    document.documentElement.setAttribute(gateAttribute, autoSession);
  }
  function closeGate() {
    if (document.documentElement.getAttribute(gateAttribute) === autoSession)
      document.documentElement.removeAttribute(gateAttribute);
    autoSession = '';
  }
  function cancelFallbackClick(task) {
    if (task.token === null) return;
    send({kind:'fallback_cancel', id:task.id, token:task.token});
    task.token = null;
  }
  function clearFallback() {
    if (fallbackTask) cancelFallbackClick(fallbackTask);
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    fallbackTimer = null; fallbackTask = null;
  }
  function fallbackStatus(value) {
    if (autoStatus) autoStatus.textContent = 'Auto status: ' + value;
  }
  function attemptFallback(id) {
    const entry = active.get(id), value = entry?.autoAdvice, snapshot = entry?.autoSnapshot;
    if (id !== current || !autoEnabled || !autoCheckbox?.checked || !autoSession ||
        document.documentElement.getAttribute(gateAttribute) !== autoSession || !entry ||
        !entry.connected || entry.replaying || !snapshot || !value || value !== lastSuggestion ||
        value.frame_serial !== entry.serial || snapshot.key.serial !== entry.serial ||
        entry.fallbackSerial === entry.serial || entry.nativeSerial === entry.serial) return false;
    const command = globalThis.MjaiAutoplay.resolve(snapshot, value);
    if (!command || !['dahai','hora'].includes(value.type)) { fallbackStatus('fallback_unavailable'); return false; }
    const target = highlight?.fallbackTarget?.(value);
    if (!target) { fallbackStatus('fallback_unavailable'); return false; }
    entry.fallbackSerial = entry.submittedSerial = entry.serial;
    clearFallback();
    fallbackTask = {id, token:null, snapshot, command, value, session:autoSession, canvas:target.canvas,
      committed:false, clicks:0, nativeSent:false};
    beginFallbackClick(fallbackTask);
    return true;
  }
  function beginFallbackClick(task) {
    task.token = ++autoCounter;
    send({kind:'fallback_begin', id:task.id, token:task.token});
    fallbackStatus(task.clicks ? 'fallback_second_click' : 'fallback_preparing');
    watchFallback(task, 1500, () => {
      cancelFallbackClick(task);
      fallbackStatus('fallback_input_failed');
    });
  }
  function watchFallback(task, delay, callback) {
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    const timer = setTimeout(() => {
      if (fallbackTask !== task || fallbackTimer !== timer) return;
      fallbackTimer = null;
      callback();
    }, delay);
    fallbackTimer = timer;
  }
  function retryFallback(task) {
    // One click can lift a tile without sending a request. Only try the
    // second press while the same decision is open and no input was sent.
    return task.clicks === 1 && task.command.type === 1 && !task.nativeSent &&
      performance.now() + 300 < task.snapshot.deadline;
  }
  function receiveFallback(message) {
    const task = fallbackTask;
    if (!task || task.id !== message.id || task.token !== message.token) return;
    if (message.kind === 'fallback_ready') {
      const entry = active.get(task.id);
      const target = autoEnabled && autoCheckbox?.checked && autoSession === task.session &&
        document.documentElement.getAttribute(gateAttribute) === task.session &&
        current === task.id && lastSuggestion === task.value && entry?.connected && !entry.replaying &&
        entry.serial === task.snapshot.key.serial && entry.nativeSerial !== entry.serial &&
        (!task.clicks || retryFallback(task)) && highlight?.fallbackTarget?.(task.value);
      if (!target || target.canvas !== task.canvas) { clearFallback(); fallbackStatus('fallback_unavailable'); return; }
      task.committed = true;
      send({kind:'fallback_target', id:task.id, token:task.token, x:target.x, y:target.y, checkedAt:Date.now()});
    } else if (message.state === 'clicked') {
      task.token = null;
      task.clicks++;
      fallbackStatus('fallback_click');
      if (retryFallback(task)) {
        watchFallback(task, 220, () => {
          if (retryFallback(task)) beginFallbackClick(task);
          else watchFallback(task, 2000, () => fallbackStatus('fallback_unconfirmed'));
        });
      } else watchFallback(task, 2000, () => fallbackStatus('fallback_unconfirmed'));
    } else {
      clearFallback();
      fallbackStatus(message.state === 'stale' ? 'fallback_unavailable' : 'fallback_input_failed');
    }
  }
  function observeNativeOperation(id, {serial, command}) {
    const entry = active.get(id);
    if (!entry || serial !== entry.serial) return;
    entry.nativeSerial = serial;
    if (!autoEnabled || (id !== current && id !== autoTask?.socketId && id !== fallbackTask?.id)) return;
    const task = fallbackTask;
    if (task?.id === id && task.committed && task.snapshot.key.serial === serial &&
        command?.method === task.command.method && command.type === task.command.type && command.tile === task.command.tile) {
      task.nativeSent = true;
      cancelFallbackClick(task);
      fallbackStatus('fallback_submitted');
      watchFallback(task, 5000, () => fallbackStatus('fallback_unconfirmed'));
    } else stopAuto('manual');
  }
  const auto = globalThis.MjaiAutoplay?.createController({
    now: () => performance.now(),
    random: () => Math.random(),
    schedule: (fn, delay) => setTimeout(fn, delay),
    cancel: id => clearTimeout(id),
    send: (key, command) => {
      const entry = active.get(key.socketId);
      if (!autoEnabled || !autoCheckbox?.checked || !autoSession ||
          document.documentElement.getAttribute(gateAttribute) !== autoSession ||
          current !== key.socketId || !entry || entry.serial !== key.serial ||
          entry.submittedSerial === key.serial || entry.nativeSerial === key.serial ||
          entry.replaying || !entry.connected) return null;
      const localId = ++autoCounter;
      autoTask = {key, command, localId, socketId:current, requestId:null};
      entry.submittedSerial = key.serial;
      window.postMessage({channel:'majsoul-auto-v1', kind:'submit', id:current, serial:key.serial, localId,
        session:autoSession, action:command, timeuse:Math.max(0, Math.floor((performance.now() - key.openedAt) / 1000))}, location.origin);
      return localId;
    },
    status: (value, key) => {
      const fallbackId = autoTask?.socketId ?? key?.socketId;
      if (autoStatus) autoStatus.textContent = 'Auto status: ' + value;
      if (value === 'confirmed') {
        if (Number.isInteger(autoTask?.requestId)) window.postMessage({channel:'majsoul-auto-v1', kind:'complete',
          id:autoTask.socketId, requestId:autoTask.requestId}, location.origin);
        autoTask = null;
        const deferred = deferredAuto;
        deferredAuto = null;
        if (deferred) setTimeout(() => offerAuto(deferred.id, deferred.value), 0);
      }
      if (['unresolved','expired','send_failed','rejected','conflict','state_changed','confirmation_timeout'].includes(value)) {
        if (Number.isInteger(autoTask?.requestId)) window.postMessage({channel:'majsoul-auto-v1',kind:'complete',
          id:autoTask.socketId,requestId:autoTask.requestId},location.origin);
        autoTask = null;
        deferredAuto = null;
        if (autoEnabled) armGate();
      }
      if (fallbackId && ['missed','confirmation_timeout','send_failed'].includes(value)) attemptFallback(fallbackId);
    },
  });
  function stopAuto(reason) {
    clearFallback();
    if (reason === 'off') { autoEnabled = false; closeGate(); }
    else if (autoEnabled) armGate();
    if (Number.isInteger(autoTask?.requestId)) window.postMessage({channel:'majsoul-auto-v1',kind:'complete',
      id:autoTask.socketId,requestId:autoTask.requestId},location.origin);
    auto?.stop(reason);
    autoTask = null;
    deferredAuto = null;
    if (autoCheckbox) autoCheckbox.checked = autoEnabled;
  }
  function offerAuto(id, value) {
    const entry = active.get(id), data = value.opportunity;
    if (!autoEnabled || !entry || !data || entry.submittedSerial === entry.serial || entry.nativeSerial === entry.serial ||
      !Number.isSafeInteger(entry.serial) || entry.serial <= 0 || value.frame_serial !== entry.serial ||
      entry.replaying || !entry.connected || !Number.isFinite(entry.receivedAt)) return;
    if (!entry.lastSummary || data.step !== entry.lastSummary.step ||
        data.source?.replace(/^\.lq\./, '') !== entry.lastSummary.type) return stopAuto('state_changed');
    if (autoTask) { deferredAuto = {id, value}; return; }
    const wireTile = globalThis.MjaiAutoplay.wireTile;
    if (!Array.isArray(data.hand) || !Array.isArray(data.operations)) return stopAuto('unresolved');
    const budget = data.time_fixed + data.time_add;
    const key = {socketId:id,serial:entry.serial,openedAt:entry.receivedAt};
    const snapshot = {
      ...data, key, openedAt:entry.receivedAt,
      deadline:Number.isFinite(budget) && budget > 0 && budget <= 120000 ? entry.receivedAt + budget : performance.now() - 1,
      hand:data.hand.map(wireTile), drawn:wireTile(data.drawn),
      callSource:data.source?.endsWith('ActionDiscardTile') ? 'discard' : 'self',
      called:entry.lastSummary?.type === 'ActionDiscardTile' ? entry.lastSummary.tile : null,
    };
    autoTask = null;
    entry.autoSnapshot = snapshot;
    entry.autoAdvice = value;
    if (!auto.isEnabled()) auto.start(true);
    auto.offer(snapshot, value);
  }
  function chiMeld(value) {
    if (value.type !== 'chi' || !Array.isArray(value.consumed) || value.consumed.length !== 2) return null;
    const tiles = [value.pai, ...value.consumed];
    if (!tiles.every(tile => typeof tile === 'string' && /^(?:[1-9][mps]|5[mps]r)$/.test(tile) && tile[1] === value.pai[1])) return null;
    tiles.sort();
    const ranks = tiles.map(tile => Number(tile[0]));
    if (ranks[0] + 1 !== ranks[1] || ranks[1] + 1 !== ranks[2]) return null;
    const suit = {m:'Characters', p:'Dots', s:'Bamboo'}[value.pai[1]];
    const red = tiles.some(tile => tile.length === 3) ? ' (red five)' : '';
    return `${ranks.join('')} ${suit}${red}`;
  }
  function showSuggestion(value) {
    const labels = {dahai:'Discard', reach:'Riichi', hora:'Win', ryukyoku:'Draw', chi:'Chi', pon:'Pon', daiminkan:'Open kan', ankan:'Closed kan', kakan:'Added kan', none:'Pass'};
    if (!Object.hasOwn(labels, value.type)) return;
    const meld = chiMeld(value);
    const tile = typeof value.pai === 'string' && /^(?:[1-9][mps]r?|[ESWNPFC]|\?)$/.test(value.pai) ? ` ${value.pai}` : '';
    const consumed = Array.isArray(value.consumed) && value.consumed.every(x => typeof x === 'string' && /^(?:[1-9][mps]r?|[ESWNPFC])$/.test(x)) ? `\nUse: ${value.consumed.join(' ')}` : '';
    const riichiDiscard = value.type === 'reach' && typeof value.riichi_discard === 'string' &&
      /^(?:[1-9][mps]r?|[ESWNPFC])$/.test(value.riichi_discard)
      ? `\nRiichi discard: ${value.riichi_discard}` : '';
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
    render('Suggestion', `${labels[value.type]}${meld ? ` ${meld}` : tile}${consumed}${riichiDiscard}${shanten}${demo}${warning}`);
    if (meld && display.best) action.className = 'action chi-suggestion';
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
    action.className = 'action';
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
    panelStyle.textContent += '.chi-suggestion{border-inline-start:3px solid #28b961;padding-inline-start:7px}';
    const header = document.createElement('div'); header.className = 'hud-header';
    const body = document.createElement('div'); body.className = 'hud-body';
    const title = document.createElement('div'); title.className = 'title'; title.textContent = 'mjai';
    status = document.createElement('div'); status.className = 'status';
    action = document.createElement('div'); action.className = 'action';
    header.append(title); body.append(status, action); card.append(header, body);
    shadow.append(style, panelStyle, card); document.documentElement.append(host);
    highlight = globalThis.MajsoulHighlight?.create(body);
    globalThis.MajsoulPolicyUI?.create(body, updatePolicy);
    root = host;
    globalThis.MajsoulDisplaySettings?.create(body, updateDisplay);
    const autoLabel = document.createElement('label');
    Object.assign(autoLabel.style, {display:'block',pointerEvents:'auto',cursor:'pointer'});
    autoCheckbox = document.createElement('input'); autoCheckbox.type='checkbox'; autoCheckbox.checked=false;
    const autoLabelText = document.createElement('span'); autoLabelText.textContent='Enable autoplay';
    autoLabel.append(autoCheckbox, autoLabelText);
    autoStatus = document.createElement('div'); autoStatus.textContent='Auto status: off';
    body.append(autoLabel, autoStatus);
    autoCheckbox.addEventListener?.('change', () => {
      if (!autoCheckbox.checked) return stopAuto('off');
      autoEnabled = true; armGate(); auto.start();
      if (current && lastSuggestion) offerAuto(current, lastSuggestion);
    });
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
    if (autoEnabled) stopAuto('state_changed');
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
      if (message?.kind === 'fallback_ready' || message?.kind === 'fallback_result') {
        receiveFallback(message); return;
      }
      if (message.kind === 'connection') {
        if (message.state === 'disconnected') { const entry = active.get(message.id); if (entry) entry.connected = false; if (autoEnabled) stopAuto('state_changed'); if (!current || current === message.id) { current = null; render('Bridge disconnected; retrying'); } }
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
          if (autoEnabled) stopAuto('state_changed');
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
      offerAuto(message.id, value);
    });
    port.onDisconnect.addListener(() => {
      if (autoEnabled) stopAuto('state_changed');
      port = null; current = null; for (const entry of active.values()) entry.connected = false; render('Extension disconnected; retrying');
      setTimeout(() => { if (connect()) for (const id of active.keys()) send({kind:'open', id}); }, 2000);
    });
    return true;
  }
  connect();
  window.addEventListener('pagehide', clearFallback);
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || !event.data || event.data.channel !== CHANNEL) return;
    const {kind, id, buffer} = event.data;
    if (typeof id !== 'string' || !/^\d{1,12}$/.test(id)) return;
    if (kind === 'open') {
      if (!active.has(id)) active.set(id, {seat:null, journal:[], bytes:0, valid:true, connected:false, replaying:false, pendingPolicy:null, recoveryAttempted:false, pendingRestores:new Map(), serial:0});
      send({kind, id});
    } else if (kind === 'close' || kind === 'reset') {
      if (autoEnabled) stopAuto('state_changed');
      active.delete(id); send({kind, id});
      if (current === id) { current = null; render('Waiting for game traffic'); }
    } else if (kind === 'seat' && active.has(id) && Number.isInteger(event.data.seat) && event.data.seat >= 0 && event.data.seat <= 3) {
      const entry = active.get(id), changed = entry.seat !== event.data.seat;
      entry.seat = event.data.seat;
      if (entry.connected && changed) {
        if (autoEnabled) stopAuto('state_changed');
        entry.connected = false; entry.recoveryAttempted = false;
        render('Rebuilding game state'); send({kind:'restart', id});
      }
    } else if (kind === 'frame' && active.has(id) && buffer instanceof ArrayBuffer && buffer.byteLength <= 1024 * 1024 + 4096) {
      const bytes = new Uint8Array(buffer), entry = active.get(id);
      if (Number.isSafeInteger(event.data.serial) && event.data.serial > 0) {
        entry.serial = event.data.serial;
        entry.receivedAt = performance.now();
        entry.lastSummary = event.data.summary;
        if (fallbackTask?.id === id) {
          const task = fallbackTask;
          const result = event.data.summary?.step > task.snapshot.step
            ? globalThis.MjaiConfirmation.confirm(task.snapshot, task.command, event.data.summary) : 'waiting';
          if (result !== 'waiting' || !task.nativeSent || event.data.newRound === true) {
            clearFallback();
            if (result === 'match') fallbackStatus(task.committed ? 'fallback_confirmed' : 'confirmed');
            else if (task.committed) fallbackStatus(result === 'conflict' ? 'fallback_conflict' : 'fallback_unconfirmed');
          }
        }
        if (autoTask && autoTask.socketId === id && entry.autoSnapshot && event.data.summary) {
          const result = globalThis.MjaiConfirmation.confirm(entry.autoSnapshot, autoTask.command, event.data.summary);
          if (result !== 'waiting') auto.observed(autoTask.key, result === 'match');
        } else if (autoEnabled && id === current && !autoTask) auto.invalidate();
      }
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
        if (autoEnabled) stopAuto('state_changed');
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
      if (entry.connected) send({kind:'frame', id, data, serial:event.data.serial});
    } else if (kind === 'auto_sent' && autoTask && autoTask.socketId === id && event.data.localId === autoTask.localId && event.data.serial === autoTask.key.serial) {
      autoTask.requestId = event.data.requestId;
    } else if (kind === 'auto_response' && autoTask && autoTask.socketId === id && event.data.requestId === autoTask.requestId) {
      auto.response(autoTask.localId, event.data.result);
    } else if (kind === 'auto_send_failed' && autoTask && autoTask.socketId === id && event.data.localId === autoTask.localId) {
      stopAuto('send_failed');
    } else if (kind === 'manual_operation') {
      observeNativeOperation(id, event.data);
    }

  });
})();
