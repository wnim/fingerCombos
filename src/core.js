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
