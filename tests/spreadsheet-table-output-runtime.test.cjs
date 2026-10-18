const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..');
const scripts=Object.fromEntries(['spreadsheet','data-source','data-table','number-control','trigger'].map(name=>[name,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8')]));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const def=name=>vm.runInNewContext(scripts[name]);
let browser;
before(async()=>{browser=await ({chromium,webkit}[process.env.BROWSER_ENGINE||'chromium']).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1100}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.route('http://sheet-table-output.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://sheet-table-output.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
function item(name,uid,state={},extra={}){return {type:'smart',uid,componentApi:2,componentName:uid,script:scripts[name],state,x:60,y:100,
  w:600,h:220,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,fontFamily:'sans',fontSize:14,bindings:{},inputValues:{},...extra};}
async function seed(run,list,pool={}){
  await run(`cancelGesture();datasets=normalizeDatasets(${JSON.stringify(pool)});items=${JSON.stringify(list)};selection=[];editingSmartIdx=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
async function record(run,index=0){return run(`(async()=>{const r=(await ensureEditorComponentGraph()).get(items[${index}]);return {error:r.error,io:r.io,caps:r.caps};})()`);}
async function output(run,index=0){const r=await record(run,index);assert.ok(!r.error,r.error);return r.io.outputs;}
async function cell(page,run,index,address,value){await editorClick(page,run,index,address);const field=page.locator('#smartTextValue');await field.waitFor();await field.fill(value);await field.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');}
async function editorClick(page,run,index,id){
  const p=await run(`(async()=>{selection=[${index}];editingSmartIdx=${index};render();const it=items[${index}],handles=await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it)]);return {item:it,handle:handles.find(h=>h.id===${JSON.stringify(id)})};})()`);
  assert.ok(p.handle,id);const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+p.item.x+p.handle.x,box.y+p.item.y+p.handle.y);
  if(!['text','number','action'].includes(p.handle.kind))await run('smartHitSettled');
}
async function openReader(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sheet-output-')),file=path.join(directory,'reader.html');
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];reader.on('pageerror',e=>errors.push(e.message));reader.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await reader.goto(pathToFileURL(file).href);return {reader,errors,requests};
}
async function readerText(page,index,text){await page.waitForFunction(({index,text})=>{const host=document.querySelector('[data-smart-index="'+index+'"]');return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(n=>n.textContent===text);},{index,text});}
async function readerClick(page,index,handle){const p=await page.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},handle);await page.mouse.click(p.x,p.y);}
async function handles(run,index){return run(`requestSmartCall(items[${index}],'handles',[items[${index}].state,items[${index}].w,items[${index}].h,smartResolvedStyle(items[${index}])])`);}

test('Inputs enables a real Worker table output; bad cells withhold the complete result and repair restores it',async()=>app(async({page,run,context})=>{
  const state=JSON.parse(JSON.stringify(def('spreadsheet').initState()));
  await seed(run,[item('spreadsheet','sheet',state),item('data-table','result',{}, {x:760,y:100,bindings:{data:{uid:'sheet',port:'table'}}})]);
  assert.ok(scripts.spreadsheet.length<=50000);assert.equal((await record(run)).caps.outputs.table,undefined);
  await run('selection=[0];editingSmartIdx=null;render();');await page.locator('#componentBindingsBtn').click();
  await page.getByLabel('Publish table output',{exact:true}).selectOption('true');
  await page.waitForFunction(()=>!document.querySelector('#componentBindingFields').disabled);
  assert.equal(await page.getByLabel('Result cells',{exact:true}).inputValue(),'A2:C4');
  assert.equal(await page.getByLabel('Result columns (name:type)',{exact:true}).inputValue(),'energy:number\nprice:number\ncost:number');
  await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);await run('ensureEditorComponentGraph()');
  const initial=await record(run);assert.equal(initial.caps.outputs.table.type,'table');assert.match(initial.io.outputs.table.datasetId,/^~/);
  assert.deepEqual(initial.io.tables.outputs.table.rows,[[10,.3,3],[12.5,.3,3.75],[7,.32,2.24]]);assert.equal(initial.io.tables.outputs.table.editable,false);
  assert.equal((await output(run,1)).rowCount,3);assert.deepEqual(await run('Object.keys(datasets)'),[],'pure result tables are not persisted stores');
  await cell(page,run,0,'A3',"'wrong");assert.match((await record(run)).error,/Table output in A3: expected number/);assert.deepEqual((await record(run)).io.outputs,{});
  assert.ok((await record(run,1)).error);await cell(page,run,0,'A3','4');assert.equal((await record(run)).io.tables.outputs.table.rows[1][2],1.2);
  await cell(page,run,0,'C3','=1/0');assert.match((await record(run)).error,/Table output in C3: #DIV\/0!/);
  await cell(page,run,0,'C3','=A3*B3');assert.equal((await output(run,1)).rowCount,3);
  const {reader,errors,requests}=await openReader(page,run,context);await readerText(reader,1,'1.2');await readerText(reader,1,'energy');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('a pure spreadsheet result can feed an editable owned snapshot without overwriting it until Apply, also offline',async()=>app(async({page,run,context})=>{
  const state={cols:3,rows:3,cells:{A1:"'One",A2:"'Two",B1:'=INPUT("factor")*3',B2:'=INPUT("factor")*4',C1:'=OUTPUT(SUM(B1:B2),"total")'},tableOutput:true,tableRange:'A1:B2',tableColumns:'label:string\namount:number',tableName:'Calculated'};
  const store={name:'Saved results',columns:[{key:'label',name:'Label',type:'string'},{key:'amount',name:'Amount',type:'number'}],rows:[]};
  await seed(run,[item('spreadsheet','sheet',state,{bindings:{factor:{uid:'factor',port:'value'}}}),
    item('number-control','factor',{value:2},{y:400,w:240,h:130,inputValues:{min:0,max:10,step:1}}),
    item('data-table','live',{}, {x:760,y:100,h:300,bindings:{data:{uid:'sheet',port:'table'}}}),
    item('data-source','saved',{allowReaderUpdates:true},{y:640,w:300,h:150,datasetOwner:'data',inputValues:{data:{datasetId:'saved'}},bindings:{source:{uid:'sheet',port:'table'},replace:{uid:'apply',port:'value'}}}),
    item('trigger','apply',def('trigger').initState(),{x:400,y:640,w:280,h:190}),
    item('data-table','stored',{}, {x:760,y:520,h:300,bindings:{data:{uid:'saved',port:'data'}}})],{saved:store});
  assert.equal((await output(run)).total,14);await editorClick(page,run,4,'trigger');await page.waitForFunction(()=>__test.run('datasets.saved.rows.length===2'));
  assert.deepEqual(await run('datasets.saved.rows'),[['One',6],['Two',8]]);await editorClick(page,run,1,'plus');assert.equal((await output(run)).total,21);
  assert.deepEqual(await run('datasets.saved.rows'),[['One',6],['Two',8]],'derived updates do not materialize themselves');
  const plus=(await handles(run,1)).find(h=>h.id==='plus'),apply=(await handles(run,4)).find(h=>h.id==='trigger');
  const {reader,errors,requests}=await openReader(page,run,context);await readerText(reader,2,'12');await readerText(reader,5,'8');
  await readerClick(reader,1,plus);await readerText(reader,2,'16');await readerText(reader,5,'8');
  await readerClick(reader,4,apply);await readerText(reader,5,'16');
  assert.deepEqual(await run('datasets.saved.rows'),[['One',6],['Two',8]],'reader Apply remains session-local');
  await reader.reload();await readerText(reader,2,'12');await readerText(reader,5,'8');assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('table output from a bounded linked rectangle follows paging while keeping all spreadsheet metadata local',async()=>app(async({page,run,context})=>{
  const pool={source:{name:'Input',columns:[{key:'label',name:'Label',type:'string'},{key:'amount',name:'Amount',type:'number'}],rows:[['Alpha',10],['Beta',20],['Gamma',30]]}};
  const state={source:'Dataset',cols:3,rows:3,dataRows:2,dataColumns:2,cells:{C2:'=B2*2',C3:'=B3*2'},formats:{C2:'0.00'},tableOutput:true,tableRange:'A2:C3',tableColumns:'label:string\nvalue:number\ndoubled:number',tableName:'Visible results'};
  await seed(run,[item('spreadsheet','sheet',state,{inputValues:{data:{datasetId:'source'}},bindings:{startRow:{uid:'page',port:'value'}}}),
    item('number-control','page',{value:0},{y:400,w:240,h:130,inputValues:{min:0,max:1,step:1}}),
    item('data-table','result',{}, {x:760,y:100,h:300,bindings:{data:{uid:'sheet',port:'table'}}})],pool);
  assert.deepEqual((await record(run)).io.tables.outputs.table.rows,[['Alpha',10,20],['Beta',20,40]]);
  await editorClick(page,run,1,'plus');assert.deepEqual((await record(run)).io.tables.outputs.table.rows,[['Beta',20,40],['Gamma',30,60]]);
  assert.deepEqual(await run('items[0].state'),state);assert.deepEqual(await run('datasets'),pool);
  const {reader,errors,requests}=await openReader(page,run,context);await readerText(reader,2,'Gamma');await readerText(reader,2,'60');assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
