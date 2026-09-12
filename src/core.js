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
  T : { kind:'thumb',  len:132, w:34 },
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
  const s=[...cum].sort((a,b)=>a-b), m=s.length;
  const anchor = m%2 ? s[(m-1)/2] : (s[m/2-1]+s[m/2])/2;   // median = least total motion
  const out={};
  order.forEach((id,i)=>{ out[id]=(cum[i]-anchor)*SPLIT_ANGLE; });
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
   split while either of its bordering digits is folded — you can't spread
   a bent finger away from its neighbor. Takes a step's derived
   {bends, splits} (arrays, as produced by compile()) and reports whether
   any split slot has a bent border. */
export function hasIllegalOverlap(bends, splits){
  const bent = new Set(bends);
  return splits.some(slot => bent.has(slot[0]) || bent.has(slot.slice(1)));
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

/* Randomly populate all four sets for `order`. `legalPhysical=true` (i.e.
   "Split bends" off) keeps a candidate only if adding it still compiles
   the whole ROUTINE with no illegal overlap (hasIllegalOverlap), so the
   result always plays as a physically sound routine. `allowNesting=false`
   (i.e. "Nested sets" off) additionally keeps neither of B1/B2 (or S1/S2)
   a subset of the other, so no step is ever a no-op (hasSiblingSubset).
   Both default to the stricter behavior. `rng` defaults to Math.random but
   is injectable so the algorithm itself can be tested deterministically.

   Bends are filled before splits, on purpose: with nothing split yet, any
   bend is trivially legal, so B1/B2 always land on a real choice. Splits
   are then filtered against those fixed bends. Doing it the other way
   round lets S1/S2 grab every slot first and legally starves B1/B2 down
   to empty — physically correct (nothing left to bend into) but a
   frustrating thing for a "surprise me" button to hand back. Filling B1
   before B2 (and S1 before S2) the same way lets the subset check simply
   look at what's already landed in the other set.                      */
/* One draw of all four sets. Split out of randomSets so it can be rerolled
   whole (see MAX_RANDOM_TRIES below) instead of patched set-by-set. */
function attemptRandomSets(order, slots, legalPhysical, allowNesting, rng){
  const out = {B1:new Set(), B2:new Set(), S1:new Set(), S2:new Set()};
  const isSound = () => compile(out, order).every(c=>!hasIllegalOverlap(c.state.bends, c.state.splits));
  const isUnnested = () => !hasSiblingSubset(out);

  const fill = (key, universe, reserveForSibling=false) => {
    const candidates = [...universe];
    for(let i=candidates.length-1;i>0;i--){
      const j=Math.floor(rng()*(i+1));
      [candidates[i],candidates[j]]=[candidates[j],candidates[i]];
    }
    for(const id of candidates){
      if(rng() >= 0.45) continue;
      out[key].add(id);
      if((legalPhysical && !isSound()) || (!allowNesting && !isUnnested())) out[key].delete(id);
    }
    // Every set gets at least one member when one is available, so a fresh
    // randomization never lands on the "empty set" warning by chance.
    if(!out[key].size){
      for(const id of candidates){
        out[key].add(id);
        if((legalPhysical && !isSound()) || (!allowNesting && !isUnnested())) out[key].delete(id);
        else break;
      }
    }
    // Leave the sibling at least one option: if this set (filled first)
    // swallowed the whole universe and nesting is disallowed, ANY non-empty
    // sibling would be a subset of it, starving the sibling to empty for
    // no reason but draw order. Only B1/B2 need this — S1/S2 only forbid
    // exact equality, so S1 at 100% still leaves every proper subset open
    // to S2 (trimming S1 here would just needlessly ban a legal result).
    if(reserveForSibling && !allowNesting && universe.length>1 && out[key].size===universe.length){
      out[key].delete(candidates[candidates.length-1]);
    }
  };

  fill('B1', order, true); fill('B2', order);
  fill('S1', slots); fill('S2', slots);
  return out;
}

// Generous headroom over the ~1-3 tries a reroll typically needs (see below).
const MAX_RANDOM_TRIES = 200;

export function randomSets(order, legalPhysical, allowNesting = false, rng = Math.random){
  const slots = slotsOf(order);

  /* fill()'s per-set "at least one member" fallback (above) guards each set
     in isolation, but with legalPhysical on and allowNesting off it can still
     end up with S1 and S2 (rarely B1/B2) each individually non-empty-capable
     yet cornered against each other — e.g. only one slot in the whole order
     is ever physically splittable, S1 claims it, and the only thing left for
     S2 to claim would make it equal to S1 (illegal). Untangling that would
     mean re-deriving which digits ROUTINE ever bends simultaneously; instead
     just reroll the whole draw. A fully-populated result always exists (every
     digit order has room for it) and a fresh draw finds one almost
     immediately, so this only ever repeats a handful of times in practice.  */
  for(let i=0;i<MAX_RANDOM_TRIES;i++){
    const out = attemptRandomSets(order, slots, legalPhysical, allowNesting, rng);
    if(SET_KEYS.every(k=>out[k].size>0)) return out;
  }
  return attemptRandomSets(order, slots, legalPhysical, allowNesting, rng);
}

/* Exact size of the pool randomSets draws from: every non-empty
   {B1,B2,S1,S2} quadruple that satisfies the same two filters
   randomSets applies (legalPhysical / allowNesting). Digits and slots
   are few enough (≤5 and ≤4) that brute-forcing every quadruple as a
   bitmask is cheap — worst case (thumb on, splitBends off) is ~220k
   quadruples × 32 routine steps, well under a second.

   bends/splits per step take one of only four shapes — ∅, set1, set2,
   or their union — depending on which of the pair is active at that
   step (fixed by ROUTINE, independent of set contents), which is what
   the bitmask OR-in-if pattern below is exploiting.               */
export function countPossibleCombinations(order, legalPhysical, allowNesting){
  const slots = slotsOf(order);
  const n = order.length, m = slots.length;
  const borderMask = slots.map(s => {
    const i1 = order.indexOf(s[0]), i2 = order.indexOf(s.slice(1));
    return (1<<i1) | (1<<i2);
  });

  const active = {B1:false,B2:false,S1:false,S2:false};
  const steps = [];
  for(const step of ROUTINE){
    for(const a of step) active[a.set] = !a.undo;
    steps.push({b1:active.B1, b2:active.B2, s1:active.S1, s2:active.S2});
  }

  const maxB=(1<<n)-1, maxS=(1<<m)-1;
  let count=0;
  for(let B1=1; B1<=maxB; B1++){
    for(let B2=1; B2<=maxB; B2++){
      if(!allowNesting && ((B1&B2)===B1 || (B1&B2)===B2)) continue;
      for(let S1=1; S1<=maxS; S1++){
        for(let S2=1; S2<=maxS; S2++){
          if(!allowNesting && S1===S2) continue;
          if(legalPhysical){
            let illegal=false;
            for(const st of steps){
              const bends=(st.b1?B1:0)|(st.b2?B2:0);
              const splits=(st.s1?S1:0)|(st.s2?S2:0);
              for(let j=0;j<m;j++){
                if((splits&(1<<j)) && (borderMask[j]&bends)){ illegal=true; break; }
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

/* Fold the routine over the sets into an explicit sequence.

   The hand state is DERIVED, never mutated: at each step we record which
   of the four sets are active, then take the union of their members. That
   is what makes overlapping sets correct — "unbend B1" cannot straighten a
   finger that B2 is still holding, because that finger is still in the
   union. (The old model add/deleted members on a shared Set and got this
   wrong; see docs/architecture.md.)                                  */
export function compile(sets, order){
  const active={B1:false,B2:false,S1:false,S2:false};
  const union = kind => {
    const u=new Set();
    for(const k of [kind+'1', kind+'2']) if(active[k]) for(const x of sets[k]) u.add(x);
    const universe = kind==='B' ? order : slotsOf(order);
    return universe.filter(x=>u.has(x));           // canonical order
  };

  const out=[];
  for(const step of ROUTINE){
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
