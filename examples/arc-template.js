({
  initState(){ return { a1: 0, a2: Math.PI/2 }; },   // a visible quarter-turn by default

  children(state, style, w, h){
    const cx = w/2, cy = h/2, r = Math.min(w,h)/2;
    const a1 = state.a1;
    const sweep = ((state.a2 - state.a1) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
    const a2 = a1 + sweep;   // numerically >= a1, so ctx.arc/svgArcD sweep the intended direction
    const arcStart = { x: cx+r*Math.sin(a1), y: cy-r*Math.cos(a1), arcTo:{cx,cy,r,a1,a2} };
    const arcEnd = { x: cx+r*Math.sin(a2), y: cy-r*Math.cos(a2) };
    const points = style.fill ? [{x:cx,y:cy}, arcStart, arcEnd] : [arcStart, arcEnd];

    return [{
      type:'polygon', points, closed: !!style.fill,
      color: style.color, size: style.size||4, dash: style.dash,
      fill: style.fill, fillColor: style.fillColor, strokeOn: style.strokeOn,
    }];
  },

  handles(state, w, h){
    const cx = w/2, cy = h/2, r = Math.min(w,h)/2;
    return [
      { id:'a1', x: cx+r*Math.sin(state.a1), y: cy-r*Math.cos(state.a1) },
      { id:'a2', x: cx+r*Math.sin(state.a2), y: cy-r*Math.cos(state.a2) },
    ];
  },

  hitEdit(state, lx, ly, w, h){
    const cx = w/2, cy = h/2, r = Math.min(w,h)/2;
    const near = a => Math.hypot(lx-(cx+r*Math.sin(a)), ly-(cy-r*Math.cos(a))) < 14;
    if(near(state.a1)) return 'a1';
    if(near(state.a2)) return 'a2';
    return null;
  },

  dragEdit(state, handle, lx, ly, w, h){
    if(handle !== 'a1' && handle !== 'a2') return state;
    const cx = w/2, cy = h/2;
    let a = Math.atan2(lx-cx, -(ly-cy)); if(a < 0) a += 2*Math.PI;
    return { ...state, [handle]: a };
  },
})
