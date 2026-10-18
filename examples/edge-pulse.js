// Emit a timed pulse for each qualifying observed edge; the initial level never triggers.
// Queue up to 64 waiting pulses, with at least 10 ms low between them. Timing changes re-prime.
({
  apiVersion:2,
  wakePolicy:'latest',
  inputs:{value:{type:'boolean'},edge:{role:'control',type:'string',default:'rising',options:['rising','falling','either']},seconds:{role:'control',type:'number',default:0.1}},
  outputs:{value:{role:'control',type:'boolean'}},
  initState(){return {value:false,showIndicators:true};},
  initStyle(){return {w:300,h:180,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _validate(inputs,state){
    if(typeof inputs.value!=='boolean')throw new Error('Edge pulse requires a Boolean input');
    if(!['rising','falling','either'].includes(inputs.edge))throw new Error('Edge must be rising, falling, or either');
    if(!Number.isFinite(inputs.seconds) || inputs.seconds<0.01 || inputs.seconds>3600)throw new Error('Edge pulse seconds must be between 0.01 and 3600');
    if(typeof state.value!=='boolean')throw new Error('Edge pulse state must contain a Boolean output');
  },
  transition(inputs,state,memory,context){
    this._validate(inputs,state);
    const now=context.now;
    if(!Number.isFinite(now) || now<0)throw new Error('Edge pulse requires a valid monotonic time');
    const fresh=memory==null || (typeof memory==='object' && !Array.isArray(memory) && Object.keys(memory).length===0);
    if(!fresh && (typeof memory.previous!=='boolean' || !Number.isFinite(memory.seconds) || !['rising','falling','either'].includes(memory.edge) ||
       !Number.isSafeInteger(memory.pending) || memory.pending<0 || memory.pending>64 || !['idle','high','low'].includes(memory.phase) || (memory.phase==='idle' && memory.pending!==0) ||
       (memory.phase==='idle'?memory.nextAt!==null:!Number.isFinite(memory.nextAt) || memory.nextAt<0)))throw new Error('Invalid Edge pulse scheduling memory');
    if(fresh || memory.seconds!==inputs.seconds || memory.edge!==inputs.edge){
      return {state:{...state,value:false},memory:{previous:inputs.value,seconds:inputs.seconds,edge:inputs.edge,pending:0,phase:'idle',nextAt:null},nextWakeAt:null};
    }
    const qualifies=inputs.value!==memory.previous && (inputs.edge==='either' || (inputs.edge==='rising'?inputs.value:!inputs.value));
    let pending=memory.pending,phase=memory.phase,nextAt=memory.nextAt;
    if(qualifies){
      if(pending>=64)throw new Error('Edge pulse queue is full (64 pending pulses)');
      pending++;
    }
    // Every evaluation changes at most one phase so consumers observe each pulse separately.
    if(phase==='high' && !context.historical && now>=nextAt){phase='low';nextAt=now+10;}
    else if((phase==='idle' || (phase==='low' && !context.historical && now>=nextAt)) && pending){
      pending--;phase='high';nextAt=now+inputs.seconds*1000;
    }else if(phase==='low' && !context.historical && now>=nextAt){phase='idle';nextAt=null;}
    if(nextAt!==null && (!Number.isFinite(nextAt) || (!context.historical && nextAt<=now)))throw new Error('Edge pulse wake time is outside the numeric range');
    return {state:{...state,value:phase==='high'},memory:{previous:inputs.value,seconds:inputs.seconds,edge:inputs.edge,pending,phase,nextAt},nextWakeAt:nextAt};
  },
  publish(state){if(typeof state.value!=='boolean')throw new Error('Output state must contain a Boolean value');return {value:state.value};},
  compute(inputs,state){this._validate(inputs,state);return {value:state.value};},
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
    const raw=io.inputs||{},rawOutput=io.outputs?.value,scale=Math.min(w/300,h/180);
    const available=!io.error && typeof raw.value==='boolean' && Number.isFinite(raw.seconds) && ['rising','falling','either'].includes(raw.edge) && typeof rawOutput==='boolean';
    const inputs=available?raw:{},output=available?rawOutput:undefined,cy=h*.49;
    const font=size=>'600 '+Math.max(6,size*scale)+'px sans-serif';
    const label=value=>typeof value==='boolean'?String(value):'—';
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor||style.color,strokeOn:false,fill:false});
    const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true});
    const symbol=available?{rising:'↑',falling:'↓',either:'↕'}[inputs.edge]:'↕';
    const seconds=this._number(inputs.seconds);
    const children=[
      {...text('',w*.04,0,w*.92,h*.18,16,'left'),...this._caption(io.name,'Edge pulse',w*.92,h*.18,{...style,fontSize:16*scale})},
      line(w*.02,cy,w*.30,cy),line(w*.69,cy,w*.98,cy),
      text('Input: '+label(inputs.value),0,h*.33,w*.29,h*.13,10.5),text('Output: '+label(output),w*.72,h*.33,w*.28,h*.13,10),
      {type:'rect',x:w*.30,y:h*.25,w:w*.39,h:h*.48,fill:style.fill,fillColor:output===true?'#dcfce7':style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      text(symbol,w*.32,h*.29,w*.12,h*.29,29),
      {type:'polygon',closed:false,fill:false,strokeOn:true,color:output===true?'#15803d':style.color,size:Math.max(1,2*scale),
        points:[{x:w*.45,y:h*.50},{x:w*.49,y:h*.50},{x:w*.49,y:h*.35},{x:w*.58,y:h*.35},{x:w*.58,y:h*.50},{x:w*.64,y:h*.50}]},
      {...text('',w*.30,h*.58,w*.39,h*.11,11),...this._caption(seconds+' s','— s',w*.39,h*.11,{...style,fontSize:11*scale})}
    ];
    if(state.showIndicators!==false){
      const radius=4*scale;
      for(const [x,value] of [[w*.045,inputs.value],[w*.955,output]]){
        const present=typeof value==='boolean';
        children.push({type:'ellipse',x:x-radius,y:cy-radius,w:radius*2,h:radius*2,fill:true,
          fillColor:present?(value?'#15803d':'#64748b'):'#fbbf24',strokeOn:true,color:present?'#f8fafc':'#b45309',size:Math.max(1,scale)});
      }
    }
    if(!available){
      const error=typeof io.error==='string'?io.error:'';
      const note=/queue is full/i.test(error)?'Edge pulse queue full (64 pulses)':/seconds must/i.test(error)?'Seconds must be between 0.01 and 3600':!error || /^Missing value or binding/.test(error)?'Input required':'Input unavailable';
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
