({
  // The only state this object needs: its own radius. initState() has no w/h to work with (the
  // container's size isn't decided yet when it runs), so this is a plain literal -- tuned to fill
  // half the box's own half-size at the default 180x180 creation size, same proportion it filled
  // at the old 120x120 default (30/60 there == 45/90 here).
  initState(){ return { r: 45 }; },

  // One child: a circle centered in the box, fully following the container's own style.
  children(state, style, w, h){
    return [{
      type:'ellipse', x:w/2-state.r, y:h/2-state.r, w:state.r*2, h:state.r*2,
      color: style.color, size: style.size, strokeOn: style.strokeOn,
      fill: style.fill, fillColor: style.fillColor,
    }];
  },

  // One handle, on the circle's own right edge -- same point handles() reports and hitEdit checks.
  handles(state, w, h){ return [{ id:'r', x: w/2+state.r, y: h/2 }]; },

  hitEdit(state, lx, ly, w, h){
    const near = Math.hypot(lx-(w/2+state.r), ly-h/2) < 12;
    return near ? 'r' : null;
  },

  // Clamped both ways: never smaller than 5px, never bigger than half the container's own box --
  // that upper clamp is what keeps the circle from growing past the container's own edges.
  dragEdit(state, handle, lx, ly, w, h){
    if(handle !== 'r') return state;
    const maxR = Math.min(w, h) / 2;
    const r = Math.max(5, Math.min(maxR, Math.hypot(lx-w/2, ly-h/2)));
    return { ...state, r };
  },
})
