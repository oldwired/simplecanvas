// Each completed press queues a 100 ms pulse, separated by at least 10 ms low.
// Saved press tokens are primed on a fresh runtime, so reload/copy/undo never replays them.
({
  apiVersion:2,
  wakePolicy:'latest',
  inputs:{},
  outputs:{value:{role:'control',type:'boolean'}},
  initState(){return {value:false,press:0,showIndicators:true};},
  initStyle(){return {w:280,h:190,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _validate(state){
    if(typeof state.value!=='boolean' || !Number.isSafeInteger(state.press) || state.press<0)throw new Error('Trigger state must contain a Boolean output and nonnegative safe integer press token');
  },
  transition(inputs,state,memory,context){
    this._validate(state);
    const now=context.now;
    if(!Number.isFinite(now) || now<0)throw new Error('Trigger requires a valid monotonic time');
    if(!Number.isSafeInteger(memory?.press)){
      return {state:{...state,value:false},memory:{press:state.press,pending:0,phase:'idle',nextAt:null},nextWakeAt:null};
    }
    if(memory.press<0 || !Number.isSafeInteger(memory.pending) || memory.pending<0 || memory.pending>64 ||
       !['idle','high','low'].includes(memory.phase) || (memory.phase!=='idle' && (!Number.isFinite(memory.nextAt) || memory.nextAt<0)))throw new Error('Invalid Trigger scheduling memory');
    const presses=state.press>=memory.press?state.press-memory.press:(Number.MAX_SAFE_INTEGER-memory.press)+1+state.press;
    if(presses>64-memory.pending)throw new Error('Trigger queue is full (64 pending pulses)');
    let pending=memory.pending+presses,phase=memory.phase,nextAt=memory.nextAt;
    // Emit only one phase per evaluation so downstream counters observe every rising edge.
    if(phase==='high' && !context.historical && now>=nextAt){phase='low';nextAt=now+10;}
    else if((phase==='idle' || (phase==='low' && !context.historical && now>=nextAt)) && pending){
      pending--;phase='high';nextAt=now+100;
    }else if(phase==='low' && !context.historical && now>=nextAt){phase='idle';nextAt=null;}
    if(nextAt!==null && !Number.isFinite(nextAt))throw new Error('Trigger wake time is outside the numeric range');
    return {state:{...state,value:phase==='high'},memory:{press:state.press,pending,phase,nextAt},nextWakeAt:nextAt};
  },
  publish(state){this._validate(state);return {value:state.value};},
  compute(inputs,state){this._validate(state);return {value:state.value};},
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
    const output=!io.error && typeof io.outputs?.value==='boolean'?io.outputs.value:undefined,available=typeof output==='boolean';
    const scale=Math.min(w/280,h/190),font=size=>'600 '+Math.max(6,size*scale)+'px sans-serif';
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor||style.color,strokeOn:false,fill:false});
    const cy=h*.49;
    const children=[
      {...text('',w*.04,0,w*.92,h*.18,16,'left'),...this._caption(io.name,'Trigger',w*.92,h*.18,{...style,fontSize:16*scale})},
      {type:'line',x1:w*.70,y1:cy,x2:w*.98,y2:cy,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true},
      text('Output: '+(available?String(output):'—'),w*.73,h*.33,w*.27,h*.13,10),
      {type:'rect',x:w*.06,y:h*.25,w:w*.64,h:h*.48,fill:style.fill,fillColor:output===true?'#dcfce7':style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      {type:'polygon',closed:false,fill:false,strokeOn:true,color:output===true?'#15803d':style.color,size:Math.max(1,2*scale),
        points:[{x:w*.20,y:h*.44},{x:w*.30,y:h*.44},{x:w*.30,y:h*.33},{x:w*.45,y:h*.33},{x:w*.45,y:h*.44},{x:w*.55,y:h*.44}]},
      text('Press',w*.06,h*.50,w*.64,h*.16,18),
      text('100 ms',w*.06,h*.75,w*.64,h*.08,10)
    ];
    if(state.showIndicators!==false){
      const radius=4*scale;
      children.push({type:'ellipse',x:w*.955-radius,y:cy-radius,w:radius*2,h:radius*2,fill:true,
        fillColor:available?(output?'#15803d':'#64748b'):'#fbbf24',strokeOn:true,color:available?'#f8fafc':'#b45309',size:Math.max(1,scale)});
    }
    if(!available){
      const note=/queue is full/i.test(io.error||'')?'Trigger queue full (64 pulses)':'Trigger unavailable';
      children.push({...text(note,w*.04,h*.84,w*.92,h*.13,10.5),color:'#92400e'});
    }
    if(editing && available){
      children.push({type:'rect',x:w*.05,y:h*.84,w:w*.9,h:h*.13,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly:true});
      children.push({...text('Indicators: '+(state.showIndicators!==false?'on':'off'),w*.05,h*.84,w*.9,h*.13,10.5),editorOnly:true});
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,inputs:{},outputs:{}});},
  handles(state,w,h){return [{id:'trigger',x:w*.38,y:h*.49,kind:'click'},{id:'indicators',x:w/2,y:h*.905,kind:'click',editorOnly:true}];},
  hitEdit(state,x,y,w,h){
    if(x>=w*.06 && x<=w*.70 && y>=h*.25 && y<=h*.73)return 'trigger';
    return x>=w*.05 && x<=w*.95 && y>=h*.84 && y<=h*.97?'indicators':null;
  },
  dragEdit(state,handle){
    this._validate(state);
    return {state:handle==='trigger'?{...state,press:state.press===Number.MAX_SAFE_INTEGER?0:state.press+1}:
      handle==='indicators'?{...state,showIndicators:state.showIndicators===false}:state};
  }
})
