(() => {
'use strict';

// Event summaries are extracted from the server's decoded ActionPrototype.
// Return 'match', 'conflict' or 'waiting' for this submitted operation.
function confirm(snapshot, action, event) {
  if (!snapshot || !action || !event || typeof event.type !== 'string') return 'waiting';
  const seat = snapshot.seat;
  if (action.cancel_operation) return event.step > snapshot.step ? 'match' : 'waiting';
  if (action.method === 'inputOperation' && [1,7].includes(action.type)) {
    if (event.type !== 'ActionDiscardTile' || event.seat !== seat) return 'waiting';
    return event.tile === action.tile && Boolean(event.is_liqi) === (action.type === 7) ? 'match' : 'conflict';
  }
  if (action.method === 'inputChiPengGang' && [2,3,5].includes(action.type)) {
    if (event.type !== 'ActionChiPengGang' || event.seat !== seat) return 'waiting';
    const expectedType = {2:0,3:1,5:2}[action.type];
    const combinations = snapshot.operations.filter(item => item.type === action.type);
    if (combinations.length !== 1) return 'conflict';
    const pair = combinations[0].combination?.[action.index];
    if (typeof pair !== 'string' || !Array.isArray(event.tiles)) return 'conflict';
    const expected = [...pair.split('|'), snapshot.called].sort();
    const actual = [...event.tiles].sort();
    return event.meldType === expectedType && expected.length === actual.length &&
      expected.every((tile, index) => tile === actual[index]) ? 'match' : 'conflict';
  }
  if (action.method === 'inputChiPengGang' && [4,6].includes(action.type)) {
    if (event.type !== 'ActionAnGangAddGang' || event.seat !== seat) return 'waiting';
    const op = snapshot.operations.filter(item => item.type === action.type);
    const choice = op.length === 1 && op[0].combination?.[action.index];
    if (typeof choice !== 'string' || typeof event.tile !== 'string') return 'conflict';
    const base = tile => tile.replace(/^0([mps])$/, '5$1');
    const tiles = choice.split('|');
    return event.meldType === (action.type === 4 ? 3 : 2) && tiles.length === 4 &&
      tiles.every(tile => base(tile) === base(event.tile)) ? 'match' : 'conflict';
  }
  if (action.method === 'inputOperation' && [8,9].includes(action.type)) {
    if (event.type !== 'ActionHule') return 'waiting';
    return Array.isArray(event.winners) && event.winners.includes(seat) ? 'match' : 'conflict';
  }
  if (action.method === 'inputOperation' && action.type === 10)
    return event.type === 'ActionLiuJu' && event.seat === seat && event.reason === 1 ? 'match' : 'waiting';
  return 'waiting';
}
globalThis.MjaiConfirmation = {confirm};

})();
