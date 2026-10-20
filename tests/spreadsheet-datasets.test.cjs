const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const root=path.join(__dirname,'..');
const scripts=Object.fromEntries(['spreadsheet','data-source','table-filter','table-sort'].map(name=>[name,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8')]));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1100}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://spreadsheet-datasets.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://spreadsheet-datasets.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
function item(name,uid,state={},extra={}){
  return {type:'smart',uid,componentApi:2,componentName:uid,script:scripts[name],state,x:60,y:160,w:600,h:240,
    color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,fontFamily:'sans',fontSize:14,bindings:{},inputValues:{},...extra};
}
function sheet(cells={},extra={}){return item('spreadsheet','sheet',{cols:5,rows:6,cells:{E1:'=INPUT("data",A1:B4,INPUT("startRow"),0)',...cells}},extra);}
async function seed(run,items,pool){
  await run(`cancelGesture();datasets=normalizeDatasets(${JSON.stringify(pool)});items=${JSON.stringify(items)};selection=[];editingSmartIdx=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
async function record(run,index=0){return run(`(async()=>{const r=(await ensureEditorComponentGraph()).get(items[${index}]);return {error:r.error,io:r.io};})()`);}
async function outputs(run,index=0){const r=await record(run,index);assert.ok(!r.error,r.error);return r.io.outputs;}
async function childrenText(run,index=0){return run(`(async()=>{const it=items[${index}],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'children',[it.state,smartResolvedStyle(it),it.w,it.h,false,io])).filter(x=>x.type==='text').map(x=>x.text);})()`);}
async function handlePoint(page,run,index,id){
  const value=await run(`(async()=>{selection=[${index}];editingSmartIdx=${index};render();const it=items[${index}],io=await resolveSmartComponentIo(it).catch(()=>undefined),hs=await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it),io]);const h=hs.find(h=>h.id===${JSON.stringify(id)});return h?{x:it.x+h.x,y:it.y+h.y,handle:h}:null;})()`);
  assert.ok(value,'handle '+id);const box=await page.locator('#canvas').boundingBox();return {...value,x:box.x+value.x,y:box.y+value.y};
}
async function clickHandle(page,run,index,id){const p=await handlePoint(page,run,index,id);await page.mouse.click(p.x,p.y);return p;}
async function openInputs(page,run,index=0){
  await run(`selection=[${index}];editingSmartIdx=null;render();`);await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open&&!document.querySelector('#componentBindingFields').disabled);
}
async function saveInputs(page){await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);}
async function editCell(page,run,cell,text,{cancel=false}={}){
  await clickHandle(page,run,0,cell);
  const input=page.locator('[data-smart-inline-input] #smartTextValue');await input.waitFor();
  assert.equal(await input.evaluate(el=>el.readOnly),false,'formula declaration stays editable');
  await input.fill(text);await input.press(cancel?'Escape':'Enter');await input.waitFor({state:'detached'});await run('smartHitSettled');
}
async function stagedRows(page,count){await page.waitForFunction(count=>__test.run(`(()=>{const s=componentDialogSession,r=s?.rows.find(r=>r.name==='data');if(!r)return false;try{const ref=JSON.parse(r.input.value);return ref.datasetId!=='fleet'&&s.datasets[ref.datasetId]?.rows.length===${count};}catch{return false;}})()`),count);}
async function snapshot(run){return run('({items:clone(items),datasets:clone(datasets),undo:clone(undoStack),redo:clone(redoStack)})');}
async function readerText(page,index,text){await page.waitForFunction(({index,text})=>{
  const host=document.querySelector('[data-smart-index="'+index+'"]');return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(node=>node.textContent===text);
},{index,text});}
async function openReader(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-spreadsheet-data-')),file=path.join(directory,'sheet.html');
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];reader.on('pageerror',e=>errors.push(e.message));
  reader.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await reader.goto(pathToFileURL(file).href);return {reader,errors,requests};
}
const fleet={name:'Fleet',columns:[{key:'Boat',name:'Boat',type:'string'},{key:'Points',name:'Points',type:'number'}],rows:[['Aurora',8],['Borealis',2],['Calypso',5]]};
const fleetSource=()=>item('data-source','fleet-source',{}, {x:1050,y:700,w:280,h:150,inputValues:{data:{datasetId:'fleet'}}});

test('the blank built-in spreadsheet uses Insert function and a compact Edit inspector to connect a dataset',async()=>app(async({page,run})=>{
  const definition=await run("clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key==='spreadsheet'))");
  assert.deepEqual(definition.items[0].state.cells,{});assert.deepEqual(definition.ports,{inputs:{},outputs:{}});
  await seed(run,[{...definition.items[0],uid:'sheet',x:60,y:160},fleetSource()],{fleet});
  assert.deepEqual(await outputs(run),{});assert.deepEqual(await childrenText(run),[]);
  await openInputs(page,run);
  assert.equal(await page.locator('#componentTypeName').textContent(),'Spreadsheet');
  assert.equal(await page.locator('#componentNameInput').inputValue(),'Spreadsheet');
  assert.equal(await page.locator('#componentConfigurationSection').isVisible(),false);
  assert.equal(await page.getByRole('heading',{name:'Table connections',exact:true}).count(),0);
  assert.equal(await page.locator('#componentTableRangesSection').count(),0);
  await page.locator('#componentBindingsCancel').click();
  const point=await handlePoint(page,run,0,'E1');await page.mouse.click(point.x,point.y,{button:'right'});
  await page.getByRole('menuitem',{name:'Insert function',exact:true}).click();
  await page.getByRole('menuitem',{name:'Datasets',exact:true}).click();
  await page.getByRole('menuitem',{name:'INPUT("data", A1:C6, INPUT("startRow"), 0)',exact:true}).click();
  const input=page.locator('[data-smart-inline-input] #smartTextValue');await input.waitFor();
  assert.equal(await input.inputValue(),'=INPUT("data",A1:C6,INPUT("startRow"),0)');
  await input.fill('=INPUT("data",A1:B4,0,0)');await input.press('Enter');await input.waitFor({state:'detached'});await run('smartHitSettled');
  await openInputs(page,run);const original=await snapshot(run);
  await page.getByLabel('data dataset',{exact:true}).selectOption(JSON.stringify({datasetId:'fleet'}));
  await page.locator('#componentNameInput').fill('Fleet sheet');
  assert.equal(await page.locator('#componentTypeName').textContent(),'Spreadsheet');
  assert.deepEqual(await snapshot(run),original,'name and binding changes stay staged until Save');await saveInputs(page);
  assert.equal(await run('items[0].componentName'),'Fleet sheet');assert.equal(await run('items[0].state.source'),undefined);
  assert.deepEqual(Object.values(await run('items[0].state.cells')),['=INPUT("data",A1:B4,0,0)']);
  assert.ok((await childrenText(run)).includes('Aurora'));assert.deepEqual(await run('datasets.fleet'),fleet);
}));

test('a conflicting range remains repairable without losing authored cells, formatting or assignments',async()=>app(async({page,run})=>{
  const state={cols:5,rows:6,weights:[2,1,1,1,1],cells:{A1:'Saved heading',A2:'Original value',D2:'=OUTPUT(INPUT("boost"),"result")'},formats:{A2:'0.00'},aligns:{D2:'right'}};
  await seed(run,[item('spreadsheet','sheet',state,{inputValues:{boost:9}}),fleetSource()],{fleet});const original=await snapshot(run);
  await editCell(page,run,'E1','=INPUT("data",A1:B4)',{cancel:true});assert.deepEqual(await snapshot(run),original);
  await editCell(page,run,'E1','=INPUT("data",A1:B4)');assert.match((await record(run)).error,/A1.*table range|A1.*clear/i);
  const bad=await run('clone(items[0])');
  assert.deepEqual(bad.state.formats,state.formats);assert.deepEqual(bad.state.aligns,state.aligns);assert.deepEqual(bad.state.weights,state.weights);
  assert.equal(bad.inputValues.boost,9);for(const [key,value] of Object.entries(state.cells))assert.equal(bad.state.cells[key],value);
  await editCell(page,run,'E1','=INPUT("data",C3:D6)');
  await openInputs(page,run);await page.getByLabel('data dataset',{exact:true}).selectOption(JSON.stringify({datasetId:'fleet'}));await saveInputs(page);
  assert.deepEqual(await outputs(run),{result:9});assert.ok((await childrenText(run)).includes('Aurora'));
  await run('undo();undo();undo()');assert.deepEqual(await run('clone(items)'),original.items);
}));

test('a formula-defined input range preserves formulas outside its rectangle',async()=>app(async({page,run})=>{
  const cells={D2:'=OUTPUT(SUM(B2:B4),"total")'};
  await seed(run,[item('spreadsheet','sheet',{cols:5,rows:6,cells}),fleetSource()],{fleet});
  await editCell(page,run,'E1','=INPUT("data",A1:B4)');await openInputs(page,run);
  await page.getByLabel('data dataset',{exact:true}).selectOption(JSON.stringify({datasetId:'fleet'}));await saveInputs(page);
  assert.equal(await run('items[0].state.cells.D2'),cells.D2);assert.deepEqual(await outputs(run),{total:15});
}));

test('a conflicting formula port can be repaired with a distinct name without losing its scalar assignment',async()=>app(async({page,run})=>{
  const state={cols:5,rows:6,cells:{D2:'=OUTPUT(INPUT("data","string"),"label")'}};
  await seed(run,[item('spreadsheet','sheet',state,{inputValues:{data:'Original string'}}),fleetSource()],{fleet});
  await editCell(page,run,'E1','=INPUT("data",A1:B4)');assert.ok((await record(run)).error);
  assert.equal(await run('items[0].inputValues.data'),'Original string');assert.equal(await run('items[0].state.cells.D2'),state.cells.D2);
  await editCell(page,run,'E1','=INPUT("fleet",A1:B4)');await openInputs(page,run);
  assert.equal(await page.getByLabel('data value',{exact:true}).inputValue(),'Original string');
  await page.getByLabel('fleet dataset',{exact:true}).selectOption(JSON.stringify({datasetId:'fleet'}));await saveInputs(page);
  assert.deepEqual(await outputs(run),{label:'Original string'});assert.ok((await childrenText(run)).includes('Aurora'));
}));

test('a range that makes a scalar output ambiguous preserves both formulas for inline repair',async()=>app(async({page,run})=>{
  const state={cols:5,rows:6,cells:{D1:'=OUTPUT(A2,"result")'}};
  await seed(run,[item('spreadsheet','sheet',state),fleetSource()],{fleet});assert.deepEqual(await outputs(run),{result:0});
  await editCell(page,run,'E1','=INPUT("data",A1:B4)');assert.ok((await record(run)).error);
  assert.equal(await run('items[0].state.cells.D1'),state.cells.D1);assert.equal(await run('items[0].state.cells.E1'),'=INPUT("data",A1:B4)');
  await editCell(page,run,'D1','=OUTPUT(A2,"result","string")');await openInputs(page,run);
  await page.getByLabel('data dataset',{exact:true}).selectOption(JSON.stringify({datasetId:'fleet'}));await saveInputs(page);
  assert.deepEqual(await outputs(run),{result:'Aurora'});
}));

test('a formula-defined table input changes its dataset binding with one Save',async()=>app(async({page,run})=>{
  const other={...fleet,name:'Other fleet',rows:[['Delta',11]]};
  const anchor=item('data-source','other-source',{}, {x:1050,y:700,w:280,h:150,inputValues:{data:{datasetId:'other'}}});
  await seed(run,[sheet({}, {inputValues:{data:{datasetId:'fleet'}}}),anchor],{fleet,other});const original=await snapshot(run);
  await openInputs(page,run);await page.getByLabel('data dataset',{exact:true}).selectOption(JSON.stringify({datasetId:'other'}));await saveInputs(page);
  assert.deepEqual(await run('items[0].inputValues.data'),{datasetId:'other'});assert.ok((await childrenText(run)).includes('Delta'));
  assert.equal(await run('undoStack.length'),original.undo.length+1);await run('undo()');assert.deepEqual(await run('clone(items)'),original.items);
}));

test('range formula edits report newly covered cells and removal is cancelable and undoable',async()=>app(async({page,run})=>{
  const cells={C2:'=OUTPUT(B2*2,"doubled")'};
  await seed(run,[sheet(cells,{inputValues:{data:{datasetId:'fleet'}}})],{fleet});const original=await snapshot(run);
  await editCell(page,run,'E1','=INPUT("data",A1:C4,INPUT("startRow"),0)');assert.match((await record(run)).error,/C2.*table range|C2.*clear/i);
  assert.equal(await run('items[0].state.cells.C2'),cells.C2);assert.deepEqual(await run('items[0].inputValues.data'),{datasetId:'fleet'});
  await editCell(page,run,'E1','=INPUT("data",A1:B3,1,0)');assert.deepEqual(await outputs(run),{doubled:4});
  await run('undo();undo()');assert.deepEqual(await run('clone(items)'),original.items);
  const beforeRemoval=await snapshot(run);await editCell(page,run,'E1','',{cancel:true});assert.deepEqual(await snapshot(run),beforeRemoval);
  await editCell(page,run,'E1','');assert.equal(await run('items[0].state.cells.E1'),undefined);assert.equal(await run('items[0].state.cells.C2'),cells.C2);
  await run('undo()');assert.deepEqual(await run('clone(items)'),beforeRemoval.items);
}));

test('two named dataset areas and a table output are created, revised and removed as cell formulas',async()=>app(async({page,run})=>{
  const rates={name:'Rates',columns:[{key:'rate',name:'Rate',type:'number'}],rows:[[10],[20]]};
  const state={cols:6,rows:6,cells:{F1:'Combined',F2:'=B2+D2',F3:'=B3+D3',F4:'=B4'}};
  const ratesSource=item('data-source','rates-source',{}, {x:1050,y:900,w:280,h:150,inputValues:{data:{datasetId:'rates'}}});
  await seed(run,[item('spreadsheet','sheet',state),fleetSource(),ratesSource],{fleet,rates});
  await editCell(page,run,'C1','=INPUT("data",A1:B4)');await editCell(page,run,'C2','=INPUT("rates",D1:D3)');
  await editCell(page,run,'E1','=OUTPUT(F1:F4,"totals",1)');await openInputs(page,run);
  await page.getByLabel('data dataset',{exact:true}).selectOption(JSON.stringify({datasetId:'fleet'}));
  await page.getByLabel('rates dataset',{exact:true}).selectOption(JSON.stringify({datasetId:'rates'}));await saveInputs(page);
  let result=await record(run);assert.ok(!result.error,result.error);
  assert.deepEqual(result.io.tables.outputs.totals.rows,[[18],[22],[5]]);
  assert.equal(result.io.tables.inputs.data.datasetId,'fleet');assert.equal(result.io.tables.inputs.rates.datasetId,'rates');
  await editCell(page,run,'E1','=OUTPUT(F1:F3,"summary",1)');result=await record(run);assert.ok(!result.error,result.error);
  assert.equal(result.io.outputs.totals,undefined);assert.deepEqual(result.io.tables.outputs.summary.rows,[[18],[22]]);
  const saved=await snapshot(run);await editCell(page,run,'E1','',{cancel:true});assert.deepEqual(await snapshot(run),saved);
  await editCell(page,run,'E1','');assert.deepEqual(await outputs(run),{});assert.equal(await run('items[0].state.cells.F2'),state.cells.F2);
  await run('undo()');assert.deepEqual(await run('clone(items)'),saved.items);
}));

test('dataset cells and formulas receive all rows and complete strings in editor and offline HTML',async()=>app(async({page,run,context})=>{
  const note='A'.repeat(200)+'tail',data={name:'Long table',columns:[{key:'Score',name:'Score',type:'number'},{key:'Note',name:'Note',type:'string'}],rows:Array.from({length:30},(_,i)=>[1000+i,i===29?note:'row '+i])};
  const cells={B1:'=OUTPUT(SUM(COLUMN("data","Score")),"total")',B2:'=OUTPUT(DATA("data",29,"Score"),"last")',
    B3:'=OUTPUT(LEN(DATA("data",29,"Note","string")),"length")',B4:'=OUTPUT(ROWS("data"),"rows")',
    B5:'=OUTPUT(A31,"gridLast","number")',B6:'=DATA("data",29,"Note","string")',B7:'=INPUT("data",A1:A31)'};
  await seed(run,[sheet(cells,{state:{cols:2,rows:31,cells},h:620,inputValues:{data:{datasetId:'long'}}})],{long:data});
  assert.deepEqual(await outputs(run),{total:30435,last:1029,length:204,rows:30,gridLast:1029});
  const r=await record(run);assert.equal(r.io.tables.inputs.data.rows.length,30);assert.equal(r.io.tables.inputs.data.rows[29][1],note);
  const text=await childrenText(run);assert.ok(text.includes('1029'),'row 29 reaches the grid');assert.ok(text.includes(note),'drawing receives the complete string');assert.ok(text.includes('204'),'drawing and compute agree on string length');
  const {reader,errors,requests}=await openReader(page,run,context);await readerText(reader,0,'1029');await readerText(reader,0,'204');await readerText(reader,0,note);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('filtered and sorted rows use zero-based selected positions and independent named datasets',async()=>app(async({run})=>{
  const other={name:'Other',columns:[{key:'Rate',name:'Rate',type:'number'}],rows:[[10],[20]]};
  const cells={D1:'=OUTPUT(DATA("data",0,"Boat","string"),"first")',D2:'=OUTPUT(A2,"gridFirst","string")',
    D3:'=OUTPUT(SUM(COLUMN("data","Points"))+SUM(COLUMN("rates","Rate")),"sum")',D4:'=OUTPUT(ROWS("rates"),"otherRows")'};
  await seed(run,[item('table-filter','filtered',{}, {inputValues:{data:{datasetId:'fleet'},column:'Points',operation:'>',number:2}}),
    item('table-sort','sorted',{}, {bindings:{data:{uid:'filtered',port:'data'}},inputValues:{column:'Points',direction:'ascending'}}),
    sheet(cells,{bindings:{data:{uid:'sorted',port:'data'}},inputValues:{rates:{datasetId:'rates'}}})],{fleet,rates:other});
  assert.deepEqual(await outputs(run,2),{first:'Calypso',gridFirst:'Calypso',sum:43,otherRows:2});
  const r=await record(run,2);assert.deepEqual(r.io.tables.inputs.data.rowIndices,[2,0]);
  assert.deepEqual(r.io.tables.inputs.rates.rows,[[10],[20]]);assert.equal(await run('JSON.stringify(datasets)'),JSON.stringify({fleet,rates:other}));
  await run('items[2].inputValues.startRow=1;editorComponentEvaluation=null;');
  assert.deepEqual(await outputs(run,2),{first:'Calypso',gridFirst:'Aurora',sum:43,otherRows:2},'the visible row window moves independently of whole-dataset formula indexes');
}));

test('a connected dataset replacement updates formulas and data cells in editor and exported reader',async()=>app(async({page,run,context})=>{
  const source=item('data-source','source',{allowReaderImport:true},{x:60,y:100,w:300,h:150,inputValues:{data:{datasetId:'fleet'}}});
  const linked=sheet({D1:'=OUTPUT(SUM(COLUMN("data","Points")),"total")'},{y:350,bindings:{data:{uid:'source',port:'data'}}});
  await seed(run,[source,linked],{fleet});assert.deepEqual(await outputs(run,1),{total:15});
  await clickHandle(page,run,0,'loadData');let dialog=page.locator('dialog[data-component-data-action="importDataset"]');await dialog.waitFor();
  await dialog.locator('[data-data-action-file]').setInputFiles({name:'updated.csv',mimeType:'text/csv',buffer:Buffer.from('Boat,Points\nNew boat,23\nSecond boat,4')});
  await dialog.getByRole('button',{name:'Replace data',exact:true}).click();await dialog.waitFor({state:'detached'});await run('smartHitSettled');
  assert.deepEqual(await outputs(run,1),{total:27});assert.ok((await childrenText(run,1)).includes('New boat'));
  const handle=(await handlePoint(page,run,0,'loadData')).handle;
  const {reader,errors,requests}=await openReader(page,run,context);await readerText(reader,1,'27');await readerText(reader,1,'New boat');
  const point=await reader.locator('[data-smart-index="0"]').evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},handle);
  await reader.mouse.click(point.x,point.y);dialog=reader.locator('dialog[data-component-data-action="importDataset"]');await dialog.waitFor();
  await dialog.locator('[data-data-action-file]').setInputFiles({name:'reader.csv',mimeType:'text/csv',buffer:Buffer.from('Boat,Points\nReader boat,40\nAnother,2')});
  await dialog.getByRole('button',{name:'Replace data',exact:true}).click();await dialog.waitFor({state:'detached'});
  await readerText(reader,1,'42');await readerText(reader,1,'Reader boat');assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  assert.deepEqual(await outputs(run,1),{total:27},'reader replacement does not write back to the editor');
}));

test('live dataset cells are read-only but remain selectable formula references',async()=>app(async({page,run})=>{
  await seed(run,[sheet({}, {inputValues:{data:{datasetId:'fleet'}}})],{fleet});
  const original=await snapshot(run),p=await clickHandle(page,run,0,'B2');assert.equal(p.handle.readOnly,true);
  const input=page.locator('[data-smart-inline-input] #smartTextValue');await input.waitFor();
  assert.equal(await input.evaluate(el=>el.readOnly),true);assert.equal(await input.inputValue(),'8');
  await page.keyboard.type('999');assert.equal(await input.inputValue(),'8');await input.press('Enter');await input.waitFor({state:'detached'});await run('smartHitSettled');
  assert.deepEqual(await snapshot(run),original,'Enter on a source cell does not alter history or data');
  await clickHandle(page,run,0,'D2');await input.waitFor();await input.fill('=');
  const ref=await handlePoint(page,run,0,'B2');await page.mouse.click(ref.x,ref.y);assert.equal(await input.inputValue(),'=B2');
  await page.keyboard.type('*2');await input.press('Enter');await input.waitFor({state:'detached'});await run('smartHitSettled');
  assert.equal(await run('items[0].state.cells.D2'),'=B2*2');assert.ok((await childrenText(run)).includes('16'));
  assert.deepEqual(await run('datasets.fleet'),fleet);assert.equal(await run('items[0].state.cells.B2'),undefined);
}));

test('copying a connected dataset stages an editable snapshot, saves once, and supports undo',async()=>app(async({page,run})=>{
  const source=item('data-source','source',{}, {inputValues:{data:{datasetId:'fleet'}}});
  await seed(run,[source,sheet({D1:'=SUM(B2:B4)'},{bindings:{data:{uid:'source',port:'data'}}})],{fleet});const original=await snapshot(run);
  await openInputs(page,run,1);await page.getByRole('button',{name:'Copy dataset to editable cells',exact:true}).click();
  assert.deepEqual(await snapshot(run),original,'copy is staged until Save');await page.locator('#componentBindingsCancel').click();assert.deepEqual(await snapshot(run),original);
  await openInputs(page,run,1);await page.getByRole('button',{name:'Copy dataset to editable cells',exact:true}).click();await saveInputs(page);
  assert.equal(await run('items[1].state.source'),undefined);assert.equal(await run('items[1].bindings.data'),undefined);assert.equal(await run('items[1].inputValues.data'),undefined);
  assert.equal(await run('undoStack.length'),original.undo.length+1,'copy and disconnect form one edit');assert.deepEqual(await run('datasets.fleet'),fleet);
  assert.ok((await childrenText(run,1)).includes('Aurora'));await clickHandle(page,run,1,'B2');const input=page.locator('[data-smart-inline-input] #smartTextValue');await input.waitFor();
  assert.equal(await input.evaluate(el=>el.readOnly),false);await input.fill('99');await input.press('Enter');await input.waitFor({state:'detached'});await run('smartHitSettled');
  assert.equal(await run('items[1].state.cells.B2'),'99');assert.equal(await run('datasets.fleet.rows[0][1]'),8,'editing the copy leaves the source unchanged');
  await run('undo();undo();');assert.deepEqual(await run('clone(items)'),original.items,'undo restores the live formula grid and its connection');
  await run('redo()');assert.equal(await run('items[1].state.source'),undefined);assert.ok((await childrenText(run,1)).includes('8'));
}));

test('copying a live table keeps its published values instead of recomputing a configuration preview',async()=>app(async({page,run})=>{
  const script=`({apiVersion:2,inputs:{value:{type:'number',default:0}},outputs:{data:{type:'table'}},
    _table(value){return {data:{table:{name:'Stored reading',columns:[{key:'value',name:'Value',type:'number'}],rows:[[value]]}}};},
    transition(inputs,state,memory){return {state,memory,nextWakeAt:null};},
    publish(state){return this._table(state.value);},compute(inputs){return this._table(inputs.value);},children(){return [];}})`;
  await seed(run,[item('data-source','stored',{value:8},{script,inputValues:{value:8}}),
    item('data-source','other',{value:42},{script,inputValues:{value:77}}),
    sheet({}, {bindings:{data:{uid:'stored',port:'data'}}})],{});
  await run('items[0].inputValues.value=99;editorComponentEvaluation=null;');
  assert.deepEqual((await record(run,0)).io.tables.outputs.data.rows,[[8]],'the live source retains its published reading');
  const preview=await run('(async()=>{const graph=await inspectComponentGraph(items,()=>true);return graph.get(items[0]).io.tables.outputs.data.rows;})()');
  assert.deepEqual(preview,[[99]],'configuration inspection deliberately previews the pending input');
  const original=await snapshot(run);
  await openInputs(page,run,2);await page.getByRole('button',{name:'Copy dataset to editable cells',exact:true}).click();
  await page.waitForFunction(()=>__test.run("componentDialogSession?.proposal.state.cells.A2==='8'"));
  assert.equal(await run('componentDialogSession.proposal.state.cells.A2'),'8','the copy uses the published table and its retained runtime dataset');
  await page.locator('#componentBindingsCancel').click();assert.deepEqual(await snapshot(run),original,'cancelling keeps the connected sheet unchanged');
  await openInputs(page,run,2);
  await page.getByLabel('data (table)',{exact:true}).selectOption(JSON.stringify({uid:'other',port:'data'}));
  await page.getByRole('button',{name:'Copy dataset to editable cells',exact:true}).click();await saveInputs(page);
  assert.equal(await run('items[2].state.cells.A2'),'42','a different connected source selected in the dialog also uses its published value');
  assert.equal(await run('items[2].state.source'),undefined);assert.equal(await run('items[2].bindings.data'),undefined);
  assert.deepEqual(await run('items.slice(0,2).map(item=>item.state.value)'),[8,42],'copying does not advance either stored source');
}));

test('copying data resizes a rotated grouped sheet without moving its origin or sibling and undoes exactly',async()=>app(async({page,run})=>{
  const source=sheet({}, {x:400,y:300,w:500,h:240,rotation:Math.PI/6,group:'sheet-group',groupRotation:Math.PI/5,inputValues:{data:{datasetId:'fleet'}}});
  const sibling={type:'rect',uid:'sibling',x:1000,y:400,w:100,h:80,rotation:-.2,group:'sheet-group',groupRotation:Math.PI/5,color:'#475569',size:2};
  await seed(run,[source,sibling],{fleet});await run("editingGroupId='sheet-group';");
  const geometry=()=>run('items.map(it=>({w:it.w,h:it.h,origin:toWorld(it,it.x,it.y),far:toWorld(it,it.x+it.w,it.y+it.h)}))');
  const before=await geometry(),saved=await run('clone(items)');await openInputs(page,run);await page.getByRole('button',{name:'Copy dataset to editable cells',exact:true}).click();await saveInputs(page);
  const after=await geometry();assert.notEqual(after[0].w,before[0].w);assert.notEqual(after[0].h,before[0].h);
  const near=(a,b,label)=>{for(const k of ['x','y'])assert.ok(Math.abs(a[k]-b[k])<.03,label+' '+k+': '+a[k]+' vs '+b[k]);};
  near(after[0].origin,before[0].origin,'sheet origin');near(after[1].origin,before[1].origin,'sibling origin');near(after[1].far,before[1].far,'sibling corner');
  await run('undo()');assert.deepEqual(await run('clone(items)'),saved,'undo restores exact grouped geometry and connection');
  await run('redo()');const redone=await geometry();for(let i=0;i<after.length;i++){near(redone[i].origin,after[i].origin,'redo origin');near(redone[i].far,after[i].far,'redo corner');}
}));

test('CSV copy preserves text literals and blocks oversized imports without changing the scene',async()=>app(async({page,run})=>{
  await seed(run,[sheet({}, {inputValues:{data:{datasetId:'fleet'}}})],{fleet});const original=await snapshot(run);
  await openInputs(page,run);await page.locator('#datasetFileInput-data').setInputFiles({name:'too-large.csv',mimeType:'text/csv',buffer:Buffer.from('Name,Value\n'+Array.from({length:70},(_,i)=>'row'+i+','+i).join('\n'))});
  await stagedRows(page,70);
  const copy=page.getByRole('button',{name:'Copy dataset to editable cells',exact:true});await copy.click();
  await page.waitForFunction(()=>/fit|limit|too|large|maximum|128/i.test(document.querySelector('#componentBindingsError').textContent));
  assert.deepEqual(await snapshot(run),original);await page.locator('#componentBindingsCancel').click();
  await openInputs(page,run);await page.locator('#datasetFileInput-data').setInputFiles({name:'literal.csv',mimeType:'text/csv',buffer:Buffer.from('Text,Count\n"=1+2",1\n"001",2\n"TRUE",3')});
  await stagedRows(page,3);
  await copy.click();await saveInputs(page);
  const text=await childrenText(run);assert.ok(text.includes('=1+2'),'formula-looking source text is literal');assert.ok(text.includes('001'),'numeric-looking source text stays text');assert.ok(text.includes('TRUE'));
  assert.equal(await run('items[0].state.cells.A2'),"'=1+2");assert.equal(await run('items[0].state.cells.A3'),"'001");assert.equal(await run('items[0].state.cells.A4'),"'TRUE");
  assert.equal(await run('items[0].state.source'),undefined);
  assert.deepEqual(await run('undoStack.at(-1).datasets.fleet'),fleet,'the disconnected source revision remains intact in Undo');
  await run('undo()');assert.deepEqual(await run('datasets.fleet'),fleet);
}));
