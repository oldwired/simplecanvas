const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{if(browser)await browser.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://feedback-controls.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://feedback-controls.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function loadCircuit(page,run){
  await run(`cancelGesture();items=['pulseGenerator','counter','counter'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid:'step-'+index,x:60+index*400,y:120,
    componentName:['Clock','Self reset','Completions'][index],
    ...(index===0?{inputValues:{seconds:60,width:.1}}:{}),
    ...(index===1?{inputValues:{direction:'down',start:1,threshold:1},bindings:{value:{uid:'step-0',port:'value'},reset:{uid:'step-1',port:'reached'}}}:{}),
    ...(index===2?{inputValues:{threshold:9},bindings:{value:{uid:'step-1',port:'reached'}}}:{})
  }));selection=[];setTool('select');render();save();`);
  await page.waitForFunction(()=>__test.run("items[1].state.count===1 && items.every(item=>smartChildrenCache.has(item.uid))"));
}

test('editor Pause and Step expose the completion/reset rounds, preserve paused time, and Resume releases scheduling',async()=>app(async({page,run})=>{
  await loadCircuit(page,run);
  assert.equal(await page.locator('#componentStepBtn').isDisabled(),true);
  await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');
  assert.equal(await page.locator('#componentPauseBtn').textContent(),'Resume');
  assert.equal(await page.locator('#componentStepBtn').isEnabled(),true);
  const paused=await run('({time:componentTimelineNow(editorTimeline),state:JSON.stringify(items.map(item=>item.state))})');
  await page.waitForTimeout(150);
  assert.deepEqual(await run('({time:componentTimelineNow(editorTimeline),state:JSON.stringify(items.map(item=>item.state))})'),paused,'paused time and states stay fixed');
  const rows=[];
  for(let round=0;round<12;round++){
    await page.locator('#componentStepBtn').click();await run('smartGestureQueue');
    const row=await run(`({count:items[1].state.count,completions:items[2].state.count,pulse:items[0].state.value,
      reached:editorComponentEvaluation.records.get(items[1]).io.outputs.reached,pending:editorTimeline.pendingTime,
      time:componentTimelineNow(editorTimeline),status:document.getElementById('componentSignalStatus').textContent})`);
    rows.push(row);if(round>0 && row.pending===null)break;
  }
  assert.ok(rows.some(row=>row.count===0 && row.reached===true),'the transient reached state is inspectable');
  assert.ok(rows.some(row=>/round/.test(row.status)));assert.match(rows.at(-1).status,/settled/);
  assert.equal(rows.at(-1).count,1);assert.equal(rows.at(-1).completions,1);
  assert.equal(new Set(rows.map(row=>row.time)).size,1,'propagation rounds share one simulation time');
  const steppedTime=rows.at(-1).time;
  await page.waitForTimeout(150);assert.equal(await run('componentTimelineNow(editorTimeline)'),steppedTime);
  await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');
  assert.equal(await page.locator('#componentPauseBtn').textContent(),'Pause');assert.equal(await page.locator('#componentStepBtn').isDisabled(),true);
  await page.waitForFunction(()=>__test.run('items[0].state.value===false && editorTimeline.active'));
  assert.deepEqual(await run('items.slice(1).map(item=>item.state.count)'),[1,1]);
  assert.match(await page.locator('#componentSignalStatus').textContent(),/running/i);
}));

test('offline HTML Pause and Step preserve intermediate feedback displays and Resume works without network',async()=>app(async({page,run,context})=>{
  await loadCircuit(page,run);
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-feedback-controls-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'feedback.html');fs.copyFileSync(await(await download).path(),file);
  const exported=fs.readFileSync(file,'utf8'),paintHook='const handles=caps.handles ? await requestSmartCall(it,',stepHook='const graph=await settleComponentTimeline(list,call,valid,owner,{step:true,datasets:dataPool});';
  assert.equal(exported.split(paintHook).length,2,'one reader drawing reply can be held for deterministic readiness testing');
  assert.equal(exported.split(stepHook).length,2,'one Step evaluation can be held before refresh starts');
  fs.writeFileSync(file,exported.replace(paintHook,`if(window.holdCounterPaint && it.uid==='step-1'){
    window.holdCounterPaint=false;
    await new Promise(resolve=>{window.releaseCounterPaint=()=>{window.releaseCounterPaint=null;resolve();};});
  }
  ${paintHook}`).replace(stepHook,`if(window.holdStepEvaluation){
    window.holdStepEvaluation=false;
    await new Promise(resolve=>{window.releaseStepEvaluation=()=>{window.releaseStepEvaluation=null;resolve();};});
  }
  ${stepHook}`));
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  const paintedRound=()=>reader.waitForFunction(()=>{
    const revision=document.querySelector('#feedbackStatus').dataset.graphRevision;
    const shapes=[...document.querySelectorAll('[data-smart-index]')];
    return shapes.length===3 && shapes.every(shape=>shape.dataset.smartReady==='true' && shape.dataset.smartGraphRevision===revision);
  });
  await paintedRound();
  assert.equal(await reader.locator('#feedbackStep').isDisabled(),true);
  await reader.locator('#feedbackPause').click();
  await reader.waitForFunction(()=>document.querySelector('#feedbackPause').textContent==='Resume');
  await paintedRound();
  const pausedStatus=await reader.locator('#feedbackStatus').textContent();
  await reader.waitForTimeout(150);assert.equal(await reader.locator('#feedbackStatus').textContent(),pausedStatus);
  const rows=[];let heldDrawings=0;
  for(let round=0;round<12;round++){
    const before=await reader.locator('#feedbackStatus').getAttribute('data-graph-revision');
    await reader.evaluate(()=>{window.holdCounterPaint=true;window.holdStepEvaluation=true;});
    await reader.locator('#feedbackStep').click();
    await reader.waitForFunction(()=>typeof window.releaseStepEvaluation==='function');
    assert.equal(await reader.locator('[data-smart-ready="true"]').count(),0,'queued Step clears readiness before its graph evaluation and refresh begin');
    await reader.evaluate(()=>window.releaseStepEvaluation());
    await reader.waitForFunction(before=>{
      const revision=document.querySelector('#feedbackStatus').dataset.graphRevision,shape=document.querySelector('[data-smart-index="1"]');
      return revision!==before && (typeof window.releaseCounterPaint==='function' ||
        shape.dataset.smartReady==='true' && shape.dataset.smartGraphRevision===revision);
    },before);
    if(await reader.evaluate(()=>typeof window.releaseCounterPaint==='function')){
      heldDrawings++;
      assert.equal(await reader.locator('[data-smart-index="1"]').getAttribute('data-smart-ready'),null,'the new round is not ready while its actual drawing reply is held');
      await reader.evaluate(()=>window.releaseCounterPaint());
    }else{
      // A propagation round can change a different node while reusing this counter's drawing.
      await reader.evaluate(()=>{window.holdCounterPaint=false;});
    }
    await paintedRound();
    const row={status:await reader.locator('#feedbackStatus').textContent(),
      counter:await reader.locator('[data-smart-index="1"]').textContent(),completed:await reader.locator('[data-smart-index="2"]').textContent()};
    rows.push(row);if(round>0 && /settled/.test(row.status))break;
  }
  assert.ok(heldDrawings>0,'at least one changed counter drawing was held while readiness remained false');
  assert.ok(rows.some(row=>/Reached:\s*true/.test(row.counter)),'the reader displays the temporary completion before reset');
  assert.ok(rows.some(row=>/round/.test(row.status)));assert.match(rows.at(-1).status,/settled/);
  assert.match(rows.at(-1).counter,/Reached:\s*false/);
  assert.equal(await reader.locator('[data-smart-index="2"] text').evaluateAll(texts=>texts.filter(text=>text.textContent==='1').length),2);
  const frozen=await reader.locator('#feedbackStatus').textContent();await reader.waitForTimeout(150);
  assert.equal(await reader.locator('#feedbackStatus').textContent(),frozen);
  await reader.locator('#feedbackPause').click();
  await reader.waitForFunction(()=>document.querySelector('#feedbackPause').textContent==='Pause' && !document.querySelector('[data-smart-index="0"] rect[fill="#dcfce7"]'));
  assert.equal(await reader.locator('#feedbackStep').isDisabled(),true);assert.match(await reader.locator('#feedbackStatus').textContent(),/running/i);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('Pause drains an overdue queued signal before freezing a cached editor graph',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    cancelGesture();items=['delay','counter'].map((key,index)=>({
      ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid:'late-pause-'+index,
      ...(index===0?{inputValues:{value:true,seconds:.1}}:{bindings:{value:{uid:'late-pause-0',port:'value'}}})
    }));selection=[];setTool('select');await ensureEditorComponentGraph();
    clearTimeout(componentTimelineTimer);componentTimelineTimer=null;
    const owner=editorTimeline,started=owner.startedAt;
    owner.clock=()=>started+250;
    const before={value:items[0].state.value,count:items[1].state.count,due:owner.deadline<=componentTimelineNow(owner)};
    await controlComponentSimulation('pause');
    return {before,paused:owner.pausedByUser,value:items[0].state.value,count:items[1].state.count,
      pending:owner.pendingTime,deadline:owner.deadline===Infinity};
  })()`);
  assert.deepEqual(result,{before:{value:false,count:0,due:true},paused:true,value:true,count:1,pending:null,deadline:true});
}));
