const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

// Setup and editor assertions expose the closure; all edits cross the real
// Worker boundary and exported HTML runs unchanged, without network access.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{await browser?.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1050}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://memo-log.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://memo-log.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function seed(run,logMode=false){
  await run(`cancelGesture();setComponentWiringMode(false);
    function builtin(key,uid,x,y,patch={}){
      const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key===key).items[0]);
      return {...base,uid,x,y,...patch,state:{...base.state,...patch.state}};
    }
    applySketchToActiveTab([
      builtin('textInput','entry',80,120,{componentName:'Append a line'}),
      builtin('memo','events',500,120,{w:320,h:220,componentName:'Event log',
        state:{text:'A\\nB\\nC',lineCount:3,maxLines:3,maxLength:12,logMode:${logMode}},
        bindings:{line:{uid:'entry',port:'value'}}}),
      builtin('memo','pulses',940,120,{w:320,h:220,componentName:'Pulse log',
        state:{text:'A\\nB\\nC',lineCount:3,maxLines:3,maxLength:12,logMode:${logMode}},
        eventModes:{line:'value'},bindings:{line:{uid:'entry',port:'value'},append:{uid:'entry',port:'submitted'}}})
    ],{});
    selection=[];editingSmartIdx=null;setTool('select');render();`);
  await run('ensureEditorComponentGraph()');await run('save()');
}
const outputs=(run,index)=>run(`(async()=>{const record=(await ensureEditorComponentGraph()).get(items[${index}]);
  if(record.error)throw new Error(record.error);return record.io.outputs;})()`);
async function waitText(page,index,text){
  await page.waitForFunction(({index,text})=>__test.run(`editorComponentEvaluation?.records?.get(items[${index}])?.io.outputs.text`)===text,{index,text});
}
async function waitIdle(page){
  await page.waitForFunction(()=>__test.run('editorComponentEvaluation?.records?.get(items[0])?.io.outputs.submitted')===false);
}
async function entryPoint(run){
  return run(`(async()=>{const item=items[0],io=await resolveSmartComponentIo(item);
    const handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]);
    return {item,handle:handles.find(handle=>handle.id==='entry')};})()`);
}
async function submit(page,run,value){
  await run('selection=[0];editingSmartIdx=0;render()');
  const {item,handle}=await entryPoint(run),box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+handle.x,box.y+item.y+handle.y);
  const field=page.locator('[data-smart-inline-input]'),input=field.locator('input');
  await input.waitFor({state:'visible'});
  const before=Number(await field.getAttribute('data-submissions')||0);
  await input.fill(value);await input.press('Enter');
  await page.waitForFunction(before=>Number(document.querySelector('[data-smart-inline-input]')?.dataset.submissions)>before,before);
  await run('smartHitSettled');await input.press('Escape');await field.waitFor({state:'detached'});
}
async function enableLog(page,run,index){
  await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
  const setting=page.locator('#component-setting-logMode');
  assert.equal(await setting.inputValue(),'false','log mode is optional and initially off');
  await setting.selectOption('true');
  await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});
  assert.equal(await run(`items[${index}].state.logMode`),true);
}
async function openExport(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-memo-log-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'memo-log.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('dialog',dialog=>{errors.push('Unexpected reader dialog: '+dialog.message());return dialog.dismiss();});
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===3);
  return {reader,errors,requests};
}
async function readerTexts(page,index,expected){
  await page.waitForFunction(({index,expected})=>JSON.stringify(
    [...document.querySelectorAll('[data-smart-index="'+index+'"] text')].map(node=>node.textContent))===JSON.stringify(expected),{index,expected});
}
async function submitReader(page,handle,value){
  const position=await page.locator('[data-smart-index="0"]').evaluate((host,handle)=>{
    const p=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());
    return {x:p.x,y:p.y};
  },handle);
  await page.mouse.click(position.x,position.y);
  const field=page.locator('[data-smart-inline-input]'),input=field.locator('input');
  await input.waitFor({state:'visible'});
  const before=Number(await field.getAttribute('data-submissions')||0);
  await input.fill(value);await input.press('Enter');
  await page.waitForFunction(before=>Number(document.querySelector('[data-smart-inline-input]')?.dataset.submissions)>before,before);
  await input.press('Escape');await field.waitFor({state:'detached'});
}

test('Memo Log mode enabled in Edit evicts oldest lines for hybrid events and Append pulses while length failures retain text',async()=>app(async({page,run})=>{
  await seed(run);
  await submit(page,run,'D');
  await page.waitForFunction(()=>__test.run('[items[1],items[2]].every(item=>/Line limit/.test(item.state.notice))'));
  await waitIdle(page);
  for(const index of [1,2]){
    assert.deepEqual(await outputs(run,index),{text:'A\nB\nC',lineCount:3},'ordinary mode rejects over-capacity appends');
    await enableLog(page,run,index);
    assert.deepEqual(await outputs(run,index),{text:'A\nB\nC',lineCount:3},'turning the mode on is not a data operation');
  }
  await submit(page,run,'D');
  for(const index of [1,2])await waitText(page,index,'B\nC\nD');
  await waitIdle(page);
  await submit(page,run,'too-long-value');
  await page.waitForFunction(()=>__test.run('[items[1],items[2]].every(item=>/Character limit/.test(item.state.notice))'));
  for(const index of [1,2])assert.deepEqual(await outputs(run,index),{text:'B\nC\nD',lineCount:3},'rejected append does not partly evict old lines');
  await waitIdle(page);
  for(const expected of ['C\nD\nE','D\nE\nE']){
    await submit(page,run,'E');
    for(const index of [1,2])await waitText(page,index,expected);
    await waitIdle(page);
  }
  for(const index of [1,2])assert.deepEqual(await outputs(run,index),{text:'D\nE\nE',lineCount:3},'equal submitted values are separate log entries');
}));

test('Undo restores evicted Memo entries and redo/reload retain the log without replaying accepted events',async()=>app(async({page,run})=>{
  await seed(run,true);await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');
  await submit(page,run,'D');await waitText(page,1,'B\nC\nD');
  const before=await run('undoStack.length');
  await submit(page,run,'E');await waitText(page,1,'C\nD\nE');
  assert.equal(await run('undoStack.length'),before+1,'one accepted submission owns its log eviction');
  await run('undo();ensureEditorComponentGraph()');assert.deepEqual(await outputs(run,1),{text:'B\nC\nD',lineCount:3});
  await run('redo();ensureEditorComponentGraph()');assert.deepEqual(await outputs(run,1),{text:'C\nD\nE',lineCount:3});
  await run('save()');await page.reload();await run('appStarted');
  await waitText(page,1,'C\nD\nE');
  assert.equal(await run('items[1].state.logMode'),true);
  await page.waitForTimeout(180);
  assert.deepEqual(await outputs(run,1),{text:'C\nD\nE',lineCount:3},'reload does not turn retained source values into new log events');
}));

test('downloaded offline HTML rolls Memo logs through both hybrid Line and traditional Append connections',async()=>app(async({page,run,context})=>{
  await seed(run,true);const {handle}=await entryPoint(run);
  const {reader,errors,requests}=await openExport(page,run,context);
  for(const [value,expected] of [['D',['B','C','D']],['E',['C','D','E']],['E',['D','E','E']]]){
    await submitReader(reader,handle,value);
    await readerTexts(reader,1,['Event log',...expected]);
    await readerTexts(reader,2,['Pulse log',...expected]);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'the exported log works without fetching scripts or data');
}));
