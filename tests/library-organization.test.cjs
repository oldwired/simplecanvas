const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');

// Only the served editor exposes its closure. Library actions, dialogs, downloads,
// imports, category filters, and responsive layout use the production UI.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{if(browser)await browser.close();});

async function app(fn,{features={},files={}}={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    const contents={'settings.json':JSON.stringify({version:1,features}),...files};
    await page.route('http://library-organization.test/**',route=>{
      const file=contents[route.request().url().slice('http://library-organization.test/'.length)];
      return route.fulfill({status:file!==undefined||route.request().url().endsWith('index.html')?200:404,
        contentType:file!==undefined?'application/json':'text/html',body:file??html});
    });
    await page.goto('http://library-organization.test/index.html');
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
async function actions(page){
  await browse(page);
  if(await page.locator('#shapePickerManage').isHidden())await page.locator('#libraryActionsBtn').click();
  await page.locator('#shapePickerManage').waitFor({state:'visible'});
}
async function categories(page){
  await actions(page);await page.locator('#manageCategoriesBtn').click();
  await page.locator('#libraryCategoriesDialog').waitFor({state:'visible'});
}
function rowFor(page,name){return page.locator('#libraryCategoryList [data-category='+JSON.stringify(name)+']');}
async function addCategory(page,name){
  await page.locator('#newLibraryCategory').fill(name);
  await page.locator('#libraryCategoryCreate').getByRole('button',{name:'Add category',exact:true}).click();
  await rowFor(page,name).waitFor();
}
async function closeCategories(page){
  await page.locator('#libraryCategoriesDialog').press('Escape');
  await page.locator('#libraryCategoriesDialog').waitFor({state:'hidden'});
}
async function renameCategory(page,from,to){
  await rowFor(page,from).getByRole('button',{name:'Rename '+from,exact:true}).click();
  await page.locator('#libraryDialog').waitFor({state:'visible'});
  await page.locator('#libraryNameInput').fill(to);await page.locator('#libraryDialogSubmit').click();
  await page.locator('#libraryDialog').waitFor({state:'hidden'});await rowFor(page,to).waitFor();
}
async function removeCategory(page,name){
  await rowFor(page,name).getByRole('button',{name:'Remove '+name,exact:true}).click();
  await page.locator('#libraryDialog').waitFor({state:'visible'});
  await page.locator('#libraryDialogSubmit').click();await page.locator('#libraryDialog').waitFor({state:'hidden'});
  await rowFor(page,name).waitFor({state:'detached'});
}
async function filterCategory(page,name){
  if(await page.locator('#libraryCategory').isVisible())await page.locator('#libraryCategory').selectOption(name);
  else await page.locator('#libraryCategories').getByRole('button',{name:name||'All',exact:true}).click();
}
async function assignCategories(page,name,names){
  await page.locator('#librarySearch').fill(name);await filterCategory(page,'');await details(page,name);
  await page.locator('#libraryCategoriesEditBtn').click();
  const dialog=page.locator('#libraryMembershipDialog');await dialog.waitFor({state:'visible'});
  assert.equal(await dialog.getByRole('checkbox',{name:'Uncategorized',exact:true}).count(),0,'Uncategorized is derived from an empty membership set');
  for(const checkbox of await dialog.getByRole('checkbox').all())await checkbox.uncheck();
  for(const category of names)await dialog.getByRole('checkbox',{name:category,exact:true}).check();
  await page.locator('#libraryMembershipSave').click();await dialog.waitFor({state:'hidden'});
}
async function exportLibrary(page){
  await actions(page);const download=page.waitForEvent('download');await page.locator('#exportLibraryBtn').click();
  const data=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  // Preserve the completed export bookkeeping when the roundtrip test reloads next.
  await page.waitForFunction(()=>__test.run('!shapeLibraryDirty && !shapeLibrarySavePending && !shapeLibraryStorageError'));
  return data;
}
async function importLibrary(page,data){
  await page.evaluate(()=>__test.run('appReady'));
  await page.locator('#shapeLibraryInput').setInputFiles({name:'library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
}
const personalLibrary={app:'SimpleCanvasShapeLibrary',version:2,workingCollection:['my-box','my-arrow'],shapes:[
  {id:'my-box',name:'My box',category:'Drawing',items:[{type:'rect',x:0,y:0,w:120,h:60,color:'#000000',fill:true,fillColor:'#eab308',size:2}]},
  {id:'my-arrow',name:'My arrow',category:'Drawing',items:[{type:'line',x1:0,y1:0,x2:100,y2:50,color:'#000000',size:2}]}
]};

test('library labels and actions keep their scope across collapsed, expanded, and narrow layouts, and filtering hides stale details',async()=>app(async({page,run})=>{
  await run(`items=[{type:'rect',uid:'drawing-a',x:100,y:100,w:120,h:60,color:'#000000',size:2}];save();newTab();
    items=[{type:'ellipse',uid:'drawing-b',x:100,y:100,w:80,h:80,color:'#000000',size:2}];save();`);
  const workspace=await run('JSON.stringify({tabs,activeTabId,items})');
  await page.locator('#shapeLibBtn').click();
  assert.equal(await page.locator('#shapePickerLabel').textContent(),'Working collection');
  assert.equal(await page.locator('#manageShapesBtn').getAttribute('aria-label'),'Library actions');
  await page.locator('#manageShapesBtn').click();assert.equal(await page.locator('#shapePickerManage').isVisible(),true);
  await page.locator('#manageShapesBtn').click();
  await browse(page);
  assert.equal(await page.locator('#shapePickerLabel').textContent(),'Working collection');
  assert.equal(await page.locator('#libraryCollection').getAttribute('aria-label'),'Source');
  assert.deepEqual(await page.locator('#libraryCollection option').allTextContents(),['All sources','Built-in','My shapes']);
  assert.equal(await page.locator('#closeLibraryBrowserBtn').textContent(),'Collapse library');
  await actions(page);
  assert.equal(await page.locator('#libraryActionsBtn').getAttribute('aria-label'),'Close library actions');
  assert.equal(await page.locator('#libraryBrowser #shapePickerManage').count(),1,'expanded browser owns the single shared actions panel');
  assert.equal(await page.locator('#shapePickerManage').count(),1);
  assert.equal(await page.locator('#importLibraryBtn').isVisible(),true);
  assert.equal(await page.locator('#exportLibraryBtn').isVisible(),true);
  assert.equal(await page.locator('#manageCategoriesBtn').isVisible(),true);
  await page.locator('#closeLibraryBrowserBtn').click();
  assert.equal(await page.locator('#libraryBrowser').isHidden(),true);
  assert.equal(await page.locator('#shapeWorkingCollection #shapePickerManage').count(),1);
  assert.equal(await page.locator('#shapePickerLabel').textContent(),'Working collection');
  await page.setViewportSize({width:390,height:844});await browse(page);
  assert.equal(await page.locator('#libraryActionsBtn').isVisible(),true);
  assert.equal(await page.locator('#shapePickerManage').isVisible(),true);
  const panel=await page.locator('#shapePickerManage').boundingBox();
  assert.ok(panel.x>=0 && panel.x+panel.width<=390.5,'library actions stay inside a narrow viewport');
  await page.locator('#libraryActionsBtn').click();assert.equal(await page.locator('#shapePickerManage').isHidden(),true);
  await page.locator('#librarySearch').fill('Gauge');await details(page,'Gauge');
  await page.locator('#libraryActionsBtn').click();assert.equal(await page.locator('#manageCategoriesBtn').isVisible(),true);
  assert.equal(await page.locator('#libraryBrowserDetails').isHidden(),true,'Actions hides selected details to reserve vertical room on a narrow screen');
  const body=await page.locator('#libraryBrowser .library-browser-body').boundingBox();
  const count=await page.locator('#libraryResultCount').boundingBox();
  const actionsPanel=await page.locator('#shapePickerManage').boundingBox();
  assert.ok(body.height>0 && count.height>0,'the results body retains usable height while actions are open');
  assert.ok(body.y>=actionsPanel.y+actionsPanel.height-.5,'results begin below the actions panel');
  assert.ok(count.y>=body.y-.5 && count.y+count.height<=body.y+body.height+.5,'the result count fits entirely inside the remaining results body');
  await details(page,'Gauge');
  assert.equal(await page.locator('#shapePickerManage').isHidden(),true,'opening a card’s details exits Actions');
  assert.equal(await page.locator('#libraryBrowserDetails').isVisible(),true);
  await page.locator('#librarySearch').fill('no-matching-entry');
  assert.equal(await page.locator('#libraryBrowserDetails').isHidden(),true,'no actions target a result hidden by search');
  await page.locator('#librarySearch').fill('Gauge');await details(page,'Gauge');
  await page.locator('#libraryCollection').selectOption('mine');
  assert.equal(await page.locator('#libraryBrowserDetails').isHidden(),true,'changing Source also removes details for an invisible result');
  assert.equal(await run('JSON.stringify({tabs,activeTabId,items})'),workspace,'library navigation and management do not replace or change workspace drawings');
}));

test('category creation, rename, and removal preserve personal entries and pins, including empty categories through export and import',async()=>app(async({page,run})=>{
  await importLibrary(page,personalLibrary);await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes.length')===2);
  await categories(page);await addCategory(page,'Routing');await addCategory(page,'Signals');await addCategory(page,'Unused');
  await renameCategory(page,'Unused','Spare');assert.equal(await rowFor(page,'Unused').count(),0);
  await closeCategories(page);await page.locator('#libraryCollection').selectOption('mine');
  await assignCategories(page,'My box',['Routing','Signals']);await assignCategories(page,'My arrow',['Routing']);
  await page.locator('#librarySearch').fill('');await filterCategory(page,'Routing');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),2);
  await filterCategory(page,'Signals');assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1);
  await categories(page);await removeCategory(page,'Routing');await closeCategories(page);
  assert.deepEqual(await run('shapeLibrary.shapes.map(entry=>entry.id)'),['my-box','my-arrow']);
  assert.deepEqual(await run('shapeLibrary.workingCollection'),['my-box','my-arrow'],'category removal does not unpin or delete definitions');
  await filterCategory(page,'');await page.locator('#librarySearch').fill('My box');await details(page,'My box');
  assert.match(await page.locator('#libraryDetailCategories').textContent(),/Signals/);
  assert.doesNotMatch(await page.locator('#libraryDetailCategories').textContent(),/Routing/);
  await page.locator('#librarySearch').fill('My arrow');await details(page,'My arrow');
  assert.equal((await page.locator('#libraryDetailCategories').textContent()).trim(),'Uncategorized','removing the only category leaves the shape usable and uncategorized');
  const exported=await exportLibrary(page);
  assert.ok(exported.categories.includes('Spare'),'a newly created empty category is explicitly saved');
  assert.ok(!exported.categories.includes('Unused') && !exported.categories.includes('Routing'));
  assert.deepEqual(exported.shapes.find(entry=>entry.id==='my-box').categoryTags,['Signals']);
  assert.deepEqual(exported.shapes.find(entry=>entry.id==='my-arrow').categoryTags,[]);
  await page.reload();await run('appStarted');await importLibrary(page,exported);
  await page.waitForFunction(()=>__test.run('shapeLibrary?.categories?.includes("Spare")'));
  await categories(page);assert.equal(await rowFor(page,'Spare').count(),1);await closeCategories(page);
  await page.locator('#libraryCollection').selectOption('mine');await page.locator('#librarySearch').fill('');await filterCategory(page,'Signals');
  assert.equal(await page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place My box',exact:true}).count(),1);
  await filterCategory(page,'Uncategorized');
  assert.equal(await page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place My arrow',exact:true}).count(),1);
  assert.equal(await page.locator('#shapeGrid .shape-thumb').count(),2);
}));

test('built-ins can belong to several categories without becoming personal copies, losing pins, or executing their scripts',async()=>app(async({page,run})=>{
  const original=await run(`(()=>{const entry=builtInShapeLibrary.find(entry=>entry.name==='Gauge');return {id:entry.id,items:JSON.stringify(entry.items)};})()`);
  await categories(page);await addCategory(page,'Lab');await addCategory(page,'Monitoring');await closeCategories(page);
  await page.locator('#libraryCollection').selectOption('builtin');await page.locator('#librarySearch').fill('Gauge');await details(page,'Gauge');
  await page.locator('#libraryCategoriesEditBtn').click();
  const membership=page.locator('#libraryMembershipDialog');
  assert.equal(await membership.getByRole('checkbox',{name:'Displays',exact:true}).isChecked(),true,'installed category is selected initially');
  await membership.getByRole('checkbox',{name:'Lab',exact:true}).check();
  await page.locator('#libraryMembershipNew').click();await page.locator('#libraryDialog').waitFor({state:'visible'});
  await page.locator('#libraryNameInput').fill('Calibration');await page.locator('#libraryDialogSubmit').click();
  await page.locator('#libraryDialog').waitFor({state:'hidden'});
  for(const category of ['Displays','Lab','Calibration'])assert.equal(await membership.getByRole('checkbox',{name:category,exact:true}).isChecked(),true,
    'creating a category selects it and preserves the existing '+category+' choice');
  await page.locator('#libraryMembershipSave').click();await membership.waitFor({state:'hidden'});
  assert.match(await page.locator('#libraryDetailCategories').textContent(),/Calibration/,'a category can be created and assigned directly from shape details');
  await page.getByRole('button',{name:'Pin Gauge to working collection',exact:true}).click();
  await assignCategories(page,'Gauge',['Displays','Lab','Monitoring']);
  for(const category of ['Lab','Monitoring']){
    await filterCategory(page,category);
    assert.equal(await page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place Gauge',exact:true}).count(),1);
  }
  await assignCategories(page,'Gauge',['Displays','Monitoring']);
  assert.equal(await page.getByRole('button',{name:'Unpin Gauge from working collection',exact:true}).getAttribute('aria-pressed'),'true');
  assert.deepEqual(await run('shapeLibrary.workingCollection'),[original.id]);
  await filterCategory(page,'Lab');assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),0,'removing one membership clears only that category');
  await filterCategory(page,'Monitoring');assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1);
  await filterCategory(page,'');await page.locator('#libraryCollection').selectOption('mine');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),0,'organizing a built-in does not create a personal definition');
  assert.equal(await page.locator('iframe[sandbox~="allow-scripts"]').count(),0,'organizing a cached built-in never executes its source');
  assert.equal(await run(`JSON.stringify(builtInShapeLibrary.find(entry=>entry.id===${JSON.stringify(original.id)}).items)`),original.items);
  const exported=await exportLibrary(page);
  assert.deepEqual(exported.workingCollection,[original.id]);
  assert.deepEqual(exported.builtinCategoryTags[original.id],['Displays','Monitoring']);
  assert.ok(exported.categories.includes('Calibration'),'a category created while assigning memberships stays in the registry when later unused');
  assert.equal(exported.shapes.filter(entry=>entry.id===original.id).length,1);
  await page.reload();await run('appStarted');await importLibrary(page,exported);
  await page.waitForFunction(id=>__test.run('shapeLibrary?.workingCollection?.[0]')===id,original.id);
  await browse(page);await page.locator('#libraryCollection').selectOption('builtin');await filterCategory(page,'Monitoring');await page.locator('#librarySearch').fill('Gauge');
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1);
  assert.equal(await page.getByRole('button',{name:'Unpin Gauge from working collection',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await run(`JSON.stringify(builtInShapeLibrary.find(entry=>entry.id===${JSON.stringify(original.id)}).items)`),original.items);
  assert.equal(await page.locator('#libraryDialog[open]').count(),0,'the stored preview and built-in identity survive without new script consent');
}));

test('bundled category memberships are discoverable, copyable defaults while imported personal memberships take precedence',async()=>app(async({page,run})=>{
  const defaults={Gauge:['Displays','Numbers'],'Text input':['Controls','Text'],Spreadsheet:['Data','Controls','Numbers']};
  await browse(page);await page.locator('#libraryCollection').selectOption('builtin');
  for(const [name,memberships] of Object.entries(defaults)){
    assert.deepEqual(await run(`effectiveLibraryCategories(builtInShapeLibrary.find(entry=>entry.name===${JSON.stringify(name)}))`),memberships);
    await page.locator('#librarySearch').fill(name);
    for(const category of memberships){
      await filterCategory(page,category);
      assert.equal(await page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place '+name,exact:true}).count(),1,
        name+' is found in its bundled '+category+' category');
    }
  }
  const imported=await run(`(()=>{
    const entry=builtInShapeLibrary.find(entry=>entry.name==='Gauge');
    const load=(categoryTags,overrides)=>normalizeShapeLibrary({version:2,shapes:[{...clone(entry),categoryTags}],
      ...(overrides===undefined?{}:{builtinCategoryTags:{[entry.id]:overrides}})});
    const unchanged=load(entry.categoryTags),uncategorized=load([]),custom=load(['Lab','Displays']),explicitEmpty=load(entry.categoryTags,[]);
    return {unchanged:unchanged.builtinCategoryTags,
      canonical:[unchanged,uncategorized,custom,explicitEmpty].every(lib=>builtInShapeEntries.has(lib.shapes[0])),
      uncategorized:libraryEntryCategories(uncategorized.shapes[0],uncategorized),
      custom:libraryEntryCategories(custom.shapes[0],custom),
      explicitEmpty:libraryEntryCategories(explicitEmpty.shapes[0],explicitEmpty)};
  })()`);
  assert.deepEqual(imported,{unchanged:{},canonical:true,uncategorized:[],custom:['Lab','Displays'],explicitEmpty:[]},
    'canonical snapshots retain defaults, imported changes stay personal, and an explicit empty override wins');
  await run(`copyLibraryEntry(builtInShapeLibrary.find(entry=>entry.name==='Gauge'))`);
  assert.deepEqual(await run('librarySelectedEntry.categoryTags'),defaults.Gauge,'a personal copy starts with all effective memberships');
  assert.equal(await run('builtInShapeEntries.has(librarySelectedEntry)'),false);
}));

test('fixed libraries retain source and category browsing while hiding organization actions',async()=>app(async({page})=>{
  await page.locator('#shapeLibBtn').click();assert.equal(await page.locator('#manageShapesBtn').isVisible(),false);
  await browse(page);assert.equal(await page.locator('#libraryActionsBtn').isVisible(),false);
  assert.equal(await page.locator('#manageCategoriesBtn').isVisible(),false);
  await page.locator('#libraryCollection').selectOption('builtin');await filterCategory(page,'Displays');
  await page.locator('#librarySearch').fill('Gauge');await details(page,'Gauge');
  assert.equal(await page.locator('#libraryCategoriesEditBtn').isVisible(),false);
  assert.equal(await page.locator('#libraryPlaceBtn').isEnabled(),true);
  assert.equal(await page.locator('#libraryBrowserGrid .shape-thumb').count(),1);
},{features:{shapeLibraryManagement:false}}));
