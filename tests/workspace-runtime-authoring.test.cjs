const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');
const root=path.join(__dirname,'..'),example=path.join(root,'examples','workspace-runtime.json');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>browser?.close());
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1100}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://workspace-authoring.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://workspace-authoring.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await run(`openWorkspaceFile(new File([${JSON.stringify(fs.readFileSync(example,'utf8'))}],'workspace-runtime.json',{type:'application/json'}))`);
    await page.waitForFunction(()=>__test.run('tabs.length===3 && tabs.some(tab=>tab.id==="runtime-services")'));
    await run('ensureEditorComponentGraph()');await fn({page,run,context});assert.deepEqual(errors,[],'no uncaught authoring errors');
  }finally{await context.close();}
}
async function open(page,run,sketchId,uid){
  await run(`(async()=>{if(componentBindingsDialog.open)componentBindingsDialog.close();if(activeTabId!==${JSON.stringify(sketchId)})enterTab(${JSON.stringify(sketchId)});selection=[items.findIndex(item=>item.uid===${JSON.stringify(uid)})];await openComponentBindings();})()`);
  await page.locator('#componentBindingsDialog').waitFor({state:'visible'});
  await page.waitForFunction(()=>__test.run('componentDialogSession && !componentDialogSession.rendering'));
}
async function settled(page){await page.waitForFunction(()=>__test.run('componentDialogSession && !componentDialogSession.rendering'));}
async function save(page){await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});await page.waitForFunction(()=>__test.run('componentDialogSession===null'));}
async function close(page){await page.locator('#componentBindingsCancel').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});await page.waitForFunction(()=>__test.run('componentDialogSession===null'));}

test('Receive explicitly imports individual published endpoints and traces to their source',async()=>app(async({page,run})=>{
  await open(page,run,'runtime-dashboard','runtime-dashboard-clock');
  const picker=page.getByRole('combobox',{name:'Published endpoint 1',exact:true}),options=await picker.locator('option').allTextContents();
  assert.ok(options.includes('Services / Publish time / UTC time · Text'));
  assert.ok(options.includes('Services / Publish time / Second tick · Boolean'),'each remote published row is independently discoverable');
  assert.ok(!options.some(label=>label.startsWith('Dashboard / ')),'the receiving sketch’s publishers are absent');
  await close(page);
  await run("tabs.find(tab=>tab.id==='runtime-dashboard').name='Services'");
  await open(page,run,'runtime-dashboard','runtime-dashboard-clock');
  const sameNames=await picker.locator('option').evaluateAll(nodes=>nodes.filter(node=>node.value).map(node=>JSON.parse(node.value)));
  assert.ok(sameNames.some(reference=>reference.sketchId==='runtime-services'),'a remote sketch with the same name remains discoverable');
  assert.ok(sameNames.every(reference=>reference.sketchId!=='runtime-dashboard'),'local filtering uses the receiving sketch ID, not its name');
  await close(page);await run("tabs.find(tab=>tab.id==='runtime-dashboard').name='Dashboard'");
  await open(page,run,'runtime-dashboard','runtime-dashboard-clock');
  assert.equal(await page.locator('#componentTypeName').textContent(),'Receive');
  assert.equal(await page.locator('[data-input-role="data"] .component-input').count(),0,'Receive has no authorable ordinary input');
  const reference={sketchId:'runtime-services',componentUid:'runtime-publish-time',port:'tick'};
  await picker.selectOption(JSON.stringify(reference));await settled(page);await save(page);
  assert.deepEqual(await run('items.find(item=>item.uid==="runtime-dashboard-clock").workspaceReceive'),{value:reference,tick:{sketchId:'runtime-services',componentUid:'runtime-publish-time',port:'tick'}});
  await open(page,run,'runtime-dashboard','runtime-dashboard-clock');
  await page.locator('[data-workspace-endpoint-row="value"]').getByRole('button',{name:'Go to source',exact:true}).click();
  await page.waitForFunction(()=>__test.run('componentDialogSession===null'));
  assert.equal(await run('items[selection[0]].uid'),'runtime-publish-time');
  await open(page,run,'runtime-services','runtime-publish-time');
  assert.ok((await page.locator('[data-workspace-endpoint-row="tick"]').textContent()).includes('Dashboard / Receive service time / Second tick'),'publisher lists its explicit receivers by local endpoint name');
  await close(page);
  await run(`items.find(item=>item.uid==='runtime-publish-time').state.endpoints=items.find(item=>item.uid==='runtime-publish-time').state.endpoints.filter(endpoint=>endpoint.id!=='tick');editorComponentEvaluation=null;`);
  await open(page,run,'runtime-dashboard','runtime-dashboard-clock');
  const remaining=await page.getByRole('combobox',{name:'Published endpoint 1',exact:true}).locator('option').allTextContents();
  assert.ok(!remaining.includes('Services / Publish time / Second tick · Boolean'),'deleted endpoint is removed from discovery');
  assert.ok(remaining.some(text=>text.startsWith('Unavailable endpoint')),'saved broken references remain visible for repair');
}));

test('Multiple endpoint rows retain identity through names, types, ordering and independent removal',async()=>app(async({page,run})=>{
  await open(page,run,'runtime-services','runtime-publish-time');
  const original=await run('JSON.parse(JSON.stringify(componentDialogSession.proposal))');
  await page.getByRole('button',{name:'Add published endpoint',exact:true}).click();await settled(page);
  await page.getByRole('textbox',{name:'Endpoint name 3',exact:true}).fill('Ready');
  await page.getByRole('textbox',{name:'Endpoint description 3',exact:true}).fill('Whether the submission is ready.');
  await page.getByRole('combobox',{name:'Endpoint type 3',exact:true}).selectOption('boolean');await settled(page);
  const id=await run('componentDialogSession.proposal.state.endpoints[2].id');assert.match(id,/^[A-Za-z][A-Za-z0-9_]{0,47}$/);
  await page.getByRole('combobox',{name:'Ready value',exact:true}).selectOption('true');
  await page.getByRole('button',{name:'Move up endpoint 3',exact:true}).click();await settled(page);
  await save(page);
  const publisher=await run('items.find(item=>item.uid==="runtime-publish-time")');
  assert.deepEqual(publisher.state.endpoints.map(row=>row.id),['value',id,'tick']);
  assert.deepEqual(publisher.state.endpoints[1],{id,name:'Ready',type:'boolean',description:'Whether the submission is ready.'});
  assert.deepEqual(publisher.bindings,original.bindings);assert.equal(publisher.inputValues[id],true);assert.ok(publisher.h>original.h);
  await open(page,run,'runtime-dashboard','runtime-dashboard-clock');
  await page.getByRole('button',{name:'Add imported endpoint',exact:true}).click();await settled(page);
  const reference={sketchId:'runtime-services',componentUid:'runtime-publish-time',port:id};
  await page.getByRole('combobox',{name:'Published endpoint 3',exact:true}).selectOption(JSON.stringify(reference));await settled(page);
  assert.equal(await page.getByRole('textbox',{name:'Output name 3',exact:true}).inputValue(),'Ready','first import adopts the published name');
  await page.getByRole('textbox',{name:'Output name 3',exact:true}).fill('Local ready');
  await page.getByRole('button',{name:'Move up endpoint 3',exact:true}).click();await settled(page);
  const localId=await run('componentDialogSession.proposal.state.endpoints[1].id');
  await save(page);
  const receiver=await run('items.find(item=>item.uid==="runtime-dashboard-clock")');
  assert.equal(receiver.state.endpoints[1].name,'Local ready');assert.equal(receiver.state.endpoints[1].type,'boolean');
  assert.deepEqual(receiver.workspaceReceive[localId],reference);assert.equal(receiver.workspaceReceive.value.port,'value');assert.equal(receiver.workspaceReceive.tick.port,'tick');
  await open(page,run,'runtime-dashboard','runtime-dashboard-clock');
  await page.getByRole('combobox',{name:'Published endpoint 2',exact:true}).selectOption(JSON.stringify({sketchId:'runtime-services',componentUid:'runtime-publish-time',port:'value'}));await settled(page);
  assert.equal(await page.getByRole('textbox',{name:'Output name 2',exact:true}).inputValue(),'Local ready','changing the source preserves an authored local name');
  await page.getByRole('button',{name:'Remove endpoint 3',exact:true}).click();await settled(page);await save(page);
  const changed=await run('items.find(item=>item.uid==="runtime-dashboard-clock")');
  assert.deepEqual(changed.state.endpoints.map(row=>row.id),['value',localId]);assert.equal(changed.state.endpoints[1].type,'string');
  assert.equal(changed.workspaceReceive.tick,undefined);assert.deepEqual(changed.workspaceReceive.value,receiver.workspaceReceive.value);assert.equal(changed.workspaceReceive[localId].port,'value');
}));

test('Dataset catalog opt-in controls discovery and opting out preserves existing remote references',async()=>app(async({page,run})=>{
  await open(page,run,'runtime-dashboard','runtime-dashboard-table');
  const picker=page.getByRole('combobox',{name:'data dataset',exact:true});
  const options=await picker.locator('option').allTextContents();
  assert.ok(options.some(text=>text.includes('Fruit stock')));assert.ok(!options.some(text=>text.includes('Private scratch')));
  const before=await run('items.find(item=>item.uid==="runtime-dashboard-table").inputValues.data');await close(page);
  await open(page,run,'runtime-services','runtime-stock-owner');
  await page.locator('#component-dataset-shared').uncheck();await save(page);
  await open(page,run,'runtime-dashboard','runtime-dashboard-table');
  assert.deepEqual(JSON.parse(await page.getByRole('combobox',{name:'data dataset',exact:true}).inputValue()),before);
  assert.equal(await page.locator('optgroup[label="Services"] option').count(),0,'hidden catalog entries are no longer offered');
  await close(page);
  const result=await run(`(async()=>{let graph;for(let attempt=0;attempt<3;attempt++){try{graph=await ensureEditorComponentGraph();break;}catch(error){if(!error.cancelled || attempt===2)throw error;await new Promise(requestAnimationFrame);}}const item=items.find(item=>item.uid==='runtime-dashboard-table'),record=graph.get(item);return {error:record.error||null,reference:item.inputValues.data,rows:record.io.tables?.inputs?.data?.rowCount};})()`);
  assert.equal(result.error,null);assert.deepEqual(result.reference,before);
}));

test('Workspace settings configures initial sketch and per-tab visibility without hiding authoring tabs',async()=>app(async({page,run})=>{
  await open(page,run,'runtime-services','runtime-settings');
  assert.equal(await page.locator('#workspace-initial-sketch').inputValue(),'runtime-dashboard');
  assert.equal(await page.getByRole('checkbox',{name:'Show Services tab',exact:true}).isChecked(),false);
  await page.locator('#workspace-initial-sketch').selectOption('runtime-editor');
  await page.getByRole('checkbox',{name:'Show Data editor tab',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Control Dashboard tab visibility with an input',exact:true}).check();
  await page.waitForFunction(()=>__test.run('!componentDialogSession.rendering'));
  assert.equal(await page.locator('[data-input-role="control"] .component-input').count(),4,'three defaults plus optional tab control');
  await save(page);
  const state=await run('items.find(item=>item.uid==="runtime-settings").state');
  assert.equal(state.initialSketchId,'runtime-editor');assert.equal(state.tabVisibility.find(entry=>entry.sketchId==='runtime-editor').visible,false);
  assert.match(state.tabVisibility.find(entry=>entry.sketchId==='runtime-dashboard').input,/^tab/);
  assert.equal(await run('tabs.length'),3);assert.equal(await page.locator('#tabbar').isVisible(),true);
  assert.equal(await page.locator('#tabbar .tab-hidden-marker').count(),2);
  assert.equal(await page.getByRole('tab',{name:'Data editor (hidden from the HTML tab bar)',exact:true}).count(),1);
}));

test('Sketch settings uses explicit inheritance and permits an empty overridden title',async()=>app(async({page,run})=>{
  await open(page,run,'runtime-editor','runtime-editor-settings');
  const title=page.getByRole('combobox',{name:'Window title override',exact:true});
  assert.equal(await title.inputValue(),'true');
  assert.equal(await page.getByRole('combobox',{name:'Show tab bar override',exact:true}).inputValue(),'false');
  await title.selectOption('false');await save(page);
  assert.equal(await run('items.find(item=>item.uid==="runtime-editor-settings").state.overrideTitle'),false);
  await open(page,run,'runtime-editor','runtime-editor-settings');await title.selectOption('true');
  await page.getByRole('textbox',{name:'Window title value',exact:true}).fill('');await save(page);
  const result=await run('(()=>{const item=items.find(item=>item.uid==="runtime-editor-settings");return {enabled:item.state.overrideTitle,title:item.inputValues.title};})()');
  assert.deepEqual(result,{enabled:true,title:''});
}));

test('Wiring exposes Publish inputs and Receive outputs only; Active sketch mode makes remote sources unavailable',async()=>app(async({page,run})=>{
  await page.locator('#componentWiringBtn').click();
  await page.locator('#componentWiringOverlay [data-wire-port][data-uid="runtime-dashboard-clock"]').first().waitFor();
  const model=await run(`componentWiring.model.ports.map(port=>({uid:port.uid,name:port.name,direction:port.direction}))`);
  assert.deepEqual(model.filter(port=>port.uid==='runtime-publish-message').map(port=>[port.name,port.direction]),[['value','in'],['quantity','in']]);
  assert.deepEqual(model.filter(port=>port.uid==='runtime-dashboard-clock').map(port=>[port.name,port.direction]),[['value','out'],['tick','out']]);
  assert.equal(await page.locator('#componentWiringOverlay [data-wire-port][data-uid="runtime-publish-message"][data-direction="in"]').count(),2);
  const reference=await run(`(()=>{const reference=componentWiring.model.references.find(reference=>reference.port?.uid==='runtime-dashboard-table');return reference && {missing:reference.missing,name:reference.name};})()`);
  assert.ok(reference,'remote Dataset is represented on the actual wiring overlay');assert.equal(reference.missing,false);
  assert.equal(reference.name,'Services / Fruit stock');
  assert.doesNotMatch(await page.locator('#componentWireStatus').textContent(),/Loading/);
  await page.locator('#componentWiringDone').click();
  await open(page,run,'runtime-services','runtime-settings');await page.getByRole('combobox',{name:'Execution mode',exact:true}).selectOption('active sketch');
  await page.waitForFunction(()=>__test.run('!componentDialogSession.rendering'));await save(page);
  await run(`enterTab('runtime-dashboard');render();`);
  const error=await run(`(async()=>{const item=items.find(item=>item.uid==='runtime-dashboard-clock');return (await ensureEditorComponentGraph()).get(item).error;})()`);
  assert.match(error,/Whole workspace|whole workspace/);
  await open(page,run,'runtime-dashboard','runtime-dashboard-clock');
  assert.ok((await page.getByRole('combobox',{name:'Published endpoint 1',exact:true}).locator('option').allTextContents()).includes('Services / Publish time / UTC time · Text'),'authoring still lets an inactive connection be configured');
  await save(page);
}));

test('authored cross-sketch endpoints and shared records survive save, reopen and offline export without replaying submissions',async()=>app(async({page,run,context})=>{
  await open(page,run,'runtime-editor','runtime-editor-messages');
  await page.getByRole('button',{name:'Add imported endpoint',exact:true}).click();await settled(page);
  const reference={sketchId:'runtime-dashboard',componentUid:'runtime-publish-message',port:'quantity'};
  await page.getByRole('combobox',{name:'Published endpoint 2',exact:true}).selectOption(JSON.stringify(reference));await settled(page);
  await page.getByRole('textbox',{name:'Output name 2',exact:true}).fill('Stock quantity');
  const localId=await run('componentDialogSession.proposal.state.endpoints[1].id');await save(page);

  // Exercise the actual text field and host-owned shared-record edit before saving.
  const clickEditorHandle=async(uid,id)=>{
    const point=await run(`(async()=>{
      await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);
      const index=items.findIndex(item=>item.uid===${JSON.stringify(uid)}),item=items[index];
      setTool('select');selection=[index];editingSmartIdx=index;render();
      const io=await resolveSmartComponentIo(item),handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item),io]);
      const handle=handles.find(handle=>handle.id===${JSON.stringify(id)});
      return {x:item.x+handle.x,y:item.y+handle.y};
    })()`);
    const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+point.x,box.y+point.y);
  };
  const input=page.locator('[data-smart-inline-input] #smartTextValue');
  await clickEditorHandle('runtime-stock-editor','cell-0-1');await input.waitFor();await input.fill('77');await input.press('Enter');await input.waitFor({state:'detached'});
  await run("enterTab('runtime-dashboard')");
  await clickEditorHandle('runtime-message','entry');await input.waitFor();await input.fill('Pear');await input.press('Enter');
  await page.waitForFunction(()=>__test.run("editorRuntimeContext().scene.find(item=>item.uid==='runtime-service-log').state.text")==='Pear');
  await page.waitForFunction(()=>__test.run("editorRuntimeContext().pool['workspace-stock'].rows.length")===3);await input.press('Escape');
  const download=page.waitForEvent('download');await run('exportWorkspace()');
  const saved=fs.readFileSync(await(await download).path(),'utf8'),data=JSON.parse(saved);
  const stock=data.tabs.find(tab=>tab.id==='runtime-services').datasets['workspace-stock'];
  assert.deepEqual(stock.rows,[['Apples',77],['Oranges',8],['Pear',1]]);
  const receiver=data.tabs.find(tab=>tab.id==='runtime-editor').items.find(item=>item.uid==='runtime-editor-messages');
  assert.deepEqual(receiver.workspaceReceive[localId],reference);assert.equal(receiver.state.endpoints[1].name,'Stock quantity');

  await run('persistWorkspace()');await page.reload();await run('appStarted');await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
  assert.deepEqual(await run("editorRuntimeContext().pool['workspace-stock'].rows"),stock.rows,'autosave reload does not replay submitted events');
  const generation=await run('workspaceGeneration');
  await run('pendingFileAction="openWorkspace"');
  await page.locator('#projectInput').setInputFiles({name:'authored-workspace.json',mimeType:'application/json',buffer:Buffer.from(saved)});
  await page.waitForFunction(before=>__test.run('workspaceGeneration')>before,generation);
  await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');
  assert.deepEqual(await run("editorRuntimeContext().pool['workspace-stock'].rows"),stock.rows,'file reopen preserves the shared records without replay');
  assert.equal(await run(`(async()=>{const graph=await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true),item=editorRuntimeContext().scene.find(item=>item.uid==='runtime-editor-messages');return graph.get(item).io.outputs[${JSON.stringify(localId)}];})()`),1);

  const htmlDownload=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-phase4-closeout-'));
  try{
    const file=path.join(directory,'workspace.html');
    fs.writeFileSync(file,fs.readFileSync(await(await htmlDownload).path(),'utf8').replace('    void activate(initial);','    window.__reader={run:source=>eval(source)};void activate(initial);'));
    const reader=await context.newPage(),errors=[],requests=[];
    reader.on('pageerror',error=>errors.push(error.message));reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
    await reader.goto(pathToFileURL(file).href);await reader.waitForFunction(()=>!document.documentElement.classList.contains('sc-reader-starting'));
    const read=source=>reader.evaluate(source=>__reader.run(source),source);
    const rowExpression="datasets['workspace-stock'].rows";
    assert.deepEqual(await read(rowExpression),stock.rows,'HTML startup preserves stored rows without replay');
    assert.equal(await read(`(async()=>{const graph=await resolveComponentGraph(),item=items.find(item=>item.uid==='runtime-editor-messages');return graph.get(item).io.outputs[${JSON.stringify(localId)}];})()`),1);
    const point=await read(`(async()=>{
      const entry=entryFor(items.find(item=>item.uid==='runtime-message'));
      const handles=await requestSmartCall(entry.item,'handles',[entry.item.state,entry.item.w,entry.item.h,smartResolvedStyle(entry.item)]);
      const handle=handles.find(handle=>handle.id==='entry'),p=new DOMPoint(handle.x,handle.y).matrixTransform(entry.local.getScreenCTM());return {x:p.x,y:p.y};
    })()`);
    await reader.mouse.click(point.x,point.y);
    const field=reader.locator('[data-smart-inline-input] #smartTextValue');await field.waitFor();await field.fill('Pear');
    for(let count=4;count<=5;count++){
      await field.press('Enter');await reader.waitForFunction(({expression,count})=>__reader.run(expression).length===count,{expression:rowExpression,count});
      await reader.waitForFunction(()=>!document.querySelector('[data-smart-inline-input] #smartTextValue')?.readOnly);
    }
    await field.press('Escape');
    await reader.locator('.tab-select[data-tab-id="runtime-editor"]').click();
    await reader.waitForFunction(()=>document.title==='Edit fruit stock · Workspace example');
    assert.deepEqual(await read(rowExpression),[...stock.rows,['Pear',1],['Pear',1]]);
    assert.equal(await read("items.find(item=>item.uid==='runtime-editor-log').state.text"),'Pear\nPear\nPear');
    assert.equal(await reader.locator('.tab-select[data-tab-id="runtime-services"]').isVisible(),false);
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    await reader.close();
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}));
