const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');

// Only the served copy exposes the editor closure. Transfers use the real file
// chooser and downloaded JSON; previews, placement, and component execution stay live.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});

const box={type:'rect',x:0,y:0,w:120,h:70,color:'#1e293b',fill:true,fillColor:'#eab308',size:2};
const starter={app:'SimpleCanvasShapeLibrary',version:2,categories:['Workshop','Favorites','Empty category'],
  shapes:[{id:'personal-badge',name:'Badge / outline',category:'Workshop',categoryTags:['Workshop','Favorites'],
    description:'A reusable labelled badge.',tags:['outline'],items:[box],
    source:{provider:'iconify',set:'test',icon:'badge',setName:'Test icons',
      license:{title:'MIT',spdx:'MIT',url:'https://example.com/license'},
      author:{name:'Example author',url:'https://example.com/author'}}}],workingCollection:['personal-badge']};
const producerScript=`({apiVersion:2,inputs:{},outputs:{value:{type:'number'}},
  compute(inputs,state){return {value:state.n};},
  children(state,style,w,h,editing,io){return [
    {type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#dbeafe'},
    {type:'text',x:5,y:0,w,h:30,text:'Source:'+io.outputs.value,strokeOn:false}];},
  handles(){return [{id:'increment',x:40,y:45,kind:'click'}];},
  hitEdit(state,x,y){return Math.hypot(x-40,y-45)<16?'increment':null;},
  dragEdit(state){return {state:{n:state.n+4}};}
})`;
const consumerScript=`({apiVersion:2,inputs:{value:{type:'number',default:2}},outputs:{scaled:{type:'number'}},
  compute(inputs){return {scaled:inputs.value*2};},
  children(state,style,w,h,editing,io){return [
    {type:'text',x:0,y:0,w,h:30,text:'Gauge:'+io.outputs.scaled,strokeOn:false}];}
})`;
const smart=(uid,script,state={},extra={})=>({type:'smart',uid,x:100,y:150,w:180,h:90,
  color:'#000000',fillColor:'#dc2626',strokeOn:true,fill:false,textColor:'#000000',size:2,
  fontFamily:'sans',fontSize:12,font:'600 12px sans-serif',script,state,componentApi:2,...extra});
const connectedGroup=()=>[
  {...box,uid:'frame',x:90,y:140,w:440,h:110,fill:false,group:'original-group'},
  smart('source',producerScript,{n:6},{group:'original-group'}),
  smart('gauge',consumerScript,{}, {x:340,group:'original-group',bindings:{value:{uid:'source',port:'value'}}})
];
const envelope=shape=>({app:'SimpleCanvasShape',version:1,shape});

async function app(fn,{features={},library=starter}={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.addInitScript(()=>{
      const NativeWorker=window.Worker;window.__workerStarts=0;
      window.Worker=class extends NativeWorker{constructor(...args){super(...args);window.__workerStarts++;}};
    });
    const files={'settings.json':JSON.stringify({version:1,features}),
      ...(library?{'shapes-library.json':JSON.stringify(library)}:{})};
    await page.route('http://library-transfer.test/**',route=>{
      const file=files[route.request().url().slice('http://library-transfer.test/'.length)];
      return route.fulfill({status:file!==undefined||route.request().url().endsWith('index.html')?200:404,
        contentType:file!==undefined?'application/json':'text/html',body:file??html});
    });
    await page.goto('http://library-transfer.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');
    if(library){
      await page.waitForFunction(()=>Boolean(__test.run('shapeLibrary')));
      await run('Promise.all(shapeLibrary.shapes.map(ensureShapeThumbnail))');
    }
    await fn({page,run});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function browse(page){
  if(await page.locator('#shapePicker').isHidden())await page.locator('#shapeLibBtn').click();
  if(await page.locator('#libraryBrowser').isHidden())await page.locator('#browseShapesBtn').click();
  await page.locator('#libraryBrowser').waitFor({state:'visible'});
}
async function actions(page){
  await browse(page);
  if(await page.locator('#shapePickerManage').isHidden())await page.locator('#libraryActionsBtn').click();
}
async function details(page,name,source='mine'){
  await browse(page);await page.locator('#libraryCollection').selectOption(source);
  await page.locator('#librarySearch').fill(name);
  await page.locator('#libraryBrowserGrid').getByRole('button',{name:'Details for '+name,exact:true}).click();
  await page.locator('#libraryBrowserDetails').waitFor({state:'visible'});
}
async function download(page,action){
  const pending=page.waitForEvent('download');await action();const result=await pending;
  return {name:result.suggestedFilename(),data:JSON.parse(fs.readFileSync(await result.path(),'utf8'))};
}
async function importShape(page,data,name='shared.shape.json'){
  await actions(page);
  const pending=page.waitForEvent('filechooser');await page.locator('#importShapeBtn').click();
  await(await pending).setFiles({name,mimeType:'application/json',
    buffer:Buffer.from(typeof data==='string'?data:JSON.stringify(data))});
}
async function imported(page,count){
  await page.waitForFunction(count=>__test.run('shapeLibrary?.shapes.length')===count,count);
}
async function seed(run,items){
  await run(`cancelGesture();applySketchToActiveTab(${JSON.stringify(items)}.map(item=>normalizeItem(item,{})),{});setTool('select');selection=[];render();save();`);
}
async function drawing(page,uid,text){
  await page.waitForFunction(({uid,text})=>__test.run(`smartChildrenCache.get(${JSON.stringify(uid)})?.kids.some(k=>k.text===${JSON.stringify(text)})`),{uid,text},{timeout:10000});
}
async function place(page,run,name,x,y){
  await browse(page);await page.locator('#libraryCollection').selectOption('mine');await page.locator('#librarySearch').fill(name);
  await page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place '+name,exact:true}).click();
  const bounds=await page.locator('#canvas').boundingBox();await page.mouse.click(bounds.x+x,bounds.y+y);
  await run('shapePlacementQueue');
}

test('personal actions duplicate and export one shape, and imports add uniquely named copies without replacing work',async()=>app(async({page,run})=>{
  await seed(run,[{...box,uid:'existing-drawing',x:920,y:550}]);
  const drawingBefore=await run('items'),entryBefore=await run('shapeLibrary.shapes[0]');
  await page.locator('#shapeLibBtn').click();await page.locator('#manageShapesBtn').click();
  assert.equal(await page.locator('#importLibraryBtn').textContent(),'Import library…');
  assert.equal(await page.locator('#importShapeBtn').textContent(),'Import shape…');
  const compact=page.locator('#shapeGrid');
  const first=await download(page,()=>compact.getByRole('button',{name:'Export shape… Badge / outline',exact:true}).click());
  assert.equal(first.name,'Badge - outline.shape.json');
  assert.equal(first.data.app,'SimpleCanvasShape');assert.equal(first.data.version,1);
  assert.deepEqual(Object.keys(first.data).sort(),['app','shape','version']);
  assert.deepEqual(first.data.shape,entryBefore,'single-shape export retains source attribution, memberships, and its valid preview');
  assert.ok(first.data.shape.thumbnail.png.startsWith('data:image/png;base64,'));
  assert.equal(await run('shapeLibraryDirty'),false,'export does not dirty an unchanged library');
  await compact.getByRole('button',{name:'Duplicate Badge / outline',exact:true}).click();await imported(page,2);
  assert.equal(await run('shapeLibrary.shapes[1].name'),'Badge / outline copy');
  await details(page,'Badge / outline copy');assert.equal(await page.locator('#libraryCopyBtn').textContent(),'Duplicate');
  const dirty=await download(page,()=>page.locator('#libraryExportBtn').click());
  assert.equal(dirty.data.shape.name,'Badge / outline copy');
  assert.equal(await run('shapeLibraryDirty'),true,'exporting one shape cannot mark all library edits as saved');

  for(const [count,name] of [[3,'Badge / outline copy 2'],[4,'Badge / outline copy 3']]){
    await importShape(page,first.data);await imported(page,count);
    assert.equal(await run('librarySelectedEntry.name'),name);
    assert.equal(await page.locator('#libraryDetailName').textContent(),name,'the imported copy is selected');
    assert.equal(await page.locator('#libraryCollection').inputValue(),'mine');
  }
  const library=await run('shapeLibrary');
  assert.equal(new Set(library.shapes.map(entry=>entry.id)).size,4);
  assert.deepEqual(library.workingCollection,library.shapes.map(entry=>entry.id),'new copies are pinned without removing existing pins');
  assert.deepEqual(library.shapes[0],entryBefore,'the original entry is unchanged');
  for(const entry of library.shapes.slice(1)){
    assert.deepEqual(entry.items,entryBefore.items);assert.deepEqual(entry.source,entryBefore.source);
    assert.deepEqual(entry.categoryTags,['Workshop','Favorites']);
  }
  assert.ok(library.categories.includes('Empty category'));
  assert.deepEqual(await run('items'),drawingBefore,'shape transfer does not replace the current drawing');
  assert.equal(await run('shapeLibraryDirty'),true);
}));

test('built-in transfer keeps effective categories while copies become personal and cached previews stay inert',async()=>app(async({page,run})=>{
  const original=await run("builtInShapeLibrary.find(entry=>entry.id==='builtin:ruler:1')");
  await details(page,'Ruler','builtin');
  assert.equal(await page.locator('#libraryCopyBtn').textContent(),'Copy to My shapes');
  const shared=await download(page,()=>page.locator('#libraryExportBtn').click());
  assert.equal(shared.name,'Ruler.shape.json');assert.equal(shared.data.shape.id,original.id);
  assert.deepEqual(shared.data.shape.categoryTags,['Custom lab','Tools & time']);
  assert.deepEqual(shared.data.shape.items,original.items);
  await page.locator('#libraryCopyBtn').click();await imported(page,2);
  assert.equal(await run('librarySelectedEntry.name'),'Ruler copy');
  assert.equal(await page.locator('#libraryCopyBtn').textContent(),'Duplicate');
  await importShape(page,shared.data);await imported(page,3);
  const importedEntry=await run('librarySelectedEntry');
  assert.equal(importedEntry.name,'Ruler copy 2');assert.notEqual(importedEntry.id,original.id);
  assert.equal(await run('builtInShapeEntries.has(librarySelectedEntry)'),false);
  assert.deepEqual(importedEntry.items,original.items);assert.deepEqual(importedEntry.categoryTags,['Custom lab','Tools & time']);
  assert.equal(await run('Boolean(validShapeThumbnail(librarySelectedEntry))'),true);
  assert.deepEqual(await run("builtInShapeLibrary.find(entry=>entry.id==='builtin:ruler:1')"),original);
  assert.equal(await run("libraryCatalogEntries().filter(entry=>entry.id==='builtin:ruler:1').length"),1);
  assert.deepEqual(await run('shapeLibrary.workingCollection'),await run('shapeLibrary.shapes.map(entry=>entry.id)'));
  assert.equal(await page.evaluate(()=>window.__workerStarts),0,'copying/importing/browsing cached smart previews executes no source');
  assert.equal(await page.locator('#libraryDialog[open]').count(),0);
},{library:{...starter,builtinCategoryTags:{'builtin:ruler:1':['Custom lab','Tools & time']}}}));

test('a shared grouped component shape retains source and wiring, then places as independent functional groups',async()=>{
  let shared;
  await app(async({page,run})=>{
    await seed(run,connectedGroup());await drawing(page,'gauge','Gauge:12');
    await run('selection=[0,1,2];render()');await page.locator('#shapeLibBtn').click();
    await page.locator('#addSelectionFooterBtn').click();await page.locator('#libraryNameInput').fill('Connected group');
    await page.locator('#libraryDialogSubmit').click();await imported(page,1);
    await details(page,'Connected group');
    shared=(await download(page,()=>page.locator('#libraryExportBtn').click())).data;
    assert.equal(new Set(shared.shape.items.map(item=>item.group)).size,1);
    assert.ok(shared.shape.items.every(item=>item.group));
    assert.equal(shared.shape.items[2].bindings.value.uid,shared.shape.items[1].uid);
    assert.equal(shared.shape.items[1].script,producerScript);assert.equal(shared.shape.items[2].script,consumerScript);
    assert.ok(shared.shape.thumbnail.png.startsWith('data:image/png;base64,'));
  },{library:null});
  await app(async({page,run})=>{
    await seed(run,[{...box,uid:'existing-drawing',x:1100,y:650}]);const before=await run('items[0]');
    await importShape(page,shared);await imported(page,2);await details(page,'Connected group');
    assert.equal(await page.evaluate(()=>window.__workerStarts),0,'importing and inspecting a connected group does not run its scripts');
    assert.equal(await page.locator('#libraryDialog[open]').count(),0);
    assert.deepEqual(await run('librarySelectedEntry.items'),shared.shape.items);
    assert.equal(await run('Boolean(validShapeThumbnail(librarySelectedEntry))'),true);
    await place(page,run,'Connected group',350,280);await place(page,run,'Connected group',900,280);
    const placed=await run('items');assert.equal(placed.length,7);assert.deepEqual(placed[0],before);
    const first=placed.slice(1,4),second=placed.slice(4,7);
    assert.equal(new Set(placed.map(item=>item.uid)).size,7);
    for(const group of [first,second]){
      assert.equal(new Set(group.map(item=>item.group)).size,1);assert.ok(group[0].group);
      assert.equal(group[2].bindings.value.uid,group[1].uid);
      await drawing(page,group[2].uid,'Gauge:12');
    }
    assert.notEqual(first[0].group,second[0].group,'each placement has its own selection group');
    const source=await run('selection=[2];editingSmartIdx=2;render();items[2]');
    const bounds=await page.locator('#canvas').boundingBox();
    await page.mouse.click(bounds.x+source.x+40,bounds.y+source.y+45);await run('smartHitSettled');
    await drawing(page,first[2].uid,'Gauge:20');await drawing(page,second[2].uid,'Gauge:12');
    assert.equal(await run('items[2].state.n'),10);assert.equal(await run('items[5].state.n'),6);
    assert.equal(await run('shapeLibrary.shapes[1].items[1].state.n'),6,'editing an instance leaves its reusable definition unchanged');
  });
});

test('invalid shape files and disabled authoring leave the active library and drawing intact',async()=>{
  const valid=envelope(starter.shapes[0]);
  await app(async({page,run})=>{
    await seed(run,[{...box,uid:'existing-drawing',x:900,y:550}]);
    const before=await run('({library:shapeLibrary,items,dirty:shapeLibraryDirty})');
    const cases=[
      ['not-json','{unfinished',/not valid JSON/],
      ['wrong-kind',{...valid,app:'SimpleCanvasShapeLibrary'},/not a SimpleCanvas shape/],
      ['future-version',{...valid,version:2},/Unsupported shape file version/],
      ['invalid-object',envelope({name:'Broken',items:[{...box,type:'unknown'}]}),/Invalid object/]
    ];
    for(const [name,data,error] of cases){
      await importShape(page,data,name+'.json');
      await page.waitForFunction(source=>new RegExp(source).test(document.querySelector('#toast').textContent),error.source);
      assert.deepEqual(await run('({library:shapeLibrary,items,dirty:shapeLibraryDirty})'),before,name+' is rejected atomically');
      assert.equal(await page.locator('#libraryDialog[open]').count(),0);
    }
    assert.equal(await page.evaluate(()=>window.__workerStarts),0);

    // Shared selections can legitimately omit a producer. They must stay
    // explicitly disconnected, even if this drawing happens to reuse its UID.
    await seed(run,[smart('outside-this-shape',producerScript,{n:99})]);
    await drawing(page,'outside-this-shape','Source:99');
    const outside=connectedGroup();outside[2].bindings.value.uid='outside-this-shape';
    await importShape(page,envelope({name:'External group',items:outside}));await imported(page,2);
    if(await page.locator('#libraryDialog').isVisible())await page.locator('#libraryDialogCancel').click();
    const binding={uid:'outside-this-shape',port:'value',unresolved:true};
    assert.deepEqual(await run('librarySelectedEntry.items[2].bindings.value'),binding);
    await details(page,'External group');
    const exported=await download(page,()=>page.locator('#libraryExportBtn').click());
    assert.deepEqual(exported.data.shape.items[2].bindings.value,binding);
    await importShape(page,exported.data);await imported(page,3);
    if(await page.locator('#libraryDialog').isVisible())await page.locator('#libraryDialogCancel').click();
    await place(page,run,'External group copy',700,300);
    await run('ensureEditorComponentGraph()');
    assert.deepEqual(await run('items[3].bindings.value'),binding);
    await page.waitForFunction(()=>Boolean(__test.run('componentGraphError(items[3])')));
    assert.equal(await run('items[0].state.n'),99,'a matching drawing UID is never implicitly connected');
  });
  for(const feature of ['smartShapeAuthoring','smartComponents'])await app(async({page,run})=>{
    const before=await run('({library:shapeLibrary,items,dirty:shapeLibraryDirty})');
    await details(page,'Gauge','builtin');
    assert.equal(await page.locator('#libraryCopyBtn').isVisible(),false,feature+' also prevents copying components');
    const shared=await download(page,()=>page.locator('#libraryExportBtn').click());
    assert.equal(shared.data.shape.name,'Gauge','existing shapes can still be exported with authoring hidden');
    await importShape(page,shared.data);
    await page.waitForFunction(()=>/Importing smart (shapes|components) is disabled/.test(document.querySelector('#toast').textContent));
    assert.deepEqual(await run('({library:shapeLibrary,items,dirty:shapeLibraryDirty})'),before);
    await importShape(page,valid);await imported(page,2);
    assert.equal(await run('librarySelectedEntry.name'),'Badge / outline copy','ordinary shapes remain importable');
  },{features:{[feature]:false}});
  await app(async({page,run})=>{
    const before=await run('({library:shapeLibrary,items,dirty:shapeLibraryDirty})');
    await details(page,'Badge / outline');
    for(const id of ['manageShapesBtn','libraryActionsBtn','importShapeBtn','libraryCopyBtn','libraryExportBtn']){
      assert.equal(await page.locator('#'+id).isVisible(),false,id+' is hidden for a fixed library');
    }
    await page.locator('#shapeFileInput').setInputFiles({name:'blocked.shape.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(valid))});
    await run('copyLibraryEntry(shapeLibrary.shapes[0]);exportLibraryShape(shapeLibrary.shapes[0])');
    assert.deepEqual(await run('({library:shapeLibrary,items,dirty:shapeLibraryDirty})'),before,'guarded entry points cannot modify a fixed library');
  },{features:{shapeLibraryManagement:false}});
});
