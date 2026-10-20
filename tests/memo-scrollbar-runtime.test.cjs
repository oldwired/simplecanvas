const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

// The editor fixture exposes its closure for setup and output assertions only.
// Scrolling and submissions use real pointers; downloaded HTML is unmodified.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const lines=Array.from({length:30},(_,i)=>'Line '+String(i).padStart(2,'0'));
const initialText=lines.join('\n');
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1050}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://memo-scrollbar.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://memo-scrollbar.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function seed(run,{scrollbar=false,readerWiring=false,withToggle=false}={}){
  await run(`cancelGesture();setComponentWiringMode(false);
    function builtin(key,uid,x,y,patch={}){
      const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key===key).items[0]);
      return {...base,uid,x,y,...patch,state:{...base.state,...patch.state}};
    }
    applySketchToActiveTab([
      builtin('memo','memo',80,140,{w:360,h:200,componentName:'Log',
        state:{text:${JSON.stringify(initialText)},lineCount:30},inputValues:{showScrollbar:${scrollbar}},
        bindings:{line:{uid:'entry',port:'value'}}}),
      builtin('textInput','entry',580,140,{componentName:'Append a line'}),
      builtin('valueLabel','count',580,380,{componentName:'Stored lines',bindings:{value:{uid:'memo',port:'lineCount'}}})
      ${withToggle?",builtin('toggle','scrollbar-toggle',960,140,{componentName:'Scrollbar',state:{value:true}})":''}
      ${readerWiring?",builtin('pageSettings','settings',80,500,{state:{overrideTitle:true,overrideShowWiring:true},inputValues:{showWiring:true,title:'Scrollable memo'}})":''}
    ],{});
    selection=[];editingSmartIdx=null;setTool('select');render();`);
  await run('ensureEditorComponentGraph()');await run('save()');
}
async function outputs(run){
  return run('(async()=>{const record=(await ensureEditorComponentGraph()).get(items[0]);if(record.error)throw new Error(record.error);return record.io.outputs;})()');
}
async function handle(run,index,id){
  return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);
    const handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]);
    return {item,handle:handles.find(handle=>handle.id===${JSON.stringify(id)})};})()`);
}
async function editorPoint(page,run,item,point){
  const world=await run(`toWorld(items.find(item=>item.uid===${JSON.stringify(item.uid)}),${item.x+point.x},${item.y+point.y})`);
  const box=await page.locator('#canvas').boundingBox();
  return {x:box.x+world.x,y:box.y+world.y};
}
async function drag(page,from,to){
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
}
async function scrollEditor(page,run,end){
  await run('selection=[0];editingSmartIdx=0;render()');
  const data=await handle(run,0,'scroll');assert.ok(data.handle,'overflow exposes a scroll handle');
  const from=await editorPoint(page,run,data.item,data.handle);
  const to=await editorPoint(page,run,data.item,{x:data.handle.x,y:end==='top'?0:data.item.h});
  await drag(page,from,to);await run('smartHitSettled');await run('ensureEditorComponentGraph()');
}
async function visibleEditorLine(page,line,present=true){
  await page.waitForFunction(({line,present})=>
    __test.run(`(smartChildrenCache.get(items[0].uid)?.kids||[]).some(child=>child.text===${JSON.stringify(line)})`)===present,{line,present});
}
async function submitEditor(page,run,value){
  await run('selection=[1];editingSmartIdx=1;render()');
  const data=await handle(run,1,'entry'),point=await editorPoint(page,run,data.item,data.handle);
  await page.mouse.click(point.x,point.y);
  const field=page.locator('[data-smart-inline-input]'),input=field.locator('input');
  await input.waitFor({state:'visible'});await input.fill(value);await input.press('Enter');
  await page.waitForFunction(value=>__test.run('items[0].state.text').endsWith('\n'+value),value);
  await run('smartHitSettled');await input.press('Escape');await field.waitFor({state:'detached'});
}
async function clickEditorHandle(page,run,index,id){
  await run(`selection=[${index}];editingSmartIdx=${index};render()`);
  const data=await handle(run,index,id),point=await editorPoint(page,run,data.item,data.handle);
  await page.mouse.click(point.x,point.y);await run('smartHitSettled');await run('ensureEditorComponentGraph()');
}
async function openExport(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-memo-scroll-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'memo.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('dialog',dialog=>{errors.push('Unexpected reader dialog: '+dialog.message());return dialog.dismiss();});
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>[...document.querySelectorAll('[data-smart-index]')].every(host=>host.dataset.smartReady==='true'));
  return {reader,errors,requests};
}
async function readerPoint(page,index,point){
  const host=page.locator('[data-smart-index="'+index+'"]');
  return host.evaluate((host,point)=>{
    const p=new DOMPoint(point.x,point.y).matrixTransform(host.firstElementChild.getScreenCTM());
    return {x:p.x,y:p.y};
  },point);
}
async function visibleReaderLine(page,line,present=true){
  await page.waitForFunction(({line,present})=>
    [...document.querySelectorAll('[data-smart-index="0"] text')].some(node=>node.textContent===line)===present,{line,present});
}
async function submitReader(page,point,value,count){
  const location=await readerPoint(page,1,point);
  assert.equal(await page.evaluate(point=>document.elementFromPoint(point.x,point.y)?.closest('[data-smart-index]')?.dataset.smartIndex,location),'1','component controls take pointer priority over crossing wires');
  await page.mouse.click(location.x,location.y);
  const field=page.locator('[data-smart-inline-input]'),input=field.locator('input');
  await input.waitFor({state:'visible'});await input.fill(value);await input.press('Enter');
  await page.waitForFunction(count=>[...document.querySelectorAll('[data-smart-index="2"] text')].some(node=>node.textContent===String(count)),count);
  await input.press('Escape');await field.waitFor({state:'detached'});
}

test('Memo scrollbar is opt-in in Edit; dragging reveals earlier text without changing stored outputs',async()=>app(async({page,run})=>{
  await seed(run);await visibleEditorLine(page,'Line 29');
  assert.equal(await run('items[0].inputValues.showScrollbar'),false);
  assert.equal((await handle(run,0,'scroll')).handle,undefined,'default Memo has no scroll handle');
  await run('selection=[0];render()');await page.locator('#componentBindingsBtn').click();
  const literal=page.getByRole('combobox',{name:'Show scrollbar value',exact:true});
  assert.equal(await literal.inputValue(),'false');await literal.selectOption('true');
  await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});
  assert.equal(await run('items[0].inputValues.showScrollbar'),true);
  const before=await outputs(run);assert.deepEqual(before,{text:initialText,lineCount:30});
  await scrollEditor(page,run,'top');await visibleEditorLine(page,'Line 00');await visibleEditorLine(page,'Line 29',false);
  assert.deepEqual(await outputs(run),before,'scrolling changes presentation only');
  await run('save()');await page.reload();await run('appStarted');
  assert.equal(await run('items[0].inputValues.showScrollbar'),true,'literal input survives reload');
  await visibleEditorLine(page,'Line 00');assert.deepEqual(await outputs(run),before);
}));

test('a bound Toggle shows and hides Memo scrollbar without losing text or reading position in editor and HTML',async()=>app(async({page,run,context})=>{
  await seed(run,{scrollbar:true,readerWiring:true,withToggle:true});
  await run('selection=[0];render()');await page.locator('#componentBindingsBtn').click();
  await page.getByRole('combobox',{name:'Show scrollbar (boolean)',exact:true})
    .selectOption(JSON.stringify({uid:'scrollbar-toggle',port:'value'}));
  await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});
  assert.deepEqual(await run('items[0].bindings.showScrollbar'),{uid:'scrollbar-toggle',port:'value'});
  await scrollEditor(page,run,'top');await visibleEditorLine(page,'Line 00');
  const before=await outputs(run),position=await run('items[0].state.scrollOffset');
  await clickEditorHandle(page,run,3,'toggle');await visibleEditorLine(page,'Line 29');
  assert.equal((await handle(run,0,'scroll')).handle,undefined,'false removes the scroll handle');
  assert.equal(await run('items[0].state.scrollOffset'),position,'hiding retains the reading position');
  assert.deepEqual(await outputs(run),before,'the display control cannot change stored data');
  await clickEditorHandle(page,run,3,'toggle');await visibleEditorLine(page,'Line 00');
  assert.ok((await handle(run,0,'scroll')).handle,'true restores the scrollbar');
  assert.deepEqual(await outputs(run),before);

  const toggle=(await handle(run,3,'toggle')).handle;
  const {reader,errors,requests}=await openExport(page,run,context);
  await reader.locator('[data-reader-wiring] [data-wire-port]').first().waitFor({state:'visible'});
  await visibleReaderLine(reader,'Line 00');
  const memo=reader.locator('[data-smart-index="0"]'),rectangles=await memo.locator('rect').count();
  const point=await readerPoint(reader,3,toggle);
  await reader.mouse.click(point.x,point.y);await visibleReaderLine(reader,'Line 29');
  assert.equal(await memo.locator('rect').count(),rectangles-2,'false hides track and thumb');
  await reader.mouse.click(point.x,point.y);await visibleReaderLine(reader,'Line 00');
  assert.equal(await memo.locator('rect').count(),rectangles,'true restores track and thumb at the retained position');
  assert.ok(await reader.locator('[data-smart-index="2"]').textContent().then(text=>text.includes('30')));
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('Memo follows appended lines at the bottom and preserves the reading position when scrolled up',async()=>app(async({page,run})=>{
  await seed(run,{scrollbar:true});await visibleEditorLine(page,'Line 29');
  await submitEditor(page,run,'At the bottom');await visibleEditorLine(page,'At the bottom');
  assert.equal((await outputs(run)).lineCount,31);
  await scrollEditor(page,run,'top');await visibleEditorLine(page,'Line 00');
  await submitEditor(page,run,'While reading');await visibleEditorLine(page,'Line 00');await visibleEditorLine(page,'While reading',false);
  assert.deepEqual(await outputs(run),{text:initialText+'\nAt the bottom\nWhile reading',lineCount:32});
  await scrollEditor(page,run,'bottom');await visibleEditorLine(page,'While reading');
  await submitEditor(page,run,'Following again');await visibleEditorLine(page,'Following again');
  assert.equal((await outputs(run)).lineCount,33);
  if(process.env.ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.ARTIFACT_DIR,'memo-scrollbar-editor-'+engine+'.png')});
}));

test('downloaded HTML scrolls Memo with wiring visible and preserves live append behavior offline',async()=>app(async({page,run,context})=>{
  await seed(run,{scrollbar:true,readerWiring:true});
  const data=await handle(run,0,'scroll'),entry=(await handle(run,1,'entry')).handle;
  assert.ok(data.handle);
  const {reader,errors,requests}=await openExport(page,run,context);
  await reader.locator('[data-reader-wiring] [data-wire-port]').first().waitFor({state:'visible'});
  await visibleReaderLine(reader,'Line 29');
  const from=await readerPoint(reader,0,data.handle),to=await readerPoint(reader,0,{x:data.handle.x,y:0});
  await drag(reader,from,to);await visibleReaderLine(reader,'Line 00');await visibleReaderLine(reader,'Line 29',false);
  assert.ok(await reader.locator('[data-smart-index="2"]').textContent().then(text=>text.includes('30')));
  await submitReader(reader,entry,'Reader appended',31);
  await visibleReaderLine(reader,'Line 00');await visibleReaderLine(reader,'Reader appended',false);
  // A press at the bottom of the track is an intentional jump back to the tail.
  const bottom=await readerPoint(reader,0,{x:data.handle.x,y:data.item.h-8});
  await reader.mouse.click(bottom.x,bottom.y);await visibleReaderLine(reader,'Reader appended');
  await submitReader(reader,entry,'Reader follows',32);await visibleReaderLine(reader,'Reader follows');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'downloaded reader needs no network');
  if(process.env.ARTIFACT_DIR)await reader.screenshot({path:path.join(process.env.ARTIFACT_DIR,'memo-scrollbar-reader-'+engine+'.png')});
}));
