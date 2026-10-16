// A boolean display. Missing inputs remain unavailable; they never look like false.
({
  apiVersion:2,
  inputs:{value:{type:'boolean'}},
  outputs:{value:{type:'boolean'}},
  initState(){return {};},
  initStyle(){return {w:220,h:100,fontSize:22,strokeOn:false};},
  compute(inputs){return {value:inputs.value};},
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
    const value=io.outputs.value,diameter=Math.min(w*.18,h*.42);
    const caption=this._caption(io.name,'Status indicator',w,h*.33,style);
    return [
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      {type:'text',x:0,y:0,w,h:h*.33,...caption,align:'center',color:style.textColor,strokeOn:false},
      {type:'ellipse',x:w*.18-diameter/2,y:h*.66-diameter/2,w:diameter,h:diameter,fill:true,fillColor:value?'#15803d':'#64748b',strokeOn:false},
      {type:'text',x:w*.32,y:h*.36,w:w*.65,h:h*.60,text:value?'ON':'OFF',align:'center',font:style.font,color:style.textColor,strokeOn:false}
    ];
  }
})
