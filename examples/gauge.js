// Select this shape and choose Inputs to connect value to a Number control's value output.
({
  apiVersion: 2,
  inputs: { value: { type:'number', default:0 } },
  outputs: { percentage: { type:'number' } },
  initState(){ return {}; },
  initStyle(){ return { w:260, h:120, fontSize:24, strokeOn:false, fillColor:'#2563eb' }; },
  compute(inputs,state){ return { percentage:Math.max(0,Math.min(100,inputs.value)) }; },
  _caption(name,fallback,w,h,style){
    const label=(typeof name==='string'?name:'').trim().replace(/\s+/g,' ')||fallback;
    const units=text=>Array.from(text).reduce((n,c)=>n+(/[MWmw@#%]/.test(c)||c.codePointAt(0)>255?1.1:/[A-Z]/.test(c)?.88:.72),0);
    const width=Math.max(1,w-16),base=Math.min(style.fontSize||20,h*.7);
    let size=Math.min(base,width/Math.max(1,units(label))),lines=[label];
    if(size<Math.min(12,base)){
      size=Math.min(base,12,Math.max(1,h-2)/2.4,width/1.1);lines=[];let rest=label;
      for(let row=0;row<2 && rest;row++){
        let line='';for(const c of rest){if(line && units(line+c)*size>width)break;line+=c;}
        if(line.length<rest.length && line.lastIndexOf(' ')>0)line=line.slice(0,line.lastIndexOf(' '));
        rest=rest.slice(line.length).trim();
        if(row===1 && rest){while(line && units(line+'…')*size>width)line=Array.from(line).slice(0,-1).join('');line+='…';}
        lines.push(line);
      }
    }
    return {text:lines.join('\n'),font:(style.font||'600 20px sans-serif').replace(/\d+(?:\.\d+)?px/,size+'px')};
  },
  children(state,style,w,h,editing,io){
    const value=io.outputs.percentage;
    return [
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      {type:'text',x:0,y:0,w,h:h*.23,...this._caption(io.name,'Gauge',w,h*.23,style),align:'center',color:style.textColor,strokeOn:false,fill:false},
      {type:'text',x:0,y:h*.25,w,h:h*.28,text:value+'%',align:'center',font:style.font,color:style.textColor,strokeOn:false,fill:false},
      {type:'rect',x:8,y:h*.6,w:Math.max(1,w-16),h:h*.25,fill:false,strokeOn:true,color:style.color,size:1},
      {type:'rect',x:8,y:h*.6,w:Math.max(0,w-16)*value/100,h:h*.25,fill:true,fillColor:style.fillColor,strokeOn:false}
    ];
  }
})
