// Run input changes and the on-canvas buttons start/resume or pause this stopwatch.
// Only pause publishes the accumulated seconds (including milliseconds); reset clears and stops.
// The display uses saved wall-clock timestamps, so a running stopwatch continues across tabs and reloads.
({
  apiVersion:2,
  wakePolicy:'latest',
  inputs:{run:{type:'boolean',default:false},reset:{type:'boolean',default:false}},
  outputs:{elapsed:{type:'number'}},
  initState(){return {elapsedMs:0,startedAt:null,observedRun:false};},
  initStyle(){return {w:300,h:160,fontSize:24,strokeOn:false};},
  _validate(state){
    if(!Number.isSafeInteger(state.elapsedMs) || state.elapsedMs<0 ||
       (state.startedAt!==null && !Number.isSafeInteger(state.startedAt)) || typeof state.observedRun!=='boolean')throw new Error('Invalid Stopwatch state');
  },
  _validateInputs(inputs){
    if(typeof inputs.run!=='boolean' || typeof inputs.reset!=='boolean')throw new Error('Stopwatch run and reset must be Boolean');
  },
  _now(){
    const now=Date.now();
    if(!Number.isSafeInteger(now))throw new Error('Stopwatch requires a valid wall-clock time');
    return now;
  },
  _running(state){return state.startedAt!==null;},
  _elapsed(state){
    const elapsed=state.elapsedMs+(this._running(state)?Math.max(0,this._now()-state.startedAt):0);
    if(!Number.isSafeInteger(elapsed) || elapsed<0)throw new Error('Stopwatch elapsed time is outside the numeric range');
    return elapsed;
  },
  _setRunning(state,run){
    if(run===this._running(state))return state;
    return run?{...state,startedAt:this._now()}:{...state,elapsedMs:this._elapsed(state),startedAt:null};
  },
  transition(inputs,state,memory,context){
    this._validate(state);this._validateInputs(inputs);
    // Remember the input level in saved state: reopening must not undo a manual override.
    let next=inputs.reset?{...state,elapsedMs:0,startedAt:null}:inputs.run!==state.observedRun?this._setRunning(state,inputs.run):state;
    next={...next,observedRun:inputs.run};
    return {state:next,memory:{},nextWakeAt:null};
  },
  publish(state){this._validate(state);return {elapsed:state.elapsedMs/1000};},
  compute(inputs,state){
    this._validate(state);this._validateInputs(inputs);
    return {elapsed:state.elapsedMs/1000};
  },
  refreshMs(state){return this._running(state)?100:0;},
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
    const available=!io.error && typeof io.inputs?.run==='boolean' && typeof io.inputs?.reset==='boolean' && Number.isFinite(io.outputs?.elapsed);
    const scale=Math.min(w/300,h/160),color=style.textColor||style.color;
    const text=(value,y,height,size)=>({type:'text',x:0,y,w,h:height,text:value,align:'center',
      font:'600 '+Math.max(6,size*scale)+'px sans-serif',color,textColor:color,strokeOn:false,fill:false});
    const caption=(label,fallback,y,height,size)=>({...text('',y,height,size),...this._caption(label,fallback,w,height,{...style,fontSize:size*scale})});
    const running=available && this._running(state),reset=io.inputs?.reset===true;
    let reading='--:--:--.---';
    if(available){
      const elapsed=this._elapsed(state),seconds=Math.floor(elapsed/1000),pad=n=>String(n).padStart(2,'0');
      reading=pad(Math.floor(seconds/3600))+':'+pad(Math.floor(seconds/60)%60)+':'+pad(seconds%60)+'.'+String(elapsed%1000).padStart(3,'0');
    }
    const status=available?(reset?'Reset held':running?'Running':'Stopped')+' · result: '+io.outputs.elapsed.toFixed(3)+' s':'Stopwatch unavailable';
    const items=[
      {type:'rect',x:0,y:0,w,h,color:style.color,size:style.size,strokeOn:style.strokeOn,fill:style.fill,fillColor:style.fillColor},
      caption(io.name,'Stopwatch',0,h*.18,18),
      caption(reading,reading,h*.24,h*.32,style.fontSize||24),
      {...caption(status,status,h*.58,h*.16,11),...(!available?{color:'#92400e',textColor:'#92400e'}:{})}
    ];
    if(editing && available){
      for(const [x,label] of [[0,reset?'Reset held':running?'Pause':'Start'],[w/2,'Reset']]){
        items.push({type:'rect',x:x+2,y:h*.76,w:Math.max(1,w/2-4),h:h*.22,
          color:style.color,size:Math.max(1,scale),strokeOn:true,fill:false},
          {...text(label,h*.76,h*.22,14),x,w:w/2});
      }
    }
    return items;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,outputs:{}});},
  handles(state,w,h,style,io={}){
    return [...(io.inputs?.reset===true?[]:[{id:'toggle',x:w/4,y:h*.86,kind:'click'}]),{id:'reset',x:w*.75,y:h*.86,kind:'click'}];
  },
  hitEdit(state,lx,ly,w,h,style,io={}){
    if(ly<h*.76 || ly>h*.98 || lx<0 || lx>w)return null;
    return lx<w/2?(io.inputs?.reset===true?null:'toggle'):'reset';
  },
  dragEdit(state,handle,lx,ly,w,h,style,io={}){
    this._validate(state);
    if(handle==='reset')return {state:{...state,elapsedMs:0,startedAt:null}};
    return {state:handle==='toggle' && io.inputs?.reset!==true?this._setRunning(state,!this._running(state)):state};
  }
})
