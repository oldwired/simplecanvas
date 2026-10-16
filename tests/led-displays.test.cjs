const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

// Expose only the served copy's closure. Component calls still cross the real
// Worker boundary; downloaded HTML runs its own unmodified runtime.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://led-displays.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://led-displays.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}

async function editorHandle(page,run,index,id){
  const {item,handle}=await run(`(async()=>{
    selection=[${index}];editingSmartIdx=${index};render();
    const item=items[${index}],io=await resolveSmartComponentIo(item);
    const handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]);
    return {item,handle:handles.find(handle=>handle.id===${JSON.stringify(id)})};
  })()`);
  assert.ok(handle,id+' handle exists');
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+handle.x,box.y+item.y+handle.y);await run('smartHitSettled');
  return handle;
}
async function openExport(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-displays-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'document.html');fs.copyFileSync(await(await download).path(),file);
  const preview=await context.newPage(),errors=[],requests=[];
  preview.on('pageerror',error=>errors.push(error.message));
  preview.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await preview.goto(pathToFileURL(file).href);
  return {preview,errors,requests};
}
async function readerClick(page,index,point){
  const host=page.locator('[data-smart-index="'+index+'"]');
  await page.waitForFunction(host=>host.dataset.smartReady==='true',await host.elementHandle());
  const position=await host.evaluate((host,p)=>{
    const at=new DOMPoint(p.x,p.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:at.x,y:at.y};
  },point);
  await page.mouse.click(position.x,position.y);
}

async function openInputs(page,run,index){
  await run(`selection=[${index}];render()`);
  await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsSave').disabled);
}
async function saveInputs(page){
  await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
}
async function output(run,index){return (await run(`resolveSmartComponentIo(items[${index}])`)).outputs;}
async function readerLit(page,index,count){
  await page.waitForFunction(({index,count})=>{
    const host=document.querySelector('[data-smart-index="'+index+'"]');
    return host?.dataset.smartReady==='true' && host.querySelectorAll('[fill="#ef4444"]').length===count;
  },{index,count});
}

test('seven-segment modes wire through Inputs, preserve names, and respond in offline HTML',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['constant','toggle','toggle','sevenSegmentDisplay'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid:'digit-'+index,
    x:60+(index%2)*500,y:90+Math.floor(index/2)*310,componentName:['Digit source','Decimal point','Display enable','My digit'][index]
  }));items[0].state.value=5;items[2].state.value=true;setTool('select');selection=[];render();save();`);
  await openInputs(page,run,3);
  await page.getByLabel('value (number)',{exact:true}).selectOption(JSON.stringify({uid:'digit-0',port:'value'}));
  await page.getByLabel('decimalPoint (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'digit-1',port:'value'}));
  await page.getByLabel('enable (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'digit-2',port:'value'}));
  await saveInputs(page);
  const five={a:true,b:false,c:true,d:true,e:false,f:true,g:true,decimalPoint:false};
  assert.deepEqual(await output(run,3),five);
  const pointHandle=await editorHandle(page,run,1,'toggle');
  assert.deepEqual(await output(run,3),{...five,decimalPoint:true});
  const enableHandle=await editorHandle(page,run,2,'toggle');
  assert.ok(Object.values(await output(run,3)).every(value=>value===false));
  await editorHandle(page,run,2,'toggle');await editorHandle(page,run,1,'toggle');
  const {preview,errors,requests}=await openExport(page,run,context);
  await readerLit(preview,3,5);assert.match(await preview.locator('[data-smart-index="3"]').textContent(),/My digit/);
  await readerClick(preview,1,pointHandle);await readerLit(preview,3,6);
  await readerClick(preview,2,enableHandle);await readerLit(preview,3,0);
  await readerClick(preview,2,enableHandle);await readerLit(preview,3,6);
  await preview.reload();await readerLit(preview,3,5);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);

  await openInputs(page,run,3);
  await page.getByLabel('Input mode',{exact:true}).selectOption('segments');
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsSave').disabled && document.querySelectorAll('#componentInputFields .component-input').length===9);
  assert.equal(await page.getByLabel('value (number)',{exact:true}).count(),0,'numeric assignment is removed in segment mode');
  await page.getByLabel('a (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'digit-1',port:'value'}));
  await saveInputs(page);
  const saved=await run('clone(items[3])');assert.equal(saved.state.mode,'segments');assert.equal(saved.bindings.value,undefined);
  assert.ok(Object.values(await output(run,3)).every(value=>value===false));
  await editorHandle(page,run,1,'toggle');
  assert.deepEqual(await output(run,3),{a:true,b:false,c:false,d:false,e:false,f:false,g:false,decimalPoint:true});
  await page.reload();await run('appStarted');
  assert.deepEqual(await output(run,3),{a:true,b:false,c:false,d:false,e:false,f:false,g:false,decimalPoint:true});
  const direct=await openExport(page,run,context);await readerLit(direct.preview,3,2);
  await readerClick(direct.preview,1,pointHandle);await readerLit(direct.preview,3,0);
  assert.deepEqual(direct.errors,[]);assert.deepEqual(direct.requests,[]);
}));

test('matrix row inputs render the correct 64 positions and enable works offline',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['constant','toggle','ledMatrix'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid:'matrix-'+index,
    x:80+index*400,y:120,componentName:['Row pattern','Matrix enable','My matrix'][index]
  }));items[0].state.value=129;items[1].state.value=true;setTool('select');selection=[];render();save();`);
  await openInputs(page,run,2);
  await page.getByLabel('Input mode',{exact:true}).selectOption('rows');
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsSave').disabled && document.querySelector('[aria-label="r1 value"]'));
  await page.getByLabel('r1 (number)',{exact:true}).selectOption(JSON.stringify({uid:'matrix-0',port:'value'}));
  await page.getByLabel('r8 value',{exact:true}).fill('1');
  await page.getByLabel('enable (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'matrix-1',port:'value'}));
  await saveInputs(page);
  assert.deepEqual(await output(run,2),{r1:129,r2:0,r3:0,r4:0,r5:0,r6:0,r7:0,r8:1});
  const handle=await editorHandle(page,run,1,'toggle');assert.ok(Object.values(await output(run,2)).every(value=>value===0));
  await editorHandle(page,run,1,'toggle');
  const {preview,errors,requests}=await openExport(page,run,context);await readerLit(preview,2,3);
  const dots=await preview.locator('[data-smart-index="2"] ellipse').evaluateAll(nodes=>nodes.map(node=>({
    x:Number(node.getAttribute('cx')),y:Number(node.getAttribute('cy')),on:node.getAttribute('fill')==='#ef4444'
  })));
  assert.equal(dots.length,64);
  const xs=[...new Set(dots.map(dot=>dot.x))].sort((a,b)=>a-b),ys=[...new Set(dots.map(dot=>dot.y))].sort((a,b)=>a-b);
  assert.equal(xs.length,8);assert.equal(ys.length,8);
  assert.deepEqual(dots.filter(dot=>dot.on).map(dot=>[ys.indexOf(dot.y)+1,xs.indexOf(dot.x)+1]).sort(),[[1,1],[1,8],[8,8]],'MSB is the left LED and r1 is the top row');
  assert.match(await preview.locator('[data-smart-index="2"]').textContent(),/My matrix/);
  await readerClick(preview,1,handle);await readerLit(preview,2,0);
  await readerClick(preview,1,handle);await readerLit(preview,2,3);
  await preview.reload();await readerLit(preview,2,3);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  await page.reload();await run('appStarted');assert.equal((await output(run,2)).r1,129);
}));

test('matrix Boolean mode shows all crossings and switches cleanly to row values',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['toggle','toggle','ledMatrix'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid:'matrix-modes-'+index,
    x:70+index*400,y:100
  }));items[1].state.value=true;setTool('select');selection=[];render();save();`);
  assert.equal(await run('items[2].state.mode'),'boolean');
  await openInputs(page,run,2);
  assert.deepEqual(await page.getByLabel('Input mode',{exact:true}).locator('option').evaluateAll(options=>options.map(option=>option.value)),['boolean','rows']);
  await page.getByLabel('row1 (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'matrix-modes-0',port:'value'}));
  await page.getByLabel('col8 (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'matrix-modes-1',port:'value'}));
  await page.getByLabel('row8 value',{exact:true}).selectOption('true');
  await page.getByLabel('col1 value',{exact:true}).selectOption('true');await saveInputs(page);
  assert.deepEqual(await output(run,2),{r1:0,r2:0,r3:0,r4:0,r5:0,r6:0,r7:0,r8:129});
  const rowHandle=await editorHandle(page,run,0,'toggle');
  assert.deepEqual(await output(run,2),{r1:129,r2:0,r3:0,r4:0,r5:0,r6:0,r7:0,r8:129});
  const colHandle=await run(`(async()=>{
    const it=items[1];return (await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it)])).find(handle=>handle.id==='toggle');
  })()`);
  const scanned=await openExport(page,run,context);await readerLit(scanned.preview,2,4);
  await readerClick(scanned.preview,1,colHandle);await readerLit(scanned.preview,2,2);
  await readerClick(scanned.preview,0,rowHandle);await readerLit(scanned.preview,2,1);
  assert.deepEqual(scanned.errors,[]);assert.deepEqual(scanned.requests,[]);

  await openInputs(page,run,2);await page.getByLabel('Input mode',{exact:true}).selectOption('rows');
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsSave').disabled && document.querySelector('[aria-label="r1 value"]'));
  await page.getByLabel('r1 value',{exact:true}).fill('255');await saveInputs(page);
  assert.deepEqual(await run('Object.keys(items[2].bindings)'),[],'changing modes removes obsolete Boolean assignments');
  assert.deepEqual(await output(run,2),{r1:255,r2:0,r3:0,r4:0,r5:0,r6:0,r7:0,r8:0});
  const rows=await openExport(page,run,context);await readerLit(rows.preview,2,8);
  assert.deepEqual(rows.errors,[]);assert.deepEqual(rows.requests,[]);
}));

test('invalid display inputs stay visibly unavailable and do not affect a healthy display',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    const fixtures=[['sevenSegmentDisplay',{value:10}],['ledMatrix',{r1:256},{mode:'rows'}],['sevenSegmentDisplay',{value:0}]];
    const list=fixtures.map(([key,inputValues,state],i)=>{const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]);return {...item,uid:'invalid-display-'+i,inputValues,state:state||item.state};});
    const graph=await inspectComponentGraph(list,()=>true),records=[];
    // These fixtures are detached from the active scene; render their script with the
    // inspected IO and explicit owner instead of asking the live-scene graph for IO.
    for(const item of list){
      const record=graph.get(item),owner=createSmartExecution(item);
      try{const {result:children}=await requestSmartSandbox({method:'call',src:item.script,fn:record.error?'unavailableChildren':'children',args:[item.state,smartResolvedStyle(item),item.w,item.h,false,{...record.io,error:record.error}]},item,owner);
        records.push({error:record.error||'',outputs:record.io.outputs,text:children.filter(child=>child.type==='text').map(child=>child.text).join(' '),lit:children.filter(child=>child.fillColor==='#ef4444').length});
      }finally{disposeSmartExecution(owner);}
    }return records;
  })()`);
  for(const record of result.slice(0,2)){assert.ok(record.error);assert.deepEqual(record.outputs,{});assert.match(record.text,/unavailable|whole number|integer|0.?9/i);assert.equal(record.lit,0);}
  assert.equal(result[2].error,'');assert.equal(result[2].lit,6);assert.equal(result[2].outputs.g,false);
}));
