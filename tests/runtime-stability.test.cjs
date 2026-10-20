const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://runtime-stability.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://runtime-stability.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
const harness=`
  const make=(uid,script,extra={})=>({type:'smart',uid,script,componentApi:2,state:{},x:50,y:80,w:180,h:90,size:2,color:'#000000',...extra});
  const owners=new Map(),call=(item,hook,args)=>{
    if(!owners.has(item)||!smartExecutionCurrent(owners.get(item))){
      if(owners.has(item))disposeSmartExecution(owners.get(item));owners.set(item,createSmartExecution(item));
    }
    return hook==='caps'?requestSmartCaps(item,owners.get(item),args[0]):requestSmartCall(item,hook,args,owners.get(item));
  };
  const close=()=>{for(const owner of owners.values())disposeSmartExecution(owner);};
`;
const constant=`({apiVersion:2,inputs:{},outputs:{value:{type:'boolean'}},compute(i,s){return {value:!!s.value};},children(){return [];}})`;
const oscillator=`({apiVersion:2,inputs:{value:{type:'number',default:0},reset:{type:'boolean',default:false}},outputs:{value:{type:'number'}},compute(i){return {value:i.reset?0:i.value+1};},children(){return [];}})`;

test('Pause and Resume survive a control repaint between pointerdown and click in the editor and HTML',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=[{type:'smart',uid:'pause-source',componentApi:2,script:${JSON.stringify(constant)},state:{value:false},x:50,y:80,w:180,h:90,size:2,color:'#000000'}];setTool('select');render();ensureEditorComponentGraph()`);
  // WebKit cancels the click if a render replaces the hit text node between down/up.
  // Force that normal asynchronous repaint at this exact point instead of relying on timing.
  await run("document.getElementById('componentPauseBtn').addEventListener('pointerdown',()=>updateComponentSimulationControls())");
  for(const paused of [true,false]){
    await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');
    assert.equal(await run('editorTimeline.pausedByUser'),paused);
  }
  const downloading=page.waitForEvent('download');await run('exportHtml()');const download=await downloading;
  const exported=fs.readFileSync(await download.path(),'utf8').replace('void activate(initial);','window.__runtime=source=>eval(source);void activate(initial);');
  const reader=await context.newPage();
  await reader.route('http://runtime-pause-export.test/**',route=>route.fulfill({contentType:'text/html',body:exported}));
  await reader.goto('http://runtime-pause-export.test/index.html');
  await reader.waitForFunction(()=>window.__runtime && !document.documentElement.classList.contains('sc-reader-starting'));
  await reader.evaluate(()=>document.getElementById('feedbackPause').addEventListener('pointerdown',()=>__runtime('updateSignalControls()')));
  for(const paused of [true,false]){
    await reader.locator('#feedbackPause').click();await reader.evaluate(()=>__runtime('gestureQueue'));
    assert.equal(await reader.evaluate(()=>__runtime('timeline.pausedByUser')),paused);
  }
}));

test('validated capabilities are shared by equivalent instances, isolated from mutation, and invalidated by state or script',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const script='({apiVersion:2,inputs(s){return {[s.port||"value"]:{type:"number",default:0}};},outputs:{value:{type:"number"}},compute(){return {value:0};},children(){return [];}})';
    const list=Array.from({length:32},(_,i)=>make('caps-'+i,script,{state:{port:'first'}}));
    try{
      const start=smartSandboxReqSeq;
      for(const item of list)await call(item,'caps',[item.state]);
      const initial=smartSandboxReqSeq-start;
      const returned=await call(list[0],'caps',[list[0].state]);returned.inputs.first.type='string';
      const isolated=(await call(list[1],'caps',[list[1].state])).inputs.first.type;
      list[0].state.port='second';const revised=await call(list[0],'caps',[list[0].state]);
      const afterState=smartSandboxReqSeq-start;
      list[0].script=script.replace('"number",default:0','"string",default:""');
      const edited=await call(list[0],'caps',[list[0].state]);
      return {initial,isolated,revised:Object.keys(revised.inputs),afterState,afterScript:smartSandboxReqSeq-start,type:edited.inputs.second.type};
    }finally{close();}
  })()`);
  assert.equal(result.initial,1);assert.equal(result.isolated,'number');assert.deepEqual(result.revised,['second']);
  assert.equal(result.afterState,2);assert.equal(result.afterScript,3);assert.equal(result.type,'string');
}));

test('capability cache bounds retained declarations and evicts old state versions',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const item=make('bounded-caps',${JSON.stringify(constant)});
    try{
      for(let i=0;i<1100;i++)await call(item,'caps',[{version:i,padding:'x'.repeat(3600)}]);
      const count=requestSmartCaps.cache.size,bytes=requestSmartCaps.bytes,start=smartSandboxReqSeq;
      await call(item,'caps',[{version:1099,padding:'x'.repeat(3600)}]);const hit=smartSandboxReqSeq-start;
      await call(item,'caps',[{version:0,padding:'x'.repeat(3600)}]);
      return {count,bytes,hit,miss:smartSandboxReqSeq-start};
    }finally{close();}
  })()`);
  assert.ok(result.count<=1024);assert.ok(result.bytes<=4000000);assert.equal(result.hit,0);assert.equal(result.miss,1);
}));

test('feedback faults ignore unrelated changes and recover in the same evaluation as an external reset or definition edit',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const reset=make('reset',${JSON.stringify(constant)},{state:{value:false}});
    const loop=make('loop',${JSON.stringify(oscillator)},{signalState:{value:0},bindings:{value:{uid:'loop',port:'value'},reset:{uid:'reset',port:'value'}}});
    const healthy=make('healthy',${JSON.stringify(constant)},{state:{value:false}});
    const list=[loop,healthy,reset],timeline=createComponentTimeline(()=>0),rows=[];
    const sample=async()=>{const before=smartSandboxReqSeq;const graph=await settleComponentTimeline(list,call,()=>true,timeline);rows.push({calls:smartSandboxReqSeq-before,error:graph.get(loop).error||'',value:graph.get(loop).io.outputs.value,healthy:graph.get(healthy).io.outputs.value,faults:timeline.feedbackFaults.size});};
    try{
      await sample();await sample();healthy.state.value=true;await sample();loop.state.note='edited';await sample();
      reset.state.value=true;await sample();reset.state.value=false;await sample();
      loop.script=loop.script.replace('i.value+1','42');await sample();return rows;
    }finally{close();}
  })()`);
  assert.ok(result[0].calls>=256);assert.match(result[0].error,/did not settle/);assert.equal(result[0].faults,1);
  assert.equal(result[1].calls,0);assert.match(result[1].error,/did not settle/);
  assert.ok(result[2].calls<=2);assert.equal(result[2].healthy,true);assert.match(result[2].error,/did not settle/);
  assert.ok(result[3].calls>=256,'editing a faulted component state deliberately retries it');
  assert.equal(result[4].error,'');assert.equal(result[4].value,0);assert.equal(result[4].faults,0);
  assert.match(result[5].error,/did not settle/);assert.equal(result[6].error,'');assert.equal(result[6].value,42);
}));

test('a timeout retains its diagnostic through cooldown and recovers after the retry deadline',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const item=make('slow','({apiVersion:2,inputs:{},outputs:{value:{type:"number"}},compute(i,s){if(s.slow){const until=Date.now()+800;while(Date.now()<until){}}return {value:7};},children(){return [];}})',{state:{slow:true}});
    const timeline=createComponentTimeline(()=>0),rows=[];
    try{
      for(let i=0;i<2;i++){const graph=await settleComponentTimeline([item],call,()=>true,timeline);rows.push({error:graph.get(item).error,transient:graph.get(item).transient});}
      owners.get(item).failedUntil=Date.now()-1;item.state.slow=false;
      const recovered=await settleComponentTimeline([item],call,()=>true,timeline);return {rows,value:recovered.get(item).io.outputs.value};
    }finally{close();}
  })()`);
  assert.match(result.rows[0].error,/timed out/);assert.equal(result.rows[1].error,result.rows[0].error);
  assert.equal(result.rows[0].transient,true);assert.equal(result.rows[1].transient,true);assert.equal(result.value,7);
}));

test('an accepted drawing can finish while an unchanged graph is pending without repaint starvation',async()=>app(async({page,run})=>{
  await run(`(()=>{
    const original=requestSmartSandbox,originalCaps=requestSmartCaps;
    window.paintGate={drawCalls:0,holdDraw:true,holdGraph:false};
    requestSmartSandbox=(message,subject,execution)=>{
      const reply=original(message,subject,execution);
      if(message.fn==='children' && subject?.uid==='steady'){
        paintGate.drawCalls++;
        if(paintGate.holdDraw){paintGate.holdDraw=false;return reply.then(async result=>{
          paintGate.drawWaiting=true;await new Promise(resolve=>paintGate.releaseDraw=resolve);return result;
        });}
      }
      return reply;
    };
    requestSmartCaps=async(...args)=>{
      if(paintGate.holdGraph){paintGate.holdGraph=false;paintGate.graphWaiting=true;await new Promise(resolve=>paintGate.releaseGraph=resolve);}
      return originalCaps(...args);
    };
    items=[{type:'smart',uid:'steady',componentApi:2,script:${JSON.stringify(constant)},state:{value:false},x:50,y:80,w:180,h:90,size:2,color:'#000000'}];
    setTool('select');render();
  })()`);
  await page.waitForFunction(()=>window.paintGate?.drawWaiting);
  await run(`paintGate.holdGraph=true;editorComponentEvaluation=null;void (paintGate.graph=ensureEditorComponentGraph());`);
  await page.waitForFunction(()=>window.paintGate?.graphWaiting);
  await run('paintGate.releaseDraw()');
  await page.waitForFunction(()=>__test.run("smartChildrenCache.has('steady') && !smartInFlight.has('steady')"));
  assert.equal(await run('editorComponentEvaluation.records'),null,'accepted drawing is retained while the new graph is still pending');
  await run('paintGate.releaseGraph();paintGate.graph');
  assert.equal(await run('paintGate.drawCalls'),1);
  await run(`items[0].state.value=true;editorComponentEvaluation=null;ensureEditorComponentGraph()`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('steady')?.sig===smartSig(items[0]) && !smartInFlight.has('steady')"));
  assert.equal(await run('paintGate.drawCalls'),2,'a real input/state change still refreshes the drawing');
}));

test('offline reader retains feedback faults, recovers when a source changes, and does not retry permanent errors',async()=>app(async({page,run,context})=>{
  const refreshing=constant.replace('children(){return [];}','children(){return [];},refreshMs(){return 60000;}');
  await run(`cancelGesture();items=[
    {type:'smart',uid:'reset',componentApi:2,script:${JSON.stringify(refreshing)},state:{value:false},x:50,y:80,w:180,h:90,size:2,color:'#000000'},
    {type:'smart',uid:'loop',componentApi:2,script:${JSON.stringify(oscillator)},state:{},signalState:{value:0},bindings:{value:{uid:'loop',port:'value'},reset:{uid:'reset',port:'value'}},x:260,y:80,w:180,h:90,size:2,color:'#000000'},
    {type:'smart',uid:'invalid',componentApi:99,script:${JSON.stringify(constant)},state:{},x:470,y:80,w:180,h:90,size:2,color:'#000000'}
  ];setTool('select');render();`);
  const downloading=page.waitForEvent('download');await run('exportHtml()');const download=await downloading;
  const exported=fs.readFileSync(await download.path(),'utf8').replace('void activate(initial);','window.__runtime=source=>eval(source);void activate(initial);');
  const preview=await context.newPage(),errors=[];preview.on('pageerror',error=>errors.push(error.message));
  await preview.route('http://runtime-export.test/**',route=>route.fulfill({contentType:'text/html',body:exported}));
  await preview.goto('http://runtime-export.test/index.html');
  await preview.waitForFunction(()=>window.__runtime && !document.documentElement.classList.contains('sc-reader-starting') && document.querySelectorAll('[data-component-error]').length===2);
  await preview.waitForFunction(()=>__runtime('entries.every(entry=>!entry.busy)'));
  const result=await preview.evaluate(async()=>{
    const before=__runtime('smartSandboxReqSeq');await __runtime('refreshComponents()');
    const retryCalls=__runtime('smartSandboxReqSeq')-before;
    const noRetry=__runtime('entries.filter(entry=>entry.error).every(entry=>entry.next===Infinity)');
    return {retryCalls,noRetry};
  });
  await preview.waitForFunction(()=>__runtime('entries.every(entry=>!entry.busy)'));
  const updated=await preview.evaluate(async()=>{
    const beforePaint=__runtime('smartSandboxReqSeq');
    await __runtime("(()=>{const entry=entries.find(entry=>entry.item.uid==='reset');entry.drawingDeadline=performance.now()-1;return refresh(entry);})()");
    const duePaintCalls=__runtime('smartSandboxReqSeq')-beforePaint;
    await __runtime("items.find(item=>item.uid==='reset').state.value=true;refreshComponents()");
    const records=await __runtime('resolveComponentGraph()');
    return {duePaintCalls,value:records.get(__runtime("items.find(item=>item.uid==='loop')")).io.outputs.value};
  });
  assert.equal(result.retryCalls,0,'unchanged values need neither a repeat feedback search nor new drawing calls');
  assert.equal(updated.duePaintCalls,1,'the drawing refresh deadline still calls children');
  assert.equal(result.noRetry,true);assert.equal(updated.value,0);assert.deepEqual(errors,[]);
}));
