const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>browser?.close());
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1100}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://event-wiring.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://event-wiring.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function seed(run,withSettings=false){
  await run(`cancelGesture();setComponentWiringMode(false);function builtin(key,uid,x,y,extra={}){const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]);return {...item,uid,x,y,...extra};}
    items=[builtin('textInput','text',80,120),builtin('numberInput','number',80,380),builtin('memo','memo',720,180)];
    ${withSettings?"items.push(builtin('pageSettings','settings',80,650,{state:{overrideTitle:true,overrideShowTabs:false,overrideShowWiring:true,overrideShowSimulationControls:false},inputValues:{showWiring:true,title:'Event demo'}}));":''}
    selection=[];undoStack=[];redoStack=[];historyBefore=null;render();save();`);
  await run('ensureEditorComponentGraph()');
}
const port=(page,uid,name,direction,kind='flow')=>page.locator(`#componentWiringOverlay [data-wire-port][data-uid="${uid}"][data-port="${name}"][data-direction="${direction}"][data-kind="${kind}"]`);
const edge=(page,kind,input)=>page.locator(`#componentWiringOverlay [data-wire-edge][data-target-uid="memo"][data-input="${input}"][data-kind="${kind}"]`);
async function point(locator){await locator.waitFor({state:'visible'});return locator.evaluate(el=>{const r=el.querySelector('circle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});}
async function drag(page,from,to){const a=await point(from),b=await point(to);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();}
async function wired(page,run){await run('setComponentWiringMode(true)');await port(page,'text','value','out').waitFor({state:'visible'});}
async function settled(run){await run('smartHitSettled');await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');await run('renderComponentWiring()');}


test('hybrid pins connect in either direction, reject incompatible values, and disconnect without removing the parallel trigger wire',async()=>app(async({page,run})=>{
  await seed(run);await wired(page,run);
  const valuePort=port(page,'text','value','out');assert.match(await valuePort.getAttribute('aria-label'),/Output.*Text.*value \+ events/);
  assert.equal(await valuePort.getAttribute('data-side'),'right');assert.equal(await valuePort.getAttribute('data-hybrid'),'true');
  assert.equal(await page.locator('#componentWiringOverlay [data-wire-port][data-uid="text"][data-port="value"]').count(),1);
  assert.equal(await page.locator('#componentWiringOverlay [data-wire-port][data-kind="event"][data-uid="memo"]').count(),0);
  await drag(page,valuePort,port(page,'memo','line','in'));await settled(run);
  assert.deepEqual(await run('items[2].bindings'),{line:{uid:'text',port:'value'}});
  assert.equal(await edge(page,'flow','line').getAttribute('data-events'),'true');
  assert.match(await edge(page,'flow','line').locator('text').textContent(),/⚡Aa/);
  await drag(page,port(page,'text','submitted','out'),port(page,'memo','append','in'));await settled(run);
  assert.deepEqual(await run('items[2].bindings'),{line:{uid:'text',port:'value'},append:{uid:'text',port:'submitted'}});
  assert.equal(await edge(page,'flow','append').getAttribute('data-events'),'false');
  if(process.env.ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.ARTIFACT_DIR,'hybrid-wiring-editor-'+engine+'.png')});
  const before=await run('JSON.stringify({items,undo:undoStack.length})');
  await drag(page,port(page,'number','value','out'),port(page,'memo','line','in'));await settled(run);
  assert.equal(await run('JSON.stringify({items,undo:undoStack.length})'),before,'numeric events do not bypass the value port type');
  await drag(page,port(page,'memo','content','in'),port(page,'text','value','out'));await settled(run);
  assert.deepEqual(await run('items[2].bindings.content'),{uid:'text',port:'value'});
  await edge(page,'flow','line').focus();await page.keyboard.press('Enter');await page.keyboard.press('Delete');await settled(run);
  assert.equal(await run('items[2].bindings.line'),undefined);assert.deepEqual(await run('items[2].bindings.append'),{uid:'text',port:'submitted'});
  await run('undo()');await settled(run);assert.deepEqual(await run('items[2].bindings.line'),{uid:'text',port:'value'});
  await run('redo()');await settled(run);assert.equal(await run('items[2].bindings.line'),undefined);
}));

test('Edit places event behavior on each hybrid input and preserves value-only mode through Undo and reload',async()=>app(async({page,run})=>{
  await seed(run);
  await run("items[2].bindings={line:{uid:'text',port:'value'},append:{uid:'text',port:'submitted'}};selection=[2];openComponentBindings()");
  const dialog=page.locator('#componentBindingsDialog');await dialog.waitFor({state:'visible'});
  const line=dialog.locator('[data-hybrid-input="line"]'),receive=line.getByRole('checkbox',{name:'Receive events for line',exact:true});
  await receive.waitFor();assert.equal(await receive.isChecked(),true);
  assert.equal(await dialog.locator('[data-input-role="event"]').count(),0);
  assert.equal(await line.getByRole('combobox').count(),1);
  assert.match(await line.locator('.component-port-type').textContent(),/Text.*events/);
  await receive.uncheck();
  if(process.env.ARTIFACT_DIR){await receive.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.ARTIFACT_DIR,'hybrid-wiring-inspector-'+engine+'.png')});}
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.deepEqual(await run('items[2].eventModes'),{line:'value'});assert.equal(await run('items[2].state.text'),'','inspecting and changing delivery mode never emits events');
  await wired(page,run);assert.equal(await edge(page,'flow','line').getAttribute('data-events'),'false');
  await run('undo()');await settled(run);assert.equal(await run('items[2].eventModes?.line'),undefined);assert.equal(await edge(page,'flow','line').getAttribute('data-events'),'true');
  await run('redo()');await settled(run);assert.equal(await run('items[2].eventModes.line'),'value');
  await page.reload();await run('appStarted');assert.equal(await run('items[2].eventModes.line'),'value');
  await run('selection=[0];openComponentBindings()');await dialog.waitFor({state:'visible'});await dialog.locator('[data-hybrid-output="value"]').waitFor();
  assert.equal(await dialog.locator('[data-event-output]').count(),0);assert.match(await dialog.locator('[data-hybrid-output="value"]').textContent(),/⚡.*value/);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
}));

test('HTML reader draws one hybrid pin and distinguishes event carrying flows from value-only flows',async()=>app(async({page,run,context})=>{
  await seed(run,true);await run("items[2].bindings={line:{uid:'text',port:'value'},content:{uid:'text',port:'value'},append:{uid:'text',port:'submitted'}};items[2].eventModes={content:'value'};editorComponentEvaluation=null;render();save();ensureEditorComponentGraph()");
  const pending=page.waitForEvent('download');await run('exportHtml()');const exported=fs.readFileSync(await(await pending).path(),'utf8');
  const reader=await context.newPage(),errors=[];reader.on('pageerror',error=>errors.push(error.message));
  await reader.route('http://event-reader.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:exported}));await reader.goto('http://event-reader.test/demo.html');
  const overlay=reader.locator('[data-reader-wiring]');await overlay.waitFor();
  const link=overlay.locator('[data-wire-edge][data-kind="flow"][data-input="line"]');await link.waitFor();
  assert.equal(await link.getAttribute('data-events'),'true');assert.equal(await link.getAttribute('data-type'),'string');assert.match(await link.locator('text').textContent(),/⚡Aa/);
  assert.equal(await overlay.locator('[data-wire-edge][data-input="content"]').getAttribute('data-events'),'false');
  assert.equal(await overlay.locator('[data-wire-edge][data-input="append"]').getAttribute('data-events'),'false');
  const input=overlay.locator('[data-wire-port][data-uid="memo"][data-port="line"]');
  assert.equal(await input.count(),1);assert.match(await input.getAttribute('aria-label'),/Input.*Text.*value \+ events/);assert.equal(await input.getAttribute('data-side'),'left');
  assert.equal(await overlay.evaluate(el=>getComputedStyle(el).pointerEvents),'none');assert.deepEqual(errors,[]);
  if(process.env.ARTIFACT_DIR)await reader.screenshot({path:path.join(process.env.ARTIFACT_DIR,'hybrid-wiring-reader-'+engine+'.png')});
}));

test('event-only custom commands connect to the same hybrid control pin and remain editable',async()=>app(async({page,run})=>{
  await seed(run);
  await run(`items.push({type:'smart',componentApi:2,uid:'command',componentName:'Command',x:400,y:650,w:160,h:80,state:{},script: "({apiVersion:2,eventApi:1,inputs:{},outputs:{},eventOutputs:{clicked:{type:'none'}},initState(){return {};},children(){return [];}})"});editorComponentEvaluation=null;render();ensureEditorComponentGraph()`);
  await wired(page,run);
  await drag(page,port(page,'command','clicked','out','event'),port(page,'memo','clear','in'));await settled(run);
  assert.deepEqual(await run('items[2].eventBindings'),{clear:{uid:'command',port:'clicked'}});
  assert.equal(await page.locator('#componentWiringOverlay [data-wire-port][data-uid="memo"][data-port="clear"]').count(),1);
  assert.equal(await edge(page,'event','clear').getAttribute('data-type'),'none');
  await run('setComponentWiringMode(false);selection=[2];openComponentBindings()');
  const dialog=page.locator('#componentBindingsDialog'),clear=dialog.locator('[data-hybrid-input="clear"]');await clear.waitFor();
  assert.match(await clear.getByRole('combobox').first().locator('option:checked').textContent(),/Command.*clicked.*events only/);
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.deepEqual(await run('items[2].eventBindings'),{clear:{uid:'command',port:'clicked'}});
  assert.equal(await run('Object.hasOwn(items[2].eventBindings.clear,"event")'),false);
  assert.equal(await run('items[2].bindings.clear'),undefined);
}));

async function editorEntry(page,run){
  await run('selection=[0];editingSmartIdx=0;render()');
  const point=await run(`(async()=>{const item=items[0],io=await resolveSmartComponentIo(item),handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]),handle=handles.find(handle=>handle.id==='entry');return toWorld(item,item.x+handle.x,item.y+handle.y);})()`);
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+point.x,box.y+point.y);
  const field=page.locator('[data-smart-inline-input]');await field.waitFor();return {field,input:field.locator('#smartTextValue')};
}

test('committed events flash and expose payload counts while value-only links stay quiet; Undo and reload clear activity',async()=>app(async({page,run})=>{
  await seed(run);await run("items[2].bindings={line:{uid:'text',port:'value'},content:{uid:'text',port:'value'}};items[2].eventModes={content:'value'};editorComponentEvaluation=null;render();ensureEditorComponentGraph()");await wired(page,run);
  const line=edge(page,'flow','line'),content=edge(page,'flow','content'),output=port(page,'text','value','out'),input=port(page,'memo','line','in');
  assert.equal(await content.getAttribute('data-event-mode'),'off');assert.match(await content.locator('text').textContent(),/⊘⚡/);assert.match(await port(page,'memo','content','in').getAttribute('aria-label'),/Receive events off/);
  const text='<img src=x onerror=alert(1)>',entry=await editorEntry(page,run);await entry.input.fill(text);await entry.input.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#componentWiringOverlay [data-wire-edge][data-input="line"]')?.dataset.eventCount==='1');
  assert.equal(await line.getAttribute('data-event-active'),'true');assert.equal(await output.getAttribute('data-event-count'),'1');assert.equal(await input.getAttribute('data-event-count'),'1');assert.equal(await content.getAttribute('data-event-count'),'0');
  await run('smartHitSettled');await entry.input.press('Enter');await run('smartHitSettled');await page.waitForFunction(()=>document.querySelector('#componentWiringOverlay [data-wire-edge][data-input="line"]')?.dataset.eventCount==='2');
  await entry.input.press('Escape');await line.focus();await page.keyboard.press('Enter');
  assert.match(await page.locator('#componentWireStatus').textContent(),/Events: 2 · Last payload: "<img src=x onerror=alert\(1\)>"/);
  assert.equal(await page.locator('#componentWireStatus img').count(),0,'event payload is displayed as text, never markup');
  await page.waitForFunction(()=>document.querySelector('#componentWiringOverlay [data-wire-edge][data-input="line"]')?.dataset.eventActive==='false');
  assert.equal(await line.getAttribute('data-event-count'),'2','expiry keeps inspection history');
  if(process.env.ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.ARTIFACT_DIR,'event-activity-editor-'+engine+'.png')});
  await run('undo()');await settled(run);assert.equal(await line.getAttribute('data-event-count'),'0');
  await page.reload();await run('appStarted');await wired(page,run);assert.equal(await line.getAttribute('data-event-count'),'0');
}));

test('exported wiring inspects actual submissions, keeps values-only inputs quiet, and starts with no recorded activity',async()=>app(async({page,run,context})=>{
  await seed(run,true);await run("items[2].bindings={line:{uid:'text',port:'value'},content:{uid:'text',port:'value'}};items[2].eventModes={content:'value'};editorComponentEvaluation=null;render();save();ensureEditorComponentGraph()");
  const handle=await run(`(async()=>{const item=items[0],io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='entry');})()`);
  const download=page.waitForEvent('download');await run('exportHtml()');const exported=fs.readFileSync(await(await download).path(),'utf8');
  const reader=await context.newPage(),errors=[];reader.on('pageerror',error=>errors.push(error.message));
  await reader.route('http://activity-reader.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:exported}));await reader.goto('http://activity-reader.test/demo.html');
  const overlay=reader.locator('[data-reader-wiring]'),line=overlay.locator('[data-wire-edge][data-input="line"]');await line.waitFor();assert.equal(await line.getAttribute('data-event-count'),'0');
  const host=reader.locator('[data-smart-index="0"]');await reader.waitForFunction(host=>host.dataset.smartReady==='true',await host.elementHandle());
  const point=await host.evaluate((host,handle)=>{const p=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},handle);
  await reader.mouse.click(point.x,point.y);const entry=reader.locator('[data-smart-inline-input] #smartTextValue');await entry.fill('Reader event');await entry.press('Enter');
  await reader.waitForFunction(()=>document.querySelector('[data-reader-wiring] [data-wire-edge][data-input="line"]')?.dataset.eventCount==='1');assert.equal(await line.getAttribute('data-event-active'),'true');await entry.press('Escape');
  await line.focus();await reader.keyboard.press('Enter');const status=reader.locator('[data-reader-event-status]');assert.match(await status.textContent(),/Events: 1 · Last payload: "Reader event"/);
  const off=overlay.locator('[data-wire-edge][data-input="content"]');assert.equal(await off.getAttribute('data-event-count'),'0');await off.focus();await reader.keyboard.press('Enter');assert.match(await status.textContent(),/Values only · Receive events off/);
  await status.getByRole('button',{name:'Close event inspection'}).click();assert.equal(await status.count(),0);
  if(process.env.ARTIFACT_DIR)await reader.screenshot({path:path.join(process.env.ARTIFACT_DIR,'event-activity-reader-'+engine+'.png')});
  assert.deepEqual(errors,[]);await reader.reload();await line.waitFor();assert.equal(await line.getAttribute('data-event-count'),'0');
}));

test('failed delivery leaves source, wire and receiving-port activity untouched',async()=>app(async({page,run})=>{
  await seed(run);await run(`items[2].script="({apiVersion:2,eventApi:1,inputs:{line:{type:'string',event:true}},outputs:{},initState(){return {};},onEvent(){throw new Error('Reject this occurrence');},children(){return [];}})";items[2].state={};items[2].bindings={line:{uid:'text',port:'value'}};editorComponentEvaluation=null;render();ensureEditorComponentGraph()`);await wired(page,run);
  const entry=await editorEntry(page,run);await entry.input.fill('Rejected');await entry.input.press('Enter');await run('smartHitSettled');
  assert.match(await entry.field.textContent(),/Reject this occurrence/);assert.equal(await entry.field.getAttribute('data-submissions'),'0');
  for(const locator of [port(page,'text','value','out'),port(page,'memo','line','in'),edge(page,'flow','line')]){
    assert.equal(await locator.getAttribute('data-event-count'),'0');assert.equal(await locator.getAttribute('data-event-active'),'false');
  }
  await entry.input.press('Escape');
}));
