const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

// Only the editor exposes test observations. Component code is evaluated by the
// production Worker bridge; the downloaded reader has no test instrumentation.
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{await browser?.close();});
async function app(fn,query=''){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://text-operations.test/**',route=>route.fulfill({
      status:new URL(route.request().url()).pathname.endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://text-operations.test/index.html'+query);
    const run=source=>page.evaluate(async source=>{
      await __test.run('appReady');
      const pending=Promise.resolve(__test.run(source));
      (window.__testPending??=new Set()).add(pending);
      try{return await pending;}finally{window.__testPending.delete(pending);}
    },source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function seed(run,specs){
  await run(`cancelGesture();items=${JSON.stringify(specs)}.map((spec,index)=>{
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===spec.key).items[0]);
    return {...base,uid:'operation-'+index,x:70+(index%3)*450,y:100+Math.floor(index/3)*260,...spec,state:{...base.state,...spec.state}};
  });selection=[];editingSmartIdx=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
const record=(run,index)=>run(`(async()=>{const record=(await ensureEditorComponentGraph()).get(items[${index}]);return {error:record.error||null,outputs:record.io.outputs};})()`);
async function output(run,index){const result=await record(run,index);assert.equal(result.error,null);return result.outputs;}
async function setInputs(run,index,values,state={}){
  await run(`items[${index}].inputValues=${JSON.stringify(values)};Object.assign(items[${index}].state,${JSON.stringify(state)});editorComponentEvaluation=null;render();`);
  return record(run,index);
}
async function inputDialog(page,run,index){
  await run(`selection=[${index}];editingSmartIdx=null;render();void openComponentBindings();`);
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open&&!document.querySelector('#componentBindingFields').disabled);
}
async function saveDialog(page){await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);}
async function entryHandle(run,index){
  return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='entry');})()`);
}
async function openEditorEntry(page,run,index){
  await run(`selection=[${index}];editingSmartIdx=${index};render();`);
  const handle=await entryHandle(run,index);assert.ok(handle,'text input has an inline entry handle');
  const item=await run(`clone(items[${index}])`),box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+handle.x,box.y+item.y+handle.y);
  const input=page.locator(handle.kind==='number'?'#smartNumberValue':'#smartTextValue');await input.waitFor();return input;
}
async function submitEditor(page,run,index,value){
  const input=await openEditorEntry(page,run,index);await input.fill(value);await input.press('Enter');
  await page.waitForFunction(({index,value})=>__test.run(`editorComponentEvaluation?.records?.get(items[${index}])?.io.outputs.value`)===value,{index,value});
  await input.press('Escape');await input.waitFor({state:'detached'});await run('smartHitSettled');
}
async function readerText(page,index,text){
  await page.waitForFunction(({index,text})=>{const host=document.querySelector('[data-smart-index="'+index+'"]');return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(node=>node.textContent===text);},{index,text});
}
async function submitReader(page,index,handle,value){
  const point=await page.locator('[data-smart-index="'+index+'"]').evaluate((host,handle)=>{
    const point=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};
  },handle);await page.mouse.click(point.x,point.y);
  const input=page.locator('#smartTextValue');await input.waitFor();await input.fill(value);await input.press('Enter');
  await readerText(page,index,value);await input.press('Escape');await input.waitFor({state:'detached'});
}
async function exported(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-text-operations-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'text-operations.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);return {reader,errors,requests,file};
}


test('query components read the opening URL, preserve repeated/empty parameters and stay out of saved state',async()=>app(async({run})=>{
  await seed(run,[{key:'urlParameter',inputValues:{key:'name'}},{key:'urlParameter',inputValues:{key:'name',index:1}},
    {key:'urlParameter',inputValues:{key:'empty',fallback:'default'}},{key:'urlParameter',inputValues:{key:'missing',fallback:'Guest'}}]);
  assert.deepEqual(await output(run,0),{value:'Anna & Zoë',found:true,count:2});
  assert.deepEqual(await output(run,1),{value:'Bob',found:true,count:2});
  assert.deepEqual(await output(run,2),{value:'',found:true,count:1});
  assert.deepEqual(await output(run,3),{value:'Guest',found:false,count:0});
  const saved=await run('JSON.stringify(items.map(item=>item.state))');assert.ok(!saved.includes('Anna'));
  const preview=await run('(async()=>{const source=clone(items[0]);source.inputValues.fallback="Library default";return shapeThumbSVGAsync([source]);})()');
  assert.ok(preview.includes('Library default'));assert.ok(!preview.includes('Anna'),'library previews use portable defaults');
},'?name=Anna+%26+Zo%C3%AB&name=Bob&empty='));

test('HTML reads its own query, opens zero-based page links, and keeps editor query out of static markup',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'urlParameter',inputValues:{key:'name',fallback:'Guest'}},
    {key:'textLabel',bindings:{value:{uid:'operation-0',port:'value'}}}]);
  assert.equal((await output(run,1)).value,'EditorOnlySecret');
  await run('newTab()');
  await seed(run,[{key:'urlParameter',inputValues:{key:'name',fallback:'Second tab'}},
    {key:'textLabel',bindings:{value:{uid:'operation-0',port:'value'}}}]);
  const {reader,file,errors,requests}=await exported(page,run,context);
  assert.ok(!fs.readFileSync(file,'utf8').includes('EditorOnlySecret'),'neither query nor query-derived SVG text is baked into export');
  await reader.goto(pathToFileURL(file).href+'?page=1&name=Anna');
  await reader.waitForFunction(()=>document.querySelectorAll('.tab-select')[1].classList.contains('active'));
  const panel=reader.locator('.tab-panel:visible');
  await panel.locator('[data-smart-index="1"][data-smart-ready="true"]').waitFor();
  assert.equal(await panel.locator('[data-smart-index="1"] text').textContent(),'Anna');
  await reader.locator('.tab-select').nth(0).click();
  await reader.locator('.tab-panel:visible [data-smart-index="1"][data-smart-ready="true"]').waitFor();
  assert.equal(await reader.locator('.tab-panel:visible [data-smart-index="1"] text').textContent(),'Anna');
  for(const pageValue of ['-1','2','1.5','NaN','01','']){
    await reader.goto(pathToFileURL(file).href+'?page='+pageValue+'&name=FallbackPage');
    await reader.waitForFunction(()=>document.querySelectorAll('.tab-select')[0].classList.contains('active'));
    await reader.locator('.tab-panel:visible [data-smart-index="1"][data-smart-ready="true"]').waitFor();
    assert.equal(await reader.locator('.tab-panel:visible [data-smart-index="1"] text').textContent(),'FallbackPage');
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
},'?name=EditorOnlySecret'));

test('plain HTML workspace deep links work without any smart components',async()=>app(async({page,run,context})=>{
  await run('items=[{type:"text",x:20,y:20,w:400,h:40,text:"First plain tab",font:"20px sans-serif",color:"#000000"}];save();newTab();items=[{type:"text",x:20,y:20,w:400,h:40,text:"Second plain tab",font:"20px sans-serif",color:"#000000"}];save();');
  const {reader,file,errors}=await exported(page,run,context);
  await reader.goto(pathToFileURL(file).href+'?page=1');
  assert.match(await reader.locator('.tab-panel:visible').textContent(),/Second plain tab/);
  await reader.goto(pathToFileURL(file).href+'?page=999');
  assert.match(await reader.locator('.tab-panel:visible').textContent(),/First plain tab/);
  assert.deepEqual(errors,[]);
}));

test('grapheme and code-point modes work in editor and offline HTML without splitting displayed emoji',async()=>app(async({page,run,context})=>{
  const value='👩‍👩‍👧‍👦🇩🇪é';
  await seed(run,[{key:'textInput',state:{values:[value],current:0}},
    {key:'textTransform',bindings:{text:{uid:'operation-0',port:'value'}}},
    {key:'textTransform',state:{characterMode:'code points'},bindings:{text:{uid:'operation-0',port:'value'}}},
    {key:'textExtract',inputValues:{start:1,length:1},bindings:{text:{uid:'operation-0',port:'value'}}},
    {key:'textLabel',bindings:{value:{uid:'operation-3',port:'text'}}}]);
  assert.deepEqual(await output(run,1),{text:value,length:3,empty:false});
  assert.deepEqual(await output(run,2),{text:value,length:11,empty:false});
  assert.deepEqual(await output(run,3),{text:'🇩🇪',found:true});
  const {reader,errors,requests}=await exported(page,run,context);await readerText(reader,4,'🇩🇪');
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="1"]').textContent.includes('Length: 3'));
  assert.match(await reader.locator('[data-smart-index="2"]').textContent(),/Length: 11/);
  await submitReader(reader,0,await entryHandle(run,0),'é👨‍👩‍👦');await readerText(reader,4,'👨‍👩‍👦');
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="1"]').textContent.includes('Length: 2'));
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('editor navigation merges JSON parameters and recalculates the current tab, while invalid parameters are atomic',async()=>app(async({page,run})=>{
  await seed(run,[{key:'urlParameter',inputValues:{key:'name',fallback:'Guest'}},
    {key:'textLabel',bindings:{value:{uid:'operation-0',port:'value'}}},
    {key:'goToTab',inputValues:{page:0,parameters:'{"name":"Anna & Zoë","gone":null,"enabled":true}'}}]);
  assert.equal((await output(run,0)).value,'Old');
  const navigate=()=>run('openEditorComponentDataAction(items[2],{type:"goToTab",input:"page",parameters:"parameters"},()=>true)');
  assert.equal(await navigate(),true);
  assert.equal((await output(run,1)).value,'Anna & Zoë');
  const url=new URL(page.url());assert.equal(url.searchParams.get('keep'),'yes');assert.equal(url.searchParams.get('gone'),null);assert.equal(url.searchParams.get('enabled'),'true');assert.equal(url.searchParams.get('page'),'0');assert.equal(url.hash,'#anchor');
  await run('items[2].inputValues.parameters="{broken}";');
  const before=page.url();assert.equal(await navigate(),false);assert.equal(page.url(),before);assert.equal((await output(run,1)).value,'Anna & Zoë');
  await run('items[2].inputValues.parameters=JSON.stringify({name:null});');
  assert.equal(await navigate(),true);assert.equal((await output(run,1)).value,'Guest');
},'?name=Old&keep=yes&gone=x#anchor'));

test('offline Go to tab passes JSON build output, updates same-tab parameters and refreshes previously visited tabs',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'jsonBuild',state:{fields:'name:string'},inputValues:{field0:'Anna & Zoë'}},
    {key:'goToTab',inputValues:{page:1},bindings:{parameters:{uid:'operation-0',port:'text'}}},
    {key:'urlParameter',inputValues:{key:'name',fallback:'First'}}]);
  const first=await run('activeTabId');
  await run('newTab()');
  await seed(run,[{key:'urlParameter',inputValues:{key:'name',fallback:'Second'}},
    {key:'textLabel',bindings:{value:{uid:'operation-0',port:'value'}}},
    {key:'goToTab',inputValues:{page:1,parameters:'{"name":"Same tab"}'}},
    {key:'goToTab',inputValues:{page:0,parameters:'{}'}}]);
  await run(`activateTab(${JSON.stringify(first)});`);
  const {reader,file,errors,requests}=await exported(page,run,context);
  await reader.goto(pathToFileURL(file).href+'?keep=yes#anchor');
  const click=async(index)=>{
    const host=reader.locator('.tab-panel:visible [data-smart-index="'+index+'"][data-smart-ready="true"]');await host.waitFor();
    const point=await host.evaluate(host=>{const bounds=host.firstElementChild.querySelectorAll('rect');const button=bounds[bounds.length-1];const p=new DOMPoint(Number(button.getAttribute('x'))+Number(button.getAttribute('width'))/2,Number(button.getAttribute('y'))+Number(button.getAttribute('height'))/2).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};});await reader.mouse.click(point.x,point.y);
  };
  await click(1);
  await reader.waitForFunction(()=>document.querySelectorAll('.tab-select')[1].classList.contains('active'));
  await reader.waitForFunction(()=>document.querySelector('.tab-panel:not([style*="display:none"]):not([style*="display: none"]) [data-smart-index="1"]')?.textContent==='Anna & Zoë');
  assert.equal(new URL(reader.url()).searchParams.get('name'),'Anna & Zoë');assert.equal(new URL(reader.url()).searchParams.get('keep'),'yes');assert.equal(new URL(reader.url()).hash,'#anchor');
  await click(2);
  await reader.waitForFunction(()=>document.querySelectorAll('.tab-panel')[1].querySelector('[data-smart-index="1"]').textContent==='Same tab');
  await click(3);await reader.waitForFunction(()=>document.querySelectorAll('.tab-select')[0].classList.contains('active'));
  await reader.waitForFunction(()=>document.querySelectorAll('.tab-panel')[0].querySelector('[data-smart-index="2"]').textContent.includes('Same tab'));
  assert.equal(new URL(reader.url()).searchParams.get('page'),'0');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
