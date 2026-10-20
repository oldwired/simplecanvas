const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://workspace-runtime.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://workspace-runtime.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
// The hidden clock can supersede an observation while a Worker reply is pending.
// Retry graph reads only; each accepted reload/capture is still issued exactly once.
async function loadWorkspace(run,page){
  const data=fs.readFileSync(path.join(__dirname,'..','examples','workspace-runtime.json'),'utf8');
  await run(`openWorkspaceFile(new File([${JSON.stringify(data)}],'workspace.json',{type:'application/json'}))`);
  await page.waitForFunction(()=>__test.run("tabs.length===3 && activeTabId==='runtime-dashboard'"));
  return run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true).then(graph=>[...graph].filter(([,r])=>r.error).map(([i,r])=>({uid:i.uid,error:r.error})))');
}

test('accepted hidden-service Reload survives switching sketches and preserves simulation time',async()=>app(async({run,page})=>{
  assert.deepEqual(await loadWorkspace(run,page),[]);
  await run(`(async()=>{
    const context=editorRuntimeContext(),owner=context.scene.find(i=>i.uid==='runtime-stock-owner');
    window.reloadRequested=false;window.releaseReload=null;
    rememberComponentDatasetSource(owner,'data',{name:'stock.csv',delimiter:',',handle:{getFile:()=>new Promise(resolve=>{window.reloadRequested=true;window.releaseReload=()=>resolve(new File(['fruit,quantity\\nGrapes,19\\n'],'stock.csv'));})}});
    const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true),name=Object.keys(graph.get(owner).caps.dataActions).find(name=>graph.get(owner).caps.dataActions[name].type==='reloadDataset');
    queueEditorComponentActionIntents([captureComponentActionIntent(owner,name,graph.get(owner),graph.datasets)]);
  })()`);
  await page.waitForFunction(()=>window.reloadRequested);
  await run("activateTab('runtime-editor');resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)");
  await page.evaluate(()=>window.releaseReload());
  await page.waitForFunction(()=>__test.run('!editorActionDispatcher.running'));
  const result=await run(`(async()=>{const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);return {rows:graph.get(items.find(i=>i.uid==='runtime-stock-editor')).io.tables.inputs.data.rows,active:activeTabId,error:toastEl.textContent};})()`);
  assert.deepEqual(result.rows,[['Grapes',19]],result.error);assert.equal(result.active,'runtime-editor');
}));

test('separate equal event commands append two captured rows while their source sketch is hidden',async()=>app(async({run,page})=>{
  assert.deepEqual(await loadWorkspace(run,page),[]);
  await run(`(async()=>{
    const source=items.find(i=>i.uid==='runtime-message');
    const next=Object.defineProperty({...source.state},Symbol.for('simplecanvas.events'),{value:[{port:'value',payload:'Kiwi'},{port:'value',payload:'Kiwi'}]});
    await commitEditorSmartEvents(source,next,()=>true);activateTab('runtime-editor');await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
  })()`);
  await page.waitForFunction(()=>__test.run('!editorActionDispatcher.running'));
  const result=await run(`(async()=>{const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);return {rows:graph.get(items.find(i=>i.uid==='runtime-stock-editor')).io.tables.inputs.data.rows,error:toastEl.textContent};})()`);
  assert.deepEqual(result.rows.slice(-2),[['Kiwi',1],['Kiwi',1]],result.error);
}));

test('deleting an action owner while a file is pending cancels its accepted reload',async()=>app(async({run,page})=>{
  assert.deepEqual(await loadWorkspace(run,page),[]);
  await run(`(async()=>{
    const owner=editorRuntimeContext().scene.find(i=>i.uid==='runtime-stock-owner');
    window.reloadRequested=false;rememberComponentDatasetSource(owner,'data',{name:'stock.csv',delimiter:',',handle:{getFile:()=>new Promise(resolve=>{window.reloadRequested=true;window.releaseReload=()=>resolve(new File(['fruit,quantity\\nGrapes,19\\n'],'stock.csv'));})}});
    const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true),name=Object.keys(graph.get(owner).caps.dataActions).find(name=>graph.get(owner).caps.dataActions[name].type==='reloadDataset');
    queueEditorComponentActionIntents([captureComponentActionIntent(owner,name,graph.get(owner),graph.datasets)]);
  })()`);
  await page.waitForFunction(()=>window.reloadRequested);
  await run("tabDocument('runtime-services').items=tabDocument('runtime-services').items.filter(i=>i.uid!=='runtime-stock-owner');editorComponentEvaluation=null");
  await page.evaluate(()=>window.releaseReload());await page.waitForFunction(()=>__test.run('!editorActionDispatcher.running'));
  assert.equal(await run("Object.values(tabDocument('runtime-services').datasets).some(table=>table.rows.some(row=>row[0]==='Grapes'))"),false);
}));
