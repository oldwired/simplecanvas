const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
assert.ok(['chromium','webkit'].includes(engine), 'BROWSER_ENGINE must be chromium or webkit');

// Exercise the real single-file app. Expose its closure in the served test copy only;
// geometry, persistence, event handlers, and rendering all remain production code.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace('\n})();', '\nwindow.__test = {run: source => eval(source)};\n})();');
let browser;
before(async () => {
  browser = await ({chromium,webkit}[engine]).launch({headless:true,
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
    const origin=options.origin || 'http://simplecanvas.test';
    await page.route(origin+'/**', route => route.fulfill({
      status:route.request().url().endsWith('index.html') ? 200 : 404,
      contentType:'text/html', body:html
    }));
    await page.goto(origin+'/index.html');
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
async function downloadedHTML(page, run){
  const download=page.waitForEvent('download');await run('exportHtml()');
  return fs.readFileSync(await (await download).path(),'utf8');
}

test('HTML export embeds active images and commits text being edited', async () => app(async ({page,run,context}) => {
  await insertImage(page,run);
  const source=await run('assets[items[0].id]');
  const text={...wrappedText,text:'previous'};
  await run(`items.push(${JSON.stringify(text)});openText(1);textInput.value='latest edit';`);
  const exported=await downloadedHTML(page,run);
  const preview=await context.newPage();await preview.setContent(exported);
  assert.equal(await preview.locator('image').count(),1);
  assert.equal(await preview.locator('image').getAttribute('href'),source);
  assert.equal(await preview.locator('.tabbar').count(),0);
  assert.equal((await preview.locator('tspan').allTextContents()).join(' '),'latest edit');
  assert.equal(await run('assets[items[0].id]'),source);
  assert.equal(await run('items[1].text'),'latest edit');
}));

test('HTML tabs retain their own images and group pivots without changing live state', async () => app(async ({page,run,context}) => {
  const fixture=await run(`
    const c=document.createElement('canvas');c.width=c.height=30;const cx=c.getContext('2d');
    cx.fillStyle='red';cx.fillRect(0,0,30,30);const red=c.toDataURL();
    cx.fillStyle='blue';cx.fillRect(0,0,30,30);const blue=c.toDataURL();
    const scene=x=>[{type:'image',uid:'image',id:'shared',x,y:100,w:30,h:30},
      {...${JSON.stringify(rectangle('a'))},x,group:'shared-group',groupRotation:.5},
      {...${JSON.stringify(rectangle('b'))},x:x+200,group:'shared-group',groupRotation:.5}];
    applySketchToActiveTab(scene(100),{shared:red});const first=activeTabId;
    newTab();applySketchToActiveTab(scene(500),{shared:blue});
    ({red,blue,first,second:activeTabId,width:cssW,height:cssH});
  `);
  const preview=await context.newPage();
  for(const active of [fixture.second,fixture.first]){
    await run(`activateTab(${JSON.stringify(active)});selection=[1,2];render();
      window.liveRefs={items,assets,docs:tabs.map(t=>tabDocument(t.id))};`);
    const before=await run('JSON.stringify({items,assets,selection,activeTabId,docs:tabs.map(t=>documentForFile(tabDocument(t.id)))})');
    const exported=await downloadedHTML(page,run);
    assert.equal(await run('JSON.stringify({items,assets,selection,activeTabId,docs:tabs.map(t=>documentForFile(tabDocument(t.id)))})'),before);
    assert.equal(await run('items===liveRefs.items && assets===liveRefs.assets && tabs.every((t,i)=>tabDocument(t.id).assets===liveRefs.docs[i].assets)'),true);
    await preview.setContent(exported);
    const panels=preview.locator('.tab-panel');assert.equal(await panels.count(),2);
    for(let i=0;i<2;i++){
      await preview.locator('.tab-select').nth(i).click();
      assert.equal(await panels.nth(i).isVisible(),true);
      assert.equal(await panels.nth(i).locator('image').getAttribute('href'),i===0?fixture.red:fixture.blue);
      assert.equal(Number(await panels.nth(i).locator('svg').getAttribute('width')),fixture.width);
      assert.equal(Number(await panels.nth(i).locator('svg').getAttribute('height')),fixture.height);
      const rotations=await panels.nth(i).locator('g[transform^="rotate"]').evaluateAll(groups=>groups.map(g=>({text:g.getAttribute('transform'),matrix:{a:g.getCTM().a,b:g.getCTM().b}})));
      assert.equal(rotations.length,2);
      for(const rotation of rotations){
        assert.match(rotation.text,new RegExp(' '+(i===0?280:680)+' 150\\)'));
        assert.ok(Math.abs(rotation.matrix.a-Math.cos(.5))<1e-6 && Math.abs(rotation.matrix.b-Math.sin(.5))<1e-6);
      }
    }
  }
}));

test('HTML export preserves all working tabs when storage writes fail', async () => app(async ({page,run,context}) => {
  await run(`beginHistory();items=[${JSON.stringify(rectangle('before'))}];commitHistory();`);
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Full','QuotaExceededError');};});
  await run(`beginHistory();items.push(${JSON.stringify(rectangle('after'))});commitHistory();newTab();
    beginHistory();items=[${JSON.stringify(rectangle('never-saved'))}];commitHistory();newTab();`);
  assert.equal(await page.locator('#autosaveWarning').isVisible(),true);
  const exported=await downloadedHTML(page,run);
  const preview=await context.newPage();await preview.setContent(exported);
  assert.deepEqual(await preview.locator('.tab-panel').evaluateAll(panels=>panels.map(p=>p.querySelectorAll('svg > g > rect').length)),[2,1,0]);
}));

test('copy/paste keeps editable objects before the PNG fallback without internal clipboard state', async () => app(async ({page,run}) => {
  // Capture ClipboardItems without touching the OS clipboard; replay their actual MIME payloads.
  await page.evaluate(()=>{
    window.clipboardWrites=[];
    Object.defineProperty(navigator.clipboard,'write',{value:async entries=>{clipboardWrites.push(entries);}});
  });
  await run(`items=[{...${JSON.stringify(rectangle('a'))},group:'copied',groupRotation:.3},
    {...${JSON.stringify(line)},group:'copied',groupRotation:.3}];setTool('select');selection=[0,1];render();`);
  await page.keyboard.press('Control+c');
  const captured=await page.evaluate(async()=>{
    const entry=clipboardWrites.at(-1)[0], text=await(await entry.getType('text/plain')).text(), png=await entry.getType('image/png');
    const bytes=Array.from(new Uint8Array(await png.arrayBuffer()));
    const dt=new DataTransfer();dt.setData('text/plain',text);dt.items.add(new File([png],'copy.png',{type:'image/png'}));
    window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,cancelable:true,bubbles:true}));
    return {text,bytes};
  });
  assert.deepEqual(await run('items.map(it=>it.type)'),['rect','line','rect','line']);
  assert.equal(await run('items[2].group===items[3].group && items[2].group!==items[0].group'),true);
  assert.equal(await run('items[2].groupRotation'),.3);
  await run('undo()');assert.equal(await run('items.length'),2);
  await run('redo()');assert.equal(await run('items.length'),4);
  await page.reload();assert.equal(await run('clipboard.length'),0);
  await page.evaluate(({text,bytes})=>{
    const dt=new DataTransfer();dt.setData('text/plain',text);
    dt.items.add(new File([new Uint8Array(bytes)],'copy.png',{type:'image/png'}));
    window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,cancelable:true,bubbles:true}));
  },captured);
  assert.deepEqual(await run('items.slice(-2).map(it=>it.type)'),['rect','line']);
  assert.equal(await run('items.length'),6);
}, {origin:'http://localhost:8874'}));

test('structured clipboard validates objects and preserves conflicting image assets through undo', async () => app(async ({page,run}) => {
  const fixture=await run(`
    const c=document.createElement('canvas');c.width=c.height=20;const cx=c.getContext('2d');
    cx.fillStyle='red';cx.fillRect(0,0,20,20);const red=c.toDataURL();
    cx.fillStyle='blue';cx.fillRect(0,0,20,20);const blue=c.toDataURL();
    const image={type:'image',uid:'same',id:'shared',x:100,y:100,w:20,h:20};
    applySketchToActiveTab([image],{shared:blue});
    ({red,blue,payload:{app:'SimpleCanvas',kind:'objects',version:2,assets:{shared:red},items:[image,{type:'nonsense'}]}});
  `);
  await page.evaluate(payload=>{
    const dt=new DataTransfer();dt.setData('text/plain',JSON.stringify(payload));
    window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,cancelable:true,bubbles:true}));
  },fixture.payload);
  assert.deepEqual(await run('items.map(it=>assets[it.id])'),[fixture.blue,fixture.red]);
  assert.equal(await run('items[0].id!==items[1].id && items[0].uid!==items[1].uid'),true);
  await run('undo()');assert.deepEqual(await run('items.map(it=>assets[it.id])'),[fixture.blue]);
  await run('redo()');await page.reload();
  assert.deepEqual(await run('items.map(it=>assets[it.id])'),[fixture.blue,fixture.red]);
}));

test('external PNG paste still wins over the internal clipboard when JSON is invalid', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(rectangle())}];setTool('select');selection=[0];copySelection();`);
  await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=c.height=20;
    const blob=await new Promise(resolve=>c.toBlob(resolve));
    const dt=new DataTransfer();dt.setData('text/plain','{"app":"SimpleCanvas","kind":"objects","version":2,"items":[{"type":"broken"}]}');
    dt.items.add(new File([blob],'external.png',{type:'image/png'}));
    window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,cancelable:true,bubbles:true}));
  });
  await page.waitForFunction(()=>__test.run('items.length')===2);
  assert.deepEqual(await run('items.map(it=>it.type)'),['rect','image']);
}));

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

test('click cycling survives deletion and layer reordering', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify([rectangle('lower'),rectangle('upper')])};setTool('select');`);
  const box=await page.locator('#canvas').boundingBox();
  const click=()=>page.mouse.click(box.x+170,box.y+145);
  await click();assert.deepEqual(await run('selectedUids()'),['upper']);
  await page.keyboard.press('Delete');await click();
  assert.deepEqual(await run('selectedUids()'),['lower']);
  await run('undo()');await click();
  assert.deepEqual(await run('selectedUids()'),['upper']);
  await click();assert.deepEqual(await run('selectedUids()'),['lower']);
  await run('bringToFront()');await click();
  assert.deepEqual(await run('selectedUids()'),['lower']);
}));

test('drawing and text dash defaults survive switching, reload, and workspace import', async () => app(async ({page,run}) => {
  const original=await run('activeTabId');
  await run(`setTool('rect');applyDash('wide');setTool('text');applyDash('tight');newTab();activateTab(${JSON.stringify(original)});`);
  assert.deepEqual(await run('[ui.dash,ui.text.dash]'),['wide','tight']);
  const workspace=await downloadedJSON(page,run,'exportWorkspace()');
  await page.reload();assert.deepEqual(await run('[ui.dash,ui.text.dash]'),['wide','tight']);
  await run(`openWorkspaceFile(new File([${JSON.stringify(JSON.stringify(workspace))}],'workspace.json'))`);
  await page.waitForFunction(id=>__test.run('activeTabId')!==id,original);
  assert.deepEqual(await run('[ui.dash,ui.text.dash]'),['wide','tight']);
}));

const wrappedText={type:'text',uid:'text',x:100,y:320,w:110,h:40,size:2,color:'#000000',
  textColor:'#000000',strokeOn:false,text:'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen',font:'28px Arial',fontSize:28};
const markdownText={...wrappedText,uid:'markdown',y:120,w:140,text:'---\n# Wide heading\none **two** three *four* five six seven eight nine ten eleven twelve\n- thirteen fourteen fifteen sixteen\n---\n[Last link](example.com)'};

test('Markdown PNG, SVG, and clipboard exports contain the full painted block', async () => app(async ({page,run,context}) => {
  await run(`items=[${JSON.stringify(markdownText)}];setTool('select');selection=[];render();`);
  const before=await run('bbox(items[0])');
  const svgDownload=page.waitForEvent('download');await run('saveSvg()');
  const svg=fs.readFileSync(await(await svgDownload).path(),'utf8');
  const preview=await context.newPage();await preview.setContent(svg);
  const bounds=await preview.locator('svg').evaluate(el=>{
    const outer=el.getBoundingClientRect();
    return [...el.querySelectorAll('text,line')].map(child=>{
      const r=child.getBoundingClientRect();return {x:r.x-outer.x,y:r.y-outer.y,right:r.right-outer.x,bottom:r.bottom-outer.y,width:outer.width,height:outer.height};
    });
  });
  for(const b of bounds) assert.ok(b.x>=0 && b.y>=0 && b.right<=b.width && b.bottom<=b.height,'all Markdown text and rules fit the export');
  assert.equal(await preview.locator('a').first().getAttribute('href'),'https://example.com');
  const height=Number(await preview.locator('svg').getAttribute('height'));
  assert.ok(height>400);
  const pngDownload=page.waitForEvent('download');await run('savePng()');
  const png=fs.readFileSync(await(await pngDownload).path());
  assert.ok(png.readUInt32BE(20)>=height*2-2);
  const bluePixels=await page.evaluate(async source=>{
    const image=new Image();image.src=source;await image.decode();
    const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
    const cx=c.getContext('2d');cx.drawImage(image,0,0);const data=cx.getImageData(0,0,c.width,c.height).data;
    let blue=0;for(let i=0;i<data.length;i+=4)if(data[i]<160 && data[i+1]<180 && data[i+2]>200)blue++;
    return blue;
  },'data:image/png;base64,'+png.toString('base64'));
  assert.ok(bluePixels>10,'the final linked text remains visible in PNG');
  const clipboardSize=await run('itemsToPngBlob(items,{background:false}).then(createImageBitmap).then(im=>({width:im.width,height:im.height}))');
  assert.equal(clipboardSize.height,png.readUInt32BE(20));
  assert.deepEqual(await run('bbox(items[0])'),before,'painted extents do not change geometry');
}));

test('rotated Markdown bounds use the exported document and leave pivots unchanged', async () => app(async ({run}) => {
  const fixture=await run(`
    items=[{...${JSON.stringify(markdownText)},rotation:.3,group:'same',groupRotation:.5},
      {...${JSON.stringify(rectangle())},x:500,group:'same',groupRotation:.5}];
    const id=activeTabId,pivot=groupPivot('same'),painted=paintedWorldBBox(items[0]),geometry=worldBBox(items[0]);
    const svg=itemsToSVGMarkup(items);const after=groupPivot('same');
    save();newTab();items=[{...${JSON.stringify(rectangle())},x:900,group:'same',groupRotation:.1}];
    const doc=tabDocument(id);
    ({pivot,after,painted,geometry,foreign:paintedWorldBBox(doc.items[0],doc.items),sameSVG:svg===itemsToSVGMarkup(doc.items,{assets:doc.assets})});
  `);
  assert.deepEqual(fixture.pivot,fixture.after);
  assert.deepEqual(fixture.painted,fixture.foreign);
  assert.equal(fixture.sameSVG,true);
  assert.ok(fixture.painted.w>fixture.geometry.w || fixture.painted.h>fixture.geometry.h);
}));

test('Markdown editor detection matches exact markers and excludes table cells', async () => app(async ({page,run}) => {
  await run(`items=[{...${JSON.stringify(wrappedText)},x:100,y:100,w:240,h:160,text:'--- not Markdown'}];openText(0);`);
  const editor=page.locator('#textInput');
  const state=()=>run('({align:textInput.style.textAlign,padding:parseFloat(textInput.style.paddingTop),kind:shapeOps(items[0]).at(-1).kind})');
  assert.equal((await state()).align,'center');assert.ok((await state()).padding>0);
  await editor.fill('---\n# Heading');
  assert.equal((await state()).align,'left');assert.equal((await state()).padding,0);
  await editor.fill('--- ordinary text');
  assert.equal((await state()).align,'center');
  await run(`commitText();items=[{type:'table',uid:'table',x:100,y:100,w:240,h:160,rows:1,cols:1,size:2,color:'#000000',fontFamily:'sans',fontSize:24,texts:[['---\\nplain cell']]}];openText(0,null,null,{r:0,c:0});`);
  assert.deepEqual((await state()).kind,'text');
  assert.equal((await state()).align,'center');assert.ok((await state()).padding>0);
}));

test('actual PNG and SVG exports include the full wrapped text height', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(wrappedText)}];setTool('select');render();`);
  const before=await run('bbox(items[0])');
  const svgDownload=page.waitForEvent('download');await run('saveSvg()');
  const svg=fs.readFileSync(await (await svgDownload).path(),'utf8');
  const height=Number(/<svg[^>]+height="([^"]+)"/.exec(svg)[1]);
  const baselines=[...svg.matchAll(/<tspan x="[^"]+" y="([^"]+)"/g)].map(m=>Number(m[1]));
  const translateY=Number(/<g transform="translate\([^ ]+ ([^)]+)\)/.exec(svg)[1]);
  assert.ok(baselines.length>10);
  assert.ok(Math.min(...baselines)+translateY>20);
  assert.ok(Math.max(...baselines)+translateY<height-20);
  const pngDownload=page.waitForEvent('download');await run('savePng()');
  const png=fs.readFileSync(await (await pngDownload).path());
  assert.ok(png.readUInt32BE(20)>=height*2-2,'PNG uses the same painted bounds');
  assert.deepEqual(await run('bbox(items[0])'),before,'export leaves geometry bounds unchanged');
}));

test('rotated grouped table text is included without moving group pivots', async () => app(async ({run}) => {
  const result=await run(`
    items=[{type:'table',uid:'table',x:100,y:200,w:90,h:30,rows:1,cols:1,texts:[['one two three four five six seven']],fontFamily:'sans',fontSize:28,size:2,color:'#000000',group:'g',rotation:.3,groupRotation:.5},
      {...${JSON.stringify(rectangle())},x:400,group:'g',groupRotation:.5}];
    const pivot=groupPivot('g'), geometry=worldBBox(items[0]);
    const painted=paintedWorldBBox(items[0]);
    ({pivotBefore:pivot,pivotAfter:groupPivot('g'),geometry,painted});
  `);
  assert.deepEqual(result.pivotBefore,result.pivotAfter);
  assert.ok(result.painted.w>result.geometry.w || result.painted.h>result.geometry.h);
}));

const line={type:'line',uid:'line',x1:80,y1:200,x2:320,y2:200,size:6,color:'#000000',dash:'wide'};

// Capture commands actually stroked by the canvas renderer, then compare the SVG paths.
async function renderedCurveHeads(run){
  const result=await run(`
    const paths=[], fills=[], originals={}, commands={moveTo:'M',lineTo:'L',bezierCurveTo:'C',closePath:'Z'};
    let current=[];
    for(const name of ['beginPath','stroke','fill',...Object.keys(commands)]){
      originals[name]=ctx[name];
      ctx[name]=function(...args){
        if(name==='beginPath') current=[];
        else if(name==='stroke') paths.push(current.slice());
        else if(name==='fill') fills.push(current.slice());
        else current.push([commands[name],...args]);
        return originals[name].apply(this,args);
      };
    }
    try{drawItem(items[0]);}finally{for(const name in originals)ctx[name]=originals[name];}
    ({paths,fills,svg:itemToSVG(items[0])});
  `);
  const svgElements=[...result.svg.matchAll(/<path d="([^"]*)"([^>]*)/g)];
  const parsePath=d=>d.split(' ').map(command=>command==='Z' ? ['Z'] :
    [command[0],...command.slice(1).split(',').map(Number)]);
  const svgPaths=svgElements.map(m=>parsePath(m[1]));
  assert.deepEqual(result.paths,svgPaths,'canvas and SVG stroke identical geometry');
  assert.deepEqual(result.fills,svgElements.filter(m=>!m[2].includes('fill="none"')).map(m=>parsePath(m[1])),
    'canvas and SVG fill identical geometry');
  return result.paths.slice(1); // shaft first, followed by end and start heads
}
function assertHeadDirection(head, expected, message){
  const [a,tip,b]=head;
  const dx=tip[1]-(a[1]+b[1])/2, dy=tip[2]-(a[2]+b[2])/2;
  const length=Math.hypot(dx,dy), expectedLength=Math.hypot(...expected);
  assert.ok(Math.abs(dx/length-expected[0]/expectedLength)<1e-9 &&
    Math.abs(dy/length-expected[1]/expectedLength)<1e-9,message);
}
for(const start of [true,false]){
  test(`dragging the ${start?'start':'end'} handle turns the opposite arrowhead in canvas and SVG`, async () => app(async ({page,run}) => {
    await run(`items=[${JSON.stringify(line)}];setHeads(items[0],true,true);setTool('select');selection=[0];togglePointEdit();`);
    const box=await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x+(start?80:320),box.y+200);
    const handle=await run(`defaultHandleOffset(items[0],${start?0:1},'${start?'c1':'c2'}')`);
    await page.mouse.move(box.x+handle.x,box.y+handle.y);await page.mouse.down();
    await page.mouse.move(box.x+handle.x,box.y+80);await page.mouse.up();
    const heads=await renderedCurveHeads(run);
    assert.equal(heads.length,2);
    assertHeadDirection(heads[0],[320-handle.x,120],'end arrow follows the incoming tangent');
    assertHeadDirection(heads[1],[80-handle.x,120],'start arrow follows the outgoing tangent');
  }));
}

test('curve arrowheads handle coincident controls, local tangents, and collapsed segments', async () => app(async ({run}) => {
  const a={x:100,y:200}, b={x:400,y:200}, c1={x:180,y:80}, c2={x:320,y:80};
  const cases=[
    {name:'straight',points:[a,b],directions:[[300,0],[-300,0]]},
    {name:'coincident start control',points:[{...a,c1:a},{...b,c2}],directions:[[80,120],[-220,120]]},
    {name:'coincident end control',points:[{...a,c1},{...b,c2:b}],directions:[[220,120],[-80,120]]},
    {name:'both local controls remain authoritative',points:[{...a,c1},{...b,c2}],directions:[[80,120],[-80,120]]},
    {name:'both controls at start',points:[{...a,c1:a},{...b,c2:a}],directions:[[300,0],[-300,0]]},
    {name:'both controls at end',points:[{...a,c1:b},{...b,c2:b}],directions:[[300,0],[-300,0]]},
    {name:'zero-length segments at both ends',points:[a,{...a,c1},{...b,c2},b],directions:[[80,120],[-80,120]]},
    {name:'fully collapsed curve',points:[{...a,c1:a},{...a,c2:a}],directions:[]}
  ];
  for(const example of cases){
    await run(`items=[{type:'polygon',closed:false,hs:true,he:true,size:6,color:'#000000',points:${JSON.stringify(example.points)}}];`);
    const heads=await renderedCurveHeads(run);
    assert.equal(heads.length,example.directions.length,example.name);
    heads.forEach((head,i)=>assertHeadDirection(head,example.directions[i],example.name));
  }
}));

test('popover edits arrowheads before and after curve conversion without moving the canvas', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(line)}];setTool('select');selection=[0];render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.locator('#sizeBtn').click();
  assert.equal(await page.locator('#pathControls').isVisible(),true);
  await page.locator('#endHeadBtn').click();
  assert.deepEqual(await run('headsOf(items[0])'),{s:false,e:true});
  await page.locator('#editPointsBtn').click();
  assert.equal(await page.locator('#sizePicker').isVisible(),false);
  assert.equal(await run('pointEditIdx'),0);
  assert.equal(await run('items[0].type'),'polygon');
  assert.deepEqual(await page.locator('#canvas').boundingBox(),canvas);
  await page.mouse.click(canvas.x+320,canvas.y+200);
  assert.equal(await run('activeAnchor'),1);
  assert.deepEqual(await run('headsOf(items[0])'),{s:false,e:true});
  await page.locator('#sizeBtn').click();
  assert.equal(await page.locator('#editPointsBtn').textContent(),'Done');
  await page.locator('#endHeadBtn').click();await page.locator('#startHeadBtn').click();
  assert.deepEqual(await run('headsOf(items[0])'),{s:true,e:false});
  assert.equal(await run('pointEditIdx'),0);
  await page.locator('#editPointsBtn').click();
  assert.equal(await run('pointEditIdx'),null);
  await page.mouse.click(canvas.x+320,canvas.y+200);
  assert.deepEqual(await run('headsOf(items[0])'),{s:true,e:true});
  assert.equal(await run('items[0].type'),'polygon');
  await run('undo()');assert.deepEqual(await run('headsOf(items[0])'),{s:true,e:false});
  await run('redo()');
  const svg=await run('itemToSVG(items[0])');
  assert.equal((svg.match(/stroke-dasharray=/g)||[]).length,1,'arrowheads remain solid');
  await page.reload();assert.deepEqual(await run('headsOf(items[0])'),{s:true,e:true});
}));

test('closed shapes offer point editing without arrowhead controls', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(rectangle())}];setTool('select');selection=[0];render();`);
  await page.locator('#sizeBtn').click();
  assert.equal(await page.locator('#startHeadBtn').isVisible(),false);
  assert.equal(await page.locator('#editPointsBtn').isVisible(),true);
  await page.locator('#editPointsBtn').click();
  assert.equal(await run('items[0].closed'),true);
  assert.equal(await run('items[0].points.length'),4);
}));

test('arrowhead variants survive conversion, undo, toggling, reload, and workspace import', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(line)}];setTool('select');selection=[0];render();`);
  await page.locator('#sizeBtn').click();
  assert.equal(await page.locator('#startHeadFilledBtn').isDisabled(),true);
  await page.locator('#startHeadBtn').click();await page.locator('#endHeadBtn').click();
  await page.locator('#startHeadFilledBtn').click();await page.locator('#startHeadInvertedBtn').click();
  await page.locator('#endHeadFilledBtn').click();
  const variants=()=>run(`[headVariantOf(items[0],'start'),headVariantOf(items[0],'end')]`);
  assert.deepEqual(await variants(),['filled-inverted','filled']);
  await run('undo()');assert.deepEqual(await variants(),['filled-inverted','open']);
  await run('redo()');
  await page.locator('#editPointsBtn').click();
  assert.equal(await run('items[0].type'),'polygon');
  assert.deepEqual(await variants(),['filled-inverted','filled']);
  await run('togglePointEdit()');
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+80,box.y+200);
  assert.equal(await run('headsOf(items[0]).s'),false);
  await page.mouse.click(box.x+80,box.y+200);
  assert.equal(await run('headsOf(items[0]).s'),true);
  assert.deepEqual(await variants(),['filled-inverted','filled']);
  const workspace=await downloadedJSON(page,run,'exportWorkspace()');
  await page.reload();assert.deepEqual(await variants(),['filled-inverted','filled']);
  const original=await run('activeTabId');
  await run(`openWorkspaceFile(new File([${JSON.stringify(JSON.stringify(workspace))}],'variants.json'))`);
  await page.waitForFunction(id=>__test.run('activeTabId')!==id,original);
  assert.deepEqual(await variants(),['filled-inverted','filled']);
}));

test('all arrowhead variants share canvas/SVG fill and tangent geometry', async () => app(async ({run}) => {
  for(const curved of [false,true]) for(const variant of ['open','filled','open-inverted','filled-inverted']){
    const item=curved ? {type:'polygon',closed:false,points:[{x:100,y:200},{x:400,y:200,c2:{x:250,y:100}}]} :
      {type:'arrow',x1:100,y1:200,x2:400,y2:200};
    await run(`items=[{...${JSON.stringify(item)},size:6,color:'#000000',dash:'wide',hs:true,he:true,hsStyle:'${variant}',heStyle:'${variant}'}];`);
    const heads=await renderedCurveHeads(run), sign=variant.endsWith('-inverted') ? -1 : 1;
    assert.equal(heads.length,2);
    assertHeadDirection(heads[0],[sign*(curved?150:300),sign*(curved?100:0)],variant+' end tangent');
    assertHeadDirection(heads[1],[sign*(curved?-150:-300),sign*(curved?100:0)],variant+' start tangent');
    for(const head of heads) assert.equal(head.at(-1)[0]==='Z',variant.startsWith('filled'));
    const svg=await run('itemToSVG(items[0])');
    assert.equal((svg.match(/stroke-dasharray=/g)||[]).length,1,'only the shaft is dashed');
  }
}));

test('legacy arrows retain open heads and invalid style fields are ignored', async () => app(async ({run}) => {
  const result=await run(`
    const old={type:'arrow',x1:100,y1:200,x2:400,y2:200,size:6,color:'#000000'};
    const legacy=normalizeItem(old,{}), invalid=normalizeItem({...old,hsStyle:'unknown',heStyle:42},{});
    ({heads:headsOf(legacy),styles:[headVariantOf(legacy,'start'),headVariantOf(legacy,'end')],
      unchanged:itemToSVG(legacy)===itemToSVG(invalid),keys:Object.keys(invalid)});
  `);
  assert.deepEqual(result.heads,{s:false,e:true});
  assert.deepEqual(result.styles,['open','open']);
  assert.equal(result.unchanged,true);
  assert.ok(!result.keys.includes('hsStyle') && !result.keys.includes('heStyle'));
}));

test('large inverted arrowheads fit selection bounds and actual PNG/SVG exports', async () => app(async ({page,run}) => {
  await run(`items=[{type:'arrow',x1:200,y1:250,x2:400,y2:250,size:60,color:'#000000',hs:true,he:true,hsStyle:'filled-inverted',heStyle:'filled-inverted'}];setTool('select');render();`);
  const geometry=await run(`({box:bbox(items[0]),points:shapeOps(items[0]).slice(1).flatMap(op=>op.d.filter(s=>s.length>1).map(s=>({x:s[1],y:s[2]})))})`);
  for(const p of geometry.points){
    assert.ok(p.x-30>=geometry.box.x && p.x+30<=geometry.box.x+geometry.box.w);
    assert.ok(p.y-30>=geometry.box.y && p.y+30<=geometry.box.y+geometry.box.h);
  }
  const download=page.waitForEvent('download');await run('saveSvg()');
  const svg=fs.readFileSync(await (await download).path(),'utf8');
  const width=Number(/<svg[^>]+width="([^"]+)"/.exec(svg)[1]);
  const height=Number(/<svg[^>]+height="([^"]+)"/.exec(svg)[1]);
  assert.ok(width>=geometry.box.w+48 && height>=geometry.box.h+48);
  const pngDownload=page.waitForEvent('download');await run('savePng()');
  const png=fs.readFileSync(await (await pngDownload).path());
  assert.ok(png.readUInt32BE(16)>=width*2-2 && png.readUInt32BE(20)>=height*2-2);
}));

test('double-click body shortcut still works immediately after an endpoint toggle', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(line)}];setTool('select');selection=[0];render();`);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+320,box.y+200);
  await page.mouse.dblclick(box.x+200,box.y+200);
  assert.equal(await run('pointEditIdx'),0);
  assert.deepEqual(await run('headsOf(items[0])'),{s:false,e:true});
  await page.mouse.dblclick(box.x+200,box.y+200);
  assert.equal(await run('pointEditIdx'),null);
}));

test('touch anchor dragging preserves the grab offset and keeps point editing active', {skip:engine !== 'chromium' && 'Raw touch injection requires Chromium CDP'}, async () => app(async ({page,run,context}) => {
  await run(`items=[{type:'polygon',closed:false,uid:'curve',size:6,color:'#000000',points:[{x:100,y:200,c1:{x:140,y:160}},{x:350,y:200}]}];setTool('select');selection=[0];togglePointEdit();`);
  const box=await page.locator('#canvas').boundingBox();
  const session=await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+100,y:box.y+215}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+120,y:box.y+240}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.deepEqual(await run('items[0].points[0]'),{x:120,y:225,c1:{x:160,y:185}});
  assert.equal(await run('pointEditIdx'),0);
  assert.deepEqual(await run('headsOf(items[0])'),{s:false,e:false});
  await session.detach();
}, {context:{viewport:{width:768,height:1024},hasTouch:true,isMobile:true}}));

test('dragging a rotated curve endpoint retains handles and the other points', async () => app(async ({page,run}) => {
  await run(`items=[{type:'polygon',uid:'curve',closed:false,color:'#000000',size:6,rotation:.3,
    points:[{x:100,y:150,c1:{x:150,y:70}},{x:250,y:190},{x:400,y:150,c2:{x:350,y:230}}]}];setTool('select');selection=[0];render();`);
  const before=await run('items[0].points.map(p=>({anchor:toWorld(items[0],p.x,p.y),handle:p.c2&&toWorld(items[0],p.c2.x,p.c2.y)}))');
  const canvas=await page.locator('#canvas').boundingBox(), end=before[2].anchor;
  await page.mouse.move(canvas.x+end.x+4,canvas.y+end.y+2);await page.mouse.down();
  await page.mouse.move(canvas.x+end.x+24,canvas.y+end.y+17);await page.mouse.up();
  const after=await run('items[0].points');
  for(let i=0;i<2;i++){
    assert.ok(Math.abs(after[i].x-before[i].anchor.x)<.02);
    assert.ok(Math.abs(after[i].y-before[i].anchor.y)<.02);
  }
  assert.ok(Math.abs(after[2].x-before[2].anchor.x-20)<.02);
  assert.ok(Math.abs(after[2].y-before[2].anchor.y-15)<.02);
  assert.ok(Math.abs(after[2].c2.x-before[2].handle.x-20)<.02);
  assert.ok(Math.abs(after[2].c2.y-before[2].handle.y-15)<.02);
  assert.deepEqual(await run('headsOf(items[0])'),{s:false,e:false});
}));

for(const viewport of [{width:1024,height:768},{width:768,height:1024},{width:375,height:700}]){
  test(`touch popover fits ${viewport.width}×${viewport.height} and keeps canvas stationary`, async () => app(async ({page,run}) => {
    const endX=Math.min(viewport.width-80,420);
    await run(`items=[{...${JSON.stringify(line)},x2:${endX}}];setTool('select');selection=[0];render();`);
    const before=await page.locator('#canvas').boundingBox();
    await page.locator('#sizeBtn').tap();
    const popup=await page.locator('#sizePicker').boundingBox();
    assert.ok(popup.x>=4 && popup.x+popup.width<=viewport.width-4);
    assert.ok(popup.y+popup.height<=viewport.height);
    for(const id of ['startHeadBtn','endHeadBtn','editPointsBtn','startHeadFilledBtn','startHeadInvertedBtn','endHeadFilledBtn','endHeadInvertedBtn']){
      const target=await page.locator('#'+id).boundingBox();
      assert.ok(target.height>=44 && target.width>=44);
    }
    await page.locator('#endHeadBtn').tap();
    await page.locator('#endHeadFilledBtn').tap();await page.locator('#endHeadInvertedBtn').tap();
    assert.equal(await run("headVariantOf(items[0],'end')"),'filled-inverted');
    await page.locator('#editPointsBtn').tap();
    assert.deepEqual(await page.locator('#canvas').boundingBox(),before);
    await page.touchscreen.tap(before.x+endX,before.y+200);
    await page.touchscreen.tap(before.x+endX,before.y+200);
    assert.equal(await run('pointEditIdx'),0,'rapid anchor taps stay in point editing');
    assert.equal(await run('activeAnchor'),1);
    assert.deepEqual(await run('headsOf(items[0])'),{s:false,e:true});
    await page.locator('#sizeBtn').tap();await page.locator('#endHeadBtn').tap();
    assert.deepEqual(await run('headsOf(items[0])'),{s:false,e:false});
    await page.locator('#editPointsBtn').tap();
    await page.touchscreen.tap(before.x+endX,before.y+200);
    assert.deepEqual(await run('headsOf(items[0])'),{s:false,e:true});
    assert.equal(await run('pointEditIdx'),null);
    assert.deepEqual(await page.locator('#canvas').boundingBox(),before);
  }, {context:{viewport,hasTouch:true,isMobile:true,deviceScaleFactor:2}}));
}
