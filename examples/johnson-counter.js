// Each observed rising clock advances one position. Reset wins; disabled and held clocks do not advance.
// Stored outputs publish before all shared-edge updates are committed together.
({
  apiVersion:2,
  settings:{stages:{type:'number',default:4,min:1,max:16,step:1,label:'Stages'}},
  inputs:{clock:{type:'boolean',default:false},enable:{type:'boolean',default:true},reset:{type:'boolean',default:false}},
  outputs(state){const ports={};for(let i=0;i<this._stages(state);i++)ports['q'+i]={type:'boolean'};return {...ports,value:{type:'boolean'},position:{type:'number'}};},
  initState(){return {stages:4,configuredStages:4,position:0,showIndicators:true};},
  initStyle(){return {w:400,h:230,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _stages(state){if(!Number.isInteger(state.stages)||state.stages<1||state.stages>16)throw new Error('Stages must be an integer from 1 to 16');return state.stages;},
  _snapshot(state){
    const stages=this._stages(state);
    if(!Number.isInteger(state.configuredStages)||state.configuredStages<1||state.configuredStages>16||!Number.isInteger(state.position)||state.position<0||state.position>=state.configuredStages*2)throw new Error('Invalid stored counter position');
    return {stages,position:state.configuredStages===stages?state.position:0};
  },
  publish(state){const {stages,position}=this._snapshot(state),outputs={};for(let i=0;i<stages;i++)outputs['q'+i]=position<stages?i<position:i>=position-stages;return {...outputs,value:outputs['q'+(stages-1)],position};},
  _validate(inputs){if(typeof inputs.clock!=='boolean'||typeof inputs.enable!=='boolean'||typeof inputs.reset!=='boolean')throw new Error('Clock, enable and reset must be Boolean');},
  compute(inputs,state){this._validate(inputs);return this.publish(state);},
  transition(inputs,state,memory){
    this._validate(inputs);let {stages,position}=this._snapshot(state);
    const changed=state.configuredStages!==stages||memory?.stages!==stages;
    if(inputs.reset)position=0;else if(!changed&&inputs.enable&&memory?.previous===false&&inputs.clock)position=(position+1)%(stages*2);
    return {state:{...state,configuredStages:stages,position},memory:{stages,previous:inputs.clock},nextWakeAt:null};
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
    let count=4;try{count=this._stages(state);}catch{}
    const inputs=io.inputs||{},outputs=io.outputs||{},scale=Math.min(w/400,h/230),color=style.textColor||style.color;
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:'600 '+Math.max(5,size*scale)+'px sans-serif',color,strokeOn:false,fill:false});
    const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true});
    const children=[{...text('',w*.04,0,w*.92,h*.15,16,'left'),...this._caption(io.name,'Johnson counter',w*.92,h*.15,{...style,fontSize:16*scale})},
      {type:'rect',x:w*.04,y:h*.20,w:w*.92,h:h*.55,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      text('Twisted ring'+(Number.isInteger(outputs.position)?' · '+outputs.position:''),w*.10,h*.21,w*.80,h*.11,13)];
    const rows=count>8?2:1,columns=Math.min(count,8),spacing=w*.82/columns;
    for(let i=0;i<count;i++){
      const key='q'+i,value=outputs[key],x=w*.09+spacing*((i%columns)+.5),y=h*(rows===1?.48:Math.floor(i/columns)===0?.42:.62),radius=Math.min(spacing*.17,10*scale);
      children.push(text(key.toUpperCase(),x-spacing*.43,y-h*.095,spacing*.86,h*.085,10));
      if(state.showIndicators!==false)children.push({type:'ellipse',x:x-radius,y:y-radius*.1,w:radius*2,h:radius*2,fill:true,fillColor:typeof value==='boolean'?(value?'#15803d':'#e2e8f0'):'#fbbf24',strokeOn:true,color:typeof value==='boolean'?'#64748b':'#b45309',size:Math.max(.5,scale)});
      else children.push(text(typeof value==='boolean'?(value?'1':'0'):'—',x-spacing*.43,y,spacing*.86,h*.085,12));
    }
    const label=value=>typeof value==='boolean'?(value?'1':'0'):'—';
    children.push(text('CLK '+label(inputs.clock)+'   EN '+label(inputs.enable)+'   R '+label(inputs.reset),w*.04,h*.78,w*.92,h*.09,11));
    if(io.error)children.push({...text('Input unavailable',w*.04,h*.88,w*.92,h*.09,10),color:'#92400e'});
    else if(editing){for(const [x,label,editorOnly] of [[w*.04,'Reset',false],[w*.53,'Indicators: '+(state.showIndicators!==false?'on':'off'),true]]){
      children.push({type:'rect',x,y:h*.89,w:w*.43,h:h*.095,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly});children.push({...text(label,x,h*.89,w*.43,h*.095,10),editorOnly});}}
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,io);},
  handles(state,w,h){return [{id:'reset',x:w*.255,y:h*.937,kind:'click'},{id:'indicators',x:w*.745,y:h*.937,kind:'click',editorOnly:true}];},
  hitEdit(state,x,y,w,h){return y<h*.89||y>h*.985?null:x>=w*.04&&x<=w*.47?'reset':x>=w*.53&&x<=w*.96?'indicators':null;},
  dragEdit(state,handle){return {state:handle==='reset'?{...state,configuredStages:this._stages(state),position:0}:handle==='indicators'?{...state,showIndicators:state.showIndicators===false}:state};}
})
