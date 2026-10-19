const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');

// Expose the editor closure only in the served fixture. Menu activation, modal
// choices, downloads, persistence, and keyboard handling remain production code.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});

const box={type:'rect',uid:'box',x:80,y:90,w:150,h:100,color:'#1f2937',size:2,fill:true,fillColor:'#ffd166'};
const text={type:'text',uid:'note',x:300,y:100,w:250,h:80,text:'Saved draft',fontSize:28,fontFamily:'sans',textColor:'#000000',color:'#000000',size:2,strokeOn:false};
const library={app:'SimpleCanvasShapeLibrary',version:2,categories:['Drawing'],workingCollection:['personal-box'],
  shapes:[{id:'personal-box',name:'My saved box',category:'Drawing',items:[box]}]};
const table={name:'Measurements',columns:[{key:'value',name:'Value',type:'number'}],rows:[[3.5],[7]]};

async function app(fn,{features={}}={}){
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  try{
    const page=await context.newPage(),errors=[],confirmations=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>{confirmations.push(dialog.message());return dialog.accept();});
    await page.route('http://new-workspace.test/**',route=>{
      const file=new URL(route.request().url()).pathname;
      const body=file==='/index.html'?html:file==='/settings.json'?JSON.stringify({version:1,features}):file==='/shapes-library.json'?JSON.stringify(library):'';
      return route.fulfill({status:body?200:404,contentType:file.endsWith('.json')?'application/json':'text/html',body});
    });
    await page.goto('http://new-workspace.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');
    await fn({page,run,context,confirmations});
    assert.deepEqual(errors,[],'no uncaught application errors');
  }finally{await context.close();}
}
async function action(page,name){
  if(await page.locator('#menu').isHidden())await page.locator('#menuBtn').click();
  await page.locator('#menu [data-act='+JSON.stringify(name)+']').click();
}
async function seeded(run){
  return run(`(()=>{
    applySketchToActiveTab([${JSON.stringify(box)}],{});tabs[0].name='First drawing';
    newTab();applySketchToActiveTab([{...${JSON.stringify(box)},uid:'second'},${JSON.stringify(text)}],{});tabs[1].name='Second drawing';
    beginHistory();items[0].x+=20;commitHistory();
    ui.color='#ef4444';ui.size=17;saveTabList();save();renderTabs();
    return tabs.map(tab=>({id:tab.id,key:docKey(tab.id)}));
  })()`);
}
async function snapshot(run){return run(`JSON.stringify({tabs,activeTabId,documents:tabs.map(tab=>({id:tab.id,...documentForFile(tabDocument(tab.id)),undo:tabDocument(tab.id).undoStack,redo:tabDocument(tab.id).redoStack})),selection,stored:Object.fromEntries(Object.entries(localStorage))})`);}
async function emptyWorkspace(run){
  const data=await run(`({tabs,activeTabId,items,assets,datasets,ui,defaults:defaultUi(),undo:undoStack,redo:redoStack,selection,documents:[...tabDocuments.keys()],timelines:[...editorTimelines.keys()]})`);
  assert.equal(data.tabs.length,1);assert.equal(data.tabs[0].name,'Sketch 1');assert.equal(data.activeTabId,data.tabs[0].id);
  assert.deepEqual(data.items,[]);assert.deepEqual(data.assets,{});assert.deepEqual(data.datasets,{});
  assert.deepEqual(data.ui,data.defaults);assert.deepEqual(data.undo,[]);assert.deepEqual(data.redo,[]);assert.deepEqual(data.selection,[]);
  assert.deepEqual(data.documents,[data.activeTabId]);assert.ok(data.timelines.every(id=>id===data.activeTabId));
  return data.activeTabId;
}

test('menu groups file and export actions by workspace or current sketch with usable keyboard navigation on a small screen',async()=>app(async({page,run})=>{
  await seeded(run);await page.locator('#menuBtn').focus();await page.keyboard.press('ArrowDown');
  const menu=page.locator('#menu');
  assert.deepEqual(await menu.getByRole('group').evaluateAll(groups=>groups.map(group=>document.getElementById(group.getAttribute('aria-labelledby'))?.textContent.trim())),['Workspace','Current sketch']);
  const actions=async name=>menu.getByRole('group',{name,exact:true}).locator('[data-act]').evaluateAll(buttons=>buttons.map(button=>button.dataset.act));
  assert.deepEqual(await actions('Workspace'),['newWorkspace','openWorkspace','saveWorkspace','newTab','html']);
  assert.deepEqual(await actions('Current sketch'),['open','save','png','svg','htmlSketch','print','clear']);
  assert.match(await menu.locator('[data-act="open"]').textContent(),/Import sketch…/);
  assert.match(await menu.locator('[data-act="save"]').textContent(),/Export sketch…/);
  assert.match(await menu.locator('[data-act="clear"]').textContent(),/Clear current sketch/);
  assert.doesNotMatch(await menu.textContent(),/Clear canvas/);
  const ordered=await menu.locator('[data-act]').evaluateAll(buttons=>buttons.map(button=>button.dataset.act));
  for(const expected of ordered){
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.act),expected,'arrows skip noninteractive group headings');
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.act),'clear');
  await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await page.locator('#newWorkspaceDialog').waitFor({state:'visible'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#newWorkspaceDialog').isHidden(),true);
  await page.setViewportSize({width:390,height:520});await page.locator('#menuBtn').click();
  await page.keyboard.press('End');
  const bounds=await menu.boundingBox(),last=await menu.locator('[data-act="clear"]').boundingBox();
  assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391&&bounds.y>=0&&bounds.y+bounds.height<=521,'the menu fits the viewport');
  assert.ok(last.y>=bounds.y&&last.y+last.height<=bounds.y+bounds.height+1,'keyboard focus scrolls the final action into view');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#menuBtn').evaluate(el=>el===document.activeElement),true);
}));

test('Cancel and Escape preserve every tab and its history, and tab-only work still requires confirmation',async()=>app(async({page,run})=>{
  await seeded(run);const before=await snapshot(run);
  await action(page,'newWorkspace');const dialog=page.locator('#newWorkspaceDialog');await dialog.waitFor({state:'visible'});
  assert.match(await dialog.textContent(),/2.*tabs.*one blank sketch/i);
  for(const label of ['Save & start new','Start new','Cancel'])assert.equal(await dialog.getByRole('button',{name:label,exact:true}).isVisible(),true);
  await page.locator('#newWorkspaceCancel').click();assert.equal(await snapshot(run),before);
  await action(page,'newWorkspace');await page.keyboard.press('Escape');assert.equal(await snapshot(run),before);
  await run('items=[];undoStack=[];redoStack=[];save();activateTab(tabs[0].id);items=[];undoStack=[];redoStack=[];save();');
  const structural=await snapshot(run);await action(page,'newWorkspace');await dialog.waitFor({state:'visible'});
  await page.locator('#newWorkspaceCancel').click();assert.equal(await snapshot(run),structural,'empty named tabs are still workspace structure');
}));

test('Start new resets documents, history and tools while retaining the personal library and working collection across reload',async()=>app(async({page,run})=>{
  const old=await seeded(run);
  await page.waitForFunction(()=>Boolean(__test.run('shapeLibrary')));
  await run(`shapeLibrary.shapes.find(entry=>entry.id==='personal-box').name='Retained library edit';shapeLibrary.workingCollection=['personal-box'];shapeLibraryChanged();`);
  await page.waitForFunction(()=>__test.run('shapeLibraryStorageOwned && !shapeLibrarySavePending && !shapeLibraryStorageError'));
  const keptLibrary=await run('JSON.stringify(shapeLibrary)');
  await run(`assets.retained='data:image/png;base64,old';datasets.retained=${JSON.stringify(table)};rememberActiveTab();`);
  await action(page,'newWorkspace');await page.locator('#newWorkspaceStart').click();await page.locator('#newWorkspaceDialog').waitFor({state:'hidden'});
  const id=await emptyWorkspace(run);assert.ok(old.every(tab=>tab.id!==id));
  assert.equal(await run('JSON.stringify(shapeLibrary)'),keptLibrary);
  for(const tab of old)assert.equal(await page.evaluate(key=>localStorage.getItem(key),tab.key),null,'retired tab documents are removed after the new index is saved');
  assert.equal(await page.locator('#autosaveWarning').isVisible(),false);
  assert.equal(await page.locator('#undo').isDisabled(),true);assert.equal(await page.locator('#redo').isDisabled(),true);
  await page.reload();assert.equal(await emptyWorkspace(run),id);
  await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes.some(entry=>entry.name==="Retained library edit")'));
  assert.deepEqual(await run('shapeLibrary.workingCollection'),['personal-box']);
}));

test('Save & start new downloads the complete current workspace including the active text draft before resetting',async()=>app(async({page,run})=>{
  await seeded(run);
  await run('openText(1);textInput.value="Latest unsaved text";');
  await action(page,'newWorkspace');await page.locator('#newWorkspaceDialog').waitFor({state:'visible'});
  const pending=page.waitForEvent('download');await page.locator('#newWorkspaceSave').click();
  const downloaded=await pending,data=JSON.parse(fs.readFileSync(await downloaded.path(),'utf8'));
  assert.match(downloaded.suggestedFilename(),/^workspace-.*\.json$/);assert.equal(data.app,'SimpleCanvasWorkspace');
  assert.equal(data.activeIndex,1);assert.deepEqual(data.tabs.map(tab=>tab.name),['First drawing','Second drawing']);
  assert.equal(data.tabs[0].items[0].uid,'box');assert.equal(data.tabs[1].items[0].x,100);
  assert.equal(data.tabs[1].items[1].text,'Latest unsaved text');
  assert.equal(data.tabs[1].ui.color,'#ef4444');assert.equal(data.tabs[1].ui.size,17);
  await page.locator('#newWorkspaceDialog').waitFor({state:'hidden'});await emptyWorkspace(run);
}));

test('failed Save & start new leaves the workspace and confirmation available for retry',async()=>app(async({page,run})=>{
  await seeded(run);const before=await snapshot(run);
  await action(page,'newWorkspace');
  await page.evaluate(()=>{window.originalDownloadClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)throw new Error('Download unavailable');return window.originalDownloadClick.call(this);};});
  await page.locator('#newWorkspaceSave').click();
  assert.equal(await page.locator('#newWorkspaceDialog').isVisible(),true);assert.equal(await snapshot(run),before);
  assert.match(await page.locator('#newWorkspaceDialog').textContent(),/Download unavailable/);
  assert.equal(await page.locator('#newWorkspaceSave').isEnabled(),true);
  await page.evaluate(()=>{HTMLAnchorElement.prototype.click=window.originalDownloadClick;});
  const pending=page.waitForEvent('download');await page.locator('#newWorkspaceSave').click();await pending;
  await page.locator('#newWorkspaceDialog').waitFor({state:'hidden'});await emptyWorkspace(run);
}));

for(const failedWrite of ['document','index'])test(`new-workspace ${failedWrite} storage failure retains old durable tabs until persistence succeeds`,async()=>app(async({page,run})=>{
  const old=await seeded(run),oldIndex=await run('localStorage.getItem(TABS_KEY)');
  const oldDocs=await page.evaluate(keys=>keys.map(key=>localStorage.getItem(key)),old.map(tab=>tab.key));
  await action(page,'newWorkspace');
  await page.evaluate(({failedWrite,oldKeys})=>{
    window.originalStorageSet=Storage.prototype.setItem;window.originalStorageRemove=Storage.prototype.removeItem;window.storageWrites=[];
    Storage.prototype.setItem=function(key,value){
      window.storageWrites.push(['set',key]);
      if((failedWrite==='document'&&key.startsWith('simplecanvas:doc:')&&!oldKeys.includes(key))||(failedWrite==='index'&&key==='simplecanvas:tabs:v1'))throw new DOMException('Full','QuotaExceededError');
      return window.originalStorageSet.call(this,key,value);
    };
    Storage.prototype.removeItem=function(key){window.storageWrites.push(['remove',key]);return window.originalStorageRemove.call(this,key);};
  },{failedWrite,oldKeys:old.map(tab=>tab.key)});
  await page.locator('#newWorkspaceStart').click();await page.locator('#newWorkspaceDialog').waitFor({state:'hidden'});
  const id=await emptyWorkspace(run);assert.equal(await page.locator('#autosaveWarning').isVisible(),true);
  assert.equal(await run('localStorage.getItem(TABS_KEY)'),oldIndex);
  assert.deepEqual(await page.evaluate(keys=>keys.map(key=>localStorage.getItem(key)),old.map(tab=>tab.key)),oldDocs);
  assert.deepEqual(await page.evaluate(()=>window.storageWrites.filter(([kind])=>kind==='remove')),[]);
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSet;window.storageWrites=[];Storage.prototype.setItem=function(key,value){window.storageWrites.push(['set',key]);return window.originalStorageSet.call(this,key,value);};});
  await run('save()');assert.equal(await page.locator('#autosaveWarning').isVisible(),false);
  const writes=await page.evaluate(()=>window.storageWrites),newDocument=writes.findIndex(([kind,key])=>kind==='set'&&key==='simplecanvas:doc:'+id),index=writes.findIndex(([kind,key])=>kind==='set'&&key==='simplecanvas:tabs:v1');
  assert.ok(newDocument>=0&&index>newDocument,'replacement document is durable before its index');
  assert.ok(writes.filter(([kind])=>kind==='remove').length>=2);assert.ok(writes.findIndex(([kind])=>kind==='remove')>index,'old tabs are deleted only after the replacement index');
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSet;Storage.prototype.removeItem=window.originalStorageRemove;});
  await page.reload();assert.equal(await emptyWorkspace(run),id);
}));

test('a pristine workspace starts anew immediately but a renamed single tab is protected',async()=>app(async({page,run})=>{
  const before=await run('activeTabId');await action(page,'newWorkspace');
  assert.equal(await page.locator('#newWorkspaceDialog').isHidden(),true);assert.notEqual(await emptyWorkspace(run),before);
  await run('tabs[0].name="Project notes";saveTabList();renderTabs();');
  await action(page,'newWorkspace');await page.locator('#newWorkspaceDialog').waitFor({state:'visible'});
  await page.locator('#newWorkspaceCancel').click();assert.equal(await run('tabs[0].name'),'Project notes');
}));

test('starting a new workspace invalidates a workspace file that was still being read',async()=>app(async({page,run})=>{
  await seeded(run);
  const incoming={app:'SimpleCanvasWorkspace',version:5,tabs:[{name:'Late import',items:[box]}]};
  await page.evaluate(()=>{
    window.originalReadText=FileReader.prototype.readAsText;
    FileReader.prototype.readAsText=function(file){
      if(file.name==='delayed-workspace.json')window.releaseWorkspaceFile=()=>new Promise(resolve=>{this.addEventListener('loadend',resolve,{once:true});window.originalReadText.call(this,file);});
      else window.originalReadText.call(this,file);
    };
  });
  await run('pendingFileAction="openWorkspace";pendingFileTabId=activeTabId;');
  await page.locator('#projectInput').setInputFiles({name:'delayed-workspace.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});
  await page.waitForFunction(()=>typeof window.releaseWorkspaceFile==='function');
  await action(page,'newWorkspace');await page.locator('#newWorkspaceStart').click();
  await page.locator('#newWorkspaceDialog').waitFor({state:'hidden'});const id=await emptyWorkspace(run);
  await page.evaluate(async()=>{await window.releaseWorkspaceFile();FileReader.prototype.readAsText=window.originalReadText;});
  assert.equal(await emptyWorkspace(run),id,'late completion cannot replace the newly created workspace');
  const choosing=page.waitForEvent('filechooser');await action(page,'openWorkspace');const chooser=await choosing;
  await action(page,'newWorkspace');const next=await emptyWorkspace(run);assert.notEqual(next,id);
  await chooser.setFiles({name:'late-choice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});
  assert.equal(await emptyWorkspace(run),next,'a file picker opened before reset cannot import into the new workspace');
}));

test('the confirmation freezes running simulation time and Cancel preserves the user’s existing Pause choice',async()=>app(async({page,run})=>{
  await run(`cancelGesture();items=[{...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key==='pulseGenerator').items[0]),uid:'timer',x:80,y:90,inputValues:{seconds:.2,width:.1}}];selection=[];setTool('select');save();render();`);
  await page.waitForFunction(()=>__test.run('editorTimeline?.active && smartChildrenCache.has("timer")'));
  await action(page,'newWorkspace');await page.locator('#newWorkspaceDialog').waitFor({state:'visible'});
  await page.waitForFunction(()=>__test.run('!editorTimeline.active'));
  const frozen=await run('componentTimelineNow(editorTimeline)');await page.waitForTimeout(250);
  assert.equal(await run('componentTimelineNow(editorTimeline)'),frozen);
  await page.locator('#newWorkspaceCancel').click();await page.waitForFunction(()=>__test.run('editorTimeline.active'));
  await page.waitForFunction(time=>__test.run('componentTimelineNow(editorTimeline)')>time,frozen);
  await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');
  assert.equal(await run('editorTimeline.pausedByUser'),true);
  await action(page,'newWorkspace');await page.locator('#newWorkspaceDialog').waitFor({state:'visible'});
  const paused=await run('componentTimelineNow(editorTimeline)');await page.locator('#newWorkspaceCancel').click();
  await page.waitForTimeout(150);
  assert.deepEqual(await run('({time:componentTimelineNow(editorTimeline),paused:editorTimeline.pausedByUser,active:editorTimeline.active})'),{time:paused,paused:true,active:false});
}));

test('Clear current sketch only clears the active tab and Undo restores it without changing the workspace',async()=>app(async({page,run,confirmations})=>{
  const ids=await seeded(run),before=await run('JSON.stringify(items)'),other=await run('JSON.stringify(documentForFile(tabDocument(tabs[0].id)))');
  await action(page,'clear');assert.deepEqual(await run('items'),[]);
  assert.equal(await run('tabs.length'),2);assert.equal(await run('activeTabId'),ids[1].id);assert.equal(await run('tabs[1].name'),'Second drawing');
  assert.equal(await run('JSON.stringify(documentForFile(tabDocument(tabs[0].id)))'),other);
  assert.match(confirmations.at(-1),/current sketch/i);
  await page.locator('#undo').click();assert.equal(await run('JSON.stringify(items)'),before);
}));

test('workspace-disabled deployments hide the whole workspace menu group and cannot reset preserved tabs',async()=>app(async({page,run})=>{
  await seeded(run);
  await page.route('**/settings.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,features:{workspace:false}})}));
  await page.reload();await run('appStarted');const before=await run('JSON.stringify({tabs,activeTabId,items})');await page.locator('#menuBtn').click();
  assert.equal(await page.locator('#menu').getByRole('group',{name:'Workspace',exact:true}).count(),0);
  for(const name of ['newWorkspace','openWorkspace','saveWorkspace','newTab','html'])assert.equal(await page.locator('[data-act='+JSON.stringify(name)+']').isVisible(),false);
  assert.equal(await page.locator('#menu').getByRole('group',{name:'Current sketch',exact:true}).isVisible(),true);
  assert.deepEqual(await page.locator('#menu').getByRole('group',{name:'Current sketch',exact:true}).locator('[data-act]').evaluateAll(buttons=>buttons.map(button=>button.dataset.act)),['open','save','png','svg','htmlSketch','print','clear']);
  await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.dataset.act),'open');
  await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.act),'save');
  await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.act),'png');
  await page.keyboard.press('Escape');await run('MENU_ACTIONS.newWorkspace()');
  assert.equal(await page.locator('#newWorkspaceDialog').isHidden(),true);assert.equal(await run('JSON.stringify({tabs,activeTabId,items})'),before);
}));

for(const workspace of [true,false])test(`Ctrl and Command open/save shortcuts use ${workspace?'the workspace':'only the current sketch'} and their menu hints match`,async()=>app(async({page,run})=>{
  await seeded(run);
  if(!workspace){
    await page.route('**/settings.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,features:{workspace:false}})}));
    await page.reload();await run('appStarted');
  }
  const saveAction=workspace?'saveWorkspace':'save',openAction=workspace?'openWorkspace':'open';
  await page.locator('#menuBtn').click();
  for(const [actionName,key] of [[saveAction,'S'],[openAction,'O']]){
    const hint=page.locator('#menu [data-act='+JSON.stringify(actionName)+'] .sc');
    assert.equal(await hint.isVisible(),true);assert.match(await hint.textContent(),new RegExp(key+'$'));
  }
  if(workspace)for(const actionName of ['open','save'])assert.equal(await page.locator('#menu [data-act='+JSON.stringify(actionName)+'] .sc:visible').count(),0,'sketch commands do not advertise the workspace shortcut');
  await page.keyboard.press('Escape');
  for(const modifier of ['Control','Meta']){
    const prior=await run('({tabs:clone(tabs),active:activeTabId,items:clone(items),background:clone(tabDocument(tabs[0].id).items)})');
    await page.bringToFront();await page.locator('#menuBtn').focus();const pendingDownload=page.waitForEvent('download',{timeout:10000});await page.keyboard.press(modifier+'+s');
    const download=await pendingDownload,data=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(data.app,workspace?'SimpleCanvasWorkspace':'SimpleCanvas');
    if(workspace){assert.deepEqual(data.tabs.map(tab=>tab.name),prior.tabs.map(tab=>tab.name));assert.deepEqual(data.tabs[1].items,prior.items);assert.equal(data.activeIndex,1);}
    else{assert.deepEqual(data.items,prior.items);assert.equal(data.tabs,undefined);}
    await page.bringToFront();await page.locator('#menuBtn').focus();
    const selecting=page.waitForEvent('filechooser',{timeout:10000});await page.keyboard.press(modifier+'+o');const chooser=await selecting;
    assert.equal(await run('pendingFileAction'),openAction,'the shortcut selects the appropriate import route');
    const uid='imported-'+modifier;
    const incoming=workspace?{app:'SimpleCanvasWorkspace',version:5,activeIndex:1,tabs:[
      {name:'Imported first '+modifier,items:[{...box,uid:uid+'-first'}]},
      {name:'Imported second '+modifier,items:[{...box,uid}]}
    ]}:{app:'SimpleCanvas',version:5,items:[{...box,uid}]};
    await chooser.setFiles({name:'shortcut.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});
    await page.waitForFunction(uid=>__test.run('items[0]?.uid')===uid,uid);
    assert.equal(await run('tabs.length'),2);
    if(workspace){
      assert.deepEqual(await run('tabs.map(tab=>tab.name)'),incoming.tabs.map(tab=>tab.name));
      assert.ok((await run('tabs.map(tab=>tab.id)')).every(id=>!prior.tabs.some(tab=>tab.id===id)));
    }else{
      assert.deepEqual(await run('tabs'),prior.tabs);assert.equal(await run('activeTabId'),prior.active);
      assert.deepEqual(await run('tabDocument(tabs[0].id).items'),prior.background,'hidden background drawings remain unchanged');
    }
  }
}));

test('HTML exports in each menu group use that group’s scope, including workspace-disabled deployments',async()=>app(async({page,run,context})=>{
  await seeded(run);
  const exported=async(actionName,afterStart)=>{
    const pending=page.waitForEvent('download',{timeout:10000});await action(page,actionName);if(afterStart)await afterStart();const download=await pending;
    const source=fs.readFileSync(await download.path(),'utf8'),reader=await context.newPage();await reader.setContent(source);
    const result={drawings:await reader.locator('svg rect[fill="#ffd166"]').count(),tabs:await reader.locator('.tab-select').allTextContents(),text:await reader.locator('svg').allTextContents()};
    await reader.close();return result;
  };
  const all=await exported('html');assert.equal(all.drawings,2);assert.deepEqual(all.tabs,['First drawing','Second drawing']);
  await run('window.previousPlacementQueue=shapePlacementQueue;shapePlacementQueue=new Promise(resolve=>window.releaseExportPlacement=resolve);void 0;');
  const current=await exported('htmlSketch',async()=>{
    await page.locator('.tab-select').nth(0).click();
    await run('window.releaseExportPlacement();shapePlacementQueue=window.previousPlacementQueue;void 0;');
  });
  assert.equal(await run('items[0].uid'),'box','the user switched tabs while the export was waiting');
  assert.equal(current.drawings,1);assert.deepEqual(current.tabs,[]);assert.match(current.text.join(' '),/Saved draft/,'current-sketch export retains its initiating tab');
  await page.locator('.tab-select').nth(1).click();
  await page.route('**/settings.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,features:{workspace:false}})}));
  await page.reload();await run('appStarted');
  const restricted=await exported('htmlSketch');assert.equal(restricted.drawings,1);assert.deepEqual(restricted.tabs,[]);assert.match(restricted.text.join(' '),/Saved draft/);
}));

test('N adds a sketch and Shift+N starts a workspace without repeats, typing, or modal keys creating unwanted sketches',async()=>app(async({page,run})=>{
  await page.locator('#menuBtn').click();
  const add=page.getByRole('menuitem',{name:'Add sketch',exact:true});
  assert.equal(await add.isVisible(),true);assert.equal(await add.locator('.sc').textContent(),'N');
  assert.equal(await add.getAttribute('aria-keyshortcuts'),'N');
  assert.equal(await page.locator('[data-act="newWorkspace"] .sc').textContent(),'Shift+N');
  assert.equal(await page.locator('[data-act="newWorkspace"]').getAttribute('aria-keyshortcuts'),'Shift+N');
  await page.keyboard.press('Escape');await page.locator('#menuBtn').focus();
  await page.keyboard.press('n');assert.equal(await run('tabs.length'),2);assert.equal(await run('tabs[1].name'),'Sketch 2');
  await page.keyboard.down('n');await page.keyboard.down('n');await page.keyboard.up('n');
  assert.equal(await run('tabs.length'),3,'holding N creates one additional sketch');
  await run(`applySketchToActiveTab([${JSON.stringify(text)}],{});openText(0);textInput.value='';`);
  await page.locator('#textInput').press('n');await page.locator('#textInput').press('Shift+N');
  assert.equal(await page.locator('#textInput').inputValue(),'nN');assert.equal(await run('tabs.length'),3);
  assert.equal(await page.locator('#newWorkspaceDialog').isHidden(),true);
  await page.locator('#textInput').press('Escape');
  await run('setTool("text")');await page.locator('#fontFamily').focus();
  await page.keyboard.press('n');await page.keyboard.press('Shift+N');assert.equal(await run('tabs.length'),3);
  assert.equal(await page.locator('#newWorkspaceDialog').isHidden(),true,'a focused select keeps its letter keys');
  await action(page,'print');await page.locator('#printDialog').waitFor({state:'visible'});
  await page.keyboard.press('n');await page.keyboard.press('Shift+N');assert.equal(await run('tabs.length'),3);
  assert.equal(await page.locator('#newWorkspaceDialog').isHidden(),true,'another modal cannot open the workspace confirmation');
  await page.keyboard.press('Escape');await page.locator('#printDialog').waitFor({state:'hidden'});
  await page.locator('#menuBtn').focus();await page.keyboard.press('Shift+N');
  const dialog=page.locator('#newWorkspaceDialog');await dialog.waitFor({state:'visible'});
  await page.keyboard.press('n');await page.keyboard.press('Shift+N');
  assert.equal(await run('tabs.length'),3);assert.equal(await page.locator('dialog[open]').count(),1,'modal keystrokes do not create another workspace action');
  await page.locator('#newWorkspaceCancel').click();assert.equal(await run('tabs.length'),3);
  await page.locator('#menuBtn').focus();await page.keyboard.press('Shift+N');await dialog.waitFor({state:'visible'});
  await page.locator('#newWorkspaceStart').click();await dialog.waitFor({state:'hidden'});await emptyWorkspace(run);
}));

test('creation shortcuts do nothing when workspace features are disabled',async()=>app(async({page,run})=>{
  const before=await snapshot(run);
  await page.locator('#menuBtn').focus();await page.keyboard.press('n');await page.keyboard.press('Shift+N');
  await page.keyboard.down('n');await page.keyboard.down('n');await page.keyboard.up('n');
  assert.equal(await snapshot(run),before);assert.equal(await page.locator('#newWorkspaceDialog').isHidden(),true);
},{features:{workspace:false}}));
