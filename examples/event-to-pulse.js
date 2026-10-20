// Each received occurrence queues a 100 ms pulse with at least 10 ms low between.
// Payload values (including false, empty text, and null) never suppress an occurrence.
// A fresh runtime drops old pulses; events accepted in this runtime while paused survive.
({
  apiVersion:2,
  eventApi:1,
  wakePolicy:'latest',
  settings:{showHints:{type:'boolean',default:true,label:'Show hints'}},
  inputs:{},
  eventInputs:{receive:{types:['none','boolean','number','string'],label:'Receive event'}},
  outputs:{value:{role:'control',type:'boolean'}},
  initState(){return {value:false,press:0,queued:0,eventRuntime:'',showHints:true};},
  initStyle(){return {w:280,h:116,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  _validate(state){
    if(typeof state.value!=='boolean' || !Number.isSafeInteger(state.press) || state.press<0 || !Number.isSafeInteger(state.queued) || state.queued<0 || state.queued>64 ||
       state.eventRuntime!==undefined && (typeof state.eventRuntime!=='string' || state.eventRuntime.length>128))
      throw new Error('Event pulse requires a Boolean output and a nonnegative event token');
  },
  onEvent(name,payload,state,io={}){
    this._validate(state);
    if(name!=='receive')throw new Error('Unknown event input');
    if(payload!==null && !['boolean','number','string'].includes(typeof payload) ||
       typeof payload==='number' && !Number.isFinite(payload) ||
       typeof payload==='string' && payload.length>2000)throw new Error('Unsupported event payload');
    const runtimeId=typeof io.runtimeId==='string'?io.runtimeId:'';
    if(runtimeId && state.eventRuntime!==runtimeId)state={...state,value:false,queued:0,eventRuntime:runtimeId};
    if(state.queued>=64)throw new Error('Event pulse queue is full (64 pending pulses)');
    return {state:{...state,press:state.press===Number.MAX_SAFE_INTEGER?0:state.press+1,queued:state.queued+1}};
  },
  transition(inputs,state,memory,context){
    this._validate(state);
    const now=context.now;
    if(!Number.isFinite(now) || now<0)throw new Error('Event pulse requires a valid monotonic time');
    if(!Number.isSafeInteger(memory?.press)){
      const runtimeId=typeof context.runtimeId==='string'?context.runtimeId:'';
      const pending=runtimeId && state.eventRuntime===runtimeId?state.queued:0;
      // Keep one low observation before a first pulse so freshly attached counters can prime.
      const nextAt=pending?now+10:null;
      return {state:{...state,value:false,queued:pending,eventRuntime:runtimeId},
        memory:{press:state.press,pending,phase:pending?'low':'idle',nextAt},nextWakeAt:nextAt};
    }
    if(memory.press<0 || !Number.isSafeInteger(memory.pending) || memory.pending<0 || memory.pending>64 ||
       !['idle','high','low'].includes(memory.phase) || (memory.phase!=='idle' && (!Number.isFinite(memory.nextAt) || memory.nextAt<0)))
      throw new Error('Invalid event pulse scheduling memory');
    const occurrences=state.press>=memory.press?state.press-memory.press:(Number.MAX_SAFE_INTEGER-memory.press)+1+state.press;
    if(occurrences>64-memory.pending)throw new Error('Event pulse queue is full (64 pending pulses)');
    let pending=memory.pending+occurrences,phase=memory.phase,nextAt=memory.nextAt;
    // One phase per evaluation keeps adjacent occurrences as separate rising edges.
    if(phase==='high' && !context.historical && now>=nextAt){phase='low';nextAt=now+10;}
    else if((phase==='idle' || (phase==='low' && !context.historical && now>=nextAt)) && pending){
      pending--;phase='high';nextAt=now+100;
    }else if(phase==='low' && !context.historical && now>=nextAt){phase='idle';nextAt=null;}
    if(nextAt!==null && !Number.isFinite(nextAt))throw new Error('Event pulse wake time is outside the numeric range');
    return {state:{...state,value:phase==='high',queued:pending},memory:{press:state.press,pending,phase,nextAt},nextWakeAt:nextAt};
  },
  publish(state){this._validate(state);return {value:state.value};},
  compute(inputs,state){return this.publish(state);},
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400){
    const text=String(value).replace(/\s+/g,' '),limit=Math.max(1,Math.floor(w/(size*.7)));
    const chars=typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'
      ?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>part.segment):text?[text]:[];
    return {type:'text',x,y,w,h,text:chars.length>limit?chars.slice(0,Math.max(0,limit-1)).join('')+'…':text,
      plainText:true,align:'left',font:weight+' '+size+'px sans-serif',color,strokeOn:false};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/280,h/116),pad=12*scale,name=(io.name||'').trim()||'Event → pulse';
    const value=io.error?null:io.outputs?.value,available=typeof value==='boolean';
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,18*scale,13*scale,style,style.textColor||'#334155',600),
      {type:'ellipse',x:pad,y:46*scale,w:14*scale,h:14*scale,fill:true,fillColor:available?(value?'#15803d':'#64748b'):'#fbbf24',strokeOn:false},
      this._text(io.error||(!available?'Input unavailable':value?'Pulse high':'Ready'),pad+23*scale,39*scale,w-pad*2-23*scale,28*scale,io.error?12*scale:19*scale,style,io.error?'#92400e':style.textColor||'#334155',600)];
    if(state.showHints!==false)children.push(this._text('100 ms high · 10 ms gap · queued',pad,83*scale,w-pad*2,19*scale,11*scale,style,'#64748b'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
