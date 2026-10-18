const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const dataset=html.slice(html.indexOf('// ---------- embedded datasets ----------'),html.indexOf('// End of embedded dataset contract.'));
const helpers=html.slice(html.indexOf('  function validateDatasetReplacementSchema('),html.indexOf('  function safeDataFilename('));
const snapshot=html.slice(html.indexOf('  function datasetOwnersOf('),html.indexOf('  function componentTables('));
function fixture(handle){
  const scope=vm.createContext({});
  vm.runInContext(dataset+'\n'+snapshot+'\n'+helpers+'\nthis.api={rememberComponentDatasetSource,reloadComponentDataset,queueComponentDatasetReload,cancelComponentDatasetReload};',scope);
  const item={script:'source',state:{allowReaderImport:true},inputValues:{data:{datasetId:'initial'}}};
  const table={name:'Rows',columns:[{key:'Name',name:'Name',type:'string'},{key:'Value',name:'Value',type:'number'}],rows:[['Old',1]]};
  let pool={initial:table},valid=true,replaced=0;
  const host={valid:()=>valid,read:async()=>({item,pool,caps:{apiVersion:2,inputs:{data:{type:'table'}}},record:{io:{inputs:item.inputValues}}}),
    replace:async(table,expected,current)=>{if(!current())return false;const id='accepted-'+(++replaced);pool={...pool,[id]:table};item.inputValues.data={datasetId:id};return true;}};
  if(handle!==undefined)scope.api.rememberComponentDatasetSource(item,'data',{handle,name:'rows.csv',delimiter:';'});
  return {api:scope.api,item,host,setValid:value=>{valid=value;},get rows(){return pool[item.inputValues.data.datasetId].rows;},get replaced(){return replaced;}};
}
const file=text=>({name:'rows.csv',size:text.length,text:async()=>text});

test('reload requests a fresh File for each accepted pulse and reuses the accepted delimiter',async()=>{
  let value=2,reads=0;
  const f=fixture({queryPermission:async()=> 'granted',getFile:async()=>{reads++;return file('Name;Value\nNew;'+value);}});
  assert.equal(await f.api.reloadComponentDataset(f.item,'data',f.host),true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.rows)),[['New',2]]);
  value=3;assert.equal(await f.api.reloadComponentDataset(f.item,'data',f.host),true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.rows)),[['New',3]]);assert.equal(reads,2);assert.equal(f.replaced,2);
});

test('missing handles and ordinary File imports require explicit reselection rather than reading stale snapshots',async()=>{
  const missing=fixture();await assert.rejects(missing.api.reloadComponentDataset(missing.item,'data',missing.host),/Choose the file again using Load data/);
  const fallback=fixture(null);await assert.rejects(fallback.api.reloadComponentDataset(fallback.item,'data',fallback.host),/cannot reread.*automatically/);
  assert.equal(missing.replaced,0);assert.equal(fallback.replaced,0);
});

test('schema and read failures retain the last accepted data',async()=>{
  let text='Wrong;Value\nNew;2';
  const f=fixture({getFile:async()=>file(text)});
  await assert.rejects(f.api.reloadComponentDataset(f.item,'data',f.host),/Missing column "Name"/);
  text='Name;Value\nNew;text';await assert.rejects(f.api.reloadComponentDataset(f.item,'data',f.host),/must remain number/);
  const denied=fixture({queryPermission:async()=> 'denied',getFile:async()=>{throw new Error('must not read');}});
  await assert.rejects(denied.api.reloadComponentDataset(denied.item,'data',denied.host),/Choose the file again/);
  assert.equal(f.replaced,0);assert.deepEqual(f.rows,[['Old',1]]);assert.equal(denied.replaced,0);
});

test('tab or owner cancellation discards an in-flight reread',async()=>{
  let finish,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  const f=fixture({getFile:()=>{started();return new Promise(resolve=>{finish=resolve;});}});
  const pending=f.api.reloadComponentDataset(f.item,'data',f.host);await waiting;f.setValid(false);finish(file('Name;Value\nLate;8'));
  assert.equal(await pending,false);assert.equal(f.replaced,0);
});

test('the latest reload wins and an older asynchronous read cannot overwrite its accepted data',async()=>{
  const pending=[];
  const f=fixture({getFile:()=>new Promise(resolve=>pending.push(resolve))});
  const first=f.api.reloadComponentDataset(f.item,'data',f.host);await new Promise(resolve=>setImmediate(resolve));
  const second=f.api.reloadComponentDataset(f.item,'data',f.host);await new Promise(resolve=>setImmediate(resolve));
  pending[1](file('Name;Value\nLatest;9'));assert.equal(await second,true);
  pending[0](file('Name;Value\nOld;2'));assert.equal(await first,false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.rows)),[['Latest',9]]);assert.equal(f.replaced,1);
});

test('changed source assignments and disabled author permission cannot reload a previous file',async()=>{
  let reads=0;const f=fixture({getFile:async()=>{reads++;return file('Name;Value\nNew;2');}});
  f.item.state.allowReaderImport=false;await assert.rejects(f.api.reloadComponentDataset(f.item,'data',f.host),/disabled/);assert.equal(reads,0);
  f.item.state.allowReaderImport=true;f.item.inputValues.data={datasetId:'different'};
  await assert.rejects(f.api.reloadComponentDataset(f.item,'data',f.host),/Choose the file again/);assert.equal(reads,0);
});


test('reload bursts retain one queued or in-flight job per Dataset and explicit Load cancels old tickets',async()=>{
  const f=fixture(),queued=[];let runs=0,finish;
  const run=()=>{runs++;return new Promise(resolve=>{finish=resolve;});};
  for(let i=0;i<1000;i++)f.api.queueComponentDatasetReload(f.item,'data',job=>queued.push(job),run);
  assert.equal(queued.length,1);const pending=queued.shift()();assert.equal(runs,1);
  for(let i=0;i<1000;i++)f.api.queueComponentDatasetReload(f.item,'data',job=>queued.push(job),run);
  assert.equal(queued.length,0,'a pending read cannot build a promise backlog');
  finish();await pending;
  assert.equal(f.api.queueComponentDatasetReload(f.item,'data',job=>queued.push(job),async()=>{runs++;}),true);
  f.api.cancelComponentDatasetReload(f.item,'data');await queued.shift()();assert.equal(runs,1,'explicit Load invalidates the previously queued reload');
  assert.equal(f.api.queueComponentDatasetReload(f.item,'data',job=>queued.push(job),async()=>{runs++;}),true);
  await queued.shift()();assert.equal(runs,2,'the next pulse after completion can reload');
});
