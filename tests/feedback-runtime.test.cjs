const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://feedback-runtime.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://feedback-runtime.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
const harness=`
  const make=(key,uid,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid,...extra});
  const owners=new Map();
  const call=(item,hook,args)=>{
    if(!owners.has(item))owners.set(item,createSmartExecution(item));
    return hook==='caps'?requestSmartCaps(item,owners.get(item)):requestSmartCall(item,hook,args,owners.get(item));
  };
  let clock=0;const timeline=createComponentTimeline(()=>clock);resumeComponentTimeline(timeline);
  const close=()=>{for(const owner of owners.values())disposeSmartExecution(owner);};
`;

test('temporal output publication is pure and independent of unavailable current inputs',async()=>app(async({run})=>{
  const definitions={counter:'counter',delay:'delay',pulseGenerator:'pulse-generator',trigger:'trigger',
    sampleHoldBoolean:'sample-hold-boolean',sampleHoldInteger:'sample-hold-integer',randomInteger:'random-integer',
    edgePulse:'edge-pulse',liveClock:'live-clock',stopwatch:'stopwatch',timer:'timer'};
  const actual=await run(`(async()=>{${harness}
    try{return await Promise.all(${JSON.stringify(Object.keys(definitions))}.map(async key=>{
      const item=make(key,key),before=JSON.stringify(item.state),caps=await call(item,'caps',[item.state]);
      const output=await call(item,'publish',[item.state]);
      return {key,script:item.script,publish:caps.publish,output,unchanged:before===JSON.stringify(item.state)};
    }));}finally{close();}
  })()`);
  for(const row of actual){
    assert.equal(row.script.trim(),fs.readFileSync(path.join(__dirname,'..','examples',definitions[row.key]+'.js'),'utf8').trim());
    assert.equal(row.publish,true,row.key+' declares stored output publication');
    assert.equal(row.unchanged,true);assert.ok(Object.keys(row.output).length);
  }
}));

test('a self-resetting countdown delivers its brief completion edge to every consumer independent of drawing order',async()=>app(async({run})=>{
  const scenarios=[];
  for(const reverse of [false,true])scenarios.push(await run(`(async()=>{${harness}
    const source=make('toggle','source');source.state.value=false;
    const counter=make('counter','countdown',{inputValues:{direction:'down',start:2,threshold:2},
      bindings:{value:{uid:'source',port:'value'},reset:{uid:'countdown',port:'reached'}}});
    const completed=make('counter','completed',{inputValues:{threshold:9},bindings:{value:{uid:'countdown',port:'reached'}}});
    const second=make('counter','second',{inputValues:{threshold:9},bindings:{value:{uid:'countdown',port:'reached'}}});
    const list=${reverse?'[second,completed,counter,source]':'[source,counter,completed,second]'};
    try{
      const snapshots=[];
      for(const value of [false,true,false,true,false,true,false,true]){
        source.state.value=value;const graph=await settleComponentTimeline(list,call,()=>true,timeline);
        snapshots.push({outputs:[counter,completed,second].map(item=>graph.get(item).io.outputs),errors:[...graph.values()].map(record=>record.error||'')});
      }
      const before=JSON.stringify(list);await evaluateComponentGraph(list,call);
      return {snapshots,pure:before===JSON.stringify(list)};
    }finally{close();}
  })()`));
  assert.deepEqual(scenarios[0],scenarios[1]);assert.equal(scenarios[0].pure,true);
  assert.deepEqual(scenarios[0].snapshots.map(row=>row.outputs.map(output=>output.count)),
    [[2,0,0],[1,0,0],[1,0,0],[2,1,1],[2,1,1],[1,1,1],[1,1,1],[2,2,2]]);
  assert.ok(scenarios[0].snapshots.every(row=>row.errors.every(error=>!error)));
  assert.ok(scenarios[0].snapshots.every(row=>row.outputs[0].reached===false),'reached is observed internally even though final output is low');
}));

test('countdown completion stops its own pulse source and cancels the next scheduled edge',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const pulse=make('pulseGenerator','pulse',{inputValues:{seconds:1,width:.1},bindings:{enable:{uid:'enable',port:'value'}}});
    const counter=make('counter','countdown',{inputValues:{direction:'down',start:2,threshold:2},bindings:{value:{uid:'pulse',port:'value'}}});
    const enabled=make('not','enable',{bindings:{value:{uid:'countdown',port:'reached'}}});
    const list=[pulse,counter,enabled];
    try{
      const snapshots=[];
      for(const at of [0,1000,1100,2000,2100,10000]){
        clock=at;const graph=await settleComponentTimeline(list,call,()=>true,timeline);
        snapshots.push({count:counter.state.count,value:pulse.state.value,reached:graph.get(counter).io.outputs.reached,
          errors:[...graph.values()].map(record=>record.error||'')});
      }
      return {snapshots,stopped:timeline.deadline===Infinity};
    }finally{close();}
  })()`);
  assert.deepEqual(result.snapshots.map(row=>row.count),[2,1,1,0,0,0]);
  assert.deepEqual(result.snapshots.map(row=>row.value),[false,true,false,false,false,false]);
  assert.deepEqual(result.snapshots.map(row=>row.reached),[false,false,false,true,true,true]);
  assert.ok(result.snapshots.every(row=>row.errors.every(error=>!error)));assert.equal(result.stopped,true);
}));

test('positive delay advances feedback in time, while zero-time oscillation is bounded and isolated',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const delay=make('delay','delay',{inputValues:{seconds:.1},bindings:{value:{uid:'not',port:'value'}}});
    const inverter=make('not','not',{bindings:{value:{uid:'delay',port:'value'}}});
    const healthy=make('constant','healthy');
    const list=[inverter,delay,healthy];
    try{
      const snapshots=[];
      for(const at of [0,99,100,199,200,300]){clock=at;const graph=await settleComponentTimeline(list,call,()=>true,timeline);
        snapshots.push({value:graph.get(delay).io.outputs.value,errors:[...graph.values()].map(record=>record.error||'')});}
      delay.inputValues.seconds=0;
      const graph=await settleComponentTimeline(list,call,()=>true,timeline);
      return {snapshots,errors:[inverter,delay].map(item=>graph.get(item).error||''),healthy:graph.get(healthy),deadline:timeline.deadline===Infinity};
    }finally{close();}
  })()`);
  assert.deepEqual(result.snapshots.map(row=>row.value),[false,false,true,true,false,true]);
  assert.ok(result.snapshots.every(row=>row.errors.every(error=>!error)));
  assert.ok(result.errors.some(error=>/settle|oscillat|feedback/i.test(error)),JSON.stringify(result.errors));
  assert.equal(result.healthy.error,undefined);assert.ok(Number.isFinite(result.healthy.io.outputs.value));assert.equal(result.deadline,true);
}));

test('stale feedback evaluation commits neither state nor pending timers',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const source=make('toggle','source');source.state.value=false;
    const counter=make('counter','counter',{bindings:{value:{uid:'source',port:'value'},reset:{uid:'counter',port:'reached'}},inputValues:{threshold:2}});
    const list=[source,counter];
    try{
      await settleComponentTimeline(list,call,()=>true,timeline);source.state.value=true;
      const before=JSON.stringify(list),observations=JSON.stringify([...timeline.observations].map(([item,value])=>[item.uid,value.memory]));
      let valid=true,cancelled=false;
      try{await settleComponentTimeline(list,async(item,hook,args)=>{
        const result=await call(item,hook,args);if(hook==='transition')valid=false;return result;
      },()=>valid,timeline);}catch(error){cancelled=error.cancelled===true;}
      return {cancelled,unchanged:before===JSON.stringify(list),memoryUnchanged:observations===JSON.stringify([...timeline.observations].map(([item,value])=>[item.uid,value.memory]))};
    }finally{close();}
  })()`);
  assert.deepEqual(result,{cancelled:true,unchanged:true,memoryUnchanged:true});
}));

test('self-reset feedback remains interactive and self-contained in the offline HTML reader',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['toggle','counter','counter'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid:'feedback-'+index,x:60+index*400,y:120,
    ...(index===1?{inputValues:{direction:'down',start:2,threshold:2},bindings:{value:{uid:'feedback-0',port:'value'},reset:{uid:'feedback-1',port:'reached'}}}:{}),
    ...(index===2?{inputValues:{threshold:9},bindings:{value:{uid:'feedback-1',port:'reached'}}}:{})
  }));items[0].state.value=false;selection=[];setTool('select');render();save();`);
  await page.waitForFunction(()=>__test.run("items[1].state.count===2 && items.every(item=>smartChildrenCache.has(item.uid))"));
  const point=await run(`(async()=>{const item=items[0],io=await resolveSmartComponentIo(item);
    return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='toggle');})()`);
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-feedback-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'feedback.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===3);
  const counts=async(first,second)=>reader.waitForFunction(([a,b])=>[a,b].every((count,index)=>
    [...document.querySelectorAll('[data-smart-index="'+(index+1)+'"] text')].filter(text=>text.textContent===String(count)).length===2),[first,second]);
  await counts(2,0);
  for(const [first,second] of [[1,0],[1,0],[2,1],[2,1],[1,1],[1,1],[2,2]]){
    const host=reader.locator('[data-smart-index="0"]');
    const at=await host.evaluate((host,point)=>{const p=new DOMPoint(point.x,point.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},point);
    await reader.mouse.click(at.x,at.y);await counts(first,second);
  }
  assert.deepEqual(await run('items.slice(1).map(item=>item.state.count)'),[2,0],'reader simulation stays local');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('gate-built NOR latch starts unknown, settles when initialized, and preserves its stored bit',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const set=make('toggle','set'),reset=make('toggle','reset');set.state.value=false;reset.state.value=false;
    const q=make('nor','q',{bindings:{a:{uid:'reset',port:'value'},b:{uid:'notQ',port:'value'}}});
    const notQ=make('nor','notQ',{bindings:{a:{uid:'set',port:'value'},b:{uid:'q',port:'value'}}});
    const list=[q,notQ,set,reset];
    try{
      const rows=[];
      for(const [s,r] of [[false,false],[true,false],[false,false],[false,true],[false,false],[true,true]]){
        set.state.value=s;reset.state.value=r;const graph=await settleComponentTimeline(list,call,()=>true,timeline);
        rows.push({outputs:[q,notQ].map(item=>graph.get(item).io.outputs.value),errors:[q,notQ].map(item=>graph.get(item).error||'')});
      }
      const saved=clone(list),savedOwners=new Map();
      set.state.value=false;reset.state.value=false;
      const released=await settleComponentTimeline(list,call,()=>true,timeline);
      // Restore the previously stable set state with persisted signal snapshots and no scheduler memory.
      saved[0].signalState={value:true};saved[1].signalState={value:false};saved[2].state.value=false;saved[3].state.value=false;
      const restored=await settleComponentTimeline(saved,call,()=>true,createComponentTimeline(()=>0));
      return {rows,released:[q,notQ].map(item=>({output:released.get(item).io.outputs.value,error:released.get(item).error||''})),
        restored:saved.slice(0,2).map(item=>restored.get(item).io.outputs.value)};
    }finally{close();}
  })()`);
  assert.deepEqual(result.rows.map(row=>row.outputs),[['X','X'],[true,false],[true,false],[false,true],[false,true],[false,false]]);
  assert.ok(result.rows.every(row=>row.errors.every(error=>!error)));
  assert.ok(result.released.every(row=>row.output==='X' || /settle|oscillat|feedback/i.test(row.error)),JSON.stringify(result.released));
  assert.deepEqual(result.restored,[true,false]);
}));

test('completion can reset its counter and latch the pulse source off until an explicit restart',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const restart=make('toggle','restart');restart.state.value=true;
    const pulse=make('pulseGenerator','pulse',{inputValues:{seconds:1,width:.1},bindings:{enable:{uid:'enable',port:'value'}}});
    const counter=make('counter','countdown',{inputValues:{direction:'down',start:2,threshold:2},
      bindings:{value:{uid:'pulse',port:'value'},reset:{uid:'countdown',port:'reached'}}});
    const stopped=make('srLatch','stopped',{bindings:{set:{uid:'countdown',port:'reached'},reset:{uid:'restart',port:'value'}}});
    const enabled=make('not','enable',{bindings:{value:{uid:'stopped',port:'q'}}});
    const list=[pulse,counter,enabled,stopped,restart];
    try{
      const rows=[];
      for(const [at,reset] of [[0,true],[0,false],[1000,false],[1100,false],[2000,false],[5000,false],[5000,true],[5000,false],[6000,false]]){
        clock=at;restart.state.value=reset;const graph=await settleComponentTimeline(list,call,()=>true,timeline);
        rows.push({count:counter.state.count,pulse:pulse.state.value,stopped:graph.get(stopped).io.outputs.q,errors:[...graph.values()].map(record=>record.error||'')});
      }
      return rows;
    }finally{close();}
  })()`);
  assert.deepEqual(result.map(row=>row.count),[2,2,1,1,2,2,2,2,1]);
  assert.deepEqual(result.map(row=>row.stopped),[false,false,false,false,true,true,false,false,false]);
  assert.ok(result.every(row=>row.errors.every(error=>!error)),JSON.stringify(result));
}));

test('overdue transport-delay transitions settle individually so short pulses cannot disappear between renders',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const source=make('toggle','source');source.state.value=false;
    const delay=make('delay','delayed',{inputValues:{seconds:.1},bindings:{value:{uid:'source',port:'value'}}});
    const counter=make('counter','counted',{bindings:{value:{uid:'delayed',port:'value'}}});
    const list=[counter,delay,source];
    try{
      for(const [at,value] of [[0,false],[10,true],[20,false],[30,true],[40,false]]){
        clock=at;source.state.value=value;await settleComponentTimeline(list,call,()=>true,timeline);
      }
      clock=1000;const graph=await settleComponentTimeline(list,call,()=>true,timeline);
      return {count:counter.state.count,value:delay.state.value,errors:[...graph.values()].map(record=>record.error||''),deadline:timeline.deadline===Infinity};
    }finally{close();}
  })()`);
  assert.deepEqual(result,{count:2,value:false,errors:['','',''],deadline:true});
}));

test('historical queued inputs settle before latest generators take one sample at the current observation',async()=>app(async({run})=>{
  const result=await run(`(async()=>{${harness}
    const source=make('toggle','source');source.state.value=false;
    const delay=make('delay','delayed',{inputValues:{seconds:2},bindings:{value:{uid:'source',port:'value'}}});
    const hold=make('sampleHoldBoolean','held',{inputValues:{seconds:1},bindings:{value:{uid:'delayed',port:'value'}}});
    const random=make('randomInteger','random',{inputValues:{min:7,max:7}});
    const pulse=make('pulseGenerator','pulse',{inputValues:{seconds:1,width:.1}});
    const counter=make('counter','counted',{bindings:{value:{uid:'pulse',port:'value'}}});
    const list=[hold,counter,delay,pulse,random,source],transitions=[];
    const tracked=async(item,hook,args)=>{
      const result=await call(item,hook,args);
      if(hook==='transition')transitions.push({uid:item.uid,context:args[3],value:result.state.value,deadline:result.nextWakeAt});
      return result;
    };
    try{
      await settleComponentTimeline(list,tracked,()=>true,timeline);source.state.value=true;await settleComponentTimeline(list,tracked,()=>true,timeline);
      transitions.length=0;clock=2500;
      const graph=await settleComponentTimeline(list,tracked,()=>true,timeline);
      return {transitions,outputs:[hold,random,pulse,counter].map(item=>graph.get(item).io.outputs),
        errors:[...graph.values()].map(record=>record.error||''),deadline:timeline.deadline};
    }finally{close();}
  })()`);
  assert.ok(result.errors.every(error=>!error),JSON.stringify(result.errors));
  assert.deepEqual(result.outputs,[{value:true},{value:7},{value:true},{count:1,reached:false}]);
  assert.equal(result.deadline,2600);
  const historicalHold=result.transitions.filter(row=>row.uid==='held' && row.context.historical);
  assert.ok(historicalHold.length>0);assert.ok(historicalHold.every(row=>row.value===false && row.deadline===1000),'historical data arrives without consuming the overdue sample');
  for(const uid of ['random','pulse']){
    const calls=result.transitions.filter(row=>row.uid===uid);assert.equal(calls.length,1,uid+' coalesces overdue wakes');
    assert.equal(calls[0].context.now,2500);assert.equal(calls[0].context.historical,false);
  }
  const observedHold=result.transitions.filter(row=>row.uid==='held' && !row.context.historical);
  assert.equal(observedHold.length,1);assert.equal(observedHold[0].value,true);assert.equal(observedHold[0].deadline,3500);
}));
