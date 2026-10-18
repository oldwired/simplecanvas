// A numeric source with configurable bounds and step. Click the value to type a number.
// The slider, buttons, and direct entry use the same step grid, anchored at the minimum.
({
  apiVersion:2,
  inputs:{min:{type:'number',default:0},max:{type:'number',default:100},step:{type:'number',default:1}},
  outputs:{value:{type:'number'}},
  initState(){return {value:50};},
  initStyle(){return {w:240,h:130,fontSize:20,strokeOn:false};},
  _config(inputs={}){
    const {min=0,max=100,step=1}=inputs;
    if(!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step))throw new Error('Bounds and step must be finite numbers');
    if(min>max)throw new Error('Minimum must not exceed maximum');
    if(step<=0)throw new Error('Step must be greater than zero');
    if(!Number.isFinite(max-min) || !Number.isFinite((max-min)/step))throw new Error('Range or step is outside the numeric range');
    return {min,max,step};
  },
  _snap(value,config){
    const {min,max,step}=config;
    value=Number.isFinite(value)?Math.max(min,Math.min(max,value)):min;
    if(value===min || value===max)return value||0;
    const ticks=Math.round((value-min)/step),raw=Math.max(min,Math.min(max,min+ticks*step));
    const decimals=value=>{const [mantissa,exponent='0']=String(value).split('e');return Math.max(0,(mantissa.split('.')[1]||'').length-Number(exponent));};
    const precision=Math.max(decimals(min),decimals(step));
    const snapped=precision<=100?Number(raw.toFixed(precision)):raw;
    return Math.max(min,Math.min(max,snapped))||0;
  },
  compute(inputs,state){const config=this._config(inputs);return {value:this._snap(state.value,config)};},
  _number(value){return !Number.isFinite(value)?'—':Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(8)));},
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
    let config;try{config=this._config(io.inputs);}catch{}
    const value=io.outputs?.value,available=!io.error && Number.isFinite(value) && !!config;
    const scale=Math.min(w/240,h/130),pad=Math.min(20*scale,w*.15),y=h*.55;
    const textColor=style.textColor||style.color,font=size=>'600 '+Math.max(6,size*scale)+'px sans-serif';
    const position=available && config.max!==config.min?(value-config.min)/(config.max-config.min):.5;
    const label=this._number(value);
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      {type:'text',x:0,y:0,w,h:h*.22,...this._caption(io.name,'Number control',w,h*.22,style),align:'center',color:textColor,strokeOn:false,fill:false},
      {type:'text',x:w*.12,y:h*.23,w:w*.76,h:h*.23,text:available?label:'—',align:'center',font:font(20),color:textColor,strokeOn:false,fill:false},
      {type:'line',x1:pad,y1:y,x2:w-pad,y2:y,color:style.color,size:2}
    ];
    if(available){
      children.push({type:'ellipse',x:pad+(w-pad*2)*position-6*scale,y:y-6*scale,w:12*scale,h:12*scale,fill:true,fillColor:style.color,strokeOn:false});
      if(editing){
        for(const [x,label] of [[0,'− '+this._number(config.step)],[w/2,'+ '+this._number(config.step)]]){
          children.push({type:'rect',x:x+4*scale,y:h*.72,w:Math.max(0,w/2-8*scale),h:h*.25,strokeOn:true,color:style.color,size:1,fill:false});
          children.push({type:'text',x,y:h*.72,w:w/2,h:h*.25,text:label,align:'center',font:font(16),color:textColor,strokeOn:false,fill:false});
        }
      }
    }else{
      children.push({type:'text',x:0,y:h*.72,w,h:h*.25,text:'Check bounds and step in Inputs',align:'center',font:font(10),color:'#92400e',strokeOn:false,fill:false});
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,outputs:{}});},
  handles(state,w,h,style,io={}){
    let config;try{config=this._config(io.inputs);}catch{return [];}
    const value=io.outputs?.value;if(!Number.isFinite(value) || io.error)return [];
    const scale=Math.min(w/240,h/130),pad=Math.min(20*scale,w*.15);
    const position=config.max===config.min?.5:(value-config.min)/(config.max-config.min);
    return [
      {id:'value',x:pad+(w-pad*2)*position,y:h*.55},
      {id:'entry',x:w/2,y:h*.345,kind:'number',value,min:config.min,max:config.max,step:config.step},
      {id:'minus',x:w/4,y:h*.84,kind:'click'},
      {id:'plus',x:w*.75,y:h*.84,kind:'click'}
    ];
  },
  hitEdit(state,lx,ly,w,h){
    if(lx<0 || lx>w)return null;
    if(ly>=h*.72 && ly<=h)return lx<w/2?'minus':'plus';
    if(ly>=h*.23 && ly<=h*.46)return 'entry';
    if(Math.abs(ly-h*.55)<=Math.min(18,h*.09))return 'value';
    return null;
  },
  dragEdit(state,handle,lx,ly,w,h,style,io={}){
    const config=this._config(io.inputs),current=this._snap(io.outputs?.value??state.value,config);
    const scale=Math.min(w/240,h/130),pad=Math.min(20*scale,w*.15);
    let value=current;
    if(handle==='value')value=config.min+Math.max(0,Math.min(1,(lx-pad)/Math.max(1,w-pad*2)))*(config.max-config.min);
    else if(handle==='entry'){if(!Number.isFinite(lx))throw new Error('Enter a finite number');value=lx;}
    else if(handle==='plus')value=config.max-current<=config.step?config.max:current+config.step;
    else if(handle==='minus')value=current-config.min<=config.step?config.min:current-config.step;
    if(!Number.isFinite(value))throw new Error('Calculation overflow');
    return {state:{...state,value:this._snap(value,config)}};
  }
})
