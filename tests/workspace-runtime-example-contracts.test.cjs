const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {buildWorkspaceRuntimeExample,updateWorkspaceRuntimeExample}=require('../tools/update-workspace-runtime-example.cjs');
const root=path.join(__dirname,'..');

test('the separate application example has stable, resolvable identities and deliberate catalog sharing',()=>{
  const workspace=buildWorkspaceRuntimeExample(),[services,dashboard,editor]=workspace.tabs;
  assert.deepEqual(workspace.tabs.map(tab=>tab.id),['runtime-services','runtime-dashboard','runtime-editor']);
  assert.equal(workspace.activeIndex,1);
  const ids=workspace.tabs.flatMap(tab=>tab.items.map(item=>item.uid));
  assert.equal(ids.length,new Set(ids).size);
  const settings=services.items.find(item=>item.workspaceSettings);
  assert.equal(settings.state.executionMode,'whole workspace');
  assert.equal(settings.state.initialSketchId,dashboard.id);
  assert.deepEqual(settings.state.tabVisibility.map(tab=>tab.visible),[false,true,true]);
  assert.equal(services.items.find(item=>item.uid==='runtime-stock-owner').datasetShared,true);
  assert.equal(services.items.find(item=>item.uid==='runtime-private-owner').datasetShared,false);
  for(const tab of workspace.tabs)for(const item of tab.items){
    if(item.workspaceReceive){
      assert.equal(item.workspaceEndpoint,'receive');
      for(const [id,ref] of Object.entries(item.workspaceReceive)){
        const source=workspace.tabs.find(tab=>tab.id===ref.sketchId)?.items.find(source=>source.uid===ref.componentUid);
        assert.equal(source?.workspaceEndpoint,'publish');
        assert.ok(source.state.endpoints.some(endpoint=>endpoint.id===ref.port));
        assert.equal(item.state.endpoints.find(endpoint=>endpoint.id===id)?.type,source.state.endpoints.find(endpoint=>endpoint.id===ref.port).type);
      }
    }
    for(const ref of Object.values(item.inputValues||{}))if(ref?.datasetId){
      const owner=ref.sketchId?workspace.tabs.find(tab=>tab.id===ref.sketchId):tab;
      assert.ok(owner.datasets[ref.datasetId]);
    }
  }
  const capture=services.items.find(item=>item.uid==='runtime-capture');
  assert.equal(capture.state.allowReaderCapture,true);
  assert.equal(capture.eventBindings.capture.uid,'runtime-receive-message');
  assert.deepEqual(capture.bindings.field1,{uid:'runtime-receive-message',port:'quantity'});
  assert.deepEqual(dashboard.items.find(item=>item.uid==='runtime-publish-message').state.endpoints.map(endpoint=>endpoint.id),['value','quantity']);
  assert.deepEqual(dashboard.items.find(item=>item.uid==='runtime-dashboard-clock').state.endpoints.map(endpoint=>endpoint.id),['value','tick']);
  assert.deepEqual(dashboard.items.find(item=>item.uid==='runtime-dashboard-tick').bindings.value,{uid:'runtime-dashboard-clock',port:'tick'});
  assert.equal(dashboard.items.find(item=>item.uid==='runtime-quantity').state.value,1);
  assert.equal(editor.items.find(item=>item.uid==='runtime-stock-editor').state.allowReaderEdit,true);
});

function fixture(t,{existing=true}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-workspace-runtime-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const examples=path.join(directory,'examples');fs.mkdirSync(examples);
  for(const name of fs.readdirSync(path.join(root,'examples')))if(name.endsWith('.js'))
    fs.copyFileSync(path.join(root,'examples',name),path.join(examples,name));
  const json=path.join(examples,'workspace-runtime.json'),html=path.join(examples,'workspace-runtime.html');
  if(existing){fs.writeFileSync(json,'{"previous":true}\n');fs.writeFileSync(html,'<title>Previous</title>\n');}
  return {root:directory,examples,json,html};
}

test('the new demo publishes JSON and HTML only after successful export',async t=>{
  const f=fixture(t);
  await updateWorkspaceRuntimeExample({root:f.root,exportReader:async({workspacePath,readerPath,tabCount})=>{
    assert.equal(tabCount,3);
    assert.equal(fs.readFileSync(f.json,'utf8'),'{"previous":true}\n');
    assert.equal(JSON.parse(fs.readFileSync(workspacePath,'utf8')).tabs[0].id,'runtime-services');
    fs.writeFileSync(readerPath,'<title>New</title>');
  }});
  assert.equal(JSON.parse(fs.readFileSync(f.json,'utf8')).tabs.length,3);
  assert.equal(fs.readFileSync(f.html,'utf8'),'<title>New</title>');
});

test('a failed first export leaves neither artifact behind',async t=>{
  const f=fixture(t,{existing:false});
  await assert.rejects(updateWorkspaceRuntimeExample({root:f.root,exportReader:async()=>{throw new Error('export failed');}}),/export failed/);
  assert.equal(fs.existsSync(f.json),false);assert.equal(fs.existsSync(f.html),false);
  assert.equal(fs.readdirSync(f.examples).some(name=>name.startsWith('.workspace-runtime-')),false);
});

test('a second publication failure restores the prior JSON/HTML pair',async t=>{
  const f=fixture(t),io=Object.create(fs);
  io.renameSync=(source,target)=>{
    if(target===f.html && path.basename(source)==='workspace-runtime.html')throw new Error('publication failed');
    fs.renameSync(source,target);
  };
  await assert.rejects(updateWorkspaceRuntimeExample({root:f.root,io,exportReader:async({readerPath})=>fs.writeFileSync(readerPath,'new')}),/publication failed/);
  assert.equal(fs.readFileSync(f.json,'utf8'),'{"previous":true}\n');
  assert.equal(fs.readFileSync(f.html,'utf8'),'<title>Previous</title>\n');
});

test('edits made during demo export are preserved',async t=>{
  const f=fixture(t);
  await assert.rejects(updateWorkspaceRuntimeExample({root:f.root,exportReader:async({readerPath})=>{
    fs.writeFileSync(readerPath,'new');fs.writeFileSync(f.json,'{"manual":"edit"}');
  }}),/changed during export/);
  assert.equal(fs.readFileSync(f.json,'utf8'),'{"manual":"edit"}');
  assert.equal(fs.readFileSync(f.html,'utf8'),'<title>Previous</title>\n');
});
