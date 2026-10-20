const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

// Test-only read access observes the real graph. The workflow itself uses library
// placement, Edit, pointer wiring, inline cells, history and the File menu.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{await browser?.close();});
async function canvasPoint(page,item,x=16,y=16){
  const box=await page.locator('#canvas').boundingBox();return {x:box.x+item.x+x,y:box.y+item.y+y};
}
async function place(page,run,name,x,y){
  if(await page.locator('#shapePicker').isHidden())await page.locator('#shapeLibBtn').click();
  if(await page.locator('#libraryBrowser').isHidden())await page.locator('#browseShapesBtn').click();
  await page.locator('#librarySearch').fill(name);
  await page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place '+name,exact:true}).click();
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+x,box.y+y);
  await run('shapePlacementQueue');return run('clone(items.at(-1))');
}
async function edit(page,item,fn){
  const p=await canvasPoint(page,item);await page.mouse.click(p.x,p.y);await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open && !document.querySelector('#componentBindingFields').disabled);
  await fn();await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
}
const port=(page,item,name,direction)=>page.locator(`#componentWiringOverlay [data-wire-port][data-uid="${item.uid}"][data-port="${name}"][data-direction="${direction}"]`);
async function portPoint(locator){
  for(let attempt=0;attempt<10;attempt++){
    await locator.waitFor({state:'visible'});
    const p=await locator.evaluate(el=>{if(!el.isConnected)return null;const circle=el.matches('circle')?el:el.querySelector('circle')||el,r=circle.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;});
    if(p)return p;
  }
  assert.fail('wiring port has no visible hit target');
}
async function drag(page,from,to){const a=await portPoint(from),b=await portPoint(to);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:10});await page.mouse.up();}
async function connect(page,source,target,{reverse=false}={}){
  const out=port(page,source,'data','out'),input=port(page,target,'data','in');await drag(page,reverse?input:out,reverse?out:input);
  await page.waitForFunction(({source,target})=>__test.run(`items.find(it=>it.uid===${JSON.stringify(target)}).bindings?.data?.uid`)===source,{source:source.uid,target:target.uid});
}
async function records(run,item){return run(`(async()=>{const item=items.find(it=>it.uid===${JSON.stringify(item.uid)}),record=(await ensureEditorComponentGraph()).get(item);if(record.error)throw Error(record.error);return record.io.tables.inputs.data.rows;})()`);}
async function handles(run,item){return run(`(async()=>{const item=items.find(it=>it.uid===${JSON.stringify(item.uid)}),io=await resolveSmartComponentIo(item);return requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]);})()`);}
async function clickHandle(page,run,item,id){
  const h=(await handles(run,item)).find(h=>h.id===id);assert.ok(h,'handle '+id);
  const p=await canvasPoint(page,item,h.x,h.y);await page.mouse.dblclick(p.x,p.y);await page.mouse.click(p.x,p.y);await run('smartHitSettled');return h;
}
async function menuDownload(page,action){
  const download=page.waitForEvent('download');await page.locator('#menuBtn').click();await page.locator(`#menu [data-act="${action}"]`).click();return await download;
}
async function readerText(page,index,text){
  await page.waitForFunction(({index,text})=>{const host=document.querySelector(`[data-smart-index="${index}"]`);return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(el=>el.textContent===text);},{index,text});
}
async function readerHandle(page,index,h){
  const point=await page.locator(`[data-smart-index="${index}"]`).evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},h);
  await page.mouse.click(point.x,point.y);
}

test('Phase 3 closeout: author a shared data workflow from an empty canvas and use its downloaded offline reader',async()=>{
  const context=await browser.newContext({viewport:{width:1800,height:1450}}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-phase3-'));
  try{
    const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://phase3-closeout.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://phase3-closeout.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);await run('appStarted');
    assert.equal(await run('items.length'),0,'starts with a genuinely empty drawing');
    const dataset=await place(page,run,'Dataset',250,180);
    await edit(page,dataset,async()=>{
      await page.locator('#componentNameInput').fill('Fleet');
      await page.locator('#datasetFileInput-data').setInputFiles({name:'fleet.csv',mimeType:'text/csv',buffer:Buffer.from('Boat;Region;Points\nTern;North;12\nSkua;South;99\nGull;North;8\n')});
      await page.waitForFunction(()=>document.querySelector('#componentOutputs').textContent.includes('rowCount = 3'));
      assert.match(await page.locator('#datasetCsvStatus-data').textContent(),/semicolon/i);
    });
    const filter=await place(page,run,'Table filter',650,180),sort=await place(page,run,'Table sort',1050,180);
    const editor=await place(page,run,'Dataset editor',450,580),view=await place(page,run,'Dataset editor',1280,580);
    const chart=await place(page,run,'Data bar chart',450,1050),download=await place(page,run,'Download table',1120,1050);
    await page.locator('#componentWiringBtn').click();await port(page,dataset,'data','out').waitFor();
    await connect(page,dataset,filter);await connect(page,filter,sort,{reverse:true});await connect(page,dataset,editor);
    await connect(page,sort,view);await connect(page,sort,chart,{reverse:true});await connect(page,sort,download);
    const before=await run('JSON.stringify(items.map(it=>it.bindings))');
    await drag(page,port(page,dataset,'rowCount','out'),port(page,sort,'data','in'));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await run('JSON.stringify(items.map(it=>it.bindings))'),before,'number output cannot replace a table input');
    const links=await page.locator('#componentWiringOverlay [data-wire-edge]').evaluateAll(elements=>elements.map(el=>({kind:el.dataset.kind,type:el.dataset.type})));
    assert.ok(links.some(link=>link.kind==='dataset'),'the owned Dataset link is visually distinct');
    assert.ok(links.some(link=>link.kind==='flow'&&link.type==='table'),'table transformations retain directed flow links');
    await page.locator('#componentWiringBtn').click();
    await edit(page,filter,async()=>{
      await page.getByLabel('column value',{exact:true}).selectOption('Region');
      await page.getByLabel('operation value',{exact:true}).selectOption('=');
      await page.getByLabel('text value',{exact:true}).fill('North');
    });
    await edit(page,sort,async()=>{await page.getByLabel('column value',{exact:true}).selectOption('Points');});
    await edit(page,editor,async()=>{
      await page.locator('#componentNameInput').fill('Edit source records');
      await page.getByLabel('Edit dataset records',{exact:true}).selectOption('true');
      await page.getByLabel('Allow reader edits',{exact:true}).selectOption('true');
    });
    assert.deepEqual(await records(run,view),[['Gull','North',8],['Tern','North',12]]);
    assert.deepEqual(await records(run,chart),[['Gull','North',8],['Tern','North',12]]);
    const cell=await clickHandle(page,run,editor,'cell-0-2');
    const field=page.locator('#smartTextValue');await field.waitFor();await field.fill('4');await field.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');
    assert.deepEqual(await records(run,view),[['Tern','North',4],['Gull','North',8]],'a shared cell edit immediately changes filtering and sort order');
    assert.deepEqual(await records(run,chart),[['Tern','North',4],['Gull','North',8]]);
    await page.locator('#undo').click();assert.deepEqual(await records(run,view),[['Gull','North',8],['Tern','North',12]]);
    await page.locator('#redo').click();assert.deepEqual(await records(run,view),[['Tern','North',4],['Gull','North',8]]);
    const workspaceDownload=await menuDownload(page,'saveWorkspace'),saved=JSON.parse(fs.readFileSync(await workspaceDownload.path(),'utf8'));
    assert.equal(Object.keys(saved.tabs[0].datasets).length,1,'shared rows are stored once');
    assert.equal(saved.tabs[0].items.length,7);assert.equal(JSON.stringify(saved.tabs[0].datasets).includes('"Tern","North",4'),true);
    await page.reload();await run('appStarted');assert.deepEqual(await records(run,view),[['Tern','North',4],['Gull','North',8]],'browser reload preserves authored connections and shared edits');
    await page.waitForFunction(()=>__test.run('items.every(it=>smartChildrenCache.get(it.uid)?.kids?.length>0)'));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(process.env.PHASE3_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PHASE3_SCREENSHOTS,'sc-phase3-authoring-editor.png'),fullPage:true});
    const htmlDownload=await menuDownload(page,'html'),file=path.join(directory,'workflow.html');fs.copyFileSync(await htmlDownload.path(),file);
    const reader=await context.newPage();reader.on('pageerror',error=>errors.push(error.message));reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
    await reader.goto(pathToFileURL(file).href);await readerText(reader,4,'Tern');await readerText(reader,5,'4');
    await readerHandle(reader,3,cell);const readerField=reader.locator('#smartTextValue');await readerField.waitFor();await readerField.fill('2.5');await readerField.press('Enter');await readerField.waitFor({state:'detached'});
    await readerText(reader,4,'2.5');await readerText(reader,5,'2.5');
    if(process.env.PHASE3_SCREENSHOTS)await reader.screenshot({path:path.join(process.env.PHASE3_SCREENSHOTS,'sc-phase3-authoring-reader.png'),fullPage:true});
    const jsonHandle=(await handles(run,download)).find(h=>h.id==='json');await readerHandle(reader,6,jsonHandle);
    const dialog=reader.locator('dialog[data-component-data-action]');await dialog.waitFor();
    const resultDownload=reader.waitForEvent('download');await dialog.locator('[data-data-action-submit]').click();
    const result=JSON.parse(fs.readFileSync(await(await resultDownload).path(),'utf8'));
    assert.deepEqual(result,[{Boat:'Tern',Region:'North',Points:2.5},{Boat:'Gull',Region:'North',Points:8}]);
    assert.deepEqual(await records(run,view),[['Tern','North',4],['Gull','North',8]],'reader edits remain local to the exported session');
    await reader.reload();await readerText(reader,4,'4');await readerText(reader,5,'4');
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'the authored dashboard works without network access');
  }finally{await context.close();fs.rmSync(directory,{recursive:true,force:true});}
});
