// Draw one integer from the inclusive configured range every active second.
// A fresh runtime or changed range draws immediately; late wakes never catch up in a burst.
({
  apiVersion:2,
  wakePolicy:'latest',
  inputs:{min:{role:'control',type:'number',default:0},max:{role:'control',type:'number',default:100}},
  outputs:{value:{type:'number'}},
  initState(){return {value:0,showIndicators:true};},
  initStyle(){return {w:280,h:180,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _validate(inputs,state){
    if(!Number.isSafeInteger(inputs.min) || !Number.isSafeInteger(inputs.max) || inputs.min>inputs.max)throw new Error('Random bounds must be safe integers with min no greater than max');
    if(!Number.isSafeInteger(inputs.max-inputs.min+1))throw new Error('Random inclusive range is too wide');
    if(!Number.isSafeInteger(state.value))throw new Error('Random state must contain a safe integer');
  },
  transition(inputs,state,memory,context){
    this._validate(inputs,state);
    const now=context.now;
    if(!Number.isFinite(now) || now<0)throw new Error('Random requires a valid monotonic time');
    const fresh=!Number.isFinite(memory?.nextAt) || memory.min!==inputs.min || memory.max!==inputs.max;
    const due=fresh || (!context.historical && now>=memory.nextAt);
    const value=due?inputs.min+Math.floor(Math.random()*(inputs.max-inputs.min+1)):state.value;
    const nextAt=due?now+1000:memory.nextAt;
    if(!Number.isFinite(nextAt))throw new Error('Random wake time is outside the numeric range');
    return {state:{...state,value},memory:{min:inputs.min,max:inputs.max,nextAt},nextWakeAt:nextAt};
  },
  publish(state){if(!Number.isSafeInteger(state.value))throw new Error('Output state must contain a safe integer');return {value:state.value};},
  compute(inputs,state){this._validate(inputs,state);return {value:state.value};},
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
    const raw=io.inputs||{},rawOutput=io.outputs?.value,scale=Math.min(w/280,h/180);
    const available=!io.error && Number.isSafeInteger(raw.min) && Number.isSafeInteger(raw.max) && Number.isSafeInteger(rawOutput);
    const inputs=available?raw:{},output=available?rawOutput:undefined;
    const font=size=>'600 '+Math.max(6,size*scale)+'px sans-serif';
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor||style.color,strokeOn:false,fill:false});
    const label=Number.isSafeInteger(output)?String(output):'—',range=available?inputs.min+' … '+inputs.max:'— … —',cy=h*.49;
    const children=[
      {...text('',w*.04,0,w*.92,h*.18,16,'left'),...this._caption(io.name,'Random integer',w*.92,h*.18,{...style,fontSize:16*scale})},
      {type:'line',x1:w*.73,y1:cy,x2:w*.98,y2:cy,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true},
      text('Output',w*.75,h*.33,w*.25,h*.13,10.5),
      {type:'rect',x:w*.05,y:h*.23,w:w*.68,h:h*.50,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      text('RND',w*.05,h*.25,w*.68,h*.12,11),
      {...text(label,w*.07,h*.37,w*.64,h*.23,28),font:'600 '+Math.min(28*scale,w*.60/Math.max(1,label.length*.72))+'px sans-serif'},
      {...text('',w*.05,h*.61,w*.68,h*.10,11),...this._caption(range,'— … —',w*.68,h*.10,{...style,fontSize:11*scale})},
      text('Every 1 s',w*.05,h*.75,w*.68,h*.08,10)
    ];
    if(state.showIndicators!==false){
      const radius=4*scale;
      children.push({type:'ellipse',x:w*.955-radius,y:cy-radius,w:radius*2,h:radius*2,fill:true,
        fillColor:available?'#2563eb':'#fbbf24',strokeOn:true,color:available?'#f8fafc':'#b45309',size:Math.max(1,scale)});
    }
    if(!available){
      const error=typeof io.error==='string'?io.error:'';
      const note=/range is too wide/i.test(error)?'Integer range is too wide':/bounds must/i.test(error)?'Choose integer bounds with min ≤ max':!error || /^Missing value or binding/.test(error)?'Input required':'Input unavailable';
      children.push({...text(note,w*.04,h*.84,w*.92,h*.13,10.5),color:'#92400e'});
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
