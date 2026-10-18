// Wall-clock readings and nominal 100 ms boundary pulses in a selected timezone.
// Reopening, changing timezone, and missed/adjusted clock time re-prime without replaying ticks.
// The host schedules transitions; compute and image exports use the last settled snapshot.
({
  apiVersion:2,
  wakePolicy:'latest',
  inputs:{timezone:{role:'control',type:'string',default:'local'}},
  outputs:{second:{role:'control',type:'boolean'},minute:{role:'control',type:'boolean'},hour:{role:'control',type:'boolean'},halfDay:{role:'control',type:'boolean'},time:{type:'string'}},
  initState(){return {time:'00:00:00',second:false,minute:false,hour:false,halfDay:false,showIndicators:true};},
  initStyle(){return {w:220,h:300,strokeOn:false,fontSize:16};},
  _formatter(timezone){
    if(typeof timezone!=='string' || !timezone.trim() || timezone.length>128)throw new Error('Timezone must be local or a valid timezone name, such as Europe/Berlin');
    const zone=timezone.trim();
    try{return new Intl.DateTimeFormat('en-GB',{...(zone.toLowerCase()==='local'?{}:{timeZone:zone}),
      hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',numberingSystem:'latn'});}
    catch(_){throw new Error('Invalid timezone: use local, UTC, or a timezone name such as Europe/Berlin');}
  },
  _validate(state){
    if(typeof state.time!=='string' || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(state.time) ||
       ['second','minute','hour','halfDay'].some(key=>typeof state[key]!=='boolean') || typeof state.showIndicators!=='boolean')throw new Error('Invalid Live clock state');
  },
  transition(inputs,state,memory,context){
    const {now}=context;
    this._validate(state);
    if(!Number.isFinite(now) || now<0)throw new Error('Live clock requires a valid monotonic time');
    const formatter=this._formatter(inputs.timezone),wall=Date.now();
    if(!Number.isFinite(wall) || Math.abs(wall)>8640000000000000)throw new Error('Live clock requires a valid wall-clock time');
    const parts=Object.fromEntries(formatter.formatToParts(new Date(wall)).map(part=>[part.type,part.value]));
    const hour=Number(parts.hour)%24,minute=Number(parts.minute),second=Number(parts.second);
    const time=[hour,minute,second].map(value=>String(value).padStart(2,'0')).join(':');
    const zone=formatter.resolvedOptions().timeZone,epochSecond=Math.floor(wall/1000);
    const fresh=memory==null || (typeof memory==='object' && !Array.isArray(memory) && Object.keys(memory).length===0);
    if(!fresh && (typeof memory.zone!=='string' || !Number.isFinite(memory.wall) || !Number.isSafeInteger(memory.epochSecond) ||
       memory.epochSecond!==Math.floor(memory.wall/1000) || !Number.isFinite(memory.now) || memory.now<0 ||
       (memory.until!==null && (!Number.isFinite(memory.until) || memory.until<=memory.now))))throw new Error('Invalid Live clock scheduling memory');
    // Replaying an earlier queued signal must not consume this wall-clock wake.
    if(context.historical && !fresh && memory.zone===zone){
      const nextWakeAt=memory.until===null?memory.now+1000-((memory.wall%1000+1000)%1000):memory.until;
      return {state,memory,nextWakeAt};
    }
    // Active-document time pauses while hidden. A wall/active-time discontinuity resets observation,
    // as does a backwards clock adjustment. Small scheduling jitter does not erase a normal tick.
    const restart=fresh || memory.zone!==zone || wall<memory.wall || now<memory.now ||
      Math.abs((wall-memory.wall)-(now-memory.now))>500;
    let secondTick=false,minuteTick=false,hourTick=false,halfDayTick=false,until=null;
    if(!restart){
      if(memory.until!==null){
        // An overdue high must fall before another rise; never turn missed ticks into a burst.
        if(now<memory.until){
          secondTick=state.second;minuteTick=state.minute;hourTick=state.hour;halfDayTick=state.halfDay;until=memory.until;
        }
      }else if(epochSecond===memory.epochSecond+1){
        secondTick=true;minuteTick=second===0;hourTick=minuteTick && minute===0;halfDayTick=hourTick && hour%12===0;
        until=now+100;
      }
    }
    const nextWakeAt=until===null?now+1000-((wall%1000+1000)%1000):until;
    if(!Number.isFinite(nextWakeAt) || nextWakeAt<=now)throw new Error('Live clock wake time is outside the numeric range');
    return {state:{...state,time,second:secondTick,minute:minuteTick,hour:hourTick,halfDay:halfDayTick},
      memory:{zone,wall,now,epochSecond,until},nextWakeAt};
  },
  publish(state){
    this._validate(state);
    return {second:state.second,minute:state.minute,hour:state.hour,halfDay:state.halfDay,time:state.time};
  },
  compute(inputs,state){
    this._formatter(inputs.timezone);this._validate(state);
    return {second:state.second,minute:state.minute,hour:state.hour,halfDay:state.halfDay,time:state.time};
  },
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
    const available=!io.error && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(io.outputs?.time);
    const scale=Math.min(w/220,h/300),top=24*scale,d=Math.max(1,Math.min(w-16*scale,h-112*scale));
    const cx=w/2,cy=top+d/2,r=d/2,thin=Math.max(1,(style.size||2)/2);
    const text=(value,x,y,width,height,size)=>({type:'text',x,y,w:width,h:height,text:value,align:'center',
      font:'600 '+Math.max(6,size*scale)+'px sans-serif',color:style.textColor||style.color,textColor:style.textColor||style.color,strokeOn:false,fill:false});
    const items=[{...text('',0,0,w,22*scale,16),...this._caption(io.name,'Live clock',w,22*scale,{...style,fontSize:16*scale})},
      {type:'ellipse',x:cx-r,y:top,w:d,h:d,color:style.color,size:thin,strokeOn:true,fill:style.fill,fillColor:style.fillColor}];
    for(let i=0;i<12;i++){
      const angle=i/12*Math.PI*2;
      items.push({type:'line',x1:cx+Math.sin(angle)*r*.84,y1:cy-Math.cos(angle)*r*.84,
        x2:cx+Math.sin(angle)*r*.95,y2:cy-Math.cos(angle)*r*.95,color:style.color,size:thin});
    }
    if(available){
      const [hour,minute,second]=io.outputs.time.split(':').map(Number),minutes=minute+second/60,hours=hour%12+minutes/60;
      for(const [value,total,length,size,color] of [[hours,12,.5,style.size||2,style.color],
        [minutes,60,.72,style.size||2,style.color],[second,60,.82,thin,style.textColor||style.color]]){
        const angle=value/total*Math.PI*2;
        items.push({type:'line',x1:cx,y1:cy,x2:cx+Math.sin(angle)*r*length,y2:cy-Math.cos(angle)*r*length,color,size});
      }
    }
    const timezone=typeof io.inputs?.timezone==='string'?io.inputs.timezone.trim():'local';
    const zoneLabel=available?(timezone.toLowerCase()==='local'?'Local time':timezone):/timezone/i.test(io.error||'')?'Invalid timezone':'Clock unavailable';
    items.push(text(available?io.outputs.time:'--:--:--',0,top+d+6*scale,w,22*scale,20),
      {...text('',0,top+d+31*scale,w,16*scale,11),...this._caption(zoneLabel,'Local time',w,16*scale,{...style,fontSize:11*scale}),
        ...(!available?{color:'#92400e',textColor:'#92400e'}:{})});
    if(state.showIndicators!==false){
      for(const [index,[key,label]] of [['second','1 s'],['minute','1 m'],['hour','1 h'],['halfDay','12 h']].entries()){
        const x=w*(index+.5)/4,y=h-28*scale,radius=3*scale;
        items.push({type:'ellipse',x:x-17*scale-radius,y:y-radius,w:radius*2,h:radius*2,fill:true,
          fillColor:available?(io.outputs[key]?'#15803d':'#94a3b8'):'#fbbf24',strokeOn:false},
          text(label,x-11*scale,y-8*scale,35*scale,16*scale,9));
      }
    }
    if(editing && available){
      items.push({type:'rect',x:0,y:h-17*scale,w,h:17*scale,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly:true},
        {...text('Indicators: '+(state.showIndicators?'on':'off'),0,h-17*scale,w,17*scale,10),editorOnly:true});
    }
    return items;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,outputs:{}});},
  handles(state,w,h){return [{id:'indicators',x:w/2,y:h-8.5*Math.min(w/220,h/300),kind:'click',editorOnly:true}];},
  hitEdit(state,x,y,w,h){return x>=0 && x<=w && y>=h-17*Math.min(w/220,h/300) && y<=h?'indicators':null;},
  dragEdit(state,handle){return {state:handle==='indicators'?{...state,showIndicators:!state.showIndicators}:state};}
})
