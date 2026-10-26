const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const {createMqttExampleServer}=require('../tools/serve-mqtt-example.cjs');
const root=path.join(__dirname,'..');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>browser?.close());

async function app(fn,{settings,authenticate}={}){
  const broker=await createMqttExampleServer({interval:0,authenticate});
  await new Promise((resolve,reject)=>{broker.server.once('error',reject);broker.server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+broker.server.address().port,url=origin.replace('http:','ws:')+'/mqtt';
  const context=await browser.newContext({viewport:{width:1700,height:1150}});
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-mqtt-'));
  const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
  const errors=[];
  try{
    if((process.env.BROWSER_ENGINE||'chromium')==='chromium')await context.grantPermissions(['local-network-access'],{origin});
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.route(origin+'/index.html',route=>route.fulfill({contentType:'text/html',body:html}));
    if(settings)await context.route(origin+'/settings.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(settings)}));
    const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());await page.goto(origin+'/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);await run('appStarted');
    await fn({page,run,context,directory,broker,url,origin});
    assert.deepEqual(errors,[],'editor, Run and HTML have no uncaught errors');
  }finally{await context.close();await broker.close();fs.rmSync(directory,{recursive:true,force:true});}
}
async function seed(run,url,{memo=false,startup=false,second=false}={}){
  await run(`(async()=>{
    cancelGesture();const make=(key,uid,x,y,extra={})=>{
      const definition=BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key);if(!definition)throw new Error('Missing built-in '+key);
      const item=clone(definition.items[0]);return {...item,uid,componentName:uid,x,y,...extra,state:{...item.state,...extra.state},inputValues:{...item.inputValues,...extra.inputValues}};
    };
    items=[make('mqttConfig','config',50,60,{state:{connectOnStart:${startup}},inputValues:{url:${JSON.stringify(url)},clientId:''}}),
      make('mqttSubscribe','reading',450,60,{state:{format:'json',valueType:'number'},inputValues:{topic:'simplecanvas/demo/reading',path:'/value'},mqttBinding:{sketchId:activeTabId,componentUid:'config'}}),
      make('mqttSubscribe','text',850,60,{state:{format:'text',valueType:'string'},inputValues:{topic:'simplecanvas/demo/status',path:''},mqttBinding:{sketchId:activeTabId,componentUid:'config'}}),
      make('numberControl','control',50,420)];
    ${memo?`items.push(make('memo','memo',450,420,{bindings:{line:{uid:'text',port:'value'}}}));`:''}
    ${second?`items.push(make('mqttConfig','config2',50,750,{inputValues:{url:${JSON.stringify(url)},clientId:''}}),make('mqttSubscribe','reading2',450,750,{state:{format:'json',valueType:'number'},inputValues:{topic:'simplecanvas/demo/reading',path:'/value'},mqttBinding:{sketchId:activeTabId,componentUid:'config2'}}));`:''}
    datasets={};selection=[];editingSmartIdx=null;setTool('select');render();save();
    await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);undoStack=[];redoStack=[];await persistWorkspace();
  })()`);
}
async function action(run,type='mqttConnect',uid='config'){
  return run(`openEditorComponentDataAction(items.find(item=>item.uid===${JSON.stringify(uid)}),{type:${JSON.stringify(type)}},()=>true)`);
}
async function output(run,uid){return run(`(async()=>{const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);return graph.get(editorRuntimeContext().scene.find(item=>item.uid===${JSON.stringify(uid)}))?.io.outputs;})()`);}
async function waitOutput(page,uid,key,value){await page.waitForFunction(({uid,key,value})=>__test.run(`editorComponentEvaluation?.records?.get(editorRuntimeContext().scene.find(item=>item.uid===${JSON.stringify(uid)}))?.io.outputs[${JSON.stringify(key)}]`)===value,{uid,key,value});}
async function patch(run,uid,changes){await run(`(async()=>{const item=items.find(item=>item.uid===${JSON.stringify(uid)}),changes=${JSON.stringify(changes)};for(const [key,value] of Object.entries(changes))item[key]=['state','inputValues'].includes(key)?{...item[key],...value}:value;editorComponentEvaluation=null;render();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);}
async function handle(run,uid,id){return run(`(async()=>{const item=items.find(item=>item.uid===${JSON.stringify(uid)}),io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id===${JSON.stringify(id)});})()`);}
async function readerReady(frame,index=0){await frame.locator('[data-smart-index="'+index+'"][data-smart-ready="true"]').waitFor();}
async function readerText(frame,index,text){await frame.waitForFunction(({index,text})=>document.querySelector('[data-smart-index="'+index+'"]')?.dataset.smartReady==='true'&&[...document.querySelectorAll('[data-smart-index="'+index+'"] text')].some(node=>node.textContent===text),{index,text});}
async function readerClick(page,frame,index,h,preview=false){
  assert.ok(h,'declared action handle exists');await readerReady(frame,index);
  const point=await frame.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},h);
  const offset=preview?await page.locator('#runPreviewFrame').boundingBox():{x:0,y:0};await page.mouse.click(offset.x+point.x,offset.y+point.y);
}
async function preview(page){await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();const frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await readerReady(frame);return frame;}
async function reader(run,context,directory){const file=path.join(directory,'mqtt.html');fs.writeFileSync(file,await run('buildWorkspaceHtml(captureWorkspaceHtml())'));const page=await context.newPage();await page.goto(pathToFileURL(file).href);await readerReady(page);return page;}

test('manual MQTT subscriptions share a connection and live values never enter source history/autosave',{timeout:60000},()=>app(async({page,run,broker,url})=>{
  await seed(run,url);assert.equal(broker.stats.connections.length,0,'opening the editor never connects');
  const before=await run('({items:JSON.stringify(items),undo:clone(undoStack),redo:clone(redoStack)})'),saved=await run('readSavedWorkspace()');
  await action(run);await waitOutput(page,'reading','value',35);await waitOutput(page,'text','value','Workshop online');
  assert.equal(broker.stats.connections.length,1,'both subscriptions share Config');
  await broker.publish(broker.topics.reading,{value:72,name:'Latest'});await waitOutput(page,'reading','value',72);
  assert.equal((await output(run,'config')).connected,true);
  assert.deepEqual(await run('({items:JSON.stringify(items),undo:clone(undoStack),redo:clone(redoStack)})'),before);
  await run('persistWorkspace()');assert.deepEqual(await run('readSavedWorkspace()'),saved);
  assert.ok(!(await run('buildWorkspaceHtml(captureWorkspaceHtml())')).includes('Latest'),'live payloads are not copied into HTML');
  await page.reload();await run('appStarted');await output(run,'reading');
  assert.equal(broker.stats.connections.length,1,'restoration does not replay Connect');assert.equal((await output(run,'reading')).available,false);
}));

test('retained and reconnect baselines do not append events, while equal live messages remain separate occurrences',{timeout:60000},()=>app(async({page,run,broker,url})=>{
  await seed(run,url,{memo:true});await action(run);await waitOutput(page,'text','value','Workshop online');
  assert.equal(await run("items.find(item=>item.uid==='memo').state.lineCount"),0);
  for(let count=1;count<=2;count++){
    await broker.publish(broker.topics.status,'Repeated live line',{retain:true});await waitOutput(page,'memo','lineCount',count);
  }
  broker.dropClients();await waitOutput(page,'text','available',false);assert.equal((await output(run,'text')).stale,true);
  await waitOutput(page,'text','available',true);assert.equal(broker.stats.connections.length,2);
  assert.equal(await run("items.find(item=>item.uid==='memo').state.lineCount"),2,'retained reconnect value does not append');
  await broker.publish(broker.topics.status,'After reconnect');await waitOutput(page,'memo','lineCount',3);
  assert.equal((await output(run,'memo')).text,'Repeated live line\nRepeated live line\nAfter reconnect');
}));

test('MQTT malformed payloads withhold current data and a valid update recovers without reconnect',{timeout:60000},()=>app(async({page,run,broker,url})=>{
  await seed(run,url);await action(run);await waitOutput(page,'reading','value',35);
  await broker.publish(broker.topics.reading,'{"value":');await waitOutput(page,'reading','available',false);
  assert.match((await output(run,'reading')).error,/JSON|payload/i);
  await broker.publish(broker.topics.reading,{value:81});await waitOutput(page,'reading','value',81);
  await broker.publish(broker.topics.status,'x'.repeat(2001));await waitOutput(page,'text','available',false);
  assert.match((await output(run,'text')).error,/2000|limit|large|length/i);
  await broker.publish(broker.topics.status,'Recovered');await waitOutput(page,'text','value','Recovered');
  assert.equal(broker.stats.connections.length,1);
}));

test('Config edits require Apply and independent Config instances keep independent connections',{timeout:60000},()=>app(async({page,run,broker,url})=>{
  await seed(run,url,{second:true});await action(run);await waitOutput(page,'reading','value',35);
  await action(run,'mqttConnect','config2');await waitOutput(page,'reading2','value',35);
  assert.equal(new Set(broker.stats.connections).size,2,'generated client IDs are distinct');
  await patch(run,'config',{inputValues:{clientId:'changed-explicit-id'}});
  await broker.publish(broker.topics.reading,{value:44});await waitOutput(page,'reading','value',44);await waitOutput(page,'reading2','value',44);
  assert.equal(broker.stats.connections.length,2,'editing the draft does not reconnect');
  await action(run);await waitOutput(page,'reading','value',35);assert.ok(broker.stats.connections.includes('changed-explicit-id'));
  await action(run,'mqttDisconnect');await waitOutput(page,'reading','available',false);
  await broker.publish(broker.topics.reading,{value:67});await waitOutput(page,'reading2','value',67);
  assert.equal((await output(run,'config2')).connected,true,'disconnecting one Config preserves the other');
}));

for(const whole of [false,true])test('MQTT connections follow '+(whole?'Whole workspace':'Active sketch only')+' scope in editor and HTML',{timeout:60000},()=>app(async({page,run,broker,url,context,directory})=>{
  await seed(run,url);
  const tabs=await run(`(async()=>{const settings={...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key==='workspaceSettings').items[0]),uid:'settings',x:50,y:800};settings.state.executionMode=${JSON.stringify(whole?'whole workspace':'active sketch')};items.push(settings);save();const source=activeTabId;newTab();const other=activeTabId;activateTab(source);await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);return {source,other};})()`);
  await action(run);await waitOutput(page,'reading','value',35);
  await run(`activateTab(${JSON.stringify(tabs.other)});resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  await broker.publish(broker.topics.reading,{value:58});
  if(whole)await waitOutput(page,'reading','value',58);
  await run(`activateTab(${JSON.stringify(tabs.source)});resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  assert.equal((await output(run,'reading')).available,whole);
  assert.equal(broker.stats.connections.length,1,'sketch navigation does not replay a manual Connect');
  const connect=await handle(run,'config','connect'),exported=await reader(run,context,directory);
  await readerClick(exported,exported,0,connect);await readerText(exported,1,'35');
  await exported.locator('.tab-select[data-tab-id="'+tabs.other+'"]').click();
  await exported.locator('.tab-panel[data-tab-id="'+tabs.other+'"]').waitFor({state:'visible'});
  await broker.publish(broker.topics.reading,{value:76});
  await exported.locator('.tab-select[data-tab-id="'+tabs.source+'"]').click();await readerReady(exported);
  if(whole)await readerText(exported,1,'76');
  else assert.ok(!(await exported.locator('[data-smart-index="1"]').textContent()).includes('76'));
  assert.equal(broker.stats.connections.length,2,'reader navigation never replays Connect');
}));

test('MQTT pause and hidden-page suspension reconnect without replaying retained action events',{timeout:60000},()=>app(async({page,run,broker,url})=>{
  await seed(run,url,{memo:true});await action(run);await waitOutput(page,'reading','value',35);
  await run("controlComponentSimulation('pause')");await waitOutput(page,'reading','available',false);
  await run("controlComponentSimulation('resume')");await waitOutput(page,'reading','available',true);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await broker.publish(broker.topics.status,'Hidden latest',{retain:true});
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  await waitOutput(page,'text','value','Hidden latest');
  assert.equal(await run("items.find(item=>item.uid==='memo').state.lineCount"),0);
}));

test('MQTT works through real sockets in isolated Run and self-contained HTML, and Return discards the session',{timeout:90000},()=>app(async({page,run,context,directory,broker,url})=>{
  await seed(run,url);const connect=await handle(run,'config','connect'),plus=await handle(run,'control','plus');
  const before=await run('JSON.stringify(items)');const frame=await preview(page);
  assert.doesNotMatch(await page.locator('#runPreviewFrame').getAttribute('sandbox'),/allow-same-origin/);
  assert.equal(broker.stats.connections.length,0,'opening Run does not connect by default');
  await readerClick(page,frame,0,connect,true);await readerText(frame,1,'35');await readerText(frame,2,'Workshop online');
  await readerClick(page,frame,3,plus,true);await readerText(frame,3,'51');
  await broker.publish(broker.topics.reading,{value:79});await readerText(frame,1,'79');
  await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
  assert.equal(await run('JSON.stringify(items)'),before);assert.equal((await output(run,'reading')).available,false);
  const exported=await reader(run,context,directory);assert.equal(broker.stats.connections.length,1,'opening exported HTML does not connect by default');
  await readerClick(exported,exported,0,connect);await readerText(exported,1,'35');
  await broker.publish(broker.topics.status,'Standalone HTML');await readerText(exported,2,'Standalone HTML');
  assert.equal(broker.stats.connections.length,2);assert.equal(new Set(broker.stats.connections).size,2);
}));

test('automatic MQTT Connect is opt-in for Run and HTML and never starts from editor evaluation',{timeout:90000},()=>app(async({page,run,context,directory,broker,url})=>{
  await seed(run,url,{startup:true});assert.equal(broker.stats.connections.length,0);
  const frame=await preview(page);await readerText(frame,1,'35');assert.equal(broker.stats.connections.length,1);
  await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
  assert.equal((await output(run,'reading')).available,false);
  const exported=await reader(run,context,directory);await readerText(exported,1,'35');assert.equal(broker.stats.connections.length,2);
}));

test('networkIntegrations off blocks MQTT Connect in editor, Run and HTML',{timeout:90000},()=>app(async({page,run,context,directory,broker,url})=>{
  await seed(run,url,{startup:true});const connect=await handle(run,'config','connect');
  assert.equal(await action(run),false);const frame=await preview(page);await readerClick(page,frame,0,connect,true);
  await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
  const exported=await reader(run,context,directory);await readerClick(exported,exported,0,connect);
  assert.equal(broker.stats.connections.length,0);
},{settings:{features:{networkIntegrations:false}}}));

test('MQTT credentials stay in host memory and require explicit inclusion in each artifact',{timeout:90000},()=>app(async({page,run,context,directory,broker,url})=>{
  await seed(run,url);const secret='mqtt-session-secret';
  await action(run,'mqttCredentials');const dialog=page.locator('[data-integration-credentials]');await dialog.waitFor();
  await dialog.locator('[data-integration-auth]').selectOption('mqtt');
  await dialog.locator('[data-integration-user]').fill('reader');await dialog.locator('[data-integration-secret]').fill(secret);
  await dialog.locator('[data-integration-save]').click();await dialog.waitFor({state:'detached'});
  assert.equal(broker.stats.connections.length,0,'setting credentials does not connect');
  await action(run);await waitOutput(page,'reading','value',35);
  await run("beginHistory();items.find(item=>item.uid==='control').x+=40;commitHistory();render();");
  await page.keyboard.press('ControlOrMeta+z');await output(run,'config');
  assert.equal(await run("items.find(item=>item.uid==='control').x"),50);
  assert.equal(await run('editorIntegrationCredentials.size'),1,'unrelated history restoration retains the connection credentials');
  assert.equal(broker.stats.connections.length,1,'Undo does not reconnect');
  await action(run);await waitOutput(page,'reading','value',35);
  assert.equal(broker.stats.connections.length,2,'the restored Config authenticates again with the session credentials');
  assert.ok(!(await run('JSON.stringify({undoStack,redoStack})')).includes(secret),'credentials never enter history');
  assert.ok(!(await run('JSON.stringify(items)')).includes(secret));await run('persistWorkspace()');
  assert.ok(!JSON.stringify(await run('readSavedWorkspace()')).includes(secret));
  assert.ok(!(await run('buildWorkspaceHtml(captureWorkspaceHtml())')).includes(secret));
  await action(run,'mqttDisconnect');
  const connect=await handle(run,'config','connect');
  const frame=await preview(page);await readerClick(page,frame,0,connect,true);await readerText(frame,1,'35');
  await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
  await run('void exportHtml()');const chooser=page.locator('[data-integration-export]');await chooser.waitFor();
  assert.equal(await chooser.locator('[data-integration-include]').first().isChecked(),false);
  await chooser.locator('[data-integration-include]').first().check();
  const pending=page.waitForEvent('download');await chooser.locator('[data-integration-export-continue]').click();
  const html=fs.readFileSync(await(await pending).path(),'utf8');assert.ok(html.includes(secret));
  const file=path.join(directory,'authenticated.html');fs.writeFileSync(file,html);
  const exported=await context.newPage();await exported.goto(pathToFileURL(file).href);await readerReady(exported);
  await readerClick(exported,exported,0,connect);await readerText(exported,1,'35');
  await run('void exportWorkspace()');await chooser.waitFor();
  assert.equal(await chooser.locator('[data-integration-include]').first().isChecked(),false,'previous inclusion does not change default');
  await chooser.getByRole('button',{name:'Cancel',exact:true}).click();
},{authenticate:(client,username,password,done)=>done(null,username==='reader'&&password?.toString()==='mqtt-session-secret')}));

test('duplicate sketch remaps its MQTT references and deleting its Config leaves a broken reference',{timeout:60000},()=>app(async({page,run,broker,url})=>{
  await seed(run,url);const original=await run('activeTabId');
  const copy=await run(`(async()=>{duplicateTab();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);return {id:activeTabId,items:items.map(item=>({uid:item.uid,name:item.componentName,binding:item.mqttBinding}))};})()`);
  const config=copy.items.find(item=>item.name==='config'),reading=copy.items.find(item=>item.name==='reading');
  assert.notEqual(config.uid,'config');assert.notEqual(copy.id,original);
  assert.deepEqual(reading.binding,{sketchId:copy.id,componentUid:config.uid});
  await action(run,'mqttConnect',config.uid);await waitOutput(page,reading.uid,'value',35);assert.equal(broker.stats.connections.length,1);
  await run(`beginHistory();items=items.filter(item=>item.uid!==${JSON.stringify(config.uid)});commitHistory();render();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  await waitOutput(page,reading.uid,'available',false);assert.match((await output(run,reading.uid)).error,/missing|choose|config/i);
  await run('undo();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
  assert.equal((await output(run,reading.uid)).available,false);assert.equal(broker.stats.connections.length,1,'Undo does not revive the deleted connection');
}));

test('Edit presents a Config picker and saves a deliberately selected connection reference',{timeout:60000},()=>app(async({page,run,url,broker})=>{
  await seed(run,url);await patch(run,'reading',{mqttBinding:null});
  await run("selection=[1];editingSmartIdx=null;setTool('select');render()");await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open&&!document.querySelector('#componentBindingFields').disabled);
  const ref=await run("JSON.stringify({sketchId:activeTabId,componentUid:'config'})");
  await page.locator('#component-mqtt-config').selectOption(ref);await page.locator('#componentBindingsSave').click();
  await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});
  assert.deepEqual(await run('items[1].mqttBinding'),JSON.parse(ref));assert.equal(broker.stats.connections.length,0);
  await action(run);await waitOutput(page,'reading','value',35);
}));

test('duplicate explicit client IDs cannot evict another Config in the same workspace',{timeout:60000},()=>app(async({page,run,broker,url})=>{
  await seed(run,url,{second:true});await patch(run,'config',{inputValues:{clientId:'deliberate-client'}});await patch(run,'config2',{inputValues:{clientId:'deliberate-client'}});
  await action(run);await waitOutput(page,'reading','value',35);
  assert.equal(await action(run,'mqttConnect','config2'),false);
  assert.equal(broker.stats.connections.length,1);assert.equal((await output(run,'config')).connected,true);
  await broker.publish(broker.topics.reading,{value:62});await waitOutput(page,'reading','value',62);
}));

test('an oversized MQTT packet disconnects without retry storms and leaves the editor usable',{timeout:60000},()=>app(async({page,run,broker,url})=>{
  await seed(run,url);await action(run);await waitOutput(page,'reading','value',35);
  await broker.publish(broker.topics.reading,'x'.repeat(65537));await waitOutput(page,'reading','available',false);
  assert.match((await output(run,'config')).error,/64 KiB|packet|limit/i);
  await patch(run,'control',{state:{value:77}});assert.equal((await output(run,'control')).value,77);
  assert.equal(broker.stats.connections.length,1);
  await action(run);await waitOutput(page,'reading','value',35);assert.equal(broker.stats.connections.length,2,'manual reconnect remains available');
}));

test('queued MQTT events keep the actual topic paired with their captured value',{timeout:60000},()=>app(async({page,run,broker,url})=>{
  await seed(run,url,{memo:true});await patch(run,'text',{inputValues:{topic:'review/+'}});
  await run(`(async()=>{const compose={...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key==='textCompose').items[0]),uid:'compose',x:900,y:420,bindings:{a:{uid:'text',port:'value'},b:{uid:'text',port:'topic'}},inputValues:{separator:':'}};items.push(compose);items.find(item=>item.uid==='memo').bindings={line:{uid:'compose',port:'text'}};editorComponentEvaluation=null;render();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);
  await action(run);await broker.publish('review/baseline','Baseline',{retain:true});await waitOutput(page,'text','value','Baseline');
  await run('smartGestureQueue=smartGestureQueue.then(()=>new Promise(resolve=>window.__releaseMqttQueue=resolve));void 0');
  await page.waitForFunction(()=>typeof window.__releaseMqttQueue==='function');
  await broker.publish('review/first','First');await broker.publish('review/second','Second');
  // Rendering now deliberately waits behind an accepted gesture. Observe transport
  // receipt here; requiring a painted graph while its queue is held would deadlock.
  await page.waitForFunction(()=>__test.run("editorMqttService.peek(items.find(item=>item.uid==='text'),{}).value")==='Second');
  await page.evaluate(()=>window.__releaseMqttQueue());await waitOutput(page,'memo','lineCount',2);
  assert.equal((await output(run,'memo')).text,'First:review/first\nSecond:review/second');
}));

test('continuous MQTT readings leave a larger workspace responsive to a released control click',{timeout:60000},()=>app(async({page,run,broker,url})=>{
  await seed(run,url);
  await run(`(async()=>{
    for(let index=0;index<80;index++)items.push({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key==='gauge').items[0]),
      uid:'gauge-'+index,x:50+(index%8)*150,y:700+Math.floor(index/8)*80,w:130,h:65,bindings:{value:{uid:'reading',port:'value'}}});
    editorComponentEvaluation=null;render();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
  })()`);
  await action(run);await waitOutput(page,'reading','value',35);
  const plus=await handle(run,'control','plus');await run('selection=[3];editingSmartIdx=3;render()');
  const position=await run(`toWorld(items[3],items[3].x+${plus.x},items[3].y+${plus.y})`),box=await page.locator('#canvas').boundingBox();
  const click=()=>page.mouse.click(box.x+position.x,box.y+position.y);
  await click();await page.waitForFunction(()=>__test.run('items[3].state.value')===51);
  // Keep publishing until the interaction has completed. Stopping first would hide the
  // old starvation bug: each sample invalidated the graph needed to accept the click.
  let count=0,started;const streaming=new Promise(resolve=>started=resolve);
  const timer=setInterval(()=>{
    void broker.publish(broker.topics.reading,{value:++count%101}).catch(()=>{});
    if(count===3)started();
  },35);
  try{
    await streaming;await click();
    await page.waitForFunction(()=>__test.run('items[3].state.value')===52,{},{timeout:8000});
    assert.ok(count>=3);assert.equal((await output(run,'config')).connected,true);
  }finally{clearInterval(timer);}
}));

test('new subscribers and changed mappings receive retained-only values without inventing events or extra connections',{timeout:60000},()=>app(async({page,run,broker,url})=>{
  const collectorScript=`({apiVersion:2,eventApi:1,inputs:{},outputs:{count:{type:'number'}},eventInputs:{receive:{type:'number'}},
    compute(inputs,state){return {count:state.count};},onEvent(name,payload,state){return {state:{count:state.count+1}};},
    children(state,style,w,h){return [{type:'text',x:0,y:0,w,h,text:'Events: '+state.count,plainText:true,font:'16px sans-serif',color:'#334155'}];}})`;
  await broker.publish(broker.topics.reading,{value:35,alternate:84},{retain:true});await seed(run,url);
  await run(`(async()=>{items.push({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key==='constant').items[0]),uid:'count-first',x:850,y:420,w:200,h:70,
    script:${JSON.stringify(collectorScript)},state:{count:0},eventBindings:{receive:{uid:'reading',port:'value'}}});
    editorComponentEvaluation=null;render();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);
  await action(run);await waitOutput(page,'reading','value',35);assert.equal((await output(run,'count-first')).count,0);
  await run(`(async()=>{
    items.push({...clone(items.find(item=>item.uid==='reading')),uid:'reading-new',x:450,y:700},
      {...clone(items.find(item=>item.uid==='count-first')),uid:'count-new',x:850,y:700,eventBindings:{receive:{uid:'reading-new',port:'value'}}});
    editorComponentEvaluation=null;render();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
  })()`);
  await waitOutput(page,'reading-new','value',35);
  assert.equal((await output(run,'count-first')).count,0);assert.equal((await output(run,'count-new')).count,0);
  await patch(run,'reading-new',{inputValues:{path:'/alternate'}});await waitOutput(page,'reading-new','value',84);
  assert.equal((await output(run,'reading')).value,35);
  assert.equal((await output(run,'count-first')).count,0);assert.equal((await output(run,'count-new')).count,0);
  assert.equal(broker.stats.connections.length,1,'resubscribing retains the shared connection');
  await broker.publish(broker.topics.reading,{value:36,alternate:85});
  await waitOutput(page,'count-first','count',1);await waitOutput(page,'count-new','count',1);
  assert.equal((await output(run,'reading-new')).value,85,'later live messages still emit for both subscribers');
}));
