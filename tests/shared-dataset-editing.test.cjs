const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..');
const scripts=Object.fromEntries(['spreadsheet','data-source','table-filter','table-sort','data-table','data-bar-chart'].map(name=>[name,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8')]));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
let browser;
before(async()=>{browser=await ({chromium,webkit}[process.env.BROWSER_ENGINE||'chromium']).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://shared-dataset-editing.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://shared-dataset-editing.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
function item(name,uid,state={},extra={}){
  return {type:'smart',uid,componentApi:2,componentName:uid,script:scripts[name],state,x:60,y:160,w:600,h:240,
    color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,fontFamily:'sans',fontSize:14,bindings:{},inputValues:{},...extra};
}
function sheet(cells={},extra={},state={}){return item('spreadsheet','sheet',{source:'Dataset',cols:5,rows:6,dataColumns:3,dataRows:3,editDataset:true,cells,...state},{inputValues:{data:{datasetId:'fleet'}},...extra});}
async function seed(run,items,pool={fleet}){
  items=[...items,...Object.keys(pool).map(id=>item('data-source','owner-'+id,{}, {x:1500,y:900,inputValues:{data:{datasetId:id}}}))];
  await run(`cancelGesture();datasets=normalizeDatasets(${JSON.stringify(pool)});items=${JSON.stringify(items)};selection=[];editingSmartIdx=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
async function outputs(run,index=0){return run(`(async()=>{const r=(await ensureEditorComponentGraph()).get(items[${index}]);if(r.error)throw new Error(r.error);return r.io.outputs;})()`);}
async function text(run,index=0){return run(`(async()=>{const it=items[${index}],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'children',[it.state,smartResolvedStyle(it),it.w,it.h,false,io])).filter(x=>x.type==='text').map(x=>x.text);})()`);}
async function handle(run,index,id){return run(`(async()=>{const it=items[${index}],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it),io])).find(h=>h.id===${JSON.stringify(id)});})()`);}
async function openCell(page,run,index,id){
  await run(`selection=[${index}];editingSmartIdx=${index};render();`);const h=await handle(run,index,id);assert.ok(h,'cell '+id);
  const it=await run(`({x:items[${index}].x,y:items[${index}].y})`),box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+it.x+h.x,box.y+it.y+h.y);const field=page.locator('[data-smart-inline-input] #smartTextValue');await field.waitFor();return {field,handle:h};
}
async function edit(page,run,index,id,value){const {field}=await openCell(page,run,index,id);await field.fill(value);await field.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');}
async function snapshot(run){return run('({items:items.map(({script,...item})=>clone(item)),datasets:clone(datasets),undo:undoStack.length,redo:redoStack.length})');}
async function readerText(reader,index,value){await reader.waitForFunction(({index,value})=>{const host=document.querySelector('[data-smart-index="'+index+'"]');return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(t=>t.textContent===value);},{index,value});}
async function openReader(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-shared-dataset-')),file=path.join(directory,'document.html');
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];reader.on('pageerror',error=>errors.push(error.message));reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);await readerText(reader,0,'Aurora');return {reader,errors,requests};
}
async function clickReader(reader,index,h){const point=await reader.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},h);await reader.mouse.click(point.x,point.y);}
const fleet={name:'Fleet',columns:[{key:'Boat',name:'Boat',type:'string'},{key:'Points',name:'Points',type:'number'},{key:'Ready',name:'Ready',type:'boolean'}],rows:[['Aurora',8,true],['Borealis',2,false],['Calypso',5,true]]};
function consumers(){return [sheet(),sheet({A1:'=OUTPUT(SUM(COLUMN("data","Points")),"total")'},{uid:'formula',x:800,y:100},{source:'Cells',editDataset:false}),
  item('data-table','table',{maxRows:12,showCounts:true},{x:60,y:520,inputValues:{data:{datasetId:'fleet'}}}),
  item('data-bar-chart','chart',{maxBars:12,showValues:true},{x:800,y:520,inputValues:{data:{datasetId:'fleet'},category:'Boat',value:'Points'}})];}

test('editing one bound cell updates shared formulas, table and chart without changing source identity',async()=>app(async({page,run})=>{
  await seed(run,consumers());const before=await handle(run,0,'B2'),history=await run('undoStack.length');
  assert.equal(before.datasetCell.datasetId,'fleet');assert.equal(before.datasetCell.rowId,'r0');assert.deepEqual(await outputs(run,1),{total:15});
  await edit(page,run,0,'B2','14');
  assert.deepEqual(await outputs(run,1),{total:21});assert.ok((await text(run,2)).includes('14'));assert.ok((await text(run,3)).includes('14'));
  assert.equal(await run('datasets.fleet.rows[0][1]'),14);assert.equal(await run('items[0].state.cells.B2'),undefined);
  const after=await handle(run,0,'B2');assert.equal(after.datasetCell.datasetId,'fleet');assert.equal(after.datasetCell.rowId,'r0');assert.equal(after.datasetCell.revision,before.datasetCell.revision+1);
  assert.equal(await run('undoStack.length'),history+1,'one cell submission is one undoable data edit');
}));

test('editing a sorted and filtered view updates its stable source row and refreshes selection order',async()=>app(async({page,run})=>{
  await seed(run,[item('table-filter','filtered',{}, {x:800,y:100,inputValues:{data:{datasetId:'fleet'},column:'Points',operation:'>',number:1}}),
    item('table-sort','sorted',{}, {x:800,y:400,bindings:{data:{uid:'filtered',port:'data'}},inputValues:{column:'Points',direction:'ascending'}}),
    sheet({D1:'=OUTPUT(A2,"first","string")'},{bindings:{data:{uid:'sorted',port:'data'}},inputValues:{}})]);
  const target=await handle(run,2,'B2');assert.equal(target.value,'2');assert.equal(target.datasetCell.rowId,'r1');
  await edit(page,run,2,'B2','9');assert.deepEqual(await run('datasets.fleet.rows'),[['Aurora',8,true],['Borealis',9,false],['Calypso',5,true]]);
  assert.deepEqual(await outputs(run,2),{first:'Calypso'});assert.equal((await handle(run,2,'B2')).datasetCell.rowId,'r2');
}));

test('typed edits are atomic, blank numeric cells become null, and text beginning equals stays literal',async()=>app(async({page,run})=>{
  await seed(run,[sheet()]);const before=await snapshot(run);let {field}=await openCell(page,run,0,'B2');await field.fill('not a number');await field.press('Enter');
  await page.locator('[data-smart-inline-input] [role="alert"]').waitFor();assert.deepEqual(await snapshot(run),before,'invalid typed text changes neither data nor history');await field.press('Escape');
  await edit(page,run,0,'B2','');assert.equal(await run('datasets.fleet.rows[0][1]'),null);
  await edit(page,run,0,'C3','TRUE');assert.equal(await run('datasets.fleet.rows[1][2]'),true);
  const literal='=OUTPUT(100,"injected")';await edit(page,run,0,'A2',literal);assert.equal(await run('datasets.fleet.rows[0][0]'),literal);
  assert.deepEqual(await outputs(run),{});assert.ok((await text(run)).includes(literal));assert.equal(await run('items[0].state.cells.A2'),undefined);
}));

test('an open dirty field cannot overwrite a newer dataset revision',async()=>app(async({page,run})=>{
  await seed(run,[sheet()]);const {field}=await openCell(page,run,0,'B2');await field.fill('99');
  await run("commitEditorDatasetChange({type:'update',datasetId:'fleet',rowId:'r0',changes:{Points:17}});ensureEditorComponentGraph()");
  const before=await snapshot(run);if(await field.count()){await field.press('Enter');await run('smartHitSettled');}
  assert.equal(await run('datasets.fleet.rows[0][1]'),17,'the draft must not overwrite the intervening accepted edit');assert.deepEqual(await snapshot(run),before);
}));

test('removing the owning Dataset makes connected records read-only and invalidates an open edit',async()=>app(async({page,run})=>{
  await seed(run,[sheet()]);const {field}=await openCell(page,run,0,'B2');await field.fill('99');
  await run("items.splice(1,1);editorComponentEvaluation=null;render();ensureEditorComponentGraph()");
  if(await field.count()){await field.press('Enter');await run('smartHitSettled');}
  assert.equal(await run('datasets.fleet.rows[0][1]'),8);
  const current=await handle(run,0,'B2');assert.equal(current.readOnly,true);assert.equal(current.datasetCell,undefined);
  assert.ok((await text(run)).includes('8'),'the orphaned table remains readable');
}));

test('an open dirty field cannot follow its input when it is retargeted to a different dataset',async()=>app(async({page,run})=>{
  const other={...fleet,name:'Other fleet',rows:[['Different',50,false],['Elsewhere',60,true]]};
  await seed(run,[sheet(),item('data-table','other',{}, {x:800,inputValues:{data:{datasetId:'other'}}}),item('data-table','original',{}, {x:800,y:500,inputValues:{data:{datasetId:'fleet'}}})],{fleet,other});
  const {field}=await openCell(page,run,0,'B2');await field.fill('99');
  await run("items[0].inputValues.data={datasetId:'other'};editorComponentEvaluation=null;render();ensureEditorComponentGraph()");
  const before=await snapshot(run);if(await field.count()){await field.press('Enter');await run('smartHitSettled');}
  assert.equal(await run('datasets.fleet.rows[0][1]'),8);assert.equal(await run('datasets.other.rows[0][1]'),50,'same row ID/revision on another dataset cannot inherit the draft');assert.deepEqual(await snapshot(run),before);
}));

test('delete and replace invalidate open row editors instead of redirecting them to another row',async()=>{
  for(const operation of ['delete','replace'])await app(async({page,run})=>{
    await seed(run,[sheet()]);const {field}=await openCell(page,run,0,'B2');await field.fill('99');
    const command=operation==='delete'?{type:'delete',datasetId:'fleet',rowId:'r0'}:{type:'replace',datasetId:'fleet',table:{...fleet,rows:[['Replacement',40,true],['New row',41,false]]}};
    await run(`commitEditorDatasetChange(${JSON.stringify(command)});ensureEditorComponentGraph()`);const before=await snapshot(run);
    if(await field.count()){await field.press('Enter');await run('smartHitSettled');}
    assert.deepEqual(await snapshot(run),before,operation+' must invalidate the open editor');assert.equal(await run('datasets.fleet.rows[0][1]'),operation==='delete'?2:40);
    assert.equal(await run('datasetRowIds(datasets.fleet).includes("r0")'),false);
  });
});

test('data edits undo and redo with a paused timeline and persist row identity through reload',async()=>app(async({page,run})=>{
  await seed(run,consumers());await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');const paused=await run('({time:componentTimelineNow(editorTimeline),paused:editorTimeline.pausedByUser})');assert.equal(paused.paused,true);
  await edit(page,run,0,'B2','14');const changed=await run('clone(datasets.fleet)');await run('undo();ensureEditorComponentGraph()');assert.deepEqual(await outputs(run,1),{total:15});
  assert.deepEqual(await run('({time:componentTimelineNow(editorTimeline),paused:editorTimeline.pausedByUser})'),paused);
  await run('redo();ensureEditorComponentGraph()');assert.deepEqual(await run('datasets.fleet'),changed);assert.deepEqual(await outputs(run,1),{total:21});
  assert.deepEqual(await run('({time:componentTimelineNow(editorTimeline),paused:editorTimeline.pausedByUser})'),paused);
  await run('save()');await page.reload();await run('appStarted');assert.deepEqual(await run('datasets.fleet'),changed);assert.deepEqual(await outputs(run,1),{total:21});
  const current=await handle(run,0,'B2');assert.equal(current.datasetCell.datasetId,'fleet');assert.equal(current.datasetCell.rowId,'r0');assert.equal(current.datasetCell.revision,changed.revision);
}));

test('offline HTML only edits explicitly enabled dataset cells and updates its local shared consumers',async()=>app(async({page,run,context})=>{
  const entries=consumers();entries[0].state.allowReaderEdit=true;entries.push(sheet({}, {uid:'locked',x:800,y:800}, {allowReaderEdit:false}));
  await seed(run,entries);const enabled=await handle(run,0,'B2'),locked=await handle(run,4,'B2'),header=await handle(run,0,'B1');
  assert.notEqual(enabled.editorOnly,true);assert.equal(locked.editorOnly,true);const {reader,errors,requests}=await openReader(page,run,context);
  await clickReader(reader,0,enabled);let field=reader.locator('#smartTextValue');await field.waitFor();await field.fill('14');await field.press('Enter');await field.waitFor({state:'detached'});
  await readerText(reader,1,'21');await readerText(reader,2,'14');await readerText(reader,3,'14');await readerText(reader,4,'14');
  await clickReader(reader,4,locked);assert.equal(await reader.locator('#smartTextValue').count(),0,'reader editing is hidden on the other sheet');
  await clickReader(reader,0,header);assert.equal(await reader.locator('#smartTextValue').count(),0,'reader cannot edit header names');
  assert.equal(await run('datasets.fleet.rows[0][1]'),8,'offline edits remain in the reader session');assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('New dataset builds a staged typed empty table, supports Cancel, and persists only on Save',async()=>app(async({page,run})=>{
  await seed(run,[sheet({D1:'=OUTPUT(ROWS("data"),"rows")'})]);const original=await snapshot(run);
  const open=async()=>{await run('selection=[0];editingSmartIdx=null;render();');await page.locator('#componentBindingsBtn').click();await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open&&!document.querySelector('#componentBindingFields').disabled);};
  const create=async()=>{
    await page.locator('[data-new-dataset="data"]').click();const box=page.locator('[data-dataset-builder="data"]');await box.waitFor();await box.getByLabel('Dataset name',{exact:true}).fill('Inbox');
    await box.getByLabel('Column name',{exact:true}).nth(0).fill('message');await box.getByLabel('Column type',{exact:true}).nth(0).selectOption('string');
    await box.getByLabel('Column name',{exact:true}).nth(1).fill('count');await box.getByLabel('Column type',{exact:true}).nth(1).selectOption('number');
    await box.getByRole('button',{name:'Add column',exact:true}).click();await box.getByLabel('Column name',{exact:true}).nth(2).fill('ready');await box.getByLabel('Column type',{exact:true}).nth(2).selectOption('boolean');
    await box.getByRole('button',{name:'Use new dataset',exact:true}).click();await box.waitFor({state:'hidden'});
  };
  await open();await create();assert.deepEqual(await snapshot(run),original,'Use new dataset only changes the Inputs draft');await page.locator('#componentBindingsCancel').click();assert.deepEqual(await snapshot(run),original);
  await open();await create();await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);await run('smartHitSettled');
  const id=await run('items[0].inputValues.data.datasetId');assert.notEqual(id,'fleet');const saved=await run(`clone(datasets[${JSON.stringify(id)}])`);
  assert.deepEqual(saved,{name:'Inbox',columns:[{key:'message',name:'message',type:'string'},{key:'count',name:'count',type:'number'},{key:'ready',name:'ready',type:'boolean'}],rows:[],rowIds:[],revision:0,nextRowId:0});
  assert.deepEqual(await outputs(run),{rows:0});assert.ok((await text(run)).includes('message'));assert.equal((await handle(run,0,'A2')).datasetCell,undefined,'empty source rows are not invented by the grid');
  await page.reload();await run('appStarted');assert.equal(await run('items[0].inputValues.data.datasetId'),id);assert.deepEqual(await run(`datasets[${JSON.stringify(id)}]`),saved);
}));

test('Dataset Edit separates owned storage from an optional source and saves an unconnected owner',async()=>app(async({page,run})=>{
  const other={...fleet,name:'Other fleet'};await seed(run,[sheet()],{fleet,other});
  await run('selection=[1];editingSmartIdx=null;render();');await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open&&!document.querySelector('#componentBindingFields').disabled);
  assert.equal(await page.getByLabel('Owned dataset',{exact:true}).count(),1);
  assert.equal(await page.getByLabel('Incoming table (optional)',{exact:true}).isVisible(),true);
  assert.equal(await page.locator('#component-input-0').isVisible(),false,'owned storage has no connection picker');
  const storage=page.getByLabel('data dataset',{exact:true});
  assert.equal(await storage.inputValue(),JSON.stringify({datasetId:'fleet'}));
  assert.equal(await storage.locator('option').filter({hasText:'Other fleet'}).evaluate(option=>option.disabled),true,'another owner cannot be selected');
  assert.equal(await page.getByLabel('source dataset',{exact:true}).inputValue(),'');
  await page.locator('#datasetFileInput-source').setInputFiles({name:'incoming.csv',mimeType:'text/csv',buffer:Buffer.from('Boat,Points,Ready\nNew,11,true\n')});
  await page.waitForFunction(()=>document.querySelector('[aria-label="source dataset"]').value!=='');
  assert.equal(await storage.locator('option').filter({hasText:'Other fleet'}).evaluate(option=>option.disabled),true,'staging an import retains ownership restrictions');
  assert.match(await page.getByLabel('source dataset',{exact:true}).locator('option').first().textContent(),/None/);
  await page.getByLabel('source dataset',{exact:true}).selectOption('');
  await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  assert.equal(await run('items[1].datasetOwner'),'data');
  assert.equal(await run('Object.hasOwn(items[1].inputValues,"source")'),false);
  assert.deepEqual(await outputs(run,1),{data:{datasetId:'fleet'},rowCount:3});
}));
