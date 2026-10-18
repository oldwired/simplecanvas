// A 0–60 second/minute countdown with the original red remaining-time dial.
// Commands and scheduled transitions sample wall time; compute and drawing use a settled snapshot.
// Reloads, inactivity, and missed boundaries never replay old tick pulses.
({
  apiVersion:2,
  wakePolicy:'latest',
  settings:{unit:{type:'string',default:'minutes',options:['minutes','seconds'],label:'Unit'},
    duration:{type:'number',default:45,min:0,max:60,step:1,label:'Starting duration'}},
  inputs:{run:{role:'control',type:'boolean',default:false},reset:{role:'control',type:'boolean',default:false}},
  outputs:{tick:{role:'control',type:'boolean'},reached:{role:'control',type:'boolean'}},
  initState(){return {unit:'minutes',duration:45,configuredUnit:'minutes',configuredDuration:45,
    remainingMs:2700000,endsAt:null,observedRun:false,tick:false,showIndicators:true};},
  initStyle(){return {w:234,h:350,fontSize:12,fillColor:'#dc2626',strokeOn:false};},
  _period(unit){return unit==='minutes'?60000:1000;},
  _validate(state){
    if(!['minutes','seconds'].includes(state.unit) || !['minutes','seconds'].includes(state.configuredUnit))throw new Error('Timer unit must be minutes or seconds');
    if([state.duration,state.configuredDuration].some(value=>!Number.isInteger(value) || value<0 || value>60))throw new Error('Timer duration must be a whole number from 0 to 60');
    if(!Number.isSafeInteger(state.remainingMs) || state.remainingMs<0 || state.remainingMs>state.configuredDuration*this._period(state.configuredUnit) ||
       (state.endsAt!==null && !Number.isSafeInteger(state.endsAt)) || typeof state.observedRun!=='boolean' ||
       typeof state.tick!=='boolean' || typeof state.showIndicators!=='boolean')throw new Error('Invalid Timer state');
  },
  _validateInputs(inputs){if(typeof inputs.run!=='boolean' || typeof inputs.reset!=='boolean')throw new Error('Timer run and reset must be Boolean');},
  _now(){const now=Date.now();if(!Number.isSafeInteger(now))throw new Error('Timer requires a valid wall-clock time');return now;},
  _changed(state){return state.unit!==state.configuredUnit || state.duration!==state.configuredDuration;},
  _refill(state,run=state.observedRun){return {...state,configuredUnit:state.unit,configuredDuration:state.duration,
    remainingMs:state.duration*this._period(state.unit),endsAt:null,observedRun:run,tick:false};},
  _snapshot(state){this._validate(state);return this._changed(state)?this._refill(state):state;},
  _remaining(state,wall){return state.endsAt===null?state.remainingMs:Math.min(state.remainingMs,Math.max(0,state.endsAt-wall));},
  _setRunning(state,run,wall){
    if(!run)return {...state,remainingMs:this._remaining(state,wall),endsAt:null,tick:false};
    if(state.endsAt!==null)return state;
    const next=state.remainingMs===0?this._refill(state):state;
    const endsAt=next.remainingMs>0?wall+next.remainingMs:null;
    if(endsAt!==null && !Number.isSafeInteger(endsAt))throw new Error('Timer deadline is outside the numeric range');
    return {...next,endsAt,tick:false};
  },
  transition(inputs,state,memory,context){
    const {now}=context;
    this._validate(state);this._validateInputs(inputs);
    if(!Number.isFinite(now) || now<0)throw new Error('Timer requires a valid monotonic time');
    const wall=this._now(),changed=this._changed(state),fresh=memory==null || (typeof memory==='object' && !Array.isArray(memory) && Object.keys(memory).length===0);
    if(!fresh && (!Number.isSafeInteger(memory.wall) || !Number.isFinite(memory.now) || memory.now<0 ||
       !Number.isSafeInteger(memory.remainingMs) || memory.remainingMs<0 || memory.remainingMs>3600000 ||
       (memory.endsAt!==null && !Number.isSafeInteger(memory.endsAt)) || !['minutes','seconds'].includes(memory.unit) ||
       !Number.isInteger(memory.duration) || memory.duration<0 || memory.duration>60 ||
       (memory.until!==null && (!Number.isFinite(memory.until) || memory.until<=memory.now))))throw new Error('Invalid Timer scheduling memory');
    const restart=fresh || wall<memory.wall || now<memory.now || Math.abs((wall-memory.wall)-(now-memory.now))>500;
    const command=changed || inputs.reset || inputs.run!==state.observedRun;
    // Historical signal changes still apply commands, but scheduled wall-clock ticks wait
    // for the current observation. Keep the original deadline so it remains due then.
    if(context.historical && !fresh && !command){
      let nextWakeAt=memory.until;
      if(state.endsAt!==null){
        const period=this._period(memory.unit),unitRemaining=memory.remainingMs%period||period;
        const wake=memory.now+Math.min(1000,memory.remainingMs,unitRemaining);
        nextWakeAt=nextWakeAt===null?wake:Math.min(nextWakeAt,wake);
      }
      return {state,memory,nextWakeAt};
    }
    let next=this._snapshot(state);
    const priorEnd=next.endsAt;
    if(changed || inputs.reset)next=this._refill(next,inputs.run);
    else{
      next={...next,remainingMs:this._remaining(next,wall)};
      if(next.remainingMs===0)next.endsAt=null;
      if(inputs.run!==state.observedRun)next=this._setRunning(next,inputs.run,wall);
      next.observedRun=inputs.run;
    }
    let tick=false,until=null;
    if(!restart && !command){
      if(state.tick && memory.until!==null){
        // Always show a falling edge before another rise, even after a late wake.
        if(now<memory.until){tick=true;until=memory.until;}
      }else if(priorEnd!==null && memory.endsAt===priorEnd && memory.unit===next.unit && memory.duration===next.duration){
        const period=this._period(next.unit);
        if(Math.ceil(memory.remainingMs/period)-Math.ceil(next.remainingMs/period)===1){tick=true;until=now+100;}
      }
    }
    next={...next,tick};
    let nextWakeAt=until;
    if(next.endsAt!==null){
      const unitRemaining=next.remainingMs%this._period(next.unit)||this._period(next.unit);
      const wake=now+Math.min(1000,next.remainingMs,unitRemaining);
      nextWakeAt=nextWakeAt===null?wake:Math.min(nextWakeAt,wake);
    }
    if(nextWakeAt!==null && (!Number.isFinite(nextWakeAt) || nextWakeAt<=now))throw new Error('Timer wake time is outside the numeric range');
    return {state:next,memory:{wall,now,endsAt:next.endsAt,remainingMs:next.remainingMs,unit:next.unit,duration:next.duration,until},nextWakeAt};
  },
  publish(state){const view=this._snapshot(state);return {tick:view.tick,reached:view.remainingMs===0};},
  compute(inputs,state){this._validateInputs(inputs);const view=this._snapshot(state);return {tick:view.tick,reached:view.remainingMs===0};},
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
  _layout(style,w,h){
    const r=Math.min(w,h)/2,fontSize=style.fontSize||12;
    const labelW=Math.max(0,Math.min(w-4,Math.max(30,fontSize*1.4+14))),labelH=Math.max(0,Math.min(h-4,Math.max(18,fontSize*1.3)));
    const numR=Math.max(0,Math.min(r*.94,r-labelW/2-2,r-labelH/2-2));
    const tickOuter=Math.max(0,numR-labelH/2-4),tickInnerMajor=Math.max(0,tickOuter-Math.max(8,r*.12));
    return {labelW,labelH,numR,tickOuter,tickInnerMajor,tickInnerMinor:Math.max(0,tickOuter-Math.max(4,r*.06)),wedgeR:Math.max(0,tickInnerMajor-6)};
  },
  _dial(style,w,h){
    const scale=Math.min(w/234,h/350),top=22*scale,fontSize=style.fontSize||12;
    const bigPx=Math.floor(Math.min(Math.max(fontSize*2,w*.12),(w-12)/8.6)),showText=bigPx>=6;
    const textH=showText?Math.ceil(bigPx*1.3):0,gap=showText?Math.min(8,h*.02):0;
    const D=Math.max(0,Math.min(w,h-top-textH-gap-64*scale));
    return {scale,top,bigPx,showText,textH,textY:top+D+gap,D,cx:w/2,cy:top+D/2};
  },
  _hand(state,style,w,h){
    const dial=this._dial(style,w,h),layout=this._layout(style,dial.D,dial.D);
    const units=state.remainingMs/this._period(state.unit),angle=(2*Math.PI-(units/60)*2*Math.PI)%(2*Math.PI);
    return {...dial,...layout,angle,x:dial.cx+Math.sin(angle)*layout.wedgeR,y:dial.cy-Math.cos(angle)*layout.wedgeR};
  },
  children(state,style,w,h,editing,io={}){
    let view;try{view=this._snapshot(state);}catch{view=this.initState();}
    const available=!io.error && typeof io.outputs?.tick==='boolean' && typeof io.outputs?.reached==='boolean';
    const d=this._hand(view,style,w,h),{scale,top,D,cx,cy,wedgeR}=d,color=style.textColor||style.color;
    const text=(value,x,y,width,height,size)=>({type:'text',x,y,w:width,h:height,text:value,align:'center',font:'600 '+Math.max(1,size)+'px sans-serif',color,textColor:color,strokeOn:false,fill:false});
    const items=[{...text('',0,0,w,top,16*scale),...this._caption(io.name,'Timer',w,top,{...style,fontSize:16*scale})},
      {type:'ellipse',x:cx-D/2,y:top,w:D,h:D,color:style.color,strokeOn:true,size:Math.max(1,(style.size||2)/2),fill:false}];
    const units=view.remainingMs/this._period(view.unit),sweep=Math.min(units/60*2*Math.PI,2*Math.PI-.0001),angle=(2*Math.PI-sweep)%(2*Math.PI);
    if(available && units>0 && wedgeR>1)items.push({type:'polygon',closed:true,color:style.fillColor,fill:true,fillColor:style.fillColor,strokeOn:false,
      points:[{x:cx,y:cy},{x:cx+wedgeR*Math.sin(angle),y:cy-wedgeR*Math.cos(angle),arcTo:{cx,cy,r:wedgeR,a1:angle,a2:angle+sweep}},{x:cx,y:cy-wedgeR}]});
    const thin=Math.max(1,(style.size||2)/2);
    for(let i=0;i<60;i++){
      const a=i/60*2*Math.PI,major=i%5===0,inner=major?d.tickInnerMajor:d.tickInnerMinor;
      items.push({type:'line',color:style.color,size:major?thin:Math.max(.5,thin*.5),x1:cx+Math.sin(a)*inner,y1:cy-Math.cos(a)*inner,x2:cx+Math.sin(a)*d.tickOuter,y2:cy-Math.cos(a)*d.tickOuter});
    }
    for(let i=0;i<12;i++){
      const a=i/12*2*Math.PI;
      items.push({...text(String((60-i*5)%60),cx+Math.sin(a)*d.numR-d.labelW/2,cy-Math.cos(a)*d.numR-d.labelH/2,d.labelW,d.labelH,style.fontSize||12),font:style.font});
    }
    if(available)items.push({type:'line',x1:cx,y1:cy,x2:d.x,y2:d.y,color:style.color,size:style.size||2});
    if(d.showText){
      const count=Math.ceil(units),unit=view.unit==='minutes'?'Minute':'Second';
      items.push({...text(available?count+' '+unit+(count===1?'':'s')+' left':'Timer unavailable',0,d.textY,w,d.textH,d.bigPx),
        font:String(style.font||'600 12px sans-serif').replace(/\d+(?:\.\d+)?px/,d.bigPx+'px'),
        ...(!available?{color:'#92400e',textColor:'#92400e'}:{})});
    }
    if(view.showIndicators){
      for(const [x,key,label] of [[w*.24,'tick','Tick'],[w*.67,'reached','0 reached']]){
        const y=h-54*scale,r=3*scale;
        items.push({type:'ellipse',x:x-r,y:y-r,w:r*2,h:r*2,fill:true,fillColor:available?(io.outputs[key]?'#15803d':'#94a3b8'):'#fbbf24',strokeOn:false},
          text(label,x+6*scale,y-7*scale,w*.29,14*scale,9*scale));
      }
    }
    if(editing && available){
      const label=io.inputs?.reset?'Reset held':view.endsAt!==null?'Pause':view.remainingMs===0?'Restart':'Start';
      for(const [x,caption] of [[0,label],[w/2,'Reset']])items.push({type:'rect',x:x+2*scale,y:h-43*scale,w:Math.max(0,w/2-4*scale),h:24*scale,
        color:style.color,size:Math.max(.5,scale),strokeOn:true,fill:false},text(caption,x,h-43*scale,w/2,24*scale,12*scale));
      items.push({type:'rect',x:0,y:h-14*scale,w,h:14*scale,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly:true},
        {...text('Indicators: '+(view.showIndicators?'on':'off'),0,h-14*scale,w,14*scale,9*scale),editorOnly:true});
    }
    return items;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,outputs:{}});},
  handles(state,w,h,style={},io={}){
    const d=this._hand(this._snapshot(state),style,w,h),scale=d.scale;
    return [...(io.inputs?.reset?[]:[{id:'hand',x:d.x,y:d.y},{id:'toggle',x:w/4,y:h-31*scale,kind:'click'}]),
      {id:'reset',x:w*.75,y:h-31*scale,kind:'click'},{id:'indicators',x:w/2,y:h-7*scale,kind:'click',editorOnly:true}];
  },
  hitEdit(state,x,y,w,h,style={},io={}){
    const d=this._hand(this._snapshot(state),style,w,h),scale=d.scale;
    if(x<0 || x>w)return null;
    if(y>=h-14*scale && y<=h)return 'indicators';
    if(y>=h-43*scale && y<=h-19*scale)return x<w/2?(io.inputs?.reset?null:'toggle'):'reset';
    return !io.inputs?.reset && Math.hypot(x-d.x,y-d.y)<14?'hand':null;
  },
  dragEdit(state,handle,x,y,w,h,style={},io={}){
    let next=this._snapshot(state);
    const run=typeof io.inputs?.run==='boolean'?io.inputs.run:next.observedRun;
    if(handle==='indicators')return {state:{...next,showIndicators:!next.showIndicators}};
    if(handle==='reset')return {state:this._refill(next,run)};
    if(io.inputs?.reset)return {state:next};
    if(handle==='toggle')return {state:{...this._setRunning(next,next.endsAt===null,this._now()),observedRun:run}};
    if(handle==='hand'){
      const {cx,cy}=this._dial(style,w,h);let angle=Math.atan2(x-cx,-(y-cy));if(angle<0)angle+=2*Math.PI;
      const duration=Math.round(((2*Math.PI-angle)%(2*Math.PI))/(2*Math.PI)*60)%60;
      next=this._refill({...next,duration},run);
    }
    return {state:next};
  }
})
