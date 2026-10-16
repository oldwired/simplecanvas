// Count false-to-true edges. An initial high input seeds memory without counting.
// Held reset keeps zero and follows the input, so releasing reset high adds no edge.
({
  apiVersion:2,
  inputs:{value:{type:'boolean'},threshold:{type:'number',default:3},reset:{type:'boolean',default:false}},
  outputs:{count:{type:'number'},reached:{type:'boolean'}},
  initState(){return {count:0,showIndicators:true};},
  initStyle(){return {w:300,h:210,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _validate(inputs,state){
    if(typeof inputs.value!=='boolean' || typeof inputs.reset!=='boolean')throw new Error('Counter requires Boolean input and reset values');
    if(!Number.isSafeInteger(inputs.threshold) || inputs.threshold<0)throw new Error('Counter threshold must be a nonnegative safe integer');
    if(!Number.isSafeInteger(state.count) || state.count<0)throw new Error('Counter count must be a nonnegative safe integer');
  },
  transition(inputs,state,memory){
    this._validate(inputs,state);
    let count=state.count;
    if(inputs.reset)count=0;
    else if(memory?.previous===false && inputs.value){
      if(count>=Number.MAX_SAFE_INTEGER)throw new Error('Counter exceeds the safe integer range');
      count++;
    }
    return {state:{...state,count},memory:{previous:inputs.value},nextWakeAt:null};
  },
  compute(inputs,state){this._validate(inputs,state);return {count:state.count,reached:state.count>=inputs.threshold};},
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
    const raw=io.inputs||{},rawOutputs=io.outputs||{},scale=Math.min(w/300,h/210);
    const available=!io.error && typeof raw.value==='boolean' && typeof raw.reset==='boolean' && Number.isSafeInteger(raw.threshold) && Number.isSafeInteger(rawOutputs.count) && typeof rawOutputs.reached==='boolean';
    const inputs=available?raw:{},outputs=available?rawOutputs:{};
    const font=size=>'600 '+Math.max(6,size*scale)+'px sans-serif';
    const label=value=>typeof value==='boolean'?String(value):'—';
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor||style.color,strokeOn:false,fill:false});
    const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true});
    const count=Number.isSafeInteger(outputs.count)?String(outputs.count):'—',threshold=Number.isSafeInteger(inputs.threshold)?String(inputs.threshold):'—';
    const upper=h*.42,lower=h*.66;
    const children=[
      {...text('',w*.04,0,w*.92,h*.18,16,'left'),...this._caption(io.name,'Counter',w*.92,h*.18,{...style,fontSize:16*scale})},
      line(w*.02,upper,w*.30,upper),line(w*.02,lower,w*.30,lower),line(w*.69,upper,w*.98,upper),line(w*.69,lower,w*.98,lower),
      text('Input: '+label(inputs.value),0,h*.27,w*.29,h*.13,10.5),
      text('Reset: '+label(inputs.reset),0,h*.51,w*.29,h*.13,10.5),
      text('Count',w*.72,h*.22,w*.28,h*.09,10.5),
      {...text('',w*.72,h*.31,w*.28,h*.09,10),...this._caption(count,'—',w*.28,h*.09,{...style,fontSize:10*scale})},
      text('Reached: '+label(outputs.reached),w*.71,h*.51,w*.29,h*.13,10),
      {type:'rect',x:w*.30,y:h*.25,w:w*.39,h:h*.48,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      text('↑',w*.30,h*.26,w*.39,h*.18,26),
      {...text('',w*.30,h*.44,w*.39,h*.15,24),...this._caption(count,'—',w*.39,h*.15,{...style,fontSize:24*scale})},
      {...text('',w*.30,h*.60,w*.39,h*.10,11),...this._caption('≥ '+threshold,'≥ —',w*.39,h*.10,{...style,fontSize:11*scale})}
    ];
    if(state.showIndicators!==false){
      const radius=4*scale;
      for(const [x,y,value,numeric] of [[w*.045,upper,inputs.value,false],[w*.045,lower,inputs.reset,false],[w*.955,upper,outputs.count,true],[w*.955,lower,outputs.reached,false]]){
        const present=numeric?Number.isFinite(value):typeof value==='boolean';
        children.push({type:'ellipse',x:x-radius,y:y-radius,w:radius*2,h:radius*2,fill:true,
          fillColor:present?(numeric?'#2563eb':value?'#15803d':'#64748b'):'#fbbf24',strokeOn:true,color:present?'#f8fafc':'#b45309',size:Math.max(1,scale)});
      }
    }
    if(!available){
      const error=typeof io.error==='string'?io.error:'';
      const note=/threshold must/i.test(error)?'Threshold must be a nonnegative integer':/safe integer range/i.test(error)?'Counter is outside the numeric range':!error || /^Missing value or binding/.test(error)?'Input required':'Input unavailable';
      children.push({...text(note,w*.04,h*.79,w*.92,h*.18,10.5),color:'#92400e'});
    }
    if(editing && available){
      for(const [x,label,editorOnly] of [[w*.05,'Reset',false],[w*.53,'Indicators: '+(state.showIndicators!==false?'on':'off'),true]]){
        children.push({type:'rect',x,y:h*.84,w:w*.42,h:h*.13,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly});
        children.push({...text(label,x,h*.84,w*.42,h*.13,10.5),editorOnly});
      }
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,inputs:{},outputs:{}});},
  handles(state,w,h){return [{id:'reset',x:w*.26,y:h*.905,kind:'click'},{id:'indicators',x:w*.74,y:h*.905,kind:'click',editorOnly:true}];},
  hitEdit(state,x,y,w,h){
    if(y<h*.84 || y>h*.97)return null;
    return x>=w*.05 && x<=w*.47?'reset':x>=w*.53 && x<=w*.95?'indicators':null;
  },
  dragEdit(state,handle){return {state:handle==='reset'?{...state,count:0}:handle==='indicators'?{...state,showIndicators:state.showIndicators===false}:state};}
})
