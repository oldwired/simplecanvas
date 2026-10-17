const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

// Instrument the served editor only. Exported HTML and all component Workers
// retain their production runtime, timers, and input handling.
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
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://stopwatch.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://stopwatch.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function seed(run,connected=false){
  await run(`(()=>{
    const make=(key,uid,name,x,y)=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key===key).items[0]),uid,componentName:name,x,y});
    items=[make('toggle','run-switch','Run signal',80,100),make('trigger','reset-pulse','Reset signal',80,320),
      make('stopwatch','measured','Lap time',440,140),make('valueLabel','result','Last paused result',820,160),
      make('stopwatch','independent','Independent timer',440,460)];
    if(${connected}){
      items[2].bindings={run:{uid:'run-switch',port:'value'},reset:{uid:'reset-pulse',port:'value'}};
      items[3].bindings={value:{uid:'measured',port:'elapsed'}};
    }
    setTool('select');selection=[];render();save();
  })()`);
}
async function editInputs(page,run,index,edit){
  await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();await edit();
  await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
}
async function editorHandle(page,run,index,id,{allowInactive=false}={}){
  const target=await run(`(async()=>{
    selection=[${index}];editingSmartIdx=${index};render();const item=items[${index}];
    const handle=(await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)])).find(handle=>handle.id===${JSON.stringify(id)});
    return {item,handle};
  })()`);
  assert.ok(allowInactive || target.handle,'interactive '+id+' handle exists');
  const handle=target.handle||{x:target.item.w/4,y:target.item.h*.86},box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+target.item.x+handle.x,box.y+target.item.y+handle.y);await run('smartHitSettled');
}
const result=run=>run('(async()=> (await resolveSmartComponentIo(items[3])).outputs.value)()');
async function reading(page,uid='measured',different=null){
  const value=await page.waitForFunction(({uid,different})=>{
    const text=__test.run(`smartChildrenCache.get(${JSON.stringify(uid)})?.kids.find(child=>/^\\d{2,}:\\d{2}:\\d{2}\\.\\d{3}$/.test(child.text))?.text`);
    return text && text!==different?text:false;
  },{uid,different},{timeout:5000});return value.jsonValue();
}
function formatMilliseconds(value){
  const pad=(n,width=2)=>String(n).padStart(width,'0');
  return pad(Math.floor(value/3600000))+':'+pad(Math.floor(value/60000)%60)+':'+pad(Math.floor(value/1000)%60)+'.'+pad(value%1000,3);
}

test('Stopwatch publishes paused milliseconds through connected run/reset inputs while manual controls and instances stay independent',async()=>app(async({page,run})=>{
  await seed(run);
  await editInputs(page,run,2,async()=>{
    await page.getByLabel('run (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'run-switch',port:'value'}));
    await page.getByLabel('reset (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'reset-pulse',port:'value'}));
  });
  await editInputs(page,run,3,()=>page.getByLabel('value (number)',{exact:true}).selectOption(JSON.stringify({uid:'measured',port:'elapsed'})));
  await editorHandle(page,run,4,'toggle');const independentStart=await run('items[4].state.startedAt');
  await editorHandle(page,run,0,'toggle');assert.equal(typeof await run('items[2].state.startedAt'),'number');
  assert.equal(await result(run),0);
  const first=await reading(page,'measured','00:00:00.000');
  const stable=await run('JSON.stringify({state:items[2].state,storage:{...localStorage},history:undoStack.length})');
  await reading(page,'measured',first);
  assert.equal(await result(run),0,'live display updates do not publish an unfinished measurement');
  assert.equal(await run('JSON.stringify({state:items[2].state,storage:{...localStorage},history:undoStack.length})'),stable,
    'redrawing a running stopwatch does not mutate state, autosave, or add undo steps');
  await editorHandle(page,run,0,'toggle');
  const paused=await run('items[2].state.elapsedMs');assert.ok(Number.isInteger(paused) && paused>0);
  assert.equal(await result(run),paused/1000,'numeric seconds retain the full millisecond measurement');
  await page.waitForFunction(expected=>__test.run("smartChildrenCache.get('measured')?.kids.some(child=>child.text==="+JSON.stringify(expected)+")"),formatMilliseconds(paused));
  await editorHandle(page,run,0,'toggle');await reading(page,'measured',formatMilliseconds(paused));
  assert.equal(await result(run),paused/1000,'resuming keeps the previously published result');
  await editorHandle(page,run,1,'trigger');
  await page.waitForFunction(()=>__test.run('items[1].state.value===false && items[2].state.startedAt===null && items[2].state.elapsedMs===0'));
  assert.equal(await result(run),0);assert.equal(await run('items[0].state.value'),true);
  assert.equal(await run('items[2].state.observedRun'),true,'reset consumes the held run level');
  await editorHandle(page,run,0,'toggle');await editorHandle(page,run,0,'toggle');
  assert.equal(typeof await run('items[2].state.startedAt'),'number');
  await editorHandle(page,run,2,'toggle');assert.equal(await run('items[2].state.startedAt'),null);
  await run('render();ensureEditorComponentGraph()');assert.equal(await run('items[2].state.startedAt'),null,'manual pause survives the unchanged true run signal');
  assert.equal(await run('items[4].state.startedAt'),independentStart,'resetting and pausing another stopwatch leaves this instance running');
  assert.equal(await run('items[4].state.elapsedMs'),0);
}));

async function openExport(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-stopwatch-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'stopwatch.html');fs.copyFileSync(await(await download).path(),file);
  const preview=await context.newPage(),errors=[],requests=[];
  preview.on('pageerror',error=>errors.push(error.message));
  preview.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await preview.goto(pathToFileURL(file).href);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===5);
  return {preview,errors,requests};
}
async function readerClick(page,index,x,y){
  const at=await page.locator('[data-smart-index="'+index+'"]').evaluate((host,p)=>{
    const point=new DOMPoint(p.x,p.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};
  },{x,y});await page.mouse.click(at.x,at.y);
}
async function readerReading(page,index,previous=null){
  const reading=await page.waitForFunction(({index,previous})=>{
    const value=[...document.querySelector('[data-smart-index="'+index+'"]').querySelectorAll('text')]
      .map(node=>node.textContent).find(text=>/^\d{2,}:\d{2}:\d{2}\.\d{3}$/.test(text));
    return value && value!==previous?value:false;
  },{index,previous},{timeout:5000});return reading.jsonValue();
}
async function readerResult(page){
  return page.locator('[data-smart-index="3"] text').allTextContents();
}

test('Stopwatch keeps manual overrides and running timestamps across hidden time, reload, held reset, and offline HTML',async()=>app(async({page,run,context})=>{
  await seed(run,true);
  await editorHandle(page,run,0,'toggle');await reading(page,'measured','00:00:00.000');
  await editorHandle(page,run,2,'toggle');const paused=await run('items[2].state.elapsedMs');
  await editorHandle(page,run,4,'toggle');
  const startedAt=await run('save();items[4].state.startedAt');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(250);
  await page.reload();await run('appStarted');
  assert.deepEqual(await run('items[2].state'),{elapsedMs:paused,startedAt:null,observedRun:true},'a manual pause overrides the saved true run signal after reload');
  assert.equal(await run('items[4].state.startedAt'),startedAt,'manual Start with the default false run input survives reload');
  await editorHandle(page,run,4,'toggle');
  assert.ok(await run('items[4].state.elapsedMs')>=250,'the measurement includes time spent hidden');
  assert.equal(await result(run),paused/1000);

  await editInputs(page,run,4,async()=>{
    await page.getByLabel('run value',{exact:true}).selectOption('true');
    await page.getByLabel('reset value',{exact:true}).selectOption('true');
  });
  await editorHandle(page,run,4,'toggle',{allowInactive:true});
  assert.deepEqual(await run('items[4].state'),{elapsedMs:0,startedAt:null,observedRun:true},'held reset wins over literal run and manual Start');
  await editInputs(page,run,4,()=>page.getByLabel('reset value',{exact:true}).selectOption('false'));
  assert.equal(await run('items[4].state.startedAt'),null,'releasing reset while run stays true does not start again');

  const shapes=await run('items.map(item=>({w:item.w,h:item.h}))');
  const {preview,errors,requests}=await openExport(page,run,context);
  const stopwatch=shapes[2],runSwitch=shapes[0],reset=shapes[1];
  assert.equal(await readerReading(preview,2),formatMilliseconds(paused));
  const before=await readerResult(preview);
  await readerClick(preview,2,stopwatch.w/4,stopwatch.h*.86);
  await readerReading(preview,2,formatMilliseconds(paused));
  assert.deepEqual(await readerResult(preview),before,'HTML also holds its paused output during a new measurement');
  await readerClick(preview,2,stopwatch.w/4,stopwatch.h*.86);
  await preview.waitForFunction(before=>JSON.stringify([...document.querySelector('[data-smart-index="3"]').querySelectorAll('text')].map(node=>node.textContent))!==JSON.stringify(before),before);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="2"]').textContent.includes('Stopped'));
  const stopped=await readerReading(preview,2);await preview.waitForTimeout(150);assert.equal(await readerReading(preview,2),stopped);
  await readerClick(preview,1,reset.w*.38,reset.h*.49);
  await preview.waitForFunction(()=>[...document.querySelector('[data-smart-index="2"]').querySelectorAll('text')].some(node=>node.textContent==='00:00:00.000'));
  await preview.waitForFunction(()=>/Output:\s*false/.test(document.querySelector('[data-smart-index="1"]').textContent));
  await preview.waitForTimeout(150);assert.equal(await readerReading(preview,2),'00:00:00.000','reset release leaves the stopwatch stopped');
  await readerClick(preview,0,runSwitch.w*.5,runSwitch.h*.69);
  await readerClick(preview,0,runSwitch.w*.5,runSwitch.h*.69);
  await readerReading(preview,2,'00:00:00.000');
  await readerClick(preview,0,runSwitch.w*.5,runSwitch.h*.69);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="2"]').textContent.includes('Start'));
  assert.equal(await preview.locator('[data-component-error]').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'downloaded stopwatch controls and signals need no HTTP requests');
}));
