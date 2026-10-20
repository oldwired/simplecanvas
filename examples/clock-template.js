({
  // Default state for a freshly-placed instance -- classic "watch ad" time.
  initState(){ return { h:10, m:10 }; },

  // Called fresh on every render. state = the current time; style = the container's own resolved
  // Fill/Stroke/Stroke-width/Text-color (whatever the toolbar dropdowns currently show for THIS
  // object); w/h = the box's current size (changes live while resizing).
  children(state, style, w, h){
    const cx = w/2, cy = h/2;              // box center, in local (0,0)-(w,h) coordinates
    const r = Math.min(w,h)/2;             // face radius

    // Face + ticks always use HALF the dropdown's stroke width (min 1px), regardless of how thick
    // the hands themselves are.
    const thin = Math.max(1, (style.size||4)/2);

    const items = [
      // Face: color AND fill follow the container's own style (style.color / style.fill / style.fillColor)
      { type:'ellipse', x:0, y:0, w, h,
        color: style.color, strokeOn:true, size: thin,
        fill: style.fill, fillColor: style.fillColor },
    ];

    // 12 hour ticks, arranged radially, with a 4px gap from the face's own edge
    for(let i=0; i<12; i++){
      const a = i/12 * 2*Math.PI;          // this tick's angle (0 = 12 o'clock, clockwise)
      items.push({
        type:'line', color: style.color, size: thin,
        x1: cx + Math.sin(a)*(r-12), y1: cy - Math.cos(a)*(r-12),   // inner end
        x2: cx + Math.sin(a)*(r-4),  y2: cy - Math.cos(a)*(r-4),    // outer end (4px short of the face edge)
      });
    }

    // Hour/minute hand angles, derived from the current state
    const hourA = ((state.h % 12) + state.m/60) / 12 * 2*Math.PI;   // hour hand also drifts with the minutes
    const minA  = state.m/60 * 2*Math.PI;

    // Hour hand: short (50% of radius), full dropdown stroke width
    items.push({
      type:'line', x1:cx, y1:cy,
      x2: cx + Math.sin(hourA)*r*0.5, y2: cy - Math.cos(hourA)*r*0.5,
      color: style.color, size: style.size||4,
    });

    // Minute hand: longer (70% of radius), 1px thinner than the hour hand
    items.push({
      type:'line', x1:cx, y1:cy,
      x2: cx + Math.sin(minA)*r*0.7, y2: cy - Math.cos(minA)*r*0.7,
      color: style.color, size: Math.max(1, (style.size||4)-1),
    });

    return items;
  },

  // Marks where each hand can be grabbed in edit mode (small solid circles drawn by the app itself
  // -- this only reports positions, it doesn't draw anything). Same points hitEdit checks against.
  handles(state, w, h){
    const cx = w/2, cy = h/2, r = Math.min(w,h)/2;
    const hourA = ((state.h%12) + state.m/60) / 12 * 2*Math.PI;
    const minA = state.m/60 * 2*Math.PI;
    return [
      { id:'minute', x: cx + Math.sin(minA)*r*0.7, y: cy - Math.cos(minA)*r*0.7 },
      { id:'hour',   x: cx + Math.sin(hourA)*r*0.5, y: cy - Math.cos(hourA)*r*0.5 },
    ];
  },

  // Called on every click while the object is in edit mode (lx/ly = click position, relative to
  // the box's own top-left corner). Returns which hand was grabbed, or null for a miss.
  hitEdit(state, lx, ly, w, h){
    const cx = w/2, cy = h/2, r = Math.min(w,h)/2;
    const hourA = ((state.h%12) + state.m/60) / 12 * 2*Math.PI;
    const minA = state.m/60 * 2*Math.PI;

    // "close enough to this hand's tip" (14px tolerance)
    const near = (ang, len) => Math.hypot(
      lx - (cx + Math.sin(ang)*len),
      ly - (cy - Math.cos(ang)*len)
    ) < 14;

    if(near(minA, r*0.7)) return 'minute';   // minute hand checked first (usually the longer, outer one)
    if(near(hourA, r*0.5)) return 'hour';
    return null;   // missed both hands -- no drag starts
  },

  // Called on every mouse move while a hand is being dragged. Computes the new angle from the
  // pointer position and turns it into the new time for whichever hand is currently grabbed.
  dragEdit(state, handle, lx, ly, w, h){
    const cx = w/2, cy = h/2;
    // angle of the mouse relative to the center, 0 = straight up (12 o'clock), clockwise
    let a = Math.atan2(lx-cx, -(ly-cy));
    if(a < 0) a += 2*Math.PI;   // normalize to [0, 2*PI)

    if(handle === 'minute') return { ...state, m: Math.round(a/(2*Math.PI)*60) % 60 };
    if(handle === 'hour'){
      const hf = a/(2*Math.PI)*12;
      return { ...state, h: Math.floor(hf)%12 || 12 };   // "|| 12", not 0, so noon/midnight isn't stored as 0
    }
    return state;   // unknown handle -- leave state unchanged
  },
})
