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

test('an infinite loop in a script times out, recovers, and does not take down other smart shapes', async () => app(async ({page,run}) => {
  // All smart scripts share ONE worker (an explicit, accepted trade-off -- see the sandbox's own
  // comment: isolation is from the host, not between scripts), so a hung script temporarily blocks
  // whatever else happened to be queued alongside it in that same worker too -- `ok1`'s own request,
  // sent in the same render() pass as the hung one, is rejected right along with it when the timeout
  // fires and the worker is torn down. A timed-out item also gets a backoff window (see
  // smartBackoffUntil) so it isn't retried on literally the very next render() -- without that, a
  // script that hangs EVERY time (not just once) would re-hang the shared worker on every single
  // render() for as long as the canvas is used at all, repeatedly colliding with whatever else shares
  // that pass. The guarantee under test: the hang never reaches the main thread (confirmed by this
  // test, and the whole suite, simply completing at all); the sandbox itself recovers promptly
  // (a fresh, unrelated call succeeds right after); and once the hung item is gone from the scene (the
  // realistic resolution -- delete it, or undo its placement), an unrelated sibling that was only ever
  // collateral damage renders correctly again.
  const hangScript = `({ children(){ while(true){} } })`;
  const okScript = `({ children(state,style,w,h){ return [{type:'rect',x:0,y:0,w:w,h:h,color:style.color,strokeOn:true,fill:false}]; } } )`;
  await run(`items=[
    {type:'smart',uid:'hang1',x:40,y:40,w:100,h:100,color:'#000',fillColor:'#fff',fill:false,strokeOn:false,
      textColor:'#000',size:2,fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script:${JSON.stringify(hangScript)},state:{}},
    {type:'smart',uid:'ok1',x:200,y:40,w:100,h:100,color:'#000',fillColor:'#fff',fill:false,strokeOn:false,
      textColor:'#000',size:2,fontFamily:'sans',fontSize:12,font:fontStr('sans',12),script:${JSON.stringify(okScript)},state:{}}
  ];setTool('select');render();`);
  // Give the hung request time to hit its own timeout and regenerate the sandbox (250ms + margin).
  await page.waitForTimeout(500);
  assert.equal(await run(`smartChildrenCache.has('hang1')`), false, 'the hung shape never got a result, but caused no crash');
  // The sandbox must have actually recovered: a fresh, unrelated call (unrelated to either item above)
  // succeeds normally.
  const fresh = await run(`requestSmartCall('({children(){return [{type:"rect",x:1,y:2,w:3,h:4}]}})', 'children', [{},{},10,10,false])`);
  assert.deepEqual(fresh, [{type:'rect',x:1,y:2,w:3,h:4}], 'a normal call succeeds after the hang, proving the worker was regenerated');
  // Remove the hung item (the realistic recovery path) so ok1's own retry isn't immediately paired
  // with the same hang all over again. ok1's own request was collateral damage from that same
  // worker-sharing, so it's under the same backoff (see smartBackoffUntil) -- wait that out too before
  // expecting a retry, reading the real constant rather than duplicating its value here.
  await run(`items = items.filter(it=>it.uid!=='hang1');`);
  const backoffMs = await run('SMART_BACKOFF_MS');
  await page.waitForTimeout(backoffMs + 200);
  await run(`render()`);
  await page.waitForTimeout(100);
  const okKids = await run(`smartChildrenCache.get('ok1') && smartChildrenCache.get('ok1').kids`);
  assert.ok(okKids && okKids.length, 'the other shape renders correctly once the hung one is gone from the scene');
}));

// Real bug, reported directly: a smart shape's polygon-type children (a flag pennant, a clock's own
// elapsed-time wedge, an arrow's curved shaft -- anything with a `points` array) drifted further off
// its container on every single repaint, winding up well outside the container within a few frames.
// Root cause: shapeOps' 'smart' case merges each cached child with Object.assign({...}, raw) before
// calling translateItem on it -- a SHALLOW copy, so `child.points` was still the exact same array (and
// point objects) smartChildrenFor keeps cached across many render() calls. translateItem mutates a
// polygon's points (and a point's own arcTo/c1/c2) IN PLACE, not just a top-level x/y -- before the
// render-loop cache existed, def.children() ran fresh on every single call, so this aliasing was
// harmless (nothing persisted to corrupt); caching made the same points shift a little further on
// every repaint instead of sitting still.
test('a smart shape\'s polygon children do not drift on repeated repaints', async () => app(async ({page,run}) => {
  const script = `({
    children(state,style,w,h){
      return [{type:'polygon', points:[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}], closed:true, color:style.color, size:2, strokeOn:true, fill:false}];
    }
  })`;
  await run(`items=[{type:'smart',uid:'d1',x:100,y:100,w:80,h:60,color:'#1f2937',fillColor:'#ffd166',
    fill:false,strokeOn:false,textColor:'#1f2937',size:2,fontFamily:'sans',fontSize:12,font:fontStr('sans',12),
    script:${JSON.stringify(script)},state:{}}];setTool('select');render();`);
  await page.waitForTimeout(100);   // let the cache's first background children() request resolve
  const before = await run(`JSON.stringify(shapeOps(items[0]).find(op=>op.kind==='path').d)`);
  for(let i=0;i<10;i++) await run('render()');   // 10 more repaints, reusing the SAME cached children
  const after = await run(`JSON.stringify(shapeOps(items[0]).find(op=>op.kind==='path').d)`);
  assert.equal(after, before, 'the polygon\'s on-screen points must not shift after repeated, unrelated repaints');
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

test('the Timer template shows a large "N Minutes left" readout under the dial, inside the box, never wrapping', async () => app(async ({run}) => {
  const r = JSON.parse(await run(`(async()=>{
    const script = SMART_TEMPLATES.timer.script;
    const init = await requestSmartCall(script, 'initStyle', []);
    const out = [];
    for(const [w,h] of [[init.w, init.h], [160,190], [90,110], [70,84]]){
      const it = {type:'smart', w, h, color:'#1f2937', fillColor:'#dc2626', fill:false, strokeOn:true, textColor:'#1f2937',
        size:2, fontFamily:'sans', fontSize:12, font:fontStr('sans',12), script};
      for(const value of [-45, -59, -1]){
        const kids = await requestSmartCall(script, 'children', [{value}, smartResolvedStyle(it), w, h, false]);
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
  for(const o of r.out){
    assert.ok(o.bottom <= o.h + 0.5, `readout inside the box at ${o.w}x${o.h}`);
    assert.ok(o.textW <= o.boxW, `"${o.text}" fits on one line at ${o.w}x${o.h} (${o.textW.toFixed(1)} <= ${o.boxW})`);
  }
}));

test('a Timer scaled down to almost nothing, or any script arc with a negative radius, renders without errors', async () => app(async ({page,run}) => {
  await run(`(async()=>{
    const script = SMART_TEMPLATES.timer.script;
    const base = {type:'smart', color:'#1f2937', fillColor:'#dc2626', fill:false, strokeOn:true, textColor:'#1f2937',
      size:2, fontFamily:'sans', fontSize:12, font:fontStr('sans',12)};
    items = [
      ...[[30,36],[12,14],[4,5],[1,1]].map(([w,h],k)=>({...base, uid:'t'+k, x:40+k*60, y:40, w, h, script, state:{value:-45}})),
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

test('missing smart previews require consent; exported PNGs load without executing scripts', async()=>app(async({page,run})=>{
  const library={shapes:[{name:'Counter',items:[smartFixture(slowClickScript)]}]};
  await importLibrary(page,library);
  await page.locator('#libraryDialog[open]').waitFor();
  assert.match(await page.locator('#libraryDialogMessage').textContent(),/runs scripts/);
  assert.equal(await page.locator('iframe[sandbox]').count(),0,'import alone must not start script execution');
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
    assert.equal(await page.locator('iframe[sandbox]').count(),0,'bundled PNG must not run the smart script');
    const unchanged=await downloadedJSON(page,run,'exportShapeLibrary()');
    assert.equal(unchanged.shapes[0].thumbnail.png,data.shapes[0].thumbnail.png);
    const changed=JSON.parse(JSON.stringify(data));changed.shapes[0].items[0].state={group:2};
    await importLibrary(page,changed);
    await page.locator('#libraryDialog[open]').waitFor();
    assert.equal(await page.locator('.shape-thumb img').count(),0,'all script state participates in preview invalidation');
    assert.equal(await page.locator('iframe[sandbox]').count(),0,'a stale PNG requires fresh consent');
    await page.locator('#libraryDialogCancel').click();
  }
}));

test('startup libraries keep missing smart previews inert until the library is opened and approved',async()=>app(async({page,run})=>{
  const library={shapes:[{name:'Startup smart',items:[smartFixture(slowClickScript)]}]};
  await page.route('**/shapes-library.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(library)}));
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#shapeLibraryStatus').textContent.includes('1 shape'));
  assert.equal(await page.locator('iframe[sandbox]').count(),0);
  assert.equal(await page.locator('#libraryDialog[open]').count(),0);
  await page.locator('#shapeLibBtn').click();
  await page.locator('#libraryDialog[open]').waitFor();
  await page.locator('#libraryDialogCancel').click();
  assert.equal(await page.locator('iframe[sandbox]').count(),0);
}));

test('ordinary previews are bundled automatically and replacing a shape invalidates its PNG',async()=>app(async({page,run})=>{
  await importLibrary(page,{shapes:[{name:'Box',items:[rectangle()]}]});
  await page.locator('.shape-thumb img').waitFor();
  const first=await downloadedJSON(page,run,'exportShapeLibrary()');
  await run(`items=[{...${JSON.stringify(rectangle())},fillColor:'#3b82f6'}];setTool('select');selection=[0];render();`);
  const replacing=run('replaceLibraryShape(shapeLibrary.shapes[0])');
  await page.locator('#libraryDialogSubmit').click();
  await replacing;
  const second=await downloadedJSON(page,run,'exportShapeLibrary()');
  assert.notEqual(second.shapes[0].thumbnail.png,first.shapes[0].thumbnail.png);
  assert.notEqual(second.shapes[0].thumbnail.source,first.shapes[0].thumbnail.source);
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
      await run(`requestSmartCall(${JSON.stringify(script)},'children',[])`);
      await page.waitForTimeout(100);
      const kids=await run(`requestSmartCall(${JSON.stringify(script)},'children',[])`);
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

test('all shipped templates and both examples retain arcs, zero-width outlines and outside labels',async()=>app(async({run})=>{
  const examples=['drill-template.js','race-start-timer.js'].map(name=>fs.readFileSync(path.join(__dirname,'..','examples',name),'utf8'));
  const result=await run(`(async()=>{
    const scripts=[...Object.values(SMART_TEMPLATES).map(t=>t.script),...${JSON.stringify(examples)}];
    const outputs=[];
    for(const script of scripts){
      const state=await requestSmartCall(script,'initState',[])||{};
      const init=await requestSmartCall(script,'initStyle',[])||{};
      const it={...${JSON.stringify(smartFixture(''))},...init,script,state,w:init.w||180,h:init.h||180};it.font=fontStr(it.fontFamily,it.fontSize);
      const r=await requestSmartSandbox({method:'call',src:script,fn:'children',args:[state,smartResolvedStyle(it),it.w,it.h,true]});
      outputs.push(r.result);
    }
    return outputs;
  })()`);
  assert.equal(result.length,9);
  for(let i=0;i<result.length;i++) assert.ok(result[i].length || i===6,'template '+i+' remains visible');
  const race=result[8];
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
