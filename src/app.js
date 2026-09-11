/* ============================================================
   APP — controls, player, persistence, boot. The only file that
   touches the page chrome; core.js holds the model and hand.js
   the puppet.
   ============================================================ */
import {
  ROUTINE, SET_KEYS, digitOrder, slotsOf, validateRoutine, compile, defaultSets, sanitizeSets,
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
      loop,
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
    const thumb=!!d.thumb;
    const rightHand=!!d.rightHand;
    const loop=!!d.loop;
    // nothing stored -> defaults; stored-but-empty is a real choice, so keep it
    const sets = (d.sets && typeof d.sets==='object')
      ? sanitizeSets(d.sets, digitOrder(thumb))
      : defaultSets();
    const tempoValue = Number.isFinite(d.tempoValue) ? d.tempoValue : null;
    return {thumb, rightHand, loop, sets, tempoValue};
  }catch{ return null; }
}

/* ============================================================
   STATE
   ============================================================ */
const restored = loadSession();
const SETS = restored?.sets ?? defaultSets();

const hand = createHand($('hand'), { onStateChange: s => { $('thumbSw').checked = s.thumb; } });

let rightHand = restored?.rightHand ?? false;
let loop = restored?.loop ?? false;
let COMPILED=[], p=-1, playing=false, timer=null, tempo=0;

/* ============================================================
   PLAYER
   ============================================================ */
const seqbox=$('seqbox'), nowEl=$('now');

const stateAt = i =>
  i<0 ? {thumb:hand.state.thumb, bends:[], splits:[]}
      : {thumb:hand.state.thumb, ...COMPILED[i].state};

function recompile(){
  COMPILED = compile(SETS, digitOrder(hand.state.thumb));
  renderSeq();
  if(p>COMPILED.length-1) p=COMPILED.length-1;
  show();
}

function show(){
  hand.setState(stateAt(p));
  [...seqbox.children].forEach((r,i)=>r.classList.toggle('cur', i===p));
  if(p>=0){
    const c=COMPILED[p];
    nowEl.classList.remove('rest');
    nowEl.innerHTML=`<span class="tok">${p+1}. ${c.token}</span>${c.label}`;
    revealRow(p);
  } else {
    nowEl.classList.add('rest'); nowEl.textContent='— ready —';
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
  if(!loop && p>=COMPILED.length-1){ setPlaying(false); return; }   // stop, don't wrap
  stepBy(1);
  timer=setTimeout(tick, tempo);
}
function setPlaying(on){
  playing=on; clearTimeout(timer);
  $('btnPlay').textContent = on?'⏸':'▶';
  if(on){ if(p>=COMPILED.length-1) p=-1; tick(); }
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
function buildSetChips(){
  const order=digitOrder(hand.state.thumb), slots=slotsOf(order);
  for(const key of SET_KEYS){
    const universe = key[0]==='B' ? order : slots;
    const cls = key[0]==='B' ? 'bend' : 'split';
    const box=$(key); box.innerHTML='';
    universe.forEach(id=>{
      const c=document.createElement('div');
      c.className='chip '+cls+(SETS[key].has(id)?' on':''); c.textContent=id;
      c.onclick=()=>{
        SETS[key].has(id) ? SETS[key].delete(id) : SETS[key].add(id);
        c.classList.toggle('on'); recompile(); saveSession();
      };
      box.appendChild(c);
    });
  }
}

/* ---- wiring ------------------------------------------------- */
$('thumbSw').onchange=()=>{
  hand.enableThumb($('thumbSw').checked);
  Object.assign(SETS, sanitizeSets(SETS, digitOrder(hand.state.thumb)));
  buildSetChips(); recompile(); saveSession();
};
$('handSw').onchange=()=>{
  rightHand = $('handSw').checked;
  $('hand').classList.toggle('right', rightHand);
  saveSession();
};
$('loopSw').onchange=()=>{ loop = $('loopSw').checked; saveSession(); };
$('btnPlay').onclick =()=>setPlaying(!playing);
$('btnNext').onclick =()=>{ setPlaying(false); stepBy(1); };
$('btnPrev').onclick =()=>{ setPlaying(false); stepBy(-1); };
$('btnReset').onclick=()=>{ setPlaying(false); go(-1); };
$('tempo').oninput   = ()=>{ readTempo(); saveSession(); };

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
$('loopSw').checked = loop;
buildSetChips();
recompile();
go(-1);
