const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

// Expose the editor fixture only. Every component still crosses the actual
// Worker boundary; downloaded HTML uses its own unmodified offline runtime.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
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
async function openTextEntry(page,run,index){
  await run(`selection=[${index}];editingSmartIdx=${index};render()`);
  const {item,handle}=await run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);
    return {item,handle:(await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='entry')};})()`);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+handle.x,box.y+item.y+handle.y);
  const input=page.locator('#smartTextValue');await input.waitFor({state:'visible'});return input;
}

const fleet={name:'Race results',columns:[{key:'Boat',name:'Boat',type:'string'},{key:'Points',name:'Points',type:'number'}],
  rows:[['Aurora',3],['Borealis',1],['Aurora',5],['Calypso',7],['Borealis',2]]};
const flow=[
 {key:'dataSource',componentName:'Race results',state:{allowReaderImport:true},inputValues:{data:{datasetId:'fleet'}}},
 {key:'tableAggregate',inputValues:{group:'Boat',value:'Points',operation:'sum'},bindings:{data:{uid:'data-0',port:'data'}}},
 {key:'tableSort',inputValues:{column:'result',direction:'ascending'},bindings:{data:{uid:'data-1',port:'data'}}},
 {key:'dataTable',bindings:{data:{uid:'data-2',port:'data'}}},
 {key:'dataBarChart',inputValues:{category:'group',value:'result'},bindings:{data:{uid:'data-2',port:'data'}}},
 {key:'dataDownload',inputValues:{filename:'leaderboard'},bindings:{data:{uid:'data-2',port:'data'}}},
 {key:'dataTable',componentName:'Other view',inputValues:{data:{datasetId:'fleet'}}}
].map((item,index)=>({...item,x:40+(index%3)*450,y:50+Math.floor(index/3)*250}));
const expected=[['Borealis',3],['Calypso',7],['Aurora',8]];
async function resultTable(run,index=2){return run(`(async()=>{const graph=await ensureEditorComponentGraph(),record=graph.get(items[${index}]);
 if(record.error)throw new Error(record.error);return componentTableSnapshot(record.io.outputs.data,graph.datasets||datasets);})()`);}
async function clickHandle(page,run,index,id){
 const value=await run(`(async()=>{selection=[${index}];editingSmartIdx=${index};setTool('select');render();const item=items[${index}];
 const handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)]);return {item,handle:handles.find(h=>h.id===${JSON.stringify(id)})};})()`);
 assert.ok(value.handle,'handle '+id);const box=await page.locator('#canvas').boundingBox();
 await page.mouse.click(box.x+value.item.x+value.handle.x,box.y+value.item.y+value.handle.y);
 await page.locator('dialog[data-component-data-action]').waitFor({state:'visible'});
}
async function downloadDialog(page,format){
 const dialog=page.locator('dialog[data-component-data-action="downloadTable"]');
 await dialog.locator('[data-data-action-format]').selectOption(format);
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download',exact:true}).click();
 const download=await pending;return {name:download.suggestedFilename(),text:fs.readFileSync(await download.path(),'utf8')};
}
async function chooseFile(page,text,name='updated.tsv'){
 const dialog=page.locator('dialog[data-component-data-action="importDataset"]');
 await dialog.locator('[data-data-action-file]').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(text)});
 return dialog;
}

test('editor data actions download derived results without replay and replacement is one undoable shared dataset change',async()=>app(async({page,run})=>{
 await seed(run,flow,{fleet});assert.deepEqual((await resultTable(run)).rows,expected);
 const downloads=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
 await clickHandle(page,run,5,'json');const result=await downloadDialog(page,'json');
 assert.equal(result.name,'leaderboard.json');assert.deepEqual(JSON.parse(result.text),expected.map(([group,result])=>({group,result})));
 await run('smartHitSettled');const before=await run('({items:clone(items),datasets:clone(datasets),undo:undoStack.length})');
 await clickHandle(page,run,0,'loadData');
 const csv='Boat\tPoints\nAurora\t2\nBorealis\t6\nBorealis\t9\n"Dawn, ""Go"""\t1';
 const dialog=await chooseFile(page,csv);await page.waitForFunction(()=>!document.querySelector('dialog[data-component-data-action] [data-data-action-submit]').disabled);
 await dialog.getByRole('button',{name:'Replace data',exact:true}).click();await dialog.waitFor({state:'detached'});await run('smartHitSettled');
 assert.deepEqual((await resultTable(run)).rows,[['Dawn, "Go"',1],['Aurora',2],['Borealis',15]]);
 assert.equal(await run('undoStack.length'),before.undo+1);assert.deepEqual(await run('items[6].inputValues.data'),{datasetId:'fleet'});
 assert.deepEqual(await run('datasets.fleet.rows'),[['Aurora',2],['Borealis',6],['Borealis',9],['Dawn, "Go"',1]],'all sources follow the shared dataset revision');
 assert.equal((await output(run,6)).rowCount,4);
 await clickHandle(page,run,5,'csv');const csvDownload=await downloadDialog(page,'csv');await run('smartHitSettled');
 assert.equal(csvDownload.text,'group,result\r\n"Dawn, ""Go""",1\r\nAurora,2\r\nBorealis,15\r\n');
 await run('undo()');assert.deepEqual((await resultTable(run)).rows,expected);
 await run('redo()');assert.deepEqual((await resultTable(run)).rows,[['Dawn, "Go"',1],['Aurora',2],['Borealis',15]]);
 await run('render();save();persistWorkspace()');await page.reload();await run('appStarted');assert.equal((await resultTable(run)).rows.length,3);
 assert.deepEqual(downloads,['leaderboard.json','leaderboard.csv'],'undo, redo, redraw and reload never replay downloads');
 assert.deepEqual(Object.keys(await run('(async()=>{const saved=await readSavedWorkspace();return saved.workspace.tabs.find(tab=>tab.id===activeTabId).document.datasets;})()')).length,1,'only the current shared dataset is persisted');
}));

test('editor reader-style imports reject mismatched schemas and stale file reads without modifying data',async()=>app(async({page,run})=>{
 await seed(run,flow,{fleet});const before=await run('JSON.stringify({items,datasets,undo:undoStack})');
 await clickHandle(page,run,0,'loadData');let dialog=await chooseFile(page,'Boat;Other\nA;1','wrong.csv');
 await page.waitForFunction(()=>document.querySelector('dialog[data-component-data-action] [role="alert"]').textContent.includes('Missing column'));
 assert.equal(await dialog.getByRole('button',{name:'Replace data',exact:true}).isEnabled(),false);
 assert.equal(await run('JSON.stringify({items,datasets,undo:undoStack})'),before);
 await chooseFile(page,'Boat;Points\nA;not-a-number','wrong-type.csv');
 await page.waitForFunction(()=>document.querySelector('dialog[data-component-data-action] [role="alert"]').textContent.includes('must remain number'));
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await run('smartHitSettled');
 assert.equal(await run('JSON.stringify({items,datasets,undo:undoStack})'),before);
 await clickHandle(page,run,0,'loadData');
 await page.evaluate(()=>{const original=File.prototype.text;File.prototype.text=function(){const file=this;return new Promise(resolve=>window.releaseData=async()=>resolve(await original.call(file)));};});
 await chooseFile(page,'Boat\tPoints\nNew\t10');await page.waitForFunction(()=>typeof window.releaseData==='function');
 await run('newTab()');const other=await run('JSON.stringify({items,datasets,undo:undoStack})');
 await page.evaluate(()=>window.releaseData());await page.locator('dialog[data-component-data-action]').waitFor({state:'detached'});
 assert.equal(await run('JSON.stringify({items,datasets,undo:undoStack})'),other,'late file read cannot attach itself to a new tab');
}));

test('downloads include all rows beyond the presentation preview and snapshot the accepted row order',async()=>app(async({page,run})=>{
 const large={...fleet,rows:Array.from({length:300},(_,i)=>['Boat '+i,300-i])};
 const list=[flow[0],{...flow[2],bindings:{data:{uid:'data-0',port:'data'}},inputValues:{column:'Points',direction:'ascending'}},
  {...flow[5],x:40,y:400,bindings:{data:{uid:'data-1',port:'data'}}}];
 await seed(run,list,{fleet:large});
 await clickHandle(page,run,2,'json');const dialog=page.locator('dialog[data-component-data-action]');
 assert.equal(await dialog.locator('[data-data-action-preview] tr').count(),6,'preview is bounded to five data rows');
 const result=await downloadDialog(page,'json');assert.equal(JSON.parse(result.text).length,300);
 assert.deepEqual(JSON.parse(result.text)[0],{Boat:'Boat 299',Points:1});assert.deepEqual(JSON.parse(result.text).at(-1),{Boat:'Boat 0',Points:300});
}));

test('Cancel during replacement validation cannot commit the pending imported dataset',async()=>app(async({page,run})=>{
 await seed(run,flow,{fleet});const before=await run('JSON.stringify({items,datasets,undo:undoStack})');
 await clickHandle(page,run,0,'loadData');const dialog=await chooseFile(page,'Boat\tPoints\nOther\t8');
 await page.waitForFunction(()=>!document.querySelector('dialog[data-component-data-action] [data-data-action-submit]').disabled);
 await run(`(()=>{const original=inspectComponentGraph;inspectComponentGraph=async(...args)=>{await new Promise(resolve=>window.releaseInspection=resolve);return original(...args);};})()`);
 await dialog.getByRole('button',{name:'Replace data',exact:true}).click();await page.waitForFunction(()=>typeof window.releaseInspection==='function');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});
 await page.evaluate(()=>window.releaseInspection());await run('smartHitSettled');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await run('JSON.stringify({items,datasets,undo:undoStack})'),before);
}));
