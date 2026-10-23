const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {buildHttpIntegrationsExample,updateHttpIntegrationsExample}=require('../tools/update-http-integrations-example.cjs');
const root=path.join(__dirname,'..');

test('HTTP example keeps independent sources, JSON consumers and unrelated live controls',()=>{
  const workspace=buildHttpIntegrationsExample(),items=workspace.tabs[0].items;
  assert.deepEqual(buildHttpIntegrationsExample(),workspace,'rebuilds preserve component identities and authored state');
  const ids=new Set(items.map(item=>item.uid));assert.equal(ids.size,items.length);
  for(const item of items)for(const binding of Object.values(item.bindings||{}))assert.ok(ids.has(binding.uid));
  const sources=items.filter(item=>item.script?.includes('integrationApi:1'));
  assert.equal(sources.length,2);assert.notEqual(sources[0].inputValues.url,sources[1].inputValues.url);
  for(const item of sources){
    const fixture=JSON.parse(fs.readFileSync(path.join(root,item.inputValues.url),'utf8'));
    assert.equal(typeof fixture.value,'number');assert.ok(fixture.value>=0 && fixture.value<=100);
    assert.equal(item.inputValues.path,'/value');assert.equal(Object.hasOwn(item.state,'value'),false);
    assert.equal(Object.hasOwn(item.state,'json'),false);
  }
  assert.deepEqual(items.find(item=>item.uid==='http-name-extract').bindings.text,{uid:'http-workshop',port:'json'});
  assert.equal(items.find(item=>item.uid==='http-clock').inputValues.timezone,'UTC');
  assert.equal(items.find(item=>item.uid==='http-local-control').state.value,25);
});

test('HTTP builtin presents manual actions and reads transient results without changing authored state',()=>{
  const definition=vm.runInNewContext(fs.readFileSync(path.join(root,'examples/http-source.js'),'utf8'),{Intl,Date});
  const state=definition.initState(),before=JSON.stringify(state),ports=definition.outputs(state);
  assert.equal(ports.value.type,'number');assert.equal(ports.json.type,'string');
  assert.equal(definition.httpSource(state).timeoutMs,10000);
  const source={available:true,value:72,json:'{"value":72}',status:'ready',lastUpdated:42};
  const result=definition.compute({url:'https://example.test/data',path:'/value'},state,{source});
  assert.equal(result.value,72);assert.equal(result.json,source.json);assert.equal(result.available,true);
  assert.equal(JSON.stringify(state),before,'host results never enter persistent component state');
  assert.deepEqual(Array.from(definition.handles(state,340,208),handle=>handle.action.type),['httpGet','httpCredentials']);
  assert.equal(definition.hitEdit(state,70,168,340,208),'refresh');
  assert.equal(definition.hitEdit(state,250,168,340,208),'connection');
  assert.equal(definition.outputs({...state,valueType:'boolean'}).value.type,'boolean');
  assert.equal(ports.value.event,true);assert.equal(ports.json.event,true);
  assert.equal(definition.eventOutputs.completed.type,'string');assert.equal(definition.eventOutputs.failed.type,'string');
  assert.equal(definition.dataActions.refresh.trigger,'refresh');assert.equal(definition.inputs(state).refresh.event,'action');
  assert.equal(definition.httpSource(state).automation.polling,false);
  assert.equal(definition.httpSource({...state,polling:true,refreshOnChange:true,refreshOnStart:true}).automation.startup,true);
  assert.equal(definition.httpSource({...state,debounceSeconds:.4}).automation.debounceMs,400);
  assert.equal(definition.httpSource({...state,debounceSeconds:8.2}).automation.debounceMs,8200);
  assert.equal(definition.compute({},state,{source:{httpStatus:503}}).httpStatus,503);
});

test('automatic reads and explicit POST examples wire controls, completion logs and captured JSON drafts',()=>{
  const workspace=buildHttpIntegrationsExample();assert.equal(workspace.tabs.length,3);
  const ids=new Set();
  for(const tab of workspace.tabs){
    for(const item of tab.items){assert.equal(ids.has(item.uid),false);ids.add(item.uid);}
    const local=new Set(tab.items.map(item=>item.uid));
    for(const item of tab.items)for(const binding of [...Object.values(item.bindings||{}),...Object.values(item.eventBindings||{})])assert.ok(local.has(binding.uid));
  }
  const automatic=workspace.tabs[1].items,source=automatic.find(item=>item.uid==='http-auto-source');
  assert.equal(source.state.polling,true);assert.equal(source.state.refreshOnChange,true);assert.equal(source.state.refreshOnStart,true);
  assert.deepEqual(source.bindings.enabled,{uid:'http-auto-enabled',port:'value'});
  assert.deepEqual(automatic.find(item=>item.uid==='http-auto-log').eventBindings.line,{uid:'http-auto-source',port:'completed'});
  const post=workspace.tabs[2].items,writer=post.find(item=>item.uid==='http-post-source');
  assert.deepEqual(writer.bindings.body,{uid:'http-post-body',port:'text'});
  assert.deepEqual(writer.eventBindings.send,{uid:'http-post-trigger',port:'value'});
  assert.deepEqual(post.find(item=>item.uid==='http-post-log').eventBindings.line,{uid:'http-post-source',port:'completed'});
});

test('HTTP POST declares explicit sends only and displays a successful empty response',()=>{
  const definition=vm.runInNewContext(fs.readFileSync(path.join(root,'examples/http-post.js'),'utf8'),{Intl,Date});
  const state=definition.initState(),before=JSON.stringify(state),capability=definition.httpSource(state);
  assert.equal(capability.method,'POST');assert.equal(capability.body,'body');assert.equal(capability.idempotencyKey,'idempotencyKey');
  assert.equal(Object.hasOwn(capability,'automation'),false);assert.equal(definition.inputs(state).send.event,'action');
  assert.equal(definition.dataActions.send.type,'httpPost');assert.equal(definition.actionEvents.httpPost.success,'completed');
  assert.deepEqual(Array.from(definition.handles(state,340,208),handle=>handle.action.type),['httpPost','httpCredentials']);
  const result=definition.compute({},state,{source:{status:'ready',httpStatus:204,available:false,json:''}});
  assert.equal(result.httpStatus,204);assert.equal(result.available,false);
  const drawing=definition.children(state,definition.initStyle(),340,208,false,{outputs:result});
  assert.ok(drawing.some(child=>child.text==='Sent'));assert.equal(JSON.stringify(state),before);
  const failed=definition.compute({},state,{source:{status:'error',httpStatus:200,error:'Response could not be mapped'}});
  assert.ok(definition.children(state,definition.initStyle(),340,208,false,{outputs:failed}).some(child=>child.text==='Response error'));
});

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-http-example-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const examples=path.join(directory,'examples');fs.mkdirSync(examples);
  for(const name of fs.readdirSync(path.join(root,'examples')))if(name.endsWith('.js'))fs.copyFileSync(path.join(root,'examples',name),path.join(examples,name));
  const json=path.join(examples,'http-integrations.json'),html=path.join(examples,'http-integrations.html');
  fs.writeFileSync(json,'{"previous":true}\n');fs.writeFileSync(html,'<title>Previous</title>\n');
  return {root:directory,examples,json,html};
}

test('HTTP example publishes its JSON and HTML pair only after a successful export',async t=>{
  const f=fixture(t);
  await updateHttpIntegrationsExample({root:f.root,exportReader:async({workspacePath,readerPath,tabCount})=>{
    assert.equal(tabCount,3);assert.equal(fs.readFileSync(f.json,'utf8'),'{"previous":true}\n');
    assert.equal(JSON.parse(fs.readFileSync(workspacePath,'utf8')).tabs[0].id,'http-reads');
    fs.writeFileSync(readerPath,'<title>HTTP example</title>');
  }});
  assert.equal(JSON.parse(fs.readFileSync(f.json,'utf8')).tabs.length,3);
  assert.equal(fs.readFileSync(f.html,'utf8'),'<title>HTTP example</title>');
});

test('failed HTTP example export preserves the previous pair',async t=>{
  const f=fixture(t);
  await assert.rejects(updateHttpIntegrationsExample({root:f.root,exportReader:async()=>{throw new Error('export failed');}}),/export failed/);
  assert.equal(fs.readFileSync(f.json,'utf8'),'{"previous":true}\n');assert.equal(fs.readFileSync(f.html,'utf8'),'<title>Previous</title>\n');
  assert.equal(fs.readdirSync(f.examples).some(name=>name.startsWith('.http-integrations-')),false);
});
