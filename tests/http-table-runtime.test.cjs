const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..'),origin='http://http-tables.test',api='https://tables.integration.test';
const columns=[{key:'label',name:'label',type:'string'},{key:'value',name:'value',type:'number'}];
const readings=[{label:'Low',value:2},{label:'High',value:9}],sorted=[['High',9],['Low',2]];
const failureCollector=`({apiVersion:2,eventApi:1,inputs:{},outputs:{count:{type:'number'}},eventInputs:{receive:{type:'string'}},
  compute(inputs,state){return {count:state.values.length};},onEvent(name,payload,state){return {state:{values:[...state.values,payload]}};},
  children(state,style,w,h){return [{type:'text',x:0,y:0,w,h,text:'Dataset failures: '+state.values.length,plainText:true,font:'16px sans-serif',color:'#334155'}];}})`;
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});

async function app(fn,{readerProbe=false}={}){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-http-tables-'));
  const probe=`window.__httpTableProbe={
    held:[],hold(){const push=httpCompletions.push;httpCompletions.push=(...args)=>this.held.push(args);this.release=()=>{httpCompletions.push=push;for(const args of this.held.splice(0))push(...args);};},
    read(){return {rows:datasets.saved.rows,revision:datasetRevision(datasets.saved),outputs:currentGraph?.get(items[0])?.io.outputs};}
  };`;
  const inject='window.__test={run:source=>eval(source)};'+(readerProbe?`{
    const original=buildWorkspaceHtml;buildWorkspaceHtml=async(...args)=>{
      const output=await original(...args),marker='void activate(initial);';
      if(!output.includes(marker))throw new Error('Missing reader startup probe location');
      return output.replace(marker,${JSON.stringify(probe)}+marker);
    };
  }`:'');
  const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject(inject);
  const errors=[],requests=[],held=[];let response=()=>({records:readings});
  try{
    context.on('page',page=>{page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());});
    await context.route(api+'/**',async route=>{
      const request=route.request();
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST','access-control-allow-headers':'content-type'}});
      const call={method:request.method(),url:request.url(),body:request.postData()};requests.push(call);
      const result=await response(call);
      if(result===null)return;
      try{await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},...(result.response||{body:JSON.stringify(result)})});}
      catch(error){if(!/closed|disposed|Invalid|cancelled|aborted/i.test(error.message))throw error;}
    });
    await context.route(origin+'/**',route=>route.fulfill(new URL(route.request().url()).pathname==='/index.html'?{contentType:'text/html',body:html}:{status:404,body:''}));
    const page=await context.newPage();await page.goto(origin+'/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);await run('appStarted');
    const defer=()=>{const gate={};gate.promise=new Promise(resolve=>gate.resolve=resolve);held.push(gate);return gate;};
    await fn({page,run,context,directory,requests,setResponse:fn=>{response=fn;},defer});
    assert.deepEqual(errors,[],'editor, Run and exported reader have no uncaught errors');
  }finally{for(const gate of held)gate.resolve(null);await context.close();fs.rmSync(directory,{recursive:true,force:true});}
}
async function seed(run,{live=true,readerUpdates=true,post=false}={}){
  await run(`(async()=>{
    cancelGesture();
    const make=(key,uid,x,y,extra={})=>{const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]);return {...base,uid,componentName:uid,x,y,...extra,state:{...base.state,...extra.state}};};
    datasets=normalizeDatasets({saved:{name:'Saved records',columns:${JSON.stringify(columns)},rows:[['Old',1]]}});
    items=[make(${JSON.stringify(post?'httpPost':'httpSource')},'http',40,40,{state:{valueType:'table'},inputValues:{url:${JSON.stringify(api+'/records')},path:'/records'${post?",body:'{}'":''}}}),
      make('tableSort','sort',420,40,{inputValues:{column:'value',direction:'descending'},bindings:{data:{uid:'http',port:'value'}}}),
      make('dataTable','direct',800,40,{w:650,h:260,bindings:{data:{uid:'sort',port:'data'}}}),
      make('dataSource','saved',40,350,{state:{updateMode:${JSON.stringify(live?'Live':'Manual')},allowReaderUpdates:${readerUpdates}},inputValues:{data:{datasetId:'saved'}},bindings:{source:{uid:'sort',port:'data'}}}),
      make('dataTable','editable',420,350,{w:620,h:280,state:{editDataset:true,allowReaderEdit:true},bindings:{data:{uid:'saved',port:'data'}}}),
      make('dataDownload','download',1100,350,{inputValues:{filename:'http-records'},bindings:{data:{uid:'saved',port:'data'}}}),
      make('numberControl','control',40,650),
      make('textLabel','json-view',420,680,{bindings:{value:{uid:'http',port:'json'}}}),
      make('constant','dataset-failures',1100,680,{w:300,h:80,script:${JSON.stringify(failureCollector)},state:{values:[]},inputValues:{},bindings:{},eventBindings:{receive:{uid:'saved',port:'failed'}}})];
    selection=[];editingSmartIdx=null;setTool('select');render();save();
    await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);undoStack=[];redoStack=[];await persistWorkspace();
  })()`);
}
async function refresh(run,{post=false}={}){
  await run(`openEditorComponentDataAction(items[0],{type:${JSON.stringify(post?'httpPost':'httpGet')}},()=>true)`);
}
const wait=(page,expression)=>page.waitForFunction(expression=>__test.run(expression),expression);
const waitRows=(page,rows)=>wait(page,`JSON.stringify(datasets.saved.rows)===${JSON.stringify(JSON.stringify(rows))}`);
async function record(run,index=0){
  return run(`(async()=>{const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true),r=graph.get(items[${index}]);return {error:r?.error,unavailable:r?.unavailable,outputs:r?.io.outputs,tables:r?.io.tables,outputErrors:r?.outputErrors};})()`);
}
async function settled(run){
  await run('(async()=>{await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);await editorActionDispatcher.promise;await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);return true;})()');
}
async function handle(run,index,id){
  const result=await run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id===${JSON.stringify(id)});})()`);
  assert.ok(result,'handle '+id);return result;
}
async function readerText(frame,index,text){
  await frame.waitForFunction(({index,text})=>{const host=document.querySelector('[data-smart-index="'+index+'"]');return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(node=>node.textContent===text);},{index,text});
}
async function clickReader(page,frame,index,handle,preview=false){
  await frame.waitForFunction(index=>document.querySelector('[data-smart-index="'+index+'"]')?.dataset.smartReady==='true',index);
  const p=await frame.locator('[data-smart-index="'+index+'"]').evaluate((host,h)=>{const p=new DOMPoint(h.x,h.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},handle);
  const offset=preview?await page.locator('#runPreviewFrame').boundingBox():{x:0,y:0};await page.mouse.click(offset.x+p.x,offset.y+p.y);
}
async function exported(page,run,context,directory){
  const pending=page.waitForEvent('download');await run('void exportHtml()');
  const file=path.join(directory,'http-tables.html');fs.copyFileSync(await(await pending).path(),file);
  const reader=await context.newPage();await reader.goto(pathToFileURL(file).href);await readerText(reader,4,'Old');return reader;
}
async function download(page,frame){
  const dialog=frame.locator('dialog[data-component-data-action="downloadTable"]');await dialog.waitFor();
  await dialog.locator('[data-data-action-format]').selectOption('json');
  const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download',exact:true}).click();
  const result=await pending;assert.equal(result.suggestedFilename(),'http-records.json');return JSON.parse(fs.readFileSync(await result.path(),'utf8'));
}
async function noReaderDatasetWarning(frame){
  await readerText(frame,8,'Dataset failures: 0');
  assert.equal(await frame.locator('[data-component-event-error]').count(),0,'Live Dataset waiting does not show an action warning');
}

for(const post of [false,true])test((post?'POST':'GET')+' Edit supports a Table response without a new component or automatic request',async()=>app(async({page,run,requests})=>{
  await seed(run,{post});
  await run("items=[items[0]];datasets={};items[0].state.valueType='number';items[0].inputValues.path='/value';selection=[0];editorComponentEvaluation=null;render();openComponentBindings()");
  await page.locator('#componentBindingsSave:enabled').waitFor();
  await page.locator('#component-setting-valueType').selectOption('table');await page.locator('#componentBindingsSave:enabled').waitFor();
  assert.match(await page.locator('#component-setting-valueType option:checked').textContent(),/Table/);
  const id=await run("componentDialogSession.rows.find(row=>row.name==='path').input.id");await page.locator('#'+id).fill('/records');await page.locator('#'+id).blur();
  await page.setViewportSize({width:390,height:844});await page.locator('[data-integration-section="response"]').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#componentBindingsDialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1),true);
  assert.equal(await page.locator('.component-edit-body').evaluate(body=>body.scrollWidth<=body.clientWidth+1),true);
  fs.mkdirSync(path.join(root,'tmp'),{recursive:true});
  await page.screenshot({path:path.join(root,'tmp','http-table-'+(post?'post':'get')+'-inspector-'+(process.env.BROWSER_ENGINE||'chromium')+'.png')});
  assert.equal(requests.length,0,'choosing response mapping does not issue a request');
  await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});
  const definition=await run('(async()=>{const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true),caps=graph.get(items[0]).caps;return {state:items[0].state,path:items[0].inputValues.path,port:caps.outputs.value,event:caps.eventOutputs?.value};})()');
  assert.equal(definition.state.valueType,'table');assert.equal(definition.path,'/records');assert.equal(definition.port.type,'table');assert.equal(definition.event,undefined);
  await refresh(run,{post});await wait(page,"editorComponentEvaluation?.records?.get(items[0])?.io.outputs.rowCount===2");
  assert.deepEqual((await record(run)).tables.outputs.value.rows,[['Low',2],['High',9]]);assert.equal(requests.length,1);
}));

test('HTTP tables feed direct transforms and Live Dataset without blocking controls or leaking stale source values',async()=>app(async({page,run,setResponse,defer})=>{
  await seed(run);const gate=defer();setResponse(()=>gate.promise);
  await refresh(run);await wait(page,"editorComponentEvaluation?.records?.get(items[0])?.io.outputs.loading===true");
  await settled(run);assert.equal((await record(run,8)).outputs.count,0,'initial pending source does not emit Dataset.failed');
  assert.doesNotMatch(await page.locator('#toast').textContent(),/source|dataset|unavailable/i,'Live Dataset silently waits for its source');
  await run("beginHistory();items[6].state.value=71;commitHistory();render()");await wait(page,"editorComponentEvaluation?.records?.get(items[6])?.io.outputs.value===71");
  assert.equal((await record(run)).outputs.loading,true,'the local control settles while the HTTP request waits');
  gate.resolve({records:readings});await waitRows(page,sorted);await settled(run);
  assert.deepEqual((await record(run,2)).tables.inputs.data.rows,sorted);
  assert.deepEqual((await record(run)).tables.outputs.value.rows,[['Low',2],['High',9]]);
  assert.equal((await record(run)).outputs.rowCount,2);assert.equal((await record(run)).outputs.jsonAvailable,true);
  const reference=(await record(run)).outputs.value;assert.match(reference.datasetId,/^~derived-/);assert.equal(Object.hasOwn(reference,'table'),false);
  assert.ok(!(await run('JSON.stringify(items)')).includes('"High"'),'only the deliberate Dataset copy stores response records');
  await run("commitEditorDatasetChange({type:'update',datasetId:'saved',rowId:datasets.saved.rowIds[0],changes:{value:77}});render()");await waitRows(page,[['High',77],['Low',2]]);await settled(run);
  const changedRevision=await run('datasetRevision(datasets.saved)');
  await run('render()');await settled(run);assert.equal(await run('datasets.saved.rows[0][1]'),77,'unrelated redraw keeps edits');
  const second=defer();setResponse(()=>second.promise);await refresh(run);await wait(page,"editorComponentEvaluation?.records?.get(items[0])?.io.outputs.loading===true");
  await settled(run);assert.equal((await record(run,8)).outputs.count,0,'refreshing the source does not emit Dataset.failed');
  assert.doesNotMatch(await page.locator('#toast').textContent(),/source|dataset|unavailable/i,'refresh waiting does not show an action warning');
  assert.equal((await record(run,2)).unavailable,true,'direct table is unavailable during refresh');
  assert.deepEqual((await record(run,4)).tables.inputs.data.rows,[['High',77],['Low',2]],'the stored Dataset remains independently usable');
  second.resolve({records:readings});await waitRows(page,sorted);await settled(run);
  assert.equal(await run('datasetRevision(datasets.saved)'),changedRevision+1,'even a same-data refresh replaces edits once');
  await run('render()');await settled(run);assert.equal(await run('datasetRevision(datasets.saved)'),changedRevision+1);
  assert.equal((await record(run,8)).outputs.count,0,'successful recovery does not leave a deferred failure event');
}));

test('an explicit Dataset Replace still reports an unavailable source instead of silently succeeding',async()=>app(async({page,run})=>{
  await seed(run,{live:false});await settled(run);assert.equal((await record(run,8)).outputs.count,0);
  await run("items[3].inputValues.replace=true;editorComponentEvaluation=null;render()");
  await wait(page,'items[8].state.values.length===1');await settled(run);
  assert.match(await run('items[8].state.values[0]'),/source|unavailable|table|unknown/i);
  assert.deepEqual(await run('datasets.saved.rows'),[['Old',1]],'a rejected explicit action cannot erase stored data');
}));

test('a valid table survives the text-port limit, while invalid responses withhold data and preserve owned records',async()=>app(async({page,run,setResponse})=>{
  await seed(run);
  const rows=Array.from({length:70},(_,index)=>({label:'Record '+index,value:index}));assert.ok(JSON.stringify({records:rows}).length>2000);
  setResponse(()=>({records:rows}));await refresh(run);await wait(page,'datasets.saved.rows.length===70');await settled(run);
  const result=await record(run);assert.equal(result.outputs.available,true);assert.equal(result.outputs.jsonAvailable,false);assert.equal(Object.hasOwn(result.outputs,'json'),false);
  assert.equal(result.outputs.rowCount,70);assert.equal((await record(run,1)).outputs.rowCount,70);
  assert.equal((await record(run,7)).unavailable,true,'oversized JSON is unavailable rather than an invented empty string');
  const saved=await run('JSON.stringify(datasets.saved)');
  for(const value of [[],[{label:'Wrong',value:{nested:1}}],[{label:'Wrong',value:1},{label:'Mixed',value:'2'}]]){
    setResponse(()=>({records:value}));await refresh(run);await wait(page,"editorComponentEvaluation?.records?.get(items[0])?.io.outputs.status==='error'");
    const failure=await record(run);assert.equal(failure.outputs.available,false);assert.equal(Object.hasOwn(failure.outputs,'value'),false);assert.ok(failure.outputs.error);
    assert.equal(await run('JSON.stringify(datasets.saved)'),saved,'failed response does not erase stored data');
  }
  setResponse(()=>({records:{columns,rows:[]}}));await refresh(run);await waitRows(page,[]);await settled(run);
  assert.equal((await record(run)).outputs.available,true);assert.equal((await record(run)).outputs.rowCount,0,'an explicitly typed empty table is a successful response');
}));

test('POST table responses are explicit and superseded GET tables cannot overwrite newer records',async()=>app(async({page,run,requests,setResponse,defer})=>{
  await seed(run,{post:true});assert.equal(requests.length,0);await refresh(run,{post:true});await waitRows(page,sorted);
  assert.equal(requests[0].method,'POST');assert.equal(requests[0].body,'{}');
  await run('render()');await settled(run);assert.equal(requests.length,1,'redraw does not repeat a POST');
  setResponse(()=>({response:{status:204,body:''}}));await refresh(run,{post:true});await wait(page,"editorComponentEvaluation?.records?.get(items[0])?.io.outputs.httpStatus===204");
  assert.equal((await record(run)).outputs.available,false);assert.deepEqual(await run('datasets.saved.rows'),sorted,'empty acknowledgement is not a replacement table');
  await seed(run);const older=defer(),newer=defer();let count=0;setResponse(()=>++count===1?older.promise:newer.promise);
  const oldRequest=page.waitForRequest(api+'/records');await refresh(run);await oldRequest;await wait(page,"editorComponentEvaluation?.records?.get(items[0])?.io.outputs.loading===true");
  const newRequest=page.waitForRequest(api+'/records');await refresh(run);await newRequest;
  newer.resolve({records:[{label:'Newest',value:99}]});await waitRows(page,[['Newest',99]]);
  older.resolve({records:[{label:'Obsolete',value:1}]});await settled(run);
  assert.deepEqual(await run('datasets.saved.rows'),[['Newest',99]]);
}));

test('queued HTTP completions append their captured tables through Sort rather than sampling a later response',async()=>app(async({page,run,setResponse})=>{
  await seed(run,{live:false});
  await run(`items[3].eventBindings={append:{uid:'http',port:'completed'}};editorComponentEvaluation=null;render();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)`);
  // Hold only completion delivery, not requests or graph settlement. This exposes
  // the race without sleeps: both responses are current before the first event runs.
  await run(`(()=>{
    const push=editorHttpCompletions.push;window.heldHttpTableCompletions=[];
    editorHttpCompletions.push=(...args)=>heldHttpTableCompletions.push(args);
    window.releaseHttpTableCompletions=()=>{editorHttpCompletions.push=push;for(const args of heldHttpTableCompletions.splice(0))push(...args);};
  })()`);
  await refresh(run);await wait(page,'heldHttpTableCompletions.length===1');await wait(page,"editorComponentEvaluation?.records?.get(items[0])?.io.outputs.rowCount===2");
  setResponse(()=>({records:[{label:'Later',value:42}]}));await refresh(run);await wait(page,'heldHttpTableCompletions.length===2');
  await wait(page,"editorComponentEvaluation?.records?.get(items[0])?.io.outputs.rowCount===1");
  assert.deepEqual(await run('datasets.saved.rows'),[['Old',1]],'mere publication does not append in Manual mode');
  await run('releaseHttpTableCompletions()');await waitRows(page,[['Old',1],...sorted,['Later',42]]);await settled(run);
  assert.equal(await run('datasetRevision(datasets.saved)'),2,'each completion appends once, including its own row snapshot');
}));

for(const mode of ['Run','HTML'])test(mode+' queued completions append the captured HTTP table rather than the latest response',async()=>app(async({page,run,context,directory,setResponse})=>{
  await seed(run,{live:false});await run("items[3].eventBindings={append:{uid:'http',port:'completed'}};editorComponentEvaluation=null;render();save();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)");
  const refreshHandle=await handle(run,0,'refresh'),before=await run('JSON.stringify(datasets)');let surface=page,frame;
  if(mode==='Run'){
    await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
    frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await readerText(frame,4,'Old');
  }else{surface=await exported(page,run,context,directory);frame=surface;}
  await frame.evaluate(()=>__httpTableProbe.hold());
  await clickReader(surface,frame,0,refreshHandle,mode==='Run');await frame.waitForFunction(()=>__httpTableProbe.held.length===1&&__httpTableProbe.read().outputs?.rowCount===2);
  setResponse(()=>({records:[{label:'Later',value:42}]}));await clickReader(surface,frame,0,refreshHandle,mode==='Run');
  await frame.waitForFunction(()=>__httpTableProbe.held.length===2&&__httpTableProbe.read().outputs?.rowCount===1);
  assert.deepEqual(await frame.evaluate(()=>__httpTableProbe.read().rows),[['Old',1]]);
  await frame.evaluate(()=>__httpTableProbe.release());const expected=[['Old',1],...sorted,['Later',42]];
  await frame.waitForFunction(expected=>JSON.stringify(__httpTableProbe.read().rows)===JSON.stringify(expected),expected);
  assert.equal(await frame.evaluate(()=>__httpTableProbe.read().revision),2);
  if(mode==='Run'){await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});}
  assert.equal(await run('JSON.stringify(datasets)'),before,'reader completion actions remain in the disposable copy');
},{readerProbe:true}));

test('Run and downloaded HTML fetch editable HTTP tables, overwrite edits on refresh and download results independently',async()=>app(async({page,run,context,directory,requests,setResponse,defer})=>{
  await seed(run);const refreshHandle=await handle(run,0,'refresh'),cell=await handle(run,4,'cell-0-1'),downloadHandle=await handle(run,5,'json');
  const before=await run('JSON.stringify({items,datasets,undoStack,redoStack})');
  await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
  const frame=await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame();await readerText(frame,4,'Old');assert.equal(requests.length,0);
  const first=defer();setResponse(()=>first.promise);await clickReader(page,frame,0,refreshHandle,true);await readerText(frame,0,'Loading…');await noReaderDatasetWarning(frame);
  first.resolve({records:readings});await readerText(frame,2,'High');await readerText(frame,4,'High');await noReaderDatasetWarning(frame);
  await clickReader(page,frame,4,cell,true);const field=frame.locator('[data-smart-inline-input] #smartTextValue');await field.waitFor();await field.fill('88');await field.press('Enter');await field.waitFor({state:'detached'});await readerText(frame,4,'88');
  const again=defer();setResponse(()=>again.promise);await clickReader(page,frame,0,refreshHandle,true);await readerText(frame,0,'Loading…');await noReaderDatasetWarning(frame);await readerText(frame,4,'88');
  again.resolve({records:readings});await readerText(frame,4,'9');await noReaderDatasetWarning(frame);assert.doesNotMatch(await frame.locator('[data-smart-index="4"]').textContent(),/88/);
  await clickReader(page,frame,5,downloadHandle,true);assert.deepEqual(await download(page,frame),[{label:'High',value:9},{label:'Low',value:2}]);
  await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
  assert.equal(await run('JSON.stringify({items,datasets,undoStack,redoStack})'),before,'returning discards fetched data and edits');
  assert.equal((await record(run)).outputs.available,false);
  const reader=await exported(page,run,context,directory),exportedResponse=defer();setResponse(()=>exportedResponse.promise);
  await clickReader(reader,reader,0,refreshHandle);await readerText(reader,0,'Loading…');await noReaderDatasetWarning(reader);
  exportedResponse.resolve({records:readings});await readerText(reader,4,'High');await noReaderDatasetWarning(reader);
  await clickReader(reader,reader,5,downloadHandle);assert.deepEqual(await download(reader,reader),[{label:'High',value:9},{label:'Low',value:2}]);
  assert.equal(await run('JSON.stringify({items,datasets,undoStack,redoStack})'),before,'HTML reading and downloads do not change authoring');
}));

test('HTTP table publication in HTML does not grant permission to update a stored Dataset',async()=>app(async({page,run,context,directory})=>{
  await seed(run,{readerUpdates:false});const refreshHandle=await handle(run,0,'refresh');const reader=await exported(page,run,context,directory);
  await clickReader(reader,reader,0,refreshHandle);await readerText(reader,2,'High');await readerText(reader,4,'Old');
  assert.doesNotMatch(await reader.locator('[data-smart-index="4"]').textContent(),/High/);
  assert.deepEqual(await run('datasets.saved.rows'),[['Old',1]]);
}));
