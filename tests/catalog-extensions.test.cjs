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
 await page.waitForFunction(()=>!document.querySelector('input[data-smart-number-input]'));   // Enter only applies: no next field
 {const pt=await editorPoint(page,run,0,'C2');await page.mouse.click(pt.x,pt.y);}
 await page.locator('input[data-smart-number-input]').waitFor();
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

test('spreadsheet Booleans: typed INPUT/OUTPUT ports, comparisons, IF/AND, wired to a toggle and a status indicator',async()=>app(async({run})=>{
 const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
 const cells={B1:'=INPUT("temp")',B2:'=INPUT("door","boolean")',B3:'=B1>25',B4:'=OUTPUT(AND(B3,B2),"Alarm")',
   B5:'=IF(B4,"ALARM","ok")',B6:'=OUTPUT(IF(B2,B1*2,0),"Heat")',B7:'=OUTPUT(B5,"State")'};
 await run(`(async()=>{const script=${JSON.stringify(script)};
   const cat=(k,uid,x,y,extra)=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===k).items[0]),uid,x,y,bindings:{},inputValues:{},...extra});
   cancelGesture();
   items=[{type:'smart',uid:'sh',x:60,y:100,w:640,h:240,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
     fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script,state:{cells:${JSON.stringify(cells)}},componentApi:2,componentName:'Spreadsheet',
     bindings:{temp:{uid:'nc',port:'value'},door:{uid:'tg',port:'value'}},inputValues:{}},
     cat('numberControl','nc',800,100,{state:{value:30}}),cat('toggle','tg',800,300,{state:{value:true}}),
     cat('statusIndicator','si',800,480,{bindings:{value:{uid:'sh',port:'Alarm'}}})];
   setTool('select');selection=[];render();await ensureEditorComponentGraph();})()`);
 const caps=await run('requestSmartCaps(items[0])');
 assert.deepEqual(caps.inputs,{temp:{type:'number',default:0},door:{type:'boolean',default:false}},'INPUT types: number by default, "boolean" on request');
 assert.deepEqual(caps.outputs,{Alarm:{type:'boolean'},Heat:{type:'number'},State:{type:'string'}},'OUTPUT types follow the formulas');
 assert.deepEqual(await outputs(run,0),{Alarm:true,Heat:60,State:'ALARM'});
 assert.deepEqual(await outputs(run,3),{value:true},'the Boolean output drives a status indicator');
 await run(`items[2].state={...items[2].state,value:false};ensureEditorComponentGraph()`);
 assert.deepEqual(await outputs(run,0),{Alarm:false,Heat:0,State:'ok'},'IF follows the Boolean input');
 assert.deepEqual(await outputs(run,3),{value:false});
}));

test('spreadsheet VLOOKUP: approximate and exact matches, comma or semicolon separators, typed outputs',async()=>app(async({run})=>{
 const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
 const cells={D1:'0',E1:'none',F1:'0',D2:'10',E2:'small',F2:'2.5',D3:'50',E3:'medium',F3:'2',D4:'100',E4:'large',F4:'1.5',
   H1:'Apfel',I1:'1.2',H2:'Birne',I2:'0.9',
   A1:'=INPUT("qty")',B1:'=OUTPUT(VLOOKUP(A1,D1:F4,3)*A1,"Cost")',B2:'=OUTPUT(VLOOKUP(A1;D1:F4;2;TRUE),"Size")',
   B3:'=OUTPUT(VLOOKUP(„birne“;H1:I2;2;FALSE),‘Pear’)'};   // typographic quotes work like straight ones
 await run(`(async()=>{const script=${JSON.stringify(script)};
   cancelGesture();
   items=[{type:'smart',uid:'sh',x:60,y:100,w:640,h:240,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
     fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script,state:{cells:${JSON.stringify(cells)}},componentApi:2,componentName:'Spreadsheet',
     bindings:{},inputValues:{qty:60}}];
   setTool('select');selection=[];render();await ensureEditorComponentGraph();})()`);
 assert.deepEqual((await run('requestSmartCaps(items[0])')).outputs,{Cost:{type:'number'},Size:{type:'string'},Pear:{type:'number'}});
 assert.deepEqual(await outputs(run,0),{Cost:120,Size:'medium',Pear:0.9},'60 falls in the 50 band: rate 2, size medium; exact text match ignores case');
 await run(`items[0].inputValues={qty:5};ensureEditorComponentGraph()`);
 assert.deepEqual(await outputs(run,0),{Cost:0,Size:'none',Pear:0.9},'5 falls in the 0 band');
 await run(`items[0].state={cells:{...items[0].state.cells,B1:'=OUTPUT(VLOOKUP(11,D1:F4,3,FALSE),"Cost")'}};ensureEditorComponentGraph()`);
 assert.match((await outputs(run,0)).error,/#N\/A/,'an exact lookup without a match reports #N/A');
}));

test('a component in error keeps its editor-only handles so a spreadsheet can be repaired in place; ordinary handles stay blocked',async()=>app(async({page,run})=>{
 const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
 const place=cells=>run(`(async()=>{const script=${JSON.stringify(script)};
   const nc={...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==='numberControl').items[0]),uid:'nc',x:820,y:100,state:{value:5},bindings:{},inputValues:{}};
   cancelGesture();
   items=[{type:'smart',uid:'sh',x:80,y:120,w:640,h:240,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
     fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script,state:{cells:${'${JSON.stringify(cells)}'}},componentApi:2,componentName:'Spreadsheet',
     bindings:{energy:{uid:'nc',port:'value'}},inputValues:{}},nc];
   setTool('select');selection=[];render();await ensureEditorComponentGraph();})()`.replace("${JSON.stringify(cells)}",JSON.stringify(cells)));
 // 1. a binding whose INPUT formula was removed: "Unknown input energy"
 await place({B1:'=OUTPUT(A1*2,"Out")'});
 assert.match((await outputs(run,0)).error,/Unknown input energy/);
 {const pt=await editorPoint(page,run,0,'A1');await page.mouse.click(pt.x,pt.y);}
 let input=page.locator('input[data-smart-number-input]');await input.waitFor();
 await input.fill('=INPUT("energy")');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.A1')==='=INPUT("energy")');
 await page.waitForFunction(()=>!document.querySelector('input[data-smart-number-input]'));await run('smartHitSettled');
 assert.deepEqual(await outputs(run,0),{Out:10},'retyping the INPUT formula reconnects the kept binding');
 // 2. an OUTPUT formula error
 await place({A1:'=INPUT("energy")',A2:'0',B1:'=OUTPUT(A1/A2,"Out")'});
 assert.match((await outputs(run,0)).error,/#DIV\/0!/);
 {const pt=await editorPoint(page,run,0,'A2');await page.mouse.click(pt.x,pt.y);}
 input=page.locator('input[data-smart-number-input]');await input.waitFor();
 await input.fill('2');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.A2')==='2');
 await page.waitForFunction(()=>!document.querySelector('input[data-smart-number-input]'));await run('smartHitSettled');
 assert.deepEqual(await outputs(run,0),{Out:2.5},'fixing the divisor clears the error');
 // 3. ordinary (non editor-only) handles of a component in error stay blocked
 const blocked=await run(`(async()=>{
   const it={...clone(items[0]),uid:'bad',bindings:{nope:{uid:'nc',port:'value'}},
     script:'({apiVersion:2,initState(){return {n:0};},children(){return [];},handles(){return [{id:"go",x:1,y:1,kind:"click"},{id:"fix",x:2,y:2,kind:"click",editorOnly:true}];},hitEdit(){return "go";},dragEdit(s){return {state:{n:s.n+1}};}})',state:{n:0}};
   items.push(it);await ensureEditorComponentGraph();
   return (await requestSmartCall(it,'handles',[it.state,10,10,{}])).map(h=>h.id);})()`);
 assert.deepEqual(blocked,['fix'],'only editor-only handles remain while the component is in error');
}));

test('spreadsheet context menu inserts and deletes columns/rows, resizes the shape, rewrites references, and undoes',async()=>app(async({page,run})=>{
 const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
 const cells={A1:'1',B1:'2',C1:'3',D1:'=SUM(A1:C1)',E1:'=OUTPUT(D1+B1,"Total")',A2:'="B1 stays"'};
 await run(`(async()=>{const script=${JSON.stringify(script)};
   cancelGesture();
   items=[{type:'smart',uid:'sh',x:120,y:140,w:384,h:144,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
     fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script,state:{cols:6,rows:6,cells:${JSON.stringify(cells)}},componentApi:2,componentName:'Spreadsheet',
     bindings:{},inputValues:{}}];
   setTool('select');selection=[];render();await ensureEditorComponentGraph();})()`);
 // right-click at a point in the sheet's local coordinates (edit mode) and pick a menu entry
 const pick=async(lx,ly,label)=>{
   await run('selection=[0];editingSmartIdx=0;render()');
   const it=await run('({x:items[0].x,y:items[0].y})'),box=await page.locator('#canvas').boundingBox();
   await page.mouse.click(box.x+it.x+lx,box.y+it.y+ly,{button:'right'});
   const menu=page.locator('[data-smart-context-menu]');await menu.waitFor();
   await menu.getByRole('menuitem',{name:label,exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('[data-smart-context-menu]'));await run('smartHitSettled');
   await page.waitForTimeout(150);
 };
 const sheet=()=>run('({w:items[0].w,h:items[0].h,cols:items[0].state.cols,rows:items[0].state.rows,cells:items[0].state.cells})');
 assert.deepEqual(await outputs(run,0),{Total:8});
 await pick(32,-16,'Insert 1 column right');   // on the column header
 let s=await sheet();
 assert.deepEqual([s.w,s.h,s.cols,s.rows],[448,144,7,6],'one column wider, cells keep their size');
 assert.equal(s.cells.E1,'=SUM(A1:D1)','a range spanning the insertion grows');
 assert.equal(s.cells.F1,'=OUTPUT(E1+C1,"Total")','references follow their moved cells');
 assert.equal(s.cells.A2,'="B1 stays"','quoted text is never rewritten');
 assert.deepEqual(await outputs(run,0),{Total:8});
 await pick(150,30,'Delete column');   // on a cell in C (the former B)
 s=await sheet();
 assert.deepEqual([s.w,s.cols],[384,6]);
 assert.equal(s.cells.D1,'=SUM(A1:C1)','a range shrinks when a column inside it is deleted');
 assert.equal(s.cells.E1,'=OUTPUT(D1+#REF!,"Total")','a reference to the deleted column becomes #REF!');
 await pick(-22,12,'Insert 1 row below');   // on the row header
 s=await sheet();
 assert.deepEqual([s.h,s.rows],[168,7]);
 assert.equal(s.cells.A3,'="B1 stays"','row 2 moved to row 3');
 await run('undo()');await run('undo()');await run('undo()');
 s=await sheet();
 assert.deepEqual([s.w,s.h,s.cols,s.rows],[384,144,6,6],'undo restores size and dimensions');
 assert.deepEqual(s.cells,cells,'and the original formulas');
 const legacy=await run(`(async()=>{const it={...clone(items[0]),uid:'old',state:{cells:{J10:'7'}}};items.push(it);
   return (await requestSmartCall(it,'handles',[it.state,it.w,it.h,{}])).filter(h=>h.kind==='text').length;})()`);
 assert.equal(legacy,100,'a sheet saved without rows/cols keeps 10 x 10');
}));

test('spreadsheet math, counting, error and text functions behave like Excel',async()=>app(async({run})=>{
 const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
 const cells={A1:'2.5',A2:'-7.25',A3:'hello',A4:'=""',A5:'=1/0',A6:'TRUE',
   B1:'=OUTPUT(ROUND(2.345;2)+ROUND(-2.5)+ROUND(1.005;2),"rounds")',B2:'=OUTPUT(-2^2+MOD(-7;3)+INT(A2)+SQRT(16),"math")',
   B3:'=OUTPUT(COUNTA(A1:A6)*10+COUNT(A1:A6),"counts")',B4:'=OUTPUT(IFERROR(A5;0)+IFERROR(A1*2;0),"iferror")',
   B5:'=OUTPUT("Total: "&A1&" "&LEFT(A3;2)&UPPER(MID(A3;3;3)),"text")',B6:'=OUTPUT(AND(ISBLANK(C1),NOT(ISBLANK(A4)),ISERROR(A5),ISTEXT(A3)),"tests")'};
 await run(`(async()=>{const script=${JSON.stringify(script)};
   cancelGesture();
   items=[{type:'smart',uid:'sh',x:60,y:100,w:384,h:144,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
     fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script,state:{cols:6,rows:6,cells:${JSON.stringify(cells)}},componentApi:2,componentName:'Spreadsheet',
     bindings:{},inputValues:{}}];
   setTool('select');selection=[];render();await ensureEditorComponentGraph();})()`);
 assert.deepEqual((await run('requestSmartCaps(items[0])')).outputs.text,{type:'string'});
 const o=await outputs(run,0);
 assert.equal(o.rounds,2.35-3+1.01);
 assert.equal(o.math,4+2-8+4,'-2^2 is 4, MOD takes the divisor sign, INT floors');
 assert.equal(o.counts,62,'COUNTA counts all 6 non-empty cells including "" and an error; COUNT counts 2 numbers');
 assert.equal(o.iferror,5);
 assert.equal(o.text,'Total: 2.5 heLLO');
 assert.equal(o.tests,true);
}));

test('spreadsheet context menu: Insert function submenu wraps the cell formula and opens it with the placeholder selected',async()=>app(async({page,run})=>{
 const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
 const cells={A1:'10',A2:'4',A3:'=A1/A2'};
 await run(`(async()=>{const script=${JSON.stringify(script)};
   cancelGesture();
   items=[{type:'smart',uid:'sh',x:120,y:140,w:384,h:144,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
     fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script,state:{cols:6,rows:6,cells:${JSON.stringify(cells)}},componentApi:2,componentName:'Spreadsheet',
     bindings:{},inputValues:{}}];
   setTool('select');selection=[0];editingSmartIdx=0;render();await ensureEditorComponentGraph();})()`);
 const box=await page.locator('#canvas').boundingBox();
 await page.mouse.click(box.x+120+32,box.y+140+60,{button:'right'});   // A3
 const menus=page.locator('[data-smart-context-menu]');
 await menus.first().getByRole('menuitem',{name:/Insert function/}).hover();
 await menus.nth(1).getByRole('menuitem',{name:/Math/}).hover();
 await menus.nth(2).getByRole('menuitem',{name:'ROUND(value, digits)'}).click();
 const input=page.locator('input[data-smart-number-input]');await input.waitFor();
 assert.deepEqual(await input.evaluate(e=>[e.value,e.value.slice(e.selectionStart,e.selectionEnd)]),['=ROUND(A1/A2, digits)','digits'],
   'the formula is wrapped and the first open placeholder is selected');
 assert.equal(await menus.count(),0,'menus close after the choice');
 await page.keyboard.type('0');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.A3')==='=ROUND(A1/A2, 0)');
 await page.waitForFunction(()=>!document.querySelector('input[data-smart-number-input]'));await run('smartHitSettled');
 const shown=await run(`(async()=>{const it=items[0],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'children',[it.state,smartResolvedStyle(it),it.w,it.h,false,io])).filter(k=>k.type==='text').map(k=>k.text);})()`);
 assert.ok(shown.includes('3'),'ROUND(10/4, 0) shows 3');
 const bad=await run(`(async()=>{const it={...clone(items[0]),uid:'bad',componentApi:undefined,script:'({initState(){return {};},children(){return [];},contextMenu(){return [{label:"a",items:[{label:"b",items:[{label:"c",items:[{id:"x",label:"x"}]}]}]}];}})'};
   const r=await requestSmartCall(it,'contextMenu',[{},0,0,10,10,{}]);return r==null?'rejected':'accepted';})()`);
 assert.equal(bad,'rejected','menus nest at most two levels deep');
}));

test('spreadsheet column width from the header menu: number dialog, the shape grows by the difference, reset restores',async()=>app(async({page,run})=>{
 const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
 await run(`(async()=>{const script=${JSON.stringify(script)};
   cancelGesture();
   items=[{type:'smart',uid:'sh',x:120,y:140,w:384,h:144,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
     fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script,state:{cols:6,rows:6,cells:{B1:'x'}},componentApi:2,componentName:'Spreadsheet',
     bindings:{},inputValues:{}}];
   setTool('select');selection=[0];editingSmartIdx=0;render();await ensureEditorComponentGraph();})()`);
 const pick=async label=>{const box=await page.locator('#canvas').boundingBox();
   await page.mouse.click(box.x+120+96,box.y+140-16,{button:'right'});   // column header B
   await page.locator('[data-smart-context-menu]').getByRole('menuitem',{name:label,exact:true}).click();};
 await pick('Column width…');
 await page.locator('dialog[data-smart-number-input]').waitFor();
 assert.equal(await page.locator('#smartNumberValue').inputValue(),'64','the dialog shows the current width');
 await page.locator('#smartNumberValue').fill('120');await page.getByRole('button',{name:'Apply',exact:true}).click();await run('smartHitSettled');
 await page.waitForFunction(()=>__test.run('items[0].w')===440);
 assert.deepEqual(await run('items[0].state.weights'),[1,1.875,1,1,1,1]);
 const rect=await run(`(async()=>{const it=items[0];return (await requestSmartCall(it,'handles',[it.state,it.w,it.h,{}])).find(h=>h.id==='B1').rect;})()`);
 assert.deepEqual([rect.x,rect.w],[64,120],'cell B1 is 120 px wide and starts after A');
 await run('selection=[0];editingSmartIdx=0;render()');
 await pick('Reset column width');
 await page.waitForFunction(()=>__test.run('items[0].w')===384);
 assert.equal(await run('items[0].state.weights'),undefined,'a reset sheet stores no widths');
}));
