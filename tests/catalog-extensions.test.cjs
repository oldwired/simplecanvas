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
