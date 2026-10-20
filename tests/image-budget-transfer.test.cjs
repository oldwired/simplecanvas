const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
let html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const app=parseApp(html);
// Exercise the real transfer paths with tiny budgets instead of allocating 64 MiB per test.
html=app.inject('window.__test={run:source=>eval(source)};');
html=html.replace('MAX_IMAGE_BYTES=16*1024*1024,MAX_SCENE_IMAGE_BYTES=64*1024*1024','MAX_IMAGE_BYTES=128,MAX_SCENE_IMAGE_BYTES=192');
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1kAAAAASUVORK5CYII=';
let browser;
before(async()=>{browser=await launchBrowser();});after(async()=>{await browser?.close();});
async function editor(fn){
  const context=await browser.newContext();
  try{
    const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());
    await page.route('http://image-budget.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://image-budget.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run(`appStarted`);
    await run(`cancelGesture();items=[{type:'image',uid:'one',id:'a',x:20,y:20,w:20,h:20},{type:'image',uid:'two',id:'b',x:60,y:20,w:20,h:20}];
      assets={a:${JSON.stringify(pixel)},b:${JSON.stringify(pixel)}};undoStack=[];redoStack=[];save();persistWorkspace()`);
    await fn({page,run});
  }finally{await context.close();}
}
test('both paste paths reject an aggregate overflow without changing objects, asset pools, history or autosave',async()=>editor(async({run})=>{
  const result=await run(`(async()=>{
    const snapshot=()=>JSON.stringify({items,assets,datasets,undoStack,redoStack});
    const before=snapshot(),stored=JSON.stringify(await readSavedWorkspace());
    clipboard=[{type:'image',uid:'new',id:'c',x:0,y:0,w:20,h:20}];clipboardAssets={c:${JSON.stringify(pixel)}};
    clipboardDatasets={};clipboardDatasetSources=new Map();
    const pasted=pasteClipboard(),sameClipboard=before===snapshot();
    const recognized=pasteObjectPayload(JSON.stringify({app:'SimpleCanvas',kind:'objects',version:FORMAT_VERSION,items:clipboard,assets:clipboardAssets}));
    await persistWorkspace();
    return {pasted,recognized,sameClipboard,sameObjects:before===snapshot(),sameStored:stored===JSON.stringify(await readSavedWorkspace()),message:toastEl.textContent};
  })()`);
  assert.equal(result.pasted,false);assert.equal(result.recognized,true);assert.equal(result.sameClipboard,true);
  assert.equal(result.sameObjects,true);assert.equal(result.sameStored,true);assert.match(result.message,/64 MiB/);
}));
test('asset-ID collisions count separately; reusing existing pixels and replacing the sketch remain valid',async()=>editor(async({run})=>{
  const result=await run(`(()=>{
    const incoming=[{type:'image',uid:'replacement',id:'a',x:0,y:0,w:20,h:20}],before=JSON.stringify(assets);
    let error='';try{adoptSceneAssets(incoming,{a:${JSON.stringify(pixel+'AAAA')}},{})}catch(e){error=e.message;}
    const unchanged=before===JSON.stringify(assets);
    clipboard=incoming;clipboardAssets={a:assets.a};clipboardDatasets={};clipboardDatasetSources=new Map();
    const reused=pasteClipboard(),reusedId=items.at(-1).id;
    applySketchToActiveTab([{...incoming[0],id:'c'}],{c:${JSON.stringify(pixel)}},activeTabId,{});
    return {error,unchanged,reused,reusedId,count:items.length,id:items[0].id};
  })()`);
  assert.match(result.error,/64 MiB/);assert.equal(result.unchanged,true);assert.equal(result.reused,true);assert.equal(result.reusedId,'a');
  assert.equal(result.count,1);assert.equal(result.id,'c');
}));
