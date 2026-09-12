import test from 'node:test';
import assert from 'node:assert/strict';
import {
  digitOrder, slotsOf, splayAngles, SPLIT_ANGLE, SET_KEYS,
  parseRoutine, swapHalf, HALF, ROUTINE, tokenOf, validateRoutine,
  compile, membersOf, defaultSets, sanitizeSets, hasIllegalOverlap, hasSiblingSubset, randomSets,
  countPossibleCombinations,
} from '../src/core.js';

/* A step is "motionless" if the hand's bends/splits are identical to
   whatever they were before it — i.e. the step's action(s) changed
   nothing visible, regardless of what the instruction text claims. */
function hasMotionlessStep(sets, order){
  let prev = {bends:[], splits:[]};
  return compile(sets, order).some(c => {
    const same = JSON.stringify(c.state)===JSON.stringify(prev);
    prev = c.state;
    return same;
  });
}

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

/* ---- hard mode: no split while a bordering digit is folded --- */
test('a split slot with a bent border is illegal', () => {
  assert.equal(hasIllegalOverlap(['1','2'], ['12']), true);
  assert.equal(hasIllegalOverlap(['4'], ['34']), true);
  assert.equal(hasIllegalOverlap(['2'], ['23']), true);
  assert.equal(hasIllegalOverlap(['3'], ['23']), true);
});

test('a split slot with no bent border is legal', () => {
  assert.equal(hasIllegalOverlap([], ['12','23','34']), false);
  assert.equal(hasIllegalOverlap(['1','4'], ['23']), false);
});

test('the default sets never produce an illegal overlap', () => {
  const order = digitOrder(false);
  const bad = compile(defaultSets(), order).some(c => hasIllegalOverlap(c.state.bends, c.state.splits));
  assert.equal(bad, false);
});

/* ---- nested sets: only FULL containment can cause a motionless step -- */
test('one set fully containing the other is a sibling subset', () => {
  assert.equal(hasSiblingSubset({B1:new Set(['1']), B2:new Set(['1']), S1:new Set(), S2:new Set()}), true);
  assert.equal(hasSiblingSubset({B1:new Set(), B2:new Set(), S1:new Set(['12']), S2:new Set(['12'])}), true);
  // proper subset counts too, in either direction
  assert.equal(hasSiblingSubset({B1:new Set(['1']), B2:new Set(['1','2']), S1:new Set(), S2:new Set()}), true);
  assert.equal(hasSiblingSubset({B1:new Set(['1','2']), B2:new Set(['1']), S1:new Set(), S2:new Set()}), true);
});

test('disjoint or merely partially-overlapping sibling sets are not a sibling subset', () => {
  assert.equal(hasSiblingSubset(defaultSets()), false);
  assert.equal(hasSiblingSubset({B1:new Set(['1']), B2:new Set(['2']), S1:new Set(['12']), S2:new Set(['34'])}), false);
  // the user's own example: real overlap (2 and 3 are in both), but neither
  // set is a subset of the other, since B1 has 4 (not in B2) and B2 has 1
  // (not in B1)
  assert.equal(hasSiblingSubset({B1:new Set(['2','3','4']), B2:new Set(['1','2','3']), S1:new Set(), S2:new Set()}), false);
});

test("the user's partial-overlap example never produces a motionless step", () => {
  const order = digitOrder(false);
  const sets = {B1:new Set(['2','3','4']), B2:new Set(['1','2','3']), S1:new Set(['12']), S2:new Set(['34'])};
  assert.equal(hasMotionlessStep(sets, order), false);
});

test('a sibling subset does produce a motionless step somewhere in the routine', () => {
  const order = digitOrder(false);
  // B2 is a proper subset of B1: whenever B2 toggles while B1 is already
  // active (or vice versa), nothing about the hand actually changes.
  const sets = {B1:new Set(['1','4']), B2:new Set(['1']), S1:new Set(['23']), S2:new Set(['34'])};
  assert.equal(hasMotionlessStep(sets, order), true);
});

/* B1/B2 and S1/S2 don't behave the same way in ROUTINE: B1/B2 spend real
   stretches simultaneously active, so any containment (proper or equal)
   between them stalls a step; S1/S2 only ever swap atomically and are
   never simultaneously active, so a swap between a PROPER subset still
   visibly changes the open slots — only exact equality stalls. This is
   verified against the actual compiled routine, not asserted on faith. */
test('S1/S2 tolerate a proper subset (never simultaneously active, so a swap still moves something)', () => {
  const order = digitOrder(false);
  const sets = {B1:new Set(['1']), B2:new Set(['4']), S1:new Set(['12']), S2:new Set(['12','23'])};
  assert.equal(hasSiblingSubset(sets), false);
  assert.equal(hasMotionlessStep(sets, order), false);
});

test('S1/S2 only stall on exact equality', () => {
  const order = digitOrder(false);
  const sets = {B1:new Set(['1']), B2:new Set(['4']), S1:new Set(['12','23']), S2:new Set(['12','23'])};
  assert.equal(hasSiblingSubset(sets), true);
  assert.equal(hasMotionlessStep(sets, order), true);
});

test('B1/B2, unlike S1/S2, already stall on a proper (non-equal) subset', () => {
  const order = digitOrder(false);
  const sets = {B1:new Set(['1','3']), B2:new Set(['3']), S1:new Set(['12']), S2:new Set(['34'])};
  assert.equal(hasSiblingSubset(sets), true);
  assert.equal(hasMotionlessStep(sets, order), true);
});

/* ---- random generator --------------------------------------- */
// deterministic PRNG so the randomizer's behavior is reproducible in tests
function mulberry32(seed){
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('legal randomization never produces an illegal overlap, across many seeds and both hands', () => {
  for(const thumb of [false, true]){
    const order = digitOrder(thumb);
    for(let seed=0; seed<50; seed++){
      const sets = randomSets(order, true, false, mulberry32(seed));
      const bad = compile(sets, order).some(c => hasIllegalOverlap(c.state.bends, c.state.splits));
      assert.equal(bad, false, `seed ${seed} thumb=${thumb}`);
    }
  }
});

test('legal randomization only ever uses members of the current digit order', () => {
  const order = digitOrder(false);
  const slots = slotsOf(order);
  const sets = randomSets(order, true, false, mulberry32(7));
  for(const k of ['B1','B2']) for(const id of sets[k]) assert.ok(order.includes(id));
  for(const k of ['S1','S2']) for(const id of sets[k]) assert.ok(slots.includes(id));
});

test('legal randomization never leaves any set empty, for either hand', () => {
  for(const thumb of [false, true]){
    const order = digitOrder(thumb);
    for(let seed=0; seed<100; seed++){
      for(const allowNesting of [true, false]){
        const sets = randomSets(order, true, allowNesting, mulberry32(seed));
        for(const k of SET_KEYS) assert.ok(sets[k].size > 0, `seed ${seed} thumb=${thumb} allowNesting=${allowNesting}: ${k} empty`);
      }
    }
  }
});

test('hard-mode randomization (legalPhysical=false) can still produce an illegal overlap', () => {
  // Not guaranteed on any single seed, but at least one of a spread of seeds
  // should hit a bent-border split — otherwise the legal filter isn't doing
  // anything and this couldn't be told apart from legalPhysical=true.
  const order = digitOrder(false);
  let sawIllegal = false;
  for(let seed=0; seed<200 && !sawIllegal; seed++){
    const sets = randomSets(order, false, false, mulberry32(seed));
    sawIllegal = compile(sets, order).some(c => hasIllegalOverlap(c.state.bends, c.state.splits));
  }
  assert.equal(sawIllegal, true);
});

test('with allowNesting=false (the default), randomization never lets one sibling fully contain the other', () => {
  for(const thumb of [false, true]){
    const order = digitOrder(thumb);
    for(let seed=0; seed<50; seed++){
      for(const legalPhysical of [true, false]){
        const sets = randomSets(order, legalPhysical, false, mulberry32(seed));
        assert.equal(hasSiblingSubset(sets), false, `seed ${seed} thumb=${thumb} legalPhysical=${legalPhysical}`);
        assert.equal(hasMotionlessStep(sets, order), false, `seed ${seed} thumb=${thumb} legalPhysical=${legalPhysical}`);
      }
    }
  }
});

test('with allowNesting=true, randomization can let one sibling fully contain the other', () => {
  const order = digitOrder(false);
  let sawNesting = false;
  for(let seed=0; seed<200 && !sawNesting; seed++){
    const sets = randomSets(order, true, true, mulberry32(seed));
    sawNesting = hasSiblingSubset(sets);
  }
  assert.equal(sawNesting, true);
});

/* countPossibleCombinations claims to count exactly the quadruples
   randomSets is allowed to land on. Cross-check it against a brute
   force over every non-empty {B1,B2,S1,S2} quadruple, run straight
   through compile()/hasIllegalOverlap/hasSiblingSubset — the same
   checks randomSets itself applies — rather than trusting the
   bitmask math to have mirrored them correctly. */
function nonEmptySubsets(universe){
  const out=[];
  for(let mask=1; mask<(1<<universe.length); mask++){
    out.push(new Set(universe.filter((_,i)=>mask&(1<<i))));
  }
  return out;
}

function bruteForceCount(order, legalPhysical, allowNesting){
  const slots = slotsOf(order);
  const bSubsets = nonEmptySubsets(order), sSubsets = nonEmptySubsets(slots);
  let count=0;
  for(const B1 of bSubsets) for(const B2 of bSubsets){
    for(const S1 of sSubsets) for(const S2 of sSubsets){
      const sets={B1,B2,S1,S2};
      if(!allowNesting && hasSiblingSubset(sets)) continue;
      if(legalPhysical && compile(sets, order).some(c=>hasIllegalOverlap(c.state.bends, c.state.splits))) continue;
      count++;
    }
  }
  return count;
}

test('countPossibleCombinations matches a brute-force count, for every toggle combination', () => {
  const order = digitOrder(false);   // small enough (4 digits, 3 slots) to brute force
  for(const legalPhysical of [true, false]){
    for(const allowNesting of [true, false]){
      assert.equal(
        countPossibleCombinations(order, legalPhysical, allowNesting),
        bruteForceCount(order, legalPhysical, allowNesting),
        `legalPhysical=${legalPhysical} allowNesting=${allowNesting}`,
      );
    }
  }
});

test('countPossibleCombinations shrinks as the toggles get stricter', () => {
  for(const thumb of [false, true]){
    const order = digitOrder(thumb);
    const loosest  = countPossibleCombinations(order, false, true);
    const noNest   = countPossibleCombinations(order, false, false);
    const noSplit  = countPossibleCombinations(order, true, true);
    const strictest= countPossibleCombinations(order, true, false);
    assert.ok(noNest <= loosest, `thumb=${thumb}`);
    assert.ok(noSplit <= loosest, `thumb=${thumb}`);
    assert.ok(strictest <= noNest && strictest <= noSplit, `thumb=${thumb}`);
  }
});
