const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {chromium,webkit}=require('playwright');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const names=['constant','math','range-map','gauge','number-input','data-source','data-table','data-download','spreadsheet'];
const scripts=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8')]));
const defs=Object.fromEntries(Object.entries(scripts).map(([name,script])=>[name,vm.runInNewContext(script)]));
const artifact=(2.8*2/10)*100;
let browser;
before(async()=>{browser=await ({chromium,webkit}[process.env.BROWSER_ENGINE||'chromium']).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1000}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://numeric-formatting.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://numeric-formatting.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
function item(name,uid,patch={}){
  const def=defs[name];return {type:'smart',uid,componentApi:2,componentName:uid,script:scripts[name],state:def.initState(),x:40,y:100,color:'#64748b',textColor:'#334155',font:'400 18px sans-serif',fontFamily:'sans',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,...def.initStyle(),...patch};
}
async function seed(run,items,pool={}){
  await run(`cancelGesture();datasets=normalizeDatasets(${JSON.stringify(pool)});items=${JSON.stringify(items)};selection=[];editingSmartIdx=null;undoStack=[];redoStack=[];historyBefore=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
const output=(run,index)=>run(`(async()=>{const graph=await ensureEditorComponentGraph();return graph.get(items[${index}]).io.outputs;})()`);
async function texts(run,index){return run(`(async()=>{const it=items[${index}],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'children',[it.state,smartResolvedStyle(it),it.w,it.h,false,io])).filter(c=>c.type==='text').map(c=>c.text);})()`);}
async function clickEditor(page,run,index,id){
  const point=await run(`(async()=>{selection=[${index}];editingSmartIdx=${index};render();const it=items[${index}],io=await resolveSmartComponentIo(it);const handle=(await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it),io])).find(h=>h.id===${JSON.stringify(id)});return {x:it.x+handle.x,y:it.y+handle.y,handle};})()`);
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+point.x,box.y+point.y);await run('smartHitSettled');return point.handle;
}
async function reader(page,run,context,count){
  const download=page.waitForEvent('download');await run('exportHtml()');const body=fs.readFileSync(await(await download).path(),'utf8');
  const exported=await context.newPage(),errors=[];exported.on('pageerror',error=>errors.push(error.message));
  await exported.route('http://numeric-export.test/**',route=>route.fulfill({status:200,contentType:'text/html',body}));
  await exported.goto('http://numeric-export.test/document.html');
  await exported.waitForFunction(count=>document.querySelectorAll('[data-smart-ready="true"]').length===count,count);
  return {page:exported,errors};
}
async function readerText(page,index,text){await page.waitForFunction(({index,text})=>[...document.querySelector('[data-smart-index="'+index+'"]')?.querySelectorAll('text')||[]].some(node=>node.textContent===text),{index,text});}
async function clickReader(page,index,handle){
  const p=await page.locator('[data-smart-index="'+index+'"]').evaluate((host,handle)=>{const p=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},handle);await page.mouse.click(p.x,p.y);
}

test('real editor and HTML export show the 2.8 numeric-tools result as 56 percent while signals keep full precision',async()=>app(async({page,run,context})=>{
  await seed(run,[item('constant','source',{state:{value:2.8}}),
    item('math','multiply',{x:300,inputValues:{b:2,operation:'×'},bindings:{a:{uid:'source',port:'value'}}}),
    item('range-map','map',{x:650,inputValues:{inMin:0,inMax:10,outMin:0,outMax:100,clamp:true},bindings:{value:{uid:'multiply',port:'value'}}}),
    item('gauge','gauge',{x:1000,bindings:{value:{uid:'map',port:'value'}}})]);
  assert.equal((await output(run,1)).value,5.6);assert.equal((await output(run,2)).value,artifact);assert.equal((await output(run,3)).percentage,artifact);
  assert.ok((await texts(run,3)).includes('56%'));
  const saved=await run('makeDocument(items,assets,{},datasets)');assert.equal(saved.items[0].state.value,2.8);
  const exported=await reader(page,run,context,4);await readerText(exported.page,3,'56%');assert.deepEqual(exported.errors,[]);
}));

test('Inputs previews format numbers but saving an unchanged literal retains every stored digit',async()=>app(async({page,run})=>{
  await seed(run,[item('gauge','gauge',{inputValues:{value:artifact}})]);
  await run('selection=[0];render()');await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open&&!document.querySelector('#componentBindingFields').disabled);
  const field=page.getByLabel('value value',{exact:true});assert.equal(await field.inputValue(),String(artifact));
  await page.waitForFunction(()=>document.querySelector('#componentOutputs').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#componentOutputs').textContent(),'percentage = 56');
  await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  assert.equal(await run('items[0].inputValues.value'),artifact);assert.equal((await output(run,0)).percentage,artifact);
}));

test('number input displays a rounded value but opens and submits every original digit in editor and export',async()=>app(async({page,run,context})=>{
  const value=.1+.2,state={...defs['number-input'].initState(),values:[value],min:0,max:1,step:.1};
  await seed(run,[item('number-input','input',{state})]);assert.ok((await texts(run,0)).includes('0.3'));
  const handle=await clickEditor(page,run,0,'entry'),field=page.locator('#smartNumberValue');await field.waitFor();
  assert.equal(await field.inputValue(),String(value));await field.press('Enter');await run('smartHitSettled');await field.press('Escape');await field.waitFor({state:'detached'});
  assert.equal((await output(run,0)).value,value);assert.ok((await run('items[0].state.values')).every(number=>number===value));
  const exported=await reader(page,run,context,1);await readerText(exported.page,0,'0.3');await clickReader(exported.page,0,handle);
  const readerField=exported.page.locator('#smartNumberValue');await readerField.waitFor();assert.equal(await readerField.inputValue(),String(value));
  await readerField.press('Enter');await readerField.press('Escape');await readerField.waitFor({state:'detached'});await readerText(exported.page,0,'0.3');
  await clickReader(exported.page,0,handle);await readerField.waitFor();assert.equal(await readerField.inputValue(),String(value),'unchanged entry did not save the rounded label');await readerField.press('Escape');
  assert.deepEqual(exported.errors,[]);
}));

test('Dataset and Spreadsheet views preserve raw cells on unchanged edits and CSV or JSON downloads',async()=>app(async({page,run,context})=>{
  const records={name:'Exact records',columns:[{key:'number',name:'Number',type:'number'},{key:'text',name:'Text',type:'string'}],rows:[[artifact,String(artifact)]]};
  await seed(run,[item('data-table','records',{w:720,h:300,state:{...defs['data-table'].initState(),editDataset:true,allowReaderEdit:true},inputValues:{data:{datasetId:'records'}}}),
    item('spreadsheet','sheet',{x:40,y:440,w:700,h:160,state:{...defs.spreadsheet.initState(),source:'Dataset',dataColumns:2,dataRows:1,editDataset:true,allowReaderEdit:true},inputValues:{data:{datasetId:'records'},startRow:0}}),
    item('data-source','owner',{x:950,y:100,datasetOwner:'data',inputValues:{data:{datasetId:'records'}}}),
    item('data-download','download',{x:900,y:360,inputValues:{data:{datasetId:'records'},filename:'exact'}})],{records});
  const before=await run('JSON.stringify(datasets.records)');
  assert.ok((await texts(run,0)).includes('56'));assert.ok((await texts(run,0)).includes(String(artifact)));assert.ok((await texts(run,1)).includes('56'));
  const tableHandle=await clickEditor(page,run,0,'cell-0-0'),field=page.locator('#smartTextValue');await field.waitFor();assert.equal(await field.inputValue(),String(artifact));
  await field.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');
  const sheetHandle=await clickEditor(page,run,1,'A2');await field.waitFor();assert.equal(await field.inputValue(),String(artifact));
  await field.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');assert.equal(await run('JSON.stringify(datasets.records)'),before);
  const csv=await run('serializeComponentTable(componentTableSnapshot({datasetId:"records"},datasets),"csv")');assert.equal(csv,`number,text\r\n${artifact},${artifact}\r\n`);
  assert.deepEqual(JSON.parse(await run('serializeComponentTable(componentTableSnapshot({datasetId:"records"},datasets),"json")')),[{number:artifact,text:String(artifact)}]);
  const exported=await reader(page,run,context,4);await readerText(exported.page,0,'56');await readerText(exported.page,1,'56');
  for(const [index,handle] of [[0,tableHandle],[1,sheetHandle]]){await clickReader(exported.page,index,handle);const input=exported.page.locator('#smartTextValue');await input.waitFor();assert.equal(await input.inputValue(),String(artifact));await input.press('Enter');await input.waitFor({state:'detached'});}
  const downloadHandle=defs['data-download'].handles({},320,150,{}, {inputs:{filename:'exact'}})[1];
  await clickReader(exported.page,3,downloadHandle);const dialog=exported.page.locator('dialog[data-component-data-action]');await dialog.waitFor();
  assert.deepEqual(await dialog.locator('td').allTextContents(),['56',String(artifact)]);assert.equal(await dialog.locator('td').first().getAttribute('title'),String(artifact));
  const result=exported.page.waitForEvent('download');await dialog.getByRole('button',{name:'Download',exact:true}).click();
  assert.deepEqual(JSON.parse(fs.readFileSync(await(await result).path(),'utf8')),[{number:artifact,text:String(artifact)}]);
  assert.deepEqual(exported.errors,[]);
}));

test('authoring Number control and Gauge templates match their portable sources and formatted built-ins',async()=>app(async({run})=>{
  for(const [key,name] of [['numberControl','number-control'],['gauge','gauge']]){
    const template=await run(`SMART_TEMPLATES[${JSON.stringify(key)}].script`);
    const builtin=await run(`BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===${JSON.stringify(key)}).items[0].script`);
    assert.equal(template.trim(),scripts[name]?.trim()||fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8').trim(),key+' authoring template matches its source');
    assert.equal(template.trim(),builtin.trim(),key+' authoring and built-in definitions agree');
  }
  await run(`cancelGesture();datasets={};items=['numberControl','gauge'].map((key,index)=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid:'template-'+index,script:SMART_TEMPLATES[key].script,x:60+index*350,y:100,...(index===0?{state:{value:${artifact}},inputValues:{min:${artifact},max:100,step:1}}:{bindings:{value:{uid:'template-0',port:'value'}}})}));selection=[];setTool('select');render();save();`);
  assert.equal((await output(run,0)).value,artifact);assert.equal((await output(run,1)).percentage,artifact);
  assert.ok((await texts(run,0)).includes('56'));assert.ok((await texts(run,1)).includes('56%'));
}));

test('paused editor and exported signal traces use display formatting while retaining exact numeric signals',async()=>app(async({page,run,context})=>{
  const value=.1+.2,state={...defs['number-input'].initState(),values:[value],min:0,max:1,step:.1};
  await seed(run,[item('number-input','input',{state})]);
  await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');
  const handle=await clickEditor(page,run,0,'entry'),field=page.locator('#smartNumberValue');await field.waitFor();await field.press('Enter');await run('smartHitSettled');await field.press('Escape');
  await page.locator('#componentStepBtn').click();await run('smartGestureQueue');
  assert.match(await page.locator('#componentSignalStatus').textContent(),/value=0\.3, submitted=true/);
  assert.equal(await run('editorTimeline.trace.at(-1).changes[0].outputs.value'),value);assert.equal((await output(run,0)).value,value);
  const exported=await reader(page,run,context,1);await exported.page.locator('#feedbackPause').click();
  await exported.page.waitForFunction(()=>document.querySelector('#feedbackPause').textContent==='Resume');
  const nextValue=.2+.4;await clickReader(exported.page,0,handle);const readerField=exported.page.locator('#smartNumberValue');await readerField.waitFor();await readerField.fill(String(nextValue));await readerField.press('Enter');
  await readerText(exported.page,0,'0.6');await readerField.press('Escape');
  await exported.page.locator('#feedbackStep').click();
  await exported.page.waitForFunction(()=>/value=0\.6, submitted=true/.test(document.querySelector('#feedbackStatus').textContent));
  await clickReader(exported.page,0,handle);await readerField.waitFor();assert.equal(await readerField.inputValue(),String(nextValue));await readerField.press('Escape');assert.deepEqual(exported.errors,[]);
}));
