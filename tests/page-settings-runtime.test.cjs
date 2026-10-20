const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const settingsSource=fs.readFileSync(path.join(root,'examples/page-settings.js'),'utf8');
const engine=process.env.BROWSER_ENGINE||'chromium';
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>browser?.close());
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1100}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://page-settings.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://page-settings.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'editor has no uncaught errors');
  }finally{await context.close();}
}
async function seed(run,{single=false,invalid=false,duplicate=false}={}){
  await run(`cancelGesture();tabs=[{id:'settings',name:'Configured'},${single?'':"{id:'plain',name:'Default'},"}{id:'static',name:'Static'}].slice(0,${single?1:3});tabDocuments.clear();
    for(const tab of tabs)tabDocuments.set(tab.id,makeDocument());
    function builtin(key,uid,x,y,patch={}){const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]);return {...item,uid,x,y,...patch,state:{...item.state,...patch.state}};}
    const controller=builtin('textLabel','settings',80,80,{script:${JSON.stringify(settingsSource)},pageSettings:true,componentName:'Sketch settings',state:{overrideTitle:true,overrideShowTabs:true,overrideShowWiring:true,overrideShowSimulationControls:true},inputValues:{},bindings:{title:{uid:'title',port:'value'},showTabs:{uid:'tabs',port:'value'},showWiring:{uid:'wires',port:'value'},showSimulationControls:{uid:'simulation',port:'value'}}});
    ${invalid?"controller.bindings.title={uid:'missing',port:'value'};":''}
    const content=[controller,builtin('textInput','title',430,80,{state:{values:['Welcome']}}),builtin('toggle','tabs',80,300,{state:{value:false}}),builtin('toggle','wires',430,300,{state:{value:true}}),builtin('toggle','simulation',780,300,{state:{value:false}}),builtin('goToTab','next',80,520,{inputValues:{page:1,go:false},state:{showButton:true}})];
    ${duplicate?"content.push({...clone(controller),uid:'duplicate',x:790,y:80});":''}
    tabDocuments.get('settings').items=content;
    if(tabDocuments.has('plain'))tabDocuments.get('plain').items=[builtin('goToTab','back',80,80,{inputValues:{page:0,go:false},state:{showButton:true}})];
    if(tabDocuments.has('static'))tabDocuments.get('static').items=[{type:'text',uid:'static-text',x:80,y:80,w:500,h:80,text:'Static page',fontSize:24,color:'#000000',strokeOn:false}];
    enterTab('settings');render();saveTabList();`);
  await run('ensureEditorComponentGraph()');
}
async function exportFile(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-page-settings-')),file=path.join(dir,'workspace.html');
  fs.copyFileSync(await(await download).path(),file);context.on('close',()=>fs.rmSync(dir,{recursive:true,force:true}));return file;
}
async function openReader(context,file,query=''){
  const reader=await context.newPage(),errors=[],requests=[];reader.on('pageerror',error=>errors.push(error.message));
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.addInitScript(()=>{
    window.__visible=[];
    const observe=()=>{for(const panel of document.querySelectorAll('.tab-panel'))if(getComputedStyle(panel).visibility==='visible'&&getComputedStyle(panel).display!=='none'){
      const id=panel.dataset.tabId;if(!window.__visible.some(entry=>entry.id===id))window.__visible.push({id,title:document.title,tabs:!document.querySelector('.tabbar')?.hidden,wiring:!!panel.querySelector('[data-reader-wiring]'),controls:getComputedStyle(document.querySelector('[aria-label="Signal simulation"]')||document.body).display!=='none'});
    }};
    new MutationObserver(observe).observe(document,{attributes:true,childList:true,subtree:true});
  });
  await reader.goto(pathToFileURL(file).href+query);return {reader,errors,requests};
}
async function ready(reader,id='settings'){
  await reader.waitForFunction(id=>{const panel=document.querySelector('.tab-panel[data-tab-id="'+id+'"]');return panel?.getAttribute('aria-busy')==='false'&&getComputedStyle(panel).display!=='none'&&getComputedStyle(panel).visibility==='visible'&&!document.documentElement.classList.contains('sc-reader-starting');},id);
}
async function clickHandle(reader,index,x,y){
  const host=reader.locator('.tab-panel:visible [data-smart-index="'+index+'"][data-smart-ready="true"]');await host.waitFor();
  const point=await host.evaluate((host,{x,y})=>{const p=new DOMPoint(x,y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},{x,y});
  await reader.mouse.click(point.x,point.y);
}
async function editorHandle(run,index,id){return run(`(async()=>{const it=items[${index}],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it),io])).find(h=>h.id===${JSON.stringify(id)});})()`);}
async function presentation(reader){return reader.evaluate(()=>({title:document.title,tabs:!document.querySelector('.tabbar')?.hidden,wiring:!!document.querySelector('.tab-panel:not([style*="display: none"]) [data-reader-wiring]'),controls:getComputedStyle(document.querySelector('[aria-label="Signal simulation"]')).display!=='none'}));}

test('connected Sketch settings settle before first reveal and remain live without changing the editor',async()=>app(async({page,run,context})=>{
  const editorTitle=await page.title();await seed(run);assert.equal(await page.title(),editorTitle);
  assert.equal(await page.locator('#tabbar').isVisible(),true,'export visibility does not hide authoring navigation');
  const input=await editorHandle(run,1,'entry'),tabs=await editorHandle(run,2,'toggle'),wires=await editorHandle(run,3,'toggle'),simulation=await editorHandle(run,4,'toggle');
  const file=await exportFile(page,run,context),{reader,errors,requests}=await openReader(context,file);await ready(reader);
  const expected={title:'Welcome',tabs:false,wiring:true,controls:false};assert.deepEqual(await presentation(reader),expected);
  assert.deepEqual(await reader.evaluate(()=>window.__visible.find(entry=>entry.id==='settings')),{id:'settings',...expected},'no pre-settings destination frame is exposed');
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').dataset.smartReady==='true');
  const hidden=reader.locator('.tab-panel[data-tab-id="settings"] [data-smart-index="0"]');assert.equal(await hidden.textContent(),'');assert.equal(await hidden.evaluate(node=>getComputedStyle(node).pointerEvents),'none');
  await clickHandle(reader,1,input.x,input.y);const edit=reader.locator('#smartTextValue');await edit.fill('A new title');await edit.press('Enter');await reader.waitForFunction(()=>document.querySelector('#smartTextValue')?.readOnly===false);await edit.press('Escape');
  await reader.waitForFunction(()=>document.title==='A new title');
  await clickHandle(reader,2,tabs.x,tabs.y);await reader.waitForFunction(()=>!document.querySelector('.tabbar').hidden);
  await clickHandle(reader,3,wires.x,wires.y);await reader.waitForFunction(()=>!document.querySelector('[data-reader-wiring]'));
  await clickHandle(reader,4,simulation.x,simulation.y);await reader.waitForFunction(()=>getComputedStyle(document.querySelector('[aria-label="Signal simulation"]')).display!=='none');
  assert.deepEqual(await presentation(reader),{title:'A new title',tabs:true,wiring:false,controls:true});assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('Go to tab and tab clicks reset presentation; query entry and rapid activation retain only the destination settings',async()=>app(async({page,run,context})=>{
  await seed(run);const next=await editorHandle(run,5,'go'),file=await exportFile(page,run,context);
  const {reader,errors}=await openReader(context,file,'?page=1');await ready(reader,'plain');
  assert.deepEqual(await presentation(reader),{title:'Sketch',tabs:true,wiring:false,controls:true});
  await reader.locator('.tab-select[data-tab-id="settings"]').click();await ready(reader);
  await clickHandle(reader,5,next.x,next.y);await ready(reader,'plain');
  assert.deepEqual(await presentation(reader),{title:'Sketch',tabs:true,wiring:false,controls:true});
  await reader.evaluate(()=>{for(const id of ['settings','plain','settings','static'])document.querySelector('.tab-select[data-tab-id="'+id+'"]').click();});await ready(reader,'static');
  assert.deepEqual(await presentation(reader),{title:'Sketch',tabs:true,wiring:false,controls:false});
  await reader.waitForTimeout(100);assert.equal(await reader.title(),'Sketch','superseded settings cannot apply after a later activation');
  assert.deepEqual(errors,[]);
}));

test('missing inputs and duplicate Sketch settings fail closed to defaults without an exported controller error card',async()=>app(async({page,run,context})=>{
  for(const options of [{invalid:true},{duplicate:true}]){
    await seed(run,options);const {reader,errors}=await openReader(context,await exportFile(page,run,context));await ready(reader);
    assert.deepEqual(await presentation(reader),{title:'Sketch',tabs:true,wiring:false,controls:true});
    await reader.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').hasAttribute('data-component-error'));
    assert.equal(await reader.locator('.tab-panel[data-tab-id="settings"] [data-smart-index="0"]').textContent(),'');assert.deepEqual(errors,[]);await reader.close();
  }
}));

test('single-tab settings work and scripts-disabled exports retain a visible static drawing',async()=>app(async({page,run,context})=>{
  await seed(run,{single:true});const file=await exportFile(page,run,context),{reader,errors}=await openReader(context,file);await ready(reader);
  assert.equal(await reader.title(),'Welcome');assert.equal(await reader.locator('.tabbar').count(),0);assert.equal(await reader.locator('[data-reader-wiring]').count(),1);assert.deepEqual(errors,[]);
  const disabled=await browser.newContext({javaScriptEnabled:false});try{const fallback=await disabled.newPage();await fallback.goto(pathToFileURL(file).href);assert.equal(await fallback.locator('.tab-panel').isVisible(),true);assert.match(await fallback.locator('body').textContent(),/Welcome/);}finally{await disabled.close();}
}));

test('read-only wiring shares typed ports, flow arrows and dataset links and never intercepts controls',async()=>app(async({page,run,context})=>{
  await seed(run);
  await run(`datasets={shared:parseDatasetText('name,value\\nA,1','data.csv')};
    function add(key,uid,x,y,patch){const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]);items.push({...item,uid,x,y,...patch});}
    add('dataSource','store',80,740,{inputValues:{data:{datasetId:'shared'}}});
    add('dataTable','table',500,740,{bindings:{data:{uid:'store',port:'data'}}});
    items[1].rotation=Math.PI/6;editorComponentEvaluation=null;save();render();`);
  await run('ensureEditorComponentGraph()');const {reader,errors}=await openReader(context,await exportFile(page,run,context));await ready(reader);
  const overlay=reader.locator('[data-reader-wiring]');assert.equal(await overlay.evaluate(node=>getComputedStyle(node).pointerEvents),'none');
  assert.match(await overlay.getAttribute('aria-label'),/read only/);
  assert.ok(await overlay.locator('[role="button"][data-wire-edge]').count(),'links can be inspected without editing their connections');
  assert.equal(await reader.locator('#componentWireDisconnect').count(),0,'reader inspection offers no authoring controls');
  assert.ok(await overlay.locator('[data-wire-edge][data-kind="flow"][data-type="string"] path[marker-end]').count());
  assert.ok(await overlay.locator('[data-wire-edge][data-kind="flow"][data-type="boolean"] path[marker-end]').count());
  const dataset=overlay.locator('[data-wire-edge][data-kind="dataset"][data-type="table"]');assert.equal(await dataset.count(),1);assert.equal(await dataset.locator('path[marker-end]').count(),0);assert.equal(await dataset.locator('path[stroke-dasharray="6 5"]').count(),1);
  assert.match(await overlay.locator('[data-wire-port][data-uid="settings"][data-port="title"]').getAttribute('aria-label'),/Window title/);
  const topLabel=overlay.locator('[data-wire-port][data-uid="settings"][data-port="showSimulationControls"]');
  assert.ok(Array.from(await topLabel.locator('text').textContent()).length<=10,'horizontal port banks use compact labels');
  assert.match(await topLabel.locator('title').textContent(),/Show simulation controls/,'the complete label remains in the tooltip');
  const ends=await overlay.locator('[data-wire-port][data-uid="title"][data-direction="out"][data-port="value"]').evaluate(node=>{const pin=node.querySelector('circle');return {x:Number(pin.getAttribute('cx')),y:Number(pin.getAttribute('cy'))};});assert.ok(Number.isFinite(ends.x)&&Number.isFinite(ends.y));
  const toggle=await editorHandle(run,2,'toggle');await clickHandle(reader,2,toggle.x,toggle.y);await reader.waitForFunction(()=>!document.querySelector('.tabbar').hidden);assert.deepEqual(errors,[]);
}));

test('bfcache re-entry and background activation settle settings again before revealing content',async()=>app(async({page,run,context})=>{
  await seed(run);const {reader,errors}=await openReader(context,await exportFile(page,run,context));await ready(reader);
  await reader.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await ready(reader);
  assert.deepEqual(await presentation(reader),{title:'Welcome',tabs:false,wiring:true,controls:false});
  await reader.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));document.querySelector('.tab-select[data-tab-id="plain"]').click();});
  assert.equal(await reader.locator('.tab-panel[data-tab-id="plain"]').getAttribute('aria-busy'),'true');
  await reader.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await ready(reader,'plain');
  assert.deepEqual(await presentation(reader),{title:'Sketch',tabs:true,wiring:false,controls:true});assert.deepEqual(errors,[]);
}));

test('paused simulation applies Sketch settings once a stepped signal propagation has settled',async()=>app(async({page,run,context})=>{
  await seed(run,{single:true});
  const timer=`({apiVersion:2,inputs:{},outputs:{value:{type:'number'}},publish(state){return {value:state.value||0};},transition(inputs,state,memory,{now}){return {state:{value:memory.started?(state.value||0)+1:0},memory:{started:true},nextWakeAt:now+1000};},children(){return [];}})`;
  await run(`items[0].bindings.title={uid:'formatted',port:'text'};items[4].state.value=true;
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==='numberToText').items[0]);
    items.push({...base,uid:'formatted',x:800,y:600,bindings:{value:{uid:'timer',port:'value'}}},{...base,uid:'timer',x:800,y:800,script:${JSON.stringify(timer)},state:{value:0},bindings:{}});
    editorComponentEvaluation=null;render();save();`);
  await run('ensureEditorComponentGraph()');const {reader,errors}=await openReader(context,await exportFile(page,run,context));await ready(reader);
  await reader.locator('#feedbackPause').click();await reader.waitForFunction(()=>document.querySelector('#feedbackPause').textContent==='Resume');
  const before=Number(await reader.title());assert.ok(Number.isSafeInteger(before));
  for(let i=0;i<8;i++){
    const previousStatus=await reader.locator('#feedbackStatus').textContent();
    await reader.locator('#feedbackStep').click();
    await reader.waitForFunction(previous=>document.querySelector('#feedbackStatus').textContent!==previous,previousStatus);
    if(Number(await reader.title())>before)break;
  }
  assert.equal(Number(await reader.title()),before+1,'a stored signal can update the title in Pause/Step mode');
  assert.match(await reader.locator('#feedbackStatus').textContent(),/settled/);assert.deepEqual(errors,[]);
}));

test('an upstream Worker timeout reveals the destination with defaults instead of leaving startup blank',async()=>app(async({page,run,context})=>{
  await seed(run,{single:true});
  const failing=`({apiVersion:2,inputs:{},outputs:{value:{type:'string'}},compute(){while(true){}},children(){return [];}})`;
  await run(`items[1].script=${JSON.stringify(failing)};editorComponentEvaluation=null;render();save();`);
  const {reader,errors}=await openReader(context,await exportFile(page,run,context));await ready(reader);
  assert.equal(await reader.title(),'Sketch');assert.equal(await reader.locator('[data-reader-wiring]').count(),0);assert.equal(await reader.locator('[aria-label="Signal simulation"]').isVisible(),true);assert.deepEqual(errors,[]);
}));
