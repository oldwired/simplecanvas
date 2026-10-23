const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..'),origin='http://http-integrations.test',api='https://api.integration.test';
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});

async function app(fn,{settings}={}){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-http-'));
  const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
  const calls=[],held=[],errors=[];
  let respond=()=>({value:37,name:'First reading'});
  try{
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.route(api+'/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET','access-control-allow-headers':'authorization'}});
      const call={url:url.href,path:url.pathname,headers:request.headers()};calls.push(call);
      const result=await respond(call,route);
      if(result===null)return;
      try{await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},...(result?.response||{body:JSON.stringify(result)})});}catch(error){if(!/closed|disposed|Invalid|cancelled|aborted/i.test(error.message))throw error;}
    });
    await context.route(origin+'/**',route=>route.fulfill(new URL(route.request().url()).pathname==='/index.html'?
      {contentType:'text/html',body:html}:route.request().url().endsWith('settings.json')&&settings?
        {contentType:'application/json',body:JSON.stringify(settings)}:{status:404,body:''}));
    const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());
    await page.goto(origin+'/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');
    const defer=()=>{const gate={};gate.promise=new Promise(resolve=>gate.resolve=resolve);held.push(gate);return gate;};
    await fn({page,run,context,directory,calls,setResponse:fn=>{respond=fn;},defer});
    assert.deepEqual(errors,[],'editor and Run produce no uncaught errors');
  }finally{for(const gate of held)gate.resolve(null);await context.close();fs.rmSync(directory,{recursive:true,force:true});}
}

async function seed(run,{clock=false,two=false}={}){
  await run(`(async()=>{
    cancelGesture();
    const make=(key,uid,x,y,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,componentName:uid,x,y,...extra});
    items=[make('httpSource','http',60,70,{inputValues:{url:${JSON.stringify(api+'/reading')},path:'/value'}}),
      make('jsonExtract','extract',470,70,{state:{resultType:'string',showIndicators:true},inputValues:{pointer:'/name'},bindings:{text:{uid:'http',port:'json'}}}),
      make('numberControl','control',870,70)];
    ${two?`items.push(make('httpSource','http-second',60,350,{inputValues:{url:${JSON.stringify(api+'/second')},path:'/value'}}));`:''}
    ${clock?`items.push(make('pulseGenerator','clock',470,350,{inputValues:{seconds:.08,width:.03,enable:true}}),make('counter','count',870,350,{bindings:{value:{uid:'clock',port:'value'}}}));`:''}
    datasets={};selection=[];editingSmartIdx=null;setTool('select');render();save();
    await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);undoStack=[];redoStack=[];await persistWorkspace();
  })()`);
}
async function refresh(run,uid='http'){
  return run(`openEditorComponentDataAction(items.find(item=>item.uid===${JSON.stringify(uid)}),{type:'httpGet'},()=>true)`);
}
async function record(run,uid='http'){
  return run(`(async()=>{const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true),record=graph.get(editorRuntimeContext().scene.find(item=>item.uid===${JSON.stringify(uid)}));return {error:record?.error,outputs:record?.io.outputs,source:record?.io.source};})()`);
}
async function waitOutput(page,uid,key,value){
  await page.waitForFunction(({uid,key,value})=>{
    return __test.run(`editorComponentEvaluation?.records?.get(editorRuntimeContext().scene.find(item=>item.uid===${JSON.stringify(uid)}))?.io.outputs[${JSON.stringify(key)}]===${JSON.stringify(value)}`);
  },{uid,key,value});
}
async function handle(run,uid,id){
  return run(`(async()=>{const item=items.find(item=>item.uid===${JSON.stringify(uid)}),io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id===${JSON.stringify(id)});})()`);
}
async function readerReady(frame,index=0){
  await frame.waitForFunction(index=>document.querySelector('[data-smart-index="'+index+'"]')?.dataset.smartReady==='true',index);
}
async function readerText(frame,index,text){
  await frame.waitForFunction(({index,text})=>{
    const host=document.querySelector('[data-smart-index="'+index+'"]');
    return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(node=>node.textContent===text);
  },{index,text});
}
async function clickReader(page,frame,index,handle,isPreview=false){
  assert.ok(handle,'the component exposes its declared action handle');await readerReady(frame,index);
  const p=await frame.locator('[data-smart-index="'+index+'"]').evaluate((host,handle)=>{
    const point=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};
  },handle);
  const offset=isPreview?await page.locator('#runPreviewFrame').boundingBox():{x:0,y:0};await page.mouse.click(offset.x+p.x,offset.y+p.y);
}
async function credentials(page,run,{auth='bearer',username='',secret='fixture-token'}={}){
  await run("openEditorComponentDataAction(items.find(item=>item.componentName==='http'),{type:'httpCredentials'},()=>true)");
  const dialog=page.locator('[data-integration-credentials]');await dialog.waitFor();
  await dialog.locator('[data-integration-auth]').selectOption(auth);
  if(auth==='basic')await dialog.locator('[data-integration-user]').fill(username);
  if(auth!=='none')await dialog.locator('[data-integration-secret]').fill(secret);
  await dialog.locator('[data-integration-save]').click();await dialog.waitFor({state:'detached'});
}
async function downloadWithCredentials(page,run,action,include=false){
  await run('void '+action+'()');const dialog=page.locator('[data-integration-export]');await dialog.waitFor();
  assert.equal(await dialog.locator('[data-integration-include]').first().isChecked(),false,'credential inclusion always needs an explicit artifact choice');
  if(include)await dialog.locator('[data-integration-include]').first().check();
  const waiting=page.waitForEvent('download');await dialog.locator('[data-integration-export-continue]').click();
  return fs.readFileSync(await(await waiting).path(),'utf8');
}

test('manual GET publishes a typed reading and JSON text without persisting live results or replaying on reload',async()=>app(async({page,run,calls})=>{
  await seed(run);assert.equal(calls.length,0,'opening and evaluating the source does not request data');
  const before=await run('({items:JSON.stringify(items),undo:clone(undoStack),redo:clone(redoStack)})'),saved=await run('readSavedWorkspace()');
  await refresh(run);await waitOutput(page,'http','available',true);
  const result=await record(run);assert.equal(result.outputs.value,37);assert.equal(result.outputs.loading,false);assert.equal(result.outputs.error,'');
  assert.deepEqual(JSON.parse(result.outputs.json),{value:37,name:'First reading'});assert.ok(result.outputs.lastUpdated>0);
  await waitOutput(page,'extract','value','First reading');assert.equal(calls.length,1);
  assert.deepEqual(await run('({items:JSON.stringify(items),undo:clone(undoStack),redo:clone(redoStack)})'),before,'live results stay outside authoring state/history');
  await run('render();persistWorkspace()');assert.deepEqual(await run('readSavedWorkspace()'),saved,'live results do not alter the saved workspace');
  const output=await run('buildWorkspaceHtml(captureWorkspaceHtml())');assert.doesNotMatch(output,/First reading/,'HTML contains authored configuration, not the live response');assert.equal(calls.length,1,'static export does not request data');
  await page.reload();await run('appStarted');await record(run);assert.equal(calls.length,1,'restoring the document never replays Refresh');
  assert.equal((await record(run)).outputs.available,false);
}));

test('a pending GET leaves the graph, timed components, controls and another GET responsive',async()=>app(async({page,run,calls,setResponse,defer})=>{
  await seed(run,{clock:true,two:true});
  const gate=defer();setResponse(call=>call.path==='/reading'?gate.promise:{value:82,name:'Independent reading'});
  await refresh(run);await waitOutput(page,'http','loading',true);assert.equal(calls.length,1);
  const start=await run("items.find(item=>item.uid==='count').state.count");
  await page.waitForFunction(start=>__test.run("items.find(item=>item.uid==='count').state.count")>start,start);
  await refresh(run,'http-second');await waitOutput(page,'http-second','value',82);
  assert.equal((await record(run)).outputs.loading,true,'the independent source completes while the first fetch is pending');
  await run(`(async()=>{const item=items.find(item=>item.uid==='control'),next={...item.state,value:71};beginHistory();item.state=next;commitHistory();render();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);
  assert.equal((await record(run,'control')).outputs.value,71,'an unrelated control update settles before GET completion');
  gate.resolve({value:19,name:'Delayed reading'});await waitOutput(page,'http','value',19);assert.equal(calls.length,2);
}));

test('a newer request and changed configuration invalidate earlier HTTP results',async()=>app(async({page,run,calls,setResponse,defer})=>{
  await seed(run);const replies=[];setResponse(call=>{const gate=defer();replies.push(gate);return gate.promise;});
  await refresh(run);await waitOutput(page,'http','loading',true);
  await run(`items[0].inputValues.url=${JSON.stringify(api+'/new')};editorComponentEvaluation=null;render();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  await Promise.all([page.waitForRequest(api+'/new'),refresh(run)]);assert.equal(replies.length,2);
  replies[1].resolve({value:91,name:'Newest'});await waitOutput(page,'http','value',91);
  replies[0].resolve({value:4,name:'Obsolete'});await page.waitForTimeout(80);
  assert.equal((await record(run)).outputs.value,91);assert.equal(calls.length,2);
  await run(`items[0].inputValues.path='/missing';editorComponentEvaluation=null;render();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  assert.equal((await record(run)).outputs.available,false,'a result from old mapping is not current data');assert.equal(calls.length,2,'editing configuration never starts a request');
}));

test('HTTP failures are visible, leave current value unavailable and allow a manual retry',async()=>app(async({page,run,setResponse,calls})=>{
  await seed(run);setResponse(()=>({response:{status:503,body:'service unavailable'}}));
  await refresh(run);await waitOutput(page,'http','status','error');
  const failed=await record(run);assert.equal(failed.outputs.available,false);assert.match(failed.outputs.error,/503|HTTP|request/i);assert.equal(calls.length,1);
  setResponse(()=>({value:62,name:'Recovered'}));await refresh(run);await waitOutput(page,'http','value',62);
  setResponse(()=>({response:{body:'{"value":'}}));await refresh(run);await waitOutput(page,'http','status','error');
  const invalid=await record(run);assert.equal(invalid.outputs.available,false);assert.ok(invalid.outputs.error,'invalid JSON has a local error');
  setResponse(()=>({value:12,name:'x'.repeat(2100)}));await refresh(run);await waitOutput(page,'http','status','error');
  const oversized=await record(run);assert.equal(oversized.outputs.available,false);assert.match(oversized.outputs.error,/2000|large|limit|length|size/i);
}));

test('timeout, deletion and undo retire requests without replaying them',async()=>app(async({page,run,calls,setResponse,defer})=>{
  await seed(run);const timeout=defer();setResponse(()=>timeout.promise);
  await run(`items[0].state.timeoutSeconds=1;editorComponentEvaluation=null;render();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  await refresh(run);await waitOutput(page,'http','loading',true);await waitOutput(page,'http','status','error');
  const timedOut=await record(run);assert.match(timedOut.outputs.error,/timeout|timed out/i,JSON.stringify({timedOut,calls,state:await run('items[0].state')}));assert.equal(calls.length,1,'timeouts do not retry automatically');
  timeout.resolve({value:1,name:'Too late'});
  const deleted=defer();setResponse(()=>deleted.promise);
  await refresh(run);await waitOutput(page,'http','loading',true);
  await run(`beginHistory();items=items.filter(item=>item.uid!=='http');commitHistory();render();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  deleted.resolve({value:8,name:'Deleted source'});
  await run('undo();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
  assert.equal((await record(run)).outputs.available,false,'undo restores authored configuration without reviving the request');assert.equal(calls.length,2);
}));

test('connection credentials remain in host memory and are excluded from ordinary persistence and HTML',async()=>app(async({page,run,calls})=>{
  await seed(run);const secret='fixture-token-never-persisted';
  await credentials(page,run,{secret});
  assert.equal(calls.length,0,'saving credentials does not issue a request');
  assert.equal((await record(run)).outputs.error,'','changing connection settings is not a failed request');
  await refresh(run);await waitOutput(page,'http','available',true);assert.equal(calls[0].headers.authorization,'Bearer '+secret);
  const state=await run('JSON.stringify(items)');assert.ok(!state.includes(secret),'component scripts and saved state never hold the credential');
  await run('persistWorkspace()');assert.ok(!JSON.stringify(await run('readSavedWorkspace()')).includes(secret));
  const exported=await run('buildWorkspaceHtml(captureWorkspaceHtml())');assert.ok(!exported.includes(secret),'normal HTML export omits session credentials');
  await page.reload();await run('appStarted');await refresh(run);await waitOutput(page,'http','available',true);
  assert.equal(calls[1].headers.authorization,undefined,'session credentials do not survive reload');
}));

test('credential inclusion is per artifact and imported credentials return only to host memory',async()=>app(async({page,run,calls,context,directory})=>{
  await seed(run);const secret='explicit-fixture-token';await credentials(page,run,{secret});
  const handleRefresh=await handle(run,'http','refresh');
  const ordinary=await downloadWithCredentials(page,run,'exportHtml');assert.ok(!ordinary.includes(secret));assert.equal(calls.length,0);
  const included=await downloadWithCredentials(page,run,'exportWorkspace',true),data=JSON.parse(included);
  assert.equal(data.integrationCredentials.length,1);assert.equal(data.integrationCredentials[0].secret,secret);
  const generation=await run('workspaceGeneration');
  await run(`openWorkspaceFile(new File([${JSON.stringify(included)}],'with-credentials.json',{type:'application/json'}))`);
  await page.waitForFunction(generation=>__test.run('workspaceGeneration')>generation,generation);
  const uid=await run("items.find(item=>item.componentName==='http').uid");
  await record(run,uid);assert.equal(calls.length,0,'importing credentials does not authorize a request');
  assert.ok(!(await run('JSON.stringify(items)')).includes(secret));await run('persistWorkspace()');
  assert.ok(!JSON.stringify(await run('readSavedWorkspace()')).includes(secret),'imported credentials are not copied into autosave');
  await refresh(run,uid);await waitOutput(page,uid,'available',true);assert.equal(calls[0].headers.authorization,'Bearer '+secret);
  const readerHtml=await downloadWithCredentials(page,run,'exportHtml',true),file=path.join(directory,'with-credentials.html');fs.writeFileSync(file,readerHtml);
  assert.ok(readerHtml.includes(secret),'explicitly selected HTML carries its credential');
  const reader=await context.newPage();await reader.goto(pathToFileURL(file).href);await readerReady(reader);assert.equal(calls.length,1);
  await clickReader(reader,reader,0,handleRefresh);await readerText(reader,1,'First reading');assert.equal(calls[1].headers.authorization,'Bearer '+secret);
  const ordinaryAgain=await downloadWithCredentials(page,run,'exportWorkspace');assert.ok(!ordinaryAgain.includes(secret),'inclusion for an earlier artifact never changes the next default');
}));

test('Run inherits session credentials, while changing origins cannot send them to another service',async()=>app(async({page,run,calls,setResponse})=>{
  await seed(run);await credentials(page,run,{auth:'basic',username:'reader',secret:'pāssword'});
  const refreshHandle=await handle(run,'http','refresh');await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
  const frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await clickReader(page,frame,0,refreshHandle,true);await readerText(frame,1,'First reading');
  assert.equal(calls[0].headers.authorization,'Basic '+Buffer.from('reader:pāssword').toString('base64'));
  await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
  await run(`items[0].inputValues.url='https://different.integration.test/reading';editorComponentEvaluation=null;render();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  const outbound=[];await page.route('https://different.integration.test/**',route=>{outbound.push(route.request().headers());return route.fulfill({contentType:'application/json',body:'{"value":1}',headers:{'access-control-allow-origin':'*'}});});
  await refresh(run);await waitOutput(page,'http','status','error');assert.deepEqual(outbound,[],'credentials are bound to the configured origin before fetch');
}));

test('networkIntegrations off blocks manual reads in editor, Run and downloaded HTML',async()=>app(async({page,run,context,directory,calls})=>{
  await seed(run);const refreshHandle=await handle(run,'http','refresh');assert.equal(await refresh(run),false);assert.equal(calls.length,0);
  await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
  const frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await clickReader(page,frame,0,refreshHandle,true);assert.equal(calls.length,0);
  await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
  const output=await run('buildWorkspaceHtml(captureWorkspaceHtml())'),file=path.join(directory,'disabled.html');fs.writeFileSync(file,output);
  const reader=await context.newPage();await reader.goto(pathToFileURL(file).href);await clickReader(reader,reader,0,refreshHandle);assert.equal(calls.length,0);
},{settings:{features:{networkIntegrations:false}}}));

test('Run and self-contained HTML perform independent manual requests and stay interactive while fetching',async()=>app(async({page,run,context,directory,calls,setResponse,defer})=>{
  await seed(run);const refreshHandle=await handle(run,'http','refresh'),plus=await handle(run,'control','plus');
  const before=await run('({items:JSON.stringify(items),undo:clone(undoStack),redo:clone(redoStack)})');
  const gate=defer();setResponse(()=>gate.promise);
  await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
  const frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await readerReady(frame);
  assert.equal(calls.length,0,'Run startup is not network authorization');
  await clickReader(page,frame,0,refreshHandle,true);
  await clickReader(page,frame,2,plus,true);await readerText(frame,2,'51');
  assert.equal(calls.length,1,'manual reader Refresh starts one request');gate.resolve({value:44,name:'Run result'});await readerText(frame,1,'Run result');
  await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
  assert.deepEqual(await run('({items:JSON.stringify(items),undo:clone(undoStack),redo:clone(redoStack)})'),before);
  assert.equal((await record(run)).outputs.available,false,'Run readings never enter the editor source');
  const output=await run('buildWorkspaceHtml(captureWorkspaceHtml())'),file=path.join(directory,'http.html');fs.writeFileSync(file,output);
  const reader=await context.newPage(),errors=[];reader.on('pageerror',error=>errors.push(error.message));
  await reader.goto(pathToFileURL(file).href);await readerReady(reader);assert.equal(calls.length,1,'opening downloaded HTML does not request data');
  setResponse(()=>({value:73,name:'HTML result'}));await clickReader(reader,reader,0,refreshHandle);await readerText(reader,1,'HTML result');
  assert.equal(calls.length,2);assert.deepEqual(errors,[]);
}));

test('returning from Run discards a pending request and a new Run starts without its result',async()=>app(async({page,run,calls,setResponse,defer})=>{
  await seed(run);const refreshHandle=await handle(run,'http','refresh'),gate=defer();setResponse(()=>gate.promise);
  await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
  let frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await clickReader(page,frame,0,refreshHandle,true);
  await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
  gate.resolve({value:99,name:'Discarded response'});assert.equal((await record(run)).outputs.available,false);
  await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
  frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await readerReady(frame);
  assert.ok(!(await frame.locator('[data-smart-index="1"]').textContent()).includes('Discarded response'));
  assert.equal(calls.length,1,'the new Run does not restore or replay the prior request');
  await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
}));

for(const whole of [false,true])test('HTTP ownership follows '+(whole?'Whole workspace':'Active sketch only')+' scope in editor and HTML',async()=>app(async({page,run,calls,setResponse,defer,context,directory})=>{
  await seed(run);
  const tabs=await run(`(async()=>{
    const settings={...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key==='workspaceSettings').items[0]),uid:'settings',x:60,y:400};
    settings.state.executionMode=${JSON.stringify(whole?'whole workspace':'active sketch')};items.push(settings);save();
    const source=activeTabId;newTab();const other=activeTabId;activateTab(source);await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
    return {source,other};
  })()`);
  const refreshHandle=await handle(run,'http','refresh'),first=defer();setResponse(()=>first.promise);
  await refresh(run);await waitOutput(page,'http','loading',true);
  await run(`activateTab(${JSON.stringify(tabs.other)});resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  first.resolve({value:48,name:'Across sketches'});
  if(whole){
    await waitOutput(page,'http','value',48);
    assert.equal(await run('activeTabId'),tabs.other);
  }
  await run(`activateTab(${JSON.stringify(tabs.source)});resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  assert.equal((await record(run)).outputs.available,whole,'only Whole workspace keeps the hidden source request alive');assert.equal(calls.length,1);
  const output=await run('buildWorkspaceHtml(captureWorkspaceHtml())'),file=path.join(directory,'scope.html');fs.writeFileSync(file,output);
  const reader=await context.newPage();await reader.goto(pathToFileURL(file).href);await readerReady(reader);
  const second=defer();setResponse(()=>second.promise);
  await Promise.all([reader.waitForRequest(api+'/reading'),clickReader(reader,reader,0,refreshHandle)]);
  await reader.locator('.tab-select[data-tab-id="'+tabs.other+'"]').click();
  await reader.locator('.tab-panel[data-tab-id="'+tabs.other+'"]').waitFor({state:'visible'});
  second.resolve({value:56,name:'Reader scope'});
  await reader.locator('.tab-select[data-tab-id="'+tabs.source+'"]').click();await readerReady(reader);
  if(whole)await readerText(reader,1,'Reader scope');
  else assert.ok(!(await reader.locator('[data-smart-index="1"]').textContent()).includes('Reader scope'));
  assert.equal(calls.length,2,'sketch activation never replays Refresh');
}));

test('an accepted GET may complete while the browser page is hidden without replaying on visibility restoration',async()=>app(async({page,run,calls,setResponse,defer})=>{
  await seed(run);const gate=defer();setResponse(()=>gate.promise);await refresh(run);await waitOutput(page,'http','loading',true);
  await run(`(()=>{const item=items[0],record=editorComponentEvaluation.records.get(item);window.httpSnapshot=()=>editorIntegrationService.read(item,record.caps,record.io.inputs);})()`);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  gate.resolve({value:67,name:'Accepted while visible'});
  await page.waitForFunction(()=>window.httpSnapshot().loading===false);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await waitOutput(page,'http','value',67);assert.equal(calls.length,1);
}));

test('Edit can bind an idle HTTP source and preview or cancel drafts without changing its live result',async()=>app(async({page,run,calls})=>{
  await seed(run);
  await run(`items.push({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key==='gauge').items[0]),uid:'gauge',componentName:'Gauge',x:60,y:350});save();render();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  const open=async index=>{
    await run(`setTool('select');selection=[${index}];editingSmartIdx=null;render()`);await page.locator('#componentBindingsBtn').click();
    await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open&&!document.querySelector('#componentBindingFields').disabled);
  };
  await open(3);await page.getByLabel('value (number)',{exact:true}).selectOption(JSON.stringify({uid:'http',port:'value'}));
  await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});
  assert.deepEqual(await run('items[3].bindings'),{value:{uid:'http',port:'value'}});assert.equal(calls.length,0);
  await refresh(run);await waitOutput(page,'gauge','percentage',37);await open(3);
  await page.waitForFunction(()=>document.querySelector('#componentOutputs').getAttribute('aria-busy')!=='true'&&document.querySelector('#componentOutputs').textContent.includes('37'));
  await page.locator('#componentBindingsCancel').click();await open(0);
  const pointerId=await page.locator('#componentBindingFields input').evaluateAll(inputs=>inputs.find(input=>input.value==='/value')?.id);
  assert.ok(pointerId,'Edit exposes the JSON pointer literal');await page.locator('#'+pointerId).fill('/missing');
  await page.waitForFunction(()=>document.querySelector('#componentOutputs').getAttribute('aria-busy')!=='true');
  await page.locator('#componentBindingsCancel').click();
  assert.equal((await record(run)).outputs.value,37,'a cancelled mapping draft leaves the live reading intact');assert.equal(calls.length,1);
}));

test('Save and start new waits for credential export, retains cancellation, and downloads before resetting',async()=>app(async({page,run,calls})=>{
  for(const include of [false,true]){
    await seed(run);const secret='new-workspace-session-token';await credentials(page,run,{secret});
    await run('openNewWorkspace()');const confirmation=page.locator('#newWorkspaceDialog');await confirmation.waitFor();
    const original=await run('JSON.stringify({items,tabs,activeTabId,workspaceGeneration})');
    await page.locator('#newWorkspaceSave').click();let chooser=page.locator('[data-integration-export]');await chooser.waitFor();
    await chooser.getByRole('button',{name:'Cancel',exact:true}).click();await chooser.waitFor({state:'detached'});
    assert.equal(await confirmation.isVisible(),true,'cancelling the nested export leaves the New workspace choice open');
    assert.equal(await run('JSON.stringify({items,tabs,activeTabId,workspaceGeneration})'),original,'export cancellation keeps the original workspace');
    await page.locator('#newWorkspaceSave').click();chooser=page.locator('[data-integration-export]');await chooser.waitFor();
    assert.equal(await chooser.locator('[data-integration-include]').first().isChecked(),false);
    if(include)await chooser.locator('[data-integration-include]').first().check();
    const pending=page.waitForEvent('download');await chooser.locator('[data-integration-export-continue]').click();
    const data=JSON.parse(fs.readFileSync(await(await pending).path(),'utf8'));
    assert.equal(data.app,'SimpleCanvasWorkspace');assert.equal(data.tabs[0].items[0].uid,'http','the download contains the prior workspace');
    assert.equal(data.integrationCredentials?.[0]?.secret,include?secret:undefined);
    await confirmation.waitFor({state:'hidden'});assert.deepEqual(await run('({items:items.length,tabs:tabs.length})'),{items:0,tabs:1});
  }
  assert.equal(calls.length,0,'saving or starting fresh never requests HTTP data');
}));
