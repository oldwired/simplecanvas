const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..'),origin='http://integration-history.test',api='https://integration-history-api.test';
const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),requests=[],errors=[];
  let respond=()=>({status:200,body:{value:'reading'}});
  try{
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.route(origin+'/**',route=>route.fulfill(new URL(route.request().url()).pathname==='/index.html'?{contentType:'text/html',body:html}:{status:404,body:''}));
    await context.route(api+'/**',async route=>{
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST'}});
      requests.push({method:route.request().method(),authorization:route.request().headers().authorization||null});
      const result=respond(requests.length);
      await route.fulfill({status:result.status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:result.body===undefined?'':JSON.stringify(result.body)});
    });
    const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());await page.goto(origin+'/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({context,page,run,requests,setResponse:fn=>{respond=fn;}});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
const sourceFixture=(key='httpSource')=>`({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===${JSON.stringify(key)}).items[0]),uid:'source',componentName:'Source',x:40,y:40,
  state:{...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===${JSON.stringify(key)}).items[0].state),valueType:'string'},
  inputValues:{url:${JSON.stringify(api+'/reading')},path:'/value'${key==='httpPost' ? ",body:'{}',idempotencyKey:''" : ''}}})`;
async function seed(run){
  await run(`(async()=>{cancelGesture();items=[${sourceFixture()},{type:'rect',uid:'rectangle',x:450,y:40,w:80,h:80,color:'#000000',size:1}];datasets={};selection=[];editingSmartIdx=null;render();save();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);undoStack=[];redoStack=[];})()`);
}
const graph=run=>run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true).then(()=>true)');
async function refreshEditor(page,run){
  await run("openEditorComponentDataAction(items[0],{type:'httpGet'},()=>true)");
  await page.waitForFunction(()=>__test.run('editorComponentEvaluation?.records?.get(items[0])?.io.outputs.available')===true);
}
async function reader(page,run,context,mode){
  // A diagnostic hook observes the actual reader graph/queue. It is added only to this fixture.
  await run(`(()=>{const original=buildWorkspaceHtml;buildWorkspaceHtml=async(...args)=>(await original(...args)).replace('void activate(initial);','window.__reader={run:source=>eval(source)};void activate(initial);');})()`);
  if(mode==='Run'){
    await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
    const frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();
    return {target:frame,read:source=>frame.evaluate(source=>__reader.run(source),source)};
  }
  const hasCredentials=await run('editorIntegrationCredentials.size>0');
  const downloading=page.waitForEvent('download');await run('void exportHtml()');
  const credentials=page.locator('[data-integration-export]');
  if(hasCredentials){
    await credentials.waitFor();
    await credentials.locator('[data-integration-include]').first().check();
    await credentials.locator('[data-integration-export-continue]').click();
  }
  const contents=fs.readFileSync(await(await downloading).path(),'utf8');
  await context.route(origin+'/reader.html',route=>route.fulfill({contentType:'text/html',body:contents}));
  const target=await context.newPage();await target.goto(origin+'/reader.html');
  await target.waitForFunction(()=>document.querySelector('[data-smart-index="0"]')?.dataset.smartReady==='true');
  return {target,read:source=>target.evaluate(source=>__reader.run(source),source),contents};
}
test('unrelated Undo/Redo preserves session credentials for HTTP requests, Run and explicitly selected HTML exports',async()=>app(async({page,run,context,requests})=>{
  await seed(run);
  assert.equal(await run("openEditorComponentDataAction(items[0],{type:'httpCredentials'},()=>true)"),true,await run('JSON.stringify({toast:document.getElementById("toast")?.textContent,record:editorComponentEvaluation?.records?.get(items[0])})'));
  const dialog=page.locator('[data-integration-credentials]');await dialog.locator('[data-integration-auth]').selectOption('bearer');
  await dialog.locator('[data-integration-secret]').fill('history-only-token');await dialog.locator('[data-integration-save]').click();
  await refreshEditor(page,run);
  await run('beginHistory();items[1].x+=40;commitHistory();render();');
  await page.keyboard.press('ControlOrMeta+z');await graph(run);
  assert.equal(await run('items[1].x'),450);assert.equal(await run('editorIntegrationCredentials.size'),1);await refreshEditor(page,run);
  await run('redo()');await graph(run);assert.equal(await run('items[1].x'),490);await refreshEditor(page,run);
  assert.equal(requests.length,3,'history restores no requests');
  assert.doesNotMatch(await run('JSON.stringify({undoStack,redoStack,items})'),/history-only-token/,'the secret never enters history or item state');
  for(const mode of ['Run','HTML']){
    const {target,read,contents}=await reader(page,run,context,mode);
    if(contents)assert.match(contents,/history-only-token/,'the author explicitly includes credentials in this artifact');
    const before=requests.length;
    await read(`(async()=>{const graph=await resolveAcceptedComponentGraph(resolveComponentGraph,()=>true);const source=items.find(item=>item.uid==='source');queueReaderComponentActionIntents([captureHttpHostIntent(source,graph.get(source),'user')]);})()`);
    await target.waitForFunction(()=>__reader.run('integrationService.peek(items[0],integrationGraph.records.get(items[0]).caps,integrationGraph.records.get(items[0]).io.inputs).available')===true);
    assert.equal(requests.length,before+1);
    if(mode==='Run')await page.locator('#exitPreviewBtn').click();else await target.close();
  }
  assert.ok(requests.every(request=>request.authorization==='Bearer history-only-token'));
  await run('setTool("select");selection=[0];deleteSelected();');await graph(run);
  assert.equal(await run('editorIntegrationCredentials.size'),0);
  await run('undo()');await graph(run);
  assert.equal(await run('items[0].uid'),'source');assert.equal(await run('editorIntegrationCredentials.size'),0,'Undo of a genuine deletion does not resurrect secrets');
}));

test('history credential remapping is scoped to surviving unique identities and preserves origin checks',async()=>app(async({run})=>{
  const result=await run(`(()=>{
    const source={type:'smart',uid:'same',componentApi:2,script:'HTTP'},remote={...source},restored={...source};
    const store=createIntegrationCredentialStore();store.set(source,{auth:'bearer',username:'',secret:'local',origin:'https://a.test'});store.set(remote,{auth:'mqtt',username:'user',secret:'remote',origin:'wss://b.test'});
    store.replaceItems([source],[restored]);const kept=store.headers(restored,{url:'https://a.test/path'}).Authorization,independent=store.mqtt(remote,{url:'wss://b.test/mqtt'}).password;
    let originError;try{store.headers(restored,{url:'https://other.test/path'});}catch(error){originError=error.message;}
    store.replaceItems([restored],[{...restored,uid:'copy'}]);const copied=store.get({...restored,uid:'copy'});
    const changed={...remote,script:'different'};store.replaceItems([remote],[changed]);
    const duplicate={...source};store.set(source,{auth:'bearer',username:'',secret:'ambiguous',origin:'https://a.test'});store.replaceItems([source,duplicate],[{...source}]);
    return {kept,independent,originError,copied:!!copied,size:store.size};
  })()`);
  assert.equal(result.kept,'Bearer local');assert.equal(result.independent,'remote');assert.match(result.originError,/endpoint changed/i);
  assert.equal(result.copied,false);assert.equal(result.size,0,'copies, changed scripts and ambiguous identities do not receive credentials');
}));

const collector=`({apiVersion:2,eventApi:1,inputs:{timestamp:{type:'number',default:0},status:{type:'number',default:0},available:{type:'boolean',default:false},loading:{type:'boolean',default:false},error:{type:'string',default:''}},outputs:{count:{type:'number'}},eventInputs:{received:{type:'string'},failed:{type:'string'}},compute(inputs,state){return {count:state.values.length};},onEvent(name,payload,state,io){return {state:{values:[...state.values,{name,payload,...io.inputs}]}};},children(state){return [{type:'text',x:0,y:0,w:350,h:80,text:String(state.values.length),font:'16px sans-serif',color:'#000000'}];}})`;
const scenarios=[
  {key:'httpSource',port:'value',name:'HTTP hybrid values retain their own queued response metadata',responses:[{status:201,body:{value:'first'}},{status:202,body:{value:'latest'}}]},
  {key:'httpPost',port:'completed',name:'HTTP completions retain response metadata through a queued success, failure and empty acknowledgement',responses:[{status:201,body:{value:'first'}},{status:503,body:{error:'unavailable'}},{status:204},{status:202,body:{value:'latest'}}]}
];
for(const mode of ['editor','Run','HTML'])for(const scenario of scenarios)test(mode+' '+scenario.name,async()=>app(async({page,run,context,setResponse})=>{
  const {responses,key,port}=scenario;
  setResponse(index=>responses[index-1]);
  await run(`(async()=>{cancelGesture();items=[${sourceFixture(key)},{type:'smart',uid:'collector',componentApi:2,script:${JSON.stringify(collector)},state:{values:[]},x:430,y:40,w:350,h:100,
    bindings:{timestamp:{uid:'source',port:'lastUpdated'},status:{uid:'source',port:'httpStatus'},available:{uid:'source',port:'available'},loading:{uid:'source',port:'loading'},error:{uid:'source',port:'error'}},
    eventBindings:{received:{uid:'source',port:${JSON.stringify(port)}},failed:{uid:'source',port:'failed'}}}];datasets={};selection=[];editingSmartIdx=null;render();save();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);
  let target=page,read=run,hook='__test',service='editorIntegrationService',resolve='ensureEditorComponentGraph',queue='smartGestureQueue';
  if(mode!=='editor'){
    ({target,read}=await reader(page,run,context,mode));hook='__reader';service='integrationService';resolve='resolveComponentGraph';queue='gestureQueue';
  }
  await read(`(async()=>{const graph=await resolveAcceptedComponentGraph(${resolve},()=>true);window.record=graph.get(items[0]);window.gate={};gate.promise=new Promise(resolve=>gate.resolve=resolve);${queue}=${queue}.then(()=>gate.promise);})()`);
  const captured=[];
  for(let index=0;index<responses.length;index++){
    await read(`${service}.start(items[0],record,{origin:'user',valid:()=>items[0]?.uid==='source'})`);
    await target.waitForFunction(({hook,service,status})=>window[hook].run(service+'.peek(items[0],record.caps,record.io.inputs).httpStatus')===status && window[hook].run(service+'.peek(items[0],record.caps,record.io.inputs).loading')===false,{hook,service,status:responses[index].status});
    captured.push(await read(`${service}.peek(items[0],record.caps,record.io.inputs)`));
  }
  await read('gate.resolve()');await target.waitForFunction(({hook,count})=>window[hook].run('items[1].state.values.length')===count,{hook,count:responses.length});
  const received=await read('items[1].state.values');
  assert.deepEqual(received,captured.map(snapshot=>({name:snapshot.status==='ready'?'received':'failed',payload:snapshot.status==='ready'?(port==='value'?snapshot.value:snapshot.json):snapshot.error,
    timestamp:snapshot.lastUpdated,status:snapshot.httpStatus,available:snapshot.available,loading:false,error:snapshot.error})));
  if(key==='httpPost'){assert.equal(received[1].available,false);assert.equal(received[2].payload,'');assert.equal(received[2].available,false);}
  assert.equal(await read('items[0].state.valueType'),'string');
  if(mode==='Run')await page.locator('#exitPreviewBtn').click();else if(mode==='HTML')await target.close();
}));
