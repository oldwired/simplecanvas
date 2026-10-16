// Start low; the first rising edge arrives after one full period of active document time.
// Disable or a timing change restarts the sequence. Late wakes emit one phase, never a burst.
({
  apiVersion:2,
  inputs:{seconds:{type:'number',default:1},width:{type:'number',default:0.1},enable:{type:'boolean',default:true}},
  outputs:{value:{type:'boolean'}},
  initState(){return {value:false,showIndicators:true};},
  initStyle(){return {w:300,h:180,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _validate(inputs,state){
    if(!Number.isFinite(inputs.seconds) || inputs.seconds<0.02 || inputs.seconds>3600)throw new Error('Pulse period must be between 0.02 and 3600 seconds');
    if(!Number.isFinite(inputs.width) || inputs.width<0.01 || inputs.seconds-inputs.width<0.01-1e-12)throw new Error('Pulse width and low time must each be at least 0.01 seconds');
    if(typeof inputs.enable!=='boolean')throw new Error('Pulse enable must be Boolean');
    if(typeof state.value!=='boolean')throw new Error('Pulse generator state must contain a Boolean output');
  },
  transition(inputs,state,memory,context){
    this._validate(inputs,state);
    const now=context.now;
    if(!Number.isFinite(now) || now<0)throw new Error('Pulse generator requires a valid monotonic time');
    const fresh=memory==null || (typeof memory==='object' && !Array.isArray(memory) && Object.keys(memory).length===0);
    if(!fresh && (typeof memory.enable!=='boolean' || !Number.isFinite(memory.seconds) || !Number.isFinite(memory.width) ||
       !['idle','high','low'].includes(memory.phase) || memory.enable!==(memory.phase!=='idle') || (memory.phase==='idle'?memory.nextAt!==null:!Number.isFinite(memory.nextAt) || memory.nextAt<0)))throw new Error('Invalid Pulse generator scheduling memory');
    const restart=fresh || !memory.enable || memory.seconds!==inputs.seconds || memory.width!==inputs.width;
    let phase='idle',nextAt=null;
    if(inputs.enable){
      if(restart){phase='low';nextAt=now+inputs.seconds*1000;}
      else{
        phase=memory.phase;nextAt=memory.nextAt;
        // A late wake preserves both levels: each phase starts from the actual wake time.
        if(now>=nextAt){
          phase=phase==='high'?'low':'high';
          nextAt=now+(phase==='high'?inputs.width:inputs.seconds-inputs.width)*1000;
        }
      }
    }
    if(nextAt!==null && (!Number.isFinite(nextAt) || nextAt<=now))throw new Error('Pulse generator wake time is outside the numeric range');
    return {state:{...state,value:phase==='high'},memory:{seconds:inputs.seconds,width:inputs.width,enable:inputs.enable,phase,nextAt},nextWakeAt:nextAt};
  },
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
    const raw=io.inputs||{},rawOutput=io.outputs?.value,scale=Math.min(w/300,h/180);
    const available=!io.error && typeof raw.enable==='boolean' && Number.isFinite(raw.seconds) && Number.isFinite(raw.width) && typeof rawOutput==='boolean';
    const inputs=available?raw:{},output=available?rawOutput:undefined,cy=h*.49;
    const font=size=>'600 '+Math.max(6,size*scale)+'px sans-serif';
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor||style.color,strokeOn:false,fill:false});
    const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true});
    const timing=available?'T '+inputs.seconds+' s · on '+inputs.width+' s':'T — s · on — s';
    const children=[
      {...text('',w*.04,0,w*.92,h*.18,16,'left'),...this._caption(io.name,'Pulse generator',w*.92,h*.18,{...style,fontSize:16*scale})},
      line(w*.02,cy,w*.23,cy),line(w*.76,cy,w*.98,cy),
      text('Enable',0,h*.33,w*.22,h*.13,10.5),text('Output',w*.77,h*.33,w*.23,h*.13,10.5),
      {type:'rect',x:w*.23,y:h*.25,w:w*.53,h:h*.48,fill:style.fill,fillColor:output===true?'#dcfce7':style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      {type:'polygon',closed:false,fill:false,strokeOn:true,color:output===true?'#15803d':style.color,size:Math.max(1,2*scale),
        points:[{x:w*.29,y:h*.55},{x:w*.35,y:h*.55},{x:w*.35,y:h*.37},{x:w*.43,y:h*.37},{x:w*.43,y:h*.55},{x:w*.53,y:h*.55},{x:w*.53,y:h*.37},{x:w*.61,y:h*.37},{x:w*.61,y:h*.55},{x:w*.69,y:h*.55}]},
      {...text('',w*.23,h*.75,w*.53,h*.08,10),...this._caption(timing,'T — s',w*.53,h*.08,{...style,fontSize:10*scale})}
    ];
    if(state.showIndicators!==false){
      const radius=4*scale;
      for(const [x,value] of [[w*.045,inputs.enable],[w*.955,output]]){
        const present=typeof value==='boolean';
        children.push({type:'ellipse',x:x-radius,y:cy-radius,w:radius*2,h:radius*2,fill:true,
          fillColor:present?(value?'#15803d':'#64748b'):'#fbbf24',strokeOn:true,color:present?'#f8fafc':'#b45309',size:Math.max(1,scale)});
      }
    }
    if(!available){
      const error=typeof io.error==='string'?io.error:'';
      const note=/period must/i.test(error)?'Period: 0.02–3600 s':/width and low time/i.test(error)?'High and low time must each be ≥ 0.01 s':'Input unavailable';
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
