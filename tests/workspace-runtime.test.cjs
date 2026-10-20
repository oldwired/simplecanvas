const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://workspace-runtime.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://workspace-runtime.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function loadWorkspace(run,page){
  const data=fs.readFileSync(path.join(__dirname,'..','examples','workspace-runtime.json'),'utf8');
  await run(`openWorkspaceFile(new File([${JSON.stringify(data)}],'workspace.json',{type:'application/json'}))`);
  await page.waitForFunction(()=>__test.run("tabs.length===3 && activeTabId==='runtime-dashboard'"));
  return run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true).then(graph=>[...graph].filter(([,r])=>r.error).map(([i,r])=>({uid:i.uid,error:r.error})))');
}

test('hidden services publish current values and receive equal submissions without switching sketches',async()=>app(async({run,page})=>{
  assert.deepEqual(await loadWorkspace(run,page),[]);
  await run(`(async()=>{
    activateTab('runtime-services');
    const settings=tabDocument('runtime-services').items.find(item=>item.workspaceSettings);
    settings.state.executionMode='active sketch';editorComponentEvaluation=null;
    await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
    settings.state.executionMode='whole workspace';editorComponentEvaluation=null;
    await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
  })()`);
  assert.equal(await run('componentWorkspace(items).whole'),false,'live paint scene still carries its earlier active-sketch context');
  assert.doesNotMatch(await run('itemsToSVGMarkup(items)'),/requires Whole workspace/,'static export uses the current runtime after changing execution mode');
  await run("activateTab('runtime-dashboard');resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)");
  const svg=await run('itemsToSVGMarkup(items)');
  assert.match(svg,/Apples/,'static exports resolve records owned by hidden sketches');
  assert.doesNotMatch(svg,/dataset is missing|requires Whole workspace/);
  const result=await run(`(async()=>{
    const context=editorRuntimeContext(),source=items.find(i=>i.uid==='runtime-message'),records=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
    const before=records.get(context.scene.find(i=>i.uid==='runtime-dashboard-clock')).io.outputs.value;
    const next=Object.defineProperty({...source.state},Symbol.for('simplecanvas.events'),{value:[{port:'value',payload:'Pear'},{port:'value',payload:'Pear'}]});
    await commitEditorSmartEvents(source,next,()=>true);await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
    const logs=context.scene.filter(i=>['runtime-service-log','runtime-editor-log'].includes(i.uid)).map(i=>i.state);
    const timeline=editorTimeline;activateTab('runtime-editor');await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
    return {before,logs,sameTimeline:timeline===editorTimeline,active:activeTabId};
  })()`);
  assert.match(result.before,/^\d\d:\d\d:\d\d$/);assert.equal(result.sameTimeline,true);
  for(const state of result.logs)assert.equal(state.text,'Pear\nPear');
}));

for(const {format,grouped} of [{format:'svg'},{format:'png'},{format:'png',grouped:true}])test(format.toUpperCase()+' download freezes '+(grouped?'rotated group':'smart')+' state and geometry before asynchronous rendering',async()=>app(async({run,page})=>{
  const source=`({
    apiVersion:2,inputs:{},outputs:{value:{type:'string'}},
    compute(inputs,state){return {value:state.value};},
    children(state,style,w,h){return [
      {type:'rect',x:0,y:0,w,h,fill:true,fillColor:state.value==='Before'?'#00ff00':'#ff0000',strokeOn:false},
      {type:'text',x:10,y:10,w:100,h:24,text:state.value,font:'16px sans-serif',color:'#000000',strokeOn:false}
    ];}
  })`;
  await run(`(async()=>{items=[{uid:'export-snapshot',type:'smart',componentApi:2,script:${JSON.stringify(source)},
    state:{value:'Before'},x:100,y:100,w:120,h:50,size:2,fill:true,fillColor:'#00ff00',strokeOn:false}];
    ${grouped?"items[0].group='export-group';items[0].groupRotation=Math.PI/2;items.push({uid:'group-sibling',type:'rect',group:'export-group',groupRotation:Math.PI/2,x:260,y:100,w:40,h:50,size:2,fill:true,fillColor:'#0000ff',strokeOn:false});":""}
    render();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);
  // Hold the actual export between capture and Worker evaluation, then make a live
  // update. Retrying the export would incorrectly save the updated value and size.
  await run(`(()=>{
    const warm=warmSmartExportCache;
    warmSmartExportCache=async(...args)=>{
      window.exportWaiting=true;
      await new Promise(resolve=>window.releaseExport=resolve);
      return warm(...args);
    };
    window.exportFailure=null;
    window.exportCompletion=${format==='svg'?'saveSvg':'savePng'}().catch(error=>{window.exportFailure=error.message;});
  })()`);
  await page.waitForFunction(()=>window.exportWaiting);
  await run("items[0].state={value:'After'};items[0].w=300;items[0].h=100;if(items[1]){items[1].x=600;items[1].y=400;}render();");
  const pending=page.waitForEvent('download');
  await page.evaluate(()=>window.releaseExport());
  const download=await pending;await page.evaluate(()=>window.exportCompletion);
  assert.equal(await page.evaluate(()=>window.exportFailure),null);
  const contents=fs.readFileSync(await download.path());
  if(format==='svg'){
    const svg=contents.toString('utf8');
    assert.match(svg,/>Before</);assert.doesNotMatch(svg,/>After</);
    assert.match(svg,/<svg[^>]*width="174" height="104"/);
  }else{
    assert.equal(contents.subarray(1,4).toString(),'PNG');
    assert.equal(contents.readUInt32BE(16),grouped?208:348);assert.equal(contents.readUInt32BE(20),grouped?508:208);
    const pixel=await page.evaluate(async ({encoded,grouped})=>{
      const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);
      return Array.from(context.getImageData(grouped?65:200,grouped?250:140,1,1).data);
    },{encoded:contents.toString('base64'),grouped});
    assert.deepEqual(pixel,[0,255,0,255],'PNG paints the captured state');
  }
  assert.deepEqual(await run('({value:items[0].state.value,w:items[0].w,h:items[0].h})'),{value:'After',w:300,h:100},'export keeps the live update intact');
}));

test('shared data edits update the owner, undo across sketches, and keep pause on navigation/history',async()=>app(async({run,page})=>{
  assert.deepEqual(await loadWorkspace(run,page),[]);
  const result=await run(`(async()=>{
    const context=editorRuntimeContext(),owner=context.scene.find(i=>i.uid==='runtime-stock-owner'),id=owner.inputValues.data.datasetId;
    const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);const original=graph.datasets[id].rows[0][1];
    await controlComponentSimulation('pause');
    const rowId=datasetRowIds(graph.datasets[id])[0];
    commitEditorDatasetChange({type:'update',datasetId:id,rowId,changes:{quantity:77}});
    await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);activateTab('runtime-editor');await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
    const changed=editorComponentEvaluation.records.get(items.find(i=>i.uid==='runtime-stock-editor')).io.tables.inputs.data.rows[0][1];
    undo();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);const restored=editorRuntimeContext().pool[id].rows[0][1];
    return {changed,restored,original,paused:editorTimeline.pausedByUser};
  })()`);
  assert.equal(result.changed,77);assert.equal(result.restored,result.original);assert.equal(result.paused,true);
}));

test('accepted events finish hidden Worker calls after navigation and cancel when their source is removed',async()=>app(async({run,page})=>{
  assert.deepEqual(await loadWorkspace(run,page),[]);
  const begin=async text=>run(`(()=>{
    const source=editorRuntimeContext().scene.find(item=>item.uid==='runtime-message');
    window.eventHeld=false;window.eventFinished=false;window.eventOutcome=null;window.eventFailure=null;
    const original=dispatchSmartSandboxNext;window.releaseHeldEvent=()=>{dispatchSmartSandboxNext=original;original();};
    dispatchSmartSandboxNext=()=>{
      if([...smartSandboxPending.values()].some(job=>job.message.fn==='onEvent')){window.eventHeld=true;return;}
      original();
    };
    const next=Object.defineProperty({...source.state},Symbol.for('simplecanvas.events'),{value:[{port:'value',payload:${JSON.stringify(text)}}]});
    void commitEditorSmartEvents(source,next,()=>true).then(()=>{window.eventOutcome='accepted';},error=>{window.eventOutcome=error.cancelled?'cancelled':error.message;window.eventFailure={message:error.message,stack:error.stack,cancelled:!!error.cancelled};}).finally(()=>{window.eventFinished=true;});
  })()`);
  const waitHeld=async()=>{
    await page.waitForFunction(()=>window.eventHeld || window.eventFinished);
    const status=await run(`({held:window.eventHeld,finished:window.eventFinished,outcome:window.eventOutcome,failure:window.eventFailure,activeTabId,pending:[...smartSandboxPending.values()].map(job=>({method:job.message.method,fn:job.message.fn})),graphErrors:[...(editorComponentEvaluation?.records||[])].filter(([,record])=>record.error).map(([item,record])=>({uid:item.uid,error:record.error}))})`);
    assert.equal(status.held,true,JSON.stringify(status,null,2));
  };
  await begin('Across navigation');await waitHeld();
  await run("activateTab('runtime-services')");await page.evaluate(()=>window.releaseHeldEvent());
  await page.waitForFunction(()=>window.eventFinished);
  assert.equal(await page.evaluate(()=>window.eventOutcome),'accepted');
  assert.equal(await run("editorRuntimeContext().scene.find(item=>item.uid==='runtime-service-log').state.text"),'Across navigation');
  await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
  await begin('Must be cancelled');await waitHeld();
  await run("tabDocument('runtime-dashboard').items=tabDocument('runtime-dashboard').items.filter(item=>item.uid!=='runtime-message');editorRuntimeContext();editorComponentEvaluation=null");
  await page.evaluate(()=>window.releaseHeldEvent());await page.waitForFunction(()=>window.eventFinished);
  assert.equal(await page.evaluate(()=>window.eventOutcome),'cancelled');
  assert.equal(await run("editorRuntimeContext().scene.find(item=>item.uid==='runtime-service-log').state.text"),'Across navigation');
}));

test('table endpoints route a filtered view across sketches without publishing its dataset to the catalog',async()=>app(async({run,page})=>{
  assert.deepEqual(await loadWorkspace(run,page),[]);
  const scripts=Object.fromEntries(['table-filter','publish','receive','data-table'].map(name=>[name,fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8')]));
  const result=await run(`(async()=>{
    const scripts=${JSON.stringify(scripts)},make=(uid,type,extra={})=>{
      const definition=eval(scripts[type]);return {uid,type:'smart',componentApi:2,script:scripts[type],state:definition.initState(),...definition.initStyle(),x:40,y:680,inputValues:{},bindings:{},...extra};
    };
    const services=tabDocument('runtime-services'),owner=services.items.find(item=>item.uid==='runtime-stock-owner');owner.datasetShared=false;
    const filter=make('table-filter-source','table-filter',{inputValues:{data:owner.inputValues.data,column:'quantity',operation:'>',number:10}});
    const publish=make('table-publish-source','publish',{state:{endpoints:[{id:'value',name:'Filtered stock',type:'table',description:''}]},bindings:{value:{uid:filter.uid,port:'data'}}});
    services.items.push(filter,publish);
    const receive=make('table-receive-target','receive',{state:{endpoints:[{id:'value',name:'Filtered stock',type:'table',description:''}]},workspaceReceive:{value:{sketchId:'runtime-services',componentUid:publish.uid,port:'value'}}});
    const view=make('table-view-target','data-table',{bindings:{data:{uid:receive.uid,port:'value'}}});items.push(receive,view);
    editorComponentEvaluation=null;saveEditorRuntime();let graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
    const before=graph.get(view).io.tables?.inputs?.data?.rows,errors=[...graph].filter(([,record])=>record.error).map(([item,record])=>[item.uid,record.error]);
    const id=owner.inputValues.data.datasetId,rowId=datasetRowIds(graph.datasets[id])[1];
    commitEditorDatasetChange({type:'update',datasetId:id,rowId,changes:{quantity:18}});graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
    return {before,after:graph.get(view).io.tables?.inputs?.data?.rows,errors,shared:owner.datasetShared,events:Object.keys(graph.get(receive).caps.eventOutputs||{})};
  })()`);
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.before,[['Apples',12]]);
  assert.deepEqual(result.after,[['Apples',12],['Oranges',18]]);assert.equal(result.shared,false);assert.deepEqual(result.events,[]);
}));

test('offline workspace starts at configured sketch, hides service tab and continues remote processing',async()=>app(async({run,page,context})=>{
  assert.deepEqual(await loadWorkspace(run,page),[]);
  const downloadScript=fs.readFileSync(path.join(__dirname,'..','examples','data-download.js'),'utf8');
  const memoScript=fs.readFileSync(path.join(__dirname,'..','examples','memo.js'),'utf8');
  await run(`(()=>{
    const download=eval(${JSON.stringify(downloadScript)}),memo=eval(${JSON.stringify(memoScript)});
    const owner=editorRuntimeContext().scene.find(item=>item.uid==='runtime-stock-owner');
    // Nine datasets on each of two sketches exceed the per-sketch limit only when incorrectly merged.
    const services=tabDocument('runtime-services');services.items.find(item=>item.workspaceSettings===true).inputValues.showWiring=true;
    for(const [prefix,targetItems,targetPool,count] of [['service',services.items,services.datasets,7],['dashboard',items,datasets,9]]){
      for(let i=0;i<count;i++){
        const id='extra-'+prefix+'-'+i;targetPool[id]={name:id,columns:[{key:'value',name:'Value',type:'number'}],rows:[[i]]};
        const extra=JSON.parse(JSON.stringify(owner));Object.assign(extra,{uid:id,type:'smart',componentName:id,x:40+i*36,y:940,w:32,h:24,datasetShared:false,inputValues:{data:{datasetId:id}},bindings:{},eventBindings:{}});
        extra.state.allowReaderImport=false;targetItems.push(extra);
      }
    }
    items.push({uid:'runtime-download',type:'smart',componentApi:2,script:${JSON.stringify(downloadScript)},state:download.initState(),...download.initStyle(),x:900,y:620,
      inputValues:{data:{...owner.inputValues.data,sketchId:'runtime-services'},filename:'stock-before'},bindings:{}},
      {uid:'runtime-download-log',type:'smart',componentApi:2,script:${JSON.stringify(memoScript)},state:memo.initState(),...memo.initStyle(),x:900,y:800,
      inputValues:{},bindings:{},eventBindings:{line:{uid:'runtime-download',port:'prepared'}}});
    editorComponentEvaluation=null;saveEditorRuntime();
  })()`);

  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-workspace-runtime-'));context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'workspace.html');fs.copyFileSync(await(await download).path(),file);
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('    void activate(initial);', '    window.__reader={run:source=>eval(source)};void activate(initial);'));
  const reader=await context.newPage(),errors=[],requests=[];reader.on('pageerror',e=>errors.push(e.message));reader.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>!document.documentElement.classList.contains('sc-reader-starting'));
  assert.equal(await reader.locator('.tab-select.active').getAttribute('data-tab-id'),'runtime-dashboard');
  assert.equal(await reader.locator('[data-tab-id="runtime-services"].tab-select').isVisible(),false);
  await reader.waitForFunction(()=>document.querySelector('[data-tab-id="runtime-dashboard"].tab-panel [data-smart-ready="true"]'));
  assert.match(await reader.title(),/Fruit stock/);
  await reader.locator('[data-tab-id="runtime-dashboard"].tab-panel [data-reader-wiring] [data-wire-port][data-uid="runtime-message"]').first().waitFor({state:'attached'});
  assert.match(await reader.locator('[data-tab-id="runtime-dashboard"].tab-panel [data-dataset-reference][data-remote="true"] title').first().textContent(),/Services/);
  const readerRun=source=>reader.evaluate(source=>window.__reader.run(source),source);
  const clickHandle=async(uid,id)=>{
    const point=await readerRun(`(async()=>{
      const e=entryFor(items.find(item=>item.uid===${JSON.stringify(uid)}));
      const handles=await requestSmartCall(e.item,'handles',[e.item.state,e.item.w,e.item.h,smartResolvedStyle(e.item)]);
      const handle=handles.find(handle=>handle.id===${JSON.stringify(id)});if(!handle)throw new Error('Missing handle');
      const p=new DOMPoint(handle.x,handle.y).matrixTransform(e.local.getScreenCTM());return {x:p.x,y:p.y};
    })()`);
    await reader.mouse.click(point.x,point.y);
  };
  const stockId=await readerRun('items.find(item=>item.uid==="runtime-stock-owner").inputValues.data.datasetId');
  const stockExpr=`datasets[${JSON.stringify(stockId)}]`;
  assert.equal(await readerRun('Object.keys(datasets).length'),18);
  const before=await readerRun(`${stockExpr}.rows.length`);
  await clickHandle('runtime-message','entry');
  const field=reader.locator('[data-smart-inline-input] #smartTextValue');await field.waitFor();
  await field.fill('Pear');await field.press('Enter');
  await reader.waitForFunction(()=>window.__reader.run('items.find(i=>i.uid==="runtime-service-log").state.text')==='Pear');
  await reader.waitForFunction(()=>!document.querySelector('[data-smart-inline-input] #smartTextValue')?.readOnly);
  await field.press('Enter');
  await reader.waitForFunction(()=>window.__reader.run('items.find(i=>i.uid==="runtime-service-log").state.text')==='Pear\nPear');
  await reader.waitForFunction(({expr,count})=>window.__reader.run(expr)===count,{expr:`${stockExpr}.rows.length`,count:before+2});
  assert.deepEqual(await readerRun(`${stockExpr}.rows.slice(-2)`),[['Pear',1],['Pear',1]]);
  await field.press('Escape');
  await reader.locator('.tab-select[data-tab-id="runtime-editor"]').click();
  await reader.waitForFunction(()=>document.title==='Edit fruit stock · Workspace example');
  await reader.locator('[data-tab-id="runtime-editor"].tab-panel [data-reader-wiring] [data-wire-port][data-uid="runtime-stock-editor"]').first().waitFor({state:'attached'});
  assert.equal(await reader.locator('[data-tab-id="runtime-editor"].tab-panel [data-wire-port][data-uid="runtime-message"]').count(),0);
  await reader.waitForFunction(()=>window.__reader.run('entryFor(items.find(i=>i.uid==="runtime-stock-editor")).host.dataset.smartReady')==='true');
  assert.equal(await readerRun('items.find(i=>i.uid==="runtime-editor-log").state.text'),'Pear\nPear');
  await clickHandle('runtime-stock-editor','cell-0-1');
  const cell=reader.locator('[data-smart-inline-input] #smartTextValue');await cell.waitFor();await cell.fill('77');await cell.press('Enter');await cell.waitFor({state:'detached'});
  await reader.waitForFunction(expr=>window.__reader.run(expr)===77,`${stockExpr}.rows[0][1]`);
  await clickHandle('runtime-editor-home','go');
  await reader.waitForFunction(()=>document.querySelector('.tab-select.active')?.dataset.tabId==='runtime-dashboard');
  assert.equal(await readerRun(`${stockExpr}.rows[0][1]`),77);
  await clickHandle('runtime-open-services','go');
  await reader.waitForFunction(()=>document.querySelector('.tab-select.active')?.dataset.tabId==='runtime-services');
  assert.equal(await reader.locator('[data-tab-id="runtime-services"].tab-select').isVisible(),false,'hidden tabs remain reachable with Go to tab');
  // A service reload is accepted before navigation and completes in the same runtime.
  await readerRun(`(async()=>{
    const owner=items.find(item=>item.uid==='runtime-stock-owner');
    window.reloadRequested=false;window.reloadTimeline=timeline;
    rememberComponentDatasetSource(owner,'data',{name:'stock.csv',delimiter:',',handle:{getFile:()=>new Promise(resolve=>{
      window.reloadRequested=true;window.releaseReload=()=>resolve(new File(['fruit,quantity\\nGrapes,19\\n'],'stock.csv'));
    })}});
    const graph=await resolveComponentGraph(),name=Object.keys(graph.get(owner).caps.dataActions).find(name=>graph.get(owner).caps.dataActions[name].type==='reloadDataset');
    queueReaderComponentActionIntents([captureComponentActionIntent(owner,name,graph.get(owner),graph.datasets)]);
  })()`);
  await reader.waitForFunction(()=>window.reloadRequested);
  await reader.locator('.tab-select[data-tab-id="runtime-dashboard"]').click();
  await reader.evaluate(()=>window.releaseReload());
  await reader.waitForFunction(()=>window.__reader.run('!actionDispatcher.running'));
  assert.deepEqual(await readerRun(`${stockExpr}.rows`),[['Grapes',19]]);
  assert.equal(await readerRun('Object.keys(datasets).length'),18,'reload retains the other sketch’s stored datasets');
  assert.equal(await readerRun('timeline===window.reloadTimeline'),true);
  // Prepared output is delivered once; the browser only downloads after an explicit click.
  const downloaded=[];reader.on('download',value=>downloaded.push(value));
  await readerRun(`(async()=>{
    const item=items.find(item=>item.uid==='runtime-download'),graph=await resolveComponentGraph();
    const intent=captureComponentActionIntent(item,'csv',graph.get(item),graph.datasets);
    item.inputValues.filename='later-name';queueReaderComponentActionIntents([intent]);
  })()`);
  await reader.waitForFunction(()=>window.__reader.run('!actionDispatcher.running'));
  assert.equal(await readerRun('items.find(item=>item.uid==="runtime-download-log").state.text'),'stock-before.csv');
  assert.equal(downloaded.length,0);
  const fileDownload=reader.waitForEvent('download');
  await reader.locator('[data-prepared-download]').getByRole('button',{name:'Download',exact:true}).click();
  const saved=await fileDownload;assert.equal(saved.suggestedFilename(),'stock-before.csv');
  assert.match(fs.readFileSync(await saved.path(),'utf8'),/Grapes,19/);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
