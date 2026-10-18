// Shift all stages simultaneously on each observed rising pulse. Q0 receives the input.
// value aliases the last stage; shiftedOut holds the OLD final stage from the latest shift.
// Cascade through value with a shared pulse: every register samples the old outputs together.
({
  apiVersion:2,
  settings:{stages:{type:'number',default:4,min:1,max:16,step:1,label:'Stages'}},
  inputs:{value:{type:'number'},pulse:{type:'boolean',default:false},reset:{type:'boolean',default:false}},
  outputs(state){
    const ports={};for(let i=0;i<this._stages(state);i++)ports['q'+i]={type:'number'};
    return {...ports,value:{type:'number'},shiftedOut:{type:'number'}};
  },
  initState(){return {stages:4,configuredStages:4,cells:Array(4).fill(0),shiftedOut:0,showIndicators:true};},
  initStyle(){return {w:440,h:240,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _valid(value){return Number.isFinite(value);},
  _stages(state){
    if(!Number.isInteger(state.stages) || state.stages<1 || state.stages>16)throw new Error('Stages must be an integer from 1 to 16');
    return state.stages;
  },
  _snapshot(state){
    const stages=this._stages(state);
    if(!Number.isInteger(state.configuredStages) || state.configuredStages<1 || state.configuredStages>16 ||
      !Array.isArray(state.cells) || state.cells.length!==state.configuredStages || !Array.from(state.cells).every(value=>this._valid(value)) || !this._valid(state.shiftedOut))
      throw new Error('Shift register state requires matching stages and finite numeric stored values');
    return state.configuredStages!==stages?{cells:Array(stages).fill(0),shiftedOut:0}:{cells:state.cells.slice(),shiftedOut:state.shiftedOut};
  },
  _validate(inputs,state){
    this._snapshot(state);
    if(!this._valid(inputs.value))throw new Error('Shift register requires a finite numeric input');
    if(typeof inputs.pulse!=='boolean' || typeof inputs.reset!=='boolean')throw new Error('Pulse and reset must be Boolean values');
  },
  transition(inputs,state,memory){
    this._validate(inputs,state);
    const stages=this._stages(state),changed=state.configuredStages!==stages || memory?.stages!==stages;
    let {cells,shiftedOut}=this._snapshot(state);
    if(inputs.reset){cells=Array(stages).fill(0);shiftedOut=0;}
    else if(!changed && memory?.previous===false && inputs.pulse){
      shiftedOut=cells[stages-1];cells=[inputs.value,...cells.slice(0,-1)];
    }
    return {state:{...state,configuredStages:stages,cells,shiftedOut},memory:{stages,previous:inputs.pulse},nextWakeAt:null};
  },
  compute(inputs,state){this._validate(inputs,state);return this.publish(state);},
  publish(state){
    const {cells,shiftedOut}=this._snapshot(state),outputs={};
    for(let i=0;i<cells.length;i++)outputs['q'+i]=cells[i];
    return {...outputs,value:cells[cells.length-1],shiftedOut};
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
    const stages=Number.isInteger(state.stages)&&state.stages>=1&&state.stages<=16?state.stages:4;
    const rawInputs=io.inputs||{},rawOutputs=io.outputs||{},scale=Math.min(w/440,h/240);
    const available=!io.error&&this._valid(rawInputs.value)&&typeof rawInputs.pulse==='boolean'&&typeof rawInputs.reset==='boolean'&&
      this._valid(rawOutputs.value)&&this._valid(rawOutputs.shiftedOut)&&Array.from({length:stages},(_,i)=>rawOutputs['q'+i]).every(value=>this._valid(value));
    const inputs=available?rawInputs:{},outputs=available?rawOutputs:{};
    const label=value=>!this._valid(value)?'—':typeof value==='boolean'?(value?'1':'0'):String(value).length<=8?String(value):Number(value.toPrecision(3)).toString();
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:'600 '+Math.max(5,size*scale)+'px sans-serif',color:style.textColor||style.color,strokeOn:false,fill:false});
    const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true});
    const arrow=(x1,y,x2)=>[line(x1,y,x2,y),line(x2-4*scale,y-3*scale,x2,y),line(x2-4*scale,y+3*scale,x2,y)];
    const children=[
      {...text('',w*.04,0,w*.92,h*.15,16,'left'),...this._caption(io.name,'Shift register',w*.92,h*.15,{...style,fontSize:16*scale})},
      {...text('',w*.01,h*.15,w*.29,h*.07,10),...this._caption('In: '+label(inputs.value),'In: —',w*.29,h*.07,{...style,fontSize:10*scale})},
      {...text('',w*.31,h*.15,w*.34,h*.07,10),...this._caption('Q'+(stages-1)+' / value: '+label(outputs.value),'Q'+(stages-1)+' / value: —',w*.34,h*.07,{...style,fontSize:10*scale})},
      {...text('',w*.66,h*.15,w*.33,h*.07,10),...this._caption('Shifted out: '+label(outputs.shiftedOut),'Shifted out: —',w*.33,h*.07,{...style,fontSize:10*scale})}
    ];
    const rows=stages>8?2:1,columns=Math.min(stages,8),spacing=w*.76/columns,cellW=Math.min(62*scale,spacing*.78),cellH=h*(rows===1?.20:.135);
    const center=i=>({x:w*.12+spacing*((i%columns)+.5),y:h*(rows===1?.47:Math.floor(i/columns)===0?.38:.65)});
    const led=(x,y,value,radius=3*scale)=>{
      const present=typeof value==='boolean'||Number.isFinite(value);
      children.push({type:'ellipse',x:x-radius,y:y-radius,w:radius*2,h:radius*2,fill:true,
        fillColor:present?(typeof value==='number'?'#2563eb':value?'#15803d':'#64748b'):'#fbbf24',strokeOn:true,color:present?'#f8fafc':'#b45309',size:Math.max(.5,scale*.7)});
    };
    const first=center(0),last=center(stages-1);
    children.push(...arrow(w*.02,first.y,first.x-cellW/2),...arrow(last.x+cellW/2,last.y,w*.98));
    for(let i=0;i<stages;i++){
      const {x,y}=center(i),value=outputs['q'+i],left=x-cellW/2,top=y-cellH/2;
      if(i>0 && i%columns!==0){const previous=center(i-1);children.push(...arrow(previous.x+cellW/2,y,left));}
      children.push(
        {type:'rect',x:left,y:top,w:cellW,h:cellH,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
        text('Q'+i,left,y-cellH/2-h*.08,cellW,h*.07,10),
        {...text('',left,top,cellW,cellH*(state.showIndicators===false?1:.67),15),...this._caption(label(value),'—',cellW+8,cellH*(state.showIndicators===false?1:.67),{...style,fontSize:15*scale})}
      );
      if(state.showIndicators!==false)led(x,y+cellH*.30,value,Math.min(3*scale,cellW*.09));
    }
    if(rows===2){
      const end=center(columns-1),next=center(columns),mid=h*.475;
      children.push(line(end.x+cellW/2,end.y,w*.965,end.y),line(w*.965,end.y,w*.965,mid),
        line(w*.965,mid,w*.035,mid),line(w*.035,mid,w*.035,next.y),...arrow(w*.035,next.y,next.x-cellW/2));
    }
    children.push(text('Pulse: '+(typeof inputs.pulse==='boolean'?String(inputs.pulse):'—'),w*.07,h*.77,w*.39,h*.08,10),
      text('Reset: '+(typeof inputs.reset==='boolean'?String(inputs.reset):'—'),w*.56,h*.77,w*.39,h*.08,10));
    if(state.showIndicators!==false){led(w*.055,h*.81,inputs.pulse);led(w*.545,h*.81,inputs.reset);}
    if(!available)children.push({...text(!io.error || /^Missing value or binding/.test(io.error)?'Input required':'Input unavailable',w*.04,h*.88,w*.92,h*.10,10),color:'#92400e'});
    else if(editing){
      for(const [x,label,editorOnly] of [[w*.05,'Reset',false],[w*.53,'Indicators: '+(state.showIndicators!==false?'on':'off'),true]]){
        children.push({type:'rect',x,y:h*.88,w:w*.42,h:h*.09,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly});
        children.push({...text(label,x,h*.88,w*.42,h*.09,10),editorOnly});
      }
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,inputs:{},outputs:{},error:io.error||'Input unavailable'});},
  handles(state,w,h){return [{id:'reset',x:w*.26,y:h*.925,kind:'click'},{id:'indicators',x:w*.74,y:h*.925,kind:'click',editorOnly:true}];},
  hitEdit(state,x,y,w,h){
    if(y<h*.88 || y>h*.97)return null;
    return x>=w*.05&&x<=w*.47?'reset':x>=w*.53&&x<=w*.95?'indicators':null;
  },
  dragEdit(state,handle){
    if(handle==='reset'){const stages=this._stages(state);return {state:{...state,configuredStages:stages,cells:Array(stages).fill(0),shiftedOut:0}};}
    return {state:handle==='indicators'?{...state,showIndicators:state.showIndicators===false}:state};
  }
})
