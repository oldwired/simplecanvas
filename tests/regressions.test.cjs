const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

// Exercise the real single-file app. Expose its closure in the served test copy only;
// geometry, persistence, event handlers, and rendering all remain production code.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace('\n})();', '\nwindow.__test = {run: source => eval(source)};\n})();');
let browser;
before(async () => {
  browser = await chromium.launch({headless:true,
    ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
});
after(async () => { if(browser) await browser.close(); });

async function app(fn, options={}){
  const context = await browser.newContext({viewport:{width:1280,height:900}, ...options.context});
  try{
    if(options.init) await context.addInitScript(options.init);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.route('http://simplecanvas.test/**', route => route.fulfill({
      status:route.request().url().endsWith('index.html') ? 200 : 404,
      contentType:'text/html', body:html
    }));
    await page.goto('http://simplecanvas.test/index.html');
    const run = code => page.evaluate(code => window.__test.run(code), code);
    await fn({page, run, context});
    assert.deepEqual(errors, [], 'no uncaught application errors');
  } finally { await context.close(); }
}
const rectangle = (uid='rect') => ({type:'rect',uid,x:100,y:100,w:160,h:100,size:2,
  color:'#1f2937',strokeOn:true,fill:true,fillColor:'#ffd166'});
async function downloadedJSON(page, run, expression){
  const download = page.waitForEvent('download');
  await run(expression);
  return JSON.parse(fs.readFileSync(await (await download).path(), 'utf8'));
}

test('quota failures preserve tab contents, history, recovery export, and retry', async () => app(async ({page,run}) => {
  await run(`beginHistory();items=[${JSON.stringify(rectangle('before'))}];commitHistory();`);
  const original = await run('activeTabId');
  await page.evaluate(() => {
    for(const size of [50000,1000,50]){
      for(let n=0;n<2000;n++){
        try{ localStorage.setItem('quota-'+size+'-'+n, 'x'.repeat(size)); }
        catch{ break; }
      }
    }
  });
  await run(`beginHistory();items.push(${JSON.stringify(rectangle('after'))});commitHistory();newTab();`);
  assert.equal(await page.locator('#autosaveWarning').isVisible(), true);
  await run(`activateTab(${JSON.stringify(original)})`);
  assert.deepEqual(await run('items.map(it=>it.uid)'), ['before','after']);
  const exported = await downloadedJSON(page,run,'exportWorkspace()');
  assert.equal(exported.tabs[0].items.length,2);
  assert.equal(exported.tabs.length,2);
  await run('undo()'); assert.equal(await run('items.length'),1);
  await run('redo()'); assert.equal(await run('items.length'),2);
  await page.evaluate(() => {
    for(const key of Object.keys(localStorage)) if(key.startsWith('quota-')) localStorage.removeItem(key);
  });
  await run('save()');
  assert.equal(await page.locator('#autosaveWarning').isVisible(), false);
  await page.reload();
  assert.deepEqual(await run('items.map(it=>it.uid)'), ['before','after']);
}));

test('disabled browser storage still permits drawing, tabs, and workspace export', async () => app(async ({page,run}) => {
  const original=await run('activeTabId');
  await run(`beginHistory();items=[${JSON.stringify(rectangle())}];commitHistory();newTab();activateTab(${JSON.stringify(original)});`);
  assert.equal(await run('items.length'),1);
  assert.equal(await page.locator('#autosaveWarning').isVisible(),true);
  const exported=await downloadedJSON(page,run,'exportWorkspace()');
  assert.equal(exported.tabs[0].items.length,1);
}, {init:() => {
  for(const method of ['getItem','setItem','removeItem']) Storage.prototype[method]=()=>{throw new DOMException('Storage disabled','SecurityError');};
}}));

test('large legacy sketches migrate without duplicating their storage', async () => app(async ({page,run}) => {
  // Seed from a page without the app's visibilitychange autosave handler.
  await page.route('http://simplecanvas.test/seed',route=>route.fulfill({body:'',contentType:'text/html'}));
  await page.goto('http://simplecanvas.test/seed');
  const bytes=await page.evaluate(() => {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=900;
    const ctx=canvas.getContext('2d'), image=ctx.createImageData(900,900);
    let seed=12345;
    for(let i=0;i<image.data.length;i+=4){
      for(let c=0;c<3;c++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;image.data[i+c]=seed>>>24;}
      image.data[i+3]=255;
    }
    ctx.putImageData(image,0,0);
    const data=JSON.stringify({version:2,items:[{type:'image',id:'large',x:100,y:100,w:400,h:400}],assets:{large:canvas.toDataURL()}});
    localStorage.clear();localStorage.setItem('simplecanvas:v1',data);return data.length;
  });
  assert.ok(bytes>3_000_000);
  await page.goto('http://simplecanvas.test/index.html');
  assert.equal(await run('items.length'),1);
  assert.equal(await run('activeTabId'),'legacy');
  assert.equal(await page.locator('#autosaveWarning').isVisible(),false);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('simplecanvas:doc:')).length),0);
  await run('save()');await page.reload();
  assert.equal(await run('items[0].id'),'large');
}));

test('workspace replacement retains old storage until new documents and index succeed', async () => app(async ({page,run}) => {
  await run(`beginHistory();items=[${JSON.stringify(rectangle('old'))}];commitHistory();`);
  const oldIndex=await page.evaluate(()=>localStorage.getItem('simplecanvas:tabs:v1'));
  const oldKey=await run('docKey(activeTabId)');
  const workspace={app:'SimpleCanvasWorkspace',version:2,activeIndex:1,tabs:[
    {name:'Imported A',items:[rectangle('a')]},{name:'Imported B',items:[rectangle('b')]}
  ]};
  await page.evaluate(()=>{
    window.realStorageSet=Storage.prototype.setItem;let writes=0;
    Storage.prototype.setItem=function(key,value){
      if(key.startsWith('simplecanvas:doc:') && ++writes>=2)throw new DOMException('Full','QuotaExceededError');
      return window.realStorageSet.call(this,key,value);
    };
  });
  await run(`openWorkspaceFile(new File([${JSON.stringify(JSON.stringify(workspace))}],'workspace.json'));`);
  await page.waitForFunction(()=>__test.run('tabs[0].name')==='Imported A');
  assert.deepEqual(await run('items.map(it=>it.uid)'),['b']);
  assert.equal(await page.evaluate(()=>localStorage.getItem('simplecanvas:tabs:v1')),oldIndex);
  assert.ok(await page.evaluate(key=>localStorage.getItem(key),oldKey));
  assert.equal(await page.locator('#autosaveWarning').isVisible(),true);
  const exported=await downloadedJSON(page,run,'exportWorkspace()');
  assert.deepEqual(exported.tabs.map(t=>t.items[0].uid),['a','b']);
  await page.evaluate(()=>{Storage.prototype.setItem=window.realStorageSet;});
  await run('save()');
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),oldKey),null);
  assert.equal(await page.locator('#autosaveWarning').isVisible(),false);
  await page.reload();assert.equal(await run('items[0].uid'),'b');
}));

async function insertImage(page,run){
  await run(`const c=document.createElement('canvas');c.width=c.height=40;c.getContext('2d').fillRect(0,0,40,40);importImage(c.toDataURL());`);
  await page.waitForFunction(()=>__test.run('items.length')===1);
}
test('undo and redo retain image assets after tab switches', async () => app(async ({page,run}) => {
  await insertImage(page,run);
  const source=await run('assets[items[0].id]'), original=await run('activeTabId');
  await run(`deleteSelected();newTab();activateTab(${JSON.stringify(original)});undo();`);
  assert.equal(await run('assets[items[0].id]'),source);
  assert.match(await run('itemToSVG(items[0])'),/<image href="data:image\/png/);
  await run('redo()');assert.equal(await run('items.length'),0);
  await run('undo()');await page.reload();
  assert.equal(await run('assets[items[0].id]'),source);
}));

test('cross-tab image paste survives source closure and destination reload', async () => app(async ({page,run}) => {
  await insertImage(page,run);
  const original=await run('activeTabId'), source=await run('assets[items[0].id]');
  await run(`copySelection();newTab();closeTab(${JSON.stringify(original)});pasteClipboard();`);
  const exported=await downloadedJSON(page,run,'exportWorkspace()');
  assert.equal(exported.tabs[0].assets[exported.tabs[0].items[0].id],source);
  await page.reload();assert.equal(await run('items.length'),1);
  assert.equal(await run('assets[items[0].id]'),source);
}));

test('importing reused image ids preserves previous image pixels for undo and clipboard', async () => app(async ({run}) => {
  const result=await run(`
    const c=document.createElement('canvas');c.width=c.height=20;const cx=c.getContext('2d');
    cx.fillStyle='red';cx.fillRect(0,0,20,20);const red=c.toDataURL();
    cx.fillStyle='blue';cx.fillRect(0,0,20,20);const blue=c.toDataURL();
    const image={type:'image',id:'shared',x:100,y:100,w:20,h:20};
    applySketchToActiveTab([image],{shared:red});setTool('select');selection=[0];copySelection();
    applySketchToActiveTab([image],{shared:blue});const second=assets[items[0].id];
    undo();const restored=assets[items[0].id];redo();pasteClipboard();
    ({secondIsBlue:second===blue,restoredIsRed:restored===red,
      pastedIsRed:assets[items[1].id]===red,firstStillBlue:assets[items[0].id]===blue,
      distinctIds:items[0].id!==items[1].id});
  `);
  assert.deepEqual(result,{secondIsBlue:true,restoredIsRed:true,pastedIsRed:true,firstStillBlue:true,distinctIds:true});
}));

test('image decoding completes in its original tab', async () => app(async ({page,run}) => {
  // Both calls run in one JS task, before the image load event can fire.
  const original=await run('activeTabId');
  await run(`const c=document.createElement('canvas');c.width=c.height=20;importImage(c.toDataURL());newTab();`);
  await page.waitForFunction(id=>__test.run(`tabDocument(${JSON.stringify(id)}).items.length`)===1,original);
  assert.equal(await run('items.length'),0);
  await run(`activateTab(${JSON.stringify(original)})`);
  assert.equal(await run('items.length'),1);
  await run('undo()');assert.equal(await run('items.length'),0);
}));
