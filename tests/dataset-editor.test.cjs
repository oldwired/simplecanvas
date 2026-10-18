const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..');
const scripts=Object.fromEntries(['data-table','data-source','table-sort','table-aggregate'].map(name=>[name,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8')]));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
let browser;
before(async()=>{browser=await ({chromium,webkit}[process.env.BROWSER_ENGINE||'chromium']).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://dataset-editor.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://dataset-editor.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
const records={name:'Records',columns:[{key:'name',name:'Name',type:'string'},{key:'value',name:'Value',type:'number'},{key:'ready',name:'Ready',type:'boolean'}],rows:[['Aurora',8,true],['Borealis',2,false],['Calypso',5,true]]};
function item(name,uid,state={},extra={}){return {type:'smart',uid,componentApi:2,componentName:uid,script:scripts[name],state,x:40,y:100,w:720,h:440,color:'#94a3b8',textColor:'#334155',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,fontFamily:'sans',fontSize:13,inputValues:{},bindings:{},...extra};}
function editor(state={},extra={}){return item('data-table','Records',{maxRows:12,maxColumns:8,showCounts:true,editDataset:true,allowReaderEdit:false,...state},{inputValues:{data:{datasetId:'records'},startRow:0,startColumn:0},...extra});}
async function seed(run,list=[editor()],table=records){
  list=[...list,item('data-source','Owner',{updateMode:'Manual'},{x:1200,y:800,w:300,h:150,datasetOwner:'data',inputValues:{data:{datasetId:'records'}}})];
  await run(`cancelGesture();datasets=normalizeDatasets({records:${JSON.stringify(table)}});items=${JSON.stringify(list)};selection=[];editingSmartIdx=null;undoStack=[];redoStack=[];historyBefore=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
async function handles(run,index=0){return run(`(async()=>{const it=items[${index}],io=await resolveSmartComponentIo(it);return requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it),io]);})()`);}
async function handle(run,id,index=0){const found=(await handles(run,index)).find(h=>h.id===id);assert.ok(found,'handle '+id);return found;}
async function texts(run,index=0){return run(`(async()=>{const it=items[${index}],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'children',[it.state,smartResolvedStyle(it),it.w,it.h,false,io])).filter(c=>c.type==='text').map(c=>c.text);})()`);}
async function click(page,run,id,index=0){
  await run(`selection=[${index}];editingSmartIdx=${index};render();`);
  const h=await handle(run,id,index),it=await run(`({x:items[${index}].x,y:items[${index}].y})`),box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+it.x+h.x,box.y+it.y+h.y);await run('smartHitSettled');return h;
}
async function openCell(page,run,id,index=0){await click(page,run,id,index);const field=page.locator('[data-smart-inline-input] #smartTextValue');await field.waitFor();return field;}
async function edit(page,run,id,value,index=0){const field=await openCell(page,run,id,index);await field.fill(value);await field.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');}
async function choose(page,run,id,value){await click(page,run,id);const field=page.locator('select[data-smart-inline-input="choice"]');await field.waitFor();await field.selectOption(String(value));await field.waitFor({state:'detached'});await run('smartHitSettled');}
const snapshot=run=>run('({data:clone(datasets.records),undo:undoStack.length,redo:redoStack.length})');
async function readerText(reader,index,value){await reader.waitForFunction(({index,value})=>{const host=document.querySelector('[data-smart-index="'+index+'"]');return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(t=>t.textContent===value);},{index,value});}
async function clickReader(reader,index,h){const point=await reader.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},h);await reader.mouse.click(point.x,point.y);}
async function exportReader(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-dataset-editor-')),file=path.join(directory,'document.html');context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  fs.copyFileSync(await(await download).path(),file);const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);await readerText(reader,0,'Aurora');return {reader,errors,requests};
}

test('Dataset editor uses real row and column page controls to reach the final supported cell',async()=>app(async({page,run})=>{
  const large={name:'Large',columns:Array.from({length:32},(_,i)=>({key:'c'+i,name:'Column '+i,type:'string'})),rows:Array.from({length:1000},(_,r)=>Array.from({length:32},(_,c)=>r+':'+c))};
  await seed(run,[editor()],large);assert.equal((await handles(run)).filter(h=>h.datasetCell).length,96);
  await choose(page,run,'startRow',996);await choose(page,run,'startColumn',24);
  assert.deepEqual(await run('({row:items[0].inputValues.startRow,column:items[0].inputValues.startColumn})'),{row:996,column:24});
  assert.ok((await texts(run)).includes('999:31'));assert.equal((await handle(run,'cell-3-7')).datasetCell.rowId,'r999');
  await edit(page,run,'cell-3-7','=literal');assert.equal(await run('datasets.records.rows[999][31]'),'=literal');
  assert.ok((await handles(run)).length<=128);
}));

test('typed record edits update shared views, reject invalid values and keep formula-like text literal',async()=>app(async({page,run})=>{
  await seed(run,[editor(),editor({editDataset:false},{uid:'viewer',componentName:'Viewer',x:800})]);
  const before=await snapshot(run),field=await openCell(page,run,'cell-0-1');await field.fill('wrong');await field.press('Enter');
  await page.locator('[data-smart-inline-input] [role="alert"]').waitFor();assert.deepEqual(await snapshot(run),before);await field.press('Escape');
  await edit(page,run,'cell-0-1','14.5');assert.ok((await texts(run,1)).includes('14.5'));
  await edit(page,run,'cell-1-2','true');await edit(page,run,'cell-2-1','');await edit(page,run,'cell-0-0','=SUM(1,2)');
  assert.deepEqual(await run('datasets.records.rows'),[['=SUM(1,2)',14.5,true],['Borealis',2,true],['Calypso',null,true]]);
  assert.deepEqual(await run('(async()=>{const graph=await ensureEditorComponentGraph();return graph.get(items[0]).io.outputs;})()'),{rowCount:3});
  assert.equal((await handles(run,1)).some(h=>h.datasetCell||h.kind==='action'),false);
}));

test('Add and Delete record use stable row identities and create separate undoable dataset edits',async()=>app(async({page,run})=>{
  await seed(run);const before=await snapshot(run);await click(page,run,'addRow');
  assert.deepEqual(await run('datasets.records.rows.at(-1)'),[null,null,null]);assert.equal(await run('datasetRowIds(datasets.records).at(-1)'),'r3');
  assert.equal(await run('undoStack.length'),before.undo+1);
  await click(page,run,'delete-1');assert.deepEqual(await run('datasetRowIds(datasets.records)'),['r0','r2','r3']);
  assert.deepEqual(await run('datasets.records.rows.map(row=>row[0])'),['Aurora','Calypso',null]);assert.equal(await run('undoStack.length'),before.undo+2);
  await run('undo();ensureEditorComponentGraph()');assert.deepEqual(await run('datasetRowIds(datasets.records)'),['r0','r1','r2','r3']);
  await run('undo();ensureEditorComponentGraph()');assert.deepEqual(await run('datasets.records.rows'),records.rows);
  await run('redo();ensureEditorComponentGraph()');await run('redo();ensureEditorComponentGraph()');assert.deepEqual(await run('datasetRowIds(datasets.records)'),['r0','r2','r3']);
}));

test('sorted view edits and deletes the original record while unowned tables stay read-only',async()=>app(async({page,run})=>{
  await seed(run,[editor({}, {bindings:{data:{uid:'sorted',port:'data'}},inputValues:{startRow:0,startColumn:0}}),item('table-sort','sorted',{}, {x:1000,y:100,inputValues:{data:{datasetId:'records'},column:'value',direction:'ascending'}})]);
  assert.equal((await handle(run,'cell-0-0')).value,'Borealis');assert.equal((await handle(run,'cell-0-0')).datasetCell.rowId,'r1');assert.equal((await handles(run)).some(h=>h.id==='addRow'),false);
  await edit(page,run,'cell-0-1','9');assert.equal((await handle(run,'cell-0-0')).value,'Calypso');
  await click(page,run,'delete-0');assert.deepEqual(await run('datasets.records.rows'),[['Aurora',8,true],['Borealis',9,false]]);
  await run('items.pop();editorComponentEvaluation=null;render();ensureEditorComponentGraph()');
  assert.equal((await handles(run)).some(h=>h.datasetCell||h.kind==='action'),false,'removing the Dataset owner removes write authority');
  assert.ok((await texts(run)).includes('Aurora'));
}));

test('derived tables are read-only and connected page inputs cannot be changed by local navigation',async()=>app(async({run})=>{
  await seed(run,[editor({}, {bindings:{data:{uid:'summary',port:'data'},startRow:{uid:'Owner',port:'rowCount'}},inputValues:{startColumn:0}}),
    item('table-aggregate','summary',{}, {x:1000,y:100,inputValues:{data:{datasetId:'records'},enabled:true,group:'',value:'value',operation:'sum'}})]);
  const current=await handles(run);assert.deepEqual(current.map(h=>h.id),['startColumn']);
  assert.ok((await texts(run)).includes('15'));assert.ok((await texts(run)).some(text=>text.includes('linked')));
  assert.deepEqual(await run('datasets.records.rows'),records.rows);
}));

test('stale inline drafts and stale, out-of-view, or unauthorized record commands cannot write',async()=>app(async({page,run})=>{
  await seed(run);const oldDelete=(await handle(run,'delete-0')).action,field=await openCell(page,run,'cell-0-1');await field.fill('99');
  await run("commitEditorDatasetChange({type:'update',datasetId:'records',rowId:'r0',changes:{value:17}});ensureEditorComponentGraph()");
  const before=await snapshot(run);if(await field.count()){await field.press('Enter');await run('smartHitSettled');}assert.deepEqual(await snapshot(run),before);
  const failures=await run(`(async()=>{const graph=await ensureEditorComponentGraph(),record=graph.get(items[0]),pool=graph.datasets;const message=(action,entry=items[0],rec=record,reader=false)=>{try{prepareDatasetRecordAction(entry,action,rec,pool,reader);return 'accepted';}catch(error){return error.message;}};const current={type:'deleteDatasetRow',input:'data',datasetId:'records',revision:datasetRevision(datasets.records),rowId:'r0'},selected={...record,io:{...record.io,inputs:{...record.io.inputs,data:{datasetId:'records',rows:[1]}}}};return [message(${JSON.stringify(oldDelete)}),message(current,items[0],record,true),message({...current,datasetId:'other'}),message(current,items[0],selected),message({type:'appendDatasetRow',input:'data',datasetId:'records',revision:current.revision},items[0],selected),message(current,{...items[0],state:{editDataset:false}})];})()`);
  assert.match(failures[0],/dataset changed/);assert.match(failures[1],/disabled/);assert.match(failures[2],/dataset changed/);assert.match(failures[3],/no longer in this view/);assert.match(failures[4],/complete dataset/);assert.match(failures[5],/disabled/);assert.deepEqual(await snapshot(run),before);
}));

test('offline Dataset editor permits explicit reader edits and record actions, and reload restores embedded data',async()=>app(async({page,run,context})=>{
  await seed(run,[editor({allowReaderEdit:true}),editor({}, {uid:'locked',componentName:'Locked',x:800})]);
  const enabled=await handle(run,'cell-0-1'),locked=await handle(run,'cell-0-1',1),add=await handle(run,'addRow'),remove=await handle(run,'delete-1');
  const {reader,errors,requests}=await exportReader(page,run,context);
  await clickReader(reader,0,enabled);const field=reader.locator('#smartTextValue');await field.waitFor();await field.fill('14');await field.press('Enter');await field.waitFor({state:'detached'});await readerText(reader,1,'14');
  await clickReader(reader,1,locked);assert.equal(await reader.locator('#smartTextValue').count(),0);
  await clickReader(reader,1,add);await readerText(reader,0,'3 rows');
  await clickReader(reader,0,add);await readerText(reader,0,'4 rows');await readerText(reader,1,'4 rows');
  await clickReader(reader,0,remove);await readerText(reader,0,'3 rows');assert.equal(await reader.locator('[data-smart-index="0"] text').filter({hasText:'Borealis'}).count(),0);
  assert.deepEqual(await run('datasets.records.rows'),records.rows,'reader changes are session local');
  await reader.reload();await readerText(reader,0,'Borealis');await readerText(reader,0,'8');assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
