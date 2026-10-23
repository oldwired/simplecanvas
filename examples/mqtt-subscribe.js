// A typed reading from an explicitly selected MQTT Config. Host results are transient.
({
  apiVersion:2,
  eventApi:1,
  integrationApi:1,
  settings:{
    format:{type:'string',default:'json',options:['text','json'],label:'Payload format'},
    valueType:{type:'string',default:'number',options:['number','string','boolean'],label:'Value type'},
    showIndicators:{type:'boolean',default:true,label:'Show status details'}
  },
  inputs:{topic:{type:'string',default:'',label:'Topic / filter'},
    path:{role:'control',type:'string',default:'/value',label:'JSON pointer (JSON payloads)'}},
  mqttSource(state){return {topic:'topic',path:'path',format:state.format,valueType:state.valueType};},
  outputs(state){
    if(!['number','string','boolean'].includes(state.valueType))throw new Error('Choose number, string or boolean as value type');
    return {value:{type:state.valueType,event:true},json:{type:'string',event:true,label:'JSON text'},
      available:{role:'control',type:'boolean'},stale:{role:'control',type:'boolean'},
      error:{type:'string'},lastUpdated:{type:'number',label:'Last updated (epoch ms)'},status:{type:'string'},topic:{type:'string',label:'Last topic'}};
  },
  initState(){return {format:'json',valueType:'number',showIndicators:true};},
  initStyle(){return {w:340,h:176,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state,context={}){
    this.outputs(state);
    const source=context.source||{},empty=state.valueType==='number'?0:state.valueType==='boolean'?false:'';
    return {value:source.available?source.value:empty,json:source.available?(source.json||''):'',available:source.available===true,
      stale:source.stale===true,error:source.error||'',lastUpdated:source.lastUpdated||0,status:source.status||'disconnected',topic:source.topic||''};
  },
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400){
    const content=String(value).replace(/\s+/g,' ');
    const chars=typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'
      ?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(content),part=>part.segment):Array.from(content);
    let text='',used=0;
    for(let index=0;index<chars.length;index++){
      const char=chars[index],units=/[MWmw@#%]/.test(char)||char.codePointAt(0)>255?1.1:/[A-Z]/.test(char)?.88:.72;
      if((used+units+(index<chars.length-1?1.1:0))*size>w){text+='…';break;}
      text+=char;used+=units;
    }
    return {type:'text',x,y,w,h,text,plainText:true,align:'left',font:weight+' '+size+'px sans-serif',color,textColor:color,strokeOn:false};
  },
  _message(value,x,y,w,size,scale,style,color){
    const content=String(value).replace(/\s+/g,' ').trim(),first=this._text(content,x,y,w,17*scale,size*scale,style,color);
    if(!first.text.endsWith('…'))return [first];
    let line=first.text.slice(0,-1),space=line.lastIndexOf(' ');
    if(space>line.length/2)line=line.slice(0,space);
    first.text=line;
    return [first,this._text(content.slice(line.length).trimStart(),x,y+18*scale,w,17*scale,size*scale,style,color)];
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/340,h/176),pad=12*scale,out=io.outputs||{},name=io.name?.trim()||'MQTT Subscribe';
    const text=(value,x,y,ww,hh,size,color,weight)=>this._text(value,x,y,ww,hh,size*scale,style,color,weight);
    const ready=out.available===true,error=io.error||out.error||'',stale=out.stale===true;
    const setup=!io.error && !ready && (!String(io.inputs?.topic||'').trim() || error==='Choose an available MQTT Config in Edit');
    const problem=error && !setup;
    const labels={idle:'Disconnected',unbound:'Choose a connection',disconnected:'Disconnected',connecting:'Connecting…',reconnecting:'Reconnecting…',suspended:'Connection paused',disabled:'Network disabled',waiting:'Waiting for a reading',ready:'Live reading',error:'Subscription error'};
    const formatted=typeof out.value==='number'?Number.isSafeInteger(out.value)?String(out.value):String(Number(out.value.toPrecision(8))):String(out.value??'');
    const message=out.status==='disabled'?labels.disabled:setup?'Set up subscription':problem?'Subscription error':ready?(formatted||'(empty)'):out.status==='suspended'?labels.suspended:stale?'Reading is stale':labels[out.status]||'Waiting for a reading';
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      text(name,pad,pad,w-pad*2,21*scale,14,undefined,600),
      text(message,pad,42*scale,w-pad*2,30*scale,ready?24:20,problem?'#b91c1c':undefined,600)
    ];
    if(problem)children.push(...this._message(error,pad,80*scale,w-pad*2,12,scale,style,'#b91c1c'));
    else if(setup)children.push(...this._message('Choose an MQTT Config and enter a topic in Edit.',pad,80*scale,w-pad*2,12,scale,style,'#64748b'));
    else children.push(text(io.inputs?.topic||'Topic not configured',pad,80*scale,w-pad*2,20*scale,12,'#64748b'));
    if(state.showIndicators!==false){
      const row=problem||setup?128:110;
      children.push({type:'ellipse',x:pad,y:(row+5)*scale,w:8*scale,h:8*scale,fill:true,fillColor:problem?'#dc2626':ready?'#15803d':stale?'#d97706':'#94a3b8',strokeOn:false});
      const updated=out.lastUpdated?new Date(out.lastUpdated).toLocaleTimeString():'';
      const status=setup?'Not configured':labels[out.status]||'No current reading';
      children.push(text(status+(updated?' · '+updated:''),pad+15*scale,row*scale,w-pad*2-15*scale,17*scale,11,'#64748b'));
      if(!problem && !setup)children.push(text(state.format==='json'?'JSON '+(io.inputs?.path||'(root)')+' → '+state.valueType:'Text → '+state.valueType,pad,137*scale,w-pad*2,18*scale,11,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,io);}
})
