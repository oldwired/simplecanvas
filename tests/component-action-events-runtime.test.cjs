const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..');
const scripts=Object.fromEntries(['data-source','capture-row'].map(name=>[name,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8')]));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
let browser;
before(async()=>{browser=await ({chromium,webkit}[process.env.BROWSER_ENGINE||'chromium']).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>browser?.close());
async function app(fn){
 const context=await browser.newContext({viewport:{width:1600,height:1100}});
 try{const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.route('http://action-events.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));await page.goto('http://action-events.test/index.html');
  const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
const collector=`({apiVersion:2,eventApi:1,inputs:{},outputs:{text:{type:'string'},count:{type:'number'}},eventInputs:{loaded:{type:'number'},captured:{type:'number'},failed:{type:'string'}},initState(){return {entries:[]};},publish(state){return {text:state.entries.join(' | '),count:state.entries.length};},onEvent(name,payload,state){return {state:{entries:[...state.entries,name+':'+payload].slice(-10)}};},children(state){return [{type:'text',x:4,y:4,w:490,h:300,text:state.entries.join(' | ')||'No completions',plainText:true,font:'16px sans-serif',color:'#334155'}];}})`;
const columns=[{key:'label',name:'label',type:'string'},{key:'value',name:'value',type:'number'},{key:'active',name:'active',type:'boolean'}];
async function seed(run,rows=[]){
 await run(`cancelGesture();datasets=normalizeDatasets({log:{name:'Log',columns:${JSON.stringify(columns)},rows:${JSON.stringify(rows)}}});const make=(key,uid,x,y,extra={})=>{const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]);return {...item,uid,x,y,...extra,state:{...item.state,...extra.state}};};items=[
  make('dataSource','source',40,50,{script:${JSON.stringify(scripts['data-source'])},state:{allowReaderImport:true},inputValues:{data:{datasetId:'log'}},bindings:{reload:{uid:'reload',port:'value'}}}),
  make('toggle','reload',400,50,{state:{value:false}}),
  make('captureRow','capture',40,300,{script:${JSON.stringify(scripts['capture-row'])},state:{allowReaderCapture:true},bindings:{data:{uid:'source',port:'data'},capture:{uid:'trigger',port:'value'}},inputValues:{field0:'Sample',field1:7,field2:true}}),
  make('trigger','trigger',400,300),
  {type:'smart',componentApi:2,uid:'events',script:${JSON.stringify(collector)},componentName:'Completions',state:{entries:[]},x:800,y:50,w:500,h:300,eventBindings:{loaded:{uid:'source',port:'loaded'},captured:{uid:'capture',port:'captured'},failed:{uid:'source',port:'failed'}}}
 ];selection=[];editingSmartIdx=null;setTool('select');render();save();ensureEditorComponentGraph()`);
 assert.deepEqual(await run('(async()=>[...(await ensureEditorComponentGraph())].filter(([,r])=>r.error).map(([i,r])=>({uid:i.uid,error:r.error})))()'),[]);
}
async function handle(run,index,id){return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(h=>h.id===${JSON.stringify(id)});})()`);}
async function clickEditor(page,run,index,id){await run(`selection=[${index}];editingSmartIdx=${index};render()`);const h=await handle(run,index,id),it=await run(`({x:items[${index}].x,y:items[${index}].y})`),box=await page.locator('#canvas').boundingBox();assert.ok(h,id);await page.mouse.click(box.x+it.x+h.x,box.y+it.y+h.y);}
async function clickReader(page,index,h){const p=await page.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},h);await page.mouse.click(p.x,p.y);}
async function logs(page,run,count){await page.waitForFunction(count=>__test.run('items[4].state.entries.length')===count,count);return run('items[4].state.entries');}
async function readerLog(page,text){await page.waitForFunction(text=>document.querySelector('[data-smart-index="4"]')?.textContent.includes(text),text);}
async function picker(page){await page.evaluate(()=>{window.fileText='label;value;active\nOne;1;true\nTwo;2;false';window.permission='granted';window.showOpenFilePicker=async()=>[{queryPermission:async()=>permission,getFile:async()=>new File([fileText],'log.csv',{type:'text/csv'})}];});}
async function choose(page){const dialog=page.locator('dialog[data-component-data-action]');await dialog.waitFor();await dialog.locator('[data-data-action-choose-file]').click();return dialog;}
async function replace(dialog){await dialog.getByRole('button',{name:'Replace data',exact:true}).click();await dialog.waitFor({state:'detached'});}
async function exported(page,run,context){const download=page.waitForEvent('download');await run('exportHtml()');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-action-events-')),file=path.join(dir,'demo.html');fs.copyFileSync(await(await download).path(),file);context.on('close',()=>fs.rmSync(dir,{recursive:true,force:true}));const reader=await context.newPage(),errors=[];reader.on('pageerror',e=>errors.push(e.message));await reader.goto(pathToFileURL(file).href);await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===5);return {reader,errors};}

test('editor file import/reload completes once after acceptance, reports failures, and cancellation does not emit',async()=>app(async({page,run})=>{
 await seed(run);await picker(page);await clickEditor(page,run,0,'loadData');let dialog=await choose(page);assert.deepEqual(await run('items[4].state.entries'),[],'preview alone never loads');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});await run('smartHitSettled');assert.deepEqual(await run('items[4].state.entries'),[]);
 await clickEditor(page,run,0,'loadData');dialog=await choose(page);await replace(dialog);assert.deepEqual(await logs(page,run,1),['loaded:2']);await run('smartHitSettled');
 await clickEditor(page,run,1,'toggle');assert.deepEqual(await logs(page,run,2),['loaded:2','loaded:2'],'identical successful reload still completes');await run('smartHitSettled');
 await clickEditor(page,run,1,'toggle');await run('smartHitSettled');await page.evaluate(()=>{fileText='wrong;value;active\nBad;1;true';});await clickEditor(page,run,1,'toggle');const failed=await logs(page,run,3);assert.match(failed[2],/^failed:/);assert.equal(await run('datasets.log.rows.length'),2);
 await run('render();ensureEditorComponentGraph()');assert.equal((await run('items[4].state.entries')).length,3,'repaint cannot replay completion');
}));

test('invalid file preview emits failure without data mutation, while closing its dialog causes no extra occurrence',async()=>app(async({page,run})=>{
 await seed(run);await picker(page);await page.evaluate(()=>{fileText='label;value;active\n"unclosed;1;true';});await clickEditor(page,run,0,'loadData');const dialog=await choose(page);assert.match((await logs(page,run,1))[0],/^failed:.*unclosed/);assert.equal(await run('datasets.log.rows.length'),0);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});await run('smartHitSettled');assert.equal((await run('items[4].state.entries')).length,1);
 await run('undo();ensureEditorComponentGraph()');assert.deepEqual(await run('items[4].state.entries'),[],'failed attempts have an independent undoable completion');assert.equal(await run('datasets.log.rows.length'),0);
 await run('redo();ensureEditorComponentGraph()');assert.equal((await run('items[4].state.entries')).length,1,'redo restores the log without repeating file IO');
}));

test('offline reader imports and reloads deliver typed completion events and failed permission reads keep accepted data',async()=>app(async({page,run,context})=>{
 await seed(run);const load=await handle(run,0,'loadData'),reload=await handle(run,1,'toggle');const {reader,errors}=await exported(page,run,context);await picker(reader);
 await clickReader(reader,0,load);await replace(await choose(reader));await readerLog(reader,'loaded:2');
 await clickReader(reader,1,reload);await readerLog(reader,'loaded:2 | loaded:2');await clickReader(reader,1,reload);await reader.waitForFunction(()=>!!document.querySelector('[data-smart-index="1"] rect[fill="#64748b"]'));
 await reader.evaluate(()=>{permission='denied';});await clickReader(reader,1,reload);await readerLog(reader,'failed:');assert.match(await reader.locator('[data-smart-index="0"]').textContent(),/2 rows/);assert.deepEqual(errors,[]);
 await reader.reload();await readerLog(reader,'No completions');
}));

test('Capture row emits zero-based inserted indices and row-limit failure in editor and HTML',async()=>app(async({page,run,context})=>{
 await seed(run);await run("items[4].eventBindings.failed={uid:'capture',port:'failed'};editorComponentEvaluation=null;ensureEditorComponentGraph()");
 await clickEditor(page,run,3,'trigger');assert.deepEqual(await logs(page,run,1),['captured:0']);await run('smartHitSettled');await clickEditor(page,run,3,'trigger');assert.deepEqual(await logs(page,run,2),['captured:0','captured:1']);await run('smartHitSettled');
 await run('undo();ensureEditorComponentGraph()');assert.equal(await run('datasets.log.rows.length'),1);assert.deepEqual(await run('items[4].state.entries'),['captured:0'],'undo returns the accepted append and its completion together');
 const rows=Array.from({length:1000},(_,i)=>['Row'+i,i,true]);await seed(run,rows);await run("items[4].eventBindings.failed={uid:'capture',port:'failed'};editorComponentEvaluation=null;ensureEditorComponentGraph()");const trigger=await handle(run,3,'trigger');
 const {reader,errors}=await exported(page,run,context);await clickReader(reader,3,trigger);await readerLog(reader,'failed:');assert.match(await reader.locator('[data-smart-index="4"]').textContent(),/1000/);assert.equal((await reader.locator('[data-smart-index="4"]').textContent()).includes('captured:'),false);
 await clickEditor(page,run,3,'trigger');assert.match((await logs(page,run,1))[0],/^failed:.*1000/);assert.equal(await run('datasets.log.rows.length'),1000);assert.deepEqual(errors,[]);
}));
