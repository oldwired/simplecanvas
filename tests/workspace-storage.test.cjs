const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{await browser?.close();});
const box={type:'rect',uid:'box',x:80,y:90,w:150,h:100,color:'#1f2937',size:2,fill:true,fillColor:'#ffd166'};
async function app(fn,{init}={}){
  const context=await browser.newContext({viewport:{width:1280,height:900}}),errors=[];
  try{
    if(init)await context.addInitScript(init);
    await context.route('http://localhost:4173/**',route=>route.fulfill({status:route.request().url().includes('.html')?200:404,contentType:'text/html',body:route.request().url().includes('.html')?html:''}));
    const open=async(file='index.html')=>{
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
      await page.goto('http://localhost:4173/'+file);
      const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
      await run('appStarted');return {page,run};
    };
    await fn({...(await open()),open,context,errors});assert.deepEqual(errors,[],'no uncaught application errors');
  }finally{await context.close();}
}
const seed=async(run,x=80)=>run(`applySketchToActiveTab([{...${JSON.stringify(box)},x:${x}}],{});persistWorkspace()`);
const owner=run=>run('({owned:workspaceStorage.owned,writable:workspaceStorage.writable,protected:workspaceStorage.protected,error:workspaceStorage.error})');
const saved=run=>run('readSavedWorkspace()');
const waitReadOnly=page=>page.waitForFunction(()=>__test.run('workspaceStorage.ready && !workspaceStorage.writable'));

test('workspace snapshots use IndexedDB when localStorage writes are disabled and survive reload',async()=>app(async({page,run})=>{
  assert.equal((await owner(run)).owned,true);assert.equal(await seed(run),true);
  const initial=await saved(run);assert.equal(initial.workspace.tabs[0].document.items[0].x,80);
  assert.equal(await page.evaluate(()=>localStorage.getItem('simplecanvas:tabs:v1')),null);
  await run('newTab();persistWorkspace()');assert.equal((await saved(run)).workspace.tabs.length,2);
  await page.reload();assert.equal(await run('tabs.length'),2);await run('activateTab(tabs[0].id)');assert.equal(await run('items[0].uid'),'box');
},{init:()=>{Storage.prototype.setItem=function(){throw new DOMException('disabled','QuotaExceededError');};}}));

test('a workspace larger than localStorage quota remains durable with its image data',async()=>app(async({page,run})=>{
  const size=await run(`(async()=>{
    const image=document.createElement('canvas');image.width=image.height=1600;
    const ctx=image.getContext('2d'),pixels=ctx.createImageData(1600,1600);crypto.getRandomValues(pixels.data.subarray(0,65536));
    for(let offset=65536;offset<pixels.data.length;offset+=65536)crypto.getRandomValues(pixels.data.subarray(offset,Math.min(offset+65536,pixels.data.length)));
    ctx.putImageData(pixels,0,0);const src=image.toDataURL('image/png');
    applySketchToActiveTab([{type:'image',uid:'photo',id:'photo',x:0,y:0,w:400,h:400,rotation:0}],{photo:src});await persistWorkspace();return src.length;
  })()`);
  assert.ok(size>5*1024*1024);assert.equal((await owner(run)).error,'');
  await page.reload();assert.equal(await run('assets.photo.length'),size);assert.equal(await run('items[0].uid'),'photo');
}));

test('rapid edits during a pending snapshot are flushed before persistWorkspace resolves',async()=>app(async({run})=>{
  await seed(run);
  const result=await run(`(async()=>{
    const original=IDBObjectStore.prototype.put;let changed=false;
    IDBObjectStore.prototype.put=function(value,key){
      const request=original.call(this,value,key);
      if(this.name==='workspaces'&&!changed){changed=true;queueMicrotask(()=>{items[0].x=170;save();});}
      return request;
    };
    items[0].x=120;try{await save();return {live:items[0].x,stored:(await readSavedWorkspace()).workspace.tabs[0].document.items[0].x,dirty:unsavedTabs.size};}
    finally{IDBObjectStore.prototype.put=original;}
  })()`);
  assert.deepEqual(result,{live:170,stored:170,dirty:0});
}));

test('second window is read-only; explicit takeover loads the latest workspace and fences the former writer',async()=>app(async({page,run,open})=>{
  await seed(run,90);const other=await open();assert.equal((await owner(other.run)).writable,false);
  assert.equal(await other.run('items[0].x'),90);await run('items[0].x=140;save()');
  await other.page.locator('#canvas').click({position:{x:400,y:400}});await other.page.keyboard.press('Delete');
  assert.equal(await other.run('items.length'),1);assert.equal(await other.run('newTab();tabs.length'),1);
  await other.page.locator('#takeWorkspaceOwnership').click();
  await other.page.waitForFunction(()=>__test.run('workspaceStorage.writable && items[0]?.x===140'));
  await waitReadOnly(page);assert.equal((await owner(run)).writable,false);
  await other.run('items[0].x=210;save()');const durable=await saved(other.run);
  assert.equal(await run('items[0].x=500;save()'),false);assert.deepEqual(await saved(run),durable);
  await other.page.reload();assert.equal(await other.run('items[0].x'),210);assert.equal((await owner(other.run)).writable,true);
}));

test('ownership fences stale writes even without Web Locks or BroadcastChannel messages',async()=>app(async({page,run,open})=>{
  await seed(run);const other=await open();assert.equal((await owner(other.run)).writable,false);
  await other.run('takeWorkspaceOwnership()');await other.run('items[0].x=260;save()');
  // Suppress the heartbeat to exercise the atomic token check rather than message delivery.
  const result=await run('clearInterval(workspaceStorage.heartbeat);items[0].x=999;save()');
  assert.equal(result,false);assert.equal((await owner(run)).writable,false);
  assert.equal((await saved(other.run)).workspace.tabs[0].document.items[0].x,260);
  await other.page.close();
  // Without either liveness API, a terminated page's deletion may not commit.
  // The lease is the fallback; explicit takeover remains immediately available.
  await run(`(async()=>{const db=await openWorkspaceDatabase();await new Promise(resolve=>{const tx=db.transaction('owners','readwrite'),store=tx.objectStore('owners'),get=store.get(WORKSPACE_STORAGE_KEY);get.onsuccess=()=>{if(get.result)store.put({...get.result,expiresAt:0},WORKSPACE_STORAGE_KEY);};tx.oncomplete=resolve;});})()`);
  await page.reload();assert.equal((await owner(run)).writable,true);
},{init:()=>{Object.defineProperty(navigator,'locks',{value:undefined});window.BroadcastChannel=undefined;}}));

test('restoring a cached page never steals ownership from the active writer',async()=>app(async({page,run,open})=>{
  await seed(run);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  const other=await open();assert.equal((await owner(other.run)).writable,true);await other.run('items[0].x=270;save()');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await waitReadOnly(page);assert.equal((await owner(other.run)).writable,true);
  assert.equal((await saved(run)).workspace.tabs[0].document.items[0].x,270);
}));

test('pathnames isolate independent workspaces in the same origin',async()=>app(async({run,open})=>{
  await seed(run);const other=await open('another.html');assert.equal((await owner(other.run)).writable,true);
  assert.equal(await other.run('items.length'),0);await seed(other.run,300);
  assert.equal((await saved(run)).workspace.tabs[0].document.items[0].x,80);
  assert.equal((await saved(other.run)).workspace.tabs[0].document.items[0].x,300);
}));

test('corrupt snapshots are preserved read-only and can be downloaded before explicit recovery',async()=>app(async({page,run})=>{
  await seed(run);const corrupt={version:1,revision:'broken',workspace:{tabs:[{id:'broken',name:'Broken',document:{items:[{type:'unknown'}]}}],activeId:'broken'}};
  await run(`(async()=>{const db=await openWorkspaceDatabase();await new Promise((resolve,reject)=>{const tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(${JSON.stringify(corrupt)},WORKSPACE_STORAGE_KEY);tx.oncomplete=resolve;tx.onabort=reject;});})()`);
  await page.reload();assert.equal((await owner(run)).protected,true);assert.equal((await owner(run)).writable,false);
  assert.deepEqual(await saved(run),corrupt);await run('save()');assert.deepEqual(await saved(run),corrupt);
  const downloadPromise=page.waitForEvent('download');await page.locator('#downloadWorkspaceRecovery').click();
  const download=await downloadPromise;assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8')),corrupt);
  await page.locator('#resetWorkspaceRecovery').click();await page.waitForFunction(()=>__test.run('workspaceStorage.writable && !workspaceStorage.protected && !workspaceStorage.job'));
  assert.equal((await saved(run)).workspace.tabs[0].document.items.length,0);
  const recovery=await run(`(async()=>{const db=await openWorkspaceDatabase();return new Promise(resolve=>{const tx=db.transaction('recovery'),request=tx.objectStore('recovery').getAll();tx.oncomplete=()=>resolve(request.result);});})()`);
  assert.deepEqual(recovery,[corrupt]);
}));

test('malformed legacy storage is preserved instead of replaced with a blank autosave',async()=>app(async({page,run})=>{
  assert.equal((await owner(run)).protected,true);assert.equal(await saved(run),null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('simplecanvas:tabs:v1')),'{broken');
  await run('save()');assert.equal(await saved(run),null);
},{init:()=>localStorage.setItem('simplecanvas:tabs:v1','{broken')}));

test('unavailable IndexedDB permits session editing with an explicit unsaved warning and recovery download',async()=>app(async({page,run})=>{
  assert.equal((await owner(run)).writable,true);assert.equal(await seed(run),false);
  assert.equal(await page.locator('#autosaveWarning').isVisible(),true);
  const downloaded=page.waitForEvent('download');await page.locator('#saveRecoveryWorkspace').click();
  const file=await downloaded;assert.equal(JSON.parse(fs.readFileSync(await file.path(),'utf8')).tabs[0].items[0].uid,'box');
},{init:()=>{indexedDB.open=()=>{throw new DOMException('disabled','SecurityError');};}}));


test('a copied reload ticket cannot displace a page that has already resumed',async()=>app(async({page,run,open})=>{
  await seed(run);const previous=await run('workspaceStorage.token');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await page.waitForFunction(old=>__test.run('workspaceStorage.writable && workspaceStorage.token')!==old && __test.run('workspaceStorage.writable'),previous);
  const resumed=await run('workspaceStorage.token');assert.notEqual(resumed,previous);
  const other=await open();await other.run(`sessionStorage.setItem(WORKSPACE_HANDOFF_KEY,${JSON.stringify(previous)})`);
  await other.page.reload();assert.equal((await owner(other.run)).writable,false);assert.equal((await owner(run)).writable,true);
},{init:()=>Object.defineProperty(navigator,'locks',{value:undefined})}));

test('taking ownership cancels an open editor dialog and leaves recovery controls usable',async()=>app(async({page,run,open})=>{
  await seed(run);await run('newTab();persistWorkspace()');
  const other=await open();await page.locator('.tab-select.active').dblclick();
  await page.locator('#libraryDialog').waitFor({state:'visible'});
  await other.run('takeWorkspaceOwnership()');await waitReadOnly(page);
  await page.locator('#libraryDialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#downloadWorkspaceRecovery').isVisible(),true);
  assert.equal(await page.locator('#takeWorkspaceOwnership').isEnabled(),true);
}));

test('a sketch import started before an ownership handoff cannot overwrite the restored workspace',async()=>app(async({run,open})=>{
  await seed(run);
  await run(`
    window.originalFileReader=FileReader;
    window.FileReader=class {readAsText(){window.pendingSketchRead=this;}};
    try{importProject(new File(['pending'],'pending.json'));}finally{window.FileReader=window.originalFileReader;}
  `);
  const other=await open();await other.run('takeWorkspaceOwnership()');await run('renewWorkspaceOwnership()');
  await other.run('items[0].x=180;save()');await run('takeWorkspaceOwnership()');
  const restored=await saved(run);assert.equal(restored.workspace.tabs[0].document.items[0].x,180);
  await run(`pendingSketchRead.result=JSON.stringify({app:'SimpleCanvas',version:FORMAT_VERSION,
    items:[{...${JSON.stringify(box)},uid:'stale-import',x:300}],assets:{}});
    pendingSketchRead.onload();persistWorkspace()`);
  assert.equal(await run('items[0].uid'),'box');assert.equal(await run('items[0].x'),180);
  assert.deepEqual(await saved(run),restored,'the stale import does not write a new durable snapshot');
}));

test('a stale takeover read cannot restore editing after another window has already reclaimed ownership',async()=>app(async({run,open})=>{
  await seed(run);const other=await open();await run('items[0].x=140;save()');
  await other.run(`window.originalSavedRead=readSavedWorkspace;
    readSavedWorkspace=async()=>{const value=await originalSavedRead();await new Promise(resolve=>window.finishSavedRead=resolve);return value;};
    window.pendingTakeover=takeWorkspaceOwnership();undefined`);
  await other.page.waitForFunction(()=>typeof window.finishSavedRead==='function');
  await run('renewWorkspaceOwnership()');await run('takeWorkspaceOwnership()');await run('items[0].x=210;save()');
  await other.run('renewWorkspaceOwnership()');assert.equal((await owner(other.run)).writable,false);
  await other.run('window.finishSavedRead();window.pendingTakeover');
  assert.equal((await owner(other.run)).owned,false);assert.equal((await owner(other.run)).writable,false);
  assert.equal(await other.run('items[0].x'),80,'a superseded read does not replace this window’s recovery copy');
  assert.equal((await owner(run)).writable,true);assert.equal((await saved(run)).workspace.tabs[0].document.items[0].x,210);
}));

test('read-only tab and notice focus allow navigation and recovery but never editing shortcuts',async()=>app(async({page,run,open})=>{
  await seed(run);await run('newTab();persistWorkspace()');await seed(run,180);
  await run("setTool('select');selection=[0];render()");
  const other=await open();await other.run('takeWorkspaceOwnership()');await waitReadOnly(page);
  const before=await run('JSON.stringify({items,undoStack,redoStack,selection,tool:ui.tool,tabs})'),durable=await saved(other.run);
  for(const selector of ['.tab-select.active','#downloadWorkspaceRecovery']){
    await page.locator(selector).focus();
    for(const shortcut of ['Control+d','Delete','Control+z']){
      await page.keyboard.press(shortcut);
      assert.equal(await run('JSON.stringify({items,undoStack,redoStack,selection,tool:ui.tool,tabs})'),before,`${shortcut} from ${selector} leaves the recovery copy unchanged`);
    }
  }
  await page.locator('.tab-select.active').focus();await page.keyboard.press('ArrowLeft');
  assert.equal(await run('activeTabId'),await run('tabs[0].id'),'read-only sketches can still be browsed with arrow keys');
  const downloadPromise=page.waitForEvent('download');await page.keyboard.press('Control+s');
  const download=await downloadPromise,data=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.equal(data.tabs.length,2);assert.equal(data.tabs[0].items[0].x,80);assert.equal(data.tabs[1].items[0].x,180);
  assert.deepEqual(await saved(other.run),durable);
}));

test('direct file URLs retain autosave and single-owner behavior without a server',async()=>{
  const os=require('node:os'),{pathToFileURL}=require('node:url');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-storage-')),file=path.join(directory,'index.html');
  fs.writeFileSync(file,html);const context=await browser.newContext();
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.goto(pathToFileURL(file).href);const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await seed(run,370);assert.equal((await owner(run)).writable,true);assert.equal((await owner(run)).error,'');
    await page.reload();assert.equal(await run('items[0].x'),370);assert.equal((await owner(run)).writable,true);
    const other=await context.newPage();await other.goto(pathToFileURL(file).href);
    await other.evaluate(()=>__test.run('appReady'));assert.equal(await other.evaluate(()=>__test.run('workspaceStorage.writable')),false);
    await other.close();assert.deepEqual(errors,[]);
  }finally{await context.close();fs.rmSync(directory,{recursive:true,force:true});}
});

test('gracefully closing the last writer permits a new window without waiting for a fallback lease',async()=>app(async({page,run,open})=>{
  await seed(run,490);const former=await run('workspaceStorage.token');await page.close();
  const reopened=await open();assert.equal((await owner(reopened.run)).writable,true);assert.equal(await reopened.run('items[0].x'),490);
  assert.notEqual(await reopened.run('workspaceStorage.token'),former);
  await reopened.run(`localStorage.setItem(WORKSPACE_RELEASE_KEY,${JSON.stringify(former)})`);
  const stale=await open();assert.equal((await owner(stale.run)).writable,false,'a release receipt cannot release a later owner');
},{init:()=>{Object.defineProperty(navigator,'locks',{value:undefined});window.BroadcastChannel=undefined;}}));

test('legacy documents without their index remain recoverable instead of starting a new saved workspace',async()=>app(async({page,run})=>{
  assert.equal((await owner(run)).protected,true);assert.equal(await saved(run),null);
  const recovery=await run('workspaceStorage.raw');assert.equal(recovery.documents.orphan,'{"version":2,"items":[]}');
  assert.equal(await page.evaluate(()=>localStorage.getItem('simplecanvas:doc:orphan')),recovery.documents.orphan);
},{init:()=>localStorage.setItem('simplecanvas:doc:orphan','{"version":2,"items":[]}')}));

for(const stage of ['database','lock']){
  test(`a cached page hidden while its ${stage} claim is pending cannot become an owner afterward`,async()=>app(async({page,run,open})=>{
    await seed(run,510);const before=await saved(run);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    await run(`
      window.originalClaim=claimWorkspaceOwnership;
      claimWorkspaceOwnership=(...args)=>(window.pendingClaim=originalClaim(...args));
      window.originalClaimStage=${stage==='database'?'openWorkspaceDatabase':'acquireWorkspaceLock'};
      ${stage==='database'?'openWorkspaceDatabase':'acquireWorkspaceLock'}=async(...args)=>{
        const result=await originalClaimStage(...args);
        ${stage==='database'?'openWorkspaceDatabase':'acquireWorkspaceLock'}=originalClaimStage;
        await new Promise(resolve=>window.finishClaimStage=resolve);return result;
      };
      window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
    `);
    await page.waitForFunction(()=>typeof window.finishClaimStage==='function');
    if(stage==='lock')assert.equal(await run("typeof workspaceStorage.release"),'function','the test holds an actual acquired Web Lock');
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    assert.equal(await run('finishClaimStage();pendingClaim'),false);
    assert.deepEqual(await run('({owned:workspaceStorage.owned,writable:workspaceStorage.writable,suspended:workspaceStorage.suspended,lock:workspaceStorage.release,heartbeat:workspaceStorage.heartbeat})'),
      {owned:false,writable:false,suspended:true,lock:null,heartbeat:null});
    assert.deepEqual(await saved(run),before,'the abandoned claim does not change the workspace');
    const other=await open();assert.equal((await owner(other.run)).writable,true,'the abandoned claim leaves no lock or lease blocking the next window');
  }));
}

test('departure after queuing an owner lease retires only the unpublished candidate',async()=>app(async({page,run,open})=>{
  await seed(run,520);const before=await saved(run);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  const result=await run(`(async()=>{
    const original=IDBObjectStore.prototype.put;let hidden=false;
    IDBObjectStore.prototype.put=function(value,key){
      const request=original.call(this,value,key);
      if(this.name==='owners'&&!hidden){hidden=true;window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));}
      return request;
    };
    try{return {claim:await claimWorkspaceOwnership(),hidden};}finally{IDBObjectStore.prototype.put=original;}
  })()`);
  assert.deepEqual(result,{claim:false,hidden:true});
  assert.deepEqual(await run('({owned:workspaceStorage.owned,writable:workspaceStorage.writable,suspended:workspaceStorage.suspended,lock:workspaceStorage.release,heartbeat:workspaceStorage.heartbeat})'),
    {owned:false,writable:false,suspended:true,lock:null,heartbeat:null});
  assert.equal(await run(`(async()=>{const db=await openWorkspaceDatabase();return new Promise(resolve=>{const tx=db.transaction('owners'),get=tx.objectStore('owners').get(WORKSPACE_STORAGE_KEY);tx.oncomplete=()=>resolve(get.result??null);});})()`),null);
  assert.deepEqual(await saved(run),before);
  const other=await open();assert.equal((await owner(other.run)).writable,true);
}));

test('stealing a lock before its claim publishes prevents the superseded claimant from taking it back',async()=>app(async({page,run,open})=>{
  await seed(run,530);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await run(`
    window.originalClaimLock=acquireWorkspaceLock;
    acquireWorkspaceLock=async(...args)=>{
      const lock=await originalClaimLock(...args);acquireWorkspaceLock=originalClaimLock;
      await new Promise(resolve=>window.finishClaimLock=resolve);return lock;
    };
    window.pendingClaim=claimWorkspaceOwnership();undefined
  `);
  await page.waitForFunction(()=>typeof window.finishClaimLock==='function');
  assert.equal(await run('workspaceStorage.owned'),false);
  const other=await open();await other.run('takeWorkspaceOwnership()');
  await page.waitForFunction(()=>__test.run('workspaceStorage.release===null'));
  const durable=await saved(other.run);assert.equal((await owner(other.run)).writable,true);
  assert.equal(await run('finishClaimLock();pendingClaim'),false);
  assert.equal((await owner(run)).owned,false);assert.equal((await owner(run)).writable,false);
  assert.deepEqual(await saved(run),durable);assert.equal(await other.run('renewWorkspaceOwnership();workspaceStorage.writable'),true);
}));

for(const operation of ['resume','takeover','retry','recovery']){
  test(`departure during the pending save before ${operation} prevents a later ownership claim`,async()=>app(async({page,run,open})=>{
    await seed(run,540);const before=await saved(run);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    await run(`
      window.claimCalls=0;window.originalClaim=claimWorkspaceOwnership;
      claimWorkspaceOwnership=(...args)=>{claimCalls++;return window.pendingClaim=originalClaim(...args);};
      workspaceStorage.job=window.pendingSave=new Promise(resolve=>window.finishPendingSave=()=>{workspaceStorage.job=null;resolve(true);});
      ${operation==='resume'?"window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));":
        `window.pendingOperation=${{takeover:'takeWorkspaceOwnership',retry:'retryWorkspaceStorage',recovery:'resetWorkspaceRecovery'}[operation]}();`}
      undefined
    `);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    await run('finishPendingSave();pendingSave');await run('window.pendingOperation');await run('window.pendingClaim');
    assert.equal(await run('claimCalls'),0,'the pre-departure operation never starts a fresh claim');
    assert.deepEqual(await run('({owned:workspaceStorage.owned,writable:workspaceStorage.writable,suspended:workspaceStorage.suspended})'),
      {owned:false,writable:false,suspended:true});
    assert.deepEqual(await saved(run),before);
    const other=await open();assert.equal((await owner(other.run)).writable,true);
  }));
}

test('an older cached-page resume cannot revoke a newer successful resume when its claim finishes',async()=>app(async({page,run})=>{
  await seed(run,550);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await run(`
    window.originalOpen=openWorkspaceDatabase;window.originalClaim=claimWorkspaceOwnership;
    claimWorkspaceOwnership=(...args)=>(window.pendingClaim=originalClaim(...args));
    openWorkspaceDatabase=async()=>{
      const db=await originalOpen();openWorkspaceDatabase=originalOpen;
      await new Promise(resolve=>window.finishOldOpen=resolve);return db;
    };
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
  `);
  await page.waitForFunction(()=>typeof window.finishOldOpen==='function');
  await run('window.oldClaim=pendingClaim;undefined');
  await page.evaluate(()=>{
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
  });
  await page.waitForFunction(()=>__test.run('workspaceStorage.writable'));
  const token=await run('workspaceStorage.token');assert.equal(await run('finishOldOpen();oldClaim'),false);
  assert.equal(await run('workspaceClaimCurrent('+JSON.stringify(token)+')'),true);
  assert.equal((await owner(run)).writable,true);assert.equal(await run('items[0].x'),550);
}));

test('departure during the initial workspace read leaves a safe document and allows a later resume',async()=>app(async({page,run})=>{
  assert.equal(await run('workspaceStorage.ready'),true);assert.equal(await run('workspaceStorage.suspended'),true);
  assert.equal((await owner(run)).writable,false);assert.equal(await saved(run),null);
  assert.equal(await run('tabs.length'),1);assert.equal(await run('tabDocuments.has(activeTabId)'),true);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await page.waitForFunction(()=>__test.run('workspaceStorage.writable'));
  await seed(run,560);await page.reload();assert.equal(await run('items[0].x'),560);
},{init:()=>{
  if(sessionStorage.getItem('test-hidden-during-boot'))return;
  sessionStorage.setItem('test-hidden-during-boot','1');
  const original=IDBObjectStore.prototype.get;let first=true;
  IDBObjectStore.prototype.get=function(key){
    const request=original.call(this,key);
    if(this.name==='workspaces'&&first){
      first=false;request.addEventListener('success',()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    }
    return request;
  };
}}));
