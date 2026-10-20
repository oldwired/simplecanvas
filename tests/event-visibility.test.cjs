const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const gate=`if(message.fn==='onEvent' && subject?.uid==='memo-second' && !window.__eventGatePassed){
  window.__eventGatePassed=true;window.__eventWaiting=true;
  return new Promise(resolve=>{window.__releaseEvent=resolve;}).then(()=>requestSmartSandbox(message,subject,execution));
}`;
function instrument(html){
  html=parseApp(html).instrumentFunction('requestSmartSandbox',gate);
  return parseApp(html).inject('window.__test={run:source=>eval(source)};');
}
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1100}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://event-visibility.test/**',route=>route.fulfill({contentType:'text/html',body:route.request().url().endsWith('index.html')?instrument(source):''}));
    await page.goto('http://event-visibility.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function seed(run){
  await run(`cancelGesture();const builtin=(key,uid,x,y,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid,x,y,...extra});
    items=[builtin('textInput','entry',70,100),
      builtin('memo','memo-first',450,100,{eventBindings:{line:{uid:'entry',port:'value'}}}),
      builtin('memo','memo-second',850,100,{eventBindings:{line:{uid:'entry',port:'value'}}}),
      builtin('pulseGenerator','clock',70,500,{inputValues:{seconds:.08,width:.03,enable:true}}),
      builtin('counter','count',450,500,{bindings:{value:{uid:'clock',port:'value'}}})];
    selection=[];editingSmartIdx=null;setTool('select');render();save();ensureEditorComponentGraph();`);
}
async function setHidden(page,value){
  await page.evaluate(value=>{window.__hidden=value;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hidden});document.dispatchEvent(new Event('visibilitychange'));},value);
}
async function submitEditor(page,run){
  const p=await run(`(async()=>{selection=[0];editingSmartIdx=0;render();const it=items[0],handles=await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it)]),h=handles.find(h=>h.id==='entry');return {x:it.x+h.x,y:it.y+h.y};})()`);
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+p.x,box.y+p.y);
  const field=page.locator('[data-smart-inline-input] input');await field.fill('accepted');await field.press('Enter');
  await page.waitForFunction(()=>window.__eventWaiting===true);
}
async function readerFor(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');const body=instrument(fs.readFileSync(await(await download).path(),'utf8'));
  const reader=await context.newPage(),errors=[];reader.on('pageerror',error=>errors.push(error.message));
  await reader.route('http://event-visibility-reader.test/**',route=>route.fulfill({contentType:'text/html',body}));
  await reader.goto('http://event-visibility-reader.test/index.html');
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="0"]')?.dataset.smartReady==='true');
  const readerRun=source=>reader.evaluate(source=>__test.run(source),source);
  return {reader,run:readerRun,errors};
}
async function submitReader(page,run){
  const p=await run(`(()=>{const entry=entries[0],h=entry.handles.find(h=>h.id==='entry');const p=new DOMPoint(h.x,h.y).matrixTransform(entry.local.getScreenCTM());return {x:p.x,y:p.y};})()`);
  await page.mouse.click(p.x,p.y);const field=page.locator('[data-smart-inline-input] input');await field.fill('accepted');await field.press('Enter');
  await page.waitForFunction(()=>window.__eventWaiting===true);
}
const memoState='items.filter(it=>it.uid.startsWith("memo-")).map(it=>({text:it.state.text,count:it.state.lineCount}))';
const expected=[{text:'accepted',count:1},{text:'accepted',count:1}];

test('an accepted editor event commits atomically while hidden; clocks and new submissions stay paused',async()=>app(async({page,run})=>{
  await seed(run);await submitEditor(page,run);
  assert.deepEqual(await run(memoState),[{text:'',count:0},{text:'',count:0}],'first receiver remains staged while second waits');
  await setHidden(page,true);const at=await run('componentTimelineNow(editorTimeline)');
  await page.evaluate(()=>__releaseEvent());await run('smartGestureQueue');
  assert.deepEqual(await run(memoState),expected);assert.equal(await run('editorTimeline.active'),false);
  assert.equal(await run('componentTimelineTimer'),null);assert.equal(await run('componentTimelineNow(editorTimeline)'),at);
  assert.equal(await page.locator('[data-smart-inline-input]').count(),0);
  await setHidden(page,false);await run('ensureEditorComponentGraph()');assert.deepEqual(await run(memoState),expected);
  assert.equal(await run('editorTimeline.active'),true);
}));

test('an accepted HTML event commits while hidden and defers follow-up actions until visible',async()=>app(async({page,run,context})=>{
  await seed(run);const exported=await readerFor(page,run,context),reader=exported.reader,readerRun=exported.run;
  await submitReader(reader,readerRun);await setHidden(reader,true);const at=await readerRun('componentTimelineNow(timeline)');
  await reader.evaluate(()=>__releaseEvent());await readerRun('gestureQueue');
  assert.deepEqual(await readerRun(memoState),expected);assert.equal(await readerRun('timeline.active'),false);
  assert.equal(await readerRun('timelineTimer'),null);assert.equal(await readerRun('componentTimelineNow(timeline)'),at);
  await readerRun(`queueReaderComponentActionIntents([{item:items[0],type:'downloadTable',format:'csv',filename:'after-visibility',table:{name:'sample',columns:[{key:'n',name:'N',type:'number'}],rows:[[1]]}}])`);
  assert.equal(await reader.locator('[data-prepared-download]').count(),0);
  assert.equal(await readerRun('actionDispatcher.queue.length'),1);
  await setHidden(reader,false);await reader.locator('[data-prepared-download]').waitFor();
  assert.deepEqual(await readerRun(memoState),expected);assert.deepEqual(exported.errors,[]);
}));

for(const reason of ['pagehide','restored pagehide','ownership','delete'])test('accepted editor events still cancel atomically on '+reason,async()=>app(async({page,run})=>{
  await seed(run);await submitEditor(page,run);
  if(reason.includes('pagehide')){
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
    if(reason==='restored pagehide'){
      await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
      await page.waitForFunction(()=>__test.run('workspaceStorage.writable'));
    }
  }
  else if(reason==='ownership')await run('loseWorkspaceOwnership("test takeover")');
  else await run('items.splice(2,1);editorComponentEvaluation=null;render()');
  await page.evaluate(()=>__releaseEvent());await run('smartGestureQueue');
  const memos=await run(memoState);assert.ok(memos.every(memo=>memo.text===''&&memo.count===0));
}));

test('accepted HTML events still cancel on actual page departure',async()=>app(async({page,run,context})=>{
  await seed(run);const {reader,run:readerRun}=await readerFor(page,run,context);
  await submitReader(reader,readerRun);await reader.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await reader.evaluate(()=>__releaseEvent());await readerRun('gestureQueue');
  assert.deepEqual(await readerRun(memoState),[{text:'',count:0},{text:'',count:0}]);
}));

test('accepted editor events cancel when leaving their active-sketch execution scope',async()=>app(async({page,run})=>{
  await seed(run);
  const originalTab=await run(`rememberActiveTab();tabs.push({id:'other-sketch',name:'Other'});
    tabDocuments.set('other-sketch',makeDocument());renderTabs();activeTabId;`);
  assert.equal(await run('editorRuntimeContext().whole'),false);
  await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
  await submitEditor(page,run);
  await run("activateTab('other-sketch')");
  await page.evaluate(()=>__releaseEvent());await run('smartGestureQueue');
  assert.deepEqual(await run(`tabDocument(${JSON.stringify(originalTab)}).items.filter(it=>it.uid.startsWith('memo-')).map(it=>({text:it.state.text,count:it.state.lineCount}))`),
    [{text:'',count:0},{text:'',count:0}],'neither staged receiver commits after its execution scope closes');
}));

for(const whole of [true,false])test('accepted HTML events '+(whole?'finish across whole-workspace navigation':'cancel when leaving active-sketch execution'),async()=>app(async({page,run,context})=>{
  await seed(run);
  const originalTab=await run(`
    const settings={...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==='workspaceSettings').items[0]),uid:'settings',x:850,y:500};
    settings.state.executionMode=${JSON.stringify(whole?'whole workspace':'active sketch')};items.push(settings);
    rememberActiveTab();tabs.push({id:'other-sketch',name:'Other'});tabDocuments.set('other-sketch',makeDocument());renderTabs();save();activeTabId;`);
  const {reader,run:readerRun,errors}=await readerFor(page,run,context);
  assert.equal(await readerRun('workspaceContext.whole'),whole);
  await submitReader(reader,readerRun);
  assert.deepEqual(await readerRun(memoState),[{text:'',count:0},{text:'',count:0}],'both receivers remain staged before navigation');
  // Start the reader's navigation path while the accepted source input is still
  // waiting for its receivers; no completion or repaint is allowed to race ahead.
  await readerRun("void activate('other-sketch')");
  assert.equal(await readerRun('activeTabId'),'other-sketch');
  await reader.evaluate(()=>__releaseEvent());await readerRun('gestureQueue');
  await reader.waitForFunction(()=>__test.run('!activationPending'));
  const result=await readerRun(`documents.find(doc=>doc.id===${JSON.stringify(originalTab)}).items.filter(it=>it.uid.startsWith('memo-')).map(it=>({text:it.state.text,count:it.state.lineCount}))`);
  assert.deepEqual(result,whole?expected:[{text:'',count:0},{text:'',count:0}]);
  const sourceValues=await readerRun(`documents.find(doc=>doc.id===${JSON.stringify(originalTab)}).items.find(it=>it.uid==='entry').state.values`);
  assert.equal(sourceValues.includes('accepted'),whole,'source and receivers share the same accepted boundary');
  assert.deepEqual(errors,[]);
}));
