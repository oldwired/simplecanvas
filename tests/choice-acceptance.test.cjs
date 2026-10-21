const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=parseApp(html).instrumentFunction('openSmartChoice',`
  const originalAccept=accept;
  accept=async(...args)=>{
    if(window.__holdChoice){window.__choiceAcceptStarted=true;await new Promise(resolve=>window.__releaseChoice=resolve);}
    return originalAccept(...args);
  };`);
html=parseApp(html).inject('window.__test={run:source=>eval(source)};');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>browser?.close());

async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:960}}),errors=[];
  try{
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    const page=await context.newPage();
    await page.route('http://choice-acceptance.test/**',route=>route.fulfill(route.request().url().endsWith('/index.html')?{contentType:'text/html',body:html}:{status:404,body:''}));
    await page.goto('http://choice-acceptance.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run(`appStarted`);
    await run(`cancelGesture();const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key==='dropdown').items[0]);
      items=[{...item,uid:'pending-choice',x:40,y:90,w:280,h:78}];selection=[];setTool('select');render();save();ensureEditorComponentGraph();`);
    await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}

for(const mode of ['editor','HTML reader'])for(const outcome of ['commit','cancel choice','cancel next gesture'])
test(`${mode}: pending dropdown acceptance and next click (${outcome})`,async()=>app(async({page,run,context})=>{
  let target=page;
  if(mode==='HTML reader'){
    const content=await run('(async()=>{rememberActiveTab();return buildWorkspaceHtml(captureWorkspaceHtml());})()');
    target=await context.newPage();await target.route('http://choice-reader.test/**',route=>route.fulfill({contentType:'text/html',body:content}));
    await target.goto('http://choice-reader.test/document.html');
    await target.waitForFunction(()=>document.querySelector('[data-smart-index="0"]')?.dataset.smartReady==='true');
    const p=await target.locator('[data-smart-index="0"]').evaluate(host=>{const p=new DOMPoint(140,52).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};});
    await target.mouse.click(p.x,p.y);
  }else{
    const at=await run(`(async()=>{selection=[0];editingSmartIdx=0;render();const it=items[0],hs=await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it)]),h=hs.find(h=>h.kind==='choice');return {x:it.x+h.x,y:it.y+h.y};})()`);
    const bounds=await page.locator('#canvas').boundingBox();await page.mouse.click(bounds.x+at.x,bounds.y+at.y);await run('smartHitSettled');
  }
  const select=target.locator('select[data-smart-inline-input="choice"]');await select.waitFor();
  await target.evaluate(()=>{
    window.__holdChoice=true;window.__nextClicks=0;
    const button=document.createElement('button');button.id='choice-next';button.textContent='Next control';button.style.cssText='position:fixed;top:20px;right:20px;z-index:2000';
    button.addEventListener('click',()=>window.__nextClicks++);document.body.append(button);
  });
  await select.selectOption('1');await target.waitForFunction(()=>window.__choiceAcceptStarted===true);
  if(outcome==='cancel next gesture'){
    await target.evaluate(()=>window.addEventListener('pointerdown',event=>window.__queuedPointerId=event.pointerId,{capture:true,once:true}));
    const bounds=await target.locator('#choice-next').boundingBox();
    await target.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await target.mouse.down();
    await target.evaluate(()=>document.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__queuedPointerId,pointerType:'mouse',bubbles:true})));
    await target.mouse.up();
  }else await target.locator('#choice-next').click();
  if(outcome==='cancel choice')await target.evaluate(()=>document.querySelector('select[data-smart-inline-input="choice"]').dispatchEvent(new Event('smartcancel')));
  await target.evaluate(()=>{window.__holdChoice=false;window.__releaseChoice();});
  if(mode==='editor'){
    await run('smartHitSettled');
    assert.equal(await run('(async()=>{const graph=await ensureEditorComponentGraph();return graph.get(items[0]).io.outputs.index;})()'),outcome==='cancel choice'?0:1);
  }else await target.waitForFunction(text=>[...document.querySelector('[data-smart-index="0"]').querySelectorAll('text')].some(node=>node.textContent===text),outcome==='cancel choice'?'Idle':'Running',{timeout:2000});
  await select.waitFor({state:'detached'});
  assert.equal(await target.evaluate(()=>window.__nextClicks),outcome==='commit'?1:0,'only an uncancelled accepted outside click is delivered, once');
}));
