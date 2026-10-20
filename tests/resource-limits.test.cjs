const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseApp}=require('./helpers/app-source.cjs');
const {launchBrowser}=require('./helpers/browser.cjs');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),app=parseApp(source);
const helpers=vm.runInNewContext(app.declarationsSource(['MAX_IMAGE_BYTES','MAX_SCENE_IMAGE_BYTES','MAX_ENTRY_NAME',
  'imageDataBytes','checkSceneImageBudget','normalizedSketchName','uniqueEntryName','readIconJSON'])+
  ';({imageDataBytes,checkSceneImageBudget,normalizedSketchName,uniqueEntryName,readIconJSON})',{Uint8Array,TextDecoder});
const data=bytes=>'data:image/png;base64,'+'A'.repeat(Math.ceil(bytes/3)*4);

test('image budgets count decoded bytes and unique referenced assets',()=>{
  assert.equal(helpers.imageDataBytes('data:image/png;base64,AA=='),1);
  assert.equal(helpers.imageDataBytes('data:image/png;base64,AAA='),2);
  const image=data(12*1024*1024),assets=Object.fromEntries(Array.from({length:6},(_,i)=>['img'+i,image]));
  helpers.checkSceneImageBudget(Array.from({length:100},()=>({type:'image',id:'img0'})),assets);
  assert.throws(()=>helpers.checkSceneImageBudget(Object.keys(assets).map(id=>({type:'image',id})),assets),/64 MiB/);
  assert.throws(()=>helpers.checkSceneImageBudget([{type:'image',id:'large'}],{large:data(17*1024*1024)}),/16 MiB/);
});
test('sketch name validation rejects oversize names instead of truncating imported identities',()=>{
  assert.equal(helpers.normalizedSketchName('  Sketch  '),'Sketch');
  assert.equal(helpers.normalizedSketchName('', 'Untitled'),'Untitled');
  assert.equal(helpers.normalizedSketchName('x'.repeat(120)).length,120);
  assert.throws(()=>helpers.normalizedSketchName('x'.repeat(121)),/120 characters/);
});
test('generated entry names reserve suffix space and resolve long-name collisions',()=>{
  const original='x'.repeat(120),names=new Set([original]);
  const copy=helpers.uniqueEntryName(original,names,' copy');names.add(copy);
  assert.equal(copy,'x'.repeat(115)+' copy');
  const second=helpers.uniqueEntryName(original,names,' copy');
  assert.equal(second,'x'.repeat(113)+' copy 2');assert.equal(second.length,120);
  assert.equal(helpers.uniqueEntryName('y'.repeat(180),new Set()),'y'.repeat(120));
  assert.equal(helpers.uniqueEntryName(original,names),'x'.repeat(118)+' 2');
});

test('Iconify response limits enforce streamed bytes even without a trustworthy Content-Length',async()=>{
  assert.equal((await helpers.readIconJSON(new Response('{"icons":[]}'),32)).icons.length,0);
  await assert.rejects(helpers.readIconJSON(new Response('x'.repeat(33)),32),/too large/);
  await assert.rejects(helpers.readIconJSON(new Response('{}',{headers:{'Content-Length':'999'}}),32),/too large/);
  await assert.rejects(helpers.readIconJSON(new Response('x'.repeat(33),{headers:{'Content-Length':'1'}}),32),/too large/);
});

let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});
async function editor(fn){
  const context=await browser.newContext();
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const html=app.inject('window.__test={run:source=>eval(source)};');
    await page.route('http://resource-limits.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://resource-limits.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
test('oversized images and imported names leave editor history and the workspace untouched',async()=>editor(async({run})=>{
  const result=await run(`(()=>{
    const before=JSON.stringify(workspaceSnapshot()),history=undoStack.length,errors=[];
    readFile(new File([new Uint8Array(MAX_IMAGE_BYTES+1)],'large.png',{type:'image/png'}));
    for(const tab of [{name:'x'.repeat(121),items:[]},{name:'Large image',items:[{type:'image',id:'large',x:0,y:0,w:10,h:10}],assets:{large:'data:image/png;base64,'+'A'.repeat(24*1024*1024)}}]){
      try{parseFileAsTabs({app:'SimpleCanvasWorkspace',version:FORMAT_VERSION,tabs:[tab]});}catch(error){errors.push(error.message);}
    }
    return {same:before===JSON.stringify(workspaceSnapshot()),history:undoStack.length===history,errors};
  })()`);
  assert.equal(result.same,true);assert.equal(result.history,true);assert.equal(result.errors.length,2);
  assert.match(result.errors[0],/120 characters/);assert.match(result.errors[1],/16 MiB/);
}));
test('Iconify keeps search results and cached icon bodies bounded',async()=>editor(async({page,run})=>{
  const result=await run(`(()=>{
    iconBodies.clear();iconBodyChars=0;
    for(let i=0;i<1200;i++)cacheIconBody('set:'+i,{body:'x'.repeat(10000),vb:[0,0,24,24]});
    let total=0;for(const icon of iconBodies.values())total+=icon?.body?.length||0;
    const invalid=iconFromSetData({icons:{oversize:{body:'x'.repeat(ICON_MAX_BODY+1)}}},'oversize');
    return {entries:iconBodies.size,total,invalid};
  })()`);
  assert.ok(result.entries<=1024);assert.ok(result.total<=8000000);assert.equal(result.invalid,null);
  await page.route('https://api.iconify.design/search?**',route=>route.fulfill({json:{icons:Array(97).fill('test:large'),collections:{}}}));
  await run("openIconDialog();searchIcons('test')");
  assert.equal(await run('iconLastSearch'),null);
}));

test('long library names can be duplicated and long Iconify names imported without stalling',async()=>editor(async({run})=>{
  const result=await run(`(()=>{
    const source={name:'x'.repeat(120),items:[{type:'rect',x:0,y:0,w:50,h:50,size:1,color:'#000000'}]};
    shapeLibrary=prepareShapeLibrary({app:'SimpleCanvasShapeLibrary',version:2,shapes:[source]});
    syncShapeLibraryEntries(true);copyLibraryEntry(source);copyLibraryEntry(source);
    const iconName='y'.repeat(128);
    for(let index=0;index<2;index++){
      openIconDialog();finishIconImport({ready:true,request:iconImportSeq,session:iconSession,library:shapeLibrary,
        set:'test',name:iconName,col:{},result:{items:clone(source.items)}});
    }
    return shapeLibrary.shapes.map(entry=>entry.name);
  })()`);
  assert.deepEqual(result,['x'.repeat(120),'x'.repeat(115)+' copy','x'.repeat(113)+' copy 2','y'.repeat(120),'y'.repeat(118)+' 2']);
}));
