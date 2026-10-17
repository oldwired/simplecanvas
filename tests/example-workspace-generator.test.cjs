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
  const workspace='{"tabs":[{"items":[{"type":"smart","uid":"demo-1-source","script":"old script"}]}]}\n';
  const reader='<!doctype html><title>Previous reader</title>\n';
  fs.writeFileSync(workspacePath,workspace);fs.writeFileSync(readerPath,reader);
  fs.writeFileSync(path.join(examples,'number-control.js'),'new component source');
  return {root,examples,workspacePath,readerPath,workspace,reader};
}
const stagingFolders=examples=>fs.readdirSync(examples).filter(name=>name.startsWith('.smart-components-workspace-'));

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
