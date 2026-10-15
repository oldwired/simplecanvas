// Select this shape and choose Inputs to connect value to a Number control's value output.
({
  apiVersion: 2,
  inputs: { value: { type:'number', default:0 } },
  outputs: { percentage: { type:'number' } },
  initState(){ return {}; },
  initStyle(){ return { w:260, h:120, fontSize:24, strokeOn:false, fillColor:'#2563eb' }; },
  compute(inputs,state){ return { percentage:Math.max(0,Math.min(100,inputs.value)) }; },
  children(state,style,w,h,editing,io){
    const value=io.outputs.percentage;
    return [
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      {type:'text',x:0,y:0,w,h:h*.5,text:value+'%',align:'center',font:style.font,color:style.textColor,strokeOn:false,fill:false},
      {type:'rect',x:8,y:h*.6,w:Math.max(1,w-16),h:h*.25,fill:false,strokeOn:true,color:style.color,size:1},
      {type:'rect',x:8,y:h*.6,w:Math.max(0,w-16)*value/100,h:h*.25,fill:true,fillColor:style.fillColor,strokeOn:false}
    ];
  }
})
