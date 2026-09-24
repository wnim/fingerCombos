/* ============================================================
   CORE — the model.

   No DOM, no SVG, no globals: everything in here is pure and runs in
   plain Node (see test/core.test.mjs). If a thing can be reasoned about
   without looking at a screen, it belongs here.
   ============================================================ */

/* ---- anatomy ----------------------------------------------
   The ONLY place a digit is declared. Add one here and slots, layout,
   splits and controls all follow. `len`/`w` are proportions, not pixels:
   the renderer scales them to whatever band it has.              */
export const DIGIT_TABLE = {
  //  id : { kind, len, w }
  T : { kind:'thumb',  len:165, w:46 },
  1 : { kind:'finger', len:150, w:36 },
  2 : { kind:'finger', len:180, w:38 },
  3 : { kind:'finger', len:162, w:37 },
  4 : { kind:'finger', len:128, w:34 },
};

export const FINGER_ORDER = ['1','2','3','4'];   // left→right on screen
export const SPLIT_ANGLE  = 23;                  // degrees a split opens its slot

/** The active digit array. The thumb is a prepend — never a branch. */
export function digitOrder(enableThumb){
  return enableThumb ? ['T', ...FINGER_ORDER] : [...FINGER_ORDER];
}

/** Slots are every consecutive pair. [T,1,2,3,4] -> T1, 12, 23, 34 */
export function slotsOf(order){
  const s=[];
  for(let i=0;i<order.length-1;i++) s.push(order[i]+''+order[i+1]);
  return s;
}

/* Split model: MEDIAN-ANCHORED prefix sum. A digit's angle is how many
   opened slots lie to its left, minus the median of that distribution —
   so the hand rotates as little as possible and the opening is absorbed
   by the smaller side. Edge slots (12/34) swing only the outer finger;
   the centre slot (23) swings both halves apart. Generalises to any N. */
export function splayAngles(order, splits){
  const open = splits instanceof Set ? splits : new Set(splits);
  const cum=[]; let run=0;
  order.forEach((id,i)=>{
    cum[i]=run;
    if(i<order.length-1) run += open.has(order[i]+''+order[i+1]) ? 1 : 0;
  });
  /* The anchor is a FINGER concept — it balances motion across the finger
     chain only. The thumb always sits at cum=0 as the chain's leftmost
     link, so folding it into this pool would skew the median toward zero
     (dumping a split's rotation onto one side) purely because it's an
     inert extra data point, not because the fingers need to move less. */
  const fingerCum = order.filter(id=>DIGIT_TABLE[id].kind==='finger').map(id=>cum[order.indexOf(id)]);
  const s=[...fingerCum].sort((a,b)=>a-b), m=s.length;
  const anchor = m%2 ? s[(m-1)/2] : (s[m/2-1]+s[m/2])/2;   // median = least total motion
  const out={};
  order.forEach((id,i)=>{ out[id]=(cum[i]-anchor)*SPLIT_ANGLE; });
  /* The thumb sits off the fingers' axis, not colinear with them, so it
     doesn't share their "least total motion" pool: since it's always the
     chain's leftmost link its own cum is always 0, meaning the shared
     anchor above — which the FINGERS legitimately need to rebalance among
     themselves — would otherwise swing the thumb too, by however much
     splits *elsewhere* (T1 uninvolved) happen to shift that anchor. The
     thumb's angle should depend only on its own slot. */
  const thumbId = order.find(id=>DIGIT_TABLE[id].kind==='thumb');
  if(thumbId) out[thumbId] = open.has(slotsOf(order)[0]) ? -SPLIT_ANGLE : 0;
  return out;
}

/* ============================================================
   THE ROUTINE — holy, hence a const. Stored as the half; the full
   routine is the half followed by the same half with sets 1<->2 swapped.
   ============================================================ */
export const ROUTINE_HALF = "b1s1-b1-s1&s2b2-s2b1-b2b2-b1s2-b2-s2&s1b1-s1-b1";

export const SET_KEYS = ['B1','B2','S1','S2'];

/** parse -> steps; a step is an array of {set, undo} (length > 1 for `&`) */
export function parseRoutine(str){
  const re=/(&?)(-?)([bs])([12])/g, steps=[]; let m;
  while((m=re.exec(str))){
    const action={set:m[3].toUpperCase()+m[4], undo:m[2]==='-'};
    if(m[1]==='&' && steps.length) steps[steps.length-1].push(action);
    else steps.push([action]);
  }
  return steps;
}

export const swapSet = s => s[0] + (s[1]==='1'?'2':'1');   // B1<->B2, S1<->S2
export function swapHalf(steps){
  return steps.map(st=>st.map(a=>({set:swapSet(a.set), undo:a.undo})));
}

export const HALF    = parseRoutine(ROUTINE_HALF);
export const ROUTINE = [...HALF, ...swapHalf(HALF)];    // 32 steps

/* No-simul variant: the same routine, but the two simultaneous "&" steps
   (see docs/sequence.md) are unrolled into two ordinary sequential steps
   instead — derived from ROUTINE_HALF itself, not a separate hand-typed
   string, so the two can never drift apart. */
export const ROUTINE_HALF_NO_SIMUL = ROUTINE_HALF.replace(/&/g, '');
export const HALF_NO_SIMUL    = parseRoutine(ROUTINE_HALF_NO_SIMUL);
export const ROUTINE_NO_SIMUL = [...HALF_NO_SIMUL, ...swapHalf(HALF_NO_SIMUL)];

/* ROUTINE_COMPLETE: a from-scratch 16-action sequence hitting all 16
   possible transitions (12 cross-set + 4 same-set) exactly once each —
   zero redundancy, unlike ROUTINE/ROUTINE_NO_SIMUL, which pad the same
   coverage out to 36 actions by revisiting B1/B2 far more than needed.
   Two earlier attempts were tried and abandoned before this one:

   1. A raw Eulerian circuit over the four sets, ignoring physical
      constraints entirely: it necessarily puts every bend set
      concurrently active with every split set at some point, which
      collapses the legal-combination count under "Split bends"
      disabled by 17-20x (240->12 with no thumb, 2,882->168 with it).

   2. A trimmed circuit that fixed (1) — restricting coexistence to
      just B1+S1 and B2+S2, matching the holy sequence — but didn't
      also keep S1 and S2 mutually exclusive the way the holy sequence
      does. hasSiblingSubset()'s S1/S2 branch only checks for exact
      equality (see its comment), because it assumes S1/S2 are never
      simultaneously active; break that assumption and "Nested sets"
      silently stops catching real dead steps (verified: 2,640 of 4,620
      test quadruples it called fine actually stalled).

   This sequence keeps both properties the holy sequence has — B1 only
   ever coexists with S1, B2 only with S2, and S1/S2 are never
   simultaneously active — so it costs nothing under either toggle:
   same legal-combination count as ROUTINE (240 / 2,882), and the same
   zero mismatches against hasSiblingSubset's motionless-step check.

   It's a loop, so any rotation of it has the exact same properties —
   same transitions, same legality, same neutral-return point (every
   rotation point here happens to land on neutral anyway). The 16 actions
   split into two contiguous 8-action halves: four isolated "flip it on,
   flip it right back off" self-transitions (B1/-B1/B2/-B2, S1/-S1/S2/-S2
   — the plainest moves here, structurally, in any rotation) and eight
   actions where a bend and a split set actually hand off to each other.
   Rotated so the two self-transition quadruples sit together at the
   front and the entire handoff stretch runs uninterrupted to the end —
   a first attempt at this rotation moved only half that block, leaving
   the other self-transition quadruple stranded at the tail (a trivial-
   meaty-trivial sandwich instead of a build-up). */
export const ROUTINE_COMPLETE_STR = "b1-b1b2-b2s1-s1s2-s2s1b1-s1b2-b1s2-b2-s2";
export const ROUTINE_COMPLETE = parseRoutine(ROUTINE_COMPLETE_STR);

/* ROUTINE_DENSE: same rules as ROUTINE_COMPLETE — never revisit neutral
   until the very end, never repeat a (state, move) pair, stay inside the
   same 7 legal non-neutral states (B1 only with S1, B2 only with S2, S1
   and S2 never together) — but where COMPLETE only adds a compound "&"
   move where one is truly forced (S1<->S2, the only pair 2 bits apart
   with no single-bit route), this one takes every legal state pair up to
   2 bits apart as a usable move, single-bit or compound alike. That
   graph has 28 interior moves + the 2 neutral touches = a provable
   30-move ceiling (found the same way ROUTINE_COMPLETE was — Hierholzer's
   algorithm on the fully-balanced graph).

   The straight 30-move Eulerian circuit included 3 detours that leave
   the state exactly where they found it (a bend+unbend of a single set
   with nothing else changing, twice, plus a 4-move round trip through
   B1/B2/B1,B2 back to its start) — real edges in the 30-edge graph, but
   ones that only lead back to somewhere already visited rather than
   forward to something new. Dropping all three costs nothing checkable
   (still legal, still zero repeated edges, still never touches neutral
   before the end, still the same 240 / 2,882 legal-combination count)
   and removes exactly the steps that read as filler: what's left is 22
   moves, 16 of them simultaneous (73%, up from 53% in the untrimmed 30),
   because the cut fell entirely on single-bit moves and left every
   compound one standing. */
export const ROUTINE_DENSE_STR = "b1-b1&s2s1&-s2-s1&s2b2&-s2s2b1&-s2-b1&s2-s2-b2&s2b1&-s2s1b2&-s1-b2&s1-s1-b1&s1b2&-s1-b2&s1b1&-s1-b1&b2b1&-b2-b1";
export const ROUTINE_DENSE = parseRoutine(ROUTINE_DENSE_STR);

/* The six sequences selectable in the UI. One registry so index.html's
   dropdown and app.js's compile/randomize calls can't disagree about
   what's on offer — see docs/sequence.md. */
export const SEQUENCES = {
  holySimul:       { label: 'Holy with simul',    steps: ROUTINE },
  holyNoSimul:     { label: 'Holy no simul',       steps: ROUTINE_NO_SIMUL },
  halfHolySimul:   { label: 'Half holy simul',     steps: HALF },
  halfHolyNoSimul: { label: 'Half holy no simul',  steps: HALF_NO_SIMUL },
  complete:        { label: 'Complete',            steps: ROUTINE_COMPLETE },
  dense:           { label: 'Dense',               steps: ROUTINE_DENSE },
};

/** Render a step back into its abstract token: `-S1&S2` */
export const tokenOf = step => step.map(a=>(a.undo?'-':'')+a.set).join('&');

/* Legality at the SET level: each set is bent/split as a whole, so a
   toggle is illegal only if the set is already in the target state —
   bending a bent set, unsplitting an unsplit set. Since the hand state
   is now DERIVED from which sets are active (see compile), set-level
   legality is the whole story; overlapping members can no longer
   produce a contradiction. Returns [] when the routine is sound.   */
export function validateRoutine(steps){
  const active={B1:false,B2:false,S1:false,S2:false}, errs=[];
  steps.forEach((step,i)=>step.forEach(a=>{
    const isB=a.set[0]==='B', want=!a.undo;                 // want: true=activate
    if(active[a.set]===want){
      const verb = a.undo ? (isB?'unbend':'unsplit') : (isB?'bend':'split');
      const cond = want ? 'already '+(isB?'bent':'split') : 'not '+(isB?'bent':'split');
      errs.push(`step ${i+1} “${(a.undo?'-':'')+a.set}”: can't ${verb} ${a.set} — it's ${cond}`);
    }
    active[a.set]=want;
  }));
  return errs;
}

/* Physical constraint (off when "Split bends" is on): a slot can't be
   split while a digit it would actually move away from its neighbor is
   folded. An EDGE slot (the first or last in the hand's slot list) only
   moves its outermost digit when it opens — e.g. slot "12" only cares
   about digit 1, not digit 2; slot "34" only cares about digit 4. Every
   other (interior) slot pulls both of its bordering digits apart, so
   either one being bent blocks it. Takes a step's derived {bends, splits}
   (arrays, as produced by compile()) plus the hand's full ordered slot
   list (slotsOf(order)) so edge slots can be told from interior ones. */
export function hasIllegalOverlap(bends, splits, slots){
  const bent = new Set(bends);
  return splits.some(slot => {
    const i = slots.indexOf(slot);
    const edge = slots.length>1 && (i===0 || i===slots.length-1);
    if(!edge) return bent.has(slot[0]) || bent.has(slot.slice(1));
    return i===0 ? bent.has(slot[0]) : bent.has(slot.slice(1));
  });
}

export const subsumes = (a,b) => a.size>0 && [...a].every(x=>b.has(x));
export const setsEqual = (a,b) => a.size>0 && a.size===b.size && subsumes(a,b);

/* No-op constraint (off when "Nested sets" is on). B1/B2 and S1/S2 don't
   behave the same way in ROUTINE, so the condition that produces a
   motionless step is different for each pair — this isn't a stylistic
   choice, it follows from how compile() derives state:

   B1/B2 spend real stretches of the routine BOTH active at once (see
   "overlapping bend sets" in the tests) — e.g. B1 activates while B2 is
   still on. Whichever one toggles, the members it moves that the other
   ISN'T already holding are what's visible; the step is a total no-op
   only if the toggling set's entire membership is already covered by the
   other, i.e. one fully contains the other (proper subset OR equal —
   verified: B1={1,3}/B2={3} alone already stalls at steps 7-10 and 23-26
   of the compiled routine). Partial overlap, e.g. B1={2,3,4}/B2={1,2,3},
   never stalls (activating B1 still moves finger 4; activating B2 still
   moves finger 1), even though 3 fingers' worth of "bend" is redundant.

   S1/S2, by contrast, are NEVER simultaneously active — the routine only
   ever swaps which one is active in a single atomic step ("-S1&S2"). A
   swap step's visible splits go from S1's members straight to S2's; that
   changes unless the two sets are EXACTLY equal (verified: any proper
   subset, e.g. S1={12}/S2={12,23}, still changes the visible slots at
   every swap — only S1==S2 produces the no-op).                        */
export function hasSiblingSubset(sets){
  return subsumes(sets.B1, sets.B2) || subsumes(sets.B2, sets.B1) || setsEqual(sets.S1, sets.S2);
}

/* ============================================================
   RANDOM GENERATOR
   ============================================================ */

/* Uniform rejection sampling: draw B1/B2 (over `order`) and S1/S2 (over
   `slotsOf(order)`) each as an independent, uniformly-random NON-EMPTY
   subset, then keep the whole quadruple only if it's legal — same two
   filters countPossibleCombinations enumerates: `legalPhysical=true` (i.e.
   "Split bends" off) requires the compiled ROUTINE to have no illegal
   overlap (hasIllegalOverlap); `allowNesting=false` (i.e. "Nested sets"
   off) requires neither of B1/B2 nor S1/S2 be a subset of its sibling
   (hasSiblingSubset). On rejection, redraw all four from scratch — never
   patch one set — which is what makes this exact: if X is uniform over
   every non-empty quadruple and T is the legal subset, then for any
   t in T, P(X=t | X∈T) = (1/|S|)/(|T|/|S|) = 1/|T|, constant across T.
   Both halves of that argument are where the old fill()-based generator
   broke down — it drew each member via an independent ~45% coin flip
   (size-biased, not "every subset equally likely") and filled B1, then
   B2 against B1, then S1, then S2 against everything before it (a
   conditional/sequential draw, not a joint one) — so siblings like B1
   and B2 were never actually interchangeable in the result. `rng`
   defaults to Math.random but is injectable for deterministic tests. */
function randomNonEmptySubset(universe, rng){
  const mask = 1 + Math.floor(rng() * ((1<<universe.length) - 1));   // uniform in [1, 2^n-1]
  return new Set(universe.filter((_, i) => mask & (1<<i)));
}

/* One fully independent draw of all four sets — kept as its own function
   so a rejection can redraw all of them atomically (see randomSets).

   `blacklist` (optional {B:Set, S:Set}) removes specific fingers/slots
   from the draw pool entirely — a blacklisted member can never appear in
   B1/B2 (or S1/S2), while the rest of the pool stays uniform (dropping
   members from a uniform-subset draw doesn't bias the survivors, it just
   shrinks the space they're drawn from). Falls back to the full pool if
   the blacklist would empty it, rather than drawing from nothing. */
function randomQuadruple(order, slots, rng, blacklist){
  const bPool = blacklist?.B?.size ? order.filter(id=>!blacklist.B.has(id)) : order;
  const sPool = blacklist?.S?.size ? slots.filter(id=>!blacklist.S.has(id)) : slots;
  const bUniverse = bPool.length ? bPool : order;
  const sUniverse = sPool.length ? sPool : slots;
  return {
    B1: randomNonEmptySubset(bUniverse, rng),
    B2: randomNonEmptySubset(bUniverse, rng),
    S1: randomNonEmptySubset(sUniverse, rng),
    S2: randomNonEmptySubset(sUniverse, rng),
  };
}

/* Single-candidate mirror of the two filters countPossibleCombinations
   sums over the whole space. Runs compile() once per candidate (fine —
   randomSets only ever tests one candidate at a time, unlike
   countPossibleCombinations which must check every candidate). */
function isLegalQuadruple(sets, order, legalPhysical, allowNesting, routine, positionRules = []){
  if(!allowNesting && hasSiblingSubset(sets)) return false;
  if(!legalPhysical && !positionRules.length) return true;
  const compiled = compile(sets, order, routine);
  if(legalPhysical){
    const slots = slotsOf(order);
    if(compiled.some(c=>hasIllegalOverlap(c.state.bends, c.state.splits, slots))) return false;
  }
  if(positionRules.length && compiled.some(c=>positionRules.some(r=>matchesPositionRule(c.state.bends, c.state.splits, r)))) return false;
  return true;
}

/* Worst-case acceptance ratio across every toggle combination is ~76:1
   (thumb on, legalPhysical=true, allowNesting=false: 216,225 candidates
   vs 2,882 legal — see countPossibleCombinations). A cap of 5000 makes
   the failure probability (1-1/76)^5000 ≈ 3.7e-29 — negligible even
   summed across a whole test run — while costing microseconds even in
   the unlucky tail, since each attempt is just one compile() call. */
const MAX_RANDOM_TRIES = 5000;

export function randomSets(order, legalPhysical, allowNesting = false, rng = Math.random, blacklist = null, routine = ROUTINE, positionRules = []){
  const slots = slotsOf(order);
  for(let i=0;i<MAX_RANDOM_TRIES;i++){
    const candidate = randomQuadruple(order, slots, rng, blacklist);
    if(isLegalQuadruple(candidate, order, legalPhysical, allowNesting, routine, positionRules)) return candidate;
  }
  return randomQuadruple(order, slots, rng, blacklist);   // ~2.6e-11 chance; see MAX_RANDOM_TRIES above
}

/* Exact size of the pool randomSets draws from: every non-empty
   {B1,B2,S1,S2} quadruple that satisfies the same two filters
   randomSets applies (legalPhysical / allowNesting). Digits and slots
   are few enough (≤5 and ≤4) that brute-forcing every quadruple as a
   bitmask is cheap — worst case (thumb on, splitBends off) is ~220k
   quadruples × up to 36 routine steps (the longest of the five
   selectable sequences — see SEQUENCES), well under a second.

   bends/splits per step take one of only four shapes — ∅, set1, set2,
   or their union — depending on which of the pair is active at that
   step (fixed by the routine, independent of set contents), which is
   what the bitmask OR-in-if pattern below is exploiting.           */
export function countPossibleCombinations(order, legalPhysical, allowNesting, blacklist = null, routine = ROUTINE, positionRules = []){
  const slots = slotsOf(order);
  const n = order.length, m = slots.length;
  const borderMask = slots.map((s, j) => {
    const i1 = order.indexOf(s[0]), i2 = order.indexOf(s.slice(1));
    const edge = slots.length>1 && (j===0 || j===slots.length-1);
    if(!edge) return (1<<i1) | (1<<i2);
    return j===0 ? (1<<i1) : (1<<i2);
  });

  const active = {B1:false,B2:false,S1:false,S2:false};
  const steps = [];
  for(const step of routine){
    for(const a of step) active[a.set] = !a.undo;
    steps.push({b1:active.B1, b2:active.B2, s1:active.S1, s2:active.S2});
  }

  // A blacklisted finger/slot can never appear in ANY set that draws from
  // its universe (both B1&B2, or both S1&S2) — encoded once as a bitmask
  // so every candidate carrying a blacklisted bit is skipped up front.
  const blackB = blacklist ? order.reduce((mask,id,i)=>blacklist.B?.has(id)?mask|(1<<i):mask, 0) : 0;
  const blackS = blacklist ? slots.reduce((mask,id,i)=>blacklist.S?.has(id)?mask|(1<<i):mask, 0) : 0;

  // Each position rule as four bitmasks, encoded the same way blackB/blackS
  // are — iterating order/slots and testing membership — so a stray id that
  // slipped past sanitization can't corrupt the mask via indexOf's -1.
  const ruleMasks = positionRules.map(r => ({
    bendOnMask:   order.reduce((mask,id,i)=>r.bendOn.includes(id)  ?mask|(1<<i):mask, 0),
    bendOffMask:  order.reduce((mask,id,i)=>r.bendOff.includes(id) ?mask|(1<<i):mask, 0),
    splitOnMask:  slots.reduce((mask,id,i)=>r.splitOn.includes(id) ?mask|(1<<i):mask, 0),
    splitOffMask: slots.reduce((mask,id,i)=>r.splitOff.includes(id)?mask|(1<<i):mask, 0),
  }));

  const maxB=(1<<n)-1, maxS=(1<<m)-1;
  let count=0;
  for(let B1=1; B1<=maxB; B1++){
    if(B1 & blackB) continue;
    for(let B2=1; B2<=maxB; B2++){
      if(B2 & blackB) continue;
      if(!allowNesting && ((B1&B2)===B1 || (B1&B2)===B2)) continue;
      for(let S1=1; S1<=maxS; S1++){
        if(S1 & blackS) continue;
        for(let S2=1; S2<=maxS; S2++){
          if(S2 & blackS) continue;
          if(!allowNesting && S1===S2) continue;
          if(legalPhysical || ruleMasks.length){
            let illegal=false;
            for(const st of steps){
              const bends=(st.b1?B1:0)|(st.b2?B2:0);
              const splits=(st.s1?S1:0)|(st.s2?S2:0);
              if(legalPhysical){
                for(let j=0;j<m;j++){
                  if((splits&(1<<j)) && (borderMask[j]&bends)){ illegal=true; break; }
                }
              }
              if(!illegal){
                for(const r of ruleMasks){
                  if((bends&r.bendOnMask)===r.bendOnMask && !(bends&r.bendOffMask) &&
                     (splits&r.splitOnMask)===r.splitOnMask && !(splits&r.splitOffMask)){ illegal=true; break; }
                }
              }
              if(illegal) break;
            }
            if(illegal) continue;
          }
          count++;
        }
      }
    }
  }
  return count;
}

/* ============================================================
   SETS + COMPILE
   ============================================================ */

export const defaultSets = () => ({
  B1:new Set(['1','2']), B2:new Set(['3']), S1:new Set(['34']), S2:new Set(['12']),
});

/* ---- position blacklist ------------------------------------
   A "position" rule is a partial, wildcard-able hand SHAPE — not raw
   B1/B2/S1/S2 membership, but the DERIVED {bends, splits} state compile()
   produces at each step of a playing routine. Each finger/slot is one of
   three states: required ON (must be bent/split), required OFF (must not
   be), or — if absent from both lists — a wildcard that imposes nothing.
   Plain id arrays, not Sets, so a rule round-trips through JSON as-is. */
export function emptyPositionRule(){
  return { bendOn:[], bendOff:[], splitOn:[], splitOff:[] };
}

/* A rule with all four arrays empty is pure wildcard — it would match
   EVERY possible state, which would make randomSets reject every
   candidate and always fall back past MAX_RANDOM_TRIES. Must never be
   allowed to persist; checked both at add-time (disables the "Add rule"
   button) and at sanitize/load-time (a rule can go empty after the thumb
   drops its one remaining constrained digit). */
export function isEmptyPositionRule(rule){
  return !rule.bendOn.length && !rule.bendOff.length && !rule.splitOn.length && !rule.splitOff.length;
}

/* bends/splits may be a Set or a plain array — compile() produces arrays
   (see union() below), hasIllegalOverlap already has to handle the same
   ambiguity for `bends`. */
export function matchesPositionRule(bends, splits, rule){
  const bentSet = bends instanceof Set ? bends : new Set(bends);
  const splitSet = splits instanceof Set ? splits : new Set(splits);
  return rule.bendOn.every(id=>bentSet.has(id))
      && rule.bendOff.every(id=>!bentSet.has(id))
      && rule.splitOn.every(id=>splitSet.has(id))
      && rule.splitOff.every(id=>!splitSet.has(id));
}

/* Coerce arbitrary/stored rule data into a valid rule for this digit
   order, or null if nothing usable survives — mirrors sanitizeSets /
   app.js's sanitizeBlacklistSide. An id contradictorily listed as both
   required-on and required-off can't come from the builder UI (its chips
   cycle through one state at a time) but could come from corrupted or
   hand-edited storage; resolve it by keeping "on" and dropping "off". */
/* Plain-English reading of a rule — e.g. "1 & 2 bent, 12 & 23 split" — so
   a rule can be sanity-checked by its meaning instead of by decoding chip
   colors/ids. Returns '' for a fully-wildcard rule; the caller supplies
   its own "nothing picked yet" fallback text. */
export function describePositionRule(rule){
  const clause = (ids, verb) => ids.length ? `${ids.join(' & ')} ${verb}` : null;
  return [
    clause(rule.bendOn, 'bent'),
    clause(rule.bendOff, 'not bent'),
    clause(rule.splitOn, 'split'),
    clause(rule.splitOff, 'not split'),
  ].filter(Boolean).join(', ');
}

/* Order-independent content equality — used to tell whether a rule that
   exists on one hand side also exists (independently) on the other, since
   "apply to both hands" stores two separate cloned entries rather than one
   shared one. */
export function positionRuleEquals(a, b){
  const sameSet = (x,y) => x.length===y.length && x.every(id=>y.includes(id));
  return sameSet(a.bendOn,b.bendOn) && sameSet(a.bendOff,b.bendOff)
      && sameSet(a.splitOn,b.splitOn) && sameSet(a.splitOff,b.splitOff);
}

export function sanitizePositionRule(raw, order){
  const validB = new Set(order), validS = new Set(slotsOf(order));
  const clean = (v, valid) => (Array.isArray(v) ? v : []).map(String).filter(x=>valid.has(x));
  const bendOn = clean(raw?.bendOn, validB), splitOn = clean(raw?.splitOn, validS);
  const rule = {
    bendOn, splitOn,
    bendOff: clean(raw?.bendOff, validB).filter(id=>!bendOn.includes(id)),
    splitOff: clean(raw?.splitOff, validS).filter(id=>!splitOn.includes(id)),
  };
  return isEmptyPositionRule(rule) ? null : rule;
}

/* Coerce arbitrary set data into a valid {B1,B2,S1,S2} for this digit
   order, dropping members that don't exist. One place handles both jobs
   that need it: restoring from storage (which may be stale or corrupt)
   and clamping after the thumb is toggled off.                       */
export function sanitizeSets(raw, order){
  const valid={B:new Set(order), S:new Set(slotsOf(order))};
  const out={};
  for(const k of SET_KEYS){
    const src=raw?.[k];
    const list = src instanceof Set ? [...src] : Array.isArray(src) ? src : [];
    out[k]=new Set(list.map(String).filter(x=>valid[k[0]].has(x)));
  }
  return out;
}

/** A set's members in canonical (screen) order. */
export function membersOf(sets, key, order){
  const universe = key[0]==='B' ? order : slotsOf(order);
  return universe.filter(x=>sets[key].has(x));
}

/* ---- textual sets I/O ---------------------------------------
   "B1:1,2 B2:3 S1:34 S2:12" — one whitespace-separated KEY:members
   token per set, comma-separated members, always all four keys (even
   when a set is empty, e.g. "S2:") so a copy round-trips exactly.   */
export function serializeSets(sets, order){
  return SET_KEYS.map(k => `${k}:${membersOf(sets, k, order).join(',')}`).join(' ');
}

/* Pure text -> {key: [members]} for whichever of B1/B2/S1/S2 tokens are
   present (case-insensitive, junk tokens ignored) — a key absent from
   the text is simply absent from the result, so the caller can tell
   "typed empty" (key:'') from "key missing" before handing the rest to
   sanitizeSets for validation/clamping against the current digit order. */
export function parseSetsText(text){
  const out={};
  for(const raw of String(text).trim().split(/\s+/)){
    const m = /^(B1|B2|S1|S2):(.*)$/i.exec(raw);
    if(!m) continue;
    out[m[1].toUpperCase()] = m[2].split(',').map(s=>s.trim()).filter(Boolean);
  }
  return out;
}

/* Fold the routine over the sets into an explicit sequence.

   The hand state is DERIVED, never mutated: at each step we record which
   of the four sets are active, then take the union of their members. That
   is what makes overlapping sets correct — "unbend B1" cannot straighten a
   finger that B2 is still holding, because that finger is still in the
   union. (The old model add/deleted members on a shared Set and got this
   wrong; see docs/architecture.md.)                                  */
export function compile(sets, order, routine = ROUTINE){
  const active={B1:false,B2:false,S1:false,S2:false};
  const union = kind => {
    const u=new Set();
    for(const k of [kind+'1', kind+'2']) if(active[k]) for(const x of sets[k]) u.add(x);
    const universe = kind==='B' ? order : slotsOf(order);
    return universe.filter(x=>u.has(x));           // canonical order
  };

  const out=[];
  for(const step of routine){
    for(const a of step) active[a.set] = !a.undo;   // whole step lands at once
    const bends=union('B'), splits=union('S');

    const parts = step.map(a=>{
      const isB=a.set[0]==='B', mem=membersOf(sets, a.set, order);
      const verb = isB ? (a.undo?'unbend':'bend') : (a.undo?'unsplit':'split');
      let text = `${verb} ${mem.join('·')||'∅'}`;
      // Members this action could NOT move, because the sibling set still
      // holds them. Without this note the instruction text would contradict
      // what the hand visibly does.
      if(a.undo){
        const held=new Set(isB?bends:splits);
        const stuck=mem.filter(x=>held.has(x));
        if(stuck.length) text += ` (${stuck.join('·')} stays ${isB?'bent':'split'})`;
      }
      return text;
    });

    out.push({ token:tokenOf(step), label:parts.join('  &  '), state:{bends, splits} });
  }
  return out;
}
