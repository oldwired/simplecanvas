// Active-high enable: pass the Boolean input through when enabled, otherwise output Z.
// null is the declared high-impedance output, never an unavailable or false value.
({
  apiVersion:2,
  inputs:{value:{type:'boolean'},enable:{type:'boolean'}},
  outputs:{value:{type:'boolean',triState:true}},
  initState(){return {showIndicators:true};},
  initStyle(){return {w:260,h:190,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  compute(inputs){return {value:inputs.enable?inputs.value:null};},
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
  children(state,style,w,h,editing,io={}){
    const rawInputs=io.inputs||{},rawOutput=io.outputs?.value,scale=Math.min(w/260,h/190);
    const available=!io.error && typeof rawInputs.value==='boolean' && typeof rawInputs.enable==='boolean' && (typeof rawOutput==='boolean' || rawOutput===null);
    const inputs=available?rawInputs:{},output=available?rawOutput:undefined;
    const font=size=>'600 '+Math.max(6,size*scale)+'px sans-serif';
    const label=value=>value===null?'Z':typeof value==='boolean'?String(value):'—';
    const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true});
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor||style.color,strokeOn:false,fill:false});
    const cy=h*.55,enableX=w*.46,enableY=h*.25;
    const children=[
      {...text('',w*.04,0,w*.92,h*.18,16,'left'),...this._caption(io.name,'Tri-state buffer',w*.92,h*.18,{...style,fontSize:16*scale})},
      line(w*.02,cy,w*.30,cy),
      line(w*.69,cy,w*.98,cy),
      line(enableX,h*.23,enableX,h*(.35+(.46-.30)/(.69-.30)*(.55-.35))),
      text('Input: '+label(inputs.value),0,h*.40,w*.29,h*.13,10.5),
      text('Output: '+label(output),w*.72,h*.40,w*.28,h*.13,10),
      text('Enable: '+label(inputs.enable),w*.50,h*.19,w*.46,h*.14,10.5,'left'),
      {type:'polygon',closed:true,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size,
        points:[{x:w*.30,y:h*.35},{x:w*.69,y:h*.55},{x:w*.30,y:h*.75}]}
    ];
    if(state.showIndicators!==false){
      const radius=4*scale;
      for(const [x,y,value] of [[w*.045,cy,inputs.value],[enableX,enableY,inputs.enable],[w*.955,cy,output]]){
        const present=typeof value==='boolean' || value===null;
        const color=value===null?'#7c3aed':typeof value==='boolean'?(value?'#15803d':'#64748b'):'#fbbf24';
        children.push({type:'ellipse',x:x-radius,y:y-radius,w:radius*2,h:radius*2,fill:true,fillColor:color,
          strokeOn:true,color:present?'#f8fafc':'#b45309',size:Math.max(1,scale)});
      }
    }
    if(available && output===null)children.push({...text('High impedance',w*.53,h*.68,w*.44,h*.12,10.5),color:'#7c3aed'});
    if(!available){
      children.push({...text(!io.error || /^Missing value or binding/.test(io.error)?'Input required':'Input unavailable',w*.04,h*.82,w*.92,h*.15,10.5),color:'#92400e'});
    }
    if(editing && available){
      children.push({type:'rect',x:w*.05,y:h*.84,w:w*.9,h:h*.13,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly:true});
      children.push({...text('Indicators: '+(state.showIndicators!==false?'on':'off'),w*.05,h*.84,w*.9,h*.13,10.5),editorOnly:true});
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,inputs:{},outputs:{}});},
  handles(state,w,h){return [{id:'indicators',x:w/2,y:h*.905,kind:'click',editorOnly:true}];},
  hitEdit(state,x,y,w,h){return x>=w*.05 && x<=w*.95 && y>=h*.84 && y<=h*.97?'indicators':null;},
  dragEdit(state,handle){return {state:handle==='indicators'?{...state,showIndicators:state.showIndicators===false}:state};}
})
