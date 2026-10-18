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
    await page.route(origin+'/**', route => {
      const file = options.files?.[route.request().url().slice(origin.length+1)];
      return route.fulfill({
        status:file!==undefined || route.request().url().endsWith('index.html') ? 200 : 404,
        contentType:file!==undefined ? 'application/json' : 'text/html', body:file ?? html
      });
    });
    await page.goto(origin+'/index.html');
    const run = code => page.evaluate(async code => {await window.__test.run('appReady');return window.__test.run(code);}, code);
    await run('appStarted');
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

test('HTML export keeps each tab’s images, group rotation, and pending text edits', async () => app(async ({page,run,context}) => {
  const fixture=await run(`
    const c=document.createElement('canvas');c.width=c.height=30;const cx=c.getContext('2d');
    cx.fillStyle='red';cx.fillRect(0,0,30,30);const red=c.toDataURL();
    cx.fillStyle='blue';cx.fillRect(0,0,30,30);const blue=c.toDataURL();
    const scene=x=>[{type:'image',uid:'image',id:'shared',x,y:100,w:30,h:30},
      {...${JSON.stringify(rectangle('a'))},x,group:'shared-group',groupRotation:.5},
      {...${JSON.stringify(rectangle('b'))},x:x+200,group:'shared-group',groupRotation:.5}];
    applySketchToActiveTab(scene(100),{shared:red});
    newTab();applySketchToActiveTab(scene(500),{shared:blue});
    items.push({...${JSON.stringify(wrappedText)},text:'previous'});openText(3);textInput.value='latest edit';
    ({red,blue});
  `);
  const exported=await downloadedHTML(page,run);
  const preview=await context.newPage();await preview.setContent(exported);
  const panels=preview.locator('.tab-panel');assert.equal(await panels.count(),2);
  for(let i=0;i<2;i++){
    await preview.locator('.tab-select').nth(i).click();
    assert.equal(await panels.nth(i).isVisible(),true);
    assert.equal(await panels.nth(i).locator('image').getAttribute('href'),i===0?fixture.red:fixture.blue);
    const matrices=await panels.nth(i).locator('g[transform^="rotate"]').evaluateAll(groups=>groups.map(g=>{
      const m=g.getCTM();return {a:m.a,b:m.b,e:m.e,f:m.f};
    }));
    assert.equal(matrices.length,2);
    const cx=i===0?280:680, cy=150, c=Math.cos(.5), sin=Math.sin(.5);
    for(const m of matrices){
      assert.ok(Math.abs(m.a-c)<1e-6 && Math.abs(m.b-sin)<1e-6);
      assert.ok(Math.abs(m.e-(cx*(1-c)+cy*sin))<.01 && Math.abs(m.f-(cy*(1-c)-cx*sin))<.01,
        'each exported group rotates around its own tab’s pivot');
    }
  }
  assert.equal((await panels.nth(1).locator('tspan').allTextContents()).join(' '),'latest edit');
  assert.equal(await run('assets[items[0].id]'),fixture.blue,'export leaves the live image intact');
  assert.equal(await run('items[3].text'),'latest edit');
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
    return {text,bytes};
  });
  await page.reload();assert.equal(await run('clipboard.length'),0);
  await page.evaluate(({text,bytes})=>{
    const dt=new DataTransfer();dt.setData('text/plain',text);
    dt.items.add(new File([new Uint8Array(bytes)],'copy.png',{type:'image/png'}));
    window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,cancelable:true,bubbles:true}));
  },captured);
  assert.deepEqual(await run('items.map(it=>it.type)'),['rect','line','rect','line']);
  assert.equal(await run('items[2].group===items[3].group && items[2].group!==items[0].group'),true);
  assert.equal(await run('items[2].groupRotation'),.3);
  await run('undo()');assert.equal(await run('items.length'),2);
  await run('redo()');assert.equal(await run('items.length'),4);
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

test('quota failures preserve tabs, history, JSON/HTML recovery exports, and retry', async () => app(async ({page,run,context}) => {
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
  const preview=await context.newPage();await preview.setContent(await downloadedHTML(page,run));
  assert.deepEqual(await preview.locator('.tab-panel').evaluateAll(panels=>panels.map(p=>p.querySelectorAll('svg > g > rect').length)),[2,0],
    'HTML recovery contains unsaved edits and the empty tab');
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
  assert.equal(await page.locator('#autosaveWarning').isVisible(),false);
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

test('image import and undo stay with the original tab after switching away', async () => app(async ({page,run}) => {
  // Both calls run in one JS task, before the image load event can fire.
  const original=await run('activeTabId');
  await run(`const c=document.createElement('canvas');c.width=c.height=20;importImage(c.toDataURL());newTab();`);
  await page.waitForFunction(id=>__test.run(`tabDocument(${JSON.stringify(id)}).items.length`)===1,original);
  assert.equal(await run('items.length'),0);
  await run(`activateTab(${JSON.stringify(original)})`);
  assert.equal(await run('items.length'),1);
  const source=await run('assets[items[0].id]');
  await run('undo()');assert.equal(await run('items.length'),0);
  await run('redo()');assert.equal(await run('assets[items[0].id]'),source);
  await run(`setTool('select');selection=[0];deleteSelected();newTab();activateTab(${JSON.stringify(original)});undo();`);
  assert.equal(await run('assets[items[0].id]'),source,'deletion undo restores the image after another tab switch');
  await page.reload();assert.equal(await run('assets[items[0].id]'),source);
}));

test('click cycling resets after deletion, layer reordering, and nudging', async () => app(async ({page,run}) => {
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
  await page.keyboard.press('ArrowRight');await click();
  assert.deepEqual(await run('selectedUids()'),['lower'],'a scene edit resets the cycle even when the hit stack is unchanged');
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

test('Markdown numbered lists auto-renumber regardless of the typed digit, and survive export', async () => app(async ({page,run}) => {
  // Every line typed "1." -- the natural way to write a list without hand-renumbering it -- should
  // still count up 1,2,3 (not repeat "1." three times); a blank spacer line doesn't reset the count.
  const body='---\n1. alpha\n1. bravo\n\n1. charlie\n- switched to a bullet\n1. restarts at 1';
  await run(`items=[{...${JSON.stringify(markdownText)},text:${JSON.stringify(body)}}];setTool('select');render();`);
  const nums=await run(`parseMarkdownBlocks(markdownBodyOf(items[0].text)).filter(b=>b.type==='oli').map(b=>b.num)`);
  assert.deepEqual(nums,[1,2,3,1],'blank line keeps counting, a bullet line in between resets it');

  // A different starting number is honored, same as standard Markdown.
  const started=await run(`parseMarkdownBlocks('5. five\\n5. six\\n5. seven').filter(b=>b.type==='oli').map(b=>b.num)`);
  assert.deepEqual(started,[5,6,7]);

  // The rendered labels use the RENUMBERED value, not the literally-typed digit, and are painted
  // (survive PNG/SVG export, same convention the other Markdown export test checks).
  const labels=await run(`layoutMarkdownBlocks(parseMarkdownBlocks(markdownBodyOf(items[0].text)),0,0,300,600,'sans',28).filter(w=>w.text==='1.'||w.text==='2.'||w.text==='3.').map(w=>w.text)`);
  assert.deepEqual(labels,['1.','2.','3.','1.']);
  const svgDownload=page.waitForEvent('download');await run('saveSvg()');
  const svg=fs.readFileSync(await (await svgDownload).path(),'utf8');
  assert.ok(svg.includes('>1.<') && svg.includes('>2.<') && svg.includes('>3.<'),'numbered labels are painted into the SVG export');

  // A run spanning a one- and two-digit number ("9.".."11.") must still line up its BODY TEXT at the
  // same x for every item -- an earlier version sized each item's own indent off its own number
  // width, so "9." (narrower) and "10."/"11." (wider) left their own body text at different x
  // positions, a real bug found via actual use right after this first shipped.
  const wide=await run(`layoutMarkdownBlocks(parseMarkdownBlocks('9. nine\\n10. ten\\n11. eleven'),0,0,300,600,'sans',28)`);
  const bodyXs=wide.filter(w=>['nine','ten','eleven'].includes(w.text)).map(w=>w.x);
  assert.equal(new Set(bodyXs).size,1,'body text starts at the same x regardless of the number\'s own digit count');
  const numX=text=>wide.find(w=>w.text===text).x;
  assert.ok(numX('9.') < bodyXs[0] && numX('10.') < bodyXs[0] && numX('11.') < bodyXs[0],'the numbers stay clear of the shared body-text column');
  assert.ok(numX('9.') > numX('10.'),'narrower "9." is right-aligned further in than the wider "10.", not left-flush with it');
  assert.equal(numX('10.'),numX('11.'),'same-width numbers ("10.","11.") share the exact same start x');
}));

test('Markdown lists (bulleted and numbered) sit indented to the right of plain paragraph text, with matching body-text start', async () => app(async ({page,run}) => {
  const rows=await run(`layoutMarkdownBlocks(parseMarkdownBlocks('para\\n- bullet\\n1. one'),0,0,300,600,'sans',28)`);
  const xOf=text=>rows.find(w=>w.text===text).x;
  const paraX=xOf('para'), bulletX=xOf('•'), numX=xOf('1.');
  assert.ok(bulletX>paraX,'a bullet-list marker sits to the right of plain paragraph text, not flush with it');
  assert.ok(numX>paraX,'a numbered-list marker sits to the right of plain paragraph text, not flush with it');

  // A bullet's own column is sized off the WIDEST single digit ("1." through "9."), not literally
  // "1." -- found via actual use (a real screenshot + a per-digit width measurement) that "1." is the
  // NARROWEST digit by a real margin in this app's own font (confirmed: ~18px vs ~22-23px for every
  // other single digit), so a lone "1."-item list is a misleading reference: any REAL numbered list
  // with more than one item almost always ends up wider than that, leaving a bullet list's own body
  // text visibly less indented than it. Found the actually-widest digit dynamically rather than
  // hardcoding one, since exact per-digit widths are a font metric, not a logical guarantee.
  const widest=await run(`(()=>{ctx.font=mdFontString('sans',28,{});let best='1',w=0;for(let d=1;d<=9;d++){const t=ctx.measureText(d+'.').width;if(t>w){w=t;best=String(d);}}return best;})()`);
  const rows2=await run(`layoutMarkdownBlocks(parseMarkdownBlocks('- bullet\\n${widest}. word'),0,0,300,600,'sans',28)`);
  const xOf2=text=>rows2.find(w=>w.text===text).x;
  assert.equal(xOf2('bullet'),xOf2('word'),`a bullet list's body text starts exactly where a numbered list's does, even against its widest single digit ("${widest}.")`);
}));

test('the indent before a list marker, and the gap after it, both scale proportionally with the item\'s own font size', async () => app(async ({page,run}) => {
  const at=async fontPx=>{
    const rows=await run(`layoutMarkdownBlocks(parseMarkdownBlocks('- x'),0,0,300,600,'sans',${fontPx})`);
    const markerX=rows.find(w=>w.text==='•').x, textX=rows.find(w=>w.text==='x').x;
    const markerW=await run(`(ctx.font=mdFontString('sans',${fontPx},{}),ctx.measureText('•').width)`);
    return {markerX, gap: textX-(markerX+markerW)};   // markerX-6 == listIndent+rightAlignOffset
  };
  const at12=await at(12), at24=await at(24), at48=await at(48);
  // listIndent should scale linearly with font size -- half the font size roughly halves the indent,
  // double roughly doubles it. Compare via the DIFFERENCE from the flush-left baseline (x=6) so the
  // assertion isolates listIndent's own scaling from the marker glyph's unrelated (and non-linear)
  // own width.
  const indentPart = r => r.markerX - 6;
  assert.ok(Math.abs(indentPart(at24)/indentPart(at12) - 2) < 0.15, '24px indent is roughly double the 12px indent');
  assert.ok(Math.abs(indentPart(at48)/indentPart(at24) - 2) < 0.15, '48px indent is roughly double the 24px indent');
  // The gap AFTER the marker (markerGap, 8px tuned at 24px) must scale the same way -- a real bug,
  // found via actual use right after listIndent alone was made proportional: a flat gap becomes a
  // proportionally BIGGER fraction of a smaller font's own text (8px is small next to a 48px letter,
  // large next to a 12px one), so the list still looked disproportionate at smaller sizes even once
  // listIndent itself scaled correctly.
  assert.ok(Math.abs(at24.gap/at12.gap - 2) < 0.2, '24px marker-to-text gap is roughly double the 12px gap');
  assert.ok(Math.abs(at48.gap/at24.gap - 2) < 0.2, '48px marker-to-text gap is roughly double the 24px gap');
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

const line={type:'line',uid:'line',x1:80,y1:200,x2:320,y2:200,size:6,color:'#000000',dash:'wide'};

function assertHeadDirection(head, expected, message){
  const [a,tip,b]=head;
  const dx=tip[1]-(a[1]+b[1])/2, dy=tip[2]-(a[2]+b[2])/2;
  const length=Math.hypot(dx,dy), expectedLength=Math.hypot(...expected);
  assert.ok(Math.abs(dx/length-expected[0]/expectedLength)<1e-9 &&
    Math.abs(dy/length-expected[1]/expectedLength)<1e-9,message);
}
test('dragging one Bézier handle turns both exported arrowheads with the curve', async () => app(async ({page,run,context}) => {
  await run(`items=[{type:'polygon',uid:'curve',closed:false,size:6,color:'#000000',dash:'wide',
    hs:true,he:true,hsStyle:'filled-inverted',points:[{x:80,y:200,c1:{x:140,y:200}},{x:320,y:200}]}];
    setTool('select');selection=[0];togglePointEdit();`);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+80,box.y+200);
  await page.mouse.move(box.x+140,box.y+200);await page.mouse.down();
  await page.mouse.move(box.x+140,box.y+80);await page.mouse.up();
  const download=page.waitForEvent('download');await run('saveSvg()');
  const preview=await context.newPage();await preview.setContent(fs.readFileSync(await(await download).path(),'utf8'));
  const paths=preview.locator('path');assert.equal(await paths.count(),3);
  const heads=await paths.evaluateAll(paths=>paths.slice(1).map(p=>p.getAttribute('d').split(' ').map(command=>
    [command[0],...command.slice(1).split(',').map(Number)])));
  assertHeadDirection(heads[0],[180,120],'end head follows the incoming tangent even without its own handle');
  assertHeadDirection(heads[1],[60,-120],'inverted start head points back along the outgoing tangent');
  assert.equal(await paths.nth(1).getAttribute('fill'),'none');
  assert.notEqual(await paths.nth(2).getAttribute('fill'),'none');
  assert.equal(await preview.locator('[stroke-dasharray]').count(),1,'only the shaft is dashed');
}));

test('endpoint clicks cycle every variant independently on straight and curved paths', async () => app(async ({page,run}) => {
  for(const curved of [false,true]){
    await run(`items=[${JSON.stringify(line)}];setTool('select');selection=[0];pointEditIdx=null;
      if(${curved}){convertToCurve(0);items[0].points[0].c1={x:140,y:120};items[0].points[1].c2={x:260,y:120};}render();`);
    const canvas=await page.locator('#canvas').boundingBox();
    const before=await run('pathEnds(items[0])');
    const state=()=>run(`[headsOf(items[0]).s ? headVariantOf(items[0],'start') : 'none',headsOf(items[0]).e ? headVariantOf(items[0],'end') : 'none']`);
    for(const end of ['start','end']){
      for(const variant of ['open','filled','open-inverted','filled-inverted','none','open']){
        await page.mouse.click(canvas.x+(end==='start'?80:320),canvas.y+200);
        assert.deepEqual(await state(),end==='start' ? [variant,'none'] : ['open',variant]);
        assert.equal(await run('pointEditIdx'),null,'rapid endpoint clicks do not enter point editing');
        assert.deepEqual(await run('pathEnds(items[0])'),before,'cycling keeps the path endpoints in place');
      }
    }
    assert.equal(await run('items[0].type'),curved?'polygon':'arrow');
    await page.mouse.dblclick(canvas.x+320,canvas.y+200);
    assert.deepEqual(await state(),['open','open-inverted'],'a double-click advances two variants');
    assert.equal(await run('pointEditIdx'),null,'native endpoint double-clicks do not change modes');
  }
}));

test('cycled arrowhead variants survive conversion, undo, reload, and workspace import', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(line)}];setTool('select');selection=[0];render();`);
  const box=await page.locator('#canvas').boundingBox();
  for(let i=0;i<4;i++) await page.mouse.click(box.x+80,box.y+200);
  for(let i=0;i<2;i++) await page.mouse.click(box.x+320,box.y+200);
  const variants=()=>run(`[headVariantOf(items[0],'start'),headVariantOf(items[0],'end')]`);
  assert.deepEqual(await variants(),['filled-inverted','filled']);
  await run('undo()');assert.deepEqual(await variants(),['filled-inverted','open']);
  await run('redo()');
  await page.mouse.dblclick(box.x+200,box.y+200);
  assert.equal(await run('items[0].type'),'polygon');
  assert.equal(await run('pointEditIdx'),0);
  assert.deepEqual(await variants(),['filled-inverted','filled']);
  await page.mouse.click(box.x+80,box.y+200);
  assert.equal(await run('activeAnchor'),0);
  assert.deepEqual(await variants(),['filled-inverted','filled'],'anchor selection does not cycle heads');
  await page.mouse.dblclick(box.x+200,box.y+200);
  assert.equal(await run('pointEditIdx'),null);
  const workspace=await downloadedJSON(page,run,'exportWorkspace()');
  await page.reload();assert.deepEqual(await variants(),['filled-inverted','filled']);
  const original=await run('activeTabId');
  await run(`openWorkspaceFile(new File([${JSON.stringify(JSON.stringify(workspace))}],'variants.json'))`);
  await page.waitForFunction(id=>__test.run('activeTabId')!==id,original);
  assert.deepEqual(await variants(),['filled-inverted','filled']);
}));

test('large inverted arrowheads stay inside the downloaded SVG', async () => app(async ({page,run,context}) => {
  await run(`items=[{type:'arrow',x1:200,y1:250,x2:400,y2:250,size:60,color:'#000000',hs:true,he:true,hsStyle:'filled-inverted',heStyle:'filled-inverted'}];setTool('select');render();`);
  const download=page.waitForEvent('download');await run('saveSvg()');
  const preview=await context.newPage();await preview.setContent(fs.readFileSync(await(await download).path(),'utf8'));
  const fits=await preview.locator('svg').evaluate(svg=>{
    const bounds=svg.getBoundingClientRect(), paths=[...svg.querySelectorAll('path')];
    return paths.length===3 && paths.every(path=>{
      const r=path.getBoundingClientRect(), halfStroke=parseFloat(getComputedStyle(path).strokeWidth)/2;
      return r.left-halfStroke>=bounds.left && r.right+halfStroke<=bounds.right &&
        r.top-halfStroke>=bounds.top && r.bottom+halfStroke<=bounds.bottom;
    });
  });
  assert.equal(fits,true,'both arrowheads, including their stroke, fit the exported image');
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

test('double-tap conversion keeps the cycled shape for the next touch drag', {skip:engine !== 'chromium' && 'Raw touch injection requires Chromium CDP'}, async () => app(async ({page,run,context}) => {
  const scene=['bottom','middle','top'].map(uid=>rectangle(uid));
  await run(`items=${JSON.stringify(scene)};setTool('select');selection=[2];render();`);
  const box=await page.locator('#canvas').boundingBox();
  await page.touchscreen.tap(box.x+180,box.y+150);
  await page.touchscreen.tap(box.x+190,box.y+155);
  assert.deepEqual(await run('selectedUids()'),['middle']);
  assert.equal(await run('items[1].type'),'polygon');
  assert.equal(await run('pointEditIdx'),1);
  const session=await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+195,y:box.y+160}]});
  assert.deepEqual(await run('selectedUids()'),['middle'],'the third press must grab the cycled shape');
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+225,y:box.y+185}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await session.detach();
  assert.deepEqual(await run('items[1].points'),[{x:130,y:125},{x:290,y:125},{x:290,y:225},{x:130,y:225}]);
  assert.deepEqual(await run('[items[0],items[2]]'),[scene[0],scene[2]],'the other layers must not move');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await run('items[1].points'),[{x:100,y:100},{x:260,y:100},{x:260,y:200},{x:100,y:200}]);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await run('items'),scene,'conversion and dragging remain separate undo steps');
}, {context:{viewport:{width:768,height:1024},hasTouch:true,isMobile:true}}));

test('dragging a rotated curve endpoint retains handles and the other points', async () => app(async ({page,run}) => {
  await run(`items=[{type:'polygon',uid:'curve',closed:false,color:'#000000',size:6,rotation:.3,
    hs:true,he:true,hsStyle:'filled-inverted',heStyle:'filled',
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
  assert.deepEqual(await run('headsOf(items[0])'),{s:true,e:true});
  assert.deepEqual(await run("[headVariantOf(items[0],'start'),headVariantOf(items[0],'end')]"),['filled-inverted','filled']);
}));

test('iPad taps cycle endpoints and double-taps enter and leave point editing', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(line)}];setTool('select');selection=[0];render();`);
  const box=await page.locator('#canvas').boundingBox();
  const head=()=>run(`headsOf(items[0]).e ? headVariantOf(items[0],'end') : 'none'`);
  const tapEnd=()=>page.touchscreen.tap(box.x+320,box.y+215); // finger lands off-center, beyond the mouse radius
  const doubleTapBody=async()=>{
    await page.touchscreen.tap(box.x+200,box.y+200);
    await page.touchscreen.tap(box.x+200,box.y+200);
  };
  await tapEnd();await tapEnd();
  assert.equal(await head(),'filled');
  assert.equal(await run('pointEditIdx'),null,'rapid endpoint taps only cycle heads');
  await doubleTapBody();
  assert.equal(await run('pointEditIdx'),0);
  await tapEnd();await tapEnd();
  assert.equal(await run('pointEditIdx'),0,'rapid anchor taps stay in point editing');
  assert.equal(await run('activeAnchor'),1);
  assert.equal(await head(),'filled','anchor taps do not change arrowheads');
  await doubleTapBody();
  assert.equal(await run('pointEditIdx'),null);
  await tapEnd();
  assert.equal(await head(),'open-inverted','converted curves keep endpoint cycling');
}, {context:{viewport:{width:768,height:1024},hasTouch:true,isMobile:true,deviceScaleFactor:2}}));

// ---------- secondary clicks on the canvas ----------
// The native menu is always suppressed. A secondary press -- the right button, or Control+click on a
// Mac, which browsers deliver as a primary-button press with ctrlKey followed by a contextmenu event
// -- never starts a gesture; its one job is finishing the polygon in progress. Duplicate-drag is
// therefore ⌘+drag on a Mac. Events go straight to the canvas here, so the checks do not depend on
// the host OS's own Control-click handling.
const pointerSequence = (run, seq) => run(`(()=>{
  const r = canvas.getBoundingClientRect();
  let prevented = null;
  for(const [type,x,y,init] of ${JSON.stringify(seq)}){
    const common = {bubbles:true, cancelable:true, clientX:r.left+x, clientY:r.top+y, ...init};
    const e = type==='contextmenu' ? new MouseEvent(type, common) : new PointerEvent(type, {pointerId:1, pointerType:'mouse', ...common});
    canvas.dispatchEvent(e);
    if(type==='contextmenu') prevented = e.defaultPrevented;
  }
  return prevented;
})()`);
const macControlClick = (run, x, y) => pointerSequence(run, [
  ['pointerdown',x,y,{button:0,buttons:1,ctrlKey:true}], ['contextmenu',x,y,{button:2,ctrlKey:true}], ['pointerup',x,y,{button:0,ctrlKey:true}]]);
const modifierDrag = (run, mod, x0, y0, x1, y1) => pointerSequence(run, [
  ['pointerdown',x0,y0,{button:0,buttons:1,[mod]:true}], ['pointermove',(x0+x1)/2,(y0+y1)/2,{buttons:1,[mod]:true}],
  ['pointermove',x1,y1,{buttons:1,[mod]:true}], ['pointerup',x1,y1,{button:0,[mod]:true}]]);

test('the native context menu is always suppressed; a secondary click finishes the polygon in progress without adding a corner of its own', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(rectangle('r1'))}];setTool('select');selection=[0];render();`);
  assert.equal(await pointerSequence(run, [['contextmenu',140,130,{button:2}]]), true, 'suppressed in select mode, where Ctrl+drag and Ctrl-resize run');
  assert.equal(await run('items.length'),1);

  await run(`setTool('polygon');polygonPress(300,300,false,false);polygonPress(400,300,false,false);polygonPress(400,400,false,false);`);
  assert.equal(await pointerSequence(run, [['contextmenu',450,450,{button:2}]]), true);
  assert.equal(await run('ui.tool'),'select','right-click finished the polygon');
  assert.deepEqual(await run('items[1].points'),[{x:300,y:300},{x:400,y:300},{x:400,y:400}],'with exactly the corners placed');

  await run(`isMac=true;setTool('polygon');polygonPress(500,300,false,false);polygonPress(600,300,false,false);polygonPress(600,400,false,false);`);
  assert.equal(await macControlClick(run, 650, 450), true);
  assert.equal(await run('ui.tool'),'select','a Mac Control+click finishes it the same way');
  assert.deepEqual(await run('items[2].points'),[{x:500,y:300},{x:600,y:300},{x:600,y:400}],'and places no stray corner at the click spot first');
}));

test('on a Mac, Control+click on a selected item duplicates nothing and ⌘+drag is the duplicate-drag; Ctrl+drag stays the duplicate-drag elsewhere', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(rectangle('r1'))}];setTool('select');selection=[0];render();isMac=true;`);
  assert.equal(await macControlClick(run, 140, 130), true);
  assert.equal(await run('items.length'),1,'no silent duplicate stacked under the (suppressed) menu');
  assert.deepEqual(await run('selection'),[0]);
  await modifierDrag(run, 'metaKey', 140, 130, 200, 170);
  let items=await run('items');
  assert.equal(items.length,2,'⌘+drag duplicated');
  assert.equal(items[0].x,100,'the original stayed');
  assert.ok(Math.abs(items[1].x-160)<.5 && Math.abs(items[1].y-140)<.5,'the copy followed the drag');
  assert.deepEqual(await run('selection'),[1]);

  await run('isMac=false');
  await modifierDrag(run, 'ctrlKey', 200, 170, 260, 170);
  items=await run('items');
  assert.equal(items.length,3,'Ctrl+drag still duplicates on other platforms');
  assert.ok(Math.abs(items[2].x-220)<.5,'the copy followed the drag');
}));

// ---------- group edit mode ("enter group", Point-Edit-style persistence) ----------
// A group's own bounding box, once selected, can be "entered" via double-click (on a member, or on
// empty space between members) -- editingGroupId then names the group, independent of `selection`,
// which is free to become [] (e.g. after deleting the browsed member) or [oneMemberIdx] (that member
// picked for move/resize/recolor/delete/edit) while it stays active. It only exits on a click OUTSIDE
// the group's own box, Escape, Ungroup, or the group vanishing (see groupBoxContains()/syncGroupEdit()).
// hitTest()/hitStack() treat ANY point inside a group's own box as a hit on its topmost (z-order)
// member, even across gaps between members -- exactly like a single item's own bbox is already fully
// clickable, empty interior included. So a click/dblclick on empty space between members always
// resolves to that representative member, never to "nothing" -- there is no separate "missed every
// member, but still inside the box" state to track.
const groupMember = (uid,x) => ({type:'rect',uid,x,y:100,w:80,h:60,size:2,
  color:'#1f2937',strokeOn:true,fill:true,fillColor:'#ffd166',group:'g1',groupRotation:0});
const groupOf3 = () => [groupMember('m1',100),groupMember('m2',300),groupMember('m3',500)];

test('double-clicking a grouped rect enters group edit mode; moving it leaves siblings untouched; clicking outside the group exits', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+140,canvas.y+130);   // center of m1
  assert.equal(await run('editingGroupId'),'g1');
  assert.deepEqual(await run('selection'),[0]);

  await page.mouse.move(canvas.x+140,canvas.y+130);await page.mouse.down();
  await page.mouse.move(canvas.x+170,canvas.y+110);await page.mouse.up();
  const [m1,m2,m3]=await run('items');
  assert.ok(Math.abs(m1.x-130)<.5 && Math.abs(m1.y-80)<.5,'m1 moved by the drag delta (30,-20)');
  assert.equal(m2.x,300,'m2 untouched');
  assert.equal(m3.x,500,'m3 untouched');
  assert.equal(m1.group,'g1');assert.equal(m2.group,'g1');assert.equal(m3.group,'g1');

  await page.mouse.click(canvas.x+900,canvas.y+700);   // genuinely outside the group's own box
  assert.equal(await run('editingGroupId'),null);
  assert.deepEqual(await run('selection'),[]);
}));

test('while in group edit mode, a plain (non-double) click on a DIFFERENT member selects just that one -- no re-double-click needed', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+140,canvas.y+130);   // enter via m1
  assert.equal(await run('editingGroupId'),'g1');
  assert.deepEqual(await run('selection'),[0]);

  await page.mouse.click(canvas.x+340,canvas.y+130);   // plain click on m2 -- NOT a double-click
  assert.equal(await run('editingGroupId'),'g1','still browsing the same group');
  assert.deepEqual(await run('selection'),[1],'selects just m2, does not re-expand to the whole group');

  await page.mouse.click(canvas.x+540,canvas.y+130);   // then m3, same way
  assert.deepEqual(await run('selection'),[2]);

  // and it's genuinely movable right away, no need to double-click first
  await page.mouse.move(canvas.x+540,canvas.y+130);await page.mouse.down();
  await page.mouse.move(canvas.x+560,canvas.y+130);await page.mouse.up();
  const [m1,m2,m3]=await run('items');
  assert.ok(Math.abs(m3.x-520)<.5,'m3 moved');
  assert.equal(m1.x,100);assert.equal(m2.x,300);
}));

test('clicking empty space WITHIN the group\'s own box does not exit the mode -- resolves to the topmost member, like a single item\'s own bbox already does', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+140,canvas.y+130);
  assert.equal(await run('editingGroupId'),'g1');

  // gap between m1 (own box up to x=183) and m2 (own box from x=297), still well within the
  // group's own union box (x:[97,583], y:[97,163]) -- resolves via the group-box fallback to m3
  // (index 2, topmost in z-order), same as a click landing anywhere else in the group's own box.
  await page.mouse.click(canvas.x+240,canvas.y+130);
  assert.equal(await run('editingGroupId'),'g1','still inside the group');
  assert.deepEqual(await run('selection'),[2],'resolves to the topmost member, not nothing');

  // and the mode still works normally from here -- click a different member to pick it instead
  await page.mouse.click(canvas.x+340,canvas.y+130);
  assert.deepEqual(await run('selection'),[1]);
}));

test('double-clicking empty space within an already-selected group\'s box enters its edit mode too, picking the topmost member', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.click(canvas.x+140,canvas.y+130);   // plain click on m1 -- selects the WHOLE group first
  assert.deepEqual(await run('selection'),[0,1,2]);
  assert.equal(await run('editingGroupId'),null,'not in edit mode yet, just a normal whole-group selection');

  await page.mouse.dblclick(canvas.x+240,canvas.y+130);   // empty gap between m1 and m2, within the box
  assert.equal(await run('editingGroupId'),'g1','entered via empty space, not a direct member hit');
  assert.deepEqual(await run('selection'),[2],'resolves to the topmost member (m3), ready to move/edit it right away');
}));

test('a cold click on empty space within an UNSELECTED group\'s own box selects the whole group directly -- no need to hit a member first', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.click(canvas.x+240,canvas.y+130);   // gap between m1 and m2, nothing selected yet
  assert.deepEqual(await run('selection'),[0,1,2],'whole group selected, same as clicking a member directly');
  assert.equal(await run('editingGroupId'),null,'a plain click never enters edit mode');
}));

test('Escape exits group edit mode back to the whole group selected; a tool switch exits it too', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+140,canvas.y+130);
  assert.equal(await run('editingGroupId'),'g1');
  assert.deepEqual(await run('selection'),[0]);
  await page.keyboard.press('Escape');
  assert.equal(await run('editingGroupId'),null);
  assert.deepEqual(await run('selection.slice().sort()'),[0,1,2],'the lone member is not left selected while the group draws as a whole');
  assert.equal(await run('resizePivotFor(selection).isGroup'),true,'handles belong to the whole group again');

  await page.mouse.dblclick(canvas.x+140,canvas.y+130);
  assert.equal(await run('editingGroupId'),'g1');
  await run(`setTool('rect')`);
  assert.equal(await run('editingGroupId'),null,'switching tools leaves the mode');
  await page.mouse.click(canvas.x+340,canvas.y+130);   // click-without-drag on the rect tool falls back to select
  assert.equal(await run('ui.tool'),'select');
  assert.equal(await run('editingGroupId'),null,'and does not sneak back into it');
  assert.deepEqual(await run('selection.slice().sort()'),[0,1,2],'a plain whole-group selection');
  assert.equal(await run('resizePivotFor(selection).isGroup'),true,'with whole-group handles');
}));

test('a plain body press-and-drag right after entering group edit mode moves only that member', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+140,canvas.y+130);
  await page.mouse.move(canvas.x+120,canvas.y+140);await page.mouse.down();   // off-center, plain body
  await page.mouse.move(canvas.x+135,canvas.y+150);await page.mouse.up();
  assert.deepEqual(await run('selection'),[0],'still editing just m1, not the whole group');
  const [m1,m2]=await run('items');
  assert.ok(Math.abs(m1.x-115)<.5,'m1 moved');
  assert.equal(m2.x,300,'m2 untouched by the drag');
}));

test('resizing and recoloring a group member while editing only changes that one member', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+140,canvas.y+130);
  assert.equal(await run('editingGroupId'),'g1');

  // se corner of m1's padded bbox: x:100,y:100,w:80,h:60,size:2 -> pad=3 -> box (97,97)-(183,163)
  await page.mouse.move(canvas.x+183,canvas.y+163);await page.mouse.down();
  await page.mouse.move(canvas.x+203,canvas.y+183);await page.mouse.up();
  let [m1,m2,m3]=await run('items');
  assert.ok(m1.w>80 && m1.h>60,'m1 grew');
  assert.equal(m2.w,80);assert.equal(m3.w,80);

  await run(`setTool('select');selection=[0];applyFillColor('#2563eb',false);`);
  [m1,m2,m3]=await run('items');
  assert.equal(m1.fillColor,'#2563eb');
  assert.equal(m2.fillColor,'#ffd166','m2 keeps its original fill color');
  assert.equal(m3.fillColor,'#ffd166','m3 keeps its original fill color');
}));

test('deleting the browsed member stays IN group edit mode (ready to pick another); deleting a group down to one member auto-ungroups the survivor', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+340,canvas.y+130);   // m2, the middle member
  assert.equal(await run('editingGroupId'),'g1');
  assert.deepEqual(await run('selection'),[1]);
  await page.keyboard.press('Delete');
  assert.equal(await run('items.length'),2);
  assert.equal(await run('editingGroupId'),'g1','stays in the group\'s edit mode -- 2 members still remain');
  assert.deepEqual(await run('selection'),[],'nothing individually selected anymore, ready to pick another');
  const [m1,m3]=await run('items');
  assert.equal(m1.group,'g1');assert.equal(m3.group,'g1');

  // and browsing continues to work normally: click the other remaining member
  await page.mouse.click(canvas.x+540,canvas.y+130);   // m3 is now items[1], still drawn at its own x:500
  assert.deepEqual(await run('selection'),[1]);

  await run(`items=[${JSON.stringify(groupMember('a',100))},${JSON.stringify(groupMember('b',300))}];setTool('select');render();`);
  await page.mouse.dblclick(canvas.x+140,canvas.y+130);
  assert.equal(await run('editingGroupId'),'g1');
  await page.keyboard.press('Delete');
  assert.equal(await run('editingGroupId'),null,'auto-ungrouping the lone survivor leaves nothing to browse');
  const [survivor]=await run('items');
  assert.equal(survivor.group,undefined,'the last surviving member is auto-ungrouped');
  assert.equal(survivor.groupRotation,undefined);
}));

test('undo/redo across a move performed in group edit mode', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+140,canvas.y+130);
  await page.mouse.move(canvas.x+140,canvas.y+130);await page.mouse.down();
  await page.mouse.move(canvas.x+180,canvas.y+130);await page.mouse.up();
  assert.ok(Math.abs((await run('items[0].x'))-140)<.5);

  await run('undo()');
  assert.equal(await run('items[0].x'),100,'position reverts');
  assert.equal(await run('editingGroupId'),null,'undo leaves group edit mode (cancelGesture resets it)');

  await run('redo()');
  assert.ok(Math.abs((await run('items[0].x'))-140)<.5,'move re-applies on redo');
}));

// A 90° rotation swings each member's on-screen position by roughly its own distance from the group's
// pivot, so these sit closer together and lower on the canvas than groupOf3()'s usual spread, or the
// rotated members would land off-canvas.
const rotatedMember = (uid,x) => ({type:'rect',uid,x,y:400,w:80,h:60,size:2,color:'#1f2937',
  strokeOn:true,fill:true,fillColor:'#ffd166',group:'g1',groupRotation:Math.PI/2});
const rotatedGroup = () => [rotatedMember('m1',300),rotatedMember('m2',450),rotatedMember('m3',600)];
// on-screen centers of every item -- stored x/y are in the LOCAL (unrotated) frame, so with a group
// rotation the actual position of any point on an item is toWorld(item, localX, localY)
const screenCenters = run => run('items.map(it=>toWorld(it, it.x+it.w/2, it.y+it.h/2))');
const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);

// every member of the (only) group still encoded the way the fixture was: shared groupRotation, no own rotation
const encodedAsRotatedGroup = async run => {
  for(const it of await run('items')){
    assert.ok(Math.abs(it.groupRotation-Math.PI/2)<1e-9,'groupRotation kept');
    assert.ok(!it.rotation,'no own rotation left behind on a member');
  }
};

test('moving a member of a ROTATED group in edit mode follows the pointer on screen, leaves its siblings put, and keeps the group\'s own encoding', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(rotatedGroup())};setTool('select');render();`);
  const before=await screenCenters(run);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+before[0].x,canvas.y+before[0].y);
  assert.equal(await run('editingGroupId'),'g1');
  assert.deepEqual(await run('selection'),[0]);
  await encodedAsRotatedGroup(run);   // entering changes nothing about the data
  const rp=await run('resizePivotFor([0])');
  assert.ok(rp && Math.abs(rp.rotation-Math.PI/2)<1e-9 && dist({x:rp.cx,y:rp.cy},before[0])<.5,'the browsed member gets resize handles in its on-screen frame');
  const piv=await run('rotationPivotFor([0])');
  assert.ok(piv && Math.abs(piv.rotation-Math.PI/2)<1e-9,'and a rotation handle');

  await page.mouse.move(canvas.x+before[0].x,canvas.y+before[0].y);await page.mouse.down();
  await page.mouse.move(canvas.x+before[0].x+40,canvas.y+before[0].y);await page.mouse.up();   // 40px purely rightward on screen
  const moved=await screenCenters(run);
  assert.ok(dist(moved[0],{x:before[0].x+40,y:before[0].y})<.5,'m1 followed the pointer on screen');
  for(const i of [1,2]) assert.ok(dist(moved[i],before[i])<.5,`m${i+1} did not move`);
  await encodedAsRotatedGroup(run);   // the rotation was only folded into the members for the drag itself

  await page.mouse.click(canvas.x+before[1].x,canvas.y+before[1].y);   // pick m2
  assert.deepEqual(await run('selection'),[1]);
  await page.keyboard.press('Delete');
  const survivors=await screenCenters(run);
  assert.equal(survivors.length,2);
  assert.ok(dist(survivors[0],moved[0])<.5 && dist(survivors[1],before[2])<.5,'the survivors stay put after a sibling is deleted');
  assert.equal(await run('editingGroupId'),'g1');
  await encodedAsRotatedGroup(run);

  await run('undo()');   // the delete
  await run('undo()');   // the move
  const undone=await screenCenters(run);
  assert.equal(undone.length,3);
  for(let i=0;i<3;i++) assert.ok(dist(undone[i],before[i])<.5,`m${i+1} back where it started`);
  await encodedAsRotatedGroup(run);   // history only ever holds the group's own encoding
}));

test('entering and leaving group edit mode leaves a rotated group resizing exactly as before', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(rotatedGroup())};setTool('select');render();`);
  const before=await screenCenters(run);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+before[0].x,canvas.y+before[0].y);
  assert.equal(await run('editingGroupId'),'g1');
  await page.keyboard.press('Escape');
  assert.deepEqual(await run('selection.slice().sort()'),[0,1,2]);
  const rp=await run('resizePivotFor(selection)');
  assert.ok(rp.isGroup && Math.abs(rp.rotation-Math.PI/2)<1e-9,'the whole group still resizes in its rotated frame');
  // its (local) south-east corner, on screen; dragged 60px leftward on screen, which in the group's
  // 90°-turned frame is straight down its own y axis -- so every member gets taller, none wider
  const corner=await run(`rotatePoint(${rp.box.x+rp.box.w},${rp.box.y+rp.box.h},${rp.cx},${rp.cy},${rp.rotation})`);
  await page.mouse.move(canvas.x+corner.x,canvas.y+corner.y);await page.mouse.down();
  await page.mouse.move(canvas.x+corner.x-60,canvas.y+corner.y,{steps:3});await page.mouse.up();
  for(const it of await run('items')){
    assert.ok(Math.abs(it.w-80)<.5,'width untouched');
    assert.ok(Math.abs(it.h-120)<.5,'height doubled');
  }
  await encodedAsRotatedGroup(run);
}));

test('duplicating a member of a ROTATED group in edit mode leaves the originals put: the copy joins the group without moving its pivot', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(rotatedGroup())};setTool('select');render();`);
  const before=await screenCenters(run);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+before[0].x,canvas.y+before[0].y);
  assert.deepEqual(await run('selection'),[0]);
  await run('duplicateSelection()');
  let after=await screenCenters(run);
  assert.equal(after.length,4);
  for(let i=0;i<3;i++) assert.ok(dist(after[i],before[i])<.5,`m${i+1} did not move (off by ${dist(after[i],before[i]).toFixed(1)}px)`);
  assert.ok(dist(after[3],{x:before[0].x+16,y:before[0].y+16})<.5,'the copy sits 16px down-right of its source on screen');
  assert.equal(await run('items[3].group'),'g1');
  assert.equal(await run('editingGroupId'),'g1');
  await encodedAsRotatedGroup(run);
  await run('selection=[2];duplicateSelection()');   // the last member too -- grows the box on another side
  after=await screenCenters(run);
  for(let i=0;i<3;i++) assert.ok(dist(after[i],before[i])<.5,`m${i+1} still put (off by ${dist(after[i],before[i]).toFixed(1)}px)`);
  await run('undo();undo();');
  assert.equal(await run('items.length'),3);
  await encodedAsRotatedGroup(run);   // history holds only the group's own encoding
}));

test('deleting some members of a ROTATED group leaves the survivors in place, down to the auto-ungrouped last one', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(rotatedGroup())};setTool('select');render();`);
  const before=await screenCenters(run);
  await run('selection=[1];deleteSelected();');   // a partial selection, straight from the rotated state
  const two=await screenCenters(run);
  assert.equal(two.length,2);
  assert.ok(dist(two[0],before[0])<.5 && dist(two[1],before[2])<.5,'both survivors still drawn where they were');
  await encodedAsRotatedGroup(run);
  await run('selection=[1];deleteSelected();');
  const [lone]=await screenCenters(run);
  assert.ok(dist(lone,before[0])<.5,'the auto-ungrouped last survivor too');
  const it=await run('items[0]');
  assert.equal(it.group,undefined);assert.equal(it.groupRotation,undefined);
  assert.ok(Math.abs(it.rotation-Math.PI/2)<1e-9,'it keeps the look it had inside the group');
}));

test('ungrouping while in group edit mode ungroups the whole group and exits edit mode', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+140,canvas.y+130);
  assert.equal(await run('editingGroupId'),'g1');
  await run('ungroupSelection()');
  assert.equal(await run('editingGroupId'),null);
  assert.deepEqual(await run('selection.slice().sort()'),[0,1,2]);
  const items=await run('items');
  for(const it of items){ assert.equal(it.group,undefined); assert.equal(it.groupRotation,undefined); }
}));

test('in group edit mode, a member fully covered by a sibling is reachable by click-cycling', async () => app(async ({page,run}) => {
  const big={...rectangle('big'),x:100,y:100,w:200,h:150,group:'g1',groupRotation:0};
  const top={...rectangle('top'),x:120,y:120,w:100,h:80,fillColor:'#2563eb',group:'g1',groupRotation:0};
  await run(`items=${JSON.stringify([big,top])};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+170,canvas.y+160);   // inside both; the top one wins
  assert.equal(await run('editingGroupId'),'g1');
  assert.deepEqual(await run('selection'),[1]);
  await page.waitForTimeout(600);                          // well past the double-click interval
  await page.mouse.click(canvas.x+170,canvas.y+160);       // restarts the cycle on the top member
  assert.deepEqual(await run('selection'),[1]);
  await page.waitForTimeout(600);
  await page.mouse.click(canvas.x+170,canvas.y+160);       // steps down to the covered member
  assert.deepEqual(await run('selection'),[0],'the rect underneath can be picked without ungrouping');
  assert.equal(await run('editingGroupId'),'g1');
}));

test('duplicating a browsed member adds the copy to the group being edited; copying it to the clipboard detaches it', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupOf3())};setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+140,canvas.y+130);
  assert.deepEqual(await run('selection'),[0]);
  await run('duplicateSelection()');
  assert.equal(await run('items.length'),4);
  assert.equal(await run('items[3].group'),'g1','the duplicate joins the group, rather than forming a group of one');
  assert.equal(await run('editingGroupId'),'g1','still browsing it');
  assert.deepEqual(await run('selection'),[3]);
  await run('selection=duplicateItemsInPlace([1])');   // the Ctrl+drag primitive, same rule
  assert.equal(await run('items[4].group'),'g1');
  await run('selection=[3];copySelection()');
  assert.equal(await run('clipboard[0].group'),undefined,'a lone member on the clipboard carries no group');
}));

test('a line/arrow member picked in group edit mode keeps its endpoint handles: drag one end, click it to cycle the head', async () => app(async ({page,run}) => {
  await run(`items=[
    ${JSON.stringify(groupMember('m1',100))},
    {type:'arrow',uid:'a1',x1:300,y1:130,x2:500,y2:130,size:4,color:'#000000',he:true,group:'g1',groupRotation:0}
  ];setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+400,canvas.y+130);   // on the arrow's shaft
  assert.equal(await run('editingGroupId'),'g1');
  assert.deepEqual(await run('selection'),[1]);
  assert.equal(await run('loneOpenPathIdx(selection)'),1,'endpoint knobs are offered for the browsed arrow');
  await page.mouse.move(canvas.x+500,canvas.y+130);await page.mouse.down();   // grab its end knob
  await page.mouse.move(canvas.x+540,canvas.y+170);await page.mouse.up();
  const [rect,arrow]=await run('items');
  assert.ok(Math.abs(arrow.x2-540)<.5 && Math.abs(arrow.y2-170)<.5,'the end followed the drag');
  assert.equal(arrow.x1,300,'the other end stayed put');
  assert.equal(rect.x,100,'and so did the sibling');
  assert.equal(arrow.group,'g1','still a member');
  await page.mouse.click(canvas.x+540,canvas.y+170);   // a plain click on the knob cycles the head style
  assert.equal(await run('items[1].heStyle'),'filled');
  assert.equal(await run('editingGroupId'),'g1');
}));

test('a click in an empty gap of a selected group neither re-aligns nor long-press-edits the text member it resolves to', async () => app(async ({page,run}) => {
  await run(`items=[
    {type:'rect',uid:'r1',x:400,y:100,w:80,h:60,size:2,color:'#1f2937',strokeOn:true,fill:true,fillColor:'#ffd166',group:'g1',groupRotation:0},
    {type:'text',uid:'t1',x:100,y:100,w:200,h:50,text:'hello',font:'400 28px sans-serif',
      color:'#1f2937',textColor:'#1f2937',strokeOn:false,fill:false,align:'center',size:2,group:'g1',groupRotation:0}
  ];setTool('select');render();`);
  let canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.click(canvas.x+350,canvas.y+125);   // gap between the text (x:100..300) and the rect (x:400..480)
  assert.deepEqual(await run('selection.slice().sort()'),[0,1],'the gap selects the whole group');
  canvas=await page.locator('#canvas').boundingBox();   // the text's font controls may have shifted the canvas
  await page.mouse.click(canvas.x+350,canvas.y+125);   // again, now on the already-selected group
  await page.waitForTimeout(500);                       // past the deferred alignment click
  assert.equal(await run('items[1].align'),'center','alignment untouched');
  await page.mouse.move(canvas.x+350,canvas.y+125);await page.mouse.down();
  await page.waitForTimeout(800);                       // past the long-press delay
  await page.mouse.up();
  assert.equal(await run('editingTextIdx'),null,'no editor for a press that was not on the text itself');
}));

// ---------- text/table: grouped instances get a TWO-STAGE double-click ----------
// Unlike rect/ellipse/etc, these two types already have their own dblclick behavior (open the text
// editor, open a cell editor) that fires unconditionally today, group or not. A grouped instance's
// FIRST double-click now only enters group edit mode instead (so it can be moved/resized/recolored/
// deleted on its own, like any other grouped shape) -- otherwise a grouped text/table item would have
// no way to be repositioned without ungrouping at all, since a plain click always grabs the whole
// group. A SECOND double-click, while already browsing THIS item's own group, opens its own editor,
// same as an ungrouped instance always could.
//
// Test note: selecting a text/table item shows its Font/Size toolbar controls, which can grow the
// toolbar and shift the canvas element's on-page position -- each of these tests re-fetches the canvas's
// boundingBox() between separate mouse gestures rather than reusing one cached box throughout, or a
// second dblclick's coordinates would silently miss the (now-shifted) target.
const groupedText = () => [
  {type:'text',uid:'t1',x:100,y:100,w:200,h:50,text:'hello',font:'400 28px sans-serif',
    color:'#1f2937',textColor:'#1f2937',strokeOn:false,fill:false,align:'center',size:2,group:'g1',groupRotation:0},
  {type:'rect',uid:'r1',x:400,y:100,w:80,h:60,size:2,color:'#1f2937',strokeOn:true,fill:true,fillColor:'#ffd166',group:'g1',groupRotation:0}
];

test('grouped text: first double-click enters group edit mode (movable), second opens the text editor', async () => app(async ({page,run}) => {
  await run(`items=${JSON.stringify(groupedText())};setTool('select');render();`);
  let canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+200,canvas.y+125);
  assert.deepEqual(await run('JSON.stringify({editingGroupId,selection,editingTextIdx})'),
    JSON.stringify({editingGroupId:'g1',selection:[0],editingTextIdx:null}),
    'first dblclick enters group edit mode, does not open the editor');

  // confirm it's genuinely movable now (the whole point of entering this mode first) -- re-fetch:
  // entering group edit mode just selected a text item, which can grow the toolbar (font controls)
  // and shift the canvas element, so the box cached before dblclick1 may already be stale.
  canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvas.x+200,canvas.y+125);await page.mouse.down();
  await page.mouse.move(canvas.x+230,canvas.y+125);await page.mouse.up();
  const [movedText,rect]=await run('items');
  assert.ok(Math.abs(movedText.x-130)<.5,'text moved on its own');
  assert.equal(rect.x,400,'sibling rect untouched');

  canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+230,canvas.y+125);
  assert.equal(await run('editingTextIdx'),0,'second dblclick on the now-isolated member opens the text editor');
}));

test('grouped table: first double-click enters group edit mode, second opens the cell editor', async () => app(async ({page,run}) => {
  await run(`items=[
    {type:'table',uid:'tb1',x:100,y:100,w:200,h:80,rows:1,cols:1,size:2,color:'#000000',fontFamily:'sans',fontSize:20,
      texts:[['cell']],group:'g1',groupRotation:0},
    {type:'rect',uid:'r1',x:400,y:100,w:80,h:60,size:2,color:'#1f2937',strokeOn:true,fill:true,fillColor:'#ffd166',group:'g1',groupRotation:0}
  ];setTool('select');render();`);
  let canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+200,canvas.y+140);
  assert.deepEqual(await run('JSON.stringify({editingGroupId,selection,editingTextIdx})'),
    JSON.stringify({editingGroupId:'g1',selection:[0],editingTextIdx:null}),
    'first dblclick enters group edit mode, does not open the cell editor');

  canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+200,canvas.y+140);
  assert.equal(await run('editingTextIdx'),0,'second dblclick opens the cell editor');
  assert.deepEqual(await run('editingCell'),{r:0,c:0});
}));

test('grouped smart object: double-click steps group edit mode -> the object\'s own script-edit mode -> back', async () => app(async ({page,run}) => {
  const smartScript = `({initState(){return{};},children(state,style,w,h){return[{type:'rect',x:0,y:0,w,h,color:style.color,strokeOn:true,fill:false}];}})`;
  await run(`items=[
    {type:'smart',uid:'s1',x:100,y:100,w:180,h:180,color:'#1f2937',fillColor:'#ffd166',fill:false,strokeOn:true,
      textColor:'#000',size:6,script:${JSON.stringify(smartScript)},state:{},group:'g1',groupRotation:0},
    {type:'rect',uid:'r1',x:400,y:100,w:80,h:60,size:2,color:'#1f2937',strokeOn:true,fill:true,fillColor:'#ffd166',group:'g1',groupRotation:0}
  ];setTool('select');render();`);
  let canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+190,canvas.y+190);
  assert.deepEqual(await run('JSON.stringify({editingGroupId,editingSmartIdx,selection})'),
    JSON.stringify({editingGroupId:'g1',editingSmartIdx:null,selection:[0]}),
    'first dblclick enters group edit mode, not the script-edit mode');

  canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+190,canvas.y+190);
  assert.deepEqual(await run('JSON.stringify({editingGroupId,editingSmartIdx})'),
    JSON.stringify({editingGroupId:'g1',editingSmartIdx:0}),
    'second dblclick enters the smart object\'s own script-edit mode, group edit mode stays too');

  // Once editingSmartIdx is set (as of the dblclick above), every press here crosses the sandbox for
  // its own hitEdit check (see onDown) -- onDoubleClick's own exit-toggle below waits for that to
  // settle before deciding anything (see its own comment), but page.mouse.dblclick() itself only
  // waits for the synthetic DOM events to dispatch, not for the app's own async continuation after
  // them. A short wait lets that continuation actually run before asserting its result.
  canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+190,canvas.y+190);
  await page.waitForTimeout(50);
  assert.deepEqual(await run('JSON.stringify({editingGroupId,editingSmartIdx})'),
    JSON.stringify({editingGroupId:'g1',editingSmartIdx:null}),
    'third dblclick (the smart object\'s own re-dblclick-exits toggle) leaves script-edit mode, still in group edit mode');
}));

// A double-click is two selection clicks before its own event arrives. Smart controls must keep
// the item grabbed by the first press, while separate clicks still reach the layers behind it.
const overlappingSmart = uid => ({type:'smart',uid,x:100,y:100,w:180,h:140,
  color:'#1f2937',fillColor:'#ffd166',fill:false,strokeOn:true,textColor:'#000',size:2,state:{},
  script:`({children(state,style,w,h){return[{type:'rect',x:0,y:0,w,h,color:style.color,strokeOn:true,fill:false}];}})`});
async function seedOverlap(run, scene){
  await run(`cancelGesture();items=${JSON.stringify(scene)};selection=[];setTool('select');render();`);
}
test('overlapping smart controls open on a fresh or already-selected double-click', async () => app(async ({page,run}) => {
  const scene=[rectangle('bottom'),rectangle('middle'),overlappingSmart('smart')];
  for(const selected of [false,true]){
    await seedOverlap(run,scene);
    let box=await page.locator('#canvas').boundingBox();
    if(selected) await page.mouse.click(box.x+190,box.y+160);
    box=await page.locator('#canvas').boundingBox();
    await page.mouse.dblclick(box.x+190,box.y+160);
    await page.waitForFunction(()=>__test.run('editingSmartIdx')===2);
    assert.deepEqual(await run('selectedUids()'),['smart']);
    assert.equal(await run('pointEditIdx'),null,'the background is not converted or edited');
    assert.deepEqual(await run('items'),scene,'entering controls leaves all drawing data unchanged');
  }
}));

test('double-click keeps a selected lower smart component beneath a shape or another component', async () => app(async ({page,run}) => {
  for(const top of [rectangle('top'),overlappingSmart('top')]){
    const scene=[rectangle('bottom'),overlappingSmart('selected'),top];
    await seedOverlap(run,scene);
    let box=await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x+190,box.y+160);
    box=await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x+190,box.y+160);
    assert.deepEqual(await run('selectedUids()'),['selected'],'separate clicks reach the lower component');
    box=await page.locator('#canvas').boundingBox();
    await page.mouse.dblclick(box.x+190,box.y+160);
    await page.waitForFunction(()=>__test.run('editingSmartIdx')===1);
    assert.deepEqual(await run('selectedUids()'),['selected']);
    assert.deepEqual(await run('items'),scene);
  }
}));

test('separate clicks still cycle behind smart controls and dragging moves the selected lower shape', async () => app(async ({page,run}) => {
  const scene=[rectangle('background'),overlappingSmart('smart')];
  await seedOverlap(run,scene);
  for(const expected of ['smart','background','smart','background']){
    const box=await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x+190,box.y+160);
    assert.deepEqual(await run('selectedUids()'),[expected]);
  }
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.move(box.x+190,box.y+160);await page.mouse.down();
  await page.mouse.move(box.x+225,box.y+180);await page.mouse.up();
  assert.deepEqual(await run('selectedUids()'),['background']);
  assert.deepEqual(await run('items[0]'),{...scene[0],x:135,y:120});
  assert.deepEqual(await run('items[1]'),scene[1]);
  assert.equal(await run('editingSmartIdx'),null);
}));

test('ordinary overlapping shapes keep their cycled double-click target', async () => app(async ({page,run}) => {
  const scene=['bottom','middle','top'].map(uid=>rectangle(uid));
  await seedOverlap(run,scene);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(box.x+190,box.y+160);
  assert.deepEqual(await run('selectedUids()'),['middle']);
  assert.equal(await run('pointEditIdx'),1);
  assert.equal(await run('items[1].type'),'polygon');
  assert.deepEqual(await run('[items[0],items[2]]'),[scene[0],scene[2]]);
}));

test('overlapping grouped smart controls retain group entry then smart editing', async () => app(async ({page,run}) => {
  const scene=[rectangle('background'),overlappingSmart('smart')].map(it=>({...it,group:'overlap',groupRotation:0}));
  await seedOverlap(run,scene);
  let box=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(box.x+190,box.y+160);
  assert.equal(await run('editingGroupId'),'overlap');
  assert.equal(await run('editingSmartIdx'),null);
  assert.deepEqual(await run('selectedUids()'),['smart']);
  box=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(box.x+190,box.y+160);
  await page.waitForFunction(()=>__test.run('editingSmartIdx')===1);
  assert.equal(await run('editingGroupId'),'overlap');
  assert.deepEqual(await run('selectedUids()'),['smart']);
  assert.deepEqual(await run('items'),scene);
}));

test('overlapping smart controls keep the first touch target on double-tap', async () => app(async ({page,run}) => {
  const scene=[rectangle('bottom'),rectangle('middle'),overlappingSmart('smart')];
  for(const selected of [false,true]){
    await seedOverlap(run,scene);
    let box=await page.locator('#canvas').boundingBox();
    if(selected){
      await page.touchscreen.tap(box.x+190,box.y+160);
      await page.waitForTimeout(400);
    }
    box=await page.locator('#canvas').boundingBox();
    await page.touchscreen.tap(box.x+190,box.y+160);
    await page.touchscreen.tap(box.x+198,box.y+166);
    await page.waitForFunction(()=>__test.run('editingSmartIdx')===2);
    assert.deepEqual(await run('selectedUids()'),['smart']);
    assert.equal(await run('pointEditIdx'),null);
    assert.deepEqual(await run('items'),scene);
  }
}, {context:{viewport:{width:768,height:1024},hasTouch:true,isMobile:true}}));

test('ungrouped text/table still open their own editor on the very first double-click, unaffected', async () => app(async ({page,run}) => {
  await run(`items=[{type:'text',uid:'t1',x:100,y:100,w:200,h:50,text:'hello',font:'400 28px sans-serif',
    color:'#1f2937',textColor:'#1f2937',strokeOn:false,fill:false,align:'center',size:2}];setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+200,canvas.y+125);
  assert.deepEqual(await run('JSON.stringify({editingGroupId,editingTextIdx})'),
    JSON.stringify({editingGroupId:null,editingTextIdx:0}));
}));

// ---------- a real double-click on a smart object's own handle must not exit edit mode ----------
// Real bug, reported directly: a real double-click on one of a smart shape's own handles (e.g. the
// Chart template's "+" add-bar button, a kind:'click' handle) left edit mode entirely -- each half of
// the double-click correctly resolved the handle's own action via onDown/onUp's smartDrag machinery,
// but the native dblclick event ALSO fired the generic "re-double-click a smart object exits edit
// mode" toggle on top of it, since onUp's smartDrag resolution was missing the handledPointerUp flag
// its sibling gestures (editingAnchor/endDrag, used by Point-Edit) already set. General fix -- any
// smart shape with its own handles benefits, not just one script -- verified here against the Chart
// template this PR itself ships.
test('a real double-click on a smart object\'s own handle stays in edit mode; a double-click on its plain body still exits', async () => app(async ({page,run}) => {
  await run(`(async()=>{
    const initState = await requestSmartCall(SMART_TEMPLATES.chart.script, 'initState', []);
    items=[{type:'smart',uid:'c1',x:40,y:40,w:240,h:160,color:'#1f2937',fillColor:'#ffd166',
      fill:false,strokeOn:false,textColor:'#1f2937',size:2,fontFamily:'sans',fontSize:12,font:fontStr('sans',12),
      script:SMART_TEMPLATES.chart.script,state:initState}];
    setTool('select');selection=[0];editingSmartIdx=0;render();
  })()`);
  const handlePt = await run(`(async()=>{
    const it = items[0];
    const hs = await requestSmartCall(it, 'handles', [it.state, it.w, it.h, smartResolvedStyle(it)]);
    const h = hs.find(x=>x.id==='add');
    return { x: it.x + h.x, y: it.y + h.y };
  })()`);
  const canvas = await page.locator('#canvas').boundingBox();
  const barsBefore = await run('items[0].state.values.length');
  // Every press here crosses the sandbox for its own hitEdit/dragEdit check (see onDown) --
  // page.mouse.dblclick() only waits for the synthetic DOM events to dispatch, not for the app's own
  // async continuation after them, so a short wait lets that continuation actually finish first.
  await page.mouse.dblclick(canvas.x + handlePt.x, canvas.y + handlePt.y);
  await page.waitForTimeout(50);
  assert.equal(await run('editingSmartIdx'), 0, 'a double-click on the "+" handle itself stays in edit mode');
  // Chart's own "+" has no debounce of its own (unlike the race-start-timer example's cycle buttons),
  // so a real double-click's TWO separate clicks each correctly resolve their own add-bar action --
  // that part is unchanged and expected. The actual fix under test is editingSmartIdx surviving above.
  assert.ok(await run('items[0].state.values.length') > barsBefore, 'the handle\'s own click resolution still fires normally');

  // a double-click on the item's own plain body (the top margin strip, above the bars/labels and
  // well away from any handle -- but still inside the 240x160 box at (40,40)) still exits, unchanged
  await page.mouse.dblclick(canvas.x + 240, canvas.y + 48);
  await page.waitForTimeout(50);
  assert.equal(await run('editingSmartIdx'), null, 'a double-click on the plain body still exits edit mode as before');
}));

// ---------- Smart Shape sandbox: the actual security boundary ----------
// A smart shape's script is untrusted (SMART_SHAPES.md) and runs inside a dedicated Worker with every
// network global deleted before it ever runs -- not in the app's own scope. These two tests are the
// ones that actually prove the isolation holds, rather than just that the feature still works.
test('a hostile script cannot reach the host page\'s DOM, localStorage, network, or top frame', async () => app(async ({page,run}) => {
  // The script reports what it could/couldn't reach via its own returned descriptor (child text) --
  // run() itself can't see into the worker directly, so the proof has to come back this way.
  const hostileScript = `({
    children(state, style, w, h){
      const report = {};
      try { report.parentDoc = !!window.parent.document.title; } catch(e) { report.parentDoc = 'blocked:'+e.constructor.name; }
      try { localStorage.setItem('pwned','1'); report.localStorage = 'REACHED'; } catch(e) { report.localStorage = 'blocked:'+e.constructor.name; }
      try { report.fetch = typeof fetch; } catch(e) { report.fetch = 'blocked'; }
      try { report.xhr = typeof XMLHttpRequest; } catch(e) { report.xhr = 'blocked'; }
      try { report.topLocation = window.top.location.href; } catch(e) { report.topLocation = 'blocked:'+e.constructor.name; }
      return [{type:'text', text:JSON.stringify(report), x:0,y:0,w:w,h:h, align:'left', font:'12px sans', color:'#000'}];
    }
  })`;
  await run(`items=[{type:'smart',uid:'h1',x:40,y:40,w:200,h:100,color:'#000',fillColor:'#fff',
    fill:false,strokeOn:false,textColor:'#000',size:2,fontFamily:'sans',fontSize:12,font:fontStr('sans',12),
    script:${JSON.stringify(hostileScript)},state:{}}];setTool('select');render();`);
  await page.waitForTimeout(100);   // let the cache's background children() request resolve
  const kids = await run(`smartChildrenCache.get('h1').kids`);
  const report = JSON.parse(kids[0].text);
  assert.match(report.parentDoc, /^blocked:/, 'cannot reach the host page\'s DOM through window.parent');
  assert.match(report.localStorage, /^blocked:/, 'cannot read or write the host page\'s localStorage');
  assert.equal(report.fetch, 'undefined', 'fetch is deleted inside the sandbox');
  assert.equal(report.xhr, 'undefined', 'XMLHttpRequest is deleted inside the sandbox');
  assert.match(report.topLocation, /^blocked:/, 'cannot reach the top frame either');
  // and, most directly: the host's OWN localStorage was never actually touched
  assert.equal(await run(`localStorage.getItem('pwned')`), null, 'the host page\'s real localStorage is untouched');
}));

test('an infinite loop in a script times out, recovers, and does not take down other smart shapes', async () => app(async ({page,run,context}) => {
  // Keep the offender present: recovery must preserve healthy queued work without manual renders.
  const hangScript = `({ children(){ while(true){} } })`;
  const okScript = `({ children(state,style,w,h){ return [{type:'rect',x:0,y:0,w:w,h:h,color:style.color,strokeOn:true,fill:false}]; } } )`;
  await run(`items=[
    {type:'smart',uid:'hang1',x:40,y:40,w:100,h:100,color:'#000',fillColor:'#fff',fill:false,strokeOn:false,
      textColor:'#000',size:2,fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script:${JSON.stringify(hangScript)},state:{}},
    {type:'smart',uid:'ok1',x:200,y:40,w:100,h:100,color:'#000',fillColor:'#fff',fill:false,strokeOn:false,
      textColor:'#000',size:2,fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script:${JSON.stringify(okScript)},state:{}}
  ];setTool('select');render();`);
  await page.waitForFunction(()=>__test.run("smartBackoffUntil.has('hang1') && smartChildrenCache.has('ok1')"));
  assert.equal(await run(`smartChildrenCache.has('hang1')`), false, 'the hung shape never got a result, but caused no crash');
  const fresh = await run(`requestSmartCall('({children(){return [{type:"rect",x:1,y:2,w:3,h:4}]}})', 'children', [{},{},10,10,false])`);
  assert.deepEqual(fresh, [{type:'rect',x:1,y:2,w:3,h:4}], 'a different owner still executes');
  const okKids = await run(`smartChildrenCache.get('ok1') && smartChildrenCache.get('ok1').kids`);
  assert.ok(okKids && okKids.length, 'the healthy shape renders while the offender remains');
  assert.equal(await run('items.length'),2);
  await run('selection=[1];render()');await page.keyboard.press('ArrowRight');
  assert.equal(await run('items[1].x'),201);await run('undo()');assert.equal(await run('items[1].x'),200);
  const svg=await run('itemsToSVGMarkup(items,{width:600,height:300,background:false})');
  const preview=await context.newPage();await preview.setContent(svg);
  const position=await preview.locator('rect').evaluate(rect=>{
    const p=new DOMPoint(rect.x.baseVal.value,rect.y.baseVal.value).matrixTransform(rect.getCTM());
    return {x:p.x,y:p.y};
  });
  assert.deepEqual(position,{x:200,y:40},'healthy content still exports at its world position beside a hanging owner');
}));

// Real bug, reported directly: a smart shape's polygon-type children (a flag pennant, a clock's own
// elapsed-time wedge, an arrow's curved shaft -- anything with a `points` array) drifted further off
// its container on every single repaint, winding up well outside the container within a few frames.
// Cached geometry must stay local and unchanged across paints, including nested curve controls.
test('a smart shape\'s polygon children do not drift on repeated repaints', async () => app(async ({page,run}) => {
  const script = `({
    children(state,style,w,h){
      return [{type:'polygon', points:[{x:0,y:0,c1:{x:20,y:-20}},
        {x:w,y:0,c2:{x:w-20,y:-20},arcTo:{cx:w,cy:h/2,r:h/2,a1:0,a2:Math.PI}},
        {x:w,y:h},{x:0,y:h}], closed:true, color:style.color, size:2, strokeOn:true, fill:false}];
    }
  })`;
  await run(`items=[{type:'smart',uid:'d1',x:100,y:100,w:80,h:60,color:'#1f2937',fillColor:'#ffd166',
    fill:false,strokeOn:false,textColor:'#1f2937',size:2,fontFamily:'sans',fontSize:12,font:fontStr('sans',12),
    script:${JSON.stringify(script)},state:{}}];setTool('select');render();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.has('d1')"));
  const before=await run(`(()=>{
    const kids=smartChildrenCache.get('d1').kids;
    const freeze=o=>{if(o && typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}};
    freeze(kids);render();return {children:JSON.stringify(kids),pixels:canvas.toDataURL()};
  })()`);
  for(let i=0;i<10;i++) await run('render()');   // 10 more repaints, reusing the SAME cached children
  const after=await run(`({children:JSON.stringify(smartChildrenCache.get('d1').kids),pixels:canvas.toDataURL()})`);
  assert.deepEqual(after,before,'nested geometry and painted pixels stay unchanged across unrelated repaints');
}));

// Real bug, reported directly: a smart shape built from a long reference template (race-start-timer.js,
// ~37,300 characters with its full explanatory header comment -- SMART_SHAPES.md explicitly tells
// readers to paste a reference script's whole file that way) was silently rejected as "invalid" the
// moment it went through a save/load round-trip (export the Shape Library, re-import it into a fresh
// view) -- creating it live via the dialog never checks script length at all, so the problem only
// surfaced later. Root cause: normalizeItem's own MAX_SCRIPT cap (20,000, set before any example this
// long existed) was well under half of what the documented workflow actually produces. Fixed by
// raising the cap to 50,000.
test('a smart shape with a long reference-template script survives a save/load round-trip', async () => app(async ({page,run}) => {
  const result = await run(`
    (() => {
      // Pad a trivial script with a long comment, well past the OLD 20,000-char cap but under the
      // new 50,000 one -- mirrors race-start-timer.js's own shape (mostly explanatory comment).
      const padding = '/*' + 'x'.repeat(30000) + '*/';
      const script = padding + '\\n({ children(state,style,w,h){ return [{type:"rect",x:0,y:0,w:w,h:h,color:style.color,strokeOn:true,fill:false}]; } })';
      const raw = {type:'smart',uid:'long1',x:10,y:10,w:100,h:100,color:'#000',fillColor:'#fff',
        fill:false,strokeOn:true,textColor:'#000',size:2,fontFamily:'sans',fontSize:12,
        font:fontStr('sans',12),script,state:{}};
      const scene = normalizeScene([raw], {}, FORMAT_VERSION);
      return JSON.stringify({ scriptLength: script.length, itemCount: scene.items.length,
        survived: scene.items.length===1 && scene.items[0].type==='smart' });
    })()
  `);
  const parsed = JSON.parse(result);
  assert.ok(parsed.scriptLength > 20000, 'the test script must actually exceed the OLD cap to be meaningful');
  assert.ok(parsed.survived, `a ${parsed.scriptLength}-character script must survive normalizeScene (a real save/load round-trip), not be silently dropped`);
}));

// ---------- Iconify icon import ----------
const SAILBOAT = '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M22 18H2a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4Z"/><path d="M21 14 10 2 3 14h18Z"/><path d="M10 2v16"/></g>';

test('SVG path parser handles arcs, compact numbers, and closing', async () => app(async ({run}) => {
  const r = JSON.parse(await run(`(()=>{
    const arc = svgPathToSubpaths('M0 0 A10 10 0 0 1 20 0');
    const a = arc[0].points, last = a[a.length-1];
    const samples = [];
    for(let k=0;k<a.length-1;k++){ const p=a[k], q=a[k+1]; for(let t=0;t<=1;t+=0.125)
      samples.push({x:cubicPoint(p.x,p.c1?p.c1.x:p.x,q.c2?q.c2.x:q.x,q.x,t), y:cubicPoint(p.y,p.c1?p.c1.y:p.y,q.c2?q.c2.y:q.y,q.y,t)}); }
    const top = samples.reduce((m,p)=>p.y<m.y?p:m);
    const compact = svgPathToSubpaths('M1.5-.5.5.5l1e1 0a4 4 0 014 4z');
    const two = svgPathToSubpaths('M0 0h10v10zm20 0h5v5z');
    return JSON.stringify({last, top, compactFirst: compact[0].points[0], compactSecond: compact[0].points[1],
      compactClosed: compact[0].closed, twoCount: two.length, secondStart: two[1].points[0], twoClosed: two.map(s=>s.closed)});
  })()`));
  assert.ok(Math.abs(r.last.x-20)<1e-6 && Math.abs(r.last.y)<1e-6, 'arc ends exactly at its endpoint');
  assert.ok(Math.abs(r.top.x-10)<0.5 && Math.abs(r.top.y+10)<0.1, `arc apex near (10,-10), got ${JSON.stringify(r.top)}`);
  assert.deepEqual([r.compactFirst.x, r.compactFirst.y], [1.5, -0.5]);
  assert.deepEqual([r.compactSecond.x, r.compactSecond.y], [0.5, 0.5], 'a second pair after M is an implicit L');
  assert.equal(r.compactClosed, true);
  assert.equal(r.twoCount, 2);
  assert.deepEqual([r.secondStart.x, r.secondStart.y], [20, 0], 'relative m after Z starts from the closed subpath start');
  assert.deepEqual(r.twoClosed, [true, true]);
}));

test('SVG icon conversion: stroke icon, circle, and rejected features', async () => app(async ({run}) => {
  const r = JSON.parse(await run(`(()=>{
    const boat = svgIconToItems(${JSON.stringify(SAILBOAT)}, {left:0,top:0,width:24,height:24});
    const circle = svgIconToItems('<circle cx="12" cy="12" r="10" fill="currentColor"/>', {left:0,top:0,width:24,height:24});
    const rej = [
      '<mask id="m"><path d="M0 0h1v1z"/></mask><path d="M0 0h10v10z" mask="url(#m)"/>',
      '<path fill="url(#g)" d="M0 0h10v10z"/>',
    ].map(b=>svgIconToItems(b,{left:0,top:0,width:24,height:24}).error || null);
    const duo = svgIconToItems('<path fill="currentColor" d="M0 0h24v24H0z" opacity=".4"/><path fill="currentColor" d="M8 8h8v8H8z"/>', {left:0,top:0,width:24,height:24});
    const thin = svgIconToItems('<path fill="none" stroke="currentColor" stroke-width="1.5" d="M2 2h20"/>', {left:0,top:0,width:24,height:24}).items[0].size;
    ui.color = '#00ff00';   // the toolbar color must not leak into imported icons
    const vb = {left:0,top:0,width:24,height:24};
    const colors = {
      current: svgIconToItems('<path fill="currentColor" d="M0 0h24v24H0z"/>', vb).items[0].fillColor,
      named: svgIconToItems('<path fill="red" d="M0 0h24v24H0z"/>', vb).items[0].fillColor,
      hex: svgIconToItems('<path fill="#36c" d="M0 0h24v24H0z"/>', vb).items[0].fillColor,
      absent: svgIconToItems('<path d="M0 0h24v24H0z"/>', vb).items[0].fillColor,
      outline: (it=>[it.color, it.fillColor])(svgIconToItems('<path fill="none" stroke="currentColor" d="M2 2h20v20H2z"/>', vb).items[0]),
    };
    return JSON.stringify({boat, circle, rej, thin, colors, duo:svgIconToItems('<path fill="currentColor" d="M0 0h24v24H0z" opacity=".4"/><path fill="currentColor" d="M8 8h8v8H8z"/>', vb).items.map(i=>i.fillColor), color:ICON_INK});
  })()`));
  assert.equal(r.thin, 8, 'a fractional stroke width (1.5 x 5 = 7.5) is rounded to whole pixels');
  assert.deepEqual(r.colors, {current:r.color, named:'#ff0000', hex:'#3366cc', absent:'#000000', outline:[r.color, r.color]},
    'icons keep their own colors (currentColor = preview ink), never the toolbar color');
  assert.notEqual(r.duo[0], r.color, 'a translucent layer becomes a tint');
  assert.equal(r.duo[1], r.color, 'an opaque layer keeps the drawing color');
  assert.ok(r.boat.items, r.boat.error);
  assert.equal(r.boat.items.length, 3);
  assert.deepEqual(r.boat.items.map(i=>i.type), ['polygon','polygon','polygon']);
  assert.deepEqual(r.boat.items.map(i=>i.closed), [true, true, false]);
  assert.ok(r.boat.items.every(i=>i.strokeOn && !i.fill && i.group==='s1'), 'stroke icon -> grouped outline polygons');
  assert.ok(Math.abs(r.boat.items[0].size-10)<0.01, 'stroke width 2 scales with the 24 -> 120 viewBox');
  assert.equal(r.circle.items.length, 1);
  const c = r.circle.items[0];
  assert.ok(c.closed && c.fill && !c.strokeOn && c.points.length===4 && c.points.every(p=>p.c1 && p.c2), 'circle -> closed 4-anchor bezier');
  assert.ok(c.group == null, 'a single item is not grouped');
  assert.ok(r.rej.every(Boolean), `every unsupported icon is refused: ${JSON.stringify(r.rej)}`);
}));

async function routeIconify(page){
  const cors = {'access-control-allow-origin':'*'};
  await page.route('https://api.iconify.design/**', route => {
    const url = new URL(route.request().url());
    if(url.pathname==='/search') return route.fulfill({headers:cors, contentType:'application/json', body:JSON.stringify({
      icons:['gplset:sailboat','lucide:sailboat','multi:sailboat'], total:3, limit:96, start:0,
      collections:{
        lucide:{name:'Lucide', author:{name:'Lucide Contributors', url:'https://github.com/lucide-icons/lucide'},
          license:{title:'ISC', spdx:'ISC', url:'https://github.com/lucide-icons/lucide/blob/main/LICENSE'}, tags:['Uses Stroke'], palette:false},
        gplset:{name:'GPL Icons', author:{name:'Someone'}, license:{title:'GPL 3.0', spdx:'GPL-3.0', url:'javascript:alert(1)'}, palette:false},
        multi:{name:'Colorful', license:{title:'MIT', spdx:'MIT'}, palette:true},
      }})});
    if(url.pathname==='/multi.json') return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({width:24,height:24,icons:{sailboat:{body:'<rect width="12" height="24" fill="red"/><rect x="12" width="12" height="24" fill="blue"/>'}}})});
    if(url.pathname==='/lucide.json') return route.fulfill({headers:cors, contentType:'application/json',
      body:JSON.stringify({prefix:'lucide', width:24, height:24, icons:{sailboat:{body:SAILBOAT}}})});
    if(url.pathname.endsWith('.svg')) return route.fulfill({headers:cors, contentType:'image/svg+xml',
      body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>'});
    return route.fulfill({status:404, headers:cors, body:''});
  });
}

test('icon dialog filters licenses, imports an icon with its license, and places it as one group', async () => app(async ({page,run}) => {
  await routeIconify(page);
  const iconRequests = [];
  page.on('request', r => { if(r.url().startsWith('https://api.iconify.design/')) iconRequests.push(new URL(r.url()).pathname); });
  await run('openIconDialog()');
  await page.fill('#iconSearchInput', 'sailboat');
  await page.click('#iconSearchBtn');
  await page.waitForSelector('#iconResults .shape-entry');
  assert.equal(await page.locator('#iconResults .shape-entry').count(), 2, 'GPL hidden, multicolor included');
  assert.match(await page.textContent('#iconStatus'), /1 hidden by the license filter/);
  await page.uncheck('#iconPermissiveOnly');
  await page.waitForFunction(()=>document.querySelectorAll('#iconResults .shape-entry').length===3);
  assert.equal(await page.locator('#iconResults .icon-license.restricted').count(), 1);
  assert.equal(await page.locator('#iconResults [href^="javascript"]').count(), 0, 'non-http license links are not linked');
  await page.check('#iconPermissiveOnly');
  await page.waitForFunction(()=>document.querySelectorAll('#iconResults .shape-entry').length===2);
  assert.match(await page.locator('#iconResults .icon-license').first().textContent(), /Lucide/);
  await page.locator('#iconResults .shape-thumb').first().click();
  await page.waitForFunction(()=>__test.run('shapeLibrary && shapeLibrary.shapes.length')===1);
  const lib = JSON.parse(await run(`JSON.stringify({open: iconDialog.open, entry: shapeLibrary.shapes[0],
    roundTrip: normalizeShapeLibrary(JSON.parse(JSON.stringify(shapeLibrary))).shapes[0].source})`));
  assert.equal(lib.open, false, 'dialog closes after import');
  assert.equal(lib.entry.name, 'sailboat');
  assert.equal(lib.entry.source.license.spdx, 'ISC');
  assert.equal(lib.entry.source.setName, 'Lucide');
  assert.deepEqual(lib.roundTrip, lib.entry.source, 'source survives export/import normalization');
  assert.equal(lib.entry.items.length, 3);
  await run('openIconDialog()');
  await page.locator('#iconResults .shape-thumb').first().click();
  await page.waitForFunction(()=>__test.run('shapeLibrary.shapes.length')===2);
  assert.equal(await run('shapeLibrary.shapes[1].name'), 'sailboat 2', 'a second import gets a unique name');
  assert.ok(!iconRequests.some(p=>p.endsWith('.svg')), 'thumbnails are drawn from batched set data, not one request per icon');
  assert.equal(iconRequests.filter(p=>p==='/lucide.json').length, 1, 'one request per set, reused for both imports');
  assert.match(await page.locator('#iconResults img').first().getAttribute('src'), /^data:image\/svg\+xml,/);
  const placed = JSON.parse(await run(`(async()=>{ await placeShapeAt(shapeLibrary.shapes[0], 400, 300);
    return JSON.stringify(items.map(i=>({type:i.type, group:i.group}))); })()`));
  assert.equal(placed.length, 3);
  assert.ok(placed[0].group!=null && placed.every(i=>i.group===placed[0].group), 'placed icon is one group');
}));

test('hole bridges get no stroke, everything else strokes as before', async () => app(async ({run}) => {
  const r = JSON.parse(await run(`(async ()=>{
    const it = svgIconToItems('<path fill-rule="evenodd" d="M0 0h24v24H0zM6 6h12v12H6z"/>', {left:0,top:0,width:24,height:24}).items[0];
    const summary = item=>shapeOps(item).filter(o=>o.kind==='path').map(o=>({stroke:o.style.stroke, fill:o.style.fill,
      cmds:o.d.map(c=>c[0]).join('')}));
    const stroked = {...it, strokeOn:true};
    const moved = clone(stroked); const k = moved.points.findIndex((p,i)=>moved.points.some((q,j)=>j!==i && q.x===p.x && q.y===p.y));
    moved.points[k] = {...moved.points[k], x:moved.points[k].x+7};
    const plain = {type:'polygon', points:[{x:0,y:0},{x:100,y:0},{x:50,y:80}], closed:true, color:'#000000', size:4, strokeOn:true, fill:true, fillColor:'#ff0000'};
    const spike = {...plain, points:[{x:0,y:0},{x:100,y:0},{x:150,y:40},{x:100,y:0},{x:50,y:80}]};
    const svg = await itemsToSVGMarkup([stroked]);
    return JSON.stringify({off:summary(it), on:summary(stroked), moved:summary(moved), plain:summary(plain), spike:summary(spike),
      svgPaths:(svg.match(/<path /g)||[]).length});
  })()`));
  assert.equal(r.off.length, 1, 'stroke off: one path, unchanged');
  assert.equal(r.plain.length, 1, 'an ordinary polygon: one path, unchanged');
  assert.equal(r.spike.length, 1, 'a drawn spike (A->B directly followed by B->A) keeps its stroke');
  assert.equal(r.on.length, 2, 'bridged polygon with stroke: fill path + stroke path');
  assert.equal(r.on[0].stroke, 'none');
  assert.match(r.on[0].cmds, /Z$/, 'the fill keeps the whole closed contour');
  assert.equal(r.on[1].fill, 'none');
  assert.ok(!r.on[1].cmds.includes('Z'), 'the stroke path is open runs');
  assert.equal((r.on[1].cmds.match(/L/g)||[]).length, 8, 'outline 4 + hole 4 edges stroked, both bridge segments skipped');
  assert.equal((r.on[1].cmds.match(/M/g)||[]).length, 2, 'two runs: outline and hole');
  assert.equal(r.moved.length, 1, 'a bridge point moved apart is an ordinary edge again');
  assert.equal(r.svgPaths, 2, 'SVG export follows the same split');
}));

test('library footer stays below a grid capped at four rows, and hides in Manage', async () => app(async ({page,run}) => {
  await run(`shapeLibrary = {app:'SimpleCanvasShapeLibrary', version:1, shapes:Array.from({length:20}, (_,k)=>({name:'s'+k,
    items:[{type:'rect', x:-20, y:-20, w:40, h:40, color:'#000000', size:2, strokeOn:true, fill:false}]}))}; setShapePicker(true)`);
  const m = JSON.parse(await run(`(()=>{ const g = shapeGrid.getBoundingClientRect(), f = shapePickerFooter.getBoundingClientRect(),
    e = shapeGrid.querySelector('.shape-entry').getBoundingClientRect();
    return JSON.stringify({gridH:g.height, rowH:e.height, scrolls:shapeGrid.scrollHeight>shapeGrid.clientHeight,
      footerBelow:f.top>=g.bottom, footerVisible:!shapePickerFooter.hidden && f.height>0}); })()`));
  assert.ok(m.scrolls, 'twenty shapes overflow the grid, which scrolls');
  assert.ok(m.gridH < 5*m.rowH, `grid shows at most four rows (grid ${m.gridH}px, row ${m.rowH}px)`);
  assert.ok(m.footerBelow && m.footerVisible, 'footer sits under the grid, outside its scroll area');
  assert.equal(await run(`shapeGrid.querySelectorAll('.shape-entry').length`), 20, 'the grid holds only shapes, no add tiles');
  await page.click('#manageShapesBtn');
  assert.equal(await run('shapePickerFooter.hidden'), true, 'Manage has its own actions; footer is hidden');
}));

test('icon entry points hide while the browser is offline and return when it reconnects', async () => app(async ({run,context}) => {
  const visible = ()=>run(`JSON.stringify({btn: !document.getElementById('addIconBtn').hidden,
    tile: !document.getElementById('addIconFooterBtn').hidden})`).then(JSON.parse);
  await run('renderShapeLibrary()');
  assert.deepEqual(await visible(), {btn:true, tile:true});
  await context.setOffline(true);
  await run('new Promise(r=>setTimeout(r,50))');
  assert.deepEqual(await visible(), {btn:false, tile:false});
  await context.setOffline(false);
  await run('new Promise(r=>setTimeout(r,50))');
  assert.deepEqual(await visible(), {btn:true, tile:true});
}));

test('icon search offline shows a message instead of failing', async () => app(async ({page,run}) => {
  await page.route('https://api.iconify.design/**', route => route.abort());
  await run('openIconDialog()');
  await page.fill('#iconSearchInput', 'anchor');
  await page.click('#iconSearchBtn');
  await page.waitForFunction(()=>/connection/.test(document.getElementById('iconStatus').textContent));
  assert.equal(await page.locator('#iconResults .shape-entry').count(), 0);
}));

test('the Timer template shows a large Minutes or Seconds left readout under the dial, inside the box, never wrapping', async () => app(async ({run}) => {
  const r = JSON.parse(await run(`(async()=>{
    const script = SMART_TEMPLATES.timer.script;
    const seed = clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key==='timer').items[0]);
    const init = await requestSmartCall(seed, 'initStyle', []);
    const initial = await requestSmartCall(seed, 'initState', []);
    const out = [];
    for(const [w,h] of [[init.w, init.h], [160,190], [90,110], [70,84]]){
      const it = {type:'smart', uid:'timer-readout', componentApi:2, componentName:'Timer', w, h, color:'#1f2937', fillColor:'#dc2626', fill:false, strokeOn:true, textColor:'#1f2937',
        size:2, fontFamily:'sans', fontSize:12, font:fontStr('sans',12), script};
      for(const unit of ['minutes','seconds'])for(const duration of [45,59,1]){
        it.state={...initial,unit,duration,configuredUnit:unit,configuredDuration:duration,remainingMs:duration*(unit==='minutes'?60000:1000)};
        const kids = (await warmSmartExportCache([it],true)).get(it);
        const t = kids.find(c=>c.type==='text' && /left$/.test(c.text));
        ctx.font = t.font;
        out.push({w, h, text:t.text, bottom:t.y+t.h, px:+/(\\d+)px/.exec(t.font)[1], textW:ctx.measureText(t.text).width, boxW:t.w-12});
      }
    }
    return JSON.stringify({init, out});
  })()`));
  assert.equal(r.init.h > r.init.w, true, 'a new Timer is taller than wide, to hold the readout');
  const big = r.out[0];
  assert.equal(big.text, '45 Minutes left');
  assert.ok(big.px >= 24, `large type at the default size (${big.px}px)`);
  assert.equal(r.out[2].text, '1 Minute left', 'singular at one minute');
  assert.equal(r.out[3].text, '45 Seconds left');
  assert.equal(r.out[5].text, '1 Second left', 'singular at one second');
  for(const o of r.out){
    assert.ok(o.bottom <= o.h + 0.5, `readout inside the box at ${o.w}x${o.h}`);
    assert.ok(o.textW <= o.boxW, `"${o.text}" fits on one line at ${o.w}x${o.h} (${o.textW.toFixed(1)} <= ${o.boxW})`);
  }
}));

test('a Timer scaled down to almost nothing, or any script arc with a negative radius, renders without errors', async () => app(async ({page,run}) => {
  await run(`(async()=>{
    const script = SMART_TEMPLATES.timer.script;
    const seed = clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key==='timer').items[0]);
    const state = await requestSmartCall(seed,'initState',[]);
    const base = {type:'smart', color:'#1f2937', fillColor:'#dc2626', fill:false, strokeOn:true, textColor:'#1f2937',
      size:2, fontFamily:'sans', fontSize:12, font:fontStr('sans',12)};
    items = [
      ...[[30,36],[12,14],[4,5],[1,1]].map(([w,h],k)=>({...base, uid:'t'+k, x:40+k*60, y:40, w, h, script, componentApi:2, state:clone(state)})),
      {...base, uid:'neg', x:400, y:40, w:50, h:50,
       script:'({children(){return [{type:"polygon",closed:true,fill:true,fillColor:"#ff0000",color:"#ff0000",strokeOn:false,points:[{x:25,y:25},{x:25,y:20,arcTo:{cx:25,cy:25,r:-3,a1:0,a2:1}},{x:30,y:25}]}]}})'}];
    render();
  })()`);
  await page.waitForTimeout(400);
  await run('render()');
  const svg = await run('itemsToSVGMarkup(items)');
  assert.ok(!/A -/.test(svg), 'SVG export clamps a negative arc radius too');
}));

test('the race-start-timer example never hands a negative arc radius to the renderer, however small it is scaled', async () => app(async ({run}) => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'examples', 'race-start-timer.js'), 'utf8');
  const radii = JSON.parse(await run(`(async()=>{
    const script = ${JSON.stringify(script)};
    const state = await requestSmartCall(script, 'initState', []);
    const style = await requestSmartCall(script, 'initStyle', []) || {};
    const it = {type:'smart', color:'#1f2937', fillColor:'#dc2626', fill:false, strokeOn:true, textColor:'#1f2937',
      size:2, fontFamily:'sans', fontSize:style.fontSize||12, font:fontStr('sans', style.fontSize||12), script};
    const out = [];
    for(const [w,h] of [[40,30],[12,10],[3,2],[1,1]]){
      const kids = await requestSmartCall(script, 'children', [{...state, value:-3}, smartResolvedStyle(it), w, h, false]) || [];
      for(const k of kids) for(const p of (k.points||[])) if(p.arcTo) out.push(p.arcTo.r);
    }
    return JSON.stringify(out);
  })()`));
  assert.ok(radii.every(r=>r>=0), `no negative radius: ${JSON.stringify(radii)}`);
}));

const smartFixture = (script, state={}) => ({type:'smart',uid:'smart-test',x:100,y:100,w:180,h:180,
  color:'#000000',fillColor:'#dc2626',strokeOn:true,fill:false,textColor:'#000000',size:2,
  fontFamily:'sans',fontSize:12,font:'600 12px sans-serif',script,state});
async function importLibrary(page, library){
  await page.locator('#shapeLibraryInput').setInputFiles({name:'library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(library))});
}
const slowClickScript = `({
  children(){return [{type:'rect',x:0,y:0,w:180,h:180}];},
  handles(){return [{id:'inc',x:50,y:50,kind:'click'}];},
  hitEdit(s,x,y){const end=performance.now()+40;while(performance.now()<end){}return Math.hypot(x-50,y-50)<14?'inc':null;},
  dragEdit(s){const end=performance.now()+40;while(performance.now()<end){}return {n:(s.n||0)+1};}
})`;


async function openExport(page,run,context,{init}={}){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const file=await(await download).path(),directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'simplecanvas-html-'));
  const htmlFile=path.join(directory,'sketch.html');fs.copyFileSync(file,htmlFile);
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const preview=await context.newPage(),errors=[],requests=[];
  preview.on('pageerror',error=>errors.push(error.message));
  preview.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  if(init)await preview.addInitScript(init);
  await preview.goto(require('node:url').pathToFileURL(htmlFile).href);
  return {preview,errors,requests,source:fs.readFileSync(file,'utf8')};
}
async function exportedPoint(host,x,y,parent=false){
  return host.evaluate((el,{x,y,parent})=>{
    const p=new DOMPoint(x,y).matrixTransform((parent?el:el.firstElementChild).getScreenCTM());
    return {x:p.x,y:p.y};
  },{x,y,parent});
}
// Native pointer injection can quantize screen coordinates. Keep real browser gestures, but
// assert geometry against the events the app received using matrices captured before the drag.
async function recordExportGesture(host,gesture){
  await host.evaluate(el=>{
    const matrix=el.firstElementChild.getScreenCTM(),inverse=matrix.inverse();
    const state={down:null,latest:null,up:null};
    const record=event=>{
      const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(inverse);
      const sample={screen:{x:event.clientX,y:event.clientY},local:{x:point.x,y:point.y}};
      if(event.type==='pointerdown'){state.down=sample;state.latest=null;}
      else if(state.down)state[event.type==='pointermove'?'latest':'up']=sample;
    };
    const types=['pointerdown','pointermove','pointerup'];
    for(const type of types)window.addEventListener(type,record,true);
    el.__testGesture={state,stop:()=>{for(const type of types)window.removeEventListener(type,record,true);}};
  });
  try{
    await gesture();
    const result=await host.evaluate(el=>el.__testGesture.state);
    assert.ok(result.down,'the gesture must deliver a pointerdown');
    const end=result.up||result.latest||result.down;
    return {...result,end,screenDelta:{x:end.screen.x-result.down.screen.x,y:end.screen.y-result.down.screen.y},
      localDelta:{x:end.local.x-result.down.local.x,y:end.local.y-result.down.local.y}};
  }finally{await host.evaluate(el=>{el.__testGesture.stop();delete el.__testGesture;});}
}
function gestureRotation(gesture,w,h){
  const end=gesture.latest||gesture.end,start=gesture.down;
  const delta=Math.atan2(end.local.y-h/2,end.local.x-w/2)-Math.atan2(start.local.y-h/2,start.local.x-w/2);
  return Math.atan2(Math.sin(delta),Math.cos(delta));
}
function rotatedPoint(point,center,angle){
  const dx=point.x-center.x,dy=point.y-center.y,c=Math.cos(angle),s=Math.sin(angle);
  return {x:center.x+c*dx-s*dy,y:center.y+s*dx+c*dy};
}
async function exportClick(preview,host,x,y){const p=await exportedPoint(host,x,y);await preview.mouse.click(p.x,p.y);}
async function exportDrag(preview,host,x,y,dx,dy,release=true){
  const a=await exportedPoint(host,x,y),b=await exportedPoint(host,x+dx,y+dy);
  const gesture=await recordExportGesture(host,async()=>{
    await preview.mouse.move(a.x,a.y);await preview.mouse.down();
    await preview.mouse.move(b.x,b.y,{steps:5});if(release)await preview.mouse.up();
  });
  assert.ok(gesture.latest,'drag must deliver a pointermove');
  if(release)assert.ok(gesture.up,'released drag must deliver a pointerup');
  assert.ok(Math.abs(gesture.end.screen.x-b.x)<=1 && Math.abs(gesture.end.screen.y-b.y)<=1,'drag reaches the requested screen endpoint within one CSS pixel');
  return gesture;
}
async function exportRotate(preview,host,w,h,angle,release=true){
  const radius=h/2+30,a=await exportedPoint(host,w/2,-30);
  const b=await exportedPoint(host,w/2+Math.sin(angle)*radius,h/2-Math.cos(angle)*radius);
  const gesture=await recordExportGesture(host,async()=>{
    await preview.mouse.move(a.x,a.y);await preview.mouse.down();await preview.mouse.move(b.x,b.y,{steps:6});
    if(release)await preview.mouse.up();
  });
  assert.ok(gesture.latest,'rotation must deliver a pointermove');
  if(release)assert.ok(gesture.up,'released rotation must deliver a pointerup');
  assert.ok(Math.abs(gesture.end.screen.x-b.x)<=1 && Math.abs(gesture.end.screen.y-b.y)<=1,'rotation reaches the requested screen endpoint within one CSS pixel');
  return gesture;
}

test('HTML smart shapes run offline with live timing, direct ordered controls and a locked layout',async()=>app(async({page,run,context})=>{
  // Keep this refresh-only/API1 fixture inert in saved state. API2 Live Clock
  // deliberately publishes durable time and pulses and has its own connection tests.
  const clockScript=`({refreshMs(){return 1000;},children(s,style,w,h){return [{type:'text',x:0,y:0,w,h,text:new Date().toISOString(),strokeOn:false}];}})`;
  const stopwatch=await run(`(async()=>{
    const sw={...${JSON.stringify(smartFixture(''))},script:SMART_TEMPLATES.stopwatch.script};await initializeSmartItem(sw);
    items=[sw,{...${JSON.stringify(smartFixture(clockScript))},uid:'refresh-clock',x:500,h:208}];
    setTool('select');selection=[];render();save();return sw;
  })()`);
  const before=await run('JSON.stringify({items,undoStack,redoStack,storage:{...localStorage}})');
  const {preview,errors,requests}=await openExport(page,run,context,{init:()=>{
    // Force early callbacks, as can occur naturally when browsers round fractional delays.
    const timeout=window.setTimeout.bind(window);
    window.setTimeout=(fn,delay,...args)=>timeout(fn,delay>10?delay-2:delay,...args);
  }});
  const sw=preview.locator('[data-smart-index="0"]'),clock=preview.locator('[data-smart-index="1"]');
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===2);
  assert.match(await sw.textContent(),/Start.*Reset/,'operating buttons are visible immediately');
  const firstClock=await clock.textContent();
  await preview.waitForFunction(first=>document.querySelector('[data-smart-index="1"]').textContent!==first,firstClock);
  await exportClick(preview,sw,stopwatch.w/4,stopwatch.h*.86);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').textContent.includes('Pause'));
  await preview.waitForFunction(()=>!document.querySelector('[data-smart-index="0"]').textContent.includes('00:00:00.000'));
  await exportClick(preview,sw,stopwatch.w/4,stopwatch.h*.86);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').textContent.includes('Start'));
  const paused=await sw.textContent();await preview.waitForTimeout(250);assert.equal(await sw.textContent(),paused);
  // Quick released clicks still execute in order. Reset, Start, Pause must end stopped.
  await exportClick(preview,sw,stopwatch.w*.75,stopwatch.h*.86);
  await exportClick(preview,sw,stopwatch.w/4,stopwatch.h*.86);await exportClick(preview,sw,stopwatch.w/4,stopwatch.h*.86);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').textContent.includes('Start'));
  const box=await sw.boundingBox();await exportDrag(preview,sw,20,20,60,40);await preview.waitForTimeout(100);
  assert.deepEqual(await sw.boundingBox(),box,'the body cannot be moved');
  assert.equal(await sw.locator('[data-resize-width]').count(),0,'no regular resize controls');
  assert.equal(await sw.locator('[data-resize-height],[data-rotate]').count(),0,'rotation and height resizing also default off');
  assert.equal(await run('JSON.stringify({items,undoStack,redoStack,storage:{...localStorage}})'),before,'export interactions never edit the source workspace');
  assert.deepEqual(requests,[],'the downloaded file needs no server or network');assert.deepEqual(errors,[]);
}));

test('ruler author controls bind moving and rotation; HTML extends opted-in instances at fixed scale',async()=>app(async({page,run,context})=>{
  await run(`(async()=>{const ruler={...${JSON.stringify(smartFixture(''))},script:SMART_TEMPLATES.ruler.script};await initializeSmartItem(ruler);
    items=[ruler];setTool('select');selection=[0];editingSmartIdx=0;render();save();})()`);
  await page.waitForFunction(()=>__test.run("smartHandlesCache.get('smart-test')?.hs.length")===3);
  const shape=await run('items[0]'),canvas=await page.locator('#canvas').boundingBox();
  for(const x of [shape.w/4,shape.w*.75]){
    await page.mouse.click(canvas.x+shape.x+x,canvas.y+shape.y+shape.h+18);await run('smartHitSettled');
  }
  assert.deepEqual(await run('items[0].state'),{unit:'cm',allowMove:true,allowExtend:true});
  await run('undo()');assert.equal(await run('items[0].state.allowExtend'),false);await run('redo()');
  const saved=await downloadedJSON(page,run,'exportProject()');assert.equal(saved.items[0].state.allowExtend,true);
  await page.reload();
  await run(`items.push({...clone(items[0]),uid:'locked',x:650,state:{unit:'cm'}});items[0].rotation=.2;
    items[0].group='rotated';items[0].groupRotation=.3;items.push({...${JSON.stringify(rectangle('sibling'))},x:200,y:300,group:'rotated',groupRotation:.3});render();`);
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===2);
  const ruler=preview.locator('[data-smart-index="0"]'),locked=preview.locator('[data-smart-index="1"]');
  assert.doesNotMatch(await ruler.textContent(),/HTML: move|HTML: extend/);
  assert.equal(await locked.locator('[data-resize-width]').count(),0);
  assert.equal(await locked.locator('[data-rotate]').count(),0);
  assert.equal(await ruler.locator('[data-rotate]').count(),1,'one ruler toggle enables both moving and rotation');
  assert.equal(await ruler.locator('[data-rotate]').isVisible(),false,'rotation starts hidden');
  assert.equal(await ruler.locator('[data-resize-height]').count(),0,'the ruler does not enable height resizing');
  const lockedBox=await locked.boundingBox();await exportDrag(preview,locked,50,40,35,20);await preview.waitForTimeout(100);
  assert.deepEqual(await locked.boundingBox(),lockedBox);
  await exportClick(preview,ruler,50,40);assert.equal(await ruler.locator('[data-rotate]').isVisible(),true);
  await preview.mouse.click(20,20);assert.equal(await ruler.locator('[data-rotate]').isVisible(),false,'clicking the page clears selection');
  await exportClick(preview,ruler,50,40);await exportClick(preview,locked,50,40);
  assert.equal(await ruler.locator('[data-rotate]').isVisible(),false,'clicking another shape clears the old selection');
  await exportClick(preview,ruler,50,40);await preview.keyboard.press('Escape');
  assert.equal(await ruler.locator('[data-rotate]').isVisible(),false,'Escape clears selection');
  const initial=await exportedPoint(ruler,0,0);
  const movement=await exportDrag(preview,ruler,50,40,45,20);
  const destination={x:initial.x+movement.screenDelta.x,y:initial.y+movement.screenDelta.y};
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"]>g').getAttribute('transform')!=='translate(100 100)');
  const moved=await exportedPoint(ruler,0,0);assert.ok(Math.abs(moved.x-destination.x)<.1 && Math.abs(moved.y-destination.y)<.1,'rotated body follows the pointer');
  const oldWidth=+(await ruler.locator('rect[pointer-events="all"]').getAttribute('width'));
  const extension=await exportDrag(preview,ruler,oldWidth,shape.h/2,96,0);
  const expectedWidth=oldWidth+extension.localDelta.x;
  await preview.waitForFunction(w=>Math.abs(+document.querySelector('[data-smart-index="0"] rect[pointer-events="all"]').getAttribute('width')-w)<.1,expectedWidth);
  const newWidth=+(await ruler.locator('rect[pointer-events="all"]').getAttribute('width'));
  assert.ok(Math.abs(newWidth-expectedWidth)<.1);
  assert.equal(await ruler.locator('rect[pointer-events="all"]').getAttribute('height'),String(shape.h));
  const tickPositions=await ruler.locator('rect').evaluateAll(rects=>rects.filter(r=>+r.getAttribute('y')>45 && +r.getAttribute('height')<23 && +r.getAttribute('height')>0)
    .map(r=>+r.getAttribute('x') + +r.getAttribute('width')/2));
  assert.ok(tickPositions.length>100);assert.ok(Math.abs(tickPositions[3]-tickPositions[2]-96/25.4)<.001,'extension retains millimeter spacing');
  const center=await exportedPoint(ruler,newWidth/2,shape.h/2),edge=await exportedPoint(ruler,0,0);
  const rotation=await exportRotate(preview,ruler,newWidth,shape.h,Math.PI/2);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"]>g').getAttribute('transform').includes('rotate('));
  const turnedCenter=await exportedPoint(ruler,newWidth/2,shape.h/2),turnedEdge=await exportedPoint(ruler,0,0);
  assert.ok(Math.hypot(turnedCenter.x-center.x,turnedCenter.y-center.y)<.1,'rotation keeps the ruler center fixed');
  const expectedEdge=rotatedPoint(edge,center,gestureRotation(rotation,newWidth,shape.h));
  assert.ok(Math.hypot(turnedEdge.x-expectedEdge.x,turnedEdge.y-expectedEdge.y)<.1);
  const rotatedExtension=await exportDrag(preview,ruler,newWidth,shape.h/2,60,0);
  const extendedWidth=newWidth+rotatedExtension.localDelta.x;
  await preview.waitForFunction(w=>Math.abs(+document.querySelector('[data-smart-index="0"] rect[pointer-events="all"]').getAttribute('width')-w)<.1,extendedWidth);
  const extendedEdge=await exportedPoint(ruler,0,0);
  assert.ok(Math.hypot(extendedEdge.x-turnedEdge.x,extendedEdge.y-turnedEdge.y)<.1,'extending after rotation anchors the left edge');
  await exportClick(preview,ruler,extendedWidth-44,11);await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').textContent.includes('inch'));
  assert.ok(await ruler.locator('[data-resize-width]').count());assert.ok(initial.x!==moved.x);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
}));

test('HTML uses static script permissions, filters editor-only controls and handles, and retains tab instance state',async()=>app(async({page,run,context})=>{
  const script=`({exportBehavior:{move:true,resizeWidth:false},
    children(s,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#ffd166'},
      {type:'text',x:0,y:0,w,h:30,text:String(s.n||0),strokeOn:false},
      {type:'text',x:0,y:50,w,h:30,text:'AUTHOR ONLY',editorOnly:true}];},
    handles(){return [{id:'inc',x:40,y:20,kind:'click'},{id:'author',x:40,y:65,kind:'click',editorOnly:true}];},
    hitEdit(s,x,y){return y<40?'inc':y<90?'author':null;},
    dragEdit(s,id){return {n:(s.n||0)+(id==='inc'?1:100)};}})`;
  await run(`items=[${JSON.stringify(smartFixture(script))}];save();newTab();items=[${JSON.stringify(smartFixture(script,{n:9}))}];render();save();`);
  const snapshot=await run('itemsToSVGMarkup(items)');assert.doesNotMatch(snapshot,/AUTHOR ONLY/,'even unconditional author children stay out of static exports');
  const {preview,errors}=await openExport(page,run,context);
  const panels=preview.locator('.tab-panel'),first=panels.nth(0).locator('[data-smart-index]'),second=panels.nth(1).locator('[data-smart-index]');
  await preview.waitForFunction(()=>document.querySelector('.tab-panel [data-smart-ready="true"]'));
  assert.equal(await first.locator('[data-rotate]').count(),0,'move permission alone does not implicitly grant rotation');
  assert.equal(await first.textContent(),'0');await exportClick(preview,first,40,20);
  await preview.waitForFunction(()=>document.querySelector('.tab-panel [data-smart-index]').textContent==='1');
  await exportClick(preview,first,40,65);await preview.waitForTimeout(100);assert.equal(await first.textContent(),'1','author-only handles never run');
  const start=await exportedPoint(first,0,0),end=await exportedPoint(first,30,25);
  await exportDrag(preview,first,60,110,30,25);await preview.waitForTimeout(100);
  const moved=await exportedPoint(first,0,0);assert.ok(Math.abs(moved.x-end.x)<.1 && Math.abs(moved.y-end.y)<.1);assert.notEqual(start.x,moved.x);
  await preview.locator('.tab-select').nth(1).click();
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===2);
  assert.equal(await second.textContent(),'9');await exportClick(preview,second,40,20);
  await preview.waitForFunction(()=>document.querySelectorAll('.tab-panel [data-smart-index]')[1].textContent==='10');
  await preview.locator('.tab-select').nth(0).click();assert.equal(await first.textContent(),'1');assert.deepEqual(await exportedPoint(first,0,0),moved);
  assert.deepEqual(errors,[]);
}));

test('HTML rotation and height resizing work independently of movement and width, cancel cleanly, and survive tab switches',async()=>app(async({page,run,context})=>{
  const script=`({exportBehavior:{rotate:true,resizeHeight:true},
    children(s,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#dbeafe'},
      {type:'text',x:0,y:0,w,h:30,text:String(s.n||0),strokeOn:false}];},
    handles(){return [{id:'inc',x:40,y:40,kind:'click'}];},
    hitEdit(s,x,y){return Math.hypot(x-40,y-40)<14?'inc':null;},
    dragEdit(s){return {n:(s.n||0)+1};}})`;
  await run(`items=[{...${JSON.stringify(smartFixture(script))},x:350,y:220,h:100,rotation:.25}];save();newTab();items=[${JSON.stringify(rectangle())}];render();save();`);
  const {preview,errors}=await openExport(page,run,context),shape=preview.locator('.tab-panel').nth(0).locator('[data-smart-index="0"]');
  await preview.waitForFunction(()=>document.querySelector('[data-smart-ready="true"]'));
  assert.equal(await shape.locator('[data-resize-width]').count(),0);
  const origin=await exportedPoint(shape,0,0);await exportDrag(preview,shape,70,70,30,20);await preview.waitForTimeout(100);
  assert.deepEqual(await exportedPoint(shape,0,0),origin,'rotation permission does not grant body movement');
  const center=await exportedPoint(shape,90,50),corner=await exportedPoint(shape,0,0);
  const rotation=await exportRotate(preview,shape,180,100,Math.PI/2);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"]>g').getAttribute('transform').includes('rotate('));
  const rotatedCorner=await exportedPoint(shape,0,0);
  const expectedCorner=rotatedPoint(corner,center,gestureRotation(rotation,180,100));
  assert.ok(Math.hypot(rotatedCorner.x-expectedCorner.x,rotatedCorner.y-expectedCorner.y)<.1);
  const transform=await shape.locator(':scope>g').getAttribute('transform');
  await exportRotate(preview,shape,180,100,Math.PI/4,false);
  await preview.waitForFunction(t=>document.querySelector('[data-smart-index="0"]>g').getAttribute('transform')!==t,transform);
  await preview.keyboard.press('Escape');await preview.mouse.up();
  assert.equal(await shape.locator(':scope>g').getAttribute('transform'),transform,'Escape restores rotation');
  const resize=await exportDrag(preview,shape,90,100,0,50),height=100+resize.localDelta.y;
  await preview.waitForFunction(h=>Math.abs(+document.querySelector('[data-smart-index="0"] rect[pointer-events="all"]').getAttribute('height')-h)<.1,height);
  assert.equal(await shape.locator('rect[pointer-events="all"]').getAttribute('width'),'180');
  const resizedCorner=await exportedPoint(shape,0,0);
  assert.ok(Math.hypot(resizedCorner.x-rotatedCorner.x,resizedCorner.y-rotatedCorner.y)<.1,'height resizing after rotation anchors the top edge');
  const pendingResize=await exportDrag(preview,shape,90,height,0,30,false);
  await preview.waitForFunction(h=>Math.abs(+document.querySelector('[data-smart-index="0"] rect[pointer-events="all"]').getAttribute('height')-h)<.1,height+pendingResize.localDelta.y);
  await preview.keyboard.press('Escape');await preview.mouse.up();
  await preview.waitForFunction(h=>Math.abs(+document.querySelector('[data-smart-index="0"] rect[pointer-events="all"]').getAttribute('height')-h)<.1,height);
  await exportClick(preview,shape,40,40);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"] text').textContent==='1');
  const retained=await shape.locator(':scope>g').getAttribute('transform');
  await preview.locator('.tab-select').nth(1).click();await preview.locator('.tab-select').nth(0).click();
  assert.equal(await shape.locator(':scope>g').getAttribute('transform'),retained);
  assert.equal(await shape.locator('[data-rotate]').isVisible(),false,'tab switches clear selection while keeping transforms');
  assert.ok(Math.abs(+(await shape.locator('rect[pointer-events="all"]').getAttribute('height'))-height)<.1);
  assert.deepEqual(errors,[]);
}));

test('editor and HTML Shift-rotation snap to absolute 15-degree steps, including pre-rotated groups',async()=>app(async({page,run,context})=>{
  await run(`items=[{...${JSON.stringify(rectangle())},rotation:20*Math.PI/180}];setTool('select');selection=[0];render();`);
  const pivot=await run(`rotationPivotFor(selection)`),canvas=await page.locator('#canvas').boundingBox();
  const radius=pivot.cy-pivot.handleY;
  await page.mouse.move(canvas.x+pivot.cx+Math.sin(pivot.rotation)*radius,canvas.y+pivot.cy-Math.cos(pivot.rotation)*radius);
  await page.mouse.down();await page.keyboard.down('Shift');
  await page.mouse.move(canvas.x+pivot.cx+Math.sin(38*Math.PI/180)*radius,canvas.y+pivot.cy-Math.cos(38*Math.PI/180)*radius,{steps:5});
  assert.ok(Math.abs(await run('items[0].rotation')-Math.PI/4)<1e-6,'the editor snaps 38 degrees to 45 degrees');
  await page.keyboard.up('Shift');await page.mouse.up();
  assert.ok(Math.abs(await run('items[0].rotation')-Math.PI/4)<1e-6,'releasing Shift without moving retains the editor angle');

  const script=`({exportBehavior:{rotate:true},children(s,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#dbeafe'}];}})`;
  await run(`items=[{...${JSON.stringify(smartFixture(script))},x:350,y:220,rotation:20*Math.PI/180,group:'snap',groupRotation:15*Math.PI/180},
    {...${JSON.stringify(rectangle('sibling'))},x:650,group:'snap',groupRotation:15*Math.PI/180}];selection=[];render();`);
  const {preview,errors}=await openExport(page,run,context),shape=preview.locator('[data-smart-index="0"]');
  await preview.waitForFunction(()=>document.querySelector('[data-smart-ready="true"]'));
  const angle=()=>shape.evaluate(el=>{const m=el.firstElementChild.getScreenCTM();return Math.atan2(m.b,m.a)*180/Math.PI;});
  assert.ok(Math.abs(await angle()-35)<1e-4,'the export starts with the combined own and group rotation');
  await exportClick(preview,shape,90,90);
  await preview.keyboard.down('Shift');await exportRotate(preview,shape,180,180,3*Math.PI/180,false);
  assert.ok(Math.abs(await angle()-45)<1e-4,'HTML snaps the visible 38-degree angle to 45, rather than snapping its drag delta');
  await preview.keyboard.up('Shift');await preview.mouse.up();
  assert.ok(Math.abs(await angle()-45)<1e-4,'pointerup keeps the last snapped angle when Shift has been released');
  const freeRotation=await exportRotate(preview,shape,180,180,-7*Math.PI/180);
  const freeAngle=45+gestureRotation(freeRotation,180,180)*180/Math.PI;
  assert.ok(Math.abs(await angle()-freeAngle)<1e-4,'rotation follows the received pointer without Shift');
  await preview.keyboard.down('Shift');await exportClick(preview,shape,90,-30);await preview.keyboard.up('Shift');
  assert.ok(Math.abs(await angle()-freeAngle)<1e-4,'a stationary handle click does not change the angle');
  await preview.keyboard.down('Shift');await exportRotate(preview,shape,180,180,-76*Math.PI/180);await preview.keyboard.up('Shift');
  assert.ok(Math.abs(await angle()+45)<1e-4,'negative angles use the same absolute snapping grid');
  await preview.keyboard.down('Shift');await exportRotate(preview,shape,180,180,43*Math.PI/180);await preview.keyboard.up('Shift');
  assert.ok(Math.abs(await angle())<1e-4,'snapping also crosses zero cleanly');
  assert.deepEqual(errors,[]);
}));

test('HTML scripted drags use rotated local coordinates, coalesce replies, and cancel cleanly; touch clicks work',async()=>app(async({page,run,context})=>{
  const script=`({children(s,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#ffffff'},
    {type:'text',x:0,y:0,w,h:35,text:String(s.value||50),strokeOn:false}];},
    handles(){return [{id:'value',x:50,y:60}];},
    hitEdit(s,x,y){return Math.hypot(x-50,y-60)<14?'value':null;},
    dragEdit(s,id,x){const end=performance.now()+35;while(performance.now()<end){}return {value:Math.round(x)};}})`;
  await run(`items=[{...${JSON.stringify(smartFixture(script,{value:50}))},rotation:.35}];render();`);
  const {preview,errors}=await openExport(page,run,context),shape=preview.locator('[data-smart-index="0"]');
  await preview.waitForFunction(()=>document.querySelector('[data-smart-ready="true"]'));
  const box=await shape.boundingBox(),drag=await exportDrag(preview,shape,50,60,70,25);
  const value=String(Math.round(drag.end.local.x));
  await preview.waitForFunction(value=>document.querySelector('[data-smart-index]').textContent===value,value);
  assert.deepEqual(await shape.boundingBox(),box,'dragging a scripted control changes state, not the container');
  const pendingDrag=await exportDrag(preview,shape,50,60,40,20,false);
  await preview.waitForFunction(value=>document.querySelector('[data-smart-index]').textContent===value,String(Math.round(pendingDrag.latest.local.x)));
  await preview.keyboard.press('Escape');await preview.mouse.up();
  await preview.waitForFunction(value=>document.querySelector('[data-smart-index]').textContent===value,value);
  const frozen=await shape.textContent();
  await preview.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await preview.waitForTimeout(100);assert.equal(await shape.textContent(),frozen);
  await preview.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  const resumedDrag=await exportDrag(preview,shape,50,60,30,0);
  await preview.waitForFunction(value=>document.querySelector('[data-smart-index]').textContent===value,String(Math.round(resumedDrag.end.local.x)));
  assert.deepEqual(errors,[]);
  // Use the same file and runtime on a touch device. Taps need no double-tap edit gesture.
  const touch=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true});
  try{
    const tp=await touch.newPage();await tp.goto(preview.url());
    await tp.waitForFunction(()=>document.querySelector('[data-smart-ready="true"]'));
    const touchShape=tp.locator('[data-smart-index]'),handle=await exportedPoint(touchShape,60,60);
    const tap=await recordExportGesture(touchShape,()=>tp.touchscreen.tap(handle.x,handle.y));
    await tp.waitForFunction(value=>document.querySelector('[data-smart-index]').textContent===value,String(Math.round(tap.down.local.x)));
  }finally{await touch.close();}
}));

test('HTML isolates hostile or hung scripts, preserves frozen fallback, and escapes embedded source and state',async()=>app(async({page,run,context})=>{
  const attack="</script><script>window.exportEscaped=true</script> $& $` $'";
  const hostile=`({children(s,style,w,h){return [{type:'text',x:0,y:0,w,h,text:s.text+' '+typeof document+' '+typeof fetch,strokeOn:false}];}})`;
  const hang=`({children(s,style,w,h,editing){if(editing)while(true){}return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#22c55e'}];}})`;
  await run(`(async()=>{
    const clock={...${JSON.stringify(smartFixture(''))},uid:'clock',script:SMART_TEMPLATES.liveClock.script,x:700};
    await initializeSmartItem(clock);
    items=[${JSON.stringify(smartFixture(hostile,{text:attack}))},{...${JSON.stringify(smartFixture(hang))},uid:'hang',x:400},clock];render();
  })()`);
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===2);
  assert.equal(await preview.evaluate(()=>window.exportEscaped),undefined);
  const text=await preview.locator('[data-smart-index="0"]').textContent();assert.equal(text.replace(/\s/g,''),(attack+' undefined undefined').replace(/\s/g,''));
  assert.equal(await preview.locator('[data-smart-index="1"] rect').getAttribute('fill'),'#22c55e','a failed live rendering retains the static drawing');
  const clock=preview.locator('[data-smart-index="2"]'),first=await clock.textContent();
  await preview.waitForFunction(first=>document.querySelector('[data-smart-index="2"]').textContent!==first,first);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
}));

test('cached smart drawings follow moves, rotations, state, style and size edits in canvas and SVG',async()=>app(async({page,run,context})=>{
  const script='/*'+'long source '.repeat(2800)+'*/'+`({children(s,style,w,h,editing){return [
    {type:'rect',x:s.offset||0,y:0,w,h,fill:true,fillColor:editing?'#0000ff':style.color,strokeOn:false}];}})`;
  await run(`items=[{...${JSON.stringify(smartFixture(script))},w:80,h:60,color:'#ff0000'}];setTool('select');selection=[];render();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.has('smart-test')"));
  const pixel=(x,y)=>run(`Array.from(ctx.getImageData(${x}*dpr,${y}*dpr,1,1).data).slice(0,3)`);
  assert.deepEqual(await pixel(120,120),[255,0,0]);
  await run('items[0].x=300;items[0].y=200;items[0].rotation=Math.PI/2;render()');
  assert.deepEqual(await pixel(340,230),[255,0,0],'position-only edits translate the cached local drawing');
  assert.notDeepEqual(await pixel(120,120),[255,0,0],'moving does not leave the previous drawing behind');
  const preview=await context.newPage();
  await preview.setContent(await run('itemsToSVGMarkup(items,{width:700,height:500,background:false})'));
  assert.deepEqual(await preview.locator('rect[fill="#ff0000"]').evaluate(rect=>{
    const p=new DOMPoint(rect.x.baseVal.value+rect.width.baseVal.value/2,rect.y.baseVal.value+rect.height.baseVal.value/2).matrixTransform(rect.getCTM());
    return {x:p.x,y:p.y};
  }),{x:340,y:230},'SVG transforms place the local drawing at the same world coordinates');
  await run("items[0].rotation=0;items[0].state.offset=-20;items[0].color='#00ff00';items[0].w=100;items[0].h=80;render()");
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.kids[0]?.w===100"));
  assert.deepEqual(await pixel(310,220),[0,255,0],'in-place state and style edits refresh geometry and colors');
  assert.notDeepEqual(await pixel(390,220),[0,255,0],'new local bounds replace the old cached bounds');
  await run('selection=[0];editingSmartIdx=0;render()');
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.kids[0]?.fillColor==='#0000ff'"));
  assert.deepEqual(await pixel(310,220),[0,0,255],'editing children replace the non-editing drawing');
  const exported=await run('itemsToSVGMarkup(items)');
  assert.ok(exported.includes('#00ff00') && !exported.includes('#0000ff'),'export uses non-editing children');
  const pngColor=await run(`(async()=>{
    const im=await createImageBitmap(await itemsToPngBlob(items,{background:false,margin:0,scale:1}));
    const c=document.createElement('canvas');c.width=im.width;c.height=im.height;
    const x=c.getContext('2d');x.drawImage(im,0,0);return Array.from(x.getImageData(30,20,1,1).data).slice(0,3);
  })()`);
  assert.deepEqual(pngColor,[0,255,0],'PNG also uses the fresh export drawing');
  await run('render()');
  assert.deepEqual(await pixel(310,220),[0,0,255],'an export cannot replace the active edit-mode drawing');
}));

test('finishing many previews preserves the focused library entry without removing tiles',async()=>app(async({page,run})=>{
  await run(`
    const c=document.createElement('canvas');c.width=c.height=128;const png=c.toDataURL();
    window.releasePreviews=[];
    createShapeThumbnail=()=>new Promise(resolve=>window.releasePreviews.push(()=>resolve(png)));
    shapeLibrary=normalizeShapeLibrary({shapes:Array.from({length:40},(_,i)=>({name:'Box '+i,items:[${JSON.stringify(rectangle())}]}))});
    setShapePicker(true);
  `);
  await page.getByRole('button',{name:'Place Box 0',exact:true}).focus();
  await page.evaluate(()=>{
    window.removedPreviewTiles=0;
    new MutationObserver(records=>records.forEach(r=>window.removedPreviewTiles+=r.removedNodes.length))
      .observe(document.querySelector('#shapeGrid'),{childList:true});
  });
  await page.evaluate(()=>window.releasePreviews.forEach(release=>release()));
  await page.waitForFunction(()=>document.querySelectorAll('.shape-thumb img').length===40);
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Place Box 0','a finishing preview does not interrupt keyboard/touch focus');
  assert.equal(await page.evaluate(()=>window.removedPreviewTiles),0,'preview completion only replaces its image, not other entries');
  const library=await downloadedJSON(page,run,'exportShapeLibrary()');
  assert.equal(library.shapes.filter(t=>t.thumbnail?.version===1).length,40);
  assert.equal(await run('shapeLibraryDirty'),false);
}));

test('an edited preview supersedes an in-flight job even when the script changes back',async()=>app(async({page,run})=>{
  const first='({children(){return [{type:"rect",x:0,y:0,w:100,h:100,fill:true,fillColor:"#ff0000"}];}})';
  const second=first.replace('#ff0000','#00ff00');
  await run(`
    const create=createShapeThumbnail;window.previewStarted=0;window.finishOldPreview=null;
    createShapeThumbnail=list=>{
      if(window.previewStarted++===0)return new Promise(resolve=>window.finishOldPreview=resolve);
      return create(list);
    };
    shapeLibrary=normalizeShapeLibrary({shapes:[{name:'Changing',items:[${JSON.stringify(smartFixture(first))}]}]});
    smartPreviewConsent.add(shapeLibrary.shapes[0]);setShapePicker(true);
    const tpl=shapeLibrary.shapes[0];
    tpl.items[0].script=${JSON.stringify(second)};invalidateShapePreview(tpl);
    tpl.items[0].script=${JSON.stringify(first)};invalidateShapePreview(tpl);
  `);
  const exporting=downloadedJSON(page,run,'exportShapeLibrary()');
  await page.evaluate(()=>window.finishOldPreview('data:image/png;base64,STALE'));
  const library=await exporting;
  assert.equal(await page.evaluate(()=>window.previewStarted),2,'the obsolete job is discarded and a fresh preview is generated');
  assert.notEqual(library.shapes[0].thumbnail.png,'data:image/png;base64,STALE','export waits for the replacement preview');
  await page.waitForFunction(()=>document.querySelector('.shape-thumb img')?.naturalWidth===128);
  assert.equal(await page.locator('#generateShapePreviews').isVisible(),false);
}));

test('per-instance Workers contain handler replacement and prototype tampering',async()=>app(async({run})=>{
  const handler=`(self.onmessage=e=>postMessage(JSON.stringify({id:e.data.id,ok:true,result:{owned:true}})),{children(){return [];}})`;
  const prototype=`(Object.prototype.workerPoison='attacker',{children(){return [];}})`;
  const result=await run(`(async()=>{
    const victim={script:'({children(){return [];},dragEdit(s){return {value:s.value+1,clean:!({}).workerPoison};}})'};
    const results=[];
    for(const script of ${JSON.stringify([handler,prototype])}){
      await requestSmartCall({script},'children',[]);
      results.push(await requestSmartCall(victim,'dragEdit',[{value:7}]));
    }
    return results;
  })()`);
  assert.deepEqual(result,[{value:8,clean:true},{value:8,clean:true}]);
}));

test('identical source instances do not observe each other through Worker globals',async()=>app(async({run})=>{
  const script=`({children(s){self.lastInput=s.secret;return [];},dragEdit(){return {seen:self.lastInput||'clean'};}})`;
  const result=await run(`(async()=>{
    const a={script:${JSON.stringify(script)}}, b={script:${JSON.stringify(script)}};
    await requestSmartCall(a,'children',[{secret:'instance A'}]);
    const own=await requestSmartCall(a,'dragEdit',[]),other=await requestSmartCall(b,'dragEdit',[]);
    return {own,other};
  })()`);
  assert.deepEqual(result,{own:{seen:'instance A'},other:{seen:'clean'}});
}));

test('idle malicious Workers cannot forge another owners active request with guessed IDs',async()=>app(async({run})=>{
  const attacker=`({children(){setTimeout(()=>{for(let id=1;id<50;id++)postMessage(JSON.stringify({id,owner:'instance-2',version:1,ok:true,result:{owned:true}}));},40);return [];}})`;
  const victim=`({children(){return [];},dragEdit(s){const end=performance.now()+100;while(performance.now()<end){}return {value:s.value+1};}})`;
  const result=await run(`(async()=>{
    await requestSmartCall({script:${JSON.stringify(attacker)}},'children',[]);
    return requestSmartCall({script:${JSON.stringify(victim)}},'dragEdit',[{value:7}]);
  })()`);
  assert.deepEqual(result,{value:8});
}));

test('an oversized re-encoded reply retires only its originating Worker',async()=>app(async({run})=>{
  const script=`({children(){postMessage('{"id":1,"ok":true,"result":[],"padding":"'+String.fromCharCode(0xd800).repeat(90000)+'"}');return [];}})`;
  const result=await run(`Promise.all([
    requestSmartCall({script:${JSON.stringify(script)}},'children',[]),
    requestSmartCall({script:'({children(){return [{type:"rect",x:0,y:0,w:10,h:10}];}})'},'children',[])
  ])`);
  assert.equal(result[0],null);assert.equal(result[1]?.[0]?.type,'rect','healthy queued work survives malformed owner output');
  assert.equal(await run('smartSandboxGeneration'),1,'the trusted frame was not regenerated');
}));

test('a malicious canvas instance cannot replace another shapes edit or undo history',async()=>app(async({page,run})=>{
  const attacker=`(self.onmessage=e=>postMessage(JSON.stringify({id:e.data.id,ok:true,result:{owned:true}})),{children(){return [];}})`;
  await run(`items=[{...${JSON.stringify(smartFixture(attacker))},uid:'attacker',x:500},${JSON.stringify(smartFixture(slowClickScript))}];
    setTool('select');selection=[1];editingSmartIdx=1;undoStack=[];render();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.has('attacker') && smartHandlesCache.has('smart-test')"));
  const b=await page.locator('#canvas').boundingBox();await page.mouse.click(b.x+150,b.y+150);await run('smartHitSettled');
  assert.deepEqual(await run('items[1].state'),{n:1});assert.equal(await run('undoStack.length'),1);
  await run('undo()');assert.deepEqual(await run('items[1].state'),{});
  await run('redo()');assert.deepEqual(await run('items[1].state'),{n:1});
}));

test('source replacement rejects in-flight state replies and creates a fresh execution owner',async()=>app(async({page,run})=>{
  const delayed=slowClickScript.replace('performance.now()+40;while(performance.now()<end){}return {n:',
    'performance.now()+150;while(performance.now()<end){}return {n:');
  await run(`items=[${JSON.stringify(smartFixture(delayed))}];setTool('select');selection=[0];editingSmartIdx=0;undoStack=[];render();`);
  const b=await page.locator('#canvas').boundingBox();await page.mouse.click(b.x+150,b.y+150);
  await page.waitForFunction(()=>__test.run('smartSandboxPending.get(smartSandboxActive)?.message.fn')==='dragEdit');
  await run(`items[0].script=${JSON.stringify(slowClickScript)};render();`);await run('smartHitSettled');
  assert.deepEqual(await run('items[0].state'),{});assert.equal(await run('undoStack.length'),0);
  await page.mouse.click(b.x+150,b.y+150);await run('smartHitSettled');
  assert.deepEqual(await run('items[0].state'),{n:1});
}));

test('source replacement settles a released drag so later smart gestures still run',async()=>app(async({page,run})=>{
  const script=`({children(){return [];},handles(){return [{id:'move',x:50,y:50}];},hitEdit(){return 'move';},
    dragEdit(s,id,x){const end=performance.now()+180;while(performance.now()<end){}return {value:x};}})`;
  await run(`items=[${JSON.stringify(smartFixture(script))}];setTool('select');selection=[0];editingSmartIdx=0;undoStack=[];render();`);
  const b=await page.locator('#canvas').boundingBox();
  await page.mouse.move(b.x+150,b.y+150);await page.mouse.down();
  await page.waitForFunction(()=>__test.run('smartCurrentPress?.mode')==='handle');
  await page.mouse.move(b.x+170,b.y+150);await page.mouse.up();
  await page.waitForFunction(()=>__test.run('[...smartGestureRecords].some(p=>!!p.sd?.onSettle)'));
  await run(`items[0].script=${JSON.stringify(script.replace('performance.now()+180','performance.now()+1'))};render();`);
  await page.waitForFunction(()=>__test.run('smartGestureRecords.size')===0);
  assert.deepEqual(await run('items[0].state'),{});assert.equal(await run('undoStack.length'),0);
  await page.mouse.click(b.x+150,b.y+150);await run('smartHitSettled');
  assert.deepEqual(await run('items[0].state'),{value:50});assert.equal(await run('undoStack.length'),1);
}));

test('failed non-live exports cannot borrow another instances cached drawing through a copied UID',async()=>app(async({page,run})=>{
  const script=`({children(){if(!self.privateValue)throw new Error('uninitialized realm');return [{type:'text',text:self.privateValue,x:0,y:0,w:180,h:40}];},
    dragEdit(s){self.privateValue=s.secret;return {};}})`;
  await run(`items=[${JSON.stringify(smartFixture(script))}];
    (async()=>{await requestSmartCall(items[0],'dragEdit',[{secret:'INSTANCE PRIVATE'}]);setTool('select');render();})()`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.kids[0]?.text")==='INSTANCE PRIVATE');
  const cloneExport=await run('itemsToSVGMarkup([clone(items[0])])');
  assert.ok(!cloneExport.includes('INSTANCE PRIVATE'),'a different execution owner gets no fallback from a UID collision');
  assert.ok((await run('itemsToSVGMarkup(items)')).includes('INSTANCE PRIVATE'),'the original instance still exports its own drawing');
}));

test('cancelled initialization scopes cannot continue hooks or recreate a retired Worker',async()=>app(async({page,run})=>{
  const script=`({children(){return [];},initState(){const end=performance.now()+120;while(performance.now()<end){}return {late:true};},initStyle(){return {w:900};}})`;
  await run(`window.draft={script:${JSON.stringify(script)},state:{},w:100};window.draftValid=true;
    window.draftOwner=createSmartExecution(draft,()=>draftValid);
    void (window.draftResult=initializeSmartItem(draft,null,()=>draftValid,draftOwner).then(()=>false,e=>!!e.cancelled));`);
  await page.waitForFunction(()=>__test.run('smartSandboxPending.get(smartSandboxActive)?.message.fn')==='initState');
  await run('draftValid=false;disposeSmartExecution(draftOwner)');
  assert.equal(await run('draftResult'),true);
  const created=await run('smartRuntimeStats.created');
  assert.equal(await run(`requestSmartCall(draft,'initStyle',[],draftOwner)`),null);
  assert.deepEqual(await run('draft.state'),{});assert.equal(await run('draft.w'),100);
  assert.equal(await run('smartRuntimeStats.created'),created);
}));

test('failed live children retry automatically without a user-triggered render',async()=>app(async({page,run})=>{
  const script=`({children(s){if(!s.ready)throw new Error('not ready');return [{type:'rect',x:0,y:0,w:20,h:20,fill:true,fillColor:'#22c55e'}];}})`;
  await run(`items=[${JSON.stringify(smartFixture(script))}];setTool('select');render();`);
  await page.waitForFunction(()=>__test.run("smartBackoffUntil.has('smart-test')"));
  await run('items[0].state.ready=true');
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.kids[0]?.fillColor")==='#22c55e');
  assert.equal(await run('smartRetryTimers.size'),0);
}));

test('persistent hook failures renew their backoff instead of entering a fast retry loop',async()=>app(async({page,run})=>{
  const script=`({children(){throw new Error('permanent failure');}})`;
  await run(`items=[${JSON.stringify(smartFixture(script))}];setTool('select');render();`);
  await page.waitForFunction(()=>__test.run("smartBackoffUntil.has('smart-test')"));
  const first=await run('smartSandboxReqSeq');
  await page.waitForTimeout(await run('SMART_BACKOFF_MS+250'));
  assert.equal(await run('smartSandboxReqSeq'),first+1,'only one automatic retry occurs in this window');
  assert.ok(await run("smartBackoffUntil.get('smart-test')-Date.now()")>2000,'the next backoff has a fresh deadline');
  assert.equal(await run('smartRetryTimers.size'),1);
}));

test('missing smart previews require consent; exported PNGs load without executing scripts', async()=>app(async({page,run})=>{
  const library={shapes:[{name:'Counter',items:[smartFixture(slowClickScript)]}]};
  await importLibrary(page,library);
  await page.locator('#libraryDialog[open]').waitFor();
  assert.match(await page.locator('#libraryDialogMessage').textContent(),/runs scripts/);
  // The print preview has no script permission; only the Worker bridge can execute scripts.
  assert.equal(await page.locator('iframe[sandbox~="allow-scripts"]').count(),0,'import alone must not start script execution');
  await page.locator('#libraryDialogCancel').click();
  assert.equal(await page.locator('.shape-thumb img').count(),0);
  await page.locator('#generateShapePreviewsBtn').click();
  await page.locator('#libraryDialogSubmit').click();
  await page.locator('.shape-thumb img').waitFor();
  const exported=await downloadedJSON(page,run,'exportShapeLibrary()');
  assert.match(exported.shapes[0].thumbnail.png,/^data:image\/png;base64,/);
  assert.equal(exported.shapes[0].thumbnail.version,1);
  await contextFresh(exported);
  async function contextFresh(data){
    await page.reload();
    await importLibrary(page,data);
    await page.locator('.shape-thumb img').waitFor();
    assert.equal(await page.locator('#libraryDialog[open]').count(),0);
    assert.equal(await page.locator('iframe[sandbox~="allow-scripts"]').count(),0,'bundled PNG must not run the smart script');
    const unchanged=await downloadedJSON(page,run,'exportShapeLibrary()');
    assert.equal(unchanged.shapes[0].thumbnail.png,data.shapes[0].thumbnail.png);
    const changed=JSON.parse(JSON.stringify(data));changed.shapes[0].items[0].state={group:2};
    await importLibrary(page,changed);
    await page.locator('#libraryDialog[open]').waitFor();
    assert.equal(await page.locator('.shape-thumb img').count(),0,'all script state participates in preview invalidation');
    assert.equal(await page.locator('iframe[sandbox~="allow-scripts"]').count(),0,'a stale PNG requires fresh consent');
    await page.locator('#libraryDialogCancel').click();
  }
}));

const demoLibrary = fs.readFileSync(path.join(__dirname,'..','examples','demo-shapes-library.json'),'utf8');
const demoShapeCount = JSON.parse(demoLibrary).shapes.length;
const settingsFile=features=>JSON.stringify({version:1,features});

test('optional smart refresh redraws without changing state, history or saves, and follows document visibility and lifetime',async()=>app(async({page,run})=>{
  const script=`({refreshMs(){return 100;},children(){return [{type:'text',x:0,y:0,w:180,h:30,text:String(Date.now())}];}})`;
  await run(`items=[${JSON.stringify(smartFixture(script,{keep:'saved'}))}];setTool('select');selection=[];save();render();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.kids.length")===1);
  const first=await run(`({reading:smartChildrenCache.get('smart-test').kids[0].text,
    saved:localStorage.getItem(docKey(activeTabId)),history:undoStack.length,tab:activeTabId})`);
  await page.waitForFunction(first=>__test.run("smartChildrenCache.get('smart-test')?.kids[0]?.text")!==first,first.reading);
  assert.equal(await run('localStorage.getItem(docKey(activeTabId))'),first.saved);
  assert.deepEqual(await run('items[0].state'),{keep:'saved'});assert.equal(await run('undoStack.length'),first.history);
  await run('newTab()');
  assert.equal(await run('smartRefreshTimer'),null);assert.equal(await run('smartChildrenCache.size'),0);
  await run(`activateTab(${JSON.stringify(first.tab)})`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.kids.length")===1);
  await run(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));`);
  await page.waitForFunction(()=>__test.run('smartInFlight.size')===0);
  const hidden=await run("({requests:smartSandboxReqSeq,reading:smartChildrenCache.get('smart-test').kids[0].text})");
  await page.waitForTimeout(250);
  assert.equal(await run('smartSandboxReqSeq'),hidden.requests,'hidden documents stop refreshing');
  assert.equal(await run('smartRefreshTimer'),null);
  await run(`Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));`);
  await page.waitForFunction(first=>__test.run("smartChildrenCache.get('smart-test')?.kids[0]?.text")!==first,hidden.reading);
  await run('selection=[0];deleteSelected()');
  assert.equal(await run('smartRefreshTimer'),null);assert.equal(await run('smartChildrenCache.size'),0);
}));

test('refresh intervals are bounded and invalid requests keep a static, valid drawing',async()=>app(async({page,run})=>{
  const script=`({refreshMs(s){return s.interval==='nonfinite'?Infinity:s.interval;},children(){return [{type:'rect',x:0,y:0,w:30,h:30,fill:true,fillColor:'#22c55e'}];}})`;
  await run(`items=[${JSON.stringify(smartFixture(script,{interval:1}))}];setTool('select');selection=[];render();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.refreshMs")===100);
  await run('items[0].state.interval=1000000;render()');
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.refreshMs")===60000);
  await run('items[0].state.interval=-1;render()');
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.refreshMs")===0);
  assert.equal(await run("smartChildrenCache.get('smart-test').kids[0].fillColor"),'#22c55e');
  assert.equal(await run('smartRefreshTimer'),null);
  assert.match(await page.locator('#toast').textContent(),/refreshMs/);
  await run('items[0].state.interval="nonfinite";render()');
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.sig===smartSig(items[0])"));
  assert.equal(await run("smartChildrenCache.get('smart-test').refreshMs"),0);
  assert.equal(await run('smartBackoffUntil.size'),0,'a non-finite interval does not discard valid children');
}));

test('live clock, stopwatch and ruler are available as matching source templates and inert demo previews',async()=>app(async({page,run})=>{
  const definitions=[['liveClock','live-clock.js','Live clock'],['stopwatch','stopwatch.js','Stopwatch'],['ruler','ruler.js','Ruler']];
  const entries=JSON.parse(demoLibrary).shapes;
  for(const [key,file,name] of definitions){
    const source=fs.readFileSync(path.join(__dirname,'..','examples',file),'utf8');
    assert.equal(await run(`SMART_TEMPLATES[${JSON.stringify(key)}].script`),source);
    assert.equal(entries.find(entry=>entry.name===name).items[0].script,source);
    await page.locator('#shapeLibBtn').click();await page.locator('#manageShapesBtn').click();await page.locator('#newSmartObjectBtn').click();
    await page.locator('#smartTemplateSelect').selectOption(key);
    assert.equal(await page.locator('#smartObjectNameInput').inputValue(),name);
    assert.equal(await page.locator('#smartObjectScriptInput').inputValue(),source);
    await page.locator('#smartObjectDialogSubmit').click();
    await page.locator('#smartObjectDialog').waitFor({state:'hidden'});
    await page.waitForFunction(name=>__test.run('shapeLibrary.shapes.some(t=>t.name===\"'+name+'\")'),name);
    assert.equal(await run(`shapeLibrary.shapes.find(t=>t.name===${JSON.stringify(name)}).items[0].script`),source);
    await page.locator('#shapeLibBtn').click();
  }
  assert.equal(await run('SMART_TEMPLATES.clock.script.includes("h:10, m:10")'),true,'manual Clock remains a separate template');
}));

test('live clock advances on its own and stopwatch controls, exports, undo and reload preserve timestamp timing',async()=>app(async({page,run})=>{
  await run(`(async()=>{
    const clock={...${JSON.stringify(smartFixture(''))},script:SMART_TEMPLATES.liveClock.script};
    await initializeSmartItem(clock);items=[clock];setTool('select');selection=[];render();return clock;
  })()`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.kids.some(c=>/^\\d{2}:\\d{2}:\\d{2}$/.test(c.text))"));
  const first=await run("items[0].state.time");
  await page.waitForFunction(first=>__test.run("items[0].state.time")!==first,first);
  assert.equal(await run('items[0].componentApi'),2);
  assert.match(await run('items[0].state.time'),/^\d{2}:\d{2}:\d{2}$/);
  assert.equal(await run("['second','minute','hour','halfDay'].every(port=>typeof items[0].state[port]==='boolean')"),true);
  await run(`(async()=>{const sw={...${JSON.stringify(smartFixture(''))},script:SMART_TEMPLATES.stopwatch.script};await initializeSmartItem(sw);
    items=[sw];selection=[0];editingSmartIdx=0;undoStack=[];redoStack=[];render();})()`);
  await page.waitForFunction(()=>__test.run("smartHandlesCache.get('smart-test')?.hs.length")===2);
  const click=async id=>{
    const shape=await run('items[0]'),canvas=await page.locator('#canvas').boundingBox();
    const handle=await run(`requestSmartCall(items[0],'handles',[items[0].state,items[0].w,items[0].h]).then(hs=>hs.find(h=>h.id===${JSON.stringify(id)}))`);
    await page.mouse.click(canvas.x+shape.x+handle.x,canvas.y+shape.y+handle.y);await run('smartHitSettled');
  };
  await click('toggle');
  const started=await run('items[0].state.startedAt');assert.equal(typeof started,'number');
  await page.waitForFunction(()=>{
    const reading=__test.run("smartChildrenCache.get('smart-test')?.kids.find(child=>/^\\d{2,}:\\d{2}:\\d{2}\\.\\d{3}$/.test(child.text))?.text");
    return typeof reading==='string' && reading!=='00:00:00.000';
  });
  assert.equal(await run('undoStack.length'),1,'refreshes do not become undo steps');
  // Model a delayed/background redraw: elapsed time must follow the saved timestamp, not tick count.
  await run('items[0].state.startedAt=Date.now()-62300;render();save()');
  const svg=await run('itemsToSVGMarkup(items)');assert.match(svg,/00:01:02\.[3-9]\d{2}/);
  await page.reload();assert.equal(await run('typeof items[0].state.startedAt'),'number');
  await run('setTool("select");selection=[0];editingSmartIdx=0;render()');
  await click('toggle');assert.equal(await run('items[0].state.startedAt'),null);
  const paused=await run('items[0].state.elapsedMs');assert.ok(paused>=62300 && paused<68000);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.refreshMs")===0);
  const saved=await downloadedJSON(page,run,'exportProject()');assert.equal(saved.items[0].state.elapsedMs,paused);
  await click('reset');assert.equal(await run('items[0].state.elapsedMs'),0);
  await run('undo()');assert.equal(await run('items[0].state.elapsedMs'),paused);
  await run('redo()');assert.equal(await run('items[0].state.elapsedMs'),0);
  await page.reload();assert.deepEqual(await run('items[0].state'),{elapsedMs:0,startedAt:null,observedRun:false});
}));

test('ruler grows at a fixed drill-template scale and unit switching is undoable and survives saving',async()=>app(async({page,run})=>{
  await run(`(async()=>{const ruler={...${JSON.stringify(smartFixture(''))},script:SMART_TEMPLATES.ruler.script};await initializeSmartItem(ruler);
    items=[ruler];setTool('select');selection=[0];editingSmartIdx=0;render();})()`);
  const marks=await run(`(async()=>{
    const get=async w=>requestSmartCall(items[0],'children',[{unit:'cm'},smartResolvedStyle(items[0]),w,76,false]);
    const short=await get(96),long=await get(192);
    const positions=kids=>kids.filter(c=>c.type==='rect' && c.fill && Math.abs(c.y+c.h-72)<1e-9)
      .map(c=>c.x===0?0:c.x+c.w/2);
    return {short:positions(short),long:positions(long)};
  })()`);
  assert.deepEqual(marks.long.slice(0,marks.short.length),marks.short,'extending adds marks without stretching existing divisions');
  assert.ok(Math.abs(marks.short[1]-96/25.4)<1e-9,'one millimeter matches the drill template');
  assert.ok(marks.long.length>marks.short.length);
  const canvas=await page.locator('#canvas').boundingBox(),shape=await run('items[0]');
  await page.mouse.click(canvas.x+shape.x+shape.w-44,canvas.y+shape.y+11);await run('smartHitSettled');
  assert.equal(await run('items[0].state.unit'),'in');
  const inch=await run(`requestSmartCall(items[0],'children',[items[0].state,smartResolvedStyle(items[0]),192,76,false])`);
  const one=inch.find(c=>c.type==='text' && c.text==='1');assert.equal(one.x+one.w/2,96);
  const print=await run(`(async()=>{
    const ruler={...items[0],w:240.37};
    const svg=await itemsToSVGMarkup([ruler]);
    const doc=new DOMParser().parseFromString(svg,'image/svg+xml'),root=doc.documentElement;
    const image=await createImageBitmap(await itemsToPngBlob([ruler],{background:false}));
    const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
    const cx=c.getContext('2d');cx.drawImage(image,0,0);
    // This row crosses only full-inch ticks, below the labels and above shorter half-inch ticks.
    // Use the actual crop translation so stroke bounds are accounted for.
    const crop=root.querySelector('g').transform.baseVal.consolidate().matrix;
    const cropY=crop.f,zeroEdge=(ruler.x+crop.e)*2;
    const row=cx.getImageData(0,Math.round((ruler.y+76-4-19+cropY)*2),c.width,1).data,groups=[];
    for(let x=0;x<c.width;x++)if(row[x*4+3]>160){
      if(!groups.length || x>groups.at(-1).at(-1)+1)groups.push([]);groups.at(-1).push(x);
    }
    const leftPixels=cx.getImageData(0,0,Math.floor(zeroEdge),c.height).data;
    const overhang=leftPixels.some((value,index)=>index%4===3 && value>0);
    image.close();
    return {width:+root.getAttribute('width'),viewWidth:root.viewBox.baseVal.width,
      height:+root.getAttribute('height'),viewHeight:root.viewBox.baseVal.height,
      zeroEdge,overhang,centers:groups.map(xs=>(xs[0]+xs.at(-1))/2+.5)};
  })()`);
  assert.ok(Math.abs(print.width-print.viewWidth)<.0001 && Math.abs(print.height-print.viewHeight)<.0001,
    'fractional SVG dimensions preserve a one-to-one physical scale');
  assert.equal(print.centers.length,3);
  assert.equal(print.overhang,false,'no painted pixels protrude to the left of zero');
  assert.equal(print.centers[1]-print.zeroEdge,192,'one inch from the flush zero edge is 192 pixels in the default 2x PNG');
  assert.equal(print.centers[2]-print.centers[1],192);
  await run('undo()');assert.equal(await run('items[0].state.unit'),'cm');await run('redo()');
  await run('editingSmartIdx=0;render()');
  await page.mouse.click(canvas.x+shape.x+shape.w-44,canvas.y+shape.y+11);await run('smartHitSettled');
  assert.equal(await run('items[0].state.unit'),'px');
  const px=await run(`requestSmartCall(items[0],'children',[items[0].state,smartResolvedStyle(items[0]),192,76,false])`);
  const fifty=px.find(c=>c.type==='text' && c.text==='50');assert.equal(fifty.x+fifty.w/2,50);
  const wide=await run(`requestSmartCall(items[0],'children',[{unit:'cm'},smartResolvedStyle(items[0]),1000000,76,false])`);
  assert.ok(wide.length>1 && wide.length<=1000,'very long rulers keep valid bounded geometry');
  const exported=await downloadedJSON(page,run,'exportProject()');assert.equal(exported.items[0].state.unit,'px');
  await page.reload();assert.equal(await run('items[0].state.unit'),'px');
}));

async function printFrameReady(page){
  await page.waitForFunction(()=>__test.run('printPreviewReady'));
}

test('printing preserves physical ruler scale, assets and pending text on the active sketch without changing the drawing',async()=>app(async({page,run})=>{
  await run(`(async()=>{items=[{...${JSON.stringify(rectangle())},fillColor:'#ef4444'}];save();newTab();
    const ruler={...${JSON.stringify(smartFixture(''))},script:SMART_TEMPLATES.ruler.script};
    await initializeSmartItem(ruler);ruler.x=100;ruler.y=100;
    const c=document.createElement('canvas');c.width=c.height=8;c.getContext('2d').fillRect(0,0,8,8);
    assets={printImage:c.toDataURL()};items=[ruler,{...${JSON.stringify(wrappedText)},x:100,y:300,text:'old'},
      {type:'image',id:'printImage',x:450,y:100,w:40,h:40}];
    setTool('select');selection=[0];editingSmartIdx=0;render();openText(1);textInput.value='Latest print note';})()`);
  await page.locator('#menuBtn').click();await page.locator('[data-act="print"]').click();
  await page.locator('#printDialog[open]').waitFor();await printFrameReady(page);
  assert.equal(await page.locator('#printMode').inputValue(),'actual');
  assert.equal(await page.locator('#printOrientation').inputValue(),'landscape');
  assert.equal(await run('items[1].text'),'Latest print note');
  const before=await run('({scene:JSON.stringify(items),history:undoStack.length,assets:JSON.stringify(assets),saved:localStorage.getItem(docKey(activeTabId))})');
  await page.locator('#printReference').check();await printFrameReady(page);
  const result=await page.locator('#printPreview').evaluate(frame=>{
    const doc=frame.contentDocument,page=doc.querySelector('body>svg'),art=doc.querySelector('.print-artwork>svg');
    return {paper:[page.getAttribute('width'),page.getAttribute('height')],ratio:+art.getAttribute('width')/+art.getAttribute('viewBox').split(/\s+/)[2],
      reference:doc.querySelector('.print-calibration path').getBBox().width,
      images:doc.querySelectorAll('image').length,text:doc.body.textContent,markup:doc.querySelector('.print-artwork').innerHTML};
  });
  assert.deepEqual(result.paper,['297mm','210mm']);assert.ok(Math.abs(result.ratio-25.4/96)<1e-10);
  assert.equal(result.reference,50);assert.equal(result.images,1);assert.match(result.text,/Latest\s*print\s*note/);
  assert.ok(!result.markup.includes('#ef4444'),'background tabs are not printed');
  assert.ok(!result.text.includes('↻'),'edit-mode controls are not printed');
  await page.locator('#printPaper').selectOption('letter');await page.locator('#printOrientation').selectOption('landscape');
  await page.locator('#printMargin').fill('13');await printFrameReady(page);
  assert.deepEqual(await page.locator('#printPreview').evaluate(frame=>{
    const page=frame.contentDocument.querySelector('body>svg'),clip=frame.contentDocument.querySelector('clipPath rect');
    return [page.getAttribute('width'),page.getAttribute('height'),clip.getAttribute('x')];
  }),['279.4mm','215.9mm','13']);
  await page.locator('#printPreview').evaluate(frame=>{frame.contentWindow.print=()=>{frame.dataset.printCalls=String(+(frame.dataset.printCalls||0)+1);};});
  await page.locator('#printDialogSubmit').click();
  assert.equal(await page.locator('#printPreview').getAttribute('data-print-calls'),'1','Print targets the prepared document');
  assert.deepEqual(await run('({scene:JSON.stringify(items),history:undoStack.length,assets:JSON.stringify(assets),saved:localStorage.getItem(docKey(activeTabId))})'),before);
  await page.locator('#printDialogCancel').click();await page.waitForFunction(()=>__test.run('printSnapshot')===null);
}));

test('oversized actual-size printing requires clipping consent, retains scale, and resets consent when the layout changes',async()=>app(async({page,run,context})=>{
  await run(`items=[{...${JSON.stringify(rectangle())},w:940,h:450}];save();render();`);
  await page.keyboard.press('Control+p');await page.locator('#printDialog[open]').waitFor();await printFrameReady(page);
  await page.locator('#printMode').selectOption('fit');await page.locator('#printOrientation').selectOption('portrait');await printFrameReady(page);
  const fitted=await page.locator('#printPreview').evaluate(frame=>{
    const doc=frame.contentDocument,art=doc.querySelector('.print-artwork>svg'),clip=doc.querySelector('clipPath rect');
    return {w:+art.getAttribute('width'),h:+art.getAttribute('height'),maxW:+clip.getAttribute('width'),maxH:+clip.getAttribute('height')};
  });
  assert.ok(fitted.w<=fitted.maxW+1e-6 && fitted.h<=fitted.maxH+1e-6);
  await page.locator('#printMode').selectOption('actual');
  await page.locator('#printWarning').waitFor({state:'visible'});
  assert.equal(await page.locator('#printDialogSubmit').isDisabled(),true);
  assert.equal(await page.locator('#printClip').isChecked(),false);
  assert.match(await page.locator('#printWarning').textContent(),/exceeds.*printable area/);
  await page.locator('#printPreview').evaluate(frame=>{frame.contentWindow.print=()=>{frame.dataset.printCalls=String(+(frame.dataset.printCalls||0)+1);};});
  await page.keyboard.press('Control+p');
  assert.equal(await page.locator('#printPreview').getAttribute('data-print-calls'),null,'the shortcut cannot bypass clipping consent');
  await page.locator('#printClip').check();await printFrameReady(page);
  assert.equal(await page.locator('#printDialogSubmit').isEnabled(),true);
  const clipped=await page.locator('#printPreview').evaluate(async frame=>{
    const doc=frame.contentDocument,svg=doc.querySelector('body>svg'),art=doc.querySelector('.print-artwork>svg');
    const clip=doc.querySelector('clipPath rect'),paper=svg.viewBox.baseVal;
    const canvas=document.createElement('canvas');canvas.width=paper.width;canvas.height=paper.height;
    const image=new Image(),url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
    try{
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
      const cx=canvas.getContext('2d');cx.drawImage(image,0,0,canvas.width,canvas.height);
      const x=+clip.getAttribute('x') + +clip.getAttribute('width'),y=paper.height/2;
      return {ratio:+art.getAttribute('width')/+art.getAttribute('viewBox').split(/\s+/)[2],
        inside:Array.from(cx.getImageData(x-3,y,1,1).data),outside:Array.from(cx.getImageData(x+3,y,1,1).data)};
    }finally{URL.revokeObjectURL(url);}
  });
  assert.ok(Math.abs(clipped.ratio-25.4/96)<1e-10,'allowing clipping preserves the physical scale');
  assert.deepEqual(clipped.inside,[255,209,102,255],'artwork reaches the clipping edge');
  assert.deepEqual(clipped.outside,[255,255,255,255],'overflow is clipped before the page margin');
  if(engine==='chromium'){
    const output=await context.newPage();
    try{
      await output.setContent(await page.locator('#printPreview').getAttribute('srcdoc'));
      const pdf=await output.pdf({preferCSSPageSize:true});
      assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,1,'clipped artwork prints on one page');
    }finally{await output.close();}
  }
  await page.locator('#printPreview').evaluate(frame=>{frame.contentWindow.print=()=>{frame.dataset.printCalls=String(+(frame.dataset.printCalls||0)+1);};});
  await page.locator('#printDialogSubmit').click();
  assert.equal(await page.locator('#printPreview').getAttribute('data-print-calls'),'1','the override prints the prepared document');
  await page.locator('#printClip').uncheck();
  assert.equal(await page.locator('#printDialogSubmit').isDisabled(),true,'revoking consent blocks printing again');
  await page.locator('#printOrientation').selectOption('landscape');await printFrameReady(page);
  assert.equal(await page.locator('#printWarning').isVisible(),false);
  await page.locator('#printMargin').fill('50');await page.locator('#printWarning').waitFor({state:'visible'});
  assert.equal(await page.locator('#printDialogSubmit').isDisabled(),true);
  await page.locator('#printClip').check();await printFrameReady(page);
  await page.locator('#printReference').check();
  assert.equal(await page.locator('#printClip').isChecked(),false,'changing the layout requires fresh clipping consent');
  assert.equal(await page.locator('#printDialogSubmit').isDisabled(),true);
  await page.locator('#printClip').check();await printFrameReady(page);
  await page.locator('#printMargin').fill('');assert.equal(await page.locator('#printDialogSubmit').isDisabled(),true);
  assert.match(await page.locator('#printDialogError').textContent(),/margins/);
  await page.locator('#printMargin').fill('10');await page.locator('#printMode').selectOption('fit');await printFrameReady(page);
  assert.equal(await page.locator('#printDialogError').textContent(),'');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#printDialog').isVisible(),false);
  assert.equal(await run('items.length'),1);
  await page.keyboard.press('Control+p');await printFrameReady(page);
  await page.locator('#printMode').selectOption('actual');await page.locator('#printOrientation').selectOption('portrait');
  await page.locator('#printClip').check();await printFrameReady(page);
  await page.keyboard.press('Escape');await page.keyboard.press('Control+p');
  await page.locator('#printWarning').waitFor({state:'visible'});
  assert.equal(await page.locator('#printClip').isChecked(),false,'reopening the dialog requires fresh clipping consent');
  assert.equal(await page.locator('#printDialogSubmit').isDisabled(),true);
}));

test('tiled printing keeps physical scale, matching overlap marks, numbered previews, and every sheet in the PDF',async()=>app(async({page,run,context})=>{
  await run(`items=[{...${JSON.stringify(rectangle())},w:2000,h:1100}];save();render();`);
  const before=await run('JSON.stringify({items,undoStack,redoStack,assets,storage:{...localStorage}})');
  await page.keyboard.press('Control+p');await page.locator('#printDialog[open]').waitFor();
  await page.locator('#printMode').selectOption('tile');await printFrameReady(page);
  assert.equal(await page.locator('#printOverlap').inputValue(),'10');
  assert.equal(await page.locator('#printAlignment').isChecked(),true);
  assert.equal(await page.locator('#printWarning').isVisible(),false,'tiling preserves the whole drawing without a clipping override');
  assert.match(await page.locator('#printSummary').textContent(),/100%.*2 columns × 2 rows.*4 pages/);
  const sheets=await page.locator('#printPreview').evaluate(frame=>[...frame.contentDocument.querySelectorAll('body>svg')].map(sheet=>{
    const art=sheet.querySelector('.print-artwork>svg'),clip=sheet.querySelector('clipPath rect');
    const path=sheet.querySelector('.print-alignment path'),marks=[];
    for(let distance=2;distance<path.getTotalLength();distance+=8){
      const point=path.getPointAtLength(distance);marks.push([point.x-+art.getAttribute('x'),point.y-+art.getAttribute('y')]);
    }
    return {x:+art.getAttribute('x'),y:+art.getAttribute('y'),w:+art.getAttribute('width'),h:+art.getAttribute('height'),
      ratio:+art.getAttribute('width')/+art.getAttribute('viewBox').split(/\s+/)[2],
      area:[+clip.getAttribute('width'),+clip.getAttribute('height')],marks,label:sheet.querySelector('.print-page-number').textContent};
  }));
  assert.equal(sheets.length,4);
  for(const sheet of sheets){assert.ok(Math.abs(sheet.ratio-25.4/96)<1e-10);assert.deepEqual(sheet.area,[277,182]);}
  assert.equal(sheets[0].x-sheets[1].x,267,'adjacent columns repeat 10 mm');
  assert.equal(sheets[0].y-sheets[2].y,172,'adjacent rows repeat 10 mm');
  assert.deepEqual(sheets[0].marks.slice(0,2),sheets[1].marks.slice(0,2),'horizontal neighbours share registration coordinates');
  assert.deepEqual(sheets[0].marks.slice(2),sheets[2].marks.slice(2),'vertical neighbours share registration coordinates');
  assert.ok(sheets[1].x+sheets[1].w<=10+277 && sheets[3].y+sheets[3].h<=10+182,'last column and row cover the remaining drawing');
  assert.match(sheets[3].label,/Page 4 of 4.*Row 2, column 2/);
  assert.equal(await page.locator('#printPagePrev').isDisabled(),true);
  for(let i=0;i<3;i++)await page.locator('#printPageNext').click();
  assert.match(await page.locator('#printPageLabel').textContent(),/Page 4 of 4.*Row 2, column 2/);
  assert.equal(await page.locator('#printPageNext').isDisabled(),true);
  const output=await context.newPage();
  try{
    await output.setContent(await page.locator('#printPreview').evaluate(frame=>frame.contentDocument.documentElement.outerHTML));
    assert.equal(await output.locator('body>svg:visible').count(),1);
    await output.emulateMedia({media:'print'});
    assert.equal(await output.locator('body>svg:visible').count(),4,'printing includes every sheet regardless of the selected preview');
    if(engine==='chromium'){
      const pdf=await output.pdf({preferCSSPageSize:true});
      assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,4,'the PDF contains exactly four physical sheets');
    }
  }finally{await output.close();}
  await page.locator('#printOverlap').fill('50');await printFrameReady(page);
  assert.match(await page.locator('#printSummary').textContent(),/3 columns × 2 rows.*6 pages/);
  assert.match(await page.locator('#printPageLabel').textContent(),/Page 1 of 6/,'layout changes reset the preview page');
  await page.locator('#printAlignment').uncheck();await printFrameReady(page);
  assert.equal(await page.locator('#printPreview').evaluate(frame=>frame.contentDocument.querySelectorAll('.print-alignment').length),0);
  await page.locator('#printOverlap').fill('0');await page.locator('#printReference').check();await printFrameReady(page);
  assert.match(await page.locator('#printSummary').textContent(),/2 columns × 2 rows.*4 pages/);
  assert.deepEqual(await page.locator('#printPreview').evaluate(frame=>[...frame.contentDocument.querySelectorAll('.print-calibration path')].map(p=>p.getPointAtLength(50).x-p.getPointAtLength(0).x)),[50,50,50,50]);
  await page.locator('#printPreview').evaluate(frame=>{frame.contentWindow.print=()=>{frame.dataset.printCalls='1';};});
  await page.keyboard.press('Control+p');
  assert.equal(await page.locator('#printPreview').getAttribute('data-print-calls'),'1');
  assert.equal(await run('JSON.stringify({items,undoStack,redoStack,assets,storage:{...localStorage}})'),before,'tiling never changes the drawing or saved state');
  await page.locator('#printOverlap').fill('');assert.equal(await page.locator('#printDialogSubmit').isDisabled(),true);
  assert.match(await page.locator('#printDialogError').textContent(),/overlap/);
  await page.locator('#printMode').selectOption('fit');await printFrameReady(page);
  assert.equal(await page.locator('#printTileOptions').isVisible(),false);
  assert.equal(await page.locator('#printPageNav').isVisible(),false);
}));

test('tiled printing handles exact page boundaries, small drawings, portrait Letter, and excessive page counts',async()=>app(async({page,run})=>{
  // Use exact physical geometry so rounding cannot add a spurious sheet at a tile boundary.
  await run(`const tilePixel=document.createElement('canvas');tilePixel.width=tilePixel.height=1;
    assets={exactTile:tilePixel.toDataURL()};items=[{type:'image',uid:'exactTile',id:'exactTile',x:0,y:0,w:544/MM_PER_PX,h:182/MM_PER_PX}];render();`);
  await page.keyboard.press('Control+p');await page.locator('#printMode').selectOption('tile');await printFrameReady(page);
  assert.match(await page.locator('#printSummary').textContent(),/2 columns × 1 row.*2 pages/);
  await page.locator('#printDialogCancel').click();
  await run(`items=[${JSON.stringify(rectangle())}];render();`);
  await page.keyboard.press('Control+p');await printFrameReady(page);
  assert.match(await page.locator('#printSummary').textContent(),/1 column × 1 row.*1 page$/);
  await page.locator('#printPaper').selectOption('letter');await page.locator('#printOrientation').selectOption('portrait');await printFrameReady(page);
  assert.deepEqual(await page.locator('#printPreview').evaluate(frame=>{
    const sheet=frame.contentDocument.querySelector('body>svg');return [sheet.getAttribute('width'),sheet.getAttribute('height')];
  }),['215.9mm','279.4mm']);
  await page.locator('#printDialogCancel').click();
  await run(`items=[{...${JSON.stringify(rectangle())},w:100000,h:100000}];render();`);
  await page.keyboard.press('Control+p');await page.locator('#printDialogError').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('printDialogError').textContent.includes('maximum 100'));
  assert.equal(await page.locator('#printDialogSubmit').isDisabled(),true,'an excessive grid is rejected before creating all sheets');
  await page.locator('#printMode').selectOption('fit');await printFrameReady(page);
  assert.equal(await page.locator('#printDialogError').textContent(),'');
}));

test('print previews freeze live shapes and a cancelled snapshot cannot reopen or replace a later preview',async()=>app(async({page,run})=>{
  const script=`({refreshMs(){return 100;},children(s,style,w,h,editing){return [{type:'text',x:0,y:0,w,h,text:String(Date.now())+(editing?' EDIT CONTROL':'')}];}})`;
  await run(`items=[${JSON.stringify(smartFixture(script))}];setTool('select');selection=[0];editingSmartIdx=0;render();`);
  await page.locator('#menuBtn').click();await page.locator('[data-act="print"]').click();await printFrameReady(page);
  const snapshot=await run('printSnapshot.svg');assert.ok(!snapshot.includes('EDIT CONTROL'));
  const live=await run("smartChildrenCache.get('smart-test')?.kids[0]?.text");
  await page.waitForFunction(before=>__test.run("smartChildrenCache.get('smart-test')?.kids[0]?.text")!==before,live);
  await page.locator('#printMargin').fill('12');await printFrameReady(page);
  assert.equal(await run('printSnapshot.svg'),snapshot,'layout changes reuse the frozen drawing');
  await page.locator('#printDialogCancel').click();
  const slow=`({children(){const start=performance.now();while(performance.now()-start<150){}return [{type:'text',x:0,y:0,w:180,h:30,text:'Old snapshot'}];}})`;
  await run(`items=[${JSON.stringify(smartFixture(slow))}];selection=[];render();void openPrintDialog();`);
  await page.locator('#printDialogCancel').click();
  await run(`items=[${JSON.stringify(rectangle())}];render();openPrintDialog();`);await printFrameReady(page);
  assert.ok(!(await run('printSnapshot.svg')).includes('Old snapshot'));
  assert.equal(await page.locator('#printDialog[open]').count(),1);
}));

test('disabling custom printing uses native menu printing and leaves browser shortcuts untouched',async()=>app(async({page,run})=>{
  await page.evaluate(()=>{window.nativePrintCalls=0;window.print=()=>{nativePrintCalls++;};});
  await run(`items=[${JSON.stringify(rectangle())}];setTool('select');render();`);
  await page.locator('#menuBtn').click();await page.locator('[data-act="print"]').click();
  assert.equal(await page.evaluate(()=>nativePrintCalls),1);
  assert.equal(await page.locator('#printDialog[open]').count(),0);
  assert.equal(await run('printSnapshot'),null);
  assert.equal(await page.locator('#printPreview').getAttribute('srcdoc'),null);
  for(const modifier of ['ctrlKey','metaKey']){
    const cancelled=await page.evaluate(modifier=>{
      const event=new KeyboardEvent('keydown',{key:'p',[modifier]:true,bubbles:true,cancelable:true});
      document.body.dispatchEvent(event);return event.defaultPrevented;
    },modifier);
    assert.equal(cancelled,false,modifier+' keeps the native print shortcut');
  }
  assert.equal(await run('ui.tool'),'select','native shortcuts do not switch drawing tools');
},{files:{'settings.json':settingsFile({customPrinting:false})}}));

test('a custom deployment title is plain text and invalid titles do not partially apply settings',async()=>{
  const title='Team <b>sketchpad</b> & notes';
  await app(async({page,run})=>{
    assert.equal(await page.title(),title);
    assert.equal(await page.locator('head title b').count(),0);
    assert.equal(await run('features.workspace'),false);
    assert.equal(await page.locator('#settingsWarning').isVisible(),false);
  },{files:{'settings.json':JSON.stringify({version:1,title,features:{workspace:false}})}});
  for(const title of ['',42]){
    await app(async({page,run})=>{
      assert.equal(await page.title(),'SimpleCanvas — Quick Sketches');
      assert.equal(await run('features.workspace'),true,'invalid settings never partially disable features');
      assert.equal(await page.locator('#settingsWarning').isVisible(),true);
    },{files:{'settings.json':JSON.stringify({title,features:{workspace:false}})}});
  }
});

test('the Really Simple deployment loads its own title and disables all optional features',async()=>app(async({page,run})=>{
  assert.equal(await page.title(),'Really SimpleCanvas');
  assert.equal(await run('Object.values(features).every(value=>value===false)'),true);
  assert.equal(await page.locator('#shapeLibWrap').isVisible(),false);
  assert.equal(await run('performance.getEntriesByType("resource").some(e=>e.name.endsWith("shapes-library.json"))'),false);
  await page.locator('#menuBtn').click();
  for(const action of ['newTab','openWorkspace','saveWorkspace'])assert.equal(await page.locator(`[data-act="${action}"]`).isVisible(),false);
  await page.keyboard.press('Escape');await page.locator('[data-tool="rect"]').click();
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvas.x+100,canvas.y+100);await page.mouse.down();
  await page.mouse.move(canvas.x+260,canvas.y+200,{steps:5});await page.mouse.up();
  assert.deepEqual(await run('items.map(it=>it.type)'),['rect']);
  await page.reload();assert.equal(await page.title(),'Really SimpleCanvas');
  assert.deepEqual(await run('items.map(it=>it.type)'),['rect']);
},{origin:'http://simplecanvas.test/simplecanvas/reallysimple',files:{'settings.json':fs.readFileSync(path.join(__dirname,'..','reallysimple','settings.json'),'utf8')}}));

test('workspace settings preserve saved tabs, restrict exports to the active sketch, and retain recovery',async()=>app(async({page,run})=>{
  const first=await run(`applySketchToActiveTab([{...${JSON.stringify(rectangle('background'))},fillColor:'#ef4444'}],{});activeTabId`);
  await run(`newTab();applySketchToActiveTab([{...${JSON.stringify(rectangle('active'))},fillColor:'#3b82f6'}],{});`);
  const stored=await run(`({index:localStorage.getItem(TABS_KEY),background:localStorage.getItem(docKey(${JSON.stringify(first)})),active:activeTabId})`);
  await page.route('**/settings.json',route=>route.fulfill({contentType:'application/json',body:settingsFile({workspace:false})}));
  await page.reload();
  assert.equal(await run('features.workspace'),false);
  assert.equal(await page.locator('#tabbar').isHidden(),true);
  await page.locator('#menuBtn').click();
  for(const action of ['newTab','openWorkspace','saveWorkspace'])assert.equal(await page.locator(`[data-act="${action}"]`).isVisible(),false);
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('[data-act="png"]').evaluate(el=>el===document.activeElement),true,'menu navigation skips disabled workspace actions');
  await page.keyboard.press('Escape');
  await run(`newTab();activateTab(${JSON.stringify(first)});closeTab(${JSON.stringify(first)});renameTab(${JSON.stringify(first)});openWorkspaceFile(new File(['{}'],'workspace.json'));exportWorkspace();`);
  assert.equal(await run('activeTabId'),stored.active);
  assert.equal(await run('tabs.length'),2);
  assert.equal(await page.locator('dialog[open]').count(),0);
  const exported=await downloadedHTML(page,run);
  assert.ok(exported.includes('#3b82f6') && !exported.includes('#ef4444'),'HTML exports only the active drawing');
  await run('beginHistory();items[0].x+=1;commitHistory();');
  await page.evaluate(()=>{window.originalSettingsSetItem=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new Error('storage unavailable');};});
  await run('items[0].x+=10;save();');
  assert.equal(await page.locator('#autosaveWarning').isVisible(),true);
  const download=page.waitForEvent('download');await page.locator('#saveRecoveryWorkspace').click();
  const recovery=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.deepEqual(recovery.tabs.map(t=>t.items[0].uid),['background','active']);
  assert.equal(recovery.tabs[1].items[0].x,111);
  assert.equal(await run(`localStorage.getItem(docKey(${JSON.stringify(first)}))`),stored.background,'hidden documents remain untouched');
  assert.equal(await run('localStorage.getItem(TABS_KEY)'),stored.index,'disabling tabs never rewrites their saved index');
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalSettingsSetItem;});await run('persistWorkspace()');
  await page.unroute('**/settings.json');await page.reload();await run('appReady');
  assert.equal(await page.locator('#tabbar').isVisible(),true);
  assert.equal(await run('items[0].x'),111);
  await run(`activateTab(${JSON.stringify(first)})`);assert.equal(await run('items[0].uid'),'background');
}));

test('fixed libraries block mutations and Iconify while existing smart handles still work',async()=>app(async({page,run})=>{
  await page.waitForFunction(count=>__test.run('shapeLibrary?.shapes.length')===count,demoShapeCount);
  await page.locator('#shapeLibBtn').click();
  assert.equal(await page.locator('#manageShapesBtn').isVisible(),false);
  assert.equal(await page.locator('#shapePickerFooter').isVisible(),false);
  const before=await run('JSON.stringify(shapeLibrary)');
  let iconRequests=0;
  await page.route('https://api.iconify.design/**',route=>{iconRequests++;return route.fulfill({contentType:'application/json',body:'{"icons":[]}'});});
  await run(`items=[${JSON.stringify(rectangle())}];setTool('select');selection=[0];
    addSelectionToLibrary();renameLibraryShape(shapeLibrary.shapes[0]);replaceLibraryShape(shapeLibrary.shapes[0]);deleteLibraryShape(shapeLibrary.shapes[0]);
    importShapeLibraryFile(new File(['{"shapes":[]}'],'other.json'));exportShapeLibrary();
    document.getElementById('manageShapesBtn').click();document.getElementById('newSmartObjectBtn').click();
    openIconDialog();searchIcons('boat');importIconToLibrary('mdi','anchor',{});`);
  assert.equal(await run('JSON.stringify(shapeLibrary)'),before);
  assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(iconRequests,0);
  await page.locator('#shapeLibBtn').click();
  await page.getByRole('button',{name:'Place Clock',exact:true}).click();
  let canvas=await page.locator('#canvas').boundingBox();await page.mouse.click(canvas.x+450,canvas.y+240);
  await run('shapePlacementQueue');
  canvas=await page.locator('#canvas').boundingBox();
  const clock=await run('items[1]');
  await page.mouse.dblclick(canvas.x+clock.x+clock.w/2,canvas.y+clock.y+clock.h/2);
  await page.waitForFunction(()=>__test.run('editingSmartIdx')===1);
  const minute=await run(`requestSmartCall(items[1],'handles',[items[1].state,items[1].w,items[1].h,smartResolvedStyle(items[1])]).then(hs=>hs.find(h=>h.id==='minute'))`);
  await page.mouse.move(canvas.x+clock.x+minute.x,canvas.y+clock.y+minute.y);await page.mouse.down();
  await page.waitForFunction(()=>__test.run('smartDrag?.handle')==='minute');
  await page.mouse.move(canvas.x+clock.x+clock.w*.85,canvas.y+clock.y+clock.h/2,{steps:5});await page.mouse.up();await run('smartHitSettled');
  assert.equal(await run('items[1].state.m'),15);
  await run('undo()');assert.equal(await run('items[1].state.m'),10);
}, {files:{'settings.json':settingsFile({shapeLibraryManagement:false}),'shapes-library.json':demoLibrary}}));

test('smart authoring can be disabled independently while static library additions remain available',async()=>app(async({page,run})=>{
  await page.waitForFunction(count=>__test.run('shapeLibrary?.shapes.length')===count,demoShapeCount);
  await page.locator('#shapeLibBtn').click();await page.locator('#manageShapesBtn').click();
  assert.equal(await page.getByRole('button',{name:'Edit Drill template',exact:true}).count(),0);
  assert.equal(await page.locator('#newSmartObjectBtn').isVisible(),false);
  assert.equal(await page.locator('#addIconBtn').isVisible(),true,'Iconify is independent of script authoring');
  await run(`editLibrarySmartSource(shapeLibrary.shapes[8],shapeLibrary.shapes[8].items[0]);
    document.getElementById('newSmartObjectBtn').click();document.getElementById('smartObjectDialogForm').dispatchEvent(new Event('submit',{cancelable:true}));`);
  assert.equal(await page.locator('#smartObjectDialog').isVisible(),false);
  await page.locator('#manageShapesBtn').click();
  await run(`items=[${JSON.stringify(rectangle())}];setTool('select');selection=[0];render();`);
  await page.locator('#shapeLibBtn').click();
  await page.locator('#addSelectionFooterBtn').click();await page.locator('#libraryNameInput').fill('Allowed static shape');
  await page.locator('#libraryDialogSubmit').click();
  await page.getByText('Allowed static shape',{exact:true}).waitFor();
  await run('shapeLibraryDirty=false;');
  await run(`items=[clone(shapeLibrary.shapes[6].items[0])];selection=[0];addSelectionToLibrary();
    importShapeLibraryFile(new File([${JSON.stringify(demoLibrary)}],'smart-library.json'));`);
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Importing smart shapes is disabled');
  assert.equal(await run('shapeLibrary.shapes.length'),demoShapeCount+1);
  assert.equal(await page.locator('#libraryDialog[open]').count(),0);
}, {files:{'settings.json':settingsFile({smartShapeAuthoring:false}),'shapes-library.json':demoLibrary}}));

test('Iconify can be disabled independently without blocking static shapes or smart authoring',async()=>app(async({page,run})=>{
  let requests=0;
  await page.route('https://api.iconify.design/**',route=>{requests++;return route.fulfill({contentType:'application/json',body:'{"icons":[]}'});});
  await page.locator('#shapeLibBtn').click();
  assert.equal(await page.locator('#addIconFooterBtn').isVisible(),false);
  assert.equal(await page.locator('#addSelectionFooterBtn').isVisible(),true);
  await page.locator('#manageShapesBtn').click();
  assert.equal(await page.locator('#addIconBtn').isVisible(),false);
  assert.equal(await page.locator('#newSmartObjectBtn').isVisible(),true);
  await run(`openIconDialog();searchIcons('boat');loadIconBodies([{set:'mdi',name:'anchor'}]);importIconToLibrary('mdi','anchor',{});`);
  assert.equal(requests,0);
  assert.equal(await page.locator('#iconDialog').isVisible(),false);
  await page.locator('#newSmartObjectBtn').click();assert.equal(await page.locator('#smartObjectDialog').isVisible(),true);
}, {files:{'settings.json':settingsFile({iconify:false})}}));

test('disabling the complete library skips its request and preserves smart drawings and exports',async()=>app(async({page,run})=>{
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('#shapeLibWrap').isVisible(),false);
  assert.equal(await run('performance.getEntriesByType("resource").some(e=>e.name.endsWith("shapes-library.json"))'),false);
  await run(`setShapePicker(true);armShapeForPlacement(${JSON.stringify(JSON.parse(demoLibrary).shapes[6])});placeShapeAt(${JSON.stringify(JSON.parse(demoLibrary).shapes[6])},400,200);`);
  assert.equal(await run('items.length'),0);
  assert.equal(await page.locator('#shapePicker').isVisible(),false);
  await run(`applySketchToActiveTab([normalizeItem({...${JSON.stringify(JSON.parse(demoLibrary).shapes[6].items[0])},uid:'saved-clock',x:100,y:100},{})],{});`);
  const svg=await run('itemsToSVGMarkup(items)');assert.match(svg,/<ellipse|<circle/);
  await page.reload();assert.equal(await run('items[0].uid'),'saved-clock');
}, {files:{'settings.json':settingsFile({shapeLibrary:false}),'shapes-library.json':demoLibrary}}));

test('settings resolve before input, document restoration, or library loading',async()=>app(async({page,run})=>{
  let finish,started;
  const pending=new Promise(resolve=>{finish=resolve;}),requested=new Promise(resolve=>{started=resolve;});
  await page.route('**/settings.json',async route=>{started();await pending;await route.fulfill({contentType:'application/json',body:settingsFile({workspace:false,shapeLibrary:false})});});
  await page.reload({waitUntil:'domcontentloaded'});await requested;
  assert.equal(await page.evaluate(()=>document.body.inert),true);
  assert.equal(await page.evaluate(()=>__test.run('activeTabId')),null);
  await page.keyboard.press('r');assert.equal(await page.evaluate(()=>__test.run('ui.tool')),'pen');
  finish();await run('appReady');
  assert.equal(await page.evaluate(()=>document.body.inert),false);
  assert.equal(await page.locator('#shapeLibWrap').isVisible(),false);
  assert.equal(await page.locator('[data-act="newTab"]').getAttribute('hidden'),'');
}));

test('invalid deployment settings warn and preserve working defaults',async()=>{
  for(const contents of ['{',JSON.stringify({version:2}),settingsFile({workspace:'false'}),settingsFile({workspce:false}),JSON.stringify({features:null})]){
    await app(async({page,run})=>{
      assert.equal(await page.locator('#settingsWarning').isVisible(),true);
      assert.equal(await run('features.workspace && features.shapeLibraryManagement && features.smartShapeAuthoring && features.iconify'),true);
      await run('newTab()');assert.equal(await run('tabs.length'),2);
    },{files:{'settings.json':contents}});
  }
});

test('a stalled settings request times out and releases the standard app',async()=>app(async({page,run})=>{
  await page.route('**/settings.json',async route=>{
    await new Promise(resolve=>setTimeout(resolve,2200));
    await route.fulfill({contentType:'application/json',body:settingsFile({workspace:false})}).catch(()=>{});
  });
  await page.reload();await run('appReady');
  assert.equal(await page.locator('#settingsWarning').isVisible(),true);
  assert.match(await page.locator('#settingsWarning').textContent(),/timed out/);
  assert.equal(await run('features.workspace'),true);
  assert.equal(await page.evaluate(()=>document.body.inert),false);
}));

test('the standalone local HTML opens with defaults and no HTTP settings dependency',async()=>{
  const context=await browser.newContext();
  try{
    const page=await context.newPage(),requests=[],errors=[];
    page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(require('node:url').pathToFileURL(path.join(__dirname,'..','index.html')).href);
    await page.waitForFunction(()=>!document.body.inert);
    assert.equal(await page.locator('#settingsWarning').isVisible(),false);
    await page.locator('#menuBtn').click();await page.getByRole('menuitem',{name:'Add tab',exact:true}).click();
    assert.equal(await page.locator('#tabbar .tab').count(),2);
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('the bundled demo loads under a Pages subpath with inert previews and editable smart shapes',async()=>app(async({page,run})=>{
  await page.waitForFunction(count=>__test.run('shapeLibrary?.shapes.length')===count,demoShapeCount);
  assert.equal(await run('shapeLibrary.shapes.filter(t=>t.items.some(it=>it.type==="smart")).length'),7);
  await page.locator('#shapeLibBtn').click();
  await page.waitForFunction(count=>{
    const images=[...document.querySelectorAll('#shapeGrid img')];
    return images.length===count && images.every(img=>img.complete && img.naturalWidth===128);
  },demoShapeCount);
  assert.equal(await page.locator('#libraryDialog[open]').count(),0,'saved previews need no script consent');
  assert.equal(await page.evaluate(()=>window.__smartWorkerStarts),0,'browsing the demo runs no smart scripts');
  assert.equal(await run('shapeLibraryDirty'),false);
  const expectedWorking=JSON.parse(demoLibrary).workingCollection;
  const canonical={Clock:'builtin:clock:1',Chart:'builtin:chart:1','Live clock':'builtin:liveClock:1',Stopwatch:'builtin:stopwatch:1',Ruler:'builtin:ruler:1'};
  const expectedCategories={
    'builtin:clock:1':['Tools & time','Displays'],'builtin:chart:1':['Displays'],
    'builtin:liveClock:1':['Tools & time','Displays'],'builtin:stopwatch:1':['Tools & time','Displays'],
    'builtin:ruler:1':['Workshop','Tools & time']
  };
  const inspectDemo=()=>run(`({
    working:shapeLibrary.workingCollection,
    entries:shapeLibrary.shapes.map(entry=>({id:entry.id,name:entry.name,builtin:builtInShapeEntries.has(entry),
      canonical:builtInShapeLibrary.find(candidate=>candidate.id===entry.id)===entry,categories:effectiveLibraryCategories(entry),
      catalogCopies:libraryCatalogEntries().filter(candidate=>candidate.id===entry.id).length})),
    builtinCount:builtInShapeLibrary.length
  })`);
  const loaded=await inspectDemo();
  assert.equal(loaded.working.length,13);assert.deepEqual(loaded.working,expectedWorking,'the familiar working collection keeps its original order');
  assert.equal(loaded.entries.filter(entry=>entry.builtin).length,5);
  assert.equal(loaded.entries.filter(entry=>!entry.builtin).length,8);
  assert.equal(loaded.entries.some(entry=>entry.name.includes('(smart)')),false,'smart status is no longer repeated in entry names');
  assert.ok(loaded.entries.some(entry=>entry.name==='Finishing line'));
  await page.locator('#browseShapesBtn').click();
  await page.locator('#libraryCollection').selectOption('mine');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),8,'My shapes contains only the eight demo-owned entries');
  await page.locator('#libraryCollection').selectOption('builtin');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),loaded.builtinCount);
  for(const [name,id] of Object.entries(canonical)){
    const entry=loaded.entries.find(entry=>entry.name===name);
    assert.equal(entry.id,id);assert.equal(entry.builtin,true);assert.equal(entry.canonical,true);
    assert.equal(entry.catalogCopies,1,name+' appears once in the catalog');
    assert.deepEqual(entry.categories,expectedCategories[id]);
    const card=page.locator('#libraryBrowserGrid [data-entry-id='+JSON.stringify(id)+']');
    assert.equal(await card.count(),1);assert.equal(await card.locator('.library-origin').textContent(),'Built-in');
  }
  const exported=await downloadedJSON(page,run,'exportShapeLibrary()');
  assert.deepEqual(exported.workingCollection,expectedWorking);
  assert.deepEqual(exported.builtinCategoryTags,expectedCategories,'demo-specific memberships are exported separately from canonical definitions');
  const revision=await run('shapeLibraryRevision');await importLibrary(page,exported);
  await page.waitForFunction(previous=>__test.run('shapeLibraryRevision')>previous,revision);
  assert.deepEqual(await inspectDemo(),loaded,'export/reimport keeps categories, pins, order, and canonical identity without creating personal copies');
  assert.equal(await page.locator('#libraryDialog[open]').count(),0,'the canonical cached previews remain inert after reimport');
  assert.equal(await page.evaluate(()=>window.__smartWorkerStarts),0);
  if(await page.locator('#libraryBrowser').isVisible())await page.locator('#closeLibraryBrowserBtn').click();
  let canvas=await page.locator('#canvas').boundingBox();
  for(const [name,x] of [['Starboard tack boat',180],['Clock',480],['Chart',820]]){
    if(await page.locator('#shapePicker').isHidden()) await page.locator('#shapeLibBtn').click();
    await page.getByRole('button',{name:'Place '+name,exact:true}).click();
    canvas=await page.locator('#canvas').boundingBox();
    await page.mouse.click(canvas.x+x,canvas.y+240);
    await run('shapePlacementQueue');
  }
  assert.deepEqual(await run('items.map(it=>it.type)'),['polygon','polygon','ellipse','line','smart','smart']);
  canvas=await page.locator('#canvas').boundingBox();
  const clock=await run('items[4]');
  await page.mouse.dblclick(canvas.x+clock.x+clock.w/2,canvas.y+clock.y+clock.h/2);
  await page.waitForFunction(()=>__test.run('editingSmartIdx')===4);
  const minute=await run(`requestSmartCall(items[4],'handles',[items[4].state,items[4].w,items[4].h,smartResolvedStyle(items[4])]).then(hs=>hs.find(h=>h.id==='minute'))`);
  await page.mouse.move(canvas.x+clock.x+minute.x,canvas.y+clock.y+minute.y);
  await page.mouse.down();
  await page.waitForFunction(()=>__test.run('smartDrag?.handle')==='minute');
  await page.mouse.move(canvas.x+clock.x+clock.w*.85,canvas.y+clock.y+clock.h/2,{steps:5});
  await page.mouse.up();
  await run('smartHitSettled');
  assert.equal(await run('items[4].state.m'),15);
  await run('undo()');assert.equal(await run('items[4].state.m'),10);
  await run('redo()');assert.equal(await run('items[4].state.m'),15);
  const chart=await run('items[5]');
  await page.mouse.dblclick(canvas.x+chart.x+chart.w-40,canvas.y+chart.y+8);
  await page.waitForFunction(()=>__test.run('editingSmartIdx')===5);
  const add=await run(`requestSmartCall(items[5],'handles',[items[5].state,items[5].w,items[5].h,smartResolvedStyle(items[5])]).then(hs=>hs.find(h=>h.id==='add'))`);
  await page.mouse.click(canvas.x+chart.x+add.x,canvas.y+chart.y+add.y);
  await run('smartHitSettled');
  assert.equal(await run('items[5].state.values.length'),5);
  await run('undo()');assert.deepEqual(await run('items[5].state.values'),[30,60,45,80]);
  await page.reload();
  assert.equal(await run('items[4].state.m'),15,'edited demo shapes survive autosave/reload');
  assert.deepEqual(await run('items[5].state.values'),[30,60,45,80]);
}, {origin:'http://simplecanvas.test/simplecanvas',files:{'shapes-library.json':demoLibrary},init:()=>{
  const NativeWorker=window.Worker;
  window.__smartWorkerStarts=0;
  window.Worker=class extends NativeWorker{constructor(...args){super(...args);window.__smartWorkerStarts++;}};
}}));

test('contributor demo entries keep their source scripts, working controls, and saved state',async()=>app(async({page,run})=>{
  const sourceFiles=[['Drill template','drill-template.js'],['Race start timer','race-start-timer.js']];
  const entries=JSON.parse(demoLibrary).shapes;
  for(const [name,file] of sourceFiles){
    assert.equal(entries.find(entry=>entry.name===name).items[0].script.replace(/\r\n/g,'\n'),
      fs.readFileSync(path.join(__dirname,'..','examples',file),'utf8').replace(/\r\n/g,'\n'));
  }
  await page.waitForFunction(count=>__test.run('shapeLibrary?.shapes.length')===count,demoShapeCount);
  for(const [name,x] of [['Drill template',300],['Race start timer',800]]){
    await page.locator('#shapeLibBtn').click();await page.getByRole('button',{name:'Place '+name,exact:true}).click();
    const canvas=await page.locator('#canvas').boundingBox();await page.mouse.click(canvas.x+x,canvas.y+260);
    await run('shapePlacementQueue');
  }
  assert.deepEqual(await run('items.map(it=>it.type)'),['smart','smart']);
  const drill=await run('items[0]');let canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+drill.x+drill.w/2,canvas.y+drill.y+drill.h/2);
  await page.waitForFunction(()=>__test.run('editingSmartIdx')===0);
  const diameter=await run(`requestSmartCall(items[0],'handles',[items[0].state,items[0].w,items[0].h,smartResolvedStyle(items[0])]).then(hs=>hs.find(h=>h.id==='dia'))`);
  canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvas.x+drill.x+diameter.x,canvas.y+drill.y+diameter.y);await page.mouse.down();
  await page.waitForFunction(()=>__test.run('smartDrag?.handle')==='dia');
  await page.mouse.move(canvas.x+drill.x+diameter.x+3,canvas.y+drill.y+diameter.y,{steps:5});await page.mouse.up();await run('smartHitSettled');
  const changedDiameter=await run('items[0].state.holeDiameterMm');assert.ok(changedDiameter>6);
  await run('undo()');assert.equal(await run('items[0].state.holeDiameterMm'),6);await run('redo()');
  const race=await run('items[1]');canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+race.x+race.w-20,canvas.y+race.y+race.h/2);
  await page.waitForFunction(()=>__test.run('editingSmartIdx')===1);
  const orange=await run(`requestSmartCall(items[1],'handles',[items[1].state,items[1].w,items[1].h,smartResolvedStyle(items[1])]).then(hs=>hs.find(h=>h.id==='orange'))`);
  canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.click(canvas.x+race.x+orange.x,canvas.y+race.y+orange.y);await run('smartHitSettled');
  assert.equal(await run('items[1].state.orangeShown'),false);
  await run('undo()');assert.equal(await run('items[1].state.orangeShown'),true);await run('redo()');
  const exported=await downloadedJSON(page,run,'exportProject()');
  assert.equal(exported.items[0].state.holeDiameterMm,changedDiameter);
  assert.equal(exported.items[1].state.orangeShown,false);
  await page.reload();
  assert.equal(await run('items[0].state.holeDiameterMm'),changedDiameter);
  assert.equal(await run('items[1].state.orangeShown'),false);
},{files:{'shapes-library.json':demoLibrary}}));

test('a single HTML deployment works without a shape library',async()=>app(async({page,run})=>{
  await page.waitForLoadState('networkidle');
  assert.equal(await run('shapeLibrary'),null);
  await page.locator('#shapeLibBtn').click();
  assert.equal(await page.locator('#shapeGrid .shape-entry').count(),0);
  await page.locator('#shapeLibBtn').click();
  await page.locator('[data-tool="rect"]').click();
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvas.x+100,canvas.y+100);
  await page.mouse.down();
  await page.mouse.move(canvas.x+260,canvas.y+200,{steps:5});
  await page.mouse.up();
  assert.deepEqual(await run('items.map(it=>it.type)'),['rect']);
  await page.reload();
  assert.deepEqual(await run('items.map(it=>it.type)'),['rect'],'drawing and autosave work without a library');
}));

test('a delayed demo response preserves a library imported during startup',async()=>app(async({page,run})=>{
  let finishDemo,requestStarted;
  const pendingDemo=new Promise(resolve=>{finishDemo=resolve;});
  const responseReady=new Promise(resolve=>{requestStarted=resolve;});
  await page.route('**/shapes-library.json',async route=>{
    requestStarted();await pendingDemo;
    await route.fulfill({contentType:'application/json',body:demoLibrary});
  });
  // Do not wait for the deliberately pending startup fetch's load event.
  await page.reload({waitUntil:'domcontentloaded'});
  await responseReady;
  await importLibrary(page,{shapes:[{name:'My imported shape',items:[rectangle()]}]});
  finishDemo();await page.waitForLoadState('networkidle');
  assert.deepEqual(await run('shapeLibrary.shapes.map(t=>t.name)'),['My imported shape']);
}));

test('startup libraries keep missing smart previews inert until the library is opened and approved',async()=>app(async({page,run})=>{
  const library={shapes:[{name:'Startup smart',items:[smartFixture(slowClickScript)]}]};
  await page.route('**/shapes-library.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(library)}));
  await page.reload();
  await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes.length')===1);
  assert.equal(await page.locator('iframe[sandbox~="allow-scripts"]').count(),0);
  assert.equal(await page.locator('#libraryDialog[open]').count(),0);
  await page.locator('#shapeLibBtn').click();
  await page.locator('#libraryDialog[open]').waitFor();
  await page.locator('#libraryDialogCancel').click();
  assert.equal(await page.locator('iframe[sandbox~="allow-scripts"]').count(),0);
}));

test('ordinary previews are bundled automatically and replacing a shape invalidates its PNG',async()=>app(async({page,run})=>{
  await importLibrary(page,{shapes:[{name:'Box',items:[rectangle()]}]});
  await page.locator('.shape-thumb img').waitFor();
  await page.waitForFunction(()=>__test.run('!shapePreviewJobs.has(shapeLibrary.shapes[0])'));
  assert.equal(await run('shapeLibraryDirty'),false,'automatic previews do not create unexported user changes');
  const first=await downloadedJSON(page,run,'exportShapeLibrary()');
  await run(`items=[{...${JSON.stringify(rectangle())},fillColor:'#3b82f6'}];setTool('select');selection=[0];render();`);
  const replacing=run('replaceLibraryShape(shapeLibrary.shapes[0])');
  await page.locator('#libraryDialogSubmit').click();
  await replacing;
  const second=await downloadedJSON(page,run,'exportShapeLibrary()');
  assert.notEqual(second.shapes[0].thumbnail.png,first.shapes[0].thumbnail.png);
  assert.notEqual(second.shapes[0].thumbnail.source,first.shapes[0].thumbnail.source);
}));

test('a rejected bundled PNG regenerates an ordinary preview without marking the library dirty',async()=>app(async({page,run})=>{
  await importLibrary(page,{shapes:[{name:'Box',items:[rectangle()]}]});
  await page.locator('.shape-thumb img').waitFor();
  const library=await downloadedJSON(page,run,'exportShapeLibrary()');
  const png=Buffer.alloc(33);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(2,16);png.writeUInt32BE(2,20);
  library.shapes[0].name='Recovered box';
  library.shapes[0].thumbnail.png='data:image/png;base64,'+png.toString('base64');
  await importLibrary(page,library);
  await page.getByText('Recovered box',{exact:true}).waitFor();
  await page.waitForFunction(()=>{
    const img=document.querySelector('.shape-thumb img');
    return img?.complete && img.naturalWidth===128 && __test.run('!shapePreviewJobs.has(shapeLibrary.shapes[0])');
  });
  assert.equal(await run('shapeLibraryDirty'),false);
  assert.equal(await page.locator('#libraryDialog[open]').count(),0);
  assert.equal(await page.locator('iframe[sandbox~="allow-scripts"]').count(),0,'ordinary recovery executes no smart code');
  await page.locator('.shape-thumb img').evaluate(img=>{window.oldPreviewError=img.onerror;});
  await run(`items=[${JSON.stringify(rectangle())}];setTool('select');selection=[0];render();`);
  const replacing=run('replaceLibraryShape(shapeLibrary.shapes[0])');
  await page.locator('#libraryDialogSubmit').click();await replacing;
  await page.locator('#shapeLibBtn').click();
  await page.locator('.shape-thumb img').waitFor();
  await page.waitForFunction(()=>__test.run('!shapePreviewJobs.has(shapeLibrary.shapes[0])'));
  assert.equal(await run('shapeLibraryDirty'),true,'an explicit library edit still needs export');
  const replacement=await run('shapeLibrary.shapes[0].thumbnail.png');
  await page.evaluate(()=>window.oldPreviewError());
  assert.equal(await run('shapeLibrary.shapes[0].thumbnail.png'),replacement,'a late old-image error cannot discard the replacement');
}));

test('extra touch pointers cannot release or wedge a smart handle press',async()=>app(async({page,run})=>{
  await run(`items=[${JSON.stringify(smartFixture(slowClickScript))}];setTool('select');selection=[0];editingSmartIdx=0;undoStack=[];render();`);
  for(const secondLift of ['pointerup','pointercancel']){
    await page.evaluate(secondLift=>{
      const canvas=document.querySelector('#canvas'), b=canvas.getBoundingClientRect();
      const emit=(type,id)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',
        isPrimary:id===11,button:0,clientX:b.x+150,clientY:b.y+150}));
      emit('pointerdown',11);emit('pointerdown',22);emit('pointerup',11);emit(secondLift,22);
    },secondLift);
    await page.waitForFunction(()=>__test.run('smartGestureRecords.size')===0);
  }
  assert.equal(await run('items[0].state.n'),2,'one action per primary press, despite the other finger lifting or cancelling');
  const b=await page.locator('#canvas').boundingBox();
  await page.mouse.click(b.x+150,b.y+150);await run('smartHitSettled');
  assert.equal(await run('items[0].state.n'),3,'later gestures still run');
  await run('undo()');assert.equal(await run('items[0].state.n'),2);
}));

test('released smart clicks survive nudges and color changes with independent undo entries',async()=>app(async({page,run})=>{
  const script=slowClickScript.replace('performance.now()+40;while(performance.now()<end){}return {n:',
    'performance.now()+180;while(performance.now()<end){}return {n:');
  for(const action of ['nudge','held nudge','color']){
    await run(`cancelGesture();items=[${JSON.stringify(smartFixture(script))}];setTool('select');selection=[0];editingSmartIdx=0;undoStack=[];redoStack=[];render();`);
    const b=await page.locator('#canvas').boundingBox();
    await page.mouse.click(b.x+150,b.y+150);
    await page.waitForFunction(()=>__test.run('smartSandboxPending.get(smartSandboxActive)?.message.fn')==='dragEdit');
    if(action==='nudge') await page.keyboard.press('ArrowRight');
    else if(action==='held nudge') await page.keyboard.down('ArrowRight');
    else await run(`applyStrokeColor('#0000ff',false)`);
    await run('smartHitSettled');
    assert.equal(await run('items[0].state.n'),1,action+' must retain the completed click');
    if(action==='held nudge') await page.keyboard.up('ArrowRight');
    assert.equal(await run('undoStack.length'),2,action+' and the handle action have separate history');
    await run('undo()');
    if(action==='held nudge'){
      assert.equal(await run('items[0].state.n'),1);assert.equal(await run('items[0].x'),100);
    }else{
      assert.deepEqual(await run('items[0].state'),{});
      assert.equal(await run(action==='nudge'?'items[0].x':'items[0].color'),action==='nudge'?101:'#0000ff');
    }
    await run('undo()');
    assert.deepEqual(await run('items[0].state'),{});assert.equal(await run('items[0].x'),100);
    assert.equal(await run('items[0].color'),'#000000');
    await run('redo();redo()');assert.equal(await run('items[0].state.n'),1);
  }
}));

test('size-changing smart clicks keep nudges and held nudges independently undoable',async()=>app(async({page,run})=>{
  const script=`({apiVersion:2,inputs:{},outputs:{},compute(){return {};},children(){return [];},
    handles(){return [{id:'grow',x:50,y:50,kind:'click'}];},hitEdit(){return 'grow';},contextMenu(){return [{id:'grow',label:'Grow'}];},
    dragEdit(s,id,x,y,w,h){const end=performance.now()+180;while(performance.now()<end){}return {state:{n:(s.n||0)+1},size:{w:w+40}};}})`;
  for(const [held,menu] of [[false,false],[true,false],[true,true]]){
    await run(`cancelGesture();items=[{...${JSON.stringify(smartFixture(script))},componentApi:2,bindings:{},inputValues:{}}];setTool('select');selection=[0];editingSmartIdx=0;undoStack=[];redoStack=[];render();`);
    const original=await run('items[0].w'),b=await page.locator('#canvas').boundingBox();
    if(menu){await page.mouse.click(b.x+150,b.y+150,{button:'right'});await page.locator('[data-smart-context-menu]').getByRole('menuitem',{name:'Grow',exact:true}).click();}
    else await page.mouse.click(b.x+150,b.y+150);
    await page.waitForFunction(()=>__test.run('smartSandboxPending.get(smartSandboxActive)?.message.fn')==='dragEdit');
    if(held)await page.keyboard.down('ArrowRight');else await page.keyboard.press('ArrowRight');
    await run('smartHitSettled');if(held)await page.keyboard.up('ArrowRight');
    assert.deepEqual(await run('[items[0].state.n,items[0].x,items[0].w,undoStack.length]'),[1,101,original+40,2]);
    await run('undo()');
    if(held)assert.deepEqual(await run('[items[0].state.n,items[0].x,items[0].w]'),[1,100,original+40]);
    else assert.deepEqual(await run('[items[0].state,items[0].x,items[0].w]'),[{},101,original]);
    await run('undo()');assert.deepEqual(await run('[items[0].state,items[0].x,items[0].w]'),[{},100,original]);
    await run('redo();redo()');assert.deepEqual(await run('[items[0].state.n,items[0].x,items[0].w]'),[1,101,original+40]);
  }
}));

test('a released smart drag does not leak its provisional state into a following nudge undo',async()=>app(async({page,run})=>{
  const script=`({children(){return [];},handles(){return [{id:'move',x:50,y:50}];},hitEdit(){return 'move';},
    dragEdit(s,id,x){const end=performance.now()+120;while(performance.now()<end){}return {x};}})`;
  await run(`items=[${JSON.stringify(smartFixture(script))}];setTool('select');selection=[0];editingSmartIdx=0;undoStack=[];render();`);
  const b=await page.locator('#canvas').boundingBox();
  await page.mouse.move(b.x+150,b.y+150);await page.mouse.down();
  await page.waitForFunction(()=>__test.run('smartCurrentPress?.mode')==='handle');
  await page.mouse.move(b.x+160,b.y+150);
  await page.waitForFunction(()=>__test.run('items[0].state.x')===60);
  await page.mouse.move(b.x+170,b.y+150);await page.mouse.up();
  await page.keyboard.press('ArrowRight');await run('smartHitSettled');
  assert.equal(await run('items[0].state.x'),70);
  assert.equal(await run('undoStack.length'),2);
  await run('undo()');assert.deepEqual(await run('items[0].state'),{});
  await run('undo()');assert.deepEqual(await run('items[0].state'),{});
  assert.equal(await run('items[0].x'),100);
}));

test('smart edit dots and corner squares follow both item and group rotation',async()=>app(async({page,run})=>{
  const script=`({children(){return [];},handles(){return [{id:'h',x:50,y:50}];},
    hitEdit(s,x,y){return Math.hypot(x-50,y-50)<10?'h':null;},dragEdit(){return {hit:true};}})`;
  await run(`items=[{...${JSON.stringify(smartFixture(script))},rotation:Math.PI/6,group:'g',groupRotation:Math.PI/4},
    {...${JSON.stringify(rectangle('sibling'))},x:400,w:80,h:180,group:'g',groupRotation:Math.PI/4}];
    setTool('select');selection=[0];editingGroupId='g';editingSmartIdx=0;render();`);
  await page.waitForFunction(()=>__test.run("smartHandlesCache.has('smart-test')"));
  const rotate=(x,y,cx,cy,a)=>({x:cx+(x-cx)*Math.cos(a)-(y-cy)*Math.sin(a),y:cy+(x-cx)*Math.sin(a)+(y-cy)*Math.cos(a)});
  // Own rotated rectangle extends left of x=100, shifting the group's geometry pivot.
  const ownLeft=190-90*(Math.cos(Math.PI/6)+Math.sin(Math.PI/6));
  const groupX=(ownLeft+480)/2;
  const world=(x,y)=>{const p=rotate(x,y,190,190,Math.PI/6);return rotate(p.x,p.y,groupX,190,Math.PI/4);};
  const dot=world(150,150), corner=world(98,98);
  for(const p of [dot,corner]){
    const pixel=await run(`Array.from(ctx.getImageData(Math.round(${p.x}*dpr),Math.round(${p.y}*dpr),1,1).data).slice(0,3)`);
    assert.deepEqual(pixel,[99,102,241],'edit marker is painted at its transformed hit location');
  }
  const b=await page.locator('#canvas').boundingBox();
  await page.mouse.click(b.x+dot.x,b.y+dot.y);await run('smartHitSettled');
  assert.equal(await run('items[0].state.hit'),true,'the visible dot also receives the handle press');
}));

test('explicit solid children and zero-width outlines agree on canvas and SVG',async()=>app(async({page,run,context})=>{
  const script=`({children(){return [
    {type:'rect',x:0,y:0,w:120,h:120,size:5,color:'#ff0000'},
    {type:'line',x1:10,y1:25,x2:110,y2:25,size:2,dash:'solid',color:'#0000ff'},
    {type:'line',x1:10,y1:70,x2:110,y2:70,size:0,color:'#ff0000'},
    {type:'rect',x:10,y:85,w:60,h:25,size:0,fill:true,fillColor:'#00ff00',color:'#ff0000'}];}})`;
  await run(`items=[{...${JSON.stringify(smartFixture(script))},dash:'tight'}];setTool('select');selection=[];render();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.has('smart-test')"));
  const pixels=await run(`[...Array.from({length:20},(_,i)=>[120+i*4,125]),[150,170],[140,195]].map(([x,y])=>Array.from(ctx.getImageData(x*dpr,y*dpr,1,1).data).slice(0,3))`);
  assert.ok(pixels.slice(0,20).every(p=>p[0]===0 && p[1]===0 && p[2]===255),'solid child has no inherited dash gaps');
  assert.notDeepEqual(pixels[20],[255,0,0],'zero-width line paints no inherited stroke');
  assert.deepEqual(pixels[21],[0,255,0],'zero-width outline preserves the fill');
  const svg=await run('itemsToSVGMarkup(items)');
  const preview=await context.newPage();await preview.setContent(svg);
  const solid=preview.locator('path[stroke="#0000ff"]');
  assert.equal(await solid.getAttribute('stroke-dasharray'),null);
  assert.equal(await preview.locator('path[stroke="#ff0000"]').getAttribute('stroke-width'),'0');
}));

test('loaded smart state enforces the hook contract before replacing a library or editing a sketch',async()=>app(async({page,run})=>{
  await importLibrary(page,{shapes:[{name:'Keep',items:[rectangle()]}]});
  await page.locator('.shape-thumb img').waitFor();
  const result=await run(`(()=>{
    const good=${JSON.stringify(smartFixture('({children(){return [];}})',{data:[true,null,7]}))};
    let deep={};for(let i=0;i<18;i++)deep={child:deep};
    const invalid=[{constructor:1},JSON.parse('{"__proto__":{}}'),{data:{prototype:1}},deep,[],null,{n:Infinity}];
    return {kept:normalizeScene([good],{},FORMAT_VERSION).items[0].state,
      rejected:invalid.map(state=>normalizeScene([{...good,state}],{},FORMAT_VERSION).items.length),
      missing:normalizeItem({...good,state:undefined},{}).state};
  })()`);
  assert.deepEqual(result,{kept:{data:[true,null,7]},rejected:Array(7).fill(0),missing:{}});
  await importLibrary(page,{shapes:[{name:'Invalid',items:[smartFixture('({children(){return [];}})',{constructor:1})]}]});
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Invalid object'));
  assert.equal(await run('shapeLibrary.shapes[0].name'),'Keep');
}));

test('slow smart queues do not turn text double-clicks or double-taps into alignment changes',async()=>app(async({page,run})=>{
  const slow=`({children(){const end=performance.now()+90;while(performance.now()<end){}return [];}})`;
  for(const smartEdit of [false,true])for(const touch of [false,true]){
    await run(`cancelGesture();items=[${JSON.stringify(smartFixture(slowClickScript))},
      {type:'text',uid:'text',x:400,y:100,w:200,h:70,text:'Edit me',font:'400 24px sans-serif',size:2,color:'#000000',align:'center',strokeOn:false,fill:false}];
      setTool('select');selection=[1];editingSmartIdx=${smartEdit?'0':'null'};undoStack=[];render();
      smartHitSettled=Promise.all(Array.from({length:8},()=>requestSmartCall(${JSON.stringify(slow)},'children',[])));
    `);
    const b=await page.locator('#canvas').boundingBox();
    if(touch) await page.evaluate(({x,y})=>{
      const canvas=document.querySelector('#canvas');
      for(let i=0;i<2;i++)for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,
        {bubbles:true,pointerId:11,pointerType:'touch',isPrimary:true,button:0,clientX:x,clientY:y}));
    },{x:b.x+425,y:b.y+135});
    else await page.mouse.dblclick(b.x+425,b.y+135);
    await page.waitForFunction(()=>__test.run('editingTextIdx')===1);
    assert.equal(await run('items[1].align'),'center');assert.equal(await run('undoStack.length'),0);
    await page.keyboard.press('Escape');
  }
}));

test('smart thumbnails and tight SVG/PNG exports include outside labels and thick child strokes',async()=>app(async({page,run,context})=>{
  const script=`({children(){return [
    {type:'rect',x:0,y:0,w:100,h:100,size:60,color:'#ff0000'},
    {type:'text',x:0,y:-70,w:100,h:30,text:'OUTSIDE',size:0,strokeOn:false,textColor:'#0000ff',fontSize:20}];}})`;
  const shape={...smartFixture(script),w:100,h:100,rotation:.3};
  await run(`items=[${JSON.stringify(shape)}];setTool('select');selection=[];render();`);
  const geometry=await run('bbox(items[0])');
  const svg=await run('itemsToSVGMarkup(items)');
  const preview=await context.newPage();await preview.setContent(svg);
  const measured=await preview.locator('svg').evaluate(svg=>{
    const outer=svg.getBoundingClientRect();
    return [...svg.querySelectorAll('text')].map(el=>{const b=el.getBoundingClientRect();return {x:b.x-outer.x,y:b.y-outer.y,right:b.right-outer.x,bottom:b.bottom-outer.y,w:outer.width,h:outer.height};});
  });
  for(const b of measured)assert.ok(b.x>=0 && b.y>=0 && b.right<=b.w && b.bottom<=b.h,'outside label fits rotated SVG');
  const dimensions=await run('itemsToPngBlob(items,{background:false,scale:1,margin:0}).then(createImageBitmap).then(im=>({w:im.width,h:im.height}))');
  assert.ok(dimensions.w>190 && dimensions.h>220,'PNG includes painted children beyond the 100px container');
  const thumb=await run('shapeThumbSVGAsync(items)');
  const viewBox=/viewBox="([^"]+)"/.exec(thumb)[1].split(' ').map(Number);
  assert.ok(viewBox[2]>190 && viewBox[3]>220,'thumbnail includes the same painted area');
  assert.deepEqual(await run('bbox(items[0])'),geometry,'export bounds never change editing geometry');
}));

test('thumbnail and child SVG injection cannot reach the page on import, generation, or export',async()=>app(async({page,run,context})=>{
  await page.evaluate(()=>localStorage.setItem('security-sentinel','test-only'));
  const injected='100"/><image href="data:," onerror="window.leak=localStorage.getItem(\'security-sentinel\')"/><rect width="100';
  const script=`({children(){return [
    {type:'rect',x:0,y:0,w:${JSON.stringify(injected)},h:100,strokeOn:false,fill:true,fillColor:'#000000'},
    {type:'rect',x:0,y:0,w:20,h:30,fill:true,fillColor:'#22c55e',strokeOn:false}];}})`;
  const fixture=smartFixture(script);
  const fake='data:image/png;base64,'+Buffer.from('<svg onload="window.leak=1"/>').toString('base64');
  await importLibrary(page,{shapes:[{name:'Attack',items:[fixture],thumbnail:{version:1,png:fake,source:'forged'}}]});
  await page.locator('#libraryDialog[open]').waitFor();
  await page.locator('#libraryDialogSubmit').click();
  await page.locator('.shape-thumb img').waitFor();
  assert.equal(await page.evaluate(()=>window.leak),undefined);
  await run(`items=[${JSON.stringify(fixture)}];render();`);
  const svg=await run('itemsToSVGMarkup(items)');
  assert.ok(svg.includes('#22c55e'),'the valid sibling still exports');
  assert.ok(!svg.includes('onerror') && !svg.includes('<image'));
  const exported=await downloadedHTML(page,run);
  const view=await context.newPage();
  await view.setContent(exported);
  assert.equal(await view.evaluate(()=>window.leak),undefined);
  await view.close();
}));

test('opaque Worker policy blocks recovered network APIs, imports and storage over HTTP and file URLs',async()=>{
  const script=`({children(){
    const r=self.probeResult||(self.probeResult={});
    if(!r.started){r.started=true;
      WorkerGlobalScope.prototype.fetch.call(self,'https://blocked.test/fetch').then(()=>r.fetch='allowed',()=>r.fetch='blocked');
      import('https://blocked.test/module.js').then(()=>r.module='allowed',()=>r.module='blocked');
      try{WorkerGlobalScope.prototype.importScripts.call(self,'https://blocked.test/script.js');r.importScripts='allowed';}catch(e){r.importScripts='blocked';}
      try{Object.getOwnPropertyDescriptor(WorkerGlobalScope.prototype,'indexedDB').get.call(self).open('test');r.storage='allowed';}catch(e){r.storage='blocked';}
    }
    return [{type:'text',text:JSON.stringify(r),x:0,y:0,w:180,h:100,strokeOn:false,fill:false}];
  }})`;
  for(const origin of ['http://simplecanvas.test','file://'+path.resolve(__dirname,'..')]){
    await app(async({page,run,context})=>{
      const requests=[];
      await context.route('https://blocked.test/**',route=>{requests.push(route.request().url());return route.fulfill({contentType:'text/javascript',body:'export const ok=1;'});});
      await run(`window.policyProbe={script:${JSON.stringify(script)}};requestSmartCall(policyProbe,'children',[])`);
      await page.waitForTimeout(100);
      const kids=await run(`requestSmartCall(policyProbe,'children',[])`);
      const r=JSON.parse(kids[0].text);
      for(const key of ['fetch','module','importScripts','storage']) assert.equal(r[key],'blocked',key+' on '+origin);
      assert.deepEqual(requests,[],'no blocked request reaches the network');
    },{origin});
  }
});

test('malformed and oversized hook results cannot poison rendering, handles, state or export',async()=>app(async({page,run})=>{
  const script=`({children(s){if(!s.good)return {};return [{type:'rect',x:0,y:0,w:20,h:30,fill:true,fillColor:'#22c55e'}];},handles(){return {};}})`;
  await run(`items=[${JSON.stringify(smartFixture(script))},${JSON.stringify(rectangle('other'))}];setTool('select');selection=[0];editingSmartIdx=0;render();`);
  await page.waitForTimeout(100);
  await run('render()');
  const svg=await run('itemsToSVGMarkup(items)');
  assert.ok(svg.includes('#ffd166'),'the other drawing still exports');
  const values=await run(`(async()=>{
    const results=[];
    for(const [src,hook] of [
      ['({children(){return Array(1001).fill({type:"rect",x:0,y:0,w:1,h:1})}})','children'],
      ['({children(){return []},handles(){return [{id:"a",x:1,y:2},{id:"a",x:2,y:3}]}})','handles'],
      ['({children(){return []},initState(){return {tooLong:"x".repeat(4001)}}})','initState'],
      ['({children(){return []},dragEdit(){return []}})','dragEdit'],
      ['({children(){return []},initStyle(){return {w:"100"}}})','initStyle']
    ])results.push(await requestSmartCall(src,hook,[]));
    return results;
  })()`);
  assert.deepEqual(values,[null,null,null,null,{}]);
  await run('render()');
}));

test('all shipped templates and contributor examples retain arcs, zero-width outlines and outside labels',async()=>app(async({run})=>{
  const examples=['drill-template.js','race-start-timer.js'].map(name=>fs.readFileSync(path.join(__dirname,'..','examples',name),'utf8'));
  const result=await run(`(async()=>{
    const scripts=[...Object.entries(SMART_TEMPLATES).map(([name,t])=>({name,script:t.script})),
      ...${JSON.stringify(examples)}.map((script,i)=>({name:'contributor-'+i,script}))];
    const outputs=[];
    for(const {name,script} of scripts){
      const caps=await requestSmartCaps(script);
      if(caps.apiVersion===2){
        const it={...${JSON.stringify(smartFixture(''))},script};ensureUids([it]);
        await initializeSmartItem(it,caps);
        const cache=await warmSmartExportCache([it],true);
        outputs.push({name,kids:cache.get(it)});
        continue;
      }
      const state=await requestSmartCall(script,'initState',[])||{};
      const init=await requestSmartCall(script,'initStyle',[])||{};
      const it={...${JSON.stringify(smartFixture(''))},...init,script,state,w:init.w||180,h:init.h||180};it.font=fontStr(it.fontFamily,it.fontSize);
      const r=await requestSmartSandbox({method:'call',src:script,fn:'children',args:[state,smartResolvedStyle(it),it.w,it.h,true]});
      outputs.push({name,kids:r.result});
    }
    return outputs;
  })()`);
  assert.equal(result.length,14);
  for(const {name,kids} of result) assert.ok(kids.length || name==='blank','template '+name+' remains visible');
  const race=result.find(r=>r.name==='contributor-1').kids;
  assert.ok(race.some(c=>c.size===0 && c.strokeOn===false));
  assert.ok(race.some(c=>c.y<0),'label above the box remains valid');
  assert.ok(race.some(c=>c.points?.some(p=>p.arcTo)),'arc descriptors survive validation');
}));

test('two quick smart handle clicks each change state and create an undo entry; no-op clicks do not',async()=>app(async({page,run})=>{
  await run(`items=[${JSON.stringify(smartFixture(slowClickScript))}];setTool('select');selection=[0];editingSmartIdx=0;undoStack=[];redoStack=[];render();`);
  await page.waitForTimeout(100);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+150,box.y+150);
  await page.mouse.click(box.x+150,box.y+150);
  await run('smartHitSettled');
  assert.equal(await run('items[0].state.n'),2);
  assert.equal(await run('undoStack.length'),2);
  await run('undo()');assert.equal(await run('items[0].state.n'),1);
  await run('undo()');assert.deepEqual(await run('items[0].state'),{});
  await run('redo()');await run('redo()');assert.equal(await run('items[0].state.n'),2);
  const noOp=slowClickScript.replace('return {n:(s.n||0)+1};','return s;');
  await run(`items[0].script=${JSON.stringify(noOp)};selection=[0];editingSmartIdx=0;render();`);
  await page.mouse.click(box.x+150,box.y+150);await run('smartHitSettled');
  assert.equal(await run('undoStack.length'),2);
}));

test('outside smart-edit misses complete quick selection, deselection and buffered dragging',async()=>app(async({page,run})=>{
  async function seed(){
    await run(`items=[${JSON.stringify(smartFixture(slowClickScript))},{...${JSON.stringify(rectangle('other'))},x:400}];setTool('select');selection=[0];editingSmartIdx=0;undoStack=[];render();`);
    await page.waitForTimeout(100);return page.locator('#canvas').boundingBox();
  }
  let b=await seed();
  await page.mouse.click(b.x+450,b.y+150);await run('smartHitSettled');
  assert.deepEqual(await run('selection'),[1]);assert.equal(await run('editingSmartIdx'),null);
  assert.equal(await run('drag'),null);
  b=await seed();await page.mouse.click(b.x+750,b.y+450);await run('smartHitSettled');
  assert.deepEqual(await run('selection'),[]);assert.equal(await run('marquee'),null);
  b=await seed();await page.mouse.move(b.x+450,b.y+150);await page.mouse.down();
  await page.mouse.move(b.x+490,b.y+170);await page.mouse.up();await run('smartHitSettled');
  assert.equal(await run('items[1].x'),440);assert.equal(await run('items[1].y'),120);
  assert.equal(await run('undoStack.length'),1);await run('undo()');assert.equal(await run('items[1].x'),400);
}));

test('cancel, delete, undo and tab switches invalidate delayed smart state updates',async()=>app(async({page,run})=>{
  const delayed=slowClickScript.replace('performance.now()+40;while(performance.now()<end){}return {n:', 'performance.now()+120;while(performance.now()<end){}return {n:');
  for(const action of ['cancelGesture()','deleteSelected()','undo()','newTab()']){
    await run(`cancelGesture();items=[${JSON.stringify(smartFixture(delayed))}];setTool('select');selection=[0];editingSmartIdx=0;undoStack=[];historyBefore=null;render();`);
    await page.waitForTimeout(100);
    const b=await page.locator('#canvas').boundingBox();await page.mouse.click(b.x+150,b.y+150);
    await page.waitForTimeout(60);await run(action);await page.waitForTimeout(200);
    if(action==='newTab()'){
      const stored=await run(`Array.from(tabDocuments.values()).flatMap(doc=>doc.items).filter(it=>it.uid==='smart-test').map(it=>it.state)`);
      assert.ok(stored.every(s=>!s.n),'old tab must not receive a stale state reply');
    } else assert.ok((await run('items.map(it=>it.state)')).every(s=>!s?.n),action+' must stop delayed updates');
  }
}));

test('malformed Worker envelopes fail cleanly and the next smart shape still runs',async()=>app(async({run})=>{
  for(const wire of ['null','[]','42']){
    const script=`({children(){postMessage(${JSON.stringify(wire)});return [];}})`;
    assert.equal(await run(`requestSmartCall(${JSON.stringify(script)},'children',[])`),null);
    const control=await run(`requestSmartCall('({children(){return [{type:"rect",x:0,y:0,w:20,h:30}];}})','children',[])`);
    assert.equal(control.length,1,'a fresh Worker recovers after the malformed message');
  }
}));

test('validated smart text preserves italic font weights',async()=>app(async({run})=>{
  const script=`({children(){return ['italic 700 12px Georgia,"Times New Roman",serif','italic bold 14px sans-serif'].map(font=>({type:'text',text:'Label',x:0,y:0,w:80,h:30,font}));}})`;
  const kids=await run(`requestSmartCall(${JSON.stringify(script)},'children',[])`);
  assert.deepEqual(kids.map(c=>c.font),['italic 700 12px Georgia,"Times New Roman",serif','italic bold 14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif']);
}));

test('smart drag release never applies the same movement twice, including an in-flight final move',async()=>app(async({page,run})=>{
  const script=`({
    children(){return [{type:'rect',x:0,y:0,w:180,h:180}];},
    handles(){return [{id:'move',x:50,y:50}];},hitEdit(){return 'move';},
    dragEdit(s,id,x,y){const end=performance.now()+40;while(performance.now()<end){}return {n:(s.n||0)+1,x,y};}
  })`;
  for(const settled of [true,false]){
    await run(`cancelGesture();items=[${JSON.stringify(smartFixture(script))}];setTool('select');selection=[0];editingSmartIdx=0;undoStack=[];historyBefore=null;render();`);
    const b=await page.locator('#canvas').boundingBox();
    await page.mouse.move(b.x+150,b.y+150);await page.mouse.down();
    await page.waitForFunction(()=>__test.run('smartCurrentPress?.mode')==='handle');
    await page.mouse.move(b.x+170,b.y+180);
    if(settled) await page.waitForFunction(()=>__test.run('items[0].state.n')===1);
    await page.mouse.up();await run('smartHitSettled');
    assert.deepEqual(await run('items[0].state'),{n:1,x:70,y:80});
    assert.equal(await run('undoStack.length'),1);
    await run('undo()');assert.deepEqual(await run('items[0].state'),{});
  }
}));

test('cancelled smart double-clicks and touch taps cannot act on a replacement tab or reopen editing',async()=>app(async({page,run})=>{
  const delayed=slowClickScript.replace('performance.now()+40;while(performance.now()<end){}return Math.hypot','performance.now()+120;while(performance.now()<end){}return Math.hypot');
  async function seed(){
    await run(`cancelGesture();items=[${JSON.stringify(smartFixture(delayed))}];setTool('select');selection=[0];editingSmartIdx=0;undoStack=[];render();`);
    return page.locator('#canvas').boundingBox();
  }
  for(const action of ['newTab()','cancelGesture()']){
    const b=await seed();await page.mouse.dblclick(b.x+150,b.y+150);await run(action);
    await run('smartHitSettled');await page.waitForTimeout(20);
    assert.equal(await run('editingSmartIdx'),null,'the cancelled double-click cannot reopen editing');
    assert.equal(await run('ui.tool'),action==='newTab()'?'pen':'select');
  }
  const b=await seed();await page.mouse.click(b.x+150,b.y+150);
  await run(`lastTap={t:performance.now(),x:${b.x+150},y:${b.y+150}};
    void onTapUp({pointerType:'touch',clientX:${b.x+150},clientY:${b.y+150}});newTab();`);
  await run('smartHitSettled');await page.waitForTimeout(20);
  assert.equal(await run('ui.tool'),'pen','a delayed touch double-tap cannot switch the new tab’s tool');
  assert.equal(await run('editingSmartIdx'),null);
}));

test('Manage opens existing smart source without executing it; cancelling an async save keeps the definition',async()=>app(async({page,run})=>{
  const original=smartFixture(slowClickScript,{n:7});
  await importLibrary(page,{shapes:[{name:'Counter',items:[original]},{name:'Box',items:[rectangle()]}]});
  await page.locator('#libraryDialogCancel').click();await page.locator('#manageShapesBtn').click();
  assert.equal(await page.getByRole('button',{name:'Edit Box',exact:true}).count(),0);
  await page.getByRole('button',{name:'Edit Counter',exact:true}).click();
  assert.equal(await page.locator('#smartObjectNameInput').inputValue(),'Counter');
  assert.equal(await page.locator('#smartObjectNameField').isHidden(),true,'editing an existing source does not offer library renaming');
  assert.equal(await page.locator('#smartObjectNameInput').isDisabled(),true,'the hidden creation-only field is excluded from editing');
  assert.equal(await page.locator('#smartObjectScriptInput').evaluate(element=>element===document.activeElement),true,'source editing focuses the script');
  assert.equal(await page.locator('#smartObjectScriptInput').inputValue(),slowClickScript);
  assert.deepEqual(await page.locator('#smartObjectScriptInput').evaluate(input=>({start:input.selectionStart,top:input.scrollTop,left:input.scrollLeft})),
    {start:0,top:0,left:0},'opening a script starts at its first line');
  assert.equal(await page.locator('#smartTemplateRow').isVisible(),false);
  assert.equal(await page.locator('iframe[sandbox~="allow-scripts"]').count(),0,'reading code alone does not execute it');
  const assertEditorFits=async(width,height)=>{
    const dialog=await page.locator('#smartObjectDialog').boundingBox(),editor=await page.locator('#smartObjectScriptInput').boundingBox();
    const buttons=await Promise.all(['#smartObjectDialogCancel','#smartObjectDialogSubmit'].map(selector=>page.locator(selector).boundingBox()));
    assert.ok(dialog.x>=-.5 && dialog.y>=-.5 && dialog.x+dialog.width<=width+.5 && dialog.y+dialog.height<=height+.5,
      'the source dialog fits the '+width+'×'+height+' viewport');
    assert.ok(editor.width>0 && editor.height>0 && editor.x>=dialog.x && editor.x+editor.width<=dialog.x+dialog.width+.5,
      'the script editor stays inside the dialog');
    assert.ok(editor.y+editor.height<=Math.min(...buttons.map(button=>button.y))+.5,'the script editor does not cover Save or Cancel');
    for(const button of buttons)assert.ok(button.y>=0 && button.y+button.height<=height+.5 && button.x>=0 && button.x+button.width<=width+.5,
      'Save and Cancel stay visible without scrolling the dialog');
    return {dialog,editor};
  };
  const desktop=await assertEditorFits(1280,900);
  assert.ok(desktop.dialog.width>850 && desktop.editor.width>800,'desktop source editing uses the available width');
  assert.ok(desktop.editor.height>350,'desktop source editing provides substantially more than the old ten-row area');
  await page.setViewportSize({width:390,height:844});await assertEditorFits(390,844);
  await page.setViewportSize({width:844,height:390});await assertEditorFits(844,390);
  await page.setViewportSize({width:1280,height:900});
  await page.locator('#smartObjectScriptInput').fill('({children(){return [];}})');
  await page.locator('#smartObjectDialogCancel').click();
  assert.equal(await run('shapeLibrary.shapes[0].items[0].script'),slowClickScript);
  await page.getByRole('button',{name:'Edit Counter',exact:true}).click();
  const delayed=`(()=>{const end=performance.now()+120;while(performance.now()<end){}return {children(){return [];}}})()`;
  await page.locator('#smartObjectScriptInput').fill(delayed);
  await page.locator('#smartObjectDialogSubmit').click();
  await page.locator('#smartObjectDialogCancel').click();await page.waitForTimeout(200);
  assert.equal(await run('shapeLibrary.shapes[0].items[0].script'),slowClickScript);
  assert.deepEqual(await run('shapeLibrary.shapes[0].items[0].state'),{n:7});
}));

test('source edits update the library and bundled PNG, survive export, and preserve placed instances',async()=>app(async({page,run})=>{
  const oldScript=`({children(){return [{type:'rect',x:0,y:0,w:180,h:180,fill:true,fillColor:'#dc2626'}];}})`;
  const newScript=oldScript.replace('#dc2626','#3b82f6');
  await importLibrary(page,{shapes:[{name:'Color box',items:[smartFixture(oldScript,{n:7})]}]});
  await page.locator('#libraryDialogSubmit').click();await page.locator('.shape-thumb img').waitFor();
  const before=await downloadedJSON(page,run,'exportShapeLibrary()');
  await run("placeShapeAt(shapeLibrary.shapes[0],400,300)");
  await page.locator('#shapeLibBtn').click();await page.locator('#manageShapesBtn').click();
  await page.getByRole('button',{name:'Edit Color box',exact:true}).click();
  assert.equal(await page.locator('#smartObjectNameField').isHidden(),true);
  assert.equal(await page.locator('#smartObjectNameInput').isDisabled(),true);
  await page.locator('#smartObjectNameInput').evaluate(input=>{input.value='Renamed by a stale form';});
  await page.locator('#smartObjectScriptInput').fill('({initState(){return {};}})');
  await page.locator('#smartObjectDialogSubmit').click();
  await page.waitForFunction(()=>document.querySelector('#smartObjectDialogError').textContent.includes('children'));
  assert.equal(await run('shapeLibrary.shapes[0].items[0].script'),oldScript);
  await page.locator('#smartObjectScriptInput').fill(newScript);await page.locator('#smartObjectDialogSubmit').click();
  await page.waitForFunction(()=>!document.querySelector('#smartObjectDialog').open);
  const after=await downloadedJSON(page,run,'exportShapeLibrary()');
  assert.equal(after.shapes.length,1,'saving updates the entry instead of adding a duplicate');
  assert.equal(after.shapes[0].name,'Color box','saving source ignores changes to the hidden creation-only name field');
  assert.deepEqual(after.shapes[0].items[0],{...before.shapes[0].items[0],script:newScript});
  assert.notEqual(after.shapes[0].thumbnail.png,before.shapes[0].thumbnail.png);
  assert.equal(await run('items[0].script'),oldScript,'placed instances keep their own definition');
  await page.reload();await importLibrary(page,after);
  assert.equal(await page.locator('#libraryDialog[open]').count(),0,'the edited preview is bundled');
  await page.locator('#manageShapesBtn').click();
  await page.getByRole('button',{name:'Edit Color box',exact:true}).click();
  assert.equal(await page.locator('#smartObjectScriptInput').inputValue(),newScript);
  await page.locator('#smartObjectDialogCancel').click();
  await page.locator('#newSmartObjectBtn').click();
  assert.equal(await page.locator('#smartTemplateRow').isVisible(),true);
  assert.equal(await page.locator('#smartObjectNameField').isVisible(),true,'creation restores the name field after source editing');
  assert.equal(await page.locator('#smartObjectNameInput').isEnabled(),true);
  assert.equal(await page.locator('#smartObjectNameInput').evaluate(element=>element===document.activeElement),true,'new-shape creation still starts with its name');
  await page.locator('#smartObjectNameInput').fill('New shape');
  await page.locator('#smartObjectScriptInput').fill(newScript);await page.locator('#smartObjectDialogSubmit').click();
  await page.waitForFunction(()=>!document.querySelector('#smartObjectDialog').open);
  assert.deepEqual(await run('shapeLibrary.shapes.map(t=>t.name)'),['Color box','New shape']);
}));

test('composite library entries expose each smart script and edit only the chosen component',async()=>app(async({page,run})=>{
  const first=smartFixture(slowClickScript,{n:1}),second={...smartFixture('({children(){return [];}})',{n:2}),x:350};
  await importLibrary(page,{shapes:[{name:'Composite',items:[first,rectangle(),second]}]});
  await page.locator('#libraryDialogCancel').click();await page.locator('#manageShapesBtn').click();
  await page.getByRole('button',{name:'Edit 2 Composite',exact:true}).click();
  assert.equal(await page.locator('#smartObjectScriptInput').inputValue(),second.script);
  const updated='({children(){return [{type:"ellipse",x:0,y:0,w:50,h:50}];}})';
  await page.locator('#smartObjectScriptInput').fill(updated);await page.locator('#smartObjectDialogSubmit').click();
  await page.waitForFunction(()=>!document.querySelector('#smartObjectDialog').open);
  const exported=await downloadedJSON(page,run,'exportShapeLibrary()');
  assert.equal(exported.shapes[0].name,'Composite');
  assert.equal(exported.shapes[0].items[0].script,first.script);
  assert.equal(exported.shapes[0].items[1].type,'rect');
  assert.deepEqual(exported.shapes[0].items[2].state,{n:2});
  assert.equal(exported.shapes[0].items[2].script,updated);
}));

test('each smart placement initializes fresh state and style, including imported definitions without state',async()=>app(async({page,run})=>{
  const script=`({initState(){return {stamp:Date.now()};},initStyle(){return {fillColor:'#3b82f6',size:5,w:120,h:80};},children(){return [];}})`;
  await run(`shapeLibrary=normalizeShapeLibrary({shapes:[{name:'Fresh',items:[${JSON.stringify(smartFixture(script,{stamp:0}))}]}]});items=[];undoStack=[];`);
  const start=Date.now();await run('placeShapeAt(shapeLibrary.shapes[0],300,200)');
  await page.waitForTimeout(5);await run('placeShapeAt(shapeLibrary.shapes[0],600,400)');
  const placed=await run('items');
  assert.equal(placed.length,2);
  assert.ok(placed[0].state.stamp>=start);assert.ok(placed[1].state.stamp>placed[0].state.stamp);
  for(const [i,it] of placed.entries()){
    assert.equal(it.fillColor,'#3b82f6');assert.equal(it.size,5);assert.equal(it.w,120);assert.equal(it.h,80);
    assert.equal(it.x+it.w/2,i===0?300:600);assert.equal(it.y+it.h/2,i===0?200:400);
  }
  assert.equal(await run('undoStack.length'),2);
  await run('undo()');assert.equal(await run('items.length'),1);
  await run('redo()');assert.equal(await run('items[1].state.stamp'),placed[1].state.stamp,'redo restores the initialized instance');
  assert.deepEqual(await run('shapeLibrary.shapes[0].items[0].state'),{stamp:0},'placement never changes the definition');
  await run(`const raw=${JSON.stringify(smartFixture(script))};delete raw.state;
    const imported=normalizeShapeLibrary({shapes:[{name:'Missing state',items:[raw]}]});placeShapeAt(imported.shapes[0],800,400);`);
  await page.waitForFunction(()=>__test.run('items.length')===3);
  assert.ok(await run('items[2].state.stamp')>=start);
}));

test('queued smart hooks each receive a full execution budget',async()=>app(async({run})=>{
  const script=`({children(s){const end=performance.now()+90;while(performance.now()<end){}return [{type:'text',text:String(s.n),x:0,y:0,w:100,h:40}];}})`;
  const result=await run(`Promise.all([0,1,2,3].map(n=>requestSmartCall(${JSON.stringify(script)},'children',[{n}])))`);
  assert.deepEqual(result.map(k=>k?.[0]?.text),['0','1','2','3']);
}));

test('rapid smart placements keep their order and undo entries; cancellation discards pending initialization',async()=>app(async({page,run})=>{
  const script=`({n:0,initState(){const end=performance.now()+50;while(performance.now()<end){}return {n:++this.n};},children(){return [];}})`;
  await importLibrary(page,{shapes:[{name:'Fresh',items:[smartFixture(script)]}]});
  await page.locator('#libraryDialogCancel').click();
  await run('armShapeForPlacement(shapeLibrary.shapes[0])');
  const b=await page.locator('#canvas').boundingBox();await page.mouse.dblclick(b.x+400,b.y+300);
  await run('shapePlacementQueue');
  assert.deepEqual(await run('items.map(it=>it.state.n)'),[1,1],'each placement owns a fresh definition realm');
  assert.equal(await run('undoStack.length'),2);await run('undo()');assert.equal(await run('items.length'),1);
  await run('undo()');assert.equal(await run('items.length'),0);
  for(const action of ['newTab()','undo()','setTool("pen")','cancelGesture()','Escape','clearAll()']){
    await run('cancelGesture();items=[];undoStack=[];setTool("select");void placeShapeAt(shapeLibrary.shapes[0],300,200);');
    await page.waitForFunction(()=>__test.run('smartSandboxPending.get(smartSandboxActive)?.message.fn')==='initState');
    if(action==='Escape') await page.keyboard.press('Escape');else await run(action);
    await run('shapePlacementQueue');
    assert.equal(await run('items.length'),0,action+' cancels the pending placement');
    assert.ok(await run('Array.from(tabDocuments.values()).every(doc=>!doc.items.some(it=>it.type==="smart"))'),'no stale shape is added to a background tab');
  }
}));

test('failed exports cannot reuse edit-only children, while matching non-editing fallback remains usable',async()=>app(async({page,run})=>{
  for(const failure of ['throw new Error("broken export")','while(true){}']){
    const script=`({children(s,style,w,h,editing){if(!editing){${failure};}return [{type:'text',text:'EDIT ONLY',x:0,y:0,w:180,h:50}];}})`;
    await run(`cancelGesture();items=[];setTool('select');items=[${JSON.stringify(smartFixture(script))},${JSON.stringify(rectangle('other'))}];selection=[0];editingSmartIdx=0;render();`);
    await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.kids.some(k=>k.text==='EDIT ONLY')"));
    const svg=await run('itemsToSVGMarkup(items)');
    assert.ok(!svg.includes('EDIT ONLY'),'editing content must never appear in export');assert.ok(svg.includes('#ffd166'));
  }
  const control=`(()=>{let n=0;return {children(){if(n++)throw new Error('refresh failed');return [{type:'text',text:'NORMAL CONTENT',x:0,y:0,w:180,h:50}];}}})()`;
  await run(`cancelGesture();items=[${JSON.stringify(smartFixture(control))}];render();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('smart-test')?.kids.some(k=>k.text==='NORMAL CONTENT')"));
  assert.ok((await run('itemsToSVGMarkup(items)')).includes('NORMAL CONTENT'));
}));

test('removed smart shapes and replaced scripts are evicted, including late cache replies',async()=>app(async({page,run})=>{
  await run(`items=[${JSON.stringify(smartFixture(slowClickScript))}];setTool('select');selection=[0];editingSmartIdx=0;render();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.has('smart-test') && smartHandlesCache.has('smart-test')"));
  await run('deleteSelected()');
  assert.equal(await run("smartChildrenCache.has('smart-test') || smartHandlesCache.has('smart-test') || smartBackoffUntil.has('smart-test')"),false);
  const delayed=`({children(){const end=performance.now()+90;while(performance.now()<end){}return [];},handles(){return [];}})`;
  await run(`items=[${JSON.stringify(smartFixture(delayed))}];selection=[0];editingSmartIdx=0;render();deleteSelected();`);
  await page.waitForTimeout(250);
  assert.equal(await run("smartChildrenCache.has('smart-test') || smartHandlesCache.has('smart-test') || smartBackoffUntil.has('smart-test')"),false,'late replies cannot repopulate removed entries');
  await run(`items=[${JSON.stringify(smartFixture(slowClickScript))}];selection=[0];editingSmartIdx=0;render();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.has('smart-test') && smartHandlesCache.has('smart-test')"));
  await run(`items[0].script=${JSON.stringify(delayed)};render();`);
  assert.equal(await run("smartChildrenCache.has('smart-test') || smartHandlesCache.has('smart-test')"),false,'old script data is released before a replacement reply');
}));

test('resident instance Workers are bounded and evicted realms never transfer globals',async()=>app(async({run})=>{
  const script=`({children(s){self.calls=(self.calls||0)+1;return [{type:'text',text:s.value+':'+self.calls+':'+(self.poison||'clean'),x:0,y:0,w:120,h:30}];}})`;
  const result=await run(`(async()=>{
    const cold={script:${JSON.stringify(script)},state:{value:7}},hot={script:${JSON.stringify(script)},state:{value:9}};
    const read=async it=>(await requestSmartCall(it,'children',[it.state]))[0].text;
    const first=await read(cold),again=await read(cold),hotValues=[];
    await requestSmartCall({script:'(self.poison="attacker",{children(){return [];}})'},'children',[]);
    for(let n=0;n<SMART_MAX_RESIDENT_WORKERS+3;n++){
      await requestSmartCall({script:${JSON.stringify(script)},state:{value:n}},'children',[{value:n}]);
      hotValues.push(await read(hot));
    }
    return {first,again,hotValues,coldAfter:await read(cold),state:cold.state,stats:{...smartRuntimeStats},limit:SMART_MAX_RESIDENT_WORKERS};
  })()`);
  assert.equal(result.first,'7:1:clean');assert.equal(result.again,'7:2:clean');
  assert.deepEqual(result.hotValues,result.hotValues.map((_,i)=>'9:'+(i+1)+':clean'));
  assert.equal(result.coldAfter,'7:1:clean','an evicted instance gets a fresh realm');
  assert.deepEqual(result.state,{value:7},'durable state remains app-owned');
  assert.ok(result.stats.peak<=result.limit && result.stats.resident<=result.limit);
  assert.ok(result.stats.retired>0,'the workload crosses the resident limit');
}));


// Compare production canvas/SVG/PNG output with the browser's own rendering of the source SVG.
// These fixtures are centered in their viewBox, matching the library's centering policy.
test('compound icon fills and short curved contours survive editing, persistence and image export',async()=>app(async({run})=>{
  const cases=[
    ['overlapping evenodd','<path fill-rule="evenodd" d="M0 0H16V24H0Z M8 0H24V24H8Z"/>',[[4,12],[12,12],[20,12]]],
    ['overlapping opposite winding','<path d="M0 0H16V24H0Z M8 0V24H24V0Z"/>',[[4,12],[12,12],[20,12]]],
    ['nested nonzero','<path d="M0 0H24V24H0Z M3 3H21V21H3Z M6 6V18H18V6Z M9 9V15H15V9Z"/>',[[1,12],[4,12],[7,12],[12,12]]],
    ['evenodd island','<path fill-rule="evenodd" d="M0 0H24V24H0Z M6 6H18V18H6Z M10 10H14V14H10Z"/>',[[2,2],[7,7],[12,12]]],
    ['nonzero island','<path d="M0 0H24V24H0Z M6 6V18H18V6Z M10 10H14V14H10Z"/>',[[2,2],[7,7],[12,12]]],
    ['disjoint contours','<path d="M0 0H8V24H0Z M16 0H24V24H16Z"/>',[[4,12],[12,12],[20,12]]],
    ['transformed curves','<g transform="translate(12 12) rotate(30) scale(1 .6)"><path fill="#36c" d="M-12 0C-12 -12 12 -12 12 0C12 12 -12 12 -12 0Z"/></g>',[[1,1],[12,12],[23,23]]],
    ['two-anchor lens','<path d="M0 12C0 0 24 0 24 12C24 24 0 24 0 12Z"/>',[[1,1],[12,4],[12,12],[12,20]]],
    ['one-anchor loop','<path d="M12 24C-12 -8 36 -8 12 24Z"/>',[[2,12],[12,2],[12,12],[22,12]]],
  ];
  for(const [name,body,samples] of cases){
    const r=await run(`(async()=>{
      const body=${JSON.stringify(body)},samples=${JSON.stringify(samples)},vb={left:0,top:0,width:24,height:24};
      const at=samples.map(([x,y])=>[x*5,y*5]);
      async function raster(url,width,height,points){
        const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
        const off=document.createElement('canvas');off.width=width;off.height=height;const x=off.getContext('2d');
        x.fillStyle='#fff';x.fillRect(0,0,width,height);x.drawImage(image,0,0,width,height);
        return points.map(([px,py])=>Array.from(x.getImageData(Math.round(px),Math.round(py),1,1).data));
      }
      const expected=await raster('data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24">'+body+'</svg>'),120,120,at);
      const converted=svgIconToItems(body,vb);
      if(!converted.items)return {error:converted.error};
      const lib=normalizeShapeLibrary(JSON.parse(JSON.stringify({shapes:[{name:'Imported',items:converted.items}]})));
      items=normalizeScene(lib.shapes[0].items,{},FORMAT_VERSION).items;ensureUids(items);
      items.forEach(it=>translateItem(it,60,60));
      items.forEach((_,i)=>convertToCurve(i));
      setTool('select');selection=[];render();
      const canvasPixels=at.map(([x,y])=>Array.from(ctx.getImageData(x*dpr,y*dpr,1,1).data));
      const svg=await itemsToSVGMarkup(items,{width:120,height:120,background:false});
      const svgPixels=await raster('data:image/svg+xml,'+encodeURIComponent(svg),120,120,at);
      const bitmap=await createImageBitmap(await itemsToPngBlob(items,{background:false,scale:1,margin:0}));
      const png=document.createElement('canvas');png.width=png.height=120;const px=png.getContext('2d');
      px.fillStyle='#fff';px.fillRect(0,0,120,120);px.drawImage(bitmap,(120-bitmap.width)/2,(120-bitmap.height)/2);
      const pngPixels=at.map(([x,y])=>Array.from(px.getImageData(x,y,1,1).data));
      return {expected,canvasPixels,svgPixels,pngPixels};
    })()`);
    assert.equal(r.error,undefined,name+' converts');
    assert.deepEqual(r.canvasPixels,r.expected,name+' matches the original on canvas after roundtrip and point-edit conversion');
    assert.deepEqual(r.svgPixels,r.expected,name+' keeps its fill in SVG export');
    assert.deepEqual(r.pngPixels,r.expected,name+' keeps its fill in PNG export');
  }
}));

test('Close, Escape and library replacement invalidate pending icon imports',async()=>{
  for(const action of ['close','escape','replace'])await app(async({page,run})=>{
    let release,retryStarted,calls=0;
    const response=new Promise(resolve=>release=resolve),retry=new Promise(resolve=>retryStarted=resolve);
    const body='<rect width="24" height="24"/>';
    await page.route('https://api.iconify.design/**',async route=>{
      const url=new URL(route.request().url()),headers={'access-control-allow-origin':'*'};
      if(url.pathname==='/search')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({
        icons:['test:late'],collections:{test:{name:'Test',license:{title:'MIT',spdx:'MIT'}}}
      })});
      if(url.pathname==='/test.json'){
        if(++calls===1)return route.fulfill({status:503,headers,body:''});
        retryStarted();await response;
        return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({width:24,height:24,icons:{late:{body}}})});
      }
      return route.fulfill({status:404,headers,body:''});
    });
    await run('openIconDialog()');await page.locator('#iconSearchInput').fill('late');await page.locator('#iconSearchBtn').click();
    await page.locator('#iconResults .shape-thumb').waitFor();
    assert.equal(await page.locator('#iconResults .shape-thumb').textContent(),'?');
    await page.locator('#iconResults .shape-thumb').click();await retry;
    if(action==='close')await page.locator('#iconDialogCancel').click();
    if(action==='escape')await page.keyboard.press('Escape');
    const replacement={shapes:[{name:'Replacement',items:[rectangle()]}]};
    await importLibrary(page,replacement);
    await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes[0]?.name')==='Replacement');
    release();
    await page.waitForFunction(()=>__test.run("iconBodies.has('test:late')"));
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.deepEqual(await run('shapeLibrary.shapes.map(s=>s.name)'),['Replacement'],action+' cannot append to the replacement library');
    assert.equal(await run('shapeLibraryDirty'),false,'a cancelled import does not create unexported changes');
    if(action==='replace')await page.locator('#iconDialogCancel').click();
    await run('openIconDialog()');
    await page.locator('#iconResults .shape-thumb').click();
    await page.waitForFunction(()=>__test.run('shapeLibrary.shapes.length')===2);
    assert.deepEqual(await run('shapeLibrary.shapes.map(s=>s.name)'),['Replacement','late'],'a fresh explicit click can add the cached icon');
  });
});


async function routeStaticIcons(page,icons){
  await page.route('https://api.iconify.design/**',route=>{
    const url=new URL(route.request().url()),headers={'access-control-allow-origin':'*'};
    if(url.pathname==='/search')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({
      icons:Object.keys(icons).map(name=>'test:'+name),collections:{test:{name:'Colorful test icons',palette:true,license:{title:'MIT',spdx:'MIT'}}}
    })});
    if(url.pathname==='/test.json')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({width:24,height:24,
      icons:Object.fromEntries(Object.entries(icons).map(([name,body])=>[name,{body}]))})});
    return route.fulfill({status:404,headers,body:''});
  });
}
const SIMPLIFIED_ICON='<defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><clipPath id="c"><rect width="12" height="24"/></clipPath><filter id="f"><feGaussianBlur stdDeviation="1"/></filter></defs><g transform="translate(2 2)" clip-path="url(#c)" filter="url(#f)"><rect width="20" height="20" fill="url(#g)"/></g>';

test('multicolor icons import directly and retain separate colors through library export and placement',async()=>app(async({page,run})=>{
  await routeIconify(page);await run('openIconDialog()');await page.locator('#iconSearchInput').fill('sailboat');await page.locator('#iconSearchBtn').click();
  await page.locator('#iconResults .shape-thumb[title*="Colorful"]').click();
  await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes.length')===1);
  assert.equal(await page.locator('#iconImportPreview').isVisible(),false,'supported flat colors need no loss confirmation');
  const saved=await downloadedJSON(page,run,'exportShapeLibrary()');
  const entry=saved.shapes[0];assert.deepEqual(entry.items.map(it=>it.fillColor),['#ff0000','#0000ff']);
  assert.equal(entry.source.set,'multi');
  await run(`(async()=>{shapeLibrary=normalizeShapeLibrary(${JSON.stringify(saved)});await placeShapeAt(shapeLibrary.shapes[0],120,120);selection=[];render();})()`);
  const svg=await run('itemsToSVGMarkup(items)');
  assert.match(svg,/#ff0000/);assert.match(svg,/#0000ff/);
  assert.deepEqual(await run('items.map(it=>it.fillColor)'),['#ff0000','#0000ff']);
}));

test('Load more advances over filtered results, keeps earlier pages and retries failed requests',async()=>app(async({page,run})=>{
  const requests=[];let attempts=0;
  const cols={closed:{name:'Restricted',license:{spdx:'GPL-3.0'}},test:{name:'Colors',palette:true,license:{spdx:'MIT'}}};
  const first=Array.from({length:96},(_,i)=>'closed:icon-'+i);
  await page.route('https://api.iconify.design/**',route=>{
    const url=new URL(route.request().url()),headers={'access-control-allow-origin':'*'};
    if(url.pathname==='/search'){
      requests.push(Object.fromEntries(url.searchParams));const start=Number(url.searchParams.get('start'));
      if(start===96 && ++attempts===1)return route.fulfill({status:503,headers,body:''});
      return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({icons:start===0?first:['closed:icon-0','test:color'],collections:cols})});
    }
    if(url.pathname==='/test.json')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({width:24,height:24,icons:{color:{body:'<rect width="24" height="24" fill="red"/>'}}})});
    return route.fulfill({status:404,headers,body:''});
  });
  await run('openIconDialog()');await page.locator('#iconSearchInput').fill('boat');await page.locator('#iconSearchBtn').click();
  await page.waitForFunction(()=>/96 hidden/.test(document.getElementById('iconStatus').textContent));
  assert.equal(await page.locator('#iconResults .shape-entry').count(),0);
  await page.locator('#iconLoadMore').click();await page.waitForFunction(()=>/results are kept/.test(document.getElementById('iconStatus').textContent));
  await page.locator('#iconLoadMore').click();await page.locator('#iconResults .shape-thumb').waitFor();
  assert.equal(await page.locator('#iconLoadMore').isVisible(),false,'short final page ends pagination');
  assert.match(await page.locator('#iconStatus').textContent(),/1 icon shown.*96 hidden/);
  assert.deepEqual(requests.map(r=>[r.query,r.start,r.limit]),[['boat','0','96'],['boat','96','96'],['boat','96','96']]);
  await page.locator('#iconPermissiveOnly').uncheck();
  await page.waitForFunction(()=>document.querySelectorAll('#iconResults .shape-entry').length===97);
  assert.equal(new Set(await page.locator('#iconResults .shape-name').allTextContents()).size,97,'duplicate results do not create duplicate tiles');
  assert.equal(requests.length,3,'filter changes reuse all loaded pages');
}));

test('a stale Load more response cannot replace a newer search or reopen a closed dialog',async()=>app(async({page,run})=>{
  let release,started;
  const response=new Promise(r=>release=r),pending=new Promise(r=>started=r);
  await page.route('https://api.iconify.design/**',async route=>{
    const url=new URL(route.request().url()),headers={'access-control-allow-origin':'*'};
    if(url.pathname==='/search'){
      const query=url.searchParams.get('query'),start=Number(url.searchParams.get('start'));
      if(start){started();await response;}
      const icons=query==='old' && !start?Array.from({length:96},(_,i)=>'test:old-'+i):['test:'+(start?'late':'new')];
      return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({icons,collections:{test:{name:'Test',license:{spdx:'MIT'}}}})});
    }
    return route.fulfill({status:404,headers,body:''});
  });
  await run('openIconDialog()');await page.locator('#iconSearchInput').fill('old');await page.locator('#iconSearchBtn').click();
  await page.locator('#iconResults .shape-entry').first().waitFor();await page.locator('#iconLoadMore').click();await pending;
  await page.locator('#iconSearchInput').fill('new');await page.locator('#iconSearchBtn').click();
  await page.waitForFunction(()=>document.querySelectorAll('#iconResults .shape-name').length===1 && document.querySelector('#iconResults .shape-name').textContent==='new');
  await page.locator('#iconDialogCancel').click();release();
  await run('new Promise(r=>setTimeout(r,50))');await run('openIconDialog()');
  await page.waitForFunction(()=>document.querySelector('#iconResults .shape-name')?.textContent==='new');
  assert.deepEqual(await page.locator('#iconResults .shape-name').allTextContents(),['new']);
  assert.equal(await page.locator('#iconLoadMore').isVisible(),false);
}));

test('simplified imports preview the actual static result and require confirmation before changing the library',async()=>app(async({page,run})=>{
  await routeStaticIcons(page,{gradient:SIMPLIFIED_ICON});await run('openIconDialog()');
  await page.locator('#iconSearchInput').fill('gradient');await page.locator('#iconSearchBtn').click();await page.locator('#iconResults .shape-thumb').click();
  await page.locator('#iconImportConfirm:enabled').waitFor();
  assert.equal(await run('shapeLibrary'),null,'preview alone never creates a library');
  const before=await page.locator('#iconOriginalPreview').getAttribute('src'),after=await page.locator('#iconConvertedPreview').getAttribute('src');
  assert.match(decodeURIComponent(before),/linearGradient/);assert.doesNotMatch(decodeURIComponent(after),/linearGradient|clipPath|filter=|script/);
  const losses=await page.locator('#iconImportLosses').textContent();
  for(const message of ['Gradients','Masks and clipping','Visual effects'])assert.ok(losses.includes(message));
  assert.equal(await run("Array.from(document.querySelectorAll('#iconImportPreview img')).every(im=>im.complete && im.naturalWidth>0)"),true);
  const pixels=await run(`(async()=>{
    const result=[];for(const id of ['iconOriginalPreview','iconConvertedPreview']){
      const im=document.getElementById(id),c=document.createElement('canvas');c.width=c.height=120;
      const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,120,120);x.drawImage(im,0,0,120,120);
      result.push(Array.from(x.getImageData(95,60,1,1).data));
    }return result;
  })()`);
  assert.notDeepEqual(pixels[0],pixels[1],'before/after previews visibly expose the omitted clipping');
  await page.locator('#iconImportCancel').click();assert.equal(await run('shapeLibrary'),null);
  await page.locator('#iconResults .shape-thumb').click();await page.locator('#iconImportConfirm:enabled').waitFor();
  const approved=await run('clone(iconPendingImport.result.items)');
  await page.locator('#iconImportConfirm').click();await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes.length')===1);
  assert.deepEqual(await run('shapeLibrary.shapes[0].items'),approved,'the confirmed preview geometry is the geometry that gets added');
  const exported=await downloadedJSON(page,run,'exportShapeLibrary()');
  assert.deepEqual(exported.shapes[0].items,approved);assert.equal(exported.shapes[0].source.license.spdx,'MIT');
}));

test('simplified preview confirmation is invalidated by Escape, a new search or library replacement',async()=>{
  for(const action of ['escape','search','replace'])await app(async({page,run})=>{
    await routeStaticIcons(page,{gradient:SIMPLIFIED_ICON});await run('openIconDialog()');
    await page.locator('#iconSearchInput').fill('gradient');await page.locator('#iconSearchBtn').click();await page.locator('#iconResults .shape-thumb').click();
    await page.locator('#iconImportConfirm:enabled').waitFor();
    if(action==='escape'){await page.keyboard.press('Escape');await run('openIconDialog()');}
    if(action==='search'){await page.locator('#iconSearchInput').fill('another');await page.locator('#iconSearchBtn').click();}
    if(action==='replace'){
      await importLibrary(page,{shapes:[{name:'Replacement',items:[rectangle()]}]});
      await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes[0]?.name')==='Replacement');
      await page.locator('#iconImportConfirm').click();
      assert.deepEqual(await run('shapeLibrary.shapes.map(s=>s.name)'),['Replacement']);
      assert.equal(await run('shapeLibraryDirty'),false);
    }else{
      assert.equal(await run('iconPendingImport'),null);assert.equal(await run('shapeLibrary'),null);
    }
    assert.equal(await page.locator('#iconImportPreview').isVisible(),false,action+' retires the preview');
  });
});

test('static simplification applies transforms, reports omissions, and never admits animations or empty results',async()=>app(async({run})=>{
  const r=await run(`(()=>{
    const vb={left:0,top:0,width:24,height:24};
    const body='<defs><pattern id="p" width="1" height="1"/></defs><g transform="translate(12 12) scale(2 1)"><rect x="-4" y="-4" width="8" height="8" style="fill:url(#p);stroke:red;stroke-width:1;opacity:.5;stroke-dasharray:2 2"/><text>omitted</text><use href="#x"/></g>';
    const normal=svgIconToItems(body,vb),simple=svgIconToItems(body,vb,{simplify:true});
    const animations=[
      '<rect width="24" height="24"><animate attributeName="x" values="0;2" dur="1s"/></rect>',
      '<g><set attributeName="fill" to="red"/><rect width="24" height="24"/></g>',
      '<style>@keyframes spin {to{opacity:0}}</style><rect width="24" height="24"/>',
      '<rect width="24" height="24" style="animation:spin 1s infinite"/>',
      '<rect width="24" height="24" style="transition:fill 1s"/>',
    ].map(body=>[svgIconToItems(body,vb),svgIconToItems(body,vb,{simplify:true})]);
    return {normal,simple,animations,empty:svgIconToItems('<text>only text</text>',vb,{simplify:true}),
      unsafe:svgIconToItems('<script>throw 1</script><rect width="24" height="24"/>',vb,{simplify:true}),
      faint:svgIconToItems('<rect width="24" height="24"/><circle r="10" opacity=".01"/>',vb),
      zeroStroke:svgIconToItems('<rect width="24" height="24" fill="red" stroke="blue" stroke-width="0"/>',vb),
      stylesInDefs:svgIconToItems('<defs><style>.red{fill:red}</style></defs><rect class="red" width="24" height="24"/>',vb,{simplify:true})};
  })()`);
  assert.equal(r.normal.canSimplify,true);assert.ok(r.simple.items?.length);assert.ok(r.simple.warnings.length>=4);
  const b=await run(`bbox(${JSON.stringify(r.simple.items[0])},false)`);assert.equal(b.w,80);assert.equal(b.h,40,'non-uniform transforms are applied to geometry');
  for(const pair of r.animations)for(const result of pair){assert.match(result.error,/Animated/);assert.equal(result.items,undefined);assert.equal(result.canSimplify,undefined);}
  assert.match(r.empty.error,/no drawable/);assert.match(r.unsafe.error,/scripts/);
  assert.ok(r.faint.warnings.some(w=>/transparent layers/.test(w)),'omitting faint layers is disclosed');
  assert.equal(r.zeroStroke.items[0].strokeOn,false,'zero-width SVG strokes stay invisible');
  assert.ok(r.stylesInDefs.warnings.includes('Stylesheet rules were omitted.'),'CSS rules inside definitions require the same disclosure');
}));

test('search excludes animated icons while keeping static multicolor icons',async()=>app(async({page,run})=>{
  await routeStaticIcons(page,{static:'<rect width="24" height="24" fill="red"/>',animated:'<rect width="24" height="24"><animate attributeName="opacity" values="0;1" dur="1s"/></rect>',css:'<style>@keyframes x{to{opacity:0}}</style><rect width="24" height="24"/>'});
  await run('openIconDialog()');await page.locator('#iconSearchInput').fill('icons');await page.locator('#iconSearchBtn').click();
  await page.locator('#iconResults .shape-entry').waitFor();
  assert.deepEqual(await page.locator('#iconResults .shape-name').allTextContents(),['static']);
  assert.match(await page.locator('#iconStatus').textContent(),/2 animated icons excluded/);
}));

const pointEditSquare = {type:'polygon',uid:'sq',closed:true,color:'#1f2937',size:2,strokeOn:true,fill:true,fillColor:'#ffd166',
  points:[{x:100,y:100},{x:300,y:100},{x:300,y:300},{x:100,y:300}]};

test('Point-Edit: a click on the outline adds an anchor (undoable), click-drag adds and moves it', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(pointEditSquare)}];setTool('select');selection=[0];pointEditIdx=0;activeAnchor=null;render();`);
  const box = await page.locator('#canvas').boundingBox();
  const undoBefore = await run('undoStack.length');
  await page.mouse.click(box.x+150, box.y+101);
  assert.deepEqual(await run('items[0].points.map(p=>[p.x,p.y])'), [[100,100],[150,100],[300,100],[300,300],[100,300]]);
  assert.equal(await run('activeAnchor'), 1, 'the new anchor is the active one');
  assert.equal(await run('undoStack.length'), undoBefore+1, 'one undo entry');
  await run('undo()');
  assert.equal(await run('items[0].points.length'), 4);
  await run('selection=[0];pointEditIdx=0;render()');
  await page.mouse.move(box.x+300, box.y+200);
  await page.mouse.down();
  await page.mouse.move(box.x+330, box.y+200, {steps:4});
  await page.mouse.move(box.x+350, box.y+200, {steps:4});
  await page.mouse.up();
  const pts = await run('items[0].points.map(p=>[p.x,p.y])');
  assert.equal(pts.length, 5);
  assert.deepEqual(pts[2], [350,200], 'inserted between the right-hand corners and dragged out');
  assert.equal(await run('pointEditIdx'), 0, 'still in Point-Edit');
}));

test('Point-Edit: Delete, Alt+click and the x button remove an anchor, never below the minimum', async () => app(async ({page,run}) => {
  const five = {...pointEditSquare, points:[...pointEditSquare.points, {x:50,y:200}]};
  await run(`items=[${JSON.stringify(five)}];setTool('select');selection=[0];pointEditIdx=0;activeAnchor=null;render();`);
  const box = await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+50, box.y+200);          // pick the extra anchor
  assert.equal(await run('activeAnchor'), 4);
  await page.keyboard.press('Delete');
  assert.equal(await run('items.length'), 1, 'Delete removes the anchor, not the shape');
  assert.equal(await run('items[0].points.length'), 4);
  await run('undo(); selection=[0]; pointEditIdx=0; render()');
  assert.equal(await run('items[0].points.length'), 5, 'undo restores it');
  await page.keyboard.down('Alt');
  await page.mouse.click(box.x+50, box.y+200);
  await page.keyboard.up('Alt');
  assert.equal(await run('items[0].points.length'), 4, 'Alt+click removes an anchor directly');
  await page.mouse.click(box.x+300, box.y+300);          // pick a corner, then its x button
  assert.equal(await run('activeAnchor'), 2);
  await page.mouse.click(box.x+316, box.y+284);
  assert.deepEqual(await run('items[0].points.map(p=>[p.x,p.y])'), [[100,100],[300,100],[100,300]], 'x button removes it');
  await page.mouse.click(box.x+100, box.y+100);
  assert.equal(await run('anchorDeleteButtonPos()'), null, 'no x button at the minimum');
  await page.keyboard.press('Delete');
  assert.equal(await run('items[0].points.length'), 3, 'a closed shape keeps at least 3 anchors');
  assert.equal(await run('items.length'), 1);
}));

test('Point-Edit: a double-click on the outline still leaves the mode and adds no anchor; hover shows the + ghost', async () => app(async ({page,run}) => {
  await run(`items=[${JSON.stringify(pointEditSquare)}];setTool('select');selection=[0];pointEditIdx=0;activeAnchor=null;render();`);
  const box = await page.locator('#canvas').boundingBox();
  await page.mouse.move(box.x+200, box.y+102);
  assert.ok(await run('insertHover!==null'), 'hovering the outline shows where a point would go');
  await page.mouse.move(box.x+200, box.y+200);
  assert.equal(await run('insertHover'), null, 'not inside the shape');
  await page.mouse.move(box.x+100, box.y+100);
  assert.equal(await run('insertHover'), null, 'not on an existing anchor');
  const undoBefore = await run('undoStack.length');
  await page.mouse.dblclick(box.x+150, box.y+101);
  assert.equal(await run('pointEditIdx'), null, 'double-click left Point-Edit');
  assert.equal(await run('items[0].points.length'), 4, 'and left no stray anchor behind');
  assert.equal(await run('undoStack.length'), undoBefore, 'nor an undo entry');
}));

test('inserting an anchor into a curve keeps its exact shape', async () => app(async ({run}) => {
  const worst = await run(`(()=>{
    const it = {type:'polygon', closed:false, color:'#000000', size:2, strokeOn:true, fill:false,
      points:[{x:0,y:0,c1:{x:40,y:-80}}, {x:200,y:0,c2:{x:160,y:90}}]};
    const before = JSON.parse(JSON.stringify(it));
    insertAnchor(it, 0, 0.37);
    let worst = 0;
    for(const s of polyCurveSegments(it)) for(let t=0; t<=1; t+=0.05){
      const x = cubicPoint(s.a.x,s.c1.x,s.c2.x,s.b.x,t), y = cubicPoint(s.a.y,s.c1.y,s.c2.y,s.b.y,t);
      worst = Math.max(worst, nearestOnOutline(before, x, y).d);
    }
    return worst;
  })()`);
  assert.ok(worst < 0.05, `split curve deviates ${worst}px from the original`);
}));


test('off-center insertion projects onto open diagonal edges and preserves rotated outlines',async()=>app(async({page,run})=>{
  const open={...pointEditSquare,closed:false,fill:false,points:[{x:100,y:100},{x:500,y:300}]};
  await run(`items=[${JSON.stringify(open)}];setTool('select');selection=[0];pointEditIdx=0;activeAnchor=null;render();`);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+200,box.y+151);
  const inserted=await run('items[0].points[1]');
  assert.deepEqual(inserted,{x:200.4,y:150.2},'nearest point is the line projection, not cubic easing along it');
  await run('undo()');assert.deepEqual(await run('items[0].points'),open.points);
  const rotation=Math.PI/6,rotated={...pointEditSquare,rotation};
  // Independent rigid transform around the known square center, not the app's hit-test helper.
  const c=Math.cos(rotation),s=Math.sin(rotation),a={x:200-100*c+100*s,y:200-100*s-100*c};
  // WebKit rounds dispatched mouse coordinates. Use an integer click and project that actual
  // location onto the rotated edge, instead of expecting an undispatched fractional position.
  const click={x:Math.round(a.x+50*c),y:Math.round(a.y+50*s)};
  const along=(click.x-a.x)*c+(click.y-a.y)*s,expected={x:a.x+along*c,y:a.y+along*s};
  await run(`items=[${JSON.stringify(rotated)}];selection=[0];pointEditIdx=0;activeAnchor=null;render();`);
  await page.mouse.click(box.x+click.x,box.y+click.y);
  const points=await run('items[0].points');
  assert.equal(points.length,5);
  assert.ok(Math.hypot(points[1].x-expected.x,points[1].y-expected.y)<.03,`rotation baking keeps the anchor at the projected click: ${JSON.stringify({actual:points[1],expected})}`);
  const remaining=[points[0],...points.slice(2)];
  for(let i=0;i<remaining.length;i++){
    const p=rotated.points[i],x=200+(p.x-200)*c-(p.y-200)*s,y=200+(p.x-200)*s+(p.y-200)*c;
    assert.ok(Math.hypot(remaining[i].x-x,remaining[i].y-y)<.01,'the original anchors stay in place');
  }
  await run('undo()');assert.deepEqual(await run('items[0]'),rotated,'undo restores the original stored rotation and geometry');
}));

test('Delete and Backspace repeats stay within point editing after the selected anchor is removed',async()=>{
  const shapes=[{...pointEditSquare,points:[...pointEditSquare.points,{x:50,y:200}]},
    {...pointEditSquare,closed:false,fill:false,points:[{x:100,y:100},{x:200,y:150},{x:300,y:100}]}];
  for(const key of ['Delete','Backspace'])for(const shape of shapes)await app(async({page,run})=>{
    const index=shape.closed?4:1,p=shape.points[index];
    await run(`items=[${JSON.stringify(shape)}];setTool('select');selection=[0];pointEditIdx=0;activeAnchor=null;render();`);
    const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+p.x,box.y+p.y);
    await page.keyboard.down(key);await page.keyboard.down(key);await page.keyboard.up(key);
    await page.keyboard.press(key);   // no active anchor: even a fresh press remains harmless in this mode
    assert.equal(await run('items.length'),1,key+' does not change its target to the object');
    assert.equal(await run('items[0].points.length'),shape.points.length-1);
    assert.equal(await run('pointEditIdx'),0);
    await run('undo()');assert.deepEqual(await run('items[0]'),shape,'anchor removal is exactly one undo step');
    await page.keyboard.press(key);assert.equal(await run('items.length'),0,'whole-object deletion still works after leaving point editing');
  });
});

test('double-click exit preserves Redo and the oldest Undo entry when history is full',async()=>{
  for(const full of [false,true])await app(async({page,run})=>{
    await run(`items=[${JSON.stringify(pointEditSquare)}];setTool('select');selection=[0];
      for(let i=0;i<${full?80:1};i++){beginHistory();items[0].fillColor=${full?"'#'+i.toString(16).padStart(6,'0')":"'#00ff00'"};commitHistory();}
      ${full?'':'undo();'}selection=[0];pointEditIdx=0;activeAnchor=null;render();`);
    const before=await run('({items:clone(items),undo:undoStack.slice(),redo:redoStack.slice()})');
    const box=await page.locator('#canvas').boundingBox();await page.mouse.dblclick(box.x+150,box.y+101);
    const after=await run('({items:clone(items),undo:undoStack.slice(),redo:redoStack.slice()})');
    assert.deepEqual(after,before,'withdrawing an insertion restores geometry and both complete histories');
    assert.equal(await run('pointEditIdx'),null);
    if(full){
      await run('for(let i=0;i<80;i++)undo()');
      assert.equal(await run('items[0].fillColor'),pointEditSquare.fillColor,'even the oldest edit is still undoable');
    }else{
      await run('redo()');assert.equal(await run('items[0].fillColor'),'#00ff00','Redo still restores the real recolor');
    }
  });
});

test('a point insertion cannot withdraw a later nudge or survive undo into another edit session',async()=>app(async({page,run})=>{
  await run(`items=[${JSON.stringify(pointEditSquare)}];setTool('select');selection=[0];pointEditIdx=0;activeAnchor=null;render();`);
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+150,box.y+101);
  await page.keyboard.press('ArrowRight');await page.mouse.click(box.x+151,box.y+100);
  assert.equal(await run('pointEditIdx'),0,'an intervening edit retires the tentative double-click rollback');
  assert.deepEqual(await run('items[0].points[1]'),{x:151,y:100},'the later nudge is retained');
  await run('undo()');assert.equal(await run('items[0].points[1].x'),150);
  await run('undo();togglePointEdit()');
  await page.mouse.click(box.x+300,box.y+100);
  assert.equal(await run('items[0].points.length'),4);
  assert.equal(await run('pointEditIdx'),0,'a new edit session does not consume a stale insertion');
}));

test('touch adds an off-center anchor and double-tap exit restores the drawing and Redo',async()=>app(async({page,run})=>{
  await run(`items=[${JSON.stringify(pointEditSquare)}];setTool('select');selection=[0];beginHistory();items[0].fillColor='#00ff00';commitHistory();undo();selection=[0];pointEditIdx=0;activeAnchor=null;render();`);
  const box=await page.locator('#canvas').boundingBox();
  await page.touchscreen.tap(box.x+150,box.y+100);
  assert.deepEqual(await run('items[0].points[1]'),{x:150,y:100});
  await page.touchscreen.tap(box.x+150,box.y+100);
  assert.equal(await run('pointEditIdx'),null);assert.equal(await run('items[0].points.length'),4);
  await run('redo()');assert.equal(await run('items[0].fillColor'),'#00ff00');
},{context:{viewport:{width:1024,height:768},hasTouch:true,isMobile:true}}));

test('withdrawing an insertion retains unrelated smart-instance execution state',async()=>app(async({page,run})=>{
  const script='({children(){return [];},initState(){self.calls=(self.calls||0)+1;return {n:self.calls};}})';
  await run(`items=[${JSON.stringify(pointEditSquare)},{...${JSON.stringify(smartFixture(script))},x:500}];setTool('select');selection=[0];pointEditIdx=0;activeAnchor=null;render();`);
  assert.deepEqual(await run("requestSmartCall(items[1],'initState',[])"),{n:1});
  const box=await page.locator('#canvas').boundingBox();await page.mouse.dblclick(box.x+150,box.y+101);
  assert.equal(await run('pointEditIdx'),null);
  assert.deepEqual(await run("requestSmartCall(items[1],'initState',[])"),{n:2},'unrelated point edits do not replace another instance or reset its Worker');
}));

test('font controls edit selected tables and mixed text selections with undo and file persistence',async()=>app(async({page,run})=>{
  const table={type:'table',uid:'table',x:100,y:100,w:240,h:160,rows:1,cols:1,size:2,color:'#000000',
    fontFamily:'sans',fontSize:28,texts:[['Table']]};
  await run(`items=[${JSON.stringify(table)},${JSON.stringify(wrappedText)},${JSON.stringify(smartFixture('({children(){return [];}})'))},${JSON.stringify(rectangle())}];
    setTool('select');selection=[0];render();`);
  const defaults=await run('({family:ui.fontFamily,size:ui.fontSize})');
  await page.locator('#fontSize').selectOption('48');
  assert.equal(await run('items[0].fontSize'),48,'the selected table changes, rather than drawing defaults');
  assert.equal(await run('undoStack.length'),1);
  await page.locator('#fontFamily').selectOption('serif');
  assert.equal(await run('items[0].fontFamily'),'serif');
  await run('undo()');assert.equal(await run('items[0].fontFamily'),'sans');
  assert.equal(await run('items[0].fontSize'),48);
  await run('redo()');assert.equal(await run('items[0].fontFamily'),'serif');
  await run('selection=[0,1,2,3];render()');
  await page.locator('#fontFamily').selectOption('mono');
  await page.locator('#fontSize').selectOption('36');
  for(const it of await run('items.slice(0,3)')){
    assert.equal(it.fontFamily,'mono');assert.equal(it.fontSize,36);
    assert.match(it.font,/36px .*monospace/);
  }
  assert.equal(await run('items[3].font'),undefined,'non-text shapes do not acquire font fields');
  assert.deepEqual(await run('({family:ui.fontFamily,size:ui.fontSize})'),defaults,'editing a selection preserves drawing defaults');
  const exported=await downloadedJSON(page,run,'exportProject()');
  await page.reload();await run(`applySketchToActiveTab(${JSON.stringify(exported.items)},${JSON.stringify(exported.assets)})`);
  assert.deepEqual(await run('items.slice(0,3).map(it=>[it.fontFamily,it.fontSize])'),[['mono',36],['mono',36],['mono',36]]);
}));

test('toolbar popovers stay exclusive and retain color-panel, accessibility and menu keyboard behavior',async()=>app(async({page,run})=>{
  await run("setTool('table')");
  const popovers={strokeBtn:'strokePicker',fillBtn:'fillPicker',textColorBtn:'textColorPicker',sizeBtn:'sizePicker',
    tableBtn:'tablePicker',shapeLibBtn:'shapePicker',menuBtn:'menu'};
  async function onlyOpen(button){
    const state=await page.evaluate(popovers=>Object.entries(popovers).map(([button,id])=>({button,
      open:!document.getElementById(id).hidden,expanded:document.getElementById(button).getAttribute('aria-expanded')})),popovers);
    assert.deepEqual(state.filter(p=>p.open).map(p=>p.button),button?[button]:[]);
    for(const p of state)assert.equal(p.expanded,String(p.button===button),p.button+' reflects the open state');
    assert.equal(await page.locator('#menuBtn').evaluate(b=>b.classList.contains('active')),button==='menuBtn');
  }
  await page.locator('#strokeBtn').click();await onlyOpen('strokeBtn');
  await page.locator('#strokePicker .cswatch.custom').click();
  assert.equal(await page.locator('#strokePicker .cpanel').isVisible(),true);
  for(const button of ['tableBtn','menuBtn','fillBtn','textColorBtn','sizeBtn','shapeLibBtn','strokeBtn']){
    await page.locator('#'+button).click();await onlyOpen(button);
  }
  assert.equal(await page.locator('#strokePicker .cpanel').isVisible(),false,'opening another popover resets the custom-color panel');
  await page.mouse.click(1,1);await onlyOpen(null);
  await page.locator('#tableBtn').click();
  await page.locator('#menuBtn').focus();await page.keyboard.press('ArrowDown');await onlyOpen('menuBtn');
  const actions=page.locator('#menu button[data-act]');
  assert.equal(await actions.first().evaluate(b=>b===document.activeElement),true);
  await page.keyboard.press('ArrowDown');assert.equal(await actions.nth(1).evaluate(b=>b===document.activeElement),true);
  await page.keyboard.press('Escape');await onlyOpen(null);
  assert.equal(await page.locator('#menuBtn').evaluate(b=>b===document.activeElement),true);
}));
