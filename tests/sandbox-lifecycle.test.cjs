const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});
async function app(fn){
  const context=await browser.newContext();
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://sandbox-lifecycle.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://sandbox-lifecycle.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}

for(const [name,schedule] of [
  ['timer','setTimeout(()=>{while(true){}},0)'],
  ['microtask','queueMicrotask(()=>{while(true){}})'],
  ['intrinsic async continuation','(async()=>{await 0;while(true){}})()']
])test(`a valid hook reply cannot leave an unbounded ${name} running`,async()=>app(async({page,run})=>{
  const script=`({children(){${schedule};return [];}})`;
  assert.deepEqual(await run(`requestSmartCall({script:${JSON.stringify(script)}},'children',[])`),[],'the hook has already returned a valid reply');
  await page.waitForTimeout(700);
  assert.equal(await run('smartRuntimeStats.resident'),0,'the trusted bridge retires background execution without another request');
  assert.equal(await run('smartRuntimeStats.retired'),1);
  assert.deepEqual(await run(`requestSmartCall({script:'({children(){return [];},initState(){return {healthy:true};}})'},'initState',[])`),{healthy:true},'unrelated work remains available');
}));

test('resident execution expires even if its delayed callback has not fired',async()=>app(async({page,run})=>{
  assert.deepEqual(await run(`requestSmartCall({script:'({children(){setTimeout(()=>{while(true){}},2000);return [];}})'},'children',[])`),[]);
  await page.waitForTimeout(700);
  assert.equal(await run('smartRuntimeStats.resident'),0,'a future callback cannot outlive its realm lease');
}));

test('short hook bursts reuse a realm while repeated replies cannot renew its execution lease',async()=>app(async({run})=>{
  const result=await run(`(async()=>{
    const subject={script:'({children(){return [];},initState(s){self.calls=(self.calls||0)+1;return {count:s.count+1,local:self.calls};}})'};
    const states=[];let state={count:0};
    for(let index=0;index<9;index++){
      state=await requestSmartCall(subject,'initState',[state]);states.push(state);
      if(index>0)await new Promise(resolve=>setTimeout(resolve,75));
    }
    return {states,stats:{...smartRuntimeStats}};
  })()`);
  assert.deepEqual(result.states.map(state=>state.count),[1,2,3,4,5,6,7,8,9],'app-owned state survives realm retirement');
  assert.deepEqual(result.states.slice(0,2).map(state=>state.local),[1,2],'adjacent synchronous hooks keep their compile cache');
  assert.ok(result.stats.created>1,'successful subsequent hooks do not renew the original lease');
}));

test('an active valid hook can complete at lease expiry before its realm retires',async()=>app(async({page,run})=>{
  const result=await run(`(async()=>{
    const subject={script:'({children(){return [];},initState(){const until=performance.now()+180;while(performance.now()<until){}return {complete:true};}})'};
    await requestSmartCall(subject,'children',[]);
    await new Promise(resolve=>setTimeout(resolve,160));
    return await requestSmartCall(subject,'initState',[]);
  })()`);
  assert.deepEqual(result,{complete:true});
  await page.waitForTimeout(50);
  assert.equal(await run('smartRuntimeStats.resident'),0,'the finished hook does not grant another lease');
}));


test('the standalone file export also retires post-reply async execution',async()=>app(async({page,run,context})=>{
  const script='({children(){(async()=>{await 0;while(true){}})();return [{type:"text",text:"Valid drawing",x:0,y:0,w:180,h:40}];}})';
  await run(`cancelGesture();items=[{type:'smart',uid:'background',x:20,y:20,w:180,h:40,size:2,color:'#000000',state:{},script:${JSON.stringify(script)}}];render();save();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.has('background')"));
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-sandbox-lifecycle-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const exported=fs.readFileSync(await(await download).path(),'utf8');
  const instrumented=exported.replace('void activate(initial);','window.__sandboxStats=()=>({...smartRuntimeStats});void activate(initial);');
  assert.notEqual(instrumented,exported,'instrument only the generated runtime for observing resident workers');
  const file=path.join(directory,'background.html');fs.writeFileSync(file,instrumented);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-ready="true"]'));
  assert.match(await reader.locator('[data-smart-ready="true"]').textContent(),/Valid drawing/);
  await reader.waitForTimeout(700);
  assert.deepEqual(await reader.evaluate(()=>__sandboxStats()),{resident:0,peak:1,created:1,retired:1});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
