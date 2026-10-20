const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url'),{launchBrowser}=require('./helpers/browser.cjs');
const root=path.join(__dirname,'..'),engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const scripts=Object.fromEntries(['workspace-settings','text-input','text-extract','publish','receive','text-compose','memo','data-source','data-table']
  .map(name=>[name,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8')]));
const eventSink=`({
  apiVersion:2,eventApi:1,
  eventInputs:{record:{types:['none','boolean','number','string']}},
  inputs:{},outputs:{count:{type:'number'}},initState(){return {values:[]};},
  compute(inputs,state){return {count:state.values.length};},
  onEvent(name,payload,state){return {state:{values:[...state.values,payload]}};},
  children(state,style,w,h){return [{type:'text',x:0,y:0,w,h,text:String(state.values.length),font:'16px sans-serif',color:'#334155'}];}
})`;
function endpoint(id,type,name=id){return {id,name,type,description:''};}
function item(script,uid,x,y,patch={}){
  const source=scripts[script]||script,definition=vm.runInNewContext(source);
  return {type:'smart',componentApi:2,uid,componentName:uid,script:source,x,y,w:280,h:90,
    color:'#334155',textColor:'#334155',fill:true,fillColor:'#fff',strokeOn:true,size:1,fontSize:16,
    ...definition.initStyle?.(),inputValues:{},bindings:{},eventBindings:{},...patch,
    state:{...definition.initState?.(),...patch.state}};
}
function fixture(){
  const outgoing=[endpoint('first','string'),endpoint('last','string'),endpoint('count','number'),
    endpoint('flag','boolean'),endpoint('rows','table'),endpoint('notice','event'),endpoint('complete','string')];
  const incoming=[endpoint('left','string'),endpoint('right','string'),endpoint('total','number'),
    endpoint('enabled','boolean'),endpoint('data','table'),endpoint('notice','event'),endpoint('side','number'),endpoint('complete','string')];
  const refs=Object.fromEntries([['left','first'],['right','last'],['total','count'],['enabled','flag'],['data','rows'],['notice','notice'],['complete','complete']]
    .map(([local,port])=>[local,{sketchId:'multi-controls',componentUid:'multi-main',port}]));
  refs.side={sketchId:'multi-other',componentUid:'multi-second',port:'extra'};
  return {app:'SimpleCanvasWorkspace',version:5,activeIndex:0,tabs:[
    {id:'multi-controls',name:'Controls',assets:{},datasets:{'multi-stock':{name:'Stock',columns:[
      {key:'name',name:'Name',type:'string'},{key:'quantity',name:'Quantity',type:'number'}],rows:[['Alpha',2],['Beta',4]]}},items:[
      item('text-input','multi-text',40,60),
      item('text-extract','multi-first',400,30,{inputValues:{start:0,length:2},bindings:{text:{uid:'multi-text',port:'value'}}}),
      item('text-extract','multi-last',400,220,{inputValues:{start:2,length:3},bindings:{text:{uid:'multi-text',port:'value'}}}),
      item('data-source','multi-owner',40,340,{datasetShared:false,inputValues:{data:{datasetId:'multi-stock'}}}),
      item('publish','multi-main',820,40,{workspaceEndpoint:'publish',state:{endpoints:outgoing},
        inputValues:{count:7,flag:true},bindings:{first:{uid:'multi-first',port:'text'},last:{uid:'multi-last',port:'text'},rows:{uid:'multi-owner',port:'data'},complete:{uid:'multi-return',port:'value'}},
        eventBindings:{notice:{uid:'multi-text',port:'value'}}}),
      item('receive','multi-return',820,570,{workspaceEndpoint:'receive',
        workspaceReceive:{value:{sketchId:'multi-consumers',componentUid:'multi-response',port:'value'}}})
    ]},
    {id:'multi-other',name:'Other source',assets:{},datasets:{},items:[
      item('workspace-settings','multi-settings',40,40,{workspaceSettings:true,
        state:{executionMode:'whole workspace',initialSketchId:'multi-controls',tabVisibility:[]},inputValues:{showWiring:true}}),
      item('publish','multi-second',440,40,{workspaceEndpoint:'publish',state:{endpoints:[endpoint('extra','number','Other number')]},inputValues:{extra:42}})
    ]},
    {id:'multi-consumers',name:'Consumers',assets:{},datasets:{},items:[
      item('receive','multi-receiver',40,50,{workspaceEndpoint:'receive',state:{endpoints:incoming},workspaceReceive:refs}),
      item('text-compose','multi-compose',420,50,{inputValues:{separator:':'},bindings:{a:{uid:'multi-receiver',port:'left'},b:{uid:'multi-receiver',port:'right'}}}),
      item('memo','multi-log',420,300,{bindings:{line:{uid:'multi-compose',port:'text'}}}),
      item(eventSink,'multi-events',820,580),
      item('data-table','multi-table',820,50,{bindings:{data:{uid:'multi-receiver',port:'data'}}}),
      item('text-compose','multi-step',40,700,{inputValues:{b:'!',separator:''},bindings:{a:{uid:'multi-receiver',port:'left'}}}),
      item('publish','multi-response',420,700,{workspaceEndpoint:'publish',bindings:{value:{uid:'multi-step',port:'text'}}}),
      item('memo','multi-return-log',820,700,{bindings:{line:{uid:'multi-receiver',port:'complete'}}})
    ]}
  ]};
}
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>browser?.close());
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1050}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://multi-endpoint.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://multi-endpoint.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');
    const data=fixture();data.tabs[2].items[3].eventBindings={record:{uid:'multi-receiver',port:'notice'}};
    await run(`openWorkspaceFile(new File([${JSON.stringify(JSON.stringify(data))}],'multi-endpoints.json',{type:'application/json'}))`);
    await page.waitForFunction(()=>__test.run("tabs.length===3 && activeTabId==='multi-controls'"));
    await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
    await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
const editorSnapshot=`(async()=>{
  const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true),scene=editorRuntimeContext().scene,find=uid=>scene.find(item=>item.uid===uid);
  return {errors:[...graph].filter(([,record])=>record.error).map(([item,record])=>[item.uid,record.error]),
    outputs:graph.get(find('multi-receiver')).io.outputs,rows:graph.get(find('multi-table')).io.tables?.inputs?.data?.rows,
    log:find('multi-log').state.text,returnLog:find('multi-return-log').state.text,events:find('multi-events').state.values};
})()`;
const readerSnapshot=editorSnapshot.replaceAll('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)','resolveAcceptedComponentGraph(resolveComponentGraph,()=>true)')
  .replace('editorRuntimeContext().scene','items');
async function submit(page,point,value){
  await page.mouse.click(point.x,point.y);
  const input=page.locator('[data-smart-inline-input] #smartTextValue');await input.waitFor();
  await input.fill(value);await input.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('[data-smart-inline-input] #smartTextValue')?.readOnly);
  await input.press('Escape');await input.waitFor({state:'detached'});
}
function verifyInitial(snapshot){
  assert.deepEqual(snapshot.errors,[]);
  assert.equal(snapshot.outputs.total,7);assert.equal(snapshot.outputs.enabled,true);assert.equal(snapshot.outputs.side,42);
  assert.equal(snapshot.outputs.left,'');assert.equal(snapshot.outputs.right,'');
  assert.equal(snapshot.outputs.complete,'!','startup values can revisit independent rows of the same Publish and Receive');
  assert.equal(snapshot.outputs.data.datasetId,'multi-stock');assert.ok(!Object.hasOwn(snapshot.outputs,'notice'));
  assert.deepEqual(snapshot.rows,[['Alpha',2],['Beta',4]]);assert.equal(snapshot.log,'');assert.equal(snapshot.returnLog,'');assert.deepEqual(snapshot.events,[]);
}
function verifyEvents(snapshot){
  assert.deepEqual(snapshot.errors,[]);
  assert.equal(snapshot.outputs.left,'He');assert.equal(snapshot.outputs.right,'llo');
  assert.equal(snapshot.log,'He:llo\nHe:llo','each original submission reconverges into exactly one complete composed line');
  assert.equal(snapshot.outputs.complete,'He!');
  assert.equal(snapshot.returnLog,'He!\nHe!','each occurrence can revisit independent connector rows without a false dependency cycle');
  assert.deepEqual(snapshot.events,['Hello','Hello'],'event-only endpoint preserves equal independent occurrences');
}
test('one Receive maps mixed endpoints from independent publishers and preserves reconverging hybrid occurrences',async()=>app(async({page,run})=>{
  verifyInitial(await run(editorSnapshot));
  const point=await run(`(async()=>{
    const item=items.find(item=>item.uid==='multi-text'),index=items.indexOf(item);
    setTool('select');selection=[index];editingSmartIdx=index;render();
    const handle=(await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)])).find(handle=>handle.id==='entry');
    const world=toWorld(item,item.x+handle.x,item.y+handle.y),box=canvas.getBoundingClientRect();return {x:box.left+world.x,y:box.top+world.y};
  })()`);
  await submit(page,point,'Hello');await submit(page,point,'Hello');
  verifyEvents(await run(editorSnapshot));
  await run(`(async()=>{
    const context=editorRuntimeContext(),publisher=context.scene.find(item=>item.uid==='multi-main');
    publisher.state.endpoints[0].name='Renamed display name';
    context.scene.find(item=>item.uid==='multi-second').inputValues.extra=99;
    const table=context.pool['multi-stock'];commitEditorDatasetChange({type:'update',datasetId:'multi-stock',rowId:datasetRowIds(table)[1],changes:{quantity:8}});
    await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
  })()`);
  const changed=await run(editorSnapshot);verifyEvents(changed);
  assert.equal(changed.outputs.side,99);assert.deepEqual(changed.rows,[['Alpha',2],['Beta',8]]);
}));
test('offline HTML preserves mixed endpoint mappings, table flow and repeated reconverging events',async()=>app(async({page,run,context})=>{
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-multi-endpoints-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'workspace.html');
  const source=fs.readFileSync(await(await download).path(),'utf8');
  assert.match((source.match(/<svg\b[\s\S]*?<\/svg>/g)||[]).join(''),/Alpha/,'initial static SVG already resolves the remote table');
  fs.writeFileSync(file,source.replace('    void activate(initial);','    window.__reader={run:source=>eval(source)};void activate(initial);'));
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>!document.documentElement.classList.contains('sc-reader-starting'));
  const readerRun=source=>reader.evaluate(source=>window.__reader.run(source),source);
  verifyInitial(await readerRun(readerSnapshot));
  const point=await readerRun(`(async()=>{
    const entry=entryFor(items.find(item=>item.uid==='multi-text')),item=entry.item;
    const handle=(await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)])).find(handle=>handle.id==='entry');
    const point=new DOMPoint(handle.x,handle.y).matrixTransform(entry.local.getScreenCTM());return {x:point.x,y:point.y};
  })()`);
  await submit(reader,point,'Hello');await submit(reader,point,'Hello');
  verifyEvents(await readerRun(readerSnapshot));
  await reader.locator('.tab-select[data-tab-id="multi-consumers"]').click();
  await reader.waitForFunction(()=>document.querySelector('.tab-select.active')?.dataset.tabId==='multi-consumers');
  verifyEvents(await readerRun(readerSnapshot));
  assert.deepEqual((await run(editorSnapshot)).events,[],'reader changes stay local to the downloaded document');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
