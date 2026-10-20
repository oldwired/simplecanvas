const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

// Expose only the served copy's closure. Component calls still cross the real
// Worker boundary; downloaded HTML runs its own unmodified runtime.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://counter-modes.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://counter-modes.test/index.html');
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
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-counter-'));
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

test('Counter up/down contracts preserve edges, configuration, reset, and saved counts',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key==='counter').items[0]);
    const owner=createSmartExecution(item),caps=await requestSmartCaps(item,owner);
    let state=await requestSmartCall(item,'initState',[],owner),memory={};
    let inputs={value:true,threshold:3,reset:false,direction:'down',start:3};
    const initial=clone(state),results=[];
    const step=async(changes={})=>{
      inputs={...inputs,...changes};
      const next=await requestSmartCall(item,'transition',[inputs,state,memory,{now:0}],owner);
      state=next.state;memory=next.memory;
      const outputs=await requestSmartCall(item,'compute',[inputs,state],owner);results.push(outputs);return outputs;
    };
    try{
      await step();await step();await step({value:false});await step({value:true});
      await step({threshold:99});await step({start:5});await step();
      await step({value:false});await step({value:true});
      await step({reset:true});await step({value:false});await step({value:true});await step({reset:false});
      await step({value:false});await step({value:true});
      const saved=clone(state),restored=await requestSmartCall(item,'transition',[inputs,saved,{}, {now:0}],owner);
      await step({direction:'up'});await step({start:10});await step({value:false});await step({value:true});
      await step({start:11});await step({threshold:1});
      const before=JSON.stringify(state),pendingInputs={...inputs,direction:'down',start:7};
      const pending=await requestSmartCall(item,'compute',[pendingInputs,state],owner);
      const pure=before===JSON.stringify(state);
      await step({direction:'down',start:0});await step({value:false});await step({value:true});await step();
      const manualInputs={...inputs,start:6},manualState={...state,count:1,configuredDirection:'down',configuredStart:6};
      const io={inputs:manualInputs,outputs:await requestSmartCall(item,'compute',[manualInputs,manualState],owner)};
      const reset=(await requestSmartSandbox({method:'call',src:item.script,fn:'dragEdit',args:[manualState,'reset',0,0,item.w,item.h,smartResolvedStyle(item),io]},item,owner)).result;
      const afterReset=await requestSmartCall(item,'transition',[manualInputs,reset,{previous:true},{now:0}],owner);
      const upInputs={...manualInputs,direction:'up'},upState={...state,count:9,configuredDirection:'up',configuredStart:6};
      const resetUp=(await requestSmartSandbox({method:'call',src:item.script,fn:'dragEdit',args:[upState,'reset',0,0,item.w,item.h,smartResolvedStyle(item),{inputs:upInputs,outputs:{count:9,reached:true}}]},item,owner)).result;
      const simultaneous=[];
      for(const [configuredDirection,configuredStart,count,changes] of [
        ['up',3,4,{direction:'down',start:3}],
        ['down',3,2,{direction:'down',start:5}],
        ['up',3,4,{direction:'up',start:5}],
        ['up',3,4,{direction:'up',start:3,threshold:5}]
      ]){
        const values={value:true,reset:false,threshold:99,...changes};
        const snapshot={...initial,count,configuredDirection,configuredStart};
        const next=await requestSmartCall(item,'transition',[values,snapshot,{previous:false},{now:0}],owner);
        simultaneous.push(await requestSmartCall(item,'compute',[values,next.state],owner));
      }
      const errors=[];
      for(const changes of [{direction:'sideways'},{start:-1},{start:1.5},{start:Number.MAX_SAFE_INTEGER+1},{threshold:-1}]){
        try{await requestSmartCall(item,'compute',[{...inputs,...changes},state],owner);errors.push('');}catch(error){errors.push(error.message);}
      }
      let overflow='';
      try{await requestSmartCall(item,'transition',[{...inputs,direction:'up'}, {...state,count:Number.MAX_SAFE_INTEGER,configuredDirection:'up'}, {previous:false},{now:0}],owner);}catch(error){overflow=error.message;}
      return {initial,caps,results,restored:restored.state,pending,pure,reset,afterReset:afterReset.state,resetUp,simultaneous,errors,overflow};
    }finally{disposeSmartExecution(owner);}
  })()`);
  assert.equal(result.initial.configuredDirection,'up');assert.equal(result.initial.configuredStart,3);
  assert.deepEqual(result.caps.inputs.direction,{role:'control',type:'string',default:'up',options:['up','down']});
  assert.deepEqual(result.caps.inputs.start,{role:'control',type:'number',default:3});
  assert.deepEqual(result.results.map(output=>output.count),[3,3,3,2,2,5,5,5,4,5,5,5,5,5,4,0,0,0,1,1,1,0,0,0,0]);
  assert.deepEqual(result.results.map(output=>output.reached),Array(20).fill(false).concat([true,true,true,true,true]));
  assert.equal(result.restored.count,4,'a restored high input preserves the saved down count');
  assert.deepEqual(result.pending,{count:7,reached:false});assert.equal(result.pure,true,'compute previews a pending configuration without changing saved state');
  assert.equal(result.reset.count,6);assert.equal(result.afterReset.count,6,'manual reset while high cannot consume a second edge');
  assert.equal(result.resetUp.count,0);
  assert.deepEqual(result.simultaneous,[{count:3,reached:false},{count:5,reached:false},{count:5,reached:false},{count:5,reached:true}],
    'direction/down-start changes suppress a coincident edge; up-start and threshold changes still count it');
  assert.ok(result.errors.every(Boolean),'invalid numeric configuration and direction are rejected');
  assert.match(result.overflow,/safe integer range/i);
}));

async function seedPair(run,extra={}){
  await run(`cancelGesture();items=['trigger','counter'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),
    uid:'countdown-'+index,x:120+index*430,y:140,
    ...(key==='counter'?{bindings:{value:{uid:'countdown-0',port:'value'}},...${JSON.stringify(extra)}}:{})
  }));setTool('select');selection=[];render();save();`);
}
async function idleCount(page,count){
  await page.waitForFunction(count=>__test.run('items[0].state.value===false && items[1].state.count==='+count),count);
}

test('Inputs configures a countdown and Trigger reaches zero, resets, and survives undo and reload',async()=>app(async({page,run})=>{
  await seedPair(run);
  await page.waitForFunction(()=>__test.run('items[1].state.count===0'));
  await run('selection=[1];render()');await page.locator('#componentBindingsBtn').click();
  await page.getByLabel('direction value',{exact:true}).selectOption('down');
  await page.getByLabel('start value',{exact:true}).fill('3');
  await page.locator('#componentNameInput').fill('Launch countdown');
  await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  await idleCount(page,3);
  for(const count of [2,1,0,0]){await editorHandle(page,run,0,'trigger');await idleCount(page,count);}
  const view=await run(`(async()=>{
    const io=await resolveSmartComponentIo(items[1]);
    const children=await requestSmartCall(items[1],'children',[items[1].state,smartResolvedStyle(items[1]),items[1].w,items[1].h,true]);
    return {outputs:io.outputs,text:children.filter(child=>child.type==='text').map(child=>child.text),leds:children.filter(child=>child.type==='ellipse').map(child=>child.fillColor)};
  })()`);
  assert.deepEqual(view.outputs,{count:0,reached:true});
  assert.ok(view.text.includes('Launch countdown'));assert.ok(view.text.includes('↓'));
  assert.ok(view.leds.includes('#15803d'),'reached output shows a true indicator at zero');
  await editorHandle(page,run,1,'reset');await idleCount(page,3);
  await run('undo()');await idleCount(page,0);
  await run('redo()');await idleCount(page,3);
  await editorHandle(page,run,0,'trigger');await idleCount(page,2);
  const download=page.waitForEvent('download');await run('exportProject()');
  const project=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.equal(project.items[1].state.count,2);
  assert.equal(project.items[1].state.configuredDirection,'down');assert.equal(project.items[1].state.configuredStart,3);
  assert.equal(project.items[1].inputValues.direction,'down');assert.equal(project.items[1].inputValues.start,3);
  await page.reload();await run('appStarted');await idleCount(page,2);
  await editorHandle(page,run,0,'trigger');await idleCount(page,1);
  assert.deepEqual((await run('resolveSmartComponentIo(items[1])')).outputs,{count:1,reached:false});
}));

test('Exported countdown preserves saved progress, stops at zero, and resets to its start',async()=>app(async({page,run,context})=>{
  await seedPair(run,{inputValues:{direction:'down',start:3}});await idleCount(page,3);
  const trigger=await editorHandle(page,run,0,'trigger');await idleCount(page,2);
  const reset=await run(`(async()=>{
    const item=items[1];return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)])).find(handle=>handle.id==='reset');
  })()`);
  const {preview,errors,requests}=await openExport(page,run,context);
  const readerCount=async(count,reached)=>{
    await preview.waitForFunction(({count,reached})=>{
      const trigger=document.querySelector('[data-smart-index="0"]'),counter=document.querySelector('[data-smart-index="1"]');
      return trigger?.dataset.smartReady==='true' && counter?.dataset.smartReady==='true' && /Output:\s*false/.test(trigger.textContent) &&
        [...counter.querySelectorAll('text')].filter(text=>text.textContent===String(count)).length===2 &&
        new RegExp('Reached:\\s*'+reached).test(counter.textContent);
    },{count,reached});
  };
  await readerCount(2,false);
  for(const count of [1,0,0]){await readerClick(preview,0,trigger);await readerCount(count,count===0);}
  await readerClick(preview,1,reset);await readerCount(3,false);
  await preview.reload();await readerCount(2,false);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
