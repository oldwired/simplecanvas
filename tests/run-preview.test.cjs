const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..');
const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});

async function app(fn,{settings,file=false,query='',secure=false}={}){
  const context=await browser.newContext({viewport:{width:1500,height:1100}}),errors=[];
  let directory;
  try{
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    if(file){
      directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-preview-'));
      fs.writeFileSync(path.join(directory,'index.html'),html);
      await page.goto(pathToFileURL(path.join(directory,'index.html')).href);
    }else{
      const origin=(secure?'https':'http')+'://run-preview.test';
      await page.route(origin+'/**',route=>route.fulfill(new URL(route.request().url()).pathname.endsWith('index.html')?
        {contentType:'text/html',body:html}:route.request().url().endsWith('settings.json')&&settings?
          {contentType:'application/json',body:JSON.stringify(settings)}:{status:404,body:''}));
      await page.goto(origin+'/index.html'+query);
    }
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught errors in editor or preview');
  }finally{await context.close();if(directory)fs.rmSync(directory,{recursive:true,force:true});}
}

const table={name:'Preview records',columns:[{key:'name',name:'Name',type:'string'},{key:'score',name:'Score',type:'number'}],rows:[['Original',8],['Second',3]]};
async function seedControls(run){
  await run(`cancelGesture();datasets=normalizeDatasets({records:${JSON.stringify(table)}});
    const make=(key,uid,x,y,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,componentName:uid,x,y,...extra});
    items=[make('numberControl','number',60,90),make('textInput','entry',420,90),
      make('memo','memo',820,90,{w:360,h:170,eventBindings:{line:{uid:'entry',port:'value'}}}),
      make('dataTable','table',60,330,{w:650,h:330,state:{maxRows:12,maxColumns:8,showCounts:true,editDataset:true,allowReaderEdit:true},inputValues:{data:{datasetId:'records'}}}),
      make('dataDownload','download',820,350,{inputValues:{data:{datasetId:'records'},filename:'preview-results'}}),
      make('dataSource','owner',820,600,{inputValues:{data:{datasetId:'records'}}})];
    selection=[];editingSmartIdx=null;setTool('select');render();save();
    resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);`);
  await run(`(async()=>{await controlComponentSimulation('pause');undoStack=[];redoStack=[];
    beginHistory();items[0].x+=10;commitHistory();selection=[0];render();await persistWorkspace();})()`);
}
const sourceState=run=>run(`({items:JSON.stringify(items),datasets:JSON.stringify(datasets),
  undo:clone(undoStack),redo:clone(redoStack),selection:selection.slice(),tab:activeTabId,tool:ui.tool,paused:editorTimeline?.pausedByUser})`);
async function handle(run,index,id){
  return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);
    const handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]);
    return handles.find(handle=>handle.id===${JSON.stringify(id)});})()`);
}
async function preview(page){
  await page.locator('#runPreviewBtn').click();
  assert.equal(await page.locator('#runPreviewPanel').evaluate(panel=>panel.open),true,JSON.stringify(await page.evaluate(()=>__test.run('({preview:!!runPreview,started:appStarted,gesture:hasActivePointerGesture(),poly:!!polyDraft,dialogs:[...document.querySelectorAll("dialog[open]")].map(el=>el.id)})'))));
  await page.locator('#runPreviewPanel').waitFor({state:'visible'});
  await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
  const element=await page.locator('#runPreviewFrame').elementHandle(),frame=await element.contentFrame();
  assert.ok(frame,'preview runs in a separate frame');await frame.locator('.tab-panel:visible > svg').first().waitFor();return frame;
}
async function readerText(frame,index,text,tab=null){
  await frame.waitForFunction(({index,text,tab})=>{
    const panel=tab?document.querySelector('.tab-panel[data-tab-id="'+tab+'"]'):document;
    const host=panel?.querySelector('[data-smart-index="'+index+'"]');
    return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(node=>node.textContent===text);
  },{index,text,tab});
}
async function clickHandle(page,frame,index,handle,tab=null){
  assert.ok(handle,'interactive handle exists');
  const host=frame.locator((tab?'.tab-panel[data-tab-id="'+tab+'"] ':'')+'[data-smart-index="'+index+'"]');
  await frame.waitForFunction(host=>host.dataset.smartReady==='true',await host.elementHandle());
  const point=await host.evaluate((host,handle)=>{
    const p=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};
  },handle),box=await page.locator('#runPreviewFrame').boundingBox();
  await page.mouse.click(box.x+point.x,box.y+point.y);
}
async function leavePreview(page){
  await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
}

test('Preview isolates scalar, text and dataset edits, permits result downloads, and starts fresh each time',async()=>app(async({page,run})=>{
  await seedControls(run);
  const plus=await handle(run,0,'plus'),entry=await handle(run,1,'entry'),cell=await handle(run,3,'cell-0-1'),csv=await handle(run,4,'csv');
  const before=await sourceState(run),saved=await run('readSavedWorkspace()');
  const frame=await preview(page);
  await readerText(frame,0,'50');await readerText(frame,3,'Original');
  if(process.env.BROWSER_ENGINE!=='webkit')await page.screenshot({path:'/private/tmp/simplecanvas-run-preview.png'});
  assert.match(await page.locator('#runPreviewPanel').textContent(),/Preview changes are discarded when you return to editing\./);
  const sandbox=(await page.locator('#runPreviewFrame').getAttribute('sandbox')).split(/\s+/);
  assert.ok(sandbox.includes('allow-scripts'));assert.ok(sandbox.includes('allow-downloads'));assert.ok(!sandbox.includes('allow-same-origin'));
  assert.equal(await frame.evaluate(()=>{try{void parent.document.body;return 'accessible';}catch(error){return error.name;}}),'SecurityError');
  assert.equal(await page.locator('#runPreviewPanel').evaluate(panel=>panel.matches(':modal')),true,'Preview isolates keyboard and pointer input in a modal surface');
  assert.equal(await page.locator('[data-tool="rect"]').evaluate(button=>{button.focus();return button===document.activeElement;}),false,'background editor controls cannot take focus');
  await clickHandle(page,frame,0,plus);await readerText(frame,0,'51');
  await clickHandle(page,frame,1,entry);
  const input=frame.locator('[data-smart-inline-input] input');await input.fill('Preview only');await input.press('Enter');
  await readerText(frame,2,'Preview only');await input.press('Escape');
  await clickHandle(page,frame,3,cell);
  const field=frame.locator('[data-smart-inline-input] input');await field.fill('42');await field.press('Enter');await field.waitFor({state:'detached'});
  await readerText(frame,3,'42');
  await clickHandle(page,frame,4,csv);const dialog=frame.locator('dialog[data-component-data-action]');await dialog.waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Download',exact:true}).click()]);
  assert.equal(download.suggestedFilename(),'preview-results.csv');
  assert.equal(fs.readFileSync(await download.path(),'utf8'),'name,score\r\nOriginal,42\r\nSecond,3\r\n');
  assert.deepEqual(await sourceState(run),before);assert.deepEqual(await run('readSavedWorkspace()'),saved,'preview changes never enter editor autosave');
  await leavePreview(page);assert.deepEqual(await sourceState(run),before);
  assert.equal(await page.locator('#runPreviewPanel').evaluate(panel=>panel.matches(':modal')),false);
  assert.equal(await page.locator('#runPreviewBtn').evaluate(button=>button===document.activeElement),true,'Return restores keyboard focus to Run');
  const fresh=await preview(page);await readerText(fresh,0,'50');await readerText(fresh,3,'8');
  assert.ok(!(await fresh.locator('[data-smart-index="2"]').textContent()).includes('Preview only'));
  await leavePreview(page);assert.deepEqual(await run('readSavedWorkspace()'),saved);
}));

test('Preview runs its own clock while the source timeline is suspended, then resumes the source',async()=>app(async({page,run})=>{
  await run(`cancelGesture();const make=(key,uid,x,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,x,y:150,...extra});
    items=[make('pulseGenerator','clock',80,{inputValues:{seconds:.08,width:.03,enable:true}}),make('counter','count',500,{bindings:{value:{uid:'clock',port:'value'}}})];
    setTool('select');render();save();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);`);
  await page.waitForFunction(()=>__test.run('items[1].state.count')>0);
  const frame=await preview(page),source=await run('({count:items[1].state.count,now:componentTimelineNow(editorTimeline),paused:editorTimeline.pausedByUser})');
  assert.equal(source.paused,false,'Preview does not replace the user’s pause preference');
  assert.equal(await run('editorTimeline.active'),false);
  await frame.waitForFunction(()=>document.querySelector('[data-smart-index="1"]')?.dataset.smartReady==='true');
  const first=await frame.locator('[data-smart-index="1"] text').allTextContents();
  await frame.waitForFunction(first=>JSON.stringify([...document.querySelectorAll('[data-smart-index="1"] text')].map(node=>node.textContent))!==JSON.stringify(first),first);
  assert.deepEqual(await run('({count:items[1].state.count,now:componentTimelineNow(editorTimeline),paused:editorTimeline.pausedByUser})'),source);
  await leavePreview(page);await page.waitForFunction(count=>__test.run('items[1].state.count')>count,source.count);
  assert.equal(await run('editorTimeline.active'),true);
}));

test('Preview honors hidden service sketches and whole-workspace navigation without moving the editor',async()=>app(async({page,run})=>{
  const data=fs.readFileSync(path.join(root,'examples','workspace-runtime.json'),'utf8');
  await run(`openWorkspaceFile(new File([${JSON.stringify(data)}],'workspace.json',{type:'application/json'}))`);
  await page.waitForFunction(()=>__test.run("activeTabId==='runtime-dashboard'"));
  await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
  const navigation=await run(`(async()=>{const index=items.findIndex(item=>item.uid==='runtime-open-services'),item=items[index],io=await resolveSmartComponentIo(item);
    return {index,handle:(await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='go')};})()`);
  const frame=await preview(page);
  await frame.locator('.tab-select[data-tab-id="runtime-dashboard"].active').waitFor();
  assert.equal(await frame.locator('.tab-select[data-tab-id="runtime-services"]').isVisible(),false);
  await frame.waitForFunction(()=>[...document.querySelector('.tab-panel[data-tab-id="runtime-dashboard"]').querySelectorAll('text')].some(node=>/^\d\d:\d\d:\d\d$/.test(node.textContent)));
  await clickHandle(page,frame,navigation.index,navigation.handle,'runtime-dashboard');
  await frame.locator('.tab-panel[data-tab-id="runtime-services"]').waitFor({state:'visible'});
  assert.equal(await run('activeTabId'),'runtime-dashboard','preview navigation never switches the editor sketch');
  await frame.locator('.tab-select[data-tab-id="runtime-editor"]').click();
  await frame.locator('.tab-panel[data-tab-id="runtime-editor"]').waitFor({state:'visible'});
  assert.equal(await page.locator('#exitPreviewBtn').isVisible(),true,'reader presentation cannot hide Return to editing');
  await leavePreview(page);assert.equal(await run('activeTabId'),'runtime-dashboard');
}));

for(const file of [false,true])test('plain drawings run without smart authoring '+(file?'from file://':'with workspace and smart features disabled'),async()=>app(async({page,run})=>{
  await run(`items=[{type:'rect',uid:'plain',x:100,y:100,w:240,h:160,fill:true,fillColor:'#ef4444',strokeOn:true,color:'#334155',size:2}];selection=[0];setTool('select');render();save();persistWorkspace();`);
  const before=await sourceState(run),frame=await preview(page);
  assert.equal(await frame.locator('rect[fill="#ef4444"]').count(),1);
  assert.equal(await page.locator('#exitPreviewBtn').isVisible(),true);
  await leavePreview(page);assert.deepEqual(await sourceState(run),before);
},{file,settings:{features:{workspace:false,smartComponents:false}}}));

test('keyboard Run and Return work, and cancellation cannot reopen a late preview',async()=>app(async({page,run})=>{
  await seedControls(run);const before=await sourceState(run);
  await run(`window.previewBuildWaiting=false;window.previewBuildFinished=false;
    window.originalPreviewBuild=buildWorkspaceHtml;const originalBuild=buildWorkspaceHtml;
    buildWorkspaceHtml=async(...args)=>{window.previewBuildWaiting=true;window.previewBuildSignal=args[1].signal;await new Promise(resolve=>window.releasePreviewBuild=resolve);
      try{return await originalBuild(...args);}finally{window.previewBuildFinished=true;}};`);
  await page.locator('#runPreviewBtn').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.previewBuildWaiting);
  assert.equal(await page.locator('#runPreviewPanel').getAttribute('data-state'),'preparing');
  assert.equal(await page.locator('#exitPreviewBtn').isVisible(),true,'cancel is available before reader startup');
  await page.locator('#exitPreviewBtn').focus();await page.keyboard.press('Escape');
  await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.previewBuildSignal.aborted),true,'Return aborts the cancelled export build');
  assert.equal(await page.locator('#runPreviewPanel').isVisible(),false);assert.equal(await page.locator('#runPreviewFrame').count(),0);
  assert.deepEqual(await sourceState(run),before);assert.equal(await page.locator('#runPreviewBtn').evaluate(button=>button===document.activeElement),true);
  await run('buildWorkspaceHtml=(...args)=>{window.currentPreviewBuildSignal=args[1].signal;return window.originalPreviewBuild(...args);};');
  await page.keyboard.press('Enter');await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
  assert.equal(await page.evaluate(()=>window.currentPreviewBuildSignal.aborted),false,'a new preview receives a fresh, live signal');
  assert.equal(await page.evaluate(()=>window.currentPreviewBuildSignal===window.previewBuildSignal),false);
  const currentFrame=await page.locator('#runPreviewFrame').elementHandle();
  await page.evaluate(()=>window.releasePreviewBuild());await page.waitForFunction(()=>window.previewBuildFinished);
  assert.equal(await currentFrame.evaluate(frame=>frame.isConnected),true,'a late cancelled build cannot replace the newer preview');
  assert.equal(await page.locator('#runPreviewFrame').count(),1);
  assert.equal(await page.locator('#runPreviewFrame').getAttribute('title'),'Workspace preview');
  await page.locator('#exitPreviewBtn').focus();await page.keyboard.press('Enter');
  await page.locator('#runPreviewPanel').waitFor({state:'hidden'});assert.deepEqual(await sourceState(run),before);
}));

test('Escape cancels a held reader drag locally, closes reader dialogs locally, and exits only from the Preview header',async()=>app(async({page,run})=>{
  await seedControls(run);
  const before=await sourceState(run),plus=await handle(run,0,'plus'),csv=await handle(run,4,'csv');
  const size=await run('({w:items[0].w,h:items[0].h})'),frame=await preview(page);
  await readerText(frame,0,'50');
  const point=async value=>{
    const local=await frame.locator('[data-smart-index="0"]').evaluate((host,{value,w,h})=>{
      const pad=Math.min(20*Math.min(w/240,h/130),w*.15);
      const p=new DOMPoint(pad+(w-pad*2)*value/100,h*.55).matrixTransform(host.firstElementChild.getScreenCTM());
      return {x:p.x,y:p.y};
    },{value,...size});
    const box=await page.locator('#runPreviewFrame').boundingBox();return {x:box.x+local.x,y:box.y+local.y};
  };
  try{
    const start=await point(50);await page.mouse.move(start.x,start.y);await page.mouse.down();
    const moved=await point(80);await page.mouse.move(moved.x,moved.y);await readerText(frame,0,'80');
    const focus=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id}));
    await page.keyboard.press('Escape');
    assert.equal(frame.isDetached(),false,'cancelling a reader gesture must not remove the Run iframe: '+JSON.stringify(focus));
    assert.equal(await page.locator('#runPreviewPanel').evaluate(panel=>panel.open),true,'reader Escape leaves Run open');
    await readerText(frame,0,'50');await page.mouse.up();
    await clickHandle(page,frame,0,plus);await readerText(frame,0,'51');
    assert.deepEqual(await sourceState(run),before,'cancelled and subsequent reader edits remain isolated');

    await clickHandle(page,frame,4,csv);
    const dialog=frame.locator('dialog[data-component-data-action]');await dialog.waitFor();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).focus();await page.keyboard.press('Escape');
    await dialog.waitFor({state:'detached'});
    assert.equal(await page.locator('#runPreviewPanel').evaluate(panel=>panel.open),true,'Escape still dismisses the reader’s own modal without exiting Run');
    await page.locator('#exitPreviewBtn').focus();await page.keyboard.press('Escape');
    await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
    assert.deepEqual(await sourceState(run),before,'header Escape returns to the unchanged authored workspace');
  }finally{await page.mouse.up();}
}));

test('a failed Preview build leaves a visible error and a working return path without changing the source',async()=>app(async({page,run})=>{
  await seedControls(run);const before=await sourceState(run),saved=await run('readSavedWorkspace()');
  await run(`window.originalPreviewBuild=buildWorkspaceHtml;buildWorkspaceHtml=async()=>{throw new Error('Deliberate preview build failure');};`);
  await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="error"]').waitFor();
  assert.match(await page.locator('#runPreviewStatus').textContent(),/Deliberate preview build failure/);
  assert.equal(await page.locator('#exitPreviewBtn').isVisible(),true);assert.equal(await page.locator('#runPreviewFrame').count(),0);
  await leavePreview(page);assert.deepEqual(await sourceState(run),before);assert.deepEqual(await run('readSavedWorkspace()'),saved);
  await run('buildWorkspaceHtml=window.originalPreviewBuild');const frame=await preview(page);await readerText(frame,0,'50');await leavePreview(page);
}));

test('a read-only editor can run a disposable Preview without taking ownership or saving changes',async()=>app(async({page,run,context})=>{
  await seedControls(run);const saved=await run('readSavedWorkspace()');
  const readonly=await context.newPage(),errors=[];readonly.on('pageerror',error=>errors.push(error.message));
  await readonly.route('http://run-preview.test/**',route=>route.fulfill(route.request().url().endsWith('index.html')?{contentType:'text/html',body:html}:{status:404,body:''}));
  await readonly.goto(page.url());
  const read=source=>readonly.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
  assert.equal(await read('workspaceStorage.writable'),false);
  const plus=await handle(read,0,'plus'),before=await sourceState(read),frame=await preview(readonly);
  await readerText(frame,0,'50');await clickHandle(readonly,frame,0,plus);await readerText(frame,0,'51');
  await leavePreview(readonly);assert.deepEqual(await sourceState(read),before);
  assert.equal(await read('workspaceStorage.writable'),false);assert.equal(await run('workspaceStorage.writable'),true);
  assert.deepEqual(await run('readSavedWorkspace()'),saved);assert.deepEqual(errors,[]);
}));

test('Preview copies URL parameters and keeps Go to tab parameter updates inside the disposable reader',async()=>app(async({page,run})=>{
  await run(`cancelGesture();const make=(key,uid,x,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,x,y:100,...extra});
    tabs=[{id:'preview-first',name:'First'},{id:'preview-second',name:'Second'}];tabDocuments.clear();
    tabDocuments.set('preview-first',makeDocument());tabDocuments.set('preview-second',makeDocument());
    tabDocument('preview-first').items=[make('urlParameter','first-name',80,{inputValues:{key:'name'}}),
      make('goToTab','next',500,{inputValues:{page:1,parameters:'{"name":"Preview","via":"Run"}'}})];
    tabDocument('preview-second').items=[make('urlParameter','second-name',80,{inputValues:{key:'name'}}),make('urlParameter','via',500,{inputValues:{key:'via'}})];
    enterTab('preview-first');render();save();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);`);
  const go=await handle(run,1,'go'),url=page.url(),query=await run('componentPageQuery'),frame=await preview(page);
  await readerText(frame,0,'Anna','preview-first');
  await clickHandle(page,frame,1,go,'preview-first');
  await frame.locator('.tab-panel[data-tab-id="preview-second"]').waitFor({state:'visible'});
  await readerText(frame,0,'Preview','preview-second');await readerText(frame,1,'Run','preview-second');
  assert.equal(page.url(),url);assert.equal(await run('componentPageQuery'),query);assert.equal(await run('activeTabId'),'preview-first');
  await leavePreview(page);assert.equal(page.url(),url);
},{query:'?page=0&name=Anna&keep=yes'}));

test('Run cancels a pending text-alignment click before freezing the source',async()=>app(async({page,run})=>{
  await run(`cancelGesture();items=[{type:'text',uid:'align',x:100,y:100,w:300,h:80,text:'Alignment example',
    font:'600 24px sans-serif',fontFamily:'sans',fontSize:24,color:'#334155',align:'left'}];
    setTool('select');selection=[0];render();save();
    const nativeTimeout=window.setTimeout,nativeClearTimeout=window.clearTimeout;
    window.setTimeout=(callback,delay,...args)=>{
      if(delay===300){window.pendingAlignmentTimer=nativeTimeout(()=>{},60000);
        window.pendingAlignmentCancelled=false;window.finishPendingAlignment=()=>{if(!window.pendingAlignmentCancelled)callback(...args);};return window.pendingAlignmentTimer;}
      return nativeTimeout(callback,delay,...args);
    };
    window.clearTimeout=timer=>{if(timer===window.pendingAlignmentTimer)window.pendingAlignmentCancelled=true;return nativeClearTimeout(timer);};`);
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+370,box.y+140);
  assert.equal(await page.evaluate(()=>typeof window.finishPendingAlignment),'function','selected text click arms delayed alignment');
  const before=await sourceState(run);await preview(page);
  assert.equal(await page.evaluate(()=>window.pendingAlignmentCancelled),true,'Run cancels the real pending alignment timer');
  await page.evaluate(()=>window.finishPendingAlignment());
  assert.deepEqual(await sourceState(run),before,'the cancelled alignment never edits the frozen source or its history');
  await leavePreview(page);assert.deepEqual(await sourceState(run),before);
}));

test('pasting on the Preview header cannot change the parent editor',async()=>app(async({page,run})=>{
  await seedControls(run);await run('clipboard=clonesOf(selection);');
  const before=await sourceState(run),saved=await run('readSavedWorkspace()');await preview(page);
  await page.locator('#exitPreviewBtn').focus();
  await page.locator('#exitPreviewBtn').evaluate(button=>{
    button.dispatchEvent(new ClipboardEvent('paste',{clipboardData:new DataTransfer(),cancelable:true,bubbles:true}));
  });
  assert.deepEqual(await sourceState(run),before,'the global paste listener does not change a frozen editor');
  await leavePreview(page);await run('persistWorkspace()');assert.deepEqual(await run('readSavedWorkspace()'),saved);
}));

test('Run cancels pending sketch and image file reads even after returning to editing',async()=>app(async({page,run})=>{
  await seedControls(run);const before=await sourceState(run),saved=await run('readSavedWorkspace()');
  await run(`const NativeReader=window.FileReader;window.FileReader=class{
    readAsText(){window.pendingPreviewSketchRead=this;}
    readAsDataURL(){window.pendingPreviewImageRead=this;}
  };
  try{importProject(new File(['pending'],'pending.json'));readFile(new File(['pending'],'pending.png',{type:'image/png'}));}
  finally{window.FileReader=NativeReader;}
  window.previewImageImportCalls=0;const nativeImageImport=importImage;
  importImage=(...args)=>{window.previewImageImportCalls++;return nativeImageImport(...args);};`);
  await preview(page);await leavePreview(page);
  await run(`(async()=>{window.pendingPreviewSketchRead.result=JSON.stringify({app:'SimpleCanvas',version:FORMAT_VERSION,
    items:[{type:'rect',uid:'late-import',x:50,y:50,w:200,h:100,color:'#222',size:2}],assets:{}});
    await window.pendingPreviewSketchRead.onload();
    window.pendingPreviewImageRead.result=document.createElement('canvas').toDataURL('image/png');
    window.pendingPreviewImageRead.onload();await persistWorkspace();})()`);
  assert.equal(await run('window.previewImageImportCalls'),0,'the stale image FileReader never starts a new decode');
  assert.deepEqual(await sourceState(run),before);assert.deepEqual(await run('readSavedWorkspace()'),saved);
}));

test('Run cancels an image decode that completes after returning to editing',async()=>app(async({page,run})=>{
  await seedControls(run);const before=await sourceState(run),saved=await run('readSavedWorkspace()');
  await run(`const NativeImage=window.Image;window.Image=class{
    constructor(){this.naturalWidth=100;this.naturalHeight=80;window.pendingPreviewImageDecode=this;}
    set src(value){this.source=value;}
  };
  try{importImage(document.createElement('canvas').toDataURL('image/png'));}finally{window.Image=NativeImage;}`);
  await preview(page);await leavePreview(page);
  await run('window.pendingPreviewImageDecode.onload();persistWorkspace()');
  assert.deepEqual(await sourceState(run),before);assert.deepEqual(await run('readSavedWorkspace()'),saved,'a late decode cannot append an asset or history record');
}));

test('HTTPS Preview imports data with an ordinary file chooser without invoking the sandbox-denied native picker',async()=>app(async({page,run})=>{
  await seedControls(run);
  await run(`items[5].state.allowReaderImport=true;render();save();persistWorkspace();`);
  const load=await handle(run,5,'loadData'),before=await sourceState(run),saved=await run('readSavedWorkspace()');
  const frame=await preview(page);assert.equal(await frame.evaluate(()=>window.isSecureContext),true);
  await frame.evaluate(()=>{
    window.nativePickerCalls=0;
    Object.defineProperty(window,'showOpenFilePicker',{configurable:true,value:async()=>{
      window.nativePickerCalls++;throw new DOMException('Opaque frames cannot use this picker','SecurityError');
    }});
  });
  await clickHandle(page,frame,5,load);
  const dialog=frame.locator('dialog[data-component-data-action="importDataset"]');await dialog.waitFor();
  const file=dialog.locator('[data-data-action-file]');assert.equal(await file.isVisible(),true,'the fallback file chooser is available immediately');
  assert.equal(await dialog.locator('[data-data-action-choose-file]').count(),0,'the unavailable native picker is not offered');
  await file.setInputFiles({name:'preview.csv',mimeType:'text/csv',buffer:Buffer.from('name,score\nImported preview,23')});
  await dialog.getByRole('button',{name:'Replace data',exact:true}).click();await dialog.waitFor({state:'detached'});
  await readerText(frame,3,'Imported preview');await readerText(frame,3,'23');
  assert.equal(await frame.evaluate(()=>window.nativePickerCalls),0);
  assert.deepEqual(await sourceState(run),before);await leavePreview(page);await run('persistWorkspace()');
  assert.deepEqual(await run('readSavedWorkspace()'),saved);
},{secure:true}));

test('Preview keeps user-clicked Markdown links usable in a separate window without an opener',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=[{type:'text',uid:'link',x:100,y:100,w:500,h:100,
    text:'---\\n[Preview help](https://preview-links.test/help)',font:'24px sans-serif',fontFamily:'sans',fontSize:24,color:'#334155'}];
    setTool('select');selection=[];render();save();persistWorkspace();`);
  await context.route('https://preview-links.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Preview help</title><p>Help opened</p>'}));
  const before=await sourceState(run),frame=await preview(page),links=frame.locator('a[href="https://preview-links.test/help"]');
  assert.ok(await links.count()>0,'the Markdown link is present in the exported SVG');const link=links.first();
  assert.equal(await link.getAttribute('target'),'_blank');assert.match(await link.getAttribute('rel'),/noopener/);
  const [popup]=await Promise.all([page.waitForEvent('popup'),link.click()]);await popup.waitForLoadState();
  assert.equal(await popup.title(),'Preview help');assert.equal(await popup.evaluate(()=>window.opener===null),true);
  assert.deepEqual(await sourceState(run),before);await popup.close();await leavePreview(page);
}));
