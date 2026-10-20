const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {updateExampleWorkspace}=require('../tools/update-example-workspace.cjs');

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-example-generator-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const examples=path.join(root,'examples');fs.mkdirSync(examples);
  const workspacePath=path.join(examples,'smart-components-workspace.json');
  const readerPath=path.join(examples,'smart-components-workspace.html');
  const workspace='{"tabs":[{"items":[{"type":"smart","uid":"demo-1-source","exampleSource":"number-control.js","script":"old script"}]}]}\n';
  const reader='<!doctype html><title>Previous reader</title>\n';
  fs.writeFileSync(workspacePath,workspace);fs.writeFileSync(readerPath,reader);
  fs.writeFileSync(path.join(examples,'number-control.js'),'new component source');
  return {root,examples,workspacePath,readerPath,workspace,reader};
}
const stagingFolders=examples=>fs.readdirSync(examples).filter(name=>name.startsWith('.smart-components-workspace-'));

test('workspace generator rejects missing or traversing source metadata before publishing',async t=>{
  const f=fixture(t);
  for(const exampleSource of [undefined,'../index.html','/number-control.js']){
    const workspace=JSON.parse(f.workspace);workspace.tabs[0].items[0].exampleSource=exampleSource;
    const previous=JSON.stringify(workspace);fs.writeFileSync(f.workspacePath,previous);
    await assert.rejects(updateExampleWorkspace({root:f.root,exportReader:async()=>assert.fail('must not export')}),/valid exampleSource/);
    assert.equal(fs.readFileSync(f.workspacePath,'utf8'),previous);
    assert.equal(fs.readFileSync(f.readerPath,'utf8'),f.reader);
  }
});

test('workspace generator keeps the previous pair until export succeeds, then publishes both prepared artifacts',async t=>{
  const f=fixture(t),newReader='<!doctype html><title>New reader</title>\n';
  const result=await updateExampleWorkspace({root:f.root,exportReader:async({workspacePath,readerPath,tabCount})=>{
    assert.equal(tabCount,1);
    assert.equal(fs.readFileSync(f.workspacePath,'utf8'),f.workspace);
    assert.equal(fs.readFileSync(f.readerPath,'utf8'),f.reader);
    assert.equal(JSON.parse(fs.readFileSync(workspacePath,'utf8')).tabs[0].items[0].script,'new component source');
    fs.writeFileSync(readerPath,newReader);
  }});
  assert.deepEqual(result,{tabCount:1});
  assert.equal(JSON.parse(fs.readFileSync(f.workspacePath,'utf8')).tabs[0].items[0].script,'new component source');
  assert.equal(fs.readFileSync(f.readerPath,'utf8'),newReader);
  assert.deepEqual(stagingFolders(f.examples),[]);
});

test('a failed HTML exporter preserves the previous JSON and reader and cleans staged output',async t=>{
  const f=fixture(t);
  await assert.rejects(updateExampleWorkspace({root:f.root,exportReader:async({readerPath})=>{
    fs.writeFileSync(readerPath,'partial HTML');throw new Error('browser export failed');
  }}),/browser export failed/);
  assert.equal(fs.readFileSync(f.workspacePath,'utf8'),f.workspace);
  assert.equal(fs.readFileSync(f.readerPath,'utf8'),f.reader);
  assert.deepEqual(stagingFolders(f.examples),[]);
});

test('sketch identities remain stable across repeated exports, renaming and reordering',async t=>{
  const f=fixture(t),workspace=JSON.parse(f.workspace);
  workspace.tabs.push({id:'demo-sketch-1',name:'Existing identity',items:[]},{name:'Another sketch',items:[]});
  fs.writeFileSync(f.workspacePath,JSON.stringify(workspace));
  const exportReader=async({workspacePath,readerPath})=>{
    const data=JSON.parse(fs.readFileSync(workspacePath,'utf8'));
    fs.writeFileSync(readerPath,'<title>'+data.tabs.map(tab=>tab.id).join(',')+'</title>');
  };
  await updateExampleWorkspace({root:f.root,exportReader});
  const first=fs.readFileSync(f.workspacePath,'utf8'),reader=fs.readFileSync(f.readerPath,'utf8');
  assert.deepEqual(JSON.parse(first).tabs.map(tab=>tab.id),['demo-sketch-1-2','demo-sketch-1','demo-sketch-3']);
  await updateExampleWorkspace({root:f.root,exportReader});
  assert.equal(fs.readFileSync(f.workspacePath,'utf8'),first);
  assert.equal(fs.readFileSync(f.readerPath,'utf8'),reader);
  const reordered=JSON.parse(first);reordered.tabs.reverse();reordered.tabs[0].name='Renamed';
  fs.writeFileSync(f.workspacePath,JSON.stringify(reordered));
  await updateExampleWorkspace({root:f.root,exportReader});
  assert.deepEqual(JSON.parse(fs.readFileSync(f.workspacePath,'utf8')).tabs.map(tab=>tab.id),
    ['demo-sketch-3','demo-sketch-1','demo-sketch-1-2']);
});

test('failure publishing the second artifact rolls back the first without changing either previous file',async t=>{
  const f=fixture(t),io=Object.create(fs);
  io.renameSync=(source,target)=>{
    if(target===f.readerPath&&path.basename(source)==='reader.html')throw new Error('reader publication denied');
    return fs.renameSync(source,target);
  };
  await assert.rejects(updateExampleWorkspace({root:f.root,io,exportReader:async({readerPath})=>{
    fs.writeFileSync(readerPath,'new HTML');
  }}),/reader publication denied/);
  assert.equal(fs.readFileSync(f.workspacePath,'utf8'),f.workspace);
  assert.equal(fs.readFileSync(f.readerPath,'utf8'),f.reader);
  assert.deepEqual(stagingFolders(f.examples),[]);
});

test('an edit during export is preserved instead of being overwritten by generated artifacts',async t=>{
  const f=fixture(t),edited='{"tabs":[],"note":"saved while export was running"}\n';
  await assert.rejects(updateExampleWorkspace({root:f.root,exportReader:async({readerPath})=>{
    fs.writeFileSync(readerPath,'new HTML');fs.writeFileSync(f.workspacePath,edited);
  }}),/changed during export/);
  assert.equal(fs.readFileSync(f.workspacePath,'utf8'),edited);
  assert.equal(fs.readFileSync(f.readerPath,'utf8'),f.reader);
  assert.deepEqual(stagingFolders(f.examples),[]);
});

test('a rollback failure retains recovery copies and reports their location',async t=>{
  const f=fixture(t),io=Object.create(fs);
  io.renameSync=(source,target)=>{
    if(target===f.readerPath||path.basename(source)==='previous-workspace.json')throw new Error('disk stopped accepting replacements');
    return fs.renameSync(source,target);
  };
  await assert.rejects(updateExampleWorkspace({root:f.root,io,exportReader:async({readerPath})=>{
    fs.writeFileSync(readerPath,'new HTML');
  }}),error=>error instanceof AggregateError&&error.message.includes('recovery copies were retained in'));
  const folders=stagingFolders(f.examples);assert.equal(folders.length,1);
  assert.equal(fs.readFileSync(path.join(f.examples,folders[0],'previous-workspace.json'),'utf8'),f.workspace);
  assert.equal(fs.readFileSync(path.join(f.examples,folders[0],'previous-reader.html'),'utf8'),f.reader);
  assert.equal(fs.readFileSync(f.readerPath,'utf8'),f.reader);
});

test('duplicate dataset IDs become stable global identities while references retain their owning sketches',async t=>{
  const f=fixture(t),workspace=JSON.parse(f.workspace),first=workspace.tabs[0];first.id='owner-a';
  const table={columns:[{key:'name',name:'Name',type:'string'}],rows:[['shared']]};
  first.datasets={shared:table};
  Object.assign(first.items[0],{datasetOwner:'data',inputValues:{
    data:{datasetId:'shared'},remote:{datasetId:'shared',sketchId:'owner-b',rows:[0]},external:{datasetId:'shared',sketchId:'external'}},
    signalState:{held:{datasetId:'shared'}},state:{literal:{datasetId:'shared'},text:'shared'}});
  const second={id:'owner-b',name:'Second',datasets:{shared:table},items:[{type:'rect',
    inputValues:{local:{datasetId:'shared'},remote:{datasetId:'shared',sketchId:'owner-a'}},
    signalState:{held:{datasetId:'shared',sketchId:'owner-a'}}}]};
  const third={id:'owner-c',datasets:{'demo-data-owner-b-shared':table},items:[]};
  workspace.tabs.push(second,third);fs.writeFileSync(f.workspacePath,JSON.stringify(workspace,null,2)+'\n');
  const exportReader=async({workspacePath,readerPath})=>fs.copyFileSync(workspacePath,readerPath);
  await updateExampleWorkspace({root:f.root,exportReader});
  const once=fs.readFileSync(f.workspacePath,'utf8'),reader=fs.readFileSync(f.readerPath,'utf8'),updated=JSON.parse(once);
  const a='demo-data-owner-a-shared',b='demo-data-owner-b-shared-2';
  assert.deepEqual(updated.tabs.map(tab=>Object.keys(tab.datasets)),[[a],[b],['demo-data-owner-b-shared']]);
  const owner=updated.tabs[0].items[0],consumer=updated.tabs[1].items[0];
  assert.equal(owner.datasetOwner,'data');assert.deepEqual(owner.inputValues.data,{datasetId:a});
  assert.deepEqual(owner.inputValues.remote,{datasetId:b,sketchId:'owner-b',rows:[0]});
  assert.deepEqual(owner.inputValues.external,{datasetId:'shared',sketchId:'external'});
  assert.deepEqual(owner.signalState.held,{datasetId:a});
  assert.deepEqual(consumer.inputValues,{local:{datasetId:b},remote:{datasetId:a,sketchId:'owner-a'}});
  assert.deepEqual(consumer.signalState.held,{datasetId:a,sketchId:'owner-a'});
  assert.deepEqual(owner.state,{literal:{datasetId:'shared'},text:'shared'});assert.deepEqual(updated.tabs[0].datasets[a],table);
  await updateExampleWorkspace({root:f.root,exportReader});
  assert.equal(fs.readFileSync(f.workspacePath,'utf8'),once);assert.equal(fs.readFileSync(f.readerPath,'utf8'),reader);
  updated.tabs.reverse();updated.tabs[2].name='Renamed';fs.writeFileSync(f.workspacePath,JSON.stringify(updated,null,2)+'\n');
  await updateExampleWorkspace({root:f.root,exportReader});
  const reordered=JSON.parse(fs.readFileSync(f.workspacePath,'utf8'));
  assert.deepEqual(reordered.tabs.map(tab=>Object.keys(tab.datasets)),[['demo-data-owner-b-shared'],[b],[a]]);
  assert.deepEqual(reordered.tabs[1].items[0].inputValues.remote,{datasetId:a,sketchId:'owner-a'});
});
