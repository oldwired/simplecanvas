// The same physical scale as drill-template.js: 96 canvas px = 1 inch = 25.4 mm.
// Extending the ruler reveals more divisions without stretching them. Resize vertically to change
// its height. Double-click, then click the unit label to cycle cm/mm, inch, and px.
// Physical size is reliable in SVG printed at actual size; screens and browser printing may scale.
({
  initState(){ return { unit:'cm' }; },
  initStyle(){ return { w:378, h:76, fontSize:12, strokeOn:false }; },
  // Adjust these definitions to make a custom scale. minor is the spacing of the smallest tick;
  // unitPx is the distance represented by one numbered unit. Both are in canvas pixels.
  _scales:{
    cm:{minor:96/25.4,majorEvery:10,unitPx:96/2.54,label:'cm / mm',radix:10},
    in:{minor:96/16,majorEvery:16,unitPx:96,label:'inch',radix:2},
    px:{minor:10,majorEvery:5,unitPx:1,label:'px',radix:10}
  },
  _unit(state){ return ['cm','in','px'].includes(state.unit)?state.unit:'cm'; },
  children(state, style, w, h, editing){
    const unit=this._unit(state), scale=this._scales[unit];
    // Keep large imported/resized rulers within the app's child budget, dropping fine divisions
    // first. Every remaining tick still uses the original physical scale.
    const stride=Math.pow(scale.radix,Math.max(0,Math.ceil(Math.log(Math.max(1,w/scale.minor/400))/Math.log(scale.radix))));
    const step=scale.minor*stride, majorEvery=Math.max(1,Math.round(scale.majorEvery/stride));
    const baseline=h-4, majorLength=Math.min(22,h*.3), minorLength=majorLength*.45;
    const baselineWidth=Math.max(1,style.size||1);
    const items=[
      {type:'rect',x:0,y:0,w,h,color:style.color,size:style.size,strokeOn:style.strokeOn,fill:style.fill,fillColor:style.fillColor},
      // Filled strips have flat ends. A stroked line's rounded cap would protrude past zero.
      {type:'rect',x:0,y:baseline-baselineWidth/2,w,h:baselineWidth,strokeOn:false,fill:true,fillColor:style.color}
    ];
    for(let i=0;i<=Math.floor(w/step+1e-9);i++){
      const x=i*step, major=i%majorEvery===0;
      const half=(unit==='cm' || unit==='in') && majorEvery>1 && majorEvery%2===0 && i%(majorEvery/2)===0;
      // Zero starts at the left edge, with a normal tick and its label inside the scale.
      const length=major?majorLength:half?majorLength*.72:minorLength;
      const size=Math.max(1,(style.size||2)/2)*(unit==='cm' && !major ? .65 : 1);
      // Keep the stroke's visible area inside the scale, including at zero and at thick settings.
      const left=Math.max(0,x-size/2), right=Math.min(w,x+size/2);
      items.push({type:'rect',x:left,y:baseline-length,w:right-left,h:length,strokeOn:false,fill:true,fillColor:style.color});
      if(major)items.push({type:'text',x:i===0?0:x-20,y:baseline-majorLength-21,w:40,h:18,
        text:String(Math.round(x/scale.unitPx*1000)/1000),align:i===0?'left':'center',font:style.font,color:style.textColor,strokeOn:false,fill:false});
    }
    const buttonW=Math.min(88,w), buttonX=w-buttonW;
    if(w>180)items.push({type:'text',x:0,y:0,w:w-buttonW-8,h:20,align:'left',
      text:(w/scale.unitPx).toFixed(unit==='px'?0:2)+' '+(unit==='in'?'in':unit),
      font:style.font,color:style.textColor,strokeOn:false,fill:false});
    if(editing)items.push({type:'rect',x:buttonX,y:0,w:buttonW,h:22,color:style.color,size:1,strokeOn:true,fill:false});
    items.push({type:'text',x:buttonX,y:0,w:buttonW,h:22,text:scale.label+(editing?' ↻':''),
      align:'center',font:style.font,color:style.textColor,strokeOn:false,fill:false});
    return items;
  },
  handles(state, w){ return [{id:'units',x:w-Math.min(88,w)/2,y:11,kind:'click'}]; },
  hitEdit(state, lx, ly, w){ return lx>=w-Math.min(88,w) && lx<=w && ly>=0 && ly<=22?'units':null; },
  dragEdit(state, handle){
    if(handle!=='units') return state;
    const units=['cm','in','px'];return {...state,unit:units[(units.indexOf(this._unit(state))+1)%units.length]};
  },
})
