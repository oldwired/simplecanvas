// Smart-shape script for SimpleCanvas — a 4-hole square drilling template ("Bohrschablone"),
// sized in real millimeters so it prints 1:1 (96px == 1 inch == 25.4mm, the fixed CSS/SVG pixel
// definition — the actual print-scale guarantee comes from exporting to SVG and printing "actual
// size" from a vector program, not from this app's own browser-based Print button). No separate
// calibration mark is drawn for that — just measure the printed holes themselves against a real
// ruler, same as the reference spacing label already tells you what they SHOULD measure.
//
// To use: SimpleCanvas → Shape Library → Manage → "Add smart shape…" → pick "Blank" → paste this
// whole file's content into the Script field (this header comment included — it's harmless there).
//
// - Resize with the ordinary resize handles (Shift keeps it square) to set the hole spacing.
// - Drag the 'pos' handle (center of the 4-hole square) to move it within the rectangle, without
//   changing the rectangle's own size.
// - Drag the 'dia' handle (top-left hole's own edge) to change the hole diameter.
({
  // holeDiameterMm: the one thing that needs a drag handle (spacing alone doesn't tell you how big
  // to actually drill) -- 6mm is a common everyday screw-clearance size. offsetXmm/offsetYmm: the
  // 4-hole square's own position, relative to the container's center -- (0,0) means centered.
  initState(){ return { holeDiameterMm: 6, offsetXmm: 0, offsetYmm: 0 }; },
  // ~40mm square at 96px/inch -- a plausible small drilling template's starting size, still fully
  // resizable afterward like any other item. Frame rect starts off (matching every other template's
  // "strokeOn:true,fill:false is the universal default, but this one specifically wants an
  // uncluttered look until the user opts in"), since the 4 holes/crosshairs are the actual content.
  initStyle(){ return { w: 151, h: 151, strokeOn: false, fontSize: 12 }; },

  // Shared geometry derivation, reused by children()/handles()/hitEdit()/dragEdit() so all four can
  // never drift apart. margin is a flat fraction of the container -- deliberately independent of the
  // CURRENT hole radius -- so growing or shrinking the hole diameter can never secretly change the
  // hole-to-hole spacing; diameter and spacing stay genuinely independent controls. The position
  // clamp below (using the current radius) only ever pulls the square back toward center far enough
  // to keep every hole fully inside the container -- it never touches the stored offset itself, so
  // shrinking the hole again always restores whatever position was last actually dragged to.
  _geom(state, w, h){
    const mmToPx = 96/25.4;
    const r = Math.max(1, state.holeDiameterMm) * mmToPx / 2;
    const margin = Math.min(w,h) * 0.15;
    const spacing = Math.max(1, Math.min(w,h) - margin*2), half = spacing/2;
    let ccx = w/2 + state.offsetXmm*mmToPx, ccy = h/2 + state.offsetYmm*mmToPx;
    ccx = Math.max(half+r, Math.min(w-half-r, ccx));
    ccy = Math.max(half+r, Math.min(h-half-r, ccy));
    return { mmToPx, r, margin, spacing, half, ccx, ccy };
  },

  children(state, style, w, h){
    const { mmToPx, r, spacing, half, ccx, ccy } = this._geom(state, w, h);
    const armR = Math.max(4, r*0.6);   // crosshair arm half-length, for precise center-punching
    const corners = [
      {x:ccx-half,y:ccy-half}, {x:ccx+half,y:ccy-half},
      {x:ccx-half,y:ccy+half}, {x:ccx+half,y:ccy+half},
    ];

    const items = [
      // the container's own frame -- purely optional, follows the toolbar's Fill/Stroke like any
      // other rect would (off by default -- see initStyle above).
      { type:'rect', x:0, y:0, w, h, color:style.color, size:style.size, strokeOn:style.strokeOn, fill:style.fill, fillColor:style.fillColor },
    ];
    for(const c of corners){
      items.push({ type:'ellipse', x:c.x-r, y:c.y-r, w:r*2, h:r*2, color:style.color, size:style.size, strokeOn:true, fill:false });
      items.push({ type:'line', x1:c.x-armR, y1:c.y, x2:c.x+armR, y2:c.y, color:style.color, size:Math.max(1,style.size*0.6) });
      items.push({ type:'line', x1:c.x, y1:c.y-armR, x2:c.x, y2:c.y+armR, color:style.color, size:Math.max(1,style.size*0.6) });
    }

    // live spacing readout, ABOVE the container (never inside it) -- so it can never collide with
    // the 4-hole square, wherever it's currently been dragged to within the container.
    const spacingMm = (spacing/mmToPx).toFixed(1);
    items.push({ type:'text', text: spacingMm+' mm hole spacing', x:0, y:-26, w, h:20, align:'center', font:style.font, color:style.textColor, strokeOn:false, fill:false });

    return items;
  },

  // 'pos' (at the 4-hole square's own center) drags the whole square around within the container,
  // without ever touching w/h. 'dia' (on the top-left hole's own right edge) changes just the hole
  // diameter, independent of spacing/position.
  handles(state, w, h){
    const { r, half, ccx, ccy } = this._geom(state, w, h);
    return [
      { id:'pos', x:ccx, y:ccy },
      { id:'dia', x:ccx-half+r, y:ccy-half },
    ];
  },

  hitEdit(state, lx, ly, w, h){
    const { r, half, ccx, ccy } = this._geom(state, w, h);
    if(Math.hypot(lx-ccx, ly-ccy) < 10) return 'pos';
    if(Math.hypot(lx-(ccx-half+r), ly-(ccy-half)) < 10) return 'dia';
    return null;
  },

  dragEdit(state, handle, lx, ly, w, h){
    const { mmToPx, margin, half, ccx, ccy } = this._geom(state, w, h);
    if(handle === 'dia'){
      // Clamped to the SMALLER of half the current spacing (adjacent holes would start to overlap)
      // and the fixed margin (the hole would start to poke past the container's own edge) -- both
      // real constraints, independent of each other.
      const cornerX = ccx-half, cornerY = ccy-half;
      const maxR = Math.min(half, margin) - 2;
      const rPx = Math.max(2, Math.min(maxR, Math.hypot(lx-cornerX, ly-cornerY)));
      const mm = Math.round((rPx*2/mmToPx)*10)/10;
      return { ...state, holeDiameterMm: Math.max(0.5, mm) };
    }
    if(handle === 'pos'){
      // Stores the RAW dragged offset (not the clamped display position) -- _geom()'s own clamp
      // re-applies fresh every render, so this never needs to duplicate that clamping logic here.
      const offsetXmm = Math.round(((lx-w/2)/mmToPx)*10)/10;
      const offsetYmm = Math.round(((ly-h/2)/mmToPx)*10)/10;
      return { ...state, offsetXmm, offsetYmm };
    }
    return state;
  },
})
