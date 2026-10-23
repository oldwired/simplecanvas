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

test('MQTT example deliberately shares one Config across two sketches without automatic startup',()=>{
  const workspace=buildMqttIntegrationsExample();assert.deepEqual(buildMqttIntegrationsExample(),workspace);
  assert.equal(workspace.tabs.length,2);
  const all=workspace.tabs.flatMap(tab=>tab.items),ids=new Set(all.map(item=>item.uid));assert.equal(ids.size,all.length);
  const configs=all.filter(item=>item.script?.includes('mqttConfig(state)'));assert.equal(configs.length,1);
  const config=configs[0];assert.equal(config.state.connectOnStart,false);assert.equal(config.inputValues.url,'ws://127.0.0.1:8001/mqtt');
  const subscribers=all.filter(item=>item.script?.includes('mqttSource(state)'));assert.equal(subscribers.length,3);
  for(const item of subscribers){assert.deepEqual(item.mqttBinding,{sketchId:'mqtt-readings',componentUid:config.uid});assert.equal(Object.hasOwn(item.state,'value'),false);}
  assert.equal(all.find(item=>item.uid==='mqtt-workspace-settings').state.executionMode,'whole workspace');
  assert.equal(all.find(item=>item.uid==='mqtt-workspace-settings').workspaceSettings,true,'the synchronous startup hint enables whole-workspace execution');
  assert.equal(all.find(item=>item.uid==='mqtt-status').state.format,'text');
  assert.deepEqual(all.find(item=>item.uid==='mqtt-event-log').bindings.line,{uid:'mqtt-status',port:'value'});
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
    assert.equal(tabCount,2);assert.equal(fs.readFileSync(f.json,'utf8'),'{"previous":true}\n');
    assert.equal(JSON.parse(fs.readFileSync(workspacePath,'utf8')).tabs[0].id,'mqtt-readings');
    fs.writeFileSync(readerPath,'<title>MQTT example</title>');
  }});
  assert.equal(JSON.parse(fs.readFileSync(f.json,'utf8')).tabs.length,2);assert.equal(fs.readFileSync(f.html,'utf8'),'<title>MQTT example</title>');
});

test('failed MQTT example export preserves the previous artifacts',async t=>{
  const f=fixture(t);
  await assert.rejects(updateMqttIntegrationsExample({root:f.root,exportReader:async()=>{throw new Error('export failed');}}),/export failed/);
  assert.equal(fs.readFileSync(f.json,'utf8'),'{"previous":true}\n');assert.equal(fs.readFileSync(f.html,'utf8'),'<title>Previous</title>\n');
  assert.equal(fs.readdirSync(f.examples).some(name=>name.startsWith('.mqtt-integrations-')),false);
});
