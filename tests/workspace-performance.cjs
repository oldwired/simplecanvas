// Development-only, observational benchmark. No timing thresholds or runtime-limit overrides.
// node tests/workspace-performance.cjs [baseline-ref|working-only] [update-count]
// BROWSER_ENGINE=webkit selects WebKit; the default baseline is pre-stabilization 0e557fe.
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..');
const baseline=process.argv[2]||'0e557fe';
const updates=Number(process.argv[3]||5);
if(!Number.isSafeInteger(updates)||updates<1||updates>20)throw new Error('Choose 1–20 updates');
const timeoutMs=Number(process.env.BENCH_TIMEOUT_MS||120000);
if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw new Error('BENCH_TIMEOUT_MS must be 1000–300000');

function makeFixture(){
  const definitions=new Map();
  const get=name=>{
    if(!definitions.has(name)){
      const script=fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8');
      // Only trusted checked-in examples run here, to construct their normal initial fixture state.
      definitions.set(name,{script,definition:vm.runInNewContext('('+script+')',{}, {timeout:1000})});
    }
    return definitions.get(name);
  };
  const tabs=['services','dashboard','reports'].map(id=>({id:'bench-'+id,name:id[0].toUpperCase()+id.slice(1),version:5,items:[],datasets:{},assets:{}}));
  const add=(tab,name,uid,extra={})=>{
    const {script,definition}=get(name),position=tabs[tab].items.length;
    const item={type:'smart',componentApi:2,uid,componentName:uid,x:30+(position%4)*340,y:450+Math.floor(position/4)*210,
      w:300,h:180,color:'#334155',textColor:'#0f172a',fillColor:'#ffffff',fill:false,strokeOn:false,size:1,
      fontFamily:'sans',fontSize:16,font:'600 16px sans-serif',state:JSON.parse(JSON.stringify(definition.initState?.()||{})),
      ...JSON.parse(JSON.stringify(definition.initStyle?.()||{})),script,...extra};
    tabs[tab].items.push(item);return item;
  };
  const wire=(uid,port='value')=>({uid,port});
  add(0,'text-input','bench-entry',{x:30,y:40,w:300,h:100});
  add(0,'text-compose','bench-compose',{x:400,y:40,w:300,h:130,bindings:{a:wire('bench-entry')},inputValues:{b:'measurement',separator:' / '}});
  add(0,'memo','bench-log',{x:760,y:40,w:360,h:260,bindings:{line:wire('bench-compose','text')}});
  add(0,'text-label','bench-text',{bindings:{value:wire('bench-compose','text')}});
  const settings=add(0,'workspace-settings','bench-settings',{workspaceSettings:true});settings.state.executionMode='whole workspace';
  settings.state.initialSketchId=tabs[0].id;
  for(let channel=0;channel<16;channel++){
    const tab=channel%3,prefix='channel-'+channel;
    const control=add(tab,'number-control',prefix+'-input');control.state.value=channel+10;
    add(tab,'math',prefix+'-math',{bindings:{a:wire(control.uid)},inputValues:{b:2,operation:'×'}});
    add(tab,'compare',prefix+'-compare',{bindings:{value:wire(prefix+'-math')},inputValues:{b:35,operation:'>'}});
    add(tab,'status-indicator',prefix+'-status',{bindings:{value:wire(prefix+'-compare')}});
    add(tab,'value-label',prefix+'-label',{bindings:{value:wire(prefix+'-math')}});
  }
  tabs[0].datasets['bench-readings']={name:'Readings',columns:[{key:'group',name:'Group',type:'string'},{key:'amount',name:'Amount',type:'number'},{key:'active',name:'Active',type:'boolean'}],
    rows:Array.from({length:256},(_,i)=>['Group '+i%8,(i*17)%101,i%3!==0])};
  add(0,'data-source','bench-dataset',{datasetOwner:'data',datasetShared:true,inputValues:{data:{datasetId:'bench-readings'}}});
  for(let channel=0;channel<4;channel++){
    const tab=channel%3,prefix='data-'+channel;
    add(tab,'table-filter',prefix+'-filter',{inputValues:{data:{datasetId:'bench-readings',...(tab?{sketchId:tabs[0].id}:{})},column:'amount',operation:'≥',number:channel*10}});
    add(tab,'table-sort',prefix+'-sort',{bindings:{data:wire(prefix+'-filter','data')},inputValues:{column:'amount',direction:'descending'}});
    add(tab,'table-aggregate',prefix+'-aggregate',{bindings:{data:wire(prefix+'-sort','data')},inputValues:{group:'group',value:'amount',operation:'sum'}});
    add(tab,'data-table',prefix+'-table',{w:320,h:200,bindings:{data:wire(prefix+'-sort','data')}});
    add(tab,'data-bar-chart',prefix+'-chart',{w:320,h:200,bindings:{data:wire(prefix+'-aggregate','data')}});
    add(tab,'value-label',prefix+'-count',{bindings:{value:wire(prefix+'-filter','rowCount')}});
  }
  const endpoints=[{id:'number',name:'Number',type:'number',description:''},{id:'message',name:'Message',type:'string',description:''}];
  add(0,'publish','bench-publish',{state:{endpoints},bindings:{number:wire('channel-0-input'),message:wire('bench-compose','text')}});
  for(let tab=1;tab<3;tab++){
    const uid='bench-receive-'+tab;
    add(tab,'receive',uid,{state:{endpoints},workspaceReceive:Object.fromEntries(endpoints.map(row=>[row.id,{sketchId:tabs[0].id,componentUid:'bench-publish',port:row.id}]))});
    add(tab,'value-label','remote-number-'+tab,{bindings:{value:wire(uid,'number')}});
    add(tab,'memo','remote-log-'+tab,{bindings:{line:wire(uid,'message')}});
  }
  // A long-period timer includes stateful timeline work without nondeterministic clock ticks
  // contaminating the bounded update measurements below.
  add(0,'pulse-generator','bench-clock',{inputValues:{seconds:3600,width:1,enable:true}});
  add(0,'counter','bench-counter',{bindings:{value:wire('bench-clock')}});
  const fixture={app:'SimpleCanvasWorkspace',version:5,activeIndex:0,tabs};
  const count=tabs.reduce((n,tab)=>n+tab.items.length,0);
  if(count<100||count>128)throw new Error('Benchmark fixture must contain 100–128 components');
  return {fixture,description:{sketches:tabs.length,components:count,componentsPerSketch:tabs.map(tab=>tab.items.length),distinctScripts:definitions.size,datasetRows:256,
    sourceBytes:Buffer.byteLength(JSON.stringify(fixture)),sha256:crypto.createHash('sha256').update(JSON.stringify(fixture)).digest('hex')}};
}
const {fixture,description}=makeFixture();
function instrument(html,{countCalls=true}={}){
  if(countCalls)html=parseApp(html).instrumentFunction('requestSmartSandbox',`globalThis.__benchHooks??={};const benchHook=message.method==='caps'?'caps':message.fn||message.method;globalThis.__benchHooks[benchHook]=(globalThis.__benchHooks[benchHook]||0)+1;`);
  return parseApp(html).inject(`window.__bench={run:source=>eval(source)};`);
}
const snapshotCode=`({at:performance.now(),requests:smartSandboxReqSeq,workers:{...smartRuntimeStats},hooks:{...globalThis.__benchHooks}})`;
function difference(before,after,elapsed){
  return {elapsedMs:Math.round(elapsed??after.at-before.at),sandboxRequests:after.requests-before.requests,workersCreated:after.workers.created-before.workers.created,
    hooks:Object.fromEntries(Object.keys(after.hooks).map(key=>[key,after.hooks[key]-(before.hooks[key]||0)]).filter(([,count])=>count))};
}
const graphCode=`(async()=>{
  const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
  const errors=[...graph].filter(([,record])=>record.error).map(([item,record])=>({uid:item.uid,error:record.error}));
  if(errors.length)throw new Error(JSON.stringify(errors));return graph.size;
})()`;
async function editorIdle(page){
  await page.waitForFunction(()=>__bench.run('editorComponentEvaluation?.records && smartInFlight.size===0 && smartHandlesInFlight.size===0 && smartSandboxPending.size===0'),null,{timeout:timeoutMs});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function measureVersion(browser,version){
  const raw=version==='working'?fs.readFileSync(path.join(root,'index.html'),'utf8'):cp.execFileSync('git',['show',version+':index.html'],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
  const html=instrument(raw),context=await browser.newContext({viewport:{width:1440,height:1100}});
  const watchdog=setTimeout(()=>void context.close(),timeoutMs*3);
  const result={version,appBytes:Buffer.byteLength(raw),status:'started'};
  let phase='startup';
  const stage=name=>{phase=name;console.error(version+': '+name);};
  try{
    stage('startup');
    const page=await context.newPage(),errors=[];page.setDefaultTimeout(timeoutMs);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://workspace-bench.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    const run=code=>page.evaluate(code=>__bench.run(code),code);
    let started=performance.now();await page.goto('http://workspace-bench.test/index.html');await run('appReady');
    result.emptyAppReadyMs=Math.round(performance.now()-started);
    stage('workspace load and first paint');
    let before=await run(snapshotCode);started=performance.now();
    await run(`openWorkspaceFile(new File([${JSON.stringify(JSON.stringify(fixture))}],'benchmark.json',{type:'application/json'}))`);
    await page.waitForFunction(()=>__bench.run("tabs.length===3 && activeTabId==='bench-services'"));
    result.workspaceComponents=await run(graphCode);await editorIdle(page);
    result.workspaceLoadAndFirstPaint=difference(before,await run(snapshotCode),performance.now()-started);
    if(result.workspaceComponents!==description.components)throw new Error('Not every fixture component entered the whole-workspace graph');
    stage('unchanged evaluations');
    result.unchangedEvaluations=[];
    for(let i=0;i<updates;i++){
      before=await run(snapshotCode);started=performance.now();await run('editorComponentEvaluation=null;'+graphCode);await editorIdle(page);
      result.unchangedEvaluations.push(difference(before,await run(snapshotCode),performance.now()-started));
    }
    result.changedEvaluations=[];
    stage('changed evaluations');
    for(let i=0;i<updates;i++){
      before=await run(snapshotCode);started=performance.now();
      await run(`items.find(item=>item.uid==='channel-0-input').state.value=${30+i};editorComponentEvaluation=null;`+graphCode);await editorIdle(page);
      const value=await run("editorComponentEvaluation.records.get(items.find(item=>item.uid==='channel-0-math')).io.outputs.value");
      if(value!==(30+i)*2)throw new Error('Updated numeric output did not propagate');
      result.changedEvaluations.push(difference(before,await run(snapshotCode),performance.now()-started));
    }
    // Real inline entry and Enter, with completion observed on three independently stored Memos.
    stage('inline submission');
    await run("setTool('select');selection=[items.findIndex(item=>item.uid==='bench-entry')];editingSmartIdx=selection[0];render()");await editorIdle(page);
    const point=await run(`(async()=>{const it=items[editingSmartIdx],h=(await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it)])).find(h=>h.id==='entry');return {x:it.x+h.x,y:it.y+h.y};})()`);
    const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+point.x,box.y+point.y);
    const field=page.locator('[data-smart-inline-input] input');await field.fill('benchmark');before=await run(snapshotCode);started=performance.now();await field.press('Enter');
    await page.waitForFunction(()=>__bench.run(`editorRuntimeContext().scene.filter(it=>['bench-log','remote-log-1','remote-log-2'].includes(it.uid)).every(it=>it.state.text==='benchmark / measurement')`));
    const acceptedAt=performance.now();await run('smartGestureQueue');await editorIdle(page);
    result.inlineSubmission={...difference(before,await run(snapshotCode),performance.now()-started),acceptedMs:Math.round(acceptedAt-started),receivers:3};
    await page.keyboard.press('Escape');
    stage('workspace save');
    started=performance.now();
    const storage=await run(`(async()=>{for(const tab of tabs)unsavedTabs.add(tab.id);tabListDirty=true;rememberActiveTab();await persistWorkspace();
      if(typeof readSavedWorkspace==='function'){const record=await readSavedWorkspace();return {backend:'IndexedDB',characters:JSON.stringify(record).length,unsaved:unsavedTabs.size,error:workspaceStorage.error};}
      return {backend:'localStorage',characters:Object.keys(localStorage).filter(key=>key.startsWith('simplecanvas')).reduce((n,key)=>n+key.length+localStorage.getItem(key).length,0),unsaved:unsavedTabs.size};})()`);
    result.workspaceSave={...storage,elapsedMs:Math.round(performance.now()-started)};
    if(storage.unsaved||storage.error)throw new Error('Workspace did not save successfully: '+JSON.stringify(storage));
    stage('Run preview');
    result.preview={available:await run("typeof startRunPreview==='function' && typeof stopRunPreview==='function'")};
    if(result.preview.available){
      before=await run(snapshotCode);started=performance.now();await run('startRunPreview()');
      await page.waitForFunction(()=>['ready','error'].includes(document.getElementById('runPreviewPanel')?.dataset.state),null,{timeout:timeoutMs});
      const readyMs=Math.round(performance.now()-started),frame=await (await page.locator('#runPreviewFrame').elementHandle()).contentFrame();
      result.preview={...result.preview,readyMs,editorPreparation:difference(before,await run(snapshotCode),readyMs),
        readerHooks:await frame.evaluate(()=>({...globalThis.__benchHooks})),state:await page.locator('#runPreviewPanel').getAttribute('data-state')};
      if(result.preview.state!=='ready')throw new Error('Run preview did not become ready');
      await run('stopRunPreview()');
    }
    const download=async call=>{const pending=page.waitForEvent('download');const started=performance.now();await run(call);const file=await pending;if(await file.failure())throw new Error(await file.failure());const data=fs.readFileSync(await file.path());return {data,elapsedMs:Math.round(performance.now()-started)};};
    stage('native export');
    let exported=await download('exportWorkspace()');result.nativeExport={bytes:exported.data.length,elapsedMs:exported.elapsedMs};
    stage('HTML export');
    exported=await download('exportHtml()');result.htmlExport={bytes:exported.data.length,elapsedMs:exported.elapsedMs};
    // htmlSmartSource serializes the already instrumented sandbox helper from the editor.
    const reader=await context.newPage(),readerBody=instrument(exported.data.toString(),{countCalls:false});reader.on('pageerror',error=>errors.push(error.message));
    stage('reader startup');
    await reader.route('http://workspace-reader-bench.test/**',route=>route.fulfill({contentType:'text/html',body:readerBody}));
    started=performance.now();await reader.goto('http://workspace-reader-bench.test/index.html');
    await reader.waitForFunction(()=>__bench.run("!activationPending && currentGraph?.size>0 && entries.every(entry=>entry.host.dataset.smartReady==='true' || !!entry.error)"),null,{timeout:timeoutMs});
    const readerState=await reader.evaluate(code=>__bench.run(code),`({components:currentGraph.size,errors:[...currentGraph].filter(([,record])=>record.error).map(([item,record])=>({uid:item.uid,error:record.error})),...${snapshotCode}})`);
    if(readerState.errors.length)throw new Error('Reader graph errors: '+JSON.stringify(readerState.errors));
    result.readerStartup={elapsedMs:Math.round(performance.now()-started),sandboxRequests:readerState.requests,workersCreated:readerState.workers.created,hooks:readerState.hooks,components:readerState.components};
    await reader.close();
    if(errors.length)throw new Error('Page errors: '+errors.join('; '));
    result.status='complete';
  }catch(error){result.status='failed';result.phase=phase;result.error=error.message;}
  finally{clearTimeout(watchdog);await context.close();}
  return result;
}
(async()=>{
  const browser=await launchBrowser();
  try{
    console.log(JSON.stringify({benchmark:'large-workspace',engine:process.env.BROWSER_ENGINE||'chromium',browser:browser.version(),platform:process.platform,arch:process.arch,updates,fixture:description,
      notes:['One warm browser process; isolated empty storage/context for each version. Baseline first, working second; use repeated runs to assess noise.',
        'Fixture scripts/state are identical in both versions. Counts include graph and visible painting requests; unchanged evaluations deliberately invalidate only the host graph cache.',
        'Timer period is one hour to include stateful initialization without timer bursts during finite update measurements. No performance thresholds; limits/timeouts stay unchanged.',
        'Storage characters count the saved IndexedDB record or legacy localStorage keys+values, not browser on-disk physical allocation. Export byte counts are actual downloaded files.',
        'Preview readyMs observes the public ready signal; its editorPreparation counters exclude the separate reader, whose hook calls are reported separately. Exported readerStartup additionally waits for completed visible paints.']}));
    for(const version of baseline==='working-only'?['working']:[baseline,'working']){
      const result=await measureVersion(browser,version);console.log(JSON.stringify(result));if(result.status!=='complete')process.exitCode=1;
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
