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
after(async()=>browser?.close());

async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1200}}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-transition-data-')),errors=[];
  try{
    context.on('page',page=>{page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());});
    await context.route('http://transition-data.test/**',route=>route.fulfill(route.request().url().endsWith('/index.html')?{contentType:'text/html',body:html}:{status:404,body:''}));
    const page=await context.newPage();await page.goto('http://transition-data.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context,directory});assert.deepEqual(errors,[]);
  }finally{await context.close();fs.rmSync(directory,{recursive:true,force:true});}
}
const collector=`({apiVersion:2,eventApi:1,inputs:{},outputs:{text:{type:'string'}},eventInputs:{replaced:{type:'number'},appended:{type:'number'},captured:{type:'number'},prepared:{type:'string'},failed:{type:'string'}},publish(state){return {text:state.entries.join(' | ')};},onEvent(name,payload,state){return {state:{entries:[...state.entries,name+':'+payload]}};},children(state){return [{type:'text',x:4,y:4,w:550,h:160,text:state.entries.join(' | ')||'No completions',plainText:true,font:'16px sans-serif',color:'#334155'}];}})`;

async function seed(run,origin){
  await run(`(()=>{
    cancelGesture();const make=(key,uid,x,y,extra={})=>{const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]);return {...base,uid,componentName:uid,x,y,...extra,state:{...base.state,...extra.state}};};
    const table=value=>({name:value,columns:[{key:'entry',name:'Entry',type:'string'}],rows:[[value]]});
    datasets=normalizeDatasets({incoming:table('incoming'),replace:table('replace-old'),append:table('append-old'),capture:table('capture-old')});
    const driver=${origin==='transition'?"make('signalToEvent','event',360,40,{state:{type:'boolean'},inputValues:{value:true},bindings:{trigger:{uid:'toggle',port:'value'}}})":"make('textCompare','event',360,40,{inputValues:{text:'equal',compare:'equal'},bindings:{reprocess:{uid:'toggle',port:'value'}}})"};
    items=[make('toggle','toggle',40,40),driver,
      make('tableSort','incoming',700,40,{inputValues:{data:{datasetId:'incoming'},column:'entry',direction:'ascending'}}),
      make('dataSource','replace',40,230,{state:{allowReaderUpdates:true},inputValues:{data:{datasetId:'replace'}},bindings:{source:{uid:'incoming',port:'data'},replace:{uid:'event',port:'value'}}}),
      make('dataSource','append',380,230,{state:{allowReaderUpdates:true},inputValues:{data:{datasetId:'append'}},bindings:{source:{uid:'incoming',port:'data'},append:{uid:'event',port:'value'}}}),
      make('dataSource','capture-owner',720,230,{inputValues:{data:{datasetId:'capture'}}}),
      make('captureRow','capture',40,450,{state:{fields:'entry:string',allowReaderCapture:true},inputValues:{field0:'captured'},bindings:{data:{uid:'capture-owner',port:'data'},capture:{uid:'event',port:'value'}}}),
      make('dataDownload','download',380,450,{inputValues:{filename:'transition'},bindings:{data:{uid:'incoming',port:'data'},json:{uid:'event',port:'value'}}}),
      ...['replace','append','capture-owner'].map((uid,i)=>make('dataTable',uid+'-view',40+i*340,670,{w:300,h:200,bindings:{data:{uid,port:'data'}}})),
      {type:'smart',componentApi:2,uid:'log',componentName:'Completions',script:${JSON.stringify(collector)},state:{entries:[]},x:720,y:450,w:550,h:160,eventBindings:{replaced:{uid:'replace',port:'replaced'},appended:{uid:'append',port:'appended'},captured:{uid:'capture',port:'captured'},prepared:{uid:'download',port:'prepared'},failed:{uid:'replace',port:'failed'}}}
    ];selection=[];editingSmartIdx=null;setTool('select');render();save();
  })()`);
  assert.deepEqual(await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true).then(graph=>[...graph].filter(([,record])=>record.error).map(([item,record])=>({uid:item.uid,error:record.error})))'),[]);
  return run(`(async()=>{const item=items[0],io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='toggle');})()`);
}

async function readerFor(mode,{page,run,context,directory}){
  if(mode==='Run'){
    await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
    return {page,surface:await(await page.locator('#runPreviewFrame').elementHandle()).contentFrame(),offset:await page.locator('#runPreviewFrame').boundingBox()};
  }
  const downloading=page.waitForEvent('download');await run('void exportHtml()');
  const file=path.join(directory,'reader.html');fs.copyFileSync(await(await downloading).path(),file);
  const reader=await context.newPage();await reader.goto(pathToFileURL(file).href);return {page:reader,surface:reader,offset:{x:0,y:0}};
}
async function clickReader({page,surface,offset},handle){
  const host=surface.locator('[data-smart-index="0"]');await surface.waitForFunction(host=>host.dataset.smartReady==='true',await host.elementHandle());
  const point=await host.evaluate((host,handle)=>{const p=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},handle);
  await page.mouse.click(offset.x+point.x,offset.y+point.y);
}
async function assertDownload(page,surface){
  const notice=surface.locator('[data-prepared-download]');await notice.waitFor();
  const downloading=page.waitForEvent('download');await notice.getByRole('button',{name:'Download',exact:true}).click();const download=await downloading;
  assert.equal(download.suggestedFilename(),'transition.json');assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8')),[{entry:'incoming'}]);
}

for(const origin of ['transition','Reprocess'])for(const mode of ['editor','Run','HTML'])test(mode+' '+origin+' events retain tables for Replace, Append, Capture row and Download',async()=>app(async ctx=>{
  const {page,run}=ctx,handle=await seed(run,origin),before=await run('JSON.stringify(datasets)');
  if(mode==='editor'){
    await run('selection=[0];editingSmartIdx=0;render()');const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+40+handle.x,box.y+40+handle.y);
    await page.waitForFunction(()=>__test.run('items[11].state.entries.length===4'));
    assert.deepEqual(await run('items[11].state.entries'),['replaced:1','appended:2','captured:1','prepared:transition.json']);
    assert.deepEqual(await run('[datasets.replace.rows,datasets.append.rows,datasets.capture.rows]'),[[['incoming']],[['append-old'],['incoming']],[['capture-old'],['captured']]]);
    await assertDownload(page,page);
    await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');assert.equal(await run('items[11].state.entries.length'),4,'redraw does not repeat accepted actions');
  }else{
    const reader=await readerFor(mode,ctx);await clickReader(reader,handle);
    await reader.surface.waitForFunction(()=>document.querySelector('[data-smart-index="11"]')?.textContent.includes('prepared:transition.json'));
    assert.match(await reader.surface.locator('[data-smart-index="11"]').textContent(),/replaced:1 \| appended:2 \| captured:1 \| prepared:transition.json/);
    const replace=await reader.surface.locator('[data-smart-index="8"]').textContent(),append=await reader.surface.locator('[data-smart-index="9"]').textContent(),capture=await reader.surface.locator('[data-smart-index="10"]').textContent();
    assert.match(replace,/incoming/);assert.doesNotMatch(replace,/replace-old/);assert.match(append,/append-old/);assert.match(append,/incoming/);assert.match(capture,/capture-old/);assert.match(capture,/captured/);
    await assertDownload(reader.page,reader.surface);
    if(mode==='Run')await page.locator('#exitPreviewBtn').click();
    assert.equal(await run('JSON.stringify(datasets)'),before,'reader mutations do not change the authored datasets');
  }
}));
