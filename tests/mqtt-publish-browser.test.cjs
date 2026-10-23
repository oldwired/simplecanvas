const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const {createPublishBroker}=require('./helpers/mqtt-publish-broker.cjs');
const {createMosquitto}=require('./helpers/mosquitto.cjs');
const root=path.join(__dirname,'..'),command='simplecanvas/test/command',reading='simplecanvas/test/reading';
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>browser?.close());
const collector=`({apiVersion:2,eventApi:1,inputs:{},outputs:{count:{type:'number'}},eventInputs:{receive:{type:'string'}},
  initState(){return {values:[]};},compute(inputs,state){return {count:state.values.length};},
  onEvent(name,payload,state){return {state:{values:[...state.values,payload]}};},
  children(state,style,w,h){return [{type:'text',x:0,y:0,w,h,text:'Events: '+state.values.length,plainText:true,font:'16px sans-serif',color:'#334155'}];}})`;

async function app(fn,{mosquitto=false,authenticated=false}={}){
  const broker=mosquitto?await createMosquitto({authenticated}):await createPublishBroker();
  const context=await browser.newContext({viewport:{width:1700,height:1200}}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-mqtt-send-')),errors=[];
  const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
  const server=http.createServer((request,response)=>{response.writeHead(request.url==='/index.html'?200:404,{'Content-Type':'text/html','Cache-Control':'no-store'});response.end(request.url==='/index.html'?html:'');});
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+server.address().port;
    if((process.env.BROWSER_ENGINE||'chromium')==='chromium')await context.grantPermissions(['local-network-access'],{origin});
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await broker.publish(reading,{value:35},{retain:true});
    const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());await page.goto(origin+'/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);await run('appStarted');
    await fn({page,run,context,directory,broker});assert.deepEqual(errors,[],'editor, Run and downloaded HTML have no uncaught errors');
  }finally{await context.close();await broker.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
}
async function seed(run,url,extra={}, {initialHigh=false}={}){
  await run(`(async()=>{cancelGesture();const make=(key,uid,x,y,extra={})=>{const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]);return {...item,uid,componentName:uid,x,y,...extra,state:{...item.state,...extra.state},inputValues:{...item.inputValues,...extra.inputValues}};};
    items=[make('mqttConfig','config',50,60,{inputValues:{url:${JSON.stringify(url)}}}),
      make('mqttPublish','send',450,60,{inputValues:{topic:${JSON.stringify(command)},payload:'hello'},...${JSON.stringify(extra)}}),
      make('mqttSubscribe','reading',850,60,{state:{format:'json',valueType:'number'},inputValues:{topic:${JSON.stringify(reading)},path:'/value'}}),
      make('numberControl','control',50,420),
      make('constant','completed',450,420,{script:${JSON.stringify(collector)},state:{values:[]},w:300,h:70,eventBindings:{receive:{uid:'send',port:'completed'}}}),
      make('constant','failed',850,420,{script:${JSON.stringify(collector)},state:{values:[]},w:300,h:70,eventBindings:{receive:{uid:'send',port:'failed'}}}),
      make('jsonBuild','json',50,720,{inputValues:{field0:'Anna',field1:12}}),
      make('toggle','toggle',450,720,{state:{value:${initialHigh}}}),make('textInput','text',850,720)];
    items[1].mqttBinding=items[2].mqttBinding={sketchId:activeTabId,componentUid:'config'};
    datasets={};selection=[];editingSmartIdx=null;setTool('select');render();save();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);undoStack=[];redoStack=[];await persistWorkspace();})()`);
}
async function output(run,uid){return run(`(async()=>{const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);return graph.get(items.find(item=>item.uid===${JSON.stringify(uid)}))?.io.outputs;})()`);}
async function waitOutput(page,uid,key,value){await page.waitForFunction(({uid,key,value})=>__test.run(`editorComponentEvaluation?.records?.get(items.find(item=>item.uid===${JSON.stringify(uid)}))?.io.outputs[${JSON.stringify(key)}]`)===value,{uid,key,value});}
async function patch(run,uid,changes){await run(`(async()=>{const item=items.find(item=>item.uid===${JSON.stringify(uid)}),changes=${JSON.stringify(changes)};for(const [key,value] of Object.entries(changes))item[key]=['state','inputValues'].includes(key)?{...item[key],...value}:value;editorComponentEvaluation=null;render();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);}
async function action(run,uid,type){return run(`openEditorComponentDataAction(items.find(item=>item.uid===${JSON.stringify(uid)}),{type:${JSON.stringify(type)}},()=>true)`);}
async function handle(run,uid,id){return run(`(async()=>{const item=items.find(item=>item.uid===${JSON.stringify(uid)}),io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id===${JSON.stringify(id)});})()`);}
async function click(page,run,uid,id){
  await run(`selection=[items.findIndex(item=>item.uid===${JSON.stringify(uid)})];editingSmartIdx=selection[0];render()`);
  const h=await handle(run,uid,id);assert.ok(h,id+' handle exists');const point=await run(`(()=>{const item=items.find(item=>item.uid===${JSON.stringify(uid)});return toWorld(item,item.x+${h.x},item.y+${h.y});})()`),box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+point.x,box.y+point.y);await run('smartHitSettled');
}
async function logs(page,run,uid,count){await waitOutput(page,uid,'count',count);return run(`items.find(item=>item.uid===${JSON.stringify(uid)}).state.values`);}
async function connect(page,run){await action(run,'config','mqttConnect');await waitOutput(page,'reading','value',35);}
async function readerReady(frame,index=0){await frame.locator('[data-smart-index="'+index+'"][data-smart-ready="true"]').waitFor();}
async function readerText(frame,index,text){await frame.waitForFunction(({index,text})=>document.querySelector('[data-smart-index="'+index+'"]')?.dataset.smartReady==='true'&&[...document.querySelectorAll('[data-smart-index="'+index+'"] text')].some(node=>node.textContent===text),{index,text});}
async function readerClick(page,frame,index,h,preview=false){assert.ok(h);await readerReady(frame,index);const p=await frame.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},h);const offset=preview?await page.locator('#runPreviewFrame').boundingBox():{x:0,y:0};await page.mouse.click(offset.x+p.x,offset.y+p.y);}
async function preview(page){await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();const frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await readerReady(frame);return frame;}
async function exitPreview(page){await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});}
async function reader(fixture,{credentials=false}={}){
  const {page,run,context,directory}=fixture,pending=page.waitForEvent('download');await run('void exportHtml()');
  if(credentials){const dialog=page.locator('[data-integration-export]');await dialog.waitFor();assert.equal(await dialog.locator('[data-integration-include]').first().isChecked(),false);await dialog.locator('[data-integration-include]').first().check();await dialog.locator('[data-integration-export-continue]').click();}
  const html=fs.readFileSync(await(await pending).path(),'utf8'),file=path.join(directory,'publish.html');fs.writeFileSync(file,html);const exported=await context.newPage();await exported.goto(pathToFileURL(file).href);await readerReady(exported);return exported;
}
async function credentials(page,run,broker){await action(run,'config','mqttCredentials');const dialog=page.locator('[data-integration-credentials]');await dialog.waitFor();await dialog.locator('[data-integration-auth]').selectOption('mqtt');await dialog.locator('[data-integration-user]').fill(broker.credentials.username);await dialog.locator('[data-integration-secret]').fill(broker.credentials.password);await dialog.locator('[data-integration-save]').click();await dialog.waitFor({state:'detached'});}

// Assertions deliberately wait on transport receipt/PUBACK-derived outputs, never arbitrary sleeps.
test('MQTT Publish captures JSON, stays responsive while PUBACK is pending, and never repeats from redraw/history', {timeout:90000},()=>app(async({page,run,broker})=>{
  await seed(run,broker.url,{state:{format:'json'},bindings:{payload:{uid:'json',port:'text'}}});await connect(page,run);assert.equal(broker.publications.length,0);
  const gate=broker.holdNext();await click(page,run,'send','send');const sent=await gate.received;
  assert.deepEqual(JSON.parse(sent.payload),{name:'Anna',value:12});assert.equal(sent.qos,1);assert.equal(sent.retain,false);await waitOutput(page,'send','loading',true);
  await click(page,run,'send','send');assert.equal(broker.publications.length,1,'pending Send cannot create another publication');await logs(page,run,'failed',1);
  await click(page,run,'control','plus');await waitOutput(page,'control','value',51);
  await broker.publish(reading,{value:72});await waitOutput(page,'reading','value',72);assert.equal(broker.connections.length,1,'sending does not open another Config connection');
  await patch(run,'json',{inputValues:{field0:'Bea',field1:18}});assert.deepEqual(JSON.parse(sent.payload),{name:'Anna',value:12});
  gate.release();assert.deepEqual(await logs(page,run,'completed',1),[sent.payload]);await waitOutput(page,'send','loading',false);assert.equal((await output(run,'send')).status,'ready');
  await run('render();persistWorkspace();undo();redo();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');assert.equal(broker.publications.length,1);
  await page.reload();await run('appStarted');await output(run,'send');assert.equal(broker.publications.length,1,'reload cannot send');
}));

test('MQTT Publish accepts pulse and captured text events, rejects disconnected sends, and does not replay on reconnect', {timeout:90000},()=>app(async({page,run,broker})=>{
  await seed(run,broker.url,{bindings:{send:{uid:'toggle',port:'value'}}},{initialHigh:true});await connect(page,run);assert.equal(broker.publications.length,0,'initial high Send is a baseline');
  await patch(run,'toggle',{state:{value:false}});await patch(run,'toggle',{state:{value:true}});await logs(page,run,'completed',1);assert.equal(broker.publications.length,1);
  await patch(run,'send',{bindings:{payload:{uid:'text',port:'value'}},eventBindings:{send:{uid:'text',port:'value'}}});
  await click(page,run,'text','entry');const input=page.locator('[data-smart-inline-input] #smartTextValue');await input.waitFor();
  for(let count=2;count<=3;count++){await input.fill('Same command');await input.press('Enter');await logs(page,run,'completed',count);}
  await input.press('Escape');await input.waitFor({state:'detached'});assert.deepEqual(broker.publications.slice(1).map(call=>call.payload),['Same command','Same command']);
  await action(run,'config','mqttDisconnect');await action(run,'send','mqttPublish');await logs(page,run,'failed',1);assert.equal(broker.publications.length,3);
  await connect(page,run);assert.equal(broker.publications.length,3,'Connect cannot flush a disconnected Send');
  await broker.publish(reading,{value:88});await waitOutput(page,'reading','value',88);assert.equal(broker.publications.length,3);
}));

test('MQTT Publish times out without replay or late completion and leaves shared subscriptions usable', {timeout:90000},()=>app(async({page,run,broker})=>{
  await seed(run,broker.url,{state:{timeoutSeconds:1}});await connect(page,run);const gate=broker.holdNext();await action(run,'send','mqttPublish');await gate.received;
  assert.match((await logs(page,run,'failed',1))[0],/unknown|acknowledg|timeout/i);await waitOutput(page,'send','loading',false);
  gate.release();await broker.publish(reading,{value:64});await waitOutput(page,'reading','value',64);assert.deepEqual(await run("items.find(item=>item.uid==='completed').state.values"),[]);
  await action(run,'send','mqttPublish');await logs(page,run,'completed',1);assert.equal(broker.publications.length,2);assert.equal(broker.connections.length,1);
  await action(run,'config','mqttDisconnect');await connect(page,run);assert.equal(broker.publications.length,2,'retiring the session cannot replay timed-out commands');
}));

test('MQTT Publish works in isolated Run and freshly exported HTML, with session changes discarded', {timeout:90000},()=>app(async(fixture)=>{
  const {page,run,broker}=fixture;await seed(run,broker.url);const connectHandle=await handle(run,'config','connect'),send=await handle(run,'send','send'),plus=await handle(run,'control','plus');const before=await run('JSON.stringify(items)');
  const frame=await preview(page);assert.doesNotMatch(await page.locator('#runPreviewFrame').getAttribute('sandbox'),/allow-same-origin/);
  await readerClick(page,frame,0,connectHandle,true);await readerText(frame,2,'35');await readerClick(page,frame,1,send,true);await readerText(frame,4,'Events: 1');
  assert.equal(broker.publications.length,1);assert.equal(broker.publications[0].payload,'hello');await readerClick(page,frame,3,plus,true);await readerText(frame,3,'51');
  await exitPreview(page);assert.equal(await run('JSON.stringify(items)'),before);
  const exported=await reader(fixture);assert.equal(broker.publications.length,1,'downloaded HTML never sends on startup');await readerClick(exported,exported,0,connectHandle);await readerText(exported,2,'35');
  await readerClick(exported,exported,1,send);await readerText(exported,4,'Events: 1');assert.equal(broker.publications.length,2);
  await exported.reload();await readerReady(exported);assert.equal(broker.publications.length,2,'reload does not resend');
}));

test('MQTT Publish returning from Run retires an unacknowledged send without reviving it', {timeout:90000},()=>app(async({page,run,broker})=>{
  await seed(run,broker.url);const connectHandle=await handle(run,'config','connect'),send=await handle(run,'send','send');const frame=await preview(page);
  await readerClick(page,frame,0,connectHandle,true);await readerText(frame,2,'35');const gate=broker.holdNext();await readerClick(page,frame,1,send,true);await gate.received;
  await exitPreview(page);gate.release();assert.deepEqual(await run("items.find(item=>item.uid==='completed').state.values"),[]);
  const next=await preview(page);await readerClick(page,next,0,connectHandle,true);await readerText(next,2,'35');assert.equal(broker.publications.length,1,'new Run never inherits pending writes');await exitPreview(page);
}));

async function observeMosquitto(broker){
  const publications=[],waiters=new Set();broker.client.on('message',(topic,payload,packet)=>{if(topic===command){publications.push({topic,payload:payload.toString(),qos:packet.qos,retain:packet.retain});for(const waiter of [...waiters])if(publications.length>=waiter.count)waiter.finish();}});
  publications.waitFor=count=>publications.length>=count?Promise.resolve():new Promise((resolve,reject)=>{const waiter={count,finish(error){clearTimeout(timer);waiters.delete(waiter);error?reject(error):resolve();}},timer=setTimeout(()=>waiter.finish(new Error('No observed MQTT publication '+count)),10000);waiters.add(waiter);});
  await new Promise((resolve,reject)=>broker.client.subscribe(command,{qos:1},error=>error?reject(error):resolve()));return publications;
}
const mosquittoOptions={timeout:90000,skip:process.env.MOSQUITTO_BIN?false:'Set MOSQUITTO_BIN for MQTT Publish compatibility checks'};
test('Mosquitto: Publish acknowledges explicit editor commands and supports intentional retained payloads',mosquittoOptions,()=>app(async({page,run,broker})=>{
  const publications=await observeMosquitto(broker);await seed(run,broker.url);await connect(page,run);await click(page,run,'send','send');await logs(page,run,'completed',1);
  await publications.waitFor(1);assert.equal(publications.length,1);assert.equal(publications[0].payload,'hello');assert.equal(publications[0].qos,1);assert.equal(publications[0].retain,false);
  await patch(run,'send',{state:{retain:true},inputValues:{payload:'Retained command'}});await click(page,run,'send','send');await logs(page,run,'completed',2);
  await publications.waitFor(2);await new Promise((resolve,reject)=>broker.client.unsubscribe(command,error=>error?reject(error):resolve()));
  const retained=new Promise(resolve=>broker.client.once('message',(topic,payload,packet)=>resolve({topic,payload:payload.toString(),retain:packet.retain})));
  await new Promise((resolve,reject)=>broker.client.subscribe(command,{qos:1},error=>error?reject(error):resolve()));assert.deepEqual(await retained,{topic:command,payload:'Retained command',retain:true});
},{mosquitto:true}));

test('Mosquitto: authenticated Publish works in Run and downloaded HTML through shared Config credentials',{
  ...mosquittoOptions,skip:!process.env.MOSQUITTO_BIN?mosquittoOptions.skip:!process.env.MOSQUITTO_PASSWD?'Set MOSQUITTO_PASSWD for authenticated Publish':false
},()=>app(async(fixture)=>{
  const {page,run,broker}=fixture,publications=await observeMosquitto(broker);await seed(run,broker.url);await credentials(page,run,broker);const connectHandle=await handle(run,'config','connect'),send=await handle(run,'send','send');
  const frame=await preview(page);await readerClick(page,frame,0,connectHandle,true);await readerText(frame,2,'35');await readerClick(page,frame,1,send,true);await readerText(frame,4,'Events: 1');await exitPreview(page);
  await publications.waitFor(1);assert.equal(publications.length,1);assert.deepEqual(await run("items.find(item=>item.uid==='completed').state.values"),[]);
  const exported=await reader(fixture,{credentials:true});await readerClick(exported,exported,0,connectHandle);await readerText(exported,2,'35');await readerClick(exported,exported,1,send);await readerText(exported,4,'Events: 1');await publications.waitFor(2);assert.equal(publications.length,2);
},{mosquitto:true,authenticated:true}));

test('MQTT Subscribe retained baselines never trigger Publish, while a fresh JSON event sends its captured payload', {timeout:90000},()=>app(async({page,run,broker})=>{
  await seed(run,broker.url,{bindings:{payload:{uid:'reading',port:'json'}},eventBindings:{send:{uid:'reading',port:'json'}}});
  await connect(page,run);assert.equal(broker.publications.length,0,'retained data initializes values without an action');
  await broker.publish(reading,{value:71});await logs(page,run,'completed',1);assert.equal(broker.publications.length,1);assert.equal(broker.publications[0].payload,'{"value":71}');
  broker.dropClients();await waitOutput(page,'reading','available',false);await waitOutput(page,'reading','value',35);
  assert.equal(broker.publications.length,1,'retained reconnect data never replays a publication');
}));

test('MQTT Publish Edit selects a shared Config on another sketch without connecting or sending', {timeout:90000},()=>app(async({page,run,broker})=>{
  await seed(run,broker.url);
  const tabs=await run(`(async()=>{
    const settings={...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key==='workspaceSettings').items[0]),uid:'settings',x:50,y:950};
    settings.state.executionMode='whole workspace';items.push(settings);const config=items.shift(),publisher=activeTabId;save();
    newTab();const connection=activeTabId;items=[config];save();activateTab(publisher);
    await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);return {publisher,connection};
  })()`);
  await patch(run,'send',{mqttBinding:null});
  await run("selection=[items.findIndex(item=>item.uid==='send')];editingSmartIdx=null;setTool('select');render()");
  await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open&&!document.querySelector('#componentBindingFields').disabled);
  const ref={sketchId:tabs.connection,componentUid:'config'};
  await page.locator('#component-mqtt-config').selectOption(JSON.stringify(ref));await page.locator('#componentBindingsSave').click();
  await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});
  assert.deepEqual(await run("items.find(item=>item.uid==='send').mqttBinding"),ref);
  assert.equal(broker.connections.length,0,'choosing a Config does not connect');assert.equal(broker.publications.length,0,'saving Edit never sends');
  await run(`activateTab(${JSON.stringify(tabs.connection)});resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  await action(run,'config','mqttConnect');await waitOutput(page,'config','connected',true);
  await run(`activateTab(${JSON.stringify(tabs.publisher)});resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  await action(run,'send','mqttPublish');assert.deepEqual(await logs(page,run,'completed',1),['hello']);
  assert.equal(broker.connections.length,1);assert.equal(broker.publications.length,1);
}));

test('deleting Config and Undo retire a pending Publish; restoring it requires a new Connect and Send', {timeout:90000},()=>app(async({page,run,broker})=>{
  await seed(run,broker.url);await connect(page,run);const gate=broker.holdNext();await action(run,'send','mqttPublish');await gate.received;
  await run("beginHistory();items=items.filter(item=>item.uid!=='config');commitHistory();render();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)");
  await waitOutput(page,'reading','available',false);gate.release();
  assert.deepEqual(await run("items.find(item=>item.uid==='completed').state.values"),[]);
  await run('undo();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
  assert.equal((await output(run,'reading')).available,false);assert.equal(broker.connections.length,1,'Undo never revives a socket');
  assert.equal(broker.publications.length,1);assert.deepEqual(await run("items.find(item=>item.uid==='completed').state.values"),[]);
  await connect(page,run);assert.equal(broker.publications.length,1,'reconnecting the restored Config never replays the pending Send');
  await action(run,'send','mqttPublish');assert.deepEqual(await logs(page,run,'completed',1),['hello']);assert.equal(broker.publications.length,2);
}));

test('hiding editor or HTML during Publish delivers one unknown-outcome failure on return without replay', {timeout:90000},()=>app(async(fixture)=>{
  const {page,run,broker}=fixture;
  const visible=async(target,value)=>target.evaluate(value=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>!value});document.dispatchEvent(new Event('visibilitychange'));
  },value);
  await seed(run,broker.url);await connect(page,run);const first=broker.holdNext();await action(run,'send','mqttPublish');await first.received;
  await visible(page,false);first.release();await broker.publish(reading,{value:57},{retain:true});await visible(page,true);
  assert.match((await logs(page,run,'failed',1))[0],/unknown/i);await waitOutput(page,'reading','value',57);
  assert.deepEqual(await run("items.find(item=>item.uid==='completed').state.values"),[]);
  assert.equal(broker.publications.length,1,'visibility resume never replays the editor Send');
  assert.equal((await output(run,'failed')).count,1,'later graph refreshes do not duplicate failure');

  await patch(run,'failed',{state:{values:[]}});
  const connectHandle=await handle(run,'config','connect'),send=await handle(run,'send','send'),exported=await reader(fixture);
  await readerClick(exported,exported,0,connectHandle);await readerText(exported,2,'57');
  const second=broker.holdNext();await readerClick(exported,exported,1,send);await second.received;
  await visible(exported,false);second.release();await broker.publish(reading,{value:84},{retain:true});await visible(exported,true);
  await readerText(exported,5,'Events: 1');await readerText(exported,2,'84');await readerText(exported,4,'Events: 0');
  assert.equal(broker.publications.length,2,'visibility resume never replays the HTML Send');await readerText(exported,5,'Events: 1');
}));
