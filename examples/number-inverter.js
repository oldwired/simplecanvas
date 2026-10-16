// Negate a required numeric value. This is multiplication by -1, not boolean NOT.
// Blue indicators mean a numeric value is available; zero is also available.
({
  apiVersion:2,
  inputs:{value:{type:'number'}},
  outputs:{value:{type:'number'}},
  initState(){return {showIndicators:true};},
  initStyle(){return {w:240,h:150,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  compute(inputs){return {value:-inputs.value};},
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
    const inputs=io?.inputs||{},outputs=io?.outputs||{},scale=Math.min(w/240,h/150);
    const font=size=>'600 '+Math.max(6,size*scale)+'px sans-serif';
    const label=value=>Number.isFinite(value)?String(value):'—';
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor,strokeOn:false,fill:false});
    const cy=h*.49,available=Number.isFinite(inputs.value)&&Number.isFinite(outputs.value);
    const children=[
      {...text('',w*.04,0,w*.92,h*.2,16,'left'),...this._caption(io?.name,'Inverter (×−1)',w*.92,h*.2,{...style,fontSize:16*scale})},
      {type:'line',x1:w*.02,y1:cy,x2:w*.30,y2:cy,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true},
      {type:'line',x1:w*.69,y1:cy,x2:w*.98,y2:cy,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true},
      text('Input: '+label(inputs.value),0,cy-h*.16,w*.29,h*.13,10.5),
      text('Output: '+label(outputs.value),w*.72,cy-h*.16,w*.28,h*.13,10),
      {type:'rect',x:w*.30,y:h*.25,w:w*.39,h:h*.48,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      text('×−1',w*.30,h*.25,w*.39,h*.48,28)
    ];
    if(state.showIndicators!==false){
      const radius=4*scale;
      for(const [x,value] of [[w*.045,inputs.value],[w*.955,outputs.value]]){
        const present=Number.isFinite(value);
        children.push({type:'ellipse',x:x-radius,y:cy-radius,w:radius*2,h:radius*2,fill:true,
          fillColor:present?'#2563eb':'#fbbf24',strokeOn:true,color:present?'#f8fafc':'#b45309',size:Math.max(1,scale)});
      }
    }
    if(io?.error || !available){
      children.push(text(!io?.error || /^Missing value or binding/.test(io.error)?'Input required':'Input unavailable',w*.04,h*.82,w*.92,h*.15,10.5));
    }
    if(editing && available && !io?.error){
      children.push({type:'rect',x:w*.05,y:h*.84,w:w*.9,h:h*.13,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly:true});
      children.push({...text('Indicators: '+(state.showIndicators!==false?'on':'off'),w*.05,h*.84,w*.9,h*.13,10.5),editorOnly:true});
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io){return this.children(state,style,w,h,false,io);},
  handles(state,w,h){return [{id:'indicators',x:w/2,y:h*.905,kind:'click',editorOnly:true}];},
  hitEdit(state,x,y,w,h){return x>=w*.05 && x<=w*.95 && y>=h*.84 && y<=h*.97?'indicators':null;},
  dragEdit(state,handle){return {state:handle==='indicators'?{...state,showIndicators:state.showIndicators===false}:state};}
})
