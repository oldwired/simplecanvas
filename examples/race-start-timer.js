// Smart-shape script for SimpleCanvas — a second Timer variant ("Timer v2") for sailing race starts:
// the existing Timer's own countdown dial (reused almost as-is, just shifted into the right part of
// the box) plus a signal mast to its left showing the WR 26 (World Sailing Racing Rules, 5-Minute-
// Start) flag sequence as a state machine.
//
// To use: SimpleCanvas → Shape Library → Manage → "Add smart shape…" → pick "Blank" → paste this
// whole file's content into the Script field (this header comment included — it's harmless there).
//
// - Drag the clock hand (right side) to set the time, before OR after the start: unlike the original
//   Timer (which only ever counts down to a single T0), this dial is split into two 30-minute halves
//   centered on the start instant -- the LEFT half (hand swept counterclockwise from the top) is
//   BEFORE the start, reading like the original countdown; the RIGHT half (hand swept clockwise from
//   the top) is AFTER it. The filled wedge always pivots on the top (the start instant): before the
//   start it reaches FROM the hand TO the top (shrinking as the countdown runs out, same as before);
//   after the start it reaches FROM the top TO the hand instead (growing as time elapses) -- the wedge
//   opens the other way, per explicit request. See _dialAngle for the actual angle math.
// - Double-click the placed shape to enter edit mode (same gesture as every other smart shape) —
//   this is what makes the three click-icons below actually show up; they're deliberately invisible
//   otherwise, same as the Chart template's own "-"/"+" buttons.
// - Click the blue icon (top, next to the main signal) to cycle the main/override signal: normal
//   time-based sequence → Individual recall (X) → General recall (First Substitute) → Postponement
//   (AP) → Abandonment (N) → back to normal.
// - Click the purple icon (middle, next to the secondary signal) to cycle the secondary flag: while
//   the main signal is the normal time-based sequence, this cycles which PREPARATORY flag flies at
//   T-4..T-1 (P/I/Z/U/Black — Z+I is deliberately not offered, see below); while the main signal is
//   AP or N, it instead cycles that override's own "over H" / "over A" modifier (none/H/A). Absent
//   entirely whenever there's nothing to meaningfully cycle at that moment: no flag flying at the TOP
//   mast position at all (before the sequence starts, or exactly at T0), OR the automatic class flag
//   flying ALONE with the preparatory flag not yet (or no longer) shown — exactly at T-5 and exactly
//   at T-1.
// - Click the orange icon (bottom) to toggle the Orange line-marking flag on/off — independent of
//   everything else, since it only ever marks the committee-boat end of the line, not the sequence.
//   The icon itself shows the current on/off state (filled vs. hollow).
//
// Every mast flag is a plain, identically-sized rectangle EXCEPT two genuinely triangular pennants,
// both per explicit request with a reference image: the Answering Pennant (AP) — 5 vertical red/white
// stripes, hoist to fly — and the General Recall / First Substitute flag — a blue triangle with a
// smaller yellow triangle inset inside it. Every other flag stays a plain rect, a deliberate
// simplification over the real International Code flag shapes to keep the rest of the mast visually
// uniform. Flag renderings are
// simplified pictograms (solid/split/quartered/cross patterns built from plain rects), not
// pixel-accurate reproductions of the official flags — the point is to make each one visually
// distinct and quickly recognizable at UI scale, not to replace an official flag chart. The class
// flag is plain white with "Class" centered inside it (per explicit request) rather than following
// the toolbar's own fill color, since a real class flag has no fixed design to begin with.
//
// Z+I (WR 30.2 + 30.1 together) is deliberately NOT offered in the preparatory-flag cycle, per
// explicit request ("gibt es für uns hier nicht") — it isn't a flag of its own anyway (the real rule
// flies Z and I as two separate flags together), and the earlier version's "Z+I" entry only ever
// reused Z's own pattern with a relabeled caption, which was misleading rather than useful.
//
// Automatic vs. manual ("Kombination", per explicit design decision): the main/sub flags are fully
// time-driven (state.value) whenever state.event is null — exactly reproducing the WR 26 T-5/T-4/
// T-1/T0 table below. The moment state.event is set to anything else (via the 'event' click-handle),
// that override completely replaces the time-based display, independent of state.value from then on
// — matching how Individual/General recall, postponement and abandonment are real, situational events
// a race committee decides, not something a clock alone can predict.
//
// Individual recall (X), general recall, and abandonment (N) are only reachable AFTER the start
// (value > 0) or exactly at it (value:0) — never anywhere BEFORE it (value < 0, the dial's entire
// left half). Dragging the hand to anywhere before the start cancels any of those three back to the
// automatic class-flag display, and the 'event' cycle button only offers null/AP there — "nur
// zwischen AP und ggfs. Klassenflagge hin- und herschaltbar" (explicit request; originally this was
// only the narrower T-5..T-1 window, broadened to the whole left half per an immediate follow-up).
// AP (postponement) is the exact mirror: reachable everywhere BEFORE the start and exactly at it, but
// never once the hand sits in the dial's RIGHT half (value > 0, after the start) — dragging the hand
// past the start cancels a stale AP the same way, and the 'event' cycle button leaves AP out of its
// own cycle there. See _beforeStart()/_afterStart().
({
  initState(){
    return {
      value: -5,          // minutes relative to the start: negative = before (counts UP toward 0,
                           // same convention as the original Timer), positive = after. The dial itself
                           // only spans -30..+30 (see _dialAngle) -- -5 is a fresh 5-minute sequence
                           // about to start.
      event: null,        // null (normal time-based sequence) | 'X' (individual recall) |
                           // 'recall' (general recall / First Substitute) | 'AP' (postponement) |
                           // 'N' (abandonment) -- a manual override, independent of `value` once set.
      sub: null,           // null | 'H' | 'A' -- the flag flown "over" AP or N (WR 26: AP-over-H /
                           // AP-over-A / N-over-H / N-over-A). Ignored unless event is 'AP' or 'N'.
      prep: 'P',           // 'P' | 'I' | 'Z' | 'U' | 'black' -- which preparatory flag flies at
                           // T-4..T-1 when event is null (WR 30.1/30.2/30.3/30.4). No 'Z+I' option --
                           // deliberately not offered, see the header comment.
      orangeShown: true,   // the line-marking Orange flag, always independent of the sequence itself.
    };
  },
  // w shrunk from 420 to 330 to match the narrower mast (see _layout's own comment) -- the clock's
  // own position is now derived FROM the mast's width, so this is the actual natural total width at
  // h:200, not a guess; a smaller w here would start clipping the clock's own right edge.
  initStyle(){ return { w: 330, h: 200, fontSize: 12, strokeOn: false }; },

  // ---- flag pictogram catalogue -----------------------------------------------------------------
  // Every entry is a plain rectangle EXCEPT AP and firstSub, both handled as their own special cases
  // in _drawFlag (same as 'class') since they're genuinely triangular, not rects with a pattern. All
  // three mast positions render at the SAME w/h (see _mastLayout), so every flag here is drawn at an
  // identical bounding box regardless of which position it ends up in -- a triangular flag's own
  // silhouette just doesn't fill that whole box the way a rect does.
  _FLAGS: {
    P:        { pattern:'centerbox', colors:['#1d4ed8','#ffffff'] },
    I:        { pattern:'centerdot', colors:['#facc15','#000000'] },
    Z:        { pattern:'quad',      colors:['#facc15','#000000','#dc2626','#1d4ed8'] },
    U:        { pattern:'diagonal2', colors:['#dc2626','#ffffff'] },
    black:    { pattern:'solid',     colors:['#000000'] },
    X:        { pattern:'cross',     colors:['#ffffff','#1d4ed8'] },
    N:        { pattern:'quad',      colors:['#1d4ed8','#ffffff','#ffffff','#1d4ed8'] },
    H:        { pattern:'vsplit2',   colors:['#ffffff','#dc2626'] },
    A:        { pattern:'vsplit2',   colors:['#ffffff','#1d4ed8'] },
    orange:   { pattern:'solid',     colors:['#f97316'], label:'Orange' },
  },

  // The 5 cyclable preparatory-flag keys, in cycle order (P -> I -> Z -> U -> Black -> P...). No
  // 'Z+I' -- deliberately not offered, see the header comment.
  _PREP_CYCLE: ['P','I','Z','U','black'],
  _EVENT_CYCLE: [null,'X','recall','AP','N'],
  _SUB_CYCLE: [null,'H','A'],

  // AP's own triangular silhouette (tapering from full height at x to a point at x+fw), divided into
  // N equal VERTICAL stripes -- each stripe is a trapezoid clipped to the pennant's own top/bottom
  // taper (the last stripe degenerates to a triangle, since the taper closes to a point exactly at
  // x+fw). Generic over colors.length, so re-coloring or re-striping AP later needs no new geometry.
  _pennantStripes(x, y, fw, fh, colors, style){
    const n = colors.length, stripeW = fw/n;
    const topAt = X => y + (fh/2) * ((X-x)/fw);
    const botAt = X => y+fh - (fh/2) * ((X-x)/fw);
    const items = [];
    for(let i=0;i<n;i++){
      const X0 = x+i*stripeW, X1 = x+(i+1)*stripeW;
      const pts = [{x:X0,y:topAt(X0)}, {x:X1,y:topAt(X1)}, {x:X1,y:botAt(X1)}, {x:X0,y:botAt(X0)}];
      items.push({ type:'polygon', points:pts, closed:true, color:style.color, size:0, strokeOn:false, fill:true, fillColor:colors[i] });
    }
    // overall silhouette outline, drawn on top, so the stripe seams don't each look individually bordered
    items.push({ type:'polygon', points:[{x,y},{x,y:y+fh},{x:x+fw,y:y+fh/2}], closed:true, color:style.color, size:Math.max(1,(style.size||2)*0.5), strokeOn:true, fill:false });
    return items;
  },

  // A solid triangular pennant with a smaller, same-orientation inner triangle inset from its own
  // edges (the "border band" look of firstSub's reference image: a blue triangle with a yellow
  // triangle inside it). The inner triangle is the OUTER one scaled toward the shared centroid --
  // not a true constant-width inset (that would need per-edge offset math for little visible gain
  // here), but visually matches the reference closely enough for a simplified pictogram.
  _pennantInset(x, y, fw, fh, outerColor, innerColor, style){
    const pts = [{x,y}, {x,y:y+fh}, {x:x+fw,y:y+fh/2}];
    const gx = (pts[0].x+pts[1].x+pts[2].x)/3, gy = (pts[0].y+pts[1].y+pts[2].y)/3;
    const scale = 0.6;
    const inner = pts.map(p => ({x:gx+(p.x-gx)*scale, y:gy+(p.y-gy)*scale}));
    return [
      { type:'polygon', points:pts, closed:true, color:style.color, size:Math.max(1,(style.size||2)*0.5), strokeOn:true, fill:true, fillColor:outerColor },
      { type:'polygon', points:inner, closed:true, color:style.color, size:0, strokeOn:false, fill:true, fillColor:innerColor },
    ];
  },

  // Renders one flag ('kind', a key into _FLAGS, or 'class') into the box (x,y,fw,fh). Returns a
  // flat array of child item descriptors (rects/ellipses/lines/text), always including a thin
  // outline and a small code-letter label below it so the pattern alone never has to carry all the
  // meaning -- except 'class', whose label sits centered INSIDE the flag instead (see below).
  _drawFlag(kind, x, y, fw, fh, style){
    if(!kind) return [];
    const outlineSize = Math.max(1, (style.size||2)*0.5);
    const labelH = Math.max(10, fh*0.3);
    if(kind === 'class'){
      // Plain white, "Class" centered inside -- a real class flag has no fixed design, so this is
      // deliberately NOT toolbar-fill-driven like the rest of this app's styleable items; the outline
      // still follows the toolbar's own stroke color, same as every other flag here.
      return [
        { type:'rect', x, y, w:fw, h:fh, color:style.color, size:outlineSize, strokeOn:true, fill:true, fillColor:'#ffffff' },
        { type:'text', text:'Class', x, y, w:fw, h:fh, align:'center', font:style.font, color:style.textColor, strokeOn:false, fill:false },
      ];
    }
    if(kind === 'AP'){
      // Genuinely triangular (reference image: red-white-red-white-red vertical stripes, hoist to
      // fly) -- most other flags here stay a plain rect, per explicit request.
      const items = this._pennantStripes(x, y, fw, fh, ['#dc2626','#ffffff','#dc2626','#ffffff','#dc2626'], style);
      items.push({ type:'text', text:'AP', x, y:y+fh+4, w:fw, h:labelH, align:'center', font:style.font, color:style.textColor, strokeOn:false, fill:false });
      return items;
    }
    if(kind === 'firstSub'){
      // Also genuinely triangular (reference image: blue triangle, yellow triangle inset inside it).
      const items = this._pennantInset(x, y, fw, fh, '#1d4ed8', '#facc15', style);
      items.push({ type:'text', text:'1st Sub', x, y:y+fh+4, w:fw, h:labelH, align:'center', font:style.font, color:style.textColor, strokeOn:false, fill:false });
      return items;
    }
    const def = this._FLAGS[kind];
    if(!def) return [];
    const c = def.colors;
    const items = [];
    if(def.pattern === 'solid'){
      items.push({ type:'rect', x, y, w:fw, h:fh, color:style.color, size:outlineSize, strokeOn:true, fill:true, fillColor:c[0] });
    } else if(def.pattern === 'vsplit2'){
      items.push({ type:'rect', x, y, w:fw/2, h:fh, color:style.color, size:outlineSize, strokeOn:true, fill:true, fillColor:c[0] });
      items.push({ type:'rect', x:x+fw/2, y, w:fw/2, h:fh, color:style.color, size:outlineSize, strokeOn:true, fill:true, fillColor:c[1] });
    } else if(def.pattern === 'quad'){
      items.push({ type:'rect', x, y, w:fw/2, h:fh/2, color:style.color, size:outlineSize, strokeOn:false, fill:true, fillColor:c[0] });
      items.push({ type:'rect', x:x+fw/2, y, w:fw/2, h:fh/2, color:style.color, size:outlineSize, strokeOn:false, fill:true, fillColor:c[1] });
      items.push({ type:'rect', x, y:y+fh/2, w:fw/2, h:fh/2, color:style.color, size:outlineSize, strokeOn:false, fill:true, fillColor:c[2] });
      items.push({ type:'rect', x:x+fw/2, y:y+fh/2, w:fw/2, h:fh/2, color:style.color, size:outlineSize, strokeOn:false, fill:true, fillColor:c[3] });
      items.push({ type:'rect', x, y, w:fw, h:fh, color:style.color, size:outlineSize, strokeOn:true, fill:false });
    } else if(def.pattern === 'diagonal2'){
      items.push({ type:'rect', x, y, w:fw, h:fh, color:style.color, size:outlineSize, strokeOn:true, fill:true, fillColor:c[0] });
      items.push({ type:'polygon', points:[{x,y:y+fh},{x:x+fw,y:y+fh},{x:x+fw,y}], closed:true, color:style.color, size:0, strokeOn:false, fill:true, fillColor:c[1] });
    } else if(def.pattern === 'centerbox'){
      items.push({ type:'rect', x, y, w:fw, h:fh, color:style.color, size:outlineSize, strokeOn:true, fill:true, fillColor:c[0] });
      const bw=fw*0.4, bh=fh*0.4;
      items.push({ type:'rect', x:x+fw/2-bw/2, y:y+fh/2-bh/2, w:bw, h:bh, color:style.color, size:0, strokeOn:false, fill:true, fillColor:c[1] });
    } else if(def.pattern === 'centerdot'){
      items.push({ type:'rect', x, y, w:fw, h:fh, color:style.color, size:outlineSize, strokeOn:true, fill:true, fillColor:c[0] });
      const dr=fh*0.3;
      items.push({ type:'ellipse', x:x+fw/2-dr, y:y+fh/2-dr, w:dr*2, h:dr*2, color:style.color, size:0, strokeOn:false, fill:true, fillColor:c[1] });
    } else if(def.pattern === 'cross'){
      // A plus-shaped cross reaching all four edges (reference image: Flag X, a white flag with a
      // blue "+" cross) -- NOT a diagonal X, which an earlier version drew here before a reference
      // image corrected it. Both arms share ONE thickness (`armT`, tied to fh so it doesn't thin out
      // now that flags are narrower) -- an explicit follow-up request, since the vertical arm's width
      // and the horizontal arm's height used to be two unrelated fractions (of fw and fh respectively),
      // which stopped looking like an even "+" once fw shrank independently of fh.
      items.push({ type:'rect', x, y, w:fw, h:fh, color:style.color, size:outlineSize, strokeOn:true, fill:true, fillColor:c[0] });
      const armT = fh*0.26;
      items.push({ type:'rect', x:x+fw/2-armT/2, y, w:armT, h:fh, color:style.color, size:0, strokeOn:false, fill:true, fillColor:c[1] });
      items.push({ type:'rect', x, y:y+fh/2-armT/2, w:fw, h:armT, color:style.color, size:0, strokeOn:false, fill:true, fillColor:c[1] });
    }
    const label = def.label || kind;
    items.push({ type:'text', text:label, x, y:y+fh+4, w:fw, h:labelH, align:'center', font:style.font, color:style.textColor, strokeOn:false, fill:false });
    return items;
  },

  // X (individual recall) and general recall don't make sense anywhere BEFORE the start -- neither
  // does N (abandonment), for this tool's own purposes (explicit simplification, same spirit as
  // dropping Z+I: "nur zwischen AP und ggfs. Klassenflagge hin- und herschaltbar" -- only AP and the
  // automatic class flag are real options on the whole left half of the dial). Originally this only
  // covered the narrower T-5..T-1 window; broadened per explicit follow-up request to the ENTIRE
  // before-start region (`value < 0`), since e.g. value:-10 ("before sequence") let the full cycle
  // through just as much as T-5..T-1 did, which made no more sense there than in the window itself.
  // Used by both _flags()/_statusLabel() (so the flag shown and the text readout can never disagree)
  // and the 'event' cycle handle (so the cycle itself only ever offers null/AP before the start) -- a
  // single shared definition of "is this override even valid right now," rather than ad hoc checks
  // that could drift. Deliberately a strict `<0` (not `<=0`) -- exactly at the start instant (value:0)
  // sits in neither half, so EVERY override (X/recall/AP/N) is reachable there, matching how AP's own
  // mirror restriction below also treats 0 as unrestricted.
  _beforeStart(state){ return state.value < 0; },
  // AP is the mirror case: never valid once the hand sits in the RIGHT half of the dial (value > 0,
  // after the start) -- it's specifically a before-the-start signal. Deliberately a plain `>0` check,
  // not tied to _beforeStart's own range -- AP is still perfectly valid everywhere _beforeStart covers
  // (that's the whole point of the restriction above) and exactly at value:0, just never after it.
  _afterStart(state){ return state.value > 0; },
  _effectiveEvent(state){
    if(this._beforeStart(state) && (state.event==='X' || state.event==='recall' || state.event==='N')) return null;
    if(this._afterStart(state) && state.event==='AP') return null;
    return state.event;
  },

  // Derives which flag flies at the mast's two main positions (p1 = top/main signal, p2 = middle/
  // secondary signal) from the current state -- the actual WR 26 state machine. Automatic (from
  // `value`) whenever `event` is null (or forced null by _effectiveEvent); a manual override entirely
  // replaces it otherwise.
  _flags(state){
    const minutesRemaining = Math.max(0, -state.value);
    const event = this._effectiveEvent(state);
    if(event === 'AP')     return { p1:'AP', p2: state.sub };
    if(event === 'N')      return { p1:'N',  p2: state.sub };
    if(event === 'recall') return { p1:'firstSub', p2:null };
    if(event === 'X')      return { p1:'X', p2:null };
    const classUp = minutesRemaining <= 5 && minutesRemaining > 0;  // T-5 up to (not incl.) T0
    const prepUp  = minutesRemaining <= 4 && minutesRemaining > 1;  // T-4 up to (not incl.) T-1
    return { p1: classUp ? 'class' : null, p2: prepUp ? state.prep : null };
  },

  // A short textual readout of the current state, next to the mast -- lets someone confirm what's
  // flying without having to read the pictograms, and doubles as the thing tests assert against.
  _statusLabel(state){
    const minutesRemaining = Math.max(0, -state.value);
    const event = this._effectiveEvent(state);
    if(event === 'AP')     return 'Postponed (AP)' + (state.sub ? ' over '+state.sub : '');
    if(event === 'N')      return 'Abandoned (N)' + (state.sub ? ' over '+state.sub : '');
    if(event === 'recall') return 'General recall';
    if(event === 'X')      return 'Individual recall (X)';
    if(state.value > 0)         return 'T+'+state.value+' after start';
    if(minutesRemaining > 5)     return 'Before sequence';
    if(minutesRemaining > 4)     return 'T-5 Warning';
    if(minutesRemaining > 1)     return 'T-4 Preparatory ('+state.prep+')';
    if(minutesRemaining > 0)     return 'T-1 One minute';
    return 'T-0 Start';
  },

  // Shared layout -- mast on the left, clock dial on the right, reused by children()/handles()/
  // hitEdit()/dragEdit() so all four can never drift apart. The clock portion mirrors the original
  // Timer template's own _layout(), just computed around a sub-box instead of the whole container.
  //
  // flagW/flagH are derived purely from `h` (NOT from available leftover space before the clock, as
  // an earlier version had it) -- explicit follow-up request: keep flag HEIGHT the same, halve the
  // WIDTH. `flagW = flagH*1.97` reproduces that exact halved width at the default 200px container
  // height (the earlier w-dependent formula worked out to flagW=126 at flagH=32 there; half of 126 is
  // 63, and 32*1.97≈63). Decoupling flagW from the clock's own position is also what makes the clock
  // (and the overall natural width, see initStyle below) genuinely follow the narrower mast instead of
  // leaving a dead gap where the old, wider flag column used to reach -- `clockCx` is now computed
  // FROM the mast's own right edge (mastX+flagW+icon column+gap), not from `w` at all.
  _layout(style, w, h){
    const fontSize = (style && style.fontSize) || 16;
    const mastX = 10;
    const mastTop = h*0.1, mastBottom = h*0.9;
    const flagH = (mastBottom-mastTop)*0.2;
    const flagW = flagH*1.97;
    const clockR = Math.max(10, h/2 - 4);
    const clockCx = mastX + flagW + 16 + 16 + clockR + 14;
    const clockCy = h/2;
    // Wider than the original Timer's own labelW -- this dial's labels now include 3-character
    // negative numbers ("-25"/"-20"/"-15"/"-10"), not just 2-digit positives up to "55", so the old
    // formula (sized for 2 characters) wrapped them onto two lines.
    const labelW = Math.min(w-4, Math.max(34, fontSize*2.2 + 10));
    const labelH = Math.min(h-4, Math.max(16, fontSize*1.2));
    const numR = Math.max(0, Math.min(clockR*0.94, clockR - labelW/2 - 2, clockR - labelH/2 - 2));
    const tickOuter = numR - labelH/2 - 4;
    const tickInnerMajor = tickOuter - Math.max(6, clockR*0.12);
    const tickInnerMinor = tickOuter - Math.max(3, clockR*0.06);
    const wedgeR = tickInnerMajor - 5;
    return { clockR, clockCx, clockCy, mastX, mastTop, mastBottom, flagW, flagH,
      labelW, labelH, numR, tickOuter, tickInnerMajor, tickInnerMinor, wedgeR };
  },

  // The three mast flag SLOTS -- all the SAME w/h (flagW x flagH), per explicit request, positioned
  // at three evenly-spaced heights down the mast with room left for each one's own label underneath.
  _mastLayout(L){
    const range = L.mastBottom - L.mastTop;
    return {
      flagW: L.flagW, flagH: L.flagH,
      p1Y: L.mastTop + range*0.04,
      p2Y: L.mastTop + range*0.38,
      orangeY: L.mastTop + range*0.72,
    };
  },

  // The clock-hand drag point plus the one-shot 'click'-kind handles, all in one place so
  // children()'s own edit-mode icons and handles()/hitEdit() can never drift apart.
  _handleList(state, L, M){
    const angle = this._dialAngle(state.value);
    const iconX = L.mastX + M.flagW + 16;
    const hs = [
      { id:'hand', x:L.clockCx+Math.sin(angle)*L.wedgeR, y:L.clockCy-Math.cos(angle)*L.wedgeR },
      { id:'event', x:iconX, y:M.p1Y+M.flagH/2, kind:'click' },
    ];
    // 'p2cycle' is hidden in two distinct situations, both meaning "nothing to cycle at position 2
    // right now": (1) no flag at all flies at the top (p1 null) -- before the sequence starts, or
    // exactly at T0; (2) the automatic class flag flies ALONE, with the preparatory flag not yet (or
    // no longer) shown -- exactly at T-5 and exactly at T-1, the two instants where classUp is true
    // but prepUp is false (see _flags). X/recall/AP/N are all exempt from case (2) even though X/
    // recall always have p2 null too: AP/N's own p2cycle is always meaningful regardless of the
    // CURRENT sub value (clicking null->H is an immediate, visible change), and X/recall are a
    // separate, already-accepted case (a documented no-op, not something actually hidden). Checking
    // `p1==='class'` specifically (rather than "p2 is null") is what naturally excludes all four
    // overrides -- none of them ever sets p1 to 'class'.
    const f = this._flags(state);
    const hideP2Cycle = !f.p1 || (f.p1==='class' && !f.p2);
    if(!hideP2Cycle) hs.push({ id:'p2cycle', x:iconX, y:M.p2Y+M.flagH/2, kind:'click' });
    hs.push({ id:'orange', x:iconX, y:M.orangeY+M.flagH/2, kind:'click' });
    return hs;
  },

  // Maps `value` (minutes relative to the start -- negative before, positive after) to the hand's
  // angle in this app's own convention (0 = top/12-o'clock, positive = clockwise). One unified formula
  // covers both halves of the dial: before the start (value -30..0) sweeps through the LEFT side
  // (angle 2π..0, i.e. counterclockwise from top down to the bottom at -30); after the start (value
  // 0..30) sweeps through the RIGHT side (angle 0..π, clockwise from top down to the bottom at +30).
  // -30 and +30 are the SAME bottom point, approached from opposite sides -- a real 60-minute clock
  // face, split into two 30-minute halves centered on the start instant, per explicit request ("es
  // gibt also eine Unterscheidung zwischen vor dem Start... und nach dem Start"). Clamped to ±30 --
  // the dial itself only has room for that much on each side; `_flags`'s own `minutesRemaining` is
  // UNCLAMPED and unaffected (a `value` far below -30 still correctly reads as "before sequence").
  _dialAngle(value){
    const v = Math.max(-30, Math.min(30, value));
    return ((v/30)*Math.PI + 2*Math.PI) % (2*Math.PI);
  },

  children(state, style, w, h, editing){
    const L = this._layout(style, w, h);
    const M = this._mastLayout(L);
    const items = [];

    // ---- mast ----
    items.push({ type:'line', x1:L.mastX, y1:L.mastTop, x2:L.mastX, y2:L.mastBottom, color:style.color, size:Math.max(1,style.size||2) });
    const { p1, p2 } = this._flags(state);
    items.push(...this._drawFlag(p1, L.mastX, M.p1Y, M.flagW, M.flagH, style));
    items.push(...this._drawFlag(p2, L.mastX, M.p2Y, M.flagW, M.flagH, style));
    if(state.orangeShown) items.push(...this._drawFlag('orange', L.mastX, M.orangeY, M.flagW, M.flagH, style));

    // above the container, never inside it -- so it can never collide with any flag's own label.
    items.push({ type:'text', text:this._statusLabel(state), x:0, y:-20, w, h:18, align:'left', font:style.font, color:style.textColor, strokeOn:false, fill:false });

    // Edit-mode-only click icons -- invisible otherwise, same convention as the Chart template's own
    // "-"/"+" buttons: without these, there's nothing on screen marking where a click-kind handle
    // actually is (the generic blue-dot marker is deliberately skipped for kind:'click' handles).
    if(editing){
      const hs = this._handleList(state, L, M);
      const cycleIcon = (x,y,fillColor) => {
        items.push({ type:'ellipse', x:x-8, y:y-8, w:16, h:16, color:'#1f2937', size:1.5, strokeOn:true, fill:true, fillColor });
        items.push({ type:'polygon', points:[{x:x-3,y:y-5},{x:x-3,y:y+5},{x:x+5,y}], closed:true, color:'#ffffff', size:0, strokeOn:false, fill:true, fillColor:'#ffffff' });
      };
      const h1 = hs.find(hh=>hh.id==='event'), h2 = hs.find(hh=>hh.id==='p2cycle'), h3 = hs.find(hh=>hh.id==='orange');
      cycleIcon(h1.x, h1.y, '#2563eb');   // blue: cycles the main/override signal
      if(h2) cycleIcon(h2.x, h2.y, '#7c3aed');   // purple: cycles prep (or AP/N's H/A modifier) -- absent when there's no top flag to go with it
      // orange toggle: always orange-filled, regardless of on/off state (explicit follow-up request,
      // reversing the earlier filled-vs-hollow on/off indicator) -- no inner triangle, since this is
      // a toggle, not a cycle.
      items.push({ type:'ellipse', x:h3.x-8, y:h3.y-8, w:16, h:16, color:'#1f2937', size:1.5, strokeOn:true, fill:true, fillColor:'#f97316' });
    }

    // ---- clock dial (adapted from the original Timer template, split into a before/after-start
    // pair of 30-minute halves -- see _dialAngle) ----
    const cx = L.clockCx, cy = L.clockCy, r = L.clockR;
    const valueForDial = Math.max(-30, Math.min(30, state.value));
    const angle = this._dialAngle(state.value);
    items.push({ type:'ellipse', x:cx-r, y:cy-r, w:r*2, h:r*2, color:style.color, strokeOn:true, size:Math.max(1,(style.size||4)/2), fill:false });
    if(valueForDial !== 0){
      // Before the start, the wedge represents time REMAINING -- it always reaches the TOP (the
      // start instant), growing from the hand backward toward it as time passes. After the start, it
      // represents time ELAPSED -- it always STARTS at the top, growing forward toward the hand. Same
      // shape, opposite sweep direction, both pivoting on the one instant (the top) that matters to
      // either reading -- exactly the "Arc öffnet andersrum" the user asked for.
      const a1 = valueForDial < 0 ? angle : 0;
      const a2 = valueForDial < 0 ? 2*Math.PI : angle;
      const arcStart = { x:cx+L.wedgeR*Math.sin(a1), y:cy-L.wedgeR*Math.cos(a1), arcTo:{cx,cy,r:L.wedgeR,a1,a2} };
      const arcEnd = { x:cx+L.wedgeR*Math.sin(a2), y:cy-L.wedgeR*Math.cos(a2) };
      items.push({ type:'polygon', points:[{x:cx,y:cy}, arcStart, arcEnd], closed:true, color:style.fillColor, fill:true, fillColor:style.fillColor, strokeOn:false });
    }
    const thin = Math.max(1,(style.size||4)/2);
    for(let i=0;i<60;i++){
      const a = i/60 * 2*Math.PI;
      const major = (i%5===0);
      items.push({ type:'line', color:style.color, size: major?thin:Math.max(0.5,thin*0.5),
        x1:cx+Math.sin(a)*(major?L.tickInnerMajor:L.tickInnerMinor), y1:cy-Math.cos(a)*(major?L.tickInnerMajor:L.tickInnerMinor),
        x2:cx+Math.sin(a)*L.tickOuter, y2:cy-Math.cos(a)*L.tickOuter });
    }
    // 12 labels, clockwise from the top: 0, 5, 10, ..., 30 (bottom, the right/after-start half), then
    // -25, -20, ..., -5 (continuing clockwise back up to the top -- the left/before-start half, read
    // in the direction the hand actually sweeps as the countdown runs down toward 0).
    for(let i=0;i<12;i++){
      const a = i/12 * 2*Math.PI;
      const value = i<=6 ? i*5 : i*5-60;
      const lx = cx+Math.sin(a)*L.numR, ly = cy-Math.cos(a)*L.numR;
      items.push({ type:'text', text:String(value), x:lx-L.labelW/2, y:ly-L.labelH/2, w:L.labelW, h:L.labelH, align:'center', font:style.font, color:style.textColor, strokeOn:false, fill:false });
    }
    items.push({ type:'line', x1:cx, y1:cy, x2:cx+Math.sin(angle)*L.wedgeR, y2:cy-Math.cos(angle)*L.wedgeR, color:style.color, size:style.size||4 });

    return items;
  },

  // 'hand' (continuous drag, the clock) plus the three one-shot 'click'-kind handles on the mast --
  // see _handleList above for what each one does.
  handles(state, w, h, style){
    const L = this._layout(style||{}, w, h);
    const M = this._mastLayout(L);
    return this._handleList(state, L, M);
  },

  hitEdit(state, lx, ly, w, h, style){
    const hs = this.handles(state, w, h, style||{});
    for(const hdl of hs){ if(Math.hypot(lx-hdl.x, ly-hdl.y) < 14) return hdl.id; }
    return null;
  },

  // Debounce window for the three click-kind handles below -- explicit follow-up request: a real
  // person clicking through a cycle repeatedly sometimes lands two genuine, separate press/release
  // gestures close enough together to read as an accidental double-click, advancing the cycle twice
  // for what felt like one click. This can't be caught at the browser's own dblclick event (the app
  // doesn't special-case double-clicks on an individual smart-shape handle, only on the shape's own
  // body), so it's handled entirely in-script instead: each handle stores its OWN last-resolved
  // timestamp in `state` (`_click_event`/`_click_p2cycle`/`_click_orange` -- three separate fields, so
  // clicking one icon never debounces a different one) and a click arriving inside this window is a
  // silent no-op (same `state` returned, timestamp left untouched, so it doesn't itself start a new
  // window). `Date.now()` is ordinary JS, available here since scripts run in the page's own real
  // global scope (see CLAUDE.md's "Accepted risk" note), not a sandbox.
  _CLICK_DEBOUNCE_MS: 350,
  _debounced(state, key, now){
    const last = state['_click_'+key];
    return !!(last && now - last < this._CLICK_DEBOUNCE_MS);
  },

  dragEdit(state, handle, lx, ly, w, h, style){
    if(handle === 'hand'){
      const L = this._layout(style||{}, w, h);
      let a = Math.atan2(lx-L.clockCx, -(ly-L.clockCy)); if(a<0) a += 2*Math.PI;
      // Inverse of _dialAngle: a<=π is the RIGHT half (after start, value 0..30), a>π is the LEFT half
      // (before start, value -30..0, wrapping down from just-under-0 as a approaches 2π).
      let value = Math.round(a <= Math.PI ? (a/Math.PI)*30 : (a/Math.PI)*30 - 60);
      value = Math.max(-30, Math.min(30, value));
      // Dragging the hand to anywhere BEFORE the start cancels a stale X/recall/N override outright
      // (not just hides it) -- so dragging the hand back to AFTER the start later doesn't resurrect
      // it. AP is left untouched there -- it's explicitly still allowed before the start. The mirror
      // case: dragging the hand past the start (value > 0) cancels a stale AP the same way -- AP can
      // never apply after the start.
      const staleBeforeStart = this._beforeStart({value}) && (state.event==='X' || state.event==='recall' || state.event==='N');
      const staleAP = this._afterStart({value}) && state.event==='AP';
      if(staleBeforeStart || staleAP){
        return { ...state, value, event: null, sub: null };
      }
      return { ...state, value };
    }
    const now = Date.now();
    if(handle === 'event'){
      if(this._debounced(state, 'event', now)) return state;
      // Before the start, only AP is offered -- cycling through X/recall/N here would immediately get
      // cancelled again by the hand-drag reset above anyway, so they're left out of the cycle itself
      // rather than being reachable-then-instantly-undone. Past the start (right half of the dial),
      // it's the mirror case: AP itself is left out instead, for the exact same reason (it'd just get
      // cancelled again by the hand-drag reset's own AP check). Only exactly AT the start (value:0,
      // neither half) does the full 5-state cycle apply.
      const cycle = this._beforeStart(state) ? [null,'AP']
        : this._afterStart(state) ? this._EVENT_CYCLE.filter(e => e!=='AP')
        : this._EVENT_CYCLE;
      const i = cycle.indexOf(this._effectiveEvent(state));
      const next = cycle[(i<0?0:i+1) % cycle.length];
      return { ...state, event: next, sub: (next==='AP'||next==='N') ? state.sub : null, _click_event: now };
    }
    if(handle === 'p2cycle'){
      if(this._debounced(state, 'p2cycle', now)) return state;
      if(state.event === 'AP' || state.event === 'N'){
        const i = this._SUB_CYCLE.indexOf(state.sub);
        return { ...state, sub: this._SUB_CYCLE[(i+1) % this._SUB_CYCLE.length], _click_p2cycle: now };
      }
      if(state.event === null){
        const i = this._PREP_CYCLE.indexOf(state.prep);
        return { ...state, prep: this._PREP_CYCLE[(i+1) % this._PREP_CYCLE.length], _click_p2cycle: now };
      }
      return state;  // X / general recall have no secondary flag to cycle
    }
    if(handle === 'orange'){
      if(this._debounced(state, 'orange', now)) return state;
      return { ...state, orangeShown: !state.orangeShown, _click_orange: now };
    }
    return state;
  },
})
