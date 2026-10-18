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
async function openTextEntry(page,run,index){
  await run(`selection=[${index}];editingSmartIdx=${index};render()`);
  const {item,handle}=await run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);
    return {item,handle:(await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='entry')};})()`);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+handle.x,box.y+item.y+handle.y);
  const input=page.locator('#smartTextValue');await input.waitFor({state:'visible'});return input;
}


const results={name:'Sailing results',columns:[
  {key:'Boat',name:'Boat',type:'string'},{key:'Region',name:'Region',type:'string'},
  {key:'Points',name:'Points',type:'number'},{key:'Qualified',name:'Qualified',type:'boolean'}
],rows:[['Tern','North',12.5,true],['Skua','South',8,false],['Möwe','North',17,true]]};
const circuit=[
  {key:'dataSource',componentName:'Results',inputValues:{data:{datasetId:'results'}}},
  {key:'textInput',componentName:'Choose region',state:{values:['North'],current:0}},
  {key:'tableFilter',componentName:'Matching boats',inputValues:{column:'Region',operation:'='},bindings:{data:{uid:'data-0',port:'data'},text:{uid:'data-1',port:'value'}}},
  {key:'dataTable',componentName:'Results table',bindings:{data:{uid:'data-2',port:'data'}}},
  {key:'dataBarChart',componentName:'Points chart',inputValues:{category:'Boat',value:'Points'},bindings:{data:{uid:'data-2',port:'data'}}}
];
async function waitCount(page,index,count){
  await page.waitForFunction(({index,count})=>__test.run(`editorComponentEvaluation?.records?.get(items[${index}])?.io.outputs.rowCount`)===count,{index,count});
}
async function childrenText(run,index){
  return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);
    return (await requestSmartCall(item,'children',[item.state,smartResolvedStyle(item),item.w,item.h,false,io])).filter(child=>child.type==='text').map(child=>child.text);})()`);
}
async function dataSnapshot(run){
  return run('({active:activeTabId,items:clone(items),datasets:clone(datasets),undo:clone(undoStack),redo:clone(redoStack),stored:localStorage.getItem(docKey(activeTabId))})');
}

test('one embedded dataset drives a filter, table and chart through the actual Text input',async()=>app(async({page,run})=>{
  await seed(run,circuit,{results});
  assert.deepEqual(await output(run,0),{data:{datasetId:'results'},rowCount:3});
  assert.deepEqual(await output(run,2),{data:{datasetId:'results',rows:[0,2]},rowCount:2});
  assert.equal((await output(run,3)).rowCount,2);assert.equal((await output(run,4)).rowCount,2);
  for(const index of [3,4]){
    const text=await childrenText(run,index);assert.ok(text.includes('Tern'));assert.ok(text.includes('Möwe'));assert.ok(!text.includes('Skua'));
  }
  const before=await run('JSON.stringify(datasets)');
  const input=await openTextEntry(page,run,1);await input.fill('South');await input.press('Enter');
  await waitCount(page,2,1);await run('smartHitSettled');
  assert.deepEqual(await output(run,2),{data:{datasetId:'results',rows:[1]},rowCount:1});
  for(const index of [3,4]){
    const text=await childrenText(run,index);assert.ok(text.includes('Skua'));assert.ok(!text.includes('Tern'));
  }
  assert.equal(await run('JSON.stringify(datasets)'),before,'filtering never mutates the embedded source');
  assert.equal((await output(run,0)).rowCount,3);
  assert.ok(await run('items.every(item=>JSON.stringify(item.state).length<4000)'),'row data never enters component state');
  assert.deepEqual(await run('items[0].inputValues.data'),{datasetId:'results'});
}));

test('table references survive reload and a complete workspace download/import without duplicating source data',async()=>app(async({page,run})=>{
  await seed(run,circuit,{results});await run('save()');
  const stored=await run('JSON.parse(localStorage.getItem(docKey(activeTabId)))');
  assert.deepEqual(stored.datasets,{results});assert.deepEqual(stored.items[0].inputValues.data,{datasetId:'results'});
  await page.reload();await run('appStarted');assert.equal((await output(run,2)).rowCount,2);
  assert.deepEqual(await run('datasets'),{results});
  const {directory,file}=await exportFile(page,run,'exportWorkspace()','json');
  try{
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.deepEqual(saved.tabs[0].datasets,{results});
    assert.equal(JSON.stringify(saved).split('Sailing results').length-1,1,'the complete dataset is saved once per drawing');
    await run('newTab()');await run('pendingFileAction="openWorkspace"');
    await page.locator('#projectInput').setInputFiles(file);
    await page.waitForFunction(()=>__test.run('tabs.length===1 && items.length===5'));
    assert.deepEqual(await run('datasets'),{results});assert.deepEqual(await output(run,2),{data:{datasetId:'results',rows:[0,2]},rowCount:2});
    assert.equal((await output(run,4)).rowCount,2);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}));

test('a downloaded HTML dashboard filters offline and keeps same-named datasets isolated between tabs',async()=>app(async({page,run,context})=>{
  await seed(run,circuit,{results});const first=await run('activeTabId');
  await run('newTab()');
  const other={...results,name:'Other fleet',rows:[['Puffin','West',31,true]]};
  await seed(run,[{...circuit[0]}, {...circuit[3],uid:'other-table',bindings:{data:{uid:'data-0',port:'data'}}}],{results:other});
  await run(`activateTab(${JSON.stringify(first)})`);
  const {reader,errors,requests}=await openReader(page,run,context);
  assert.equal(await reader.locator('.tab-select').count(),2);
  const firstPanel=reader.locator('.tab-panel').nth(0);
  await reader.waitForFunction(panel=>[...panel.querySelectorAll('[data-smart-index]')].every(host=>host.dataset.smartReady==='true'),await firstPanel.elementHandle());
  assert.ok((await firstPanel.locator('[data-smart-index="3"]').textContent()).includes('Tern'));
  const inputHost=firstPanel.locator('[data-smart-index="1"]');
  const at=await inputHost.evaluate(host=>{const point=new DOMPoint(160,48).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};});
  await reader.mouse.click(at.x,at.y);await reader.locator('#smartTextValue').fill('South');await reader.locator('#smartTextValue').press('Enter');
  await reader.waitForFunction(panel=>panel.querySelector('[data-smart-index="3"]').textContent.includes('Skua'),await firstPanel.elementHandle());
  for(const index of [3,4]){
    const text=await firstPanel.locator('[data-smart-index="'+index+'"]').textContent();assert.ok(text.includes('Skua'));assert.ok(!text.includes('Tern'));
  }
  await reader.locator('.tab-select').nth(1).click();const secondPanel=reader.locator('.tab-panel').nth(1);
  await reader.waitForFunction(panel=>panel.querySelector('[data-smart-index="1"]')?.dataset.smartReady==='true',await secondPanel.elementHandle());
  assert.ok((await secondPanel.textContent()).includes('Puffin'));assert.ok(!(await secondPanel.textContent()).includes('Tern'));
  await reader.locator('.tab-select').nth(0).click();
  assert.ok((await firstPanel.locator('[data-smart-index="3"]').textContent()).includes('Skua'),'switching tabs retains the edited filter');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'exported data and runtime have no network dependency');
}));

test('large tables are resolved for filtering but only bounded previews reach rendering hooks',async()=>app(async({run})=>{
  const large={...results,rows:Array.from({length:600},(_,index)=>['Boat '+index,index%2?'South':'North',index,index%3===0])};
  await seed(run,circuit,{results:large});
  assert.equal((await output(run,0)).rowCount,600);assert.equal((await output(run,2)).rowCount,300);
  const checked=await run(`(async()=>{const graph=await ensureEditorComponentGraph();return [0,2,3,4].map(index=>{
    const io=graph.get(items[index]).io;return {index,tables:io.tables,outputSize:JSON.stringify(io.outputs).length};
  });})()`);
  for(const entry of checked){
    for(const group of Object.values(entry.tables))for(const table of Object.values(group)){
      assert.ok(table.rows.length<=24,'presentations get at most 24 rows');assert.ok(table.rowCount>=300);
    }
    assert.ok(entry.outputSize<4000,'outputs are references and row indexes, not duplicated cells');
  }
  const text=await childrenText(run,3);assert.ok(text.some(value=>value.includes('300')),'visible table reports the full filtered count');
}));

test('invalid or missing embedded data rejects a whole sketch import without losing drawings, history or saved data',async()=>app(async({page,run,dialogs})=>{
  await seed(run,circuit,{results});await run('save()');const before=await dataSnapshot(run);
  const good={app:'SimpleCanvas',version:await run('FORMAT_VERSION'),items:before.items,assets:{},datasets:{results}};
  const cases=[
    {...good,datasets:{results:{...results,rows:[['Tern','North','wrong type',true]]}}},
    {...good,datasets:{}},
    {...good,items:before.items.map((item,index)=>index===0?{...item,inputValues:{data:{datasetId:'results',rows:[999]}}}:item)},
    {...good,datasets:{results:{...results,rows:Array.from({length:1001},()=>results.rows[0])}}}
  ];
  for(const incoming of cases){
    await run(`document.querySelector('#toast').textContent='';importProject(new File([${JSON.stringify(JSON.stringify(incoming))}],'bad-data.json',{type:'application/json'}))`);
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.length>0);
    assert.deepEqual(await dataSnapshot(run),before,'rejected file leaves the whole current drawing untouched');
  }
  assert.deepEqual(dialogs,[],'validation finishes before any destructive replacement confirmation');
}));

async function openInputs(page,run,index=0){
  await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open && !document.querySelector('#componentBindingFields').disabled);
}
async function importDataFile(page,name,text){
  await page.locator('#datasetFileInput-data').setInputFiles({name,mimeType:name.endsWith('.csv')?'text/csv':name.endsWith('.tsv')?'text/tab-separated-values':'application/json',buffer:Buffer.from(text)});
}
async function inputOutputFeedback(page,count){
  await page.waitForFunction(count=>{const output=document.querySelector('#componentOutputs');return output.getAttribute('aria-busy')!=='true' && output.textContent.includes('rowCount = '+count);},count);
}

test('CSV and JSON file imports preview in Inputs and commit only when the user saves',async()=>app(async({page,run})=>{
  await seed(run,[circuit[0]],{results});const before=await dataSnapshot(run);
  await openInputs(page,run);await importDataFile(page,'fleet.csv','Boat,Points\nPuffin,10\nGull,7\n');
  await inputOutputFeedback(page,2);
  assert.deepEqual(await dataSnapshot(run),before,'a successful file preview does not mutate the drawing');
  await page.locator('#componentBindingsCancel').click();assert.deepEqual(await dataSnapshot(run),before,'Cancel discards the imported dataset');
  await openInputs(page,run);await importDataFile(page,'fleet.json',JSON.stringify([{Boat:'Heron',Points:6},{Boat:'Puffin',Points:15}]));
  await inputOutputFeedback(page,2);await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  const after=await dataSnapshot(run),ref=after.items[0].inputValues.data;
  assert.notEqual(ref.datasetId,'results');assert.deepEqual(after.datasets[ref.datasetId].rows,[['Heron',6],['Puffin',15]]);
  assert.equal(after.undo.length,before.undo.length+1,'import plus assignment is one undo step');assert.equal((await output(run,0)).rowCount,2);
  await run('undo()');assert.deepEqual(await run('items[0].inputValues.data'),{datasetId:'results'});assert.equal((await output(run,0)).rowCount,3);
  await run('redo()');assert.deepEqual(await run('items[0].inputValues.data'),ref);assert.equal((await output(run,0)).rowCount,2);
}));

async function waitCsvPreview(page,headers){
  await page.waitForFunction(headers=>JSON.stringify(Array.from(document.querySelectorAll('#componentInputFields th'),cell=>cell.textContent))===JSON.stringify(headers),headers);
}
async function stagedData(run){
  return run(`(()=>{const ref=JSON.parse(componentDialogSession.rows.find(row=>row.name==='data').input.value);
    return {ref,table:clone(componentDialogSession.datasets[ref.datasetId])};})()`);
}

test('CSV delimiter detection previews semicolons and quoted cells, blocks a bad override, and saves only on confirmation',async()=>app(async({page,run})=>{
  await seed(run,[circuit[0]],{results});const before=await dataSnapshot(run);
  const csv='Boat;Points;Notes\r\n"Skua, South";7;"Line one\r\nLine two"\r\nTern;12;"Said ""Go!"""\r\n';
  await openInputs(page,run);await importDataFile(page,'semicolon-fleet.csv',csv);
  await waitCsvPreview(page,['Boat (string)','Points (number)','Notes (string)']);await inputOutputFeedback(page,2);
  const delimiter=page.getByLabel('data CSV delimiter',{exact:true});assert.equal(await delimiter.inputValue(),'auto');
  assert.match(await page.locator('#datasetCsvStatus-data').textContent(),/detected.*semicolon/i);
  const valid=await stagedData(run);
  assert.deepEqual(valid.table.rows,[['Skua, South',7,'Line one\nLine two'],['Tern',12,'Said "Go!"']]);
  assert.deepEqual(await page.locator('#componentInputFields td').allTextContents(),valid.table.rows.flat().map(String));
  assert.deepEqual(await dataSnapshot(run),before,'preview does not change the drawing or its saved data');

  await delimiter.selectOption(',');
  await page.waitForFunction(()=>document.querySelector('#componentBindingsError').textContent.length>0 && document.querySelector('#componentBindingsSave').disabled);
  assert.deepEqual(await stagedData(run),valid,'a failed delimiter override preserves the last successful draft');
  assert.deepEqual(await dataSnapshot(run),before,'a failed override does not change the drawing');
  await delimiter.selectOption(';');await inputOutputFeedback(page,2);
  assert.equal(await page.locator('#componentBindingsSave').isEnabled(),true);
  assert.equal(await page.locator('#componentBindingsError').textContent(),'');
  assert.deepEqual((await stagedData(run)).table,valid.table);
  await page.locator('#componentBindingsCancel').click();assert.deepEqual(await dataSnapshot(run),before);

  await openInputs(page,run);await importDataFile(page,'semicolon-fleet.csv',csv);await inputOutputFeedback(page,2);
  await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  const after=await dataSnapshot(run),id=after.items[0].inputValues.data.datasetId;
  assert.deepEqual(after.datasets[id],valid.table);assert.equal(after.undo.length,before.undo.length+1);
  await page.reload();await run('appStarted');assert.deepEqual(await run(`datasets[${JSON.stringify(id)}]`),valid.table);
  assert.equal((await output(run,0)).rowCount,2);
}));

test('CSV delimiter ambiguity is visible and manual choices reparse the same file without accumulating drafts',async()=>app(async({page,run})=>{
  await seed(run,[circuit[0]],{results});const before=await dataSnapshot(run);await openInputs(page,run);
  await importDataFile(page,'ambiguous.csv','A;B,C\n1;2,3');await inputOutputFeedback(page,1);
  const delimiter=page.getByLabel('data CSV delimiter',{exact:true});
  assert.match(await page.locator('#datasetCsvStatus-data').textContent(),/ambiguous/i);
  await delimiter.selectOption(';');await waitCsvPreview(page,['A (number)','B,C (string)']);
  assert.deepEqual((await stagedData(run)).table.rows,[[1,'2,3']]);
  await delimiter.selectOption(',');await waitCsvPreview(page,['A;B (string)','C (number)']);
  assert.deepEqual((await stagedData(run)).table.rows,[['1;2',3]]);
  assert.equal(await run('Object.keys(componentDialogSession.datasets).length'),2,'only the original data and latest parse are staged');
  assert.equal(await page.getByLabel('data dataset',{exact:true}).locator('option').count(),3,'reparsing does not accumulate dataset choices');
  assert.deepEqual(await dataSnapshot(run),before);
  await delimiter.selectOption(';');await waitCsvPreview(page,['A (number)','B,C (string)']);await inputOutputFeedback(page,1);
  await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  const after=await dataSnapshot(run),id=after.items[0].inputValues.data.datasetId;
  assert.deepEqual(after.datasets[id].rows,[[1,'2,3']]);assert.equal(after.undo.length,before.undo.length+1);

  await openInputs(page,run);await importDataFile(page,'first.csv','Boat,Points\nTern,4');await inputOutputFeedback(page,1);
  assert.equal(await delimiter.isVisible(),true);
  await importDataFile(page,'replacement.json','[{"Boat":"Gull","Points":8}]');
  await waitCsvPreview(page,['Boat (string)','Points (number)']);
  await page.waitForFunction(()=>document.querySelector('#componentInputFields td')?.textContent==='Gull');
  assert.equal(await delimiter.isVisible(),false,'JSON import hides CSV-only settings');
  await page.locator('#componentBindingsCancel').click();assert.deepEqual(await dataSnapshot(run),after);
}));

test('CSV delimiter controls detect TSV and let tab-separated CSV recover from a wrong manual delimiter',async()=>app(async({page,run})=>{
  await seed(run,[circuit[0]],{results});const before=await dataSnapshot(run);await openInputs(page,run);
  assert.match(await page.locator('#datasetFileInput-data').getAttribute('accept'),/\.tsv/);
  const source='Boat\tPoints\tNotes\n"Skua\tSouth"\t7\t"two, separators; here"\nTern\t12\t"Line one\nLine two"\n';
  await importDataFile(page,'tab-fleet.tsv',source);await waitCsvPreview(page,['Boat (string)','Points (number)','Notes (string)']);await inputOutputFeedback(page,2);
  const delimiter=page.getByLabel('data CSV delimiter',{exact:true});
  assert.deepEqual(await delimiter.locator('option').allTextContents(),['Automatic','Comma (,)','Semicolon (;)','Tab']);
  assert.match(await page.locator('#datasetCsvStatus-data').textContent(),/detected.*tab/i);
  const expected=[['Skua\tSouth',7,'two, separators; here'],['Tern',12,'Line one\nLine two']];
  assert.equal((await stagedData(run)).table.name,'tab-fleet');assert.deepEqual((await stagedData(run)).table.rows,expected);
  await importDataFile(page,'tab-fleet.csv',source);await inputOutputFeedback(page,2);
  await delimiter.selectOption(',');
  await page.waitForFunction(()=>document.querySelector('#componentBindingsError').textContent.length>0 && document.querySelector('#componentBindingsSave').disabled);
  await delimiter.selectOption('\t');await inputOutputFeedback(page,2);
  assert.equal(await page.locator('#componentBindingsSave').isEnabled(),true);assert.deepEqual((await stagedData(run)).table.rows,expected);
  assert.deepEqual(await dataSnapshot(run),before);
  await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  const after=await dataSnapshot(run);assert.deepEqual(after.datasets[after.items[0].inputValues.data.datasetId].rows,expected);
}));

test('a failed CSV delimiter override on one table stays blocked while another table input changes',async()=>app(async({page,run})=>{
  const script=`({apiVersion:2,inputs:{data:{type:'table'},other:{type:'table'}},outputs:{rowCount:{type:'number'}},
    compute(inputs,state,context){return {rowCount:context.tables.data.rowCount};},children(){return [];}})`;
  await seed(run,[{key:'dataSource',script,inputValues:{data:{datasetId:'results'},other:{datasetId:'other'}}}],{
    results,other:{...results,name:'Other fleet',rows:[['Puffin','West',9,true]]}
  });
  const before=await dataSnapshot(run);await openInputs(page,run);
  await importDataFile(page,'semicolon.csv','Boat;Points\n"Skua, South";7');await inputOutputFeedback(page,1);
  const delimiter=page.getByLabel('data CSV delimiter',{exact:true});await delimiter.selectOption(',');
  await page.waitForFunction(()=>document.querySelector('#componentBindingsError').textContent.length>0 && document.querySelector('#componentBindingsSave').disabled);
  const staged=await stagedData(run),other=page.getByLabel('other dataset',{exact:true});
  await other.selectOption(JSON.stringify({datasetId:'results'}));
  assert.equal(await page.locator('#componentBindingsSave').isEnabled(),false,'an unrelated table edit cannot confirm a failed CSV parse');
  assert.equal(await delimiter.isVisible(),true,'the failing import keeps its correction controls');
  assert.deepEqual(await stagedData(run),staged);assert.deepEqual(await dataSnapshot(run),before);
  await delimiter.selectOption(';');await inputOutputFeedback(page,1);
  assert.equal(await page.locator('#componentBindingsSave').isEnabled(),true);
  await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  assert.deepEqual(await run('items[0].inputValues.other'),{datasetId:'results'});assert.equal((await output(run,0)).rowCount,1);
}));

test('malformed and oversized CSV/JSON files leave the current dataset, history and persistence unchanged',async()=>app(async({page,run})=>{
  await seed(run,[circuit[0]],{results});const before=await dataSnapshot(run);
  for(const [name,text] of [['broken.csv','Boat,Points\nTern'],['broken.json','[{"Boat":{"nested":true}}]'],['huge.csv','x'.repeat(1000001)]]){
    await openInputs(page,run);await importDataFile(page,name,text);
    await page.waitForFunction(()=>document.querySelector('#componentBindingsError').textContent.length>0);
    assert.deepEqual(await dataSnapshot(run),before,name+' is rejected atomically');
    await page.locator('#componentBindingsCancel').click();await waitCount(page,0,3);assert.equal((await output(run,0)).rowCount,3);
  }
}));

test('a data file finishing after a tab switch cannot attach itself to another component or sketch',async()=>app(async({page,run})=>{
  await seed(run,[circuit[0]],{results});const first=await run('activeTabId');
  await openInputs(page,run);
  await page.evaluate(()=>{
    const nativeText=File.prototype.text;
    File.prototype.text=function(){const file=this;return new Promise(resolve=>{window.__releaseDatasetRead=async()=>resolve(await nativeText.call(file));});};
  });
  await run(`(()=>{const original=importComponentDataset;importComponentDataset=async(...args)=>{try{return await original(...args);}finally{window.__datasetImportFinished=true;}};})()`);
  await importDataFile(page,'late.csv','Boat,Points\nLate boat,99');
  await page.waitForFunction(()=>typeof window.__releaseDatasetRead==='function');
  await run('newTab()');await seed(run,[circuit[0]],{results:{...results,name:'Other data',rows:[['Gull','West',2,false]]}});
  const current=await dataSnapshot(run),other=await run(`documentForFile(tabDocument(${JSON.stringify(first)}))`);
  await page.evaluate(()=>window.__releaseDatasetRead());await page.waitForFunction(()=>window.__datasetImportFinished===true);
  assert.deepEqual(await dataSnapshot(run),current);assert.deepEqual(await run(`documentForFile(tabDocument(${JSON.stringify(first)}))`),other);
  assert.equal((await output(run,0)).rowCount,1);
}));

test('table ports reject scalar wiring, feedback loops and invalid published row selections without stopping healthy components',async()=>app(async({run})=>{
  const errors=()=>run(`(async()=>{const graph=await ensureEditorComponentGraph();return items.map(item=>({error:graph.get(item)?.error||'',outputs:graph.get(item)?.io.outputs}));})()`);
  await seed(run,[circuit[0],{key:'valueLabel',bindings:{value:{uid:'data-0',port:'data'}}},{key:'constant',state:{value:23}}],{results});
  let checked=await errors();assert.match(checked[1].error,/incompatible.*type/i);assert.equal(checked[2].outputs.value,23);
  await seed(run,[{key:'tableFilter',bindings:{data:{uid:'data-0',port:'data'}}},{key:'constant',state:{value:23}}],{results});
  checked=await errors();assert.match(checked[0].error,/table.*feedback/i);assert.equal(checked[1].outputs.value,23);
  for(const ref of [{datasetId:'results',rows:[999]},{datasetId:'results',rows:[0,0]},
    {datasetId:'results',rows:[.5]},{datasetId:'missing'},{datasetId:'results',rows:Array.from({length:1001},(_,index)=>index)}]){
    const script=`({apiVersion:2,inputs:{data:{type:'table'}},outputs:{data:{type:'table'}},compute(){return {data:${JSON.stringify(ref)}};},children(){return [];}})`;
    await seed(run,[{...circuit[0],script},{key:'dataTable',bindings:{data:{uid:'data-0',port:'data'}}},{key:'constant',state:{value:23}}],{results});
    checked=await errors();assert.ok(checked[0].error,JSON.stringify(ref)+' must reject');
    assert.ok(checked[1].error,'downstream consumers do not receive an invalid table');assert.equal(checked[2].outputs.value,23);
  }
}));

test('dataset selections copy across tab collisions and survive library preview, shape transfer and independent placement',async()=>app(async({page,run})=>{
  await page.evaluate(()=>navigator.clipboard && Object.defineProperty(navigator.clipboard,'write',{value:entries=>{
    window.__copied=Promise.all(entries.flatMap(entry=>entry.types.map(type=>entry.getType(type))));return window.__copied;
  }}));
  await seed(run,[circuit[0],{key:'dataTable',bindings:{data:{uid:'data-0',port:'data'}}}],{results});
  await run('selection=[0,1];copySelection()');await page.evaluate(()=>window.__copied);
  await run('newTab()');const other={...results,name:'Existing fleet',rows:[['Gull','West',1,false]]};
  await seed(run,[circuit[0]],{results:other});const original=await run('items[0]');
  assert.equal(await run('pasteClipboard()'),true);await waitCount(page,2,3);
  let placed=await run('items'),copiedId=placed[1].inputValues.data.datasetId;
  assert.notEqual(copiedId,'results','colliding ID is remapped');assert.deepEqual(await run('datasets.results'),other);
  assert.equal(placed[2].bindings.data.uid,placed[1].uid);assert.equal((await output(run,0)).rowCount,1);
  assert.deepEqual(await run(`datasets[${JSON.stringify(copiedId)}]`),results);
  await run('undo()');assert.equal(await run('items.length'),1);assert.deepEqual(await run('items[0]'),original);
  await run('redo()');await waitCount(page,2,3);assert.equal(await run('items[1].inputValues.data.datasetId'),copiedId);

  const adding=run('selection=[1,2];addSelectionToLibrary()');await page.locator('#libraryNameInput').fill('Fleet dashboard');
  await page.locator('#libraryDialogSubmit').click();await adding;
  await run('ensureShapeThumbnail(shapeLibrary.shapes[0])');
  assert.equal(await run('Boolean(validShapeThumbnail(shapeLibrary.shapes[0]))'),true,'data-aware preview renders');
  const {directory,file}=await exportFile(page,run,'exportLibraryShape(shapeLibrary.shapes[0])','json');
  try{
    const shared=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(shared.shape.datasets[copiedId],results);
    await page.locator('#shapeFileInput').setInputFiles(file);await page.waitForFunction(()=>__test.run('shapeLibrary.shapes.length')===2);
    assert.equal(await run('Boolean(validShapeThumbnail(shapeLibrary.shapes[1]))'),true);
    await run('setShapePicker(false);newTab()');
    await seed(run,[{...circuit[0],inputValues:{data:{datasetId:copiedId}}}],{[copiedId]:other});
    await run('placeShapeAt(shapeLibrary.shapes[1],450,500)');await waitCount(page,2,3);
    placed=await run('items');const libraryId=placed[1].inputValues.data.datasetId;
    assert.notEqual(libraryId,copiedId);assert.equal(placed[2].bindings.data.uid,placed[1].uid);
    assert.equal((await output(run,0)).rowCount,1);assert.deepEqual(await run(`datasets[${JSON.stringify(libraryId)}]`),results);
    assert.deepEqual(await run(`shapeLibrary.shapes[1].datasets[${JSON.stringify(copiedId)}]`),results,'placement never edits its reusable definition');
    await run('undo()');assert.equal(await run('items.length'),1);
    await run('redo()');await waitCount(page,2,3);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}));

test('importing a seventeenth dataset leaves existing sources, history and storage intact',async()=>app(async({page,run})=>{
  const pool=Object.fromEntries(Array.from({length:16},(_,index)=>['set'+index,{...results,name:'Fleet '+index}]));
  await seed(run,Array.from({length:17},(_,index)=>({...circuit[0],inputValues:{data:{datasetId:'set'+(index%16)}}})),pool);
  const before=await dataSnapshot(run);await openInputs(page,run,16);await importDataFile(page,'extra.csv','Boat,Points\nExtra,99');
  await page.waitForFunction(()=>/16 datasets/.test(document.querySelector('#componentBindingsError').textContent));
  assert.deepEqual(await dataSnapshot(run),before);await page.locator('#componentBindingsCancel').click();
  // dialog.close() queues its close event. The old graph can still look settled until
  // that event clears the inspection session and starts the resumed evaluation.
  const resumed=await page.waitForFunction(()=>__test.run(`!componentDialogSession && !componentBindingsDialog.open &&
    editorComponentEvaluation?.records?.get(items[15])?.io.outputs`));
  assert.equal((await resumed.jsonValue()).rowCount,3,'the resumed graph still exposes the original dataset');
}));

test('multiple datasets and multiple filters of one dataset remain independent, with schema-based Inputs choices',async()=>app(async({page,run})=>{
  const second={...results,name:'Another fleet',rows:[['Puffin','North',42,true],['Gull','West',6,false]]};
  await seed(run,[
    circuit[0],{...circuit[0],componentName:'Other results',inputValues:{data:{datasetId:'other'}}},
    {key:'tableFilter',componentName:'North boats'},
    {key:'tableFilter',componentName:'South boats',inputValues:{column:'Region',operation:'=',text:'South'},bindings:{data:{uid:'data-0',port:'data'}}},
    {key:'tableFilter',componentName:'Other north boats',inputValues:{column:'Region',operation:'=',text:'North'},bindings:{data:{uid:'data-1',port:'data'}}},
    {key:'dataTable',bindings:{data:{uid:'data-2',port:'data'}}},
    {key:'dataTable',bindings:{data:{uid:'data-4',port:'data'}}},
    {key:'dataBarChart'}
  ],{results,other:second});
  await openInputs(page,run,2);
  await page.getByLabel('data (table)',{exact:true}).selectOption({label:'Results · data'});await inputOutputFeedback(page,3);
  const column=page.getByLabel('column value',{exact:true});
  assert.deepEqual(await column.locator('option').allTextContents(),['Use default','Boat (string)','Region (string)','Points (number)','Qualified (boolean)']);
  await column.selectOption('Region');await page.getByLabel('operation value',{exact:true}).selectOption('=');
  await page.getByLabel('text value',{exact:true}).fill('North');await inputOutputFeedback(page,2);
  await page.locator('#componentBindingsSave').click();await waitCount(page,2,2);
  assert.deepEqual((await output(run,2)).data,{datasetId:'results',rows:[0,2]});
  assert.deepEqual((await output(run,3)).data,{datasetId:'results',rows:[1]});
  assert.deepEqual((await output(run,4)).data,{datasetId:'other',rows:[0]});
  assert.ok((await childrenText(run,5)).includes('Tern'));assert.ok((await childrenText(run,6)).includes('Puffin'));
  await openInputs(page,run,7);await page.getByLabel('data (table)',{exact:true}).selectOption({label:'North boats · data'});
  await inputOutputFeedback(page,2);
  assert.deepEqual(await page.getByLabel('value value',{exact:true}).locator('option').allTextContents(),['Use default','Points (number)'],'chart value choices exclude strings and booleans');
  await page.getByLabel('category value',{exact:true}).selectOption('Boat');await page.getByLabel('value value',{exact:true}).selectOption('Points');
  await page.locator('#componentBindingsSave').click();await waitCount(page,7,2);
  assert.deepEqual(await run('datasets'),{results,other:second});
}));

test('a recognized clipboard payload with invalid embedded data cannot fall back to a PNG or stale internal copy',async()=>app(async({page,run})=>{
  await seed(run,[circuit[0]],{results});await run('selection=[0];copySelection()');const before=await dataSnapshot(run);
  const incoming={app:'SimpleCanvas',kind:'objects',version:await run('FORMAT_VERSION'),items:before.items,assets:{},datasets:{}};
  await page.evaluate(async incoming=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=20;
    const png=await new Promise(resolve=>canvas.toBlob(resolve));const data=new DataTransfer();
    data.setData('text/plain',JSON.stringify(incoming));data.items.add(new File([png],'fallback.png',{type:'image/png'}));
    window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,cancelable:true,bubbles:true}));
  },incoming);
  await page.waitForFunction(()=>/dataset.*missing/i.test(document.querySelector('#toast').textContent));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.deepEqual(await dataSnapshot(run),before,'recognized invalid data is handled without inserting another representation');
}));

test('repeated file previews retain only the original data and latest import, then Save remains one undo step',async()=>app(async({page,run})=>{
  await seed(run,[circuit[0]],{results});const before=await dataSnapshot(run);await openInputs(page,run);
  let latest;
  for(let index=1;index<=20;index++){
    const rows=Array.from({length:index},(_,row)=>({Boat:'Fleet '+index+' boat '+row,Points:row}));
    await importDataFile(page,'fleet-'+index+'.json',JSON.stringify(rows));await inputOutputFeedback(page,index);
    const staged=await run('({datasets:componentDialogSession.datasets,base:componentDialogSession.baseDatasets})');
    assert.deepEqual(staged.base,{results});assert.equal(Object.keys(staged.datasets).length,2,'only original + latest staged dataset retained');
    assert.deepEqual(staged.datasets.results,results);
    latest=Object.entries(staged.datasets).find(([id])=>id!=='results');
    assert.equal(latest[1].name,'fleet-'+index);assert.equal(latest[1].rows.length,index);
    assert.equal(await page.getByLabel('data dataset',{exact:true}).locator('option').count(),3,'replaced imports also leave the chooser');
    assert.deepEqual(await dataSnapshot(run),before,'staged imports never change saved drawing or history');
  }
  await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  const after=await dataSnapshot(run);assert.equal(after.undo.length,before.undo.length+1);
  assert.deepEqual(after.items[0].inputValues.data,{datasetId:latest[0]});assert.equal((await output(run,0)).rowCount,20);
  assert.deepEqual(Object.keys(JSON.parse(after.stored).datasets),[latest[0]],'only the current dataset is persisted with the drawing');
  await run('undo()');await waitCount(page,0,3);
  assert.deepEqual(await run('items[0].inputValues.data'),{datasetId:'results'});
  assert.deepEqual(await run('JSON.parse(localStorage.getItem(docKey(activeTabId))).datasets'),{results});
}));
