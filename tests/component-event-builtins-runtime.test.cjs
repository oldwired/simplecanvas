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
after(async()=>browser?.close());
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://event-builtins.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://event-builtins.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
const sourceScript=`({
  apiVersion:2,eventApi:1,inputs:{},outputs(state){return {value:{type:state.type,event:true}};},
  compute(inputs,state){return {value:state.value};},
  children(state,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#fff',strokeOn:true,color:'#64748b',size:1},
    {type:'text',x:4,y:10,w:w-8,h:40,text:'Send '+String(state.value)+' ('+state.presses+')',plainText:true,font:'16px sans-serif',color:'#334155',strokeOn:false}];},
  handles(state,w,h){return [{id:'send',kind:'click',x:w/2,y:h/2}];},
  hitEdit(state,x,y,w,h){return x>=0&&x<=w&&y>=0&&y<=h?'send':null;},
  dragEdit(state){return {state:{...state,presses:state.presses+1},events:Array.from({length:state.burst||1},()=>({port:'value',payload:state.value}))};}
})`;
const logScript=`({
  apiVersion:2,eventApi:1,inputs:{},outputs:{count:{type:'number'}},
  eventInputs:{receive:{types:['none','string','number','boolean']}},
  compute(inputs,state){return {count:state.values.length};},
  onEvent(name,payload,state){return {state:{values:[...state.values,payload]}};},
  children(state,style,w,h){return [{type:'text',x:0,y:0,w,h,text:JSON.stringify(state.values),plainText:true,font:'16px sans-serif',color:'#334155',strokeOn:false}];}
})`;
const source=(type,value,extra={})=>({key:'constant',script:sourceScript,state:{type,value,presses:0,burst:1},w:220,h:80,...extra});
const log=(uid,port)=>({key:'constant',script:logScript,state:{values:[]},eventBindings:{receive:{uid,port}},w:350,h:120});
const bind=(index,port='value')=>({uid:'built-event-'+index,port});
async function seed(run,specs){
  await run(`cancelGesture();items=${JSON.stringify(specs)}.map((spec,index)=>{
    const definition=BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===spec.key);
    if(!definition)throw new Error('Missing built-in '+spec.key);
    const base=clone(definition.items[0]);
    return {...base,uid:'built-event-'+index,x:60+(index%3)*450,y:100+Math.floor(index/3)*330,...spec,state:spec.script?spec.state:{...base.state,...spec.state}};
  });selection=[];editingSmartIdx=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
async function output(run,index){
  return run(`(async()=>{const record=(await ensureEditorComponentGraph()).get(items[${index}]);if(record.error)throw new Error(record.error);return record.io.outputs;})()`);
}
async function handle(run,index,id){
  return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item),handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]);return {item,handle:handles.find(handle=>handle.id===${JSON.stringify(id)})};})()`);
}
async function click(page,run,index,id='send'){
  await run(`selection=[${index}];editingSmartIdx=${index};render()`);
  const point=await handle(run,index,id);assert.ok(point.handle,id+' handle exists');
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+point.item.x+point.handle.x,box.y+point.item.y+point.handle.y);
  await run('smartHitSettled');
}
async function choose(page,run,index,value,{repeat=false}={}){
  await click(page,run,index,'select');
  const list=page.locator('select[data-smart-inline-input="choice"]');await list.waitFor();
  if(repeat)await list.press('Enter');else await list.selectOption(String(value));
  await list.waitFor({state:'detached'});await run('smartHitSettled');
}
async function pause(page,run){await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');}
async function patch(run,index,patch){
  await run(`items[${index}].state={...items[${index}].state,...${JSON.stringify(patch)}};editorComponentEvaluation=null;render();ensureEditorComponentGraph()`);
}
async function waitCount(page,index,count){
  await page.waitForFunction(({index,count})=>__test.run(`items[${index}].state.count`)===count,{index,count});
}
async function openExport(page,run,context,{initiallyPaused=false}={}){
  const pending=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-event-builtins-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'example.html');
  let body=fs.readFileSync(await(await pending).path(),'utf8');
  if(initiallyPaused){
    // Pause before the first graph evaluation to exercise an accepted event with no
    // transition memory. Everything else uses the actual exported runtime and Workers.
    const hook='doc.timeline=createComponentTimeline();';assert.ok(body.includes(hook));
    body=body.replace(hook,hook+'doc.timeline.pausedByUser=true;');
  }
  fs.writeFileSync(file,body);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  return {reader,errors,requests};
}
async function readerReady(reader,count){await reader.waitForFunction(count=>document.querySelectorAll('[data-smart-ready="true"]').length===count,count);}
async function readerClick(reader,index,at){
  const host=reader.locator('[data-smart-index="'+index+'"]');
  await reader.waitForFunction(el=>el.dataset.smartReady==='true',await host.elementHandle());
  const point=await host.evaluate((host,at)=>{const p=new DOMPoint(at.x,at.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},at);
  await reader.mouse.click(point.x,point.y);
}
async function readerExact(reader,index,text,count=1){
  await reader.waitForFunction(({index,text,count})=>[...document.querySelectorAll('[data-smart-index="'+index+'"] text')].filter(node=>node.textContent===text).length===count,{index,text,count});
}

test('Dropdown UI submissions emit once, including choosing the same row; dataset refresh only changes values',async()=>app(async({page,run})=>{
  await seed(run,[{key:'dropdown'},{key:'memo',bindings:{line:bind(0,'text')}},log('built-event-0','index')]);
  await pause(page,run);
  await choose(page,run,0,1);await choose(page,run,0,1,{repeat:true});
  assert.equal((await output(run,1)).text,'Running\nRunning');
  assert.deepEqual(await run('items[2].state.values'),[1,1]);
  await run(`datasets={choices:{name:'Choices',columns:[{key:'text',name:'Text',type:'string'}],rows:[['Alpha'],['Beta']]}};
    items[0].state.source='dataset';items[0].inputValues={data:{datasetId:'choices'},textColumn:'text',keyColumn:'',select:1};editorComponentEvaluation=null;render();ensureEditorComponentGraph();`);
  assert.equal((await output(run,0)).text,'Beta');assert.equal((await output(run,1)).lineCount,2);
  await run(`datasets.choices.rows[1][0]='Updated beta';editorComponentEvaluation=null;render();ensureEditorComponentGraph();`);
  assert.equal((await output(run,0)).text,'Updated beta');assert.equal((await output(run,1)).lineCount,2);
  await choose(page,run,0,1,{repeat:true});
  assert.equal((await output(run,1)).text,'Running\nRunning\nUpdated beta');
  await run('undo();ensureEditorComponentGraph()');assert.equal((await output(run,1)).lineCount,2);
}));

test('HTML Dropdown emits its dataset row beyond the preview and repeats explicit accepted selections',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'dropdown',state:{source:'dataset'},inputValues:{data:{datasetId:'choices'},textColumn:'text',keyColumn:'',select:0}},
    {key:'memo',bindings:{line:bind(0,'text')}}]);
  await run(`datasets={choices:{name:'Choices',columns:[{key:'text',name:'Text',type:'string'}],rows:Array.from({length:40},(_,i)=>['Choice '+i])}};editorComponentEvaluation=null;render();ensureEditorComponentGraph();`);
  const point=(await handle(run,0,'select')).handle,{reader,errors,requests}=await openExport(page,run,context);
  await readerReady(reader,2);
  for(let count=1;count<=2;count++){
    await readerClick(reader,0,point);const list=reader.locator('select[data-smart-inline-input="choice"]');await list.waitFor();
    if(count===1)await list.selectOption('39');else await list.press('Enter');
    await list.waitFor({state:'detached'});await readerExact(reader,1,'Choice 39',count);
  }
  await reader.reload();await readerReady(reader,2);await readerExact(reader,1,'Choice 39',0);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

for(const [key,type,a,b,changed] of [
  ['textSelector','string','Alpha','Beta','Changed'],
  ['selectorNumber','number',1.25,2.8,-5.5],
  ['selectorBoolean','boolean',false,true,true]
])test(key+' forwards the selected input only; Select events and Reprocess deliberately sample values',async()=>app(async({page,run})=>{
  const out=type==='string'?'text':'value';
  await seed(run,[source(type,a),source(type,b),{key,bindings:{a:bind(0),b:bind(1),select:bind(3),reprocess:bind(4)}},
    source('boolean',false),{key:'trigger'},log('built-event-2',out)]);
  await pause(page,run);
  await click(page,run,1);assert.deepEqual(await run('items[5].state.values'),[]);
  await click(page,run,0);assert.deepEqual(await run('items[5].state.values'),[a]);
  await patch(run,1,{value:changed});await patch(run,3,{value:true});
  assert.equal((await output(run,2))[out],changed);
  assert.deepEqual(await run('items[5].state.values'),[a],'pure value changes never emit');
  await click(page,run,3);assert.deepEqual(await run('items[5].state.values'),[a,changed],'explicit Select is an occurrence even if already selected');
  await click(page,run,0);assert.deepEqual(await run('items[5].state.values'),[a,changed]);
  await click(page,run,4,'trigger');assert.deepEqual(await run('items[5].state.values'),[a,changed,changed]);
}));

for(const [key,type,a,b] of [['steppedSelectorNumber','number',11,22],['steppedSelectorBoolean','boolean',false,true]])
test(key+' forwards selected channels and emits once for stepping and Reprocess',async()=>app(async({page,run})=>{
  await seed(run,[source(type,a),source(type,b),{key,state:{channels:2},bindings:{in0:bind(0),in1:bind(1),pulse:bind(3),reprocess:bind(4)}},
    {key:'trigger'},{key:'trigger'},log('built-event-2','value')]);
  await click(page,run,1);assert.deepEqual(await run('items[5].state.values'),[]);
  await click(page,run,0);assert.deepEqual(await run('items[5].state.values'),[a]);
  await click(page,run,3,'trigger');
  await page.waitForFunction(()=>__test.run('items[2].state.position')===1);
  assert.deepEqual(await run('items[5].state.values'),[a,b],'one pulse step produces one occurrence');
  await click(page,run,4,'trigger');assert.deepEqual(await run('items[5].state.values'),[a,b,b],'hybrid Reprocess does not also sample its pulse');
  await click(page,run,0);assert.deepEqual(await run('items[5].state.values'),[a,b,b]);
}));

test('Event → pulse retains accepted events while paused, counts every pulse after resume, and completes once',async()=>app(async({page,run})=>{
  await seed(run,[source('string','same'),{key:'eventToPulse',eventBindings:{receive:bind(0)}},
    {key:'counter',inputValues:{threshold:2},bindings:{value:bind(1)}},log('built-event-2','reached')]);
  await pause(page,run);
  await click(page,run,0);await click(page,run,0);
  assert.equal(await run('items[1].state.queued'),2);assert.equal((await output(run,1)).value,false);
  assert.equal((await output(run,2)).count,0);
  await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');await waitCount(page,2,2);
  await page.waitForFunction(()=>__test.run('items[3].state.values.length')===1);
  assert.deepEqual(await run('items[3].state.values'),[true]);
  await run('save()');await page.reload();await run('appStarted');await output(run,2);
  assert.equal(await run('items[1].state.queued'),0);assert.equal((await output(run,2)).count,2);
  assert.deepEqual(await run('items[3].state.values'),[true],'restore does not emit a second completion');
}));

test('a newly placed Event → pulse accepts its first events while paused before any transition has primed it',async()=>app(async({page,run})=>{
  await seed(run,[{key:'trigger'}]);await pause(page,run);
  await seed(run,[source('string','first'),{key:'eventToPulse',eventBindings:{receive:bind(0)}},
    {key:'counter',inputValues:{threshold:2},bindings:{value:bind(1)}},log('built-event-2','reached')]);
  assert.equal(await run('editorTimeline.pausedByUser'),true);
  assert.equal(await run('Number.isSafeInteger(editorTimeline.observations.get(items[1])?.memory?.press)'),false,'no transition baseline exists yet');
  await click(page,run,0);await click(page,run,0);
  assert.equal(await run('items[1].state.queued'),2);assert.equal((await output(run,2)).count,0);
  await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');await waitCount(page,2,2);
  await page.waitForFunction(()=>__test.run('items[3].state.values.length')===1);
  assert.deepEqual(await run('items[3].state.values'),[true],'both first events survive their initial transition');
}));

test('Event → pulse queue rejects an overflowing interaction atomically and discards pending work on reload',async()=>app(async({page,run})=>{
  await seed(run,[source('string','same',{state:{type:'string',value:'same',presses:0,burst:16}}),
    {key:'eventToPulse',eventBindings:{receive:bind(0)}},{key:'counter',bindings:{value:bind(1)}}]);
  await pause(page,run);
  for(let i=0;i<4;i++)await click(page,run,0);
  assert.equal(await run('items[1].state.queued'),64);assert.equal(await run('items[0].state.presses'),4);
  await click(page,run,0);
  assert.equal(await run('items[1].state.queued'),64);assert.equal(await run('items[0].state.presses'),4,'failing burst also rolls back its source edit');
  await run('save()');await page.reload();await run('appStarted');await output(run,1);
  assert.equal(await run('items[1].state.queued'),0);assert.equal((await output(run,2)).count,0);
}));

test('Signal → event samples the current value on trigger pulses and ignores the value source events',async()=>app(async({page,run})=>{
  await seed(run,[source('string','captured'),{key:'trigger'},
    {key:'signalToEvent',bindings:{value:bind(0),trigger:bind(1)}},{key:'memo',bindings:{line:bind(2)}}]);
  await click(page,run,0);assert.equal((await output(run,3)).lineCount,0,'source event reaches a value-only input');
  for(let count=1;count<=2;count++){
    await click(page,run,1,'trigger');
    await page.waitForFunction(count=>__test.run('items[3].state.lineCount')===count,count);
    await page.waitForFunction(()=>__test.run('editorComponentEvaluation?.records?.get(items[1])?.io.outputs.value')===false);
  }
  assert.equal((await output(run,3)).text,'captured\ncaptured');
}));

test('offline HTML queues repeated events while paused and delivers Counter completion after resume',async()=>app(async({page,run,context})=>{
  await seed(run,[source('string','same'),{key:'eventToPulse',eventBindings:{receive:bind(0)}},
    {key:'counter',inputValues:{threshold:2},bindings:{value:bind(1)}},
    {key:'textCompose',inputValues:{a:'Completed',b:''},eventBindings:{reprocess:bind(2,'reached')}},
    {key:'memo',bindings:{line:bind(3,'text')}}]);
  const point=(await handle(run,0,'send')).handle,{reader,errors,requests}=await openExport(page,run,context);
  await readerReady(reader,5);await reader.locator('#feedbackPause').click();
  for(let sent=1;sent<=2;sent++){await readerClick(reader,0,point);await reader.waitForFunction(sent=>document.querySelector('[data-smart-index="0"]')?.textContent.endsWith('('+sent+')'),sent);}
  await readerExact(reader,4,'Completed',0);
  await reader.locator('#feedbackPause').click();await readerExact(reader,4,'Completed',1);
  await readerExact(reader,2,'2',2);
  await reader.reload();await readerReady(reader,5);await readerExact(reader,4,'Completed',0);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('offline HTML keeps events accepted while paused before the first transition and drops old pending tokens on reload',async()=>app(async({page,run,context})=>{
  await seed(run,[source('string','first'),{key:'eventToPulse',eventBindings:{receive:bind(0)}},
    {key:'counter',inputValues:{threshold:2},bindings:{value:bind(1)}},
    {key:'textCompose',inputValues:{a:'First events completed',b:''},eventBindings:{reprocess:bind(2,'reached')}},
    {key:'memo',bindings:{line:bind(3,'text')}}]);
  const point=(await handle(run,0,'send')).handle,{reader,errors,requests}=await openExport(page,run,context,{initiallyPaused:true});
  await readerReady(reader,5);
  assert.equal(await reader.locator('#feedbackPause').textContent(),'Resume','reader starts without transition memory');
  for(let sent=1;sent<=2;sent++){await readerClick(reader,0,point);await reader.waitForFunction(sent=>document.querySelector('[data-smart-index="0"]')?.textContent.endsWith('('+sent+')'),sent);}
  await readerExact(reader,4,'First events completed',0);
  await reader.locator('#feedbackPause').click();await readerExact(reader,4,'First events completed',1);
  await reader.reload();await readerReady(reader,5);
  await reader.locator('#feedbackPause').click();await readerExact(reader,4,'First events completed',0);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('Timer completion works in editor and offline HTML and does not replay on reload',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'timer',state:{unit:'seconds',duration:1,configuredUnit:'seconds',configuredDuration:1,remainingMs:1000}},
    {key:'textCompose',inputValues:{a:'Timer finished',b:''},eventBindings:{reprocess:bind(0,'reached')}},
    {key:'memo',bindings:{line:bind(1,'text')}}]);
  const point=(await handle(run,0,'toggle')).handle;
  await click(page,run,0,'toggle');
  await page.waitForFunction(()=>__test.run('items[2].state.lineCount')===1);
  assert.equal((await output(run,2)).text,'Timer finished');
  const {reader,errors,requests}=await openExport(page,run,context);await readerReady(reader,3);
  await readerExact(reader,2,'Timer finished',1,'the exported log is retained');
  await readerClick(reader,0,point);await readerExact(reader,2,'Timer finished',2);
  await reader.reload();await readerReady(reader,3);await readerExact(reader,2,'Timer finished',1);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('editor and HTML retain a completed counter when its event receiver rejects the notification',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'trigger'},{key:'counter',inputValues:{threshold:1},bindings:{value:bind(0)}},
    {key:'constant',script:logScript.replace("return {state:{values:[...state.values,payload]}};","throw new Error('Log is full');"),state:{values:[]},eventBindings:{receive:bind(1,'reached')}}]);
  const point=(await handle(run,0,'trigger')).handle,{reader,errors}=await openExport(page,run,context);
  await readerReady(reader,3);await readerClick(reader,0,point);await reader.locator('[data-component-event-error]').waitFor();
  assert.match(await reader.locator('[data-component-event-error]').textContent(),/Log is full/);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="1"]')?.textContent.includes('Reached: true'));assert.deepEqual(errors,[]);assert.equal(await reader.locator('[data-component-error]').count(),0);
  await click(page,run,0,'trigger');await waitCount(page,1,1);assert.equal((await output(run,1)).count,1);
  assert.deepEqual(await run('items[2].state.values'),[]);assert.match(await page.locator('#toast').textContent(),/Log is full/);
}));
