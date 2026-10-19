// Each accepted entry queues its value and one submitted pulse, including unchanged entries.
// The bounded inbox survives Pause; a fresh runtime retains the latest value without replaying it.
// A 10 ms arming gap lets connected Clear signals settle before the first queued pulse.
({
  apiVersion:2,
  wakePolicy:'latest',
  settings:{maxLength:{type:'number',default:2000,min:1,max:2000,step:1,label:'Maximum length (UTF-16 units)'},required:{type:'boolean',default:false,label:'Required'},placeholder:{type:'string',default:'',label:'Placeholder'},showSubmitted:{type:'boolean',default:false,label:'Show submission state'},showHints:{type:'boolean',default:false,label:'Show hints'}},
  inputs:{clear:{role:'control',type:'boolean',default:false}},
  outputs:{value:{type:'string'},submitted:{role:'control',type:'boolean'}},
  initState(){return {values:[''],current:0,pending:[],submitted:false,press:0,entryRuntime:'',showSubmitted:false,showHints:false,maxLength:2000,required:false,placeholder:''};},
  initStyle(){return {w:320,h:72,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  _value(value){if(typeof value!=='string' || value.length>2000)throw new Error('Text must contain at most 2000 characters'); return value;},
  _config(state){if(!Number.isSafeInteger(state.maxLength) || state.maxLength<1 || state.maxLength>2000 || typeof state.required!=='boolean' || typeof state.placeholder!=='string' || state.placeholder.length>120 || /[\r\n]/.test(state.placeholder))throw new Error('Choose a length from 1 to 2000 and a single-line placeholder of at most 120 characters');},
  _state(state){
    this._config(state);
    if(!Array.isArray(state.values) || !state.values.length || state.values.length>65 ||
       !Number.isSafeInteger(state.current) || state.current<0 || state.current>=state.values.length ||
       !Array.isArray(state.pending) || state.pending.length>64 ||
       state.pending.some(index=>!Number.isSafeInteger(index) || index<0 || index>=state.values.length) ||
       typeof state.submitted!=='boolean' || !Number.isSafeInteger(state.press) || state.press<0 ||
       (state.entryRuntime!==undefined && (typeof state.entryRuntime!=='string' || state.entryRuntime.length>128)))throw new Error('Invalid stored input state');
    state.values.forEach(value=>this._value(value));
    if(JSON.stringify(state.values).length>3200 || JSON.stringify(state).length>4000)throw new Error('Stored input text is too large');
  },
  _latest(state){return state.values[state.pending.length?state.pending[state.pending.length-1]:state.current];},
  _compact(state){
    const used=[...new Set([state.current,...state.pending])],values=used.map(index=>state.values[index]);
    return {...state,values,current:used.indexOf(state.current),pending:state.pending.map(index=>used.indexOf(index))};
  },
  _entry(value,state){
    this._value(value);if(value.length>state.maxLength)throw new Error('Text exceeds the configured maximum length');
    if(state.required && !value.trim())throw new Error('Enter a value');
    if(/[\r\n]/.test(value))throw new Error('Enter a single line of text');
    return value;
  },
  publish(state){
    this._state(state);
    return {value:state.submitted?state.values[state.current]:this._latest(state),submitted:state.submitted};
  },
  compute(inputs,state){return this.publish(state);},
  transition(inputs,state,memory,context){
    this._state(state);
    const now=context.now,clear=inputs.clear===undefined?false:inputs.clear;
    if(typeof clear!=='boolean')throw new Error('Clear trigger must be Boolean');
    if(!Number.isFinite(now) || now<0)throw new Error('Input requires a valid monotonic time');
    if(memory?.primed!==true){
      const runtimeId=typeof context.runtimeId==='string'?context.runtimeId:'';
      if(!runtimeId || state.entryRuntime!==runtimeId){
        return {state:{...state,values:[this._latest(state)],current:0,pending:[],submitted:false,entryRuntime:runtimeId},
          memory:{primed:true,phase:'idle',nextAt:null,clear},nextWakeAt:null};
      }
      // A first entry accepted while paused belongs to this runtime, so Step may emit it.
      state={...state,submitted:false};memory={primed:true,phase:'idle',nextAt:null,clear};
    }
    if(!['idle','high','low'].includes(memory.phase) || (memory.phase!=='idle' && (!Number.isFinite(memory.nextAt) || memory.nextAt<0)))throw new Error('Invalid input scheduling memory');
    // Clear wins over the queue, but an initially high signal only establishes its baseline.
    if(memory.clear===false && clear){
      return {state:{...state,values:[''],current:0,pending:[],submitted:false},
        memory:{primed:true,phase:'idle',nextAt:null,clear},nextWakeAt:null};
    }
    let phase=memory.phase,nextAt=memory.nextAt,current=state.current,pending=state.pending.slice();
    // One phase per round gives every accepted entry its own rising edge and matching value.
    if(phase==='high' && !context.historical && now>=nextAt){phase='low';nextAt=now+10;}
    else if(phase==='idle' && pending.length){phase='low';nextAt=now+10;}
    else if(phase==='low' && !context.historical && now>=nextAt && pending.length){
      current=pending.shift();phase='high';nextAt=now+100;
    }else if(phase==='low' && !context.historical && now>=nextAt){phase='idle';nextAt=null;}
    if(nextAt!==null && !Number.isFinite(nextAt))throw new Error('Input wake time is outside the numeric range');
    const next=this._compact({...state,current:phase!=='high' && pending.length?pending[0]:current,pending,submitted:phase==='high'});this._state(next);
    return {state:next,memory:{primed:true,phase,nextAt,clear},nextWakeAt:nextAt};
  },
  // Preview boundaries follow visible characters. Without Segmenter, keep the text whole.
  _graphemes(value){
    const text=String(value);
    return typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'
      ?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>part.segment)
      :text?[text]:[];
  },
  _caption(name,fallback,w,h,style){
    const label=(typeof name==='string'?name:'').trim().replace(/\s+/g,' ')||fallback;
    const units=text=>this._graphemes(text).reduce((n,c)=>n+(/[MWmw@#%]/.test(c)||c.codePointAt(0)>255?1.1:/[A-Z]/.test(c)?.88:.72),0);
    const width=Math.max(1,w-16),base=Math.min(style.fontSize||20,h*.7);
    let size=Math.min(base,width/Math.max(1,units(label))),lines=[label];
    if(size<Math.min(12,base)){
      size=Math.min(base,12,Math.max(1,h-2)/2.4,width/1.1);lines=[];let rest=label;
      for(let row=0;row<2 && rest;row++){
        let line='';for(const c of this._graphemes(rest)){if(line && units(line+c)*size>width)break;line+=c;}
        if(line.length<rest.length && line.lastIndexOf(' ')>0)line=line.slice(0,line.lastIndexOf(' '));
        rest=rest.slice(line.length).trim();
        if(row===1 && rest){while(line && units(line+'…')*size>width)line=this._graphemes(line).slice(0,-1).join('');line+='…';}
        lines.push(line);
      }
    }
    return {text:lines.join('\n'),font:(style.font||'600 20px sans-serif').replace(/\d+(?:\.\d+)?px/,size+'px')};
  },
  _preview(value,width,size){
    const chars=this._graphemes(value),unit=c=>/[MWmw@#%]/.test(c)||c.codePointAt(0)>255?1.1:/[A-Z]/.test(c)?.88:.72;
    const room=Math.max(1,width)/size;if(chars.reduce((used,c)=>used+unit(c),0)<=room)return value;
    let result='',used=.9;for(const c of chars){if(used+unit(c)>room)break;result+=c;used+=unit(c);}return result+'…';
  },
  _field(state,w,h,style={}){
    const scale=Math.min(w/320,h/72),footer=state.showSubmitted===true || state.showHints===true?14*scale:0;
    const y=24*scale,height=Math.max(1,h-y-footer);
    return {x:0,y,w,h:height,fontSize:Math.max(5,Math.min(style.fontSize||18,height*.55))};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/320,h/72),field=this._field(state,w,h,style),font=(size,weight=400)=>(style.font||weight+' '+size+'px sans-serif').replace(/\d+(?:\.\d+)?px/,size+'px');
    const text=(value,x,y,width,height,size,align='left')=>({type:'text',x,y,w:width,h:height,text:value,plainText:true,align,font:font(size),color:style.textColor||style.color,strokeOn:false,fill:false});
    let available=false,value;try{this._state(state);value=this._latest(state);available=!io.error;}catch{}
    const label=available?value || state.placeholder || (state.showHints===true?'Enter text':''):'Input unavailable',inset=Math.min(10*scale,field.w*.08);
    const children=[
      {...text('',0,0,w,20*scale,13*scale),...this._caption(io.name,'Text input',w,20*scale,{...style,fontSize:13*scale})},
      {type:'rect',x:field.x,y:field.y,w:field.w,h:field.h,fill:true,fillColor:style.fillColor||'#ffffff',strokeOn:true,color:style.color||'#94a3b8',size:style.size||1.5},
      {...text(this._preview(label,Math.max(1,field.w-inset*2),field.fontSize),field.x+inset,field.y+(field.h-field.fontSize*1.35)/2,Math.max(1,field.w-inset*2),field.fontSize*1.35,field.fontSize),color:available?available && !value?'#64748b':style.textColor||style.color:'#92400e'}
    ];
    if(state.showHints===true || state.showSubmitted===true){
      const hint=state.showHints===true?'Enter to submit':'',status=state.showSubmitted===true?'Submitted: '+(available?String(io.outputs?.submitted===true):'—'):'';
      children.push(text([hint,status].filter(Boolean).join(' · '),0,h-12*scale,w,12*scale,9*scale));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,error:io.error||'Input unavailable',outputs:{}});},
  handles(state,w,h,style={}){
    this._state(state);const inline=this._field(state,w,h,style);
    return [{id:'entry',x:inline.x+inline.w/2,y:inline.y+inline.h/2,kind:'text',value:this._latest(state),maxLength:state.maxLength,required:state.required,placeholder:state.placeholder,inline}];
  },
  hitEdit(state,x,y,w,h){const field=this._field(state,w,h);return x>=field.x && x<=field.x+field.w && y>=field.y && y<=field.y+field.h?'entry':null;},
  dragEdit(state,handle,value,ly,w,h,style,io={}){
    this._state(state);if(handle!=='entry')return {state};
    value=this._entry(value,state);
    const runtimeId=typeof io.runtimeId==='string'?io.runtimeId:'';
    if(runtimeId && state.entryRuntime!==runtimeId){
      // Reopened/copied inboxes are old actions; keep their latest value, then accept this new one.
      state={...state,values:[this._latest(state)],current:0,pending:[],submitted:false,entryRuntime:runtimeId};
    }
    if(state.pending.length>=64)throw new Error('Submission queue is full; wait for pending submissions');
    const values=state.values.slice(),pending=state.pending.slice();
    let index=values.indexOf(value);if(index<0){index=values.length;values.push(value);}pending.push(index);
    const next=this._compact({...state,values,current:state.submitted?state.current:pending[0],pending,press:state.press===Number.MAX_SAFE_INTEGER?0:state.press+1});
    if(JSON.stringify(next.values).length>3200 || JSON.stringify(next).length>4000)throw new Error('Submission text is too large; shorten it or wait for pending submissions');
    this._state(next);return {state:next};
  }
})
