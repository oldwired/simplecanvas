// Seconds countdown with numeric outputs. Drag the hand in edit mode to set 0-59 s; Start/Pause and
// Reset run it. Outputs: seconds (0-60), and its tens (0-6) and ones (0-9) digits for two
// single-digit displays. Timing uses the host clock (transition/nextWakeAt), so connected
// components follow every second; reloading resumes a running countdown from its saved second.
// In edit mode, click the title to type your own (an empty title goes back to the instance name from
// Inputs..., or "Countdown timer").
({
  apiVersion:2,
  outputs:{seconds:{type:'number'},tens:{type:'number'},ones:{type:'number'}},
  initState(){return {remaining:45,preset:45,running:false};},
  initStyle(){return {w:240,h:340,fontSize:16,fill:false,fillColor:'#dc2626',strokeOn:true,color:'#334155',textColor:'#334155',size:2};},
  _validate(state){
    for(const key of ['remaining','preset'])
      if(!Number.isInteger(state[key]) || state[key]<0 || state[key]>60)throw new Error('Countdown '+key+' must be a whole number of seconds from 0 to 60');
    if(typeof state.running!=='boolean')throw new Error('Countdown running flag must be Boolean');
    if(state.title!==undefined && (typeof state.title!=='string' || state.title.length>100))throw new Error('Countdown title must be text of at most 100 characters');
  },
  // The shown title: the user's own (state.title), else the instance name, else the component's name.
  _title(state,io){return (typeof state.title==='string' && state.title.trim()) || io.name || 'Countdown timer';},
  _titleRect(w,h){const s=this._layout(w,h).s;return {x:w*.04,y:0,w:w*.92,h:26*s};},
  // One layout for drawing and hit-testing: caption, dial, readout, control row (240 x 340 design grid).
  _layout(w,h){
    const s=Math.min(w/240,h/340);
    const top=30*s,bottom=h-96*s,d=Math.max(0,Math.min(w-8*s,bottom-top)),r=d/2;
    const cx=w/2,cy=top+r;
    const numR=r*.84,tickOuter=r*.72,tickMajor=r*.58,tickMinor=r*.65,wedgeR=Math.max(0,r*.55);
    return {s,cx,cy,r,numR,tickOuter,tickMajor,tickMinor,wedgeR,readoutY:top+d+4*s,rowY:h-46*s,rowH:40*s};
  },
  // Seconds left -> angle of the red/white boundary; 0 sits at the top, numbers count down clockwise.
  _angle(seconds){return ((60-Math.max(0,Math.min(60,seconds)))%60)/60*2*Math.PI;},
  _caption(name,fallback,w,h,style){
    const label=(typeof name==='string'?name:'').trim().replace(/\s+/g,' ')||fallback;
    const units=text=>Array.from(text).reduce((n,c)=>n+(/[MWmw@#%]/.test(c)||c.codePointAt(0)>255?1.1:/[A-Z]/.test(c)?.88:.72),0);
    const size=Math.max(1,Math.min(style.fontSize||16,h*.7,Math.max(1,w-16)/Math.max(1,units(label))));
    return {text:label,size,font:(style.font||'600 16px sans-serif').replace(/\d+(?:\.\d+)?px/,size+'px')};
  },
  transition(inputs,state,memory,context){
    this._validate(state);
    const now=context.now;
    if(!Number.isFinite(now) || now<0)throw new Error('Countdown requires a valid monotonic time');
    if(!state.running || state.remaining<=0)return {state:{...state,running:false},memory:{},nextWakeAt:null};
    // A fresh observation (Start, reload, undo, copy) counts down from the saved whole second.
    const fresh=!memory || !Number.isFinite(memory.endAt) || memory.from!==state.remaining;
    const endAt=fresh?now+state.remaining*1000:memory.endAt;
    const remaining=Math.max(0,Math.ceil((endAt-now)/1000-1e-9));
    const running=remaining>0;
    return {state:{...state,remaining,running},memory:running?{endAt,from:remaining}:{},
      nextWakeAt:running?endAt-(remaining-1)*1000:null};
  },
  compute(inputs,state){
    this._validate(state);
    return {seconds:state.remaining,tens:Math.floor(state.remaining/10),ones:state.remaining%10};
  },
  children(state,style,w,h,editing,io={}){
    const L=this._layout(w,h),{s,cx,cy,r}=L,items=[];
    const seconds=Number.isInteger(io.outputs?.seconds)?io.outputs.seconds:state.remaining;
    const ink=style.color||'#334155',textInk=style.textColor||ink,thin=Math.max(1,(style.size||2)/2);
    const font=px=>(style.font||'600 16px sans-serif').replace(/\d+(?:\.\d+)?px/,Math.max(6,Math.round(px))+'px');
    const text=(value,x,y,tw,th,px,color=textInk)=>({type:'text',x,y,w:tw,h:th,text:String(value),align:'center',font:font(px),color,strokeOn:false,fill:false});
    const cap=this._caption(this._title(state,io),'Countdown timer',w*.92,26*s,{...style,fontSize:16*s});
    items.push({...text('',w*.04,0,w*.92,26*s,16*s),text:cap.text,font:cap.font});
    items.push({type:'ellipse',x:cx-r,y:cy-r,w:2*r,h:2*r,color:ink,size:thin,strokeOn:true,fill:false});
    const a=this._angle(seconds),sweep=Math.min(seconds/60*2*Math.PI,2*Math.PI-1e-4);
    if(seconds>0 && L.wedgeR>1){
      const from=(2*Math.PI-sweep)%(2*Math.PI);
      items.push({type:'polygon',closed:true,fill:true,fillColor:style.fillColor||'#dc2626',color:style.fillColor||'#dc2626',strokeOn:false,
        points:[{x:cx,y:cy},{x:cx+L.wedgeR*Math.sin(from),y:cy-L.wedgeR*Math.cos(from),arcTo:{cx,cy,r:L.wedgeR,a1:from,a2:from+sweep}},{x:cx,y:cy-L.wedgeR}]});
    }
    for(let i=0;i<60;i++){
      const t=i/60*2*Math.PI,inner=i%5===0?L.tickMajor:L.tickMinor;
      items.push({type:'line',x1:cx+Math.sin(t)*inner,y1:cy-Math.cos(t)*inner,x2:cx+Math.sin(t)*L.tickOuter,y2:cy-Math.cos(t)*L.tickOuter,
        color:ink,size:i%5===0?thin:Math.max(.5,thin*.5)});
    }
    // two-digit labels: ~1.3 em of text plus the text box's 6 px inset on each side, so they never wrap
    const numPx=Math.max(6,r*.13),boxW=numPx*1.4+14,boxH=numPx*1.5;
    for(let i=0;i<12;i++){
      const t=i/12*2*Math.PI;
      items.push(text((60-i*5)%60,cx+Math.sin(t)*L.numR-boxW/2,cy-Math.cos(t)*L.numR-boxH/2,boxW,boxH,numPx));
    }
    items.push({type:'line',x1:cx,y1:cy,x2:cx+Math.sin(a)*L.wedgeR,y2:cy-Math.cos(a)*L.wedgeR,color:ink,size:style.size||2});
    items.push(text(seconds+' s',0,L.readoutY,w,40*s,30*s));
    if(editing){
      for(const [x,label] of [[0,state.running?'Pause':'Start'],[w/2,'Reset']]){
        items.push({type:'rect',x:x+6*s,y:L.rowY,w:Math.max(1,w/2-12*s),h:L.rowH,color:ink,size:1,strokeOn:true,fill:true,fillColor:'#f1f5f9'});
        items.push(text(label,x,L.rowY,w/2,L.rowH,15*s));
      }
    }else items.push(text(state.running?'Running':seconds>0?'Stopped':'Done',0,L.rowY,w,L.rowH,14*s));
    return items;
  },
  handles(state,w,h,style={},io={}){
    const L=this._layout(w,h),a=this._angle(state.remaining),t=this._titleRect(w,h);
    const cap=this._caption(this._title(state,io),'Countdown timer',t.w,t.h,{...style,fontSize:16*L.s});
    return [{id:'hand',x:L.cx+Math.sin(a)*L.wedgeR,y:L.cy-Math.cos(a)*L.wedgeR},
      {id:'toggle',x:w/4,y:L.rowY+L.rowH/2,kind:'click'},{id:'reset',x:w*.75,y:L.rowY+L.rowH/2,kind:'click'},
      // the title is edited in place, prefilled with what is shown; editor only (not in exported HTML)
      {id:'title',x:t.x+t.w/2,y:t.y+t.h/2,kind:'text',value:cap.text,label:'Title',inline:{...t,fontSize:cap.size,align:'center',mode:'edit'},editorOnly:true}];
  },
  hitEdit(state,x,y,w,h){
    const t=this._titleRect(w,h);
    if(x>=t.x && x<=t.x+t.w && y>=t.y && y<=t.y+t.h)return 'title';
    const L=this._layout(w,h),a=this._angle(state.remaining);
    if(Math.hypot(x-(L.cx+Math.sin(a)*L.wedgeR),y-(L.cy-Math.cos(a)*L.wedgeR))<14)return 'hand';
    if(y>=L.rowY && y<=L.rowY+L.rowH && x>=0 && x<=w)return x<w/2?'toggle':'reset';
    return null;
  },
  dragEdit(state,handle,x,y,w,h){
    if(handle==='title'){
      if(typeof x!=='string')return {state};
      const title=x.trim().replace(/\s+/g,' ').slice(0,100),next={...state};
      if(title)next.title=title;else delete next.title;   // empty: back to the default title
      return {state:next};
    }
    if(handle==='toggle')return {state:{...state,running:!state.running && state.remaining>0}};
    if(handle==='reset')return {state:{...state,remaining:state.preset,running:false}};
    if(handle==='hand'){
      const L=this._layout(w,h);
      let a=Math.atan2(x-L.cx,-(y-L.cy));if(a<0)a+=2*Math.PI;
      const seconds=Math.round(((2*Math.PI-a)%(2*Math.PI))/(2*Math.PI)*60)%60;
      return {state:{...state,remaining:seconds,preset:seconds,running:false}};   // setting the dial stops it
    }
    return {state};
  }
})
