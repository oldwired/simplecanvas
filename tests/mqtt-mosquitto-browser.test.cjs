// Optional real-broker compatibility suite:
// MOSQUITTO_BIN=/path/to/mosquitto MOSQUITTO_PASSWD=/path/to/mosquitto_passwd node --test tests/mqtt-mosquitto-browser.test.cjs
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const {createMosquitto}=require('./helpers/mosquitto.cjs');
const root=path.join(__dirname,'..'),enabled=Boolean(process.env.MOSQUITTO_BIN);
const reading='simplecanvas/mosquitto/reading',status='simplecanvas/mosquitto/status';
const options={skip:enabled?false:'Set MOSQUITTO_BIN to run the optional Mosquitto compatibility suite',timeout:90000};
let browser;
before(async()=>{if(enabled)browser=await launchBrowser();});
after(async()=>browser?.close());

async function app(fn,{authenticated=false}={}){
  const broker=await createMosquitto({authenticated}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-mosquitto-browser-'));
  const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
  const server=http.createServer((request,response)=>{const index=request.url==='/index.html';response.writeHead(index?200:404,{'Content-Type':'text/html','Cache-Control':'no-store'});response.end(index?html:'');});
  const context=await browser.newContext({viewport:{width:1700,height:1150}}),errors=[];
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+server.address().port;
    if((process.env.BROWSER_ENGINE||'chromium')==='chromium')await context.grantPermissions(['local-network-access'],{origin});
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await baseline(broker);
    const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());await page.goto(origin+'/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);await run('appStarted');
    await fn({page,run,context,directory,broker});
    assert.deepEqual(errors,[],'no uncaught errors in editor, Run or exported HTML');
  }finally{
    await context.close();await broker.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});
  }
}
async function baseline(broker){await broker.publish(reading,{value:35,name:'Mosquitto',alternate:84},{retain:true});await broker.publish(status,'Broker ready',{retain:true});}
async function seed(run,url,{startup=false}={}){
  await run(`(async()=>{
    cancelGesture();const make=(key,uid,x,y,extra={})=>{const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]);return {...item,uid,componentName:uid,x,y,...extra,state:{...item.state,...extra.state},inputValues:{...item.inputValues,...extra.inputValues}};};
    items=[make('mqttConfig','config',50,60,{state:{connectOnStart:${startup}},inputValues:{url:${JSON.stringify(url)},clientId:''}}),
      make('mqttSubscribe','reading',450,60,{state:{format:'json',valueType:'number'},inputValues:{topic:${JSON.stringify(reading)},path:'/value'},mqttBinding:{sketchId:activeTabId,componentUid:'config'}}),
      make('mqttSubscribe','text',850,60,{state:{format:'text',valueType:'string'},inputValues:{topic:${JSON.stringify(status)},path:''},mqttBinding:{sketchId:activeTabId,componentUid:'config'}}),
      make('numberControl','control',50,420),make('memo','memo',450,420,{bindings:{line:{uid:'text',port:'value'}}}),
      make('valueLabel','count',850,420,{bindings:{value:{uid:'memo',port:'lineCount'}}}),
      make('textLabel','json',50,740,{w:1000,h:100,bindings:{value:{uid:'reading',port:'json'}}})];
    datasets={};selection=[];editingSmartIdx=null;setTool('select');render();save();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);undoStack=[];redoStack=[];await persistWorkspace();
  })()`);
}
async function action(run,type='mqttConnect'){return run(`openEditorComponentDataAction(items[0],{type:${JSON.stringify(type)}},()=>true)`);}
async function output(run,uid){return run(`(async()=>{const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);return graph.get(items.find(item=>item.uid===${JSON.stringify(uid)}))?.io.outputs;})()`);}
async function waitOutput(page,uid,key,value){await page.waitForFunction(({uid,key,value})=>__test.run(`editorComponentEvaluation?.records?.get(items.find(item=>item.uid===${JSON.stringify(uid)}))?.io.outputs[${JSON.stringify(key)}]`)===value,{uid,key,value});}
async function handle(run,index,id){return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id===${JSON.stringify(id)});})()`);}
async function readerReady(frame,index=0){await frame.locator('[data-smart-index="'+index+'"][data-smart-ready="true"]').waitFor();}
async function readerText(frame,index,text){await frame.waitForFunction(({index,text})=>document.querySelector('[data-smart-index="'+index+'"]')?.dataset.smartReady==='true'&&[...document.querySelectorAll('[data-smart-index="'+index+'"] text')].some(node=>node.textContent===text),{index,text});}
async function readerClick(page,frame,index,h,preview=false){
  assert.ok(h);await readerReady(frame,index);
  const p=await frame.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},h);
  const offset=preview?await page.locator('#runPreviewFrame').boundingBox():{x:0,y:0};await page.mouse.click(offset.x+p.x,offset.y+p.y);
}
async function preview(page){await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();const frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await readerReady(frame);return frame;}
async function exitPreview(page){await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});}
async function exportedReader({page,run,context,directory},{credentials=false}={}){
  const pending=page.waitForEvent('download');await run('void exportHtml()');
  if(credentials){const dialog=page.locator('[data-integration-export]');await dialog.waitFor();assert.equal(await dialog.locator('[data-integration-include]').first().isChecked(),false);await dialog.locator('[data-integration-include]').first().check();await dialog.locator('[data-integration-export-continue]').click();}
  const text=fs.readFileSync(await(await pending).path(),'utf8'),file=path.join(directory,'mosquitto.html');fs.writeFileSync(file,text);
  assert.ok(text.includes('function componentMqttClientLibrary('),'download includes bundled MQTT client');
  const reader=await context.newPage(),requests=[];reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);await readerReady(reader);return {reader,text,requests};
}

test('Mosquitto: editor shares one connection, receives typed/JSON values, and reconnects without retained event replay',options,()=>app(async({page,run,broker})=>{
  await seed(run,broker.url);assert.deepEqual(broker.browserConnections(),[],'editor opening never connects');
  const before=await run('JSON.stringify({items,undoStack,redoStack})');await action(run);
  await waitOutput(page,'reading','value',35);await waitOutput(page,'text','value','Broker ready');
  assert.deepEqual(JSON.parse((await output(run,'reading')).json),{value:35,name:'Mosquitto',alternate:84});
  assert.equal((await output(run,'memo')).lineCount,0);assert.equal(broker.browserConnections().length,1,'numeric/text subscribers share one socket');
  assert.equal(await run('JSON.stringify({items,undoStack,redoStack})'),before,'retained data does not enter source state or history');
  for(let count=1;count<=2;count++){await broker.publish(status,'Equal live message',{retain:true});await waitOutput(page,'memo','lineCount',count);}
  // Mosquitto must resend a retained packet when a new consumer joins the same filter.
  await run(`(async()=>{items.push({...clone(items[1]),uid:'second',x:1150,y:740,inputValues:{...items[1].inputValues,path:'/alternate'}});editorComponentEvaluation=null;render();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);
  await waitOutput(page,'second','value',84);assert.equal(broker.browserConnections().length,1);
  await broker.stop();await waitOutput(page,'reading','available',false);assert.equal((await output(run,'reading')).stale,true);
  await broker.start();await baseline(broker);await waitOutput(page,'reading','value',35);await waitOutput(page,'text','value','Broker ready');
  assert.equal((await output(run,'memo')).lineCount,2,'reconnect retained baselines do not append actions');
  await broker.publish(status,'After restart');await waitOutput(page,'memo','lineCount',3);
  assert.equal(broker.browserConnections().length,2);
}));

test('Mosquitto: isolated Run and a freshly downloaded file HTML both receive live readings and events',options,()=>app(async(fixture)=>{
  const {page,run,broker}=fixture;await seed(run,broker.url);const connect=await handle(run,0,'connect'),plus=await handle(run,3,'plus');
  const before=await run('JSON.stringify(items)'),frame=await preview(page);
  assert.doesNotMatch(await page.locator('#runPreviewFrame').getAttribute('sandbox'),/allow-same-origin/);assert.equal(broker.browserConnections().length,0);
  await readerClick(page,frame,0,connect,true);await readerText(frame,1,'35');await readerText(frame,2,'Broker ready');await readerText(frame,5,'0');
  await readerText(frame,6,'{"value":35,"name":"Mosquitto","alternate":84}');
  await readerClick(page,frame,3,plus,true);await readerText(frame,3,'51');
  await broker.publish(reading,{value:71,name:'Run'});await readerText(frame,1,'71');
  for(let count=1;count<=2;count++){await broker.publish(status,'Run message');await readerText(frame,5,String(count));}
  await exitPreview(page);assert.equal(await run('JSON.stringify(items)'),before,'Run edits and event log are discarded');
  const {reader,requests}=await exportedReader(fixture);assert.equal(broker.browserConnections().length,1,'downloaded HTML remains manual by default');
  await readerClick(reader,reader,0,connect);await readerText(reader,1,'35');await readerText(reader,5,'0');
  await broker.publish(reading,{value:89,name:'Export'});await readerText(reader,1,'89');await readerText(reader,6,'{"value":89,"name":"Export"}');
  for(let count=1;count<=2;count++){await broker.publish(status,'Export message');await readerText(reader,5,String(count));}
  assert.equal(new Set(broker.browserConnections()).size,2,'Run and HTML have separate generated client IDs');assert.deepEqual(requests,[],'the downloaded HTML loads no external client script');
}));

test('Mosquitto: startup connection is opt-in in Run and downloaded HTML, never editor startup',options,()=>app(async(fixture)=>{
  const {page,run,broker}=fixture;await seed(run,broker.url,{startup:true});assert.equal(broker.browserConnections().length,0);
  const frame=await preview(page);await readerText(frame,1,'35');await readerText(frame,5,'0');await exitPreview(page);
  const {reader}=await exportedReader(fixture);await readerText(reader,1,'35');await readerText(reader,5,'0');
  assert.equal(broker.browserConnections().length,2);assert.equal((await output(run,'reading')).available,false);
}));

test('Mosquitto: password authentication works in editor, Run and explicitly credentialled HTML',{
  ...options,skip:!enabled?options.skip:!process.env.MOSQUITTO_PASSWD?'Set MOSQUITTO_PASSWD to test broker authentication':false
},()=>app(async(fixture)=>{
  const {page,run,broker}=fixture;await seed(run,broker.url);
  await action(run,'mqttCredentials');const dialog=page.locator('[data-integration-credentials]');await dialog.waitFor();
  await dialog.locator('[data-integration-auth]').selectOption('mqtt');await dialog.locator('[data-integration-user]').fill(broker.credentials.username);await dialog.locator('[data-integration-secret]').fill(broker.credentials.password);
  await dialog.locator('[data-integration-save]').click();await dialog.waitFor({state:'detached'});await action(run);await waitOutput(page,'reading','value',35);
  assert.ok(!(await run('JSON.stringify(items)')).includes(broker.credentials.password));assert.ok(!(await run('buildWorkspaceHtml(captureWorkspaceHtml())')).includes(broker.credentials.password));
  await action(run,'mqttDisconnect');const connect=await handle(run,0,'connect'),frame=await preview(page);
  await readerClick(page,frame,0,connect,true);await readerText(frame,1,'35');await exitPreview(page);
  const {reader,text}=await exportedReader(fixture,{credentials:true});assert.ok(text.includes(broker.credentials.password));
  await readerClick(reader,reader,0,connect);await readerText(reader,1,'35');await broker.publish(reading,{value:93,name:'Authenticated'});await readerText(reader,1,'93');
},{authenticated:true}));
