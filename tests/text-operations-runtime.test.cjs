const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

// Only the editor exposes test observations. Component code is evaluated by the
// production Worker bridge; the downloaded reader has no test instrumentation.
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://text-operations.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://text-operations.test/index.html');
    const run=source=>page.evaluate(async source=>{
      await __test.run('appReady');
      const pending=Promise.resolve(__test.run(source));
      (window.__testPending??=new Set()).add(pending);
      try{return await pending;}finally{window.__testPending.delete(pending);}
    },source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function seed(run,specs){
  await run(`cancelGesture();items=${JSON.stringify(specs)}.map((spec,index)=>{
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===spec.key).items[0]);
    return {...base,uid:'operation-'+index,x:70+(index%3)*450,y:100+Math.floor(index/3)*260,...spec,state:{...base.state,...spec.state}};
  });selection=[];editingSmartIdx=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
const record=(run,index)=>run(`(async()=>{const record=(await ensureEditorComponentGraph()).get(items[${index}]);return {error:record.error||null,outputs:record.io.outputs};})()`);
async function output(run,index){const result=await record(run,index);assert.equal(result.error,null);return result.outputs;}
async function setInputs(run,index,values,state={}){
  await run(`items[${index}].inputValues=${JSON.stringify(values)};Object.assign(items[${index}].state,${JSON.stringify(state)});editorComponentEvaluation=null;render();`);
  return record(run,index);
}
async function inputDialog(page,run,index){
  await run(`selection=[${index}];editingSmartIdx=null;render();void openComponentBindings();`);
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open&&!document.querySelector('#componentBindingFields').disabled);
}
async function saveDialog(page){await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open&&__test.run('componentDialogSession===null'));}
async function entryHandle(run,index){
  return run(`(async()=>{const item=items[${index}],io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='entry');})()`);
}
async function openEditorEntry(page,run,index){
  await run(`selection=[${index}];editingSmartIdx=${index};render();`);
  const handle=await entryHandle(run,index);assert.ok(handle,'text input has an inline entry handle');
  const item=await run(`clone(items[${index}])`),box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+handle.x,box.y+item.y+handle.y);
  const input=page.locator(handle.kind==='number'?'#smartNumberValue':'#smartTextValue');await input.waitFor();return input;
}
async function submitEditor(page,run,index,value){
  const input=await openEditorEntry(page,run,index);await input.fill(value);await input.press('Enter');
  await page.waitForFunction(({index,value})=>__test.run(`editorComponentEvaluation?.records?.get(items[${index}])?.io.outputs.value`)===value,{index,value});
  await input.press('Escape');await input.waitFor({state:'detached'});await run('smartHitSettled');
}
async function readerText(page,index,text){
  await page.waitForFunction(({index,text})=>{const host=document.querySelector('[data-smart-index="'+index+'"]');return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(node=>node.textContent===text);},{index,text});
}
async function submitReader(page,index,handle,value){
  const point=await page.locator('[data-smart-index="'+index+'"]').evaluate((host,handle)=>{
    const point=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};
  },handle);await page.mouse.click(point.x,point.y);
  const input=page.locator('#smartTextValue');await input.waitFor();await input.fill(value);await input.press('Enter');
  await readerText(page,index,value);await input.press('Escape');await input.waitFor({state:'detached'});
}
async function exported(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-text-operations-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'text-operations.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);return {reader,errors,requests};
}

test('text operations are placeable built-ins with typed, mode-specific Edit controls',async()=>app(async({page,run})=>{
  for(const [key,name,file] of [['textCompare','Text compare','text-compare'],['textExtract','Text extract','text-extract'],['numberToText','Number to text','number-to-text']]){
    assert.equal(await run(`BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===${JSON.stringify(key)}).items[0].script.trim()`),fs.readFileSync(path.join(root,'examples',file+'.js'),'utf8').trim(),'built-in source matches the maintained example');
    if(await page.locator('#shapePicker').isHidden())await page.locator('#shapeLibBtn').click();
    if(await page.locator('#libraryBrowser').isHidden())await page.locator('#browseShapesBtn').click();
    await page.locator('#librarySearch').fill(name);
    const tile=page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place '+name,exact:true});
    const thumbnail=tile.locator('img');await thumbnail.waitFor();
    assert.match(await thumbnail.getAttribute('src'),/^data:image\/png;base64,/,'the library uses an inert PNG preview');
    assert.ok(await thumbnail.evaluate(async image=>{await image.decode();return image.naturalWidth>0&&image.naturalHeight>0;}),'the built-in thumbnail decodes successfully');
    await tile.click();
    const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+250,box.y+({textCompare:200,textExtract:480,numberToText:750}[key]));await run('shapePlacementQueue');
  }
  const caps=await run('(async()=>Promise.all(items.map(item=>requestSmartCaps(item))))()');
  assert.equal(caps[0].inputs.text.type,'string');assert.equal(caps[0].inputs.compare.type,'string');assert.equal(caps[0].outputs.value.type,'boolean');
  assert.equal(caps[1].inputs.start.type,'number');assert.equal(caps[1].outputs.text.type,'string');assert.equal(caps[1].outputs.found.type,'boolean');
  assert.deepEqual(caps[2].inputs,{
    value:{type:'number',default:0,event:true},
    reprocess:{type:'boolean',default:false,event:'command',label:'Reprocess',role:'control'}
  });
  assert.deepEqual(caps[2].outputs,{text:{type:'string',event:true}});
  await inputDialog(page,run,0);
  await page.getByLabel('text value',{exact:true}).fill('Hello');await page.getByLabel('compare value',{exact:true}).fill('HELLO');
  await page.locator('#component-setting-caseSensitive').selectOption('false');await saveDialog(page);
  assert.deepEqual(await output(run,0),{value:true});
  await inputDialog(page,run,1);await page.locator('#component-setting-mode').selectOption('regex capture');
  await page.getByLabel('pattern value',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('start value',{exact:true}).count(),0,'range controls disappear in regex mode');
  await page.getByLabel('text value',{exact:true}).fill('ticket-42');await page.getByLabel('pattern value',{exact:true}).fill('ticket-(\\d+)');
  await page.getByLabel('group value',{exact:true}).fill('0');await saveDialog(page);
  assert.deepEqual(await output(run,1),{text:'42',found:true});
  await inputDialog(page,run,2);await page.getByLabel('value value',{exact:true}).fill('-2.8');await saveDialog(page);
  assert.deepEqual(await output(run,2),{text:'-2.8'});
}));

test('Number to text preserves numeric precision through connected controls and an offline HTML export',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'numberInput',componentName:'Amount',state:{min:-10,max:10,step:.1}},
    {key:'numberToText',componentName:'Amount as text',bindings:{value:{uid:'operation-0',port:'value'}}},
    {key:'textLabel',componentName:'Exact text',bindings:{value:{uid:'operation-1',port:'text'}}}]);
  for(const value of [-2.8,.1+.2]){
    const input=await openEditorEntry(page,run,0);await input.fill(String(value));await input.press('Enter');
    await page.waitForFunction(value=>__test.run('editorComponentEvaluation?.records?.get(items[0])?.io.outputs.value')===value,value);
    assert.deepEqual(await output(run,1),{text:String(value)});assert.deepEqual(await output(run,2),{value:String(value)});
    await input.press('Escape');await input.waitFor({state:'detached'});await run('smartHitSettled');
  }
  const handle=await entryHandle(run,0),{reader,errors,requests}=await exported(page,run,context);
  await readerText(reader,2,'0.30000000000000004');
  for(const value of [-2.8,.1+.2,0]){
    const point=await reader.locator('[data-smart-index="0"]').evaluate((host,handle)=>{
      const point=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};
    },handle);
    await reader.mouse.click(point.x,point.y);const input=reader.locator('#smartNumberValue');await input.waitFor();
    await input.fill(String(value));await input.press('Enter');await readerText(reader,2,String(value));
    await input.press('Escape');await input.waitFor({state:'detached'});
  }
  await reader.reload();await readerText(reader,2,'0.30000000000000004');
  assert.deepEqual(await output(run,2),{value:'0.30000000000000004'},'reader edits are independent from the editor');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'number conversion needs no network or formatting library');
}));

test('comparison modes preserve case options, full-input regex matching, instance isolation and error recovery in real Workers',async()=>app(async({run})=>{
  await seed(run,[{key:'textCompare'},{key:'textCompare',inputValues:{text:'other',compare:'other'}}]);
  for(const [operation,text,compare,caseSensitive,value] of [
    ['equals','Hello','hello',true,false],['equals','Hello','hello',false,true],
    ['not equals','Hello','hello',true,true],['starts with','Hello there','hello',false,true],
    ['ends with','Hello there','THERE',false,true],['contains','A.b[1]','.[',true,false],
    ['contains','A.b[1]','.b[',true,true],['matches regex','ORDER-42','order-\\d+',false,true],
    ['matches regex','prefix ORDER-42','ORDER-\\d+',true,false],['matches regex','ORDER-42\n','ORDER-\\d+',true,false],
    ['matches regex','aaa','a|aaa',true,true],['matches regex','','',true,true]
  ]){
    assert.deepEqual(await setInputs(run,0,{text,compare,operation},{caseSensitive}),{error:null,outputs:{value}},operation+' '+JSON.stringify(text));
    assert.deepEqual(await output(run,1),{value:true},'another instance keeps its independent settings and inputs');
  }
  for(const compare of ['[','a)|(?:b']){
    const failed=await setInputs(run,0,{text:'x',compare,operation:'matches regex'});
    assert.match(failed.error,/regex|regular expression|pattern/i);assert.deepEqual(failed.outputs,{});
  }
  assert.deepEqual(await output(run,1),{value:true});
  assert.deepEqual(await setInputs(run,0,{text:'x',compare:'x',operation:'matches regex'}),{error:null,outputs:{value:true}});
}));

test('range and regex extraction use Unicode code points, distinguish empty matches and recover from invalid capture groups',async()=>app(async({run})=>{
  await seed(run,[{key:'textExtract'}]);
  for(const [text,start,length,expected,found] of [['A😀B',1,1,'😀',true],['A😀B',2,20,'B',true],['A😀B',3,0,'',true],['A😀B',4,1,'',false],['',0,0,'',true]]){
    assert.deepEqual(await setInputs(run,0,{text,start,length},{mode:'range'}),{error:null,outputs:{text:expected,found}});
  }
  for(const [mode,text,pattern,group,expected,found] of [
    ['regex match','pre 😀 post','😀',0,'😀',true],['regex match','abc','z',0,'',false],
    ['regex match','abc','(?=a)',0,'',true],['regex capture','ticket-42','ticket-(\\d+)',0,'42',true],
    ['regex capture','ticket-42','(ticket)-(\\d+)',1,'42',true],
    ['regex capture','b','(a)?b',0,'',false],['regex capture','b','(a*)b',0,'',true]
  ])assert.deepEqual(await setInputs(run,0,{text,pattern,...(mode==='regex capture'?{group}:{})},{mode}),{error:null,outputs:{text:expected,found}});
  const failed=await setInputs(run,0,{text:'b',pattern:'(b)',group:1},{mode:'regex capture'});
  assert.match(failed.error,/group/i);assert.deepEqual(failed.outputs,{});
  assert.deepEqual(await setInputs(run,0,{text:'b',pattern:'(b)',group:0}),{error:null,outputs:{text:'b',found:true}});
}));

test('connected text operations respond to inline entry and work in a downloaded offline HTML export',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'textInput',componentName:'Order'},
    {key:'textCompare',componentName:'Valid order',inputValues:{operation:'matches regex',compare:'order-\\d+'},state:{caseSensitive:false},bindings:{text:{uid:'operation-0',port:'value'}}},
    {key:'textExtract',componentName:'Order number',state:{mode:'regex capture',caseSensitive:false},inputValues:{pattern:'order-(\\d+)',group:0},bindings:{text:{uid:'operation-0',port:'value'}}},
    {key:'statusIndicator',componentName:'Valid',bindings:{value:{uid:'operation-1',port:'value'}}},
    {key:'textLabel',componentName:'Number',bindings:{value:{uid:'operation-2',port:'text'}}},
    {key:'textInput',componentName:'Pattern',state:{values:['order-(\\d+)']}},
    // This branch tests value-preview error isolation. Receiving events would deliberately
    // reject the whole submitted occurrence while its regex is invalid.
    {key:'textExtract',componentName:'Live pattern',state:{mode:'regex match',caseSensitive:false},eventModes:{text:'value'},bindings:{text:{uid:'operation-0',port:'value'},pattern:{uid:'operation-5',port:'value'}}},
    {key:'textLabel',componentName:'Live result',bindings:{value:{uid:'operation-6',port:'text'}}}
  ]);
  await submitEditor(page,run,0,'ORDER-42');assert.deepEqual(await output(run,3),{value:true});assert.deepEqual(await output(run,4),{value:'42'});
  await submitEditor(page,run,0,'bad');assert.deepEqual(await output(run,3),{value:false});assert.deepEqual(await output(run,2),{text:'',found:false});
  await submitEditor(page,run,0,'ORDER-42');
  const entry=await entryHandle(run,0),pattern=await entryHandle(run,5),{reader,errors,requests}=await exported(page,run,context);
  await readerText(reader,3,'ON');await readerText(reader,4,'42');await readerText(reader,7,'ORDER-42');
  await submitReader(reader,0,entry,'order-17');await readerText(reader,4,'17');await readerText(reader,7,'order-17');
  await submitReader(reader,5,pattern,'[');
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="6"]')?.hasAttribute('data-component-error'));
  await submitReader(reader,0,entry,'order-18');await readerText(reader,4,'18');await readerText(reader,3,'ON');
  await submitReader(reader,5,pattern,'\\d+');await readerText(reader,7,'18');
  assert.equal(await reader.locator('[data-component-error]').count(),0,'a repaired pattern restores dependent displays');
  await submitReader(reader,0,entry,'invalid');await readerText(reader,3,'OFF');
  await reader.reload();await readerText(reader,4,'42');await readerText(reader,7,'ORDER-42');
  assert.deepEqual(await output(run,4),{value:'42'},'reader interaction does not mutate the editor');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'native regex needs no external library or network');
}));

// Dispatch both actions in one JS task: Enter starts the real asynchronous
// acceptance, so the next pointer press necessarily arrives while it is pending.
// No timing delay or modified component/runtime is needed to reproduce the race.
async function submitThenImmediatelyClick(page,point){
  const observed=await page.evaluate(({x,y,repaint})=>{
    const input=document.querySelector('#smartTextValue'),form=input.closest('form'),target=document.elementFromPoint(x,y);
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
    const pending=input.readOnly;
    const pointer={pointerId:71,pointerType:'mouse',isPrimary:true,button:0,clientX:x,clientY:y,bubbles:true,cancelable:true,composed:true};
    target.dispatchEvent(new PointerEvent('pointerdown',{...pointer,buttons:1}));
    target.dispatchEvent(new PointerEvent('pointerup',{...pointer,buttons:0}));
    target.dispatchEvent(new MouseEvent('click',{...pointer,buttons:0}));
    // Model the reader's normal SVG repaint deterministically, while the actual
    // Worker acceptance is pending. The component host and its geometry survive.
    if(repaint==='host'){
      const host=target.closest('[data-smart-index]'),replacement=host.cloneNode(true);
      replacement.dataset.replayedDown='0';replacement.addEventListener('pointerdown',()=>replacement.dataset.replayedDown=String(Number(replacement.dataset.replayedDown)+1));
      host.replaceWith(replacement);
    }else if(repaint && target.closest('[data-smart-index]')!==target)target.replaceWith(target.cloneNode(true));
    return {pending,keptUntilAccepted:form.isConnected,detached:!target.isConnected};
  },point);
  assert.equal(observed.pending,true,'the next click occurs during an actual pending acceptance');
  assert.equal(observed.keptUntilAccepted,true,'an outside click must not cancel an initiated Enter submission');
  if(point.repaint)assert.equal(observed.detached,true,'the SVG child was replaced before queued replay');
}

test('clicking another text control while Enter is pending preserves the submission in editor and offline HTML',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'textInput',componentName:'First'},{key:'textInput',componentName:'Second'},
    {key:'textLabel',componentName:'First result',bindings:{value:{uid:'operation-0',port:'value'}}},
    {key:'textLabel',componentName:'Second result',bindings:{value:{uid:'operation-1',port:'value'}}}]);
  const firstHandle=await entryHandle(run,0),secondHandle=await entryHandle(run,1),secondItem=await run('clone(items[1])');
  const first=await openEditorEntry(page,run,0);await first.fill('kept in editor');
  const box=await page.locator('#canvas').boundingBox();
  await submitThenImmediatelyClick(page,{x:box.x+secondItem.x+secondHandle.x,y:box.y+secondItem.y+secondHandle.y});
  await page.waitForFunction(()=>__test.run('selection.length===1&&selection[0]===1'));
  assert.deepEqual(await output(run,2),{value:'kept in editor'});
  await submitEditor(page,run,1,'second editor entry');assert.deepEqual(await output(run,3),{value:'second editor entry'});
  const {reader,errors,requests}=await exported(page,run,context);
  await readerText(reader,2,'kept in editor');await readerText(reader,3,'second editor entry');
  const point=async(index,handle)=>reader.locator('[data-smart-index="'+index+'"]').evaluate((host,handle)=>{
    const point=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};
  },handle);
  const firstPoint=await point(0,firstHandle),secondPoint=await point(1,secondHandle);
  await reader.mouse.click(firstPoint.x,firstPoint.y);const field=reader.locator('#smartTextValue');await field.waitFor();await field.fill('kept in reader');
  await submitThenImmediatelyClick(reader,{...secondPoint,repaint:true});
  await readerText(reader,2,'kept in reader');
  await reader.waitForFunction(()=>document.querySelector('#smartTextValue')?.getAttribute('aria-label')==='Second');
  await field.fill('second reader entry');await field.press('Enter');await readerText(reader,3,'second reader entry');
  await field.press('Escape');await field.waitFor({state:'detached'});
  await reader.mouse.click(firstPoint.x,firstPoint.y);await field.waitFor();await field.fill('kept after removal');
  await submitThenImmediatelyClick(reader,{...secondPoint,repaint:'host'});
  await readerText(reader,2,'kept after removal');await field.waitFor({state:'detached'});
  assert.equal(await reader.locator('[data-smart-index="1"]').getAttribute('data-replayed-down'),'0','a removed component cannot redirect its queued click to a replacement');
  assert.deepEqual(await output(run,2),{value:'kept in editor'});assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('pathological regex is terminated in an isolated Worker while the main thread and unrelated components stay responsive',async()=>app(async({run})=>{
  // Never execute this pattern in the test runner, capability checks, or the UI.
  // The production bridge owns and terminates this deliberately isolated Worker.
  const result=await run(`(async()=>{
    const item=clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==='textCompare').items[0]);item.uid='isolated-regex-timeout';
    const owner=createSmartExecution(item);let error='',heartbeat=false;
    const timer=setTimeout(()=>{heartbeat=true;},20),started=performance.now();
    try{await requestSmartSandbox({method:'call',src:item.script,fn:'compute',args:[{text:'a'.repeat(100)+'!',compare:'(a+)+',operation:'matches regex'},item.state]},item,owner);}
    catch(failure){error=failure.message;}
    finally{clearTimeout(timer);disposeSmartExecution(owner);}
    return {error,heartbeat,elapsed:performance.now()-started,deadline:SMART_CALL_TIMEOUT_MS};
  })()`);
  assert.match(result.error,/timed out|timeout|time limit/i);assert.equal(result.heartbeat,true,'the browser event loop runs during regex computation');
  assert.equal(result.deadline,250);assert.ok(result.elapsed<5000,'the Worker deadline bounds evaluation');
  await seed(run,[{key:'textCompare',inputValues:{text:'safe',compare:'safe'}},{key:'textExtract',inputValues:{text:'A😀B',start:1,length:1}}]);
  assert.deepEqual(await output(run,0),{value:true});assert.deepEqual(await output(run,1),{text:'😀',found:true});
}));

test('text processing built-ins offer typed ports, configurable composition, and number formatting in Edit',async()=>app(async({page,run})=>{
  const definitions=[['textToNumber','Text to number'],['textCompose','Text compose'],['textTransform','Text transform'],['textReplace','Text replace'],['textSelector','Text selector']];
  for(const [index,[key,name]] of definitions.entries()){
    if(await page.locator('#shapePicker').isHidden())await page.locator('#shapeLibBtn').click();
    if(await page.locator('#libraryBrowser').isHidden())await page.locator('#browseShapesBtn').click();
    await page.locator('#librarySearch').fill(name);
    const tile=page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place '+name,exact:true});
    assert.ok(await tile.locator('img').evaluate(async img=>{await img.decode();return img.naturalWidth>0;}));
    await tile.click();const box=await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x+220+(index%3)*410,box.y+180+Math.floor(index/3)*280);await run('shapePlacementQueue');
    assert.equal(await run(`items[${index}].componentName`),name);
    assert.equal((await record(run,index)).error,null,key+' has usable fresh defaults');
  }
  const caps=await run('(async()=>Promise.all(items.map(item=>requestSmartCaps(item))))()');
  assert.equal(caps[0].inputs.text.type,'string');assert.equal(caps[0].outputs.value.type,'number');assert.equal(caps[0].outputs.valid.type,'boolean');
  assert.equal(caps[2].outputs.length.type,'number');assert.equal(caps[2].outputs.empty.type,'boolean');
  assert.equal(caps[4].inputs.select.type,'boolean');assert.equal(caps[4].outputs.text.type,'string');
  await inputDialog(page,run,1);
  await page.locator('#component-setting-inputCount').fill('3');await page.locator('#component-setting-inputCount').press('Tab');
  await page.getByLabel('c value',{exact:true}).waitFor();
  await page.locator('#component-setting-mode').selectOption('template');await page.getByLabel('template value',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('separator value',{exact:true}).count(),0);
  for(const [name,value] of [['a','Ada'],['b','7'],['c','°C'],['template','{{{a}}}: {b} {c}']])await page.getByLabel(name+' value',{exact:true}).fill(value);
  await saveDialog(page);assert.deepEqual(await output(run,1),{text:'{Ada}: 7 °C'});
  await seed(run,[{key:'numberToText',inputValues:{value:-2.8}}]);await inputDialog(page,run,0);
  await page.locator('#component-setting-format').selectOption('fixed decimals');
  for(const [key,value] of [['decimals','2'],['minimumIntegerDigits','3']]){
    await page.locator('#component-setting-'+key).fill(value);await page.locator('#component-setting-'+key).press('Tab');
  }
  await page.locator('#component-setting-decimalSeparator').selectOption(',');await saveDialog(page);
  assert.deepEqual(await output(run,0),{text:'-002,80'});
}));

test('text processing uses bounded outputs and recovers from invalid configurations in real Workers',async()=>app(async({run})=>{
  await seed(run,[{key:'textToNumber'},{key:'textTransform'},{key:'textCompose'},{key:'textReplace'},{key:'textSelector'}]);
  for(const [text,value,valid] of [['12.5',12.5,true],['12abc',0,false],['',0,false],['1e309',0,false],['-2e-3',-.002,true]]){
    assert.deepEqual(await setInputs(run,0,{text}),{error:null,outputs:{value,valid}});
  }
  assert.deepEqual(await setInputs(run,1,{text:'  A😀  ',operation:'trim'}),{error:null,outputs:{text:'A😀',length:2,empty:false}});
  assert.deepEqual(await setInputs(run,1,{text:'   ',operation:'trim'}),{error:null,outputs:{text:'',length:0,empty:true}});
  let failed=await setInputs(run,2,{a:'x'.repeat(1500),b:'y'.repeat(1500),separator:''});
  assert.match(failed.error,/2000|2,000|long|limit/i);assert.deepEqual(failed.outputs,{});
  assert.deepEqual(await setInputs(run,2,{a:'a',b:'b',separator:' / '}),{error:null,outputs:{text:'a / b'}});
  assert.deepEqual(await setInputs(run,3,{text:'a.b.a',search:'.',replacement:'$&'},{mode:'literal'}),{error:null,outputs:{text:'a$&b$&a',count:2}});
  failed=await setInputs(run,3,{text:'a',search:'(',replacement:'x'},{mode:'regex'});
  assert.match(failed.error,/regular expression|regex/i);assert.deepEqual(failed.outputs,{});
  assert.deepEqual(await setInputs(run,3,{text:'a1 b22',search:'(\\w)(\\d+)',replacement:'$2:$1'}),{error:null,outputs:{text:'1:a 22:b',count:2}});
  for(const select of [false,true])assert.deepEqual(await setInputs(run,4,{a:'<b>A</b>',b:'B😀',select}),{error:null,outputs:{text:select?'B😀':'<b>A</b>'}});
}));

test('regex replacement repairs a connected pattern in downloaded offline HTML without evaluating markup',async()=>app(async({page,run,context})=>{
  await seed(run,[{key:'textInput',componentName:'Pattern',state:{values:['(\\d+)']}},
    {key:'textReplace',componentName:'Markup replacement',state:{mode:'regex'},inputValues:{text:'a1 b22',replacement:'<em>$1</em>'},bindings:{search:{uid:'operation-0',port:'value'}}},
    {key:'textLabel',componentName:'Literal result',w:420,bindings:{value:{uid:'operation-1',port:'text'}}}]);
  assert.deepEqual(await output(run,1),{text:'a<em>1</em> b<em>22</em>',count:2});
  const handle=await entryHandle(run,0),{reader,errors,requests}=await exported(page,run,context);
  await readerText(reader,2,'a<em>1</em> b<em>22</em>');
  assert.equal(await reader.locator('[data-smart-index="2"] em').count(),0);
  await submitReader(reader,0,handle,'[');
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="1"]')?.hasAttribute('data-component-error'));
  await submitReader(reader,0,handle,'(22)');await readerText(reader,2,'a1 b<em>22</em>');
  assert.equal(await reader.locator('[data-component-error]').count(),0);
  await reader.reload();await readerText(reader,2,'a<em>1</em> b<em>22</em>');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
