const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url'),{chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..'),scripts=Object.fromEntries(['data-source','table-sort','toggle','spreadsheet'].map(name=>[name,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8')]));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
let browser;before(async()=>{browser=await ({chromium,webkit}[process.env.BROWSER_ENGINE||'chromium']).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});after(async()=>{await browser?.close();});
async function app(fn){const context=await browser.newContext({viewport:{width:1600,height:1100}});try{
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('http://dataset-source.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));await page.goto('http://dataset-source.test/index.html');
  const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
}finally{await context.close();}}
function item(script,uid,x,y,state={},extra={}){const def=vm.runInNewContext(scripts[script]);return {type:'smart',componentApi:2,uid,componentName:uid,script:scripts[script],state:{...def.initState?.(),...state},x,y,w:300,h:150,color:'#334155',textColor:'#334155',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,fontSize:14,...def.initStyle?.(),bindings:{},inputValues:{},...extra};}
const incoming={name:'Incoming',columns:[{key:'label',name:'Label',type:'string'},{key:'value',name:'Value',type:'number'}],rows:[['Low',2],['High',9]]};
async function seed(run,{self=false,source=true,reader=true}={}){
  const items=[item('data-source','incoming',30,50,{}, {inputValues:{data:{datasetId:'incoming'}}}),
    item('table-sort','sorted',370,50,{}, {inputValues:{column:'value',direction:'descending'},bindings:{data:{uid:self?'saved':'incoming',port:'data'}}}),
    item('data-source','saved',740,50,{allowReaderUpdates:reader},{inputValues:{data:{datasetId:'saved'}},bindings:{...(source?{source:{uid:'sorted',port:'data'}}:{}),replace:{uid:'replace',port:'value'},append:{uid:'append',port:'value'}}}),
    item('toggle','replace',30,320,{value:false}),item('toggle','append',370,320,{value:false}),
    item('spreadsheet','view',740,300,{source:'Dataset',cols:4,rows:6,dataColumns:2,dataRows:4,cells:{C1:'=OUTPUT(ROWS("data"),"rows")'}},{w:600,h:300,bindings:{data:{uid:'saved',port:'data'}}})];
  await run(`cancelGesture();datasets=normalizeDatasets(${JSON.stringify({incoming,saved:{...incoming,name:'Saved',rows:self?incoming.rows:[['Old',1]]}})});items=${JSON.stringify(items)};selection=[];editingSmartIdx=null;setTool('select');render();save();ensureEditorComponentGraph()`);
  assert.deepEqual(await run('(async()=>[...(await ensureEditorComponentGraph())].filter(([,r])=>r.error).map(([it,r])=>({uid:it.uid,error:r.error})))()'),[]);
}
async function click(page,run,index){await run(`selection=[${index}];editingSmartIdx=${index};render();`);const at=await run(`({x:items[${index}].x+items[${index}].w/2,y:items[${index}].y+items[${index}].h*.69})`),box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+at.x,box.y+at.y);}
async function rows(page,expected){await page.waitForFunction(expected=>__test.run('JSON.stringify(datasets.saved.rows)')===JSON.stringify(expected),expected);}
async function readerClick(reader,index){const p=await reader.locator('[data-smart-index="'+index+'"]').evaluate(host=>{const box=host.firstElementChild.getBBox(),point=new DOMPoint(box.width/2,box.height*.69).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};});await reader.mouse.click(p.x,p.y);}
async function exportReader(page,run,context){const download=page.waitForEvent('download');await run('exportHtml()');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-source-')),file=path.join(dir,'index.html');context.on('close',()=>fs.rmSync(dir,{recursive:true,force:true}));fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];reader.on('pageerror',e=>errors.push(e.message));reader.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await reader.goto(pathToFileURL(file).href);await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===6);return {reader,errors,requests};}


async function flush(run){await run('ensureEditorComponentGraph()');await run('smartGestureQueue');await run('ensureEditorComponentGraph()');await run('smartGestureQueue');}
async function mirror(run){
  const value=item('spreadsheet','mirror',370,50,{source:'Dataset',dataRows:2,dataColumns:2,cols:3,rows:3,cells:{C1:'=OUTPUT(A2:B3,"table","label:string,value:number")'}},{bindings:{data:{uid:'incoming',port:'data'}}});
  await run(`items[1]=${JSON.stringify(value)};items[2].bindings.source={uid:'mirror',port:'table'};items[2].state.updateMode='Live';items[0].state.allowReaderImport=true;items[0].bindings.reload={uid:'replace',port:'value'};delete items[2].bindings.replace;save();editorComponentEvaluation=null;ensureEditorComponentGraph()`);await flush(run);
}
async function filePicker(page){await page.evaluate(()=>{
  window.fileText='label,value\nLow,2\nHigh,9';window.fileReads=0;
  Object.defineProperty(window,'showOpenFilePicker',{configurable:true,value:async()=>[{queryPermission:async()=>'granted',getFile:async()=>{window.fileReads++;return new File([window.fileText],'data.csv',{type:'text/csv'});}}]});
});}
async function load(page,click){await click();const dialog=page.locator('dialog[data-component-data-action="importDataset"]');await dialog.waitFor();await dialog.locator('[data-data-action-choose-file]').click();await page.waitForFunction(()=>!document.querySelector('[data-data-action-submit]').disabled);await dialog.getByRole('button',{name:'Replace data',exact:true}).click();await dialog.waitFor({state:'detached'});}
async function handle(run,index,id){return run(`(async()=>{const it=items[${index}],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it),io])).find(h=>h.id===${JSON.stringify(id)});})()`);}
async function clickHandle(page,run,index,id){const h=await handle(run,index,id);assert.ok(h,id);await run(`selection=[${index}];editingSmartIdx=${index};render()`);const it=await run(`items[${index}]`),box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+it.x+h.x,box.y+it.y+h.y);}
async function readerHandle(reader,index,h){const point=await reader.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},h);await reader.mouse.click(point.x,point.y);}
async function readerText(reader,index,text){await reader.waitForFunction(({index,text})=>{const host=document.querySelector('[data-smart-index="'+index+'"]');return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(t=>t.textContent===text);},{index,text});}

test('editor Live mode keeps local edits through redraw and undo, then applies the next source refresh once',async()=>app(async({page,run})=>{
  await seed(run);await run("items[2].state.updateMode='Live';ensureEditorComponentGraph()");await rows(page,[['High',9],['Low',2]]);await flush(run);assert.equal(await run('datasetRevision(datasets.saved)'),1);
  await run("commitEditorDatasetChange({type:'update',datasetId:'saved',rowId:datasets.saved.rowIds[0],changes:{value:77}});ensureEditorComponentGraph()");await flush(run);assert.equal(await run('datasets.saved.rows[0][1]'),77);
  await run("items[0].x+=1;items[2].componentName='Renamed';render();ensureEditorComponentGraph()");await flush(run);assert.equal(await run('datasets.saved.rows[0][1]'),77);
  await run('undo();ensureEditorComponentGraph()');await flush(run);assert.equal(await run('datasets.saved.rows[0][1]'),9);
  await run('redo();ensureEditorComponentGraph()');await flush(run);assert.equal(await run('datasets.saved.rows[0][1]'),77);
  await run("commitEditorDatasetChange({type:'replace',datasetId:'incoming',table:datasets.incoming});ensureEditorComponentGraph()");await rows(page,[['High',9],['Low',2]]);await flush(run);assert.equal(await run('datasetRevision(datasets.saved)'),3);
}));

test('same-data file reload crosses Spreadsheet table output and replaces destination edits exactly once',async()=>app(async({page,run})=>{
  await seed(run);await mirror(run);await rows(page,incoming.rows);await filePicker(page);await load(page,()=>clickHandle(page,run,0,'loadData'));await flush(run);
  await run("commitEditorDatasetChange({type:'update',datasetId:'saved',rowId:datasets.saved.rowIds[0],changes:{value:77}});ensureEditorComponentGraph()");await flush(run);const revision=await run('datasetRevision(datasets.saved)');
  await click(page,run,3);await rows(page,incoming.rows);await flush(run);assert.equal(await page.evaluate(()=>fileReads),2);assert.equal(await run('datasetRevision(datasets.saved)'),revision+1);
  await run('render();ensureEditorComponentGraph()');await flush(run);assert.equal(await run('datasetRevision(datasets.saved)'),revision+1);assert.equal(await page.evaluate(()=>fileReads),2);
}));

test('offline Live mode preserves edits until a successful file refresh and never changes the embedded document',async()=>app(async({page,run,context})=>{
  await seed(run);await mirror(run);await rows(page,incoming.rows);await run('items[5].state.editDataset=true;items[5].state.allowReaderEdit=true;save();ensureEditorComponentGraph()');await flush(run);
  const cell=await handle(run,5,'B2'),loadHandle=await handle(run,0,'loadData');const {reader,errors,requests}=await exportReader(page,run,context);await filePicker(reader);await readerText(reader,5,'Low');
  await readerHandle(reader,5,cell);const field=reader.locator('[data-smart-inline-input] #smartTextValue');await field.waitFor();await field.fill('77');await field.press('Enter');await field.waitFor({state:'detached'});await readerText(reader,5,'77');
  await load(reader,()=>readerHandle(reader,0,loadHandle));await reader.waitForFunction(()=>!document.querySelector('[data-smart-index="5"]')?.textContent.includes('77'));assert.doesNotMatch(await reader.locator('[data-smart-index="5"]').textContent(),/77/);
  await readerHandle(reader,5,cell);await field.waitFor();await field.fill('88');await field.press('Enter');await field.waitFor({state:'detached'});await readerText(reader,5,'88');
  await reader.evaluate(()=>{fileText='wrong,value\nOops,7';});await readerClick(reader,3);await reader.waitForFunction(()=>document.querySelector('[data-data-action-error]')?.textContent.includes('label'));await readerText(reader,5,'88');
  assert.deepEqual(await run('datasets.saved.rows'),incoming.rows);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await reader.reload();await readerText(reader,5,'Low');assert.doesNotMatch(await reader.locator('[data-smart-index="5"]').textContent(),/88/);
}));

test('offline Live source updates remain disabled without the Dataset permission',async()=>app(async({page,run,context})=>{
  await seed(run,{reader:false});await mirror(run);await rows(page,incoming.rows);const loadHandle=await handle(run,0,'loadData');const {reader,errors}=await exportReader(page,run,context);await filePicker(reader);await reader.evaluate(()=>{fileText='label,value\nChanged,5';});
  await load(reader,()=>readerHandle(reader,0,loadHandle));await reader.waitForFunction(()=>document.querySelector('[data-smart-index="0"]')?.textContent.includes('1 row'));await readerText(reader,5,'Low');assert.doesNotMatch(await reader.locator('[data-smart-index="5"]').textContent(),/Changed/);assert.deepEqual(errors,[]);
}));
