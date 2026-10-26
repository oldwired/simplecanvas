const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const {createMqttExampleServer}=require('../tools/serve-mqtt-example.cjs');
const html=parseApp(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>browser?.close());
async function app(fn){
  const broker=await createMqttExampleServer({interval:0});
  await new Promise((resolve,reject)=>{broker.server.once('error',reject);broker.server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+broker.server.address().port,context=await browser.newContext({viewport:{width:1500,height:1050}}),errors=[];
  let requests=0,response={value:37,items:[{name:'Snapshot fruit',quantity:12}]},status=200;
  try{
    if((process.env.BROWSER_ENGINE||'chromium')==='chromium')await context.grantPermissions(['local-network-access'],{origin});
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.route(origin+'/index.html',route=>route.fulfill({contentType:'text/html',body:html}));
    await context.route(origin+'/static-reading',route=>{requests++;return route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(response)});});
    const page=await context.newPage();await page.goto(origin+'/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');
    await run(`window.make=(key,uid,x,y,extra={})=>{const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]);return {...base,uid,componentName:uid,x,y,...extra,state:{...base.state,...extra.state},inputValues:{...base.inputValues,...extra.inputValues}};}`);
    await fn({page,run,context,origin,broker,requests:()=>requests,setResponse:(value,code=200)=>{response=value;status=code;}});
    assert.deepEqual(errors,[],'no uncaught editor or reader errors');
  }finally{await context.close();await broker.close();}
}
async function seedHttp(run,origin,{table=true}={}){
  await run(`items=[make('httpSource','http',30,30,{inputValues:{url:${JSON.stringify(origin+'/static-reading')},path:'/value'}}),
    make('valueLabel','value',420,30,{bindings:{value:{uid:'http',port:'value'}}})
    ${table?`,make('httpSource','rows',30,310,{state:{valueType:'table'},inputValues:{url:${JSON.stringify(origin+'/static-reading')},path:'/items'}}),
    make('dataTable','table',420,310,{bindings:{data:{uid:'rows',port:'value'}}})`:''}];
    datasets={};selection=[];render();save();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);`);
  await refresh(run,'http');if(table)await refresh(run,'rows');
}
async function refresh(run,uid){await run(`openEditorComponentDataAction(items.find(item=>item.uid===${JSON.stringify(uid)}),{type:'httpGet'},()=>true)`);}
async function waitOutput(page,uid,key,value){await page.waitForFunction(({uid,key,value})=>__test.run(`editorComponentEvaluation?.records?.get(editorRuntimeContext().scene.find(item=>item.uid===${JSON.stringify(uid)}))?.io.outputs[${JSON.stringify(key)}]`)===value,{uid,key,value});}
async function downloadedSvg(page,run){const waiting=page.waitForEvent('download');await run('void saveSvg()');return fs.readFileSync(await(await waiting).path(),'utf8');}
async function recordPngText(page){await page.evaluate(()=>{window.__pngText=[];const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(this.canvas.id!=='canvas')window.__pngText.push(text);return fill.call(this,text,...args);};});}
function hasReading(svg,value){assert.match(svg,new RegExp('>'+value+'<\\/tspan>'));assert.doesNotMatch(svg,/Component unavailable/);}

test('SVG, PNG, print and clipboard images capture current HTTP scalars and tables without requests or persistence',()=>app(async({page,run,origin,requests})=>{
  await seedHttp(run,origin);await waitOutput(page,'http','value',37);await waitOutput(page,'rows','rowCount',1);
  await run('persistWorkspace()');const saved=await run('readSavedWorkspace()'),before=await run('JSON.stringify({items,datasets,undoStack,redoStack})'),count=requests();
  const svg=await downloadedSvg(page,run);hasReading(svg,37);assert.match(svg,/Snapshot fruit/);
  await recordPngText(page);const png=page.waitForEvent('download');await run('void savePng()');
  const bytes=fs.readFileSync(await(await png).path());assert.equal(bytes.subarray(1,4).toString(),'PNG');
  const painted=await page.evaluate(()=>window.__pngText);assert.ok(painted.includes('37'));assert.ok(painted.includes('Snapshot fruit'));assert.ok(!painted.includes('Component unavailable'));
  await page.evaluate(()=>window.__pngText=[]);
  await run('itemsToPngBlob([items[1]],{background:false,componentContext:items}).then(blob=>blob.size)');
  assert.ok((await page.evaluate(()=>window.__pngText)).includes('37'),'clipboard selection resolves its external source');
  await run('openPrintDialog()');await page.locator('#printMode').selectOption('fit');await page.waitForFunction(()=>__test.run('printPreviewReady'));
  const print=await run('printSnapshot.svg');hasReading(print,37);assert.match(print,/Snapshot fruit/);await run('printDialog.close()');
  assert.equal(requests(),count,'rendering never fetches');
  assert.equal(await run('JSON.stringify({items,datasets,undoStack,redoStack})'),before);assert.deepEqual(await run('readSavedWorkspace()'),saved);
}));

for(const format of ['svg','png'])test(format.toUpperCase()+' freezes the HTTP response before asynchronous rendering',()=>app(async({page,run,origin,setResponse,requests})=>{
  await seedHttp(run,origin);await waitOutput(page,'http','value',37);await waitOutput(page,'rows','rowCount',1);
  await recordPngText(page);
  await run(`(()=>{const warm=warmSmartExportCache;warmSmartExportCache=async(...args)=>{window.__waiting=true;await new Promise(resolve=>window.__release=resolve);return warm(...args);};window.__exportError=null;void ${format==='svg'?'saveSvg()':'savePng()'}.catch(error=>window.__exportError=error.message);})()`);
  await page.waitForFunction(()=>window.__waiting);
  setResponse({value:91,items:[{name:'Later fruit',quantity:99}]});await refresh(run,'http');await refresh(run,'rows');
  await waitOutput(page,'http','value',91);await waitOutput(page,'rows','available',true);
  const count=requests(),waiting=page.waitForEvent('download');await page.evaluate(()=>window.__release());
  const bytes=fs.readFileSync(await(await waiting).path());assert.equal(await page.evaluate(()=>window.__exportError),null);
  if(format==='svg'){const svg=bytes.toString();hasReading(svg,37);assert.match(svg,/Snapshot fruit/);assert.doesNotMatch(svg,/Later fruit/);}
  else{const text=await page.evaluate(()=>window.__pngText);assert.ok(text.includes('37'));assert.ok(text.includes('Snapshot fruit'));assert.ok(!text.includes('91'));assert.ok(!text.includes('Later fruit'));}
  assert.equal(requests(),count);assert.equal(await run('editorComponentEvaluation.records.get(items[0]).io.outputs.value'),91);
}));

test('HTML and Run stay fresh, and a failed HTTP reading does not reappear in a static image',()=>app(async({page,run,context,origin,requests,setResponse})=>{
  await seedHttp(run,origin);await waitOutput(page,'http','value',37);await waitOutput(page,'rows','rowCount',1);
  const exported=await run('buildWorkspaceHtml(captureWorkspaceHtml())'),count=requests();
  assert.ok(!exported.includes('Snapshot fruit'),'portable HTML excludes transient response contents');
  const reader=await context.newPage();await reader.route('http://offline-static.test/**',route=>route.fulfill({contentType:'text/html',body:exported}));
  await reader.goto('http://offline-static.test/index.html');await reader.locator('[data-smart-index="0"][data-smart-ready="true"]').waitFor();
  assert.match(await reader.locator('[data-smart-index="0"]').textContent(),/Ready to refresh/);
  assert.match(await reader.locator('[data-smart-index="1"]').textContent(),/Component unavailable/);assert.equal(requests(),count);await reader.close();
  await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
  const frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await frame.locator('[data-smart-index="0"][data-smart-ready="true"]').waitFor();
  assert.match(await frame.locator('[data-smart-index="0"]').textContent(),/Ready to refresh/);assert.equal(requests(),count);
  await page.locator('#exitPreviewBtn').click();
  setResponse({error:'Unavailable'},503);await refresh(run,'http');await waitOutput(page,'http','status','error');
  const svg=await downloadedSvg(page,run);assert.match(svg,/503/);assert.match(svg,/Component unavailable/);assert.doesNotMatch(svg,/>37<\/tspan>/);
}));

test('static images capture an MQTT reading from an inactive service sketch without connecting again',()=>app(async({page,run,broker,origin})=>{
  const service=await run(`(()=>{items=[make('workspaceSettings','settings',30,30,{state:{executionMode:'whole workspace'}}),
    make('mqttConfig','config',30,130,{inputValues:{url:${JSON.stringify(origin.replace('http:','ws:')+'/mqtt')}}}),
    make('mqttSubscribe','reading',430,130,{state:{format:'text',valueType:'string'},inputValues:{topic:'simplecanvas/demo/status'},mqttBinding:{sketchId:activeTabId,componentUid:'config'}})];
    datasets={};render();save();return activeTabId;})()`);
  await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
  await run("openEditorComponentDataAction(items.find(item=>item.uid==='config'),{type:'mqttConnect'},()=>true)");
  await waitOutput(page,'reading','value','Workshop online');
  // Keep the reading on the inactive sketch; capture its graph snapshot while exporting another
  // sketch. A direct context render also covers clipboard/subset source resolution.
  await run(`newTab();items=[make('textLabel','display',40,40)];render();save();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);`);
  await broker.publish(broker.topics.status,'Snapshot 37');await waitOutput(page,'reading','value','Snapshot 37');
  const connections=broker.stats.connections.length;
  const svg=await run(`itemsToSVGMarkup([tabDocument(${JSON.stringify(service)}).items.find(item=>item.uid==='reading')])`);
  assert.match(svg,/Snapshot 37/);assert.equal(broker.stats.connections.length,connections);
  const html=await run('buildWorkspaceHtml(captureWorkspaceHtml())');assert.ok(!html.includes('Snapshot 37'));
}));
