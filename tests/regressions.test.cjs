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

test('ungrouped text/table still open their own editor on the very first double-click, unaffected', async () => app(async ({page,run}) => {
  await run(`items=[{type:'text',uid:'t1',x:100,y:100,w:200,h:50,text:'hello',font:'400 28px sans-serif',
    color:'#1f2937',textColor:'#1f2937',strokeOn:false,fill:false,align:'center',size:2}];setTool('select');render();`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(canvas.x+200,canvas.y+125);
  assert.deepEqual(await run('JSON.stringify({editingGroupId,editingTextIdx})'),
    JSON.stringify({editingGroupId:null,editingTextIdx:0}));
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

async function importLibrary(page, library){
  await page.locator('#shapeLibraryInput').setInputFiles({name:'library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(library))});
}

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

const demoLibrary = fs.readFileSync(path.join(__dirname,'..','examples','demo-shapes-library.json'),'utf8');

const settingsFile=features=>JSON.stringify({version:1,features});

async function printFrameReady(page){
  await page.waitForFunction(()=>__test.run('printPreviewReady'));
}

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

test('a saved static selection exports, imports and places as independent reusable copies',async()=>app(async({page,run})=>{
  await run(`items=[${JSON.stringify(rectangle('frame'))},{type:'text',uid:'label',x:115,y:130,w:130,h:40,text:'Reusable',font:'600 20px sans-serif',fontFamily:'sans',fontSize:20,textColor:'#000000',color:'#000000',size:1,strokeOn:false,fill:false}];setTool('select');selection=[0,1];render();`);
  await page.locator('#shapeLibBtn').click();await page.locator('#addSelectionFooterBtn').click();
  await page.locator('#libraryNameInput').fill('Labelled box');await page.locator('#libraryDialogSubmit').click();
  const library=await downloadedJSON(page,run,'exportShapeLibrary()');
  assert.equal(library.shapes.length,1);assert.deepEqual(library.shapes[0].items.map(it=>it.type),['rect','text']);
  assert.ok(library.shapes[0].thumbnail.png.startsWith('data:image/png;base64,'));
  await importLibrary(page,library);
  for(const x of [400,700]){
    await page.getByRole('button',{name:'Place Labelled box',exact:true}).click();
    const bounds=await page.locator('#canvas').boundingBox();await page.mouse.click(bounds.x+x,bounds.y+350);
    if(x===400)await page.locator('#shapeLibBtn').click();
  }
  assert.equal(await run('items.length'),6);assert.equal(await run('new Set(items.map(it=>it.uid)).size'),6);
  await run("items[4].fillColor='#ef4444';save()");
  assert.equal(await run('items[2].fillColor'),'#ffd166');
  assert.equal(await run('shapeLibrary.shapes[0].items[0].fillColor'),'#ffd166');
  const sketch=await downloadedJSON(page,run,'exportProject()');
  assert.equal(sketch.items.length,6);assert.equal(sketch.items[4].fillColor,'#ef4444');
}));

test('older scripted objects stay inert and retain their recoverable source through save, reload and export',async()=>app(async({page,run})=>{
  await page.evaluate(()=>{window.__workerStarts=0;window.Worker=class{constructor(){window.__workerStarts++;throw new Error('Scripts must not execute');}};});
  const source='({children(){while(true){}},dragEdit(){throw new Error("never execute");}})';
  const legacy={...rectangle('legacy'),type:'smart',script:source,state:{value:42},rotation:.25};
  assert.deepEqual(await run(`{const it=normalizeItem({type:'smart',x:0,y:0,script:${JSON.stringify(source)},state:{}},{});[it.w,it.h]}`),[100,100]);
  await run(`{const scene=normalizeScene([${JSON.stringify(legacy)},${JSON.stringify(rectangle('static'))}],{},FORMAT_VERSION);applySketchToActiveTab(scene.items,scene.assets);setTool('select');render();}`);
  assert.equal(await run('items.length'),2);assert.equal(await run('items[0].type'),'rect');
  assert.equal(await page.evaluate(()=>window.__workerStarts),0);
  const svgDownload=page.waitForEvent('download');await run('saveSvg()');
  const svg=fs.readFileSync(await(await svgDownload).path(),'utf8');assert.match(svg,/Smart shape/);assert.match(svg,/Open in Paperwire/);
  await page.reload();assert.equal(await run('items[0].unsupportedShape.script'),source);
  await run('items[0].x=250;delete items[0].rotation;save();render()');
  const sketch=await downloadedJSON(page,run,'exportProject()');
  assert.equal(sketch.items[0].type,'smart');assert.equal(sketch.items[0].script,source);
  assert.deepEqual(sketch.items[0].state,{value:42});assert.equal(sketch.items[0].x,250);assert.equal(Object.hasOwn(sketch.items[0],'rotation'),false);
  const before=await run('JSON.stringify(shapeLibrary)');
  await importLibrary(page,{shapes:[{name:'Old script',items:[legacy]}]});
  assert.equal(await run('JSON.stringify(shapeLibrary)'),before,'a scripted library cannot replace the current static library');
  assert.match(await page.locator('#toast').textContent(),/Paperwire/);
}));
