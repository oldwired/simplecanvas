({
  // shaftRatio: shaft thickness as a fraction of the box's own half-height.
  // headLenRatio: arrowhead length as a fraction of the box's own width.
  initState(){ return { shaftRatio: 0.5, headLenRatio: 0.35 }; },

  // A single 7-point polygon (shaft rectangle + triangular head), fully following the container's
  // own style -- unlike the clock, nothing here is hard-coded, since there's only one shape and no
  // reason to override the toolbar's own Fill/Stroke/Text-color choices.
  children(state, style, w, h){
    const cy = h/2;
    const headStart = w * (1 - state.headLenRatio);   // x where the head starts widening
    const shaftHalf = (h/2) * state.shaftRatio;        // half the shaft's own thickness

    return [{
      type:'polygon',
      points: [
        {x:0,         y:cy-shaftHalf},
        {x:headStart, y:cy-shaftHalf},
        {x:headStart, y:0},            // back corner of the head (top)
        {x:w,         y:cy},           // tip
        {x:headStart, y:h},            // back corner of the head (bottom)
        {x:headStart, y:cy+shaftHalf},
        {x:0,         y:cy+shaftHalf},
      ],
      color: style.color, size: style.size||4,
      fill: style.fill, fillColor: style.fillColor, strokeOn: style.strokeOn,
    }];
  },

  // Same two points hitEdit checks against -- marked as small solid circles in edit mode.
  handles(state, w, h){
    const cy = h/2;
    const headStart = w * (1 - state.headLenRatio);
    const shaftHalf = (h/2) * state.shaftRatio;
    return [
      { id:'headLen', x: headStart, y: 0 },
      { id:'shaft', x: headStart/2, y: cy-shaftHalf },
    ];
  },

  // 'shaft' handle sits on the shaft's own top edge; 'headLen' sits on the head's back corner.
  // Both are recomputed from the CURRENT state, so they track the shape as it's being adjusted.
  hitEdit(state, lx, ly, w, h){
    const cy = h/2;
    const headStart = w * (1 - state.headLenRatio);
    const shaftHalf = (h/2) * state.shaftRatio;
    const near = (x,y) => Math.hypot(lx-x, ly-y) < 12;

    if(near(headStart, 0)) return 'headLen';
    if(near(headStart/2, cy-shaftHalf)) return 'shaft';
    return null;
  },

  // Dragging 'shaft' up/down changes the shaft's thickness; dragging 'headLen' left/right changes
  // how much of the arrow's length the head takes up. shaftRatio's upper clamp is 1 (not less) so
  // the shaft can be widened all the way up to the head's own back-corner width -- headLenRatio's
  // upper clamp stays short of 1 since a head consuming the whole box would leave no shaft at all.
  dragEdit(state, handle, lx, ly, w, h){
    if(handle === 'shaft'){
      const r = Math.max(0.05, Math.min(1, Math.abs(ly - h/2)/(h/2)));
      return { ...state, shaftRatio: r };
    }
    if(handle === 'headLen'){
      const r = Math.max(0.05, Math.min(0.9, 1 - lx/w));
      return { ...state, headLenRatio: r };
    }
    return state;
  },
})
