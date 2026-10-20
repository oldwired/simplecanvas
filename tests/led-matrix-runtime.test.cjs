const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

// Only the served editor exposes its closure. Port edits and wiring use the real
// UI; the exported reader uses its unmodified Worker/runtime implementation.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{await browser?.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://led-matrix.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://led-matrix.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function seed(run,specs){
  await run(`cancelGesture();applySketchToActiveTab(${JSON.stringify(specs)}.map((spec,index)=>{
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key===spec.key).items[0]);
    return {...base,x:60+index*450,y:130,uid:'matrix-'+index,...spec,state:{...base.state,...spec.state}};
  }),{});selection=[];editingSmartIdx=null;setTool('select');render();`);
  await run('ensureEditorComponentGraph()');await run('save()');
}
async function edit(page,run,index){
  await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open && !document.querySelector('#componentBindingsSave').disabled);
}
async function saveEdit(page){
  await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
}
const output=(run,index)=>run(`(async()=> (await resolveSmartComponentIo(items[${index}])).outputs)()`);
const port=(page,uid,name,direction)=>page.locator(`#componentWiringOverlay [data-wire-port][data-uid="${uid}"][data-port="${name}"][data-direction="${direction}"]`);
async function point(locator){
  for(let attempt=0;attempt<10;attempt++){
    await locator.waitFor({state:'visible'});
    const p=await locator.evaluate(el=>{
      if(!el.isConnected)return null;
      const shape=el.matches('circle')?el:el.querySelector('circle')||el,r=shape.getBoundingClientRect();
      return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;
    });
    if(p)return p;
  }
  assert.fail('port did not retain a rendered hit target');
}
async function drag(page,from,to){
  const a=await point(from),b=await point(to);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();
}
const rowValues={r0:128,r1:32,r2:0,r3:0,r4:0,r5:0,r6:0,r7:129};
const columnValues={c0:129,c1:0,c2:64,c3:0,c4:0,c5:0,c6:0,c7:1};

test('column-byte mode edits and persists independently of row mode and retains all row and column outputs',async()=>app(async({page,run})=>{
  await seed(run,[{key:'constant',componentName:'Column source',state:{value:129}},{key:'ledMatrix'}]);
  await edit(page,run,1);await page.getByLabel('Input mode',{exact:true}).selectOption('columns');
  await page.getByLabel('c7 value',{exact:true}).waitFor({state:'visible'});
  assert.equal(await page.getByLabel('row0 (boolean)',{exact:true}).count(),0);
  await page.getByLabel('c0 (number)',{exact:true}).selectOption(JSON.stringify({uid:'matrix-0',port:'value'}));
  await page.getByLabel('c2 value',{exact:true}).fill('64');await page.getByLabel('c7 value',{exact:true}).fill('1');
  await page.waitForFunction(()=>{
    const out=document.querySelector('#componentOutputs');
    return out.getAttribute('aria-busy')!=='true' && ['r0 = 128','r1 = 32','r7 = 129','c0 = 129','c2 = 64','c7 = 1'].every(value=>out.textContent.includes(value));
  });
  await saveEdit(page);assert.deepEqual(await output(run,1),{...rowValues,...columnValues});
  await page.reload();await run('appStarted');
  assert.equal(await run('items[1].state.mode'),'columns');
  assert.deepEqual(await run('items[1].bindings.c0'),{uid:'matrix-0',port:'value'});
  assert.deepEqual(await output(run,1),{...rowValues,...columnValues});

  await edit(page,run,1);await page.getByLabel('Input mode',{exact:true}).selectOption('rows');
  await page.getByLabel('r0 value',{exact:true}).waitFor({state:'visible'});
  assert.equal(await page.getByLabel('c0 (number)',{exact:true}).count(),0);
  await page.getByLabel('r0 value',{exact:true}).fill('255');await saveEdit(page);
  assert.equal(await run('items[1].bindings?.c0'),undefined,'mode change removes the obsolete column input binding');
  assert.deepEqual(await output(run,1),{r0:255,r1:0,r2:0,r3:0,r4:0,r5:0,r6:0,r7:0,
    c0:128,c1:128,c2:128,c3:128,c4:128,c5:128,c6:128,c7:128},'row mode still publishes column bytes with the top LED as bit 7');
}));

test('column inputs wire at the top and column outputs at the bottom while row outputs remain on the right',async()=>app(async({page,run})=>{
  await seed(run,[{key:'constant',x:100,y:100,state:{value:129}},{key:'ledMatrix',x:550,y:300,state:{mode:'columns'}},
    {key:'valueLabel',x:1110,y:600,componentName:'Column result'}]);
  await page.locator('#componentWiringBtn').click();await run('ensureEditorComponentGraph()');await run('renderComponentWiring()');
  const positions=await run(`componentWiring.model.ports.filter(port=>port.uid==='matrix-1').map(port=>({name:port.name,direction:port.direction,role:port.role,side:port.side,...componentWirePoint(port)}))`);
  for(let index=0;index<8;index++){
    const input=positions.find(p=>p.name==='c'+index&&p.direction==='in');
    const column=positions.find(p=>p.name==='c'+index&&p.direction==='out');
    const row=positions.find(p=>p.name==='r'+index&&p.direction==='out');
    assert.equal(input.side,'top');assert.equal(input.role,'data');assert.ok(input.y<300);
    assert.equal(column.side,'bottom');assert.equal(column.role,'data');assert.ok(column.y>720);
    assert.equal(row.side,'right');assert.equal(row.role,'data');assert.ok(row.x>950);
  }
  await drag(page,port(page,'matrix-1','c0','in'),port(page,'matrix-0','value','out'));
  await page.waitForFunction(()=>__test.run('items[1].bindings?.c0?.uid')==='matrix-0');
  await drag(page,port(page,'matrix-1','c0','out'),port(page,'matrix-2','value','in'));
  await page.waitForFunction(()=>__test.run('items[2].bindings?.value?.port')==='c0');
  assert.deepEqual(await output(run,2),{value:129},'the new column output is a usable numeric flow');
  assert.equal(await page.locator('[data-wire-edge][data-target-uid="matrix-2"][data-input="value"]').getAttribute('data-type'),'number');
}));

test('offline HTML displays column bytes in the same orientation and updates a connected column-value consumer when disabled',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'toggle',state:{value:true},componentName:'Enable matrix'},
    {key:'ledMatrix',state:{mode:'columns'},inputValues:columnValues,bindings:{enable:{uid:'matrix-0',port:'value'}}},
    {key:'valueLabel',componentName:'Column zero',bindings:{value:{uid:'matrix-1',port:'c0'}}}]);
  const handle=await run(`(async()=>{const it=items[0];return (await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it)])).find(handle=>handle.id==='toggle');})()`);
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-matrix-columns-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'document.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  const expectDisplay=async(count,value)=>reader.waitForFunction(({count,value})=>{
    const matrix=document.querySelector('[data-smart-index="1"]'),label=document.querySelector('[data-smart-index="2"]');
    return matrix?.dataset.smartReady==='true' && matrix.querySelectorAll('ellipse[fill="#ef4444"]').length===count &&
      label?.dataset.smartReady==='true' && [...label.querySelectorAll('text')].some(el=>el.textContent===String(value));
  },{count,value});
  await expectDisplay(4,129);
  const coordinates=await reader.locator('[data-smart-index="1"] ellipse').evaluateAll(nodes=>{
    const dots=nodes.map(node=>({x:Number(node.getAttribute('cx')),y:Number(node.getAttribute('cy')),on:node.getAttribute('fill')==='#ef4444'}));
    const xs=[...new Set(dots.map(dot=>dot.x))].sort((a,b)=>a-b),ys=[...new Set(dots.map(dot=>dot.y))].sort((a,b)=>a-b);
    return dots.filter(dot=>dot.on).map(dot=>[ys.indexOf(dot.y),xs.indexOf(dot.x)]).sort();
  });
  assert.deepEqual(coordinates,[[0,0],[1,2],[7,0],[7,7]],'bit 7 is at the top and c0 is the left column');
  const toggle=async()=>{
    const p=await reader.locator('[data-smart-index="0"]').evaluate((host,handle)=>{
      const p=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};
    },handle);
    await reader.mouse.click(p.x,p.y);
  };
  await toggle();await expectDisplay(0,0);await toggle();await expectDisplay(4,129);
  await reader.reload();await expectDisplay(4,129);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'export remains self-contained');
}));
