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
    await page.route('http://shift-register.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://shift-register.test/index.html');
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
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-shift-'));
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

test('typed shift registers cascade on the same pulse without skipping the old tail',async()=>app(async({run})=>{
  const results=await run(`(async()=>{
    const results=[];
    for(const [key,sourceKey,values,empty] of [
      ['shiftRegisterNumber','constant',[11,22,33,44,55],0],
      ['shiftRegisterBoolean','toggle',[true,false,true,true,false],false]
    ]){
      const make=(key,uid,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid,...extra});
      const data=make(sourceKey,'data'),pulse=make('toggle','pulse');
      const first=make(key,'first',{bindings:{value:{uid:'data',port:'value'},pulse:{uid:'pulse',port:'value'}}});
      first.state={...first.state,stages:2,configuredStages:2,cells:[empty,empty],shiftedOut:empty};
      const second=make(key,'second',{bindings:{value:{uid:'first',port:'value'},pulse:{uid:'pulse',port:'value'}}});
      second.state={...second.state,stages:2,configuredStages:2,cells:[empty,empty],shiftedOut:empty};
      const independent=clone(first);independent.uid='independent';independent.state.cells=[empty,empty];
      // Reverse scene order: all registers sample the same old output snapshot on the shared pulse.
      const list=[second,independent,first,pulse,data],owners=new Map(list.map(item=>[item,createSmartExecution(item)]));
      let transitions=0;const timeline=createComponentTimeline(()=>0);resumeComponentTimeline(timeline);
      const call=(item,hook,args)=>{
        if(hook==='transition')transitions++;
        return hook==='caps'?requestSmartCaps(item,owners.get(item),args[0]):requestSmartCall(item,hook,args,owners.get(item));
      };
      const settle=()=>settleComponentTimeline(list,call,()=>true,timeline);
      const samples=[];
      try{
        data.state.value=empty;pulse.state.value=false;await settle();
        for(const value of values){
          data.state.value=value;pulse.state.value=false;await settle();
          pulse.state.value=true;const graph=await settle();
          samples.push({first:graph.get(first).io.outputs,second:graph.get(second).io.outputs,
            error:[...graph.values()].map(record=>record.error||'')});
        }
        const before=JSON.stringify(list),beforeCalls=transitions;
        await evaluateComponentGraph(list,call);await inspectComponentGraph(list,()=>true);
        const pure={unchanged:JSON.stringify(list)===before,transitions:transitions-beforeCalls};
        const fresh=createComponentTimeline(()=>0);resumeComponentTimeline(fresh);await settleComponentTimeline(list,call,()=>true,fresh);
        const restored=clone(first.state);
        first.inputValues={reset:true};await settle();
        results.push({key,samples,pure,restored,reset:clone(first.state),independent:clone(independent.state)});
      }finally{for(const owner of owners.values())disposeSmartExecution(owner);}
    }
    return results;
  })()`);
  const sequences=[[11,22,33,44,55],[true,false,true,true,false]],empties=[0,false];
  for(const [index,result] of results.entries()){
    const values=sequences[index],empty=empties[index];
    for(const [step,sample] of result.samples.entries()){
      const at=offset=>step-offset>=0?values[step-offset]:empty;
      assert.deepEqual(sample.first,{q0:at(0),q1:at(1),value:at(1),shiftedOut:at(2)},result.key+' first register pulse '+step);
      assert.deepEqual(sample.second,{q0:at(2),q1:at(3),value:at(3),shiftedOut:at(4)},result.key+' cascaded pulse '+step);
      assert.ok(sample.error.every(error=>error===''));
    }
    assert.deepEqual(result.pure,{unchanged:true,transitions:0});
    assert.deepEqual(result.restored.cells,[values[4],values[3]],'a restored high pulse does not shift saved cells');
    assert.deepEqual(result.reset.cells,[empty,empty]);assert.equal(result.reset.shiftedOut,empty);
    assert.deepEqual(result.independent.cells,[values[4],values[3]],'resetting one instance leaves its copy unchanged');
  }
}));

async function editorCells(page,expected){
  await page.waitForFunction(expected=>__test.run('items[1].state.value===false && JSON.stringify(items[2].state.cells)==='+JSON.stringify(JSON.stringify(expected))),expected);
}

test('Edit configures stages and parallel outputs; Trigger samples data and saved cells reload',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['toggle','trigger','shiftRegisterBoolean','statusIndicator'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),
    uid:'shift-ui-'+index,x:100+(index%2)*560,y:100+Math.floor(index/2)*330
  }));setTool('select');selection=[2];render();save();`);
  await page.locator('#componentBindingsBtn').click();
  await page.getByLabel('Stages',{exact:true}).fill('3');await page.getByLabel('Stages',{exact:true}).press('Tab');
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsSave').disabled);
  await page.getByLabel('value (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'shift-ui-0',port:'value'}));
  await page.getByLabel('pulse (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'shift-ui-1',port:'value'}));
  await page.locator('#componentNameInput').fill('Shift history');await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);await editorCells(page,[false,false,false]);
  const ports=await run('requestSmartCaps(items[2])');
  assert.deepEqual(Object.keys(ports.outputs),['q0','q1','q2','value','shiftedOut']);
  await run('selection=[3];render()');await page.locator('#componentBindingsBtn').click();
  await page.locator('#componentInputFields .component-input select').first().selectOption(JSON.stringify({uid:'shift-ui-2',port:'q1'}));
  await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  const toggle=await editorHandle(page,run,0,'toggle');await editorCells(page,[false,false,false]);
  const pulse=await editorHandle(page,run,1,'trigger');await editorCells(page,[true,false,false]);
  await editorHandle(page,run,0,'toggle');await editorHandle(page,run,1,'trigger');await editorCells(page,[false,true,false]);
  assert.equal((await run('resolveSmartComponentIo(items[3])')).inputs.value,true,'a parallel output can drive a status indicator');
  await editorHandle(page,run,0,'toggle');await editorHandle(page,run,1,'trigger');await editorCells(page,[true,false,true]);
  await editorHandle(page,run,1,'trigger');await editorCells(page,[true,true,false]);
  assert.equal((await run('resolveSmartComponentIo(items[2])')).outputs.shiftedOut,true);
  const download=page.waitForEvent('download');await run('exportProject()');
  const project=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.deepEqual(project.items[2].state.cells,[true,true,false]);assert.equal(project.items[2].state.shiftedOut,true);
  assert.equal(project.items[2].state.stages,3);assert.equal(project.items[2].state.configuredStages,3);
  await page.reload();await run('appStarted');await editorCells(page,[true,true,false]);
  const reset=await run(`(async()=>{
    const item=items[2];return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)])).find(handle=>handle.id==='reset');
  })()`);
  assert.notEqual(reset.editorOnly,true);
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===4);
  assert.match(await preview.locator('[data-smart-index="2"]').textContent(),/Shift history/);
  // The bound q1 indicator exposes the register's parallel output through real SVG paint.
  const readerQ1=async on=>preview.waitForFunction(on=>{
    const host=document.querySelector('[data-smart-index="3"]');
    return [...(host?.querySelectorAll('ellipse')||[])].some(ellipse=>ellipse.getAttribute('fill')===(on?'#15803d':'#64748b'));
  },on);
  const readerCells=async expected=>preview.waitForFunction(expected=>{
    const register=document.querySelector('[data-smart-index="2"]'),pulse=document.querySelector('[data-smart-index="1"]');
    const text=[...(register?.querySelectorAll('text')||[])].map(element=>element.textContent);
    return register?.dataset.smartReady==='true' && /Output:\s*false/.test(pulse?.textContent||'') &&
      expected.every((value,index)=>text[text.indexOf('Q'+index)+1]===(value?'1':'0'));
  },expected);
  await readerCells([true,true,false]);await readerQ1(true);
  await readerClick(preview,2,reset);await readerCells([false,false,false]);await readerQ1(false);
  await readerClick(preview,1,pulse);await readerCells([true,false,false]);await readerQ1(false);
  await readerClick(preview,1,pulse);await readerCells([true,true,false]);await readerQ1(true);
  await readerClick(preview,1,pulse);await readerCells([true,true,true]);
  await readerClick(preview,0,toggle);await readerClick(preview,1,pulse);await readerCells([false,true,true]);
  await preview.reload();await readerCells([true,true,false]);await readerQ1(true);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
