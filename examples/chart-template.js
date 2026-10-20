({
  _number(value){return !Number.isFinite(value)?'—':Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(8)));},
  initState(){ return { values: [30, 60, 45, 80] }; },
  initStyle(){ return { fontSize: 12, strokeOn: false, w: 240, h: 160 }; },

  children(state, style, w, h, editing){
    const PRIORITY = ['#ef4444','#22c55e','#3b82f6','#eab308'];   // Red, Green, Blue, Yellow first
    const EXCLUDE = ['#ffffff','#000000','#1f2937'];
    const all = (style.presetColors && style.presetColors.length) ? style.presetColors : PRIORITY;
    const COLORS = PRIORITY.concat(all.filter(c => !PRIORITY.includes(c) && !EXCLUDE.includes(c)));
    const n = state.values.length;
    const marginX = w*0.056, marginTop = h*0.105, marginBottom = h*0.105, gap = w*0.04;
    const baseline = h - marginBottom;
    const colW = (w - marginX*2 - gap*Math.max(0,n-1)) / n;
    const maxBarH = baseline - marginTop;
    const fontPx = style.fontSize || 16;

    const items = [
      // background (toolbar Fill) + enclosing frame (toolbar Stroke), spanning the whole container
      { type:'rect', x:0, y:0, w, h, color:style.color, size:style.size||4,
        fill:style.fill, fillColor:style.fillColor, strokeOn:style.strokeOn },
      // axis: always solid black, 1px -- fixed, follows nothing
      { type:'line', x1:marginX, y1:baseline, x2:w-marginX, y2:baseline, color:'#000000', size:1 },
    ];

    state.values.forEach((v,i) => {
      const x = marginX + i*(colW+gap);
      const barH = Math.max(0, Math.min(100, v))/100 * maxBarH, barTop = baseline-barH;
      items.push({ type:'rect', x, y:barTop, w:colW, h:barH, color:COLORS[i%COLORS.length], fill:true, fillColor:COLORS[i%COLORS.length], strokeOn:false });
      // value label, above the bar's own top edge -- toolbar font family/size, toolbar text color.
      // strokeOn:false/fill:false keeps the text item's own default "box on unless told off" from
      // drawing a stray border/fill behind every number.
      items.push({ type:'text', text:this._number(v), x, y:barTop-fontPx*1.3, w:colW, h:fontPx*1.2,
        align:'center', font:style.font, color:style.textColor, strokeOn:false, fill:false });
    });

    if(editing){
      // ONE shared "-"/"+" pair, not one delete icon per bar -- deleting always drops the LAST bar,
      // so there was never a reason to target a specific one. Centered together under the axis.
      const cy = baseline + 12, iconGap = 12;
      const mr = 5, mx = w/2 - iconGap;
      items.push({ type:'line', x1:mx-mr, y1:cy, x2:mx+mr, y2:cy, color:'#dc2626', size:2 });
      if(n < COLORS.length){
        const pr = 6, px = w/2 + iconGap;
        items.push({ type:'line', x1:px-pr, y1:cy, x2:px+pr, y2:cy, color:'#16a34a', size:2 });
        items.push({ type:'line', x1:px, y1:cy-pr, x2:px, y2:cy+pr, color:'#16a34a', size:2 });
      }
    }
    return items;
  },

  // Bar-top drag points get the generic blue-dot marker (kind defaults to 'drag'). "-"/"+" are
  // marked kind:'click' -- draws their own glyph in children() instead AND tells onDown/onMove/onUp
  // to resolve them once at release, not continuously while the pointer merely passes over them.
  handles(state, w, h){
    const marginX = w*0.056, marginTop = h*0.105, marginBottom = h*0.105, gap = w*0.04;
    const baseline = h - marginBottom;
    const n = state.values.length;
    const colW = (w - marginX*2 - gap*Math.max(0,n-1)) / n;
    const maxBarH = baseline - marginTop;
    const hs = state.values.map((v,i) => {
      const x = marginX + i*(colW+gap) + colW/2;
      const barH = Math.max(0, Math.min(100, v))/100 * maxBarH;
      return { id:'bar'+i, x, y: baseline-barH };
    });
    const cy = baseline + 12, iconGap = 12;
    hs.push({ id:'del', x: w/2-iconGap, y: cy, kind:'click' });
    hs.push({ id:'add', x: w/2+iconGap, y: cy, kind:'click' });
    return hs;
  },

  hitEdit(state, lx, ly, w, h){
    const n = state.values.length;
    const marginX = w*0.056, marginTop = h*0.105, marginBottom = h*0.105, gap = w*0.04;
    const baseline = h - marginBottom;
    const colW = (w - marginX*2 - gap*Math.max(0,n-1)) / n;
    const maxBarH = baseline - marginTop;
    const cy = baseline + 12, iconGap = 12;
    if(Math.hypot(lx-(w/2-iconGap), ly-cy) < 12) return 'del';
    if(Math.hypot(lx-(w/2+iconGap), ly-cy) < 12) return 'add';
    for(let i=0;i<n;i++){
      const x = marginX + i*(colW+gap) + colW/2;
      const barH = Math.max(0, Math.min(100, state.values[i]))/100 * maxBarH;
      if(Math.hypot(lx-x, ly-(baseline-barH)) < 14) return 'bar'+i;
    }
    return null;
  },

  dragEdit(state, handle, lx, ly, w, h, style){
    if(handle === 'add'){
      const PRIORITY = ['#ef4444','#22c55e','#3b82f6','#eab308'];
      const EXCLUDE = ['#ffffff','#000000','#1f2937'];
      const all = (style && style.presetColors && style.presetColors.length) ? style.presetColors : PRIORITY;
      const max = PRIORITY.concat(all.filter(c => !PRIORITY.includes(c) && !EXCLUDE.includes(c))).length;
      if(state.values.length >= max) return state;
      const v = Math.round(10 + Math.random()*80);   // 10..90, so a new bar is never empty or full-height
      return { ...state, values: [...state.values, v] };
    }
    if(handle === 'del'){
      if(state.values.length <= 1) return state;   // always keep at least one bar
      return { ...state, values: state.values.slice(0, -1) };   // always the LAST bar
    }
    const barM = /^bar(\d+)$/.exec(handle);
    if(barM){
      const i = Number(barM[1]);
      const marginTop = h*0.105, marginBottom = h*0.105;
      const baseline = h - marginBottom;
      const maxBarH = baseline - marginTop;
      const barH = Math.max(0, Math.min(maxBarH, baseline-ly));
      const values = state.values.slice();
      values[i] = Math.round(barH/maxBarH*100);
      return { ...state, values };
    }
    return state;
  },
})
