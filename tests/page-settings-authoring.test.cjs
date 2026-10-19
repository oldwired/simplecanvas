const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');

// Only the served fixture exposes the editor closure. Capability validation and
// computation still use production Workers; placement and inspectors use real UI.
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const script=fs.readFileSync(path.join(root,'examples','page-settings.js'),'utf8');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1100}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://page-settings.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://page-settings.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return await __test.run(source);},source);
    await run('appStarted');await fn({page,run});assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function seed(run,specs=[{key:'pageSettings'}]){
  await run(`cancelGesture();items=normalizeScene(${JSON.stringify(specs)}.map((spec,index)=>{
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(definition=>definition.key===spec.key).items[0]);
    return {...base,uid:'page-settings-'+index,x:100+index*360,y:180,...spec,state:{...base.state,...spec.state}};
  }),{},FORMAT_VERSION,{}).items;selection=[];editingSmartIdx=null;undoStack=[];redoStack=[];historyBefore=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
async function inspector(page,run,index=0){
  await run(`selection=[${index}];editingSmartIdx=null;render();void openComponentBindings();`);
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open&&!document.querySelector('#componentBindingFields').disabled);
}
const snapshot=run=>run('({items:JSON.stringify(items),undo:undoStack.length,redo:redoStack.length})');
const errorOf=async(run,source)=>run(`(async()=>{try{await (${source});return null;}catch(error){return error.message;}})()`);

test('Page settings is a placeable builtin with a real thumbnail, labelled inspector and persistent host capability',async()=>app(async({page,run})=>{
  const definition=await run('BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==="pageSettings")');
  assert.ok(definition);assert.equal(definition.name,'Page settings');assert.equal(definition.items[0].script.trim(),script.trim());
  await page.locator('#shapeLibBtn').click();await page.locator('#browseShapesBtn').click();await page.locator('#librarySearch').fill('Page settings');
  const tile=page.locator('#libraryBrowserGrid').getByRole('button',{name:'Place Page settings',exact:true}),thumbnail=tile.locator('img');
  await thumbnail.waitFor();assert.match(await thumbnail.getAttribute('src'),/^data:image\/png;base64,/);
  assert.ok(await thumbnail.evaluate(async image=>{await image.decode();return image.naturalWidth>0&&image.naturalHeight>0;}));
  await tile.click();const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+320,box.y+300);await run('shapePlacementQueue');
  const item=await run('items[0]');assert.equal(item.componentName,'Page settings');assert.equal(item.pageSettings,true);
  const caps=await run('requestSmartCaps(items[0])');assert.deepEqual(caps.pageSettings,{title:'title',showTabs:'showTabs',showWiring:'showWiring',showSimulationControls:'showSimulationControls'});
  assert.deepEqual(definition.ports,{inputs:caps.inputs,outputs:caps.outputs});
  const first=await run('activeTabId');await run(`newTab();activateTab(${JSON.stringify(first)});`);
  const title=await page.title();
  await inspector(page,run);
  for(const label of ['Window title','Show tab bar','Show wiring','Show simulation controls'])await page.getByLabel(label+' value',{exact:true}).waitFor();
  await page.getByLabel('Window title value',{exact:true}).fill('Reader-only title');
  for(const label of ['Show tab bar','Show wiring','Show simulation controls'])await page.getByLabel(label+' value',{exact:true}).selectOption('false');
  await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  await run('ensureEditorComponentGraph()');
  assert.deepEqual(await run('items[0].inputValues'),{title:'Reader-only title',showTabs:false,showWiring:false,showSimulationControls:false});
  assert.equal(await page.title(),title,'page presentation does not replace the authoring application title');
  await page.locator('#tabbar').waitFor({state:'visible'});await page.locator('#componentSimulation').waitFor({state:'visible'});
  await page.locator('#componentWiringBtn').click();await page.waitForFunction(()=>__test.run('componentWiring.enabled'));
  await page.locator('#componentWiringOverlay [data-wire-port][data-port="title"]').waitFor({state:'visible'});
  await run('setComponentWiringMode(false);save()');await page.reload();await run('appStarted');
  assert.equal(await run('items[0].pageSettings'),true);assert.equal((await run('requestSmartCaps(items[0])')).pageSettings.title,'title');
  assert.equal(await run('items[0].inputValues.title'),'Reader-only title');
  await inspector(page,run);assert.equal(await page.getByLabel('Window title value',{exact:true}).inputValue(),'Reader-only title');
  await page.locator('#componentBindingsCancel').click();
}));

test('a second Page settings cannot be placed, duplicated or pasted into the same tab and leaves history intact',async()=>app(async({page,run})=>{
  await seed(run);const before=await snapshot(run);
  await run('placeShapeAt(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key==="pageSettings"),700,400);shapePlacementQueue');
  assert.deepEqual(await snapshot(run),before,'library placement cannot add a competing controller');
  await run('selection=[0];duplicateSelection()');assert.deepEqual(await snapshot(run),before,'Duplicate selection is atomic');
  assert.match(await errorOf(run,'duplicateItemsInPlace([0])'),/only one Page settings/);
  assert.deepEqual(await snapshot(run),before,'the drag duplication primitive also rejects the copy');
  const box=await page.locator('#canvas').boundingBox();
  await page.keyboard.down('Meta');await page.mouse.move(box.x+250,box.y+260);await page.mouse.down();await page.mouse.move(box.x+330,box.y+300,{steps:5});await page.mouse.up();await page.keyboard.up('Meta');await run('smartHitSettled');
  assert.deepEqual(await snapshot(run),before,'modifier-drag cannot silently duplicate or move the original');
  await run('selection=[0];copySelection()');assert.equal(await run('pasteClipboard()'),false);assert.deepEqual(await snapshot(run),before);
  const payload=await run('JSON.stringify({app:"SimpleCanvas",kind:"objects",version:FORMAT_VERSION,items:clone(items),assets:{},datasets:{}})');
  assert.equal(await run(`pasteObjectPayload(${JSON.stringify(payload)})`),true,'recognized but rejected objects must not fall back to an unrelated clipboard image');
  assert.deepEqual(await snapshot(run),before);
}));

test('copying Page settings to an empty tab is allowed and remains independent through undo and reload',async()=>app(async({page,run})=>{
  await seed(run,[{key:'pageSettings',inputValues:{title:'Copied configuration',showTabs:false,showWiring:true,showSimulationControls:false}}]);
  const original=await run('({tab:activeTabId,item:clone(items[0])})');
  await run('selection=[0];copySelection();newTab()');assert.equal(await run('pasteClipboard()'),true);
  assert.equal(await run('items.length'),1);assert.equal(await run('items[0].pageSettings'),true);assert.notEqual(await run('items[0].uid'),original.item.uid);
  assert.deepEqual(await run('items[0].inputValues'),original.item.inputValues);
  assert.equal(await run('(async()=>{const r=(await ensureEditorComponentGraph()).get(items[0]);return r.error||null;})()'),null);
  await run('undo()');assert.equal(await run('items.length'),0);await run('redo()');assert.equal(await run('items[0].pageSettings'),true);
  await page.reload();await run('appStarted');assert.equal(await run('items[0].pageSettings'),true);assert.equal(await run('items[0].inputValues.title'),'Copied configuration');
  await run(`activateTab(${JSON.stringify(original.tab)})`);assert.deepEqual(await run('items[0]'),original.item,'pasting does not mutate the original tab');
}));

test('imported duplicate controllers both report errors while a persisted marker alone grants no capability',async()=>app(async({run})=>{
  await seed(run,[{key:'pageSettings'},{key:'pageSettings',inputValues:{title:'Competing title'}},{key:'constant',state:{value:7}}]);
  await run('(()=>{const scene=normalizeScene(clone(items),{},FORMAT_VERSION,{});applySketchToActiveTab(scene.items,scene.assets,activeTabId,scene.datasets);})()');
  const records=await run('(async()=>{const graph=await ensureEditorComponentGraph();return items.map(item=>{const r=graph.get(item);return {error:r.error||null,outputs:r.io.outputs,pageSettings:!!r.caps?.pageSettings};});})()');
  assert.match(records[0].error,/only one Page settings/);assert.match(records[1].error,/only one Page settings/);
  assert.equal(records[2].error,null);assert.equal(records[2].outputs.value,7);
  await seed(run,[{key:'pageSettings'},{key:'constant',pageSettings:true,state:{value:7}}]);
  const hinted=await run('(async()=>{const graph=await ensureEditorComponentGraph();return items.map(item=>{const r=graph.get(item);return {error:r.error||null,outputs:r.io.outputs,pageSettings:!!r.caps?.pageSettings};});})()');
  assert.equal(hinted[0].error,null);assert.equal(hinted[0].pageSettings,true);
  assert.equal(hinted[1].error,null);assert.equal(hinted[1].pageSettings,false);assert.equal(hinted[1].outputs.value,7);
}));

test('Worker capability validation rejects malformed mappings, incompatible ports and stateful or signal-producing controllers',async()=>app(async({run})=>{
  const base=`({apiVersion:2,inputs:{title:{type:'string',default:''},showTabs:{type:'boolean',default:true},showWiring:{type:'boolean',default:false},showSimulationControls:{type:'boolean',default:true}},outputs:{},pageSettings:{title:'title',showTabs:'showTabs',showWiring:'showWiring',showSimulationControls:'showSimulationControls'},compute(){return {};},children(){return [];}})`;
  const cases=[
    [base.replace("title:'title',showTabs", "title:'missing',showTabs"),/distinct string input/],
    [base.replace("showTabs:'showTabs'", "showTabs:'title'"),/distinct boolean input/],
    [base.replace("showWiring:'showWiring'", "showWiring:'showTabs'"),/distinct boolean input/],
    [base.replace("showSimulationControls:'showSimulationControls'", "extra:'showSimulationControls'"),/title and three visibility inputs/],
    [base.replace("title:{type:'string',default:''}","title:{type:'string',default:'',optional:true}"),/Only table inputs may be optional/],
    [base.replace('outputs:{}',"outputs:{value:{type:'number'}}"),/without outputs or actions/],
    [base.replace('compute(){return {};}', 'publish(){return {};},transition(){return {};}'),/compute-only/],
    [base.replace('children(){',"dataActions:{go:{type:'goToTab',input:'page',trigger:'showTabs'}},children(){").replace("inputs:{title:","inputs:{page:{type:'number',default:0},title:"),/without outputs or actions/]
  ];
  for(const [script,pattern] of cases){
    const message=await errorOf(run,`(async()=>{const item={type:'smart',componentApi:2,uid:newUid(),state:{},script:${JSON.stringify(script)}},owner=createSmartExecution(item);try{return await requestSmartSandbox({method:'caps',src:item.script,args:[item.state]},item,owner);}finally{disposeSmartExecution(owner);}})()`);
    assert.match(message||'',pattern);
  }
  const caps=await run(`requestSmartCaps({type:'smart',componentApi:2,uid:newUid(),state:{},script:${JSON.stringify(base)}})`);
  assert.equal(caps.pageSettings.title,'title');
}));
