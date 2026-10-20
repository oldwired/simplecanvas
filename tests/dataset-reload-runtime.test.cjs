const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

// Expose the editor fixture only. Every component still crosses the actual
// Worker boundary; downloaded HTML uses its own unmodified offline runtime.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  try{
    const page=await context.newPage(),errors=[],dialogs=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.accept();});
    await page.route('http://data-components.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://data-components.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context,dialogs});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function seed(run,specs,pool={}){
  await run(`cancelGesture();datasets=normalizeDatasets(${JSON.stringify(pool)});items=${JSON.stringify(specs)}.map((spec,index)=>{
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===spec.key).items[0]);
    return {...base,uid:'data-'+index,x:70+(index%3)*480,y:100+Math.floor(index/3)*350,...spec,state:{...base.state,...spec.state}};
  });selection=[];editingSmartIdx=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
async function output(run,index){
  return run(`(async()=>{const record=(await ensureEditorComponentGraph()).get(items[${index}]);
    if(record.error)throw new Error(record.error);return record.io.outputs;})()`);
}
async function exportFile(page,run,expression,extension){
  const download=page.waitForEvent('download');await run(expression);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-data-'));
  const file=path.join(directory,'document.'+extension);fs.copyFileSync(await(await download).path(),file);
  return {directory,file};
}
async function openReader(page,run,context){
  const {directory,file}=await exportFile(page,run,'exportHtml()','html');
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('dialog',dialog=>{errors.push('Unexpected reader dialog: '+dialog.message());return dialog.dismiss();});
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  return {reader,errors,requests,file};
}
const datasetScript=fs.readFileSync(path.join(__dirname,'..','examples','data-source.js'),'utf8');
const baseline={name:'Initial',columns:[{key:'Name',name:'Name',type:'string'},{key:'Value',name:'Value',type:'number'}],rows:[['Embedded',1]]};
async function prepare(run){
  await seed(run,[
    {key:'dataSource',script:datasetScript,componentName:'Reloadable data',x:50,y:60,state:{allowReaderImport:true},inputValues:{data:{datasetId:'base'}},bindings:{reload:{uid:'data-2',port:'value'}}},
    {key:'dataTable',componentName:'Results',x:400,y:60,bindings:{data:{uid:'data-0',port:'data'}}},
    {key:'toggle',componentName:'Reload',x:50,y:300,state:{value:false}}
  ],{base:baseline});
}
async function editorClick(page,run,index,id){
  const {item,handle}=await run(`(async()=>{selection=[${index}];editingSmartIdx=${index};render();const item=items[${index}],handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)]);return {item,handle:handles.find(handle=>handle.id===${JSON.stringify(id)})};})()`);
  assert.ok(handle,id);const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.click(canvas.x+item.x+handle.x,canvas.y+item.y+handle.y);
}
async function readerClick(reader,index,x,y){
  const at=await reader.locator('[data-smart-index="'+index+'"]').evaluate((host,{x,y})=>{
    const point=new DOMPoint(x,y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};
  },{x,y});await reader.mouse.click(at.x,at.y);
}
async function fakeFilePicker(page){
  await page.evaluate(()=>{
    window.fileText='Name;Value\nChosen;2';window.fileReads=0;window.filePermission='granted';
    Object.defineProperty(window,'showOpenFilePicker',{configurable:true,writable:true,value:async()=>[{
      queryPermission:async()=>window.filePermission,
      getFile:async()=>{window.fileReads++;return new File([window.fileText],'results.csv',{type:'text/csv'});}
    }]});
  });
}
async function acceptFile(page){
  const dialog=page.locator('dialog[data-component-data-action="importDataset"]');await dialog.waitFor({state:'visible'});
  await dialog.locator('[data-data-action-choose-file]').click();
  await page.waitForFunction(()=>!document.querySelector('dialog[data-component-data-action] [data-data-action-submit]').disabled);
  assert.match(await dialog.locator('[data-data-action-preview]').textContent(),/Chosen/);
  await dialog.getByRole('button',{name:'Replace data',exact:true}).click();await dialog.waitFor({state:'detached'});
}
async function editorRows(run){return run('datasets[items[0].inputValues.data.datasetId].rows');}
async function editorShows(page,value){
  await page.waitForFunction(value=>__test.run(`datasets[items[0].inputValues.data.datasetId].rows[0][0]===${JSON.stringify(value)}`),value);
}

test('editor Reload rereads a fresh handle once per rising edge and preserves accepted data on schema errors',async()=>app(async({page,run})=>{
  await prepare(run);await fakeFilePicker(page);
  await editorClick(page,run,0,'loadData');await acceptFile(page);await run('smartHitSettled');
  assert.deepEqual(await editorRows(run),[['Chosen',2]]);assert.equal(await page.evaluate(()=>fileReads),1);
  await page.evaluate(()=>{fileText='Name;Value\nFresh;3';});
  await editorClick(page,run,2,'toggle');await editorShows(page,'Fresh');await run('smartHitSettled');
  assert.equal(await page.evaluate(()=>fileReads),2);
  await run('render();ensureEditorComponentGraph()');assert.equal(await page.evaluate(()=>fileReads),2,'a held-high input and redraw cannot repeat the file read');
  await editorClick(page,run,2,'toggle');await run('smartHitSettled');
  await page.evaluate(()=>{fileText='Wrong;Value\nBad;9';});
  await editorClick(page,run,2,'toggle');await run('smartHitSettled');
  await page.waitForFunction(()=>fileReads===3);
  assert.deepEqual(await editorRows(run),[['Fresh',3]],'a schema mismatch keeps the last accepted data');
  await editorClick(page,run,2,'toggle');await run('smartHitSettled');
  await page.evaluate(()=>{fileText='Name;Value\nRecovered;4';});
  await editorClick(page,run,2,'toggle');await editorShows(page,'Recovered');await run('smartHitSettled');
  assert.equal(await page.evaluate(()=>fileReads),4);
  assert.equal(await run('JSON.stringify(makeDocument(items,assets,{},datasets)).includes("fileReads")'),false);
}));

test('offline reader Reload rereads its session handle and reload starts from embedded data without file access',async()=>app(async({page,run,context})=>{
  await prepare(run);const {reader,errors,requests}=await openReader(page,run,context);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===3);await fakeFilePicker(reader);
  await readerClick(reader,0,150,124);await acceptFile(reader);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="1"]')?.textContent.includes('Chosen'));
  await reader.evaluate(()=>{fileText='Name;Value\nFresh reader;7';});
  await readerClick(reader,2,110,69);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="1"]')?.textContent.includes('Fresh reader'));
  assert.equal(await reader.evaluate(()=>fileReads),2);
  await readerClick(reader,2,110,69);await reader.waitForFunction(()=>!!document.querySelector('[data-smart-index="2"] rect[fill="#64748b"]'));
  await reader.evaluate(()=>{filePermission='denied';});
  await readerClick(reader,2,110,69);
  await reader.waitForFunction(()=>document.querySelector('[data-data-action-error]')?.textContent.includes('Choose the file again'));
  assert.match(await reader.locator('[data-smart-index="1"]').textContent(),/Fresh reader/);assert.equal(await reader.evaluate(()=>fileReads),2,'lost permission does not read the file');
  await reader.reload();await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===3);
  assert.match(await reader.locator('[data-smart-index="1"]').textContent(),/Embedded/);
  await readerClick(reader,2,110,69);
  await reader.waitForFunction(()=>document.querySelector('[data-data-action-error]')?.textContent.includes('Choose the file again'));
  assert.match(await reader.locator('[data-smart-index="1"]').textContent(),/Embedded/);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('fallback imports explain that automatic rereading is unavailable and keep accepted contents',async()=>app(async({page,run})=>{
  await prepare(run);await page.evaluate(()=>Object.defineProperty(window,'showOpenFilePicker',{configurable:true,value:undefined}));
  await editorClick(page,run,0,'loadData');const dialog=page.locator('dialog[data-component-data-action]');await dialog.waitFor({state:'visible'});
  assert.match(await dialog.locator('[data-data-action-reload-note]').textContent(),/automatic Reload is unavailable/);
  await dialog.locator('[data-data-action-file]').setInputFiles({name:'results.csv',mimeType:'text/csv',buffer:Buffer.from('Name;Value\nFallback;5')});
  await dialog.getByRole('button',{name:'Replace data',exact:true}).click();await dialog.waitFor({state:'detached'});await run('smartHitSettled');
  await editorClick(page,run,2,'toggle');await run('smartHitSettled');assert.deepEqual(await editorRows(run),[['Fallback',5]]);
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('cannot reread'));
}));

test('a pending native file selection cannot accept an older preview or remember the wrong file handle',async()=>app(async({page,run})=>{
  await prepare(run);await fakeFilePicker(page);await editorClick(page,run,0,'loadData');
  const dialog=page.locator('dialog[data-component-data-action]');await dialog.waitFor({state:'visible'});
  await dialog.locator('[data-data-action-choose-file]').click();
  await page.waitForFunction(()=>document.querySelector('[data-data-action-preview]')?.textContent.includes('Chosen'));
  await page.evaluate(()=>{
    window.secondText='Name;Value\nSecond;6';let first=true;
    window.showOpenFilePicker=async()=>[{
      queryPermission:async()=> 'granted',getFile:async()=>{
        if(first){first=false;await new Promise(resolve=>{window.releaseSecond=resolve;});}
        return new File([window.secondText],'second.csv',{type:'text/csv'});
      }
    }];
  });
  await dialog.locator('[data-data-action-choose-file]').click();await page.waitForFunction(()=>typeof releaseSecond==='function');
  assert.equal(await dialog.locator('[data-data-action-submit]').isDisabled(),true,'old preview cannot be committed while getFile is pending');
  await page.evaluate(()=>releaseSecond());
  await page.waitForFunction(()=>document.querySelector('[data-data-action-preview]')?.textContent.includes('Second') && !document.querySelector('[data-data-action-submit]').disabled);
  await dialog.getByRole('button',{name:'Replace data',exact:true}).click();await dialog.waitFor({state:'detached'});await run('smartHitSettled');
  await page.evaluate(()=>{secondText='Name;Value\nSecond updated;8';fileText='Name;Value\nWrong first file;9';});
  await editorClick(page,run,2,'toggle');await editorShows(page,'Second updated');
}));

test('a slow reload cannot block manual Load data and its late result cannot overwrite the new file',async()=>app(async({page,run})=>{
  await prepare(run);await fakeFilePicker(page);await editorClick(page,run,0,'loadData');await acceptFile(page);await run('smartHitSettled');
  await run(`(()=>{const source=componentDatasetSources(items[0]).get('data');source.handle.getFile=()=>new Promise(resolve=>window.releaseOldReload=()=>resolve(new File(['Name;Value\\nStale;8'],'results.csv',{type:'text/csv'})));})()`);
  await editorClick(page,run,2,'toggle');await page.waitForFunction(()=>typeof releaseOldReload==='function');
  await fakeFilePicker(page);await editorClick(page,run,0,'loadData');
  await page.locator('dialog[data-component-data-action]').waitFor({state:'visible',timeout:2000});
  await acceptFile(page);await page.evaluate(()=>releaseOldReload());await editorShows(page,'Chosen');
  await editorClick(page,run,2,'toggle');await run('smartHitSettled');await page.evaluate(()=>{fileText='Name;Value\nCurrent file;10';});
  await editorClick(page,run,2,'toggle');await editorShows(page,'Current file');
  assert.deepEqual(await editorRows(run),[['Current file',10]]);
}));

for(const phase of ['active library drag','accepted library drop'])test('a deferred Dataset reload preserves an '+phase+' and their separate Undo steps',async()=>app(async({page,run})=>{
  await prepare(run);await fakeFilePicker(page);
  await editorClick(page,run,0,'loadData');await acceptFile(page);await run('smartHitSettled');
  await run(`(()=>{const source=componentDatasetSources(items[0]).get('data');
    source.handle.getFile=()=>new Promise(resolve=>{window.releaseDragReload=()=>resolve(
      new File(['Name;Value\\nFresh during drag;8'],'results.csv',{type:'text/csv'}));});})()`);
  await editorClick(page,run,2,'toggle');
  await page.waitForFunction(()=>typeof window.releaseDragReload==='function');
  await run('smartHitSettled');
  const history=await run('undoStack.length'),beforeItems=await run('items.length');
  assert.deepEqual(await editorRows(run),[['Chosen',2]],'the real file read remains pending');
  if(phase==='accepted library drop'){
    // Hold only placement initialization; the reload still uses its actual file
    // handle, graph validation, dataset replacement, and history transaction.
    await run('shapePlacementQueue=new Promise(resolve=>{window.releaseDragPlacement=resolve;});true');
  }
  await page.locator('#shapeLibBtn').click();await page.locator('#browseShapesBtn').click();
  await page.locator('#libraryCollection').selectOption('builtin');await page.locator('#librarySearch').fill('Number control');
  const button=page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place Number control',exact:true});
  const origin=await button.boundingBox(),canvas=await page.locator('#canvas').boundingBox();
  assert.ok(origin);
  await page.mouse.move(origin.x+origin.width/2,origin.y+origin.height/2);await page.mouse.down();
  await page.mouse.move(canvas.x+1150,canvas.y+650,{steps:8});
  assert.equal(await page.locator('#libraryDragPreview').isVisible(),true);
  if(phase==='accepted library drop'){
    await page.mouse.up();
    assert.equal(await run('hasPendingShapePlacement()'),true,'the drop was accepted before the reload completes');
    assert.equal(await run('items.length'),beforeItems);
  }
  await page.evaluate(()=>window.releaseDragReload());
  await editorShows(page,'Fresh during drag');await run('smartHitSettled');
  assert.equal(await run('undoStack.length'),history+1,'the reload owns one Undo step');
  if(phase==='active library drag'){
    assert.equal(await page.locator('#libraryDragPreview').isVisible(),true,'completing a background reload leaves the current drag active');
    await page.mouse.up();
  }else{
    assert.equal(await run('hasPendingShapePlacement()'),true,'completing a background reload keeps the accepted drop valid');
    await run('window.releaseDragPlacement();true');
  }
  await run('shapePlacementQueue');
  assert.equal(await run('items.length'),beforeItems+1,'the first drag attempt places the component once');
  const placed=await run('items.at(-1)');
  assert.equal(placed.componentName,'Number control');
  assert.ok(Math.abs(placed.x+placed.w/2-1150)<1 && Math.abs(placed.y+placed.h/2-650)<1,'placement remains centered at the drop');
  assert.equal(await run('undoStack.length'),history+2,'the placement owns a separate Undo step');
  assert.deepEqual(await editorRows(run),[['Fresh during drag',8]]);
  await run('undo()');
  assert.equal(await run('items.length'),beforeItems,'first Undo removes only the placed component');
  assert.deepEqual(await editorRows(run),[['Fresh during drag',8]],'first Undo retains the completed reload');
  await run('undo()');
  assert.equal(await run('items.length'),beforeItems);
  assert.deepEqual(await editorRows(run),[['Chosen',2]],'second Undo restores the data from before Reload');
}));

async function preparePair(run,shared=false){
  await seed(run,[
    {key:'dataSource',script:datasetScript,componentName:'Dataset A',x:50,y:60,state:{allowReaderImport:true},inputValues:{data:{datasetId:'baseA'}},bindings:{reload:{uid:'data-4',port:'value'}}},
    shared?{key:'dataTable',componentName:'Shared view',x:430,y:60,inputValues:{data:{datasetId:'baseA'}}}:
      {key:'dataSource',script:datasetScript,componentName:'Dataset B',x:430,y:60,state:{allowReaderImport:true},inputValues:{data:{datasetId:'baseB'}},bindings:{reload:{uid:'data-4',port:'value'}}},
    {key:'dataTable',componentName:'Results A',x:50,y:280,bindings:{data:{uid:'data-0',port:'data'}}},
    {key:'dataTable',componentName:'Results B',x:530,y:280,bindings:{data:{uid:shared?'data-0':'data-1',port:'data'}}},
    {key:'toggle',componentName:'Reload both',x:930,y:60,state:{value:false}}
  ],shared?{baseA:baseline}:{baseA:baseline,baseB:{...baseline,name:'Initial B'}});
}
async function installPairPicker(page){
  await page.evaluate(()=>{
    window.pickerIndex=0;window.pendingReloads=[];window.deferReload=false;
    Object.defineProperty(window,'showOpenFilePicker',{configurable:true,value:async()=>{
      const index=window.pickerIndex++;
      return [{queryPermission:async()=> 'granted',getFile:async()=>{
        if(window.deferReload)return new Promise(resolve=>window.pendingReloads.push({index,resolve}));
        return new File(['Name;Value\nChosen '+index+';'+(index+2)],'dataset-'+index+'.csv',{type:'text/csv'});
      }}];
    }});
  });
}
async function releasePair(page){
  await page.waitForFunction(()=>window.pendingReloads.length===2);
  await page.evaluate(()=>{
    for(const {index,resolve} of window.pendingReloads)resolve(new File(['Name;Value\nUpdated '+index+';'+(index+5)],'dataset-'+index+'.csv',{type:'text/csv'}));
  });
}

test('simultaneous editor Dataset reloads serialize refreshed validation and keep both replacements',async()=>app(async({page,run})=>{
  await preparePair(run);await installPairPicker(page);
  for(const index of [0,1]){await editorClick(page,run,index,'loadData');await acceptFile(page);await run('smartHitSettled');}
  await page.evaluate(()=>{window.deferReload=true;});
  await editorClick(page,run,4,'toggle');await releasePair(page);
  await page.waitForFunction(()=>__test.run('[0,1].every(index=>datasets[items[index].inputValues.data.datasetId].rows[0][0]===`Updated ${index}`)'));
  assert.deepEqual(await run('[0,1].map(index=>datasets[items[index].inputValues.data.datasetId].rows)'),[[['Updated 0',5]],[['Updated 1',6]]]);
}));

test('simultaneous offline Dataset reloads preserve independent fresh pools and both result tables',async()=>app(async({page,run,context})=>{
  await preparePair(run);const {reader,errors,requests}=await openReader(page,run,context);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===5);await installPairPicker(reader);
  for(const index of [0,1]){
    await readerClick(reader,index,150,124);await acceptFile(reader);
    await reader.waitForFunction(index=>document.querySelector('[data-smart-index="'+(index+2)+'"]')?.textContent.includes('Chosen '+index),index);
  }
  await reader.evaluate(()=>{window.deferReload=true;});
  await readerClick(reader,4,110,69);await releasePair(reader);
  await reader.waitForFunction(()=>[0,1].every(index=>document.querySelector('[data-smart-index="'+(index+2)+'"]')?.textContent.includes('Updated '+index)));
  assert.equal(await reader.locator('[data-data-action-error]').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('one Dataset owner updates all shared views after replacement and subsequent Reload',async()=>app(async({page,run,context})=>{
  await preparePair(run,true);await fakeFilePicker(page);
  await editorClick(page,run,0,'loadData');await acceptFile(page);await run('smartHitSettled');
  assert.deepEqual(await run('[0,1].map(index=>items[index].inputValues.data.datasetId)'),['baseA','baseA']);
  assert.deepEqual((await output(run,0)).data,{datasetId:'baseA'});assert.equal((await output(run,1)).rowCount,1);
  await page.evaluate(()=>{fileText='Name;Value\nShared fresh;8';});
  await editorClick(page,run,4,'toggle');await editorShows(page,'Shared fresh');
  assert.deepEqual(await run('[0,1].map(index=>datasets[items[index].inputValues.data.datasetId].rows)'),[[['Shared fresh',8]],[['Shared fresh',8]]]);
  const {reader,errors,requests}=await openReader(page,run,context);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===5);await fakeFilePicker(reader);
  await readerClick(reader,0,150,124);await acceptFile(reader);
  await reader.waitForFunction(()=>[2,3].every(index=>document.querySelector('[data-smart-index="'+index+'"]')?.textContent.includes('Chosen')));
  // Export captured a high Reload control. Lower it first, then send the next deliberate edge.
  await readerClick(reader,4,110,69);await reader.waitForFunction(()=>!!document.querySelector('[data-smart-index="4"] rect[fill="#64748b"]'));
  await reader.evaluate(()=>{fileText='Name;Value\nShared reader;9';});await readerClick(reader,4,110,69);
  await reader.waitForFunction(()=>[2,3].every(index=>document.querySelector('[data-smart-index="'+index+'"]')?.textContent.includes('Shared reader')));
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
