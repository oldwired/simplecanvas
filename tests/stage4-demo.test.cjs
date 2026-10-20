const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..'),workspacePath=path.join(root,'examples/smart-components-workspace.json');
const workspace=JSON.parse(fs.readFileSync(workspacePath,'utf8'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});
const uid=(tab,id)=>`demo-${tab}-${id}`;
const itemFor=(tab,id)=>workspace.tabs[tab-1].items.find(item=>item.uid===uid(tab,id));
async function app(fn){
 const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.route('http://stage4-demo.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
 try{
  await page.goto('http://stage4-demo.test/index.html');
  const run=source=>page.evaluate(source=>{
   const pending=window.__testPending||(window.__testPending=new Set());
   const call=Promise.resolve(__test.run('appReady')).then(()=>__test.run(source));
   const result=call.finally(()=>pending.delete(result));pending.add(result);return result;
  },source);
  await run('appStarted');await run('pendingFileAction="openWorkspace"');await page.locator('#projectInput').setInputFiles(workspacePath);
  await page.waitForFunction(n=>__test.run('tabs.length')===n,workspace.tabs.length);
  await fn({page,run,context});assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
async function activate(run,tab){await run(`activateTab(tabs[${tab-1}].id);selection=[];setTool('select');render();`);await run('ensureEditorComponentGraph()');}
async function editorHandle(page,run,tab,id,handleId){
 const target=uid(tab,id);let snapshot;
 // Trigger deadlines and completion notifications may invalidate a read while its Worker
 // reply is pending. Retry only this read; never repeat an actual UI click or action.
 for(let attempt=0;attempt<3;attempt++){
  try{
   snapshot=await run(`(async()=>{const index=items.findIndex(item=>item.uid===${JSON.stringify(target)});selection=[index];editingSmartIdx=index;render();const item=items[index],io=await resolveSmartComponentIo(item),handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]);return {item,handle:handles.find(handle=>handle.id===${JSON.stringify(handleId)})};})()`);
   break;
  }catch(error){if(attempt===2 || !/Smart shape operation cancelled/.test(error.message))throw error;await page.waitForTimeout(50);}
 }
 const {item,handle}=snapshot;
 assert.ok(handle,target+' has '+handleId);const box=await page.locator('#canvas').boundingBox();
 await page.mouse.click(box.x+item.x+handle.x,box.y+item.y+handle.y);
 if(!['text','number','action','choice'].includes(handle.kind))await run('smartHitSettled');
}
const outputs=(run,tab,id)=>run(`(async()=>(await resolveSmartComponentIo(items.find(item=>item.uid===${JSON.stringify(uid(tab,id))}))).outputs)()`);
async function waitState(page,tab,id,expression){await page.waitForFunction(({target,expression})=>__test.run(`(()=>{const state=items.find(item=>item.uid===${JSON.stringify(target)})?.state;return !!state&&(${expression});})()`),{target:uid(tab,id),expression});}
async function submitEditor(page,run,tab,id,value){
 await editorHandle(page,run,tab,id,'entry');const field=page.locator('[data-smart-inline-input]'),input=field.locator('input');
 const before=Number(await field.getAttribute('data-submissions')||0);await input.fill(value);await input.press('Enter');
 await page.waitForFunction(({field,before})=>Number(field.dataset.submissions)>before,{field:await field.elementHandle(),before});await run('smartHitSettled');await input.press('Escape');
}
function readerHost(page,tab,id){const index=workspace.tabs[tab-1].items.findIndex(item=>item.uid===uid(tab,id));assert.ok(index>=0);return page.locator('.tab-panel').nth(tab-1).locator('[data-smart-index="'+index+'"]');}
async function openReader(context,tab){
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
 await page.goto(pathToFileURL(path.join(root,'examples/smart-components-workspace.html')).href+'?page='+(tab-1));
 const panel=page.locator('.tab-panel').nth(tab-1);await panel.waitFor({state:'visible'});
 await page.waitForFunction(panel=>[...panel.querySelectorAll('[data-smart-index]')].every(host=>host.dataset.smartReady==='true'),await panel.elementHandle());
 return {page,errors,requests};
}
async function readerHandle(page,tab,id,kind){
 const item=itemFor(tab,id),point=kind==='loadData'?{x:item.w/2,y:item.h-26*Math.min(item.w/300,item.h/150)}:kind==='trigger'?{x:item.w*.38,y:item.h*.49}:kind==='entry'?{x:item.w*.5,y:item.h*.67}:{x:item.w*.5,y:item.h*.69};
 const position=await readerHost(page,tab,id).evaluate((host,p)=>{const v=new DOMPoint(p.x,p.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:v.x,y:v.y};},point);await page.mouse.click(position.x,position.y);
}
async function readerText(page,tab,id,text){await page.waitForFunction(({host,text})=>[...host.querySelectorAll('text')].some(node=>node.textContent===text),{host:await readerHost(page,tab,id).elementHandle(),text});}
async function readerLines(page,tab,id,count){await page.waitForFunction(({host,count})=>[...host.querySelectorAll('text')].some(node=>node.textContent.startsWith(count+' '+(count===1?'line':'lines')+' · ')),{host:await readerHost(page,tab,id).elementHandle(),count});}
async function submitReader(page,tab,id,value){
 await readerHandle(page,tab,id,'entry');const field=page.locator('[data-smart-inline-input]'),input=field.locator('input');
 const before=Number(await field.getAttribute('data-submissions')||0);await input.fill(value);await input.press('Enter');
 await page.waitForFunction(({field,before})=>Number(field.dataset.submissions)>before,{field:await field.elementHandle(),before});await input.press('Escape');
}
async function readerOkay({page,errors,requests}){assert.equal(await page.locator('[data-component-error]').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);}

test('selection walkthrough groups Dropdown outputs and suppresses unselected messages in editor and offline HTML',async()=>app(async({page,run,context})=>{
 await activate(run,36);await editorHandle(page,run,36,'city','select');
 await page.locator('select[data-smart-inline-input="choice"]').selectOption('1');await run('smartHitSettled');
 await waitState(page,36,'choices','state.lineCount===1');assert.equal((await outputs(run,36,'choices')).text,'Rome / Italy');
 await submitEditor(page,run,36,'a','Chosen A');assert.equal((await outputs(run,36,'selected')).text,'Chosen A');
 await submitEditor(page,run,36,'b','Waiting B');assert.equal((await outputs(run,36,'selected')).lineCount,1);
 await editorHandle(page,run,36,'select','toggle');assert.equal((await outputs(run,36,'selector')).text,'Waiting B');assert.equal((await outputs(run,36,'selected')).lineCount,1);
 await editorHandle(page,run,36,'reprocess','trigger');assert.equal((await outputs(run,36,'selected')).text,'Chosen A\nWaiting B');
 await page.screenshot({path:'/private/tmp/sc-stage4-demo-editor-36.png'});
 const reader=await openReader(context,36),rp=reader.page;
 await readerHandle(rp,36,'city','choice');await rp.locator('select[data-smart-inline-input="choice"]').selectOption('1');
 await readerText(rp,36,'choices','Rome / Italy');await readerLines(rp,36,'choices',1);
 await submitReader(rp,36,'a','Chosen A');await readerLines(rp,36,'selected',1);
 await submitReader(rp,36,'b','Waiting B');await readerText(rp,36,'b','Waiting B');await readerLines(rp,36,'selected',1);
 await readerHandle(rp,36,'select','toggle');await readerText(rp,36,'selector','Waiting B');await readerLines(rp,36,'selected',1);
 await readerHandle(rp,36,'reprocess','trigger');await readerText(rp,36,'selected','Waiting B');await readerLines(rp,36,'selected',2);
 await rp.screenshot({path:'/private/tmp/sc-stage4-demo-reader-36.png'});await readerOkay(reader);
}));

test('adapter walkthrough samples signals, queues repeated events and logs Counter/Timer completion in both runtimes',async()=>app(async({page,run,context})=>{
 await activate(run,37);await submitEditor(page,run,37,'sample-value','Sampled');assert.equal((await outputs(run,37,'samples')).lineCount,0);
 await editorHandle(page,run,37,'sample-trigger','trigger');await waitState(page,37,'samples','state.text==="Sampled"');
 for(let i=0;i<3;i++)await submitEditor(page,run,37,'entry','Again');
 await waitState(page,37,'counter','state.count===3');await waitState(page,37,'count-log','state.text==="Count reached 3"');
 await submitEditor(page,run,37,'entry','Again');await waitState(page,37,'counter','state.count===4');assert.equal((await outputs(run,37,'count-log')).lineCount,1);
 await editorHandle(page,run,37,'run','toggle');await waitState(page,37,'timer-log','state.text==="Timer finished"');
 await page.screenshot({path:'/private/tmp/sc-stage4-demo-editor-37.png'});
 const reader=await openReader(context,37),rp=reader.page;
 await submitReader(rp,37,'sample-value','Sampled');await readerLines(rp,37,'samples',0);
 await readerHandle(rp,37,'sample-trigger','trigger');await readerText(rp,37,'samples','Sampled');
 for(let i=0;i<3;i++)await submitReader(rp,37,'entry','Again');
 await readerText(rp,37,'count-log','Count reached 3');await readerLines(rp,37,'count-log',1);
 await submitReader(rp,37,'entry','Again');await readerText(rp,37,'counter','4');await readerLines(rp,37,'count-log',1);
 await readerHandle(rp,37,'run','toggle');await readerText(rp,37,'timer-log','Timer finished');await readerLines(rp,37,'timer-log',1);
 await rp.screenshot({path:'/private/tmp/sc-stage4-demo-reader-37.png'});await readerOkay(reader);
}));

async function loadExampleFile(page){
 const dialog=page.locator('dialog[data-component-data-action="importDataset"]');await dialog.waitFor({state:'visible'});
 await dialog.locator('[data-data-action-file]').setInputFiles(path.join(root,'examples/event-readings.csv'));
 await dialog.getByRole('button',{name:'Replace data',exact:true}).click();await dialog.waitFor({state:'hidden'});
}
test('dataset walkthrough logs failure, accepted import and captured row index in editor and offline HTML',async()=>app(async({page,run,context})=>{
 await activate(run,38);await editorHandle(page,run,38,'reload','trigger');await waitState(page,38,'errors','state.lineCount===1');
 assert.equal((await outputs(run,38,'source')).rowCount,2,'a failed reload preserves stored rows');
 await editorHandle(page,run,38,'source','loadData');await loadExampleFile(page);await run('smartHitSettled');
 await waitState(page,38,'loaded','state.text==="3"');assert.equal((await outputs(run,38,'source')).rowCount,3);
 await editorHandle(page,run,38,'record','trigger');await waitState(page,38,'captured','state.text==="3"');
 assert.equal((await outputs(run,38,'source')).rowCount,4);assert.equal((await outputs(run,38,'loaded')).lineCount,1,'capture is not an import notification');
 await page.screenshot({path:'/private/tmp/sc-stage4-demo-editor-38.png'});
 const reader=await openReader(context,38),rp=reader.page;rp.on('dialog',dialog=>dialog.accept());
 await readerHandle(rp,38,'reload','trigger');await readerLines(rp,38,'errors',1);
 await readerHandle(rp,38,'source','loadData');await loadExampleFile(rp);await readerText(rp,38,'loaded','3');await readerLines(rp,38,'loaded',1);
 await readerHandle(rp,38,'record','trigger');await readerText(rp,38,'captured','3');await readerLines(rp,38,'captured',1);
 await readerText(rp,38,'table','Gamma');await readerLines(rp,38,'loaded',1);
 await rp.screenshot({path:'/private/tmp/sc-stage4-demo-reader-38.png'});await readerOkay(reader);
}));
