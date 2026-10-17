// Boolean X means unknown; controlling AND/OR inputs still resolve a definite output.
// Required boolean inputs stay unavailable until connected or given literal values.
// Indicator visibility is an instance setting; its control is author-only.
({
  apiVersion:2,
  inputs:{a:{type:'boolean',unknown:true},b:{type:'boolean',unknown:true}},
  outputs:{value:{type:'boolean',unknown:true}},
  initState(){return {showIndicators:true};},
  initStyle(){return {w:240,h:150,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  compute(inputs){return {value:inputs.a===false || inputs.b===false?false:inputs.a==='X'||inputs.b==='X'?'X':true};},
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
    const label=value=>value==='X'?'X':typeof value==='boolean'?String(value):'—';
    const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true});
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor,strokeOn:false,fill:false});
    const ports=[{name:'A',value:inputs.a,y:h*.37},{name:'B',value:inputs.b,y:h*.61}],outputY=h*.49;
    const children=[{...text('',w*.04,0,w*.92,h*.2,16,'left'),...this._caption(io?.name,'AND',w*.92,h*.2,{...style,fontSize:16*scale})}];
    for(const port of ports){
      children.push(line(w*.02,port.y,w*.42,port.y));
      children.push(text(port.name+': '+label(port.value),0,port.y-h*.16,w*.29,h*.13,10.5));
    }
    children.push(line(w*.69,outputY,w*.98,outputY));
    children.push(text('Output: '+label(outputs.value),w*.72,outputY-h*.16,w*.28,h*.13,10));
    const body={type:'polygon',closed:true,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size};
    children.push({...body,points:[
      {x:w*.30,y:h*.25},
      {x:w*.51,y:h*.25,c1:{x:w*.626,y:h*.25}},
      {x:w*.72,y:h*.49,c2:{x:w*.72,y:h*.357},c1:{x:w*.72,y:h*.623}},
      {x:w*.51,y:h*.73,c2:{x:w*.626,y:h*.73}},
      {x:w*.30,y:h*.73}
    ]});
    if(state.showIndicators!==false){
      const radius=4*scale;
      for(const port of [...ports.map(port=>({...port,x:w*.045})),{x:w*.955,y:outputY,value:outputs.value}]){
        const available=typeof port.value==='boolean';
        children.push({type:'ellipse',x:port.x-radius,y:port.y-radius,w:radius*2,h:radius*2,fill:true,
          fillColor:available?(port.value?'#15803d':'#64748b'):'#fbbf24',strokeOn:true,color:available?'#f8fafc':'#b45309',size:Math.max(1,scale)});
      }
    }
    if(io?.error)children.push(text(/^Missing value or binding/.test(io.error)?'Input required':'Input unavailable',w*.04,h*.82,w*.92,h*.15,10.5));
    if(editing && !io?.error){
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
