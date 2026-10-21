const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..');
const instrumented=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).instrumentFunction('htmlSmartRuntime','window.__reader=source=>eval(source);');
const html=parseApp(instrumented).inject('window.__test={run:source=>eval(source)};');
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
async function continuousMotion(reader,index,{tab,w=240,h=130}={}){
  return reader.frame.evaluate(({selector,w,h})=>new Promise(resolve=>{
    const host=document.querySelector(selector),positions=new Set(),values=new Set(),downstream=new Set();let frame=0;
    const scale=Math.min(w/240,h/130),pad=Math.min(20*scale,w*.15);
    // Keep sending moves while Worker drawing calls settle. Waiting for each value
    // before the next move would hide the stale-paint starvation this guards against.
    const tick=()=>{
      const value=20+(frame%60),point=new DOMPoint(pad+(w-pad*2)*value/100,h*.55).matrixTransform(host.firstElementChild.getScreenCTM());
      window.dispatchEvent(new PointerEvent('pointermove',{pointerId:window.__sliderPointerId,pointerType:'mouse',buttons:1,clientX:point.x,clientY:point.y,bubbles:true}));
      positions.add(host.querySelector('ellipse')?.getAttribute('cx'));
      values.add([...host.querySelectorAll('text')].map(text=>text.textContent).join('|'));
      downstream.add([...document.querySelector('[data-smart-index="1"]').querySelectorAll('text')].map(text=>text.textContent).join('|'));
      if(++frame<90)requestAnimationFrame(tick);else resolve({positions:[...positions],values:[...values],downstream:[...downstream]});
    };
    requestAnimationFrame(tick);
  }),{selector:hostSelector(index,tab),w,h});
}
for(const mode of ['html','preview'])test(`${mode}: a slower connected display keeps painting during continuous control movement`,async()=>app(async env=>{
  await env.run(`cancelGesture();const make=(key,uid,x,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,x,y:100,...extra});
    items=[make('numberControl','quantity',40,{w:240,h:130,state:{value:10}}),
      make('valueLabel','live-value',340,{bindings:{value:{uid:'quantity',port:'value'}}})];
    items[1].script=items[1].script.replace('children(state,style,w,h,editing,io){',
      'exportBehavior(){return {move:false};},handles(){return [];},children(state,style,w,h,editing,io){const deadline=performance.now()+80;while(performance.now()<deadline){}');
    selection=[];setTool('select');render();save();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);`);
  const reader=await openReader(env,mode),frame=reader.frame;
  await waitValue(frame,0,10);await waitValue(frame,1,10);
  try{
    await pressSlider(reader,0,10);
    const motion=await continuousMotion(reader,0);
    assert.ok(motion.positions.length>=4,'the control itself keeps moving');
    assert.ok(motion.downstream.length>=4,'the connected display paints while its values keep changing: '+JSON.stringify(motion));
    await moveSlider(reader,0,80);await reader.page.mouse.up();
    await waitValue(frame,0,80);await waitValue(frame,1,80);
  }finally{await reader.page.mouse.up();}
}));

for(const mode of ['html','preview'])test(`${mode}: an unrelated rapid clock cannot starve a slower refreshing display`,async()=>app(async env=>{
  const display=`({apiVersion:2,inputs:{},outputs:{},compute(){return {};},
    children(state,style,w,h){const until=performance.now()+80;while(performance.now()<until){}return [{type:'text',x:0,y:0,w,h,text:String(Date.now()),font:'20px sans-serif',color:'#000000'}];},refreshMs(){return 20;}})`;
  await env.run(`cancelGesture();const make=(key,uid,x,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,x,y:100,...extra});
    items=[make('valueLabel','refreshing-display',40,{w:240,h:130,script:${JSON.stringify(display)}}),
      make('pulseGenerator','unrelated-clock',340,{inputValues:{seconds:0.04,width:0.02,enable:true}})];
    selection=[];setTool('select');render();save();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);`);
  const reader=await openReader(env,mode),frame=reader.frame;
  await frame.waitForFunction(()=>window.__reader && !document.documentElement.classList.contains('sc-reader-starting'));
  const motion=await frame.evaluate(()=>new Promise(resolve=>{
    const host=document.querySelector('[data-smart-index="0"]'),values=new Set(),revisions=new Set(),staleReady=[];let frame=0;
    const tick=()=>{
      const revision=__reader('componentRevision');values.add(host.textContent);revisions.add(revision);
      if(host.dataset.smartReady==='true' && Number(host.dataset.smartGraphRevision)!==revision)staleReady.push(revision);
      if(++frame<90)requestAnimationFrame(tick);else resolve({values:[...values],revisions:[...revisions],staleReady});
    };requestAnimationFrame(tick);
  }));
  assert.ok(motion.revisions.length>=4,'the unrelated clock keeps advancing');
  assert.deepEqual(motion.staleReady,[],'a completed older paint must not claim to be ready for the latest graph');
  assert.ok(motion.values.length>=4,'the independent display keeps refreshing despite clock graph invalidations: '+JSON.stringify(motion));
  await reader.frame.evaluate(()=>__reader('timeline.pausedByUser=true;pauseComponentTimeline(timeline);clearTimeout(timelineTimer);timelineTimer=null;'));
  await frame.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').dataset.smartReady==='true');
}));

for(const mode of ['html','preview'])test(`${mode}: a counter's own changing temporal state keeps repainting under a rapid clock`,async()=>app(async env=>{
  await env.run(`cancelGesture();const make=(key,uid,x,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,x,y:100,...extra});
    items=[make('counter','slow-counter',40,{bindings:{value:{uid:'fast-clock',port:'value'}}}),
      make('pulseGenerator','fast-clock',440,{inputValues:{seconds:0.04,width:0.02,enable:true}})];
    items[0].script=items[0].script.replace('children(state,style,w,h,editing,io={}){',
      'children(state,style,w,h,editing,io={}){const deadline=performance.now()+80;while(performance.now()<deadline){}');
    selection=[];setTool('select');render();save();resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);`);
  const reader=await openReader(env,mode),frame=reader.frame;
  await frame.waitForFunction(()=>window.__reader && !document.documentElement.classList.contains('sc-reader-starting'));
  const motion=await frame.evaluate(()=>new Promise(resolve=>{
    const host=document.querySelector('[data-smart-index="0"]'),values=new Set(),states=new Set();let frame=0;
    const tick=()=>{
      values.add(host.textContent);states.add(__reader('items.find(item=>item.uid==="slow-counter").state.count'));
      if(++frame<90)requestAnimationFrame(tick);else resolve({values:[...values],states:[...states]});
    };requestAnimationFrame(tick);
  }));
  assert.ok(motion.states.length>=4,'the counter itself keeps counting');
  assert.ok(motion.values.length>=4,'the counter paints changing values while its state advances: '+JSON.stringify(motion));
}));
