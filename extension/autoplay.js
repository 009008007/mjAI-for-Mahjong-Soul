(() => {
'use strict';

// Converts MJAI recommendations into operations for the exact game snapshot.
const suits = {E:'1z', S:'2z', W:'3z', N:'4z', P:'5z', F:'6z', C:'7z'};
function wireTile(tile) {
  if (Object.hasOwn(suits, tile)) return suits[tile];
  if (typeof tile !== 'string') return null;
  if (/^5[mps]r$/.test(tile)) return '0' + tile[1];
  return /^[1-9][mps]$/.test(tile) ? tile : null;
}
function resolve(snapshot, recommendation) {
  if (!snapshot || !recommendation || !Number.isInteger(snapshot.seat) ||
      snapshot.seat !== recommendation.actor && recommendation.type !== 'none' ||
      !Array.isArray(snapshot.operations) || recommendation.source !== 'model') return null;
  const operations = snapshot.operations;
  function offered(type) {
    const matches = operations.filter(entry => entry.type === type);
    return matches.length === 1 ? matches[0] : null;
  }
  function discard(tile, riichi) {
    const choice = wireTile(tile);
    const operation = offered(riichi ? 7 : 1);
    if (!choice || !operation || !Array.isArray(snapshot.hand) ||
        !snapshot.hand.includes(choice) ||
        !riichi && Array.isArray(operation.combination) && operation.combination.includes(choice) ||
        riichi && (!Array.isArray(operation.combination) || !operation.combination.includes(choice))) return null;
    const drawn = riichi ? recommendation.riichi_hand_index === recommendation.drawn_index &&
      Number.isInteger(recommendation.drawn_index) : recommendation.tsumogiri === true;
    if (drawn && snapshot.drawn !== choice) return null;
    return {method:'inputOperation', type:riichi ? 7 : 1, tile:choice, moqie:drawn};
  }
  switch (recommendation.type) {
    case 'dahai': return discard(recommendation.pai, false);
    case 'reach': return discard(recommendation.riichi_discard, true);
    case 'chi': {
      const operation = offered(2);
      if (!operation || !Array.isArray(operation.combination) ||
          !Array.isArray(recommendation.consumed) || recommendation.consumed.length !== 2 ||
          wireTile(recommendation.pai) !== snapshot.called || snapshot.callSource !== 'discard') return null;
      const tiles = recommendation.consumed.map(wireTile);
      if (tiles.some(tile => !tile)) return null;
      const key = tiles.sort().join('|');
      const matches = operation.combination.flatMap((value, index) => {
        if (typeof value !== 'string') return [];
        const pair = value.split('|');
        return pair.length === 2 && pair.every(tile => /^(?:[0-9][mps]|[1-7]z)$/.test(tile)) &&
          pair.sort().join('|') === key ? [index] : [];
      });
      return matches.length === 1 ? {method:'inputChiPengGang', type:2, index:matches[0]} : null;
    }
    case 'pon':
    case 'daiminkan': {
      const type = recommendation.type === 'pon' ? 3 : 5;
      const operation = offered(type);
      if (!operation || snapshot.callSource !== 'discard' ||
          wireTile(recommendation.pai) !== snapshot.called ||
          !Array.isArray(recommendation.consumed) ||
          !Array.isArray(operation.combination)) return null;
      const tiles = recommendation.consumed.map(wireTile);
      if (tiles.some(tile => !tile)) return null;
      const key = tiles.sort().join('|');
      const matches = operation.combination.flatMap((value, index) =>
        typeof value === 'string' && value.split('|').sort().join('|') === key ? [index] : []);
      return matches.length === 1 ? {method:'inputChiPengGang', type, index:matches[0]} : null;
    }
    case 'ankan':
    case 'kakan': {
      const type = recommendation.type === 'ankan' ? 4 : 6;
      const operation = offered(type);
      if (!operation || !Array.isArray(operation.combination) || !Array.isArray(recommendation.consumed)) return null;
      const tiles = (type === 4 ? recommendation.consumed : [...recommendation.consumed, recommendation.pai]).map(wireTile);
      if (tiles.length !== 4 || tiles.some(tile => !tile)) return null;
      const key = tiles.sort().join('|');
      const matches = operation.combination.flatMap((value, index) =>
        typeof value === 'string' && value.split('|').sort().join('|') === key ? [index] : []);
      return matches.length === 1 ? {method:'inputChiPengGang',type,index:matches[0]} : null;
    }
    case 'hora': {
      // The game operation list is authoritative; model target can be stale.
      const wins = [8,9].filter(type => offered(type));
      return wins.length === 1 ? {method:'inputOperation', type:wins[0]} : null;
    }
    case 'ryukyoku': return offered(10) ? {method:'inputOperation', type:10} : null;
    case 'none':
      return snapshot.callSource === 'discard' && operations.some(entry => [2,3,5,9].includes(entry.type))
        ? {method:'inputChiPengGang', cancel_operation:true} : null;
    default: return null;
  }
}

// The adapter owns one snapshot, transport and timer. It must feed responses and
// game events to this controller and keep snapshot keys current.
function createController({now, random, schedule, cancel, send, status}) {
  let enabled = false, generation = 0, timer = null, pending = null, confirmationTimer = null;
  function clearTimer() {
    if (timer !== null) cancel(timer);
    timer = null;
  }
  function stop(reason) {
    enabled = false;
    generation++;
    clearTimer();
    if (confirmationTimer !== null) cancel(confirmationTimer);
    confirmationTimer = null;
    pending = null;
    status(reason);
  }
  function start(quiet = false) {
    if (pending) return;
    generation++;
    clearTimer();
    pending = null;
    enabled = true;
    if (!quiet) status('waiting');
  }
  function offer(snapshot, recommendation) {
    if (!enabled || pending) return;
    clearTimer();
    generation++;
    const token = generation;
    const command = resolve(snapshot, recommendation);
    if (!command || !Number.isFinite(snapshot.openedAt) || !Number.isFinite(snapshot.deadline)) {
      stop('unresolved');
      return;
    }
    const started = now();
    const available = Math.floor(snapshot.deadline - 250 - started);
    if (available < 0) { status('missed', snapshot.key); return; }
    // The command is resolved from the same recommendation as the green mark.
    // If inference took most of the turn, send that verified command promptly.
    const maxDelay = Math.min(3000, available);
    const delay = available < 1000 ? 0 : 1000 + Math.floor(random() * (maxDelay - 999));
    const due = started + delay;
    timer = schedule(() => {
      if (!enabled || token !== generation) return;
      timer = null;
      if (now() < due || now() > snapshot.deadline - 250) {
        status('missed', snapshot.key);
        return;
      }
      const requestId = send(snapshot.key, command);
      if (!Number.isInteger(requestId)) {
        stop('send_failed');
        return;
      }
      pending = {requestId, key:snapshot.key, command};
      const awaiting = pending;
      // Leave enough of the current decision window for a visible-target fallback.
      const clickFallback = command.method === 'inputOperation' && [1,8,9].includes(command.type);
      const confirmationDelay = clickFallback ? Math.max(100, Math.min(1500, snapshot.deadline - now() - 500)) : 5000;
      confirmationTimer = schedule(() => {
        if (enabled && token === generation && pending === awaiting) stop('confirmation_timeout');
      }, confirmationDelay);
      status('awaiting_confirmation');
    }, Math.max(0, due - now()));
    status(delay === 0 ? 'fallback' : 'scheduled');
  }
  function response(requestId, result) {
    if (!pending || pending.requestId !== requestId) return;
    if (result?.ok === false) return stop('rejected');
    if (result?.ok !== true) status('response_unknown');
  }
  function observed(key, matches) {
    if (!pending || pending.key !== key) return;
    if (!matches) return stop('conflict');
    cancel(confirmationTimer); confirmationTimer = null; pending = null; status('confirmed');
  }
  function invalidate() {
    if (pending) return stop('state_changed');
    generation++;
    clearTimer();
  }
  return {start, stop, offer, response, observed, invalidate, isEnabled:() => enabled};
}
globalThis.MjaiAutoplay = {wireTile, resolve, createController};

})();
