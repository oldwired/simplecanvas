const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const html=parseApp(fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});

async function app(fn,{width=1440,height=1000}={}){
  const context=await browser.newContext({viewport:{width,height}}),errors=[],confirmations=[];
  let acceptConfirm=true;
  try{
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>{
      if(dialog.type()==='confirm'){confirmations.push(dialog.message());return acceptConfirm?dialog.accept():dialog.dismiss();}
      return dialog.accept();
    });
    await page.route('http://inspector-ux.test/**',route=>route.fulfill(route.request().url().endsWith('/index.html')?
      {contentType:'text/html',body:html}:{status:404,body:''}));
    await page.goto('http://inspector-ux.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,confirmations,setConfirm:value=>{acceptConfirm=value;}});
    assert.deepEqual(errors,[],'no uncaught inspector errors');
  }finally{await context.close();}
}
async function seed(run,specs,pool={}){
  await run(`cancelGesture();datasets=normalizeDatasets(${JSON.stringify(pool)});
    const specs=${JSON.stringify(specs)};
    items=specs.map((spec,index)=>{const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===spec.key).items[0]);
      return {...base,x:60+index*260,y:140,uid:'ux-'+index,...spec,state:{...base.state,...spec.state}};});
    selection=[];editingSmartIdx=null;undoStack=[];redoStack=[];historyBefore=null;setTool('select');render();save();
    ensureEditorComponentGraph();`);
}
async function open(page,run,index){
  await run(`setTool('select');selection=[${index}];editingSmartIdx=null;render()`);await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open && !document.querySelector('#componentBindingFields').disabled);
}
async function preview(page,parts){
  await page.waitForFunction(parts=>{
    const output=document.querySelector('#componentOutputs');
    return output.getAttribute('aria-busy')!=='true' && parts.every(part=>output.textContent.includes(part));
  },parts);
}
async function save(page){await page.locator('#componentBindingsSave').click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);}
async function state(run){return run('({items:clone(items),datasets:clone(datasets),undo:clone(undoStack),redo:clone(redoStack)})');}
const connection=(page,name)=>page.locator('[data-component-connection="'+name+'"]');
const sourceValue=(uid,port)=>JSON.stringify({uid,port});

test('filtering dropdown preserves committed identities, shows source values and restores literal drafts when disconnected',async()=>app(async({page,run})=>{
  await seed(run,[{key:'numberControl',componentName:'Level',state:{value:11}},
    {key:'numberControl',componentName:'Level',state:{value:78}},
    {key:'constant',componentName:'Limit',state:{value:100}},
    {key:'textInput',componentName:'Wrong type'},
    {key:'valueLabel',componentName:'Display',inputValues:{value:5}}]);
  await open(page,run,4);const before=await state(run);
  const source=page.getByLabel('value (number)',{exact:true}),literal=page.getByLabel('value value',{exact:true});
  const options=await source.locator('option').allTextContents();
  assert.ok(options.includes('Level #1 (left) · value'));assert.ok(options.includes('Level #2 (right) · value'));
  assert.ok(!options.some(label=>label.includes('Wrong type')),'only compatible sources are offered');
  await literal.fill('7');await source.selectOption(sourceValue('ux-1','value'));await preview(page,['value = 78']);
  assert.match(await connection(page,'value').textContent(),/Level #2/);assert.match(await connection(page,'value').textContent(),/78/);
  assert.equal(await page.getByRole('button',{name:'Search sources for value',exact:true}).count(),0,'no separate Search action');
  await source.click();
  const search=page.getByLabel('Filter sources for value',{exact:true});await search.fill('Level #1');
  assert.equal(await source.inputValue(),sourceValue('ux-1','value'));
  const filtered=await page.getByRole('listbox').getByRole('option').allTextContents();
  assert.ok(filtered.some(label=>label.includes('Level #1')));
  assert.ok(!filtered.some(label=>label.includes('Limit')));
  await search.fill('no matching source');assert.equal(await source.inputValue(),sourceValue('ux-1','value'));
  await search.press('Escape');assert.equal(await search.isVisible(),false);
  assert.equal(await page.locator('#componentBindingsDialog').evaluate(el=>el.open),true,'Escape closes the popup rather than Edit');
  assert.equal(await source.evaluate(el=>document.activeElement===el),true);
  for(const action of ['Go to source for value','Disconnect value']){
    const button=page.getByRole('button',{name:action,exact:true});
    const dimensions=await button.boundingBox();assert.ok(dimensions.width<=36&&Math.abs(dimensions.width-dimensions.height)<1,'connection action is a small square');
    assert.equal((await button.textContent()).trim(),'','connection actions have no text label');assert.equal(await button.locator('svg').count(),1);
    assert.match(await button.getAttribute('title'),action.startsWith('Go')?/Go to source/i:/Disconnect/i);
  }
  await page.getByRole('button',{name:'Disconnect value',exact:true}).click();await preview(page,['value = 7']);
  assert.equal(await literal.inputValue(),'7');assert.equal(await source.inputValue(),'');
  assert.deepEqual(await state(run),before,'all search, source and literal changes remain a pure draft');
  await page.locator('#componentBindingsCancel').click();assert.deepEqual(await state(run),before);
  await open(page,run,4);await source.selectOption(sourceValue('ux-1','value'));await save(page);
  assert.deepEqual(await run('items[4].bindings'),{value:{uid:'ux-1',port:'value'}});
  await run('undo()');assert.deepEqual(await run('items[4].inputValues'),{value:5});
}));

test('filtering dropdown supports keyboard selection and cancels filtering without changing a binding',async()=>app(async({page,run})=>{
  await seed(run,[{key:'constant',componentName:'First',state:{value:11}},
    {key:'constant',componentName:'Limit',state:{value:100}},
    {key:'valueLabel',componentName:'Display',bindings:{value:{uid:'ux-0',port:'value'}}}]);
  await open(page,run,2);const source=page.getByLabel('value (number)',{exact:true});
  await source.focus();await source.press('ArrowDown');
  const filter=page.getByLabel('Filter sources for value',{exact:true});await filter.fill('Limit');
  assert.equal(await source.inputValue(),sourceValue('ux-0','value'));
  await filter.press('ArrowDown');await filter.press('Enter');await preview(page,['value = 100']);
  assert.equal(await source.inputValue(),sourceValue('ux-1','value'));assert.equal(await filter.isVisible(),false);
  await source.click();await filter.fill('First');await page.locator('#componentNameInput').click();
  assert.equal(await filter.isVisible(),false);assert.equal(await source.inputValue(),sourceValue('ux-1','value'),'clicking away does not commit a filtered candidate');
  await source.focus();await source.press('F');assert.equal(await filter.inputValue(),'F','typing opens the filter without changing the committed value');await filter.press('Escape');
  assert.equal(await source.inputValue(),sourceValue('ux-1','value'));assert.equal(await page.locator('#componentBindingsDialog').evaluate(el=>el.open),true);
  await source.click();await filter.fill('First');await filter.press('Tab');assert.equal(await filter.isVisible(),false);
  assert.equal(await source.inputValue(),sourceValue('ux-1','value'));assert.equal(await source.evaluate(el=>document.activeElement===el),false,'Tab leaves the filtering control without committing a candidate');
  await save(page);assert.deepEqual(await run('items[2].bindings'),{value:{uid:'ux-1',port:'value'}});
}));

test('broken source, missing output and changed output type have local repair feedback',async()=>app(async({page,run})=>{
  const wrongType='({apiVersion:2,inputs:{},outputs:{value:{type:"string"}},compute(){return {value:"text"};},children(){return [];}})';
  const cases=[{uid:'deleted',port:'value'},{uid:'ux-0',port:'gone'},{uid:'ux-0',port:'value',script:wrongType}];
  for(const scenario of cases){
    await seed(run,[{key:'constant',componentName:'Source',...(scenario.script?{script:scenario.script}:{})},
      {key:'valueLabel',inputValues:{value:9},bindings:{value:{uid:scenario.uid,port:scenario.port}}}]);
    await open(page,run,1);
    const status=connection(page,'value');await status.waitFor();
    assert.match(await status.textContent(),/missing|unavailable|not found|no longer|incompatible|different type|type.*does not match/i);
    if(scenario.script)assert.match(await status.textContent(),/type|number|string|text|compatible/i);
    await page.getByRole('button',{name:'Disconnect value',exact:true}).click();await preview(page,['value = 9']);
    await save(page);assert.deepEqual(await run('items[1].bindings'),{});
  }
}));

test('Go to source locates a clean binding and protects unsaved inspector changes',async()=>app(async({page,run,confirmations,setConfirm})=>{
  await seed(run,[{key:'numberControl',componentName:'Source',state:{value:12}},
    {key:'valueLabel',componentName:'Display',bindings:{value:{uid:'ux-0',port:'value'}}}]);
  await open(page,run,1);await page.getByRole('button',{name:'Go to source for value',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  assert.deepEqual(await run('selection'),[0]);assert.equal(confirmations.length,0);
  await open(page,run,1);await page.locator('#componentNameInput').fill('Unsaved display');setConfirm(false);
  await page.getByRole('button',{name:'Go to source for value',exact:true}).click();
  assert.equal(confirmations.length,1);assert.equal(await page.locator('#componentBindingsDialog').evaluate(el=>el.open),true);
  assert.equal(await page.locator('#componentNameInput').inputValue(),'Unsaved display');
  setConfirm(true);await page.getByRole('button',{name:'Go to source for value',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  assert.deepEqual(await run('selection'),[0]);assert.equal(await run('items[1].componentName'),'Display');assert.equal(await run('undoStack.length'),0);
}));

test('table and separate event inputs share source discovery and disconnection controls',async()=>app(async({page,run})=>{
  const eventSource='({apiVersion:2,eventApi:1,inputs:{},outputs:{},eventOutputs:{sent:{type:"string",label:"Sent text"}},compute(){return {};},children(){return [];}})';
  const receiver='({apiVersion:2,eventApi:1,inputs:{data:{type:"table"}},outputs:{count:{type:"number"}},eventInputs:{message:{type:"string",label:"Message"}},compute(i,s,c){return {count:c.tables.data.rowCount};},onEvent(name,payload,state){return {state};},children(){return [];}})';
  const pool={fruit:{name:'Fruit',columns:[{key:'fruit',name:'Fruit',type:'string'}],rows:[['Apple'],['Pear']]}};
  await seed(run,[{key:'dataSource',componentName:'Fruit source',inputValues:{data:{datasetId:'fruit'}}},
    {key:'constant',componentName:'Announcements',script:eventSource,state:{}},
    {key:'constant',componentName:'Consumer',script:receiver,state:{},inputValues:{data:{datasetId:'fruit'}}}],pool);
  await open(page,run,2);
  const tableSource=page.getByLabel('data (table)',{exact:true});
  await tableSource.click();await page.getByLabel('Filter sources for data',{exact:true}).fill('Fruit');
  await page.getByRole('listbox').getByRole('option',{name:'Fruit source · data',exact:true}).click();await preview(page,['count = 2']);
  assert.match(await connection(page,'data').textContent(),/Fruit source/);assert.match(await connection(page,'data').textContent(),/2.*rows/i);
  const event=page.getByLabel('Message event',{exact:true});
  await event.click();await page.getByLabel('Filter sources for Message',{exact:true}).fill('Announcements');
  await page.getByRole('listbox').getByRole('option',{name:/Announcements/}).click();assert.match(await connection(page,'message').textContent(),/Announcements/);
  await page.getByRole('button',{name:'Disconnect Message',exact:true}).click();assert.equal(await event.inputValue(),'');
  await page.getByRole('button',{name:'Disconnect data',exact:true}).click();assert.equal(await page.getByLabel('data dataset',{exact:true}).inputValue(),JSON.stringify({datasetId:'fruit'}));
  await page.locator('#componentBindingsCancel').click();
}));

test('invalid scalar and configuration fields expose accessible errors and Save focuses the field',async()=>app(async({page,run})=>{
  const script='({apiVersion:2,settings:{slots:{type:"number",label:"Slots",default:2,min:1,max:5,step:1}},inputs:{value:{type:"number",default:2},enabled:{type:"boolean",default:false}},outputs:{value:{type:"number"}},compute(i){return {value:i.value};},children(){return [];}})';
  await seed(run,[{key:'constant',script,state:{slots:2},inputValues:{value:2,enabled:false}}]);await open(page,run,0);
  const value=page.getByLabel('value value',{exact:true}),slots=page.getByLabel('Slots',{exact:true});
  assert.equal(await page.locator('#componentBindingsForm').evaluate(form=>form.noValidate),true);
  await value.fill('');await page.waitForFunction(()=>document.querySelector('[aria-label="value value"]').getAttribute('aria-invalid')==='true');
  const errorText=await value.evaluate(input=>({ids:input.getAttribute('aria-describedby'),text:(input.getAttribute('aria-describedby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')}));
  assert.ok(errorText.ids);assert.match(errorText.text,/number|finite/i);
  assert.ok(await page.locator('[data-component-field-error]').count());
  await page.locator('#componentBindingsSave').click();assert.equal(await value.evaluate(el=>document.activeElement===el),true);
  await value.fill('3.5');await preview(page,['value = 3.5']);assert.notEqual(await value.getAttribute('aria-invalid'),'true');
  await slots.fill('0');await slots.dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('#component-setting-slots').getAttribute('aria-invalid')==='true');
  await slots.fill('3');await slots.dispatchEvent('change');await preview(page,['value = 3.5']);
  assert.notEqual(await slots.getAttribute('aria-invalid'),'true');await save(page);assert.equal(await run('items[0].state.slots'),3);
}));

test('narrow inspectors stay within the viewport and preserve the Spreadsheet dedicated editing model',async()=>app(async({page,run})=>{
  await seed(run,[{key:'numberControl',componentName:'Source'},
    {key:'valueLabel',componentName:'A long display name that must remain usable on narrow screens',bindings:{value:{uid:'ux-0',port:'value'}}},
    {key:'spreadsheet',componentName:'Sheet'}]);
  await open(page,run,1);await page.getByLabel('value (number)',{exact:true}).click();
  const popup=await page.getByRole('listbox').boundingBox();assert.ok(popup.x>=0&&popup.x+popup.width<=390&&popup.y>=0&&popup.y+popup.height<=780,'filtering list remains inside the viewport');
  const layout=await page.locator('#componentBindingsDialog').evaluate(dialog=>{
    const rect=dialog.getBoundingClientRect(),body=dialog.querySelector('.component-edit-body'),footer=dialog.querySelector('.component-edit-footer').getBoundingClientRect();
    return {left:rect.left,right:rect.right,width:innerWidth,overflow:body.scrollWidth-body.clientWidth,footerBottom:footer.bottom,height:innerHeight};
  });
  assert.ok(layout.left>=0&&layout.right<=layout.width+1);assert.ok(layout.overflow<=2,'no horizontal inspector overflow');assert.ok(layout.footerBottom<=layout.height);
  await page.getByLabel('Filter sources for value',{exact:true}).press('Escape');
  await page.locator('#componentBindingsCancel').click();await open(page,run,2);
  assert.equal(await page.locator('#componentTypeName').textContent(),'Spreadsheet');
  assert.equal(await page.locator('#componentConfigurationSection').isVisible(),false);
  assert.equal(await page.getByRole('heading',{name:'Table connections',exact:true}).count(),0);
  assert.equal(await page.locator('#componentTableRangesSection').count(),0);
  assert.deepEqual(await run('items[2].state.cells'),{});
  await page.locator('#componentBindingsCancel').click();
},{width:390,height:780}));


test('Receiver filtering and source icon navigate to the publishing sketch while protecting unsaved edits',async()=>app(async({page,run,confirmations,setConfirm})=>{
  const workspace=fs.readFileSync(path.join(__dirname,'..','examples','workspace-runtime.json'),'utf8');
  await run(`openWorkspaceFile(new File([${JSON.stringify(workspace)}],'runtime.json',{type:'application/json'}))`);
  await page.waitForFunction(()=>__test.run('tabs.some(tab=>tab.id==="runtime-dashboard")'));
  await run('ensureEditorComponentGraph()');
  const openReceiver=async()=>{
    await run('if(activeTabId!=="runtime-dashboard")enterTab("runtime-dashboard")');
    const index=await run('items.findIndex(item=>item.uid==="runtime-dashboard-clock")');assert.ok(index>=0,JSON.stringify(await run('({activeTabId,ids:items.map(item=>item.uid)})')));await open(page,run,index);
  };
  await openReceiver();
  const picker=page.getByRole('combobox',{name:'Published endpoint 1',exact:true});
  await picker.click();const filter=page.getByLabel('Filter sources for Published endpoint 1',{exact:true});await filter.fill('UTC time');
  assert.ok((await page.getByRole('listbox').getByRole('option').allTextContents()).some(text=>text.includes('Services / Publish time / UTC time')));
  await filter.press('Escape');
  const original=await run('clone(items.find(item=>item.uid==="runtime-dashboard-clock").workspaceReceive)');
  await picker.focus();await picker.press('ArrowDown');await filter.fill('Second tick');
  await filter.press('ArrowDown');await filter.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('#componentBindingFields').disabled);
  assert.equal(await picker.inputValue(),JSON.stringify({sketchId:'runtime-services',componentUid:'runtime-publish-time',port:'tick'}));
  assert.equal(await picker.evaluate(el=>document.activeElement===el),true,'keyboard selection keeps focus on the replacement endpoint picker after reconfiguration');
  assert.equal(await filter.isVisible(),false,'the filtering popup closes after committing an endpoint');
  const disconnect=page.getByRole('button',{name:'Disconnect Published endpoint 1',exact:true});
  assert.match(await disconnect.getAttribute('title'),/Disconnect/i);await disconnect.click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingFields').disabled);
  assert.equal(await picker.inputValue(),'');assert.equal(await page.locator('[data-workspace-endpoint-row]').count(),2,'disconnect preserves the local output definition');
  assert.deepEqual(await run('items.find(item=>item.uid==="runtime-dashboard-clock").workspaceReceive'),original,'disconnect remains a draft');
  await page.locator('#componentBindingsCancel').click();await openReceiver();
  assert.equal(await picker.inputValue(),JSON.stringify(original.value),'Cancel restores the endpoint mapping');
  const go=page.getByRole('button',{name:'Go to source for Published endpoint 1',exact:true});
  assert.match(await go.getAttribute('title'),/Go to source/i);await go.click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  assert.equal(await run('activeTabId'),'runtime-services');assert.equal(await run('items[selection[0]].uid'),'runtime-publish-time');assert.equal(confirmations.length,0,'filtering alone is not an unsaved edit');
  await run('persistWorkspace()');assert.equal(await run('(async()=> (await readSavedWorkspace()).workspace.activeId)()'),'runtime-services','source navigation persists the chosen sketch like a tab click');
  await page.reload();await run('appStarted');assert.equal(await run('activeTabId'),'runtime-services');
  await openReceiver();await page.locator('#componentNameInput').fill('Unsaved receiver');setConfirm(false);await go.click();
  assert.equal(confirmations.length,1);assert.equal(await run('activeTabId'),'runtime-dashboard');assert.equal(await page.locator('#componentBindingsDialog').evaluate(el=>el.open),true);
  setConfirm(true);await go.click();await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  assert.equal(await run('activeTabId'),'runtime-services');assert.equal(await run('items[selection[0]].uid'),'runtime-publish-time');
  await run('enterTab("runtime-dashboard")');assert.equal(await run('items.find(item=>item.uid==="runtime-dashboard-clock").componentName'),'Receive service time');
}));
