const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

// Only the served test copy exposes the application closure. The sandbox, graph,
// drawing, pointer handling, persistence, and downloaded reader are production code.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace('\n})();', '\nwindow.__test = {run: source => eval(source)};\n})();');
const engine = process.env.BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
let browser;
before(async () => {
  browser = await ({chromium, webkit}[engine]).launch({headless:true,
    ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
});
after(async () => { if(browser) await browser.close(); });

async function app(fn,{origin='http://components.test'}={}){
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  try{
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route(origin+'/**', route => route.fulfill({
      status:route.request().url().endsWith('index.html') ? 200 : 404,
      contentType:'text/html',body:html
    }));
    await page.goto(origin+'/index.html');
    const run = source => page.evaluate(async source => {
      await __test.run('appReady');return __test.run(source);
    },source);
    await run('appStarted');
    await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}

const producerScript = `({apiVersion:2,
  inputs:{},outputs:{value:{type:'number'}},
  compute(inputs,state){return {value:state.n};},
  children(state,style,w,h,editing,io){return [
    {type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#dbeafe'},
    {type:'text',x:5,y:0,w,h:30,text:'Source:'+io.outputs.value,strokeOn:false}];},
  handles(){return [{id:'increment',x:40,y:45,kind:'click'}];},
  hitEdit(state,x,y){return Math.hypot(x-40,y-45)<16?'increment':null;},
  dragEdit(state){return {state:{n:state.n+4}};}
})`;
const consumerScript = `({apiVersion:2,
  inputs:{value:{type:'number',default:2}},outputs:{scaled:{type:'number'}},
  compute(inputs){return {scaled:inputs.value*2};},
  children(state,style,w,h,editing,io){return [
    {type:'rect',x:0,y:35,w:io.outputs.scaled,h:20,fill:true,fillColor:'#dc2626',strokeOn:false},
    {type:'text',x:0,y:0,w,h:30,text:'Gauge:'+io.outputs.scaled,strokeOn:false}];}
})`;
const smart = (uid,script,state={},extra={}) => ({type:'smart',uid,x:100,y:100,w:180,h:90,
  color:'#000000',fillColor:'#dc2626',strokeOn:true,fill:false,textColor:'#000000',size:2,
  fontFamily:'sans',fontSize:12,font:'600 12px sans-serif',script,state,componentApi:2,...extra});
const pair = (n=6) => [smart('source',producerScript,{n}),smart('gauge',consumerScript,{},
  {x:400,bindings:{value:{uid:'source',port:'value'}}})];

async function seed(run,list){
  await run(`cancelGesture();applySketchToActiveTab(${JSON.stringify(list)},{});setTool('select');selection=[];render();save();`);
}
async function drawing(page,uid,text){
  await page.waitForFunction(({uid,text})=>__test.run(`smartChildrenCache.get(${JSON.stringify(uid)})?.kids.some(k=>k.text===${JSON.stringify(text)})`),{uid,text},{timeout:10000});
}
async function editorClick(page,run,index=0){
  const item=await run(`selection=[${index}];editingSmartIdx=${index};render();items[${index}]`);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+40,box.y+item.y+45);
  await run('smartHitSettled');
}
async function downloadJSON(page,run,expression='exportProject()'){
  const download=page.waitForEvent('download');await run(expression);
  return JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
}
async function openExport(page,run,context,{init}={}){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const file=await(await download).path(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-components-'));
  const output=path.join(directory,'document.html');fs.copyFileSync(file,output);
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const preview=await context.newPage(),errors=[],requests=[];
  preview.on('pageerror',error=>errors.push(error.message));
  preview.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  if(init)await preview.addInitScript(init);
  await preview.goto(pathToFileURL(output).href);
  return {preview,errors,requests,source:fs.readFileSync(output,'utf8')};
}
async function readerClick(page,host,x=40,y=45){
  const point=await host.evaluate((el,{x,y})=>{
    const p=new DOMPoint(x,y).matrixTransform(el.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};
  },{x,y});
  await page.mouse.click(point.x,point.y);
}
async function readerDrawing(page,panel,text){
  await page.waitForFunction(({panel,text})=>{
    const panels=document.querySelectorAll('.tab-panel');
    return (panels.length?panels[panel]:document.body)?.querySelector('[data-smart-index="1"]')?.textContent===text;
  },{panel,text},{timeout:10000});
}

test('connected values update actual drawing and SVG, undo/redo, and JSON reload',async()=>app(async({page,run})=>{
  await seed(run,pair());await drawing(page,'gauge','Gauge:12');
  assert.equal(await run("smartChildrenCache.get('gauge').kids.find(k=>k.type==='rect').w"),12);
  assert.match(await run('itemsToSVGMarkup(items)'),/Gauge:12/);
  await editorClick(page,run);await drawing(page,'gauge','Gauge:20');
  assert.equal(await run('items[0].state.n'),10);
  await run('undo()');await drawing(page,'gauge','Gauge:12');
  await run('redo()');await drawing(page,'gauge','Gauge:20');
  const project=await downloadJSON(page,run);
  assert.deepEqual(project.items[1].bindings,{value:{uid:'source',port:'value'}});
  assert.equal(project.items[0].componentApi,2);
  assert.equal(project.items[0].state.n,10);
  await page.reload();await drawing(page,'gauge','Gauge:20');
  assert.deepEqual(await run('items[1].bindings'),project.items[1].bindings);
  assert.match(await run('itemsToSVGMarkup(items)'),/Gauge:20/);
}));

test('the supplied Number control and Gauge can be connected with the input picker and exported',async()=>app(async({page,run,context})=>{
  await run(`(async()=>{
    const control={...${JSON.stringify(smart('control',''))},script:SMART_TEMPLATES.numberControl.script,componentName:'Number control'};
    const gauge={...${JSON.stringify(smart('gauge',''))},script:SMART_TEMPLATES.gauge.script,x:400,componentName:'Gauge'};
    await initializeSmartItem(control);await initializeSmartItem(gauge);
    applySketchToActiveTab([control,gauge],{});setTool('select');selection=[1];render();save();
  })()`);
  await drawing(page,'gauge','0%');
  await page.locator('#componentBindingsBtn').click();
  const selector=page.locator('#componentInputFields .component-input select');
  await selector.selectOption(JSON.stringify({uid:'control',port:'value'}));
  await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  await drawing(page,'gauge','50%');
  assert.deepEqual(await run('items[1].bindings'),{value:{uid:'control',port:'value'}});
  await run('undo()');await drawing(page,'gauge','0%');
  await run('redo()');await drawing(page,'gauge','50%');
  const control=await run('selection=[0];editingSmartIdx=0;render();items[0]');
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+control.x+control.w*.75,box.y+control.y+control.h*.84);
  await run('smartHitSettled');await drawing(page,'gauge','55%');
  const {preview,errors,requests}=await openExport(page,run,context);
  await readerDrawing(preview,0,'55%');
  await readerClick(preview,preview.locator('[data-smart-index="0"]'),control.w*.75,control.h*.84);
  await readerDrawing(preview,0,'60%');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('downloaded connected HTML recomputes offline and resets to the saved state on reload',async()=>app(async({page,run,context})=>{
  await seed(run,pair());
  const {preview,errors,requests,source}=await openExport(page,run,context);
  assert.ok(source.includes('Gauge:12'),'initial static fallback contains settled derived geometry');
  await readerDrawing(preview,0,'Gauge:12');
  const control=preview.locator('[data-smart-index="0"]');
  await readerClick(preview,control);await readerDrawing(preview,0,'Gauge:20');
  await readerClick(preview,control);await readerDrawing(preview,0,'Gauge:28');
  assert.equal(await control.locator('[data-resize-width],[data-resize-height],[data-rotate]').count(),0);
  assert.equal(await run('items[0].state.n'),6,'reader interaction does not change the editor');
  await preview.reload();await readerDrawing(preview,0,'Gauge:12');
  assert.deepEqual(requests,[],'file opened from disk makes no network requests');
  assert.deepEqual(errors,[]);
}));

test('string and boolean ports preserve literals and bindings without conflating false with a default',async()=>app(async({page,run})=>{
  const source=`({apiVersion:2,inputs:{},outputs:{word:{type:'string'},active:{type:'boolean'}},
    compute(){return {word:'bound <value>',active:true};},children(){return [];}})`;
  const target=`({apiVersion:2,
    inputs:{word:{type:'string',default:'default'},active:{type:'boolean',default:true}},outputs:{},
    children(s,style,w,h,editing,io){return [{type:'text',x:0,y:0,w:300,h:30,
      text:(io.inputs.active?'ON:':'OFF:')+io.inputs.word,strokeOn:false}];}})`;
  await seed(run,[smart('source',source),smart('literal',target,{}, {x:300,inputValues:{word:'literal <value>',active:false}}),
    smart('bound',target,{}, {x:650,bindings:{word:{uid:'source',port:'word'},active:{uid:'source',port:'active'}}})]);
  await drawing(page,'literal','OFF:literal <value>');await drawing(page,'bound','ON:bound <value>');
  const svg=await run('itemsToSVGMarkup(items)');
  assert.match(svg,/OFF:literal &lt;value&gt;/);assert.match(svg,/ON:bound &lt;value&gt;/);
  const project=await downloadJSON(page,run);
  assert.deepEqual(project.items[1].inputValues,{word:'literal <value>',active:false});
  await page.reload();await drawing(page,'literal','OFF:literal <value>');await drawing(page,'bound','ON:bound <value>');
}));

test('connected duplicates and clipboard copies bind their own new source',async()=>app(async({page,run})=>{
  await seed(run,pair());await drawing(page,'gauge','Gauge:12');
  await run('selection=[0,1];duplicateSelection();');
  const duplicate=await run('items.slice(2)');
  assert.notEqual(duplicate[0].uid,'source');assert.notEqual(duplicate[1].uid,'gauge');
  assert.equal(duplicate[1].bindings.value.uid,duplicate[0].uid);
  await run('beginHistory();items[2].state={n:19};commitHistory();render();');
  await drawing(page,duplicate[1].uid,'Gauge:38');
  await drawing(page,'gauge','Gauge:12');
  await run('selection=[2,3];copySelection();pasteClipboard();');
  const pasted=await run('items.slice(4)');
  assert.equal(pasted[1].bindings.value.uid,pasted[0].uid);
  assert.notEqual(pasted[0].uid,duplicate[0].uid);
  await drawing(page,pasted[1].uid,'Gauge:38');
}));

test('pasting a consumer alone cannot attach its external binding to a coincidentally matching UID',async()=>app(async({page,run})=>{
  await seed(run,pair());await drawing(page,'gauge','Gauge:12');
  await run('selection=[1];copySelection();newTab();');
  await seed(run,[smart('source',producerScript,{n:99})]);
  await run('pasteClipboard()');
  const binding=await run('items[1].bindings.value');
  assert.equal(binding.uid,'source');assert.equal(binding.port,'value');assert.equal(binding.unresolved,true);
  await page.waitForFunction(()=>Boolean(__test.run('componentGraphError(items[1])')));
  assert.match(await run('componentGraphError(items[1])'),/source|unresolved|missing/i);
  assert.deepEqual(await run('items.map(it=>it.state)'),[{n:99},{}]);
}));

test('copying a connected consumer keeps its rendered PNG while editable bindings remain unresolved',async()=>app(async({page,run})=>{
  await page.evaluate(()=>{
    window.clipboardWrites=[];
    Object.defineProperty(navigator.clipboard,'write',{value:async entries=>{clipboardWrites.push(entries);}});
  });
  await seed(run,pair(60));await drawing(page,'gauge','Gauge:120');
  await run('selection=[1];copySelection()');
  const clipboard=await page.evaluate(async()=>{
    const item=clipboardWrites.at(-1)[0],png=await item.getType('image/png');
    const bitmap=await createImageBitmap(png),canvas=document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let redPixels=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]>180 && pixels[i+1]<70 && pixels[i+2]<70 && pixels[i+3]>220)redPixels++;
    return {redPixels,payload:JSON.parse(await(await item.getType('text/plain')).text())};
  });
  assert.ok(clipboard.redPixels>1800,'the actual PNG contains the 120×20 red bar computed from the unselected source');
  assert.equal(clipboard.payload.items.length,1);
  assert.notEqual(clipboard.payload.items[0].uid,'gauge');
  assert.deepEqual(clipboard.payload.items[0].bindings.value,{uid:'source',port:'value',unresolved:true});
},{origin:'http://localhost:8875'}));

test('matching UIDs in different tabs remain isolated in editor and offline reader',async()=>app(async({page,run,context})=>{
  await seed(run,pair(6));await drawing(page,'gauge','Gauge:12');
  const first=await run('activeTabId');
  await run('newTab()');await seed(run,pair(31));await drawing(page,'gauge','Gauge:62');
  const second=await run('activeTabId');
  await run(`activateTab(${JSON.stringify(first)})`);await drawing(page,'gauge','Gauge:12');
  await editorClick(page,run);await drawing(page,'gauge','Gauge:20');
  await run(`activateTab(${JSON.stringify(second)})`);await drawing(page,'gauge','Gauge:62');
  const {preview,errors,requests}=await openExport(page,run,context);
  await readerDrawing(preview,0,'Gauge:20');
  await readerClick(preview,preview.locator('.tab-panel').nth(0).locator('[data-smart-index="0"]'));
  await readerDrawing(preview,0,'Gauge:28');
  await preview.locator('.tab-select').nth(1).click();await readerDrawing(preview,1,'Gauge:62');
  await readerClick(preview,preview.locator('.tab-panel').nth(1).locator('[data-smart-index="0"]'));
  await readerDrawing(preview,1,'Gauge:70');
  await preview.locator('.tab-select').nth(0).click();await readerDrawing(preview,0,'Gauge:28');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('ambiguous imported IDs keep component references unresolved while preserving the drawing',async()=>app(async({page,run})=>{
  const fixture=[smart('ambiguous',producerScript,{n:6}),smart('ambiguous',producerScript,{n:99},{x:350}),
    smart('consumer',consumerScript,{}, {x:650,bindings:{value:{uid:'ambiguous',port:'value'}}})];
  const project={app:'SimpleCanvas',version:4,items:fixture,assets:{}};
  await run(`openWorkspaceFile(new File([${JSON.stringify(JSON.stringify(project))}],'ambiguous.json'))`);
  await page.waitForFunction(()=>__test.run('items.length')===3);
  await page.waitForFunction(()=>Boolean(__test.run('componentGraphError(items[2])')));
  assert.equal(await run('new Set(items.map(it=>it.uid)).size'),3,'ordinary ID repair still produces unique identities');
  assert.deepEqual(await run('items[2].bindings.value'),{uid:'ambiguous',port:'value',unresolved:true});
  assert.deepEqual(await run('items.slice(0,2).map(it=>it.state.n)'),[6,99]);
  const recovered=await downloadJSON(page,run);
  assert.deepEqual(recovered.items.map(it=>it.script),fixture.map(it=>it.script));
  await page.reload();await page.waitForFunction(()=>Boolean(__test.run('componentGraphError(items[2])')));
  assert.equal(await run('items[2].bindings.value.unresolved'),true);
  await page.locator('#shapeLibraryInput').setInputFiles({name:'ambiguous-library.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({shapes:[{name:'Ambiguous',items:fixture}]}))});
  await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes[0]?.name')==='Ambiguous');
  assert.equal(await run('shapeLibrary.shapes[0].items[2].bindings.value.unresolved'),true,'library imports use the same ambiguity guard');
}));

test('connected selections survive library export/import and each placement gets independent internal bindings',async()=>app(async({page,run})=>{
  await seed(run,pair());await drawing(page,'gauge','Gauge:12');
  const adding=run('selection=[0,1];addSelectionToLibrary()');
  await page.locator('#libraryNameInput').fill('Connected pair');
  await page.locator('#libraryDialogSubmit').click();await adding;
  const library=await downloadJSON(page,run,'exportShapeLibrary()');
  const saved=library.shapes[0];
  assert.equal(saved.items[1].bindings.value.uid,saved.items[0].uid);
  assert.ok(saved.thumbnail?.png?.startsWith('data:image/png;base64,'),'connected preview is generated from resolved values');
  await page.reload();await seed(run,[]);
  await page.locator('#shapeLibraryInput').setInputFiles({name:'connected-library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(library))});
  await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes[0]?.name')==='Connected pair');
  assert.equal(await run('Boolean(validShapeThumbnail(shapeLibrary.shapes[0]))'),true);
  await run('placeShapeAt(shapeLibrary.shapes[0],300,250)');
  await run('placeShapeAt(shapeLibrary.shapes[0],800,250)');
  const placed=await run('items');assert.equal(placed.length,4);
  assert.equal(new Set(placed.map(it=>it.uid)).size,4);
  assert.equal(placed[1].bindings.value.uid,placed[0].uid);
  assert.equal(placed[3].bindings.value.uid,placed[2].uid);
  await drawing(page,placed[1].uid,'Gauge:12');await drawing(page,placed[3].uid,'Gauge:12');
  await run('beginHistory();items[0].state={n:22};commitHistory();render()');
  await drawing(page,placed[1].uid,'Gauge:44');await drawing(page,placed[3].uid,'Gauge:12');
}));

test('legacy drag state containing state and emit keys remains an ordinary state object',async()=>app(async({page,run,context})=>{
  const legacy=`({children(s){return [{type:'text',x:0,y:0,w:180,h:30,text:'Legacy:'+s.state,strokeOn:false}];},
    handles(){return [{id:'increment',x:40,y:45,kind:'click'}];},hitEdit(){return 'increment';},
    dragEdit(s){return {state:s.state+1,emit:'plain data',effects:{note:'still data'}};}})`;
  const item=smart('legacy',legacy,{state:7,emit:'plain data'});delete item.componentApi;
  await seed(run,[item]);await drawing(page,'legacy','Legacy:7');
  await editorClick(page,run);await drawing(page,'legacy','Legacy:8');
  assert.deepEqual(await run('items[0].state'),{state:8,emit:'plain data',effects:{note:'still data'}});
  const {preview,errors}=await openExport(page,run,context);
  const host=preview.locator('[data-smart-index="0"]');
  await preview.waitForFunction(()=>document.querySelector('[data-smart-ready="true"]'));
  await readerClick(preview,host);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').textContent==='Legacy:9');
  assert.deepEqual(errors,[]);
}));

test('rapid source changes settle on the newest computation without mutating saved state',async()=>app(async({page,run})=>{
  const slow=producerScript.replace('return {value:state.n};','const until=performance.now()+120;while(performance.now()<until){}return {value:state.n};');
  const fixture=pair();fixture[0].script=slow;
  await seed(run,fixture);await drawing(page,'gauge','Gauge:12');
  await run('items[0].state={n:1};render();');
  await page.waitForTimeout(25);
  await run('items[0].state={n:7};render();items[0].state={n:13};render();');
  await drawing(page,'gauge','Gauge:26');
  await page.waitForTimeout(350);
  assert.equal(await run("smartChildrenCache.get('gauge').kids.find(k=>k.type==='rect').w"),26);
  assert.deepEqual(await run('items.map(it=>it.state)'),[{n:13},{}]);
  assert.match(await run('itemsToSVGMarkup(items)'),/Gauge:26/);
}));

test('unsupported component versions preserve source, bindings, and literals through JSON reload',async()=>app(async({page,run})=>{
  const script=consumerScript.replace('apiVersion:2','apiVersion:99');
  const future=smart('future',script,{retain:'future data'},{componentApi:99,
    inputValues:{value:42},bindings:{value:{uid:'missing',port:'futurePort'}}});
  await seed(run,[future]);
  const project=await downloadJSON(page,run);
  for(const key of ['script','componentApi','state','bindings','inputValues'])assert.deepEqual(project.items[0][key],future[key],key);
  await page.reload();
  const restored=await run('items[0]');
  for(const key of ['script','componentApi','state','bindings','inputValues'])assert.deepEqual(restored[key],future[key],key+' after reload');
}));

test('deleting a connected source reports the broken binding and undo restores its output',async()=>app(async({page,run})=>{
  await seed(run,pair());await drawing(page,'gauge','Gauge:12');
  await run('selection=[0];deleteSelected();');
  await page.waitForFunction(()=>Boolean(__test.run('componentGraphError(items[0])')));
  assert.match(await run('componentGraphError(items[0])'),/source|missing|unavailable/i);
  assert.deepEqual(await run('items[0].bindings'),{value:{uid:'source',port:'value'}});
  await run('undo()');await drawing(page,'gauge','Gauge:12');
  assert.equal(await run('componentGraphError(items[1])'),'');
}));

test('cycles, missing ports, wrong output types, and failed computations isolate errors and retain source data',async()=>app(async({page,run})=>{
  const failures=[
    [smart('bad',consumerScript,{}, {bindings:{value:{uid:'bad',port:'scaled'}}})],
    [smart('left',consumerScript,{}, {bindings:{value:{uid:'right',port:'scaled'}}}),
      smart('right',consumerScript,{}, {x:350,bindings:{value:{uid:'left',port:'scaled'}}})],
    [smart('producer',producerScript,{n:6}),
      smart('bad',consumerScript,{}, {bindings:{value:{uid:'producer',port:'nonexistent'}}})],
    [smart('producer',producerScript.replace('return {value:state.n};',"return {value:'not a number'};"),{n:6}),
      smart('bad',consumerScript,{}, {bindings:{value:{uid:'producer',port:'value'}}})],
    [smart('producer',producerScript.replace('return {value:state.n};',"throw new Error('Computation failed');"),{n:6}),
      smart('bad',consumerScript,{}, {bindings:{value:{uid:'producer',port:'value'}}})]
  ];
  for(const fixture of failures){
    fixture.push(smart('healthy',producerScript,{n:8},{x:700}));
    await seed(run,fixture);await drawing(page,'healthy','Source:8');
    await page.waitForFunction(()=>Boolean(__test.run('componentGraphError(items[items.length-2])')));
    assert.ok(await run('componentGraphError(items[items.length-2])'));
    assert.equal(await run("smartChildrenCache.get('healthy').kids.find(k=>k.type==='text').text"),'Source:8');
    const saved=await downloadJSON(page,run);
    for(let i=0;i<fixture.length;i++){
      assert.equal(saved.items[i].script,fixture[i].script,'error does not replace its recoverable script');
      assert.deepEqual(saved.items[i].state,fixture[i].state,'error does not rewrite local state');
      assert.deepEqual(saved.items[i].bindings||{},fixture[i].bindings||{});
    }
  }
}));

test('offline HTML shows component failures while independent components remain usable',async()=>app(async({page,run,context})=>{
  await seed(run,[
    smart('cycle',consumerScript,{}, {bindings:{value:{uid:'cycle',port:'scaled'}}}),
    smart('future',consumerScript.replace('apiVersion:2','apiVersion:99'),{}, {componentApi:99,x:350}),
    smart('healthy',producerScript,{n:8},{x:650})
  ]);
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-component-error]').length>=2);
  const messages=await preview.locator('[data-component-error]').allTextContents();
  assert.ok(messages.some(message=>/cycle|cyclic/i.test(message)));
  assert.ok(messages.some(message=>/version|unsupported/i.test(message)));
  const healthy=preview.locator('[data-smart-index="2"]');
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="2"]').textContent==='Source:8');
  await readerClick(preview,healthy);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="2"]').textContent==='Source:12');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('an offline component retry does not discard a healthy in-flight click',async()=>app(async({page,run,context})=>{
  const slowProducer=producerScript.replace('return {state:{n:state.n+4}};',
    'console.log("healthy-drag-started");const end=performance.now()+200;while(performance.now()<end){}return {state:{n:state.n+4}};');
  await seed(run,[smart('healthy',slowProducer,{n:8}),
    smart('future',consumerScript.replace('apiVersion:2','apiVersion:99'),{},{componentApi:99,x:400})]);
  const {preview,errors,requests}=await openExport(page,run,context,{init:()=>{
    // Hold only the reader's backoff timer so its real callback can run deterministically
    // while the healthy hook is busy in its Worker. No application functions are replaced.
    const now=performance.now.bind(performance),set=window.setTimeout.bind(window),clear=window.clearTimeout.bind(window);
    let offset=0,nextId=1000000000;
    const retries=new Map();
    performance.now=()=>now()+offset;
    window.setTimeout=(fn,delay,...args)=>{
      if(delay>2500 && delay<=3001){
        const id=++nextId;retries.set(id,{fn,args,due:performance.now()+delay});return id;
      }
      return set(fn,delay,...args);
    };
    window.clearTimeout=id=>{if(!retries.delete(id))clear(id);};
    window.__runComponentRetry=()=>{
      const pending=retries.entries().next().value;
      if(!pending)throw new Error('Expected a scheduled component retry');
      const [id,retry]=pending;retries.delete(id);
      offset=Math.max(offset,retry.due-now()+1);retry.fn(...retry.args);
    };
  }});
  const healthy=preview.locator('[data-smart-index="0"]');
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').textContent==='Source:8' &&
    document.querySelectorAll('[data-component-error]').length===1);
  const started=preview.waitForEvent('console',{predicate:message=>message.text()==='healthy-drag-started'});
  const click=readerClick(preview,healthy);
  await started;
  await preview.evaluate(()=>window.__runComponentRetry());
  await click;
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').textContent==='Source:12',{},{timeout:5000});
  assert.equal(await healthy.getAttribute('data-component-error'),null);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('delayed component computations cannot repaint after undo, sketch replacement, or closing their tab',async()=>app(async({page,run})=>{
  const delayed=producerScript.replace('return {value:state.n};',
    'if(state.delay){console.log("component-compute-start:"+state.n);const end=performance.now()+200;while(performance.now()<end){}}return {value:state.n};');
  const fixture=n=>{const list=pair(n);list[0].script=delayed;return list;};
  await seed(run,fixture(6));await drawing(page,'gauge','Gauge:12');
  // Observe the actual geometry cache each frame, including the period after old hooks would
  // have replied. A stale value flashing briefly is a regression even if a later render fixes it.
  await page.evaluate(()=>{
    window.__componentPaintTrace=[];window.__stopComponentPaintTrace=false;
    const observe=()=>{
      const value=__test.run("smartChildrenCache.get('gauge')?.kids.find(k=>k.type==='text')?.text");
      if(value)window.__componentPaintTrace.push(value);
      if(!window.__stopComponentPaintTrace)requestAnimationFrame(observe);
    };
    observe();
  });
  const startDelayed=async n=>{
    const started=page.waitForEvent('console',{predicate:message=>message.text()==='component-compute-start:'+n});
    await run(`beginHistory();items[0].state={n:${n},delay:true};commitHistory();render();`);
    await started; // The real Worker is inside compute(), not just queued for a future call.
  };

  await startDelayed(40);
  await run('undo()');await drawing(page,'gauge','Gauge:12');
  await page.waitForTimeout(300);
  assert.deepEqual(await run('items[0].state'),{n:6});
  assert.equal(await run("smartChildrenCache.get('gauge').kids.find(k=>k.type==='rect').w"),12);

  await startDelayed(41);
  await seed(run,fixture(9));await drawing(page,'gauge','Gauge:18');
  await page.waitForTimeout(300);
  assert.deepEqual(await run('items[0].state'),{n:9});
  assert.equal(await run("smartChildrenCache.get('gauge').kids.find(k=>k.type==='rect').w"),18);

  const retiredTab=await run('activeTabId');
  await startDelayed(42);
  await run('newTab()');await seed(run,pair(21));
  await run(`closeTab(${JSON.stringify(retiredTab)})`);
  await drawing(page,'gauge','Gauge:42');
  await page.waitForTimeout(300);
  assert.equal(await run(`tabs.some(tab=>tab.id===${JSON.stringify(retiredTab)})`),false);
  assert.deepEqual(await run('items[0].state'),{n:21});
  assert.equal(await run("smartChildrenCache.get('gauge').kids.find(k=>k.type==='rect').w"),42);
  assert.equal(await run("smartCacheOwners.get('gauge').item===items[1]"),true);
  const observed=await page.evaluate(()=>{window.__stopComponentPaintTrace=true;return window.__componentPaintTrace;});
  assert.ok(observed.length>0);
  assert.deepEqual(observed.filter(value=>['Gauge:80','Gauge:82','Gauge:84'].includes(value)),[],
    'discarded computations never become the visible drawing of a restored or replacement document');
}));
