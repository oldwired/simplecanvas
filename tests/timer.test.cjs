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
    await page.route('http://timer.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://timer.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
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
  const handle=target.handle||{x:target.item.w/4,y:target.item.h-31*Math.min(target.item.w/234,target.item.h/350)},box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+target.item.x+handle.x,box.y+target.item.y+handle.y);await run('smartHitSettled');
  return handle;
}
async function openExport(page,run,context,count){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-timer-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'timer.html');fs.copyFileSync(await(await download).path(),file);
  const preview=await context.newPage(),errors=[],requests=[];
  preview.on('pageerror',error=>errors.push(error.message));
  preview.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await preview.goto(pathToFileURL(file).href);
  await preview.waitForFunction(count=>document.querySelectorAll('[data-smart-ready="true"]').length===count,count);
  return {preview,errors,requests};
}
async function readerClick(page,index,point){
  const at=await page.locator('[data-smart-index="'+index+'"]').evaluate((host,p)=>{
    const point=new DOMPoint(p.x,p.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};
  },point);await page.mouse.click(at.x,at.y);
}
async function seed(run,connected=false){
  await run(`(async()=>{
    const make=(key,uid,name,x,y)=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key===key).items[0]),uid,componentName:name,x,y});
    items=[make('toggle','run-switch','Run signal',60,100),make('trigger','reset-pulse','Reset signal',60,320),
      make('timer','countdown','Launch countdown',420,80),make('counter','ticks','Elapsed units',800,100),
      make('statusIndicator','done','Countdown complete',800,350),make('timer','independent','Independent timer',420,510),
      make('counter','independent-ticks','Independent ticks',800,570)];
    items[3].inputValues={value:false};items[4].inputValues={value:false};
    items[6].bindings={value:{uid:'independent',port:'tick'}};
    if(${connected}){
      items[2].state={...items[2].state,unit:'seconds',duration:2};
      items[5].state={...items[5].state,unit:'seconds',duration:1};
      items[2].bindings={run:{uid:'run-switch',port:'value'},reset:{uid:'reset-pulse',port:'value'}};
      items[3].bindings={value:{uid:'countdown',port:'tick'}};
      items[4].bindings={value:{uid:'countdown',port:'reached'}};
    }
    setTool('select');selection=[];await ensureEditorComponentGraph();render();save();
  })()`);
}
async function setting(page,name,value){
  const field=page.locator('#component-setting-'+name);
  if(await field.evaluate(element=>element.tagName==='SELECT'))await field.selectOption(String(value));
  else{await field.fill(String(value));await field.press('Tab');}
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsSave').disabled);
}
async function outputs(run,index=2){return run(`(async()=>(await resolveSmartComponentIo(items[${index}])).outputs)()`);}
async function editorText(page,uid,text){
  await page.waitForFunction(({uid,text})=>__test.run(`smartChildrenCache.get(${JSON.stringify(uid)})?.kids.some(child=>child.text===${JSON.stringify(text)})`),{uid,text});
}
async function readerText(page,index,text){
  await page.waitForFunction(({index,text})=>[...document.querySelector('[data-smart-index="'+index+'"]').querySelectorAll('text')].some(node=>node.textContent===text),{index,text});
}

test('Timer settings and connected controls automatically count full units, hold completion, and reset without restarting a held run signal',async()=>app(async({page,run})=>{
  await seed(run);
  await editInputs(page,run,2,async()=>{
    await setting(page,'unit','seconds');await setting(page,'duration',2);
    await page.getByLabel('run (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'run-switch',port:'value'}));
    await page.getByLabel('reset (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'reset-pulse',port:'value'}));
  });
  await editInputs(page,run,3,()=>page.getByLabel('value (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'countdown',port:'tick'})));
  await editInputs(page,run,4,()=>page.getByLabel('value (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'countdown',port:'reached'})));
  await editorText(page,'countdown','2 Seconds left');
  assert.deepEqual(await outputs(run),{tick:false,reached:false});
  await editorHandle(page,run,5,'toggle');const independentEnd=await run('items[5].state.endsAt');
  await editorHandle(page,run,0,'toggle');assert.equal(typeof await run('items[2].state.endsAt'),'number');
  await page.waitForFunction(()=>__test.run('items[3].state.count===1'));
  await editorText(page,'countdown','1 Second left');
  await page.waitForFunction(()=>__test.run('items[3].state.count===2 && items[2].state.remainingMs===0 && items[2].state.tick===false'));
  assert.deepEqual(await outputs(run),{tick:false,reached:true});
  assert.equal(await run('items[2].state.endsAt'),null);
  await editorText(page,'done','ON');await editorText(page,'countdown','0 Seconds left');
  await page.waitForTimeout(150);
  assert.equal(await run('items[3].state.count'),2,'the final full unit emits exactly one tick and held run does not repeat');
  await editorHandle(page,run,1,'trigger');
  await page.waitForFunction(()=>__test.run('!items[1].state.value && items[2].state.remainingMs===2000 && items[2].state.endsAt===null'));
  assert.deepEqual(await outputs(run),{tick:false,reached:false});
  assert.equal(await run('items[2].state.observedRun'),true,'reset consumes the held run signal');
  assert.equal(await run('items[3].state.count'),2,'reset creates no extra unit tick');
  await editorHandle(page,run,2,'toggle');assert.equal(typeof await run('items[2].state.endsAt'),'number');
  await editorHandle(page,run,2,'toggle');const paused=await run('items[2].state.remainingMs');
  await page.waitForTimeout(150);await run('ensureEditorComponentGraph()');
  assert.equal(await run('items[2].state.remainingMs'),paused);assert.equal(await run('items[2].state.endsAt'),null,'manual pause wins while run stays true');
  await editInputs(page,run,2,async()=>{await setting(page,'unit','minutes');await setting(page,'duration',3);});
  await page.waitForFunction(()=>__test.run('items[2].state.remainingMs===180000 && items[2].state.configuredUnit==="minutes" && items[2].state.configuredDuration===3'));
  assert.equal(await run('items[2].state.remainingMs'),180000);
  assert.equal(await run('items[2].state.endsAt'),null,'configuration refills and stops a timer with held run');
  await editorText(page,'countdown','3 Minutes left');
  const dial=await run(`(async()=>{
    selection=[2];editingSmartIdx=2;render();const item=items[2];
    const hand=(await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)])).find(handle=>handle.id==='hand');
    const face=smartChildrenCache.get(item.uid).kids.find(child=>child.type==='ellipse' && !child.fill);
    return {item,hand,target:{x:face.x+face.w*.85,y:face.y+face.h/2}};
  })()`);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.move(box.x+dial.item.x+dial.hand.x,box.y+dial.item.y+dial.hand.y);await page.mouse.down();
  await page.waitForFunction(()=>__test.run('smartDrag?.handle')==='hand');
  await page.mouse.move(box.x+dial.item.x+dial.target.x,box.y+dial.item.y+dial.target.y,{steps:5});await page.mouse.up();await run('smartHitSettled');
  assert.equal(await run('items[2].state.duration'),45,'dragging the original dial still sets the starting duration');
  assert.equal(await run('items[2].state.remainingMs'),2700000);assert.equal(await run('items[2].state.endsAt'),null);
  await editorText(page,'countdown','45 Minutes left');
  assert.equal(await run('items[5].state.endsAt'),independentEnd,'another instance keeps its own running deadline');
}));

test('Timer preserves manual pauses and wall deadlines across hidden time and reload, then runs and resets in offline HTML',async()=>app(async({page,run,context})=>{
  await seed(run,true);
  await editorHandle(page,run,0,'toggle');await editorHandle(page,run,2,'toggle');
  const paused=await run('items[2].state.remainingMs');
  await editorHandle(page,run,5,'toggle');
  assert.equal(typeof await run('items[5].state.endsAt'),'number');
  await run('save()');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(1300);
  await page.reload();await run('appStarted');
  await page.waitForFunction(()=>__test.run('items[5].state.remainingMs===0 && items[5].state.endsAt===null'));
  assert.equal(await run('items[2].state.remainingMs'),paused);
  assert.equal(await run('items[2].state.endsAt'),null);assert.equal(await run('items[2].state.observedRun'),true,'saved manual pause wins over unchanged true run');
  assert.deepEqual(await outputs(run,5),{tick:false,reached:true},'a wall deadline can finish while the drawing is hidden');
  assert.equal(await run('items[6].state.count'),0,'restoring an expired timer does not invent a missed tick');
  await editInputs(page,run,2,async()=>{
    await page.getByLabel('reset (boolean)',{exact:true}).selectOption('');
    await page.getByLabel('reset value',{exact:true}).selectOption('true');
  });
  await editorHandle(page,run,2,'toggle',{allowInactive:true});
  assert.equal(await run('items[2].state.remainingMs'),2000);assert.equal(await run('items[2].state.endsAt'),null,'held reset blocks manual Start');
  await editInputs(page,run,2,()=>page.getByLabel('reset (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'reset-pulse',port:'value'})));
  assert.equal(await run('items[2].state.endsAt'),null,'releasing reset alone cannot restart a held run');
  await editorHandle(page,run,3,'reset');
  const handles=await run(`(async()=>Object.fromEntries((await requestSmartCall(items[2],'handles',[items[2].state,items[2].w,items[2].h,smartResolvedStyle(items[2])])).map(handle=>[handle.id,{x:handle.x,y:handle.y}])) )()`);
  const shapes=await run('items.map(item=>({w:item.w,h:item.h}))');
  const {preview,errors,requests}=await openExport(page,run,context,7);
  await readerText(preview,2,'2 Seconds left');await readerText(preview,4,'OFF');
  await readerClick(preview,0,{x:shapes[0].w*.5,y:shapes[0].h*.69});
  await readerClick(preview,0,{x:shapes[0].w*.5,y:shapes[0].h*.69});
  await readerText(preview,2,'1 Second left');await readerText(preview,2,'0 Seconds left');await readerText(preview,4,'ON');
  await readerText(preview,3,'2');
  await preview.waitForTimeout(150);await readerText(preview,2,'0 Seconds left');
  await readerClick(preview,2,handles.reset);await readerText(preview,2,'2 Seconds left');await readerText(preview,4,'OFF');
  await readerClick(preview,2,handles.toggle);await readerText(preview,2,'Pause');
  await readerClick(preview,1,{x:shapes[1].w*.38,y:shapes[1].h*.49});
  await readerText(preview,2,'Start');
  await preview.waitForFunction(()=>/Output:\s*false/.test(document.querySelector('[data-smart-index="1"]').textContent));
  await preview.waitForTimeout(150);await readerText(preview,2,'2 Seconds left');
  assert.equal(await preview.locator('[data-component-error]').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'downloaded countdowns and connected controls need no HTTP requests');
}));
