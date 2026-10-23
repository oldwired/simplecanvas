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
    valueType:{type:'string',default:'number',options:['number','string','boolean'],label:'Value type'},
    timeoutSeconds:{type:'number',default:10,min:1,max:30,step:1,label:'Timeout (seconds)'},
    polling:{type:'boolean',default:false,label:'Refresh at intervals'},
    refreshOnChange:{type:'boolean',default:false,label:'Refresh when URL or JSON pointer changes'},
    debounceSeconds:{type:'number',default:.25,min:0,max:10,step:.05,label:'Change delay (seconds)'},
    refreshOnStart:{type:'boolean',default:false,label:'Refresh on startup in Run / HTML'},
    showIndicators:{type:'boolean',default:true,label:'Show status details'}
  },
  inputs:{url:{type:'string',default:'',label:'URL'},path:{role:'control',type:'string',default:'/value',label:'JSON pointer'},
    refresh:{role:'control',type:'boolean',default:false,event:'action'},
    enabled:{role:'control',type:'boolean',default:true,label:'Automatic reads enabled'},
    interval:{role:'control',type:'number',default:5,label:'Refresh interval (seconds)'}},
  httpSource(state){return {url:'url',path:'path',valueType:state.valueType,timeoutMs:state.timeoutSeconds*1000,
    automation:{enabled:'enabled',interval:'interval',polling:state.polling===true,onChange:state.refreshOnChange===true,
      debounceMs:Math.round((state.debounceSeconds??.25)*1000),startup:state.refreshOnStart===true}};},
  outputs(state){
    if(!['number','string','boolean'].includes(state.valueType))throw new Error('Choose number, string or boolean as value type');
    return {value:{type:state.valueType,event:true},json:{type:'string',event:true,label:'JSON text'},
      available:{role:'control',type:'boolean'},loading:{role:'control',type:'boolean'},stale:{role:'control',type:'boolean'},
      error:{type:'string'},lastUpdated:{type:'number',label:'Last updated (epoch ms)'},status:{type:'string'},httpStatus:{type:'number',label:'HTTP status'}};
  },
  initState(){return {valueType:'number',timeoutSeconds:10,polling:false,refreshOnChange:false,debounceSeconds:.25,refreshOnStart:false,showIndicators:true};},
  initStyle(){return {w:340,h:208,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state,context={}){
    this.outputs(state);
    const source=context.source||{},empty=state.valueType==='number'?0:state.valueType==='boolean'?false:'';
    return {value:source.available?source.value:empty,json:source.available?source.json:'',available:source.available===true,
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
    return {type:'text',x,y,w,h,text,plainText:true,align:'left',font:weight+' '+size+'px sans-serif',color,strokeOn:false};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/340,h/208),pad=12*scale,out=io.outputs||{},name=io.name?.trim()||'HTTP source';
    const text=(value,x,y,ww,hh,size,color,weight)=>this._text(value,x,y,ww,hh,size*scale,style,color,weight);
    const ready=out.available===true,loading=out.loading===true,error=io.error||out.error||'';
    const formatted=typeof out.value==='number'?Number.isSafeInteger(out.value)?String(out.value):String(Number(out.value.toPrecision(8))):String(out.value??'');
    const message=loading?'Loading…':error?'Request failed':ready?(formatted||'(empty)'):out.status==='disabled'?'Network reads disabled':'Ready to refresh';
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      text(name,pad,pad,w-pad*2,21*scale,14,undefined,600),
      text(message,pad,42*scale,w-pad*2,30*scale,ready?22:18,error?'#b91c1c':undefined,600),
      text(error||io.inputs?.url||'Set a URL in Edit',pad,80*scale,w-pad*2,20*scale,11,error?'#b91c1c':'#64748b')
    ];
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:112*scale,w:8*scale,h:8*scale,fill:true,fillColor:error?'#dc2626':loading?'#d97706':ready?'#15803d':'#94a3b8',strokeOn:false});
      const updated=out.lastUpdated?new Date(out.lastUpdated).toLocaleTimeString():'';
      children.push(text((io.inputs?.path||'Root')+' · '+state.valueType+(updated?' · '+updated:''),pad+15*scale,107*scale,w-pad*2-15*scale,18*scale,10,'#64748b'));
      const modes=[state.polling?'Every '+(io.inputs?.interval??5)+' s':'',state.refreshOnChange?'On change':'',state.refreshOnStart?'At startup':''].filter(Boolean);
      if(modes.length)children.push(text(io.inputs?.enabled===false?'Automatic reads off':modes.join(' · '),pad,128*scale,w-pad*2,16*scale,10,'#64748b'));
    }
    const y=h-58*scale,bh=40*scale,leftWidth=(w-pad*3)*.51;
    children.push({type:'rect',x:pad,y,w:leftWidth,h:bh,fill:true,fillColor:'#eef2ff',strokeOn:true,color:'#818cf8',size:1},
      text(loading?'Refresh again':'Refresh',pad+12*scale,y+10*scale,leftWidth-24*scale,21*scale,13,'#3730a3',600),
      {type:'rect',x:pad*2+leftWidth,y,w:w-pad*3-leftWidth,h:bh,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#cbd5e1',size:1},
      text('Connection…',pad*2+leftWidth+10*scale,y+10*scale,w-pad*3-leftWidth-20*scale,21*scale,12,'#475569'));
    return children;
  },
  handles(state,w,h){
    const scale=Math.min(w/340,h/208),pad=12*scale,leftWidth=(w-pad*3)*.51,y=h-38*scale;
    return [{id:'refresh',kind:'action',x:pad+leftWidth/2,y,action:{type:'httpGet'}},
      {id:'connection',kind:'action',x:pad*2+leftWidth+(w-pad*3-leftWidth)/2,y,action:{type:'httpCredentials'}}];
  },
  hitEdit(state,x,y,w,h){
    const scale=Math.min(w/340,h/208),pad=12*scale,leftWidth=(w-pad*3)*.51;
    if(y<h-58*scale || y>h-18*scale)return null;
    if(x>=pad && x<=pad+leftWidth)return 'refresh';
    return x>=pad*2+leftWidth && x<=w-pad?'connection':null;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,io);}
})
