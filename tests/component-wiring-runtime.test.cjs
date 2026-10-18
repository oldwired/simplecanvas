const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');

// The served fixture exposes its closure only for seeding and verification. Wiring uses
// real pointer events against the same SVG ports and links the editor presents to users.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});

async function app(fn,settings=null){
  const context=await browser.newContext({viewport:{width:1500,height:1050}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://component-wiring.test/**',route=>{
      const url=route.request().url();
      return route.fulfill(url.endsWith('index.html')?{status:200,contentType:'text/html',body:html}:
        url.endsWith('settings.json')&&settings?{status:200,contentType:'application/json',body:JSON.stringify(settings)}:{status:404,body:''});
    });
    await page.goto('http://component-wiring.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}

const sourceScript=`({apiVersion:2,outputs:{number:{type:'number'},flag:{type:'boolean'},text:{type:'string'}},
  compute(inputs,state){return {number:state.value??7,flag:true,text:'seven'};},
  children(state,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#334155',size:1}];}})`;
const targetScript=`({apiVersion:2,inputs:{number:{type:'number',default:0},flag:{type:'boolean',default:false},text:{type:'string',default:''}},
  outputs:{number:{type:'number'},flag:{type:'boolean'},text:{type:'string'}},
  compute(inputs){return inputs;},children(state,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#334155',size:1}];}})`;
function component(uid,script,patch={}){return {type:'smart',uid,componentName:uid,componentApi:2,script,state:{},x:100,y:130,w:240,h:200,
  color:'#334155',textColor:'#334155',strokeOn:true,size:1,fill:true,fillColor:'#ffffff',fontFamily:'sans',fontSize:16,...patch};}
const source=patch=>component('source',sourceScript,patch);
const target=patch=>component('target',targetScript,{x:700,...patch});
async function seed(run,list,pool={}){
  await run(`setComponentWiringMode(false);cancelGesture();datasets=normalizeDatasets(${JSON.stringify(pool)});items=${JSON.stringify(list)};
    selection=[];editingSmartIdx=null;undoStack=[];redoStack=[];historyBefore=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
const port=(page,uid,name,direction)=>page.locator(`#componentWiringOverlay [data-wire-port][data-uid="${uid}"][data-port="${name}"][data-direction="${direction}"]`);
const edge=(page,uid,input)=>page.locator(`#componentWiringOverlay [data-wire-edge][data-target-uid="${uid}"][data-input="${input}"]`);
async function point(locator){
  // Graph settlement redraws the SVG. WebKit can detach a resolved locator between
  // its visibility check and evaluate; never use a detached node's zero rectangle.
  for(let attempt=0;attempt<10;attempt++){
    await locator.waitFor({state:'visible'});
    const p=await locator.evaluate(el=>{if(!el.isConnected)return null;const shape=el.matches('circle')?el:el.querySelector('circle')||el,r=shape.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;});
    if(p)return p;
  }
  assert.fail('port did not retain a rendered hit target');
}
async function selectEdge(page,locator){
  await locator.waitFor({state:'visible'});
  const p=await locator.evaluate(el=>{
    const path=el.matches('path')?el:el.querySelector('path'),local=path.getPointAtLength(path.getTotalLength()/2),p=new DOMPoint(local.x,local.y).matrixTransform(path.getScreenCTM());
    return {x:p.x,y:p.y};
  });
  await page.mouse.click(p.x,p.y);
}
async function wiring(page,run){
  await page.locator('#componentWiringBtn').click();
  await page.waitForFunction(()=>__test.run('componentWiring.enabled'));
  await run('ensureEditorComponentGraph()');await run('renderComponentWiring()');
  await page.locator('#componentWiringOverlay [data-wire-port]').first().waitFor({state:'visible'});
}
async function dragPorts(page,a,b){
  const from=await point(a),to=await point(b);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
}
async function bound(page,uid,input,expected){
  try{await page.waitForFunction(({uid,input,expected})=>JSON.stringify(__test.run(`items.find(it=>it.uid===${JSON.stringify(uid)})?.bindings?.[${JSON.stringify(input)}]`)??null)===JSON.stringify(expected??null),{uid,input,expected});}
  catch(error){error.message+='\nWiring state: '+JSON.stringify(await page.evaluate(()=>__test.run('({pending:componentWiring.pending,drag:componentWiring.drag,message:componentWiring.message,items:items.map(it=>({uid:it.uid,bindings:it.bindings}))})')));throw error;}
}
const snapshot=run=>run('({items:JSON.stringify(items),undo:undoStack.length,redo:redoStack.length})');
async function settleUi(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function startDrag(page,from,to={x:500,y:500}){const p=await point(from);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:4});}

test('visual wiring connects from outputs or inputs, rejects incompatible and same-direction ports, and exposes signal type and direction',async()=>app(async({page,run})=>{
  await seed(run,[source(),target()]);await wiring(page,run);
  await dragPorts(page,port(page,'source','number','out'),port(page,'target','number','in'));
  await bound(page,'target','number',{uid:'source',port:'number'});
  assert.equal(await edge(page,'target','number').getAttribute('data-kind'),'flow');
  assert.equal(await edge(page,'target','number').getAttribute('data-type'),'number');
  await dragPorts(page,port(page,'target','flag','in'),port(page,'source','flag','out'));
  await bound(page,'target','flag',{uid:'source',port:'flag'});
  await dragPorts(page,port(page,'source','text','out'),port(page,'target','text','in'));
  await bound(page,'target','text',{uid:'source',port:'text'});
  assert.equal(await edge(page,'target','text').getAttribute('data-type'),'string');
  const before=await snapshot(run);
  await dragPorts(page,port(page,'source','flag','out'),port(page,'target','number','in'));await settleUi(page);
  assert.deepEqual(await snapshot(run),before,'type mismatch cannot change bindings or create history');
  await dragPorts(page,port(page,'source','number','out'),port(page,'target','number','out'));await settleUi(page);
  assert.deepEqual(await snapshot(run),before,'two outputs cannot connect');
  assert.equal(await run('editingSmartIdx'),null,'wiring never enters component control editing');
}));

test('replacing and deleting a wire are atomic undoable operations and preserve unrelated literal values',async()=>app(async({page,run})=>{
  await seed(run,[source(),component('replacement',sourceScript,{x:100,y:480,state:{value:9}}),target({inputValues:{number:3.25,text:'retained'}})]);
  await wiring(page,run);
  await dragPorts(page,port(page,'source','number','out'),port(page,'target','number','in'));
  await bound(page,'target','number',{uid:'source',port:'number'});assert.equal(await run('undoStack.length'),1);
  await dragPorts(page,port(page,'replacement','number','out'),port(page,'target','number','in'));
  await bound(page,'target','number',{uid:'replacement',port:'number'});assert.equal(await run('undoStack.length'),2);
  await run('undo()');await bound(page,'target','number',{uid:'source',port:'number'});
  await run('redo()');await bound(page,'target','number',{uid:'replacement',port:'number'});
  await selectEdge(page,edge(page,'target','number'));await page.keyboard.press('Delete');
  await bound(page,'target','number',null);assert.equal(await run('undoStack.length'),3);
  assert.equal(await run('items.find(it=>it.uid==="target").inputValues.number'),undefined);
  assert.equal(await run('items.find(it=>it.uid==="target").inputValues.text'),'retained');
  assert.equal(await run('items.length'),3,'Delete disconnects without deleting a component');
  await run('undo()');await bound(page,'target','number',{uid:'replacement',port:'number'});
  await run('redo()');await bound(page,'target','number',null);
  assert.equal(await run('(async()=> (await ensureEditorComponentGraph()).get(items[2]).io.outputs.number)()'),0);
}));

test('ports follow own and grouped rotations and remain draggable in their displayed positions',async()=>app(async({page,run})=>{
  const rotation=Math.PI/7,groupRotation=Math.PI/5;
  await seed(run,[source({rotation,group:'rotated',groupRotation}),
    {type:'rect',uid:'frame',group:'rotated',groupRotation,x:180,y:400,w:120,h:60,color:'#888888',size:1,strokeOn:true},target({x:850,y:320,rotation:-Math.PI/8})]);
  await wiring(page,run);
  const before=await point(port(page,'source','number','out'));
  await dragPorts(page,port(page,'source','number','out'),port(page,'target','number','in'));
  await bound(page,'target','number',{uid:'source',port:'number'});
  const original=await run('items.map(it=>({uid:it.uid,x:it.x,y:it.y,rotation:it.rotation,groupRotation:it.groupRotation}))');
  await run('items[0].x+=40;items[1].x+=40;render()');
  const moved=await point(port(page,'source','number','out'));
  assert.ok(Math.abs(moved.x-before.x-40)<.5,'port follows translation of the rotated group: '+JSON.stringify({before,moved}));
  assert.ok(Math.abs(moved.y-before.y)<.5,'group translation does not change the port height');
  assert.equal(await run('items[0].rotation'),original[0].rotation,'wiring does not bake the group rotation');
  assert.equal(await run('items[0].groupRotation'),original[0].groupRotation);
}));

test('data uses left/right banks, control uses top/bottom, and explicit sides share a bank without overlapping',async()=>app(async({page,run})=>{
  const script=`({apiVersion:2,
    inputs:{value:{type:'number',default:0},flag:{type:'boolean',default:false},run:{type:'boolean',role:'control',default:false},
      column:{type:'boolean',side:'top',default:false},sideOverride:{type:'boolean',role:'control',side:'right',default:false}},
    outputs:{value:{type:'number'},tick:{type:'boolean',role:'control'},text:{type:'string',side:'top'}},
    compute(){return {value:0,tick:true,text:'ready'};},children(){return [];}})`;
  await seed(run,[component('four-sides',script,{x:450,y:350,w:320,h:220})]);await wiring(page,run);
  const data=await run(`({item:items[0],ports:componentWiring.model.ports.map(port=>({name:port.name,direction:port.direction,role:port.role,side:port.side,...componentWirePoint(port)}))})`);
  const expected={'in:value':'left','in:flag':'left','in:run':'top','in:column':'top','in:sideOverride':'right','out:value':'right','out:tick':'bottom','out:text':'top'};
  const normals={left:[-1,0],right:[1,0],top:[0,-1],bottom:[0,1]},box=data.item;
  for(const p of data.ports){
    const side=expected[p.direction+':'+p.name];assert.equal(p.side,side,p.name+' side');
    assert.ok(Math.abs(p.nx-normals[side][0])<1e-8&&Math.abs(p.ny-normals[side][1])<1e-8,p.name+' outward normal');
    if(side==='left'||side==='right')assert.ok(side==='left'?p.x<box.x:p.x>box.x+box.w,p.name+' is outside the horizontal edge');
    else assert.ok(side==='top'?p.y<box.y:p.y>box.y+box.h,p.name+' is outside the vertical edge');
    await port(page,'four-sides',p.name,p.direction).waitFor({state:'visible'});
  }
  for(const side of Object.keys(normals)){
    const bank=data.ports.filter(p=>p.side===side);
    for(let a=0;a<bank.length;a++)for(let b=a+1;b<bank.length;b++)assert.ok(Math.hypot(bank[a].x-bank[b].x,bank[a].y-bank[b].y)>=20,'mixed input/output '+side+' bank has separate hit targets');
  }
  assert.equal(data.ports.find(p=>p.name==='flag').role,'data','Boolean values are data unless explicitly declared as controls');
  assert.equal(data.ports.find(p=>p.name==='column').role,'data','a top-side data override remains data');
}));

test('rotated top and bottom controls connect from either end and Boolean data can drive a control',async()=>app(async({page,run})=>{
  const script=`({apiVersion:2,inputs:{reset:{type:'boolean',role:'control',default:false}},outputs:{tick:{type:'boolean',role:'control'}},compute(){return {tick:false};},children(){return [];}})`;
  const rotation=Math.PI/3,groupRotation=Math.PI/8,targetRotation=-Math.PI/5;
  await seed(run,[component('source',script,{x:300,y:250,w:180,h:140,rotation,group:'controls',groupRotation}),
    {type:'rect',uid:'frame',group:'controls',groupRotation,x:330,y:450,w:100,h:60,color:'#888888',size:1,strokeOn:true},
    component('target',script,{x:850,y:430,w:180,h:140,rotation:targetRotation}),component('data',sourceScript,{x:850,y:120,w:180,h:140})]);
  await wiring(page,run);
  for(const [uid,angle] of [['source',rotation+groupRotation],['target',targetRotation]]){
    const points=await run(`componentWiring.model.ports.filter(port=>port.uid===${JSON.stringify(uid)}).map(port=>({name:port.name,direction:port.direction,...componentWirePoint(port)}))`);
    for(const p of points){
      const sign=p.direction==='in'?-1:1;
      assert.ok(Math.abs(p.nx+Math.sin(angle)*sign)<1e-8&&Math.abs(p.ny-Math.cos(angle)*sign)<1e-8,uid+' '+p.name+' normal follows component/group rotation');
    }
  }
  await dragPorts(page,port(page,'source','tick','out'),port(page,'target','reset','in'));
  await bound(page,'target','reset',{uid:'source',port:'tick'});
  await dragPorts(page,port(page,'source','reset','in'),port(page,'target','tick','out'));
  await bound(page,'source','reset',{uid:'target',port:'tick'});
  await dragPorts(page,port(page,'data','flag','out'),port(page,'target','reset','in'));
  await bound(page,'target','reset',{uid:'data',port:'flag'});
  assert.equal(await edge(page,'target','reset').getAttribute('data-type'),'boolean','role changes do not add a new signal type');
}));

test('bottom-to-top self-feedback routes outside the component, including its own and group rotations',async()=>app(async({page,run})=>{
  const script=`({apiVersion:2,inputs:{reset:{type:'boolean',role:'control',default:false}},outputs:{tick:{type:'boolean',role:'control'}},compute(){return {tick:false};},children(){return [];}})`;
  for(const transformed of [false,true]){
    const rotation=transformed?Math.PI/4:0,groupRotation=transformed?Math.PI/7:0;
    await seed(run,[component('self',script,{x:500,y:350,w:240,h:180,rotation,group:'loop',groupRotation}),
      {type:'rect',uid:'frame',group:'loop',groupRotation,x:780,y:390,w:60,h:40,color:'#888888',size:1,strokeOn:true}]);
    await wiring(page,run);
    await dragPorts(page,port(page,'self','tick','out'),port(page,'self','reset','in'));
    await bound(page,'self','reset',{uid:'self',port:'tick'});
    const samples=await edge(page,'self','reset').locator('path').first().evaluate(path=>{
      const length=path.getTotalLength();
      return Array.from({length:257},(_,index)=>{const p=path.getPointAtLength(length*index/256);return {x:p.x,y:p.y};});
    });
    const state=await run(`(()=>{const item=items.find(it=>it.uid==='self'),ports=componentWiring.model.ports.filter(port=>port.item===item);return {
      item,start:componentWirePoint(ports.find(port=>port.direction==='out')),end:componentWirePoint(ports.find(port=>port.direction==='in')),
      samples:${JSON.stringify(samples)}.map(point=>toLocal(item,point.x,point.y))};})()`);
    assert.ok(Math.hypot(samples[0].x-state.start.x,samples[0].y-state.start.y)<.1,'self-feedback starts at the output pin');
    assert.ok(Math.hypot(samples.at(-1).x-state.end.x,samples.at(-1).y-state.end.y)<.1,'self-feedback ends at the input pin');
    const box=state.item;
    for(const p of state.samples)assert.ok(!(p.x>box.x+.5&&p.x<box.x+box.w-.5&&p.y>box.y+.5&&p.y<box.y+box.h-.5),
      (transformed?'rotated':'unrotated')+' self-feedback avoids the component interior at '+JSON.stringify(p));
  }
}));

test('LED matrix column inputs are on top while row data stays left',async()=>app(async({page,run})=>{
  const matrix=await run(`(()=>{const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key==='ledMatrix').items[0]);return {...base,uid:'matrix',x:450,y:350,w:300,h:300};})()`);
  await seed(run,[matrix]);await wiring(page,run);
  const ports=await run(`componentWiring.model.ports.map(port=>({name:port.name,role:port.role,side:port.side,type:port.type,...componentWirePoint(port)}))`);
  for(let index=0;index<8;index++){
    const row=ports.find(p=>p.name==='row'+index),column=ports.find(p=>p.name==='col'+index);
    assert.equal(row?.side,'left');assert.equal(row?.role,'data');assert.equal(row?.type,'boolean');
    assert.equal(column?.side,'top');assert.equal(column?.role,'data');assert.equal(column?.type,'boolean');
    assert.ok(row.x<matrix.x&&column.y<matrix.y,'row/column anchors surround the corresponding sides');
  }
  assert.equal(ports.find(p=>p.name==='enable')?.side,'top');
  assert.equal(ports.find(p=>p.name==='enable')?.role,'control');
}));

test('Escape, pointer cancellation, and tab changes cancel a wire without a stale commit or history',async()=>app(async({page,run})=>{
  await seed(run,[source(),target()]);await wiring(page,run);const before=await snapshot(run);
  await startDrag(page,port(page,'source','number','out'));await page.keyboard.press('Escape');await page.mouse.up();
  assert.deepEqual(await snapshot(run),before);assert.equal(await run('componentWiring.drag'),null);
  if(!await run('componentWiring.enabled'))await wiring(page,run);
  await startDrag(page,port(page,'source','number','out'));
  await page.locator('#componentWiringOverlay').dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',bubbles:true});await page.mouse.up();
  assert.deepEqual(await snapshot(run),before);assert.equal(await run('componentWiring.drag'),null);
  const tab=await run('activeTabId');
  await startDrag(page,port(page,'source','number','out'));await run('newTab()');await page.mouse.up();
  assert.equal(await run(`tabDocument(${JSON.stringify(tab)}).items.find(it=>it.uid==='target').bindings?.number??null`),null);
  assert.equal(await run(`tabDocument(${JSON.stringify(tab)}).undoStack.length`),0);
  assert.equal(await run('items.length'),0);assert.equal(await run('componentWiring.drag'),null);
}));

test('a port removed during a drag cannot accept the stale connection',async()=>app(async({page,run})=>{
  const dynamic=`({apiVersion:2,inputs(state){return state.remove?{}:{number:{type:'number',default:0}};},outputs:{number:{type:'number'}},compute(inputs){return {number:inputs.number??0};},children(){return [];}})`;
  await seed(run,[source(),target({script:dynamic})]);await wiring(page,run);
  const to=await point(port(page,'target','number','in'));
  await startDrag(page,port(page,'source','number','out'),to);
  await run('items[1].state.remove=true;editorComponentEvaluation=null;render()');await run('ensureEditorComponentGraph()');
  await page.mouse.up();await settleUi(page);
  assert.equal(await run('items[1].bindings?.number??null'),null);assert.equal(await run('undoStack.length'),0);
}));

async function holdTargetCaps(run){
  await run(`(()=>{const original=requestSmartCaps;requestSmartCaps=async(...args)=>{
    const result=await original(...args);
    if(componentWiring.pending && args[0]?.uid==='target' && !window.__wireCapsHeld){
      window.__wireCapsHeld=true;await new Promise(resolve=>{window.__releaseWireCaps=resolve;});
    }
    return result;
  };})()`);
}
test('a stale asynchronous port reply cannot connect after the component configuration changes',async()=>app(async({page,run})=>{
  const dynamic=`({apiVersion:2,inputs(state){return state.remove?{}:{number:{type:'number',default:0}};},outputs:{number:{type:'number'}},compute(inputs){return {number:inputs.number??0};},children(){return [];}})`;
  await seed(run,[source(),target({script:dynamic})]);await wiring(page,run);await holdTargetCaps(run);
  await dragPorts(page,port(page,'source','number','out'),port(page,'target','number','in'));
  await page.waitForFunction(()=>typeof window.__releaseWireCaps==='function');
  await run('items[1].state.remove=true;editorComponentEvaluation=null;render()');await run('ensureEditorComponentGraph()');
  await page.evaluate(()=>window.__releaseWireCaps());await run('smartGestureQueue');
  assert.equal(await run('items[1].bindings?.number??null'),null);assert.equal(await run('undoStack.length'),0);
}));

test('Escape while connection validation is pending prevents a late reply from committing',async()=>app(async({page,run})=>{
  await seed(run,[source(),target()]);await wiring(page,run);await holdTargetCaps(run);
  const before=await snapshot(run);
  await dragPorts(page,port(page,'source','number','out'),port(page,'target','number','in'));
  await page.waitForFunction(()=>typeof window.__releaseWireCaps==='function');await page.keyboard.press('Escape');
  await page.evaluate(()=>window.__releaseWireCaps());await run('smartGestureQueue');
  assert.deepEqual(await snapshot(run),before);assert.equal(await run('componentWiring.pending'),false);
}));

test('numeric self-feedback and source fan-out remain valid wiring operations',async()=>app(async({page,run})=>{
  await seed(run,[target({x:160}),component('second',targetScript,{x:700})]);await wiring(page,run);
  await dragPorts(page,port(page,'target','number','out'),port(page,'target','number','in'));
  await bound(page,'target','number',{uid:'target',port:'number'});
  await dragPorts(page,port(page,'target','number','out'),port(page,'second','number','in'));
  await bound(page,'second','number',{uid:'target',port:'number'});
  await edge(page,'second','number').waitFor({state:'visible'});
  assert.equal(await page.locator('#componentWiringOverlay [data-wire-edge][data-type="number"]').count(),2);
}));

test('table cycle checks include intermediate components while graph records await publication',async()=>app(async({page,run})=>{
  const script=`({apiVersion:2,inputs:{data:{type:'table'}},outputs:{data:{type:'table'}},compute(inputs){return {data:inputs.data};},children(){return [];}})`;
  const pool={records:{name:'Records',columns:[{key:'value',name:'Value',type:'number'}],rows:[[7]]}};
  await seed(run,[component('a',script,{x:100,w:200,inputValues:{data:{datasetId:'records'}}}),
    component('b',script,{x:500,w:200,bindings:{data:{uid:'a',port:'data'}}}),
    component('c',script,{x:900,w:200,bindings:{data:{uid:'b',port:'data'}}})],pool);
  await wiring(page,run);const before=await snapshot(run),end=await point(port(page,'a','data','in'));
  await startDrag(page,port(page,'c','data','out'),end);
  // Model the interval in which graph evaluation has a complete promise result but
  // its records have not reached the overlay. Endpoint caps alone cannot see b.
  await run('editorComponentEvaluation.records=null');await page.mouse.up();await run('smartGestureQueue');
  assert.deepEqual(await snapshot(run),before,'closing A → B → C → A cannot create a table feedback loop');
  assert.match(await run('componentWiring.message'),/table.*feedback/i);
}));

test('dense port rails stay reachable near the top of the canvas and both ends accept a drag',async()=>app(async({page,run})=>{
  const inputs=Object.fromEntries(Array.from({length:26},(_,index)=>['input'+index,{type:'number',default:0}]));
  const script=`({apiVersion:2,inputs:${JSON.stringify(inputs)},outputs:{value:{type:'number'}},compute(){return {value:0};},children(){return [];}})`;
  await seed(run,[source({x:100,y:280}),target({script,x:750,y:50,h:70})]);await wiring(page,run);
  const bounds=await page.locator('#componentWiringOverlay').boundingBox();
  const points=await Promise.all(Array.from({length:26},(_,index)=>point(port(page,'target','input'+index,'in'))));
  for(const p of points){assert.ok(p.y>=bounds.y+10,'input port is below the top edge');assert.ok(p.y<=bounds.y+bounds.height-10,'input port is above the bottom edge');}
  for(let index=1;index<points.length;index++)assert.ok(Math.hypot(points[index].x-points[index-1].x,points[index].y-points[index-1].y)>=20,'neighbouring hit targets have usable separation');
  for(const name of ['input0','input25']){await dragPorts(page,port(page,'source','number','out'),port(page,'target',name,'in'));await bound(page,'target',name,{uid:'source',port:'number'});}
}));

test('keyboard port selection connects and selected links retain focus through redraws before Delete',async()=>app(async({page,run})=>{
  await seed(run,[source(),target()]);await wiring(page,run);
  await port(page,'source','number','out').focus();await page.keyboard.press('Enter');
  await port(page,'target','number','in').focus();await page.keyboard.press('Enter');await bound(page,'target','number',{uid:'source',port:'number'});
  const link=edge(page,'target','number');await link.focus();await page.keyboard.press('Enter');await run('render()');
  assert.equal(await link.evaluate(el=>document.activeElement===el),true,'redrawing a selected wire preserves its keyboard focus');
  await page.keyboard.press('Delete');await bound(page,'target','number',null);assert.equal(await run('items.length'),2);
}));

test('an extra touch pointer cannot steal or complete the active wire drag',async()=>app(async({page,run})=>{
  await seed(run,[source(),target()]);await wiring(page,run);
  const from=port(page,'source','number','out'),to=port(page,'target','number','in'),start=await point(from),finish=await point(to),overlay=page.locator('#componentWiringOverlay');
  await from.dispatchEvent('pointerdown',{pointerId:81,pointerType:'touch',isPrimary:true,button:0,buttons:1,clientX:start.x,clientY:start.y});
  await to.dispatchEvent('pointerdown',{pointerId:82,pointerType:'touch',isPrimary:false,button:0,buttons:1,clientX:finish.x,clientY:finish.y});
  await overlay.dispatchEvent('pointerup',{pointerId:82,pointerType:'touch',isPrimary:false,button:0,clientX:finish.x,clientY:finish.y});
  assert.equal(await run('componentWiring.drag.pointerId'),81);assert.equal(await run('items[1].bindings?.number??null'),null);
  await overlay.dispatchEvent('pointerup',{pointerId:81,pointerType:'touch',isPrimary:true,button:0,clientX:finish.x,clientY:finish.y});
  await bound(page,'target','number',{uid:'source',port:'number'});assert.equal(await run('undoStack.length'),1);
}));

test('stored dataset associations are distinct from incoming table flows and ownership storage cannot be connected',async()=>app(async({page,run})=>{
  const rows=name=>({name,columns:[{key:'value',name:'Value',type:'number'}],rows:[[7]]});
  const pool={records:rows('Records'),copy:rows('Copy')};
  const entries=await run(`[
    {key:'dataSource',uid:'owner',x:100,y:130,inputValues:{data:{datasetId:'records'}}},
    {key:'dataSource',uid:'copy',x:850,y:130,inputValues:{data:{datasetId:'copy'}},bindings:{source:{uid:'owner',port:'data'}}},
    {key:'dataTable',uid:'literal',x:100,y:520,inputValues:{data:{datasetId:'records'}}},
    {key:'dataTable',uid:'bound',x:850,y:520,bindings:{data:{uid:'owner',port:'data'}}}
  ].map(spec=>{const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key===spec.key).items[0]);return {...base,...spec,w:300,h:180};})`);
  await seed(run,entries,pool);await wiring(page,run);
  for(const uid of ['literal','bound']){
    assert.equal(await edge(page,uid,'data').getAttribute('data-kind'),'dataset',uid+' shares the stored records');
    assert.equal(await edge(page,uid,'data').getAttribute('data-type'),'table');
  }
  assert.equal(await edge(page,'copy','source').getAttribute('data-kind'),'flow','a source table is a directional publication to the copy action');
  assert.equal(await edge(page,'copy','source').getAttribute('data-type'),'table');
  assert.equal(await port(page,'owner','data','in').count(),0,'owned storage is not a connectable input');
  assert.equal(await port(page,'copy','data','in').count(),0);
  const before=await run('JSON.stringify(datasets)');
  await selectEdge(page,edge(page,'literal','data'));await page.keyboard.press('Delete');
  await page.waitForFunction(()=>!__test.run('items.find(it=>it.uid==="literal").inputValues?.data'));
  assert.equal(await run('JSON.stringify(datasets)'),before,'disconnecting a view does not delete the shared records');
  await run('undo()');assert.deepEqual(await run('items.find(it=>it.uid==="literal").inputValues.data'),{datasetId:'records'});
}));

test('leaving Wiring restores normal overlap selection cycling',async()=>app(async({page,run})=>{
  const rect=uid=>({type:'rect',uid,x:120,y:150,w:180,h:120,color:'#334155',strokeOn:true,size:1,fill:true,fillColor:'#ffffff'});
  await seed(run,[rect('back'),rect('front'),source({x:700})]);await wiring(page,run);
  await page.locator('#componentWiringBtn').click();assert.equal(await run('componentWiring.enabled'),false);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+170,box.y+200);assert.deepEqual(await run('selection.map(i=>items[i].uid)'),['front']);
  await page.mouse.click(box.x+170,box.y+200);assert.deepEqual(await run('selection.map(i=>items[i].uid)'),['back']);
  assert.equal(await run('undoStack.length'),0);
}));

test('HTML and SVG exports omit editor wiring overlays while the exported reader retains the connection',async()=>app(async({page,run})=>{
  const display=`({apiVersion:2,inputs:{number:{type:'number',default:0}},outputs:{number:{type:'number'}},compute(inputs){return {number:inputs.number};},
    children(state,style,w,h,editing,io){return [{type:'text',x:0,y:0,w,h:40,text:String(io.outputs.number),strokeOn:false,color:'#334155',font:'400 18px sans-serif'}];}})`;
  await seed(run,[source(),target({script:display})]);await wiring(page,run);
  await dragPorts(page,port(page,'source','number','out'),port(page,'target','number','in'));await bound(page,'target','number',{uid:'source',port:'number'});
  await edge(page,'target','number').waitFor({state:'visible'}); // bindings commit before the async graph publishes the new overlay
  const getDownload=async expression=>{const pending=page.waitForEvent('download');await run(expression);return fs.readFileSync(await(await pending).path(),'utf8');};
  const svg=await getDownload('saveSvg()'),exported=await getDownload('exportHtml()');
  for(const [name,body] of [['SVG',svg],['HTML',exported]])assert.doesNotMatch(body,/data-wire-(?:port|edge)|componentWiringOverlay|wire-arrow-/,name+' contains only document artwork');
  assert.equal(await run('componentWiring.enabled'),true,'export does not leave the authoring mode');
  const reader=await page.context().newPage(),errors=[];reader.on('pageerror',error=>errors.push(error.message));
  await reader.route('http://component-wiring-export.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:exported}));
  await reader.goto('http://component-wiring-export.test/document.html');
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===2 &&
    [...document.querySelector('[data-smart-index="1"]').querySelectorAll('text')].some(node=>node.textContent==='7'));
  assert.equal(await reader.locator('[data-wire-port],[data-wire-edge],#componentWiringOverlay').count(),0);
  assert.deepEqual(errors,[],'reader evaluates the saved connection without authoring globals');
}));

test('the smart-components settings switch hides visual wiring authoring',async()=>app(async({page,run})=>{
  await seed(run,[source(),target({bindings:{number:{uid:'source',port:'number'}}})]);
  assert.equal(await page.locator('#componentWiringBtn').isVisible(),false);
  await run('setComponentWiringMode(true)');assert.equal(await run('componentWiring.enabled'),false);
  assert.equal(await run('(async()=> (await ensureEditorComponentGraph()).get(items[1]).io.outputs.number)()'),7,'existing drawings retain their signal connections');
},{features:{smartComponents:false}}));
