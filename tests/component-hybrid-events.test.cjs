const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

// Only the editor fixture exposes its closure. All scripts cross the real Worker
// boundary; downloaded HTML uses the unmodified, self-contained reader runtime.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://component-hybrid-events.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://component-hybrid-events.test/index.html');
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
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-hybrid-events-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'document.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('dialog',dialog=>{errors.push('Unexpected reader '+dialog.type()+': '+dialog.message());return dialog.dismiss();});
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  return {reader,errors,requests};
}

const extractorCircuit=[
  {key:'textInput',componentName:'Text'},
  {key:'textExtract',componentName:'Extract',bindings:{text:{uid:'event-0',port:'value'},start:{uid:'event-3',port:'value'},length:{uid:'event-4',port:'value'},reprocess:{uid:'event-5',port:'value'}}},
  {key:'memo',componentName:'Event log',bindings:{line:{uid:'event-1',port:'text'}}},
  {key:'numberInput',componentName:'Start',state:{values:[2]}},
  {key:'numberInput',componentName:'Length',state:{values:[3]}},
  {key:'trigger',componentName:'Reprocess'},
  {key:'textLabel',componentName:'Current result',bindings:{value:{uid:'event-1',port:'text'}}}
];
async function pause(page,run){await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');}
async function clickHandle(page,run,index,id){
  await run(`selection=[${index}];editingSmartIdx=${index};render()`);
  const {item,handle}=await entryPoint(run,index,id);assert.ok(handle,id+' exists');
  const point=await run(`toWorld(items[${index}],${item.x+handle.x},${item.y+handle.y})`),box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+point.x,box.y+point.y);await run('smartHitSettled');
}

const sharedOriginCircuit=[
  {key:'textInput',componentName:'Name and city',state:{value:'Bob;Paris'}},
  {key:'textExtract',state:{mode:'regex capture'},inputValues:{pattern:'^([^;]*);(.*)$',group:0},bindings:{text:{uid:'event-0',port:'value'}}},
  {key:'textExtract',state:{mode:'regex capture'},inputValues:{pattern:'^([^;]*);(.*)$',group:1},bindings:{text:{uid:'event-0',port:'value'}}},
  {key:'textTransform',inputValues:{operation:'uppercase'},bindings:{text:{uid:'event-2',port:'text'}}},
  {key:'textCompose',inputValues:{separator:' / '},bindings:{a:{uid:'event-1',port:'text'},b:{uid:'event-3',port:'text'}}},
  {key:'memo',bindings:{line:{uid:'event-4',port:'text'}}}
];
for(const reversed of [false,true])test('one shared origin joins unequal branches once '+(reversed?'in reversed scene order':'in scene order')+' and survives Undo/Redo and reload',async()=>app(async({page,run})=>{
  await seed(run,sharedOriginCircuit);
  if(reversed)await run('items=[items[0],items[4],items[3],items[2],items[1],items[5]];render();save();ensureEditorComponentGraph()');
  await pause(page,run);const before=await run('undoStack.length');
  for(let count=1;count<=2;count++){
    await submit(page,run,0,'Anna;Berlin',{enter:true});
    assert.deepEqual(await outputs(run,5),{text:Array(count).fill('Anna / BERLIN').join('\n'),lineCount:count});
  }
  assert.equal(await run('undoStack.length'),before+2,'each independent submission is one atomic Undo step');
  await run('undo();ensureEditorComponentGraph()');
  assert.deepEqual(await outputs(run,5),{text:'Anna / BERLIN',lineCount:1});
  await run('redo();ensureEditorComponentGraph();save()');
  await page.reload();await run('appStarted');await waitOutput(page,5,'lineCount',2);
  assert.deepEqual(await outputs(run,5),{text:'Anna / BERLIN\nAnna / BERLIN',lineCount:2});
}));

test('offline HTML joins unequal event branches once per submission while paused',async()=>app(async({page,run,context})=>{
  await seed(run,sharedOriginCircuit);
  await run('items=[items[0],items[4],items[3],items[2],items[1],items[5]];render();save();ensureEditorComponentGraph()');
  const {handle}=await entryPoint(run,0),{reader,errors,requests}=await openExport(page,run,context);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===6);
  await reader.locator('#feedbackPause').click();
  for(let count=1;count<=2;count++){
    await readerClick(reader,0,handle);const field=reader.locator('[data-smart-inline-input]'),input=field.locator('input');
    await input.fill('Anna;Berlin');const before=Number(await field.getAttribute('data-submissions')||0);
    await input.press('Enter');
    await reader.waitForFunction(({field,before})=>Number(field.dataset.submissions)>before,{field:await field.elementHandle(),before});
    await input.press('Escape');await field.waitFor({state:'detached'});
    await reader.waitForFunction(count=>[...document.querySelectorAll('[data-smart-index="5"] text')].filter(node=>node.textContent==='Anna / BERLIN').length===count,count);
    assert.equal(await reader.locator('[data-smart-index="5"] text').evaluateAll(nodes=>nodes.some(node=>/Bob|Paris|PARIS/.test(node.textContent))),false,'no intermediate combination reaches the log');
  }
  await reader.reload();await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===6);
  assert.equal(await reader.locator('[data-smart-index="5"] text').evaluateAll(nodes=>nodes.filter(node=>node.textContent==='Anna / BERLIN').length),0,'reader reload restores the exported snapshot without replay');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

const timestampCircuit=(driver='a')=>[
    {key:'textInput',componentName:'Message'},
    {key:'textCompose',componentName:'Timestamped message',inputValues:{separator:' '},
      bindings:{[driver]:{uid:'event-0',port:'value'},[driver==='a'?'b':'a']:{uid:'event-3',port:'time'}}},
    {key:'memo',componentName:'Log',bindings:{line:{uid:'event-1',port:'text'}}},
    {key:'liveClock',componentName:'Clock',inputValues:{timezone:'UTC'}}
];
for(const driver of ['a','b'])test('Text compose input '+driver+' forwards submitted text with a live clock value to Memo without appending on clock ticks',async()=>app(async({page,run})=>{
  await seed(run,timestampCircuit(driver));
  const composed=driver==='a'?/^Hello \d{2}:\d{2}:\d{2}$/:/^\d{2}:\d{2}:\d{2} Hello$/;
  await submit(page,run,0,'Hello',{enter:true});
  const first=await outputs(run,2);
  assert.equal(first.lineCount,1);assert.match(first.text,composed);
  const time=(await outputs(run,3)).time;
  await page.waitForFunction(time=>__test.run('editorComponentEvaluation?.records?.get(items[3])?.io.outputs.time')!==time,time);
  assert.deepEqual(await outputs(run,2),first,'clock parameter changes only update the current composed value');
  await submit(page,run,0,'Hello',{enter:true});
  const second=await outputs(run,2);
  assert.equal(second.lineCount,2);assert.equal(second.text.split('\n')[0],first.text);
  assert.match(second.text.split('\n')[1],composed);
}));

for(const driver of ['a','b'])test('offline HTML forwards Text compose input '+driver+' events with a ticking clock value to Memo',async()=>app(async({page,run,context})=>{
  await seed(run,timestampCircuit(driver));
  const {handle}=await entryPoint(run,0);
  const {reader,errors,requests}=await openExport(page,run,context);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===4);
  const memoLines=()=>reader.locator('[data-smart-index="2"] text').allTextContents();
  for(let count=1;count<=2;count++){
    await readerClick(reader,0,handle);
    const field=reader.locator('[data-smart-inline-input]');await field.waitFor();
    const input=field.locator('input'),before=Number(await field.getAttribute('data-submissions')||0);
    await input.fill('Hello');await input.press('Enter');
    await reader.waitForFunction(({field,before})=>Number(field.dataset.submissions)>before,{field:await field.elementHandle(),before});
    await input.press('Escape');await field.waitFor({state:'detached'});
    await reader.waitForFunction(({count,driver})=>[...document.querySelectorAll('[data-smart-index="2"] text')].filter(node=>(driver==='a'?/^Hello \d{2}:\d{2}:\d{2}$/:/^\d{2}:\d{2}:\d{2} Hello$/).test(node.textContent)).length===count,{count,driver});
    const beforeTick=await memoLines();
    const clock=await reader.locator('[data-smart-index="3"]').textContent();
    await reader.waitForFunction(clock=>document.querySelector('[data-smart-index="3"]').textContent!==clock,clock);
    assert.deepEqual(await memoLines(),beforeTick,'clock ticks do not append a line');
  }
  assert.equal(await reader.locator('[data-component-error]').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('Text compose accepts both text sources and keeps hybrid inputs through inspector mode and input-count changes',async()=>app(async({page,run})=>{
  await seed(run,[
    {key:'textInput',componentName:'First'},
    {key:'textCompose',inputValues:{separator:' / '},bindings:{a:{uid:'event-0',port:'value'},b:{uid:'event-3',port:'value'}}},
    {key:'memo',bindings:{line:{uid:'event-1',port:'text'}}},
    {key:'textInput',componentName:'Second'}
  ]);
  await pause(page,run);
  await submit(page,run,0,'One',{enter:true});
  await submit(page,run,3,'Two',{enter:true});
  await submit(page,run,3,'Two',{enter:true});
  assert.deepEqual(await outputs(run,2),{text:'One / \nOne / Two\nOne / Two',lineCount:3});
  await run('selection=[1];openComponentBindings()');
  const dialog=page.locator('#componentBindingsDialog');
  await dialog.getByRole('checkbox',{name:'Receive events for b',exact:true}).waitFor();
  assert.equal(await dialog.getByRole('checkbox',{name:'Receive events for a',exact:true}).isChecked(),true);
  assert.equal(await dialog.getByRole('checkbox',{name:'Receive events for b',exact:true}).isChecked(),true);
  await dialog.getByRole('combobox',{name:'Composition mode',exact:true}).selectOption('template');
  await dialog.getByRole('textbox',{name:'template value',exact:true}).fill('{b}: {a}');
  await dialog.getByRole('spinbutton',{name:'Number of text inputs',exact:true}).fill('8');
  await dialog.getByRole('spinbutton',{name:'Number of text inputs',exact:true}).press('Tab');
  await dialog.getByRole('checkbox',{name:'Receive events for h',exact:true}).waitFor();
  for(const name of 'abcdefgh')assert.equal(await dialog.getByRole('checkbox',{name:'Receive events for '+name,exact:true}).isChecked(),true);
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.deepEqual(await run('items[1].eventModes'),{});
  assert.equal((await outputs(run,2)).lineCount,3,'configuration changes do not emit');
  await submit(page,run,3,'Again',{enter:true});
  assert.equal((await outputs(run,2)).text,'One / \nOne / Two\nOne / Two\nAgain: One');
  // Each input keeps its own deliberate value-only choice.
  await run("selection=[1];openComponentBindings()");
  await dialog.getByRole('checkbox',{name:'Receive events for a',exact:true}).uncheck();
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await submit(page,run,0,'Sampled',{enter:true});
  assert.equal((await outputs(run,2)).lineCount,4);
  await submit(page,run,3,'Final',{enter:true});
  assert.equal((await outputs(run,2)).text.split('\n').at(-1),'Final: Sampled');
}));

test('Extractor events use submitted payloads; changed range updates the current value and Reprocess emits a fresh occurrence',async()=>app(async({page,run})=>{
  await seed(run,extractorCircuit);await pause(page,run);
  await submit(page,run,0,'Hello World',{enter:true});
  assert.deepEqual(await outputs(run,2),{text:'llo',lineCount:1});
  await submit(page,run,0,'Another Test',{enter:true});
  assert.deepEqual(await outputs(run,2),{text:'llo\noth',lineCount:2});
  await submit(page,run,3,'3',{type:'number',enter:true});await submit(page,run,4,'5',{type:'number',enter:true});
  assert.equal((await outputs(run,1)).text,'ther ');assert.equal((await outputs(run,6)).value,'ther ');
  assert.deepEqual(await outputs(run,2),{text:'llo\noth',lineCount:2},'parameter events do not fabricate a data submission');
  for(let count=3;count<=4;count++){
    await clickHandle(page,run,5,'trigger');
    assert.equal((await outputs(run,2)).lineCount,count,'same-result reprocessing preserves each event occurrence');
  }
  assert.equal((await outputs(run,2)).text,'llo\noth\nther \nther ');
  await pause(page,run);await idle(page);await idle(page,3);await idle(page,4);
  await waitOutput(page,5,'value',false);
  assert.equal((await outputs(run,2)).lineCount,4,'later data/control pulses do not duplicate their events');
}));

test('Reprocess value-only mode observes a Boolean rising edge while command mode emits once per click',async()=>app(async({page,run})=>{
  await seed(run,extractorCircuit);await submit(page,run,0,'Hello World');await idle(page);
  assert.equal((await outputs(run,2)).text,'llo');
  await clickHandle(page,run,5,'trigger');await waitOutput(page,5,'value',false);
  assert.equal((await outputs(run,2)).lineCount,2,'hybrid command does not also execute its paired pulse');
  await pause(page,run);await run("items[1].eventModes={reprocess:'value'};render();ensureEditorComponentGraph()");
  await clickHandle(page,run,5,'trigger');
  assert.equal((await outputs(run,2)).lineCount,2,'value-only command remains queued with paused signals');
  await pause(page,run);await waitOutput(page,2,'lineCount',3);await waitOutput(page,5,'value',false);
  assert.equal((await outputs(run,2)).lineCount,3,'pulse mode emits exactly once');
  await pause(page,run);await run('items[1].inputValues={...items[1].inputValues,reprocess:true};delete items[1].bindings.reprocess;render();ensureEditorComponentGraph()');
  const before=(await outputs(run,2)).lineCount;
  await run('render();ensureEditorComponentGraph()');assert.equal((await outputs(run,2)).lineCount,before,'holding high is not another event');
}));

test('one standard binding carries value and repeated events through multiple text and numeric transformations',async()=>app(async({page,run})=>{
  await seed(run,[{key:'textInput'},{key:'textTransform',inputValues:{operation:'trim'},bindings:{text:{uid:'event-0',port:'value'}}},
    {key:'textTransform',inputValues:{operation:'uppercase'},bindings:{text:{uid:'event-1',port:'text'}}},
    {key:'memo',bindings:{line:{uid:'event-2',port:'text'}}}]);await pause(page,run);
  for(let i=0;i<2;i++)await submit(page,run,0,' Anna ',{enter:true});
  assert.deepEqual(await outputs(run,3),{text:'ANNA\nANNA',lineCount:2});assert.equal((await outputs(run,2)).text,'ANNA');
  await seed(run,[{key:'numberInput',state:{min:-100,max:100,step:.1}},
    {key:'numberFunction',inputValues:{operation:'abs'},bindings:{value:{uid:'event-0',port:'value'}}},
    {key:'numberToText',bindings:{value:{uid:'event-1',port:'value'}}},
    {key:'memo',bindings:{line:{uid:'event-2',port:'text'}}}]);
  for(const value of ['-2.8','2.8'])await submit(page,run,0,value,{type:'number',enter:true});
  assert.deepEqual(await outputs(run,3),{text:'2.8\n2.8',lineCount:2},'unchanged numeric result still emits for each accepted event');
}));

test('value-only Memo binding samples the current transformed text on Append without consuming upstream events',async()=>app(async({page,run})=>{
  await seed(run,[...extractorCircuit,{key:'memo',componentName:'Sampled log',eventModes:{line:'value'},bindings:{line:{uid:'event-1',port:'text'},append:{uid:'event-5',port:'value'}}}]);
  await submit(page,run,0,'Hello World');await idle(page);await submit(page,run,0,'Another Test');await idle(page);
  assert.deepEqual(await outputs(run,7),{text:'',lineCount:0});
  await submit(page,run,3,'3',{type:'number'});await idle(page,3);await submit(page,run,4,'5',{type:'number'});await idle(page,4);
  await clickHandle(page,run,5,'trigger');await waitOutput(page,7,'lineCount',1);await waitOutput(page,5,'value',false);
  assert.deepEqual(await outputs(run,7),{text:'ther ',lineCount:1});
}));

test('transformed event changes share one Undo step and restoration never emits or reprocesses',async()=>app(async({page,run})=>{
  await seed(run,extractorCircuit);await pause(page,run);const before=await run('undoStack.length');
  await submit(page,run,0,'Hello World');assert.equal(await run('undoStack.length'),before+1);
  await run('undo();ensureEditorComponentGraph()');assert.equal((await outputs(run,2)).lineCount,0);
  await run('redo();ensureEditorComponentGraph()');assert.deepEqual(await outputs(run,2),{text:'llo',lineCount:1});
  await clickHandle(page,run,5,'trigger');assert.equal((await outputs(run,2)).lineCount,2);
  await run('undo();ensureEditorComponentGraph()');assert.equal((await outputs(run,2)).lineCount,1);
  await run('redo();ensureEditorComponentGraph();save()');await page.reload();await run('appStarted');
  await waitOutput(page,2,'lineCount',2);await page.waitForTimeout(160);assert.deepEqual(await outputs(run,2),{text:'llo\nllo',lineCount:2});
}));

test('a transform error atomically rejects the submitted event instead of committing partial source or Memo state',async()=>app(async({page,run})=>{
  await seed(run,extractorCircuit);await pause(page,run);await submit(page,run,0,'Hello World');
  await run("items[1].state={...items[1].state,mode:'regex match'};items[1].bindings={text:items[1].bindings.text};items[1].inputValues={pattern:'['};render();ensureEditorComponentGraph()");
  const before=await run('JSON.stringify(items.map(item=>item.state))');
  const {field,input}=await openEntry(page,run,0);await input.fill('Rejected');await input.press('Enter');await run('smartHitSettled');
  assert.equal(await run('JSON.stringify(items.map(item=>item.state))'),before);
  assert.match(await field.textContent(),/regular expression|regex/i);assert.equal(await field.getAttribute('data-submissions'),'0');await input.press('Escape');
}));

test('hybrid ports preserve strict signal types and do not convert incompatible numeric events to text implicitly',async()=>app(async({page,run})=>{
  await seed(run,[{key:'numberInput'},{key:'memo',bindings:{line:{uid:'event-0',port:'value'}}}]);await pause(page,run);
  const record=await run('(async()=>{const graph=await ensureEditorComponentGraph();return graph.get(items[1]);})()');assert.match(record.error,/type|number|string|incompatible/i);
  const {field,input}=await openEntry(page,run,0,'number');await input.fill('2');await input.press('Enter');await run('smartHitSettled');
  assert.equal(await run('items[1].state.lineCount'),0);assert.equal(await field.getAttribute('data-submissions'),'0');
  await input.press('Escape');
}));

test('offline HTML transforms captured events, updates the live extraction range, and reprocesses without duplicate pulses',async()=>app(async({page,run,context})=>{
  await seed(run,extractorCircuit);const handles={};
  for(const index of [0,3,4])handles[index]=(await entryPoint(run,index)).handle;
  handles[5]=(await entryPoint(run,5,'trigger')).handle;
  const {reader,errors,requests}=await openExport(page,run,context);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===7);
  await reader.locator('#feedbackPause').click();
  async function enter(index,value){
    await readerClick(reader,index,handles[index]);const field=reader.locator('[data-smart-inline-input]');await field.waitFor();const input=field.locator('input');
    const before=Number(await field.getAttribute('data-submissions')||0);await input.fill(value);await input.press('Enter');
    await reader.waitForFunction(({field,before})=>Number(field.dataset.submissions)>before,{field:await field.elementHandle(),before});await input.press('Escape');await field.waitFor({state:'detached'});
  }
  const lines=()=>reader.locator('[data-smart-index="2"] text').allTextContents();
  const count=text=>reader.locator('[data-smart-index="2"] text').evaluateAll((nodes,text)=>nodes.filter(node=>node.textContent===text).length,text);
  async function waitLine(text,n=1){await reader.waitForFunction(({text,n})=>[...document.querySelectorAll('[data-smart-index="2"] text')].filter(node=>node.textContent===text).length===n,{text,n});}
  await enter(0,'Hello World');await waitLine('llo');await enter(0,'Another Test');await waitLine('oth');
  await enter(3,'3');await enter(4,'5');
  await reader.waitForFunction(()=>[...document.querySelectorAll('[data-smart-index="6"] text')].some(node=>node.textContent==='ther '));
  assert.equal(await count('ther '),0);
  for(let i=1;i<=2;i++){await readerClick(reader,5,handles[5]);await waitLine('ther ',i);}
  await reader.locator('#feedbackPause').click();await reader.waitForTimeout(350);assert.equal(await count('ther '),2);
  assert.ok((await lines()).includes('llo'));assert.ok((await lines()).includes('oth'));
  assert.equal(await reader.locator('[data-component-error]').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('incremental value evaluation skips unrelated branches and stops at an unchanged output',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    const make=(key,uid,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,...extra});
    const a=make('constant','a',{state:{value:2.1}}),round=make('numberFunction','round',{inputValues:{operation:'floor'},bindings:{value:{uid:'a',port:'value'}}}),
      text=make('numberToText','text',{bindings:{value:{uid:'round',port:'value'}}}),b=make('constant','b',{state:{value:9}}),
      btext=make('numberToText','btext',{bindings:{value:{uid:'b',port:'value'}}});
    const list=[a,round,text,b,btext],owners=new Map(),counts={};
    const call=(item,hook,args)=>{if(!owners.has(item))owners.set(item,createSmartExecution(item));if(hook==='compute')counts[item.uid]=(counts[item.uid]||0)+1;
      return hook==='caps'?requestSmartCaps(item,owners.get(item),args[0]):requestSmartCall(item,hook,args,owners.get(item));};
    const timeline=createComponentTimeline(()=>0);
    try{
      await settleComponentTimeline(list,call,()=>true,timeline);for(const key of Object.keys(counts))counts[key]=0;
      a.state.value=2.8;let graph=await settleComponentTimeline(list,call,()=>true,timeline);const same={...counts};
      for(const key of Object.keys(counts))counts[key]=0;a.state.value=3.8;graph=await settleComponentTimeline(list,call,()=>true,timeline);
      return {same,changed:{...counts},output:graph.get(text).io.outputs.text,other:graph.get(btext).io.outputs.text};
    }finally{for(const owner of owners.values())disposeSmartExecution(owner);}
  })()`);
  assert.ok(result.same.a>0);assert.ok(result.same.round>0);assert.equal(result.same.text,0,'unchanged floor result stops its dependent conversion');
  for(const counts of [result.same,result.changed]){assert.equal(counts.b,0);assert.equal(counts.btext,0,'unrelated branch is not computed');}
  assert.ok(result.changed.text>0);assert.equal(result.output,'3');assert.equal(result.other,'9');
}));

test('Memo Clear consumes a hybrid command once and does not clear later text when its queued Boolean pulse runs',async()=>app(async({page,run})=>{
  await seed(run,[{key:'textInput'},{key:'memo',bindings:{line:{uid:'event-0',port:'value'},clear:{uid:'event-2',port:'value'}}},{key:'trigger'}]);
  await pause(page,run);await submit(page,run,0,'old');assert.equal((await outputs(run,1)).text,'old');
  await clickHandle(page,run,2,'trigger');assert.deepEqual(await outputs(run,1),{text:'',lineCount:0});
  await submit(page,run,0,'new');assert.deepEqual(await outputs(run,1),{text:'new',lineCount:1});
  await pause(page,run);await idle(page);await waitOutput(page,2,'value',false);
  assert.deepEqual(await outputs(run,1),{text:'new',lineCount:1},'queued low/high signal must not execute the command a second time');
}));

test('Boolean comparison events clear Memo only when true, while false leaves newly appended text intact',async()=>app(async({page,run})=>{
  await seed(run,[{key:'textInput'},
    {key:'textCompare',inputValues:{compare:'clear',operation:'equals'},bindings:{text:{uid:'event-0',port:'value'}}},
    {key:'memo',bindings:{line:{uid:'event-0',port:'value'},clear:{uid:'event-1',port:'value'}}}]);
  await pause(page,run);await submit(page,run,0,'keep');assert.deepEqual(await outputs(run,2),{text:'keep',lineCount:1});
  await submit(page,run,0,'clear');assert.deepEqual(await outputs(run,2),{text:'',lineCount:0});
  await submit(page,run,0,'later');assert.deepEqual(await outputs(run,2),{text:'later',lineCount:1});
}));

test('switching a high hybrid command to value-only mode establishes a baseline without manufacturing a rising edge',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    const make=(key,uid,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,...extra});
    const source=make('constant','high',{state:{value:true},script:"({apiVersion:2,eventApi:1,inputs:{},outputs:{value:{type:'boolean',event:true}},compute(inputs,state){return {value:state.value};},children(){return [];}})"}),
      extract=make('textExtract','extract',{inputValues:{text:'Hello World',start:2,length:3},bindings:{reprocess:{uid:'high',port:'value'}}}),
      memo=make('memo','log',{bindings:{line:{uid:'extract',port:'text'}}});
    const list=[source,extract,memo],owners=new Map(),call=(item,hook,args)=>{
      if(!owners.has(item))owners.set(item,createSmartExecution(item));
      return hook==='caps'?requestSmartCaps(item,owners.get(item),args[0]):requestSmartCall(item,hook,args,owners.get(item));
    },timeline=createComponentTimeline(()=>0);
    try{
      let graph=await settleComponentTimeline(list,call,()=>true,timeline);
      const initial=memo.state.lineCount;
      extract.eventModes={reprocess:'value'};graph=await settleComponentTimeline(list,call,()=>true,timeline);
      const switched=memo.state.lineCount;
      source.state.value=false;await settleComponentTimeline(list,call,()=>true,timeline);
      source.state.value=true;await settleComponentTimeline(list,call,()=>true,timeline);
      return {initial,switched,final:memo.state.text,count:memo.state.lineCount};
    }finally{for(const owner of owners.values())disposeSmartExecution(owner);}
  })()`);
  assert.equal(result.initial,0);assert.equal(result.switched,0,'Receive events change cannot manufacture an occurrence from an already high signal');
  assert.equal(result.final,'llo');assert.equal(result.count,1,'a subsequent real false-to-true edge still reprocesses');
}));
