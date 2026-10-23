const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..'),origin='http://http-automation.test',api='https://automation-api.test';
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>browser?.close());

async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1250}});
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-http-auto-'));
  const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
  const calls=[],held=[],errors=[],requestWaiters=new Set();let respond=()=>({value:37,name:'Reading'});
  try{
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.route(api+'/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST','access-control-allow-headers':'authorization, content-type, idempotency-key'}});
      const call={url:url.href,path:url.pathname,method:request.method(),headers:request.headers(),body:request.postData(),at:Date.now()};calls.push(call);
      for(const waiter of [...requestWaiters])if(waiter.matches(request))waiter.finish(null,request);
      const result=await respond(call,route);if(result===null)return;
      try{await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},...(result?.response||{body:JSON.stringify(result)})});}
      catch(error){if(!/closed|disposed|Invalid|cancelled|aborted/i.test(error.message))throw error;}
    });
    await context.route(origin+'/**',route=>route.fulfill(new URL(route.request().url()).pathname==='/index.html'?{contentType:'text/html',body:html}:{status:404,body:''}));
    const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());await page.goto(origin+'/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);await run('appStarted');
    const defer=()=>{const gate={};gate.promise=new Promise(resolve=>gate.resolve=resolve);held.push(gate);return gate;};
    // Playwright's request event can precede the route handler. Resolve only after
    // that handler has captured headers/body in calls, without waiting for a reply.
    const next=(method='GET',path='/reading')=>{
      const promise=new Promise((resolve,reject)=>{
        const waiter={matches:request=>request.method()===method&&request.url()===api+path&&request.frame().page()===page,
          finish(error,request){clearTimeout(timer);requestWaiters.delete(waiter);if(error)reject(error);else resolve(request);}};
        const timer=setTimeout(()=>waiter.finish(new Error('Timed out waiting for routed '+method+' '+path)),30000);
        timer.unref?.();requestWaiters.add(waiter);
      });
      // An earlier assertion may fail before its caller awaits this request. Fixture
      // teardown still rejects/cancels the waiter without an unhandled rejection.
      promise.catch(()=>{});return promise;
    };
    await fn({page,run,context,directory,calls,defer,next,setResponse:fn=>{respond=fn;}});
    assert.deepEqual(errors,[],'editor, Run and HTML have no uncaught errors');
  }finally{for(const gate of held)gate.resolve(null);for(const waiter of [...requestWaiters])waiter.finish(new Error('HTTP fixture closed'));await context.close();fs.rmSync(directory,{recursive:true,force:true});}
}
const bind=(index,port='value')=>({uid:'http-auto-'+index,port});
const emitterScript=`({apiVersion:2,eventApi:1,inputs:{},outputs:{value:{type:'string',event:true}},compute(inputs,state){return {value:state.value};},
 children(state,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#fff',strokeOn:true,color:'#64748b',size:1},{type:'text',x:10,y:10,w:w-20,h:30,text:'Emit',plainText:true,font:'16px sans-serif'}];},
 handles(state,w,h){return [{id:'emit',kind:'click',x:w/2,y:h/2}];},hitEdit(){return 'emit';},dragEdit(state){return {state,events:[{port:'value',payload:state.value}]};}})`;
const collectorScript=`({apiVersion:2,eventApi:1,inputs:{},outputs:{count:{type:'number'}},eventInputs:{receive:{type:'string'}},
 compute(inputs,state){return {count:state.values.length};},onEvent(name,payload,state){return {state:{values:[...state.values,payload]}};},
 children(state,style,w,h){return [{type:'text',x:0,y:0,w,h,text:'Events: '+state.values.length,plainText:true,font:'16px sans-serif',color:'#334155'}];}})`;
const emitter=(value='go',extra={})=>({key:'constant',script:emitterScript,state:{value},w:200,h:80,...extra});
const collector=(index,port)=>({key:'constant',script:collectorScript,state:{values:[]},eventBindings:{receive:bind(index,port)},w:220,h:80});
const source=(extra={})=>({key:'httpSource',inputValues:{url:api+'/reading',path:'/value'},...extra});
const post=(extra={})=>({key:'httpPost',inputValues:{url:api+'/submit',path:'/value',body:'{}'},...extra});
async function seed(run,specs){
  await run(`(async()=>{cancelGesture();items=${JSON.stringify(specs)}.map((spec,index)=>{
    const definition=BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===spec.key);if(!definition)throw new Error('Missing built-in '+spec.key);
    const item=clone(definition.items[0]);return {...item,uid:'http-auto-'+index,componentName:'Component '+index,x:60+(index%3)*460,y:70+Math.floor(index/3)*280,...spec,state:{...item.state,...spec.state},inputValues:{...item.inputValues,...spec.inputValues}};
  });datasets={};selection=[];editingSmartIdx=null;setTool('select');render();save();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);undoStack=[];redoStack=[];await persistWorkspace();})()`);
}
async function patch(run,index,changes){
  await run(`(async()=>{const item=items[${index}],changes=${JSON.stringify(changes)};for(const [key,value] of Object.entries(changes))item[key]=['state','inputValues'].includes(key)?{...item[key],...value}:value;editorComponentEvaluation=null;render();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);
}
async function output(run,index){return run(`(async()=>{const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true),record=graph.get(items[${index}]);return record?.io.outputs;})()`);}
async function waitOutput(page,index,key,value){await page.waitForFunction(({index,key,value})=>__test.run(`editorComponentEvaluation?.records?.get(items[${index}])?.io.outputs[${JSON.stringify(key)}]`)===value,{index,key,value});}
async function action(run,index,type='httpGet'){return run(`openEditorComponentDataAction(items[${index}],{type:${JSON.stringify(type)}},()=>true)`);}
async function handle(run,index,id){return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id===${JSON.stringify(id)});})()`);}
async function click(page,run,index,id){
  await run(`selection=[${index}];editingSmartIdx=${index};render()`);const h=await handle(run,index,id);assert.ok(h,id+' handle exists');
  const p=await run(`toWorld(items[${index}],items[${index}].x+${h.x},items[${index}].y+${h.y})`),box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+p.x,box.y+p.y);await run('smartHitSettled');
}
async function logs(page,run,index,count){await page.waitForFunction(({index,count})=>__test.run(`items[${index}].state.values.length`)===count,{index,count});return run(`items[${index}].state.values`);}
async function readerReady(frame,index=0){await frame.waitForFunction(index=>document.querySelector('[data-smart-index="'+index+'"]')?.dataset.smartReady==='true',index);}
async function readerText(frame,index,text){await frame.waitForFunction(({index,text})=>document.querySelector('[data-smart-index="'+index+'"]')?.dataset.smartReady==='true'&&[...document.querySelectorAll('[data-smart-index="'+index+'"] text')].some(node=>node.textContent===text),{index,text});}
async function readerClick(page,frame,index,h,{preview=false}={}){
  await readerReady(frame,index);const p=await frame.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{const point=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};},h);
  const offset=preview?await page.locator('#runPreviewFrame').boundingBox():{x:0,y:0};await page.mouse.click(offset.x+p.x,offset.y+p.y);
}
async function reader(run,context,directory,{inspectHidden=false,prepareCompletionHook=false}={}){
  const file=path.join(directory,'automation.html');let html=await run('buildWorkspaceHtml(captureWorkspaceHtml())');
  if(inspectHidden){
    // Hidden drawings deliberately do not repaint. This read-only probe lets the test
    // inspect their state before navigation could itself settle an unfinished update.
    const marker='void activate(initial);';assert.ok(html.includes(marker));
    html=html.replace(marker,`window.__httpAutomationState=()=>{const source=items.find(item=>item.uid==='http-auto-0');return {active:activeTabId,visibleEntries:entries.length,states:items.map(item=>({uid:item.uid,state:item.state})),source:source?integrationService.peek(source,currentGraph?.get(source)?.caps||{}):null};};`+marker);
  }
  if(prepareCompletionHook){
    // Schedule a visibility change immediately before the real asynchronous graph
    // preparation. The queue and its cancellation/resume logic remain unmodified.
    const marker='async deliver(item,snapshot,context,accept){\n        const current=()=>context.valid() && !document.hidden;';assert.ok(html.includes(marker));
    html=html.replace(marker,marker+'\n        window.__beforeHttpCompletionPrepare?.();');
  }
  fs.writeFileSync(file,html);const page=await context.newPage();await page.goto(pathToFileURL(file).href);await readerReady(page);return page;
}
async function preview(page){await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();const frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await readerReady(frame);return frame;}
async function exitPreview(page){await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});}
async function pause(page,run){await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');}

// Silent windows intentionally exceed the debounce/interval being exercised. Requests
// use routed browser fixtures, so these assertions test scheduling rather than server speed.
test('GET completions emit hybrid JSON and success/failure occurrences once, including identical responses',async()=>app(async({page,run,calls,setResponse,defer})=>{
  await seed(run,[source(),{key:'memo',bindings:{line:bind(0,'json')}},collector(0,'completed'),collector(0,'failed')]);
  const text=JSON.stringify({value:37,name:'Reading'});
  for(let count=1;count<=2;count++){await action(run,0);await logs(page,run,2,count);await waitOutput(page,1,'lineCount',count);}
  assert.equal((await output(run,1)).text,text+'\n'+text);assert.equal(calls.length,2);
  setResponse(()=>({response:{status:503,body:'{"error":"unavailable"}'}}));await action(run,0);assert.match((await logs(page,run,3,1))[0],/503/);
  assert.equal((await output(run,1)).lineCount,2,'failures do not forward an old JSON value');
  const late=defer();setResponse(()=>late.promise);await action(run,0);await waitOutput(page,0,'loading',true);
  setResponse(()=>({value:42,name:'New'}));await action(run,0);await logs(page,run,2,3);await waitOutput(page,1,'lineCount',3);
  late.resolve({value:5,name:'Late'});await run('render();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
  assert.equal((await output(run,0)).value,42);assert.equal((await output(run,1)).lineCount,3);assert.equal((await run('items[2].state.values')).length,3);
}));

for(const mode of ['editor','HTML'])test(mode+' recombines hybrid Value and JSON from one HTTP response into one Memo occurrence',async()=>app(async({page,run,calls,context,directory,setResponse})=>{
  await seed(run,[source(),
    {key:'numberToText',bindings:{value:bind(0,'value')}},
    {key:'jsonExtract',inputValues:{pointer:'/name'},bindings:{text:bind(0,'json')}},
    {key:'textCompose',inputValues:{separator:' / '},bindings:{a:bind(1,'text'),b:bind(2,'value')}},
    {key:'memo',bindings:{line:bind(3,'text')}},collector(0,'completed')]);
  const h=await handle(run,0,'refresh'),html=mode==='HTML'?await reader(run,context,directory):null,lines=[];
  for(const response of [{value:11,name:'First'},{value:29,name:'Second'},{value:29,name:'Second'}]){
    setResponse(()=>response);lines.push(response.value+' / '+response.name);
    if(html){
      await readerClick(html,html,0,h);await readerText(html,5,'Events: '+lines.length);await readerReady(html,4);
      const displayed=await html.locator('[data-smart-index="4"] text').allTextContents();
      assert.deepEqual(displayed.filter(text=>/^\d+ \/ /.test(text)),lines,'both response branches settle before one combined message is appended');
    }else{
      await action(run,0);await logs(page,run,5,lines.length);const memo=await output(run,4);
      assert.equal(memo.lineCount,lines.length,'one response has one origin even when its two outputs join again');
      assert.equal(memo.text,lines.join('\n'),'each occurrence contains the two values from the same response');
    }
  }
  assert.equal(calls.length,3,'an identical response remains a fresh occurrence');
}));

test('an accepted response finishes while hidden and delivers its buffered occurrences once when the editor is visible',async()=>app(async({page,run,calls,setResponse,defer})=>{
  await seed(run,[source(),{key:'memo',bindings:{line:bind(0,'json')}},collector(0,'completed')]);
  const gate=defer();setResponse(()=>gate.promise);await action(run,0);await waitOutput(page,0,'loading',true);
  await run(`(()=>{const item=items[0],record=editorComponentEvaluation.records.get(item);window.httpAutoSnapshot=()=>editorIntegrationService.read(item,record.caps,record.io.inputs);})()`);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  gate.resolve({value:67,name:'Hidden'});await page.waitForFunction(()=>window.httpAutoSnapshot().available===true);
  assert.equal(await run('items[1].state.lineCount'),0);assert.deepEqual(await run('items[2].state.values'),[],'occurrences wait while rendering and event processing are suspended');
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await logs(page,run,2,1);await waitOutput(page,1,'lineCount',1);await waitOutput(page,0,'value',67);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
  assert.equal(await run('items[1].state.lineCount'),1);assert.equal(calls.length,1);
}));

test('HTML buffers an accepted hidden response and publishes one completion after visibility returns',async()=>app(async({page,run,calls,context,directory,setResponse,defer})=>{
  await seed(run,[source(),collector(0,'completed')]);const h=await handle(run,0,'refresh'),html=await reader(run,context,directory),gate=defer();setResponse(()=>gate.promise);
  const accepted=html.waitForRequest(request=>request.method()==='GET'&&request.url()===api+'/reading');await readerClick(html,html,0,h);await accepted;
  await html.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  const finished=html.waitForEvent('requestfinished',request=>request.method()==='GET'&&request.url()===api+'/reading');gate.resolve({value:68,name:'Hidden HTML'});await finished;
  assert.equal((await html.locator('[data-smart-index="1"]').textContent()).includes('Events: 1'),false);
  await html.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await readerText(html,1,'Events: 1');
  await html.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await readerText(html,1,'Events: 1');assert.equal(calls.length,1);
}));

test('Whole workspace HTML drains a hidden completion while the visible sketch is completely empty',async()=>app(async({run,calls,context,directory,setResponse,defer})=>{
  await seed(run,[source(),{key:'memo',bindings:{line:bind(0,'json')}},collector(0,'completed'),{key:'workspaceSettings',state:{executionMode:'whole workspace'}}]);
  const tabs=await run(`(async()=>{const source=activeTabId;newTab();const empty=activeTabId;activateTab(source);await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);return {source,empty};})()`);
  const h=await handle(run,0,'refresh'),html=await reader(run,context,directory,{inspectHidden:true}),gate=defer();setResponse(()=>gate.promise);
  const accepted=html.waitForRequest(request=>request.method()==='GET'&&request.url()===api+'/reading');await readerClick(html,html,0,h);await accepted;
  await html.locator('.tab-select[data-tab-id="'+tabs.empty+'"]').click();
  await html.locator('.tab-panel[data-tab-id="'+tabs.empty+'"]').waitFor({state:'visible'});
  assert.equal((await html.evaluate(()=>__httpAutomationState())).visibleEntries,0);
  await html.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  gate.resolve({value:69,name:'Background'});await html.waitForFunction(()=>__httpAutomationState().source?.available===true);
  assert.equal(await html.evaluate(()=>__httpAutomationState().states.find(item=>item.uid==='http-auto-2').state.values.length),0);
  await html.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await html.waitForFunction(()=>{
    const {states}=__httpAutomationState();return states.find(item=>item.uid==='http-auto-1').state.lineCount===1&&states.find(item=>item.uid==='http-auto-2').state.values.length===1;
  });
  const settled=await html.evaluate(()=>__httpAutomationState());assert.equal(settled.active,tabs.empty);assert.equal(settled.visibleEntries,0);assert.equal(settled.source.value,69);
  assert.equal(settled.states.find(item=>item.uid==='http-auto-1').state.text,JSON.stringify({value:69,name:'Background'}));
  await html.locator('.tab-select[data-tab-id="'+tabs.source+'"]').click();await readerText(html,2,'Events: 1');assert.equal(calls.length,1,'navigation cannot replay the buffered occurrence');
}));

test('HTML retains a completion when the page becomes hidden during its graph preparation',async()=>app(async({run,calls,context,directory,setResponse,defer})=>{
  await seed(run,[source(),{key:'memo',bindings:{line:bind(0,'json')}},collector(0,'completed')]);
  const h=await handle(run,0,'refresh'),html=await reader(run,context,directory,{inspectHidden:true,prepareCompletionHook:true}),gate=defer();setResponse(()=>gate.promise);
  const accepted=html.waitForRequest(request=>request.method()==='GET'&&request.url()===api+'/reading');await readerClick(html,html,0,h);await accepted;
  await html.evaluate(()=>{
    window.__beforeHttpCompletionPrepare=()=>{
      delete window.__beforeHttpCompletionPrepare;
      queueMicrotask(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));window.__hiddenDuringHttpPrepare=true;});
    };
  });
  gate.resolve({value:70,name:'Preparation'});await html.waitForFunction(()=>window.__hiddenDuringHttpPrepare===true);
  assert.equal(await html.evaluate(()=>__httpAutomationState().states.find(item=>item.uid==='http-auto-2').state.values.length),0);
  await html.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await readerText(html,2,'Events: 1');
  await html.waitForFunction(()=>__httpAutomationState().states.find(item=>item.uid==='http-auto-1').state.lineCount===1);
  await html.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await readerText(html,2,'Events: 1');assert.equal(calls.length,1);
}));

test('Refresh pulses and scalar events sample settled inputs, while initial high and disabled automation stay quiet',async()=>app(async({page,run,calls,next})=>{
  await seed(run,[source({inputValues:{url:api+'/reading',path:'/value',refresh:true},bindings:{refresh:bind(1)}}),{key:'toggle',state:{value:true}},emitter(api+'/event'),collector(0,'completed')]);
  assert.equal(calls.length,0,'restoring an already high trigger is a baseline');
  await patch(run,1,{state:{value:false}});const first=next();await patch(run,1,{state:{value:true}});await first;await logs(page,run,3,1);
  await patch(run,0,{bindings:{url:bind(2)},eventBindings:{refresh:bind(2)}});
  const eventRead=next('GET','/event');await click(page,run,2,'emit');await eventRead;await logs(page,run,3,2);
  assert.equal(calls[1].url,api+'/event','an action event samples the settled URL signal');
  await patch(run,0,{inputValues:{enabled:false}});await click(page,run,2,'emit');await page.waitForTimeout(120);assert.equal(calls.length,2);
  await action(run,0);await logs(page,run,3,3);assert.equal(calls.length,3,'manual Refresh remains possible with automatic reads disabled');
}));

test('opted-in URL changes debounce once and do not request the initial or restored configuration',async()=>app(async({page,run,calls,next})=>{
  await seed(run,[source({state:{refreshOnChange:true,debounceSeconds:.15}}),collector(0,'completed')]);
  await page.waitForTimeout(240);assert.equal(calls.length,0);
  await patch(run,0,{inputValues:{url:api+'/first'}});await patch(run,0,{inputValues:{url:api+'/second'}});
  const changed=next('GET','/final');await patch(run,0,{inputValues:{url:api+'/final'}});await changed;await logs(page,run,1,1);
  assert.deepEqual(calls.map(call=>call.path),['/final']);
  await run('render();persistWorkspace()');await page.reload();await run('appStarted');await output(run,0);await page.waitForTimeout(240);
  assert.equal(calls.length,1,'restored URL is not treated as a user change');
  await patch(run,0,{inputValues:{enabled:false,url:api+'/disabled'}});await page.waitForTimeout(240);assert.equal(calls.length,1);
}));

test('polling never overlaps, pauses with simulation or page visibility, and does not catch up missed intervals',async()=>app(async({page,run,calls,setResponse,defer,next})=>{
  const first=defer();setResponse(()=>first.promise);
  await seed(run,[source({state:{polling:true},inputValues:{url:api+'/reading',path:'/value',interval:1}}),collector(0,'completed')]);
  await next();await page.waitForTimeout(1200);assert.equal(calls.length,1,'an in-flight poll is never overlapped');
  await pause(page,run);first.resolve({value:7,name:'Accepted'});await logs(page,run,1,1);
  await page.waitForTimeout(1150);assert.equal(calls.length,1,'Pause suspends future polls, not an accepted completion');
  setResponse(()=>({value:8,name:'Resumed'}));const resumed=next();await pause(page,run);await resumed;await logs(page,run,1,2);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  const hiddenCount=calls.length;await page.waitForTimeout(2200);assert.equal(calls.length,hiddenCount);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(200);assert.ok(calls.length<=hiddenCount+1,'visibility restoration does not replay missed intervals');
  await patch(run,0,{inputValues:{enabled:false}});const disabledCount=calls.length;await page.waitForTimeout(1150);assert.equal(calls.length,disabledCount);
}));

test('editor reload starts background Whole workspace polling and visibility resumes it with an empty active sketch',async()=>app(async({page,run,calls,next})=>{
  await seed(run,[source({state:{polling:true},inputValues:{url:api+'/reading',path:'/value',interval:1}}),collector(0,'completed'),{key:'workspaceSettings',state:{executionMode:'whole workspace'}}]);
  const empty=await run('(async()=>{newTab();await persistWorkspace();return activeTabId;})()');
  await page.reload();await run('appStarted');
  assert.deepEqual(await run('({active:activeTabId,items:items.length,mode:workspaceExecutionMode()})'),{active:empty,items:0,mode:'whole workspace'});
  const count=()=>run("editorRuntimeContext().scene.find(item=>item.uid==='http-auto-1').state.values.length");
  await next();
  await page.waitForFunction(()=>__test.run("editorRuntimeContext().scene.find(item=>item.uid==='http-auto-1')?.state.values.length")>=1);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  const beforeHidden=calls.length;await page.waitForTimeout(1250);assert.equal(calls.length,beforeHidden,'the background sketch does not poll while the browser page is hidden');
  const beforeResume=await count(),resumed=next();
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await resumed;
  await page.waitForFunction(previous=>__test.run("editorRuntimeContext().scene.find(item=>item.uid==='http-auto-1')?.state.values.length")>previous,beforeResume);
  assert.deepEqual(await run('({active:activeTabId,items:items.length})'),{active:empty,items:0},'polling and consumers resume without navigating or touching the empty sketch');
}));

test('startup refresh is opt-in for Run and HTML and never fires while authoring, importing or restoring history',async()=>app(async({page,run,calls,context,directory})=>{
  await seed(run,[source({state:{refreshOnStart:true}}),collector(0,'completed')]);await run('render();persistWorkspace()');assert.equal(calls.length,0);
  const download=page.waitForEvent('download');await run('exportWorkspace()');const saved=fs.readFileSync(await(await download).path(),'utf8'),generation=await run('workspaceGeneration');
  await run(`openWorkspaceFile(new File([${JSON.stringify(saved)}],'startup.json',{type:'application/json'}))`);
  await page.waitForFunction(generation=>__test.run('workspaceGeneration')>generation,generation);await output(run,0);assert.equal(calls.length,0,'import is authoring, not a startup request');
  await run('beginHistory();items[0].x+=10;commitHistory();undo();redo();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');assert.equal(calls.length,0);
  await page.reload();await run('appStarted');await output(run,0);assert.equal(calls.length,0);
  const frame=await preview(page);await readerText(frame,1,'Events: 1');assert.equal(calls.length,1);await exitPreview(page);
  assert.equal((await run('items[1].state.values')).length,0,'Run completions stay in the disposable copy');
  const html=await reader(run,context,directory);await readerText(html,1,'Events: 1');assert.equal(calls.length,2);
  await html.reload();await readerText(html,1,'Events: 1');assert.equal(calls.length,3,'a new reader session performs one startup read');
}));

test('POST sends captured JSON from JSON build once, remains nonblocking, and does not send from value changes or history',async()=>app(async({page,run,calls,next,setResponse,defer})=>{
  await seed(run,[post({bindings:{body:bind(1,'text')},inputValues:{url:api+'/submit',path:'/value',idempotencyKey:'request-17'}}),
    {key:'jsonBuild',inputValues:{field0:'Anna',field1:12}},collector(0,'completed'),{key:'numberControl'}]);
  assert.equal(calls.length,0);const gate=defer();setResponse(()=>gate.promise);
  const sent=next('POST','/submit');await click(page,run,0,'send');await sent;
  assert.deepEqual(JSON.parse(calls[0].body),{name:'Anna',value:12});assert.equal(calls[0].headers['idempotency-key'],'request-17');
  await click(page,run,0,'send');assert.equal(calls.length,1,'repeated Send while pending cannot duplicate a side effect');
  await click(page,run,3,'plus');await waitOutput(page,3,'value',51);assert.equal(calls.length,1,'another control works before the POST completes');
  await patch(run,1,{inputValues:{field0:'Bea',field1:18}});assert.deepEqual(JSON.parse(calls[0].body),{name:'Anna',value:12},'later edits cannot change the accepted request body');
  gate.resolve({value:21,name:'Saved'});await logs(page,run,2,1);await waitOutput(page,0,'value',21);
  await run('render();persistWorkspace()');assert.equal(calls.length,1,'editing the JSON body never sends it');
  await run('undo();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');await run('redo();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');assert.equal(calls.length,1,'history does not replay POST');
  await page.reload();await run('appStarted');await output(run,0);assert.equal(calls.length,1,'reload cannot repeat POST');
}));

test('POST accepts explicit signal pulses and action events, never automatically retries a failed write',async()=>app(async({page,run,calls,next,setResponse})=>{
  await seed(run,[post({bindings:{send:bind(1)},inputValues:{url:api+'/submit',path:'/value',body:'{"name":"Anna"}'}}),{key:'toggle',state:{value:true}},emitter('send'),collector(0,'completed'),collector(0,'failed')]);
  assert.equal(calls.length,0,'an initially high Send does not write');
  await patch(run,1,{state:{value:false}});const sent=next('POST','/submit');await patch(run,1,{state:{value:true}});await sent;await logs(page,run,3,1);
  await patch(run,0,{bindings:{},eventBindings:{send:bind(2)}});setResponse(()=>({response:{status:503,body:'{"error":"busy"}'}}));
  const failed=next('POST','/submit');await click(page,run,2,'emit');await failed;assert.match((await logs(page,run,4,1))[0],/503/);
  await page.waitForTimeout(1200);assert.equal(calls.length,2,'a failed POST has no retry timer');
  setResponse(()=>({value:38,name:'Retry'}));await click(page,run,2,'emit');await logs(page,run,3,2);assert.equal(calls.length,3,'a fresh explicit occurrence can retry');
}));

test('POST 204 is a successful completion without a fabricated value, and mapping errors preserve HTTP status',async()=>app(async({page,run,calls,setResponse})=>{
  await seed(run,[post(),collector(0,'completed'),collector(0,'failed'),{key:'memo',bindings:{line:bind(0,'json')}}]);
  setResponse(()=>({response:{status:204,body:''}}));await action(run,0,'httpPost');assert.deepEqual(await logs(page,run,1,1),['']);
  let result=await output(run,0);assert.equal(result.httpStatus,204);assert.equal(result.available,false);assert.equal(result.loading,false);assert.equal((await output(run,3)).lineCount,0);
  setResponse(()=>({different:17}));await action(run,0,'httpPost');assert.match((await logs(page,run,2,1))[0],/pointer/i);
  result=await output(run,0);assert.equal(result.httpStatus,200);assert.equal(result.available,false);assert.equal(calls.length,2);
}));

for(const mode of ['Run','HTML'])test(mode+' supports explicit POST and hybrid completion delivery without changing the editor source',async()=>app(async({page,run,context,directory,calls})=>{
  await seed(run,[post({inputValues:{url:api+'/submit',path:'/value',body:'{"message":"Hello"}'}}),{key:'memo',bindings:{line:bind(0,'json')}},collector(0,'completed')]);
  const h=await handle(run,0,'send'),before=await run('JSON.stringify(items)');
  const frame=mode==='Run'?await preview(page):await reader(run,context,directory),owner=mode==='Run'?page:frame;
  assert.equal(calls.length,0,'opening the reader does not send');
  for(let count=1;count<=2;count++){await readerClick(owner,frame,0,h,{preview:mode==='Run'});await readerText(frame,2,'Events: '+count);}
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.method==='POST'&&JSON.parse(call.body).message==='Hello'));
  assert.equal(await run('JSON.stringify(items)'),before,'reader state is separate from the editor');
  if(mode==='Run')await exitPreview(page);
}));
