const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

// Expose only the served copy's closure. Component calls still cross the real
// Worker boundary; downloaded HTML runs its own unmodified runtime.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://catalog-extensions.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://catalog-extensions.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}

async function editorHandle(page,run,index,id){
  const {item,handle}=await run(`(async()=>{
    selection=[${index}];editingSmartIdx=${index};render();
    const item=items[${index}],io=await resolveSmartComponentIo(item);
    const handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]);
    return {item,handle:handles.find(handle=>handle.id===${JSON.stringify(id)})};
  })()`);
  assert.ok(handle,id+' handle exists');
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+handle.x,box.y+item.y+handle.y);await run('smartHitSettled');
  return handle;
}
async function openExport(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-catalog-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'document.html');fs.copyFileSync(await(await download).path(),file);
  const preview=await context.newPage(),errors=[],requests=[];
  preview.on('pageerror',error=>errors.push(error.message));
  preview.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await preview.goto(pathToFileURL(file).href);
  return {preview,errors,requests};
}
async function readerClick(page,index,point){
  const host=page.locator('[data-smart-index="'+index+'"]');
  await page.waitForFunction(host=>host.dataset.smartReady==='true',await host.elementHandle());
  const position=await host.evaluate((host,p)=>{
    const at=new DOMPoint(p.x,p.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:at.x,y:at.y};
  },point);
  await page.mouse.click(position.x,position.y);
}

async function seed(run,specs){
 await run(`cancelGesture();items=${JSON.stringify(specs)}.map((spec,i)=>{const it=clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===spec.key).items[0]);return {...it,uid:'ext-'+i,x:80+(i%3)*390,y:100+Math.floor(i/3)*310,...spec,state:{...it.state,...spec.state}};});selection=[];editingSmartIdx=null;setTool('select');render();`);
 await run('ensureEditorComponentGraph()');
}
async function outputs(run,index){return run(`(async()=>{const graph=await ensureEditorComponentGraph(),record=graph.get(items[${index}]);return record.error?{error:record.error}:record.io.outputs;})()`);}
async function editorPoint(page,run,index,id){
 const {item,handle}=await run(`(async()=>{selection=[${index}];editingSmartIdx=${index};render();const item=items[${index}];return {item,handle:(await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)])).find(h=>h.id===${JSON.stringify(id)})};})()`);
 const box=await page.locator('#canvas').boundingBox();return {x:box.x+item.x+handle.x,y:box.y+item.y+handle.y,handle};
}
async function inputDialog(page,run,index){
 await run(`selection=[${index}];render();void openComponentBindings();`);
 await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open && !document.querySelector('#componentBindingsSave').disabled);
}
async function saveInputs(page){await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);}
async function readerText(page,index,pattern){
 await page.waitForFunction(({index,pattern})=>new RegExp(pattern).test(document.querySelector('[data-smart-index="'+index+'"]')?.textContent||''),{index,pattern});
}

test('channel settings resize real ports and preserve assignments, undo, and library placement',async()=>app(async({page,run})=>{
 await seed(run,[{key:'steppedSelectorNumber'}]);
 await inputDialog(page,run,0);
 await page.getByLabel('Channels',{exact:true}).fill('8');await page.getByLabel('Channels',{exact:true}).press('Tab');
 await page.getByLabel('in8 value',{exact:true}).fill('88');
 await page.getByLabel('in1 value',{exact:true}).fill('11');await saveInputs(page);
 assert.equal(await run('items[0].state.channels'),8);
 assert.deepEqual(await outputs(run,0),{value:11,position:1});
 assert.equal(await run('(async()=>(await requestSmartCaps(items[0])).inputs.in8.type)()'),'number');
 const placed=await run(`(async()=>{const copy=clone(items[0]);copy.uid='placement-check';await initializeSmartItem(copy);const owner=createSmartExecution(copy);try{return {state:copy.state,inputs:(await requestSmartCaps(copy,owner)).inputs,result:(await evaluateComponentGraph([copy],(it,fn,args)=>fn==='caps'?requestSmartCaps(it,null,args[0]):requestSmartCall(it,fn,args))).get(copy).io.outputs};}finally{disposeSmartExecution(owner);}})()`);
 assert.equal(placed.state.channels,8);assert.equal(placed.inputs.in8.type,'number');assert.deepEqual(placed.result,{value:11,position:1});
 await inputDialog(page,run,0);
 await page.getByLabel('Channels',{exact:true}).fill('3');await page.getByLabel('Channels',{exact:true}).press('Tab');
 await page.waitForFunction(()=>!document.querySelector('[aria-label="in4 value"]') && !document.querySelector('#componentBindingsSave').disabled);
 await saveInputs(page);assert.equal(await run('items[0].inputValues.in8'),undefined);
 await run('undo()');assert.equal(await run('items[0].state.channels'),8);assert.equal(await run('items[0].inputValues.in8'),88);
 await run('redo()');assert.equal(await run('items[0].state.channels'),3);
 const restored=await run('normalizeScene(JSON.parse(JSON.stringify(items)),{},4).items[0]');
 assert.equal(restored.state.channels,3);assert.equal(restored.inputValues.in1,11);
}));

test('stepped selector and distributor share pulses, wrap, reset, and work in offline HTML',async()=>app(async({page,run,context})=>{
 await seed(run,[{key:'trigger'},
 {key:'steppedSelectorNumber',state:{channels:3,configuredChannels:3},inputValues:{in1:10,in2:20,in3:30},bindings:{pulse:{uid:'ext-0',port:'value'}}},
 {key:'steppedDistributorNumber',state:{channels:3,configuredChannels:3},inputValues:{value:99},bindings:{pulse:{uid:'ext-0',port:'value'}}}]);
 for(const expected of [2,3,1]){
   await editorHandle(page,run,0,'trigger');
   await page.waitForFunction(expected=>__test.run('items[1].state.position')===expected,expected);
   assert.deepEqual(await outputs(run,1),{value:expected*10,position:expected});
   const routed=await outputs(run,2);assert.equal(routed.position,expected);
   for(let n=1;n<=3;n++)assert.equal(routed['out'+n],n===expected?99:0);
   await page.waitForFunction(()=>__test.run('items[0].state.value')===false);
 }
 const {preview,errors,requests}=await openExport(page,run,context);
 await readerText(preview,1,'Channel 1 / 3');
 const point=await run(`(async()=>(await requestSmartCall(items[0],'handles',[items[0].state,items[0].w,items[0].h,smartResolvedStyle(items[0])])).find(h=>h.id==='trigger'))()`);
 await readerClick(preview,0,point);await readerText(preview,1,'Channel 2 / 3');await readerText(preview,2,'Channel 2 / 3');
 assert.match(await preview.locator('[data-smart-index="1"]').textContent(),/Out: 20/);
 assert.match(await preview.locator('[data-smart-index="2"]').textContent(),/2: 99/);
 await preview.reload();await readerText(preview,1,'Channel 1 / 3');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 await inputDialog(page,run,1);await page.getByLabel('reset value',{exact:true}).selectOption('true');await saveInputs(page);
 assert.deepEqual(await outputs(run,1),{value:10,position:1});
}));

test('typed numeric entry snaps and accepts a maximum off the grid in editor and offline reader',async()=>app(async({page,run,context})=>{
 await seed(run,[{key:'numberControl',inputValues:{min:0,max:10,step:3},state:{value:0}}]);
 let point=await editorPoint(page,run,0,'entry');await page.mouse.click(point.x,point.y);
 await page.getByLabel('Value',{exact:true}).fill('5');await page.getByRole('button',{name:'Apply',exact:true}).click();await run('smartHitSettled');
 assert.deepEqual(await outputs(run,0),{value:6});
 point=await editorPoint(page,run,0,'entry');await page.mouse.click(point.x,point.y);
 await page.getByLabel('Value',{exact:true}).fill('10');await page.getByRole('button',{name:'Apply',exact:true}).click();await run('smartHitSettled');
 assert.deepEqual(await outputs(run,0),{value:10});
 await run('undo()');assert.deepEqual(await outputs(run,0),{value:6});
 const {preview,errors,requests}=await openExport(page,run,context);
 await readerClick(preview,0,point.handle);
 await preview.getByLabel('Value',{exact:true}).fill('9');await preview.getByRole('button',{name:'Apply',exact:true}).click();
 await preview.waitForFunction(()=>[...document.querySelectorAll('[data-smart-index="0"] text')].some(e=>e.textContent==='9'));
 await readerClick(preview,0,point.handle);await preview.getByLabel('Value',{exact:true}).fill('3');await preview.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.ok((await preview.locator('[data-smart-index="0"] text').allTextContents()).includes('9'));
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('periodic and edge pulses drive downstream counters without initial or restored edges',async()=>app(async({page,run,context})=>{
 await seed(run,[{key:'pulseGenerator',inputValues:{seconds:.3,width:.1}},
 {key:'counter',bindings:{value:{uid:'ext-0',port:'value'}}},
 {key:'toggle'},
 {key:'edgePulse',inputValues:{seconds:.05,edge:'either'},bindings:{value:{uid:'ext-2',port:'value'}}},
 {key:'counter',bindings:{value:{uid:'ext-3',port:'value'}}}]);
 await page.waitForFunction(()=>__test.run('items[1].state.count')>=2);
 assert.equal(await run('items[4].state.count'),0);
 await editorHandle(page,run,2,'toggle');await page.waitForFunction(()=>__test.run('items[4].state.count')===1);
 await editorHandle(page,run,2,'toggle');await page.waitForFunction(()=>__test.run('items[4].state.count')===2);
 const {preview,errors,requests}=await openExport(page,run,context);
 await readerText(preview,4,'Count2');
 const point=await run(`(async()=>(await requestSmartCall(items[2],'handles',[items[2].state,items[2].w,items[2].h,smartResolvedStyle(items[2])])).find(h=>h.id==='toggle'))()`);
 await readerClick(preview,2,point);await readerText(preview,4,'Count3');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('dynamic port and settings metadata are bounded and invalid counts stay unavailable',async()=>app(async({run})=>{
 await seed(run,[{key:'steppedDistributorBoolean',inputValues:{value:true},state:{channels:16,configuredChannels:16}},
 {key:'steppedSelectorNumber',state:{channels:17}}]);
 const caps=await run('requestSmartCaps(items[0])');assert.equal(Object.keys(caps.outputs).length,17);assert.equal(caps.settings.channels.max,16);
 assert.match((await outputs(run,1)).error,/valid v2|invalid|API marker/i);
 assert.equal(await run(`(()=>{try{normalizeComponentSettings({n:{type:'number',default:3,min:2,max:16,step:2}});return false;}catch(_){return true;}})()`),true);
 assert.equal(await run(`(()=>{try{normalizeComponentSettings({n:{type:'number',default:4,step:0}});return false;}catch(_){return true;}})()`),true);
}));

test('shrinking a distributor keeps removed-output connections visible as unavailable',async()=>app(async({page,run})=>{
 await seed(run,[{key:'steppedDistributorBoolean',inputValues:{value:true}},
 {key:'statusIndicator',bindings:{value:{uid:'ext-0',port:'out4'}}}]);
 assert.deepEqual(await outputs(run,1),{value:false});
 await inputDialog(page,run,0);await page.getByLabel('Channels',{exact:true}).fill('2');await page.getByLabel('Channels',{exact:true}).press('Tab');
 await page.waitForFunction(()=>!document.querySelector('#componentBindingsSave').disabled && !document.querySelector('#componentOutputs').textContent.includes('out3'));
 await saveInputs(page);
 assert.match((await outputs(run,1)).error,/Missing output out4/);
 assert.equal(await run('items[1].bindings.value.port'),'out4','removed output does not silently bind a different channel');
 await run('undo()');assert.deepEqual(await outputs(run,1),{value:false});
}));

test('numeric dialogs cancel on visibility changes without leaving the offline gesture queue blocked',async()=>app(async({page,run,context})=>{
 await seed(run,[{key:'numberControl',state:{value:4}}]);
 const point=await editorPoint(page,run,0,'entry');await page.mouse.click(point.x,point.y);
 await page.getByLabel('Value',{exact:true}).fill('9');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('dialog[data-smart-number-input]').count(),0);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
 await run('smartHitSettled');assert.deepEqual(await outputs(run,0),{value:4});
 const {preview}=await openExport(page,run,context);await readerClick(preview,0,point.handle);
 await preview.getByLabel('Value',{exact:true}).fill('7');
 await preview.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await preview.locator('dialog[data-smart-number-input]').count(),0);
 await preview.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
 await readerClick(preview,0,point.handle);await preview.getByLabel('Value',{exact:true}).fill('6');
 await preview.getByRole('button',{name:'Apply',exact:true}).click();
 await preview.waitForFunction(()=>[...document.querySelectorAll('[data-smart-index="0"] text')].some(e=>e.textContent==='6'));
}));

test('kind:text handles edit in place over their rect, or in a dialog without one; the spreadsheet example wires ports',async()=>app(async({page,run})=>{
 const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
 await run(`(async()=>{const script=${JSON.stringify(script)};
   const nc={...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==='numberControl').items[0]),uid:'nc',x:820,y:100,state:{value:5},bindings:{},inputValues:{}};
   cancelGesture();
   items=[{type:'smart',uid:'sh',x:80,y:120,w:640,h:240,color:'#64748b',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
     fontFamily:'sans',fontSize:16,font:fontStr('sans',16),script,state:{cells:{A1:'2',A2:'3',A3:'=SUM(A1:A2)*INPUT("energy")',B1:'=OUTPUT(A3,"Total Energy")'}},
     componentApi:2,componentName:'Spreadsheet',bindings:{energy:{uid:'nc',port:'value'}},inputValues:{}},nc];
   setTool('select');selection=[];render();await ensureEditorComponentGraph();})()`);
 assert.deepEqual(await outputs(run,0),{Total_Energy:25},'(2+3) x connected 5, published under a valid port name');
 assert.deepEqual(Object.keys((await run('requestSmartCaps(items[0])')).inputs),['energy'],'INPUT("energy") declares an input port');
 const headers=editing=>run(`(async()=>{const it=items[0],io=await resolveSmartComponentIo(it);
   const kids=await requestSmartCall(it,'children',[it.state,smartResolvedStyle(it),it.w,it.h,${editing},io]);
   return {outside:kids.filter(k=>k.editorOnly).length,cellsMoved:kids.filter(k=>!k.editorOnly && (k.x<0 || k.y<0)).length};})()`);
 assert.deepEqual(await headers(false),{outside:0,cellsMoved:0},'no headers outside edit mode');
 const edit=await headers(true);
 assert.ok(edit.outside>=40 && edit.cellsMoved===0,'edit mode adds editor-only headers outside the box without moving cells');
 const undoBefore=await run('undoStack.length');
 const pt=await editorPoint(page,run,0,'C1');await page.mouse.click(pt.x,pt.y);
 const input=page.locator('input[data-smart-number-input]');await input.waitFor();
 const box=await input.boundingBox(),canvas=await page.locator('#canvas').boundingBox();
 assert.deepEqual([box.x-canvas.x,box.y-canvas.y,box.width,box.height].map(Math.round),[80+128,120,64,24],'the field covers cell C1 exactly');
 assert.equal(await page.locator('dialog[data-smart-number-input]').count(),0,'no dialog for a handle with rect');
 await input.fill('=OUTPUT(A1*100,"Cents")');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.C1')==='=OUTPUT(A1*100,"Cents")');
 await page.locator('input[data-smart-number-input]').waitFor();   // Enter continued in C2
 await page.keyboard.type('7');await page.keyboard.press('Tab');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.C2')==='7');
 await page.locator('input[data-smart-number-input]').waitFor();   // Tab continued in D2
 await page.keyboard.type('99');await page.keyboard.press('Escape');await run('smartHitSettled');
 assert.equal(await page.locator('input[data-smart-number-input]').count(),0);
 assert.equal(await run('items[0].state.cells.D2'),undefined,'Escape discards the cell being typed');
 assert.deepEqual(await outputs(run,0),{Total_Energy:25,Cents:200},'a typed OUTPUT formula adds an output port');
 assert.equal(await run('undoStack.length'),undoBefore+2,'one undo entry per applied cell');
 await run('undo()');assert.equal(await run('items[0].state.cells.C2'),undefined);
 // without a rect the same handle kind uses the dialog
 await run(`(async()=>{items.push({...clone(items[1]),uid:'dlg',x:300,y:450,w:200,h:80,componentApi:undefined,componentName:'Note',bindings:undefined,inputValues:undefined,
   script:'({initState(){return {t:"hi"};},children(s,st,w,h){return [{type:"text",x:0,y:0,w,h,text:s.t,strokeOn:false,fill:false}];},handles(s,w,h){return [{id:"t",x:w/2,y:h/2,kind:"text",value:s.t,label:"Note"}];},hitEdit(){return "t";},dragEdit(s,id,v){return {...s,t:v||"-"};}})',
   state:{t:'hi'}});render();})()`);
 const dpt=await editorPoint(page,run,2,'t');await page.mouse.click(dpt.x,dpt.y);
 await page.waitForSelector('dialog[data-smart-number-input]');
 assert.equal(await page.locator('dialog[data-smart-number-input] label').textContent(),'Note');
 await page.locator('#smartNumberValue').fill('typed');await page.getByRole('button',{name:'Apply',exact:true}).click();await run('smartHitSettled');
 assert.equal(await run('items[2].state.t'),'typed');
 const bad=await run(`(async()=>{const it={...items[0],uid:'bad',script:'({apiVersion:2,initState(){return {};},children(){return [];},handles(){return [{id:"t",x:1,y:1,kind:"text",value:5}];}})'};
   try{const r=await requestSmartCall(it,'handles',[{},10,10,{}]);return r==null?'rejected':'accepted '+JSON.stringify(r);}catch(e){return 'rejected';}})()`);
 assert.equal(bad,'rejected','a non-string text value is rejected');
}));
