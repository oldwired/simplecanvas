const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:960}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://data-switches.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://data-switches.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function setup(run){
  const names=['toggle','table-sort','table-aggregate','data-table'],scripts=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8')]));
  await run(`window.switchScripts=${JSON.stringify(scripts)};cancelGesture();items=[];datasets={results:parseDatasetText('Team,Points\\nB,4\\nA,2\\nB,3\\nA,1','results.csv')};
    items=['toggle','table-sort','table-aggregate','data-table','data-table'].map((key,index)=>({type:'smart',uid:'switch-'+index,componentApi:2,script:window.switchScripts[key],componentName:['Run transforms','Sorted rows','Totals','Sorted preview','Total preview'][index],x:[40,250,650,250,650][index],y:index<3?100:320,w:index===0?160:320,h:index<3?150:230,color:'#94a3b8',textColor:'#334155',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
      state:index===0?{value:false}:index===1?{caseSensitive:false,showSwitch:true}:index===2?{showSwitch:true}:{maxRows:12,showCounts:true},
      ...(index===1?{inputValues:{data:{datasetId:'results'},column:'Points',direction:'ascending',enabled:true}}:{}),
      ...(index===2?{inputValues:{data:{datasetId:'results'},group:'Team',value:'Points',operation:'sum',enabled:true}}:{}),
      ...(index>=3?{bindings:{data:{uid:'switch-'+(index-2),port:'data'}}}:{})}));selection=[];setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
async function clickEditor(page,run,index,id){
  const result=await run(`(async()=>{selection=[${index}];editingSmartIdx=${index};render();const item=items[${index}],handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)]);return {item,handle:handles.find(handle=>handle.id===${JSON.stringify(id)})};})()`);
  assert.ok(result.handle,'interactive '+id+' exists');const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+result.item.x+result.handle.x,box.y+result.item.y+result.handle.y);await run('smartHitSettled');await run('ensureEditorComponentGraph()');
}
const rows=(run,index)=>run(`(async()=>{const graph=await ensureEditorComponentGraph();return graph.get(items[${index}]).io.tables.inputs.data.rows;})()`);
const handles=(run,index)=>run(`requestSmartCall(items[${index}],'handles',[items[${index}].state,items[${index}].w,items[${index}].h,smartResolvedStyle(items[${index}])])`);

test('visible transform switches edit the real Boolean input, preserve undo and copies, and bypass original rows',async()=>app(async({page,run})=>{
  await setup(run);
  assert.deepEqual(await rows(run,3),[['A',1],['A',2],['B',3],['B',4]]);assert.deepEqual(await rows(run,4),[['B',7],['A',3]]);
  await clickEditor(page,run,1,'enabled');assert.equal(await run('items[1].inputValues.enabled'),false);
  assert.deepEqual(await rows(run,3),[['B',4],['A',2],['B',3],['A',1]]);
  await clickEditor(page,run,2,'enabled');assert.equal(await run('items[2].inputValues.enabled'),false);
  assert.deepEqual(await rows(run,4),[['B',4],['A',2],['B',3],['A',1]],'aggregate bypass retains original columns and rows');
  await run('undo();');await run('ensureEditorComponentGraph()');assert.equal(await run('items[2].inputValues.enabled'),true);
  assert.deepEqual(await rows(run,4),[['B',7],['A',3]]);
  await run('redo();');await run('ensureEditorComponentGraph()');assert.equal(await run('items[2].inputValues.enabled'),false);
  await run('selection=[1];duplicateSelection();');await run('ensureEditorComponentGraph()');
  assert.equal(await run('items[5].inputValues.enabled'),false,'copy keeps the bypass setting');
  await clickEditor(page,run,5,'enabled');assert.equal(await run('items[5].inputValues.enabled'),true);
  assert.equal(await run('items[1].inputValues.enabled'),false,'copy switches independently');
  const saved=await run('makeDocument(items,assets,{},datasets)');assert.equal(saved.items[2].inputValues.enabled,false);
}));

async function readerClick(page,index,x,y){
  const host=page.locator('[data-smart-index="'+index+'"]');
  const point=await host.evaluate((host,point)=>{const p=new DOMPoint(point.x,point.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},{x,y});
  await page.mouse.click(point.x,point.y);
}
async function readerText(page,index,text){await page.waitForFunction(({index,text})=>[...document.querySelector('[data-smart-index="'+index+'"]').querySelectorAll('text')].some(node=>node.textContent===text),{index,text});}

test('connected transform inputs own switch state and hidden switches still follow signals in editor and HTML',async()=>app(async({page,run,context})=>{
  await setup(run);
  await run("items[1].bindings={enabled:{uid:'switch-0',port:'value'}};items[2].bindings={enabled:{uid:'switch-0',port:'value'}};items[1].state.showSwitch=false;editorComponentEvaluation=null;render();");
  await run('ensureEditorComponentGraph()');
  assert.deepEqual(await handles(run,1),[]);assert.deepEqual(await handles(run,2),[]);
  assert.deepEqual(await rows(run,4),[['B',4],['A',2],['B',3],['A',1]]);
  await clickEditor(page,run,0,'toggle');assert.deepEqual(await rows(run,4),[['B',7],['A',3]]);
  assert.deepEqual(await rows(run,3),[['A',1],['A',2],['B',3],['B',4]]);
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-switch-'));context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'switches.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[];reader.on('pageerror',error=>errors.push(error.message));await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===5);
  await readerText(reader,2,'On · connected');await readerText(reader,4,'2 rows');
  await readerClick(reader,2,286,129);await readerText(reader,4,'2 rows');
  await readerClick(reader,0,80,103.5);await readerText(reader,2,'Bypass · connected');await readerText(reader,4,'4 rows');
  assert.equal((await reader.locator('[data-smart-index="1"]').textContent()).includes('connected'),false,'hidden switch adds no indicator text');
  assert.deepEqual(errors,[]);
}));

test('offline manual transform switches toggle literal inputs and reload restores the exported values',async()=>app(async({page,run,context})=>{
  await setup(run);const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-manual-switch-'));context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'switches.html');fs.copyFileSync(await(await download).path(),file);const reader=await context.newPage();await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===5);
  await readerText(reader,4,'2 rows');await readerClick(reader,2,286,129);await readerText(reader,4,'4 rows');
  await readerText(reader,2,'Bypass');await readerClick(reader,1,286,129);await readerText(reader,1,'Bypass');
  await reader.reload();await readerText(reader,4,'2 rows');await readerText(reader,1,'On');await readerText(reader,2,'On');
}));
