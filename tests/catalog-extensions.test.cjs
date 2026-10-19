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
 await page.getByLabel('in7 value',{exact:true}).fill('88');
 await page.getByLabel('in0 value',{exact:true}).fill('11');await saveInputs(page);
 assert.equal(await run('items[0].state.channels'),8);
 assert.deepEqual(await outputs(run,0),{value:11,position:0});
 assert.equal(await run('(async()=>(await requestSmartCaps(items[0])).inputs.in7.type)()'),'number');
 const placed=await run(`(async()=>{const copy=clone(items[0]);copy.uid='placement-check';await initializeSmartItem(copy);const owner=createSmartExecution(copy);try{return {state:copy.state,inputs:(await requestSmartCaps(copy,owner)).inputs,result:(await evaluateComponentGraph([copy],(it,fn,args)=>fn==='caps'?requestSmartCaps(it,null,args[0]):requestSmartCall(it,fn,args))).get(copy).io.outputs};}finally{disposeSmartExecution(owner);}})()`);
 assert.equal(placed.state.channels,8);assert.equal(placed.inputs.in7.type,'number');assert.deepEqual(placed.result,{value:11,position:0});
 await inputDialog(page,run,0);
 await page.getByLabel('Channels',{exact:true}).fill('3');await page.getByLabel('Channels',{exact:true}).press('Tab');
 await page.waitForFunction(()=>!document.querySelector('[aria-label="in3 value"]') && !document.querySelector('#componentBindingsSave').disabled);
 await saveInputs(page);assert.equal(await run('items[0].inputValues.in7'),undefined);
 await run('undo()');assert.equal(await run('items[0].state.channels'),8);assert.equal(await run('items[0].inputValues.in7'),88);
 await run('redo()');assert.equal(await run('items[0].state.channels'),3);
 const restored=await run('normalizeScene(JSON.parse(JSON.stringify(items)),{},4).items[0]');
 assert.equal(restored.state.channels,3);assert.equal(restored.inputValues.in0,11);
}));

test('stepped selector and distributor share pulses, wrap, reset, and work in offline HTML',async()=>app(async({page,run,context})=>{
 await seed(run,[{key:'trigger'},
 {key:'steppedSelectorNumber',state:{channels:3,configuredChannels:3},inputValues:{in0:10,in1:20,in2:30},bindings:{pulse:{uid:'ext-0',port:'value'}}},
 {key:'steppedDistributorNumber',state:{channels:3,configuredChannels:3},inputValues:{value:99},bindings:{pulse:{uid:'ext-0',port:'value'}}}]);
 for(const expected of [1,2,0]){
   await editorHandle(page,run,0,'trigger');
   await page.waitForFunction(expected=>__test.run('items[1].state.position')===expected,expected);
   assert.deepEqual(await outputs(run,1),{value:(expected+1)*10,position:expected});
   const routed=await outputs(run,2);assert.equal(routed.position,expected);
   for(let n=0;n<3;n++)assert.equal(routed['out'+n],n===expected?99:0);
   await page.waitForFunction(()=>__test.run('items[0].state.value')===false);
 }
 const {preview,errors,requests}=await openExport(page,run,context);
 await readerText(preview,1,'Channel 0 · 3 channels');
 const point=await run(`(async()=>(await requestSmartCall(items[0],'handles',[items[0].state,items[0].w,items[0].h,smartResolvedStyle(items[0])])).find(h=>h.id==='trigger'))()`);
 await readerClick(preview,0,point);await readerText(preview,1,'Channel 1 · 3 channels');await readerText(preview,2,'Channel 1 · 3 channels');
 assert.match(await preview.locator('[data-smart-index="1"]').textContent(),/Out: 20/);
 assert.match(await preview.locator('[data-smart-index="2"]').textContent(),/1: 99/);
 await preview.reload();await readerText(preview,1,'Channel 0 · 3 channels');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 await inputDialog(page,run,1);await page.getByLabel('reset value',{exact:true}).selectOption('true');await saveInputs(page);
 assert.deepEqual(await outputs(run,1),{value:10,position:0});
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
 {key:'statusIndicator',bindings:{value:{uid:'ext-0',port:'out3'}}}]);
 assert.deepEqual(await outputs(run,1),{value:false});
 await inputDialog(page,run,0);await page.getByLabel('Channels',{exact:true}).fill('2');await page.getByLabel('Channels',{exact:true}).press('Tab');
 await page.waitForFunction(()=>!document.querySelector('#componentBindingsSave').disabled && !document.querySelector('#componentOutputs').textContent.includes('out2'));
 await saveInputs(page);
 assert.match((await outputs(run,1)).error,/Missing output out3/);
 assert.equal(await run('items[1].bindings.value.port'),'out3','removed output does not silently bind a different channel');
 await run('undo()');assert.deepEqual(await outputs(run,1),{value:false});
}));

test('numeric dialogs cancel on visibility changes without leaving the offline gesture queue blocked',async()=>app(async({page,run,context})=>{
 await seed(run,[{key:'numberControl',state:{value:4}}]);
 const point=await editorPoint(page,run,0,'entry');await page.mouse.click(point.x,point.y);
 await page.getByLabel('Value',{exact:true}).fill('9');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('dialog[data-smart-number-input],dialog[data-smart-text-input]').count(),0);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
 await run('smartHitSettled');assert.deepEqual(await outputs(run,0),{value:4});
 const {preview}=await openExport(page,run,context);await readerClick(preview,0,point.handle);
 await preview.getByLabel('Value',{exact:true}).fill('7');
 await preview.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await preview.locator('dialog[data-smart-number-input],dialog[data-smart-text-input]').count(),0);
 await preview.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
 await readerClick(preview,0,point.handle);await preview.getByLabel('Value',{exact:true}).fill('6');
 await preview.getByRole('button',{name:'Apply',exact:true}).click();
 await preview.waitForFunction(()=>[...document.querySelectorAll('[data-smart-index="0"] text')].some(e=>e.textContent==='6'));
}));

test('kind:text handles use inline edit mode, or a dialog without inline metadata; the spreadsheet example wires ports',async()=>app(async({page,run})=>{
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
 const input=page.locator('[data-smart-inline-input] #smartTextValue');await input.waitFor();
 const box=await input.boundingBox(),canvas=await page.locator('#canvas').boundingBox();
 assert.deepEqual([box.x-canvas.x,box.y-canvas.y,box.width,box.height].map(Math.round),[80+128,120,64,24],'the field covers cell C1 exactly');
 assert.equal(await page.locator('dialog[data-smart-number-input],dialog[data-smart-text-input]').count(),0,'no dialog for a handle with inline metadata');
 await input.fill('=OUTPUT(A1*100,"Cents")');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.C1')==='=OUTPUT(A1*100,"Cents")');
 await page.waitForFunction(()=>!document.querySelector('[data-smart-inline-input] #smartTextValue'));   // Enter only applies: no next field
 {const pt=await editorPoint(page,run,0,'C2');await page.mouse.click(pt.x,pt.y);}
 await page.locator('[data-smart-inline-input] #smartTextValue').waitFor();
 await page.keyboard.type('7');await page.keyboard.press('Tab');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.C2')==='7');
 await page.locator('[data-smart-inline-input] #smartTextValue').waitFor();   // Tab continued in D2
 await page.keyboard.type('99');await page.keyboard.press('Escape');await run('smartHitSettled');
 assert.equal(await page.locator('[data-smart-inline-input] #smartTextValue').count(),0);
 assert.equal(await run('items[0].state.cells.D2'),undefined,'Escape discards the cell being typed');
 assert.deepEqual(await outputs(run,0),{Total_Energy:25,Cents:200},'a typed OUTPUT formula adds an output port');
 assert.equal(await run('undoStack.length'),undoBefore+2,'one undo entry per applied cell');
 await run('undo()');assert.equal(await run('items[0].state.cells.C2'),undefined);
 // Without inline metadata the same handle kind uses the dialog
 await run(`(async()=>{items.push({...clone(items[1]),uid:'dlg',x:300,y:450,w:200,h:80,componentApi:undefined,componentName:'Note',bindings:undefined,inputValues:undefined,
   script:'({initState(){return {t:"hi"};},children(s,st,w,h){return [{type:"text",x:0,y:0,w,h,text:s.t,strokeOn:false,fill:false}];},handles(s,w,h){return [{id:"t",x:w/2,y:h/2,kind:"text",value:s.t,label:"Note"}];},hitEdit(){return "t";},dragEdit(s,id,v){return {...s,t:v||"-"};}})',
   state:{t:'hi'}});render();})()`);
 const dpt=await editorPoint(page,run,2,'t');await page.mouse.click(dpt.x,dpt.y);
 await page.waitForSelector('dialog[data-smart-text-input]');
 assert.equal(await page.locator('dialog[data-smart-text-input] label').textContent(),'Note');
 await page.locator('#smartTextValue').fill('typed');await page.getByRole('button',{name:'Apply',exact:true}).click();await run('smartHitSettled');
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
 let input=page.locator('[data-smart-inline-input] #smartTextValue');await input.waitFor();
 await input.fill('=INPUT("energy")');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.A1')==='=INPUT("energy")');
 await page.waitForFunction(()=>!document.querySelector('[data-smart-inline-input] #smartTextValue'));await run('smartHitSettled');
 assert.deepEqual(await outputs(run,0),{Out:10},'retyping the INPUT formula reconnects the kept binding');
 // 2. an OUTPUT formula error
 await place({A1:'=INPUT("energy")',A2:'0',B1:'=OUTPUT(A1/A2,"Out")'});
 assert.match((await outputs(run,0)).error,/#DIV\/0!/);
 {const pt=await editorPoint(page,run,0,'A2');await page.mouse.click(pt.x,pt.y);}
 input=page.locator('[data-smart-inline-input] #smartTextValue');await input.waitFor();
 await input.fill('2');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.A2')==='2');
 await page.waitForFunction(()=>!document.querySelector('[data-smart-inline-input] #smartTextValue'));await run('smartHitSettled');
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
 const input=page.locator('[data-smart-inline-input] #smartTextValue');await input.waitFor();
 assert.deepEqual(await input.evaluate(e=>[e.value,e.value.slice(e.selectionStart,e.selectionEnd)]),['=ROUND(A1/A2,digits)','digits'],
   'the formula is wrapped and the first open placeholder is selected');
 assert.equal(await menus.count(),0,'menus close after the choice');
 await page.keyboard.type('0');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.A3')==='=ROUND(A1/A2,0)');
 await page.waitForFunction(()=>!document.querySelector('[data-smart-inline-input] #smartTextValue'));await run('smartHitSettled');
 const shown=await run(`(async()=>{const it=items[0],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'children',[it.state,smartResolvedStyle(it),it.w,it.h,false,io])).filter(k=>k.type==='text').map(k=>k.text);})()`);
 assert.ok(shown.includes('3'),'ROUND(10/4, 0) shows 3');
 const bad=await run(`(async()=>{const it={...clone(items[0]),uid:'bad',componentApi:undefined,script:'({initState(){return {};},children(){return [];},contextMenu(){return [{label:"a",items:[{label:"b",items:[{label:"c",items:[{id:"x",label:"x"}]}]}]}];}})'};
   const r=await requestSmartCall(it,'contextMenu',[{},0,0,10,10,{}]);return r==null?'rejected':'accepted';})()`);
 assert.equal(bad,'rejected','menus nest at most two levels deep');
}));

test('spreadsheet context menu opens on a touch long press; a short tap still edits the cell',async()=>app(async({page,run})=>{
 const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
 await run(`(async()=>{const script=${JSON.stringify(script)};
   cancelGesture();
   items=[{type:'smart',uid:'sh',x:120,y:140,w:384,h:144,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
     fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script,state:{cols:6,rows:6,cells:{A1:'5'}},componentApi:2,componentName:'Spreadsheet',
     bindings:{},inputValues:{}}];
   setTool('select');selection=[0];editingSmartIdx=0;render();await ensureEditorComponentGraph();})()`);
 // touch pointer events as iPadOS sends them (no contextmenu event)
 const touch=(type,x,y)=>page.evaluate(([type,x,y])=>{const c=document.getElementById('canvas'),r=c.getBoundingClientRect();
   c.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,pointerType:'touch',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:r.left+x,clientY:r.top+y}));},[type,x,y]);
 const menus=page.locator('[data-smart-context-menu]'),input=page.locator('[data-smart-inline-input] #smartTextValue');
 const a1=[120+32,140+12];
 await touch('pointerdown',...a1);await page.waitForTimeout(700);
 assert.equal(await menus.count(),1,'holding still opens the context menu');
 await touch('pointermove',a1[0]+3,a1[1]+2);await touch('pointerup',a1[0]+3,a1[1]+2);await run('smartHitSettled');
 assert.equal(await menus.count(),1,'lifting the finger keeps the menu open');
 assert.equal(await input.count(),0,'the long press does not also start editing the cell');
 await menus.first().getByRole('menuitem',{name:'Alignment'}).click();
 await menus.nth(1).getByRole('menuitem',{name:'Center'}).click();
 await page.waitForFunction(()=>__test.run('items[0].state.aligns?.A1')==='center');
 assert.equal(await run('items[0].state.cells.A1'),'5');
 // a press that moves is not a long press; a short tap edits the cell as before
 await page.waitForTimeout(400);
 await touch('pointerdown',...a1);await touch('pointermove',a1[0]+20,a1[1]);await page.waitForTimeout(700);
 assert.equal(await menus.count(),0,'a moving press opens no menu');
 await touch('pointerup',a1[0]+20,a1[1]);
 await input.waitFor();await page.keyboard.press('Escape');   // the released press edits A1 as usual
 await page.waitForFunction(()=>!document.querySelector('[data-smart-inline-input] #smartTextValue'));await page.waitForTimeout(400);
 const b2=[120+64+32,140+24+12];
 await touch('pointerdown',...b2);await page.waitForTimeout(80);await touch('pointerup',...b2);
 await input.waitFor();
 assert.equal(await input.getAttribute('aria-label'),'Cell B2');
 assert.equal(await menus.count(),0);
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('[data-smart-inline-input] #smartTextValue'));await page.waitForTimeout(400);
 // the headers lie outside the shape's box: a long press there opens the header menu too
 const headB=[120+64+32,140-8-10];
 await touch('pointerdown',...headB);await page.waitForTimeout(700);
 assert.equal(await menus.count(),1,'a long press on a column header opens its menu');
 await touch('pointerup',...headB);await run('smartHitSettled');
 assert.ok((await menus.first().textContent()).includes('Column width'),'the column header menu');
 assert.equal(await run('editingSmartIdx'),0,'still in edit mode');
}));

test('spreadsheet context menu: Number format and Alignment per cell, moved with inserted columns',async()=>app(async({page,run})=>{
 const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
 const cells={A1:'1234.5678',A2:'0.1235',A3:'hello',A4:'=A1*2'};
 await run(`(async()=>{const script=${JSON.stringify(script)};
   cancelGesture();
   items=[{type:'smart',uid:'sh',x:120,y:140,w:384,h:144,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
     fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script,state:{cols:6,rows:6,cells:${JSON.stringify(cells)}},componentApi:2,componentName:'Spreadsheet',
     bindings:{},inputValues:{}}];
   setTool('select');selection=[0];editingSmartIdx=0;render();await ensureEditorComponentGraph();})()`);
 const box=await page.locator('#canvas').boundingBox();
 const menus=page.locator('[data-smart-context-menu]');
 const choose=async(row,sub,name,expect)=>{   // expect: state check once the choice is applied
   await page.mouse.click(box.x+120+32,box.y+140+row*24+12,{button:'right'});
   await menus.first().getByRole('menuitem',{name:sub}).hover();
   await menus.nth(1).getByRole('menuitem',{name}).click();
   await page.waitForFunction(expect=>__test.run(expect),expect);
 };
 await choose(0,'Number format',/^Thousands, 2 decimals/,"items[0].state.formats?.A1==='#,##0.00'");
 await choose(1,'Number format',/^Percent\s+12%/,"items[0].state.formats?.A2==='0%'");
 await choose(2,'Alignment',/^Right/,"items[0].state.aligns?.A3==='right'");
 await page.waitForFunction(()=>__test.run('JSON.stringify([items[0].state.formats,items[0].state.aligns])')===JSON.stringify([{A1:'#,##0.00',A2:'0%'},{A3:'right'}]));
 const drawn=()=>run(`(async()=>{const it=items[0],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'children',[it.state,smartResolvedStyle(it),it.w,it.h,false,io])).filter(k=>k.type==='text').map(k=>[k.text,k.align]);})()`);
 let shown=await drawn();
 assert.deepEqual(shown.filter(([t])=>['1,234.57','12%','hello','2469.1356'].includes(t)),[['1,234.57','right'],['12%','right'],['hello','right'],['2469.1356','right']],
   'formats change only the shown number; a formula referring to A1 still computes with the full value');
 // the current choice is ticked
 await page.mouse.click(box.x+120+32,box.y+140+2*24+12,{button:'right'});
 await menus.first().getByRole('menuitem',{name:'Alignment'}).hover();
 assert.deepEqual(await menus.nth(1).getByRole('menuitem').allTextContents(),['Left','Center','Right  ✓','Default']);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[data-smart-context-menu]'));
 // inserting a column left of A moves the settings with their cells; Default/Automatic remove them
 await run(`(async()=>{const it=items[0],r=await requestSmartCall(it,'dragEdit',[it.state,'cins0',0,0,it.w,it.h]);applySmartDragResult(it,r);})()`);
 assert.deepEqual(await run('[items[0].state.formats,items[0].state.aligns]'),[{B1:'#,##0.00',B2:'0%'},{B3:'right'}]);
 await run(`(async()=>{const it=items[0];for(const id of ['nf0:B1','nf0:B2','al:default:B3'])applySmartDragResult(it,await requestSmartCall(it,'dragEdit',[it.state,id,0,0,it.w,it.h]));})()`);
 assert.deepEqual(await run('[items[0].state.formats,items[0].state.aligns]'),[undefined,undefined]);
 assert.ok(await run(`BUILTIN_LIBRARY_DEFINITIONS.some(d=>d.key==='spreadsheet'&&d.category==='Controls')`),'built into the Controls catalog');
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
 const rect=await run(`(async()=>{const it=items[0];return (await requestSmartCall(it,'handles',[it.state,it.w,it.h,{}])).find(h=>h.id==='B1').inline;})()`);
 assert.deepEqual([rect.x,rect.w],[64,120],'cell B1 is 120 px wide and starts after A');
 await run('selection=[0];editingSmartIdx=0;render()');
 await pick('Reset column width');
 await page.waitForFunction(()=>__test.run('items[0].w')===384);
 assert.equal(await run('items[0].state.weights'),undefined,'a reset sheet stores no widths');
}));

test('spreadsheet cell pointing: while typing a formula, clicking or dragging over cells inserts references',async()=>app(async({page,run})=>{
 const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
 const cells={A1:'1',A2:'2',A3:'3',B1:'10'};
 await run(`(async()=>{const script=${JSON.stringify(script)};
   cancelGesture();
   items=[{type:'smart',uid:'sh',x:120,y:140,w:384,h:144,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
     fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script,state:{cols:6,rows:6,cells:${JSON.stringify(cells)}},componentApi:2,componentName:'Spreadsheet',
     bindings:{},inputValues:{}}];
   setTool('select');selection=[0];editingSmartIdx=0;render();await ensureEditorComponentGraph();})()`);
 const box=await page.locator('#canvas').boundingBox();
 const at=(c,r)=>({x:box.x+120+c*64+32,y:box.y+140+r*24+12});
 const input=page.locator('[data-smart-inline-input] #smartTextValue');
 // drag over A1..A3 after "=SUM("
 let q=at(3,0);await page.mouse.click(q.x,q.y);await input.waitFor();
 await page.keyboard.type('=SUM(');
 const a1=at(0,0),a3=at(0,2);
 await page.mouse.move(a1.x,a1.y);await page.mouse.down();await page.mouse.move(a3.x,a3.y,{steps:5});await page.mouse.up();
 assert.equal(await input.inputValue(),'=SUM(A1:A3','dragging inserts a range');
 assert.equal(await input.count(),1,'the field stays open');
 const frame=await page.evaluate(()=>{const el=[...document.querySelectorAll('div')].find(d=>d.style.borderStyle==='dashed');const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];});
 const cellsBox=[box.x+120,box.y+140,64,72];   // A1:A3
 frame.forEach((v,i)=>assert.ok(Math.abs(v-(cellsBox[i]+(i<2?-1:2)))<=.5,'the dashed frame reaches 1 px past every side of A1:A3: '+frame));
 await page.keyboard.type(')');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.D1')==='=SUM(A1:A3)');
 await input.waitFor({state:'detached'});
 // a second click right after replaces the reference; after an operator pointing works again
 q=at(3,1);await page.mouse.click(q.x,q.y);await input.waitFor();
 await page.keyboard.type('=');
 let c=at(1,0);await page.mouse.click(c.x,c.y);c=at(0,1);await page.mouse.click(c.x,c.y);
 assert.equal(await input.inputValue(),'=A2','pointing again replaces the reference just inserted');
 await page.keyboard.type('*');c=at(1,0);await page.mouse.click(c.x,c.y);
 assert.equal(await input.inputValue(),'=A2*B1','after an operator a click inserts again');
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.D2')==='=A2*B1');
 await input.waitFor({state:'detached'});
 // argument by argument: after pointing the first, selecting the next placeholder points into that one
 q=at(3,3);await page.mouse.click(q.x,q.y);await input.waitFor();
 const pick=word=>input.evaluate((el,w)=>{const i=el.value.indexOf(w);el.setSelectionRange(i,i+w.length);},word);
 await page.keyboard.type('=ROUND(value,digits)');await pick('value');
 c=at(0,0);await page.mouse.click(c.x,c.y);
 assert.equal(await input.inputValue(),'=ROUND(A1,digits)');
 await input.evaluate(el=>el.setSelectionRange(el.value.indexOf('digits'),el.value.indexOf('digits')+6));
 c=at(1,0);await page.mouse.click(c.x,c.y);
 assert.equal(await input.inputValue(),'=ROUND(A1,B1)','the selected placeholder is replaced, not the first argument');
 await input.evaluate(el=>{const i=el.value.indexOf('A1');el.setSelectionRange(i,i+2);});
 c=at(0,2);await page.mouse.click(c.x,c.y);
 assert.equal(await input.inputValue(),'=ROUND(A3,B1)','selecting an earlier argument and pointing replaces it');
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>__test.run('items[0].state.cells.D4')==='=ROUND(A3,B1)');
 await input.waitFor({state:'detached'});
 // plain text: a click on another cell ends editing as before
 q=at(3,2);await page.mouse.click(q.x,q.y);await input.waitFor();
 await page.keyboard.type('label');c=at(4,0);await page.mouse.click(c.x,c.y);
 await page.waitForFunction(()=>__test.run('items[0].state.cells.D3')==='label');
 await page.waitForFunction(()=>document.querySelector('[data-smart-inline-input] #smartTextValue')?.getAttribute('aria-label')==='Cell E1');
 assert.equal(await page.locator('[data-smart-inline-input] #smartTextValue').getAttribute('aria-label'),'Cell E1','the click went on to edit the clicked cell');
 await page.keyboard.press('Escape');
}));

test('holding existing controls without a context menu still activates them on touch and pen release',async()=>app(async({page,run})=>{
 for(const pointerType of ['touch','pen']){
   await seed(run,[{key:'toggle'}]);
   const point=await editorPoint(page,run,0,'toggle');
   const dispatch=type=>page.evaluate(({type,point,pointerType})=>document.getElementById('canvas').dispatchEvent(new PointerEvent(type,{
     bubbles:true,cancelable:true,pointerId:19,pointerType,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:point.x,clientY:point.y
   })),{type,point,pointerType});
   await dispatch('pointerdown');await page.waitForTimeout(700);
   assert.equal(await page.locator('[data-smart-context-menu]').count(),0);
   await dispatch('pointerup');await run('smartHitSettled');
   await page.waitForFunction(()=>__test.run('items[0].state.value')===true);
   assert.equal((await outputs(run,0)).value,true,pointerType+' release is not swallowed');
 }
}));

test('inline cell edits avoid no-op history, isolate native paste, and discard stale drafts on undo',async()=>app(async({page,run})=>{
 await seed(run,[{key:'spreadsheet',state:{cols:4,rows:4,cells:{A1:'5'}}}]);
 const open=async id=>{const point=await editorPoint(page,run,0,id);await page.mouse.click(point.x,point.y);await page.locator('[data-smart-inline-input] #smartTextValue').waitFor();};
 const field=page.locator('[data-smart-inline-input]'),input=field.locator('input');
 const before=await run('undoStack.length');
 await open('A1');assert.equal(await field.getAttribute('data-mode'),'edit');
 await input.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');
 assert.equal(await run('undoStack.length'),before,'unchanged cell does not add history');
 await open('A1');await run('clipboard=[clone(items[0])];clipboardAssets={};clipboardDatasets={};');
 const paste=await input.evaluate(element=>{
   const data=new DataTransfer();data.setData('text/plain','=1+2');
   const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});
   element.dispatchEvent(event);return event.defaultPrevented;
 });
 assert.equal(paste,false,'native field paste is not prevented by the canvas paste handler');
 assert.equal(await run('items.length'),1,'internal canvas clipboard does not paste a component into the drawing');
 await input.fill('6');await input.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');
 assert.equal(await run('items[0].state.cells.A1'),'6');
 await open('A1');await input.fill('stale');await run('undo()');await field.waitFor({state:'detached'});
 assert.equal(await run('items[0].state.cells.A1'),'5','undo cancels the draft and restores the committed cell');
}));

test('right-clicking another cell commits an inline draft and opens its context menu in one gesture',async()=>app(async({page,run})=>{
 await seed(run,[{key:'spreadsheet',state:{cols:4,rows:4,cells:{A1:'10'}}}]);
 const a=await editorPoint(page,run,0,'A1'),b=await editorPoint(page,run,0,'B1');
 await page.mouse.click(a.x,a.y);const field=page.locator('[data-smart-inline-input]');await field.waitFor();
 await field.locator('input').fill('20');await page.mouse.click(b.x,b.y,{button:'right'});
 const menus=page.locator('[data-smart-context-menu]');await menus.first().waitFor();
 await field.waitFor({state:'detached'});assert.equal(await run('items[0].state.cells.A1'),'20');
 await menus.first().getByRole('menuitem',{name:'Alignment',exact:true}).hover();
 await menus.nth(1).getByRole('menuitem',{name:'Center',exact:true}).click();
 await page.waitForFunction(()=>__test.run('items[0].state.aligns?.B1')==='center');
 assert.equal(await run('items[0].state.aligns?.A1'),undefined,'the menu belongs to the clicked cell');
}));

test('numeric inline edit mode validates, saves on Enter or outside click, and cancels in editor and offline HTML',async()=>app(async({page,run,context})=>{
 const script=`({apiVersion:2,initState(){return {value:2};},inputs(){return {};},outputs(){return {value:{type:'number'}};},compute(inputs,s){return {value:s.value};},
 children(s,st,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#fff',strokeOn:true},{type:'text',x:0,y:0,w,h,text:String(s.value),fontSize:20,fill:false,strokeOn:false}];},
 handles(s,w,h){return [{id:'value',kind:'number',x:w/2,y:h/2,value:s.value,min:0,max:10,step:1,label:'Edit value',inline:{x:0,y:0,w,h,fontSize:20,mode:'edit'}}];},
 hitEdit(s,x,y,w,h){return x>=0&&y>=0&&x<=w&&y<=h?'value':null;},dragEdit(s,id,value){return {state:{...s,value}};}})`;
 await seed(run,[{key:'numberInput',script,state:{value:2},w:180,h:50}]);
 const point=await editorPoint(page,run,0,'value');
 const {preview,errors,requests}=await openExport(page,run,context);
 for(const target of [page,preview]){
   target.setDefaultTimeout(10000);
   const open=async()=>{if(target===page){await run('smartHitSettled');const at=await editorPoint(page,run,0,'value');await page.mouse.click(at.x,at.y);}else await readerClick(preview,0,point.handle);await target.locator('[data-smart-inline-input]').waitFor();};
   const field=target.locator('[data-smart-inline-input]'),input=field.locator('input');
   await open();assert.equal(await input.getAttribute('aria-label'),'Edit value');await input.fill('11');await input.press('Enter');
   assert.equal(await field.isVisible(),true,'invalid value remains editable');
   await input.fill('3');await input.press('Enter');await field.waitFor({state:'detached'});
   await open();assert.equal(await input.inputValue(),'3');await input.fill('4');
   await target.mouse.click(20,900);await field.waitFor({state:'detached'});
   await open();assert.equal(await input.inputValue(),'4','outside click commits');
   await input.fill('9');await input.press('Escape');await field.waitFor({state:'detached'});
   await open();assert.equal(await input.inputValue(),'4','Escape discards');await input.press('Escape');
 }
 assert.deepEqual(await outputs(run,0),{value:4});assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('smart drag results persist and undo a size-only click and a continuous resize',async()=>app(async({page,run})=>{
 const script=`({apiVersion:2,initState(){return {};},inputs(){return {};},outputs(){return {};},compute(){return {};},
 children(s,st,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#fff',strokeOn:true}];},
 handles(s,w,h){return [{id:'grow',kind:'click',x:20,y:20},{id:'resize',kind:'drag',x:w-15,y:h/2}];},
 hitEdit(s,x,y,w,h){return x<40?'grow':'resize';},dragEdit(s,id,x,y,w,h){return {state:s,size:{w:id==='grow'?w+40:Math.max(60,x+15),h}};}})`;
 await seed(run,[{key:'numberInput',script,state:{},w:180,h:80}]);
 const before=await run('undoStack.length');await editorHandle(page,run,0,'grow');
 await page.waitForFunction(()=>__test.run('items[0].w')===220);
 assert.equal(await run('undoStack.length'),before+1,'size-only click is recorded');
 await run('undo()');assert.equal(await run('items[0].w'),180);await run('redo()');assert.equal(await run('items[0].w'),220);
 const point=await editorPoint(page,run,0,'resize');await page.mouse.move(point.x,point.y);await page.mouse.down();
 await page.mouse.move(point.x+70,point.y,{steps:5});
 await page.waitForFunction(()=>__test.run('items[0].w')>250);
 await page.mouse.up();await run('smartHitSettled');
 assert.equal(await run('Math.round(items[0].w)'),290,'continuous drag applies the size before release');
 await run('undo()');assert.equal(await run('items[0].w'),220,'one undo restores the complete pre-drag geometry');
}));

test('script-driven resizing in offline HTML preserves the origin of rotated components',async()=>app(async({page,run,context})=>{
 const script=`({apiVersion:2,inputs:{},outputs:{},compute(){return {};},
 children(s,st,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#ffffff',strokeOn:true}];},
 handles(){return [{id:'grow',kind:'click',x:20,y:20}];},hitEdit(s,x,y){return Math.hypot(x-20,y-20)<16?'grow':null;},
 dragEdit(s,id,x,y,w,h){return {state:s,size:{w:w+40,h}};}})`;
 await seed(run,[{key:'numberInput',script,state:{},w:180,h:80,rotation:Math.PI/4},
   {key:'numberInput',script,state:{},w:180,h:80,rotation:-Math.PI/2}]);
 const {preview,errors,requests}=await openExport(page,run,context);
 for(const index of [0,1]){
   const host=preview.locator('[data-smart-index="'+index+'"]');
   await preview.waitForFunction(index=>document.querySelector('[data-smart-index="'+index+'"]')?.dataset.smartReady==='true',index);
   const corner=()=>host.evaluate(el=>{const p=new DOMPoint(0,0).matrixTransform(el.firstElementChild.getScreenCTM());return [p.x,p.y];});
   const before=await corner();await readerClick(preview,index,{x:20,y:20});
   await preview.waitForFunction(index=>Number(document.querySelector('[data-smart-index="'+index+'"] rect')?.getAttribute('width'))===220,index);
   const after=await corner();for(let axis=0;axis<2;axis++)assert.ok(Math.abs(after[axis]-before[axis])<.01,'the exported rotation preserves the component origin');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('an edit-mode cell field grows to the right with long text and shrinks back to its cell',async()=>app(async({page,run})=>{
 await run(`(async()=>{cancelGesture();items=[{...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==='spreadsheet').items[0]),uid:'sheet',x:80,y:120}];
   setTool('select');selection=[0];editingSmartIdx=0;render();await ensureEditorComponentGraph();})()`);
 const box=await page.locator('#canvas').boundingBox(),cellW=await run('items[0].w/6');
 await page.mouse.click(box.x+80+cellW*1.5,box.y+120+14);
 const form=page.locator('[data-smart-inline-input]');await form.waitFor();
 const width=()=>form.evaluate(f=>f.getBoundingClientRect().width);
 const start=await width();assert.ok(Math.abs(start-cellW)<4,'starts at the cell width: '+start+' vs '+cellW);
 await page.keyboard.type('=SUM(A1:A6)+AVERAGE(B1:B6)*ROUND(C2,2)');
 await page.waitForFunction(w=>{const f=document.querySelector('[data-smart-inline-input]'),i=f.querySelector('input');return f.getBoundingClientRect().width>w*2&&i.scrollWidth<=i.clientWidth+1;},cellW);
 const grown=await form.evaluate(f=>{const r=f.getBoundingClientRect(),i=f.querySelector('input');return {right:r.right,fits:i.scrollWidth<=i.clientWidth+1};});
 assert.ok(grown.fits,'the whole formula is visible');assert.ok(grown.right<=await page.evaluate(()=>innerWidth),'never past the window edge');
 await form.locator('input').fill('7');
 await page.waitForFunction(w=>Math.abs(document.querySelector('[data-smart-inline-input]').getBoundingClientRect().width-w)<4,cellW);
 await page.keyboard.press('Escape');
}));

test('a grown formula field still picks covered neighbouring cells and edits text in its own cell',async()=>app(async({page,run})=>{
 await seed(run,[{key:'spreadsheet',w:384,h:144,state:{cols:6,rows:6,cells:{B1:'3',C1:'4'}}}]);
 const a=await editorPoint(page,run,0,'A1'),b=await editorPoint(page,run,0,'B1'),c=await editorPoint(page,run,0,'C1');
 await page.mouse.click(a.x,a.y);
 const form=page.locator('[data-smart-inline-input]'),input=form.locator('input');await input.waitFor();
 await input.fill('=SUM(1000000,2000000,');
 await page.waitForFunction(x=>document.querySelector('[data-smart-inline-input]').getBoundingClientRect().right>x,c.x);
 assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y).tagName,b),'INPUT','the expanded input covers B1');
 await page.mouse.click(a.x,a.y);
 assert.equal(await input.evaluate(el=>el.selectionStart<el.value.length),true,'clicking the original cell positions the native text caret');
 await input.evaluate(el=>el.setSelectionRange(el.value.length,el.value.length));
 await page.mouse.move(b.x,b.y);await page.mouse.down();await page.mouse.move(c.x,c.y,{steps:3});await page.mouse.up();
 assert.equal(await input.inputValue(),'=SUM(1000000,2000000,B1:C1','dragging through the covered area inserts a range');
 await page.keyboard.type(')');
 await page.mouse.click(a.x,a.y);
 assert.equal(await input.inputValue(),'=SUM(1000000,2000000,B1:C1)','clicking the original cell leaves the text intact');
 assert.equal(await input.evaluate(el=>document.activeElement===el),true,'the original cell remains a native text editor');
 await input.press('Enter');await form.waitFor({state:'detached'});
 assert.equal(await run('items[0].state.cells.A1'),'=SUM(1000000,2000000,B1:C1)');
}));

test('long inline fields stay within the viewport when their component is rotated',async()=>app(async({page,run,context})=>{
 const script=`({apiVersion:2,inputs:{},outputs:{},compute(){return {};},
 children(s,st,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#ffffff',strokeOn:true}];},
 handles(s,w,h){return [{id:'value',kind:'text',x:w/2,y:h/2,value:s.value||'',inline:{x:0,y:0,w,h,mode:'edit'}}];},
 hitEdit(){return 'value';},dragEdit(s,id,value){return {state:{...s,value}};}})`;
 await seed(run,[Math.PI/2,-Math.PI/2,Math.PI,Math.PI/4].map((rotation,index)=>({key:'textInput',script,state:{value:''},w:100,h:24,rotation,x:400+(index%2)*400,y:260+Math.floor(index/2)*280})));
 const {preview,errors,requests}=await openExport(page,run,context);
 for(const target of [page,preview]){
   for(let index=0;index<4;index++){
     if(target===page){
       const at=await run(`(async()=>{selection=[${index}];editingSmartIdx=${index};render();const item=items[${index}],p=toWorld(item,item.x+item.w/2,item.y+item.h/2),box=canvas.getBoundingClientRect();return {x:box.x+p.x,y:box.y+p.y};})()`);
       await page.mouse.click(at.x,at.y);await run('smartHitSettled');
     }else await readerClick(preview,index,{x:50,y:12});
     const form=target.locator('[data-smart-inline-input]'),input=form.locator('input');await input.waitFor();
     await input.fill('A long value '.repeat(50));
     await target.waitForFunction(()=>parseFloat(document.querySelector('[data-smart-inline-input]').style.width)>100);
     const bounds=await form.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};});
     assert.ok(bounds.left>=7&&bounds.top>=7&&bounds.right<=bounds.width-7&&bounds.bottom<=bounds.height-7,JSON.stringify(bounds));
     await input.press('Escape');await form.waitFor({state:'detached'});
   }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('table layout problems reach the editor as their own message, not as an invalid script',async()=>app(async({run})=>{
 const error=(cells,bind=true)=>run(`(async()=>{cancelGesture();datasets=normalizeDatasets({boats:{name:'Boats',columns:[{key:'name',name:'Name',type:'string'}],rows:[['Aurora'],['Borealis']]}});
   items=[{...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==='spreadsheet').items[0]),uid:'s',x:80,y:120,state:{cols:6,rows:6,cells:${JSON.stringify(cells)}},inputValues:${bind?"{data:{datasetId:'boats'}}":'{}'}}];
   render();const g=await ensureEditorComponentGraph();return g.get(items[0]).error||'';})()`);
 assert.equal(await error({E1:'=INPUT("data",A1:A3)'}),'');
 assert.match(await error({E1:'=INPUT("data",A1:A3)',A2:'5'}),/A2 lies in the table range/);
 assert.match(await error({A2:'=INPUT("data",A1:A3)'}),/must lie outside table ranges/);
 assert.match(await error({A1:'Hall',A2:'1',A3:'x',C1:'=OUTPUT(A1:A3,"t")'},false),/column Hall mixes types/);
}));

test('a double-click on empty canvas leaves the wiring mode; on an object it stays',async()=>app(async({page,run})=>{
 await run(`(async()=>{cancelGesture();items=[{...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==='numberControl').items[0]),uid:'n',x:200,y:200}];
   setTool('select');selection=[];render();await ensureEditorComponentGraph();setComponentWiringMode(true);})()`);
 assert.equal(await run('componentWiring.enabled'),true);
 const box=await page.locator('#canvas').boundingBox(),it=await run('items[0]');
 await page.mouse.dblclick(box.x+it.x+it.w/2,box.y+it.y+it.h/2);await run('smartHitSettled');
 assert.equal(await run('componentWiring.enabled'),true,'a double-click on an object keeps wiring');
 await page.mouse.dblclick(box.x+700,box.y+600);
 await page.waitForFunction(()=>__test.run('componentWiring.enabled')===false);
}));
