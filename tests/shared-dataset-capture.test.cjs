const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..');
const scripts=Object.fromEntries(['capture-row','data-source','spreadsheet','number-control','text-input','trigger','toggle'].map(name=>[name,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8')]));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
let browser;
before(async()=>{browser=await ({chromium,webkit}[process.env.BROWSER_ENGINE||'chromium']).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://shared-dataset-capture.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://shared-dataset-capture.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
function item(name,uid,x,y,state={},extra={}){
  const def=vm.runInNewContext(scripts[name]),style=def.initStyle?.()||{};
  return {type:'smart',uid,componentApi:2,componentName:uid,script:scripts[name],state:{...def.initState?.(),...state},x,y,w:300,h:180,
    color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,fontFamily:'sans',fontSize:14,...style,bindings:{},inputValues:{},...extra};
}
const baseline={name:'Observations',columns:[{key:'label',name:'Label',type:'string'},{key:'value',name:'Value',type:'number'},{key:'active',name:'Active',type:'boolean'}],rows:[]};
async function seed(run,{rows=[],reader=true,held=false}={}){
  const items=[
    item('data-source','dataset',30,50,{}, {inputValues:{data:{datasetId:'observations'}}}),
    item('number-control','number',30,290,{value:7}),
    item('text-input','text',340,290,{values:['First']}),
    item(held?'toggle':'trigger','capture-trigger',340,50,held?{value:false}:{}),
    item('capture-row','capture',680,50,{allowReaderCapture:reader},{inputValues:{field2:true},bindings:{data:{uid:'dataset',port:'data'},capture:{uid:'capture-trigger',port:'value'},field0:{uid:'text',port:'value'},field1:{uid:'number',port:'value'}}}),
    item('spreadsheet','sheet',680,290,{source:'Dataset',cols:5,rows:6,dataColumns:3,dataRows:3,editDataset:true,
      cells:{D1:'=OUTPUT(ROWS("data"),"rows")',E1:'=OUTPUT(SUM(COLUMN("data","value")),"total")'}},{w:600,h:300,bindings:{data:{uid:'dataset',port:'data'}}})
  ];
  await run(`cancelGesture();datasets=normalizeDatasets(${JSON.stringify({observations:{...baseline,rows}})});items=${JSON.stringify(items)};selection=[];editingSmartIdx=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
  const errors=await run('(async()=>[...(await ensureEditorComponentGraph())].filter(([,record])=>record.error).map(([item,record])=>({uid:item.uid,error:record.error})))()');
  assert.deepEqual(errors,[],'seeded graph computes through actual Workers');
}
async function handle(run,index,id){return run(`(async()=>{const it=items[${index}],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it),io])).find(h=>h.id===${JSON.stringify(id)});})()`);}
async function editorClick(page,run,index,id){
  await run(`selection=[${index}];editingSmartIdx=${index};render();`);const h=await handle(run,index,id);assert.ok(h,id);
  const it=await run(`({x:items[${index}].x,y:items[${index}].y})`),box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+it.x+h.x,box.y+it.y+h.y);
}
async function editorRows(page,count){await page.waitForFunction(count=>__test.run('datasets.observations.rows.length')===count,count);}
async function outputs(run){return run('(async()=>{const record=(await ensureEditorComponentGraph()).get(items[5]);if(record.error)throw new Error(record.error);return record.io.outputs;})()');}
async function openReader(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-capture-')),file=path.join(directory,'document.html');
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];reader.on('pageerror',error=>errors.push(error.message));reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===6);return {reader,errors,requests};
}
async function readerClick(reader,index,h){const point=await reader.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},h);await reader.mouse.click(point.x,point.y);}
async function readerRows(reader,count){await reader.waitForFunction(count=>[...document.querySelectorAll('[data-smart-index="4"] text')].some(t=>t.textContent===count+' '+(count===1?'row':'rows')),count);}

test('real editor Capture row samples connected controls, updates the shared grid, and Undo never replays a pulse',async()=>app(async({page,run})=>{
  await seed(run);const before=await run('undoStack.length');await editorClick(page,run,3,'trigger');await editorRows(page,1);await run('smartGestureQueue');
  assert.deepEqual(await run('datasets.observations.rows'),[['First',7,true]]);assert.deepEqual(await outputs(run),{rows:1,total:7});
  assert.equal(await run('undoStack.length'),before+2,'released button and accepted data append are independently undoable');
  await run('render();ensureEditorComponentGraph()');await run('smartGestureQueue');assert.equal(await run('datasets.observations.rows.length'),1);
  await run('undo();ensureEditorComponentGraph()');await run('smartGestureQueue');assert.deepEqual(await run('datasets.observations.rows'),[]);
  await run('editorComponentEvaluation=null;render();ensureEditorComponentGraph()');await run('smartGestureQueue');assert.deepEqual(await run('datasets.observations.rows'),[],'restored high or saved press token cannot recapture');
  await run('redo();ensureEditorComponentGraph()');await run('smartGestureQueue');assert.deepEqual(await run('datasets.observations.rows'),[['First',7,true]]);
  await editorClick(page,run,2,'entry');const field=page.locator('#smartTextValue');await field.fill('Second');await field.press('Enter');await page.waitForFunction(()=>!document.querySelector('#smartTextValue')?.readOnly);await field.press('Escape');await field.waitFor({state:'detached'});
  await editorClick(page,run,1,'plus');await run('smartGestureQueue');await editorClick(page,run,3,'trigger');await editorRows(page,2);
  assert.deepEqual(await run('datasets.observations.rows'),[['First',7,true],['Second',8,true]]);assert.deepEqual(await outputs(run),{rows:2,total:15});
}));

test('queued real-graph captures retain each sampled row and a held-high input adds no duplicates',async()=>app(async({page,run})=>{
  await seed(run,{held:true});
  await run('smartGestureQueue=new Promise(resolve=>window.releaseCaptures=resolve);items[3].state.value=true;ensureEditorComponentGraph()');
  await run("items[3].state.value=false;items[1].state.value=9;items[2].state.values=['Second'];ensureEditorComponentGraph()");
  await run('items[3].state.value=true;ensureEditorComponentGraph()');
  await run("items[1].state.value=99;items[2].state.values=['After sampling'];ensureEditorComponentGraph()");
  assert.equal(await run('datasets.observations.rows.length'),0);await run('window.releaseCaptures()');await editorRows(page,2);await run('smartGestureQueue');
  assert.deepEqual(await run('datasets.observations.rows'),[['First',7,true],['Second',9,true]]);assert.deepEqual(await outputs(run),{rows:2,total:16});
  await run('editorComponentEvaluation=null;render();ensureEditorComponentGraph()');await run('smartGestureQueue');assert.equal(await run('datasets.observations.rows.length'),2);
}));

test('offline exported Capture row uses connected controls and a shared grid while preserving the embedded original',async()=>app(async({page,run,context})=>{
  await seed(run);const trigger=await handle(run,3,'trigger'),entry=await handle(run,2,'entry'),plus=await handle(run,1,'plus');
  const {reader,errors,requests}=await openReader(page,run,context);await readerClick(reader,3,trigger);await readerRows(reader,1);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="5"]')?.textContent.includes('First'));
  await readerClick(reader,2,entry);const field=reader.locator('#smartTextValue');await field.fill('Offline');await field.press('Enter');await reader.waitForFunction(()=>!document.querySelector('#smartTextValue')?.readOnly);await field.press('Escape');await field.waitFor({state:'detached'});
  await readerClick(reader,1,plus);await readerClick(reader,3,trigger);await readerRows(reader,2);
  await reader.waitForFunction(()=>{const texts=[...document.querySelectorAll('[data-smart-index="5"] text')].map(t=>t.textContent);return texts.includes('Offline')&&texts.includes('15');});
  assert.deepEqual(await run('datasets.observations.rows'),[],'reader captures remain in the exported session');
  await reader.reload();await readerRows(reader,0);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('row limits fail visibly and atomically in both editor and offline HTML',async()=>app(async({page,run,context})=>{
  const rows=Array.from({length:1000},(_,i)=>['Row '+i,i,true]);await seed(run,{rows});const trigger=await handle(run,3,'trigger');
  await editorClick(page,run,3,'trigger');await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('1000'));
  assert.deepEqual(await run('datasets.observations.rows'),rows);assert.equal(await run('datasetRevision(datasets.observations)'),0);
  const {reader,errors,requests}=await openReader(page,run,context);await readerClick(reader,3,trigger);
  await reader.waitForFunction(()=>document.querySelector('[data-data-action-error]')?.textContent.includes('1000'));
  await readerRows(reader,1000);assert.equal(await reader.locator('[data-data-action-error][role="alert"]').count(),1);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('reader capture stays disabled until explicitly enabled even when its source allows importing',async()=>app(async({page,run,context})=>{
  await seed(run,{reader:false,held:true});await run('items[0].state.allowReaderImport=true;ensureEditorComponentGraph()');const trigger=await handle(run,3,'toggle');
  const {reader,errors,requests}=await openReader(page,run,context);await readerClick(reader,3,trigger);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="3"] rect[fill="#15803d"]'));
  await readerRows(reader,0);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('a concurrent shape history baseline keeps row selections aligned with accepted dataset changes',async()=>app(async({run})=>{
  await seed(run,{rows:[['First',7,true],['Second',9,true],['Third',11,false]]});
  await run("items[5].bindings={};items[5].inputValues={data:{datasetId:'observations',rows:[1,2]}};beginHistory();items[1].x+=20;commitEditorDatasetChange({type:'delete',datasetId:'observations',rowId:'r0'});commitHistory();undo();ensureEditorComponentGraph()");
  assert.deepEqual(await run('items[5].inputValues.data'),{datasetId:'observations',rows:[0,1]});
  assert.deepEqual(await outputs(run),{rows:2,total:20});
  await run('undo();ensureEditorComponentGraph()');assert.deepEqual(await run('items[5].inputValues.data'),{datasetId:'observations',rows:[1,2]});
  assert.deepEqual(await outputs(run),{rows:2,total:20});
}));
