import test from 'node:test';
import assert from 'node:assert/strict';
import {
  digitOrder, slotsOf, splayAngles, SPLIT_ANGLE,
  parseRoutine, swapHalf, HALF, ROUTINE, tokenOf, validateRoutine,
  compile, membersOf, defaultSets, sanitizeSets,
} from '../src/core.js';

/* ---- digits & slots ---------------------------------------- */
test('thumb is a prepend, never a branch', () => {
  assert.deepEqual(digitOrder(false), ['1','2','3','4']);
  assert.deepEqual(digitOrder(true),  ['T','1','2','3','4']);
});

test('slots are consecutive pairs only', () => {
  assert.deepEqual(slotsOf(digitOrder(false)), ['12','23','34']);
  assert.deepEqual(slotsOf(digitOrder(true)),  ['T1','12','23','34']);
});

test('slots generalise past five digits', () => {
  assert.deepEqual(slotsOf(['a','b','c']), ['ab','bc']);
  assert.equal(slotsOf(Array.from({length:17},(_,i)=>String(i))).length, 16);
});

/* ---- split model ------------------------------------------- */
test('an edge slot swings only the outer finger', () => {
  const order=digitOrder(false);
  assert.deepEqual(splayAngles(order,['34']), {1:0,2:0,3:0,4:SPLIT_ANGLE});
  assert.deepEqual(splayAngles(order,['12']), {1:-SPLIT_ANGLE,2:0,3:0,4:0});
});

test('the centre slot swings both halves apart', () => {
  const a=splayAngles(digitOrder(false),['23']);
  assert.deepEqual(a, {1:-SPLIT_ANGLE/2, 2:-SPLIT_ANGLE/2, 3:SPLIT_ANGLE/2, 4:SPLIT_ANGLE/2});
});

test('no splits means no rotation', () => {
  assert.deepEqual(splayAngles(digitOrder(true),[]), {T:0,1:0,2:0,3:0,4:0});
});

test('the median anchor minimises total motion', () => {
  // any alternative anchor must move the hand at least as much
  const order=digitOrder(false);
  for(const splits of [['12'],['23'],['34'],['12','34'],['12','23','34']]){
    const a=splayAngles(order,splits);
    const cost=off=>order.reduce((s,id)=>s+Math.abs(a[id]-off*SPLIT_ANGLE),0);
    for(const off of [-2,-1,1,2]) assert.ok(cost(0)<=cost(off), `${splits} beaten by offset ${off}`);
  }
});

/* ---- the routine ------------------------------------------- */
test('the half parses to 16 steps / 18 actions', () => {
  assert.equal(HALF.length, 16);
  assert.equal(HALF.flat().length, 18);
});

test('the full routine is 32 steps / 36 actions', () => {
  assert.equal(ROUTINE.length, 32);
  assert.equal(ROUTINE.flat().length, 36);
});

test('two steps are simultaneous pairs per half', () => {
  assert.equal(HALF.filter(s=>s.length>1).length, 2);
  assert.equal(tokenOf(HALF[3]), '-S1&S2');
});

test('no delimiter is needed between tokens', () => {
  assert.deepEqual(parseRoutine('b1s1-b1').map(tokenOf), ['B1','S1','-B1']);
  assert.deepEqual(parseRoutine('-s1&s2b2').map(tokenOf), ['-S1&S2','B2']);
});

test('swapping a half exchanges 1 and 2, keeping undo', () => {
  assert.deepEqual(swapHalf(parseRoutine('b1-s2&s1')).map(tokenOf), ['B2','-S1&S2']);
});

test('the second half is the first with sets swapped', () => {
  assert.deepEqual(ROUTINE.slice(16).map(tokenOf), swapHalf(HALF).map(tokenOf));
});

test('the holy sequence is legal', () => {
  assert.deepEqual(validateRoutine(ROUTINE), []);
});

test('the validator catches an impossible toggle', () => {
  // the historical bug: -b2 at step 5, unbending a set that was never bent
  const errs=validateRoutine(parseRoutine('b1s1-b1-s1&s2-b2'));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /step 5.*can't unbend B2.*not bent/);
});

test('every set returns to neutral, so playback loops', () => {
  const active={B1:false,B2:false,S1:false,S2:false};
  ROUTINE.forEach(step=>step.forEach(a=>{ active[a.set]=!a.undo; }));
  assert.deepEqual(active, {B1:false,B2:false,S1:false,S2:false});
});

/* ---- sets & compile ---------------------------------------- */
test('members come back in screen order, not insertion order', () => {
  const sets={...defaultSets(), B1:new Set(['3','1'])};
  assert.deepEqual(membersOf(sets,'B1',digitOrder(false)), ['1','3']);
});

test('compile produces one entry per step, ending at neutral', () => {
  const out=compile(defaultSets(), digitOrder(false));
  assert.equal(out.length, 32);
  assert.deepEqual(out.at(-1).state, {bends:[], splits:[]});
});

test('compile resolves tokens against the sets', () => {
  const out=compile(defaultSets(), digitOrder(false));   // B1={1,2} S1={34}
  assert.equal(out[0].token, 'B1');
  assert.equal(out[0].label, 'bend 1·2');
  assert.deepEqual(out[0].state, {bends:['1','2'], splits:[]});
  assert.equal(out[3].token, '-S1&S2');
  assert.equal(out[3].label, 'unsplit 34  &  split 12');
});

/* The regression this whole refactor exists for: with B1 and B2 sharing a
   finger, unbending B1 must not straighten a finger B2 is still holding.  */
test('overlapping bend sets: an unbend cannot steal a held finger', () => {
  const sets={B1:new Set(['1','2']), B2:new Set(['2','3']), S1:new Set(['34']), S2:new Set(['12'])};
  const out=compile(sets, digitOrder(false));
  assert.deepEqual(out[6].state.bends, ['1','2','3']);   // 7  B1  (B2 already on)
  assert.deepEqual(out[7].state.bends, ['1','2']);       // 8 -B2  — finger 2 stays, B1 holds it
  assert.deepEqual(out[9].state.bends, ['2','3']);       // 10 -B1 — finger 2 stays, B2 holds it
});

test('a held member is called out in the instruction text', () => {
  const sets={B1:new Set(['1','2']), B2:new Set(['2','3']), S1:new Set(['34']), S2:new Set(['12'])};
  const out=compile(sets, digitOrder(false));
  assert.equal(out[7].label, 'unbend 2·3 (2 stays bent)');
});

test('overlapping sets still land on neutral', () => {
  const sets={B1:new Set(['1','2']), B2:new Set(['2','3']), S1:new Set(['12','23']), S2:new Set(['23','34'])};
  assert.deepEqual(compile(sets, digitOrder(false)).at(-1).state, {bends:[], splits:[]});
});

test('empty sets compile without crashing', () => {
  const sets={B1:new Set(), B2:new Set(), S1:new Set(), S2:new Set()};
  const out=compile(sets, digitOrder(false));
  assert.equal(out.length, 32);
  assert.equal(out[0].label, 'bend ∅');
  assert.deepEqual(out[0].state, {bends:[], splits:[]});
});

test('the thumb participates like any other digit', () => {
  const order=digitOrder(true);
  const sets={B1:new Set(['T','1']), B2:new Set(['4']), S1:new Set(['T1']), S2:new Set(['34'])};
  const out=compile(sets, order);
  assert.deepEqual(out[0].state.bends, ['T','1']);
  assert.deepEqual(out[1].state.splits, ['T1']);
});

/* ---- sanitizeSets (storage restore + thumb clamp) ----------- */
test('sanitize drops members that do not exist for the digit order', () => {
  const got = sanitizeSets({B1:['1','T','9'], B2:[], S1:['T1','34','13'], S2:[]}, digitOrder(false));
  assert.deepEqual([...got.B1], ['1']);        // T has no digit, 9 is nonsense
  assert.deepEqual([...got.S1], ['34']);       // T1 has no slot, 13 is non-adjacent
});

test('sanitize keeps thumb members when the thumb is on', () => {
  const got = sanitizeSets({B1:['T','1'], B2:[], S1:['T1'], S2:[]}, digitOrder(true));
  assert.deepEqual([...got.B1], ['T','1']);
  assert.deepEqual([...got.S1], ['T1']);
});

test('sanitize accepts Sets as well as arrays, and survives junk', () => {
  const fromSets = sanitizeSets({B1:new Set(['2']), S2:new Set(['23'])}, digitOrder(false));
  assert.deepEqual([...fromSets.B1], ['2']);
  assert.deepEqual([...fromSets.S2], ['23']);
  for(const junk of [null, undefined, 42, 'nope', {B1:'12'}, {B1:{}}]){
    const got = sanitizeSets(junk, digitOrder(false));
    assert.deepEqual(Object.keys(got), ['B1','B2','S1','S2']);
    for(const k of Object.keys(got)) assert.equal(got[k].size, 0);
  }
});

test('sanitized sets always compile', () => {
  const sets = sanitizeSets({B1:['1','T'], B2:['4'], S1:['34'], S2:['13']}, digitOrder(false));
  const out = compile(sets, digitOrder(false));
  assert.equal(out.length, 32);
  assert.deepEqual(out.at(-1).state, {bends:[], splits:[]});
});
