// Number function. Configure literals or connect numeric inputs through Edit.
({
  apiVersion:2,
  inputs:{value:{type:'number'},operation:{role:'control',type:'string',default:'abs',options:['abs','round','floor','ceil']}},
  outputs:{value:{type:'number'}},
  initState(){return {showIndicators:true};},
  initStyle(){return {w:300,h:180,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  compute(inputs){
    if(!Number.isFinite(inputs.value))throw new Error('Input must be a finite number');
    if(!['abs','round','floor','ceil'].includes(inputs.operation))throw new Error('Unsupported operation');
    const value=Math[inputs.operation](inputs.value);
    if(!Number.isFinite(value))throw new Error('Calculation overflow');
    return {value:value||0};
  },
  _number(value){return !Number.isFinite(value)?'—':Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(8)));},
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
    const inputs=io.error?{}:io.inputs||{},outputs=io.error?{}:io.outputs||{},scale=Math.min(w/300,h/180);
    const font=size=>'600 '+Math.max(6,size*scale)+'px sans-serif';
    const label=value=>this._number(value);
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor||style.color,strokeOn:false,fill:false});
    const available=Number.isFinite(inputs.value)&&Number.isFinite(outputs.value);
    const title={...text('',w*.04,0,w*.92,h*.2,18,'left'),...this._caption(io.name,'Number function',w*.92,h*.2,{...style,fontSize:18*scale})};
    const cy=h*.48;
    const children=[
      title,
      {type:'line',x1:w*.02,y1:cy,x2:w*.30,y2:cy,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true},
      {type:'line',x1:w*.69,y1:cy,x2:w*.98,y2:cy,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true},
      text('Input',0,h*.25,w*.29,h*.12,10),
      text(label(inputs.value),0,h*.50,w*.29,h*.14,11),
      text('Output',w*.71,h*.25,w*.29,h*.12,10),
      text(label(outputs.value),w*.71,h*.50,w*.29,h*.14,11),
      {type:'rect',x:w*.30,y:h*.25,w:w*.39,h:h*.43,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      text(({abs:'|x|',round:'≈',floor:'⌊x⌋',ceil:'⌈x⌉'})[inputs.operation]||'f(x)',w*.30,h*.25,w*.39,h*.43,30),
      text(['abs','round','floor','ceil'].includes(inputs.operation)?inputs.operation:'Choose operation',w*.02,h*.69,w*.96,h*.12,10)
    ];
    if(state.showIndicators!==false){
      const radius=4*scale;
      for(const [x,value] of [[w*.045,inputs.value],[w*.955,outputs.value]]){
        const present=Number.isFinite(value);
        children.push({type:'ellipse',x:x-radius,y:cy-radius,w:radius*2,h:radius*2,fill:true,fillColor:present?'#2563eb':'#fbbf24',strokeOn:true,color:present?'#f8fafc':'#b45309',size:Math.max(1,scale)});
      }
    }
    if(io.error || !available){
      const error=typeof io.error==='string'?io.error:'';
      const note=!error || /^Missing value or binding/.test(error)?'Input required':/minimum|range|operation|Clamp must/i.test(error)?'Check configuration in Edit':'Calculation unavailable';
      children.push({...text(note,w*.04,h*.84,w*.92,h*.13,10.5),color:'#92400e'});
    }
    if(editing && available && !io.error){
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
