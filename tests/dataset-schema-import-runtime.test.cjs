const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

const root=path.join(__dirname,'..');
// Only the editor exposes fixture state. Reader assertions exercise the actual
// downloaded HTML and its rendered components without modifying its runtime.
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const datasetScript=fs.readFileSync(path.join(root,'examples','data-source.js'),'utf8');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>browser?.close());

async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://schema-import.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://schema-import.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
const original={
  name:'Readings',
  columns:[{key:'Name',name:'Name',type:'string'},{key:'Value',name:'Value',type:'number'}],
  rows:[['Embedded',1]]
};
async function seed(run,allowReaderColumnChanges=false){
  await run(`cancelGesture();datasets=normalizeDatasets({readings:${JSON.stringify(original)}});
    const make=(key,uid,x,y,extra={})=>{
      const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]);
      return {...item,uid,x,y,...extra,state:{...item.state,...extra.state}};
    };
    items=[
      make('dataSource','schema-source',50,60,{script:${JSON.stringify(datasetScript)},componentName:'Readings source',
        state:{allowReaderImport:true,allowReaderColumnChanges:${allowReaderColumnChanges}},
        inputValues:{data:{datasetId:'readings'}},bindings:{reload:{uid:'schema-reload',port:'value'}}}),
      make('dataTable','schema-table',430,60,{componentName:'All records',w:680,h:400,
        state:{editDataset:true,allowReaderEdit:true},bindings:{data:{uid:'schema-source',port:'data'}}}),
      make('tableFilter','schema-filter',50,350,{componentName:'Value filter',w:420,
        inputValues:{column:'Value',operation:'≥',number:0},bindings:{data:{uid:'schema-source',port:'data'}}}),
      make('toggle','schema-reload',50,560,{componentName:'Reload',state:{value:false}})
    ];selection=[];editingSmartIdx=null;setTool('select');render();save();ensureEditorComponentGraph()`);
  assert.deepEqual(await run('(async()=>[...(await ensureEditorComponentGraph())].filter(([,record])=>record.error).map(([,record])=>record.error))()'),[]);
}
async function handle(run,index,id){
  return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);
    return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id===${JSON.stringify(id)});
  })()`);
}
async function editorClick(page,run,index,id){
  await run(`selection=[${index}];editingSmartIdx=${index};render()`);
  const h=await handle(run,index,id),item=await run(`({x:items[${index}].x,y:items[${index}].y})`);
  assert.ok(h,id);const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+h.x,box.y+item.y+h.y);
}
async function readerClick(reader,index,h){
  const point=await reader.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{
    const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());
    return {x:p.x,y:p.y};
  },h);
  await reader.mouse.click(point.x,point.y);
}
async function filePicker(page,text){
  await page.evaluate(text=>{
    window.schemaFileText=text;window.schemaFileReads=0;
    Object.defineProperty(window,'showOpenFilePicker',{configurable:true,writable:true,value:async()=>[{
      queryPermission:async()=> 'granted',
      getFile:async()=>{window.schemaFileReads++;return new File([window.schemaFileText],'readings.csv',{type:'text/csv'});}
    }]});
  },text);
}
async function chooseFile(page){
  const dialog=page.locator('dialog[data-component-data-action="importDataset"]');
  await dialog.waitFor({state:'visible'});
  await dialog.locator('[data-data-action-choose-file]').click();
  return dialog;
}
async function waitBlocked(page){
  await page.waitForFunction(()=>{
    const dialog=document.querySelector('dialog[data-component-data-action]');
    return dialog?.querySelector('[data-data-action-submit]')?.disabled &&
      /column|remain|type/i.test(dialog.querySelector('[data-data-action-error]')?.textContent||'');
  });
}
async function useFileColumns(page,dialog){
  await dialog.locator('[data-data-action-columns]').selectOption('file');
  await page.waitForFunction(()=>document.querySelector('dialog[data-component-data-action] [data-data-action-submit]')?.disabled===false);
}
async function accept(dialog){
  await dialog.getByRole('button',{name:'Replace data',exact:true}).click();
  await dialog.waitFor({state:'detached'});
}
async function state(run){
  return run(`(async()=>{const records=await ensureEditorComponentGraph(),table=datasets[items[0].inputValues.data.datasetId];
    return {datasetId:items[0].inputValues.data.datasetId,columns:table.columns,rows:table.rows,
      sourceError:records.get(items[0]).error||null,tableError:records.get(items[1]).error||null,
      tableColumns:records.get(items[1]).io.tables.inputs.data.columns,
      filterError:records.get(items[2]).error||null,binding:items[2].bindings.data};
  })()`);
}
async function openReader(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-schema-import-'));
  const file=path.join(directory,'workspace.html');fs.copyFileSync(await(await download).path(),file);
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===4);
  return {reader,errors,requests};
}

test('editor explicitly adopts file columns, preserves links, flags configured consumers, and undoes the replacement',async()=>app(async({page,run})=>{
  await seed(run,false);const before=await state(run);
  await filePicker(page,'Region;Amount\nNorth;12\nSouth;24');
  await editorClick(page,run,0,'loadData');const dialog=await chooseFile(page);await waitBlocked(page);
  assert.equal(await dialog.locator('[data-data-action-columns]').inputValue(),'keep');
  assert.deepEqual((await state(run)).rows,original.rows,'a mismatched preview cannot change stored data');
  await useFileColumns(page,dialog);
  const impact=await dialog.locator('[data-data-action-impact]').textContent();
  for(const text of ['Name','Value','Region','Amount','Value filter'])assert.ok(impact.includes(text),'impact explains '+text);
  if(process.env.SCHEMA_IMPORT_SCREENSHOT)await dialog.screenshot({path:process.env.SCHEMA_IMPORT_SCREENSHOT});
  await accept(dialog);await run('smartHitSettled');
  const after=await state(run);
  assert.equal(after.datasetId,before.datasetId,'the existing Dataset retains its identity');
  assert.deepEqual(after.columns.map(column=>column.key),['Region','Amount']);
  assert.deepEqual(after.rows,[['North',12],['South',24]]);
  assert.deepEqual(after.tableColumns.map(column=>column.key),['Region','Amount'],'the generic editor follows the new structure');
  assert.equal(after.sourceError,null);assert.equal(after.tableError,null);
  assert.match(after.filterError,/Value|column/i,'a configured consumer remains visibly unresolved');
  assert.deepEqual(after.binding,before.binding,'schema replacement does not silently disconnect consumers');
  await run('undo();ensureEditorComponentGraph()');
  const restored=await state(run);
  assert.deepEqual(restored.columns,before.columns);assert.deepEqual(restored.rows,before.rows);
  assert.equal(restored.filterError,null,'Undo restores the configured filter as well');
}));

test('editor previews changed column types and permits them only with the explicit file-structure choice',async()=>app(async({page,run})=>{
  await seed(run);await filePicker(page,'Value;Name\ntext instead of number;Changed');
  await editorClick(page,run,0,'loadData');const dialog=await chooseFile(page);await waitBlocked(page);
  assert.match(await dialog.locator('[data-data-action-error]').textContent(),/Value.*number/i);
  await useFileColumns(page,dialog);
  const impact=await dialog.locator('[data-data-action-impact]').textContent();
  assert.match(impact,/Value/);assert.match(impact,/number/);assert.match(impact,/string|text/i);
  await accept(dialog);await run('smartHitSettled');
  const after=await state(run);
  assert.deepEqual(after.columns.map(column=>[column.key,column.type]),[['Value','string'],['Name','string']]);
  assert.deepEqual(after.rows,[['text instead of number','Changed']]);
  assert.match(after.filterError,/numeric|number|column/i);
}));

test('a superseded file preview cannot enable acceptance while the newer column inspection is still pending',async()=>app(async({page,run})=>{
  await seed(run);await filePicker(page,'Region;Amount\nFirst preview;12');
  await editorClick(page,run,0,'loadData');const dialog=await chooseFile(page);await waitBlocked(page);
  await run(`window.schemaOriginalInspect=inspectComponentGraph;window.schemaPreviewReleases=[];window.schemaPreviewFinished=[];
    inspectComponentGraph=async(...args)=>{
      const index=window.schemaPreviewReleases.length;
      await new Promise(resolve=>window.schemaPreviewReleases.push(resolve));
      try{return await window.schemaOriginalInspect(...args);}
      finally{window.schemaPreviewFinished.push(index);}
    };true`);
  try{
    await dialog.locator('[data-data-action-columns]').selectOption('file');
    await page.waitForFunction(()=>schemaPreviewReleases.length===1);
    assert.equal(await dialog.locator('[data-data-action-submit]').isDisabled(),true,'a proposed schema cannot be accepted before its consumers are inspected');
    await page.evaluate(()=>{schemaFileText='Category;Total\nSecond preview;27';});
    await dialog.locator('[data-data-action-choose-file]').click();
    await page.waitForFunction(()=>schemaPreviewReleases.length===2);
    assert.match(await dialog.locator('[data-data-action-preview]').textContent(),/Second preview/);
    await page.evaluate(()=>schemaPreviewReleases[0]());
    await page.waitForFunction(()=>schemaPreviewFinished.includes(0));
    assert.equal(await dialog.locator('[data-data-action-submit]').isDisabled(),true,'the superseded inspection cannot enable acceptance of the old file');
    assert.equal(await dialog.locator('[data-data-action-impact]').isVisible(),false,'the old inspection cannot publish a misleading impact report');
    assert.deepEqual((await state(run)).rows,original.rows);
    await page.evaluate(()=>schemaPreviewReleases[1]());
    await page.waitForFunction(()=>document.querySelector('dialog[data-component-data-action] [data-data-action-submit]')?.disabled===false);
    assert.match(await dialog.locator('[data-data-action-impact]').textContent(),/Category/);
    assert.doesNotMatch(await dialog.locator('[data-data-action-impact]').textContent(),/Region|Amount/);
    await run('inspectComponentGraph=window.schemaOriginalInspect;true');
    await accept(dialog);await run('smartHitSettled');
    const after=await state(run);
    assert.deepEqual(after.columns.map(column=>column.key),['Category','Total']);
    assert.deepEqual(after.rows,[['Second preview',27]]);
  }finally{
    await run('inspectComponentGraph=window.schemaOriginalInspect;window.schemaPreviewReleases.forEach(release=>release());true');
  }
}));

test('HTML export keeps column replacement unavailable unless the author permits it',async()=>app(async({page,run,context})=>{
  await seed(run,false);const load=await handle(run,0,'loadData');
  const {reader,errors,requests}=await openReader(page,run,context);
  await filePicker(reader,'Region;Amount\nBlocked;99');await readerClick(reader,0,load);
  const dialog=await chooseFile(reader);await waitBlocked(reader);
  assert.equal(await dialog.locator('[data-data-action-columns] option[value="file"]').count(),0,'reader import permission alone cannot replace columns');
  assert.equal(await dialog.locator('[data-data-action-submit]').isDisabled(),true);
  assert.match(await reader.locator('[data-smart-index="1"]').textContent(),/Embedded/);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('permitted HTML replacement adapts tables and keeps Reload strict against the newly accepted structure',async()=>app(async({page,run,context})=>{
  await seed(run,true);const load=await handle(run,0,'loadData'),reload=await handle(run,3,'toggle');
  const {reader,errors,requests}=await openReader(page,run,context);
  await filePicker(reader,'Region;Amount\nNorth;12');await readerClick(reader,0,load);
  const dialog=await chooseFile(reader);await waitBlocked(reader);await useFileColumns(reader,dialog);
  assert.match(await dialog.locator('[data-data-action-impact]').textContent(),/Value filter/);
  await accept(dialog);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="1"]')?.textContent.includes('North'));
  const table=await reader.locator('[data-smart-index="1"]').textContent();
  assert.match(table,/Region/);assert.match(table,/Amount/);
  await reader.waitForFunction(()=>/Value|column/i.test(document.querySelector('[data-smart-index="2"]')?.textContent||''));
  assert.match(await reader.locator('[data-smart-index="2"]').textContent(),/Unknown|requires|unavailable|column/i);
  await reader.evaluate(()=>{schemaFileText='Region;Amount\nUpdated;45';});
  await readerClick(reader,3,reload);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="1"]')?.textContent.includes('Updated'));
  assert.equal(await reader.evaluate(()=>schemaFileReads),2,'Reload accepts the schema explicitly adopted during Load data');
  await readerClick(reader,3,reload);
  await reader.waitForFunction(()=>!!document.querySelector('[data-smart-index="3"] rect[fill="#64748b"]'));
  await reader.evaluate(()=>{schemaFileText='Zone;Total\nRejected;77';});
  await readerClick(reader,3,reload);
  await reader.waitForFunction(()=>/Missing column|column.*remain/i.test(document.querySelector('[data-data-action-error]')?.textContent||''));
  assert.equal(await reader.evaluate(()=>schemaFileReads),3);
  assert.match(await reader.locator('[data-smart-index="1"]').textContent(),/Updated/,'mismatched Reload retains the last accepted data');
  assert.doesNotMatch(await reader.locator('[data-smart-index="1"]').textContent(),/Rejected/);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
