// Explicit MQTT QoS 1 publication through an existing host-owned Config.
// Broker acknowledgement does not prove device execution; disconnected sends are never queued.
({
  apiVersion:2,
  eventApi:1,
  integrationApi:1,
  eventOutputs:{completed:{type:'string'},failed:{type:'string'}},
  actionEvents:{mqttPublish:{success:'completed',failure:'failed'}},
  dataActions:{send:{type:'mqttPublish',trigger:'send'}},
  settings:{
    format:{type:'string',default:'text',options:['text','json'],label:'Payload format'},
    retain:{type:'boolean',default:false,label:'Retain the message on the broker'},
    timeoutSeconds:{type:'number',default:10,min:1,max:30,step:1,label:'Acknowledgement timeout (seconds)'},
    showIndicators:{type:'boolean',default:true,label:'Show delivery details'}
  },
  inputs:{topic:{type:'string',default:'',label:'Topic'},payload:{type:'string',default:'',label:'Payload'},
    send:{role:'control',type:'boolean',default:false,event:'action'}},
  mqttPublish(state){return {topic:'topic',payload:'payload',format:state.format,retain:state.retain===true,timeoutMs:state.timeoutSeconds*1000};},
  outputs:{loading:{type:'boolean',role:'control'},status:{type:'string'},error:{type:'string'},lastPublished:{type:'number',label:'Last broker acknowledgement (epoch ms)'}},
  initState(){return {format:'text',retain:false,timeoutSeconds:10,showIndicators:true};},
  initStyle(){return {w:360,h:208,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state,context={}){
    const source=context.source||{};
    return {loading:source.loading===true,status:source.status||'idle',error:source.error||'',lastPublished:source.lastPublished||0};
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
    const scale=Math.min(w/360,h/208),pad=12*scale,out=io.outputs||{},name=io.name?.trim()||'MQTT Publish';
    const text=(value,x,y,ww,hh,size,color,weight)=>this._text(value,x,y,ww,hh,size*scale,style,color,weight);
    const error=io.error||out.error||'',loading=out.loading===true,ready=out.status==='ready';
    const setup=!io.error && !loading && !ready && (!String(io.inputs?.topic||'').trim() || error==='Choose an available MQTT Config in Edit');
    const problem=error && !setup;
    const message=out.status==='disabled'?'Network disabled':out.status==='cancelled'?'Send cancelled':setup?'Set up publication':loading?'Awaiting broker…':problem?'Send failed':ready?'Broker acknowledged':'Ready to send';
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      text(name,pad,pad,w-pad*2,21*scale,14,undefined,600),
      text(message,pad,42*scale,w-pad*2,30*scale,20,problem?'#b91c1c':undefined,600)
    ];
    if(problem)children.push(...this._message(error,pad,80*scale,w-pad*2,12,scale,style,'#b91c1c'));
    else if(setup)children.push(...this._message('Choose an MQTT Config and enter a topic in Edit.',pad,80*scale,w-pad*2,12,scale,style,'#64748b'));
    else children.push(text(io.inputs?.topic||'Topic not configured',pad,80*scale,w-pad*2,20*scale,12,'#64748b'));
    if(state.showIndicators!==false){
      const row=problem||setup?128:110;
      children.push({type:'ellipse',x:pad,y:(row+5)*scale,w:8*scale,h:8*scale,fill:true,fillColor:problem?'#dc2626':loading?'#d97706':ready?'#15803d':'#94a3b8',strokeOn:false},
        text('QoS 1 · '+(state.retain?'Retained':'Not retained')+' · '+(state.format==='json'?'JSON':'Text'),pad+15*scale,row*scale,w-pad*2-15*scale,17*scale,11,'#64748b'));
      if(!problem && !setup)children.push(text('Receipt by broker ≠ execution by device',pad,131*scale,w-pad*2,16*scale,11,'#64748b'));
    }
    const y=h-58*scale;
    children.push({type:'rect',x:pad,y,w:w-pad*2,h:40*scale,fill:true,fillColor:loading?'#f1f5f9':'#eef2ff',strokeOn:true,color:loading?'#cbd5e1':'#818cf8',size:1},
      {...text(loading?'Sending…':'Send',pad+12*scale,y+11*scale,w-pad*2-24*scale,18*scale,13,loading?'#64748b':'#3730a3',600),align:'center'});
    return children;
  },
  handles(state,w,h){const scale=Math.min(w/360,h/208);return [{id:'send',kind:'action',x:w/2,y:h-38*scale,action:{type:'mqttPublish'}}];},
  hitEdit(state,x,y,w,h){const scale=Math.min(w/360,h/208),pad=12*scale;return x>=pad&&x<=w-pad&&y>=h-58*scale&&y<=h-18*scale?'send':null;},
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,io);}
})
