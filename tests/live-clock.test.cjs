const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

// Only the served editor exposes its closure. Components use the real Worker;
// the downloaded HTML runs its unmodified runtime from file://.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Europe/Berlin'});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://live-clock.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://live-clock.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}

const labelScript=`({apiVersion:2,inputs:{value:{type:'string'}},outputs:{value:{type:'string'}},
  compute(inputs){return {value:inputs.value};},
  children(state,style,w,h,editing,io){return [{type:'text',x:0,y:0,w,h,text:'Time:'+io.outputs.value,strokeOn:false}];}})`;
const zoneScript=`({apiVersion:2,inputs:{},outputs:{value:{type:'string'}},
  compute(inputs,state){return {value:state.value};},
  children(state,style,w,h,editing,io){return [{type:'text',x:0,y:0,w,h,text:'Zone:'+io.outputs.value,strokeOn:false}];},
  handles(state,w,h){return [{id:'zone',x:w/2,y:h/2,kind:'click'}];},
  hitEdit(){return 'zone';},
  dragEdit(state){return {state:{value:state.value==='UTC'?'Asia/Kathmandu':'UTC'}};}})`;

async function seed(run,connected=false){
  await run(`(()=>{
    const make=(key,uid,name,x,y)=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key===key).items[0]),uid,componentName:name,x,y});
    const clock=make('liveClock','utc-clock','UTC reference',80,100),counter=make('counter','seconds-count','Observed seconds',420,100);
    clock.inputValues={timezone:'UTC'};
    const label={...clock,uid:'time-label',componentName:'Connected time',script:${JSON.stringify(labelScript)},state:{},inputValues:{},bindings:{},x:80,y:490,w:320,h:60};
    const other=make('liveClock','other-clock','Selected timezone',800,100);other.inputValues={timezone:'Asia/Kathmandu'};
    const zone={...label,uid:'zone-source',componentName:'Timezone selector',script:${JSON.stringify(zoneScript)},state:{value:'Asia/Kathmandu'},x:800,w:350};
    if(${connected}){
      counter.bindings={value:{uid:clock.uid,port:'second'}};
      label.bindings={value:{uid:clock.uid,port:'time'}};
      other.bindings={timezone:{uid:zone.uid,port:'value'}};delete other.inputValues.timezone;
    }
    applySketchToActiveTab([clock,counter,label,other,zone],{});setTool('select');selection=[];render();save();
  })()`);
}
async function bind(page,run,index,input,source,port){
  await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
  await page.getByLabel(input+' ('+(input==='timezone' || index===2?'string':'boolean')+')',{exact:true})
    .selectOption(JSON.stringify({uid:source,port}));
  await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
}
async function editorZone(page,run){
  const target=await run(`(async()=>{
    selection=[4];editingSmartIdx=4;render();const item=items[4];
    const handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h]);return {x:item.x+handles[0].x,y:item.y+handles[0].y};
  })()`);
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+target.x,box.y+target.y);await run('smartHitSettled');
}
async function graphSnapshot(run){
  return run(`(async()=>{
    const graph=await ensureEditorComponentGraph();
    return items.map(item=>({uid:item.uid,error:graph.get(item)?.error||'',outputs:graph.get(item)?.io.outputs}));
  })()`);
}
const seconds=text=>text.split(':').reduce((n,part)=>n*60+Number(part),0);
function assertZones(snapshot,offset){
  assert.ok(snapshot.every(record=>record.error===''),JSON.stringify(snapshot));
  const utc=snapshot[0].outputs.time,other=snapshot[3].outputs.time;
  assert.match(utc,/^\d{2}:\d{2}:\d{2}$/);assert.match(other,/^\d{2}:\d{2}:\d{2}$/);
  const difference=(seconds(other)-seconds(utc)+86400)%86400;
  assert.ok([offset,(offset+1)%86400,(offset+86399)%86400].includes(difference),'independent timezone offset remains '+offset+' seconds');
  assert.equal(snapshot[2].outputs.value,utc,'the string consumer sees the same clock snapshot');
}

test('Live Clock connects second pulses and time text through Inputs and supports independent, bindable timezones',async()=>app(async({page,run})=>{
  await seed(run);
  await bind(page,run,1,'value','utc-clock','second');
  await bind(page,run,2,'value','utc-clock','time');
  await bind(page,run,3,'timezone','zone-source','value');
  assertZones(await graphSnapshot(run),5*3600+45*60);
  const start=await run('items[1].state.count');
  await page.waitForFunction(start=>__test.run('items[1].state.count')>=start+2,start,{timeout:7000});
  assert.equal(await run('items[1].bindings.value.port'),'second');
  assert.deepEqual(await run('items[2].bindings'),{value:{uid:'utc-clock',port:'time'}});
  await editorZone(page,run);assertZones(await graphSnapshot(run),0);
  assert.equal(await run('items[0].inputValues.timezone'),'UTC','changing the bound timezone does not edit another instance');

  await run('selection=[0];render()');await page.locator('#componentBindingsBtn').click();
  await page.getByLabel('timezone value',{exact:true}).fill('Invalid/Timezone');
  await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsError').textContent.length>0);
  assert.equal(await page.locator('#componentBindingsDialog').isVisible(),true,'an invalid timezone cannot be saved');
  await page.getByLabel('timezone value',{exact:true}).fill('UTC');await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  assertZones(await graphSnapshot(run),0);
}));

async function openExport(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-live-clock-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'clock.html');fs.copyFileSync(await(await download).path(),file);
  const preview=await context.newPage(),errors=[],requests=[];
  preview.on('pageerror',error=>errors.push(error.message));
  preview.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await preview.goto(pathToFileURL(file).href);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===5);
  return {preview,errors,requests};
}
async function readerSnapshot(page,after=null){
  const snapshot=await page.waitForFunction(after=>{
    const texts=index=>[...document.querySelector('[data-smart-index="'+index+'"]').querySelectorAll('text')].map(node=>node.textContent);
    const snapshot={time:texts(0).find(text=>/^\d{2}:\d{2}:\d{2}$/.test(text)),
      count:Number(texts(1).find(text=>/^\d+$/.test(text))),label:texts(2).join(''),
      other:texts(3).find(text=>/^\d{2}:\d{2}:\d{2}$/.test(text)),zone:texts(4).join('')};
    return snapshot.time && snapshot.label==='Time:'+snapshot.time && Number.isInteger(snapshot.count) &&
      (!after || (snapshot.count>after.count && snapshot.time!==after.time))?snapshot:false;
  },after,{timeout:5000});
  return snapshot.jsonValue();
}

test('Live Clock connections survive reload and exported HTML keeps ticking and changing timezone offline',async()=>app(async({page,run,context})=>{
  await seed(run,true);
  await page.waitForFunction(()=>__test.run('items[1].state.count>=1'),null,{timeout:5000});
  const saved=await run('save();({count:items[1].state.count,bindings:items.map(item=>item.bindings||{})})');
  await page.reload();await run('appStarted');
  assert.deepEqual(await run('items.map(item=>item.bindings||{})'),saved.bindings);
  assert.equal(await run('items[0].componentApi'),2);
  assert.equal(await run('items[0].inputValues.timezone'),'UTC');
  assert.equal(await run('items[4].state.value'),'Asia/Kathmandu');
  assert.ok(await run('items[1].state.count')>=saved.count,'reloading preserves the observed count');
  const restored=await run('items[1].state.count');
  await page.waitForFunction(count=>__test.run('items[1].state.count')>count,restored,{timeout:5000});
  assertZones(await graphSnapshot(run),5*3600+45*60);

  const {preview,errors,requests}=await openExport(page,run,context);
  const first=await readerSnapshot(preview);
  assert.match(first.time,/^\d{2}:\d{2}:\d{2}$/);assert.ok(Number.isInteger(first.count));
  assert.equal(first.label,'Time:'+first.time);assert.equal(first.zone,'Zone:Asia/Kathmandu');
  const next=await readerSnapshot(preview,first);assert.notEqual(next.time,first.time);assert.equal(next.label,'Time:'+next.time);
  const target=await preview.locator('[data-smart-index="4"]').evaluate(host=>{
    const point=new DOMPoint(175,30).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};
  });
  await preview.mouse.click(target.x,target.y);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="4"]').textContent==='Zone:UTC');
  await preview.waitForFunction(()=>{
    const reading=index=>[...document.querySelector('[data-smart-index="'+index+'"]').querySelectorAll('text')].map(node=>node.textContent).find(text=>/^\d{2}:\d{2}:\d{2}$/.test(text));
    return reading(0)===reading(3);
  });
  assert.equal(await preview.locator('[data-component-error]').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'the live clock and timezone conversion need no HTTP requests');
}));
