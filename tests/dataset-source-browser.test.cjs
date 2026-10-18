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

test('source Replace and Append update only owned storage, retain pulse samples, and undo without replay',async()=>app(async({page,run})=>{
  await seed(run);await click(page,run,3);await rows(page,[['High',9],['Low',2]]);await run('smartGestureQueue');assert.equal(await run('datasetRevision(datasets.saved)'),1);assert.deepEqual(await run('datasets.incoming.rows'),incoming.rows);
  await click(page,run,4);await rows(page,[['High',9],['Low',2],['High',9],['Low',2]]);await run('smartGestureQueue');
  await run('undo();ensureEditorComponentGraph()');await run('smartGestureQueue');assert.deepEqual(await run('datasets.saved.rows'),[['High',9],['Low',2]]);
  await run('redo();ensureEditorComponentGraph()');await run('smartGestureQueue');assert.equal(await run('datasets.saved.rows.length'),4);
}));

test('offline source updates use the same explicit actions and stay local to the reader session',async()=>app(async({page,run,context})=>{
  await seed(run);const {reader,errors,requests}=await exportReader(page,run,context);await readerClick(reader,3);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="2"]')?.textContent.includes('2 rows'));
  await readerClick(reader,4);await reader.waitForFunction(()=>document.querySelector('[data-smart-index="2"]')?.textContent.includes('4 rows'));
  await reader.waitForFunction(()=>{const host=document.querySelector('[data-smart-index="5"]'),cells=[...host?.querySelectorAll('text')||[]].map(cell=>cell.textContent);return host?.dataset.smartReady==='true'&&cells.filter(value=>value==='High').length===2&&cells.includes('4');});
  assert.match(await reader.locator('[data-smart-index="5"]').textContent(),/High/);assert.deepEqual(await run('datasets.saved.rows'),[['Old',1]]);
  await reader.reload();await reader.waitForFunction(()=>document.querySelector('[data-smart-index="2"]')?.textContent.includes('1 row'));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('missing source and simultaneous update pulses are visible failures while stored readers stay available',async()=>app(async({page,run,context})=>{
  await seed(run,{source:false});await click(page,run,3);await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('Source table'));assert.deepEqual(await run('datasets.saved.rows'),[['Old',1]]);
  await click(page,run,3);await run('smartGestureQueue');const {reader,errors}=await exportReader(page,run,context);await readerClick(reader,3);
  await reader.waitForFunction(()=>document.querySelector('[data-data-action-error]')?.textContent.includes('Source table'));assert.match(await reader.locator('[data-smart-index="5"]').textContent(),/Old/);assert.deepEqual(errors,[]);
  await seed(run);await run('items[3].state.value=true;items[4].state.value=true;ensureEditorComponentGraph()');await run('smartGestureQueue');
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('either Replace or Append'));assert.deepEqual(await run('datasets.saved.rows'),[['Old',1]]);
}));

test('a Dataset can explicitly replace itself with a sorted view of its own output',async()=>app(async({page,run})=>{
  await seed(run,{self:true});await click(page,run,3);await rows(page,[['High',9],['Low',2]]);await run('smartGestureQueue');
  assert.equal(await run('datasetRevision(datasets.saved)'),1);assert.deepEqual(await run('(async()=>{const r=(await ensureEditorComponentGraph()).get(items[5]);if(r.error)throw Error(r.error);return r.io.outputs;})()'),{rows:2});
}));
