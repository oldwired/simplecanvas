const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1400,height:900}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://dataset-owner-copy.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://dataset-owner-copy.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
const ownerScript=`({apiVersion:2,datasetOwner:'data',inputs:{data:{type:'table'}},outputs:{data:{type:'table'}},compute(inputs){return {data:inputs.data};},children(){return [];}})`;
const viewScript=`({apiVersion:2,inputs:{data:{type:'table'}},outputs:{value:{type:'number'}},compute(inputs,state,context){return {value:context.tables.data.rows[0]?.[0]??0};},children(){return [];}})`;
const table={name:'Values',columns:[{key:'value',name:'Value',type:'number'}],rows:[[7],[9]]};
function item(uid,extra={}){return {type:'smart',uid,componentApi:2,componentName:uid,script:viewScript,state:{},x:100,y:100,w:100,h:60,bindings:{},inputValues:{data:{datasetId:'data'}},...extra};}
function scene(){return [item('owner',{script:ownerScript,datasetOwner:'data'}),item('bound',{bindings:{data:{uid:'owner',port:'data'}},inputValues:{}}),item('literal')];}
async function seed(run,list=scene(),pool={data:table}){
  await run(`cancelGesture();items=${JSON.stringify(list)};datasets=normalizeDatasets(${JSON.stringify(pool)});selection=[];undoStack=[];redoStack=[];historyBefore=null;editingGroupId=null;setTool('select');render();`);
  await run('ensureEditorComponentGraph()');
}
async function values(run){return run('(async()=>{const graph=await ensureEditorComponentGraph();return items.filter(it=>it.script!=='+JSON.stringify(ownerScript)+').map(it=>{const record=graph.get(it);if(record.error)throw new Error(record.error);return record.io.outputs.value;});})()');}

test('duplicating an owner and its views forks exactly one store, remaps all copies, and is undoable',async()=>app(async({run})=>{
  await seed(run);await run('selection=[0,1,2];duplicateSelection();');
  const after=await run('({items:clone(items),ids:Object.keys(datasets),undo:undoStack.length})'),copies=after.items.slice(3),id=copies[0].inputValues.data.datasetId;
  assert.notEqual(id,'data');assert.equal(after.ids.length,2);assert.equal(after.undo,1);
  assert.equal(copies[1].bindings.data.uid,copies[0].uid);assert.equal(copies[1].bindings.data.unresolved,undefined);
  assert.equal(copies[2].inputValues.data.datasetId,id);assert.equal(copies[0].datasetOwner,'data');
  await run(`commitEditorDatasetChange({type:'update',datasetId:${JSON.stringify(id)},rowId:'r0',changes:{value:30}});`);
  assert.deepEqual(await values(run),[7,7,30,30]);
  await run('undo();undo();');assert.deepEqual(await run('Object.keys(datasets)'),['data']);assert.equal(await run('items.length'),3);
  await run('redo();');assert.equal(await run('items[3].inputValues.data.datasetId'),id);assert.deepEqual(await values(run),[7,7,7,7]);
}));

test('consumer-only duplicates and same-document pastes stay on the latest owned dataset',async()=>app(async({run})=>{
  await seed(run);await run('selection=[1,2];duplicateSelection();');
  assert.deepEqual(await run('items.slice(3).map(it=>({binding:it.bindings.data||null,ref:it.inputValues.data||null}))'),[
    {binding:{uid:'owner',port:'data'},ref:null},{binding:null,ref:{datasetId:'data'}}]);
  await run('selection=[1,2];copySelection();commitEditorDatasetChange({type:"update",datasetId:"data",rowId:"r0",changes:{value:25}});pasteClipboard();');
  assert.equal(await run('Object.keys(datasets).length'),1);assert.deepEqual(await values(run),[25,25,25,25,25,25]);
}));

test('repeated owner pastes each receive one independent store and cross-document bindings stay unresolved',async()=>app(async({run})=>{
  await seed(run);await run('selection=[0,1,2];copySelection();pasteClipboard();pasteClipboard();');
  const ids=await run('[items[0],items[3],items[6]].map(it=>it.inputValues.data.datasetId)');assert.equal(new Set(ids).size,3);
  assert.equal(await run('Object.keys(datasets).length'),3);
  assert.equal(await run('items[4].bindings.data.uid===items[3].uid && items[7].bindings.data.uid===items[6].uid'),true);
  await run('selection=[1];copySelection();');await seed(run,scene());await run('pasteClipboard();');
  assert.equal(await run('items[3].bindings.data.unresolved'),true,'an unrelated owner with the same UID cannot inherit a copied binding');
}));

test('library serialization preserves ownership without mutating data and placement forks it once',async()=>app(async({run})=>{
  await seed(run);const before=await run('JSON.stringify(datasets)');
  await run('selection=[0,1,2];window.template=selectionAsShapeItems();window.templatePool=datasetsUsedBy(template,datasets);');
  assert.equal(await run('JSON.stringify(datasets)'),before);assert.equal(await run('template[0].inputValues.data.datasetId'),'data');
  const normalized=await run('normalizeScene(template,{},FORMAT_VERSION,templatePool)');assert.equal(normalized.items[0].datasetOwner,'data');
  await run('commitShapePlacement(template,"Shared values",600,400,templatePool);');
  assert.equal(await run('Object.keys(datasets).length'),2);assert.equal(await run('items[3].inputValues.data.datasetId===items[5].inputValues.data.datasetId'),true);
  assert.equal(await run('items[4].bindings.data.uid===items[3].uid'),true);
}));

test('owned-store budget rejection leaves the scene, pool, and history unchanged',async()=>app(async({run})=>{
  const pool={},list=[];for(let i=0;i<16;i++){const id='data'+i;pool[id]=table;list.push(item('owner'+i,{script:ownerScript,datasetOwner:'data',inputValues:{data:{datasetId:id}}}));}
  await seed(run,list,pool);
  const result=await run('selection=[0];window.beforePool=datasets;const before=JSON.stringify(items);duplicateSelection();({samePool:datasets===beforePool,sameItems:JSON.stringify(items)===before,undo:undoStack.length,pending:historyBefore,selected:selection})');
  assert.deepEqual(result,{samePool:true,sameItems:true,undo:0,pending:null,selected:[0]});
  assert.equal(await run('Object.keys(datasets).length'),16);
}));

test('initialization derives the persisted copy hint from authoritative capabilities',async()=>app(async({run})=>{
  const source=item('owner',{script:ownerScript});
  await run(`window.ownerFixture=${JSON.stringify(source)};initializeSmartItem(ownerFixture);`);assert.equal(await run('ownerFixture.datasetOwner'),'data');
  await run(`ownerFixture.script=${JSON.stringify(viewScript)};initializeSmartItem(ownerFixture);`);assert.equal(await run('ownerFixture.datasetOwner??null'),null);
  const bad=await run(`normalizeScene([${JSON.stringify({...source,datasetOwner:'__proto__'})}],{},FORMAT_VERSION,{data:${JSON.stringify(table)}})`);
  assert.equal(bad.items[0].datasetOwner,undefined);assert.match(bad.items[0].componentInvalid,/dataset owner/i);
}));
