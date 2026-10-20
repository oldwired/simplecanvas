const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const workspace=JSON.parse(fs.readFileSync(path.join(root,'examples','smart-components-workspace.json'),'utf8'));
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{if(browser)await browser.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://feedback-workspace.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://feedback-workspace.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function fixture(run,number,body){
  const list=workspace.tabs[number-1].items.filter(item=>item.componentApi===2);
  return run(`(async()=>{
    const list=${JSON.stringify(list)},prefix='demo-${number}-';
    const item=id=>list.find(it=>it.uid===prefix+id),owners=new Map(list.map(it=>[it,createSmartExecution(it)]));
    let clock=0,graph;const timeline=createComponentTimeline(()=>clock);resumeComponentTimeline(timeline);
    const call=(it,hook,args)=>hook==='caps'?requestSmartCaps(it,owners.get(it)):requestSmartCall(it,hook,args,owners.get(it));
    const settle=async()=>{graph=await settleComponentTimeline(list,call,()=>true,timeline);const errors=[...graph.values()].filter(record=>record.error).map(record=>record.error);if(errors.length)throw new Error(errors.join('; '));};
    const output=id=>graph.get(item(id)).io.outputs;
    const tick=async(ms=1000)=>{clock+=ms;await settle();};
    const press=async id=>{item(id).state.press++;await settle();await tick(101);await tick(11);};
    try{await settle();${body}}finally{for(const owner of owners.values())disposeSmartExecution(owner);}
  })()`);
}

test('shipped feedback countdowns self-reset, stop at zero, and reset while a latch remembers stop',async()=>app(async({run})=>{
  const repeating=await fixture(run,9,`
    item('run').state.value=true;await settle();const counts=[];
    for(let cycle=0;cycle<6;cycle++){await tick(1000);counts.push(output('countdown').count);await tick(101);}
    item('run').state.value=false;await settle();
    return {counts,cycles:output('cycles').count,clock:output('clock').value,trace:timeline.trace.flatMap(round=>round.changes).filter(change=>change.uid===prefix+'countdown').map(change=>change.outputs)};
  `);
  assert.deepEqual(repeating.counts,[2,1,3,2,1,3]);assert.equal(repeating.cycles,2);assert.equal(repeating.clock,false);
  assert.ok(repeating.trace.some(output=>output.count===0&&output.reached===true),'brief zero/completion is observable');
  const stopping=await fixture(run,10,`
    for(let n=0;n<3;n++){await tick(1000);await tick(101);}
    const stopped={count:output('countdown').count,enabled:output('keep-going').value,clock:output('clock').value};
    await tick(10000);const held=output('countdown').count;await press('reset');return {stopped,held,restarted:output('countdown').count,enabled:output('keep-going').value};
  `);
  assert.deepEqual(stopping,{stopped:{count:0,enabled:false,clock:false},held:0,restarted:3,enabled:true});
  const latched=await fixture(run,11,`
    const initial=output('stop').q;await press('restart');const running=output('stop').q;
    for(let n=0;n<3;n++){await tick(1000);await tick(101);}
    const result={count:output('countdown').count,stopped:output('stop').q,clock:output('clock').value};await tick(10000);return {initial,running,result,held:output('countdown').count};
  `);
  assert.deepEqual(latched,{initial:true,running:false,result:{count:3,stopped:true,clock:false},held:3});
}));

test('the shipped latch laboratory initializes X and retains set/reset in dedicated, NOR and NAND forms',async()=>app(async({run})=>{
  const result=await fixture(run,12,`
    const read=()=>[output('sr').q,output('nor-q').value,output('nand-q').value];
    const snapshots=[read()];item('set').state.value=true;await settle();snapshots.push(read());
    item('set').state.value=false;await settle();snapshots.push(read());
    item('reset').state.value=true;await settle();snapshots.push(read());
    item('reset').state.value=false;await settle();snapshots.push(read());return snapshots;
  `);
  assert.deepEqual(result,[['X','X','X'],[true,true,true],[true,true,true],[false,false,false],[false,false,false]]);
}));

test('shipped shared-edge storage and feedback sequences sample the previous snapshot',async()=>app(async({run})=>{
  const sampled=await fixture(run,13,`
    item('data').state.value=true;item('number').state.value=27;await settle();const read=()=>[output('first').q,output('second').q,output('register').value];
    const snapshots=[read()];await press('clock');snapshots.push(read());await press('clock');snapshots.push(read());await press('reset');snapshots.push(read());return snapshots;
  `);
  assert.deepEqual(sampled,[[false,false,0],[true,false,27],[true,true,27],[false,false,0]]);
  const sequences=await fixture(run,14,`
    const snapshots=[];for(let n=0;n<10;n++){await press('clock');snapshots.push({ring:[output('ring').q0,output('ring').q1,output('ring').q2,output('ring').q3],johnson:item('johnson').state.cells,position:output('decade').position});}return snapshots;
  `);
  assert.deepEqual(sequences[0],{ring:[false,true,false,false],johnson:[true,false,false,false],position:1});
  assert.deepEqual(sequences[3],{ring:[true,false,false,false],johnson:[true,true,true,true],position:4});
  assert.deepEqual(sequences[7],{ring:[true,false,false,false],johnson:[false,false,false,false],position:8});
  assert.equal(sequences[9].position,0);
}));

test('shipped positive-delay feedback alternates only when active document time advances',async()=>app(async({run})=>{
  const result=await fixture(run,15,`
    const values=[output('delay').value];await tick(999);values.push(output('delay').value);await tick(1);values.push(output('delay').value);
    pauseComponentTimeline(timeline);clock+=5000;await settle();values.push(output('delay').value);resumeComponentTimeline(timeline);
    await tick(1000);values.push(output('delay').value);await tick(1000);values.push(output('delay').value);return values;
  `);
  assert.deepEqual(result,[false,false,true,true,false,true]);
}));

function host(page,tab,id){const name=workspace.tabs[tab-1].items.find(it=>it.uid===`demo-${tab}-${id}`).componentName;return page.locator('.tab-panel').nth(tab-1).locator('[data-smart-index]').filter({has:page.locator('text').filter({hasText:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})});}
async function readerTab(page,tab){await page.locator('.tab-select').nth(tab-1).click();const panel=page.locator('.tab-panel').nth(tab-1);await panel.waitFor({state:'visible'});await page.waitForFunction(panel=>[...panel.querySelectorAll('[data-smart-index]')].every(it=>it.dataset.smartReady==='true'),await panel.elementHandle());}
async function click(page,tab,id,kind){const item=workspace.tabs[tab-1].items.find(it=>it.uid===`demo-${tab}-${id}`),point=kind==='trigger'?{x:item.w*.38,y:item.h*.49}:{x:item.w*.5,y:item.h*.69};const position=await host(page,tab,id).evaluate((host,point)=>{const at=new DOMPoint(point.x,point.y).matrixTransform(host.firstElementChild.getScreenCTM());return{x:at.x,y:at.y};},point);await page.mouse.click(position.x,position.y);}
async function hasText(page,tab,id,value){await page.waitForFunction(({element,value})=>[...element.querySelectorAll('text')].some(it=>it.textContent===value),{element:await host(page,tab,id).elementHandle(),value});}

test('the shipped feedback HTML operates latches, shared clocks, and delayed feedback offline',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  try{
    await page.goto(pathToFileURL(path.join(root,'examples','smart-components-workspace.html')).href);
    await readerTab(page,12);await hasText(page,12,'sr','Q: X');await click(page,12,'set','toggle');await hasText(page,12,'sr','Q: 1');await click(page,12,'set','toggle');await hasText(page,12,'sr','Q: 1');
    await readerTab(page,13);await click(page,13,'data','toggle');await click(page,13,'clock','trigger');await hasText(page,13,'first','Q: 1');await hasText(page,13,'second','Q: 0');
    await page.waitForTimeout(150);await click(page,13,'clock','trigger');await hasText(page,13,'second','Q: 1');
    await readerTab(page,15);await hasText(page,15,'output','ON');await hasText(page,15,'output','OFF');
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  }finally{await context.close();}
});
