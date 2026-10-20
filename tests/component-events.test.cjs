const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

// Only the editor fixture exposes its closure. All scripts cross the real Worker
// boundary; downloaded HTML uses the unmodified, self-contained reader runtime.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://component-events.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://component-events.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function seed(run,specs){
  await run(`cancelGesture();items=${JSON.stringify(specs)}.map((spec,index)=>{
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===spec.key).items[0]);
    return {...base,uid:'event-'+index,x:70+(index%3)*450,y:100+Math.floor(index/3)*330,...spec,state:{...base.state,...spec.state}};
  });selection=[];editingSmartIdx=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
async function outputs(run,index){
  return run(`(async()=>{const graph=await ensureEditorComponentGraph(),record=graph.get(items[${index}]);
    if(record.error)throw new Error(record.error);return record.io.outputs;})()`);
}
async function waitOutput(page,index,name,value){
  await page.waitForFunction(({index,name,value})=>__test.run(`editorComponentEvaluation?.records?.get(items[${index}])?.io.outputs[${JSON.stringify(name)}]`)===value,{index,name,value});
}
async function entryPoint(run,index,id='entry'){
  return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);
    const handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]);
    return {item,handle:handles.find(handle=>handle.id===${JSON.stringify(id)})};})()`);
}
async function openEntry(page,run,index,type='text'){
  await run(`selection=[${index}];editingSmartIdx=${index};editingGroupId=items[${index}].group??null;render();`);
  const point=await entryPoint(run,index);assert.ok(point.handle,'entry handle exists');
  const world=await run(`toWorld(items[${index}],items[${index}].x+${point.handle.x},items[${index}].y+${point.handle.y})`);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+world.x,box.y+world.y);
  const field=page.locator('[data-smart-inline-input]');await field.waitFor({state:'visible'});
  const input=field.locator(type==='text'?'#smartTextValue':'#smartNumberValue');
  await input.waitFor({state:'visible'});assert.equal(await input.evaluate(element=>element===document.activeElement),true,'entry receives focus');
  assert.equal(await page.locator('dialog[open]').count(),0,'typing takes place directly over the component');
  return {field,input,handle:point.handle};
}
async function accepted(page,run,field,before){
  await page.waitForFunction(({field,before})=>Number(field.dataset.submissions)>before,{field:await field.elementHandle(),before});
  await run('smartHitSettled');
}
async function submit(page,run,index,value,{type='text',enter=false}={}){
  const {field,input}=await openEntry(page,run,index,type),before=Number(await field.getAttribute('data-submissions')||0);await input.fill(value);
  if(enter)await input.press('Enter');else await field.getByRole('button',{name:'Submit',exact:true}).click();
  await accepted(page,run,field,before);await input.press('Escape');await field.waitFor({state:'detached'});
}
async function idle(page,index=0){await waitOutput(page,index,'submitted',false);}
async function readerClick(page,index,point){
  const host=page.locator('[data-smart-index="'+index+'"]');
  await page.waitForFunction(host=>host.dataset.smartReady==='true',await host.elementHandle());
  const position=await host.evaluate((host,point)=>{
    const transformed=new DOMPoint(point.x,point.y).matrixTransform(host.firstElementChild.getScreenCTM());
    return {x:transformed.x,y:transformed.y};
  },point);await page.mouse.click(position.x,position.y);
}
async function openExport(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-events-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'document.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('dialog',dialog=>{errors.push('Unexpected reader '+dialog.type()+': '+dialog.message());return dialog.dismiss();});
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  return {reader,errors,requests};
}

const eventCircuit=[{key:'textInput',componentName:'Message'},
  {key:'memo',componentName:'Event log',bindings:{line:{uid:'event-0',port:'value'}}},
  {key:'memo',componentName:'Pulse log',eventModes:{line:'value'},bindings:{line:{uid:'event-0',port:'value'},append:{uid:'event-0',port:'submitted'}}},
  {key:'counter',componentName:'Pulse count',bindings:{value:{uid:'event-0',port:'submitted'}}}];
async function pause(page,run){await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');}

test('built-in hybrid events share value ports and preserve Memo trigger inputs',async()=>app(async({run})=>{
  await seed(run,[{key:'textInput'},{key:'numberInput'},{key:'memo'}]);
  const caps=await run('Promise.all(items.map(item=>requestSmartCaps(item)))');
  for(const [index,type] of [[0,'string'],[1,'number']]){
    assert.equal(caps[index].eventApi,1);
    assert.deepEqual(caps[index].eventOutputs.value.types,[type]);
    assert.equal(caps[index].eventOutputs.value.hybrid,true);assert.equal(caps[index].eventOutputs.submitted,undefined,'submission event shares Value instead of duplicating the pulse port');
    assert.equal(caps[index].outputs.value.type,type);
    assert.equal(caps[index].outputs.submitted.type,'boolean','submitted pulse remains a distinct Boolean output');
  }
  assert.deepEqual(caps[2].eventInputs.content.types,['string']);
  assert.deepEqual(caps[2].eventInputs.line.types,['string']);
  assert.deepEqual([...caps[2].eventInputs.clear.types].sort(),['boolean','none']);
  assert.equal(caps[2].onEvent,true);
  for(const name of ['content','line'])assert.equal(caps[2].inputs[name].type,'string');
  for(const name of ['set','append','clear'])assert.equal(caps[2].inputs[name].type,'boolean');
}));

test('accepted submissions deliver captured events immediately while paused and preserve every traditional pulse',async()=>app(async({page,run})=>{
  await seed(run,eventCircuit);await pause(page,run);
  const {field,input}=await openEntry(page,run,0);
  for(const [index,value] of ['Anna','Anna','second','third'].entries()){
    const before=Number(await field.getAttribute('data-submissions')||0);
    await input.fill(value);await input.press('Enter');await accepted(page,run,field,before);
    assert.equal(await run('items[1].state.lineCount'),index+1,'each accepted entry is one event, including repeated text');
  }
  await input.press('Escape');
  assert.deepEqual(await outputs(run,1),{text:'Anna\nAnna\nsecond\nthird',lineCount:4});
  assert.deepEqual(await outputs(run,2),{text:'',lineCount:0},'paused signal triggers do not advance');
  assert.equal(await run('items[3].state.count'),0);
  await pause(page,run);await waitOutput(page,2,'lineCount',4);await idle(page);
  assert.deepEqual(await outputs(run,2),{text:'Anna\nAnna\nsecond\nthird',lineCount:4});
  assert.equal(await run('items[3].state.count'),4);
  assert.equal(await run('items[1].state.lineCount'),4,'pulse delivery never replays the event');
}));

test('Number input sends precise events through Number to text and rejects invalid drafts',async()=>app(async({page,run})=>{
  await seed(run,[{key:'numberInput',state:{min:-100,max:100,step:.001}},
    {key:'numberToText',bindings:{value:{uid:'event-0',port:'value'}}},
    {key:'memo',bindings:{line:{uid:'event-1',port:'text'}}}]);
  await pause(page,run);
  for(const value of ['3.125','3.125','-12.5','0.30000000000000004'])await submit(page,run,0,value,{type:'number',enter:true});
  assert.deepEqual(await outputs(run,2),{text:'3.125\n3.125\n-12.5\n0.30000000000000004',lineCount:4});
  assert.equal((await outputs(run,0)).value,0.30000000000000004,'event transport preserves full numeric precision');
  const {field,input}=await openEntry(page,run,0,'number');
  for(const value of ['','101','0.0001']){
    await input.fill(value);await input.press('Enter');await run('smartHitSettled');
    assert.equal(await run('items[2].state.lineCount'),4,'invalid entry emits no event');
    assert.equal(await field.getAttribute('data-submissions')||'0','0');
  }
  await input.fill('42');await input.press('Escape');
  assert.equal(await run('items[2].state.lineCount'),4,'cancelled draft emits no event');
}));

test('wiring both event and pulse paths requests Memo Append twice',async()=>app(async({page,run})=>{
  await seed(run,[eventCircuit[0],{...eventCircuit[1],bindings:eventCircuit[2].bindings}]);
  await submit(page,run,0,'twice',{enter:true});await waitOutput(page,1,'lineCount',2);await idle(page);
  assert.deepEqual(await outputs(run,1),{text:'twice\ntwice',lineCount:2});
}));

test('one Undo covers the submitted value and all event recipients; redo and reload restore state without replay',async()=>app(async({page,run})=>{
  await seed(run,[eventCircuit[0],eventCircuit[1],{...eventCircuit[1],componentName:'Second recipient'}]);
  await pause(page,run);
  const before=await run('undoStack.length');
  await submit(page,run,0,'persisted',{enter:true});
  assert.equal(await run('undoStack.length'),before+1);
  for(const index of [1,2])assert.deepEqual(await outputs(run,index),{text:'persisted',lineCount:1});
  await run('undo();ensureEditorComponentGraph()');
  assert.equal((await outputs(run,0)).value,'');
  for(const index of [1,2])assert.deepEqual(await outputs(run,index),{text:'',lineCount:0});
  await run('redo();ensureEditorComponentGraph()');
  assert.equal((await outputs(run,0)).value,'persisted');
  for(const index of [1,2])assert.deepEqual(await outputs(run,index),{text:'persisted',lineCount:1});
  await run('save()');await page.reload();await run('appStarted');await waitOutput(page,1,'text','persisted');
  await page.waitForTimeout(180);
  for(const index of [1,2])assert.deepEqual(await outputs(run,index),{text:'persisted',lineCount:1});
  assert.deepEqual(await run('items[1].bindings'),{line:{uid:'event-0',port:'value'}});
}));

test('duplicating a connected pair remaps hybrid bindings; copying a receiver alone leaves its source unresolved',async()=>app(async({page,run})=>{
  await seed(run,eventCircuit.slice(0,2));await pause(page,run);
  await run('selection=[0,1];duplicateSelection();ensureEditorComponentGraph()');
  assert.equal(await run('items[3].bindings.line.uid'),await run('items[2].uid'));
  assert.notEqual(await run('items[3].bindings.line.uid'),'event-0');
  await submit(page,run,2,'copy');await waitOutput(page,3,'text','copy');await idle(page,2);
  assert.deepEqual(await outputs(run,1),{text:'',lineCount:0});
  await run('selection=[1];duplicateSelection();ensureEditorComponentGraph()');
  assert.equal(await run('items[4].bindings.line.unresolved'),true);
  await submit(page,run,0,'original');await waitOutput(page,1,'text','original');await idle(page);
  assert.equal(await run('items[4].state.text'),'','unresolved event source cannot attach accidentally');
}));

test('event Set and Append use the same Memo limits and preserve a rejected append',async()=>app(async({page,run})=>{
  await seed(run,[eventCircuit[0],{key:'memo',state:{maxLength:5},bindings:{content:{uid:'event-0',port:'value'}}}]);
  await pause(page,run);await submit(page,run,0,'abc');
  assert.deepEqual(await outputs(run,1),{text:'abc',lineCount:1});
  await run("items[1].bindings={line:{uid:'event-0',port:'value'}};render();ensureEditorComponentGraph()");
  await submit(page,run,0,'toolong');
  assert.deepEqual(await outputs(run,1),{text:'abc',lineCount:1});
  assert.match(await run('items[1].state.notice'),/limit|full|long/i);
  await submit(page,run,0,'x');
  assert.deepEqual(await outputs(run,1),{text:'abc\nx',lineCount:2});
  assert.equal(await run('items[1].state.notice'),'');
}));

test('offline HTML delivers repeated text and numeric events while paused, retains pulse wiring, and never replays events on reload',async()=>app(async({page,run,context})=>{
  await seed(run,[...eventCircuit,{key:'numberInput',state:{min:-100,max:100,step:.001}},
    {key:'numberToText',bindings:{value:{uid:'event-4',port:'value'}}},
    {key:'memo',componentName:'Numeric events',bindings:{line:{uid:'event-5',port:'text'}}}]);
  const handles=[(await entryPoint(run,0)).handle,(await entryPoint(run,4)).handle];
  const {reader,errors,requests}=await openExport(page,run,context);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===7);
  await reader.locator('#feedbackPause').click();
  const readerSubmit=async(index,handle,value)=>{
    await readerClick(reader,index,handle);
    const field=reader.locator('[data-smart-inline-input]');await field.waitFor({state:'visible'});
    const input=field.locator('input'),before=Number(await field.getAttribute('data-submissions')||0);
    await input.fill(value);await input.press('Enter');
    await reader.waitForFunction(({field,before})=>Number(field.dataset.submissions)>before,{field:await field.elementHandle(),before});
    await input.press('Escape');await field.waitFor({state:'detached'});
  };
  const count=async(index,text,n)=>reader.waitForFunction(({index,text,n})=>
    [...document.querySelectorAll('[data-smart-index="'+index+'"] text')].filter(node=>node.textContent===text).length===n,{index,text,n});
  for(const [i,text] of ['Anna','Anna','Next'].entries()){
    await readerSubmit(0,handles[0],text);await count(1,text,text==='Anna'?i+1:1);
  }
  assert.equal(await reader.locator('[data-smart-index="2"] text').evaluateAll(nodes=>nodes.filter(node=>node.textContent==='Anna').length),0);
  await readerSubmit(4,handles[1],'3.125');await count(6,'3.125',1);
  await reader.locator('#feedbackPause').click();await count(2,'Anna',2);await count(2,'Next',1);
  await count(1,'Anna',2);await count(1,'Next',1);
  assert.equal(await reader.locator('[data-component-error]').count(),0);
  await reader.reload();await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===7);
  await reader.waitForTimeout(180);
  for(const index of [1,2,6])assert.equal(await reader.locator('[data-smart-index="'+index+'"] text').evaluateAll(nodes=>nodes.filter(node=>['Anna','Next','3.125'].includes(node.textContent)).length),0,'export reopens its original embedded state without replay');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

function receiverScript(body){return `({apiVersion:2,eventApi:1,inputs:{},outputs:{count:{type:'number'}},
  eventInputs:{receive:{type:'string'},again:{type:'string'}},eventOutputs:{repeat:{type:'string'}},
  compute(inputs,state){return {count:state.count};},children(){return [];},
  onEvent(name,payload,state){${body}}})`;}

test('real Worker receiver failures roll back the input and all earlier recipients in the same gesture',async()=>app(async({page,run})=>{
  await seed(run,[eventCircuit[0],eventCircuit[1],{key:'constant',state:{count:0},
    script:receiverScript("throw new Error('Receiver intentionally rejected the request')"),
    eventBindings:{receive:{uid:'event-0',port:'value'}}}]);
  await pause(page,run);
  const before=await run('JSON.stringify(items.map(item=>item.state))'),history=await run('undoStack.length');
  const {field,input}=await openEntry(page,run,0);await input.fill('rolled back');await input.press('Enter');
  await run('smartHitSettled');
  assert.equal(await field.getAttribute('data-submissions'),'0');
  assert.equal(await run('JSON.stringify(items.map(item=>item.state))'),before,'source queue and prior Memo edit are rolled back together');
  assert.equal(await run('undoStack.length'),history,'failed operation creates no Undo entry');
  assert.match(await field.textContent(),/Receiver intentionally rejected/);
  await input.press('Escape');
  await run('items[2].script='+JSON.stringify(receiverScript('return {state:{...state,count:state.count+1}};'))+';render();ensureEditorComponentGraph()');
  await submit(page,run,0,'accepted');
  assert.deepEqual(await outputs(run,1),{text:'accepted',lineCount:1});assert.equal(await run('items[2].state.count'),1);
}));

test('real Worker event cycles and malformed output events fail without mutating durable state',async()=>app(async({page,run})=>{
  for(const [body,expected] of [
    ['return {state:{...state,count:state.count+1},events:[{port:"repeat",payload}]};','limit reached'],
    ['return {state:{...state,count:state.count+1},events:[{port:"repeat",payload:42}]};','incompatible payload'],
    ['return {state:{...state,count:state.count+1},events:[{port:"repeat",payload:{invalid:true}}]};','Expected a finite number']
  ]){
    await seed(run,[eventCircuit[0],{key:'constant',state:{count:0},script:receiverScript(body),
      eventBindings:{receive:{uid:'event-0',port:'value'},again:{uid:'event-1',port:'repeat'}}}]);
    if(await page.locator('#componentPauseBtn').textContent()==='Pause')await pause(page,run);
    const result=await run(`(async()=>{
      const records=await ensureEditorComponentGraph(),source=items[0],before=JSON.stringify(items),
        next=await requestSmartCall(source,'dragEdit',[source.state,'entry','payload',0,source.w,source.h,smartResolvedStyle(source)]);
      let error=null;try{await prepareComponentEventDelivery(items,source,next,(target,fn,args)=>requestSmartCall(target,fn,args),()=>true,records);}
      catch(e){error=e.message;}return {error,unchanged:before===JSON.stringify(items)};
    })()`);
    assert.match(result.error,new RegExp(expected,'i'));assert.equal(result.unchanged,true);
  }
}));

test('cancelling after a real Worker receiver returns discards all staged event effects',async()=>app(async({page,run})=>{
  await seed(run,eventCircuit.slice(0,2));await pause(page,run);
  const result=await run(`(async()=>{
    const records=await ensureEditorComponentGraph(),source=items[0],before=JSON.stringify(items),
      next=await requestSmartCall(source,'dragEdit',[source.state,'entry','stale',0,source.w,source.h,smartResolvedStyle(source)]);
    let valid=true,cancelled=false;
    try{await prepareComponentEventDelivery(items,source,next,async(target,fn,args)=>{
      const result=await requestSmartCall(target,fn,args);valid=false;return result;
    },()=>valid,records);}catch(error){cancelled=error.cancelled===true;}
    return {cancelled,unchanged:before===JSON.stringify(items)};
  })()`);
  assert.deepEqual(result,{cancelled:true,unchanged:true});
}));

test('event transport metadata neither overwrites nor interprets a durable state field named smartEvents',async()=>app(async({run})=>{
  for(const emit of [false,true]){
    const script=`({apiVersion:2,eventApi:1,inputs:{},outputs:{},eventOutputs:{submitted:{type:'string'}},
      compute(){return {};},children(){return [];},dragEdit(state){return {state:{...state,count:state.count+1}${emit?",events:[{port:'submitted',payload:'actual event'}]":''}};}})`;
    await seed(run,[{key:'constant',script,state:{count:0,smartEvents:[{port:'submitted',payload:'ordinary stored data'}]}}]);
    const result=await run(`(async()=>{
      const item=items[0],reply=await requestSmartSandbox({method:'call',src:item.script,fn:'dragEdit',args:[item.state]},item);
      return {state:JSON.parse(JSON.stringify(reply.result)),events:componentReplyEvents(reply.result)};
    })()`);
    assert.deepEqual(result.state.smartEvents,[{port:'submitted',payload:'ordinary stored data'}]);
    assert.equal(result.state.count,1);
    assert.deepEqual(result.events,emit?[{port:'submitted',payload:'actual event'}]:[]);
  }
}));
