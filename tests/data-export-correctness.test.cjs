const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
let browser;
before(async()=>{browser=await launchBrowser();});after(async()=>browser?.close());
async function app(fn){
  const context=await browser.newContext({viewport:{width:1280,height:900}}),errors=[];
  try{
    await context.route('http://export-correctness.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://export-correctness.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}

test('SVG escapes both quote styles and excludes XML-illegal characters without damaging Unicode',async()=>app(async({run})=>{
  const value='A\0B\u000bC\u001fD\ud800E\ufffeF\uffffG 😀 & < > " \'',clean='ABCDEFG 😀 & < > " \'';
  const result=await run(`(async()=>{
    const text=${JSON.stringify(value)},escaped=escXml(text);
    const scene=[normalizeItem({type:'text',uid:'unicode',x:10,y:10,w:1000,h:80,text,fontSize:24,fontFamily:'sans',strokeOn:false}, {})];
    const markup=await itemsToSVGMarkup(scene,{assets:{}}),xml=new DOMParser().parseFromString(markup,'image/svg+xml');
    return {escaped,errors:xml.querySelectorAll('parsererror').length,text:xml.querySelector('text').textContent,
      attr:new DOMParser().parseFromString("<svg xmlns='http://www.w3.org/2000/svg' data-label='"+escaped+"'/>",'image/svg+xml').documentElement.getAttribute('data-label')};
  })()`);
  assert.equal(result.errors,0);assert.equal(result.text,clean);assert.equal(result.attr,clean);
  assert.ok(result.escaped.includes('&apos;'));assert.ok(result.escaped.includes('&quot;'));assert.ok(result.escaped.includes('😀'));
  assert.equal(await run('escXml("\\t\\n\\r")'),'\t\n\r','XML-legal whitespace remains intact');
}));

test('font selection uses only own string keys and identity repair preserves legitimate imported IDs',async()=>app(async({run})=>{
  const result=await run(`(()=>{
    const base={type:'text',x:10,y:10,w:200,h:80,text:'Text',fontSize:24};
    const families=['constructor','__proto__','toString',['serif']];
    const normalized=families.map(fontFamily=>normalizeItem({...base,fontFamily},{}));
    const direct=families.map(fontFamily=>({family:familyOf({fontFamily}),font:fontStr(fontFamily,24),markdown:mdFontString(fontFamily,24,{})}));
    const legacy=normalizeItem({...base,fontFamily:'constructor',font:'600 24px '+FONTS.serif},{});
    const legitimate="Möwe's/节点:1",kept=normalizeItem({...base,uid:legitimate,group:legitimate},{});
    const repaired=ensureUids([{uid:''},{uid:'x\\u0000y'},{uid:legitimate}]);
    const invalid=normalizeItem({...base,uid:'x\\u0000y',group:'x\\ny'},{});
    applySketchToActiveTab(normalized,{});openText(0);
    return {families:normalized.map(item=>item.fontFamily),direct,legacy:legacy.fontFamily,ui:normalizeUi({fontFamily:'constructor'}).fontFamily,
      editorFont:textInput.style.font,sans:fontStr('sans',24),kept:{uid:kept.uid,group:kept.group},repaired:repaired.map(item=>item.uid),invalid:{uid:invalid.uid,group:invalid.group}};
  })()`);
  assert.deepEqual(result.families,['sans','sans','sans','sans']);assert.equal(result.ui,'sans');assert.equal(result.legacy,'serif');
  for(const entry of result.direct){assert.equal(entry.family,'sans');assert.equal(entry.font,result.sans);assert.equal(entry.markdown,result.sans);}
  assert.ok(!result.editorFont.includes('constructor'));assert.deepEqual(result.kept,{uid:"Möwe's/节点:1",group:"Möwe's/节点:1"});
  assert.ok(result.repaired.slice(0,2).every(uid=>/^u/.test(uid)));assert.equal(result.repaired[2],result.kept.uid);assert.deepEqual(result.invalid,{uid:undefined,group:undefined});
}));

const table={name:'Formula text',columns:[{key:'text',name:'Text',type:'string'},{key:'number',name:'Number',type:'number'}],rows:[['=1+1',-3],[' \t@name',2]]};
const safe="text,number\r\n'=1+1,-3\r\n' \t@name,2\r\n",raw="text,number\r\n=1+1,-3\r\n \t@name,2\r\n";
async function seed(run){
  await run(`cancelGesture();datasets=normalizeDatasets({results:${JSON.stringify(table)}});
    const make=(key,uid,x,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,x,y:100,...extra});
    items=[make('dataDownload','download',50,{inputValues:{data:{datasetId:'results'},filename:'formula'},bindings:{csv:{uid:'prepare',port:'value'}}}),make('toggle','prepare',500,{state:{value:false}})];
    selection=[];editingSmartIdx=null;setTool('select');render();save();ensureEditorComponentGraph()`);
}
async function handle(run,index,id){return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id===${JSON.stringify(id)});})()`);}
async function readerFor(page,run,context){
  const pending=page.waitForEvent('download');await run('exportHtml()');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-safe-csv-')),file=path.join(dir,'reader.html');
  fs.copyFileSync(await(await pending).path(),file);context.on('close',()=>fs.rmSync(dir,{recursive:true,force:true}));
  const reader=await context.newPage(),errors=[];reader.on('pageerror',error=>errors.push(error.message));
  await reader.goto(pathToFileURL(file).href);await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===2);
  return {reader,errors};
}
async function download(page,button){const pending=page.waitForEvent('download');await button.click();return fs.readFileSync(await(await pending).path(),'utf8');}
for(const host of ['editor','HTML reader'])test(`${host} offers safe and raw CSV for direct and prepared downloads`,async()=>app(async({page,run,context})=>{
  await seed(run);const csv=await handle(run,0,'csv'),toggle=await handle(run,1,'toggle');let errors=[];
  const click=host==='editor'?async(index,h)=>{
    await run(`selection=[${index}];editingSmartIdx=${index};render()`);const item=await run(`({x:items[${index}].x,y:items[${index}].y})`),box=await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x+item.x+h.x,box.y+item.y+h.y);
  }:async(index,h)=>{
    const point=await page.locator('[data-smart-index="'+index+'"]').evaluate((element,h)=>{const point=new DOMPoint(h.x,h.y).matrixTransform(element.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};},h);
    await page.mouse.click(point.x,point.y);
  };
  if(host==='HTML reader'){const opened=await readerFor(page,run,context);page=opened.reader;errors=opened.errors;}
  for(const mode of ['safe','raw']){
    await click(0,csv);const dialog=page.locator('dialog[data-component-data-action]');await dialog.waitFor();
    assert.equal(await dialog.locator('[data-data-action-csv-mode]').inputValue(),'safe');
    await dialog.locator('[data-data-action-format]').selectOption('json');assert.equal(await dialog.locator('[data-data-action-csv-mode]').isVisible(),false);
    await dialog.locator('[data-data-action-format]').selectOption('csv');await dialog.locator('[data-data-action-csv-mode]').selectOption(mode);
    assert.equal(await download(page,dialog.getByRole('button',{name:'Download',exact:true})),mode==='safe'?safe:raw);
    if(host==='editor')await run('smartHitSettled');
  }
  for(const mode of ['safe','raw']){
    // Use a real scalar rising edge: the graph must deliver its prepared action
    // with the durable component's identity after transactional evaluation.
    await click(1,toggle);
    const notice=page.locator('[data-prepared-download]');await notice.waitFor();
    assert.equal(await notice.locator('[data-prepared-download-csv-mode]').inputValue(),'safe');
    await notice.locator('[data-prepared-download-csv-mode]').selectOption(mode);
    assert.equal(await download(page,notice.getByRole('button',{name:'Download',exact:true})),mode==='safe'?safe:raw);
    if(host==='editor')await run('smartHitSettled');
    await click(1,toggle);
    if(host==='editor')await run('smartHitSettled');
    else await page.waitForFunction(()=>!!document.querySelector('[data-smart-index="1"] rect[fill="#64748b"]'));
  }
  assert.deepEqual(errors,[]);
}));
