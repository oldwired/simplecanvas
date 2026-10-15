// Double-click to reveal Start/Pause and Reset. Time is derived from saved timestamps, rather than
// counting redraws. A running stopwatch continues across tab switches, backgrounding, and reloads.
// Placement starts a fresh, stopped instance. Exported images capture the current reading; HTML keeps the controls and live timing.
({
  initState(){ return { elapsedMs:0, startedAt:null }; },
  initStyle(){ return { w:260, h:110, fontSize:24, strokeOn:false }; },
  _running(state){ return typeof state.startedAt==='number' && Number.isFinite(state.startedAt); },
  _elapsed(state){
    return Math.max(0,Number(state.elapsedMs)||0)+(this._running(state)?Math.max(0,Date.now()-state.startedAt):0);
  },
  refreshMs(state){ return this._running(state)?100:0; },
  children(state, style, w, h, editing){
    const tenths=Math.floor(this._elapsed(state)/100), pad=n=>String(n).padStart(2,'0');
    const text=pad(Math.floor(tenths/36000))+':'+pad(Math.floor(tenths/600)%60)+':'+pad(Math.floor(tenths/10)%60)+'.'+tenths%10;
    const running=this._running(state);
    const items=[
      {type:'rect',x:0,y:0,w,h,color:style.color,size:style.size,strokeOn:style.strokeOn,fill:style.fill,fillColor:style.fillColor},
      {type:'text',x:0,y:0,w,h:h*.6,text,align:'center',font:style.font,color:style.textColor,strokeOn:false,fill:false}
    ];
    if(editing){
      for(const [x,label] of [[0,running?'Pause':'Start'],[w/2,'Reset']]){
        items.push({type:'rect',x:x+2,y:h*.64,w:Math.max(1,w/2-4),h:h*.32,
          color:style.color,size:1,strokeOn:true,fill:false});
        items.push({type:'text',x,y:h*.64,w:w/2,h:h*.32,text:label,align:'center',
          font:style.font,color:style.textColor,strokeOn:false,fill:false});
      }
    }else{
      items.push({type:'text',x:0,y:h*.64,w,h:h*.32,text:running?'Running':'Stopped',align:'center',
        font:style.font,color:style.textColor,strokeOn:false,fill:false});
    }
    return items;
  },
  handles(state, w, h){
    return [{id:'toggle',x:w/4,y:h*.8,kind:'click'},{id:'reset',x:w*.75,y:h*.8,kind:'click'}];
  },
  hitEdit(state, lx, ly, w, h){
    if(ly<h*.64 || ly>h*.96 || lx<0 || lx>w) return null;
    return lx<w/2?'toggle':'reset';
  },
  dragEdit(state, handle){
    if(handle==='reset') return {...state,elapsedMs:0,startedAt:null};
    if(handle==='toggle') return this._running(state)
      ? {...state,elapsedMs:this._elapsed(state),startedAt:null}
      : {...state,startedAt:Date.now()};
    return state;
  },
})
