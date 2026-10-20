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
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{if(browser)await browser.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://feedback-review.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://feedback-review.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
const harness=`
  const make=(key,uid,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid,...extra});
  const owners=new Map(),call=(item,hook,args)=>{
    if(!owners.has(item)||!smartExecutionCurrent(owners.get(item))){
      if(owners.has(item))disposeSmartExecution(owners.get(item));
      owners.set(item,createSmartExecution(item));
    }
    return hook==='caps'?requestSmartCaps(item,owners.get(item),args[0]):requestSmartCall(item,hook,args,owners.get(item));
  };
  const timeline=createComponentTimeline(()=>0);
  const close=()=>{for(const owner of owners.values())disposeSmartExecution(owner);};
`;

test('retained transitive wiring keys stay compact and invalidate on an exact source edit',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const list=Array.from({length:16},(_,i)=>make('buffer','buffer-'+i,{bindings:{value:{uid:'buffer-'+((i+1)%16),port:'value'}}}));
    for(const [i,item] of list.entries())item.script+='\\n/* unique '+i+' '+ 'x'.repeat(19000)+' */';
    try{
      await settleComponentTimeline(list,call,()=>true,timeline);
      const before=list.map(item=>timeline.observations.get(item).wiring);
      const sourceChars=list.reduce((sum,item)=>sum+item.script.length,0);
      const wiringChars=before.reduce((sum,key)=>sum+key.length,0);
      const definitionChars=[...timeline.definitions.values()].reduce((sum,definition)=>sum+definition.script.length,0);
      await settleComponentTimeline(list,call,()=>true,timeline);
      const unchanged=list.every((item,i)=>timeline.observations.get(item).wiring===before[i]);
      list[0].script+='\\n// revised\\n';
      await settleComponentTimeline(list,call,()=>true,timeline);
      return {sourceChars,wiringChars,definitionChars,unchanged,definitionCount:timeline.definitions.size,
        invalidated:list.every((item,i)=>timeline.observations.get(item).wiring!==before[i])};
    }finally{close();}
  })()`);
  assert.ok(result.sourceChars>300000);
  assert.ok(result.wiringChars<16000,'keys must not duplicate dependency scripts or binding payloads');
  assert.equal(result.definitionChars,result.sourceChars,'each active definition is retained once');
  assert.equal(result.definitionCount,16);assert.equal(result.unchanged,true);assert.equal(result.invalidated,true);
}));

test('stored outputs stay available through Z inputs while combinational outputs remain blocked',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const source=make('triStateBuffer','source',{inputValues:{value:false,enable:false}});
    const stored=make('dFlipFlop','stored',{bindings:{d:{uid:'source',port:'value'}},inputValues:{clock:false}});stored.state.value=true;
    const consumer=make('not','consumer',{bindings:{value:{uid:'stored',port:'q'}}});
    const buffer=make('buffer','buffer',{bindings:{value:{uid:'source',port:'value'}}});
    const blocked=make('not','blocked',{bindings:{value:{uid:'buffer',port:'value'}}});
    const list=[blocked,consumer,stored,buffer,source];
    try{
      const read=graph=>({stored:graph.get(stored),consumer:graph.get(consumer),blocked:graph.get(blocked),source:graph.get(source)});
      const initial=read(await settleComponentTimeline(list,call,()=>true,timeline));
      const inspected=read(await evaluateComponentGraph(list,call));
      source.inputValues.enable=true;
      await settleComponentTimeline(list,call,()=>true,timeline);
      const recovered=read(await settleComponentTimeline(list,call,()=>true,timeline));
      stored.inputValues.clock=true;
      const clocked=read(await settleComponentTimeline(list,call,()=>true,timeline));
      return {initial,inspected,recovered,clocked};
    }finally{close();}
  })()`);
  for(const graph of [result.initial,result.inspected]){
    assert.equal(graph.source.io.outputs.value,null);assert.equal(graph.stored.highImpedance,true);
    assert.deepEqual(graph.stored.io.outputs,{q:true,notQ:false,value:true});
    assert.equal(graph.consumer.error,undefined);assert.deepEqual(graph.consumer.io.outputs,{value:false});
    assert.equal(graph.blocked.highImpedance,true);assert.deepEqual(graph.blocked.io.outputs,{});
  }
  assert.equal(result.recovered.stored.error,undefined);assert.equal(result.recovered.stored.io.outputs.q,true);
  assert.equal(result.clocked.stored.io.outputs.q,false);assert.equal(result.clocked.consumer.io.outputs.value,true);
}));

test('an offline consumer displays a stored value even when its register input is Z',async()=>app(async({page,run,context})=>{
  await run(`items=['triStateBuffer','dFlipFlop','statusIndicator'].map((key,i)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid:'z-'+i,x:50+i*420,y:100,
    ...(i===0?{inputValues:{value:false,enable:false}}:{}),
    ...(i===1?{bindings:{d:{uid:'z-0',port:'value'}}}:{}),
    ...(i===2?{bindings:{value:{uid:'z-1',port:'q'}}}:{})
  }));items[1].state.value=true;setTool('select');render();save();`);
  await page.waitForFunction(()=>__test.run('editorComponentEvaluation?.records?.get(items[2])?.io.outputs.value===true'));
  await run('selection=[1];render()');await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentOutputs').textContent.includes('q = true'));
  assert.match(await page.locator('#componentBindingsError').textContent(),/high impedance/);
  await page.locator('#componentBindingsCancel').click();
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-review-z-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'stored.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage();await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>[...document.querySelectorAll('[data-smart-index="2"] text')].some(text=>text.textContent==='ON'));
  assert.equal(await reader.locator('[data-smart-index="2"]').getAttribute('data-component-error'),null);
}));

test('Undo and Redo preserve a tab’s paused simulation time without sharing it with other tabs',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    items=[{...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==='pulseGenerator').items[0]),uid:'history-clock',inputValues:{seconds:60,width:.1}}];
    setTool('select');render();save();await ensureEditorComponentGraph();await controlComponentSimulation('pause');
    const first=activeTabId,at=componentTimelineNow(editorTimeline);
    beginHistory();items[0].x+=100;commitHistory();save();render();
    const capture=()=>({paused:editorTimeline.pausedByUser,active:editorTimeline.active,time:componentTimelineNow(editorTimeline),step:!document.getElementById('componentStepBtn').disabled});
    undo();await ensureEditorComponentGraph();const undone=capture();
    redo();await ensureEditorComponentGraph();const redone=capture();
    newTab();syncEditorTimeline();const otherId=activeTabId,other=capture();
    activateTab(first);await ensureEditorComponentGraph();const returned=capture();
    closeTab(otherId);const released=!editorTimelines.has(otherId);
    await controlComponentSimulation('step');const stepped=capture();
    await controlComponentSimulation('resume');const resumed=capture();
    return {at,undone,redone,other,returned,stepped,resumed,released};
  })()`);
  for(const snapshot of [result.undone,result.redone,result.returned])assert.deepEqual(snapshot,{paused:true,active:false,time:result.at,step:true});
  assert.equal(result.other.paused,false);assert.equal(result.other.active,true);
  assert.equal(result.released,true,'closing an inactive tab releases its retained simulation');
  assert.equal(result.stepped.paused,true);assert.equal(result.stepped.active,false);
  assert.equal(result.resumed.paused,false);assert.equal(result.resumed.active,true);
}));
