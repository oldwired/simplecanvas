const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});
const box={type:'rect',x:0,y:0,w:120,h:70,color:'#334155',size:2,fill:true,fillColor:'#eab308'};
const library=(name='Seed box')=>({app:'SimpleCanvasShapeLibrary',version:2,categories:['Drawing'],
  shapes:[{id:'personal-box',name,category:'Drawing',items:[box]}],workingCollection:['personal-box']});
const script=color=>`({children(state,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'${color}',strokeOn:false}];}})`;
const smartLibrary=()=>({app:'SimpleCanvasShapeLibrary',version:2,shapes:[{id:'personal-smart',name:'My smart shape',
  items:[{...box,type:'smart',script:script('#ff0000'),state:{kept:7}}]}],workingCollection:['personal-smart']});

async function app(fn,{seed=library(),local=false,features={},init}={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];
  const directory=local?fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-library-persistence-')):null;
  let seedRequests=0,seedHandler=null;
  try{
    await context.addInitScript(()=>{
      const NativeWorker=window.Worker;window.__workerStarts=0;
      window.Worker=class extends NativeWorker{constructor(...args){super(...args);window.__workerStarts++;}};
    });
    if(init)await context.addInitScript(init);
    context.on('page',page=>{page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());});
    await context.route('http://library-persistence.test/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      if(pathname.endsWith('/shapes-library.json')){
        seedRequests++;if(seedHandler)return seedHandler(route);
        return route.fulfill({status:seed?200:404,contentType:'application/json',body:seed?JSON.stringify(seed):''});
      }
      const settings=pathname.endsWith('/settings.json');
      return route.fulfill({status:settings||pathname.endsWith('/index.html')?200:404,
        contentType:settings?'application/json':'text/html',body:settings?JSON.stringify({version:1,features}):html});
    });
    const url=local?pathToFileURL(path.join(directory,'index.html')).href:'http://library-persistence.test/index.html';
    if(local)fs.writeFileSync(path.join(directory,'index.html'),html);
    const open=async(target=url)=>{
      const page=await context.newPage();await page.goto(target,{waitUntil:'domcontentloaded'});
      const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
      await run('appStarted');return {page,run};
    };
    const initial=await open();
    await fn({...initial,context,open,url,setSeed:value=>{seed=value;},setSeedHandler:handler=>{seedHandler=handler;},seedRequests:()=>seedRequests,setFeatures:value=>{features=value;}});
    assert.deepEqual(errors,[],'library restoration raises no uncaught errors');
  }finally{await context.close();if(directory)fs.rmSync(directory,{recursive:true,force:true});}
}
async function importLibrary(page,data){
  await page.locator('#shapeLibraryInput').setInputFiles({name:'my-library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await page.waitForFunction(()=>Boolean(__test.run('shapeLibrary')));
}
async function renameEntry(page,run,name){
  const action=run('renameLibraryShape(shapeLibrary.shapes[0])');
  await page.locator('#libraryDialog').waitFor({state:'visible'});
  await page.locator('#libraryNameInput').fill(name);await page.locator('#libraryDialogSubmit').click();await action;
}
async function snapshot(run){
  return run(`({library:clone(shapeLibrary),pinned:workingLibraryEntries().map(entry=>entry.id),
    canonicalPins:workingLibraryEntries().filter(entry=>entry.id.startsWith('builtin:')).map(entry=>builtInShapeEntries.has(entry)),
    validPreviews:shapeLibrary.shapes.map(entry=>!!validShapeThumbnail(entry))})`);
}
async function ready(page){await page.waitForFunction(()=>Boolean(__test.run('shapeLibrary')));}
async function saved(page){
  await page.waitForFunction(()=>__test.run('shapeLibraryStorageOwned && !shapeLibrarySavePending && !shapeLibraryStorageError'));
}
async function savedRecord(page){
  return page.evaluate(async()=>{
    const database=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('SimpleCanvasLibrary',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('libraries');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    try{return await new Promise((resolve,reject)=>{
      const request=database.transaction('libraries').objectStore('libraries').get(location.pathname);
      request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);
    });}finally{database.close();}
  });
}


test('hosted library edits, pins and category overrides survive reload and page closure ahead of the server seed',async()=>app(async({page,run,open,setSeed})=>{
  await ready(page);assert.equal(await run('shapeLibrary.shapes[0].name'),'Seed box');
  await renameEntry(page,run,'My retained box');
  await run(`createLibraryCategory('Lab');createLibraryCategory('Empty category');
    setLibraryEntryCategories(shapeLibrary.shapes[0],['Drawing','Lab']);
    pinLibraryEntry(shapeLibrary.shapes[0]);
    const gauge=builtInShapeLibrary.find(entry=>entry.name==='Gauge');
    setLibraryEntryCategories(gauge,['Lab']);pinLibraryEntry(gauge);
    Promise.all(shapeLibrary.shapes.map(ensureShapeThumbnail));`);
  await saved(page);const expected=await snapshot(run);assert.deepEqual(expected.pinned,['builtin:gauge:1']);
  assert.deepEqual(expected.canonicalPins,[true]);assert.ok(expected.library.categories.includes('Empty category'));
  const record=await savedRecord(page);
  assert.deepEqual(record.builtinIds,['builtin:gauge:1']);
  assert.deepEqual(record.library.shapes.map(entry=>entry.id),['personal-box'],'factory definitions persist as references, not copied scripts');
  assert.deepEqual(record.library.workingCollection,['builtin:gauge:1']);
  setSeed(library('Changed server seed'));
  await page.reload();await run('appStarted');assert.deepEqual(await snapshot(run),expected);
  assert.equal(await page.evaluate(()=>window.__workerStarts),0,'restoring canonical pinned entries uses inert previews');
  await page.close();const reopened=await open();
  assert.deepEqual(await snapshot(reopened.run),expected);
  await reopened.page.locator('#shapeLibBtn').click();
  assert.equal(await reopened.page.getByRole('button',{name:'Place Gauge',exact:true}).count(),1);
  assert.equal(await reopened.page.evaluate(()=>window.__workerStarts),0);
}));

test('a local HTML file restores an imported library and its working collection after reload and closing the page',async()=>app(async({page,run,open,seedRequests})=>{
  assert.equal(await run('shapeLibrary'),null);assert.equal(seedRequests(),0);
  await importLibrary(page,library('Local box'));await renameEntry(page,run,'Retained local box');
  await run(`setLibraryEntryCategories(shapeLibrary.shapes[0],['Local']);
    const clock=builtInShapeLibrary.find(entry=>entry.name==='Clock');pinLibraryEntry(clock);
    Promise.all(shapeLibrary.shapes.map(ensureShapeThumbnail));`);
  await saved(page);const expected=await snapshot(run);await page.reload();await run('appStarted');
  assert.deepEqual(await snapshot(run),expected);assert.equal(await page.evaluate(()=>window.__workerStarts),0);
  await page.close();const reopened=await open();assert.deepEqual(await snapshot(reopened.run),expected);
  assert.equal(seedRequests(),0);
},{local:true}));

test('edited smart source and its regenerated preview restore without executing scripts',async()=>app(async({page,run,open})=>{
  await importLibrary(page,smartLibrary());
  await page.locator('#libraryDialog').waitFor({state:'visible'});
  await page.locator('#libraryDialogSubmit').click();
  await page.waitForFunction(()=>__test.run('!!validShapeThumbnail(shapeLibrary.shapes[0])'));
  const previous=await run('shapeLibrary.shapes[0].thumbnail');
  const edit=run('editLibrarySmartSource(shapeLibrary.shapes[0],shapeLibrary.shapes[0].items[0])');
  await page.locator('#smartObjectDialog').waitFor({state:'visible'});
  await page.locator('#smartObjectScriptInput').fill(script('#0000ff'));await page.locator('#smartObjectDialogSubmit').click();await edit;
  await page.waitForFunction(source=>__test.run('validShapeThumbnail(shapeLibrary.shapes[0])?.source')!==source &&
    __test.run('!!validShapeThumbnail(shapeLibrary.shapes[0])'),previous.source);
  await saved(page);const expected=await snapshot(run);assert.notEqual(expected.library.shapes[0].thumbnail.png,previous.png);
  assert.equal(expected.library.shapes[0].items[0].script,script('#0000ff'));
  await page.reload();await run('appStarted');assert.deepEqual(await snapshot(run),expected);
  assert.equal(await page.evaluate(()=>window.__workerStarts),0);
  await page.locator('#shapeLibBtn').click();
  await page.waitForFunction(()=>{const image=document.querySelector('#shapeGrid img');return image?.complete&&image.naturalWidth===128;});
  assert.equal(await page.locator('#libraryDialog[open]').count(),0);assert.equal(await page.evaluate(()=>window.__workerStarts),0);
  await page.close();const reopened=await open();assert.deepEqual(await snapshot(reopened.run),expected);
  assert.equal(await reopened.page.evaluate(()=>window.__workerStarts),0);
},{seed:null}));

test('restoring a smart entry with no preview keeps its script inert and asks before generating one',async()=>app(async({page,run})=>{
  await importLibrary(page,smartLibrary());await page.locator('#libraryDialog').waitFor({state:'visible'});
  await page.locator('#libraryDialogCancel').click();assert.equal(await page.evaluate(()=>window.__workerStarts),0);
  await saved(page);await page.reload();await run('appStarted');assert.equal(await run('shapeLibrary.shapes[0].items[0].script'),script('#ff0000'));
  assert.equal(await page.evaluate(()=>window.__workerStarts),0);assert.equal(await page.locator('#libraryDialog[open]').count(),0);
  await page.locator('#shapeLibBtn').click();await page.locator('#libraryDialog').waitFor({state:'visible'});
  assert.match(await page.locator('#libraryDialog').textContent(),/Generating missing previews runs scripts/);
  await page.locator('#libraryDialogCancel').click();assert.equal(await page.evaluate(()=>window.__workerStarts),0);
},{seed:null}));

test('a delayed startup library cannot overwrite a working-collection edit or its saved copy',async()=>app(async({page,run,open,setSeedHandler})=>{
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;}),request=new Promise(resolve=>{started=resolve;});
  setSeedHandler(async route=>{started();await gate;await route.fulfill({contentType:'application/json',body:JSON.stringify(library('Late seed'))});});
  await page.reload({waitUntil:'domcontentloaded'});await request;await run('appStarted');
  await run(`const entry=builtInShapeLibrary.find(entry=>entry.name==='Gauge');pinLibraryEntry(entry);`);
  await saved(page);const expected=await snapshot(run);release();await page.waitForLoadState('networkidle');
  assert.deepEqual(await snapshot(run),expected);await page.close();
  const reopened=await open();assert.deepEqual(await snapshot(reopened.run),expected);
},{seed:null}));

test('viewing a pristine hosted seed does not prevent later seed updates',async()=>app(async({page,run,setSeed})=>{
  await ready(page);await run('Promise.all(shapeLibrary.shapes.map(ensureShapeThumbnail))');
  assert.equal(await savedRecord(page),null,'viewing or generating an ordinary seed preview does not claim personal storage');
  setSeed(library('Updated seed'));await page.reload();await run('appStarted');await ready(page);
  assert.equal(await run('shapeLibrary.shapes[0].name'),'Updated seed');
  assert.equal(await savedRecord(page),null);
}));

test('fixed-library mode uses the hosted seed without deleting the personal library',async()=>app(async({page,run,setFeatures})=>{
  await ready(page);await renameEntry(page,run,'My saved box');await saved(page);
  const record=await savedRecord(page);
  setFeatures({shapeLibraryManagement:false});await page.reload();await run('appStarted');await ready(page);
  assert.equal(await run('shapeLibrary.shapes[0].name'),'Seed box');assert.deepEqual(await savedRecord(page),record);
  setFeatures({});await page.reload();await run('appStarted');
  assert.equal(await run('shapeLibrary.shapes[0].name'),'My saved box');
}));

test('a failed browser save retains the previous snapshot, offers an export, and retries the latest edits',async()=>app(async({page,run,open})=>{
  await ready(page);await renameEntry(page,run,'Last saved box');
  await run('Promise.all(shapeLibrary.shapes.map(ensureShapeThumbnail))');await saved(page);
  const previous=await savedRecord(page);
  await page.evaluate(()=>{
    const put=IDBObjectStore.prototype.put;window.__blockLibraryWrites=true;
    IDBObjectStore.prototype.put=function(...args){
      if(this.name==='libraries' && window.__blockLibraryWrites)throw new DOMException('Test quota exceeded','QuotaExceededError');
      return put.apply(this,args);
    };
  });
  await renameEntry(page,run,'Latest recoverable box');
  const warning=page.locator('#libraryStorageWarning');await warning.waitFor({state:'visible'});
  assert.match(await page.locator('#shapeLibraryStatus').textContent(),/Not saved in this browser/);
  assert.equal(await run('shapeLibrary.shapes[0].name'),'Latest recoverable box');
  assert.deepEqual(await savedRecord(page),previous,'a failed write cannot erase the last durable copy');
  assert.equal(await run(`(()=>{const event=new Event('beforeunload',{cancelable:true});warnUnexportedLibrary(event);return event.defaultPrevented;})()`),true);
  const download=page.waitForEvent('download');await warning.getByRole('button',{name:/Export library/}).click();
  const exported=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.equal(exported.shapes[0].name,'Latest recoverable box');
  await run('shapeLibrarySaveJob'); // Export also saves its bookkeeping; let that blocked write finish.
  assert.equal(await warning.isVisible(),true,'export is a recovery copy, not a successful browser save');
  await page.evaluate(()=>{window.__blockLibraryWrites=false;});
  await warning.getByRole('button',{name:'Retry',exact:true}).click();await saved(page);
  assert.equal(await warning.isHidden(),true);assert.match(await page.locator('#shapeLibraryStatus').textContent(),/Saved in this browser/);
  assert.equal((await savedRecord(page)).library.shapes[0].name,'Latest recoverable box');
  assert.equal(await run(`(()=>{const event=new Event('beforeunload',{cancelable:true});warnUnexportedLibrary(event);return event.defaultPrevented;})()`),false);
  await page.close();const reopened=await open();assert.equal(await reopened.run('shapeLibrary.shapes[0].name'),'Latest recoverable box');
}));

test('retrying a startup storage read restores the saved library instead of saving the temporary seed over it',async()=>app(async({page,run})=>{
  await ready(page);await renameEntry(page,run,'Personal before read failure');await saved(page);
  const previous=await savedRecord(page);
  await page.addInitScript(()=>{
    const get=IDBObjectStore.prototype.get;window.__blockLibraryReads=true;
    IDBObjectStore.prototype.get=function(...args){
      if(this.name==='libraries' && window.__blockLibraryReads)throw new DOMException('Test storage read unavailable','UnknownError');
      return get.apply(this,args);
    };
  });
  await page.reload();await run('appStarted');await ready(page);
  const warning=page.locator('#libraryStorageWarning');await warning.waitFor({state:'visible'});
  assert.equal(await run('shapeLibrary.shapes[0].name'),'Seed box');
  await run('armShapeForPlacement(shapeLibrary.shapes[0])');
  assert.equal(await run('ui.tool'),'shape');
  await page.evaluate(()=>{window.__blockLibraryReads=false;});
  assert.deepEqual(await savedRecord(page),previous);
  await warning.getByRole('button',{name:'Retry',exact:true}).click();
  await page.waitForFunction(()=>__test.run('shapeLibrary.shapes[0].name')==='Personal before read failure');
  assert.equal(await warning.isHidden(),true);assert.deepEqual(await savedRecord(page),previous);
  assert.deepEqual(await run('({pending:ui.pendingShape,tool:ui.tool})'),{pending:null,tool:'select'});
  const canvas=await page.locator('#canvas').boundingBox();await page.mouse.click(canvas.x+200,canvas.y+200);
  assert.equal(await run('items.length'),0,'retry restoration cannot place the previously armed seed entry');
}));


test('personal libraries are shared across query/hash changes but isolated between app paths',async()=>app(async({page,run,open,url})=>{
  await ready(page);await renameEntry(page,run,'This deployment only');await saved(page);
  const same=await open(url+'?version=next#drawing');
  assert.equal(await same.run('shapeLibrary.shapes[0].name'),'This deployment only');
  const other=await open(url.replace('/index.html','/another/index.html'));await ready(other.page);
  assert.equal(await other.run('shapeLibrary.shapes[0].name'),'Seed box');
  assert.equal(await savedRecord(other.page),null);
  assert.equal((await savedRecord(same.page)).library.shapes[0].name,'This deployment only');
}));

test('disabling the library skips personal storage and seed loading without deleting saved entries',async()=>app(async({page,run,setFeatures,seedRequests})=>{
  await ready(page);await renameEntry(page,run,'Keep while disabled');await saved(page);
  await page.addInitScript(()=>{
    const open=IDBFactory.prototype.open;window.__libraryDatabaseOpens=0;
    IDBFactory.prototype.open=function(...args){if(args[0]==='SimpleCanvasLibrary')window.__libraryDatabaseOpens++;return open.apply(this,args);};
  });
  const requests=seedRequests();setFeatures({shapeLibrary:false});await page.reload();await run('appStarted');
  assert.equal(await run('shapeLibrary'),null);assert.equal(await page.evaluate(()=>window.__libraryDatabaseOpens),0);
  assert.equal(seedRequests(),requests);assert.equal(await page.locator('#shapeLibBtn').isVisible(),false);
  setFeatures({});await page.reload();await run('appStarted');
  assert.equal(await run('shapeLibrary.shapes[0].name'),'Keep while disabled');
}));

test('an explicitly empty personal library takes precedence over a hosted seed',async()=>app(async({page,run,setSeed,seedRequests})=>{
  await ready(page);
  await importLibrary(page,{app:'SimpleCanvasShapeLibrary',version:2,shapes:[],workingCollection:[]});
  await page.waitForFunction(()=>__test.run('shapeLibrary?.shapes.length')===0);await saved(page);
  assert.deepEqual((await savedRecord(page)).library.shapes,[]);
  const requests=seedRequests();setSeed(library('New hosted entry'));await page.reload();await run('appStarted');
  assert.deepEqual(await run('shapeLibrary.shapes'),[]);assert.deepEqual(await run('workingLibraryEntries()'),[]);
  assert.equal(seedRequests(),requests,'a valid empty personal library also skips the hosted seed');
}));

test('a stale open page keeps its draft but cannot overwrite a newer library saved by another page',async()=>app(async({page,run,open})=>{
  await ready(page);await renameEntry(page,run,'Shared starting point');
  await run('Promise.all(shapeLibrary.shapes.map(ensureShapeThumbnail))');await saved(page);
  const stale=await open();assert.equal(await stale.run('shapeLibrary.shapes[0].name'),'Shared starting point');
  await renameEntry(page,run,'Newer saved library');await saved(page);
  const newer=await savedRecord(page);
  await renameEntry(stale.page,stale.run,'My stale-page draft');
  const warning=stale.page.locator('#libraryStorageWarning');await warning.waitFor({state:'visible'});
  assert.match(await warning.textContent(),/changed in another tab/);
  assert.equal(await stale.run('shapeLibrary.shapes[0].name'),'My stale-page draft');
  assert.deepEqual(await savedRecord(stale.page),newer);
  await warning.getByRole('button',{name:'Retry',exact:true}).click();await stale.run('shapeLibrarySaveJob');
  assert.equal(await warning.isVisible(),true);assert.deepEqual(await savedRecord(stale.page),newer);
  const download=stale.page.waitForEvent('download');await warning.getByRole('button',{name:/Export library/}).click();
  const exported=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));await stale.run('shapeLibrarySaveJob');
  assert.equal(exported.shapes[0].name,'My stale-page draft');assert.deepEqual(await savedRecord(stale.page),newer);
  await stale.page.reload();await stale.run('appStarted');
  assert.equal(await stale.run('shapeLibrary.shapes[0].name'),'Newer saved library');assert.equal(await warning.isHidden(),true);
}));
