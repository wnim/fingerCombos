/* ============================================================
   APP — controls, player, persistence, boot. The only file that
   touches the page chrome; core.js holds the model and hand.js
   the puppet.
   ============================================================ */
import {
  SEQUENCES, SET_KEYS, digitOrder, slotsOf, validateRoutine, compile, defaultSets, sanitizeSets,
  hasIllegalOverlap, hasSiblingSubset, subsumes, setsEqual, randomSets, countPossibleCombinations,
  serializeSets, parseSetsText, sanitizePositionRule, isEmptyPositionRule, emptyPositionRule,
  describePositionRule, positionRuleEquals,
} from './core.js';
import { createHand } from './hand.js';

const $ = id => document.getElementById(id);

const SEQUENCE_KEYS = Object.keys(SEQUENCES);
const DEFAULT_SEQUENCE = 'halfHolySimul';

/* ---- fail loud: every selectable sequence must be sound, not just
   whichever one happens to be active right now -------------------- */
for(const [key, {label, steps}] of Object.entries(SEQUENCES)){
  const errs = validateRoutine(steps);
  if(errs.length){
    const e=$('err');
    e.hidden=false; e.textContent=`⚠ Illegal routine "${label}" — `+errs.join('  •  ');
    console.error(`Illegal routine "${label}" (${key}):`, errs);
    throw new Error(`Illegal routine "${label}": `+errs[0]);
  }
}

/* ============================================================
   PERSISTENCE — set choices survive a reload. Storage can be absent
   or throw (private windows, file://), so every touch is guarded and
   a failure just means "start from defaults".
   ============================================================ */
const STORE_KEY='fingerCombos.v1';

function saveSession(){
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify({
      thumb: hand.state.thumb,
      rightHand,
      darkMode,
      loop,
      randomizeAtPlay,
      showMap,
      splitBends,
      allowNesting,
      sequence: sequenceKey,
      descCollapsed,
      seqOpen,
      panelOpen,
      sets: Object.fromEntries(SET_KEYS.map(k=>[k,[...SETS[k]]])),
      blacklist: {
        left: { B:[...BLACKLIST.left.B], S:[...BLACKLIST.left.S] },
        right: { B:[...BLACKLIST.right.B], S:[...BLACKLIST.right.S] },
      },
      positionBlacklist: {
        left: POSITION_BLACKLIST.left,
        right: POSITION_BLACKLIST.right,
      },
      tempoValue: +$('tempo').value,
    }));
  }catch{ /* storage unavailable — the app still works, just forgets */ }
}

/* Blacklist is stored/restored per hand side (see BLACKLIST below) and,
   like SETS, needs re-validating against the current digit order — a
   stale or corrupt entry just drops rather than crashing. */
function sanitizeBlacklistSide(raw, order){
  const validB=new Set(order), validS=new Set(slotsOf(order));
  const list = v => Array.isArray(v) ? v : v instanceof Set ? [...v] : [];
  return {
    B: new Set(list(raw?.B).map(String).filter(x=>validB.has(x))),
    S: new Set(list(raw?.S).map(String).filter(x=>validS.has(x))),
  };
}

/* Position-blacklist counterpart to sanitizeBlacklistSide: coerce a stored
   array of rules into valid ones for the current digit order, dropping any
   that don't survive (see sanitizePositionRule in core.js). */
function sanitizePositionRulesSide(raw, order){
  return (Array.isArray(raw) ? raw : [])
    .map(r => sanitizePositionRule(r, order))
    .filter(Boolean);
}

function loadSession(){
  let raw=null;
  try{ raw=localStorage.getItem(STORE_KEY); }catch{ return null; }
  if(!raw) return null;
  try{
    const d=JSON.parse(raw);
    if(!d || typeof d!=='object') return null;
    // a field a prior version never wrote (undefined) falls back to `def`;
    // a field explicitly stored false is a real choice and stays false
    const boolOr = (v, def) => typeof v==='boolean' ? v : def;
    const thumb=!!d.thumb;
    const rightHand=!!d.rightHand;
    const darkMode=!!d.darkMode;
    const loop=boolOr(d.loop, true);
    const randomizeAtPlay=boolOr(d.randomizeAtPlay, true);
    const showMap=boolOr(d.showMap, true);
    const splitBends=!!d.splitBends;
    const allowNesting=!!d.allowNesting;
    // a session saved before the sequence picker only ever has the old
    // boolean; map it onto its closest equivalent so nobody's playback
    // choice silently resets
    const sequence = SEQUENCE_KEYS.includes(d.sequence) ? d.sequence
      : typeof d.halfSequence==='boolean' ? (d.halfSequence ? 'halfHolySimul' : 'holySimul')
      : DEFAULT_SEQUENCE;
    const descCollapsed=!!d.descCollapsed;
    const seqOpen=!!d.seqOpen;
    const panelOpen=!!d.panelOpen;
    // nothing stored -> defaults; stored-but-empty is a real choice, so keep it
    const sets = (d.sets && typeof d.sets==='object')
      ? sanitizeSets(d.sets, digitOrder(thumb))
      : defaultSets();
    const order = digitOrder(thumb);
    const blacklist = {
      left: sanitizeBlacklistSide(d.blacklist?.left, order),
      right: sanitizeBlacklistSide(d.blacklist?.right, order),
    };
    const positionBlacklist = {
      left: sanitizePositionRulesSide(d.positionBlacklist?.left, order),
      right: sanitizePositionRulesSide(d.positionBlacklist?.right, order),
    };
    const tempoValue = Number.isFinite(d.tempoValue) ? d.tempoValue : null;
    return {thumb, rightHand, darkMode, loop, randomizeAtPlay, showMap, splitBends, allowNesting, sequence, descCollapsed, seqOpen, panelOpen, sets, blacklist, positionBlacklist, tempoValue};
  }catch{ return null; }
}

/* ============================================================
   STATE
   ============================================================ */
const restored = loadSession();
const SETS = restored?.sets ?? defaultSets();
/* Blacklisted fingers/slots, kept separately per hand side (see the
   "Right hand" switch) — switching sides swaps which blacklist is live,
   as if each hand remembers its own. A finger blacklisted on B applies to
   both B1 and B2 (they share the same finger universe); same for S1/S2
   and slots. */
const BLACKLIST = restored?.blacklist ?? { left:{B:new Set(), S:new Set()}, right:{B:new Set(), S:new Set()} };
/* Banned hand SHAPES (see docs on matchesPositionRule in core.js), also
   kept per hand side and switched the same way as BLACKLIST. Unlike
   BLACKLIST, each entry is a whole {bendOn,bendOff,splitOn,splitOff} rule
   rather than a single member, built via the position-blacklist popup. */
const POSITION_BLACKLIST = restored?.positionBlacklist ?? { left:[], right:[] };

const hand = createHand($('hand'), { onStateChange: s => { $('thumbSw').checked = s.thumb; } });

let rightHand = restored?.rightHand ?? false;
const blacklistSide = () => BLACKLIST[rightHand ? 'right' : 'left'];
const positionRulesSide = () => POSITION_BLACKLIST[rightHand ? 'right' : 'left'];
let darkMode = restored?.darkMode ?? false;
let loop = restored?.loop ?? true;
let randomizeAtPlay = restored?.randomizeAtPlay ?? true;
let showMap = restored?.showMap ?? true;
let splitBends = restored?.splitBends ?? false;
let allowNesting = restored?.allowNesting ?? false;
let sequenceKey = restored?.sequence ?? DEFAULT_SEQUENCE;
let descCollapsed = restored?.descCollapsed ?? false;
let seqOpen = restored?.seqOpen ?? false;
let panelOpen = restored?.panelOpen ?? false;
let COMPILED=[], p=-1, playing=false, timer=null, loopTimer=null, tempo=0;

/* ---- position-blacklist popup: transient (never persisted — the modal
   always starts closed and the in-progress rule always starts blank). ---- */
let posModalOpen = false;
let posDraft = emptyPositionRule();
let posApplyBoth = false;

/* The set map is a static reference overlay — useful before the sequence
   starts, noise once you're anywhere inside it (move 1 onward), playing
   or paused. So its DOM visibility tracks both the user's toggle AND the
   sequence position, even though only the toggle is persisted. */
function applyMapVisibility(){ hand.showMap(showMap && p<0); }

function applyDescCollapsed(){
  $('sub').classList.toggle('collapsed', descCollapsed);
  $('btnDesc').classList.toggle('collapsed', descCollapsed);
  $('btnDesc').setAttribute('aria-expanded', String(!descCollapsed));
}

/* Side panels are drawers, closed by default so a phone-width viewport
   shows only the hand + transport. Each edge tab only ever opens its
   panel — it hides itself once open (see .drawertab.open in CSS) so it
   never has to travel across the screen and collide with the other
   drawer's tab. Closing happens from a ✕ button inside the panel's own
   header instead, which by construction can't overlap anything else. */
function applyDrawers(){
  $('seqpanel').classList.toggle('open', seqOpen);
  $('btnSeqTab').classList.toggle('open', seqOpen);
  $('btnSeqTab').setAttribute('aria-expanded', String(seqOpen));
  $('panel').classList.toggle('open', panelOpen);
  $('btnPanelTab').classList.toggle('open', panelOpen);
  $('btnPanelTab').setAttribute('aria-expanded', String(panelOpen));
}

/* ============================================================
   PLAYER
   ============================================================ */
const seqbox=$('seqbox');

const stateAt = i =>
  i<0 ? {thumb:hand.state.thumb, bends:[], splits:[]}
      : {thumb:hand.state.thumb, ...COMPILED[i].state};

function recompile(){
  COMPILED = compile(SETS, digitOrder(hand.state.thumb), SEQUENCES[sequenceKey].steps);
  hand.setMap(SETS);
  renderSeq();
  if(p>COMPILED.length-1) p=COMPILED.length-1;
  show();
  syncChips();
}

function show(){
  hand.setState(stateAt(p));
  applyMapVisibility();
  [...seqbox.children].forEach((r,i)=>r.classList.toggle('cur', i===p));
  if(p>=0){
    revealRow(p);
  } else {
    seqbox.scrollTop=0;                       // back at the top, ready for step 1
  }
}

/* Scroll the list, never the page. scrollIntoView would drag the whole
   document when the box sits below the fold. (.seqbox is position:relative
   so a row's offsetTop is measured against it.)                        */
function revealRow(i){
  const row=seqbox.children[i]; if(!row) return;
  const top=row.offsetTop, bot=top+row.offsetHeight;
  if(top < seqbox.scrollTop) seqbox.scrollTop = top;
  else if(bot > seqbox.scrollTop + seqbox.clientHeight) seqbox.scrollTop = bot - seqbox.clientHeight;
}

function go(i){ p=Math.max(-1, Math.min(COMPILED.length-1, i)); show(); }
function stepBy(d){ let n=p+d; if(n>=COMPILED.length) n=-1; else if(n<-1) n=COMPILED.length-1; go(n); }
function tick(){
  if(!playing) return;
  if(p>=COMPILED.length-1){
    if(!loop){ setPlaying(false); return; }   // stop, don't wrap
    setPlaying(false); loopAdvance(); return;  // loop: pause at the end, then wrap
  }
  stepBy(1);
  timer=setTimeout(tick, tempo);
}
/* Plain '▶'/'⏸' text glyphs render as full-color emoji on some mobile
   browsers (font-dependent, ugly and inconsistent) — SVG paints the same
   everywhere. Injected from JS rather than written into index.html: some
   dev-reload servers naively insert their livereload <script> before
   every </svg> they find in the raw HTML, and having several inline
   <svg> blocks in the static markup made one such server duplicate that
   injection and truncate the page. Kept out of the static HTML, that
   class of tool never sees an </svg> to match. */
const ICON_PLAY = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 2l10 6-10 6z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="2" width="4" height="12" fill="currentColor"/><rect x="9" y="2" width="4" height="12" fill="currentColor"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
function setPlaying(on){
  playing=on; clearTimeout(timer);
  if(!on) clearTimeout(loopTimer);
  $('btnPlay').innerHTML = on ? ICON_PAUSE : ICON_PLAY;
  applyMapVisibility();
  if(on){ if(p>=COMPILED.length-1) p=-1; tick(); }
}

/* End of a loop pass: pause 2s back at the pre-move-1 position — randomizing
   first when "Randomize at play" is on — so the set map (if the user has it
   toggled on) reappears as a preview of what's about to play, same as it
   shows before pressing play the first time. Only ever called while not
   currently playing (see tick), so it never races the hand's own playback
   animation. */
function loopAdvance(){
  clearTimeout(loopTimer);
  if(randomizeAtPlay) randomizeSets();
  go(-1);
  loopTimer = setTimeout(()=>setPlaying(true), 2000);
}

/* "Randomize at play" only fires from loopAdvance, i.e. on an automatic
   loop wrap. Pressing play manually — whether from rest, after a pause,
   or after a reset — never randomizes, so a pause/reset/play always gives
   a second shot at the same sets. */
function playToggle(){
  if(playing){ setPlaying(false); return; }
  setPlaying(true);
}

function renderSeq(){
  seqbox.innerHTML='';
  COMPILED.forEach((c,i)=>{
    const r=document.createElement('div'); r.className='seqrow';
    r.innerHTML=`<span class="i">${i+1}</span><span class="tok">${c.token}</span><span class="lab">${c.label}</span>`;
    r.onclick=()=>{ setPlaying(false); go(i); };
    seqbox.appendChild(r);
  });
}

/* ---- tempo: the slider reads as SPEED, so ms = span - value.
   Derived from the DOM at boot so the two can't drift apart.   */
const TEMPO_SPAN=1980;
function readTempo(){ tempo = TEMPO_SPAN - (+$('tempo').value); }

/* ---- set-membership chips ---------------------------------- */

/* "Split bends" off: a slot can't be split while a digit it would move is
   folded (hasIllegalOverlap). Test the WHOLE hypothetical sets against
   the compiled routine — not just the edited set in isolation — since an
   overlap can come from any pair of currently-active sets at any step. */
function violatesPhysical(testSets){
  if(splitBends) return false;
  const order=digitOrder(hand.state.thumb);
  const slots=slotsOf(order);
  return compile(testSets, order, SEQUENCES[sequenceKey].steps).some(c=>hasIllegalOverlap(c.state.bends, c.state.splits, slots));
}

/* "Nested sets" off: neither of B1/B2 (or S1/S2) may be a full subset of
   the other, since that's the one shape of overlap that can produce a
   completely motionless step — see hasSiblingSubset. Partial overlap
   (some fingers redundant, some not) is always fine and never checked. */
function violatesNesting(testSets){
  return !allowNesting && hasSiblingSubset(testSets);
}

function wouldViolate(testSets){
  return violatesPhysical(testSets) || violatesNesting(testSets);
}

const siblingKey = key => key==='B1'?'B2' : key==='B2'?'B1' : key==='S1'?'S2' : 'S1';

/* Force a member on by evicting whatever's blocking it.

   Physical: a digit going into a bend set evicts any split-set slot
   bordering it; a slot going into a split set evicts either border digit
   from the bend sets. Only runs while "Split bends" is off.

   Nesting: B1/B2 and S1/S2 need different fixes because they need
   different checks (see hasSiblingSubset's comment in core.js). For B1/B2,
   adding `id` to `key` can make the new key-set a subset of its sibling
   (fixed by evicting `id` from the sibling — it's now the one member
   telling them apart) or can make the sibling a subset of the new, larger
   key-set (fixed by evicting some OTHER member the two sets still share
   from key itself, since `id` must stay put; if the sibling turns out to
   consist of nothing but `id`, there's no such member to spare and the
   sibling is cleared instead). For S1/S2, only exact equality is a
   problem, and evicting `id` from the sibling always breaks an equality
   (the two can no longer match once only one of them has `id`), so no
   second phase is needed. Only runs while "Nested sets" is off.

   Either way the toggle the user actually clicked always lands.        */
function evictBlockers(key, id){
  if(key[0]==='B'){
    if(!splitBends) for(const sk of ['S1','S2']) for(const slot of [...SETS[sk]])
      if(slot[0]===id || slot.slice(1)===id) SETS[sk].delete(slot);
  } else if(!splitBends){
    const a=id[0], b=id.slice(1);
    for(const bk of ['B1','B2']){ SETS[bk].delete(a); SETS[bk].delete(b); }
  }

  if(allowNesting) return;
  const sib = SETS[siblingKey(key)];
  const keySet = new Set(SETS[key]).add(id);
  if(key[0]==='B'){
    if(subsumes(keySet, sib)) sib.delete(id);
    if(sib.size>0 && subsumes(sib, keySet)){
      const victim = [...keySet].find(x => x!==id && sib.has(x));
      if(victim!==undefined) SETS[key].delete(victim);
      else sib.clear();
    }
  } else if(setsEqual(keySet, sib)){
    sib.delete(id);
  }
}

function buildSetChips(){
  const order=digitOrder(hand.state.thumb), slots=slotsOf(order);
  for(const key of SET_KEYS){
    const universe = key[0]==='B' ? order : slots;
    const cls = key.toLowerCase();       // b1/b2/s1/s2 — matches the set-map colors
    const box=$(key); box.innerHTML='';
    universe.forEach(id=>{
      const c=document.createElement('div');
      c.className='chip '+cls+(SETS[key].has(id)?' on':''); c.textContent=id; c.dataset.id=id;
      c.onclick=(e)=>{
        const bl = key[0]==='B' ? blacklistSide().B : blacklistSide().S;
        if(e.shiftKey){
          if(bl.has(id)){
            bl.delete(id);
          } else {
            bl.add(id);
            // a blacklisted move can't stay selected in either sibling set
            for(const k of SET_KEYS) if(k[0]===key[0]) SETS[k].delete(id);
          }
          recompile(); updateRandCount(); saveSession();
          return;
        }
        if(bl.has(id)){
          c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
          return;
        }
        const turningOn = !SETS[key].has(id);
        if(turningOn){
          const testSet=new Set(SETS[key]); testSet.add(id);
          if(wouldViolate({...SETS, [key]:testSet})) evictBlockers(key, id);
          SETS[key].add(id);
        } else {
          SETS[key].delete(id);
        }
        recompile(); saveSession();
      };
      box.appendChild(c);
    });
  }
  syncChips();
}

/* Keep every chip's on/off look and its "would violate" mute in step with
   SETS — needed after a plain click AND after evictBlockers silently
   changes membership in a set whose chips live elsewhere in the panel.
   Also flags any set that's gone empty (see index.html's .setwarn rows). */
function syncChips(){
  for(const key of SET_KEYS){
    const bl = key[0]==='B' ? blacklistSide().B : blacklistSide().S;
    [...$(key).children].forEach(c=>{
      const id=c.dataset.id, isOn=SETS[key].has(id), isBlack=bl.has(id);
      c.classList.toggle('on', isOn);
      c.classList.toggle('blacklisted', isBlack);
      let title='';
      if(isBlack){
        title='Blacklisted — shift+click to re-enable it';
      } else if(!isOn){
        const testSets={...SETS, [key]:new Set(SETS[key]).add(id)};
        if(violatesPhysical(testSets))
          title="Would split a folded finger — click to force it (frees the finger/slot blocking it), or enable Split bends";
        else if(violatesNesting(testSets))
          title="Would make one set fully cover the other, so nothing would move — click to force it, or enable Nested sets";
      }
      c.classList.toggle('disabled', !!title && !isBlack);
      c.title = title;
    });
    const warn=$(key+'warn'); if(warn) warn.hidden = SETS[key].size>0;
  }
}

/* Size of the pool "Randomize sets" is drawing from — shown on the button
   itself so the two physicality toggles visibly shrink/grow it. Only
   thumb/splitBends/allowNesting affect the count (not the sets currently
   chosen), so it's recomputed on those changes rather than every click. */
function updateRandCount(){
  const order = digitOrder(hand.state.thumb);
  const n = countPossibleCombinations(order, !splitBends, allowNesting, blacklistSide(), SEQUENCES[sequenceKey].steps, positionRulesSide());
  $('randCount').textContent = `(${n.toLocaleString()} combinations)`;
}

/* "Split bends" off keeps to physically legal combinations; "Nested sets"
   off keeps neither of B1/B2 (or S1/S2) a subset of the other so no step
   is a no-op — both filters are enforced inside randomSets itself. */
function randomizeSets(){
  const order = digitOrder(hand.state.thumb);
  const next = randomSets(order, !splitBends, allowNesting, Math.random, blacklistSide(), SEQUENCES[sequenceKey].steps, positionRulesSide());
  for(const key of SET_KEYS) SETS[key] = next[key];
  recompile(); saveSession();
}

/* ---- sets as text: copy the current four sets, or paste+Enter a
   string in the same shape to load them back (round-trips exactly;
   see serializeSets/parseSetsText in core.js). Bypasses the chip
   click-time physical/nesting eviction — same as restoring from
   storage — so a pasted string can land an intentionally "illegal"
   combo if that's what it says.                                    */
function copySetsText(){
  const order = digitOrder(hand.state.thumb);
  const text = serializeSets(SETS, order);
  navigator.clipboard?.writeText(text).then(()=>{
    const btn=$('btnCopySets'), was=btn.textContent;
    btn.textContent='Copied!';
    setTimeout(()=>{ btn.textContent=was; }, 1200);
  }).catch(()=>{ $('setsInput').value=text; $('setsInput').select(); });
}

function loadSetsFromInput(){
  const input=$('setsInput');
  const parsed=parseSetsText(input.value);
  const missing=SET_KEYS.filter(k=>!(k in parsed));
  if(missing.length){
    input.setCustomValidity(`Missing ${missing.join(', ')} — expected e.g. B1:1,2 B2:3 S1:34 S2:12`);
    input.reportValidity();
    return;
  }
  input.setCustomValidity('');
  const order = digitOrder(hand.state.thumb);
  Object.assign(SETS, sanitizeSets(parsed, order));
  recompile(); saveSession();
  input.value='';
}

/* ---- position blacklist: ban whole hand SHAPES ---------------
   A separate, independent denylist from BLACKLIST above — it doesn't
   remove members from the draw pool, it rejects whole {B1,B2,S1,S2}
   candidates whose compiled playback ever matches a banned shape (see
   matchesPositionRule in core.js). Scoped to the randomizer/counter only,
   exactly like BLACKLIST — manual chip-building is untouched. Composed in
   its own modal so the thumb/hand-side/sequence (which the builder's
   chip grid and "current" rule list both depend on) can't change out
   from under a rule mid-edit — the backdrop blocks the rest of the page
   while it's open. */

function cloneRule(r){
  return { bendOn:[...r.bendOn], bendOff:[...r.bendOff], splitOn:[...r.splitOn], splitOff:[...r.splitOff] };
}

// wildcard -> required-on -> required-off -> wildcard
function cyclePosState(onList, offList, id){
  const oi=onList.indexOf(id), fi=offList.indexOf(id);
  if(oi!==-1){ onList.splice(oi,1); offList.push(id); }
  else if(fi!==-1){ offList.splice(fi,1); }
  else onList.push(id);
}

function posChipState(onList, offList, id){
  return onList.includes(id) ? 'reqon' : offList.includes(id) ? 'reqoff' : '';
}

function buildPositionBuilderChips(){
  const order=digitOrder(hand.state.thumb), slots=slotsOf(order);
  const bendBox=$('posBendChips'), splitBox=$('posSplitChips');
  bendBox.innerHTML=''; splitBox.innerHTML='';
  order.forEach(id=>{
    const c=document.createElement('div');
    c.className=`chip posbuild bendctx ${posChipState(posDraft.bendOn, posDraft.bendOff, id)}`.trim();
    c.textContent=id;
    c.title='Click to cycle: wildcard → must bend → must NOT bend';
    c.onclick=()=>{ cyclePosState(posDraft.bendOn, posDraft.bendOff, id); buildPositionBuilderChips(); };
    bendBox.appendChild(c);
  });
  slots.forEach(id=>{
    const c=document.createElement('div');
    c.className=`chip posbuild splitctx ${posChipState(posDraft.splitOn, posDraft.splitOff, id)}`.trim();
    c.textContent=id;
    c.title='Click to cycle: wildcard → must split → must NOT split';
    c.onclick=()=>{ cyclePosState(posDraft.splitOn, posDraft.splitOff, id); buildPositionBuilderChips(); };
    splitBox.appendChild(c);
  });
  $('btnPosAdd').disabled = isEmptyPositionRule(posDraft);
  const desc = describePositionRule(posDraft);
  $('posDraftSummary').textContent = desc ? `Banned when: ${desc}.` : 'Pick at least one chip above to start a rule.';
}

/* Rules are stored per hand side (see POSITION_BLACKLIST), and "apply to
   both hands" stores two independent clones rather than one shared entry
   — there is no stored link between them. Rendering the two sides as two
   separately-labeled lists ("Existing rules — left hand") read as a
   contradiction the moment a row inside it said "(both hands)". Instead,
   merge left+right into ONE list here, content-matching a left rule
   against its right-side twin (if any) via positionRuleEquals, so each
   rule appears exactly once with an honest "left/right/both hands" tag —
   regardless of which hand happens to be active in the main panel. */
function mergedPositionRules(){
  const usedRight = new Set();
  const merged = POSITION_BLACKLIST.left.map((rule, li) => {
    const ri = POSITION_BLACKLIST.right.findIndex((r,idx)=>!usedRight.has(idx) && positionRuleEquals(r, rule));
    if(ri!==-1) usedRight.add(ri);
    return { rule, li, ri: ri===-1 ? null : ri };
  });
  POSITION_BLACKLIST.right.forEach((rule, ri) => {
    if(!usedRight.has(ri)) merged.push({ rule, li:null, ri });
  });
  return merged;
}

function renderPositionRuleList(){
  const order=digitOrder(hand.state.thumb), slots=slotsOf(order);
  const box=$('posRuleList');
  box.innerHTML='';
  const merged = mergedPositionRules();
  if(!merged.length){
    box.innerHTML='<p class="hint">No banned positions yet.</p>';
    return;
  }
  /* The plain-English caption is the primary way to read a rule; the
     labeled Bend/Split chip rows underneath are a secondary, at-a-glance
     reference once you know the notation. */
  merged.forEach(({rule, li, ri})=>{
    const row=document.createElement('div'); row.className='posrule';
    const body=document.createElement('div'); body.className='posrulebody';

    const caption=document.createElement('div'); caption.className='posrulecaption';
    const handTagText = li!=null && ri!=null ? 'both hands' : li!=null ? 'left hand only' : 'right hand only';
    caption.textContent = `Banned when: ${describePositionRule(rule)}. `;
    const handTag=document.createElement('span'); handTag.className='handtag'; handTag.textContent=`(${handTagText})`;
    caption.appendChild(handTag);
    body.appendChild(caption);

    const bendIds = order.filter(id=>posChipState(rule.bendOn, rule.bendOff, id));
    const splitIds = slots.filter(id=>posChipState(rule.splitOn, rule.splitOff, id));

    const addGroup = (label, cls, ids, onList, offList) => {
      if(!ids.length) return;
      const grp=document.createElement('div'); grp.className='posrulegroup';
      const lab=document.createElement('span'); lab.className=`setlab mini ${cls}`; lab.textContent=label;
      const chips=document.createElement('div'); chips.className='chips';
      ids.forEach(id=>{
        const c=document.createElement('div');
        c.className=`chip posbuild ${cls}ctx ${posChipState(onList, offList, id)}`;
        c.textContent=id;
        chips.appendChild(c);
      });
      grp.appendChild(lab); grp.appendChild(chips);
      body.appendChild(grp);
    };
    addGroup('Bend', 'bend', bendIds, rule.bendOn, rule.bendOff);
    addGroup('Split', 'split', splitIds, rule.splitOn, rule.splitOff);

    const rm=document.createElement('button');
    rm.className='closebtn rmbtn'; rm.type='button'; rm.title='Remove this rule';
    rm.innerHTML=ICON_CLOSE;
    rm.onclick=()=>{
      if(li!=null) POSITION_BLACKLIST.left.splice(li,1);
      if(ri!=null) POSITION_BLACKLIST.right.splice(ri,1);
      renderPositionRuleList(); updateRandCount(); saveSession();
    };
    row.appendChild(body); row.appendChild(rm);
    box.appendChild(row);
  });
}

function openPositionRuleModal(){
  posDraft=emptyPositionRule(); posApplyBoth=false;
  $('posApplyTo').querySelectorAll('.segbtn').forEach(b=>b.classList.toggle('on', b.dataset.val==='this'));
  $('posApplyTo').querySelector('[data-val="this"]').textContent = `This hand (${rightHand ? 'right' : 'left'})`;
  buildPositionBuilderChips();
  renderPositionRuleList();
  posModalOpen=true;
  $('posModalBackdrop').hidden=false;
  $('posModal').hidden=false;
}

function closePositionRuleModal(){
  posModalOpen=false;
  $('posModalBackdrop').hidden=true;
  $('posModal').hidden=true;
}

function addPositionRule(){
  if(isEmptyPositionRule(posDraft)) return;
  if(posApplyBoth){
    POSITION_BLACKLIST.left.push(cloneRule(posDraft));
    POSITION_BLACKLIST.right.push(cloneRule(posDraft));
  } else {
    positionRulesSide().push(cloneRule(posDraft));
  }
  posDraft=emptyPositionRule();
  buildPositionBuilderChips();
  renderPositionRuleList();
  updateRandCount(); saveSession();
}

/* ---- wiring ------------------------------------------------- */
$('thumbSw').onchange=()=>{
  hand.enableThumb($('thumbSw').checked);
  const order = digitOrder(hand.state.thumb);
  Object.assign(SETS, sanitizeSets(SETS, order));
  BLACKLIST.left = sanitizeBlacklistSide(BLACKLIST.left, order);
  BLACKLIST.right = sanitizeBlacklistSide(BLACKLIST.right, order);
  POSITION_BLACKLIST.left = sanitizePositionRulesSide(POSITION_BLACKLIST.left, order);
  POSITION_BLACKLIST.right = sanitizePositionRulesSide(POSITION_BLACKLIST.right, order);
  buildSetChips(); recompile(); updateRandCount(); saveSession();
};
$('handSw').onchange=()=>{
  rightHand = $('handSw').checked;
  $('hand').classList.toggle('right', rightHand);
  syncChips(); updateRandCount(); saveSession();
};
$('darkSw').onchange=()=>{
  darkMode = $('darkSw').checked;
  document.body.classList.toggle('dark', darkMode);
  saveSession();
};
$('loopSw').onchange=()=>{
  loop = $('loopSw').checked;
  if(!loop) clearTimeout(loopTimer);
  saveSession();
};
$('crSw').onchange=()=>{
  randomizeAtPlay = $('crSw').checked;
  saveSession();
};
$('mapSw').onchange=()=>{ showMap = $('mapSw').checked; applyMapVisibility(); saveSession(); };
$('splitBendsSw').onchange=()=>{ splitBends = $('splitBendsSw').checked; syncChips(); updateRandCount(); saveSession(); };
$('nestedSw').onchange=()=>{ allowNesting = $('nestedSw').checked; syncChips(); updateRandCount(); saveSession(); };
$('seqSel').onchange=()=>{
  sequenceKey = $('seqSel').value;
  setPlaying(false); recompile(); updateRandCount(); saveSession();
};
$('btnDesc').onclick=()=>{ descCollapsed = !descCollapsed; applyDescCollapsed(); saveSession(); };
$('btnSeqTab').onclick=()=>{ seqOpen = true; applyDrawers(); saveSession(); };
$('btnSeqClose').onclick=()=>{ seqOpen = false; applyDrawers(); saveSession(); };
$('btnPanelTab').onclick=()=>{ panelOpen = true; applyDrawers(); saveSession(); };
$('btnPanelClose').onclick=()=>{ panelOpen = false; applyDrawers(); saveSession(); };
$('btnPosRules').onclick = openPositionRuleModal;
$('btnPosModalClose').onclick = closePositionRuleModal;
$('posModalBackdrop').onclick = closePositionRuleModal;
$('btnPosAdd').onclick = addPositionRule;
$('posApplyTo').querySelectorAll('.segbtn').forEach(b=>{
  b.onclick = ()=>{
    posApplyBoth = b.dataset.val==='both';
    $('posApplyTo').querySelectorAll('.segbtn').forEach(x=>x.classList.toggle('on', x===b));
  };
});
$('btnRandom').onclick=randomizeSets;
$('btnCopySets').onclick=copySetsText;
$('setsInput').addEventListener('keydown', e=>{
  if(e.key!=='Enter') return;
  e.preventDefault();
  loadSetsFromInput();
});
$('setsInput').addEventListener('input', ()=>$('setsInput').setCustomValidity(''));
$('btnPlay').onclick = playToggle;
$('btnNext').onclick =()=>{ setPlaying(false); stepBy(1); };
$('btnPrev').onclick =()=>{ setPlaying(false); stepBy(-1); };
$('btnReset').onclick=()=>{ setPlaying(false); go(-1); };
$('tempo').oninput   = ()=>{ readTempo(); saveSession(); };

document.addEventListener('keydown', e=>{
  if(e.code!=='Space' && e.key!==' ') return;
  const t = e.target;
  const tag = t?.tagName;
  const type = t?.type;
  const isTextualInput = tag==='INPUT' && type!=='checkbox' && type!=='radio' && type!=='button' && type!=='submit' && type!=='range';
  if(isTextualInput || tag==='SELECT' || tag==='TEXTAREA' || t?.isContentEditable) return;
  e.preventDefault();
  playToggle();
});

document.addEventListener('keydown', e=>{
  if(e.key!=='Escape') return;
  if(posModalOpen){ closePositionRuleModal(); return; }
  if(!seqOpen && !panelOpen) return;
  seqOpen=false; panelOpen=false;
  applyDrawers(); saveSession();
});

document.addEventListener('keydown', e=>{
  if(e.key!=='r' && e.key!=='R') return;
  const t = e.target;
  const tag = t?.tagName;
  const type = t?.type;
  const isTextualInput = tag==='INPUT' && type!=='checkbox' && type!=='radio' && type!=='button' && type!=='submit' && type!=='range';
  if(isTextualInput || tag==='SELECT' || tag==='TEXTAREA' || t?.isContentEditable) return;
  e.preventDefault();
  setPlaying(false); go(-1);
});

document.addEventListener('keydown', e=>{
  if(e.key!=='s' && e.key!=='S') return;
  const t = e.target;
  const tag = t?.tagName;
  const type = t?.type;
  const isTextualInput = tag==='INPUT' && type!=='checkbox' && type!=='radio' && type!=='button' && type!=='submit' && type!=='range';
  if(isTextualInput || tag==='SELECT' || tag==='TEXTAREA' || t?.isContentEditable) return;
  e.preventDefault();
  $('handSw').checked = !$('handSw').checked;
  $('handSw').onchange();
});

/* ---- code-driven use from the console ----------------------- */
window.hand = hand;
window.routine = {
  get compiled(){ return COMPILED; }, sets:SETS, recompile, goto:go,
  play:()=>setPlaying(true), pause:()=>setPlaying(false),
  get sequence(){ return sequenceKey; },
  validate:()=>validateRoutine(SEQUENCES[sequenceKey].steps),
};

/* ---------- boot -------------------------------------------- */
$('btnPlay').innerHTML = ICON_PLAY;
$('btnSeqClose').innerHTML = ICON_CLOSE;
$('btnPanelClose').innerHTML = ICON_CLOSE;
if(restored?.tempoValue!=null) $('tempo').value = restored.tempoValue;
readTempo();
if(restored?.thumb) hand.enableThumb(true);
$('thumbSw').checked = hand.state.thumb;
$('handSw').checked = rightHand;
$('hand').classList.toggle('right', rightHand);
$('darkSw').checked = darkMode;
document.body.classList.toggle('dark', darkMode);
$('loopSw').checked = loop;
$('crSw').checked = randomizeAtPlay;
$('mapSw').checked = showMap;
$('splitBendsSw').checked = splitBends;
$('nestedSw').checked = allowNesting;
for(const key of SEQUENCE_KEYS){
  const opt = document.createElement('option');
  opt.value = key; opt.textContent = SEQUENCES[key].label;
  $('seqSel').appendChild(opt);
}
$('seqSel').value = sequenceKey;
applyMapVisibility();
applyDescCollapsed();
applyDrawers();
buildSetChips();
recompile();
updateRandCount();
go(-1);
