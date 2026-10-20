const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'examples','spreadsheet.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://spreadsheet-worker.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://spreadsheet-worker.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
function sheetItem(cells,cols=6,rows=6){return {type:'smart',uid:'sheet',componentApi:2,componentName:'Sheet',script,state:{cols,rows,cells},
  x:60,y:140,w:600,h:240,color:'#94a3b8',textColor:'#1f2937',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,fontFamily:'sans',fontSize:14,bindings:{},inputValues:{}};}
const record=(run,index)=>run(`(async()=>{const graph=await ensureEditorComponentGraph(),r=graph.get(items[${index}]);return {error:r.error,outputs:r.io?.outputs};})()`);

test('configuration proposals cross the Worker boundary only as validated state and plain confirmation text',async()=>app(async({run})=>{
  const item=sheetItem({A1:'Old content',D2:'=OUTPUT(3,"old")'});
  item.script=`({apiVersion:2,inputs:{},outputs:{},compute(){return {};},children(){return [];},
    configure(next,previous){return {state:{...next,cells:{}},confirm:'Discard existing content?'};}})`;
  const result=await run(`(async()=>{
    const it=${JSON.stringify(item)},owner=createSmartExecution(it);
    try{
      const caps=await requestSmartCaps(it,owner);
      const next={...it.state,rows:8};
      const reply=await requestSmartSandbox({method:'call',src:it.script,fn:'configure',args:[next,it.state]},it,owner);
      return {configure:caps.configure,result:reply.result,original:it.state};
    }finally{disposeSmartExecution(owner);}
  })()`);
  assert.equal(result.configure,true);assert.deepEqual(result.result.state.cells,{});
  assert.equal(result.result.confirm,'Discard existing content?');assert.equal(result.result.state.rows,8);
  assert.deepEqual(result.original,item.state,'the sandbox does not mutate the saved state');
  for(const bad of [{state:null},{state:[]},{state:{},confirm:''},{state:{},confirm:true},
    {state:{},confirm:'x'.repeat(501)},{state:{},effects:[]},{state:{text:'x'.repeat(4001)}}]){
    const error=await run(`(()=>{try{validateSmartReply({ok:true,apiVersion:2,result:${JSON.stringify(bad)}},
      {method:'call',fn:'configure',componentApi:2});return '';}catch(e){return e.message;}})()`);
    assert.ok(error,'invalid proposal rejected: '+JSON.stringify(bad).slice(0,100));
  }
  assert.equal(await run(`validateSmartReply({ok:true,apiVersion:2,result:null},{method:'call',fn:'configure',componentApi:2}).result`),null);
  assert.equal(await run(`(()=>{try{validateSmartReply({ok:true,apiVersion:1,result:{state:{}}},{method:'call',fn:'configure',componentApi:1});return false;}catch{return true;}})()`),true);
}));

// The timeout is not overridden: successful requests exercise the same real Worker deadline as
// ordinary components, including parsing and static typing during the capability request.
test('a bad linked range reports its declaration error before stale assignments and repairs without losing the connection',async()=>app(async({page,run})=>{
  const item=sheetItem({C1:'=INPUT("data",A1:B10)',C2:'=OUTPUT(SUM(A2:B3),"total")'},3,3);
  item.inputValues={data:{datasetId:'source'}};
  await run(`cancelGesture();datasets=normalizeDatasets({source:{name:'Source',columns:[{key:'a',name:'A',type:'number'},{key:'b',name:'B',type:'number'}],rows:[[1,10],[2,20]]}});items=[${JSON.stringify(item)}];setTool('select');selection=[0];editingSmartIdx=0;render();`);
  const failed=await record(run,0);assert.match(failed.error,/Table INPUT in C1.*inside the grid/);assert.deepEqual(failed.outputs,{});
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+60+500,box.y+140+40);
  const field=page.locator('#smartTextValue');await field.waitFor();assert.equal(await field.evaluate(el=>el.readOnly),false);
  await field.fill('=INPUT("data",A1:B3)');await field.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');
  assert.deepEqual((await record(run,0)).outputs,{total:33});assert.deepEqual(await run('items[0].inputValues'),item.inputValues);
}));

test('a 35-row lookup chain declares and computes within the real 250ms Worker deadline',async()=>app(async({run})=>{
  const cells={A1:'key',B1:'value'};
  for(let r=2;r<=35;r++){cells['A'+r]='key';cells['B'+r]='=VLOOKUP("key",A1:B'+(r-1)+',2,FALSE)';}
  cells.C35='=OUTPUT(B35,"result")';const item=sheetItem(cells,3,35);
  const result=await run(`(async()=>{
    const item=${JSON.stringify(item)},owner=createSmartExecution(item);
    try{
      const caps=await requestSmartSandbox({method:'caps',src:item.script,args:[item.state]},item,owner);
      const computed=await requestSmartSandbox({method:'call',src:item.script,fn:'compute',args:[{},item.state]},item,owner);
      return {limit:SMART_CALL_TIMEOUT_MS,maxScript:MAX_SCRIPT,caps:caps.caps,outputs:computed.result};
    }finally{disposeSmartExecution(owner);}
  })()`);
  assert.equal(result.limit,250);assert.ok(script.length<=result.maxScript);
  assert.deepEqual(result.caps.outputs,{result:{type:'string'}});assert.deepEqual(result.outputs,{result:'value'});
}));

test('a mixed-type output declaration remains repairable through an editor-only inline cell',async()=>app(async({page,run})=>{
  const item=sheetItem({A1:'=INPUT("enabled","boolean")',B1:'=OUTPUT(IF(A1,"yes",0),"result")'},3,3);
  item.inputValues.enabled=true;
  await run(`cancelGesture();items=[${JSON.stringify(item)}];selection=[];setTool('select');render();`);
  const failed=await record(run,0);assert.ok(failed.error,'ambiguous declaration makes the component unavailable');
  assert.equal(await run('requestSmartCaps(items[0])'),null);
  assert.ok(await run(`[...smartScriptErrors.keys()].some(message=>message.includes('result type is ambiguous'))`),'typing failure explains the ambiguity');
  const point=await run(`(async()=>{
    selection=[0];editingSmartIdx=0;render();const it=items[0];
    const hs=await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it)]),h=hs?.find(h=>h.id==='B1');
    return h?{x:it.x+h.x,y:it.y+h.y,editorOnly:h.editorOnly,mode:h.inline?.mode}:null;
  })()`);
  assert.ok(point,'invalid caps preserve repair handles');assert.equal(point.editorOnly,true);assert.equal(point.mode,'edit');
  const bounds=await page.locator('#canvas').boundingBox();await page.mouse.click(bounds.x+point.x,bounds.y+point.y);await run('smartHitSettled');
  const field=page.locator('[data-smart-inline-input="text"] #smartTextValue');await field.waitFor();
  await field.fill('=OUTPUT(IF(A1,"yes","no"),"result")');await field.press('Enter');
  await field.waitFor({state:'detached'});await run('smartHitSettled');
  assert.equal(await run('items[0].state.cells.B1'),'=OUTPUT(IF(A1,"yes","no"),"result")');
  const repaired=await record(run,0);assert.ok(!repaired.error);assert.deepEqual(repaired.outputs,{result:'yes'});
  assert.deepEqual((await run('requestSmartCaps(items[0])')).outputs,{result:{type:'string'}});
}));

async function readerText(page,index,text){await page.waitForFunction(({index,text})=>{
  const host=document.querySelector('[data-smart-index="'+index+'"]');
  return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(node=>node.textContent===text);
},{index,text});}

test('independent OUTPUT arguments drive connected consumers in the editor and offline HTML',async()=>app(async({page,run,context})=>{
  const item=sheetItem({A1:'=INPUT("n")',B1:'=OUTPUT(A1+1,"first")+OUTPUT(A1+2,"second")',
    B2:'=OUTPUT(IF(A1>0,"positive","zero"),"sign")&"!"'},3,3);
  item.y=320;item.bindings.n={uid:'number',port:'value'};
  await run(`cancelGesture();
    const built=(key,uid,x,y,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid,x,y,bindings:{},inputValues:{},...extra});
    items=[built('numberControl','number',60,100,{state:{value:5}}),${JSON.stringify(item)},
      built('valueLabel','first',750,100,{componentName:'First',bindings:{value:{uid:'sheet',port:'first'}}}),
      built('valueLabel','second',1000,100,{componentName:'Second',bindings:{value:{uid:'sheet',port:'second'}}}),
      built('textLabel','sign',750,300,{bindings:{value:{uid:'sheet',port:'sign'}}})];
    selection=[];editingSmartIdx=null;setTool('select');render();save();`);
  assert.deepEqual((await record(run,1)).outputs,{first:6,second:7,sign:'positive'});
  assert.deepEqual((await record(run,2)).outputs,{value:6});assert.deepEqual((await record(run,3)).outputs,{value:7});assert.deepEqual((await record(run,4)).outputs,{value:'positive'});
  await run('items[0].state={...items[0].state,value:6};editorComponentEvaluation=null;');
  assert.deepEqual((await record(run,2)).outputs,{value:7});assert.deepEqual((await record(run,3)).outputs,{value:8});
  const plus=await run(`(async()=>{const it=items[0],hs=await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it)]);return hs.find(h=>h.id==='plus');})()`);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-spreadsheet-worker-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const download=page.waitForEvent('download');await run('exportHtml()');
  const file=path.join(directory,'sheet.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];reader.on('pageerror',error=>errors.push(error.message));
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  await readerText(reader,2,'7');await readerText(reader,3,'8');await readerText(reader,4,'positive');
  const point=await reader.locator('[data-smart-index="0"]').evaluate((host,handle)=>{
    const p=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};
  },plus);
  await reader.mouse.click(point.x,point.y);await readerText(reader,2,'8');await readerText(reader,3,'9');await readerText(reader,4,'positive');
  assert.deepEqual(errors,[],'no uncaught reader errors');assert.deepEqual(requests,[],'reader needs no network requests');
}));

for(const grouped of [false,true])test('spreadsheet column insertion preserves the rotated '+(grouped?'group member and siblings':'sheet origin')+' through undo and redo',async()=>app(async({page,run})=>{
  const item={...sheetItem({A1:'3',B1:'=OUTPUT(A1,"value")'},3,3),x:400,y:300,w:300,h:180,rotation:Math.PI/6,
    ...(grouped?{group:'rotated-sheet',groupRotation:Math.PI/5}:{})};
  const sibling={type:'rect',uid:'sibling',x:800,y:300,w:100,h:100,rotation:-.2,group:'rotated-sheet',groupRotation:Math.PI/5,color:'#475569',size:2};
  await run(`cancelGesture();items=${JSON.stringify(grouped?[item,sibling]:[item])};setTool('select');selection=[0];editingGroupId=${grouped?JSON.stringify('rotated-sheet'):'null'};editingSmartIdx=0;render();`);
  await record(run,0);
  const geometry=()=>run(`items.map(it=>({w:it.w,h:it.h,origin:toWorld(it,it.x,it.y),far:toWorld(it,it.x+it.w,it.y+it.h)}))`);
  const before=await geometry(),savedBefore=await run('clone(items)'),point=await run('toWorld(items[0],items[0].x+50,items[0].y+30)'),bounds=await page.locator('#canvas').boundingBox();
  await page.mouse.click(bounds.x+point.x,bounds.y+point.y,{button:'right'});
  const menu=page.locator('[data-smart-context-menu]');await menu.waitFor();
  await menu.getByRole('menuitem',{name:'Insert 1 column right',exact:true}).click();
  await page.waitForFunction(()=>__test.run('items[0].state.cols')===4);await run('smartHitSettled');
  // Group baking uses the editor's 0.01-coordinate normalization at each transform.
  const tolerance=grouped?.03:1e-6;
  const near=(actual,expected,message)=>{for(const key of ['x','y'])assert.ok(Math.abs(actual[key]-expected[key])<tolerance,message+' '+key+': '+actual[key]+' vs '+expected[key]);};
  const after=await geometry();assert.equal(after[0].w,400);near(after[0].origin,before[0].origin,'sheet origin stays anchored');
  if(grouped){near(after[1].origin,before[1].origin,'sibling origin stays fixed');near(after[1].far,before[1].far,'sibling far corner stays fixed');}
  await run('undo()');const undone=await geometry();assert.equal(undone[0].w,300);assert.equal(await run('items[0].state.cols'),3);
  for(let i=0;i<before.length;i++){near(undone[i].origin,before[i].origin,'undo origin');near(undone[i].far,before[i].far,'undo far corner');}
  assert.deepEqual(await run('clone(items)'),savedBefore,'undo restores the exact saved scene geometry and formulas');
  await run('redo()');const redone=await geometry();assert.equal(redone[0].w,400);assert.equal(await run('items[0].state.cols'),4);
  for(let i=0;i<after.length;i++){near(redone[i].origin,after[i].origin,'redo origin');near(redone[i].far,after[i].far,'redo far corner');}
}));
