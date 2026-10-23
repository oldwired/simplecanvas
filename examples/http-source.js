// JSON GET through the host integration service. Live results never enter saved state.
// The host withholds value/json while unavailable, independently of optional status wiring.
({
  apiVersion:2,
  eventApi:1,
  integrationApi:1,
  eventOutputs:{completed:{type:'string'},failed:{type:'string'}},
  actionEvents:{httpGet:{success:'completed',failure:'failed'}},
  dataActions:{refresh:{type:'httpGet',trigger:'refresh'}},
  settings:{
    authMode:{type:'string',default:'session',options:['session','none','bearer','basic'],label:'Authentication'},
    valueType:{type:'string',default:'number',options:['number','string','boolean','table'],label:'Response type'},
    timeoutSeconds:{type:'number',default:10,min:1,max:30,step:1,label:'Timeout (seconds)'},
    polling:{type:'boolean',default:false,label:'Refresh at intervals'},
    refreshOnChange:{type:'boolean',default:false,label:'Refresh when URL or JSON pointer changes'},
    debounceSeconds:{type:'number',default:.25,min:0,max:10,step:.05,label:'Change delay (seconds)'},
    refreshOnStart:{type:'boolean',default:false,label:'Refresh on startup in Run / HTML'},
    showIndicators:{type:'boolean',default:true,label:'Show status details'}
  },
  _auth(state){
    const mode=state.authMode??'session';
    if(!['session','none','bearer','basic'].includes(mode))throw new Error('Choose session credentials, no authentication, Bearer token input or Basic auth inputs');
    return {mode,...(mode==='bearer'?{token:'token'}:mode==='basic'?{username:'username',password:'password'}:{})};
  },
  inputs(state){
    const auth=this._auth(state),ports={url:{type:'string',default:'',label:'URL'},path:{role:'control',type:'string',default:'/value',label:'JSON pointer'},
    refresh:{role:'control',type:'boolean',default:false,event:'action'},
    enabled:{role:'control',type:'boolean',default:true,label:'Automatic reads enabled'},
    interval:{role:'control',type:'number',default:5,label:'Refresh interval (seconds)'}};
    if(auth.mode==='bearer')ports.token={role:'control',type:'string',default:'',label:'Bearer token'};
    if(auth.mode==='basic'){
      ports.username={role:'control',type:'string',default:'',label:'Username'};
      ports.password={role:'control',type:'string',default:'',label:'Password'};
    }
    return ports;
  },
  httpSource(state){return {auth:this._auth(state),url:'url',path:'path',valueType:state.valueType,timeoutMs:state.timeoutSeconds*1000,
    automation:{enabled:'enabled',interval:'interval',polling:state.polling===true,onChange:state.refreshOnChange===true,
      debounceMs:Math.round((state.debounceSeconds??.25)*1000),startup:state.refreshOnStart===true}};},
  outputs(state){
    if(!['number','string','boolean','table'].includes(state.valueType))throw new Error('Choose number, string, boolean or table as response type');
    return {value:{type:state.valueType,...(state.valueType==='table'?{label:'Table'}:{event:true})},json:{type:'string',event:true,label:'JSON text'},
      ...(state.valueType==='table'?{rowCount:{type:'number',label:'Row count'}}:{}),jsonAvailable:{role:'control',type:'boolean',label:'JSON text available'},
      available:{role:'control',type:'boolean'},loading:{role:'control',type:'boolean'},stale:{role:'control',type:'boolean'},
      error:{type:'string'},lastUpdated:{type:'number',label:'Last updated (epoch ms)'},status:{type:'string'},httpStatus:{type:'number',label:'HTTP status'}};
  },
  initState(){return {authMode:'session',valueType:'number',timeoutSeconds:10,polling:false,refreshOnChange:false,debounceSeconds:.25,refreshOnStart:false,showIndicators:true};},
  initStyle(){return {w:340,h:208,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state,context={}){
    this.outputs(state);
    const source=context.source||{},table=state.valueType==='table',empty=state.valueType==='number'?0:state.valueType==='boolean'?false:'';
    const jsonAvailable=source.available===true && source.jsonAvailable!==false;
    return {...(table?source.available?{value:{table:source.value},rowCount:source.value.rows.length}:{rowCount:0}:{value:source.available?source.value:empty}),
      json:jsonAvailable?source.json:'',jsonAvailable,available:source.available===true,
      loading:source.loading===true,stale:source.stale===true,error:source.error||'',lastUpdated:source.lastUpdated||0,status:source.status||'idle',httpStatus:source.httpStatus||0};
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
    const scale=Math.min(w/340,h/208),pad=12*scale,out=io.outputs||{},name=io.name?.trim()||'HTTP GET';
    const text=(value,x,y,ww,hh,size,color,weight)=>this._text(value,x,y,ww,hh,size*scale,style,color,weight);
    const ready=out.available===true,loading=out.loading===true,error=io.error||out.error||'',stale=out.stale===true;
    const setup=!error && !loading && !ready && out.status!=='ready' && !String(io.inputs?.url||'').trim();
    const table=state.valueType==='table',columns=io.tables?.outputs?.value?.columns||out.value?.table?.columns;
    const formatted=table?out.rowCount+' '+(out.rowCount===1?'row':'rows')+(columns?' · '+columns.length+' '+(columns.length===1?'column':'columns'):''):
      typeof out.value==='number'?Number.isSafeInteger(out.value)?String(out.value):String(Number(out.value.toPrecision(8))):String(out.value??'');
    const message=out.status==='disabled'?'Network disabled':out.status==='cancelled'?'Request cancelled':loading?'Loading…':error?(out.httpStatus>=200 && out.httpStatus<300?'Response error':'Request failed'):ready?(formatted||'(empty)'):stale?'Reading is stale':setup?'Set up request':'Ready to refresh';
    const success=ready || out.status==='ready',color=error?'#b91c1c':undefined;
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      text(name,pad,pad,w-pad*2,21*scale,14,undefined,600),
      text(message,pad,42*scale,w-pad*2,30*scale,ready?(table?18:24):20,color,600)
    ];
    if(error)children.push(...this._message(error,pad,80*scale,w-pad*2,12,scale,style,'#b91c1c'));
    else children.push(text(io.inputs?.url||'Enter an HTTP(S) URL in Edit',pad,80*scale,w-pad*2,20*scale,12,'#64748b'));
    if(state.showIndicators!==false){
      const row=error?128:110;
      children.push({type:'ellipse',x:pad,y:(row+5)*scale,w:8*scale,h:8*scale,fill:true,fillColor:error?'#dc2626':loading||stale?'#d97706':success?'#15803d':'#94a3b8',strokeOn:false});
      const updated=out.lastUpdated?new Date(out.lastUpdated).toLocaleTimeString():'';
      const mapping=(io.inputs?.path||'Root')+' → '+state.valueType;
      children.push(text(error?(updated?'Last received '+updated:'No current reading'):mapping+(updated?' · '+updated:''),pad+15*scale,row*scale,w-pad*2-15*scale,17*scale,11,'#64748b'));
      const modes=[state.polling?'Every '+(io.inputs?.interval??5)+' s':'',state.refreshOnChange?'On change':'',state.refreshOnStart?'At startup':''].filter(Boolean);
      const policy=io.inputs?.enabled===false && modes.length?'Automatic refresh off':modes.join(' · ')||'Manual refresh';
      if(!error)children.push(text(ready && out.jsonAvailable===false?'JSON text exceeds 2,000 characters':policy,pad,131*scale,w-pad*2,16*scale,11,'#64748b'));
    }
    const sessionAuth=(state.authMode??'session')==='session',y=h-58*scale,bh=40*scale,leftWidth=sessionAuth?(w-pad*3)*.51:w-pad*2;
    const button=(label,x,width,primary)=>[
      {type:'rect',x,y,w:width,h:bh,fill:true,fillColor:primary?'#eef2ff':'#f8fafc',strokeOn:true,color:primary?'#818cf8':'#cbd5e1',size:1},
      {...text(label,x+8*scale,y+11*scale,width-16*scale,18*scale,13,primary?'#3730a3':'#475569',primary?600:400),align:'center'}
    ];
    children.push(...button(loading?'Refresh again':'Refresh',pad,leftWidth,true));
    if(sessionAuth)children.push(...button('Credentials…',pad*2+leftWidth,w-pad*3-leftWidth,false));
    return children;
  },
  handles(state,w,h){
    const scale=Math.min(w/340,h/208),pad=12*scale,sessionAuth=(state.authMode??'session')==='session',leftWidth=sessionAuth?(w-pad*3)*.51:w-pad*2,y=h-38*scale;
    return [{id:'refresh',kind:'action',x:pad+leftWidth/2,y,action:{type:'httpGet'}},
      ...(sessionAuth?[{id:'connection',kind:'action',x:pad*2+leftWidth+(w-pad*3-leftWidth)/2,y,action:{type:'httpCredentials'}}]:[])];
  },
  hitEdit(state,x,y,w,h){
    const scale=Math.min(w/340,h/208),pad=12*scale,sessionAuth=(state.authMode??'session')==='session',leftWidth=sessionAuth?(w-pad*3)*.51:w-pad*2;
    if(y<h-58*scale || y>h-18*scale)return null;
    if(x>=pad && x<=pad+leftWidth)return 'refresh';
    return sessionAuth && x>=pad*2+leftWidth && x<=w-pad?'connection':null;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,io);}
})
