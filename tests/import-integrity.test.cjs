const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[],dialogs=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.accept();});
    await page.route('http://import-integrity.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://import-integrity.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,dialogs});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
const rect=(uid,x=100)=>({type:'rect',uid,x,y:100,w:120,h:80,size:2,color:'#334155',fill:true,fillColor:'#f1f5f9'});
const incoming={app:'SimpleCanvas',version:4,items:[rect('incoming')],assets:{}};
async function twoTabs(run){
  return run(`(()=>{items=[${JSON.stringify(rect('tab-a'))}];save();const first=activeTabId;
    newTab();items=[${JSON.stringify(rect('tab-b',300))}];save();const second=activeTabId;activateTab(first);return {first,second};})()`);
}
const snapshot=run=>run(`({active:activeTabId,tabs:tabs.map(tab=>({id:tab.id,items:clone(tab.id===activeTabId?items:tabDocument(tab.id).items),
  undo:clone(tab.id===activeTabId?undoStack:tabDocument(tab.id).undoStack),saved:localStorage.getItem(docKey(tab.id))}))})`);

test('a sketch file finishing after a tab switch cannot replace the newly active tab',async()=>app(async({page,run,dialogs})=>{
  const {second}=await twoTabs(run);
  await page.evaluate(()=>{
    const NativeReader=window.FileReader;window.__releaseReads=[];
    window.FileReader=class extends NativeReader{readAsText(file){window.__releaseReads.push(()=>super.readAsText(file));}};
  });
  await run(`importProject(new File([${JSON.stringify(JSON.stringify(incoming))}],'incoming.json',{type:'application/json'}))`);
  await run(`activateTab(${JSON.stringify(second)})`);const before=await snapshot(run);
  await page.evaluate(()=>window.__releaseReads.shift()());
  await page.waitForFunction(()=>/active tab changed|Sketch imported/.test(document.querySelector('#toast').textContent));
  assert.deepEqual(await snapshot(run),before,'neither tab content, history, nor persistence changes');
  assert.deepEqual(dialogs,[],'a cancelled import never asks to replace the unrelated tab');
}));

test('choosing a workspace sketch after switching tabs cancels the original Import sketch request',async()=>app(async({page,run,dialogs})=>{
  const {second}=await twoTabs(run);
  const workspace={app:'SimpleCanvasWorkspace',version:4,tabs:[{name:'Imported sketch',items:incoming.items,assets:{}}],activeIndex:0};
  await run(`importProject(new File([${JSON.stringify(JSON.stringify(workspace))}],'workspace.json',{type:'application/json'}))`);
  await page.locator('#tabPickerDialog').waitFor({state:'visible'});
  await run(`activateTab(${JSON.stringify(second)})`);const before=await snapshot(run);
  await page.locator('#tabPickerList button').click();
  await page.waitForFunction(()=>/active tab changed|Sketch imported/.test(document.querySelector('#toast').textContent));
  assert.deepEqual(await snapshot(run),before);assert.deepEqual(dialogs,[]);
}));

test('Import sketch keeps the target selected before the native picker and normal opens remain undoable',async()=>app(async({page,run,dialogs})=>{
  const {first,second}=await twoTabs(run);
  const chooser=page.waitForEvent('filechooser');await run("MENU_ACTIONS.open()");const fileChooser=await chooser;
  await run(`activateTab(${JSON.stringify(second)})`);const before=await snapshot(run);
  await fileChooser.setFiles({name:'incoming.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});
  await page.waitForFunction(()=>/active tab changed|Sketch imported/.test(document.querySelector('#toast').textContent));
  assert.deepEqual(await snapshot(run),before);assert.deepEqual(dialogs,[]);
  await run(`activateTab(${JSON.stringify(first)});importProject(new File([${JSON.stringify(JSON.stringify(incoming))}],'incoming.json'))`);
  await page.waitForFunction(()=>__test.run("items[0]?.uid==='incoming'"));
  assert.equal(dialogs.length,1);assert.match(dialogs[0],/Replace the current sketch/);
  await run('undo()');assert.equal(await run('items[0].uid'),'tab-a');
  assert.equal(await run(`tabDocument(${JSON.stringify(second)}).items[0].uid`),'tab-b');
}));

test('import normalization rejects extreme positions and extents without overflowing and keeps finite component values',async()=>app(async({run})=>{
  const result=await run(`(()=>{
    const good=${JSON.stringify(rect('valid'))};
    const invalid=[];
    for(const type of ['rect','ellipse','table','text','smart','image'])for(const field of ['x','y','w','h'])for(const value of [1e308,-1e308,1000001,-1000001]){
      invalid.push({...good,type,uid:type+'-'+field,script:'({children(){return [];}})',text:'Text',id:'image',state:{},[field]:value});
    }
    for(const type of ['line','arrow'])for(const field of ['x1','y1','x2','y2'])for(const value of [1e308,-1e308]){
      invalid.push({type,x1:0,y1:0,x2:10,y2:10,[field]:value});
    }
    for(const type of ['path','polygon'])for(const axis of ['x','y'])invalid.push({type,points:[{x:0,y:0},{x:10,y:10,[axis]:1e308},{x:20,y:0}]});
    const handles={type:'polygon',uid:'handles',points:[{x:0,y:0,c1:{x:1e308,y:0},c2:{x:0,y:-1e308}},{x:20.126,y:20.124},{x:40,y:0}]};
    const numeric={...good,type:'smart',uid:'numeric',script:'({children(){return [];}})',state:{value:Number.MAX_VALUE},componentApi:2,inputValues:{value:Number.MAX_VALUE}};
    const scene=normalizeScene([...invalid,good,handles,numeric],{image:'data:image/png;base64,AA=='},FORMAT_VERSION);
    return {rejected:invalid.every(item=>normalizeItem(item,{image:'data:image/png;base64,AA=='})===null),dropped:scene.dropped,invalid:invalid.length,
      ids:scene.items.map(item=>item.uid),handles:scene.items.find(item=>item.uid==='handles').points,numeric:scene.items.find(item=>item.uid==='numeric'),
      boundary:normalizeItem({...good,x:1000000,y:-1000000,w:1000000,h:-1000000},{})};
  })()`);
  assert.equal(result.rejected,true);assert.equal(result.dropped,result.invalid);
  assert.deepEqual(result.ids,['valid','handles','numeric']);
  assert.deepEqual(result.handles,[{x:0,y:0},{x:20.13,y:20.12},{x:40,y:0}]);
  assert.equal(result.numeric.state.value,Number.MAX_VALUE);assert.equal(result.numeric.inputValues.value,Number.MAX_VALUE);
  assert.equal(result.boundary.x,1000000);assert.equal(result.boundary.y,-1000000);
  assert.equal(result.boundary.w,1000000);assert.equal(result.boundary.h,-1000000);
}));

test('a file containing only overflowed geometry leaves the current drawing and history intact',async()=>app(async({page,run,dialogs})=>{
  await run(`items=[${JSON.stringify(rect('keep'))}];save();`);const before=await snapshot(run);
  const data={...incoming,items:[{...rect('extreme'),x:1e308}]};
  await run(`importProject(new File([${JSON.stringify(JSON.stringify(data))}],'extreme.json'))`);
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='No readable objects in that file');
  assert.deepEqual(await snapshot(run),before);assert.deepEqual(dialogs,[]);
}));

test('huge imported rotations remain finite in selection, SVG, and a saved drawing',async()=>app(async({page,run})=>{
  const angles=[1e308,-1e308,Number.MAX_VALUE,-Number.MAX_VALUE,Math.PI/3,-Math.PI/4];
  const source=angles.map((rotation,i)=>({...rect('angle-'+i,100+i*180),rotation,group:'group-'+i,groupRotation:rotation}));
  const read=`(()=>{
    const frames=items.map(item=>worldFrameOf(item));
    const finite=value=>typeof value==='number'?Number.isFinite(value):Object.values(value).every(finite);
    return {angles:items.map(item=>[item.rotation,item.groupRotation]),finite:frames.every(finite),
      svg:items.map(item=>itemToSVG(item)).join(''),saved:JSON.parse(localStorage.getItem(docKey(activeTabId))).items};
  })()`;
  const before=await run(`items=normalizeScene(${JSON.stringify(source)},{},FORMAT_VERSION).items;
    setTool('select');selection=[0];editingGroupId=items[0].group;save();render();${read}`);
  assert.deepEqual(before.angles,angles.map(angle=>[angle%(2*Math.PI),angle%(2*Math.PI)]));
  assert.equal(before.finite,true);assert.doesNotMatch(before.svg,/Infinity|NaN/);
  assert.deepEqual(before.saved.map(item=>[item.rotation,item.groupRotation]),before.angles);
  await page.reload();await run('appStarted');
  const after=await run(read);
  assert.deepEqual(after.angles,before.angles);assert.equal(after.finite,true);
  assert.equal(after.svg,before.svg);assert.deepEqual(after.saved,before.saved);
}));
