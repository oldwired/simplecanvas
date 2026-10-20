const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const scripts=Object.fromEntries(['dropdown','text-lookup','number-control'].map(name=>[name,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8')]));
const definitions=Object.fromEntries(Object.entries(scripts).map(([name,script])=>[name,vm.runInNewContext(script)]));
const initial=Object.fromEntries(Object.entries(definitions).map(([name,definition])=>[name,definition.initState()]));
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:960}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://choices.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://choices.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function setup(run){
  await run(`window.choiceScripts=${JSON.stringify(scripts)};window.choiceInitial=${JSON.stringify(initial)};cancelGesture();datasets={};
    items=['dropdown','dropdown','text-lookup','number-control'].map((key,index)=>({type:'smart',uid:'choice-'+index,componentApi:2,script:window.choiceScripts[key],componentName:['Manual choice','Independent choice','Reverse lookup','Position'][index],x:[40,380,720,40][index],y:index===3?320:90,w:280,h:index===2?116:index===3?120:78,color:'#94a3b8',textColor:'#334155',fill:true,fillColor:'#ffffff',strokeOn:true,size:1.5,state:clone(window.choiceInitial[key]),...(index===2?{bindings:{text:{uid:'choice-0',port:'text'}}}:{})}));selection=[];setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
const output=(run,index)=>run(`(async()=>{const graph=await ensureEditorComponentGraph();return graph.get(items[${index}]).io.outputs;})()`);
async function openEditor(page,run,index=0){
  const at=await run(`(async()=>{selection=[${index}];editingSmartIdx=${index};render();const it=items[${index}],hs=await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it)]),h=hs.find(h=>h.kind==='choice');return h?{x:it.x+h.x,y:it.y+h.y}:null;})()`);
  assert.ok(at,'choice handle exists');const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+at.x,box.y+at.y);await run('smartHitSettled');await page.locator('select[data-smart-inline-input="choice"]').waitFor();
}
async function choose(page,run,value){await page.locator('select[data-smart-inline-input="choice"]').selectOption(String(value));await run('smartHitSettled');await page.locator('select[data-smart-inline-input="choice"]').waitFor({state:'detached'});}

test('manual dropdown edits its input, propagates reverse lookup, supports undo and independent copies',async()=>app(async({page,run})=>{
  await setup(run);await openEditor(page,run);await choose(page,run,1);
  assert.deepEqual(await output(run,0),{index:1,key:'running',text:'Running',valid:true});assert.equal((await output(run,2)).index,1);assert.equal((await output(run,1)).index,0);
  assert.equal(await run('items[0].inputValues.select'),1);await run('undo()');assert.equal((await output(run,0)).index,0);await run('redo()');assert.equal((await output(run,0)).index,1);
  await run('selection=[0];duplicateSelection();');await output(run,4);await openEditor(page,run,4);await choose(page,run,2);
  assert.equal((await output(run,4)).index,2);assert.equal((await output(run,0)).index,1);
  const saved=await run('makeDocument(items,assets,{},datasets)');assert.equal(saved.items[4].inputValues.select,2);
  await openEditor(page,run,4);await choose(page,run,0);
  const first=await run('makeDocument(items,assets,{},datasets)');assert.equal(first.items[4].inputValues.select,0);assert.equal((await output(run,4)).key,'idle');
}));

test('automatic selection preserves index zero and rejects out-of-range or fractional signals through reverse lookup',async()=>app(async({run})=>{
  await setup(run);await run("items[0].bindings={select:{uid:'choice-3',port:'value'}};items[3].inputValues={min:-10,max:10,step:.5};editorComponentEvaluation=null;");
  for(const [value,text,key,index] of [[0,'Idle','idle',0],[2,'Stopped','stopped',2],[-1,'','',-1],[3,'','',-1],[1.5,'','',-1],[0,'Idle','idle',0]]){
    await run('items[3].state.value='+value+';editorComponentEvaluation=null;');
    assert.deepEqual(await output(run,0),{index,key,text,valid:index>=0});
    assert.deepEqual(await output(run,2),{index,key,found:index>=0});
  }
}));

test('native choices cancel on Escape, reject stale lists and bindings, and never override automatic selection',async()=>app(async({page,run})=>{
  await setup(run);await openEditor(page,run);await page.keyboard.press('Escape');assert.equal(await page.locator('select[data-smart-inline-input="choice"]').count(),0);assert.equal((await output(run,0)).index,0);
  await openEditor(page,run);await run(`items[0].state.choices='[{"text":"Idle","key":"new-idle"},{"text":"Running","key":"new-running"}]';editorComponentEvaluation=null;`);await choose(page,run,1);assert.equal((await output(run,0)).index,0,'a key-only list edit invalidates an open selection');
  await openEditor(page,run);await run("items[0].bindings={select:{uid:'choice-3',port:'value'}};items[3].state.value=1;editorComponentEvaluation=null;");await choose(page,run,1);assert.equal(await run('Object.hasOwn(items[0].inputValues||{},"select")'),false);
  assert.deepEqual(await run("requestSmartCall(items[0],'handles',[items[0].state,items[0].w,items[0].h,smartResolvedStyle(items[0])])"),[]);
  await run('items[0].bindings={};editorComponentEvaluation=null;');await openEditor(page,run);await run('undo()');await page.locator('select[data-smart-inline-input="choice"]').waitFor({state:'detached'});
}));

test('keyboard navigation waits for Enter, Escape cancels, and the expanded list stays on screen',async()=>app(async({page,run})=>{
  await setup(run);await openEditor(page,run);await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('select[data-smart-inline-input="choice"]').inputValue(),'2');assert.equal((await output(run,0)).index,0);
  await page.keyboard.press('Enter');await run('smartHitSettled');assert.equal((await output(run,0)).index,2);
  await openEditor(page,run);await page.keyboard.press('Home');await page.keyboard.press('Escape');assert.equal((await output(run,0)).index,2);
  const canvasBounds=await page.locator('#canvas').boundingBox();await run('items[0].y='+Math.floor(Math.min(canvasBounds.height,960-canvasBounds.y)-96)+';render();');await openEditor(page,run);const bounds=await page.locator('select[data-smart-inline-input="choice"]').boundingBox();
  assert.ok(bounds.y>=8 && bounds.y+bounds.height<=952,'the list shifts above the field when necessary');await page.keyboard.press('Escape');
}));

test('dataset dropdown lists all rows and full labels, rejects changed data and observes selected row order',async()=>app(async({page,run})=>{
  await setup(run);const long='Full untruncated label '.repeat(12);
  await run(`datasets={choices:{name:'Choice data',columns:[{key:'label',name:'Label',type:'string'},{key:'key',name:'Key',type:'string'}],rows:Array.from({length:40},(_,i)=>[i===39?${JSON.stringify(long)}:'Row '+(i+1),'id-'+(i+1)])}};items[0].state.source='dataset';items[0].inputValues={data:{datasetId:'choices'},textColumn:'label',keyColumn:'key'};editorComponentEvaluation=null;render();`);
  await output(run,0);await openEditor(page,run);assert.equal(await page.locator('select[data-smart-inline-input="choice"] option').count(),40);assert.equal(await page.locator('select[data-smart-inline-input="choice"] option[value="39"]').textContent(),long);await choose(page,run,39);assert.equal((await output(run,0)).text,long);
  await openEditor(page,run);await run("datasets.choices.rows[0][1]='changed-key';editorComponentEvaluation=null;");await choose(page,run,0);assert.equal((await output(run,0)).index,39);
  await run("items[0].inputValues={data:{datasetId:'choices',rows:[39,2]},select:0,textColumn:'label',keyColumn:'key'};editorComponentEvaluation=null;render();");await openEditor(page,run);assert.equal(await page.locator('select[data-smart-inline-input="choice"] option').count(),2);await choose(page,run,1);assert.equal((await output(run,0)).text,'Row 3');
}));

async function readerClick(page,index){
  const point=await page.locator('[data-smart-index="'+index+'"]').evaluate(host=>{const p=new DOMPoint(140,52).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};});await page.mouse.click(point.x,point.y);
}
async function readerText(page,index,text){await page.waitForFunction(({index,text})=>[...document.querySelector('[data-smart-index="'+index+'"]').querySelectorAll('text')].some(node=>node.textContent===text),{index,text});}

test('exported dropdown accepts manual choices offline, keeps connected controls read-only, and resets on reload',async()=>app(async({page,run,context})=>{
  await setup(run);await run("items[1].bindings={select:{uid:'choice-0',port:'index'}};editorComponentEvaluation=null;");await output(run,1);
  const download=page.waitForEvent('download');await run('exportHtml()');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-choice-'));context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'choices.html');fs.copyFileSync(await(await download).path(),file);const reader=await context.newPage(),errors=[];reader.on('pageerror',e=>errors.push(e.message));await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===4);await readerClick(reader,0);await reader.locator('select[data-smart-inline-input="choice"]').selectOption('2');await readerText(reader,0,'Stopped');await readerText(reader,1,'Stopped');
  await readerClick(reader,1);assert.equal(await reader.locator('select[data-smart-inline-input="choice"]').count(),0);await reader.reload();await readerText(reader,0,'Idle');assert.deepEqual(errors,[]);
}));
