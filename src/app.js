/* ============================================================
   APP — controls, player, persistence, boot. The only file that
   touches the page chrome; core.js holds the model and hand.js
   the puppet.
   ============================================================ */
import {
  ROUTINE, HALF, SET_KEYS, digitOrder, slotsOf, validateRoutine, compile, defaultSets, sanitizeSets,
  hasIllegalOverlap, hasSiblingSubset, subsumes, setsEqual, randomSets, countPossibleCombinations,
} from './core.js';
import { createHand } from './hand.js';

const $ = id => document.getElementById(id);

/* ---- fail loud: the const must be sound -------------------- */
const ROUTINE_ERRORS = validateRoutine(ROUTINE);
if(ROUTINE_ERRORS.length){
  const e=$('err');
  e.hidden=false; e.textContent='⚠ Illegal routine — '+ROUTINE_ERRORS.join('  •  ');
  console.error('Illegal routine:', ROUTINE_ERRORS);
  throw new Error('Illegal routine: '+ROUTINE_ERRORS[0]);
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
      halfSequence,
      descCollapsed,
      seqOpen,
      panelOpen,
      sets: Object.fromEntries(SET_KEYS.map(k=>[k,[...SETS[k]]])),
      tempoValue: +$('tempo').value,
    }));
  }catch{ /* storage unavailable — the app still works, just forgets */ }
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
    const halfSequence=boolOr(d.halfSequence, true);
    const descCollapsed=!!d.descCollapsed;
    const seqOpen=!!d.seqOpen;
    const panelOpen=!!d.panelOpen;
    // nothing stored -> defaults; stored-but-empty is a real choice, so keep it
    const sets = (d.sets && typeof d.sets==='object')
      ? sanitizeSets(d.sets, digitOrder(thumb))
      : defaultSets();
    const tempoValue = Number.isFinite(d.tempoValue) ? d.tempoValue : null;
    return {thumb, rightHand, darkMode, loop, randomizeAtPlay, showMap, splitBends, allowNesting, halfSequence, descCollapsed, seqOpen, panelOpen, sets, tempoValue};
  }catch{ return null; }
}

/* ============================================================
   STATE
   ============================================================ */
const restored = loadSession();
const SETS = restored?.sets ?? defaultSets();

const hand = createHand($('hand'), { onStateChange: s => { $('thumbSw').checked = s.thumb; } });

let rightHand = restored?.rightHand ?? false;
let darkMode = restored?.darkMode ?? false;
let loop = restored?.loop ?? true;
let randomizeAtPlay = restored?.randomizeAtPlay ?? true;
let showMap = restored?.showMap ?? true;
let splitBends = restored?.splitBends ?? false;
let allowNesting = restored?.allowNesting ?? false;
let halfSequence = restored?.halfSequence ?? true;
let descCollapsed = restored?.descCollapsed ?? false;
let seqOpen = restored?.seqOpen ?? false;
let panelOpen = restored?.panelOpen ?? false;
let COMPILED=[], p=-1, playing=false, timer=null, crTimer=null, tempo=0;

/* The set map is a static reference overlay — useful while composing sets,
   noise while the hand is actually moving. So its DOM visibility tracks
   both the user's toggle AND playback, even though only the toggle is
   persisted. */
function applyMapVisibility(){ hand.showMap(showMap && !playing); }

function applyDescCollapsed(){
  $('sub').classList.toggle('collapsed', descCollapsed);
  $('btnDesc').classList.toggle('collapsed', descCollapsed);
  $('btnDesc').setAttribute('aria-expanded', String(!descCollapsed));
}

/* Side panels are drawers, closed by default so a phone-width viewport
   shows only the hand + transport. Each tab's arrow points the way it'll
   slide the panel (open) or itself (close). */
function applyDrawers(){
  $('seqpanel').classList.toggle('open', seqOpen);
  $('btnSeqTab').setAttribute('aria-expanded', String(seqOpen));
  $('btnSeqTab').textContent = seqOpen ? '‹' : '›';
  $('panel').classList.toggle('open', panelOpen);
  $('btnPanelTab').setAttribute('aria-expanded', String(panelOpen));
  $('btnPanelTab').textContent = panelOpen ? '›' : '‹';
}

/* ============================================================
   PLAYER
   ============================================================ */
const seqbox=$('seqbox');

const stateAt = i =>
  i<0 ? {thumb:hand.state.thumb, bends:[], splits:[]}
      : {thumb:hand.state.thumb, ...COMPILED[i].state};

function recompile(){
  COMPILED = compile(SETS, digitOrder(hand.state.thumb));
  if(halfSequence) COMPILED = COMPILED.slice(0, HALF.length);
  hand.setMap(SETS);
  renderSeq();
  if(p>COMPILED.length-1) p=COMPILED.length-1;
  show();
  syncChips();
}

function show(){
  hand.setState(stateAt(p));
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
    if(randomizeAtPlay){ setPlaying(false); crAdvance(); return; }  // loop by re-randomizing
  }
  stepBy(1);
  timer=setTimeout(tick, tempo);
}
function setPlaying(on){
  playing=on; clearTimeout(timer);
  if(!on) clearTimeout(crTimer);
  $('btnPlay').textContent = on?'⏸':'▶';
  applyMapVisibility();
  if(on){ if(p>=COMPILED.length-1) p=-1; tick(); }
}

/* Loop's re-randomize cycle (when "randomize at play" is on): randomize,
   pause 2s (so there's time to read the set map even when it's off), then
   play. Only ever called while not currently playing (see playToggle/tick),
   so it never races the hand's own playback animation. */
function crAdvance(){
  clearTimeout(crTimer);
  randomizeSets();
  crTimer = setTimeout(()=>setPlaying(true), 2000);
}

/* "Randomize at play" fires once, right here, on a fresh start (from rest,
   or right after a playthrough ends) — resuming a paused mid-sequence
   playthrough just resumes it, same as always. */
function playToggle(){
  if(playing){ setPlaying(false); return; }
  if(randomizeAtPlay && (p<0 || p>=COMPILED.length-1)) randomizeSets();
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
const TEMPO_SPAN=1380;
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
  return compile(testSets, order).some(c=>hasIllegalOverlap(c.state.bends, c.state.splits, slots));
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
      c.onclick=()=>{
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
    [...$(key).children].forEach(c=>{
      const id=c.dataset.id, isOn=SETS[key].has(id);
      c.classList.toggle('on', isOn);
      let title='';
      if(!isOn){
        const testSets={...SETS, [key]:new Set(SETS[key]).add(id)};
        if(violatesPhysical(testSets))
          title="Would split a folded finger — click to force it (frees the finger/slot blocking it), or enable Split bends";
        else if(violatesNesting(testSets))
          title="Would make one set fully cover the other, so nothing would move — click to force it, or enable Nested sets";
      }
      c.classList.toggle('disabled', !!title);
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
  const n = countPossibleCombinations(order, !splitBends, allowNesting);
  $('randCount').textContent = `(${n.toLocaleString()} combinations)`;
}

/* "Split bends" off keeps to physically legal combinations; "Nested sets"
   off keeps neither of B1/B2 (or S1/S2) a subset of the other so no step
   is a no-op — both filters are enforced inside randomSets itself. */
function randomizeSets(){
  const order = digitOrder(hand.state.thumb);
  const next = randomSets(order, !splitBends, allowNesting);
  for(const key of SET_KEYS) SETS[key] = next[key];
  recompile(); saveSession();
}

/* ---- wiring ------------------------------------------------- */
$('thumbSw').onchange=()=>{
  hand.enableThumb($('thumbSw').checked);
  Object.assign(SETS, sanitizeSets(SETS, digitOrder(hand.state.thumb)));
  buildSetChips(); recompile(); updateRandCount(); saveSession();
};
$('handSw').onchange=()=>{
  rightHand = $('handSw').checked;
  $('hand').classList.toggle('right', rightHand);
  saveSession();
};
$('darkSw').onchange=()=>{
  darkMode = $('darkSw').checked;
  document.body.classList.toggle('dark', darkMode);
  saveSession();
};
$('loopSw').onchange=()=>{
  loop = $('loopSw').checked;
  if(!loop) clearTimeout(crTimer);
  saveSession();
};
$('crSw').onchange=()=>{
  randomizeAtPlay = $('crSw').checked;
  if(!randomizeAtPlay) clearTimeout(crTimer);
  saveSession();
};
$('mapSw').onchange=()=>{ showMap = $('mapSw').checked; applyMapVisibility(); saveSession(); };
$('splitBendsSw').onchange=()=>{ splitBends = $('splitBendsSw').checked; syncChips(); updateRandCount(); saveSession(); };
$('nestedSw').onchange=()=>{ allowNesting = $('nestedSw').checked; syncChips(); updateRandCount(); saveSession(); };
$('halfSw').onchange=()=>{ halfSequence = $('halfSw').checked; setPlaying(false); recompile(); saveSession(); };
$('btnDesc').onclick=()=>{ descCollapsed = !descCollapsed; applyDescCollapsed(); saveSession(); };
$('btnSeqTab').onclick=()=>{ seqOpen = !seqOpen; applyDrawers(); saveSession(); };
$('btnPanelTab').onclick=()=>{ panelOpen = !panelOpen; applyDrawers(); saveSession(); };
$('btnRandom').onclick=randomizeSets;
$('btnPlay').onclick = playToggle;
$('btnNext').onclick =()=>{ setPlaying(false); stepBy(1); };
$('btnPrev').onclick =()=>{ setPlaying(false); stepBy(-1); };
$('btnReset').onclick=()=>{ setPlaying(false); go(-1); };
$('tempo').oninput   = ()=>{ readTempo(); saveSession(); };

document.addEventListener('keydown', e=>{
  if(e.code!=='Space' && e.key!==' ') return;
  const t = e.target;
  const tag = t?.tagName;
  if(tag==='INPUT' || tag==='SELECT' || tag==='TEXTAREA' || t?.isContentEditable) return;
  e.preventDefault();
  playToggle();
});

document.addEventListener('keydown', e=>{
  if(e.key!=='Escape' || (!seqOpen && !panelOpen)) return;
  seqOpen=false; panelOpen=false;
  applyDrawers(); saveSession();
});

/* ---- code-driven use from the console ----------------------- */
window.hand = hand;
window.routine = {
  get compiled(){ return COMPILED; }, sets:SETS, recompile, goto:go,
  play:()=>setPlaying(true), pause:()=>setPlaying(false),
  validate:()=>validateRoutine(ROUTINE),
};

/* ---------- boot -------------------------------------------- */
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
$('halfSw').checked = halfSequence;
applyMapVisibility();
applyDescCollapsed();
applyDrawers();
buildSetChips();
recompile();
updateRandCount();
go(-1);
