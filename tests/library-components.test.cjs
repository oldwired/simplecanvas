const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

// Only the served copy exposes the closure. Calls still cross the production Worker
// boundary, and the exported document uses its own unmodified offline runtime.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://library-components.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,
      contentType:'text/html',body:html}));
    await page.goto('http://library-components.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}

async function editorHandle(page,run,index,id){
  const {item,handle}=await run(`(async()=>{
    selection=[${index}];editingSmartIdx=${index};render();
    const item=items[${index}],io=await resolveSmartComponentIo(item);
    const handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]);
    return {item,handle:handles.find(handle=>handle.id===${JSON.stringify(id)})};
  })()`);
  assert.ok(handle,'the '+id+' editor handle exists');
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+handle.x,box.y+item.y+handle.y);await run('smartHitSettled');
  return handle;
}
async function openExport(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-library-components-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'document.html');fs.copyFileSync(await(await download).path(),file);
  const preview=await context.newPage(),errors=[],requests=[];
  preview.on('pageerror',error=>errors.push(error.message));
  preview.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await preview.goto(pathToFileURL(file).href);
  return {preview,errors,requests};
}
async function readerClick(page,index,point){
  const position=await page.locator('[data-smart-index="'+index+'"]').evaluate((host,p)=>{
    const at=new DOMPoint(p.x,p.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:at.x,y:at.y};
  },point);
  await page.mouse.click(position.x,position.y);
}
async function readerToggle(page,index,on){
  await page.waitForFunction(({index,on})=>{
    const host=document.querySelector('[data-smart-index="'+index+'"]');
    const track=host?.querySelector('rect[fill="'+(on?'#15803d':'#64748b')+'"]');
    const thumb=host?.querySelector('ellipse[fill="#ffffff"]');
    if(!track || !thumb)return false;
    const middle=Number(track.getAttribute('x'))+Number(track.getAttribute('width'))/2;
    return on?Number(thumb.getAttribute('cx'))>middle:Number(thumb.getAttribute('cx'))<middle;
  },{index,on});
}
async function svgRenderings(page,run){
  const svg=await run('itemsToSVGMarkup(items,{liveSmart:true})');
  return page.evaluate(svg=>[...new DOMParser().parseFromString(svg,'image/svg+xml').querySelectorAll('[data-smart-index]')].map(host=>({
    text:host.textContent,
    leds:[...host.querySelectorAll('ellipse')].map(ellipse=>ellipse.getAttribute('fill')).filter(color=>['#15803d','#64748b','#2563eb','#fbbf24'].includes(color)),
    paths:[...host.querySelectorAll('path')].map(path=>path.getAttribute('d'))
  })),svg);
}
async function settledDrawings(page){
  await page.waitForFunction(()=>__test.run('items.every(item=>smartChildrenCache.has(item.uid))'));
}

const sourceFiles={numberControl:'number-control.js',toggle:'toggle.js',constant:'constant.js',compare:'compare.js',
  and:'and-gate.js',or:'or-gate.js',not:'not-gate.js',xor:'xor-gate.js',nand:'nand-gate.js',nor:'nor-gate.js',xnor:'xnor-gate.js',buffer:'buffer.js',valueLabel:'value-label.js',
  statusIndicator:'status-indicator.js',gauge:'gauge.js',numberInverter:'number-inverter.js',math:'math.js',triStateBuffer:'tri-state-buffer.js',
  delay:'delay.js',counter:'counter.js',randomInteger:'random-integer.js',sampleHoldInteger:'sample-hold-integer.js',sampleHoldBoolean:'sample-hold-boolean.js',trigger:'trigger.js',
  clamp:'clamp.js',rangeMap:'range-map.js',numberFunction:'number-function.js',pulseGenerator:'pulse-generator.js',edgePulse:'edge-pulse.js',
  selectorNumber:'selector-number.js',selectorBoolean:'selector-boolean.js',steppedSelectorNumber:'stepped-selector-number.js',
  steppedSelectorBoolean:'stepped-selector-boolean.js',steppedDistributorNumber:'stepped-distributor-number.js',steppedDistributorBoolean:'stepped-distributor-boolean.js',
  shiftRegisterBoolean:'shift-register-boolean.js',shiftRegisterNumber:'shift-register-number.js',
  sevenSegmentDisplay:'seven-segment-display.js',ledMatrix:'led-matrix.js'};

test('bundled scalar component sources, defaults, and displayed ports match the shipped examples',async()=>app(async({run})=>{
  const definitions=await run(`Promise.all(BUILTIN_LIBRARY_DEFINITIONS.filter(d=>d.items[0].componentApi===2).map(async d=>{
    const item=clone(d.items[0]),owner=createSmartExecution(item);
    try{
      const caps=await requestSmartCaps(item,owner);
      const state=await requestSmartCall(item,'initState',[],owner);
      const style=await requestSmartCall(item,'initStyle',[],owner);
      return {key:d.key,script:item.script,savedState:item.state,state,w:item.w,h:item.h,style,ports:d.ports,caps};
    }finally{disposeSmartExecution(owner);}
  }))`);
  assert.deepEqual(definitions.map(d=>d.key).sort(),Object.keys(sourceFiles).sort());
  for(const definition of definitions){
    assert.equal(definition.script.trim(),fs.readFileSync(path.join(__dirname,'..','examples',sourceFiles[definition.key]),'utf8').trim(),
      definition.key+' bundled source must stay synchronized with the editable example');
    assert.deepEqual(definition.savedState,definition.state,definition.key+' saved defaults must match fresh placement');
    assert.equal(definition.w,definition.style.w);assert.equal(definition.h,definition.style.h);
    assert.deepEqual(definition.ports,{inputs:definition.caps.inputs,outputs:definition.caps.outputs},
      definition.key+' library port labels must describe the actual validated script');
  }
}));

test('shipped gates satisfy truth tables through the sandbox and required inputs remain unavailable',async()=>app(async({page,run})=>{
  const cases=[];
  for(const a of [false,true])for(const b of [false,true]){
    cases.push({key:'and',inputs:{a,b},expected:a&&b},{key:'or',inputs:{a,b},expected:a||b},
      {key:'xor',inputs:{a,b},expected:a!==b},{key:'nand',inputs:{a,b},expected:!(a&&b)},
      {key:'nor',inputs:{a,b},expected:!(a||b)},{key:'xnor',inputs:{a,b},expected:a===b});
  }
  for(const value of [false,true])cases.push({key:'not',inputs:{value},expected:!value},{key:'buffer',inputs:{value},expected:value});
  for(const value of [false,true])for(const enable of [false,true]){
    cases.push({key:'triStateBuffer',inputs:{value,enable},expected:enable?value:null});
  }
  for(const value of [69,70,71])cases.push({key:'compare',inputs:{value,b:70,operation:'>'},expected:value>70});
  cases.push({key:'compare',inputs:{value:-2,b:-3,operation:'>'},expected:true},
    {key:'valueLabel',inputs:{value:-12.5},expected:-12.5},
    {key:'statusIndicator',inputs:{value:false},expected:false});
  for(const value of [-8.5,0,12.5,Number.MAX_VALUE])cases.push({key:'numberInverter',inputs:{value},expected:value===0?0:-value});
  for(const [a,b,operation,expected] of [[-2,3,'+',1],[1.25,.5,'−',.75],[-2.5,4,'×',-10],[7,2,'÷',3.5],[7,-2,'÷',-3.5],[0,3,'÷',0],[0,-7,'×',0]]){
    cases.push({key:'math',inputs:{a,b,operation},expected});
  }
  for(const fixture of cases){
    const result=await run(`(async()=>{
      const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===${JSON.stringify(fixture.key)}).items[0]);
      const owner=createSmartExecution(item);
      try{return (await requestSmartSandbox({method:'call',src:item.script,fn:'compute',
        args:[${JSON.stringify(fixture.inputs)},${JSON.stringify(fixture.state||{})}]},item,owner)).result;}
      finally{disposeSmartExecution(owner);}
    })()`);
    assert.deepEqual(result,{value:fixture.expected},fixture.key+' '+JSON.stringify(fixture.inputs));
  }
  await run(`(async()=>{
    const names=['and','or','not','xor','nand','nor','xnor','buffer','compare','numberInverter','math','triStateBuffer','valueLabel','statusIndicator'];
    items=names.map(key=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid:key,
      ...(key==='triStateBuffer'?{inputValues:{enable:false}}:{})}));
    await ensureEditorComponentGraph();render();
  })()`);
  await page.waitForFunction(()=>__test.run(`items.every(item=>{
    const kids=smartChildrenFor(item,false);
    return kids.some(child=>child.type==='text' && /Input required/.test(child.text)) &&
      (['valueLabel','statusIndicator'].includes(item.uid) || kids.some(child=>child.type==='polygon' || child.text==='≷' || child.text==='×−1' || child.text==='+ − × ÷'));
  })`));
  const unavailable=await run(`(async()=>{
    const graph=await ensureEditorComponentGraph();
    return items.map(item=>({key:item.uid,name:item.componentName,error:graph.get(item).error,outputs:graph.get(item).io.outputs,
      children:smartChildrenFor(item,false),text:smartChildrenFor(item,false).filter(child=>child.type==='text').map(child=>child.text)}));
  })()`);
  for(const entry of unavailable){
    assert.match(entry.error,/Missing value or binding/,entry.key+' must require its input');
    assert.deepEqual(entry.outputs,{},entry.key+' must not fabricate a false or zero result');
    assert.ok(entry.text.some(text=>text.toLowerCase()===entry.name.toLowerCase()),entry.key+' remains identifiable before connecting');
    assert.match(entry.text.join(' '),/Input required/,entry.key+' explains the missing input');
    assert.doesNotMatch(entry.text.join(' '),/undefined|Output:?\s*(true|false)/,entry.key+' does not display a fabricated output');
    if(entry.key==='triStateBuffer')assert.doesNotMatch(entry.text.join(' '),/Output:?\s*Z\b|High impedance/i,'missing inputs must not fabricate high impedance');
    if(!['valueLabel','statusIndicator'].includes(entry.key)){
      const indicators=entry.children.filter(child=>child.type==='ellipse' && child.fillColor==='#fbbf24');
      assert.equal(indicators.length,['not','buffer','numberInverter'].includes(entry.key)?2:3,entry.key+' unavailable ports use amber indicators');
      assert.equal(entry.children.some(child=>child.editorOnly),false,entry.key+' unavailable drawing does not expose author controls');
    }
  }
}));

test('Constant controls and Compare configuration work in the editor while author handles remain inert in HTML',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['constant','compare','toggle'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid:key,x:100+index*350,y:120,
    ...(key==='compare'?{inputValues:{value:71}}:{})
  }));setTool('select');selection=[];render();save();`);
  const constantPlus=await editorHandle(page,run,0,'plus');
  await page.waitForFunction(()=>__test.run('items[0].state.value===71'));
  await run('selection=[1];editingSmartIdx=null;render()');await page.locator('#componentBindingsBtn').click();
  await page.getByLabel('b value',{exact:true}).fill('71');
  const comparisons=page.getByLabel('operation value',{exact:true});
  assert.deepEqual(await comparisons.locator('option').evaluateAll(options=>options.map(option=>option.value)),['>','≥','<','≤','=','≠']);
  await comparisons.selectOption('>');await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  const compareIndicators=await editorHandle(page,run,1,'indicators');
  await page.waitForFunction(()=>__test.run('items[1].inputValues.b===71 && items[1].state.showIndicators===false'));
  const staticSvg=await run('itemsToSVGMarkup(items)');
  assert.doesNotMatch(staticSvg,/Threshold [−+] 1|>\+ 1<|>− 1</,'author controls do not appear in static exports');
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===3);
  const constant=preview.locator('[data-smart-index="0"]'),compare=preview.locator('[data-smart-index="1"]');
  const before=[await constant.textContent(),await compare.textContent()];
  assert.match(before[0],/Constant\s*71/);assert.match(before[1],/A:\s*71.*B:\s*71.*Output\s*false.*>/);
  assert.doesNotMatch(before.join(' '),/Threshold [−+] 1|Indicators:|[−+] 1/);
  await readerClick(preview,0,constantPlus);await readerClick(preview,1,compareIndicators);await readerClick(preview,2,{x:110,y:69});
  // The working Toggle confirms the ordered reader gesture queue passed both blocked handles.
  await readerToggle(preview,2,true);
  assert.deepEqual([await constant.textContent(),await compare.textContent()],before);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('logic symbols and port LEDs represent the actual input and output values',async()=>app(async({page,run})=>{
  const fixtures=[
    {key:'and',inputs:{a:true,b:false},values:[true,false,false],shape:'d'},
    {key:'nand',inputs:{a:true,b:false},values:[true,false,true],shape:'d',inverted:true},
    {key:'or',inputs:{a:false,b:true},values:[false,true,true],shape:'curved'},
    {key:'nor',inputs:{a:false,b:false},values:[false,false,true],shape:'curved',inverted:true},
    {key:'xor',inputs:{a:true,b:true},values:[true,true,false],shape:'curved',extra:true},
    {key:'xnor',inputs:{a:true,b:true},values:[true,true,true],shape:'curved',extra:true,inverted:true},
    {key:'not',inputs:{value:true},values:[true,false],shape:'triangle',inverted:true},
    {key:'buffer',inputs:{value:false},values:[false,false],shape:'triangle'}
  ];
  await run(`items=${JSON.stringify(fixtures)}.map((fixture,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===fixture.key).items[0]),
    uid:fixture.key,inputValues:fixture.inputs,x:100+(index%4)*300,y:120+Math.floor(index/4)*250
  }));selection=[];setTool('select');render();`);
  await settledDrawings(page);
  const children=await run('items.map(item=>smartChildrenCache.get(item.uid).kids)');
  const exported=await svgRenderings(page,run);
  for(const [index,fixture] of fixtures.entries()){
    const kids=children[index],polygons=kids.filter(child=>child.type==='polygon'),body=polygons.find(child=>child.closed);
    assert.ok(body,fixture.key+' has a closed vector gate silhouette');
    assert.equal(body.points.length,fixture.shape==='d'?5:3,fixture.key+' uses its expected silhouette');
    const curved=body.points.some(point=>point.c1||point.c2);
    assert.equal(curved,fixture.shape!=='triangle',fixture.key+' uses the correct curved or straight outline');
    assert.equal(polygons.filter(child=>!child.closed).length,fixture.extra?1:0,fixture.key+' has the XOR input arc only when needed');
    const leds=kids.filter(child=>child.type==='ellipse' && ['#15803d','#64748b'].includes(child.fillColor));
    const colors=fixture.values.map(value=>value?'#15803d':'#64748b');
    assert.deepEqual(leds.map(child=>child.fillColor),colors,fixture.key+' LEDs match independently calculated port states');
    assert.equal(kids.filter(child=>child.type==='ellipse').length-leds.length,fixture.inverted?1:0,
      fixture.key+' inversion bubble is distinct from its optional indicators');
    assert.match(exported[index].text,new RegExp(fixture.key,'i'));
    assert.match(exported[index].text,new RegExp('Output:\\s*'+fixture.values.at(-1)));
    assert.deepEqual(exported[index].leds,colors,fixture.key+' exports the visible LED states');
    assert.ok(exported[index].paths.some(d=>/Z/i.test(d)),fixture.key+' exports its closed silhouette');
    if(fixture.shape!=='triangle')assert.ok(exported[index].paths.some(d=>/C/i.test(d)),fixture.key+' exports its curves');
  }
}));

test('indicator visibility belongs to each instance and survives save, reload, and offline HTML',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['and','and','compare','compare','numberInverter','numberInverter','toggle'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid:'indicator-'+index,
    x:100+(index%3)*350,y:100+Math.floor(index/3)*260,
    ...(key==='and'?{inputValues:{b:true},bindings:{a:{uid:'indicator-6',port:'value'}}}:{}),
    ...(key==='compare'?{inputValues:{value:71}}:{}),
    ...(key==='numberInverter'?{inputValues:{value:-8}}:{})
  }));setTool('select');selection=[];render();save();`);
  await settledDrawings(page);
  const andIndicators=await editorHandle(page,run,0,'indicators');
  const compareIndicators=await editorHandle(page,run,2,'indicators');
  const numericIndicators=await editorHandle(page,run,4,'indicators');
  for(const handle of [andIndicators,compareIndicators,numericIndicators])assert.equal(handle.editorOnly,true);
  assert.deepEqual(await run('items.slice(0,6).map(item=>item.state.showIndicators)'),[false,true,false,true,false,true]);
  assert.deepEqual(await run('items.slice(2,4).map(item=>item.inputValues)'),[{value:71},{value:71}],'indicator changes preserve input configuration');
  const toggle=await editorHandle(page,run,6,'toggle');
  await page.waitForFunction(()=>__test.run('items[6].state.value===true'));
  const expected=[[],['#15803d','#15803d','#15803d'],[],['#2563eb','#2563eb','#15803d'],[],['#2563eb','#2563eb'],[]];
  const before=await svgRenderings(page,run);
  assert.deepEqual(before.map(item=>item.leds),expected,'only the chosen instances hide indicators; their siblings still follow live data');
  assert.doesNotMatch(before.map(item=>item.text).join(' '),/Indicators:|Threshold [−+] 1/,'author controls stay out of static exports');
  const download=page.waitForEvent('download');await run('exportProject()');
  const project=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.deepEqual(project.items.slice(0,6).map(item=>item.state.showIndicators),[false,true,false,true,false,true]);
  await page.reload();await run('appStarted');await settledDrawings(page);
  assert.deepEqual((await svgRenderings(page,run)).map(item=>item.leds),expected,'autosave reload preserves per-instance indicator choices');
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===7);
  const readerLEDs=()=>preview.evaluate(()=>[...document.querySelectorAll('[data-smart-index]')].map(host=>[...host.querySelectorAll('ellipse')]
    .map(ellipse=>ellipse.getAttribute('fill')).filter(color=>['#15803d','#64748b','#2563eb','#fbbf24'].includes(color))));
  assert.deepEqual(await readerLEDs(),expected,'offline HTML restores saved indicator visibility');
  assert.doesNotMatch((await preview.locator('[data-smart-index]').allTextContents()).join(' '),/Indicators:|Threshold [−+] 1/);
  await readerClick(preview,0,andIndicators);await readerClick(preview,2,compareIndicators);await readerClick(preview,4,numericIndicators);
  await readerClick(preview,6,toggle);
  await readerToggle(preview,6,false);
  await preview.waitForFunction(()=>/Output:\s*false/.test(document.querySelector('[data-smart-index="1"]').textContent));
  assert.deepEqual(await readerLEDs(),[[],['#64748b','#15803d','#64748b'],[],['#2563eb','#2563eb','#15803d'],[],['#2563eb','#2563eb'],[]],
    'reader data updates LEDs while editor-only visibility controls remain inert');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('control and display names update per instance and survive JSON reopen and interactive HTML export',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['toggle','toggle','valueLabel','statusIndicator','compare','numberInverter','math'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid:'named-toggle-'+index,x:120+(index%3)*350,y:150+Math.floor(index/3)*250,
    ...(key==='valueLabel'?{inputValues:{value:37.5}}:{}),
    ...(key==='statusIndicator'?{bindings:{value:{uid:'named-toggle-0',port:'value'}}}:{}),
    ...(key==='compare'?{inputValues:{value:71}}:{}),
    ...(key==='numberInverter'?{inputValues:{value:-8}}:{}),
    ...(key==='math'?{inputValues:{a:12,b:4}}:{})
  }));selection=[];setTool('select');render();save();`);
  await settledDrawings(page);
  const names=['Alarm','Cooling fan','Temperature','Door','Threshold check','Reverse sign','Shared total'];
  for(const [index,name] of names.entries()){
    await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
    await page.locator('#componentNameInput').fill(name);await page.locator('#componentBindingsSave').click();
    await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
    await page.waitForFunction(({index,name})=>__test.run(`smartChildrenCache.get(items[${index}].uid)?.kids.some(child=>child.text===${JSON.stringify(name)})`),{index,name});
  }
  const painted=await page.evaluate(()=>{
    const texts=[],original=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(this.canvas.id==='canvas')texts.push(String(text));return original.call(this,text,...args);};
    try{__test.run('render()');return texts;}finally{CanvasRenderingContext2D.prototype.fillText=original;}
  });
  assert.deepEqual(painted.filter(text=>names.includes(text)),names,'renaming repaints each instance with its own name');
  assert.ok(painted.includes('37.5'));assert.ok(painted.includes('OFF'));
  assert.doesNotMatch(painted.join(' '),/Enabled:|\bToggle\b|Value label|Status indicator/,'old captions do not linger after renaming');
  const handle=await editorHandle(page,run,0,'toggle');
  await page.waitForFunction(()=>__test.run('items[0].state.value===true'));
  const download=page.waitForEvent('download');await run('exportProject()');
  const project=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.deepEqual(project.items.map(item=>item.componentName),names);
  assert.deepEqual(project.items[2].inputValues,{value:37.5});
  await run('applySketchToActiveTab([],{})');
  await page.locator('#projectInput').setInputFiles({name:'named-toggles.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await page.waitForFunction(()=>__test.run('items.length===7 && items[6].componentName==="Shared total"'));
  await settledDrawings(page);
  const assertNamedViews=texts=>{
    assert.deepEqual(texts.slice(0,2),names.slice(0,2),'each Toggle shows its own name');
    assert.match(texts[2],/Temperature/);assert.match(texts[2],/37\.5/);
    assert.match(texts[3],/Door/);
    assert.match(texts[4],/Threshold check/);assert.match(texts[4],/>/);
    assert.match(texts[5],/Reverse sign/);assert.match(texts[5],/×−1/);
    assert.match(texts[6],/Shared total/);
  };
  const reopened=(await svgRenderings(page,run)).map(item=>item.text);
  assertNamedViews(reopened);assert.match(reopened[3],/ON/);
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===7);
  assertNamedViews(await preview.locator('[data-smart-index]').allTextContents());
  assert.match(await preview.locator('[data-smart-index="3"]').textContent(),/ON/);
  await readerToggle(preview,0,true);await readerToggle(preview,1,false);
  await readerClick(preview,0,handle);await readerClick(preview,1,handle);
  await readerToggle(preview,0,false);await readerToggle(preview,1,true);
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="3"]').textContent.includes('OFF'));
  assertNamedViews(await preview.locator('[data-smart-index]').allTextContents());
  assert.deepEqual(await run('items.slice(0,2).map(item=>item.state.value)'),[true,false],'reader interactions leave the editor document unchanged');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('Math withholds division-by-zero and overflow results and recovers its downstream value',async()=>app(async({run})=>{
  const cases=[
    {inputs:{a:1,b:0,operation:'÷'},error:/Division by zero/},
    {inputs:{a:1,b:-0,operation:'÷'},error:/Division by zero/},
    {inputs:{a:Number.MAX_VALUE,b:2,operation:'×'},error:/Calculation overflow/},
    {inputs:{a:Number.MAX_VALUE,b:Number.MAX_VALUE,operation:'+'},error:/Calculation overflow/},
    {inputs:{a:-Number.MAX_VALUE,b:Number.MAX_VALUE,operation:'−'},error:/Calculation overflow/},
    {inputs:{a:Number.MAX_VALUE,b:.5,operation:'÷'},error:/Calculation overflow/}
  ];
  for(const fixture of cases){
    const result=await run(`(async()=>{
      const math=clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==='math').items[0]);
      const display=clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==='valueLabel').items[0]);
      items=[{...math,uid:'math-source',inputValues:${JSON.stringify(fixture.inputs)}},
        {...display,uid:'math-display',bindings:{value:{uid:'math-source',port:'value'}}}];
      const graph=await ensureEditorComponentGraph();
      return items.map(item=>({error:graph.get(item).error,outputs:graph.get(item).io.outputs}));
    })()`);
    assert.match(result[0].error,fixture.error);assert.match(result[1].error,/unavailable/i);
    assert.deepEqual(result.map(item=>item.outputs),[{},{}],'invalid arithmetic never publishes an invalid or stale scalar');
  }
  const recovered=await run(`(async()=>{
    items[0].inputValues={a:6,b:2,operation:'÷'};const graph=await ensureEditorComponentGraph();
    return items.map(item=>({error:graph.get(item).error||'',outputs:graph.get(item).io.outputs}));
  })()`);
  assert.deepEqual(recovered,[{error:'',outputs:{value:3}},{error:'',outputs:{value:3}}]);
}));

test('Math operations are configured per instance in Inputs and persist through live offline export',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['numberControl','math','math','valueLabel'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid:'math-ui-'+index,
    x:index===3?450:100+index*350,y:index===3?400:120,
    ...(key==='math'?{inputValues:{a:index===1?10:3,b:50}}:{}),
    ...(key==='valueLabel'?{bindings:{value:{uid:'math-ui-1',port:'value'}}}:{})
  }));setTool('select');selection=[];render();save();`);
  await settledDrawings(page);
  for(const [index,operation,name] of [[1,'÷','Ratio'],[2,'×','Scaled']]){
    await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
    const choices=page.locator('select[aria-label="operation value"]');
    await choices.waitFor({state:'visible'});
    assert.deepEqual(await choices.locator('option').evaluateAll(options=>options.map(option=>option.value)),['+','−','×','÷','min','max']);
    assert.equal(await choices.inputValue(),'+','new Math instances default to addition');
    await page.getByLabel('b (number)',{exact:true}).selectOption(JSON.stringify({uid:'math-ui-0',port:'value'}));
    await choices.selectOption(operation);await page.locator('#componentNameInput').fill(name);
    await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  }
  await editorHandle(page,run,1,'indicators');
  assert.deepEqual(await run('items.slice(1,3).map(item=>({operation:item.inputValues.operation,show:item.state.showIndicators}))'),
    [{operation:'÷',show:false},{operation:'×',show:true}]);
  const control=await run('items[0]');
  const setNumber=async value=>{
    await run('selection=[0];editingSmartIdx=0;render()');const box=await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x+control.x+20+(control.w-40)*value/100,box.y+control.y+control.h*.55);await run('smartHitSettled');
  };
  await setNumber(0);
  await page.waitForFunction(()=>__test.run("smartChildrenFor(items[1],false).some(child=>child.text?.includes('Cannot divide by zero'))"));
  const invalid=await run('(async()=>{const graph=await ensureEditorComponentGraph();return items.slice(1).map(item=>graph.get(item).io.outputs);})()');
  assert.deepEqual(invalid,[{},{value:0},{}],'only the dividing instance and its consumer become unavailable');
  await setNumber(50);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('math-ui-3')?.kids.some(child=>child.text==='0.2')"));
  const download=page.waitForEvent('download');await run('exportProject()');
  const project=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.deepEqual(project.items.slice(1,3).map(item=>[item.inputValues.operation,item.state.showIndicators]),[['÷',false],['×',true]]);
  await page.reload();await run('appStarted');await settledDrawings(page);
  const svg=await svgRenderings(page,run);
  assert.match(svg[1].text,/Ratio.*Output\s*0\.2.*÷/);assert.deepEqual(svg[1].leds,[]);
  assert.match(svg[2].text,/Scaled.*Output\s*150.*×/);assert.deepEqual(svg[2].leds,['#2563eb','#2563eb','#2563eb']);
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===4);
  assert.equal(await preview.locator('select').count(),0,'Math operation selection stays in the editor Inputs dialog');
  assert.equal(await preview.locator('input:visible').count(),0,'numeric entry stays hidden until the user opens it');
  assert.doesNotMatch((await preview.locator('[data-smart-index]').allTextContents()).join(' '),/Indicators:/);
  await readerClick(preview,0,{x:20,y:control.h*.55});
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="1"]')?.textContent.includes('Cannot divide by zero'));
  assert.ok(await preview.locator('[data-smart-index="1"]').getAttribute('data-component-error'));
  await preview.waitForFunction(()=>document.querySelector('[data-smart-index="3"][data-component-error]'));
  assert.doesNotMatch(await preview.locator('[data-smart-index="1"]').textContent(),/Output\s*0\.2/);
  await readerClick(preview,0,{x:20+(control.w-40)*.5,y:control.h*.55});
  await preview.waitForFunction(()=>/Output\s*0\.2/.test(document.querySelector('[data-smart-index="1"]')?.textContent||'') &&
    document.querySelector('[data-smart-index="3"][data-smart-ready="true"]'));
  assert.match(await preview.locator('[data-smart-index="1"]').textContent(),/Ratio/);
  assert.match(await preview.locator('[data-smart-index="2"]').textContent(),/Scaled.*Output\s*150/);
  assert.equal(await preview.locator('[data-component-error]').count(),0,'changing the divisor recovers the entire dependent chain');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('every API2 catalog component uses its instance name in canvas, SVG, and offline HTML',async()=>app(async({page,run,context})=>{
  await page.setViewportSize({width:1600,height:1250});
  const definitions=await run(`(()=>{
    const definitions=BUILTIN_LIBRARY_DEFINITIONS.filter(definition=>definition.items[0].componentApi===2);
    const validInputs={
      clamp:{value:12,min:0,max:100},rangeMap:{value:25,inMin:0,inMax:100,outMin:0,outMax:1,clamp:true},
      numberFunction:{value:-7.5,operation:'abs'},pulseGenerator:{seconds:60,width:.1,enable:false},edgePulse:{value:false,edge:'rising',seconds:.1},
      selectorNumber:{a:12,b:24,select:false},selectorBoolean:{a:false,b:true,select:false},
      steppedSelectorNumber:{in1:10,in2:20,in3:30,in4:40,pulse:false,reset:false},
      steppedSelectorBoolean:{in1:false,in2:true,in3:false,in4:true,pulse:false,reset:false},
      steppedDistributorNumber:{value:12,pulse:false,reset:false},steppedDistributorBoolean:{value:true,pulse:false,reset:false}
    };
    items=definitions.map((definition,index)=>({
      ...clone(definition.items[0]),uid:'catalog-name-'+index,x:40+(index%4)*360,y:40+Math.floor(index/4)*200,
      inputValues:{...Object.fromEntries(Object.entries(definition.ports.inputs).map(([name,port])=>[
        name,Object.hasOwn(port,'default')?port.default:port.options?.[0]??(port.type==='number'?2:port.type==='boolean'?true:'sample')
      ])),...validInputs[definition.key]}
    }));setTool('select');selection=[];render();save();return definitions.map(definition=>definition.key);
  })()`);
  await settledDrawings(page);
  const names=definitions.map((key,index)=>'Label '+String(index+1).padStart(2,'0'));
  for(const [index,name] of names.entries()){
    await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
    await page.locator('#componentNameInput').fill(name);await page.locator('#componentBindingsSave').click();
    await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
    await page.waitForFunction(({index,name})=>__test.run(`smartChildrenCache.get(items[${index}].uid)?.kids.some(child=>child.text===${JSON.stringify(name)})`),{index,name},{timeout:5000})
      .catch(()=>{throw new Error(definitions[index]+' did not repaint its custom instance name');});
  }
  const painted=await page.evaluate(()=>{
    const captions=[],original=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(this.canvas.id==='canvas' && /^Label \d\d$/.test(String(text)))captions.push(String(text));return original.call(this,text,...args);};
    try{__test.run('render()');return captions;}finally{CanvasRenderingContext2D.prototype.fillText=original;}
  });
  assert.deepEqual(painted,names,'every current API2 definition paints its renamed caption');
  const svg=await svgRenderings(page,run);
  assert.equal(svg.length,names.length);
  for(const [index,name] of names.entries())assert.ok(svg[index].text.includes(name),definitions[index]+' exports its custom name to SVG');
  const {preview,errors,requests}=await openExport(page,run,context);
  await preview.waitForFunction(count=>document.querySelectorAll('[data-smart-ready="true"]').length===count,names.length);
  const readerText=await preview.locator('[data-smart-index]').allTextContents();
  assert.equal(readerText.length,names.length);
  for(const [index,name] of names.entries())assert.ok(readerText[index].includes(name),definitions[index]+' keeps its custom name in offline HTML');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('tri-state buffer publishes Z without coercion and its connected display recovers in the editor and offline HTML',async()=>app(async({page,run,context})=>{
  await run(`cancelGesture();items=['toggle','toggle','triStateBuffer','statusIndicator'].map((key,index)=>({
    ...clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===key).items[0]),uid:'tristate-'+index,
    x:index<2?60:index===2?400:780,y:index===1?300:120,
    componentName:['Data','Enable','Bus driver','Bus status'][index],
    ...(key==='triStateBuffer'?{inputValues:{value:false,enable:false}}:{}),
    ...(key==='statusIndicator'?{inputValues:{value:true}}:{})
  }));selection=[];setTool('select');render();save();`);
  await settledDrawings(page);
  const connect=async(index,bindings)=>{
    await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
    for(const [input,source] of Object.entries(bindings)){
      await page.getByLabel(input+' (boolean)',{exact:true}).selectOption(JSON.stringify({uid:'tristate-'+source,port:'value'}));
    }
    await page.locator('#componentBindingsSave').click();
    await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  };
  await connect(2,{value:0,enable:1});
  // Creating this binding while the source is already Z must be allowed, even
  // though the ordinary boolean display cannot consume its present value.
  await connect(3,{value:2});
  const editorState=async expected=>{
    await page.waitForFunction(expected=>__test.run(`(()=>{
      const source=smartChildrenCache.get('tristate-2')?.kids||[],display=smartChildrenFor(items[3],false);
      return source.some(child=>child.text==='Output: '+${JSON.stringify(expected===null?'Z':String(expected))}) &&
        ${expected===null?"display.some(child=>/unavailable/i.test(child.text||''))":`display.some(child=>child.text===${JSON.stringify(expected?'ON':'OFF')})`};
    })()`),expected);
    const records=await run(`(async()=>{
      const graph=await ensureEditorComponentGraph();
      return items.slice(2).map(item=>({error:graph.get(item).error||'',outputs:graph.get(item).io.outputs}));
    })()`);
    assert.equal(records[0].error,'','Z is a healthy producer result');
    assert.deepEqual(records[0].outputs,{value:expected});
    assert.deepEqual(records[1].outputs,expected===null?{}:{value:expected},'an ordinary boolean consumer never receives coerced false for Z');
    if(expected===null){
      assert.match(records[1].error,/high.?impedance|\bZ\b/i);
      assert.doesNotMatch(await run("smartChildrenFor(items[3],false).filter(child=>child.type==='text').map(child=>child.text).join(' ')"),/\bON\b|\bOFF\b/);
    }else assert.equal(records[1].error,'');
  };
  await editorState(null);
  assert.equal(await run("smartChildrenCache.get('tristate-2').kids.filter(child=>child.type==='ellipse' && child.fillColor==='#7c3aed').length"),1,
    'high impedance uses a distinct purple output indicator');
  const indicatorHandle=await editorHandle(page,run,2,'indicators');
  assert.equal(indicatorHandle.editorOnly,true);
  await page.waitForFunction(()=>__test.run("items[2].state.showIndicators===false && !smartChildrenCache.get('tristate-2')?.kids.some(child=>child.type==='ellipse' && child.fillColor==='#7c3aed')"));
  await editorHandle(page,run,2,'indicators');
  await editorState(null);
  const dataHandle=await editorHandle(page,run,0,'toggle');
  await editorState(null);
  const enableHandle=await editorHandle(page,run,1,'toggle');
  await editorState(true);
  await editorHandle(page,run,0,'toggle');await editorState(false);
  await editorHandle(page,run,1,'toggle');await editorState(null);
  const download=page.waitForEvent('download');await run('exportProject()');
  const project=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.deepEqual(project.items.slice(0,2).map(item=>item.state.value),[false,false]);
  assert.deepEqual(project.items[2].bindings,{value:{uid:'tristate-0',port:'value'},enable:{uid:'tristate-1',port:'value'}});
  assert.deepEqual(project.items[3].bindings,{value:{uid:'tristate-2',port:'value'}});
  assert.equal(project.items[2].state.showIndicators,true);
  await run('applySketchToActiveTab([],{})');
  await page.locator('#projectInput').setInputFiles({name:'tri-state-buffer.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await page.waitForFunction(()=>__test.run("items.length===4 && items[2].uid==='tristate-2'"));
  await editorState(null);
  const svg=await svgRenderings(page,run);
  assert.match(svg[2].text,/Bus driver.*Output:\s*Z.*High impedance/);
  assert.match(svg[3].text,/unavailable/i);assert.doesNotMatch(svg[3].text,/ON|OFF/);
  const {preview,errors,requests}=await openExport(page,run,context);
  const readerState=async expected=>{
    await preview.waitForFunction(expected=>{
      const source=document.querySelector('[data-smart-index="2"]'),display=document.querySelector('[data-smart-index="3"]');
      return source?.dataset.smartReady==='true' && !source.hasAttribute('data-component-error') &&
        new RegExp('Output:\\s*'+(expected===null?'Z':String(expected))).test(source.textContent) &&
        (expected===null?display?.hasAttribute('data-component-error'):display?.dataset.smartReady==='true' &&
          [...display.querySelectorAll('text')].some(text=>text.textContent===(expected?'ON':'OFF')));
    },expected,{timeout:5000}).catch(async error=>{
      error.message+='\nReader state: '+JSON.stringify(await preview.locator('[data-smart-index]').evaluateAll(hosts=>hosts.map(host=>({text:host.textContent,ready:host.dataset.smartReady,error:host.getAttribute('data-component-error')}))));
      throw error;
    });
    if(expected===null){
      assert.doesNotMatch(await preview.locator('[data-smart-index="3"]').textContent(),/ON|OFF/);
      assert.equal(await preview.locator('[data-smart-index="2"] ellipse[fill="#7c3aed"]').count(),1);
    }
  };
  await readerState(null);
  assert.doesNotMatch((await preview.locator('[data-smart-index]').allTextContents()).join(' '),/Indicators:/);
  await readerClick(preview,2,indicatorHandle);await readerClick(preview,1,enableHandle);await readerState(false);
  await readerClick(preview,0,dataHandle);await readerState(true);
  await readerClick(preview,1,enableHandle);await readerState(null);
  assert.match(await preview.locator('[data-smart-index="2"]').textContent(),/Bus driver/);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
