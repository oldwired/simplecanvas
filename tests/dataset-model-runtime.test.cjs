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
  const context=await browser.newContext({viewport:{width:1200,height:800}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://dataset-model.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://dataset-model.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
const script=`({apiVersion:2,inputs:{data:{type:'table'}},outputs:{value:{type:'number'}},
  compute(inputs,state,context){return {value:context.tables.data.rows[0]?.[0]??0};},children(){return [];}})`;
async function seed(run){
  const items=[0,1].map(index=>({type:'smart',uid:'reader'+index,componentApi:2,componentName:'Reader '+index,script,state:{},
    x:100+index*300,y:100,w:200,h:80,bindings:{},inputValues:{data:{datasetId:'data'}}}));
  const pool={data:{name:'Values',columns:[{key:'value',name:'Value',type:'number'}],rows:[[1]]}};
  await run(`cancelGesture();items=${JSON.stringify(items)};datasets=normalizeDatasets(${JSON.stringify(pool)});undoStack=[];redoStack=[];selection=[];setTool('select');save();render();`);
  await run('ensureEditorComponentGraph()');
}
async function values(run){return run('(async()=>{const graph=await ensureEditorComponentGraph();return items.map(item=>{const record=graph.get(item);if(record.error)throw new Error(record.error);return record.io.outputs.value;});})()');}

test('shared dataset edits invalidate cached values and Undo/Redo restore exact revisions without resuming Pause',async()=>app(async({run})=>{
  await seed(run);assert.deepEqual(await values(run),[1,1]);
  await run("controlComponentSimulation('pause')");await run('editorTimeline.elapsed=1250;window.originalDataset=datasets.data;');
  await run("beginHistory();datasets=datasetCommand(datasets,{type:'update',datasetId:'data',rowId:'r0',changes:{value:40},expectedRevision:0}).pool;commitHistory();window.editedDataset=datasets.data;");
  assert.deepEqual(await values(run),[40,40],'a new data pool invalidates cached computation without a manual graph reset');
  assert.equal(await run('undoStack[0].datasets.data===window.originalDataset'),true,'history shares the immutable old table');
  assert.equal(await run('datasets.data===window.editedDataset'),true);
  await run('undo()');assert.deepEqual(await values(run),[1,1]);
  assert.equal(await run('datasets.data===window.originalDataset'),true);
  assert.deepEqual(await run('({paused:editorTimeline.pausedByUser,active:editorTimeline.active,time:componentTimelineNow(editorTimeline)})'),{paused:true,active:false,time:1250});
  await run('redo()');assert.deepEqual(await values(run),[40,40]);assert.equal(await run('datasets.data===window.editedDataset'),true);
  assert.deepEqual(await run('({paused:editorTimeline.pausedByUser,active:editorTimeline.active,time:componentTimelineNow(editorTimeline)})'),{paused:true,active:false,time:1250});
  await run('beginHistory();items=[];commitHistory();');assert.deepEqual(await run('datasets'),{},'current data pool releases unreferenced tables');
  await run('undo()');assert.deepEqual(await values(run),[40,40]);assert.equal(await run('datasets.data===window.editedDataset'),true,'history owns its revision even after current data was pruned');
}));

test('replacing a dataset pool cancels in-flight graph work rather than accepting stale results',async()=>app(async({run})=>{
  await seed(run);
  const result=await run(`(async()=>{
    editorComponentEvaluation=null;const old=ensureEditorComponentGraph();
    datasets=datasetCommand(datasets,{type:'update',datasetId:'data',rowId:'r0',changes:{value:7}}).pool;
    const current=ensureEditorComponentGraph(),results=await Promise.allSettled([old,current]);
    return {old:results[0].status,cancelled:results[0].reason?.cancelled===true,current:results[1].status};
  })()`);
  assert.deepEqual(result,{old:'rejected',cancelled:true,current:'fulfilled'});assert.deepEqual(await values(run),[7,7]);
}));
