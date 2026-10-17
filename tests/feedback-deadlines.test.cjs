const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});
async function app(fn){
  const context=await browser.newContext();
  try{
    const page=await context.newPage();
    await page.route('http://feedback-deadlines.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://feedback-deadlines.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source)},source);
    await run('appStarted');await fn(run);
  }finally{await context.close();}
}
const harness=`
  const make=(key,uid,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid,...extra});
  const owners=new Map(),call=(item,hook,args)=>{
    if(!owners.has(item))owners.set(item,createSmartExecution(item));
    return hook==='caps'?requestSmartCaps(item,owners.get(item),args[0]):requestSmartCall(item,hook,args,owners.get(item));
  };
  let clock=0;const timeline=createComponentTimeline(()=>clock);resumeComponentTimeline(timeline);
  const close=()=>{for(const owner of owners.values())disposeSmartExecution(owner);};
`;

test('distinct overdue deadlines settle chronologically before a flip-flop samples its data',async()=>app(async run=>{
  const result=await run(`(async()=>{
    const scenarios=[];
    for(const late of [false,true]){${harness}
      const data=make('delay','data',{inputValues:{value:false,seconds:.2}});data.state.value=true;
      const pulse=make('delay','clock',{inputValues:{value:true,seconds:.1}});
      const flipFlop=make('dFlipFlop','memory',{bindings:{d:{uid:'data',port:'value'},clock:{uid:'clock',port:'value'}}});
      const list=[flipFlop,data,pulse];
      try{
        await settleComponentTimeline(list,call,()=>true,timeline);
        let graph;
        for(const at of late?[250]:[100,200,250]){clock=at;graph=await settleComponentTimeline(list,call,()=>true,timeline);}
        scenarios.push({data:data.state.value,clock:pulse.state.value,stored:flipFlop.state.value,errors:[...graph.values()].map(record=>record.error||'')});
      }finally{close();}
    }
    return scenarios;
  })()`);
  assert.deepEqual(result[0],{data:false,clock:true,stored:true,errors:['','','']});
  assert.deepEqual(result[1],result[0],'a delayed browser callback must not move the 200 ms data change before the 100 ms clock edge');
}));

test('an external input change is applied after already scheduled earlier clock edges',async()=>app(async run=>{
  const result=await run(`(async()=>{${harness}
    const data=make('toggle','data');data.state.value=false;
    const pulse=make('delay','clock',{inputValues:{value:true,seconds:.1}});
    const flipFlop=make('dFlipFlop','memory',{bindings:{d:{uid:'data',port:'value'},clock:{uid:'clock',port:'value'}}});
    const list=[flipFlop,data,pulse];
    try{
      await settleComponentTimeline(list,call,()=>true,timeline);
      clock=250;data.state.value=true;
      const graph=await settleComponentTimeline(list,call,()=>true,timeline);
      return {data:data.state.value,clock:pulse.state.value,stored:flipFlop.state.value,errors:[...graph.values()].map(record=>record.error||'')};
    }finally{close();}
  })()`);
  assert.deepEqual(result,{data:true,clock:true,stored:false,errors:['','','']},'the input changed at 250 ms cannot alter data sampled by the clock scheduled for 100 ms');
}));

test('cancelling historical replay commits no state, scheduling memory, trace, or saved scene',async()=>app(async run=>{
  const result=await run(`(async()=>{${harness}
    const pulse=make('delay','pulse',{inputValues:{value:true,seconds:.1}});
    const counter=make('counter','counter',{bindings:{value:{uid:'pulse',port:'value'}}});
    const list=[pulse,counter];
    try{
      await settleComponentTimeline(list,call,()=>true,timeline);
      const snapshot=()=>JSON.stringify({list,observations:[...timeline.observations].map(([item,o])=>[item.uid,o]),trace:timeline.trace,
        scene:timeline.committedScene.map(({item,snapshot})=>[item.uid,snapshot]),deadline:timeline.deadline,signature:timeline.signature});
      const before=snapshot();clock=250;let current=true,cancelled=false,replayed=false;
      try{await settleComponentTimeline(list,async(item,hook,args)=>{
        const result=await call(item,hook,args);if(hook==='transition' && args[3]?.historical){replayed=true;current=false;}return result;
      },()=>current,timeline);}catch(error){cancelled=error.cancelled===true;}
      return {replayed,cancelled,unchanged:snapshot()===before};
    }finally{close();}
  })()`);
  assert.deepEqual(result,{replayed:true,cancelled:true,unchanged:true});
}));

test('positive-time feedback backlog is bounded separately from zero-time settling and can recover',async()=>app(async run=>{
  const result=await run(`(async()=>{${harness}
    const delayed=make('delay','delayed',{inputValues:{seconds:.001},bindings:{value:{uid:'not',port:'value'}}});
    const inverter=make('not','not',{bindings:{value:{uid:'delayed',port:'value'}}});
    const healthy=make('constant','healthy');const list=[delayed,inverter,healthy];
    try{
      await settleComponentTimeline(list,call,()=>true,timeline);clock=1000;
      const graph=await settleComponentTimeline(list,call,()=>true,timeline);
      const errors=[delayed,inverter].map(item=>graph.get(item).error||'');
      const healthyValue=graph.get(healthy).io.outputs.value,stopped=timeline.deadline===Infinity;
      delayed.inputValues.seconds=1;
      const repaired=await settleComponentTimeline(list,call,()=>true,timeline);
      return {errors,healthyValue,stopped,repaired:[...repaired.values()].map(record=>record.error||''),scheduled:Number.isFinite(timeline.deadline)};
    }finally{close();}
  })()`);
  assert.ok(result.errors.every(error=>/Scheduled signal backlog exceeded 128 time steps/.test(error)),JSON.stringify(result.errors));
  assert.ok(result.errors.every(error=>!/did not settle/.test(error)));
  assert.ok(Number.isFinite(result.healthyValue));assert.equal(result.stopped,true);
  assert.deepEqual(result.repaired,['','','']);assert.equal(result.scheduled,true);
}));
