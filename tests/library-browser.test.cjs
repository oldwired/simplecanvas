const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

// The served copy alone exposes the app closure. Catalog discovery, placement,
// persistence, Workers, and the downloaded reader remain production code.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});

async function app(fn,{features={},files={}}={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    const contents={'settings.json':JSON.stringify({version:1,features}),...files};
    await page.route('http://library-browser.test/**',route=>{
      const file=contents[route.request().url().slice('http://library-browser.test/'.length)];
      return route.fulfill({status:file!==undefined||route.request().url().endsWith('index.html')?200:404,
        contentType:file!==undefined?'application/json':'text/html',body:file??html});
    });
    await page.goto('http://library-browser.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');
    await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}

async function browse(page){
  if(await page.locator('#shapePicker').isHidden())await page.locator('#shapeLibBtn').click();
  if(await page.locator('#libraryBrowser').isHidden())await page.locator('#browseShapesBtn').click();
  await page.locator('#libraryBrowser').waitFor({state:'visible'});
}
async function details(page,name){
  await page.locator('#libraryBrowserGrid').getByRole('button',{name:'Details for '+name,exact:true}).click();
  await page.locator('#libraryBrowserDetails').waitFor({state:'visible'});
}
async function place(page,run,name,x,y){
  await browse(page);await page.locator('#librarySearch').fill(name);
  await page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place '+name,exact:true}).click();
  assert.equal(await page.locator('#shapePicker').isVisible(),false,'choosing a catalog shape closes the whole picker');
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+x,box.y+y);
  await run('shapePlacementQueue');
  return run('items[items.length-1]');
}
async function drawing(page,uid,text){
  await page.waitForFunction(({uid,text})=>__test.run(`smartChildrenCache.get(${JSON.stringify(uid)})?.kids.some(k=>k.text===${JSON.stringify(text)})`),{uid,text},{timeout:10000});
}
async function canvasTexts(page){
  return page.evaluate(()=>{
    const texts=[],original=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){
      if(this.canvas.id==='canvas')texts.push(String(text));
      return original.call(this,text,...args);
    };
    try{__test.run('render()');return texts.join('\n');}
    finally{CanvasRenderingContext2D.prototype.fillText=original;}
  });
}
async function downloadLibrary(page,run){
  const download=page.waitForEvent('download');await run('exportShapeLibrary()');
  const data=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  // Roundtrip tests reload immediately afterward. Include the export bookkeeping in the
  // durable snapshot, rather than accepting a beforeunload warning for a pending save.
  await page.waitForFunction(()=>__test.run('!shapeLibraryDirty && !shapeLibrarySavePending && !shapeLibraryStorageError'));
  return data;
}
async function importLibrary(page,data){
  // setInputFiles bypasses the inert startup UI; wait for normal user interaction readiness.
  await page.evaluate(()=>__test.run('appReady'));
  await page.locator('#shapeLibraryInput').setInputFiles({name:'library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
}
async function openExport(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-library-')),file=path.join(directory,'document.html');
  fs.copyFileSync(await(await download).path(),file);
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const preview=await context.newPage(),errors=[],requests=[];
  preview.on('pageerror',error=>errors.push(error.message));
  preview.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await preview.goto(pathToFileURL(file).href);
  return {preview,errors,requests};
}
async function connect(page,run,index,bindings){
  await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
  for(const [name,{type,uid,port}] of Object.entries(bindings)){
    await page.getByLabel(name+' ('+type+')',{exact:true}).selectOption(JSON.stringify({uid,port}));
  }
  await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
}
async function editorClick(page,run,index,x,y){
  const item=await run(`selection=[${index}];editingSmartIdx=${index};render();items[${index}]`);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+x,box.y+item.y+y);await run('smartHitSettled');
}
async function readerClick(page,index,x,y){
  const host=page.locator('[data-smart-index="'+index+'"]');
  await page.waitForFunction(el=>el.dataset.smartReady==='true',await host.elementHandle());
  const point=await host.evaluate((el,{x,y})=>{
    const p=new DOMPoint(x,y).matrixTransform(el.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};
  },{x,y});
  await page.mouse.click(point.x,point.y);
}
async function readerIndicator(page,text){
  await page.waitForFunction(text=>document.querySelector('[data-smart-index="4"]')?.textContent.includes('Status indicator') && document.querySelector('[data-smart-index="4"]').textContent.includes(text),text,{timeout:10000});
}

test('every smart-shape template has a matching built-in, fresh defaults, and an inert preview',async()=>app(async({page,run})=>{
  const catalog=await run(`(()=>{
    const expected=Object.fromEntries(Object.entries(SMART_TEMPLATES).map(([key,template])=>[key,template.script]));
    return Object.entries(expected).map(([key,script])=>{
      const matches=BUILTIN_LIBRARY_DEFINITIONS.filter(entry=>entry.key===key),entry=matches[0];
      const installed=entry && builtInShapeLibrary.find(candidate=>candidate.name===entry.name && candidate.items[0]?.script===entry.items[0]?.script);
      return {key,expected:script,matches:matches.length,script:entry?.items[0]?.script,name:entry?.name,
        id:installed?.id,preview:!!installed && !!validShapeThumbnail(installed)};
    });
  })()`);
  for(const entry of catalog){
    assert.equal(entry.matches,1,entry.key+' has exactly one built-in definition');
    assert.equal(entry.script.trim(),entry.expected.trim(),entry.key+' preserves the authoring template source');
    assert.ok(entry.id && entry.preview,entry.key+' supplies a valid cached thumbnail');
  }
  await browse(page);await page.locator('#libraryCollection').selectOption('builtin');
  for(const name of ['Drill template','Race start timer']){
    await page.locator('#librarySearch').fill(name);
    assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),0,name+' remains an example rather than a built-in');
  }
  for(const entry of catalog){
    await page.locator('#librarySearch').fill(entry.name);
    const button=page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place '+entry.name,exact:true});
    assert.equal(await button.count(),1,entry.key+' is discoverable by name');
    await page.waitForFunction(button=>button.querySelector('img')?.naturalWidth===128,await button.elementHandle());
  }
  assert.equal(await page.locator('iframe[sandbox~="allow-scripts"]').count(),0,'browsing all template previews executes no component code');

  const initialized=await run(`(async()=>{
    const results=[];
    for(const key of ${JSON.stringify(catalog.map(entry=>entry.key))}){
      const definition=BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key===key),item=clone(definition.items[0]);
      const saved=clone(item.state),owner=createSmartExecution(item),caps=await requestSmartCaps(item,owner);
      try{
        const fresh=caps.initState?await requestSmartCall(item,'initState',[],owner):{};
        const style=caps.initStyle?await requestSmartCall(item,'initStyle',[],owner):{};
        await initializeSmartItem(item,caps,()=>true,owner);
        const previews=await warmSmartExportCache([item],true);
        results.push({key,saved,fresh,placed:item.state,style,applied:Object.fromEntries(Object.keys(style||{}).map(key=>[key,item[key]])),
          width:item.w,height:item.h,children:previews.get(item).length});
      }finally{disposeSmartExecution(owner);}
    }
    return results;
  })()`);
  for(const entry of initialized){
    assert.deepEqual(entry.saved,entry.fresh,entry.key+' stores fresh defaults');
    assert.deepEqual(entry.placed,entry.fresh,entry.key+' initializes fresh placement');
    assert.deepEqual(entry.applied,entry.style||{},entry.key+' applies its declared default style');
    assert.ok(entry.width>0 && entry.height>0);
    assert.equal(entry.children===0,entry.key==='blank',entry.key+' has a usable drawing, except the intentionally empty Blank starter');
  }
}));

test('new template built-ins place and pin through the browser, with independent Chart instances in saved and offline drawings',async()=>app(async({page,run,context})=>{
  const initialWorking=await run('shapeLibrary?.workingCollection?.length||0');
  const first=await place(page,run,'Chart',240,240),second=await place(page,run,'Chart',650,240);
  await place(page,run,'Clock',1050,240);await place(page,run,'Arc',240,580);
  await place(page,run,'Blank',650,580);await place(page,run,'Arrow',1050,580);
  assert.notEqual(first.uid,second.uid);
  assert.deepEqual(first.state.values,[30,60,45,80]);assert.deepEqual(second.state.values,first.state.values);
  assert.equal(await run('items[0].state.values===items[1].state.values'),false,'placements own independent mutable state');
  assert.equal(await run('shapeLibrary?.workingCollection?.length||0'),initialWorking,'placing a template does not implicitly pin it');
  const add=await run(`requestSmartCall(items[0],'handles',[items[0].state,items[0].w,items[0].h,smartResolvedStyle(items[0])]).then(handles=>handles.find(handle=>handle.id==='add'))`);
  await editorClick(page,run,0,add.x,add.y);
  assert.equal(await run('items[0].state.values.length'),5);assert.equal(await run('items[1].state.values.length'),4);
  assert.equal(await run('items[4].componentApi===undefined'),true,'Blank remains an ordinary editable smart starter');
  await page.waitForFunction(()=>__test.run('smartChildrenCache.has(items[4].uid)'));
  assert.deepEqual(await run('smartChildrenCache.get(items[4].uid).kids'),[]);

  await browse(page);await page.locator('#librarySearch').fill('Chart');
  await page.getByRole('button',{name:'Pin Chart to working collection',exact:true}).click();
  await page.locator('#librarySearch').fill('Arc');
  await page.getByRole('button',{name:'Pin Arc to working collection',exact:true}).click();
  assert.equal(await run('shapeLibrary.workingCollection.length'),initialWorking+2);
  const pinned=await downloadLibrary(page,run);
  const snapshot='items.map(item=>({uid:item.uid,script:item.script,state:item.state,w:item.w,h:item.h}))';
  const saved=await run('save();'+snapshot);await page.reload();await run('appStarted');
  assert.deepEqual(await run(snapshot),saved,'placed API1 scripts and independent state survive reload');
  await importLibrary(page,pinned);
  await page.waitForFunction(count=>__test.run('shapeLibrary?.workingCollection?.length')===count,initialWorking+2);
  assert.equal(await run('shapeLibrary.workingCollection.length'),initialWorking+2);
  await browse(page);await page.locator('#librarySearch').fill('Chart');
  assert.equal(await page.getByRole('button',{name:'Unpin Chart from working collection',exact:true}).getAttribute('aria-pressed'),'true');
  await page.locator('#shapeLibBtn').click();

  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===6);
  const bars=index=>preview.locator('[data-smart-index="'+index+'"] text').evaluateAll(nodes=>nodes.filter(node=>/^\d+$/.test(node.textContent)).length);
  assert.equal(await bars(0),5);assert.equal(await bars(1),4);
  await readerClick(preview,0,add.x,add.y);
  await preview.waitForFunction(()=>[...document.querySelector('[data-smart-index="0"]').querySelectorAll('text')].filter(node=>/^\d+$/.test(node.textContent)).length===6);
  assert.equal(await bars(1),4,'editing one exported Chart leaves the second unchanged');
  assert.equal(await preview.locator('[data-component-error]').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('the library browser filters built-ins and places directly without adding to the working collection',async()=>app(async({page,run})=>{
  await browse(page);
  const working=await page.locator('#shapeGrid .shape-thumb').count();
  await page.locator('#libraryCollection').selectOption({label:'Built-in'});
  await page.locator('#libraryCategories').getByRole('button',{name:/^Displays\b/}).click();
  await page.locator('#librarySearch').fill('gauge');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1);
  await details(page,'Gauge');
  assert.equal(await page.locator('iframe[sandbox~="allow-scripts"]').count(),0,'browsing and reading descriptions do not execute scripts');
  await page.locator('#libraryPlaceBtn').click();
  assert.equal(await page.locator('#shapePicker').isVisible(),false);
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+600,box.y+250);
  await run('shapePlacementQueue');
  const gauge=await run('items[0]');assert.equal(gauge.componentApi,2);
  await drawing(page,gauge.uid,'0%');
  assert.equal(await run('ui.tool'),'select');
  await page.mouse.click(box.x+1000,box.y+450);
  assert.equal(await run('items.length'),1,'later canvas clicks do not place a stale pending shape');
  await browse(page);
  assert.equal(await page.locator('#shapeGrid .shape-thumb').count(),working,'direct placement does not implicitly keep a catalog entry');
  await page.locator('#closeLibraryBrowserBtn').click();
  assert.equal(await page.locator('#libraryBrowser').isVisible(),false);
  assert.equal(await page.locator('#shapePicker').isVisible(),true,'collapsing the browser retains the familiar working picker');
}));

for(const authoringFeature of ['smartComponents','smartShapeAuthoring'])test(authoringFeature+' can be hidden while built-in browsing and placement remain usable',async()=>app(async({page,run})=>{
  const gauge=await place(page,run,'Gauge',600,250);await drawing(page,gauge.uid,'0%');
  assert.equal(await page.locator('#componentBindingsBtn').isVisible(),false);
  await browse(page);await details(page,'Gauge');
  assert.equal(await page.locator('#libraryPlaceBtn').isEnabled(),true);
  assert.equal(await page.locator('#libraryKeepBtn').isDisabled(),true,'authoring restrictions also apply to catalog membership changes');
  await page.locator('#libraryPlaceBtn').click();await page.keyboard.press('Escape');
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+1000,box.y+450);
  assert.equal(await run('items.length'),1,'Escape cancels catalog placement');
},{features:{[authoringFeature]:false}}));

test('keeping entries roundtrips identity, category, tags, and working membership without replacing built-ins',async()=>app(async({page,run})=>{
  const imported={app:'SimpleCanvasShapeLibrary',version:2,workingCollection:[],shapes:[{
    id:'user-route',name:'My pointer',category:'Drawing',tags:['routing','custom'],description:'A reusable routing marker.',
    items:[{type:'rect',x:0,y:0,w:120,h:60,color:'#000000',fill:true,fillColor:'#eab308',size:2}]
  }]};
  const builtins=await run('builtInShapeLibrary.map(entry=>entry.id)');
  await importLibrary(page,imported);await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes[0]?.name')==='My pointer');
  await browse(page);await page.locator('#libraryCollection').selectOption('mine');
  await page.locator('#librarySearch').fill('routing');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1,'search includes supplied tags');
  assert.equal(await page.locator('#shapeGrid .shape-thumb').count(),0,'an explicit empty working collection stays empty');
  await page.getByRole('button',{name:'Pin My pointer to working collection',exact:true}).click();
  assert.equal(await page.locator('#shapeGrid .shape-thumb').count(),1);
  const unpin=page.getByRole('button',{name:'Unpin My pointer from working collection',exact:true});
  assert.equal(await unpin.getAttribute('aria-pressed'),'true');await unpin.click();
  assert.equal(await page.locator('#shapeGrid .shape-thumb').count(),0);
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1,'unpinning keeps the definition in the catalog');
  await page.getByRole('button',{name:'Pin My pointer to working collection',exact:true}).click();
  await page.locator('#libraryCollection').selectOption('builtin');await page.locator('#librarySearch').fill('Gauge');
  await details(page,'Gauge');await page.locator('#libraryKeepBtn').click();
  assert.equal(await page.locator('#shapeGrid .shape-thumb').count(),2);
  const exported=await downloadLibrary(page,run),custom=exported.shapes.find(entry=>entry.name==='My pointer');
  const gauge=exported.shapes.find(entry=>entry.name==='Gauge');
  assert.equal(custom.id,'user-route');assert.equal(custom.category,'Drawing');
  assert.deepEqual(custom.tags,['routing','custom']);assert.equal(custom.description,imported.shapes[0].description);
  assert.ok(gauge && gauge.items.some(item=>item.componentApi===2),'kept built-ins export their definitions');
  assert.deepEqual(exported.workingCollection,[custom.id,gauge.id]);
  await page.reload();await importLibrary(page,exported);
  await page.waitForFunction(()=>__test.run('shapeLibrary?.workingCollection.length')===2);
  assert.equal(await page.locator('#shapeGrid .shape-thumb').count(),2);
  assert.deepEqual(await run('builtInShapeLibrary.map(entry=>entry.id)'),builtins);
  await browse(page);await page.locator('#libraryCollection').selectOption('builtin');await page.locator('#librarySearch').fill('Gauge');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1,'reimport does not duplicate the built-in definition');
  const legacy={shapes:[{name:'Legacy box',items:imported.shapes[0].items}]};
  await importLibrary(page,legacy);await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes[0]?.name')==='Legacy box');
  assert.equal(await page.locator('#shapeGrid .shape-thumb').count(),1,'legacy libraries keep every entry in the working collection');
  assert.deepEqual(await run('builtInShapeLibrary.map(entry=>entry.id)'),builtins,'replacing a user library preserves built-ins');
  await browse(page);await page.locator('#libraryCollection').selectOption('builtin');await page.locator('#librarySearch').fill('Gauge');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1);
}));

test('built-in controls and logic compose a strict threshold indicator that works in offline HTML',async()=>app(async({page,run,context})=>{
  const control=await place(page,run,'Number control',200,180);
  const compare=await place(page,run,'Compare',550,180);
  const toggle=await place(page,run,'Toggle',200,430);
  const gate=await place(page,run,'AND',900,260);
  const indicator=await place(page,run,'Status indicator',1150,260);
  await connect(page,run,1,{value:{type:'number',uid:control.uid,port:'value'}});
  await connect(page,run,3,{a:{type:'boolean',uid:compare.uid,port:'value'},b:{type:'boolean',uid:toggle.uid,port:'value'}});
  await connect(page,run,4,{value:{type:'boolean',uid:gate.uid,port:'value'}});
  await drawing(page,indicator.uid,'OFF');
  await editorClick(page,run,2,toggle.w/2,toggle.h/2);
  await editorClick(page,run,0,20+(control.w-40)*.70,control.h*.55);await drawing(page,indicator.uid,'OFF');
  assert.equal(await run('items[0].state.value'),70);
  await editorClick(page,run,0,20+(control.w-40)*.71,control.h*.55);await drawing(page,indicator.uid,'ON');
  assert.equal(await run('items[0].state.value'),71);
  await editorClick(page,run,2,toggle.w/2,toggle.h/2);await drawing(page,indicator.uid,'OFF');
  await run('undo()');await drawing(page,indicator.uid,'ON');
  const {preview,errors,requests}=await openExport(page,run,context);
  await readerIndicator(preview,'ON');
  await readerClick(preview,0,20+(control.w-40)*.70,control.h*.55);await readerIndicator(preview,'OFF');
  await readerClick(preview,0,20+(control.w-40)*.71,control.h*.55);await readerIndicator(preview,'ON');
  await readerClick(preview,2,toggle.w/2,toggle.h/2);await readerIndicator(preview,'OFF');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'the downloaded composed document needs no server or external library');
}));

test('an altered built-in snapshot remains a personal definition with its imported behavior',async()=>app(async({page,run})=>{
  await browse(page);await page.locator('#librarySearch').fill('Number control');
  await details(page,'Number control');await page.locator('#libraryKeepBtn').click();
  const snapshot=await downloadLibrary(page,run),entry=snapshot.shapes.find(entry=>entry.name==='Number control');
  const installedId=entry.id,installedScript=entry.items[0].script;
  const importedScript=`({apiVersion:2,inputs:{},outputs:{value:{type:'number'}},
    compute(inputs,state){return {value:state.value+1000};},
    children(state,style,w,h,editing,io){return [{type:'text',x:0,y:0,w,h,text:'Imported: '+io.outputs.value,font:style.font,color:style.textColor}];}
  })`;
  entry.items[0].script=importedScript;entry.items[0].state={value:42};
  await importLibrary(page,snapshot);
  await page.getByRole('button',{name:'Use placeholders',exact:true}).click();
  await page.waitForFunction(id=>__test.run('shapeLibrary?.shapes[0]?.id')!==id,installedId);
  await browse(page);await page.locator('#libraryCollection').selectOption('mine');
  await page.locator('#librarySearch').fill('Number control');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1);
  const placed=await place(page,run,'Number control',600,250);
  await drawing(page,placed.uid,'Imported: 1042');
  assert.equal(placed.script,importedScript);assert.deepEqual(placed.state,{value:42});
  const exported=await downloadLibrary(page,run),personal=exported.shapes.find(entry=>entry.name==='Number control');
  assert.notEqual(personal.id,installedId,'changed snapshots cannot claim the installed definition identity');
  assert.deepEqual(exported.workingCollection,[personal.id],'working membership follows the remapped personal identity');
  assert.equal(personal.items[0].script,importedScript);assert.deepEqual(personal.items[0].state,{value:42});
  assert.equal(await run(`builtInShapeLibrary.find(entry=>entry.id===${JSON.stringify(installedId)}).items[0].script`),installedScript);
  await browse(page);await page.locator('#libraryCollection').selectOption('builtin');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1,'the installed version is still available separately');
}));

test('personal metadata can change without renaming an entry that shares a pinned built-in name',async()=>app(async({page,run})=>{
  await importLibrary(page,{app:'SimpleCanvasShapeLibrary',version:2,workingCollection:['user-rectangle'],shapes:[{
    id:'user-rectangle',name:'Rectangle',category:'Drawing',tags:['custom'],description:'Personal rectangle.',
    items:[{type:'rect',x:0,y:0,w:120,h:60,color:'#000000',fill:true,fillColor:'#eab308',size:2}]
  }]});
  await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes[0]?.id')==='user-rectangle');
  await browse(page);await page.locator('#libraryCollection').selectOption('builtin');
  await page.locator('#librarySearch').fill('Rectangle');await details(page,'Rectangle');
  await page.locator('#libraryKeepBtn').click();
  assert.equal(await page.locator('#shapeGrid .shape-thumb').count(),2);
  await page.locator('#libraryCollection').selectOption('mine');await details(page,'Rectangle');
  await run("createLibraryCategory('Routing')");
  await page.locator('#libraryCategoriesEditBtn').click();
  await page.locator('#libraryMembershipOptions').getByLabel('Drawing',{exact:true}).uncheck();
  await page.locator('#libraryMembershipOptions').getByLabel('Routing',{exact:true}).check();
  await page.locator('#libraryMembershipSave').click();
  await page.locator('#libraryEditBtn').click();
  assert.equal(await page.locator('#libraryEntryName').inputValue(),'Rectangle');
  await page.locator('#libraryEntryDescription').fill('A reusable reviewed route marker.');
  await page.locator('#libraryEntryTags').fill('reviewed, links');
  await page.locator('#libraryMetadataForm').getByRole('button',{name:'Save details',exact:true}).click();
  assert.equal(await page.locator('#libraryMetadataError').textContent(),'');
  assert.equal(await page.locator('#libraryMetadataForm').isVisible(),false,'unchanged shared names do not block metadata updates');
  await page.locator('#librarySearch').fill('reviewed');
  await page.locator('#libraryCategories').getByRole('button',{name:'Routing',exact:true}).click();
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1,'edited tags and category are immediately searchable');
  const exported=await downloadLibrary(page,run),personal=exported.shapes.find(entry=>entry.id==='user-rectangle');
  assert.equal(personal.name,'Rectangle');assert.equal(personal.category,'Routing');
  assert.equal(personal.description,'A reusable reviewed route marker.');assert.deepEqual(personal.tags,['reviewed','links']);
  assert.equal(exported.shapes.filter(entry=>entry.name==='Rectangle').length,2);
  assert.equal(exported.workingCollection.length,2);
  await page.reload();await importLibrary(page,exported);
  await page.waitForFunction(()=>__test.run('shapeLibrary?.workingCollection.length')===2);
  assert.equal(await page.locator('#shapeGrid .shape-thumb').count(),2);
  await browse(page);await page.locator('#libraryCollection').selectOption('mine');
  await page.locator('#librarySearch').fill('links');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1,'personal metadata and both same-name entries survive reimport');
}));

test('a newly placed Compare explains its missing input before becoming a live connected shape',async()=>app(async({page,run,context})=>{
  const compare=await place(page,run,'Compare',600,250);
  await run('ensureEditorComponentGraph()');
  await page.waitForFunction(()=>__test.run("smartChildrenFor(items[0],false).some(child=>child.text==='≷') && smartChildrenFor(items[0],false).some(child=>child.type==='text' && /Input required/.test(child.text))"));
  const unbound=await canvasTexts(page);
  assert.match(unbound,/compare/i,'an unbound component has a visible identity instead of an empty selection box');
  assert.match(unbound,/Input required/i,'the canvas identifies the missing input');
  assert.doesNotMatch(unbound,/Output:?\s*false/,'missing data must not be shown as a computed false value');
  const svg=await run('itemsToSVGMarkup(items)');
  assert.match(svg,/Compare/i);assert.match(svg,/Input required/i);
  assert.doesNotMatch(svg,/Output:?\s*false/,'static exports preserve the unavailable state');
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="0"][data-component-error]'));
  const readerText=await preview.locator('[data-smart-index="0"]').textContent();
  assert.match(readerText,/Compare/i);assert.match(readerText,/Input required/i);
  assert.doesNotMatch(readerText,/Output:?\s*false/,'offline HTML identifies the unbound component');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  const source=await place(page,run,'Number control',200,250);
  await connect(page,run,0,{value:{type:'number',uid:source.uid,port:'value'}});
  await drawing(page,compare.uid,'A: 50');
  const connected=await canvasTexts(page);
  assert.match(connected,/Compare/i);assert.match(connected,/A:\s*50/);assert.match(connected,/>/);
  assert.match(connected,/Output\s*false/);assert.match(connected,/B:\s*70/);
  assert.doesNotMatch(connected,/missing|unavailable/i,'the missing-input presentation clears after connecting');
  await run('selection=[1];editingSmartIdx=null;render()');await page.keyboard.press('Delete');
  await run('ensureEditorComponentGraph()');
  await page.waitForFunction(()=>__test.run("smartChildrenFor(items[0],false).some(child=>child.text==='≷') && smartChildrenFor(items[0],false).some(child=>child.type==='text' && /unavailable/i.test(child.text))"));
  const disconnected=await canvasTexts(page);
  assert.match(disconnected,/Compare/i);assert.match(disconnected,/unavailable/i);
  assert.doesNotMatch(disconnected,/Output:?\s*(true|false)/,'removing a source replaces the last computed drawing with its unavailable state');
  const disconnectedSvg=await run('itemsToSVGMarkup(items)');
  assert.match(disconnectedSvg,/unavailable/i);assert.doesNotMatch(disconnectedSvg,/Output:?\s*(true|false)/);
}));

for(const fixture of [
  {name:'Value label',source:'Number control',type:'number',value:'50'},
  {name:'Status indicator',source:'Toggle',type:'boolean',value:'OFF'}
])test('a grouped '+fixture.name+' with an external source gets a portable library preview',async()=>app(async({page,run})=>{
  const source=await place(page,run,fixture.source,200,250);
  const component=await place(page,run,fixture.name,650,250);
  await connect(page,run,1,{value:{type:fixture.type,uid:source.uid,port:'value'}});
  await drawing(page,component.uid,fixture.value);
  await page.locator('[data-tool="rect"]').click();
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.move(box.x+550,box.y+400);await page.mouse.down();
  await page.mouse.move(box.x+750,box.y+470);await page.mouse.up();
  await run("setTool('select');selection=[1,2];render()");await page.locator('#groupBtn').click();
  const original=await run('JSON.stringify(items)'),name='Grouped '+fixture.name;
  await page.locator('#shapeLibBtn').click();await page.locator('#addSelectionFooterBtn').click();
  await page.locator('#libraryNameInput').fill(name);await page.locator('#libraryDialogSubmit').click();
  await page.waitForFunction(name=>__test.run(`!!validShapeThumbnail(shapeLibrary.shapes.find(entry=>entry.name===${JSON.stringify(name)}))`),name,{timeout:10000});
  assert.equal(await run('JSON.stringify(items)'),original,'library preview generation does not mutate the live scene');
  const entry=await run('shapeLibrary.shapes[0]'),stored=entry.items.find(item=>item.componentApi===2);
  assert.equal(entry.items.length,2);assert.ok(entry.items.some(item=>item.type==='rect'));
  assert.deepEqual(stored.bindings.value,{uid:source.uid,port:'value',unresolved:true},'an excluded producer remains an explicit unresolved reference');
  assert.equal(stored.script,component.script,'the current shipped component is saved without source rewriting');
  await page.waitForFunction(()=>document.querySelector('#shapeGrid .shape-thumb img')?.naturalWidth===128);
  const exported=await downloadLibrary(page,run);
  assert.equal(exported.shapes[0].thumbnail.png,entry.thumbnail.png);
  await page.reload();await run('appStarted');await importLibrary(page,exported);
  await page.waitForFunction(name=>__test.run(`shapeLibrary?.shapes[0]?.name===${JSON.stringify(name)} && !!validShapeThumbnail(shapeLibrary.shapes[0])`),name);
  assert.equal(await page.locator('#libraryDialog[open]').count(),0,'the exported preview reopens without running component source');
  const previousCount=await run('items.length');
  await place(page,run,name,1050,550);
  const copy=await run(`items.slice(${previousCount}).find(item=>item.componentApi===2)`);
  await run('ensureEditorComponentGraph()');
  assert.deepEqual(copy.bindings.value,{uid:source.uid,port:'value',unresolved:true});
  assert.match(await run(`componentGraphError(items.find(item=>item.uid===${JSON.stringify(copy.uid)}))`),/Missing source/,
    'placement does not accidentally reconnect a copied external reference');
  const copiedIndex=await run(`items.findIndex(item=>item.uid===${JSON.stringify(copy.uid)})`);
  await connect(page,run,copiedIndex,{value:{type:fixture.type,uid:source.uid,port:'value'}});
  await drawing(page,copy.uid,fixture.value);
}));
