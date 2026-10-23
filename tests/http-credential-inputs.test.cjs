const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {parseApp}=require('./helpers/app-source.cjs');
const {launchBrowser}=require('./helpers/browser.cjs');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),appSource=parseApp(html);
const plain=value=>JSON.parse(JSON.stringify(value));
const scope=vm.createContext({URL,AbortController,TextEncoder,TextDecoder,Response,Headers,ReadableStream,btoa,setTimeout,clearTimeout,console});
vm.runInContext(html.slice(html.indexOf('  function componentScalar('),html.indexOf('  function normalizeComponentSettings('))+
  '\nthis.api={normalizeComponentHttpSource,componentHttpRequest,componentHttpConfiguration,createComponentIntegrationService};',scope);
const api=scope.api;
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const response=value=>new Response(JSON.stringify({value}),{headers:{'content-type':'application/json'}});
async function until(predicate){for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('HTTP request did not settle');}
function fixture(mode='session',method='GET'){
  const auth={mode,...(mode==='bearer'?{token:'token'}:mode==='basic'?{username:'username',password:'password'}:{})};
  const caps={apiVersion:2,integrationApi:1,compute:true,inputs:{url:{type:'string'},path:{type:'string'},body:{type:'string'},key:{type:'string'},token:{type:'string'},username:{type:'string'},password:{type:'string'}},
    outputs:{value:{type:'number'},json:{type:'string'},available:{type:'boolean'},loading:{type:'boolean'},error:{type:'string'},lastUpdated:{type:'number'}},
    httpSource:{url:'url',path:'path',valueType:'number',timeoutMs:1000,method,auth,...(method==='POST'?{body:'body',idempotencyKey:'key'}:{})}};
  const item={uid:'http-input',type:'smart',componentApi:2,script:'HTTP credential input fixture',state:{authMode:mode},inputValues:{url:'https://input-api.test/read',path:'/value',body:'{}',key:'request-1',token:'wired-token',username:'reader',password:'pāssword'}};
  return {caps,item,record:{caps,io:{inputs:{...item.inputValues},outputs:{}}}};
}

test('HTTP credential declarations require explicit modes and appropriately typed input references',()=>{
  for(const mode of ['session','none','bearer','basic']){
    const {caps}=fixture(mode);
    assert.deepEqual(plain(api.normalizeComponentHttpSource(caps.httpSource,caps).auth),caps.httpSource.auth);
  }
  const {caps}=fixture('bearer');
  for(const auth of [{mode:'unknown'},{mode:'bearer'},{mode:'bearer',token:'missing'},{mode:'none',token:'token'},{mode:'basic',username:'username'},{mode:'session',extra:true}])
    assert.throws(()=>api.normalizeComponentHttpSource({...caps.httpSource,auth},caps));
  assert.throws(()=>api.normalizeComponentHttpSource(caps.httpSource,{...caps,inputs:{...caps.inputs,token:{type:'number'}}}));
});

test('HTTP input authentication builds bounded headers without exposing values in validation errors',()=>{
  for(const mode of ['session','none','bearer','basic']){
    const {caps,item}=fixture(mode),request=api.componentHttpRequest(caps,item.inputValues);
    if(mode==='session')assert.equal(Object.hasOwn(request,'authorization'),false);
    else assert.equal(request.authorization,mode==='none'?null:mode==='bearer'?'Bearer wired-token':'Basic '+Buffer.from('reader:pāssword').toString('base64'));
  }
  for(const [mode,changes] of [['bearer',{token:'private-token\r\nInjected: yes'}],['bearer',{token:''}],['bearer',{token:'Bearer token'}],['bearer',{token:'x'.repeat(2001)}],
    ['basic',{username:'private:name'}],['basic',{username:'u'.repeat(257)}],['basic',{password:''}],['basic',{password:'private-password\r\nInjected: yes'}],['basic',{password:'p'.repeat(2001)}]]){
    const {caps,item}=fixture(mode);
    assert.throws(()=>api.componentHttpRequest(caps,{...item.inputValues,...changes}),error=>{
      assert.doesNotMatch(error.message,/private-token|private:name|private-password/);return true;
    });
  }
});

test('input and unauthenticated modes bypass saved credentials while session mode retains its existing store',async()=>{
  const requests=[],snapshots=[];let savedLookups=0;
  const service=api.createComponentIntegrationService({credentials:()=>{savedLookups++;return {Authorization:'Bearer saved-secret'};},
    fetch:(url,options)=>{requests.push(options);return Promise.resolve(response(27));},onChange:(_,snapshot)=>snapshots.push(plain(snapshot))});
  try{
    for(const mode of ['none','bearer','basic','session']){
      const {caps,item,record}=fixture(mode);service.start(item,record,{origin:'user'});await until(()=>service.read(item,caps,item.inputValues).available);
    }
    assert.deepEqual(requests.map(request=>request.headers.Authorization),[undefined,'Bearer wired-token','Basic '+Buffer.from('reader:pāssword').toString('base64'),'Bearer saved-secret']);
    assert.equal(savedLookups,1,'only Session credentials reads the private credential store');
    assert.doesNotMatch(JSON.stringify(snapshots),/wired-token|pāssword|saved-secret/,'result/status publication does not expose request credentials');
  }finally{service.dispose();}
});

test('POST captures credential inputs with its body, allowing later literal and wire edits to prepare the next send',async()=>{
  const {caps,item,record}=fixture('basic','POST'),pending=deferred(),requests=[],completed=[];
  const service=api.createComponentIntegrationService({fetch:(url,options)=>{requests.push(options);return pending.promise;},onComplete:(_,snapshot,context)=>completed.push({snapshot,context})});
  try{
    service.start(item,record,{origin:'user'});
    item.inputValues.username='unfinished:username';item.inputValues.password='';item.inputValues.body='{"next":true}';item.bindings={password:{uid:'next-password',port:'value'}};
    assert.equal(service.read(item,caps,item.inputValues).loading,true,'preparing the next credentials cannot retire an accepted write');
    assert.equal(requests[0].signal.aborted,false);
    assert.equal(requests[0].headers.Authorization,'Basic '+Buffer.from('reader:pāssword').toString('base64'));
    pending.resolve(response(63));await until(()=>completed.length===1);
    assert.equal(service.read(item,caps,item.inputValues).value,63);
    assert.equal(completed[0].context.matches(caps,item.inputValues),true,'the completion belongs to the original captured command');
    assert.doesNotMatch(JSON.stringify(completed[0].snapshot),/password|pāssword|reader/);
  }finally{service.dispose();}
});

test('GET results become unavailable after credential inputs change, without silently sending another request',async()=>{
  const {caps,item,record}=fixture('bearer');let requests=0;
  const service=api.createComponentIntegrationService({fetch:()=>{requests++;return Promise.resolve(response(18));}});
  try{
    service.start(item,record,{origin:'user'});await until(()=>service.read(item,caps,item.inputValues).available);
    item.inputValues.token='replacement-token';
    assert.equal(service.read(item,caps,item.inputValues).available,false);assert.equal(requests,1);
    service.start(item,{caps,io:{inputs:{...item.inputValues}}},{origin:'user'});await until(()=>service.read(item,caps,item.inputValues).available);assert.equal(requests,2);
  }finally{service.dispose();}
});

const origin='http://credential-inputs.test',endpoint='https://credential-input-api.test';
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>browser?.close());
async function browserApp(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1150}}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'http-inputs-')),calls=[],errors=[];
  try{
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.route(endpoint+'/**',async route=>{
      const request=route.request();
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST','access-control-allow-headers':'authorization, content-type'}});
      calls.push({method:request.method(),headers:request.headers(),body:request.postData()});
      await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"value":42}'});
    });
    await context.route(origin+'/**',route=>route.fulfill(new URL(route.request().url()).pathname==='/index.html'?{contentType:'text/html',body:appSource.inject('window.__test={run:source=>eval(source)};')}:{status:404,body:''}));
    const page=await context.newPage();await page.goto(origin+'/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run(`(async()=>{
      const specs=[
        {key:'httpSource',state:{authMode:'bearer'},inputValues:{url:${JSON.stringify(endpoint+'/read')},path:'/value'},bindings:{token:{uid:'http-input-3',port:'value'}}},
        {key:'httpPost',state:{authMode:'basic'},inputValues:{url:${JSON.stringify(endpoint+'/write')},path:'/value',body:'{"requested":42}'},bindings:{username:{uid:'http-input-4',port:'value'},password:{uid:'http-input-5',port:'value'}}},
        {key:'httpSource',state:{authMode:'none'},inputValues:{url:${JSON.stringify(endpoint+'/public')},path:'/value'}},
        {key:'textInput',state:{values:['connected-token']}},{key:'textInput',state:{values:['connected-user']}},{key:'textInput',state:{values:['pāssword']}}
      ];cancelGesture();items=specs.map((spec,index)=>{const template=clone(BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key===spec.key).items[0]);return {...template,...spec,uid:'http-input-'+index,x:40+(index%3)*450,y:90+Math.floor(index/3)*290,componentName:'Credential input '+index,state:{...template.state,...spec.state},inputValues:{...template.inputValues,...spec.inputValues}};});
      for(const item of items.slice(0,3))editorIntegrationCredentials.set(item,{auth:'bearer',username:'',secret:'saved-secret-must-not-win',origin:${JSON.stringify(endpoint)}});
      datasets={};selection=[];editingSmartIdx=null;setTool('select');render();save();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
    })()`);
    await fn({page,run,context,directory,calls});assert.deepEqual(errors,[]);
  }finally{await context.close();fs.rmSync(directory,{recursive:true,force:true});}
}
async function readerReady(frame,index=0){await frame.waitForFunction(index=>document.querySelector('[data-smart-index="'+index+'"]')?.dataset.smartReady==='true',index);}
async function readerClick(page,frame,index,handle,preview){
  await readerReady(frame,index);
  const point=await frame.locator('[data-smart-index="'+index+'"]').evaluate((host,handle)=>{const point=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};},handle);
  const offset=preview?await page.locator('#runPreviewFrame').boundingBox():{x:0,y:0};await page.mouse.click(offset.x+point.x,offset.y+point.y);
}

for(const mode of ['editor','Run','HTML'])test(mode+' uses wired HTTP credential inputs and never substitutes saved credentials',()=>browserApp(async({page,run,context,directory,calls})=>{
  const handles=await run(`(async()=>Promise.all(items.slice(0,3).map(async item=>(await requestSmartCall(item,'handles',[item.state,item.w,item.h])).find(handle=>['refresh','send'].includes(handle.id)))))()`);
  let frame=null,owner=page;
  if(mode==='Run'){
    await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await readerReady(frame);
  }else if(mode==='HTML'){
    const reader=await run(`buildWorkspaceHtml(captureWorkspaceHtml(),{integrationCredentials:items.slice(0,3).map(item=>({sketchId:activeTabId,componentUid:item.uid,...editorIntegrationCredentials.get(item)}))})`);
    assert.match(reader,/connected-token/,'normal input values and their sources travel in the authored HTML');
    const file=path.join(directory,'credential-inputs.html');fs.writeFileSync(file,reader);owner=await context.newPage();await owner.goto(pathToFileURL(file).href);frame=owner;await readerReady(frame);
  }
  assert.equal(calls.length,0,'opening a workspace or reader only prepares the input values');
  for(let index=0;index<3;index++){
    if(frame){await readerClick(owner,frame,index,handles[index],mode==='Run');await frame.waitForFunction(index=>[...document.querySelectorAll('[data-smart-index="'+index+'"] text')].some(node=>node.textContent==='42'),index);}
    else{await run(`openEditorComponentDataAction(items[${index}],{type:${JSON.stringify(index===1?'httpPost':'httpGet')}},()=>true)`);await page.waitForFunction(index=>__test.run(`editorComponentEvaluation?.records?.get(items[${index}])?.io.outputs.available`)===true,index);}
  }
  assert.deepEqual(calls.map(call=>call.headers.authorization),['Bearer connected-token','Basic '+Buffer.from('connected-user:pāssword').toString('base64'),undefined]);
  assert.deepEqual(calls.map(call=>call.method),['GET','POST','GET']);assert.equal(calls[1].body,'{"requested":42}');
  if(mode==='Run'){await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});}
}));
