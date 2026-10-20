const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const script=fs.readFileSync(path.join(__dirname,'..','examples','go-to-tab.js'),'utf8');
const engine=process.env.BROWSER_ENGINE||'chromium';
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1400,height:900}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://navigation.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://navigation.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function seed(run,{go=false,showButton=true,page=1}={}){
  await run(`cancelGesture();
    tabs=[{id:'nav-a',name:'First'},{id:'nav-b',name:'Second'}];tabDocuments.clear();
    for(const tab of tabs)tabDocuments.set(tab.id,makeDocument());
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key==='textSelector').items[0]);
    const nav={...base,script:${JSON.stringify(script)},uid:'nav',componentName:'Next tab',x:60,y:70,w:240,h:120,state:{showButton:${showButton},showIndicators:true},inputValues:{page:${page},go:${go}},bindings:{}};
    const toggle={...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key==='toggle').items[0]),uid:'pulse',componentName:'Navigate',x:360,y:70,state:{value:${go},showIndicators:true}};
    nav.bindings.go={uid:'pulse',port:'value'};
    tabDocuments.get('nav-a').items=[nav,toggle];
    tabDocuments.get('nav-b').items=[{...clone(nav),uid:'nav-back',componentName:'Return',bindings:{},inputValues:{page:0,go:true},state:{showButton:true,showIndicators:true}}];
    enterTab('nav-a');saveTabList();render();`);
  await run('ensureEditorComponentGraph()');
}
async function clickEditor(page,run,index=0){
  const point=await run(`(async()=>{setTool('select');selection=[${index}];editingSmartIdx=${index};render();const it=items[${index}];
    const handles=await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it)]);return {x:it.x+handles[0].x,y:it.y+handles[0].y};})()`);
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+point.x,box.y+point.y);
}
async function active(page,id){await page.waitForFunction(id=>__test.run('activeTabId')===id,id);}
async function pulse(run,value){await run(`items[1].state.value=${value};editorComponentEvaluation=null;render();ensureEditorComponentGraph()`);}
async function readerClick(reader,index,x,y){
  const target=reader.locator('.tab-panel:visible [data-smart-index="'+index+'"][data-smart-ready="true"]');
  await target.waitFor();
  const point=await target.evaluate((host,{x,y})=>{
    const p=new DOMPoint(x,y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};
  },{x,y});await reader.mouse.click(point.x,point.y);
}
async function readerActive(reader,id){
  await reader.waitForFunction(id=>document.querySelector('.tab-select.active').dataset.tabId===id || document.querySelector('[data-data-action-error]'),id);
  const error=await reader.locator('[data-data-action-error]').textContent({timeout:100}).catch(()=>null);
  assert.equal(error,null,'navigation should succeed: '+error);
  assert.equal(await reader.locator('.tab-select.active').getAttribute('data-tab-id'),id);
}
async function openReader(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-navigation-')),file=path.join(dir,'workspace.html');
  fs.copyFileSync(await(await download).path(),file);context.on('close',()=>fs.rmSync(dir,{recursive:true,force:true}));
  const reader=await context.newPage(),errors=[],requests=[];reader.on('pageerror',error=>errors.push(error.message));
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);return {reader,errors,requests};
}

test('editor navigation buttons use zero-based target, reject absent tabs, and no-op on the current tab',async()=>app(async({page,run})=>{
  await seed(run);await clickEditor(page,run);await active(page,'nav-b');
  await run('ensureEditorComponentGraph()');await clickEditor(page,run);await active(page,'nav-a');
  await run('items[0].inputValues.page=0;editorComponentEvaluation=null;ensureEditorComponentGraph()');
  await clickEditor(page,run);await run('smartHitSettled');assert.equal(await run('activeTabId'),'nav-a');
  await run('items[0].inputValues.page=42;editorComponentEvaluation=null;ensureEditorComponentGraph()');
  await clickEditor(page,run);await run('smartHitSettled');assert.equal(await run('activeTabId'),'nav-a');
  await page.waitForFunction(()=>document.body.textContent.includes('Choose a tab index from 0 to 1'));
}));

test('editor rising trigger navigates once; initial high and high on revisiting do not bounce tabs',async()=>app(async({page,run})=>{
  await seed(run,{go:true});await run('ensureEditorComponentGraph()');assert.equal(await run('activeTabId'),'nav-a');
  await pulse(run,false);await pulse(run,true);await active(page,'nav-b');
  await run('ensureEditorComponentGraph()');assert.equal(await run('activeTabId'),'nav-b','destination high establishes its baseline');
  await run("activateTab('nav-a');ensureEditorComponentGraph()");assert.equal(await run('activeTabId'),'nav-a','revisited high does not reissue navigation');
  await pulse(run,false);await pulse(run,true);await active(page,'nav-b');
}));

test('offline exported buttons navigate and report invalid targets without leaving the document',async()=>app(async({page,run,context})=>{
  await seed(run);const {reader,errors,requests}=await openReader(page,run,context);
  await reader.waitForFunction(()=>[...document.querySelectorAll('.tab-panel')].find(panel=>panel.style.display!=='none').querySelector('[data-smart-index="0"]').textContent.includes('Go to tab 1'));
  await readerClick(reader,0,120,59);
  await readerActive(reader,'nav-b');
  await reader.waitForFunction(()=>[...document.querySelectorAll('.tab-panel')].find(panel=>panel.style.display!=='none').querySelector('[data-smart-index="0"]').textContent.includes('Go to tab 0'));
  await readerClick(reader,0,120,59);await readerActive(reader,'nav-a');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  await reader.close();
  await run('items[0].inputValues.page=42;editorComponentEvaluation=null;ensureEditorComponentGraph()');
  const invalid=await openReader(page,run,context);
  await invalid.reader.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').textContent.includes('Go to tab 42'));
  await readerClick(invalid.reader,0,120,59);
  await invalid.reader.waitForFunction(()=>document.querySelector('[data-component-event-error]')?.textContent.includes('Choose a tab index from 0 to 1'));
  assert.equal(await invalid.reader.locator('.tab-select.active').getAttribute('data-tab-id'),'nav-a');
  assert.deepEqual(invalid.errors,[]);assert.deepEqual(invalid.requests,[]);
}));

test('hidden navigation exports no button or indicators but still responds to a rising input',async()=>app(async({page,run,context})=>{
  await seed(run,{showButton:false});
  await run('items[0].x=items[1].x;items[0].y=items[1].y;items.reverse();editorComponentEvaluation=null;ensureEditorComponentGraph()');
  const {reader,errors,requests}=await openReader(page,run,context);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').textContent.includes('Navigate'));
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="1"]').dataset.smartReady==='true');
  await reader.waitForTimeout(100);
  assert.equal(await reader.locator('.tab-panel[data-tab-id="nav-a"] [data-smart-index="1"]').textContent(),'');
  assert.equal(await reader.locator('.tab-panel[data-tab-id="nav-a"] [data-smart-index="1"]').evaluate(host=>getComputedStyle(host).pointerEvents),'none');
  const toggle=await run('(async()=>{const it=items[0],handles=await requestSmartCall(it,"handles",[it.state,it.w,it.h,smartResolvedStyle(it)]);return handles[0];})()');
  await readerClick(reader,0,toggle.x,toggle.y);
  await readerActive(reader,'nav-b');
  await reader.locator('.tab-select[data-tab-id="nav-a"]').click();
  await reader.waitForFunction(()=>document.querySelector('.tab-panel[data-tab-id="nav-a"] [data-smart-index="0"]').textContent.includes('Navigate'));
  await reader.waitForTimeout(100);
  assert.equal(await reader.locator('.tab-select.active').getAttribute('data-tab-id'),'nav-a');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
