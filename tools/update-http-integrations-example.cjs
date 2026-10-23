// Build a small HTTP application example and export it through SimpleCanvas itself.
// Serve the repository root over HTTP(S), then open examples/http-integrations.html.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {exportWorkspaceReader}=require('./update-example-workspace.cjs');
const root=path.join(__dirname,'..');
const copy=value=>JSON.parse(JSON.stringify(value));

function buildHttpIntegrationsExample({root:directory=root}={}){
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
  const items=[
    text('http-title','HTTP reads · values and JSON text',40,24,1240,44,28),
    text('http-intro','Click Refresh on each source. Requests run independently; the clock and slider keep working while a response is pending.',40,78,1240,54,18),
    component('http-source.js','http-workshop','Workshop reading',40,158,{inputValues:{url:'/examples/http-reading.json',path:'/value'}}),
    component('http-source.js','http-store','Store room reading',420,158,{inputValues:{url:'/examples/http-reading-alternate.json',path:'/value'}}),
    component('number-control.js','http-local-control','Local control · always responsive',800,158,{w:250,h:142,state:{value:25}}),
    component('live-clock.js','http-clock','Clock · keeps running',1090,158,{w:180,h:250,state:{showIndicators:false},inputValues:{timezone:'UTC'}}),
    component('gauge.js','http-workshop-gauge','Workshop',40,402,{w:300,h:150,fill:false,bindings:{value:bind('http-workshop')}}),
    component('gauge.js','http-store-gauge','Store room',420,402,{w:300,h:150,fill:false,bindings:{value:bind('http-store')}}),
    component('gauge.js','http-local-gauge','Local slider',800,402,{w:300,h:150,fill:false,bindings:{value:bind('http-local-control')}}),
    component('json-extract.js','http-name-extract','Name from JSON',40,582,{state:{resultType:'string',showIndicators:false},
      inputValues:{pointer:'/name'},bindings:{text:bind('http-workshop','json')}}),
    component('text-label.js','http-name-label','Extracted name',390,582,{w:310,h:100,state:{showName:true},fontSize:28,
      bindings:{value:bind('http-name-extract')}}),
    component('text-label.js','http-json-label','Complete JSON response',760,582,{w:510,h:150,state:{showName:true},fontSize:15,
      strokeOn:true,color:'#cbd5e1',size:1,bindings:{value:bind('http-workshop','json')}}),
    text('http-how-to','Try it\n• Change value or name in either JSON file, save it, then Refresh.\n• Change one URL to a missing file: its error does not stop the other source.\n• With a slow endpoint, move the slider and watch the clock during Loading.',40,760,740,134,16),
    text('http-serving','Start node tools/serve-http-example.cjs for editor, Run and HTML. Add ?delay=2500 to either URL for a slow response. CORS and local-network permission still apply. Try the other sketches for polling, events and POST.',800,760,470,134,15),
  ];
  const automatic=[
    text('http-auto-title','Automatic reads · one event per completed request',40,24,1240,44,28),
    text('http-auto-intro','This source polls every two seconds and refreshes after a URL change. Its completed event appends each response to the log, even when two responses are identical.',40,78,1240,54,18),
    component('text-input.js','http-auto-url','Endpoint URL',40,144,{w:790,h:72,state:{values:['/examples/api/reading'],placeholder:'Endpoint URL',showHints:false}}),
    component('toggle.js','http-auto-enabled','Automatic reads',880,144,{w:160,h:90,state:{value:true}}),
    component('trigger.js','http-auto-trigger','Refresh event',1080,134,{w:190,h:128,state:{showIndicators:false}}),
    component('http-source.js','http-auto-source','Changing reading',40,274,{state:{polling:true,refreshOnChange:true,refreshOnStart:true},
      bindings:{url:bind('http-auto-url'),enabled:bind('http-auto-enabled'),interval:bind('http-auto-interval')},
      eventBindings:{refresh:bind('http-auto-trigger')}}),
    component('number-control.js','http-auto-interval','Interval in seconds',40,518,{w:340,h:142,state:{value:2},inputValues:{min:1,max:10,step:1}}),
    component('live-clock.js','http-auto-clock','Still running',40,686,{w:160,h:200,state:{showIndicators:false},inputValues:{timezone:'UTC'}}),
    component('gauge.js','http-auto-gauge','Current reading',220,706,{w:180,h:145,fill:false,bindings:{value:bind('http-auto-source')}}),
    component('memo.js','http-auto-log','Successful requests',430,274,{w:840,h:386,fontSize:17,state:{logMode:true,maxLines:10,showCounts:true},
      inputValues:{showScrollbar:true},eventBindings:{line:bind('http-auto-source','completed')}}),
    component('text-label.js','http-auto-error','Request error',430,690,{w:840,h:100,fontSize:18,state:{showName:true},strokeOn:true,color:'#cbd5e1',
      bindings:{value:bind('http-auto-source','error')}}),
    text('http-auto-help','Try /examples/http-reading.json to log the same JSON repeatedly. Add ?delay=2500 to see non-overlapping polls, or ?status=503 for an error. Turn Automatic reads off to pause polling. Manual Refresh remains available.',430,810,840,80,16),
  ];
  const post=[
    text('http-post-title','HTTP POST · build a payload, then send it explicitly',40,24,1240,44,28),
    text('http-post-intro','Changing fields only changes the draft JSON. Click Send on the POST component, or press the connected trigger. Each completed response is recorded in the log.',40,78,1240,54,18),
    component('number-control.js','http-post-value','Value to send',40,144,{w:300,h:142,state:{value:37}}),
    component('text-input.js','http-post-name','Name',400,144,{w:430,h:72,state:{values:['Workshop'],placeholder:'Name',showHints:false}}),
    component('text-input.js','http-post-key','Idempotency key',870,144,{w:400,h:72,state:{placeholder:'Optional idempotency key',showHints:false}}),
    text('http-post-name-label','Name in the JSON body',400,232,430,38,14),
    text('http-post-key-label','Optional: reuse a key for the same logical write.',870,232,400,56,14),
    component('json-build.js','http-post-body','Draft JSON body',40,334,{w:340,h:160,state:{showIndicators:false},
      bindings:{field0:bind('http-post-name'),field1:bind('http-post-value')}}),
    component('http-post.js','http-post-source','Send to local demo endpoint',400,334,{inputValues:{url:'/examples/api/echo',path:'/value'},
      bindings:{body:bind('http-post-body','text'),idempotencyKey:bind('http-post-key')},eventBindings:{send:bind('http-post-trigger')}}),
    component('gauge.js','http-post-gauge','Returned value',800,334,{w:300,h:180,fill:false,bindings:{value:bind('http-post-source')}}),
    component('trigger.js','http-post-trigger','Send once',40,560,{w:280,h:170,state:{showIndicators:false}}),
    component('text-label.js','http-post-error','Send / response error',400,600,{w:340,h:108,fontSize:16,state:{showName:true},strokeOn:true,color:'#cbd5e1',
      bindings:{value:bind('http-post-source','error')}}),
    component('memo.js','http-post-log','Completed responses',800,570,{w:470,h:290,fontSize:15,state:{logMode:true,maxLines:6,showCounts:true},
      inputValues:{showScrollbar:true},eventBindings:{line:bind('http-post-source','completed')}}),
    text('http-post-help','The demo server keeps writes only in memory. Reusing a key with the same JSON returns the original response; changing the JSON under that key returns 409. No write is retried automatically. A timeout or response error cannot prove the server did not accept a write.',40,770,700,115,16),
  ];
  const tab=(id,name,scene)=>({id,name,items:scene,datasets:{},assets:{}});
  return {app:'SimpleCanvasWorkspace',version:5,activeIndex:0,tabs:[tab('http-reads','HTTP reads',items),
    tab('http-automatic','Automatic reads',automatic),tab('http-post','HTTP POST',post)]};
}

async function updateHttpIntegrationsExample({root:directory=root,exportReader=exportWorkspaceReader,io=fs}={}){
  const examples=path.join(directory,'examples'),workspace=buildHttpIntegrationsExample({root:directory});
  const staging=io.mkdtempSync(path.join(examples,'.http-integrations-')),targets=['http-integrations.json','http-integrations.html'];
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
        throw new Error('HTTP example artifacts changed during export; generated files were not published');
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

module.exports={buildHttpIntegrationsExample,updateHttpIntegrationsExample};
if(require.main===module)updateHttpIntegrationsExample()
  .then(({tabCount})=>console.log('Updated '+tabCount+' HTTP integration sketches and self-contained HTML reader.'))
  .catch(error=>{console.error(error);process.exitCode=1;});
