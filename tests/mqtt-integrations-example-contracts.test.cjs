const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {buildMqttIntegrationsExample,updateMqttIntegrationsExample}=require('../tools/update-mqtt-integrations-example.cjs');
const root=path.join(__dirname,'..');
const definition=name=>vm.runInNewContext(fs.readFileSync(path.join(root,'examples',name),'utf8'),{Intl,Date});

test('MQTT builtins expose manual connection actions and transient typed readings',()=>{
  const config=definition('mqtt-config.js'),state=config.initState(),before=JSON.stringify(state);
  assert.equal(config.mqttConfig(state).startup,false);
  assert.equal(config.mqttConfig({...state,connectOnStart:true}).startup,true);
  assert.deepEqual(Array.from(config.handles(state,360,208),handle=>handle.action.type),['mqttConnect','mqttDisconnect','mqttCredentials']);
  for(const [x,id] of [[60,'connect'],[180,'disconnect'],[300,'credentials']])assert.equal(config.hitEdit(state,x,172,360,208),id);
  const result=config.compute({},state,{source:{connected:true,status:'connected',error:''}});
  assert.equal(result.connected,true);assert.equal(result.status,'connected');assert.equal(JSON.stringify(state),before);
  assert.equal(Object.hasOwn(config.inputs,'username'),false);assert.equal(Object.hasOwn(config.inputs,'password'),false);
  const source=definition('mqtt-subscribe.js'),sourceState=source.initState(),sourceBefore=JSON.stringify(sourceState);
  assert.equal(source.outputs(sourceState).value.type,'number');assert.equal(source.outputs(sourceState).value.event,true);
  assert.equal(source.outputs({...sourceState,valueType:'string'}).value.type,'string');
  assert.equal(source.outputs({...sourceState,valueType:'boolean'}).value.type,'boolean');
  const reading=source.compute({},sourceState,{source:{available:true,value:72,json:'{"value":72}',status:'ready',lastUpdated:42,topic:'demo/reading'}});
  assert.equal(reading.value,72);assert.equal(reading.json,'{"value":72}');assert.equal(reading.topic,'demo/reading');
  assert.equal(JSON.stringify(sourceState),sourceBefore,'live readings never enter component state');
  const text=source.compute({},{...sourceState,format:'text',valueType:'string'},{source:{available:true,value:'Online',topic:'demo/status'}});
  assert.equal(text.value,'Online');assert.equal(text.json,'');
  const stale=source.compute({},sourceState,{source:{available:false,stale:true,value:72,lastUpdated:42,status:'disconnected'}});
  assert.equal(stale.available,false);assert.equal(stale.stale,true);assert.equal(stale.lastUpdated,42);
});

test('MQTT Publish declares explicit sends and renders broker acknowledgement separately from device execution',()=>{
  const publish=definition('mqtt-publish.js'),state=publish.initState(),before=JSON.stringify(state);
  assert.deepEqual(JSON.parse(JSON.stringify(publish.mqttPublish(state))),{topic:'topic',payload:'payload',format:'text',retain:false,timeoutMs:10000});
  assert.equal(publish.inputs.send.event,'action');assert.equal(publish.inputs.send.default,false);
  assert.equal(publish.dataActions.send.type,'mqttPublish');assert.equal(publish.actionEvents.mqttPublish.success,'completed');
  assert.equal(publish.handles(state,360,208)[0].action.type,'mqttPublish');assert.equal(publish.hitEdit(state,180,172,360,208),'send');
  const outputs=publish.compute({},state,{source:{loading:false,status:'ready',error:'',lastPublished:42}});
  assert.equal(outputs.status,'ready');assert.equal(outputs.lastPublished,42);assert.equal(JSON.stringify(state),before);
  const children=publish.children(state,publish.initStyle(),360,208,false,{name:'My command',inputs:{topic:'demo/command'},outputs});
  assert.ok(children.some(child=>child.text==='My command'));
  assert.ok(children.some(child=>child.text==='Broker acknowledged'));
  assert.ok(children.some(child=>child.text?.includes('execution by device')));
  assert.equal(Object.hasOwn(publish.inputs,'username'),false);assert.equal(Object.hasOwn(publish.inputs,'password'),false);
});

test('MQTT example shares one Config across readings and explicit commands without automatic startup',()=>{
  const workspace=buildMqttIntegrationsExample();assert.deepEqual(buildMqttIntegrationsExample(),workspace);
  assert.equal(workspace.tabs.length,3);
  const all=workspace.tabs.flatMap(tab=>tab.items),ids=new Set(all.map(item=>item.uid));assert.equal(ids.size,all.length);
  const configs=all.filter(item=>item.script?.includes('mqttConfig(state)'));assert.equal(configs.length,1);
  const config=configs[0];assert.equal(config.state.connectOnStart,false);assert.equal(config.inputValues.url,'ws://127.0.0.1:8001/mqtt');
  const subscribers=all.filter(item=>item.script?.includes('mqttSource(state)'));assert.equal(subscribers.length,4);
  for(const item of subscribers){assert.deepEqual(item.mqttBinding,{sketchId:'mqtt-readings',componentUid:config.uid});assert.equal(Object.hasOwn(item.state,'value'),false);}
  assert.equal(all.find(item=>item.uid==='mqtt-workspace-settings').state.executionMode,'whole workspace');
  assert.equal(all.find(item=>item.uid==='mqtt-workspace-settings').workspaceSettings,true,'the synchronous startup hint enables whole-workspace execution');
  assert.equal(all.find(item=>item.uid==='mqtt-status').state.format,'text');
  assert.deepEqual(all.find(item=>item.uid==='mqtt-event-log').bindings.line,{uid:'mqtt-status',port:'value'});
  const publish=all.find(item=>item.uid==='mqtt-command-publish');
  assert.equal(publish.state.retain,false);assert.equal(publish.state.format,'json');
  assert.deepEqual(publish.mqttBinding,{sketchId:'mqtt-readings',componentUid:config.uid});
  assert.deepEqual(publish.bindings.payload,{uid:'mqtt-command-json',port:'text'});
  assert.equal(publish.inputValues.send,false,'the example never starts with a Send intent');
  assert.deepEqual(all.find(item=>item.uid==='mqtt-command-acks').eventBindings.line,{uid:publish.uid,port:'completed'});
  assert.deepEqual(all.find(item=>item.uid==='mqtt-command-replies').bindings.line,{uid:'mqtt-command-reply',port:'json'});
  for(const tab of workspace.tabs){const local=new Set(tab.items.map(item=>item.uid));for(const item of tab.items)for(const binding of Object.values(item.bindings||{}))assert.ok(local.has(binding.uid),'ordinary flow wires stay local');}
});

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-mqtt-example-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const examples=path.join(directory,'examples');fs.mkdirSync(examples);
  for(const name of fs.readdirSync(path.join(root,'examples')))if(name.endsWith('.js'))fs.copyFileSync(path.join(root,'examples',name),path.join(examples,name));
  const json=path.join(examples,'mqtt-integrations.json'),html=path.join(examples,'mqtt-integrations.html');
  fs.writeFileSync(json,'{"previous":true}\n');fs.writeFileSync(html,'<title>Previous</title>\n');
  return {root:directory,examples,json,html};
}

test('MQTT example publishes JSON/HTML only after a successful export',async t=>{
  const f=fixture(t);
  await updateMqttIntegrationsExample({root:f.root,exportReader:async({workspacePath,readerPath,tabCount})=>{
    assert.equal(tabCount,3);assert.equal(fs.readFileSync(f.json,'utf8'),'{"previous":true}\n');
    assert.equal(JSON.parse(fs.readFileSync(workspacePath,'utf8')).tabs[0].id,'mqtt-readings');
    fs.writeFileSync(readerPath,'<title>MQTT example</title>');
  }});
  assert.equal(JSON.parse(fs.readFileSync(f.json,'utf8')).tabs.length,3);assert.equal(fs.readFileSync(f.html,'utf8'),'<title>MQTT example</title>');
});

test('failed MQTT example export preserves the previous artifacts',async t=>{
  const f=fixture(t);
  await assert.rejects(updateMqttIntegrationsExample({root:f.root,exportReader:async()=>{throw new Error('export failed');}}),/export failed/);
  assert.equal(fs.readFileSync(f.json,'utf8'),'{"previous":true}\n');assert.equal(fs.readFileSync(f.html,'utf8'),'<title>Previous</title>\n');
  assert.equal(fs.readdirSync(f.examples).some(name=>name.startsWith('.mqtt-integrations-')),false);
});
