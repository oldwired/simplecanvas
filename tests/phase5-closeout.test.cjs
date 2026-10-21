const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const html=parseApp(fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-closeout-'));
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://phase5-closeout.test/**',route=>route.fulfill(new URL(route.request().url()).pathname.endsWith('index.html')?
      {contentType:'text/html',body:html}:{status:404,body:''}));
    await page.goto('http://phase5-closeout.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');
    await fn({page,run,context,directory});
    assert.deepEqual(errors,[],'the authored workflow has no uncaught editor errors');
  }finally{await context.close();fs.rmSync(directory,{recursive:true,force:true});}
}

async function place(page,run,name,x,y){
  if(await page.locator('#shapePicker').isHidden())await page.locator('#shapeLibBtn').click();
  if(await page.locator('#libraryBrowser').isHidden())await page.locator('#browseShapesBtn').click();
  await page.locator('#librarySearch').fill(name);
  await page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place '+name,exact:true}).click();
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+x,box.y+y);
  await run('shapePlacementQueue');
  return run('items[items.length-1]');
}
async function editSelected(page){
  await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open&&
    !document.querySelector('#componentBindingFields').disabled&&!document.querySelector('#componentBindingsSave').disabled);
}
async function saveEdit(page){
  await page.locator('#componentBindingsSave').click();
  await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});
}
async function drawing(page,uid,text){
  await page.waitForFunction(({uid,text})=>__test.run(
    `smartChildrenCache.get(${JSON.stringify(uid)})?.kids.some(k=>k.text===${JSON.stringify(text)})`),{uid,text});
}
async function handle(run,index,id){
  return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);
    return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id===${JSON.stringify(id)});})()`);
}
async function readerText(frame,index,text){
  await frame.waitForFunction(({index,text})=>{
    const host=document.querySelector('[data-smart-index="'+index+'"]');
    return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(node=>node.textContent===text);
  },{index,text});
}
async function clickReaderHandle(page,frame,index,handle,preview){
  assert.ok(handle,'the visible component has its interactive handle');
  const point=await frame.locator('[data-smart-index="'+index+'"]').evaluate((host,handle)=>{
    const p=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};
  },handle);
  const offset=preview?await page.locator('#runPreviewFrame').boundingBox():{x:0,y:0};
  await page.mouse.click(offset.x+point.x,offset.y+point.y);
}
async function download(page,action,destination){
  await page.locator('#menuBtn').click();
  const pending=page.waitForEvent('download');
  await page.locator('#menu [data-act="'+action+'"]').click();
  await(await pending).saveAs(destination);
}

// Authoring uses library, canvas and inspector gestures. Eval is used only to
// synchronize accepted rendering, inspect persisted state, and locate handles.
async function roundtrip({page,run,context,directory},consumer,original,changed){
  const plus=await handle(run,0,'plus');
  await run('persistWorkspace()');
  const before=await run('({items:clone(items),datasets:clone(datasets),undo:clone(undoStack),redo:clone(redoStack)})');
  const saved=await run('readSavedWorkspace()');
  await page.locator('#runPreviewBtn').click();
  await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
  const frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();
  await readerText(frame,consumer,original);
  await clickReaderHandle(page,frame,0,plus,true);
  await readerText(frame,consumer,changed);
  await page.locator('#exitPreviewBtn').click();
  await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
  assert.deepEqual(await run('({items:clone(items),datasets:clone(datasets),undo:clone(undoStack),redo:clone(redoStack)})'),before,
    'returning from Run preserves authoring state and undo history');
  assert.deepEqual(await run('readSavedWorkspace()'),saved,'preview edits do not enter autosave');

  const workspace=path.join(directory,'authored-workspace.json');
  await download(page,'saveWorkspace',workspace);
  assert.ok(fs.statSync(workspace).size>0,'Save workspace downloads the authored document');
  await page.reload();await run('appStarted');
  assert.deepEqual(await run('items.map(item=>item.componentName)'),before.items.map(item=>item.componentName),'reload restores the authored workspace');
  const generation=await run('workspaceGeneration');
  await page.locator('#menuBtn').click();
  const chooser=page.waitForEvent('filechooser');
  await page.locator('#menu [data-act="openWorkspace"]').click();
  await(await chooser).setFiles(workspace);
  await page.waitForFunction(generation=>__test.run('workspaceGeneration')>generation,generation);
  const restored=await run('items.map(({componentName,bindings,inputValues,state})=>({componentName,bindings,inputValues,state}))');
  assert.deepEqual(restored,before.items.map(({componentName,bindings,inputValues,state})=>({componentName,bindings,inputValues,state})),
    'downloaded workspace keeps names, bindings, configuration and formula cells');

  const output=path.join(directory,'authored-workspace.html');
  await download(page,'html',output);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(output).href);
  await readerText(reader,consumer,original);
  await clickReaderHandle(reader,reader,0,plus,false);
  await readerText(reader,consumer,changed);
  assert.deepEqual(errors,[],'the self-contained export runs without uncaught errors');
  assert.deepEqual(requests,[],'the downloaded HTML needs no network resources');
}

test('author a named binding through the library and Edit, then Run, discard, reopen and export it',async()=>app(async tools=>{
  const {page,run}=tools;
  const source=await place(page,run,'Number control',220,160);
  await editSelected(page);
  await page.locator('#componentNameInput').fill('Quantity');
  await page.getByLabel('step value',{exact:true}).fill('2');
  await saveEdit(page);
  const label=await place(page,run,'Value label',650,160);
  await editSelected(page);
  await page.locator('#componentNameInput').fill('Quantity display');
  await page.getByLabel('value (number)',{exact:true}).selectOption(JSON.stringify({uid:source.uid,port:'value'}));
  await saveEdit(page);
  await drawing(page,label.uid,'50');
  await roundtrip(tools,1,'50','52');
}));

test('Spreadsheet keeps its compact inspector and inline formulas throughout the authored Run and export workflow',async()=>app(async tools=>{
  const {page,run}=tools;
  const source=await place(page,run,'Number control',220,160);
  const sheet=await place(page,run,'Spreadsheet',600,420);
  assert.deepEqual(sheet.state.cells,{},'new spreadsheets start empty');
  await editSelected(page);
  assert.equal(await page.locator('#componentTypeName').textContent(),'Spreadsheet');
  assert.equal(await page.locator('#componentConfigurationSection').isVisible(),false);
  assert.equal(await page.getByRole('heading',{name:'Table connections',exact:true}).count(),0);
  await page.locator('#componentNameInput').fill('Calculation');
  await saveEdit(page);
  const cell=await handle(run,1,'A1'),box=await page.locator('#canvas').boundingBox();
  assert.ok(cell,'the first cell exposes inline editing');
  await page.mouse.dblclick(box.x+sheet.x+cell.x,box.y+sheet.y+cell.y);
  await run('smartHitSettled');
  if(await page.locator('[data-smart-inline-input] #smartTextValue').count()===0){
    await page.mouse.click(box.x+sheet.x+cell.x,box.y+sheet.y+cell.y);
  }
  const input=page.locator('[data-smart-inline-input] #smartTextValue');
  await input.fill('=OUTPUT(INPUT("amount")*2,"answer")');
  await input.press('Enter');await input.waitFor({state:'detached'});await run('smartHitSettled');
  await editSelected(page);
  assert.equal(await page.locator('#componentTypeName').textContent(),'Spreadsheet');
  assert.equal(await page.locator('#componentNameInput').inputValue(),'Calculation');
  await page.getByLabel('amount (number)',{exact:true}).selectOption(JSON.stringify({uid:source.uid,port:'value'}));
  await saveEdit(page);
  const label=await place(page,run,'Value label',1030,160);
  await editSelected(page);
  await page.getByLabel('value (number)',{exact:true}).selectOption(JSON.stringify({uid:sheet.uid,port:'answer'}));
  await saveEdit(page);
  await drawing(page,label.uid,'100');
  await roundtrip(tools,2,'100','102');
}));
