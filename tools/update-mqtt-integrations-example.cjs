// Build a small MQTT application example and export it through SimpleCanvas itself.
// Serve the repository root over HTTP(S), then open examples/mqtt-integrations.html.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {exportWorkspaceReader}=require('./update-example-workspace.cjs');
const root=path.join(__dirname,'..');
const copy=value=>JSON.parse(JSON.stringify(value));

function buildMqttIntegrationsExample({root:directory=root}={}){
  const scripts=new Map();
  function component(file,uid,name,x,y,options={}){
    if(!scripts.has(file)){
      const source=fs.readFileSync(path.join(directory,'examples',file),'utf8');
      scripts.set(file,{source,definition:vm.runInNewContext(source,{Intl,Date,Math},{timeout:1000})});
    }
    const {source,definition}=scripts.get(file),state={...copy(definition.initState?.()||{}),...options.state};
    const style={w:280,h:100,fontSize:16,...copy(definition.initStyle?.()||{})};
    const ports=typeof definition.inputs==='function'?definition.inputs(state):definition.inputs||{};
    const values=Object.fromEntries(Object.entries(ports).filter(([,port])=>Object.hasOwn(port,'default')).map(([key,port])=>[key,copy(port.default)]));
    return {type:'smart',uid,componentApi:2,componentName:name,x,y,color:'#64748b',size:1.5,fill:true,fillColor:'#ffffff',
      strokeOn:true,textColor:'#334155',fontFamily:'sans',fontSize:16,font:'16px sans-serif',...style,
      script:source,...options,state,inputValues:{...values,...options.inputValues}};
  }
  const text=(uid,value,x,y,w=1220,h=48,size=18)=>({type:'text',uid,text:value,x,y,w,h,size:1,color:'#334155',textColor:'#334155',
    fontFamily:'sans',fontSize:size,font:`${size}px sans-serif`,align:'left',strokeOn:false,fill:false,fillColor:'#ffffff'});
  const bind=(uid,port='value')=>({uid,port});
  const main=[
    text('mqtt-title','MQTT · one connection, several live readings',40,24,1240,44,28),
    text('mqtt-intro','Start node tools/serve-mqtt-example.cjs, then click Apply / Connect. JSON drives the Gauge; the text topic drives the label and event log.',40,78,1240,54,18),
    component('mqtt-config.js','mqtt-config','Local demo broker',40,140,{inputValues:{url:'ws://127.0.0.1:8001/mqtt'}}),
    component('number-control.js','mqtt-local-control','Local control · independent of MQTT',440,140,{w:300,h:142,state:{value:25}}),
    component('live-clock.js','mqtt-clock','Clock · keeps running',800,140,{w:160,h:210,state:{showIndicators:false},inputValues:{timezone:'UTC'}}),
    component('workspace-settings.js','mqtt-workspace-settings','Whole workspace execution',1000,140,{w:270,h:184,workspaceSettings:true,state:{executionMode:'whole workspace'},inputValues:{title:'MQTT integration example'}}),
    component('mqtt-subscribe.js','mqtt-reading','Workshop reading',40,370,{inputValues:{topic:'simplecanvas/demo/reading',path:'/value'},mqttBinding:{sketchId:'mqtt-readings',componentUid:'mqtt-config'}}),
    component('mqtt-subscribe.js','mqtt-status','Workshop message',420,370,{state:{format:'text',valueType:'string'},inputValues:{topic:'simplecanvas/demo/status',path:''},mqttBinding:{sketchId:'mqtt-readings',componentUid:'mqtt-config'}}),
    component('gauge.js','mqtt-reading-gauge','Workshop · 0–100',800,370,{w:220,h:160,fill:false,bindings:{value:bind('mqtt-reading')}}),
    component('gauge.js','mqtt-control-gauge','Local slider',1060,370,{w:210,h:160,fill:false,bindings:{value:bind('mqtt-local-control')}}),
    component('text-label.js','mqtt-status-label','Latest message',40,570,{w:720,h:80,fontSize:27,state:{showName:true},bindings:{value:bind('mqtt-status')}}),
    component('text-label.js','mqtt-connection-label','Connection status',40,650,{w:330,h:85,fontSize:20,state:{showName:true},strokeOn:true,color:'#cbd5e1',bindings:{value:bind('mqtt-config','status')}}),
    component('text-label.js','mqtt-error-label','Connection error',410,650,{w:350,h:85,fontSize:16,state:{showName:true},strokeOn:true,color:'#cbd5e1',bindings:{value:bind('mqtt-config','error')}}),
    component('memo.js','mqtt-event-log','Fresh message events',800,570,{w:470,h:205,fontSize:16,state:{logMode:true,maxLines:6,showCounts:true},inputValues:{showScrollbar:true},bindings:{line:bind('mqtt-status')}}),
    text('mqtt-help','Retained / initial readings establish a value without appending to the log. Later live messages append once, including equal text. Disconnect makes the reading unavailable; its timestamp and stale status remain visible.',40,780,1230,70,16),
  ];
  const other=[
    text('mqtt-shared-title','Another sketch · the same MQTT Config',40,24,1240,44,28),
    text('mqtt-shared-intro','This workspace uses Whole workspace execution. The connection on the first sketch stays active while this view subscribes through the same Config.',40,78,1240,60,18),
    component('mqtt-subscribe.js','mqtt-other-reading','Second view of Workshop',40,172,{inputValues:{topic:'simplecanvas/demo/reading',path:'/value'},mqttBinding:{sketchId:'mqtt-readings',componentUid:'mqtt-config'}}),
    component('gauge.js','mqtt-other-gauge','Shared reading',450,172,{w:330,h:220,fill:false,bindings:{value:bind('mqtt-other-reading')}}),
    component('text-label.js','mqtt-other-json','Complete JSON message',840,172,{w:430,h:220,fontSize:19,state:{showName:true},strokeOn:true,color:'#cbd5e1',bindings:{value:bind('mqtt-other-reading','json')}}),
    text('mqtt-shared-help','Try it\n• Connect on the first sketch, then switch between the two views. They share one broker connection.\n• Stop and restart the example server: the Config shows reconnecting, then subscriptions recover.\n• Disconnect explicitly: it stays disconnected until Apply / Connect.\n• In the editor, Subscribe → Edit lets you choose an MQTT Config by sketch and instance name.',40,420,1230,210,19),
    text('mqtt-shared-policies','Defaults\nManual connection. No credentials saved unless explicitly included in an export. Initial / retained messages never emit actions. Pause or hiding the browser suspends connections; resuming reconnects. In Active sketch mode, leaving a sketch disconnects its Config and returning requires Connect. The third sketch sends explicit commands through this same Config.',40,650,1230,170,18),
  ];
  const commands=[
    text('mqtt-command-title','Commands & replies · broker receipt and device response',40,24,1240,44,28),
    text('mqtt-command-intro','Connect the Local demo broker on the first sketch. Choose a value, then click Send. Changing the slider only prepares the JSON; it never sends a command by itself.',40,78,1240,60,18),
    component('number-control.js','mqtt-command-value','Requested value · 0–100',40,160,{w:320,h:144,state:{value:65}}),
    component('json-build.js','mqtt-command-json','Command JSON',410,160,{w:330,h:144,state:{fields:'value:number',showIndicators:false},bindings:{field0:bind('mqtt-command-value')}}),
    component('mqtt-publish.js','mqtt-command-publish','Send to demo device',800,160,{w:470,h:208,state:{format:'json'},inputValues:{topic:'simplecanvas/demo/command'},bindings:{payload:bind('mqtt-command-json','text')},mqttBinding:{sketchId:'mqtt-readings',componentUid:'mqtt-config'}}),
    text('mqtt-command-capture','Each Send captures the topic and payload.\nNo queue while disconnected; reconnect never replays a command.',40,320,700,52,17),
    component('mqtt-subscribe.js','mqtt-command-reply','Demo device reply',40,400,{w:360,h:176,inputValues:{topic:'simplecanvas/demo/reply',path:'/value'},mqttBinding:{sketchId:'mqtt-readings',componentUid:'mqtt-config'}}),
    component('gauge.js','mqtt-command-gauge','Applied value',440,400,{w:220,h:176,fill:false,bindings:{value:bind('mqtt-command-reply')}}),
    component('text-label.js','mqtt-command-response','Complete device response',710,400,{w:560,h:176,fontSize:19,state:{showName:true},strokeOn:true,color:'#cbd5e1',bindings:{value:bind('mqtt-command-reply','json')}}),
    text('mqtt-command-ack-heading','Broker acknowledgements · sent payload',40,596,380,24,17),
    text('mqtt-command-reply-heading','Device reply events',450,596,380,24,17),
    text('mqtt-command-error-heading','Failed sends',860,596,410,24,17),
    component('memo.js','mqtt-command-acks','Broker acknowledgements',40,630,{w:380,h:142,fontSize:15,state:{logMode:true,maxLines:5,showCounts:false},inputValues:{showScrollbar:true},eventBindings:{line:bind('mqtt-command-publish','completed')}}),
    component('memo.js','mqtt-command-replies','Device replies',450,630,{w:380,h:142,fontSize:15,state:{logMode:true,maxLines:5,showCounts:false},inputValues:{showScrollbar:true},bindings:{line:bind('mqtt-command-reply','json')}}),
    component('memo.js','mqtt-command-errors','Failed sends',860,630,{w:410,h:142,fontSize:15,state:{logMode:true,maxLines:5,showCounts:false},inputValues:{showScrollbar:true},eventBindings:{line:bind('mqtt-command-publish','failed')}}),
    text('mqtt-command-help','QoS 1 confirms broker receipt, not device execution. This local demo simulates a device response on a separate topic after a short delay. Retain is off for commands; a retained reply supplies the initial display without adding a log entry. Try sending the same value twice.',40,792,1230,60,16),
  ];
  const tab=(id,name,scene)=>({id,name,items:scene,datasets:{},assets:{}});
  return {app:'SimpleCanvasWorkspace',version:5,activeIndex:0,tabs:[tab('mqtt-readings','MQTT readings',main),tab('mqtt-shared','Shared connection',other),tab('mqtt-commands','Commands & replies',commands)]};
}

async function updateMqttIntegrationsExample({root:directory=root,exportReader=exportWorkspaceReader,io=fs}={}){
  const examples=path.join(directory,'examples'),workspace=buildMqttIntegrationsExample({root:directory});
  const staging=io.mkdtempSync(path.join(examples,'.mqtt-integrations-')),targets=['mqtt-integrations.json','mqtt-integrations.html'];
  const previous=targets.map(name=>{const target=path.join(examples,name);return io.existsSync(target)?io.readFileSync(target):null;});
  let keepRecovery=false;
  try{
    const stagedWorkspace=path.join(staging,targets[0]),stagedReader=path.join(staging,targets[1]);
    io.writeFileSync(stagedWorkspace,JSON.stringify(workspace,null,2)+'\n');
    await exportReader({root:directory,workspacePath:stagedWorkspace,readerPath:stagedReader,tabCount:workspace.tabs.length});
    if(!io.statSync(stagedReader).isFile() || !io.statSync(stagedReader).size)throw new Error('HTML export is empty');
    for(let index=0;index<targets.length;index++){
      const target=path.join(examples,targets[index]),current=io.existsSync(target)?io.readFileSync(target):null;
      if(previous[index]===null?current!==null:current===null || !current.equals(previous[index]))
        throw new Error('MQTT example artifacts changed during export; generated files were not published');
      if(previous[index]!==null)io.writeFileSync(path.join(staging,'previous-'+targets[index]),previous[index]);
    }
    const published=[];
    try{
      for(const name of targets){io.renameSync(path.join(staging,name),path.join(examples,name));published.push(name);}
    }catch(error){
      const recovery=[];
      for(const name of published.reverse())try{
        const index=targets.indexOf(name),target=path.join(examples,name);
        if(previous[index]===null)io.unlinkSync(target);else io.renameSync(path.join(staging,'previous-'+name),target);
      }catch(failure){recovery.push(failure);}
      if(recovery.length){keepRecovery=true;throw new AggregateError([error,...recovery],'Publishing failed; recovery copies remain in '+staging);}
      throw error;
    }
    return {tabCount:workspace.tabs.length};
  }finally{if(!keepRecovery)io.rmSync(staging,{recursive:true,force:true});}
}

module.exports={buildMqttIntegrationsExample,updateMqttIntegrationsExample};
if(require.main===module)updateMqttIntegrationsExample()
  .then(({tabCount})=>console.log('Updated '+tabCount+' MQTT integration sketches and self-contained HTML reader.'))
  .catch(error=>{console.error(error);process.exitCode=1;});
