/* ============================================================
   HAND — the puppet. Builds the SVG once, then animates transforms
   every frame. Knows nothing about the routine; the only way in is
   the API returned by createHand().
   ============================================================ */
import { DIGIT_TABLE, digitOrder, slotsOf, splayAngles } from './core.js';

/* canvas geometry — where the drawing sits, not what a hand IS
   (anatomy lives in core's DIGIT_TABLE)                          */
const KY = 220;                 // knuckle line (finger bases sit here)
const FX0 = 131, FX1 = 329;     // finger band = full palm width across the knuckle line
const THUMB_BASE = {x:120, y:396}, THUMB_REST = -55;  // side anchor + rest angle
const EASE = 0.22;              // per-frame lerp toward target

/* Layout: each digit gets a base point, a rest angle and a width.
   Widths come from DIGIT_TABLE as PROPORTIONS, scaled so the widest
   finger nearly fills its share of the band — so per-finger anatomy
   survives while the layout still adapts to any digit count.      */
export function layout(order){
  const fingers = order.filter(id=>DIGIT_TABLE[id].kind==='finger');
  const span = (FX1-FX0)/fingers.length;
  const widest = Math.max(...fingers.map(id=>DIGIT_TABLE[id].w));
  const scale = (span*0.92)/widest;
  const map={};
  fingers.forEach((id,i)=>{
    map[id]={ base:{x:FX0+span*(i+0.5), y:KY}, rest:0, w:Math.round(DIGIT_TABLE[id].w*scale) };
  });
  if(order.includes('T')) map['T']={ base:{...THUMB_BASE}, rest:THUMB_REST, w:DIGIT_TABLE['T'].w };
  return map;
}

/* ---------- SVG helpers ------------------------------------ */
const SVGNS='http://www.w3.org/2000/svg';
const el=(n,a={})=>{const e=document.createElementNS(SVGNS,n);for(const k in a)e.setAttribute(k,a[k]);return e;};
function rrect(x,y,w,h,rt,rb){           // vertical rounded rect (rt=top radius, rb=bottom)
  const x1=x+w;
  return `M${x} ${y+rt} Q${x} ${y} ${x+rt} ${y} L${x1-rt} ${y} Q${x1} ${y} ${x1} ${y+rt}`
       + ` L${x1} ${y+h-rb} Q${x1} ${y+h} ${x1-rb} ${y+h} L${x+rb} ${y+h} Q${x} ${y+h} ${x} ${y+h-rb} Z`;
}

/**
 * Build a programmable hand inside `svg`.
 * @param {SVGElement} svg
 * @param {{onStateChange?:Function}} opts
 */
export function createHand(svg, {onStateChange}={}){
  let DIGITS={};      // id -> {node, ext, bent, geom, anim:{theta,bend}, target:{...}}
  let GAPS={};        // slotId -> node
  let BOXES={};       // 'B1'|'B2' -> <g>   set-map boxes, rebuilt per paint (bend sets)
  let SLOTMAP={};     // slotId -> {s1, s2} set-map chevrons (split sets)
  let ENTRYLABEL=null;// <g> — the "then here" caption, rebuilt per paint
  let order=[], lay={};
  let raf=null;
  const state={ enableThumb:false, bends:new Set(), splits:new Set() };
  // set map is independent of the playback state above — it's the static
  // B1/B2/S1/S2 membership, not which sets are currently active mid-routine.
  const mapSets={ B1:new Set(), B2:new Set(), S1:new Set(), S2:new Set() };

  function build(enableThumb){
    svg.innerHTML='';
    order=digitOrder(enableThumb);
    lay=layout(order);
    DIGITS={}; GAPS={}; BOXES={}; SLOTMAP={}; ENTRYLABEL=null;

    // palm
    svg.appendChild(el('path',{class:'palm', d:
      'M126 236 Q120 224 132 222 L328 222 Q340 224 334 238 '+
      'L330 452 Q328 486 300 488 L156 488 Q130 486 128 456 Z'}));

    // gap markers — an annotation layer, appended LAST so the digits
    // can't occlude the chevrons or the slot label.
    const gapLayer=el('g',{class:'gaplayer'});
    // set map — a second, independent annotation layer: static B1/B2/S1/S2
    // MEMBERSHIP (not the live playback state). Bend sets get a box drawn
    // around their member fingers; split sets get a colored chevron at
    // their slot, well above the live one so the two never collide.
    const mapLayer=el('g',{class:'maplayer'});
    const b1box=el('g',{class:'setbox'}), b2box=el('g',{class:'setbox'});
    mapLayer.appendChild(b1box); mapLayer.appendChild(b2box);
    BOXES={B1:b1box, B2:b2box};
    const entryLabel=el('g',{class:'entrylabel'});
    mapLayer.appendChild(entryLabel);
    ENTRYLABEL=entryLabel;

    slotsOf(order).forEach(slot=>{
      const [a,b]=[slot[0], slot.slice(1)];
      const pa=lay[a].base, pb=lay[b].base;
      const mx=(pa.x+pb.x)/2, my=Math.min(pa.y,pb.y);
      const g=el('g',{class:'gapmark', 'data-slot':slot});
      g.appendChild(el('line',{x1:mx-9,y1:my-16,x2:mx-2,y2:my-3}));
      g.appendChild(el('line',{x1:mx+9,y1:my-16,x2:mx+2,y2:my-3}));
      const t=el('text',{class:'gaplabel', x:mx, y:my-22}); t.textContent=slot;
      g.appendChild(t);
      gapLayer.appendChild(g); GAPS[slot]=g;

      // set-map chevrons: a mini "V" per split set, S1 left / S2 right,
      // sitting right at the same gap the live chevron marks — same
      // footprint as the app's existing chevron, just colored per set,
      // so it reads as "here", not as a floating decoration.
      const sm=el('g',{class:'slotmapmark','data-slot':slot});
      const cx1=mx-7, cx2=mx+7, topY=my-16, botY=my-4;
      const s1=el('g',{class:'chev s1'});
      s1.appendChild(el('line',{x1:cx1-5,y1:topY,x2:cx1,y2:botY}));
      s1.appendChild(el('line',{x1:cx1+5,y1:topY,x2:cx1,y2:botY}));
      const s2=el('g',{class:'chev s2'});
      s2.appendChild(el('line',{x1:cx2-5,y1:topY,x2:cx2,y2:botY}));
      s2.appendChild(el('line',{x1:cx2+5,y1:topY,x2:cx2,y2:botY}));
      sm.appendChild(s1); sm.appendChild(s2);
      mapLayer.appendChild(sm); SLOTMAP[slot]={s1,s2};
    });

    // digits
    order.forEach(id=>{
      const cfg=DIGIT_TABLE[id], b=lay[id].base;
      const w=lay[id].w, L=cfg.len, x=b.x-w/2;
      const g=el('g',{class:'digit','data-id':id});

      /* --- EXTENDED: straight finger, three phalanges ----------------- */
      const proxLen=Math.round(L*0.42), midLen=Math.round(L*0.33), distLen=L-proxLen-midLen;
      const pip=b.y-proxLen, dip=pip-midLen, tipY=b.y-L;
      const ext=el('g',{class:'extended'});
      ext.appendChild(el('path',{class:'seg', d:rrect(x, pip, w, proxLen, 8, 4)}));      // proximal
      ext.appendChild(el('path',{class:'seg', d:rrect(x, dip, w, midLen, 6, 3)}));       // middle
      ext.appendChild(el('path',{class:'seg', d:rrect(x, tipY, w, distLen, w/2, 4)}));   // distal (tip)
      ext.appendChild(el('path',{class:'knuckle', d:`M${x+4} ${pip} h${w-8}`}));         // PIP crease
      ext.appendChild(el('path',{class:'knuckle', d:`M${x+4} ${dip} h${w-8}`}));         // DIP crease
      g.appendChild(ext);

      /* --- BENT: PIP fold. Proximal stays straight; middle + distal curl
         down over the front of it, nail at the very tip. ---------------- */
      const bent=el('g',{class:'bent', opacity:0});
      const bProx=Math.round(L*0.42), bPip=b.y-bProx;
      bent.appendChild(el('path',{class:'seg', d:rrect(x, bPip, w, bProx, 8, 4)}));
      const fW=w-4, fX=b.x-fW/2, foldLen=Math.round(bProx*0.9), fTop=bPip-4, fBot=fTop+foldLen;
      bent.appendChild(el('path',{class:'seg', d:rrect(fX, fTop, fW, foldLen, 6, Math.round(fW*0.5))}));
      bent.appendChild(el('path',{class:'knuckle', d:`M${fX+3} ${fTop+3} h${fW-6}`}));                        // PIP hinge
      bent.appendChild(el('path',{class:'knuckle', d:`M${fX+3} ${fTop+Math.round(foldLen*0.52)} h${fW-6}`})); // DIP
      const nW=Math.round(fW*0.62), nH=Math.round(foldLen*0.42), nY=fBot-nH-3;
      bent.appendChild(el('path',{class:'nail', d:rrect(b.x-nW/2, nY, nW, nH, Math.round(nW*0.28), Math.round(nW*0.5))}));
      bent.appendChild(el('path',{class:'cuticle', d:`M${b.x-nW/2+2} ${nY+4} Q${b.x} ${nY-4} ${b.x+nW/2-2} ${nY+4}`}));
      g.appendChild(bent);

      svg.appendChild(g);
      DIGITS[id]={
        node:g, ext, bent,
        geom:{base:b},
        anim:{theta:lay[id].rest, bend:0},
        target:{theta:lay[id].rest, bend:0},
      };
    });

    svg.appendChild(gapLayer);
    svg.appendChild(mapLayer);
    applySetMap();
  }

  /* Group a set's members into maximal runs of ADJACENT order-positions, so
     a non-contiguous set (e.g. {1,3} with 2 left out) draws two separate
     boxes instead of one box that wrongly swallows the finger in between. */
  function runsOf(members){
    const idxs = order.map((id,i)=>({id,i})).filter(o=>members.has(o.id));
    const runs=[];
    idxs.forEach(({id,i})=>{
      const cur=runs[runs.length-1];
      if(cur && i===cur.last+1){ cur.ids.push(id); cur.last=i; }
      else runs.push({ids:[id], last:i});
    });
    return runs.map(r=>r.ids);
  }

  /* Only the routine's entry point gets a plain-language caption: the holy
     sequence always opens by bending B1, then splitting S1 (see
     docs/sequence.md) — true regardless of what's in the sets — so those
     two alone can tell someone where to start without narrating the rest
     of the memorized 32-step routine. B2/S2 stay color-only. */
  const ENTRY_TEXT = { B1:'start here', S1:'then here' };

  /* Bend-set box: a rounded rect around one run's members, tip to knuckle
     line, sized in local (non-rotating) layout coordinates — same
     simplification the gap markers already make. B1/B2 use slightly
     different padding so two boxes sharing a finger read as two outlines,
     not one blurred edge. */
  function paintBoxes(container, key, members){
    container.innerHTML='';
    // B1 sits taller/narrower, B2 shorter/wider — a consistent nesting so
    // the two boxes (and their labels) stay visually separate even when
    // they share a finger, instead of the labels colliding into a blur.
    const padX = key==='B1' ? 9  : 18;
    const padTop = key==='B1' ? 26 : 14;
    const padBot = key==='B1' ? 10 : 26;
    const labelText = ENTRY_TEXT[key];
    runsOf(members).forEach(ids=>{
      let left=Infinity, right=-Infinity, top=Infinity;
      ids.forEach(id=>{
        const b=lay[id].base, w=lay[id].w, tip=b.y-DIGIT_TABLE[id].len;
        left=Math.min(left, b.x-w/2); right=Math.max(right, b.x+w/2);
        top=Math.min(top, tip);
      });
      const x=left-padX, y=top-padTop, w=(right-left)+padX*2, h=(KY+padBot)-y;
      container.appendChild(el('rect',{class:'setbox-rect '+key.toLowerCase(), x, y, width:w, height:h, rx:12}));
      if(labelText){
        const label=el('text',{class:'setbox-label '+key.toLowerCase(), x:x+w/2, y:y-7});
        label.textContent=labelText;
        container.appendChild(label);
      }
    });
  }

  /* The "then here" caption attaches to whichever S1 slot is leftmost right
     now — S1 membership can change under the app's feet, so this is
     rebuilt fresh each paint rather than fixed at build time. */
  function paintEntryLabel(){
    ENTRYLABEL.innerHTML='';
    const slot = slotsOf(order).find(s=>mapSets.S1.has(s));
    if(!slot) return;
    const [a,b]=[slot[0], slot.slice(1)];
    const pa=lay[a].base, pb=lay[b].base;
    const mx=(pa.x+pb.x)/2, my=Math.min(pa.y,pb.y);
    const t=el('text',{class:'entry-label s1', x:mx, y:my-42});
    t.textContent=ENTRY_TEXT.S1;
    ENTRYLABEL.appendChild(t);
  }

  /* Paint the static set-map overlay from the last sets given to setMap().
     Re-run at the end of every build() so a thumb-triggered rebuild (which
     tears down and recreates every mark) doesn't silently blank the map. */
  function applySetMap(){
    paintBoxes(BOXES.B1, 'B1', mapSets.B1);
    paintBoxes(BOXES.B2, 'B2', mapSets.B2);
    paintEntryLabel();
    slotsOf(order).forEach(slot=>{
      const m=SLOTMAP[slot]; if(!m) return;
      m.s1.classList.toggle('on', mapSets.S1.has(slot));
      m.s2.classList.toggle('on', mapSets.S2.has(slot));
    });
  }

  function apply(){
    // clamp state to digits/slots that actually exist
    order = digitOrder(state.enableThumb);
    const validDigits=new Set(order), validSlots=new Set(slotsOf(order));
    [...state.bends].forEach(b=>{ if(!validDigits.has(b)) state.bends.delete(b); });
    [...state.splits].forEach(s=>{ if(!validSlots.has(s)) state.splits.delete(s); });

    const splay=splayAngles(order, state.splits);
    order.forEach(id=>{
      const d=DIGITS[id];
      d.target.theta = lay[id].rest + splay[id];
      d.target.bend  = state.bends.has(id) ? 1 : 0;
    });
    Object.entries(GAPS).forEach(([slot,g])=> g.classList.toggle('on', state.splits.has(slot)));
    animate();
    onStateChange?.(api.state);
  }

  /* ---------- puppet animation loop --------------------------
     theta (rotation, from splits) is the real puppet motion;
     bend is a crossfade between the two drawings.             */
  function animate(){
    if(raf) return;
    const step=()=>{
      let moving=false;
      order.forEach(id=>{
        const d=DIGITS[id]; if(!d) return;
        d.anim.theta += (d.target.theta - d.anim.theta)*EASE;
        d.anim.bend  += (d.target.bend  - d.anim.bend )*EASE;
        if(Math.abs(d.target.theta-d.anim.theta)>0.05 || Math.abs(d.target.bend-d.anim.bend)>0.003) moving=true;
        const b=d.geom.base;
        d.node.setAttribute('transform',`rotate(${d.anim.theta.toFixed(3)} ${b.x} ${b.y})`);
        d.ext.setAttribute('opacity',(1-d.anim.bend).toFixed(3));
        d.bent.setAttribute('opacity',(d.anim.bend).toFixed(3));
      });
      raf = moving ? requestAnimationFrame(step) : null;
    };
    raf=requestAnimationFrame(step);
  }

  /* ---------- public API — drive the hand purely from code ----
     hand.setState({bends:['1','2'], splits:['34'], thumb:false})
     hand.bend('2'); hand.split('12'); hand.reset();            */
  const api={
    setState({bends=[], splits=[], thumb}={}){
      if(thumb!==undefined && thumb!==state.enableThumb){ state.enableThumb=thumb; build(thumb); }
      state.bends=new Set(bends.map(String));
      state.splits=new Set(splits.map(String));
      apply();
    },
    bend(id,on=true){ on?state.bends.add(String(id)):state.bends.delete(String(id)); apply(); },
    split(id,on=true){ on?state.splits.add(String(id)):state.splits.delete(String(id)); apply(); },
    enableThumb(on){ state.enableThumb=on; build(on); apply(); },
    reset(){ state.bends.clear(); state.splits.clear(); apply(); },
    /* setMap({B1,B2,S1,S2}) — repaint the static set-map overlay. Call
       whenever the sets change; membership may span digits/slots that
       don't exist for the current order, so filter through sanitizeSets
       upstream the same way setState's sources already do. */
    setMap(sets={}){
      for(const k of ['B1','B2','S1','S2']){
        mapSets[k] = new Set([...(sets[k]||[])].map(String));
      }
      applySetMap();
    },
    showMap(on){ svg.classList.toggle('showmap', !!on); },
    get state(){ return {thumb:state.enableThumb, bends:[...state.bends], splits:[...state.splits]}; },
    get order(){ return [...order]; },
    get slots(){ return slotsOf(order); },
  };

  build(state.enableThumb);
  return api;
}
