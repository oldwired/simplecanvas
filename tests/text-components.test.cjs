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
    await page.route('http://text-components.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://text-components.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function seed(run,specs){
  await run(`cancelGesture();items=${JSON.stringify(specs)}.map((spec,index)=>{
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===spec.key).items[0]);
    return {...base,uid:'text-'+index,x:70+(index%3)*450,y:100+Math.floor(index/3)*330,...spec,state:{...base.state,...spec.state}};
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
async function clickHandle(page,run,index,id){
  await run(`selection=[${index}];editingSmartIdx=${index};render();`);
  const point=await entryPoint(run,index,id);assert.ok(point.handle,id+' handle exists');
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+point.item.x+point.handle.x,box.y+point.item.y+point.handle.y);await run('smartHitSettled');
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
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-text-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'document.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('dialog',dialog=>{errors.push('Unexpected reader '+dialog.type()+': '+dialog.message());return dialog.dismiss();});
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  return {reader,errors,requests};
}
const textCircuit=[{key:'textInput',componentName:'Message'},
  {key:'memo',componentName:'Messages',bindings:{line:{uid:'text-0',port:'value'},append:{uid:'text-0',port:'submitted'}}},
  {key:'textLabel',componentName:'Latest log',bindings:{value:{uid:'text-1',port:'text'}}},
  {key:'counter',componentName:'Submissions',bindings:{value:{uid:'text-0',port:'submitted'}}}];

test('inline text accepts repeated Enter and pointer submission without reopening the control',async()=>app(async({page,run})=>{
  await seed(run,textCircuit);
  const {field,input}=await openEntry(page,run,0);assert.equal(await input.getAttribute('id'),'smartTextValue');
  await input.pressSequentially('Hello');
  assert.equal((await outputs(run,0)).value,'','typing is a draft until submission');
  assert.deepEqual(await outputs(run,1),{text:'',lineCount:0});
  await input.press('Enter');await waitOutput(page,1,'text','Hello');await idle(page);
  assert.equal(await field.isVisible(),true,'Enter leaves the field available for the next entry');
  assert.equal(await input.evaluate(element=>element===document.activeElement),true);
  assert.equal((await outputs(run,2)).value,'Hello');assert.equal(await run('items[3].state.count'),1);
  await input.press('Enter');await waitOutput(page,1,'text','Hello\nHello');await idle(page);
  assert.deepEqual(await outputs(run,1),{text:'Hello\nHello',lineCount:2});
  assert.equal((await outputs(run,2)).value,'Hello\nHello');assert.equal(await run('items[3].state.count'),2);
  await input.fill('');await field.getByRole('button',{name:'Submit',exact:true}).click();
  await waitOutput(page,1,'lineCount',3);await idle(page);
  assert.equal((await outputs(run,1)).text,'Hello\nHello\n','an explicitly submitted empty line is preserved');
  assert.equal(await run('items[3].state.count'),3);
}));

test('Number input accepts finite decimals and emits for unchanged values, while invalid and cancelled drafts emit nothing',async()=>app(async({page,run})=>{
  await seed(run,[{key:'numberInput',state:{min:-100,max:100,step:.001}},
    {key:'valueLabel',bindings:{value:{uid:'text-0',port:'value'}}},
    {key:'counter',bindings:{value:{uid:'text-0',port:'submitted'}}}]);
  const initial=(await outputs(run,0)).value;
  for(const invalid of ['', '1e309','101','-100.001','0.0001']){
    const {field,input}=await openEntry(page,run,0,'number');await input.fill(invalid);
    await field.getByRole('button',{name:'Submit',exact:true}).click();
    assert.equal(await field.isVisible(),true,'invalid number keeps the inline field open');
    assert.equal((await outputs(run,0)).value,initial);assert.equal(await run('items[2].state.count'),0);
    await input.press('Escape');await field.waitFor({state:'detached'});await run('smartHitSettled');
  }
  await submit(page,run,0,'-12.5',{type:'number',enter:true});await waitOutput(page,1,'value',-12.5);await idle(page);
  await submit(page,run,0,'-12.5',{type:'number'});await page.waitForFunction(()=>__test.run('items[2].state.count')===2);await idle(page);
  assert.equal((await outputs(run,0)).value,-12.5);
  const {field,input}=await openEntry(page,run,0,'number');await input.fill('99');await input.press('Escape');
  await field.waitFor({state:'detached'});await run('smartHitSettled');
  assert.equal((await outputs(run,1)).value,-12.5);assert.equal(await run('items[2].state.count'),2);
}));

test('outside clicks and Escape discard text drafts and leave the next inline edit usable',async()=>app(async({page,run})=>{
  await seed(run,textCircuit);
  for(const action of ['outside','blur','Escape']){
    const {field,input}=await openEntry(page,run,0);await input.fill('discard me');
    if(action==='outside')await page.mouse.click(20,900);
    else if(action==='blur')await input.evaluate(element=>element.blur());
    else await input.press('Escape');
    await field.waitFor({state:'detached'});await run('smartHitSettled');
    assert.deepEqual(await outputs(run,1),{text:'',lineCount:0});assert.equal(await run('items[3].state.count'),0);
  }
  await submit(page,run,0,'accepted');await waitOutput(page,1,'text','accepted');await idle(page);
  assert.equal(await run('items[3].state.count'),1);
}));

test('inline editing keeps the simulation running and preserves a draft across render refreshes',async()=>app(async({page,run})=>{
  await seed(run,[{key:'textInput'},{key:'pulseGenerator',inputValues:{seconds:.2,width:.1}},
    {key:'counter',bindings:{value:{uid:'text-1',port:'value'}}}]);
  const {field,input}=await openEntry(page,run,0);await input.fill('still typing');
  const before=await run('({time:componentTimelineNow(editorTimeline),count:items[2].state.count})');
  await page.waitForFunction(before=>__test.run('items[2].state.count')>before,before.count);
  await run('render();ensureEditorComponentGraph()');
  assert.ok(await run('componentTimelineNow(editorTimeline)')>before.time,'typing does not pause simulation time');
  assert.equal(await input.inputValue(),'still typing','repaints do not replace an unsubmitted draft');
  assert.equal(await field.isVisible(),true);
  await input.press('Enter');await waitOutput(page,0,'value','still typing');
}));

test('inline text and number fields discard stale drafts after tab switches, undo, or page hiding',async()=>app(async({page,run})=>{
  for(const key of ['textInput','numberInput'])for(const action of ['undo','tab','hidden','visibility']){
    const type=key==='textInput'?'text':'number';
    await seed(run,[{key},{key:'counter',bindings:{value:{uid:'text-0',port:'submitted'}}}]);
    const original=(await outputs(run,0)).value,tabId=await run('activeTabId');
    await run('beginHistory();items[0].x+=1;commitHistory();save();');
    const {field,input}=await openEntry(page,run,0,type);await input.fill(type==='text'?'stale':'42');
    if(action==='hidden')await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    else if(action==='visibility')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    else await run(action==='undo'?'undo()':'newTab()');
    await field.waitFor({state:'detached'});await run('smartHitSettled');
    if(action==='hidden')await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    if(action==='visibility')await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    if(action==='tab'){assert.equal(await run('items.length'),0);await run('activateTab('+JSON.stringify(tabId)+')');}
    assert.equal((await outputs(run,0)).value,original);assert.equal(await run('items[1].state.count'),0);
    await submit(page,run,0,type==='text'?'fresh':'7',{type});await waitOutput(page,1,'count',1);await idle(page);
    assert.equal((await outputs(run,0)).value,type==='text'?'fresh':7);assert.equal(await run('items[1].state.count'),1);
  }
}));

test('Memo primes existing highs, honors Clear over Set over Append, and rejects overflowing edits without truncation',async()=>app(async({page,run})=>{
  await seed(run,[{key:'memo',inputValues:{content:'seed',line:'line',set:true,append:true,clear:true}},
    {key:'textLabel',bindings:{value:{uid:'text-0',port:'text'}}}]);
  assert.deepEqual(await outputs(run,0),{text:'',lineCount:0},'fresh high control levels are not actions');
  const change=async values=>{await run(`items[0].inputValues={...items[0].inputValues,...${JSON.stringify(values)}};render();`);return outputs(run,0);};
  const low={set:false,append:false,clear:false};
  await change(low);assert.deepEqual(await change({set:true,append:true}),{text:'seed',lineCount:1});
  await change({content:'different'});assert.equal((await outputs(run,0)).text,'seed','held Set does not reapply changed content');
  await change(low);assert.deepEqual(await change({clear:true,set:true,append:true}),{text:'',lineCount:0});
  await change(low);assert.deepEqual(await change({append:true}),{text:'line',lineCount:1});
  await change(low);assert.deepEqual(await change({append:true}),{text:'line\nline',lineCount:2});
  const full='x'.repeat(2000);await change(low);assert.equal((await change({content:full,set:true})).text,full);
  await change(low);assert.deepEqual(await change({append:true}),{text:full,lineCount:1});
  assert.equal((await outputs(run,1)).value,full,'rejected append leaves downstream data intact');
  await page.waitForFunction(()=>__test.run('smartChildrenFor(items[0],false).some(child=>child.type==="text" && /limit|full|2000|long/i.test(child.text))'));
  assert.match(await run('items[0].state.notice'),/limit|full|2000|long/i);
  await change(low);assert.deepEqual(await change({clear:true}),{text:'',lineCount:0});
  assert.equal(await run('items[0].state.notice'),'','a successful action clears the old limit notice');
  const literal='---\n# Heading';await change(low);
  assert.deepEqual(await change({content:literal,set:true}),{text:literal,lineCount:2});
  const svg=await run('itemsToSVGMarkup(clone(items),{liveSmart:true})');
  const glyphs=await page.evaluate(svg=>[...new DOMParser().parseFromString(svg,'image/svg+xml').querySelectorAll('[data-smart-index]')]
    .map(host=>[...host.querySelectorAll('text')].map(text=>text.textContent)),svg);
  assert.equal(glyphs.length,2);
  for(const [index,texts] of glyphs.entries()){
    assert.ok(texts.includes('---'),['Memo','Text label'][index]+' renders literal dashes instead of a Markdown rule');
    assert.ok(texts.includes('# Heading'),['Memo','Text label'][index]+' preserves the literal heading marker');
  }
}));

test('independent input and Memo instances retain their data through reload without replaying submissions',async()=>app(async({page,run})=>{
  await seed(run,[...textCircuit,{key:'textInput',componentName:'Other message'},
    {key:'memo',componentName:'Other log',bindings:{line:{uid:'text-4',port:'value'},append:{uid:'text-4',port:'submitted'}}}]);
  await submit(page,run,0,'first');await waitOutput(page,1,'text','first');await idle(page);
  await submit(page,run,4,'second');await waitOutput(page,5,'text','second');await idle(page,4);
  await submit(page,run,0,'first');await waitOutput(page,1,'text','first\nfirst');await idle(page);
  await run('save()');await page.reload();await run('appStarted');
  await waitOutput(page,1,'text','first\nfirst');await waitOutput(page,5,'text','second');
  await page.waitForTimeout(180);
  assert.equal((await outputs(run,0)).value,'first');assert.equal((await outputs(run,4)).value,'second');
  assert.deepEqual(await outputs(run,1),{text:'first\nfirst',lineCount:2});
  assert.deepEqual(await outputs(run,5),{text:'second',lineCount:1});assert.equal(await run('items[3].state.count'),2);
  await submit(page,run,4,'second');await waitOutput(page,5,'text','second\nsecond');await idle(page,4);
  assert.equal((await outputs(run,1)).text,'first\nfirst');
}));

test('paused text submissions preserve each distinct value and resume as ordered append pulses',async()=>app(async({page,run})=>{
  await seed(run,[{key:'constant'}]);
  await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');
  assert.equal(await page.locator('#componentPauseBtn').textContent(),'Resume');
  // Introduce fresh inputs while already paused: their first accepted entry must
  // survive the first runtime transition just as later entries do.
  await seed(run,textCircuit);
  for(const value of ['first','second','first'])await submit(page,run,0,value);
  assert.deepEqual(await outputs(run,1),{text:'',lineCount:0},'paused submissions cannot advance downstream storage');
  assert.equal(await run('items[3].state.count'),0);
  await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');
  await waitOutput(page,1,'text','first\nsecond\nfirst');await idle(page);
  assert.deepEqual(await outputs(run,1),{text:'first\nsecond\nfirst',lineCount:3});
  assert.equal(await run('items[3].state.count'),3,'each queued value receives its own rising edge');
}));

test('an external Clear rising edge cancels paused text submissions without appending or replaying them',async()=>app(async({page,run})=>{
  await seed(run,[{...textCircuit[0],bindings:{clear:{uid:'text-6',port:'value'}}},...textCircuit.slice(1),{key:'toggle'},
    {key:'buffer',bindings:{value:{uid:'text-4',port:'value'}}},{key:'buffer',bindings:{value:{uid:'text-5',port:'value'}}}]);
  await submit(page,run,0,'retained note');await waitOutput(page,1,'text','retained note');await idle(page);
  await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');
  for(const value of ['discard first','discard second'])await submit(page,run,0,value);
  assert.equal((await outputs(run,0)).value,'discard second');
  await clickHandle(page,run,4,'toggle');assert.equal((await outputs(run,6)).value,true,'Clear travels through both Buffer gates');
  assert.deepEqual(await outputs(run,1),{text:'retained note',lineCount:1});
  await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');
  await waitOutput(page,0,'value','');await idle(page);
  assert.deepEqual(await outputs(run,0),{value:'',submitted:false});
  assert.equal(await run('items[3].state.count'),1,'Clear emits no submitted pulse');
  await page.waitForTimeout(180);
  assert.deepEqual(await outputs(run,1),{text:'retained note',lineCount:1});
  assert.equal(await run('items[3].state.count'),1,'cancelled entries do not reappear at later wake times');
  await submit(page,run,0,'while clear held');await waitOutput(page,1,'text','retained note\nwhile clear held');await idle(page);
  assert.equal((await outputs(run,0)).value,'while clear held','a held high Clear does not repeatedly erase later entries');
  await clickHandle(page,run,4,'toggle');await clickHandle(page,run,4,'toggle');await waitOutput(page,0,'value','');
  assert.equal(await run('items[3].state.count'),2);assert.equal((await outputs(run,1)).lineCount,2);
}));

test('Submitted can clear its own text input after Memo records the accepted value in the editor and offline HTML',async()=>app(async({page,run,context})=>{
  await seed(run,[{...textCircuit[0],state:{required:true},bindings:{clear:{uid:'text-0',port:'submitted'}}},...textCircuit.slice(1)]);
  for(const count of [1,2]){
    await submit(page,run,0,'repeat',{enter:count===1});await waitOutput(page,1,'lineCount',count);await idle(page);
    assert.deepEqual(await outputs(run,0),{value:'',submitted:false},'self-clear finishes with an empty required field');
    assert.deepEqual(await outputs(run,1),{text:Array(count).fill('repeat').join('\n'),lineCount:count});
    assert.equal(await run('items[3].state.count'),count);
  }
  const handle=(await entryPoint(run,0)).handle,{reader,errors,requests}=await openExport(page,run,context);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===4);
  for(const count of [3,4]){
    if(count===3)await readerClick(reader,0,handle);
    const field=reader.locator('[data-smart-inline-input]'),input=field.locator('input');
    await field.waitFor({state:'visible'});assert.equal(await input.inputValue(),'','the public field is empty after self-clear');
    await input.fill('repeat');await input.press('Enter');
    await reader.waitForFunction(count=>[...document.querySelectorAll('[data-smart-index="3"] text')].filter(text=>text.textContent===String(count)).length===2,count);
    await reader.waitForFunction(count=>[...document.querySelectorAll('[data-smart-index="1"] text')].filter(text=>text.textContent==='repeat').length===count,count);
    await reader.waitForFunction(()=>document.querySelector('#smartTextValue')?.value==='');
    assert.equal(await reader.locator('[data-smart-index="1"] text').evaluateAll(texts=>texts.filter(text=>text.textContent==='repeat').length),count,
      'Memo receives each accepted payload before its source is cleared');
  }
  const field=reader.locator('[data-smart-inline-input]');
  assert.equal(await field.locator('input').inputValue(),'');await field.locator('input').press('Escape');
  assert.equal(await reader.locator('[data-component-error]').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('offline HTML accepts text and numeric submissions, preserves literal markup, and reloads without replay',async()=>app(async({page,run,context})=>{
  await seed(run,[...textCircuit.map(spec=>spec.key==='textLabel'?{...spec,h:180}:spec),{key:'numberInput',state:{min:-100,max:100,step:.001}},
    {key:'counter',bindings:{value:{uid:'text-4',port:'submitted'}}}]);
  const literal='$x^2$ </script><img src=x onerror=alert(1)>';
  await submit(page,run,0,literal);await waitOutput(page,1,'text',literal);await idle(page);
  const textHandle=(await entryPoint(run,0)).handle,numberHandle=(await entryPoint(run,4)).handle;
  const {reader,errors,requests}=await openExport(page,run,context);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===6);
  const readerSubmit=async(index,handle,value,type,enter=false)=>{
    await readerClick(reader,index,handle);const field=reader.locator('[data-smart-inline-input]');
    await field.waitFor({state:'visible'});const input=field.locator('input'),before=Number(await field.getAttribute('data-submissions')||0);await input.fill(value);
    if(enter)await input.press('Enter');else await field.getByRole('button',{name:'Submit',exact:true}).click();
    await reader.waitForFunction(({field,before})=>Number(field.dataset.submissions)>before,{field:await field.elementHandle(),before});
    await input.press('Escape');await field.waitFor({state:'detached'});
  };
  const counter=async(index,value)=>reader.waitForFunction(({index,value})=>[...document.querySelectorAll('[data-smart-index="'+index+'"] text')].filter(text=>text.textContent===String(value)).length===2,{index,value});
  assert.ok((await reader.locator('[data-smart-index="2"]').textContent()).replace(/\s+/g,'').includes(literal.replace(/\s+/g,'')));
  assert.equal(await reader.locator('[data-smart-index] img').count(),0,'markup in text cannot become DOM');
  await readerSubmit(0,textHandle,literal,'text',true);await counter(3,2);
  await reader.waitForTimeout(160);
  await readerSubmit(0,textHandle,literal,'text');await counter(3,3);
  await readerClick(reader,0,textHandle);const cancelled=reader.locator('[data-smart-inline-input]');
  await cancelled.locator('input').fill('discard');await cancelled.locator('input').press('Escape');await cancelled.waitFor({state:'detached'});
  await readerSubmit(4,numberHandle,'3.125','number',true);await counter(5,1);
  await reader.waitForTimeout(160);await readerSubmit(4,numberHandle,'3.125','number');await counter(5,2);
  await readerClick(reader,4,numberHandle);const invalid=reader.locator('[data-smart-inline-input]');
  await invalid.locator('input').fill('');await invalid.getByRole('button',{name:'Submit',exact:true}).click();
  assert.equal(await invalid.isVisible(),true);await invalid.locator('input').press('Escape');
  await counter(3,3);await counter(5,2);
  assert.equal(await reader.locator('[data-smart-index] img').count(),0);assert.equal(await reader.locator('[data-component-error]').count(),0);
  await reader.reload();await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===6);
  await counter(3,1);await counter(5,0);await reader.waitForTimeout(180);await counter(3,1);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('an external Clear refreshes a pristine field while preserving an unsubmitted draft',async()=>app(async({page,run})=>{
  await seed(run,[{key:'textInput',inputValues:{clear:false}}]);
  await submit(page,run,0,'published');await idle(page);
  const {field,input}=await openEntry(page,run,0);assert.equal(await input.inputValue(),'published');
  await run('items[0].inputValues.clear=true;render();ensureEditorComponentGraph()');
  await waitOutput(page,0,'value','');await page.waitForFunction(()=>document.querySelector('#smartTextValue')?.value==='');
  await run('items[0].inputValues.clear=false;render();ensureEditorComponentGraph()');
  await input.fill('draft survives');
  await run('items[0].inputValues.clear=true;render();ensureEditorComponentGraph()');
  await waitOutput(page,0,'value','');await run('render()');
  assert.equal(await input.inputValue(),'draft survives','Clear changes published state without erasing an in-progress draft');
  await input.press('Escape');await field.waitFor({state:'detached'});
  const reopened=await openEntry(page,run,0);assert.equal(await reopened.input.inputValue(),'','Escape exposes the current cleared state');
}));

function assertBox(actual,expected,message){
  for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<2,
    `${message}: ${key} ${actual[key]} matches ${expected[key]}`);
}

test('inline fields follow rotated group geometry in the editor and scaled SVG geometry in offline HTML',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'textInput',x:250,y:210,rotation:17,group:'text-pair',groupRotation:-28},
    {key:'textLabel',x:650,y:280,group:'text-pair',groupRotation:-28,bindings:{value:{uid:'text-0',port:'value'}}}]);
  const {field,input,handle}=await openEntry(page,run,0);assert.ok(handle.inline,'entry describes its actual field rectangle');
  const invalidBoxes=await run(`[{x:-1,y:0,w:10,h:10},{x:0,y:0,w:321,h:10},{x:0,y:65,w:10,h:10},{x:0,y:0,w:0,h:10}].map(inline=>{
    try{validateSmartReply({ok:true,result:[{id:'entry',kind:'text',x:0,y:0,value:'',inline}]},{method:'call',fn:'handles',args:[{},320,72]});return null;}
    catch(error){return error.message;}
  })`);
  for(const error of invalidBoxes)assert.match(error,/Inline entry must fit inside|Entry width/,'malformed or external entry boxes are rejected');
  const expected=await run(`(()=>{
    const item=items[0],box=${JSON.stringify(handle.inline)},canvasBox=canvas.getBoundingClientRect();
    const corners=[[box.x,box.y],[box.x+box.w,box.y],[box.x+box.w,box.y+box.h],[box.x,box.y+box.h]]
      .map(([x,y])=>toWorld(item,item.x+x,item.y+y));
    const x=Math.min(...corners.map(point=>point.x)),y=Math.min(...corners.map(point=>point.y));
    return {x:canvasBox.x+x,y:canvasBox.y+y,width:Math.max(...corners.map(point=>point.x))-x,height:Math.max(...corners.map(point=>point.y))-y};
  })()`);
  assertBox(await field.boundingBox(),expected,'editor field is placed on the rotated component');
  await input.fill('rotated');await input.press('Enter');await waitOutput(page,1,'value','rotated');await input.press('Escape');
  const {reader,errors,requests}=await openExport(page,run,context);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===2);
  await readerClick(reader,0,handle);
  const readerField=reader.locator('[data-smart-inline-input]');await readerField.waitFor({state:'visible'});
  const svgBox=()=>reader.locator('[data-smart-index="0"]').evaluate((host,box)=>{
    const matrix=host.firstElementChild.getScreenCTM();
    const points=[[box.x,box.y],[box.x+box.w,box.y],[box.x+box.w,box.y+box.h],[box.x,box.y+box.h]]
      .map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
    const x=Math.min(...points.map(point=>point.x)),y=Math.min(...points.map(point=>point.y));
    return {x,y,width:Math.max(...points.map(point=>point.x))-x,height:Math.max(...points.map(point=>point.y))-y};
  },handle.inline);
  assertBox(await readerField.boundingBox(),await svgBox(),'reader field follows the SVG screen transform');
  await reader.setViewportSize({width:1000,height:800});
  await reader.waitForTimeout(80);
  assertBox(await readerField.boundingBox(),await svgBox(),'reader field follows a changed export scale');
  await readerField.locator('input').fill('scaled');await readerField.locator('input').press('Enter');
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="1"]')?.textContent.includes('scaled'));
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('Inputs exposes optional text-control hints, submission state, label name, and Memo counts',async()=>app(async({page,run})=>{
  const specs=[
    {key:'textInput',componentName:'Message',flags:{showSubmitted:'Show submission state',showHints:'Show hints'},preview:/Enter to submit.*Submitted: false/},
    {key:'numberInput',componentName:'Quantity',flags:{showSubmitted:'Show submission state',showHints:'Show hints'},preview:/Enter to submit.*Submitted: false/},
    {key:'textLabel',componentName:'Greeting',flags:{showName:'Show name',showHints:'Show hints'},preview:/Greeting.*Empty text/},
    {key:'memo',componentName:'Notes',flags:{showCounts:'Show counts',showHints:'Show hints'},preview:/Empty memo.*0 lines/}
  ];
  await seed(run,specs.map(({key,componentName})=>({key,componentName})));
  for(const [index,spec] of specs.entries()){
    await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
    for(const [name,label] of Object.entries(spec.flags)){
      const setting=page.getByRole('combobox',{name:label,exact:true});
      assert.equal(await setting.inputValue(),'false',spec.key+' defaults '+name+' off');
      await setting.selectOption('true');
      await page.waitForFunction(name=>document.querySelector('#component-setting-'+name)?.value==='true',name);
    }
    await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});
    for(const name of Object.keys(spec.flags))assert.equal(await run(`items[${index}].state[${JSON.stringify(name)}]`),true);
    await page.waitForFunction(({index,pattern})=>__test.run(`new RegExp(${JSON.stringify(pattern)}).test((smartChildrenCache.get(items[${index}].uid)?.kids||[]).map(child=>child.text||'').join(' '))`),{index,pattern:spec.preview.source});
    await page.locator('#componentBindingsBtn').click();
    for(const [name,label] of Object.entries(spec.flags)){
      const setting=page.getByRole('combobox',{name:label,exact:true});assert.equal(await setting.inputValue(),'true');
      await setting.selectOption('false');await page.waitForFunction(name=>document.querySelector('#component-setting-'+name)?.value==='false',name);
    }
    await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});
    for(const name of Object.keys(spec.flags))assert.equal(await run(`items[${index}].state[${JSON.stringify(name)}]`),false);
    await page.waitForFunction(({index,pattern})=>__test.run(`!new RegExp(${JSON.stringify(pattern)}).test((smartChildrenCache.get(items[${index}].uid)?.kids||[]).map(child=>child.text||'').join(' '))`),{index,pattern:spec.preview.source});
  }
}));

test('Text label uses ordinary stroke controls for optional colored dashed outlines in canvas, SVG, and offline HTML',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'textLabel',inputValues:{value:'A plain label'}}]);
  await page.waitForFunction(()=>__test.run('smartChildrenCache.get(items[0].uid)?.kids.some(child=>child.text==="A plain label")'));
  assert.equal(await run('smartChildrenCache.get(items[0].uid).kids.some(child=>child.type==="rect")'),false,'labels have no frame by default');
  await run('selection=[0];render()');
  await page.locator('#strokeBtn').click();await page.locator('#strokePicker [data-c="#3b82f6"]').click();
  await page.locator('#sizeBtn').click();
  await page.locator('#sizeRange').evaluate(input=>{input.value='4';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#dashPicker [data-dash="wide"]').click();await page.locator('#sizeBtn').click();
  await page.waitForFunction(()=>__test.run('smartChildrenCache.get(items[0].uid)?.kids.some(child=>child.type==="rect" && child.strokeOn!==false && child.color==="#3b82f6" && child.size===4 && child.dash==="wide")'));
  const canvas=await page.evaluate(()=>{
    const strokes=[],original=CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.id==='canvas' && this.strokeStyle==='#3b82f6')strokes.push({color:this.strokeStyle,width:this.lineWidth,dash:this.getLineDash()});return original.apply(this,args);};
    try{__test.run('render()');return strokes;}finally{CanvasRenderingContext2D.prototype.stroke=original;}
  });
  assert.deepEqual(canvas,[{color:'#3b82f6',width:4,dash:[18,12]}],'canvas paints the chosen outline style');
  const svg=await run('itemsToSVGMarkup(clone(items),{liveSmart:true})');
  const stroke=await page.evaluate(svg=>{
    const node=new DOMParser().parseFromString(svg,'image/svg+xml').querySelector('[data-smart-index] [stroke="#3b82f6"]');
    return node?{width:node.getAttribute('stroke-width'),dash:node.getAttribute('stroke-dasharray').split(/[ ,]+/).map(Number)}:null;
  },svg);assert.deepEqual(stroke,{width:'4',dash:[18,12]});
  const {reader,errors,requests}=await openExport(page,run,context);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-ready="true"]'));
  const border=reader.locator('[data-smart-index="0"] [stroke="#3b82f6"]');assert.equal(await border.count(),1);
  assert.equal(await border.getAttribute('stroke-width'),'4');assert.deepEqual((await border.getAttribute('stroke-dasharray')).split(/[ ,]+/).map(Number),[18,12]);
  await page.locator('#strokeBtn').click();await page.locator('#strokeNoneSwatch').click();
  await page.waitForFunction(()=>__test.run('items[0].strokeOn===false && !smartChildrenCache.get(items[0].uid)?.kids.some(child=>child.type==="rect")'));
  const plainSvg=await run('itemsToSVGMarkup(clone(items),{liveSmart:true})');
  assert.equal(await page.evaluate(svg=>new DOMParser().parseFromString(svg,'image/svg+xml').querySelectorAll('[data-smart-index] [stroke="#3b82f6"]').length,plainSvg),0);
  const plain=await openExport(page,run,context);await plain.reader.waitForFunction(()=>document.querySelector('[data-smart-ready="true"]'));
  assert.equal(await plain.reader.locator('[data-smart-index="0"] [stroke="#3b82f6"]').count(),0);
  assert.match(await plain.reader.locator('[data-smart-index="0"]').textContent(),/A plain label/);
  assert.deepEqual([...errors,...plain.errors],[]);assert.deepEqual([...requests,...plain.requests],[]);
}));
