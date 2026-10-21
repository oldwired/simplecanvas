const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..');
const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),errors=[];
  try{
    context.on('page',page=>{page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());});
    const page=await context.newPage();
    await page.route('http://reader-slider.test/**',route=>route.fulfill(route.request().url().endsWith('/index.html')?
      {contentType:'text/html',body:html}:{status:404,body:''}));
    await page.goto('http://reader-slider.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}

async function openReader({page,run,context},mode){
  if(mode==='preview'){
    await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
    const element=await page.locator('#runPreviewFrame').elementHandle();
    return {page,frame:await element.contentFrame(),frameElement:page.locator('#runPreviewFrame')};
  }
  const content=await run('(async()=>{rememberActiveTab();return buildWorkspaceHtml(captureWorkspaceHtml());})()');
  const reader=await context.newPage();
  await reader.route('http://slider-export.test/**',route=>route.fulfill({contentType:'text/html',body:content}));
  await reader.goto('http://slider-export.test/reader.html');return {page:reader,frame:reader};
}

const hostSelector=(index,tab)=>`${tab?'.tab-panel[data-tab-id="'+tab+'"] ':''}[data-smart-index="${index}"]`;
async function waitValue(frame,index,value,tab){
  await frame.waitForFunction(({selector,value})=>{
    const host=document.querySelector(selector);
    return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(text=>text.textContent===String(value));
  },{selector:hostSelector(index,tab),value},{timeout:5000});
}
async function sliderPoint(reader,index,value,{tab,w=240,h=130}={}){
  const point=await reader.frame.locator(hostSelector(index,tab)).evaluate((host,{value,w,h})=>{
    const scale=Math.min(w/240,h/130),pad=Math.min(20*scale,w*.15);
    const point=new DOMPoint(pad+(w-pad*2)*value/100,h*.55).matrixTransform(host.firstElementChild.getScreenCTM());
    return {x:point.x,y:point.y};
  },{value,w,h});
  const offset=reader.frameElement?await reader.frameElement.boundingBox():{x:0,y:0};
  return {x:point.x+offset.x,y:point.y+offset.y};
}
async function moveSlider(reader,index,value,options){
  const point=await sliderPoint(reader,index,value,options);await reader.page.mouse.move(point.x,point.y);return point;
}
async function pressSlider(reader,index,value,options){
  await reader.frame.evaluate(()=>window.addEventListener('pointerdown',event=>{window.__sliderPointerId=event.pointerId;},{capture:true,once:true}));
  await moveSlider(reader,index,value,options);await reader.page.mouse.down();
}
async function thumbX(frame,index,tab){
  return Number(await frame.locator(hostSelector(index,tab)+' ellipse').first().getAttribute('cx'));
}
async function continuousMotion(reader,index,{tab,w=240,h=130}={}){
  return reader.frame.evaluate(({selector,w,h})=>new Promise(resolve=>{
    const host=document.querySelector(selector),positions=new Set(),values=new Set();let frame=0;
    const scale=Math.min(w/240,h/130),pad=Math.min(20*scale,w*.15);
    // Keep sending moves while Worker drawing calls settle. Waiting for each value
    // before the next move would hide the stale-paint starvation this guards against.
    const tick=()=>{
      const value=20+(frame%60),point=new DOMPoint(pad+(w-pad*2)*value/100,h*.55).matrixTransform(host.firstElementChild.getScreenCTM());
      window.dispatchEvent(new PointerEvent('pointermove',{pointerId:window.__sliderPointerId,pointerType:'mouse',buttons:1,clientX:point.x,clientY:point.y,bubbles:true}));
      positions.add(host.querySelector('ellipse')?.getAttribute('cx'));
      values.add([...host.querySelectorAll('text')].map(text=>text.textContent).join('|'));
      if(++frame<90)requestAnimationFrame(tick);else resolve({positions:[...positions],values:[...values]});
    };
    requestAnimationFrame(tick);
  }),{selector:hostSelector(index,tab),w,h});
}
async function cancelDrag(reader){
  await reader.frame.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__sliderPointerId,pointerType:'mouse',bubbles:true})));
  await reader.page.mouse.up();
}

for(const mode of ['html','preview'])test(`${mode}: slider paints intermediate values during continuous movement, settles once on release, and rolls back cancellation`,async()=>app(async env=>{
  const {run}=env;
  await run(`cancelGesture();const make=(key,uid,x,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,x,y:100,...extra});
    items=[make('numberControl','quantity',40,{w:240,h:130,state:{value:10}}),
      make('valueLabel','live-value',340,{bindings:{value:{uid:'quantity',port:'value'}}}),
      make('compare','threshold',640,{bindings:{value:{uid:'quantity',port:'value'}},inputValues:{b:50,operation:'≥'}}),
      make('counter','edges',980,{bindings:{value:{uid:'threshold',port:'value'}}})];
    // A slower drawing hook makes overlapping graph revisions reproducible.
    items[0].script=items[0].script.replace('children(state,style,w,h,editing,io={}){',
      'children(state,style,w,h,editing,io={}){const deadline=performance.now()+35;while(performance.now()<deadline){}');
    selection=[];setTool('select');render();save();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);`);
  const reader=await openReader(env,mode),frame=reader.frame;
  await waitValue(frame,0,10);await waitValue(frame,1,10);await waitValue(frame,3,0);
  const start=await thumbX(frame,0);
  try{
    await pressSlider(reader,0,10);
    const motion=await continuousMotion(reader,0);
    assert.ok(motion.positions.length>=4,'the thumb repeatedly paints while pointer movement continues: '+JSON.stringify(motion));
    assert.ok(motion.values.length>=4,'the displayed number repeatedly paints while pointer movement continues');
    await moveSlider(reader,0,30);
    await waitValue(frame,0,30);await waitValue(frame,1,30);
    const middle=await thumbX(frame,0);assert.ok(middle>start,'the slider thumb moves before pointer release');
    await moveSlider(reader,0,80);await waitValue(frame,0,80);await waitValue(frame,1,80);
    assert.ok(await thumbX(frame,0)>middle,'a subsequent held move paints another intermediate position');
    await waitValue(frame,3,0);
    await reader.page.mouse.up();await waitValue(frame,3,1);

    await pressSlider(reader,0,80);await moveSlider(reader,0,20);await waitValue(frame,0,20);await waitValue(frame,1,20);
    await waitValue(frame,3,1);await cancelDrag(reader);
    await waitValue(frame,0,80);await waitValue(frame,1,80);await waitValue(frame,3,1);
    // A cancelled low preview must not create a falling edge or a second rising edge.
    await pressSlider(reader,0,80);await moveSlider(reader,0,90);await reader.page.mouse.up();
    await waitValue(frame,0,90);await waitValue(frame,3,1);
    if(mode==='preview'){
      assert.equal(await run('items[0].state.value'),10);
      await env.page.locator('#exitPreviewBtn').click();assert.equal(await run('items[0].state.value'),10);
    }
  }finally{await reader.page.mouse.up();}
}));

for(const mode of ['shipped html','preview'])test(`${mode}: fruit dashboard Quantity thumb and value follow a held drag`,async()=>app(async env=>{
  const workspace=JSON.parse(fs.readFileSync(path.join(root,'examples','workspace-runtime.json'),'utf8'));
  const index=workspace.tabs.find(tab=>tab.id==='runtime-dashboard').items.findIndex(item=>item.uid==='runtime-quantity');
  let reader;
  if(mode==='shipped html'){
    const page=await env.context.newPage();await page.goto(pathToFileURL(path.join(root,'examples','workspace-runtime.html')).href);
    reader={page,frame:page};
  }else{
    await env.run(`openWorkspaceFile(new File([${JSON.stringify(JSON.stringify(workspace))}],'workspace.json',{type:'application/json'}))`);
    await env.page.waitForFunction(()=>__test.run("activeTabId==='runtime-dashboard'"));
    reader=await openReader(env,'preview');
  }
  const options={tab:'runtime-dashboard',w:220,h:128};
  await waitValue(reader.frame,index,1,options.tab);const start=await thumbX(reader.frame,index,options.tab);
  try{
    await pressSlider(reader,index,1,options);
    const motion=await continuousMotion(reader,index,options);
    assert.ok(motion.positions.length>=4,'the fruit dashboard paints several thumb positions during continuous movement: '+JSON.stringify(motion));
    await moveSlider(reader,index,45,options);
    await waitValue(reader.frame,index,45,options.tab);assert.ok(await thumbX(reader.frame,index,options.tab)>start);
    await moveSlider(reader,index,72,options);await waitValue(reader.frame,index,72,options.tab);
    await reader.page.mouse.up();await waitValue(reader.frame,index,72,options.tab);
  }finally{await reader.page.mouse.up();}
}));
