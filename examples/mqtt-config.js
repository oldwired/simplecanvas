// A host-owned MQTT connection. Credentials and live clients never enter component state.
({
  apiVersion:2,
  integrationApi:1,
  settings:{
    connectOnStart:{type:'boolean',default:false,label:'Connect on opening in Run / HTML'},
    showIndicators:{type:'boolean',default:true,label:'Show connection details'}
  },
  inputs:{url:{type:'string',default:'',label:'Broker WebSocket URL'},
    clientId:{type:'string',default:'',label:'Client ID (empty = unique per session)'}},
  mqttConfig(state){return {url:'url',clientId:'clientId',startup:state.connectOnStart===true};},
  outputs:{connected:{type:'boolean',role:'control'},status:{type:'string'},error:{type:'string'}},
  initState(){return {connectOnStart:false,showIndicators:true};},
  initStyle(){return {w:360,h:208,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state,context={}){
    const source=context.source||{};
    return {connected:source.connected===true,status:source.status||'disconnected',error:source.error||''};
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
    const scale=Math.min(w/360,h/208),pad=12*scale,out=io.outputs||{},name=io.name?.trim()||'MQTT Config';
    const text=(value,x,y,ww,hh,size,color,weight)=>this._text(value,x,y,ww,hh,size*scale,style,color,weight);
    const error=io.error||out.error||'',connected=out.connected===true,source=io.source||{};
    const labels={idle:'Disconnected',connected:'Connected',connecting:'Connecting…',reconnecting:'Reconnecting…',disconnected:'Disconnected',suspended:'Connection paused',disabled:'Network disabled',error:'Connection error'};
    const setup=!error && !connected && ['idle','disconnected',undefined].includes(out.status) && !String(io.inputs?.url||'').trim();
    const status=setup?'Set up connection':labels[out.status]||'Disconnected';
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      text(name,pad,pad,w-pad*2,21*scale,14,undefined,600),
      {type:'ellipse',x:pad,y:51*scale,w:10*scale,h:10*scale,fill:true,fillColor:error?'#dc2626':connected?'#15803d':['connecting','reconnecting'].includes(out.status)?'#d97706':'#94a3b8',strokeOn:false},
      text(status,pad+20*scale,42*scale,w-pad*2-20*scale,30*scale,21,error?'#b91c1c':undefined,600)
    ];
    if(error)children.push(...this._message(error,pad,80*scale,w-pad*2,12,scale,style,'#b91c1c'));
    else children.push(text(source.connectedUrl||io.inputs?.url||'Enter a broker WebSocket URL in Edit',pad,80*scale,w-pad*2,20*scale,12,'#64748b'));
    if(state.showIndicators!==false){
      if(!error)children.push(text(io.inputs?.clientId?'Client ID: '+io.inputs.clientId:'Unique client ID for this session',pad,110*scale,w-pad*2,18*scale,11,'#64748b'));
      children.push(text(source.pending?'Draft changed · Apply to reconnect':state.connectOnStart?'Connect on opening in Run / HTML':'Manual connection',pad,131*scale,w-pad*2,17*scale,11,source.pending?'#92400e':'#64748b'));
    }
    const y=h-58*scale,bh=40*scale,bw=(w-pad*4)/3;
    const action=source.pending?'Apply':connected?'Reconnect':['connecting','reconnecting'].includes(out.status)?'Retry':'Connect';
    for(const [index,label] of [action,'Disconnect','Credentials…'].entries()){
      const x=pad+index*(bw+pad);
      children.push({type:'rect',x,y,w:bw,h:bh,fill:true,fillColor:index===0?'#eef2ff':'#f8fafc',strokeOn:true,color:index===0?'#818cf8':'#cbd5e1',size:1},
        {type:'text',x:x+6*scale,y:y+11*scale,w:bw-12*scale,h:18*scale,text:label,plainText:true,align:'center',font:(index===0?'600 ':'400 ')+12*scale+'px sans-serif',color:index===0?'#3730a3':'#475569',textColor:index===0?'#3730a3':'#475569',strokeOn:false});
    }
    return children;
  },
  handles(state,w,h){
    const scale=Math.min(w/360,h/208),pad=12*scale,bw=(w-pad*4)/3,y=h-38*scale;
    return ['connect','disconnect','credentials'].map((id,index)=>({id,kind:'action',x:pad+index*(bw+pad)+bw/2,y,
      action:{type:['mqttConnect','mqttDisconnect','mqttCredentials'][index]}}));
  },
  hitEdit(state,x,y,w,h){
    const scale=Math.min(w/360,h/208),pad=12*scale,bw=(w-pad*4)/3;
    if(y<h-58*scale || y>h-18*scale)return null;
    for(let index=0;index<3;index++){const left=pad+index*(bw+pad);if(x>=left && x<=left+bw)return ['connect','disconnect','credentials'][index];}
    return null;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,io);}
})
