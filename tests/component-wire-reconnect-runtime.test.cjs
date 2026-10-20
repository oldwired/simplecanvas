const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');

// Exercise the public pins with real pointer/keyboard events; the closure bridge only seeds
// scenes and observes transactions. Reconnecting must never expose a half-detached document.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>browser?.close());
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1050}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://wire-reconnect.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://wire-reconnect.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
const drawing=`children(state,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#fff',strokeOn:true,color:'#334155',size:1}];}`;
const numberSource=`({apiVersion:2,outputs:{value:{type:'number'}},compute(){return {value:7};},${drawing}})`;
const numberTarget=`({apiVersion:2,inputs:{a:{type:'number',default:0},b:{type:'number',default:0},flag:{type:'boolean',default:false}},
  outputs:{value:{type:'number'}},compute(inputs){return {value:inputs.a+inputs.b};},${drawing}})`;
function item(uid,script,patch={}){
  return {type:'smart',componentApi:2,uid,componentName:uid,script,state:{},x:100,y:140,w:240,h:180,
    color:'#334155',textColor:'#334155',fillColor:'#fff',fill:true,strokeOn:true,size:1,fontFamily:'sans',fontSize:16,...patch};
}
const binding=(uid='source',port='value')=>({uid,port});
const port=(page,uid,name,direction='in')=>page.locator(`#componentWiringOverlay [data-wire-port][data-uid="${uid}"][data-port="${name}"][data-direction="${direction}"]`);
const edge=(page,uid,name)=>page.locator(`#componentWiringOverlay [data-wire-edge][data-target-uid="${uid}"][data-input="${name}"]`);
async function point(locator){
  for(let attempt=0;attempt<10;attempt++){
    await locator.waitFor({state:'visible'});
    const value=await locator.evaluate(el=>{
      if(!el.isConnected)return null;
      const r=(el.querySelector('circle')||el).getBoundingClientRect();
      return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;
    });
    if(value)return value;
  }
  assert.fail('wire pin did not retain a rendered hit target');
}
async function seed(run,list,pool={}){
  await run(`setComponentWiringMode(false);cancelGesture();datasets=normalizeDatasets(${JSON.stringify(pool)});items=${JSON.stringify(list)};
    selection=[];editingSmartIdx=null;undoStack=[];redoStack=[];historyBefore=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
  await run('setComponentWiringMode(true);renderComponentWiring()');
}
async function settle(run){
  await run('smartGestureQueue');await run('ensureEditorComponentGraph()');await run('renderComponentWiring()');
}
const snapshot=run=>run('({items:JSON.stringify(items),undo:undoStack.length,redo:redoStack.length})');
async function startDrag(page,from,to={x:580,y:520}){
  const p=await point(from);await page.mouse.move(p.x,p.y);await page.mouse.down();
  await page.mouse.move(to.x,to.y,{steps:6});
}
async function drag(page,from,to){
  const end=await point(to);await startDrag(page,from,end);await page.mouse.up();
}
function numbers(){
  return [item('source',numberSource),item('other',numberSource,{y:500}),
    item('target',numberTarget,{x:750,bindings:{a:binding(),b:binding('other')}}),
    item('fanout',numberTarget,{x:750,y:500,bindings:{a:binding()}})];
}

test('moving a connected input to another input on the same component replaces it atomically and preserves fanout',async()=>app(async({page,run})=>{
  await seed(run,numbers());const before=await snapshot(run);
  await edge(page,'target','a').waitFor({state:'visible'});
  const end=await point(port(page,'target','b'));await startDrag(page,port(page,'target','a'),end);
  assert.deepEqual(await snapshot(run),before,'the live document retains both old connections during the preview');
  assert.equal(await edge(page,'target','a').count(),0,'the moved connection is hidden while its loose end is dragged');
  assert.equal(await edge(page,'fanout','a').count(),1,'other consumers stay connected');
  await page.mouse.up();await settle(run);
  assert.deepEqual(await run('items[2].bindings'),{b:binding()});
  assert.deepEqual(await run('items[3].bindings'),{a:binding()});
  assert.equal(await run('undoStack.length'),1,'detach and replacement are one Undo');
  await run('undo()');await settle(run);assert.equal((await snapshot(run)).items,before.items);
  await run('redo()');await settle(run);assert.deepEqual(await run('items[2].bindings'),{b:binding()});
}));

test('Escape, outside or incompatible drops, pointer cancellation, and the original endpoint preserve the connection',async()=>app(async({page,run})=>{
  for(const mode of ['escape','outside','incompatible','pointercancel','same']){
    await seed(run,numbers());const before=await snapshot(run);
    if(mode==='same'){
      const p=await point(port(page,'target','a'));await page.mouse.click(p.x,p.y);
    }else{
      const end=mode==='incompatible'?await point(port(page,'target','flag')):{x:580,y:520};
      await startDrag(page,port(page,'target','a'),end);
      if(mode==='escape')await page.keyboard.press('Escape');
      if(mode==='pointercancel')await page.locator('#componentWiringOverlay').dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',bubbles:true});
      await page.mouse.up();
    }
    await run('smartGestureQueue');
    await edge(page,'target','a').waitFor({state:'visible'});
    await settle(run);
    assert.deepEqual(await snapshot(run),before,mode+' leaves no partial detach or history entry');
    assert.equal(await run('componentWiring.drag'),null);
    assert.equal(await run('componentWiring.enabled'),true);
    await edge(page,'target','a').waitFor({state:'visible'});
  }
}));

test('keyboard reconnect moves a hybrid flow while keeping each input event-delivery preference',async()=>app(async({page,run})=>{
  const source=`({apiVersion:2,eventApi:1,outputs:{value:{type:'string',event:true}},compute(){return {value:'hello'};},${drawing}})`;
  const receiver=`({apiVersion:2,eventApi:1,inputs:{a:{type:'string',default:'',event:true},b:{type:'string',default:'',event:true}},
    outputs:{},compute(){return {};},onEvent(name,payload,state){return {state};},${drawing}})`;
  await seed(run,[item('source',source),item('target',receiver,{x:750,bindings:{a:binding()},eventModes:{b:'value'}})]);
  await port(page,'target','a').focus();await page.keyboard.press('Enter');
  assert.deepEqual(await run('items[1].bindings'),{a:binding()},'keyboard preview leaves the document intact');
  await port(page,'target','b').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>__test.run('items[1].bindings?.b?.uid')==='source');await settle(run);
  assert.deepEqual(await run('items[1].bindings'),{b:binding()});
  assert.deepEqual(await run('items[1].eventModes'),{b:'value'});
  assert.equal(await edge(page,'target','b').getAttribute('data-events'),'false');
  assert.equal(await run('undoStack.length'),1);
}));

test('event-only commands reconnect through hybrid pins without creating a value binding',async()=>app(async({page,run})=>{
  const source=`({apiVersion:2,eventApi:1,outputs:{},eventOutputs:{clicked:{type:'none'}},compute(){return {};},${drawing}})`;
  const receiver=`({apiVersion:2,eventApi:1,inputs:{a:{type:'boolean',default:false,event:'command',role:'control'},b:{type:'boolean',default:false,event:'command',role:'control'}},
    outputs:{},compute(){return {};},onEvent(name,payload,state){return {state};},${drawing}})`;
  await seed(run,[item('source',source),item('target',receiver,{x:750,eventBindings:{a:binding('source','clicked')}})]);
  await drag(page,port(page,'target','a'),port(page,'target','b'));await settle(run);
  assert.deepEqual(await run('items[1].eventBindings'),{b:binding('source','clicked')});
  assert.deepEqual(await run('items[1].bindings||{}'),{});
  assert.equal(await edge(page,'target','b').getAttribute('data-kind'),'event');
  assert.equal(await edge(page,'target','b').getAttribute('data-type'),'none');
  assert.equal(await run('undoStack.length'),1);
  await run('undo()');await settle(run);
  assert.deepEqual(await run('items[1].eventBindings'),{a:binding('source','clicked')});
}));

test('stored dataset associations keep their row selection when moved, including synthetic owner anchors',async()=>app(async({page,run})=>{
  const pool={records:{name:'Records',columns:[{key:'value',name:'Value',type:'number'}],rows:[[10],[20],[30]]}};
  const receiver=`({apiVersion:2,inputs:{a:{type:'table',optional:true},b:{type:'table',optional:true}},outputs:{},compute(){return {};},${drawing}})`;
  const reference={datasetId:'records',rows:[2,0]};
  for(const publishes of [true,false]){
    const owner=`({apiVersion:2,datasetOwner:'data',inputs:{data:{type:'table'}},outputs:${publishes?"{data:{type:'table'}}":"{}"},
      compute(inputs){return ${publishes?'{data:inputs.data}':'{}'};},${drawing}})`;
    await seed(run,[item('owner',owner,{datasetOwner:'data',inputValues:{data:{datasetId:'records'}}}),
      item('target',receiver,{x:750,inputValues:{a:reference}})],pool);
    const before=await snapshot(run);
    assert.equal(await edge(page,'target','a').getAttribute('data-kind'),'dataset');
    if(!publishes)assert.equal(await port(page,'owner','data','dataset').count(),1,'owner without a table publication has a storage anchor');
    await drag(page,port(page,'target','a'),port(page,'target','b'));await settle(run);
    assert.deepEqual(await run('items[1].inputValues'),{b:reference});
    assert.deepEqual(await run('items[1].bindings||{}'),{},'a stored association stays a literal reference');
    assert.equal(await run('undoStack.length'),1);
    assert.equal(await edge(page,'target','b').getAttribute('data-kind'),'dataset');
    await run('undo()');await settle(run);assert.equal((await snapshot(run)).items,before.items);
  }
}));

test('changing the original binding during asynchronous validation prevents a stale reconnect from committing',async()=>app(async({page,run})=>{
  await seed(run,[item('source',numberSource),item('other',numberSource,{y:500}),
    item('old',numberTarget,{x:750,bindings:{a:binding()}}),item('new',numberTarget,{x:750,y:500})]);
  await run(`(()=>{const original=requestSmartCaps;requestSmartCaps=async(...args)=>{
    const result=await original(...args);
    if(componentWiring.pending && args[0]?.uid==='new' && !window.__wireCapsHeld){
      window.__wireCapsHeld=true;await new Promise(resolve=>{window.__releaseWireCaps=resolve;});
    }
    return result;
  };})()`);
  await drag(page,port(page,'old','a'),port(page,'new','b'));
  await page.waitForFunction(()=>typeof window.__releaseWireCaps==='function');
  await run("items[2].bindings.a={uid:'other',port:'value'};editorComponentEvaluation=null;render()");
  const changed=await snapshot(run);
  await page.evaluate(()=>window.__releaseWireCaps());await settle(run);
  assert.deepEqual(await snapshot(run),changed,'neither endpoint is overwritten by the stale operation');
  assert.deepEqual(await run('items[2].bindings'),{a:binding('other')});
  assert.deepEqual(await run('items[3].bindings||{}'),{});
  assert.equal(await run('componentWiring.pending'),false);
}));
