const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>browser?.close());
const sourceScript=`({apiVersion:2,eventApi:1,inputs:{},outputs:{count:{type:'number'}},eventOutputs:{submitted:{type:'string'}},
  compute(inputs,state){return {count:state.count};},
  children(state,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#fff',strokeOn:true,color:'#334155',size:1},
    ...['Click','Text','Number',state.count+' · '+state.value].map((text,index)=>({type:'text',x:0,y:index*40,w,h:35,text,color:'#334155',strokeOn:false,font:'400 16px sans-serif'}))];},
  handles(state){return [{id:'click',kind:'click',x:110,y:20},{id:'text',kind:'text',x:110,y:60,value:state.value},{id:'number',kind:'number',x:110,y:100,value:12.5}];},
  hitEdit(state,x,y,w,h){return x>=0&&x<=w&&y>=0&&y<120?['click','text','number'][Math.floor(y/40)]:null;},
  dragEdit(state,id,value){const payload=id==='click'?'clicked':String(value);return {state:{count:state.count+1,value:payload},events:[{port:'submitted',payload}]};}})`;
const failingScript=`({apiVersion:2,eventApi:1,inputs:{},outputs:{},eventInputs:{receive:{type:'string'}},compute(){return {};},children(){return [];},onEvent(){throw new Error('Intentional receiver failure');}})`;
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1100}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://event-lifecycle.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://event-lifecycle.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function seed(run,{failing=false,tabs=false}={}){
  await run(`cancelGesture();function builtin(key,uid,x,y,extra={}){const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]);return {...item,uid,x,y,...extra};}
    const list=[builtin('constant','event-source',80,120,{script:${JSON.stringify(sourceScript)},componentName:'Generic event source',state:{count:0,value:'initial'},w:220,h:160}),
      builtin('memo','event-memo',450,120,{eventBindings:{line:{uid:'event-source',port:'submitted'}}}),
      builtin('pulseGenerator','running-clock',80,480,{inputValues:{seconds:.08,width:.03,enable:true}}),
      builtin('counter','running-count',450,480,{bindings:{value:{uid:'running-clock',port:'value'}}})];
    ${failing?`list.push(builtin('constant','event-failure',900,120,{script:${JSON.stringify(failingScript)},state:{},eventBindings:{receive:{uid:'event-source',port:'submitted'}}}));`:''}
    ${tabs?"tabs=[{id:'event-life',name:'Events'},{id:'event-other',name:'Other'}];tabDocuments.clear();tabDocuments.set('event-life',makeDocument());tabDocuments.set('event-other',makeDocument());tabDocuments.get('event-life').items=list;enterTab('event-life');renderTabs();":"items=list;"}
    selection=[];editingSmartIdx=null;undoStack=[];redoStack=[];historyBefore=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
const coords={click:{x:110,y:20},text:{x:110,y:60},number:{x:110,y:100}};
async function editorHandle(page,run,id){
  await run('selection=[0];editingSmartIdx=0;render()');const box=await page.locator('#canvas').boundingBox(),p=coords[id];
  await page.mouse.click(box.x+80+p.x,box.y+120+p.y);
}
async function modal(page,id,value){
  const dialog=page.locator(id==='text'?'[data-smart-text-input]':'[data-smart-number-input]');await dialog.waitFor({state:'visible'});
  assert.equal(await page.locator('[data-smart-inline-input]').count(),0,'generic handle uses modal input');
  await dialog.locator('input').fill(value);await dialog.getByRole('button',{name:'Apply',exact:true}).click();await dialog.waitFor({state:'detached'});
}
async function openExport(page,run,context,{holdRefresh=false}={}){
  const pending=page.waitForEvent('download');await run('exportHtml()');let body=fs.readFileSync(await(await pending).path(),'utf8');
  if(holdRefresh){
    // Hold exactly the first post-event graph refresh, after durable states have committed.
    // A real tab click must cancel any unfinished gesture without rolling back that accepted source.
    const hook=/function refreshComponents\([^)]*\)\{/;assert.match(body,hook);
    body=body.replace(hook,match=>match+`
      if(window.__holdEventRefresh && items.find(item=>item.uid==='event-source')?.state.count===1 && items.find(item=>item.uid==='event-memo')?.state.lineCount===1){
        window.__holdEventRefresh=false;window.__eventRefreshHeld=true;
        return new Promise(resolve=>{window.__releaseEventRefresh=()=>resolve(null);});
      }`);
  }
  const reader=await context.newPage(),errors=[];reader.on('pageerror',error=>errors.push(error.message));
  await reader.route('http://event-lifecycle-reader.test/**',route=>route.fulfill({status:200,contentType:'text/html',body}));await reader.goto('http://event-lifecycle-reader.test/document.html');
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="0"]')?.dataset.smartReady==='true');
  return {reader,errors};
}
async function readerHandle(reader,id){
  const host=reader.locator('.tab-panel:visible [data-smart-index="0"]');await host.waitFor();
  await reader.waitForFunction(el=>el.dataset.smartReady==='true',await host.elementHandle());
  const p=await host.evaluate((el,p)=>{const out=new DOMPoint(p.x,p.y).matrixTransform(el.firstElementChild.getScreenCTM());return {x:out.x,y:out.y};},coords[id]);
  await reader.mouse.click(p.x,p.y);
}
const visibleText=(page,index)=>page.locator('.tab-panel:visible [data-smart-index="'+index+'"] text');
async function readerText(reader,index,text){await reader.waitForFunction(({index,text})=>[...document.querySelectorAll('.tab-panel:not([style*="display: none"]) [data-smart-index="'+index+'"] text')].some(node=>node.textContent===text),{index,text});}
async function readerCount(reader){return visibleText(reader,3).evaluateAll(nodes=>Number(nodes.map(node=>node.textContent).find(text=>/^\d+$/.test(text))||0));}
async function readerAdvances(reader,before){await reader.waitForFunction(before=>[...document.querySelectorAll('.tab-panel:not([style*="display: none"]) [data-smart-index="3"] text')].some(node=>/^\d+$/.test(node.textContent)&&Number(node.textContent)>before),before);}

test('generic click, text modal, and number modal deliver one event per accepted editor interaction',async()=>app(async({page,run})=>{
  await seed(run);
  for(const [id,value,payload] of [['click',null,'clicked'],['text','Anna','Anna'],['number','12.5','12.5']]){
    await editorHandle(page,run,id);if(value!==null)await modal(page,id,value);await run('smartHitSettled');
    assert.equal(await run('items[0].state.value'),payload);
  }
  assert.equal(await run('items[0].state.count'),3);assert.equal(await run('items[1].state.text'),'clicked\nAnna\n12.5');
  assert.equal(await run('items[1].state.lineCount'),3);
}));

test('failed generic text and number modal events roll back all recipients and resume the editor clock',async()=>app(async({page,run})=>{
  await seed(run,{failing:true});
  for(const [id,value] of [['text','rejected'],['number','12.5']]){
    await editorHandle(page,run,id);
    const before=await run('items[3].state.count');await modal(page,id,value);await run('smartHitSettled');
    assert.equal(await run('items[0].state.count'),0);assert.equal(await run('items[0].state.value'),'initial');assert.equal(await run('items[1].state.text'),'');
    await page.waitForFunction(before=>__test.run('items[3].state.count')>before,before);
    assert.equal(await run('editorTimeline.pausedByUser'),false);assert.equal(await run('editorTimeline.active'),true);
  }
  await page.locator('#componentPauseBtn').click();await run('smartGestureQueue');
  await editorHandle(page,run,'text');await modal(page,'text','still rejected');await run('smartHitSettled');
  assert.equal(await run('editorTimeline.pausedByUser'),true);assert.equal(await run('editorTimeline.active'),false,'user pause survives failed modal delivery');
}));

test('generic click and modal events also work in HTML and failed modal delivery resumes its clock',async()=>app(async({page,run,context})=>{
  await seed(run);let exported=await openExport(page,run,context),reader=exported.reader;
  for(const [id,value,payload] of [['click',null,'clicked'],['text','Anna','Anna'],['number','12.5','12.5']]){
    await readerHandle(reader,id);if(value!==null)await modal(reader,id,value);await readerText(reader,1,payload);
  }
  await readerText(reader,0,'3 · 12.5');assert.deepEqual(exported.errors,[]);await reader.close();
  await seed(run,{failing:true});exported=await openExport(page,run,context);reader=exported.reader;
  for(const [id,value] of [['text','rejected'],['number','12.5']]){
    await readerHandle(reader,id);const before=await readerCount(reader);await modal(reader,id,value);await readerAdvances(reader,before);
    await readerText(reader,0,'0 · initial');assert.ok(!(await visibleText(reader,1).allTextContents()).includes(value),'Memo edit is rolled back with failed source');
    assert.equal(await reader.locator('#feedbackPause').textContent(),'Pause');
  }
  await reader.locator('#feedbackPause').click();await reader.waitForFunction(()=>document.getElementById('feedbackPause').textContent==='Resume');
  // An already accepted tick may still be painting when Pause's button updates. Let that paint finish before the comparison.
  await reader.waitForTimeout(160);
  await readerHandle(reader,'text');const pausedCount=await readerCount(reader);await modal(reader,'text','still rejected');
  await reader.waitForTimeout(160);assert.equal(await readerCount(reader),pausedCount);assert.equal(await reader.locator('#feedbackPause').textContent(),'Resume');
  assert.deepEqual(exported.errors,[]);
}));

test('switching HTML tabs during the post-click refresh preserves both committed source and Memo state',async()=>app(async({page,run,context})=>{
  await seed(run,{tabs:true});const {reader,errors}=await openExport(page,run,context,{holdRefresh:true});
  await reader.evaluate(()=>{window.__holdEventRefresh=true;});await readerHandle(reader,'click');
  await reader.waitForFunction(()=>window.__eventRefreshHeld===true);
  await reader.locator('.tab-select[data-tab-id="event-other"]').click();
  await reader.waitForFunction(()=>document.querySelector('.tab-select.active')?.dataset.tabId==='event-other');
  await reader.evaluate(()=>window.__releaseEventRefresh());
  await reader.locator('.tab-select[data-tab-id="event-life"]').click();
  await readerText(reader,1,'clicked');await readerText(reader,0,'1 · clicked');
  assert.deepEqual(errors,[]);
}));
