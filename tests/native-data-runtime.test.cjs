const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

// Observations enter through the editor only; scripts run in production Workers,
// and the downloaded HTML runs offline without test instrumentation.
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1200}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://native-data.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://native-data.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return await __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function seed(run,specs){
  await run(`cancelGesture();items=${JSON.stringify(specs)}.map((spec,index)=>{
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===spec.key).items[0]);
    return {...base,uid:'native-'+index,x:70+(index%3)*460,y:100+Math.floor(index/3)*240,...spec,state:{...base.state,...spec.state}};
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
async function saveDialog(page){await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);}
async function readerText(page,index,text){
  await page.waitForFunction(({index,text})=>{const host=document.querySelector('[data-smart-index="'+index+'"]');return host?.dataset.smartReady==='true'&&[...host.querySelectorAll('text')].some(node=>node.textContent===text);},{index,text});
}
async function readerSubmit(page,index,handle,value){
  const point=await page.locator('[data-smart-index="'+index+'"]').evaluate((host,handle)=>{
    const point=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:point.x,y:point.y};
  },handle);
  await page.mouse.click(point.x,point.y);const input=page.locator('#smartTextValue');await input.waitFor();
  await input.fill(value);await input.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#smartTextValue')?.readOnly===false);
  await input.press('Escape');await input.waitFor({state:'detached'});
}
async function exported(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-native-data-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'native-data.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);return {reader,errors,requests};
}

test('JSON and date tools are placeable built-ins with inert previews and typed authoring controls',async()=>app(async({page,run})=>{
  const definitions=[['jsonExtract','JSON extract','json-extract'],['jsonBuild','JSON build','json-build'],['dateParse','Date parse','date-parse'],['dateFormat','Date format','date-format'],['dateDifference','Date difference','date-difference'],['jsonEdit','JSON edit','json-edit']];
  for(const [index,[key,name,file]] of definitions.entries()){
    assert.equal(await run(`BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===${JSON.stringify(key)}).items[0].script.trim()`),fs.readFileSync(path.join(root,'examples',file+'.js'),'utf8').trim());
    if(await page.locator('#shapePicker').isHidden())await page.locator('#shapeLibBtn').click();
    if(await page.locator('#libraryBrowser').isHidden())await page.locator('#browseShapesBtn').click();
    await page.locator('#librarySearch').fill(name);
    const tile=page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place '+name,exact:true});
    const thumbnail=tile.locator('img');await thumbnail.waitFor();assert.match(await thumbnail.getAttribute('src'),/^data:image\/png;base64,/);
    assert.ok(await thumbnail.evaluate(async image=>{await image.decode();return image.naturalWidth>0&&image.naturalHeight>0;}));
    await tile.click();const box=await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x+240+(index%3)*440,box.y+200+Math.floor(index/3)*300);await run('shapePlacementQueue');
    assert.equal(await run(`items[${index}].componentName`),name);assert.equal((await record(run,index)).error,null);
  }
  const caps=await run('(async()=>Promise.all(items.map(item=>requestSmartCaps(item))))()');
  assert.equal(caps[0].outputs.value.type,'string');assert.equal(caps[0].outputs.found.type,'boolean');
  assert.equal(caps[1].inputs.field0.type,'string');assert.equal(caps[1].inputs.field1.type,'number');
  assert.equal(caps[2].outputs.timestamp.type,'number');assert.equal(caps[3].inputs.timezone.type,'string');assert.equal(caps[4].outputs.value.type,'number');
  assert.equal(caps[5].inputs.text.type,'string');assert.equal(caps[5].inputs.field0.label,'/name');assert.equal(caps[5].outputs.valid.type,'boolean');
  await inputDialog(page,run,0);await page.locator('#component-setting-resultType').selectOption('number');
  await page.getByLabel('text value',{exact:true}).fill('{"items":[2.8]}');await page.getByLabel('pointer value',{exact:true}).fill('/items/0');
  await saveDialog(page);assert.deepEqual(await output(run,0),{value:2.8,found:true,valid:true});
  assert.equal(await run('(async()=>{const caps=await requestSmartCaps(items[0]);return caps.outputs.value.type;})()'),'number');
  await inputDialog(page,run,1);await page.locator('#component-setting-fields').fill('label:string\nactive:boolean\npayload:json');
  await page.locator('#component-setting-fields').press('Tab');await page.getByLabel('payload value',{exact:true}).waitFor();
  await page.getByLabel('label value',{exact:true}).fill('A😀');await page.getByLabel('active value',{exact:true}).selectOption('true');
  await page.getByLabel('payload value',{exact:true}).fill('[1,"<b>literal</b>"]');await saveDialog(page);
  assert.deepEqual(await output(run,1),{text:'{"label":"A😀","active":true,"payload":[1,"<b>literal</b>"]}',valid:true});
  await inputDialog(page,run,3);await page.locator('#component-setting-format').selectOption('ISO (UTC)');
  await page.getByLabel('timestamp value',{exact:true}).fill('0');await saveDialog(page);
  assert.deepEqual(await output(run,3),{text:'1970-01-01T00:00:00.000Z',valid:true});
}));

test('JSON field names label the inspector and wires while renaming preserves stable connections through reload and offline export',async()=>app(async({page,run,context})=>{
  await seed(run,[
    {key:'textInput',componentName:'Customer name',state:{values:['Anna']}},
    {key:'jsonBuild',componentName:'Customer JSON',state:{fields:'name:string\namount:number'},inputValues:{field1:42},bindings:{field0:{uid:'native-0',port:'value'}}},
    {key:'jsonExtract',componentName:'Renamed field',inputValues:{pointer:'/customer'},bindings:{text:{uid:'native-1',port:'text'}}},
    {key:'textLabel',componentName:'Received customer',bindings:{value:{uid:'native-2',port:'value'}}}
  ]);
  const connection={uid:'native-0',port:'value'};
  assert.deepEqual(await output(run,1),{text:'{"name":"Anna","amount":42}',valid:true});
  await inputDialog(page,run,1);
  assert.equal(await page.getByLabel('name (string)',{exact:true}).inputValue(),JSON.stringify(connection));
  assert.equal(await page.getByLabel('amount value',{exact:true}).inputValue(),'42');
  await page.locator('#component-setting-fields').fill('customer:string\nscore:number');
  await page.locator('#component-setting-fields').press('Tab');
  await page.getByLabel('customer (string)',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('customer (string)',{exact:true}).inputValue(),JSON.stringify(connection),'renaming a field retains the selected source');
  assert.equal(await page.getByLabel('score value',{exact:true}).inputValue(),'42','renaming retains the literal value in the same slot');
  await saveDialog(page);
  assert.deepEqual(await run('items[1].bindings'),{field0:connection},'bindings use stable field IDs rather than user-visible JSON keys');
  assert.deepEqual(await output(run,1),{text:'{"customer":"Anna","score":42}',valid:true});
  const assertWireLabel=async()=>{
    await run('setComponentWiringMode(true);renderComponentWiring()');
    const wire=page.locator('#componentWiringOverlay [data-wire-port][data-uid="native-1"][data-port="field0"][data-direction="in"]');
    await wire.waitFor({state:'visible'});
    assert.match(await wire.getAttribute('aria-label'),/customer/);
    assert.match(await wire.locator('title').textContent(),/customer/);
    assert.match(await wire.locator('text').textContent(),/^customer(?: · .+)?$/);
    assert.doesNotMatch(await wire.getAttribute('aria-label'),/field0/,'internal slot ID is not presented as the field name');
    await run('setComponentWiringMode(false)');
  };
  await assertWireLabel();
  await page.reload();await run('appStarted');
  assert.deepEqual(await run('items[1].bindings'),{field0:connection});
  assert.deepEqual(await output(run,1),{text:'{"customer":"Anna","score":42}',valid:true});
  await inputDialog(page,run,1);
  assert.equal(await page.getByLabel('customer (string)',{exact:true}).inputValue(),JSON.stringify(connection));
  await page.locator('#componentBindingsCancel').click();
  await assertWireLabel();
  const handle=await run(`(async()=>{const item=items[0],io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='entry');})()`);
  const {reader,errors,requests}=await exported(page,run,context);
  await readerText(reader,3,'Anna');
  await readerSubmit(reader,0,handle,'Beth');
  await readerText(reader,3,'Beth');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'renamed fields remain connected in the offline reader');
}));

test('JSON edit exposes typed path labels, keeps retargeted wires through reload and edits live JSON in offline HTML',async()=>app(async({page,run,context})=>{
  const initial={name:'Original',customer:'Before',meta:{score:10},keep:[true,null,'untouched']};
  await seed(run,[
    {key:'textInput',componentName:'Incoming JSON',state:{values:[JSON.stringify(initial)]}},
    {key:'textInput',componentName:'Replacement name',state:{values:['Anna']}},
    {key:'jsonEdit',componentName:'Edited customer',state:{fields:'/name:string\n/meta/score:number'},inputValues:{field1:42},bindings:{text:{uid:'native-0',port:'value'},field0:{uid:'native-1',port:'value'}}},
    {key:'jsonExtract',componentName:'Received customer',inputValues:{pointer:'/customer'},bindings:{text:{uid:'native-2',port:'text'}}},
    {key:'textLabel',componentName:'Customer',bindings:{value:{uid:'native-3',port:'value'}}},
    {key:'statusIndicator',componentName:'Edited JSON valid',bindings:{value:{uid:'native-2',port:'valid'}}}
  ]);
  const connection={uid:'native-1',port:'value'};
  assert.deepEqual(await output(run,2),{text:JSON.stringify({...initial,name:'Anna',meta:{score:42}}),valid:true});
  await inputDialog(page,run,2);
  assert.equal(await page.getByLabel('/name (string)',{exact:true}).inputValue(),JSON.stringify(connection));
  assert.equal(await page.getByLabel('/meta/score value',{exact:true}).inputValue(),'42');
  await page.locator('#component-setting-fields').fill('/customer:string\n/meta/score:number');
  await page.locator('#component-setting-fields').press('Tab');
  await page.getByLabel('/customer (string)',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('/customer (string)',{exact:true}).inputValue(),JSON.stringify(connection),'retargeting keeps the connection attached to its stable slot');
  assert.equal(await page.getByLabel('/meta/score value',{exact:true}).inputValue(),'42');
  await saveDialog(page);
  const expected={text:JSON.stringify({...initial,customer:'Anna',meta:{score:42}}),valid:true};
  assert.deepEqual(await output(run,2),expected,'unselected keys, arrays and values are preserved');
  assert.deepEqual(await run('items[2].bindings.field0'),connection);
  await run('setComponentWiringMode(true);renderComponentWiring()');
  const wire=page.locator('#componentWiringOverlay [data-wire-port][data-uid="native-2"][data-port="field0"][data-direction="in"]');
  await wire.waitFor({state:'visible'});
  assert.match(await wire.getAttribute('aria-label'),/\/customer/);
  assert.match(await wire.locator('text').textContent(),/^\/customer(?: · .+)?$/);
  await run('setComponentWiringMode(false)');
  await page.reload();await run('appStarted');
  assert.deepEqual(await run('items[2].bindings.field0'),connection);
  assert.deepEqual(await output(run,2),expected);
  await inputDialog(page,run,2);
  assert.equal(await page.getByLabel('/customer (string)',{exact:true}).inputValue(),JSON.stringify(connection));
  await page.locator('#componentBindingsCancel').click();
  await page.waitForFunction(()=>__test.run('componentDialogSession===null'));
  const handles=await run(`(async()=>Promise.all(items.slice(0,2).map(async item=>{const io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='entry');})))()`);
  const {reader,errors,requests}=await exported(page,run,context);
  await readerText(reader,4,'Anna');await readerText(reader,5,'ON');
  await readerSubmit(reader,1,handles[1],'Beth <em>');await readerText(reader,4,'Beth <em>');
  assert.equal(await reader.locator('[data-smart-index="4"] em').count(),0,'patched strings remain literal text');
  await readerSubmit(reader,0,handles[0],'{"meta":{"score":5}}');await readerText(reader,5,'OFF');
  assert.equal(await reader.locator('[data-component-error]').count(),0,'a missing path is a recoverable invalid signal');
  await readerSubmit(reader,0,handles[0],'{');await readerText(reader,5,'OFF');
  await readerSubmit(reader,0,handles[0],JSON.stringify(initial));await readerText(reader,5,'ON');await readerText(reader,4,'Beth <em>');
  await reader.reload();await readerText(reader,4,'Anna');
  assert.deepEqual(await output(run,2),expected,'reader changes do not mutate the authoring document');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'JSON editing works offline without external dependencies');
}));

test('JSON edit replaces only existing own paths and recovers from malformed or missing data in real Workers',async()=>app(async({run})=>{
  await seed(run,[{key:'jsonEdit'}]);
  const replace=async(text,fields,values)=>setInputs(run,0,{text,...values},{fields});
  assert.deepEqual(await replace('{"items":[{"price":1.2}],"other":null}','/items/0/price:number',{field0:2.8}),{error:null,outputs:{text:'{"items":[{"price":2.8}],"other":null}',valid:true}});
  assert.deepEqual(await replace('{"a/b":{"~key":false},"keep":true}','/a~1b/~0key:boolean',{field0:true}),{error:null,outputs:{text:'{"a/b":{"~key":true},"keep":true}',valid:true}});
  assert.deepEqual(await replace('{"__proto__":{"safe":false}}','/__proto__/safe:boolean',{field0:true}),{error:null,outputs:{text:'{"__proto__":{"safe":true}}',valid:true}});
  for(const [text,fields,field0] of [
    ['{}','/constructor:string','blocked'],['{"items":[0]}','/items/1:number',9],
    ['{"items":[0]}','/items/01:number',9],['{"name":null}','/name/child:string','blocked'],
    ['{','/name:string','replacement'],['{"name":1e999}','/name:string','replacement'],
    ['{"name":"old"}','/name:json','[']
  ])assert.deepEqual(await replace(text,fields,{field0}),{error:null,outputs:{text:'',valid:false}},fields+' with '+text);
  assert.deepEqual(await replace('{"name":"old","keep":1}','/name:json',{field0:'{"nested":[true,null]}'}),{error:null,outputs:{text:'{"name":{"nested":[true,null]},"keep":1}',valid:true}});
  assert.deepEqual(await replace('{"name":"old"}','/name:string',{field0:'recovered'}),{error:null,outputs:{text:'{"name":"recovered"}',valid:true}});
}));

test('JSON extraction and building enforce pointers, types, output limits and recovery in real Workers',async()=>app(async({run})=>{
  await seed(run,[{key:'jsonExtract'},{key:'jsonBuild'}]);
  for(const [text,pointer,resultType,value,found,valid] of [
    ['{"a/b":{"~key":"A😀"}}','/a~1b/~0key','string','A😀',true,true],
    ['[true,false]','/0','boolean',true,true,true],['[true,false]','/01','boolean',false,false,false],
    ['{}','/constructor','JSON','',false,false],['{"__proto__":{"ok":true}}','/__proto__/ok','boolean',true,true,true],
    ['{"a":null}','/a','JSON','null',true,true],['{"a":null}','/a','number',0,true,false],
    ['{','/a','number',0,false,false],['{"a":1e999}','/a','number',0,false,false]
  ])assert.deepEqual(await setInputs(run,0,{text,pointer},{resultType}),{error:null,outputs:{value,found,valid}});
  assert.deepEqual(await setInputs(run,1,{field0:'{"x":[1,true,null]}',field1:'😀'},{fields:'data:json\ntext:string'}),{error:null,outputs:{text:'{"data":{"x":[1,true,null]},"text":"😀"}',valid:true}});
  assert.deepEqual(await setInputs(run,1,{field0:'[',field1:'ok'}),{error:null,outputs:{text:'',valid:false}});
  assert.deepEqual(await setInputs(run,1,{field0:'{"x":1e999}',field1:'ok'}),{error:null,outputs:{text:'',valid:false}});
  const tooLong=await setInputs(run,1,{field0:'x'.repeat(1993)},{fields:'a:string'});
  assert.match(tooLong.error,/2000|2,000/);assert.deepEqual(tooLong.outputs,{});
  assert.deepEqual(await setInputs(run,1,{field0:'recovered'}),{error:null,outputs:{text:'{"a":"recovered"}',valid:true}});
}));

test('date components use explicit timestamps, IANA timezones, signed elapsed time and recoverable invalid signals in Workers',async()=>app(async({run})=>{
  await seed(run,[{key:'dateParse'},{key:'dateFormat'},{key:'dateDifference'}]);
  for(const [text,timestamp,valid] of [
    ['2024-02-29',1709164800000,true],['2026-10-19T14:34:56.789+02:00',1792413296789,true],
    ['2025-02-29',0,false],['2026-10-19T12:00:00',0,false],['10/19/2026',0,false],['',0,false]
  ])assert.deepEqual(await setInputs(run,0,{text}),{error:null,outputs:{timestamp,valid}},text);
  const timestamp=Date.parse('2026-03-29T01:30:00Z');
  assert.deepEqual(await setInputs(run,1,{timestamp,timezone:'Europe/Berlin'}),{error:null,outputs:{text:'2026-03-29 03:30:00',valid:true}});
  assert.deepEqual(await setInputs(run,1,{timestamp,timezone:'America/New_York'},{format:'time'}),{error:null,outputs:{text:'21:30:00',valid:true}});
  assert.deepEqual(await setInputs(run,1,{timestamp,timezone:'Invalid/Timezone'}),{error:null,outputs:{text:'',valid:false}});
  assert.deepEqual(await setInputs(run,1,{timestamp,timezone:'UTC'},{format:'ISO (UTC)'}),{error:null,outputs:{text:'2026-03-29T01:30:00.000Z',valid:true}});
  assert.deepEqual(await setInputs(run,2,{start:2500,end:1000,unit:'seconds'}),{error:null,outputs:{value:-1.5,valid:true}});
  assert.deepEqual(await setInputs(run,2,{start:0,end:9000000000000000,unit:'days'}),{error:null,outputs:{value:0,valid:false}});
  assert.deepEqual(await setInputs(run,2,{start:Date.parse('2026-03-29T00:00:00+01:00'),end:Date.parse('2026-03-30T00:00:00+02:00'),unit:'hours'}),{error:null,outputs:{value:23,valid:true}},'elapsed time respects explicit offsets across a DST transition');
}));

test('connected JSON and date tools update from reader input and round-trip Unicode and markup offline',async()=>app(async({page,run,context})=>{
  const initial={message:'A😀<em>',when:'2026-10-19T12:34:56.789Z'},initialText=JSON.stringify(initial);
  await seed(run,[
    {key:'textInput',componentName:'Incoming JSON',state:{values:[initialText]}},
    {key:'jsonExtract',componentName:'Message',inputValues:{pointer:'/message'},bindings:{text:{uid:'native-0',port:'value'}}},
    {key:'textLabel',componentName:'Literal message',bindings:{value:{uid:'native-1',port:'value'}}},
    {key:'jsonExtract',componentName:'Incoming date',inputValues:{pointer:'/when'},bindings:{text:{uid:'native-0',port:'value'}}},
    {key:'dateParse',componentName:'Parsed timestamp',bindings:{text:{uid:'native-3',port:'value'}}},
    {key:'dateFormat',componentName:'ISO date',state:{format:'ISO (UTC)'},bindings:{timestamp:{uid:'native-4',port:'timestamp'}}},
    {key:'textLabel',componentName:'Formatted date',w:440,bindings:{value:{uid:'native-5',port:'text'}}},
    {key:'jsonBuild',componentName:'Reply JSON',state:{fields:'message:string\nwhen:string'},bindings:{field0:{uid:'native-1',port:'value'},field1:{uid:'native-5',port:'text'}}},
    {key:'jsonExtract',componentName:'Round-trip message',inputValues:{pointer:'/message'},bindings:{text:{uid:'native-7',port:'text'}}},
    {key:'textLabel',componentName:'Round-trip text',bindings:{value:{uid:'native-8',port:'value'}}},
    {key:'statusIndicator',componentName:'Date valid',bindings:{value:{uid:'native-4',port:'valid'}}}
  ]);
  assert.deepEqual(await output(run,7),{text:initialText,valid:true});
  const handle=await run(`(async()=>{const item=items[0],io=await resolveSmartComponentIo(item);return (await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io])).find(handle=>handle.id==='entry');})()`);
  const {reader,errors,requests}=await exported(page,run,context);
  await readerText(reader,2,initial.message);await readerText(reader,6,initial.when);await readerText(reader,9,initial.message);await readerText(reader,10,'ON');
  assert.equal(await reader.locator('[data-smart-index="2"] em').count(),0,'JSON text is rendered literally');
  const changed={message:'B"\\é',when:'2024-02-29T10:20:30+02:00'};
  await readerSubmit(reader,0,handle,JSON.stringify(changed));
  await readerText(reader,2,changed.message);await readerText(reader,6,'2024-02-29T08:20:30.000Z');await readerText(reader,9,changed.message);
  await readerSubmit(reader,0,handle,JSON.stringify({...changed,when:'2025-02-29'}));await readerText(reader,10,'OFF');
  await readerSubmit(reader,0,handle,'{');await readerText(reader,10,'OFF');
  assert.equal(await reader.locator('[data-component-error]').count(),0,'invalid external JSON is represented by typed validity signals');
  await readerSubmit(reader,0,handle,initialText);await readerText(reader,6,initial.when);await readerText(reader,9,initial.message);await readerText(reader,10,'ON');
  await reader.reload();await readerText(reader,9,initial.message);
  assert.deepEqual(await output(run,7),{text:initialText,valid:true},'reader edits do not mutate the editor');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'JSON, dates and timezone formatting require no network or external library');
}));
