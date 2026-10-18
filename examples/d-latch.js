// Stored outputs publish independently of current inputs; transitions commit together in a settling round.
// Initial high clocks establish a baseline. Reset dominates clock; SR set+reset produces X.
({
  apiVersion:2,
  inputs:{d:{type:'boolean',unknown:true},enable:{type:'boolean',default:false},reset:{type:'boolean',default:false}},
  outputs:{q:{type:'boolean',unknown:true},notQ:{type:'boolean',unknown:true},value:{type:'boolean',unknown:true}},
  initState(){return {value:'X',showIndicators:true};},
  initStyle(){return {w:320,h:230,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  publish(state){if(!(typeof state.value==='boolean'||state.value==='X'))throw new Error('Invalid stored value');return {q:state.value,notQ:state.value==='X'?'X':!state.value,value:state.value};},
  _validate(inputs){if(typeof inputs.d!=='boolean'&&inputs.d!=='X')throw new Error('Invalid d input');if(typeof inputs.enable!=='boolean')throw new Error('Invalid enable input');if(typeof inputs.reset!=='boolean')throw new Error('Invalid reset input');},
  compute(inputs,state){this._validate(inputs);return this.publish(state);},
  transition(inputs,state,memory){
    this._validate(inputs);this.publish(state);
    let value=state.value;if(inputs.reset)value=false;else if(inputs.enable)value=inputs.d;
    return {state:{...state,value},memory:{},nextWakeAt:null};
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
  _label(value){return value==='X'?'X':typeof value==='boolean'?(value?'1':'0'):'—';},
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/320,h/230),color=style.textColor||style.color,inputs=io.inputs||{},outputs=io.outputs||{};
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:'600 '+Math.max(5,size*scale)+'px sans-serif',color,strokeOn:false,fill:false});
    const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true});
    const children=[{...text('',w*.04,0,w*.92,h*.16,16,'left'),...this._caption(io.name,'D latch',w*.92,h*.16,{...style,fontSize:16*scale})},
      {type:'rect',x:w*.32,y:h*.22,w:w*.36,h:h*.51,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      text('D\nLatch',w*.35,h*.34,w*.30,h*.25,18)];
    const pin=(name,value,left,index,total)=>{
      const y=h*(.28+index*.38/Math.max(1,total-1)),a=left?.025:.68,b=left?.32:.975;
      children.push(line(w*a,y,w*b,y));
      children.push(text(name+': '+this._label(value),left?0:w*.70,y-h*.105,w*.30,h*.09,10));
      if((name==='CLK'||name==='Pulse')&&left)children.push(line(w*.32,y-h*.024,w*.35,y),line(w*.35,y,w*.32,y+h*.024));
      if(state.showIndicators!==false){const radius=3.5*scale,valid=typeof value==='boolean'||Number.isFinite(value),x=w*(left?.04:.96);
        children.push({type:'ellipse',x:x-radius,y:y-radius,w:radius*2,h:radius*2,fill:true,fillColor:valid?(typeof value==='number'?'#2563eb':value?'#15803d':'#64748b'):'#fbbf24',strokeOn:true,color:valid?'#f8fafc':'#b45309',size:Math.max(.5,scale*.7)});}
    };
    const left=[["d", "D"], ["enable", "EN"], ["reset", "R"]],right=[["q", "Q"], ["notQ", "Q\u0305"]];
    left.forEach(([key,label],i)=>pin(label,inputs[key],true,i,left.length));right.forEach(([key,label],i)=>pin(label,outputs[key],false,i,right.length));
    if(io.error)children.push({...text('Input unavailable',w*.04,h*.77,w*.92,h*.10,10),color:'#92400e'});
    else if(Object.values(outputs).includes('X'))children.push({...text('X · initialize or clock a known value',w*.04,h*.77,w*.92,h*.10,10),color:'#92400e'});
    if(editing){for(const [x,label,editorOnly] of [[w*.04,'Reset',false],[w*.53,'Indicators: '+(state.showIndicators!==false?'on':'off'),true]]){
      children.push({type:'rect',x,y:h*.89,w:w*.43,h:h*.095,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly});children.push({...text(label,x,h*.89,w*.43,h*.095,10),editorOnly});}}
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,io);},
  handles(state,w,h){return [{id:'reset',x:w*.255,y:h*.937,kind:'click'},{id:'indicators',x:w*.745,y:h*.937,kind:'click',editorOnly:true}];},
  hitEdit(state,x,y,w,h){return y<h*.89||y>h*.985?null:x>=w*.04&&x<=w*.47?'reset':x>=w*.53&&x<=w*.96?'indicators':null;},
  dragEdit(state,handle){return {state:handle==='reset'?{...state,value:false}:handle==='indicators'?{...state,showIndicators:state.showIndicators===false}:state};}
})
