// Sample at the beginning of each active interval and hold between boundaries.
// Input changes do not restart the interval; changing seconds begins a new interval.
({
  apiVersion:2,
  inputs:{value:{type:'number'},seconds:{type:'number',default:1}},
  outputs:{value:{type:'number'}},
  initState(){return {value:0,showIndicators:true};},
  initStyle(){return {w:300,h:180,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _validate(inputs,state){
    if(!Number.isSafeInteger(inputs.value) || !Number.isSafeInteger(state.value))throw new Error('Integer sample and hold requires safe integers');
    if(!Number.isFinite(inputs.seconds) || inputs.seconds<.01 || inputs.seconds>3600)throw new Error('Hold seconds must be between 0.01 and 3600');
  },
  transition(inputs,state,memory,context){
    this._validate(inputs,state);
    const now=context.now;
    if(!Number.isFinite(now) || now<0)throw new Error('Sample and hold requires a valid monotonic time');
    const sample=!Number.isFinite(memory?.nextAt) || memory.seconds!==inputs.seconds || now>=memory.nextAt;
    const nextAt=sample?now+inputs.seconds*1000:memory.nextAt;
    if(!Number.isFinite(nextAt))throw new Error('Hold wake time is outside the numeric range');
    return {state:{...state,value:sample?inputs.value:state.value},memory:{seconds:inputs.seconds,nextAt},nextWakeAt:nextAt};
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
    const available=!io.error && Number.isSafeInteger(raw.value) && Number.isFinite(raw.seconds) && Number.isSafeInteger(rawOutput);
    const inputs=available?raw:{},output=available?rawOutput:undefined;
    const font=size=>'600 '+Math.max(6,size*scale)+'px sans-serif';
    const label=value=>Number.isSafeInteger(value)?String(value):'—';
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor||style.color,strokeOn:false,fill:false});
    const reading=(value,x)=>({...text(label(value),x,h*.35,w*.29,h*.11,11),font:'600 '+Math.min(11*scale,w*.27/Math.max(1,label(value).length*.72))+'px sans-serif'});
    const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true});
    const seconds=Number.isFinite(inputs.seconds)?String(inputs.seconds):'—',cy=h*.49;
    const children=[
      {...text('',w*.04,0,w*.92,h*.18,16,'left'),...this._caption(io.name,'Sample & hold (integer)',w*.92,h*.18,{...style,fontSize:16*scale})},
      line(w*.02,cy,w*.30,cy),line(w*.69,cy,w*.98,cy),
      text('Input',0,h*.23,w*.29,h*.11,10.5),reading(inputs.value,0),
      text('Output',w*.71,h*.23,w*.29,h*.11,10.5),reading(output,w*.71),
      {type:'rect',x:w*.30,y:h*.25,w:w*.39,h:h*.48,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      text('S/H',w*.30,h*.27,w*.39,h*.27,26),
      {...text('',w*.30,h*.55,w*.39,h*.13,12),...this._caption(seconds+' s','— s',w*.39,h*.13,{...style,fontSize:12*scale})}
    ];
    if(state.showIndicators!==false){
      const radius=4*scale;
      for(const [x,value] of [[w*.045,inputs.value],[w*.955,output]]){
        const present=Number.isSafeInteger(value);
        children.push({type:'ellipse',x:x-radius,y:cy-radius,w:radius*2,h:radius*2,fill:true,
          fillColor:present?'#2563eb':'#fbbf24',strokeOn:true,color:present?'#f8fafc':'#b45309',size:Math.max(1,scale)});
      }
    }
    if(!available){
      const error=typeof io.error==='string'?io.error:'';
      const note=/seconds must/i.test(error)?'Seconds must be between 0.01 and 3600':/requires safe integers/i.test(error)?'Input must be a safe integer':!error || /^Missing value or binding/.test(error)?'Input required':'Input unavailable';
      children.push({...text(note,w*.04,h*.79,w*.92,h*.18,10.5),color:'#92400e'});
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
