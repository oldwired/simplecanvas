const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const appSource=parseApp(source),html=appSource.inject('window.__test={run:source=>eval(source)};');
const scope=vm.createContext({});
vm.runInContext(appSource.declarationsSource(['MAX_SCRIPT','packSmartScriptLists','unpackSmartScriptLists'])+'\nthis.api={MAX_SCRIPT,packSmartScriptLists,unpackSmartScriptLists};',scope);
const {MAX_SCRIPT:maxScript,packSmartScriptLists:pack,unpackSmartScriptLists:unpack}=scope.api;
const plain=value=>JSON.parse(JSON.stringify(value));

test('script pools deduplicate exact strings across sketches without touching nested state',()=>{
  const a='/* SHARED SOURCE */'+ ' '.repeat(2000)+'({children(){return [];}})',b=a+'\n';
  const lists=[[{type:'smart',uid:'one',script:a,state:{script:a,scriptRef:'s900'}},{type:'text',text:'a'}],
    [{type:'smart',uid:'two',script:a,state:{value:2}},{type:'smart',uid:'three',script:b,state:{value:3}}]];
  const result=pack(lists);assert.deepEqual(plain(result.scripts),{s0:a,s1:b});
  assert.equal(result.lists[0][0].script,undefined);assert.equal(result.lists[0][0].scriptRef,'s0');
  assert.equal(result.lists[1][0].scriptRef,'s0');assert.equal(result.lists[1][1].scriptRef,'s1');
  assert.deepEqual(plain(unpack(result.lists,result.scripts)),lists);
  assert.equal(lists[0][0].script,a);assert.equal(lists[0][0].scriptRef,undefined);
  assert.equal(result.lists[0][0].state,lists[0][0].state,'state is deliberately not traversed or rewritten');
  const many=Array.from({length:40},(_,i)=>({type:'smart',uid:'u'+i,script:a,state:{value:i}}));
  assert.ok(JSON.stringify(pack([many])).length<JSON.stringify(many).length/8,'serialization stores the repeated source once');
  assert.deepEqual(plain(unpack(lists)),lists,'ordinary inline script documents remain supported');
});

test('malformed script pools and references reject before any document is restored',()=>{
  const source='({children(){return [];}})',valid={type:'smart',uid:'ok',scriptRef:'s0'};
  for(const [lists,pool] of [
    [[[valid]],undefined],[[[valid]],null],[[[valid]],[]],[[[valid]],{s0:1}],[[[valid]],{s0:''}],[[[valid]],{s0:'x'.repeat(maxScript+1)}],
    [[[valid]],{s1:source}],[[[{...valid,script:source}]],{s0:source}],[[[{...valid,type:'text'}]],{s0:source}],
    [[[valid,{...valid,scriptRef:'missing'}]],{s0:source}],[[[valid]],{s0:source,s1:source}],
    [[[valid]],JSON.parse('{"s0":"x","__proto__":"x"}')],[[[{...valid,scriptRef:['s0']}]],{s0:source}],
    [[[valid]],{constructor:source}],[[null],{s0:source}]
  ])assert.throws(()=>unpack(lists,pool));
  assert.deepEqual(valid,{type:'smart',uid:'ok',scriptRef:'s0'});
});

let browser;
before(async()=>{browser=await launchBrowser();});after(async()=>browser?.close());
async function app(fn){
  const context=await browser.newContext({viewport:{width:1280,height:900}}),errors=[];
  try{
    await context.route('http://script-pool.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.goto('http://script-pool.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
const shared='/* SC_SHARED_POOL_SOURCE */({children(state){return [{type:"text",x:0,y:0,w:240,h:70,text:state.text,font:"20px sans-serif",color:"#123456"}];}})';
const different='/* SC_OTHER_POOL_SOURCE */({children(state){return [{type:"text",x:0,y:0,w:240,h:70,text:state.text,font:"20px sans-serif",color:"#654321"}];}})';
async function seed(run){
  await run(`cancelGesture();items=[];newTab();const make=(uid,script,text,x)=>normalizeItem({type:'smart',uid,script,state:{text,scriptRef:'nested'},x,y:100,w:240,h:70},{});
    items=[make('first',${JSON.stringify(shared)},'First instance',40),make('second',${JSON.stringify(shared)},'Second instance',330)];save();
    newTab();items=[make('third',${JSON.stringify(shared)},'Third instance',40),make('different',${JSON.stringify(different)},'Different source',330)];save();
    activateTab(tabs[1].id);persistWorkspace()`);
}
async function exported(page,run,call){const pending=page.waitForEvent('download');await run(call);return fs.readFileSync(await(await pending).path(),'utf8');}

test('IndexedDB and native files pool scripts across sketches and hydrate normal runtime items on reload/import',async()=>app(async({page,run})=>{
  await seed(run);const stored=await run('readSavedWorkspace()');
  assert.deepEqual(stored.workspace.scripts,{s0:shared,s1:different});
  const storedItems=stored.workspace.tabs.flatMap(tab=>tab.document.items);assert.equal(storedItems.length,4);
  assert.ok(storedItems.every(item=>item.script===undefined));assert.deepEqual(storedItems.map(item=>item.scriptRef),['s0','s0','s0','s1']);
  assert.equal(await run('items[0].script'),shared);await page.reload();assert.equal(await run('items[0].script'),shared);
  assert.equal(await run('items[0].state.text'),'First instance');assert.equal(await run('items[0].state.scriptRef'),'nested');
  const workspace=JSON.parse(await exported(page,run,'exportWorkspace()'));
  assert.equal(workspace.version,6);assert.deepEqual(workspace.scripts,{s0:shared,s1:different});
  assert.equal(workspace.tabs[1].items[0].scriptRef,'s0');assert.equal(workspace.tabs[2].items[0].scriptRef,'s0');
  const restored=await run('parseFileAsTabs('+JSON.stringify(workspace)+').entries.flatMap(entry=>entry.items).map(item=>({script:item.script,text:item.state.text}))');
  assert.deepEqual(restored,[{script:shared,text:'First instance'},{script:shared,text:'Second instance'},{script:shared,text:'Third instance'},{script:different,text:'Different source'}]);
  const sketch=JSON.parse(await exported(page,run,'exportProject()'));assert.deepEqual(sketch.scripts,{s0:shared});
  assert.equal(await run('parseFileAsTabs('+JSON.stringify(sketch)+').entries[0].items[1].script'),shared);
  await run('openWorkspaceFile(new File(['+JSON.stringify(JSON.stringify(workspace))+'],"pooled.json"))');
  await page.waitForFunction(()=>__test.run('toastEl.textContent').startsWith('Workspace opened'));
  await run('persistWorkspace()');assert.equal(await run('items[1].state.text'),'Second instance');
}));

test('a broken pooled import is rejected atomically and corrupt stored references stay protected',async()=>app(async({page,run})=>{
  await seed(run);const before=await run('JSON.stringify({tabs,activeTabId,items,workspace:workspaceSnapshot()})');
  const payload=JSON.parse(await exported(page,run,'exportWorkspace()'));payload.tabs[2].items[1].scriptRef='s999';
  await run('openWorkspaceFile(new File(['+JSON.stringify(JSON.stringify(payload))+'],"broken.json"))');
  await page.waitForFunction(()=>__test.run('toastEl.textContent').includes('shared script reference'));
  assert.equal(await run('JSON.stringify({tabs,activeTabId,items,workspace:workspaceSnapshot()})'),before);
  const corrupt=await run(`(async()=>{const record=await readSavedWorkspace();record.workspace.tabs[2].document.items[1].scriptRef='s999';
    const db=await openWorkspaceDatabase();await new Promise((resolve,reject)=>{const tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(record,WORKSPACE_STORAGE_KEY);tx.oncomplete=resolve;tx.onabort=reject;});return record;})()`);
  await page.reload();assert.equal(await run('workspaceStorage.protected'),true);assert.equal(await run('workspaceStorage.writable'),false);
  assert.deepEqual(await run('readSavedWorkspace()'),corrupt);
}));

test('offline HTML embeds repeated source once and restores each instance state across sketches',async()=>app(async({page,run,context})=>{
  await seed(run);const output=await exported(page,run,'exportHtml()');
  assert.equal(output.split('SC_SHARED_POOL_SOURCE').length-1,1);assert.equal(output.split('SC_OTHER_POOL_SOURCE').length-1,1);
  assert.ok(output.includes('"scriptRef":"s0"'));assert.equal(await run('items[0].script'),shared);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-pool-')),file=path.join(directory,'reader.html');
  fs.writeFileSync(file,output);context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const reader=await context.newPage(),errors=[];reader.on('pageerror',error=>errors.push(error.message));
  await reader.goto(pathToFileURL(file).href+'?page=1');await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length>=2);
  assert.match(await reader.locator('.tab-panel:visible').textContent(),/First instance/);assert.match(await reader.locator('.tab-panel:visible').textContent(),/Second instance/);
  await reader.locator('.tab-select').nth(2).click();await reader.waitForFunction(()=>document.querySelector('.tab-panel:not([style*="none"])')?.textContent.includes('Third instance'));
  assert.match(await reader.locator('.tab-panel:visible').textContent(),/Different source/);assert.deepEqual(errors,[]);
}));
