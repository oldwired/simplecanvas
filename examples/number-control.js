// A v2 component that publishes a number for other shapes to consume.
// Double-click to use its slider and +/- buttons; exported HTML exposes them directly.
({
  apiVersion: 2,
  inputs: {},
  outputs: { value: { type:'number' } },
  initState(){ return { value:50 }; },
  initStyle(){ return { w:240, h:110, fontSize:20, strokeOn:false }; },
  compute(inputs, state){ return { value:Math.max(0,Math.min(100,Number(state.value)||0)) }; },
  children(state, style, w, h, editing, io){
    const value=io.outputs.value, pad=20, y=h*.52;
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      {type:'text',x:0,y:0,w,h:h*.3,text:'Value: '+value,align:'center',font:style.font,color:style.textColor,strokeOn:false,fill:false},
      {type:'line',x1:pad,y1:y,x2:w-pad,y2:y,color:style.color,size:2},
      {type:'ellipse',x:pad+(w-pad*2)*value/100-6,y:y-6,w:12,h:12,fill:true,fillColor:style.color,strokeOn:false}
    ];
    if(editing){
      for(const [x,label] of [[0,'− 5'],[w/2,'+ 5']]){
        children.push({type:'rect',x:x+4,y:h*.72,w:w/2-8,h:h*.25,strokeOn:true,color:style.color,size:1,fill:false});
        children.push({type:'text',x,y:h*.72,w:w/2,h:h*.25,text:label,align:'center',font:style.font,color:style.textColor,strokeOn:false,fill:false});
      }
    }
    return children;
  },
  handles(state,w,h,style,io){ return [
    {id:'value',x:20+(w-40)*io.outputs.value/100,y:h*.52},
    {id:'minus',x:w/4,y:h*.84,kind:'click'},
    {id:'plus',x:w*.75,y:h*.84,kind:'click'}
  ]; },
  hitEdit(state,lx,ly,w,h){
    if(ly>=h*.72 && ly<=h && lx>=0 && lx<=w)return lx<w/2?'minus':'plus';
    if(Math.abs(ly-h*.52)<=18 && lx>=0 && lx<=w)return 'value';
    return null;
  },
  dragEdit(state,handle,lx,ly,w,h,style,io){
    const value=handle==='value'?Math.round((lx-20)/Math.max(1,w-40)*100)
      :io.outputs.value+(handle==='plus'?5:handle==='minus'?-5:0);
    return {state:{...state,value:Math.max(0,Math.min(100,value))}};
  }
})
