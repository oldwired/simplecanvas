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
    await page.route('http://temporal-components.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://temporal-components.test/index.html');
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
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-temporal-'));
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

const sources={delay:'delay.js',counter:'counter.js',trigger:'trigger.js',randomInteger:'random-integer.js',
  sampleHoldInteger:'sample-hold-integer.js',sampleHoldBoolean:'sample-hold-boolean.js'};
test('temporal catalog definitions match their shipped sources and saved defaults',async()=>app(async({run})=>{
  for(const [key,file] of Object.entries(sources)){
    const definition=await run(`(async()=>{
      const entry=BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===${JSON.stringify(key)});
      const item=clone(entry.items[0]),owner=createSmartExecution(item);
      try{return {script:item.script,saved:item.state,state:await requestSmartCall(item,'initState',[],owner),
        ports:entry.ports,caps:await requestSmartCaps(item,owner)};}
      finally{disposeSmartExecution(owner);}
    })()`);
    assert.equal(definition.script.trim(),fs.readFileSync(path.join(__dirname,'..','examples',file),'utf8').trim(),key+' source stays synchronized');
    assert.deepEqual(definition.saved,definition.state,key+' placement starts with the saved defaults');
    assert.equal(definition.caps.transition,true,key+' declares temporal behavior');
    assert.deepEqual(definition.ports,{inputs:definition.caps.inputs,outputs:definition.caps.outputs});
  }
}));

test('Delay preserves short pulses and emits overdue transitions one at a time',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key==='delay').items[0]);
    const owner=createSmartExecution(item);let state=item.state,memory=null;
    const step=async(now,value,seconds=.1)=>{
      const inputs={value,seconds};
      const next=await requestSmartCall(item,'transition',[inputs,state,memory,{now}],owner);
      state=next.state;memory=next.memory;
      return {value:(await requestSmartCall(item,'compute',[inputs,state],owner)).value,nextWakeAt:next.nextWakeAt};
    };
    try{
      const queued=[];for(const [now,value] of [[0,false],[10,true],[20,false],[30,true],[40,false]])queued.push(await step(now,value));
      const overdue=[];for(let n=0;n<4;n++)overdue.push(await step(1000,false));
      const zero=await step(1001,true,0);
      return {queued,overdue,zero};
    }finally{disposeSmartExecution(owner);}
  })()`);
  assert.deepEqual(result.queued.map(entry=>entry.value),[false,false,false,false,false]);
  assert.deepEqual(result.queued.map(entry=>entry.nextWakeAt),[null,110,110,110,110]);
  assert.deepEqual(result.overdue.map(entry=>entry.value),[true,false,true,false],'two narrow pulses survive a late wake without coalescing');
  assert.deepEqual(result.overdue.map(entry=>entry.nextWakeAt),[120,130,140,null]);
  assert.deepEqual(result.zero,{value:true,nextWakeAt:null},'zero delay applies the new input immediately');
}));

test('Counter counts rising edges, holds reset, and does not invent an initial or reset-release edge',async()=>app(async({run})=>{
  const results=await run(`(async()=>{
    const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key==='counter').items[0]);
    const owner=createSmartExecution(item);let state={...item.state,count:7},memory=null;
    try{
      const results=[];
      for(const [value,reset] of [[true,false],[true,false],[false,false],[true,false],[true,false],[false,true],[true,true],[true,false],[false,false],[true,false]]){
        const inputs={value,reset,threshold:8};
        const next=await requestSmartCall(item,'transition',[inputs,state,memory,{now:0}],owner);
        state=next.state;memory=next.memory;results.push(await requestSmartCall(item,'compute',[inputs,state],owner));
      }
      state=(await requestSmartSandbox({method:'call',src:item.script,fn:'dragEdit',args:[state,'reset']},item,owner)).result;
      const inputs={value:true,reset:false,threshold:8};
      state=(await requestSmartCall(item,'transition',[inputs,state,memory,{now:0}],owner)).state;
      results.push(await requestSmartCall(item,'compute',[inputs,state],owner));return results;
    }finally{disposeSmartExecution(owner);}
  })()`);
  assert.deepEqual(results.map(result=>result.count),[7,7,7,8,8,0,0,0,0,1,0]);
  assert.deepEqual(results.map(result=>result.reached),[false,false,false,true,true,false,false,false,false,false,false]);
}));

test('the document timeline preserves delayed edges across pause and keeps inspection and export pure',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    const make=(key,uid,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid,...extra});
    const source=make('toggle','clock-source'),delay=make('delay','clock-delay',{
      bindings:{value:{uid:source.uid,port:'value'}},inputValues:{seconds:.1}});
    const first=make('counter','first-count',{bindings:{value:{uid:delay.uid,port:'value'}},inputValues:{threshold:2}});
    const second=make('counter','second-count',{state:{count:5,showIndicators:true},bindings:{value:{uid:delay.uid,port:'value'}},inputValues:{threshold:1}});
    const list=[source,delay,first,second],owners=new Map(list.map(item=>[item,createSmartExecution(item)]));
    let clock=0,transitions=0;const timeline=createComponentTimeline(()=>clock);resumeComponentTimeline(timeline);
    const call=(item,hook,args)=>{
      if(hook==='transition')transitions++;
      return hook==='caps'?requestSmartCaps(item,owners.get(item)):requestSmartCall(item,hook,args,owners.get(item));
    };
    const settle=async()=>{
      const graph=await settleComponentTimeline(list,call,()=>true,timeline);
      return list.slice(1).map(item=>({error:graph.get(item).error||'',outputs:graph.get(item).io.outputs}));
    };
    try{
      await settle();for(const [at,value] of [[10,true],[20,false],[30,true],[40,false]]){clock=at;source.state.value=value;await settle();}
      pauseComponentTimeline(timeline);clock=1040;
      const pausedNow=componentTimelineNow(timeline),before=JSON.stringify(list),beforeCalls=transitions;
      await evaluateComponentGraph(list,call);await inspectComponentGraph(list,()=>true);await itemsToSVGMarkup(list,{liveSmart:true});
      const pure={unchanged:before===JSON.stringify(list),calls:transitions-beforeCalls};
      resumeComponentTimeline(timeline);
      const results=[];
      for(const at of [1110,1120,1130,1140]){
        clock=at;results.push(await settle());
        if(at===1110){second.inputValues.reset=true;await settle();}
        if(at===1120)second.inputValues.reset=false;
      }
      const reopened=clone(list),reopenedOwners=new Map(reopened.map(item=>[item,createSmartExecution(item)]));
      const resumed=createComponentTimeline(()=>clock);resumeComponentTimeline(resumed);
      reopened[0].state.value=true;reopened[1].state.value=true;
      const restored=await settleComponentTimeline(reopened,(item,hook,args)=>hook==='caps'?requestSmartCaps(item,reopenedOwners.get(item)):requestSmartCall(item,hook,args,reopenedOwners.get(item)),()=>true,resumed);
      for(const owner of reopenedOwners.values())disposeSmartExecution(owner);
      return {pausedNow,pure,results,restored:reopened.slice(2).map(item=>restored.get(item).io.outputs),
        persisted:JSON.parse(JSON.stringify(list)).map(item=>({state:item.state,memory:item.memory,nextWakeAt:item.nextWakeAt}))};
    }finally{for(const owner of owners.values())disposeSmartExecution(owner);}
  })()`);
  assert.equal(result.pausedNow,40,'one second in an inactive document does not advance its signal clock');
  assert.deepEqual(result.pure,{unchanged:true,calls:0},'inspection and frozen export never consume queued transitions');
  assert.deepEqual(result.results.map(step=>step.map(item=>item.error)),Array.from({length:4},()=>['','','']));
  assert.deepEqual(result.results.map(step=>step[0].outputs.value),[true,false,true,false]);
  assert.deepEqual(result.results.map(step=>step[1].outputs),[{count:1,reached:false},{count:1,reached:false},{count:2,reached:true},{count:2,reached:true}]);
  assert.deepEqual(result.results.map(step=>step[2].outputs.count),[6,0,1,1],'reset changes only its own Counter instance');
  assert.deepEqual(result.restored,[{count:2,reached:true},{count:1,reached:true}],'reopening with a high input establishes an edge baseline without incrementing saved counts');
  assert.ok(result.persisted.every(item=>item.memory===undefined && item.nextWakeAt===undefined),'transient scheduling data is not attached to saved items');
}));

test('Random integer and typed sample-and-hold keep their intervals and avoid catch-up bursts',async()=>app(async({run})=>{
  const fixtures=[
    {key:'randomInteger',steps:[[0,{min:7,max:7}],[500,{min:7,max:7}],[1000,{min:7,max:7}],[100000,{min:7,max:7}],[100010,{min:-3,max:-3}]],
      values:[7,7,7,7,-3],wakes:[1000,1000,2000,101000,101010]},
    {key:'sampleHoldInteger',steps:[[0,{value:7,seconds:1}],[100,{value:99,seconds:1}],[1000,{value:99,seconds:1}],[5000,{value:-3,seconds:1}],[5100,{value:8,seconds:.25}]],
      values:[7,7,99,-3,8],wakes:[1000,1000,2000,6000,5350]},
    {key:'sampleHoldBoolean',steps:[[0,{value:false,seconds:1}],[100,{value:true,seconds:1}],[1000,{value:true,seconds:1}],[5000,{value:false,seconds:1}],[5100,{value:true,seconds:.25}]],
      values:[false,false,true,false,true],wakes:[1000,1000,2000,6000,5350]}
  ];
  for(const fixture of fixtures){
    const actual=await run(`(async()=>{
      const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===${JSON.stringify(fixture.key)}).items[0]);
      const owner=createSmartExecution(item);let state=item.state,memory={};
      try{
        const results=[];
        for(const [now,inputs] of ${JSON.stringify(fixture.steps)}){
          const next=await requestSmartCall(item,'transition',[inputs,state,memory,{now}],owner);
          state=next.state;memory=next.memory;
          results.push({value:(await requestSmartCall(item,'compute',[inputs,state],owner)).value,nextWakeAt:next.nextWakeAt});
        }
        return results;
      }finally{disposeSmartExecution(owner);}
    })()`);
    assert.deepEqual(actual.map(entry=>entry.value),fixture.values,fixture.key+' samples at boundaries and holds input changes between them');
    assert.deepEqual(actual.map(entry=>entry.nextWakeAt),fixture.wakes,fixture.key+' schedules one future boundary after a late wake');
  }
}));

test('rapid accepted Toggle pulses reach a slow Counter in editor and offline HTML without phantom reload edges',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['toggle','delay','counter'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid:'pulse-'+index,x:60+index*390,y:120,
    ...(key==='delay'?{inputValues:{seconds:0},bindings:{value:{uid:'pulse-0',port:'value'}}}:{}),
    ...(key==='counter'?{inputValues:{threshold:2},bindings:{value:{uid:'pulse-1',port:'value'}}}:{})
  }));
  items[2].script=items[2].script.replace('transition(inputs,state,memory){',
    'transition(inputs,state,memory){const until=Date.now()+40;while(Date.now()<until){}');
  setTool('select');selection=[0];editingSmartIdx=0;render();save();`);
  await page.waitForFunction(()=>__test.run("items[2].state.count===0 && smartChildrenCache.has('pulse-2')"));
  const box=await page.locator('#canvas').boundingBox(),point=await run('({x:items[0].x+items[0].w/2,y:items[0].y+items[0].h*.69})');
  for(let n=0;n<4;n++)await page.mouse.click(box.x+point.x,box.y+point.y);
  await page.waitForFunction(()=>__test.run('items[0].state.value===false && items[2].state.count===2'),null,{timeout:10000});
  const toggleHandle=await editorHandle(page,run,0,'toggle');
  await page.waitForFunction(()=>__test.run('items[2].state.count===3'));
  const download=page.waitForEvent('download');await run('exportProject()');
  const project=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.equal(project.items[2].state.count,3);assert.equal(project.items[0].state.value,true);
  assert.ok(project.items.every(item=>!Object.hasOwn(item,'memory') && !Object.hasOwn(item,'nextWakeAt')));
  await page.reload();await run('appStarted');
  await page.waitForFunction(()=>__test.run("smartChildrenCache.has('pulse-2')"));
  assert.equal(await run('items[2].state.count'),3,'a saved high signal does not become another rising edge on reload');
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===3);
  const readerCount=async count=>{
    await preview.waitForFunction(count=>{
      const host=document.querySelector('[data-smart-index="2"]');
      return host?.dataset.smartReady==='true' && [...host.querySelectorAll('text')].filter(text=>text.textContent===String(count)).length===2;
    },count);
  };
  await readerCount(3);
  for(let n=0;n<4;n++)await readerClick(preview,0,toggleHandle);
  await readerCount(5);
  const reset=await run(`(async()=>{
    const item=items[2],io=await resolveSmartComponentIo(item);
    return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='reset');
  })()`);
  await readerClick(preview,2,reset);await readerCount(0);
  await readerClick(preview,0,toggleHandle);await readerClick(preview,0,toggleHandle);await readerCount(1);
  assert.equal(await run('items[2].state.count'),3,'reader state remains local to the downloaded document');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('Inputs inspection and inactive or hidden reader documents pause pending Delay transitions',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['toggle','delay','counter'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid:'pause-'+index,x:60+index*390,y:120,
    ...(key==='delay'?{inputValues:{seconds:.4},bindings:{value:{uid:'pause-0',port:'value'}}}:{}),
    ...(key==='counter'?{bindings:{value:{uid:'pause-1',port:'value'}}}:{})
  }));selection=[];setTool('select');render();save();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.has('pause-2')"));
  const toggle=await editorHandle(page,run,0,'toggle');
  await run('selection=[1];render()');await page.locator('#componentBindingsBtn').click();
  await page.getByLabel('seconds value',{exact:true}).waitFor({state:'visible'});
  await page.waitForTimeout(500);
  assert.deepEqual(await run('[items[1].state.value,items[2].state.count]'),[false,0],'inspecting inputs must not consume a pending delayed signal');
  await page.locator('#componentBindingsCancel').click();
  await page.waitForFunction(()=>__test.run('items[1].state.value===true && items[2].state.count===1'));
  await run(`(()=>{const first=activeTabId;newTab();activateTab(first);})()`);
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===3);
  const readerOutput=async value=>{
    await preview.waitForFunction(value=>new RegExp('Output:\\s*'+value).test(document.querySelector('[data-smart-index="1"]')?.textContent||''),String(value));
  };
  await readerOutput(true);
  await readerClick(preview,0,toggle);
  await preview.waitForFunction(()=>/Input:\s*false/.test(document.querySelector('[data-smart-index="1"]')?.textContent||''));
  await preview.locator('.tab-select').nth(1).click();await preview.waitForTimeout(500);
  assert.match(await preview.locator('[data-smart-index="1"]').textContent(),/Output:\s*true/,'time in another tab does not expire the signal');
  await preview.locator('.tab-select').nth(0).click();await readerOutput(false);
  await readerClick(preview,0,toggle);
  await preview.waitForFunction(()=>/Input:\s*true/.test(document.querySelector('[data-smart-index="1"]')?.textContent||''));
  await preview.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await preview.waitForTimeout(500);
  assert.match(await preview.locator('[data-smart-index="1"]').textContent(),/Output:\s*false/,'hidden document time does not expire the signal');
  await preview.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await readerOutput(true);
  await preview.waitForFunction(()=>[...document.querySelectorAll('[data-smart-index="2"] text')].filter(text=>text.textContent==='2').length===2);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('typed sample-and-hold and Random integer feed live outputs in saved and offline documents',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['numberControl','toggle','sampleHoldInteger','sampleHoldBoolean','randomInteger','valueLabel'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid:'sample-'+index,
    x:50+(index%3)*400,y:100+Math.floor(index/3)*280,
    ...(key==='sampleHoldInteger'?{inputValues:{seconds:1},bindings:{value:{uid:'sample-0',port:'value'}}}:{}),
    ...(key==='sampleHoldBoolean'?{inputValues:{seconds:1},bindings:{value:{uid:'sample-1',port:'value'}}}:{}),
    ...(key==='randomInteger'?{inputValues:{min:7,max:7}}:{}),
    ...(key==='valueLabel'?{bindings:{value:{uid:'sample-4',port:'value'}}}:{})
  }));selection=[];setTool('select');render();save();`);
  await page.waitForFunction(()=>__test.run("items.every(item=>smartChildrenCache.has(item.uid))"));
  for(const index of [2,3]){
    await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
    await page.getByLabel('seconds value',{exact:true}).fill('.4');await page.locator('#componentBindingsSave').click();
    await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  }
  const plus=await editorHandle(page,run,0,'plus'),toggle=await editorHandle(page,run,1,'toggle');
  await page.waitForFunction(()=>__test.run('items[2].state.value===51 && items[3].state.value===true && items[4].state.value===7'));
  const download=page.waitForEvent('download');await run('exportProject()');
  const project=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.deepEqual(project.items.slice(2,5).map(item=>item.state.value),[51,true,7]);
  assert.deepEqual(project.items.slice(2,4).map(item=>item.inputValues.seconds),[.4,.4]);
  await page.reload();await run('appStarted');
  await page.waitForFunction(()=>__test.run("items.every(item=>smartChildrenCache.has(item.uid))"));
  assert.deepEqual(await run('items.slice(2,5).map(item=>item.state.value)'),[51,true,7]);
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===6);
  assert.match(await preview.locator('[data-smart-index="2"]').textContent(),/Output\s*51/);
  assert.match(await preview.locator('[data-smart-index="3"]').textContent(),/Output:?\s*true/);
  assert.ok(await preview.locator('[data-smart-index="5"] text').evaluateAll(texts=>texts.some(text=>text.textContent==='7')));
  await readerClick(preview,0,plus);await readerClick(preview,1,toggle);
  await preview.waitForFunction(()=>/Output\s*52/.test(document.querySelector('[data-smart-index="2"]')?.textContent||'') &&
    /Output:?\s*false/.test(document.querySelector('[data-smart-index="3"]')?.textContent||''));
  assert.doesNotMatch((await preview.locator('[data-smart-index]').allTextContents()).join(' '),/Indicators:/,'temporal author controls stay hidden in offline HTML');
  assert.deepEqual(await run('items.slice(2,5).map(item=>item.state.value)'),[51,true,7]);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('interaction hooks use the state committed by their own temporal graph settlement',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    cancelGesture();items=['toggle','delay','counter'].map((key,index)=>({
      ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid:'hook-'+index,
      ...(key==='delay'?{inputValues:{value:false,seconds:0}}:{}),
      ...(key==='counter'?{inputValues:{value:false}}:{})
    }));await ensureEditorComponentGraph();
    items[1].inputValues.value=true;editorComponentEvaluation=null;
    const toggle=items[0],hit=await requestSmartCall(toggle,'hitEdit',[toggle.state,toggle.w/2,toggle.h*.69,toggle.w,toggle.h,smartResolvedStyle(toggle)]);
    items[2].inputValues.value=true;editorComponentEvaluation=null;
    const counter=items[2],before=clone(counter.state);
    const updated=await requestSmartCall(counter,'dragEdit',[before,'indicators',counter.w*.74,counter.h*.905,counter.w,counter.h,smartResolvedStyle(counter)]);
    return {hit,delayed:items[1].state.value,before,committed:counter.state,updated};
  })()`);
  assert.equal(result.hit,'toggle','an unrelated timer settlement must not discard an accepted interaction');
  assert.equal(result.delayed,true);
  assert.equal(result.before.count,0);assert.equal(result.committed.count,1);
  assert.deepEqual(result.updated,{count:1,configuredDirection:'up',configuredStart:3,showIndicators:false},'the hook must receive the newly committed count instead of overwriting it with stale state');
}));

test('invalid temporal replies and failed compute withhold their staged state while a healthy branch commits',async()=>app(async({run})=>{
  const script=`({apiVersion:2,inputs:{mode:{type:'string',default:'good'}},outputs:{value:{type:'number'}},
    transition(inputs,state,memory,{now}){
      if(inputs.mode==='throw')throw new Error('Transition rejected');
      return {state:{value:state.value+1},
        memory:inputs.mode==='memory'?'invalid':inputs.mode==='oversized'?{payload:'x'.repeat(5000)}:{committed:state.value+1},
        nextWakeAt:inputs.mode==='deadline'?-1:now+100};
    },
    compute(inputs,state){if(inputs.mode==='compute')throw new Error('Compute rejected');return {value:state.value};},
    children(){return [];}
  })`;
  for(const [mode,error] of [['memory',/JSON object/],['oversized',/4000/],['deadline',/wake time/i],['throw',/Transition rejected/],['compute',/Compute rejected/]]){
    const result=await run(`(async()=>{
      const failing={type:'smart',componentApi:2,uid:'failing',script:${JSON.stringify(script)},state:{value:0},inputValues:{mode:'good'}};
      const healthy={...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key==='counter').items[0]),uid:'healthy',inputValues:{value:false,threshold:1}};
      const list=[failing,healthy],owners=new Map(list.map(item=>[item,createSmartExecution(item)]));
      const call=(item,hook,args)=>hook==='caps'?requestSmartCaps(item,owners.get(item)):requestSmartCall(item,hook,args,owners.get(item));
      const timeline=createComponentTimeline(()=>0);resumeComponentTimeline(timeline);
      try{
        await settleComponentTimeline(list,call,()=>true,timeline);
        failing.inputValues.mode=${JSON.stringify(mode)};healthy.inputValues.value=true;
        const graph=await settleComponentTimeline(list,call,()=>true,timeline);
        return {error:graph.get(failing).error,outputs:graph.get(failing).io.outputs,state:failing.state,
          retainedFailure:timeline.observations.has(failing),healthy:graph.get(healthy).io.outputs,
          healthyState:healthy.state,healthyMemory:timeline.observations.get(healthy).memory};
      }finally{for(const owner of owners.values())disposeSmartExecution(owner);}
    })()`);
    assert.match(result.error,error,mode+' retains a readable error');
    assert.deepEqual(result.outputs,{});assert.deepEqual(result.state,{value:1},mode+' cannot commit its proposed second value');
    assert.equal(result.retainedFailure,false,mode+' cannot leave accepted scheduling memory behind');
    assert.deepEqual(result.healthy,{count:1,reached:true});assert.equal(result.healthyState.count,1);
    assert.deepEqual(result.healthyMemory,{previous:true},'a healthy independent Counter commits both state and memory');
  }
}));

test('a superseded temporal evaluation commits neither staged state nor scheduling memory',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    const make=(key,uid,inputValues)=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid,inputValues});
    const delay=make('delay','stale-delay',{value:false,seconds:.1}),counter=make('counter','stale-counter',{value:false});
    const list=[delay,counter],owners=new Map(list.map(item=>[item,createSmartExecution(item)]));
    const call=(item,hook,args)=>hook==='caps'?requestSmartCaps(item,owners.get(item)):requestSmartCall(item,hook,args,owners.get(item));
    let now=0;const timeline=createComponentTimeline(()=>now);resumeComponentTimeline(timeline);
    try{
      await settleComponentTimeline(list,call,()=>true,timeline);
      delay.inputValues.value=true;counter.inputValues.value=true;now=10;
      let release,entered;
      const blocked=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
      const pending=settleComponentTimeline(list,async(item,hook,args)=>{
        const reply=await call(item,hook,args);
        if(item===counter && hook==='transition'){entered();await gate;}
        return reply;
      },()=>true,timeline).then(()=>({cancelled:false}),error=>({cancelled:!!error.cancelled}));
      await blocked;
      delay.inputValues.value=false;counter.inputValues.value=false;now=20;
      await settleComponentTimeline(list,call,()=>true,timeline);
      const snapshot=()=>({states:list.map(item=>clone(item.state)),memory:list.map(item=>clone(timeline.observations.get(item).memory)),deadline:timeline.deadline});
      const before=snapshot();release();const cancelled=await pending;
      return {before,after:snapshot(),cancelled};
    }finally{for(const owner of owners.values())disposeSmartExecution(owner);}
  })()`);
  assert.deepEqual(result.cancelled,{cancelled:true});
  assert.deepEqual(result.after,result.before,'the older reply cannot replace current state, memory, or wake time');
  assert.deepEqual(result.after.states,[{value:false,showIndicators:true},{count:0,configuredDirection:'up',configuredStart:3,showIndicators:true}]);
  assert.deepEqual(result.after.memory,[{previous:false,seconds:.1,queue:[]},{previous:false}]);
  assert.equal(result.after.deadline,Infinity,'no rejected rising pulse remains scheduled');
}));

test('rewiring an upstream branch and recovering an unavailable input re-prime Counter without phantom edges',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    const make=(key,uid,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid,...extra});
    const low=make('toggle','low'),high=make('toggle','high',{state:{value:true}});
    const buffer=make('buffer','relay',{bindings:{value:{uid:'low',port:'value'}}});
    const counter=make('counter','rewired-counter',{bindings:{value:{uid:'relay',port:'value'}}});
    const list=[low,high,buffer,counter],owners=new Map(list.map(item=>[item,createSmartExecution(item)]));
    const call=(item,hook,args)=>hook==='caps'?requestSmartCaps(item,owners.get(item)):requestSmartCall(item,hook,args,owners.get(item));
    const timeline=createComponentTimeline(()=>0);resumeComponentTimeline(timeline);
    const step=async()=>{const graph=await settleComponentTimeline(list,call,()=>true,timeline);return {count:counter.state.count,error:graph.get(counter).error||'',outputs:graph.get(counter).io.outputs,memory:timeline.observations.get(counter)?.memory};};
    try{
      const snapshots=[await step()];
      buffer.bindings.value.uid='high';snapshots.push(await step());
      high.state.value=false;await step();high.state.value=true;snapshots.push(await step());
      buffer.bindings.value.uid='missing';snapshots.push(await step());
      buffer.bindings.value.uid='high';snapshots.push(await step());
      high.state.value=false;await step();high.state.value=true;snapshots.push(await step());
      return snapshots;
    }finally{for(const owner of owners.values())disposeSmartExecution(owner);}
  })()`);
  assert.deepEqual(result.map(entry=>entry.count),[0,0,1,1,1,2]);
  assert.match(result[3].error,/unavailable|Missing source/i);
  assert.deepEqual(result[3].outputs,{});assert.equal(result[3].memory,undefined);
  for(const index of [0,1,2,4,5])assert.equal(result[index].error,'');
  assert.deepEqual(result[4].memory,{previous:true},'recovery records the current high signal as a new baseline');
}));

test('Trigger queues one 100ms pulse per press with a low gap and never replays restored high state',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key==='trigger').items[0]);
    const owner=createSmartExecution(item);let state=item.state,memory={};
    const step=async(now,press=false)=>{
      if(press)state=(await requestSmartSandbox({method:'call',src:item.script,fn:'dragEdit',args:[state,'trigger']},item,owner)).result;
      const next=await requestSmartCall(item,'transition',[{},state,memory,{now}],owner);
      state=next.state;memory=next.memory;
      return {value:(await requestSmartCall(item,'compute',[{},state],owner)).value,press:state.press,nextWakeAt:next.nextWakeAt};
    };
    try{
      const initial=await step(0),queued=[];
      for(const at of [10,20,30])queued.push(await step(at,true));
      const phases=[];for(const at of [109,110,119,120,220,229,230,330,340,1000])phases.push(await step(at));
      const restored=await requestSmartCall(item,'transition',[{},{value:true,press:3,showIndicators:false},{},{now:0}],owner);
      const idle=await requestSmartCall(item,'transition',[{},restored.state,restored.memory,{now:10000}],owner);
      return {initial,queued,phases,restored:{state:restored.state,nextWakeAt:restored.nextWakeAt},idle:{state:idle.state,nextWakeAt:idle.nextWakeAt}};
    }finally{disposeSmartExecution(owner);}
  })()`);
  assert.deepEqual(result.initial,{value:false,press:0,nextWakeAt:null});
  assert.deepEqual(result.queued,[1,2,3].map(press=>({value:true,press,nextWakeAt:110})),'later presses queue instead of extending the active high pulse');
  assert.deepEqual(result.phases.map(entry=>entry.value),[true,false,false,true,false,false,true,false,false,false]);
  assert.deepEqual(result.phases.slice(0,7).map(entry=>entry.nextWakeAt),[110,120,120,220,230,230,330]);
  assert.equal(result.phases.at(-1).nextWakeAt,null,'an idle button does not repeat pulses');
  const idle={state:{value:false,press:3,showIndicators:false},nextWakeAt:null};
  assert.deepEqual(result.restored,idle);assert.deepEqual(result.idle,idle,'stored press tokens cannot replay in a fresh runtime');
}));

test('Trigger button emits once on release, queues rapid clicks, and works offline without replaying a saved pulse',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['trigger','counter'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid:'trigger-ui-'+index,x:120+index*430,y:140,
    ...(key==='counter'?{bindings:{value:{uid:'trigger-ui-0',port:'value'}},inputValues:{threshold:3}}:{})
  }));setTool('select');selection=[0];editingSmartIdx=0;render();save();`);
  await page.waitForFunction(()=>__test.run("items.every(item=>smartChildrenCache.has(item.uid))"));
  const {item,handle}=await run(`(async()=>{
    const item=items[0],io=await resolveSmartComponentIo(item);
    return {item,handle:(await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='trigger')};
  })()`);
  assert.notEqual(handle.editorOnly,true,'the pushbutton is a reader control');
  const box=await page.locator('#canvas').boundingBox(),point={x:box.x+item.x+handle.x,y:box.y+item.y+handle.y};
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(250);
  assert.deepEqual(await run('[items[0].state.press,items[0].state.value,items[1].state.count]'),[0,false,0],'holding the pointer does not emit or repeat');
  await page.mouse.up();await run('smartHitSettled');
  await page.waitForFunction(()=>__test.run('items[1].state.count===1 && items[0].state.value===false'));
  for(let n=0;n<3;n++)await page.mouse.click(point.x,point.y);
  await page.waitForFunction(()=>__test.run('items[1].state.count===4 && items[0].state.value===false'));
  assert.equal(await run('items[0].state.press'),4);
  // Capture the real Save operation during a high pulse in the same browser
  // callback, so machine speed cannot turn this into an already-idle snapshot.
  const download=page.waitForEvent('download');
  const captured=page.waitForFunction(()=>__test.run('items[0].state.value===true && (exportProject(),true)'));
  await page.mouse.click(point.x,point.y);await captured;
  const project=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.equal(project.items[0].state.value,true);assert.equal(project.items[0].state.press,5);assert.equal(project.items[1].state.count,5);
  await run('applySketchToActiveTab([],{})');
  await page.locator('#projectInput').setInputFiles({name:'active-trigger.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await page.waitForFunction(()=>__test.run("items.length===2 && items[0].uid==='trigger-ui-0' && items[0].state.value===false && smartChildrenCache.has(items[1].uid)"));
  await page.waitForTimeout(250);assert.equal(await run('items[1].state.count'),5,'reopening a saved high pulse does not replay it');
  // Export the captured high snapshot itself, so the reader also starts with a
  // stored true output and nonzero press token rather than an editor-cleaned copy.
  await run(`items=${JSON.stringify(project.items)};rememberActiveTab();`);
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===2);
  const readerIdle=async count=>{
    await preview.waitForFunction(count=>/Output:\s*false/.test(document.querySelector('[data-smart-index="0"]')?.textContent||'') &&
      [...document.querySelectorAll('[data-smart-index="1"] text')].filter(text=>text.textContent===String(count)).length===2,count);
  };
  await readerIdle(5);
  for(let n=0;n<3;n++)await readerClick(preview,0,handle);
  await readerIdle(8);
  await preview.reload();await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===2);
  await readerIdle(5);await page.waitForTimeout(250);await readerIdle(5);
  assert.doesNotMatch((await preview.locator('[data-smart-index]').allTextContents()).join(' '),/Indicators:/);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
