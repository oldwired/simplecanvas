const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

// Expose only the served copy's closure. Component calls still cross the real
// Worker boundary; downloaded HTML runs its own unmodified runtime.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:960}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://example-workspace.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://example-workspace.test/index.html');
    const run=source=>page.evaluate(source=>{
      // Chromium's DevTools awaitPromise can lose an unrooted evaluation promise while
      // Workers and a newer graph evaluation keep running. Retain this test bridge's
      // completion until it settles; this neither retries nor changes application work.
      const pending=window.__testPending||(window.__testPending=new Set());
      const call=Promise.resolve(__test.run('appReady')).then(()=>__test.run(source));
      const result=call.finally(()=>pending.delete(result));pending.add(result);return result;
    },source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}

const workspacePath=path.join(__dirname,'..','examples','smart-components-workspace.json');
const readerPath=path.join(__dirname,'..','examples','smart-components-workspace.html');
const workspace=JSON.parse(fs.readFileSync(workspacePath,'utf8'));
const uid=(tab,id)=>'demo-'+tab+'-'+id;
const itemFor=(tab,id)=>workspace.tabs[tab-1].items.find(item=>item.uid===uid(tab,id));
async function importExample(page,run){
  await run('pendingFileAction="openWorkspace"');
  await page.locator('#projectInput').setInputFiles(workspacePath);
  await page.waitForFunction(()=>__test.run('tabs.length===27 && tabs[0].name.startsWith("1")'));
  assert.deepEqual(await run('tabs.map(tab=>tab.name)'),workspace.tabs.map(tab=>tab.name));
}
async function activate(run,tab){
  await run(`activateTab(tabs[${tab-1}].id);selection=[];setTool('select');render();`);
  await run('ensureEditorComponentGraph()');
}
async function editorHandle(page,run,tab,id,handleId){
  const target=uid(tab,id);
  const {item,handle}=await run(`(async()=>{
    const index=items.findIndex(item=>item.uid===${JSON.stringify(target)});selection=[index];editingSmartIdx=index;render();
    const item=items[index],handles=await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)]);
    return {item,handle:handles.find(handle=>handle.id===${JSON.stringify(handleId)})};
  })()`);
  assert.ok(handle,target+' has interactive '+handleId);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+item.x+handle.x,box.y+item.y+handle.y);
  if(!['text','number','action'].includes(handle.kind))await run('smartHitSettled');
}
const outputs=(run,tab,id)=>run(`(async()=> (await resolveSmartComponentIo(items.find(item=>item.uid===${JSON.stringify(uid(tab,id))}))).outputs)()`);
async function waitState(page,tab,id,expression){
  await page.waitForFunction(({target,expression})=>__test.run(`(()=>{const state=items.find(item=>item.uid===${JSON.stringify(target)})?.state;return !!state && (${expression});})()`),{target:uid(tab,id),expression});
}

test('shipped workspace imports all twenty-seven tabs with valid local bindings and current component sources',async()=>app(async({page,run})=>{
  await importExample(page,run);
  const checked=await run(`(async()=>{
    const sourceKeys=new Map(BUILTIN_LIBRARY_DEFINITIONS.filter(definition=>definition.items[0].type==='smart').map(definition=>[definition.items[0].script.trim(),definition.key]));
    const result=[];
    for(const tab of tabs){
      const document=tabDocument(tab.id),before=JSON.stringify(document.items),graph=await inspectComponentGraph(document.items,()=>true,new Map(),document.datasets);
      const smart=document.items.filter(item=>item.componentApi===2),ids=new Set(smart.map(item=>item.uid));
      result.push({name:tab.name,count:smart.length,pure:before===JSON.stringify(document.items),
        sources:smart.map(item=>sourceKeys.get(item.script.trim())||null),
        bindings:smart.flatMap(item=>Object.values(item.bindings||{})).every(binding=>ids.has(binding.uid)),
        errors:[...graph.values()].map(record=>record.error||'')});
    }
    return result;
  })()`);
  assert.equal(checked.length,27);
  for(const [index,tab] of checked.entries()){
    assert.match(tab.name,new RegExp('^'+(index+1)+'\\b'));
    assert.ok(tab.count>=3,tab.name+' contains a connected example');
    assert.ok(tab.sources.every(Boolean),tab.name+' uses current bundled scripts');
    assert.equal(tab.bindings,true,tab.name+' bindings stay within their own drawing');
    assert.ok(tab.errors.every(error=>error===''),tab.name+': '+JSON.stringify(tab.errors));
    assert.equal(tab.pure,true,'graph inspection does not consume example state');
  }
  const allIds=workspace.tabs.flatMap(tab=>tab.items.filter(item=>item.componentApi===2).map(item=>item.uid));
  assert.equal(new Set(allIds).size,allIds.length);
}));

test('imported controls, routing, text and data examples respond while inactive timers pause',async()=>app(async({page,run})=>{
  await importExample(page,run);
  await activate(run,1);await editorHandle(page,run,1,'source','plus');
  assert.equal((await outputs(run,1,'readout')).value,51);

  await activate(run,2);assert.equal((await outputs(run,2,'result')).value,false);
  await editorHandle(page,run,2,'level','plus');assert.equal((await outputs(run,2,'result')).value,true);
  await editorHandle(page,run,2,'enabled','toggle');assert.equal((await outputs(run,2,'result')).value,false);

  await activate(run,3);await editorHandle(page,run,3,'source','plus');
  assert.equal((await outputs(run,3,'multiply')).value,5.2);assert.equal((await outputs(run,3,'scale')).value,52);

  await activate(run,4);assert.equal((await outputs(run,4,'countdown')).count,9);
  await editorHandle(page,run,4,'run','toggle');await waitState(page,4,'countdown','state.count===8');
  await editorHandle(page,run,4,'run','toggle');await editorHandle(page,run,4,'reset','trigger');
  await waitState(page,4,'countdown','state.count===9');await waitState(page,4,'reset','state.value===false');
  await editorHandle(page,run,4,'run','toggle');await activate(run,5);
  for(let click=0;click<3;click++)await editorHandle(page,run,5,'send','trigger');
  assert.equal((await outputs(run,5,'delivered')).count,0,'transport delay has not delivered the newly clicked pulses immediately');
  await waitState(page,5,'delivered','state.count===3');assert.equal((await outputs(run,5,'delivered')).reached,true);
  assert.equal(await run('tabDocument(tabs[3].id).items.find(item=>item.uid==="demo-4-countdown").state.count'),9,'inactive countdown keeps its pending second');
  await activate(run,4);await waitState(page,4,'countdown','state.count===8');await editorHandle(page,run,4,'run','toggle');

  await activate(run,6);assert.equal((await outputs(run,6,'selector')).position,0);
  await editorHandle(page,run,6,'next','trigger');
  await waitState(page,6,'selector','state.position===1');assert.equal((await outputs(run,6,'value')).value,25);
  await editorHandle(page,run,6,'reset','trigger');await waitState(page,6,'selector','state.position===0');
  assert.equal((await outputs(run,6,'value')).value,10);

  await activate(run,7);await editorHandle(page,run,7,'data','toggle');
  for(let click=0;click<5;click++)await editorHandle(page,run,7,'shift','trigger');
  await waitState(page,7,'second','JSON.stringify(state.cells)==="[true,false,false,false]"');
  assert.deepEqual(await run('items.find(item=>item.uid==="demo-7-first").state.cells'),[true,true,true,true]);
  await editorHandle(page,run,7,'reset','trigger');await waitState(page,7,'second','state.cells.every(value=>value===false)');
  assert.deepEqual(await run('items.find(item=>item.uid==="demo-7-first").state.cells'),[false,false,false,false]);

  await activate(run,8);const crossingOutputs=await outputs(run,8,'crossings');
  assert.deepEqual(Object.keys(crossingOutputs),['r','c'].flatMap(prefix=>Array.from({length:8},(_,index)=>prefix+index)));
  assert.deepEqual(Object.values(crossingOutputs),[170,0,170,0,170,0,170,0,170,0,170,0,170,0,170,0]);
  await editorHandle(page,run,8,'even-rows','toggle');await editorHandle(page,run,8,'even-cols','toggle');
  assert.deepEqual(Object.values(await outputs(run,8,'crossings')),Array(16).fill(255));
  await editorHandle(page,run,8,'row-byte','plus');assert.equal((await outputs(run,8,'smiley')).r0,61);
  assert.deepEqual(await outputs(run,8,'columns'),await outputs(run,8,'smiley'),'column-byte inputs reproduce the connected row-byte picture');

  await activate(run,16);assert.deepEqual(await outputs(run,16,'memo'),{text:'',lineCount:0});
  await editorHandle(page,run,16,'entry','entry');await page.locator('#smartTextValue').fill('Workspace note');
  await page.locator('#smartTextValue').press('Enter');
  await page.waitForFunction(()=>Number(document.querySelector('[data-smart-inline-input]')?.dataset.submissions)>0);await run('smartHitSettled');
  await waitState(page,16,'memo','state.text==="Workspace note"');
  assert.equal((await outputs(run,16,'label')).value,'Workspace note');assert.equal((await outputs(run,16,'count')).value,1);
  await editorHandle(page,run,16,'clear','trigger');await waitState(page,16,'memo','state.lineCount===0');
  await editorHandle(page,run,16,'number','entry');await page.locator('#smartNumberValue').fill('73');
  await page.locator('#smartNumberValue').press('Enter');
  await page.waitForFunction(()=>Number(document.querySelector('[data-smart-inline-input]')?.dataset.submissions)>0);await run('smartHitSettled');
  assert.equal((await outputs(run,16,'gauge')).percentage,73);

  await activate(run,17);assert.equal((await outputs(run,17,'source')).rowCount,12);
  assert.equal((await outputs(run,17,'filter')).rowCount,4);
  await editorHandle(page,run,17,'boat','entry');await page.locator('#smartTextValue').fill('Borealis');await page.locator('#smartTextValue').press('Enter');
  await page.waitForFunction(()=>Number(document.querySelector('[data-smart-inline-input]')?.dataset.submissions)>0);await run('smartHitSettled');
  assert.deepEqual((await outputs(run,17,'filter')).data.rows,[4,5,6,7]);
  assert.equal((await outputs(run,17,'table')).rowCount,4);assert.equal((await outputs(run,17,'chart')).rowCount,4);
  await activate(run,18);assert.equal((await outputs(run,18,'source')).rowCount,12);
  assert.equal((await outputs(run,18,'aggregate')).rowCount,3);assert.equal((await outputs(run,18,'sort')).rowCount,12);
  assert.equal((await outputs(run,18,'table')).rowCount,3);assert.equal((await outputs(run,18,'chart')).rowCount,3);
  assert.equal((await outputs(run,18,'download')).rowCount,3);
}));

function readerHost(page,tab,id){
  // Display captions are optional (Text label is just its text by default).
  // The reader uses the original item index for each smart host.
  const index=workspace.tabs[tab-1].items.findIndex(item=>item.uid===uid(tab,id));
  assert.ok(index>=0,'example contains '+uid(tab,id));
  return page.locator('.tab-panel').nth(tab-1).locator('[data-smart-index="'+index+'"]');
}
async function readerTab(page,tab){
  await page.locator('.tab-select').nth(tab-1).click();
  const panel=page.locator('.tab-panel').nth(tab-1);await panel.waitFor({state:'visible'});
  await page.waitForFunction(panel=>[...panel.querySelectorAll('[data-smart-index]')].every(host=>host.dataset.smartReady==='true'),await panel.elementHandle());
}
async function readerHandle(page,tab,id,kind){
  const item=itemFor(tab,id),point=kind==='enabled'?{x:item.w-34*Math.min(item.w/320,item.h/150),y:item.h-22*Math.min(item.w/320,item.h/150)}:kind==='loadData'?{x:item.w/2,y:item.h-26*Math.min(item.w/300,item.h/150)}:['csv','json'].includes(kind)?{x:item.w*(kind==='csv'?.25:.75),y:item.h-33*Math.min(item.w/320,item.h/150)}:kind==='plus'?{x:item.w*.75,y:item.h*.84}:kind==='trigger'?{x:item.w*.38,y:item.h*.49}:kind==='entry'?{x:item.w*.5,y:item.h*.67}:{x:item.w*.5,y:item.h*.69};
  const host=readerHost(page,tab,id);assert.equal(await host.count(),1,item.componentName+' identifies one exported component');
  const position=await host.evaluate((host,point)=>{const at=new DOMPoint(point.x,point.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:at.x,y:at.y};},point);
  await page.mouse.click(position.x,position.y);
}
async function readerText(page,tab,id,text){
  await page.waitForFunction(({host,text})=>[...host.querySelectorAll('text')].some(node=>node.textContent===text),{host:await readerHost(page,tab,id).elementHandle(),text});
}

test('shipped offline HTML has twenty-seven working tabs and needs no HTTP dependencies',async()=>{
  assert.ok(fs.existsSync(readerPath),'the shipped HTML companion exists');
  const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  try{
    await page.goto(pathToFileURL(readerPath).href);assert.equal(await page.locator('.tab-select').count(),27);
    for(let tab=1;tab<=27;tab++){
      await readerTab(page,tab);
      assert.equal(await page.locator('.tab-panel').nth(tab-1).locator('[data-component-error]').count(),0,'tab '+tab+' starts without unavailable components');
    }
    await readerTab(page,1);await readerHandle(page,1,'source','plus');await readerText(page,1,'readout','51');
    await readerTab(page,2);await readerText(page,2,'result','OFF');
    await readerHandle(page,2,'level','plus');await readerText(page,2,'result','ON');
    await readerHandle(page,2,'enabled','toggle');await readerText(page,2,'result','OFF');
    await readerTab(page,3);await readerHandle(page,3,'source','plus');await readerText(page,3,'gauge','52%');
    await readerTab(page,6);await readerHandle(page,6,'next','trigger');await readerText(page,6,'value','25');await readerText(page,6,'position','1');
    await readerTab(page,7);await readerHandle(page,7,'data','toggle');
    for(let click=0;click<5;click++)await readerHandle(page,7,'shift','trigger');
    await page.waitForFunction(host=>{
      const texts=[...host.querySelectorAll('text')].map(node=>node.textContent);return texts[texts.indexOf('Q0')+1]==='1';
    },await readerHost(page,7,'second').elementHandle());
    await readerTab(page,8);await readerHandle(page,8,'even-rows','toggle');await readerHandle(page,8,'even-cols','toggle');
    await page.waitForFunction(host=>host.querySelectorAll('ellipse[fill="#ef4444"]').length===64,await readerHost(page,8,'crossings').elementHandle());
    await readerTab(page,16);await readerHandle(page,16,'entry','entry');await page.locator('#smartTextValue').fill('Offline note');
    await page.locator('#smartTextValue').press('Enter');await readerText(page,16,'memo','Offline note');await readerText(page,16,'label','Offline note');
    await readerHandle(page,16,'clear','trigger');
    await page.waitForFunction(host=>!host.textContent.includes('Offline note'),await readerHost(page,16,'memo').elementHandle());
    await readerHandle(page,16,'number','entry');await page.locator('#smartNumberValue').fill('73');await page.locator('#smartNumberValue').press('Enter');
    await readerText(page,16,'gauge','73%');
    await readerTab(page,17);await readerText(page,17,'table','Aurora');
    await readerHandle(page,17,'boat','entry');await page.locator('#smartTextValue').fill('Borealis');await page.locator('#smartTextValue').press('Enter');
    await readerText(page,17,'table','Borealis');
    await page.locator('#smartTextValue').fill('');await page.locator('#smartTextValue').press('Enter');
    await readerText(page,17,'chart','12 rows');
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  }finally{await context.close();}
});


test('shipped reader replaces race data, sorts and groups results, switches steps off, and downloads the report',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),errors=[],downloads=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('download',download=>downloads.push(download));
  try{
    await page.goto(pathToFileURL(readerPath).href);await readerTab(page,18);
    await readerText(page,18,'table','Calypso');await readerText(page,18,'chart','3 rows');
    await readerHandle(page,18,'source','loadData');
    const load=page.locator('dialog[data-component-data-action="importDataset"]');await load.waitFor({state:'visible'});
    await load.locator('[data-data-action-file]').setInputFiles(path.join(__dirname,'..','examples','sailing-results-updated.tsv'));
    await load.locator('button').filter({hasText:/^Replace data$/}).waitFor({state:'visible'});
    await load.getByRole('button',{name:'Replace data',exact:true}).click();
    await readerText(page,18,'table','Dolphin');await readerText(page,18,'chart','4 rows');
    assert.equal(downloads.length,0,'import and recomputation do not download');
    await readerTab(page,17);await readerTab(page,18);await readerText(page,18,'table','Dolphin');
    const expected=[{group:'Aurora',result:9},{group:'Borealis',result:11},{group:'Calypso',result:7},{group:'Dolphin',result:3}];
    for(const format of ['json','csv']){
      await readerHandle(page,18,'download',format);
      const dialog=page.locator('dialog[data-component-data-action="downloadTable"]');await dialog.waitFor({state:'visible'});
      assert.equal(await dialog.locator('[data-data-action-format]').inputValue(),format);
      const event=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download',exact:true}).click();
      const download=await event;assert.equal(await download.failure(),null);assert.equal(download.suggestedFilename(),'sailing-report.'+format);
      const contents=fs.readFileSync(await download.path(),'utf8').replace(/^\uFEFF/,'');
      if(format==='json')assert.deepEqual(JSON.parse(contents),expected);
      else assert.deepEqual(contents.trim().split(/\r?\n/),['group,result','Aurora,9','Borealis,11','Calypso,7','Dolphin,3']);
    }
    assert.equal(downloads.length,2,'one file per confirmed download');
    await readerHandle(page,18,'aggregate','enabled');
    await readerText(page,18,'table','Race');
    await readerText(page,18,'aggregate','Bypass');
    assert.equal(await page.locator('[data-component-error]').count(),0,'the table and automatic chart accept the bypassed original schema');
    await readerHandle(page,18,'sort','enabled');await readerText(page,18,'sort','Bypass');
    await readerHandle(page,18,'aggregate','enabled');await readerText(page,18,'chart','4 rows');
    await page.reload();await readerTab(page,18);await readerText(page,18,'chart','3 rows');
    assert.equal(await readerHost(page,18,'table').textContent().then(text=>text.includes('Dolphin')),false,'reload restores embedded data');
    assert.equal(downloads.length,2,'reload does not replay downloads');assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('shipped choice example maps manual choices and shared dataset values in both directions',async()=>app(async({page,run})=>{
  await importExample(page,run);await activate(run,19);
  assert.deepEqual(await outputs(run,19,'manual'),{index:0,key:'idle',text:'Idle',valid:true});
  assert.deepEqual(await outputs(run,19,'automatic'),{index:1,key:'running',text:'Running',valid:true});
  assert.deepEqual(await outputs(run,19,'lookup'),{index:1,key:'running',found:true});
  await editorHandle(page,run,19,'manual','select');
  await page.locator('select[data-smart-inline-input="choice"]').selectOption('2');await run('smartHitSettled');
  assert.equal((await outputs(run,19,'manual-index')).value,2);
  assert.equal((await outputs(run,19,'manual-key')).value,'stopped');
  assert.equal((await outputs(run,19,'manual-text')).value,'Stopped');
  await editorHandle(page,run,19,'position','plus');
  assert.equal((await outputs(run,19,'automatic-text')).value,'Paused');
  for(let i=0;i<2;i++)await editorHandle(page,run,19,'position','plus');
  assert.deepEqual(await outputs(run,19,'automatic'),{index:-1,key:'',text:'',valid:false});
  assert.equal((await outputs(run,19,'valid')).value,false);
  const enter=async value=>{
    await editorHandle(page,run,19,'query','entry');await page.locator('#smartTextValue').fill(value);
    await page.locator('#smartTextValue').press('Enter');
    await page.waitForFunction(()=>Number(document.querySelector('[data-smart-inline-input]')?.dataset.submissions)>0);
    await run('smartHitSettled');
  };
  await enter('Paused');assert.deepEqual(await outputs(run,19,'lookup'),{index:2,key:'paused',found:true});
  await enter('Missing');assert.deepEqual(await outputs(run,19,'lookup'),{index:-1,key:'',found:false});
  assert.equal((await outputs(run,19,'source')).rowCount,4,'selection and lookup do not mutate the shared dataset');
}));

test('shipped choice example works offline, preserves reader choices across tabs, and restores saved choices on reload',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  try{
    await page.goto(pathToFileURL(readerPath).href);await readerTab(page,19);
    await readerText(page,19,'manual-text','Idle');await readerText(page,19,'automatic-text','Running');
    await readerHandle(page,19,'manual','choice');
    await page.locator('select[data-smart-inline-input="choice"]').selectOption('2');
    await readerText(page,19,'manual-text','Stopped');await readerText(page,19,'manual-key','stopped');
    await readerText(page,19,'manual-index','2');
    await readerHandle(page,19,'automatic','choice');
    assert.equal(await page.locator('select[data-smart-inline-input="choice"]').count(),0,'a connected selection is read-only');
    await readerHandle(page,19,'position','plus');await readerText(page,19,'automatic-text','Paused');
    for(let i=0;i<2;i++)await readerHandle(page,19,'position','plus');
    await readerText(page,19,'valid','OFF');await readerText(page,19,'automatic','No selection');
    await readerHandle(page,19,'query','entry');await page.locator('#smartTextValue').fill('Paused');
    await page.locator('#smartTextValue').press('Enter');await readerText(page,19,'lookup-index','2');
    await readerText(page,19,'lookup-key','paused');await readerText(page,19,'found','ON');
    await page.locator('#smartTextValue').fill('Missing');await page.locator('#smartTextValue').press('Enter');
    await readerText(page,19,'lookup-index','-1');await readerText(page,19,'found','OFF');
    await readerTab(page,18);await readerTab(page,19);await readerText(page,19,'manual-text','Stopped');
    await page.reload();await readerTab(page,19);await readerText(page,19,'manual-text','Idle');
    await readerText(page,19,'automatic-text','Running');await readerText(page,19,'lookup-key','running');
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  }finally{await context.close();}
});


test('shipped spreadsheet example consumes typed inputs and publishes editable formula results',async()=>app(async({page,run})=>{
  await importExample(page,run);await activate(run,20);
  assert.deepEqual(await outputs(run,20,'sheet'),{total:20,active:true,status:'Enabled'});
  await editorHandle(page,run,20,'amount','plus');
  assert.equal((await outputs(run,20,'total')).value,22);
  await editorHandle(page,run,20,'enabled','toggle');
  assert.deepEqual(await outputs(run,20,'sheet'),{total:0,active:false,status:'Paused'});
  assert.equal((await outputs(run,20,'active')).value,false);
  assert.equal((await outputs(run,20,'status')).value,'Paused');
  await editorHandle(page,run,20,'enabled','toggle');
  await editorHandle(page,run,20,'sheet','B3');
  await page.locator('#smartTextValue').fill('3');await page.locator('#smartTextValue').press('Enter');
  await page.waitForFunction(()=>__test.run('items.find(item=>item.uid==="demo-20-sheet").state.cells.B3==="3"'));
  await run('smartHitSettled');
  assert.equal((await outputs(run,20,'total')).value,33);
  assert.equal(await page.locator('[data-smart-inline-input]').count(),0,'edit mode finishes after Enter');
}));

test('shipped spreadsheet remains read-only in HTML while connected controls update all result types',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  try{
    await page.goto(pathToFileURL(readerPath).href);await readerTab(page,20);
    await readerText(page,20,'total','20');await readerText(page,20,'active','ON');await readerText(page,20,'status','Enabled');
    await readerHost(page,20,'sheet').click();
    assert.equal(await page.locator('[data-smart-inline-input]').count(),0,'reader cells do not offer authoring handles');
    await readerHandle(page,20,'amount','plus');await readerText(page,20,'total','22');
    await readerHandle(page,20,'enabled','toggle');
    await readerText(page,20,'total','0');await readerText(page,20,'active','OFF');await readerText(page,20,'status','Paused');
    await readerTab(page,19);await readerTab(page,20);await readerText(page,20,'status','Paused');
    await page.reload();await readerTab(page,20);await readerText(page,20,'total','20');await readerText(page,20,'status','Enabled');
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  }finally{await context.close();}
});

test('shipped dataset sheet pages its live grid while whole-table formulas stay complete',async()=>app(async({page,run})=>{
  await importExample(page,run);await activate(run,21);
  assert.deepEqual(await outputs(run,21,'sheet'),{points:30,rows:12,scaled:60});
  await editorHandle(page,run,21,'offset','plus');
  const io=await run(`resolveSmartComponentIo(items.find(item=>item.uid==='demo-21-sheet'))`);
  assert.equal(io.inputs.startRow,1);assert.equal(io.tables.inputs.data.rows.length,12);
  assert.deepEqual(io.outputs,{points:30,rows:12,scaled:60});
  await editorHandle(page,run,21,'sheet','F6');
  const field=page.locator('[data-smart-inline-input="text"] #smartTextValue');await field.fill('3');await field.press('Enter');
  await page.waitForFunction(()=>__test.run('items.find(item=>item.uid==="demo-21-sheet").state.cells.F6==="3"'));
  await run('smartHitSettled');assert.equal((await outputs(run,21,'scaled')).value,90);
}));

test('shipped dataset spreadsheet calculates and pages in the offline reader',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:960}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(readerPath).href);await readerTab(page,21);
    await readerText(page,21,'points','30');await readerText(page,21,'rows','12');await readerText(page,21,'scaled','60');
    await readerHandle(page,21,'offset','plus');await readerText(page,21,'offset','1');
    await readerText(page,21,'points','30');await readerText(page,21,'scaled','60');
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

async function readerCell(page,tab,id,address){
  const item=itemFor(tab,id),column=address.charCodeAt(0)-65,row=Number(address.slice(1))-1,weights=item.state.weights||Array(item.state.cols).fill(1),unit=item.w/weights.reduce((a,b)=>a+b,0);
  const point={x:(weights.slice(0,column).reduce((a,b)=>a+b,0)+weights[column]/2)*unit,y:(row+.5)*item.h/item.state.rows};
  const position=await readerHost(page,tab,id).evaluate((host,point)=>{const p=new DOMPoint(point.x,point.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},point);
  await page.mouse.click(position.x,position.y);
}
async function confirmedJsonDownload(page){
  const dialog=page.locator('dialog[data-component-data-action="downloadTable"]');await dialog.waitFor({state:'visible'});
  const event=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download',exact:true}).click();const download=await event;
  assert.equal(download.suggestedFilename(),'shared-readings.json');return JSON.parse(fs.readFileSync(await download.path(),'utf8').replace(/^\uFEFF/,''));
}

test('shared dataset demo captures control values, edits a record, and downloads the same updated rows',async()=>app(async({page,run})=>{
  await importExample(page,run);await activate(run,22);
  assert.equal((await outputs(run,22,'label')).value,'Gamma','the text entry starts with its intended live value');
  assert.deepEqual(await outputs(run,22,'sheet'),{total:35,rows:2});
  await editorHandle(page,run,22,'pulse','trigger');
  await page.waitForFunction(()=>__test.run('datasets.readings.rows.length===3'));await run('smartHitSettled');
  assert.deepEqual(await outputs(run,22,'sheet'),{total:75,rows:3});assert.deepEqual(await run('datasets.readings.rows[2]'),['Gamma',40]);
  await editorHandle(page,run,22,'sheet','B4');const field=page.locator('#smartTextValue');await field.waitFor();assert.equal(await field.inputValue(),'40');
  await field.fill('45');await field.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');
  assert.deepEqual(await outputs(run,22,'sheet'),{total:80,rows:3});assert.equal((await outputs(run,22,'chart')).rowCount,3);
  const chart=await run(`(async()=>{const it=items.find(item=>item.uid==='demo-22-chart');return requestSmartCall(it,'children',[it.state,smartResolvedStyle(it),it.w,it.h,false]);})()`);
  assert.ok(chart.some(child=>child.type==='text'&&child.text==='45'),'chart immediately displays the edited record');
  assert.deepEqual(await run('datasetRowIds(datasets.readings)'),['r0','r1','r2']);
  await editorHandle(page,run,22,'download','json');assert.deepEqual(await confirmedJsonDownload(page),[{label:'Alpha',value:10},{label:'Beta',value:25},{label:'Gamma',value:45}]);
  await run('undo();ensureEditorComponentGraph()');assert.deepEqual(await outputs(run,22,'sheet'),{total:75,rows:3});assert.equal(await run('datasets.readings.rows[2][1]'),40);
  await editorHandle(page,run,22,'offset','plus');assert.equal((await outputs(run,22,'offset')).value,1);
  const paged=await run("resolveSmartComponentIo(items.find(item=>item.uid==='demo-22-sheet'))");
  assert.equal(paged.inputs.startRow,1);assert.deepEqual(paged.outputs,{total:75,rows:3},'paging leaves whole-table formulas unchanged');
}));

test('shared dataset demo supports capture, direct editing, chart refresh and downloads in shipped HTML',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  try{
    await page.goto(pathToFileURL(readerPath).href);await readerTab(page,22);
    await readerText(page,22,'label','Gamma');await readerText(page,22,'sheet','35');await readerText(page,22,'chart','2 rows');
    await readerHandle(page,22,'pulse','trigger');await readerText(page,22,'capture','3 rows');await readerText(page,22,'sheet','75');await readerText(page,22,'chart','3 rows');
    await readerCell(page,22,'sheet','B4');const field=page.locator('#smartTextValue');await field.waitFor();assert.equal(await field.inputValue(),'40');
    await field.fill('45');await field.press('Enter');await field.waitFor({state:'detached'});await readerText(page,22,'sheet','80');await readerText(page,22,'chart','45');
    await readerCell(page,22,'sheet','E2');assert.equal(await page.locator('#smartTextValue').count(),0,'local formulas remain authored content in the reader');
    await readerHandle(page,22,'offset','plus');await readerText(page,22,'offset','1');await readerText(page,22,'sheet','80');
    await page.waitForFunction(host=>!host.textContent.includes('Alpha'),await readerHost(page,22,'sheet').elementHandle());
    await readerHandle(page,22,'download','json');assert.deepEqual(await confirmedJsonDownload(page),[{label:'Alpha',value:10},{label:'Beta',value:25},{label:'Gamma',value:45}]);
    await readerTab(page,21);await readerTab(page,22);await readerText(page,22,'sheet','80');
    await page.reload();await readerTab(page,22);await readerText(page,22,'chart','2 rows');await readerText(page,22,'sheet','35');
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  }finally{await context.close();}
});

test('source-to-dataset demo applies explicit copies and keeps incoming and owned edits independent',async()=>app(async({page,run})=>{
  await importExample(page,run);await activate(run,23);
  assert.deepEqual(await outputs(run,23,'sheet'),{total:7,rows:1});assert.equal((await outputs(run,23,'filter')).rowCount,2);
  await editorHandle(page,run,23,'replace','trigger');
  await page.waitForFunction(()=>__test.run('datasets.saved.rows.length===2'));await run('smartHitSettled');
  assert.deepEqual(await outputs(run,23,'sheet'),{total:65,rows:2});
  const ids=await run('datasets.saved.rowIds');assert.deepEqual(ids,['r1','r2']);
  await editorHandle(page,run,23,'incoming','B4');let field=page.locator('#smartTextValue');await field.waitFor();await field.fill('50');await field.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');
  assert.equal(await run('datasets.incoming.rows[2][1]'),50);assert.deepEqual(await outputs(run,23,'sheet'),{total:65,rows:2},'source edits wait for an explicit apply pulse');
  await editorHandle(page,run,23,'sheet','B2');field=page.locator('#smartTextValue');await field.waitFor();await field.fill('30');await field.press('Enter');await field.waitFor({state:'detached'});await run('smartHitSettled');
  assert.equal(await run('datasets.incoming.rows[1][1]'),25,'destination edits never write upstream');assert.deepEqual(await outputs(run,23,'sheet'),{total:70,rows:2});
  await editorHandle(page,run,23,'append','trigger');await page.waitForFunction(()=>__test.run('datasets.saved.rows.length===4'));await run('smartHitSettled');
  assert.deepEqual(await outputs(run,23,'sheet'),{total:145,rows:4});assert.deepEqual(await run('datasets.saved.rowIds.slice(0,2)'),ids);
  await editorHandle(page,run,23,'threshold','plus');assert.equal((await outputs(run,23,'filter')).rowCount,1);assert.deepEqual(await outputs(run,23,'sheet'),{total:145,rows:4});
  await editorHandle(page,run,23,'replace','trigger');await page.waitForFunction(()=>__test.run('datasets.saved.rows.length===1'));await run('smartHitSettled');
  assert.deepEqual(await outputs(run,23,'sheet'),{total:50,rows:1});assert.deepEqual(await run('datasets.saved.rows'),[['Gamma',50]]);
  const chart=await run(`(async()=>{const it=items.find(item=>item.uid==='demo-23-chart');return requestSmartCall(it,'children',[it.state,smartResolvedStyle(it),it.w,it.h,false]);})()`);
  assert.ok(chart.some(child=>child.type==='text'&&child.text==='50'));
}));

test('source-to-dataset demo accepts explicit source updates and independent edits in shipped HTML',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  try{
    await page.goto(pathToFileURL(readerPath).href);await readerTab(page,23);await readerText(page,23,'sheet','7');
    await readerHandle(page,23,'replace','trigger');await readerText(page,23,'sheet','65');await readerText(page,23,'chart','2 rows');
    await readerCell(page,23,'incoming','B4');let field=page.locator('#smartTextValue');await field.waitFor();await field.fill('50');await field.press('Enter');await field.waitFor({state:'detached'});
    await readerText(page,23,'incoming','50');await readerText(page,23,'sheet','65');
    await readerCell(page,23,'sheet','B2');field=page.locator('#smartTextValue');await field.waitFor();await field.fill('30');await field.press('Enter');await field.waitFor({state:'detached'});
    await readerText(page,23,'sheet','70');await readerText(page,23,'incoming','25');
    await readerHandle(page,23,'append','trigger');await readerText(page,23,'sheet','145');await readerText(page,23,'chart','4 rows');
    await readerHandle(page,23,'threshold','plus');await readerText(page,23,'filter','1 of 3 rows');await readerText(page,23,'sheet','145');
    await readerHandle(page,23,'replace','trigger');await readerText(page,23,'sheet','50');await readerText(page,23,'chart','1 row');
    await readerTab(page,22);await readerTab(page,23);await readerText(page,23,'sheet','50');
    await page.reload();await readerTab(page,23);await readerText(page,23,'sheet','7');await readerText(page,23,'incoming','40');
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  }finally{await context.close();}
});

async function saveInlineText(page,value){
  const field=page.locator('#smartTextValue');await field.waitFor({state:'visible'});await field.fill(value);await field.press('Enter');await field.waitFor({state:'detached'});
}

test('live editor and spreadsheet result examples keep local edits until their source refreshes',async()=>app(async({page,run})=>{
  await importExample(page,run);await activate(run,24);
  await editorHandle(page,run,24,'working-editor','cell-0-1');await saveInlineText(page,'99');await run('smartHitSettled');
  assert.equal(await run('datasets.working.rows[0][1]'),99);assert.equal(await run('datasets.incoming.rows[0][1]'),10);
  await editorHandle(page,run,24,'source-editor','cell-0-1');await saveInlineText(page,'12');
  await page.waitForFunction(()=>__test.run('datasets.working.rows[0][1]===12'));
  await activate(run,25);
  await editorHandle(page,run,25,'result-editor','cell-0-1');await saveInlineText(page,'99');await run('smartHitSettled');
  assert.equal(await run('datasets.results.rows[0][1]'),99);
  await editorHandle(page,run,25,'source-editor','cell-0-1');await saveInlineText(page,'12');
  await page.waitForFunction(()=>__test.run('datasets.results.rows[0][1]===24'));
  await editorHandle(page,run,25,'sheet','E2');await saveInlineText(page,'=B2*3');
  await page.waitForFunction(()=>__test.run('datasets.results.rows[0][1]===36'));
  assert.deepEqual(await run('datasets.results.rows'),[['Alpha',36],['Beta',50],['Gamma',80]]);
  assert.equal(await run('items.find(item=>item.uid==="demo-25-sheet").state.cells.E2'),'=B2*3','formula stays on the authored sheet');
}));

test('shipped live and calculated-result examples allow reader edits and refresh offline',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  const edit=async(tab,id,before,after)=>{
    await readerText(page,tab,id,before);
    const item=itemFor(tab,id),owner=workspace.tabs[tab-1].items.find(other=>other.uid===item.bindings.data.uid),reference=owner.inputValues.data,table=workspace.tabs[tab-1].datasets[reference.datasetId];
    const io={inputs:{data:reference,startRow:0,startColumn:0},tables:{inputs:{data:{...table,datasetId:reference.datasetId,rowCount:table.rows.length,editable:true}}}};
    // WebKit reports glyph bounds at the SVG group origin here. Click the real cell center,
    // transformed exactly like other reader controls, rather than treating text as a DOM input.
    const handle=vm.runInNewContext(item.script).handles(item.state,item.w,item.h,item,io).find(handle=>handle.id==='cell-0-1');assert.ok(handle);
    const point=await readerHost(page,tab,id).evaluate((host,handle)=>{const p=new DOMPoint(handle.x,handle.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},handle);
    await page.mouse.click(point.x,point.y);await saveInlineText(page,after);await readerText(page,tab,id,after);
  };
  try{
    await page.goto(pathToFileURL(readerPath).href);await readerTab(page,24);
    await edit(24,'working-editor','10','99');await readerText(page,24,'source-editor','10');
    await readerTab(page,23);await readerTab(page,24);await readerText(page,24,'working-editor','99');
    await edit(24,'source-editor','10','12');await readerText(page,24,'working-editor','12');
    await readerTab(page,25);await edit(25,'result-editor','20','99');
    await edit(25,'source-editor','10','12');await readerText(page,25,'result-editor','24');
    await readerHandle(page,25,'download','json');const dialog=page.locator('dialog[data-component-data-action="downloadTable"]');await dialog.waitFor({state:'visible'});
    const event=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download',exact:true}).click();const download=await event;
    assert.equal(download.suggestedFilename(),'calculated-readings.json');assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8').replace(/^\uFEFF/,'')),[{label:'Alpha',value:24},{label:'Beta',value:50},{label:'Gamma',value:80}]);
    await page.reload();await readerTab(page,25);await readerText(page,25,'result-editor','20');
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  }finally{await context.close();}
});


test('views and stored results demo edits original records through sorted views and copies calculated results explicitly',async()=>app(async({page,run})=>{
  await importExample(page,run);await activate(run,26);
  const inspect=async id=>run(`(async()=>{const item=items.find(item=>item.uid===${JSON.stringify(uid(26,id))});return {io:await resolveSmartComponentIo(item),handles:await requestSmartCall(item,'handles',[item.state,item.w,item.h,smartResolvedStyle(item)])};})()`);
  let view=await inspect('view'),calculated=await inspect('calculated'),stored=await inspect('stored');
  assert.deepEqual(view.io.inputs.data,{datasetId:'readings',rows:[1,0]});
  assert.deepEqual(view.io.tables.inputs.data.rowIds,['r1','r0']);
  assert.deepEqual(view.io.tables.inputs.data.rows,[['Gamma',40],['Beta',25]]);
  assert.equal(view.handles.find(handle=>handle.id==='cell-0-1').datasetCell.rowId,'r1','the first sorted row retains Gamma’s original record identity');
  assert.equal(view.handles.some(handle=>handle.id==='addRow'),false,'a filtered/sorted selection cannot append an unspecified record');
  assert.equal(calculated.io.tables.inputs.data.editable,false,'calculated rows have no write-back owner');
  assert.equal(calculated.handles.some(handle=>handle.datasetCell||handle.kind==='action'),false,'requesting edits does not make a calculated table editable');
  assert.notEqual(calculated.io.inputs.data.datasetId,'readings');assert.notEqual(calculated.io.inputs.data.datasetId,'saved');
  assert.equal(stored.io.inputs.data.datasetId,'saved');assert.equal(stored.io.tables.inputs.data.editable,true);
  const edit=async(id,handle,value)=>{await editorHandle(page,run,26,id,handle);await saveInlineText(page,value);await run('smartHitSettled');};
  const sum=async()=> (await inspect('calculated')).io.tables.inputs.data.rows;
  await edit('view','cell-0-1','50');
  assert.deepEqual(await run('datasets.readings.rows'),[['Beta',25],['Gamma',50],['Alpha',10]],'view edits reach the original record without sorting stored rows');
  assert.deepEqual(await run('datasets.readings.rowIds'),['r0','r1','r2']);assert.deepEqual(await sum(),[[75]]);assert.deepEqual(await run('datasets.saved.rows'),[[65]],'a stored copy waits for an explicit replacement');
  await editorHandle(page,run,26,'copy','trigger');await page.waitForFunction(()=>__test.run('datasets.saved.rows[0][0]===75'));await run('smartHitSettled');
  await edit('stored','cell-0-0','99');assert.deepEqual(await sum(),[[75]]);assert.deepEqual(await run('datasets.readings.rows'),[['Beta',25],['Gamma',50],['Alpha',10]],'editing the independent copy never changes its contributors');
  await edit('original','cell-0-1','30');assert.deepEqual(await sum(),[[80]]);assert.deepEqual(await run('datasets.saved.rows'),[[99]],'later source changes leave the edited Manual copy alone');
  await editorHandle(page,run,26,'copy','trigger');await page.waitForFunction(()=>__test.run('datasets.saved.rows[0][0]===80'));await run('smartHitSettled');
  assert.deepEqual((await inspect('view')).io.tables.inputs.data.rows,[['Gamma',50],['Beta',30]]);
}));

test('shipped views and stored results comparison keeps view edits shared and calculated copies independent offline',async()=>{
  const context=await browser.newContext({viewport:{width:1600,height:1100}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  const tab=workspace.tabs[25],readings=tab.datasets.readings,saved=tab.datasets.saved;
  const cellPoint=async(id,row,column)=>{
    const item=itemFor(26,id),definition=vm.runInNewContext(item.script),selected=id==='view',derived=id==='calculated',table=derived||id==='stored'?saved:readings;
    const reference={datasetId:derived?'derived-results':id==='stored'?'saved':'readings',...(selected?{rows:[1,0]}:{})};
    const snapshot={...table,datasetId:reference.datasetId,rows:selected?[table.rows[1],table.rows[0]]:table.rows,rowIds:selected?[table.rowIds[1],table.rowIds[0]]:table.rowIds,rowCount:selected?2:table.rows.length,editable:!derived};
    const io={inputs:{data:reference,startRow:0,startColumn:0},tables:{inputs:{data:snapshot}}};
    // Derive the actual rendered cell center. WebKit text bounds are not reliable inside the SVG host.
    const g=definition._view(item.state,item.w,item.h,io),point={x:g.pad+g.numberWidth+(column+.5)*g.cellWidth,y:g.bodyY+g.header+(row+.5)*g.rowHeight};
    return readerHost(page,26,id).evaluate((host,point)=>{const p=new DOMPoint(point.x,point.y).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};},point);
  };
  const edit=async(id,row,column,before,after)=>{
    await readerText(page,26,id,before);const point=await cellPoint(id,row,column);await page.mouse.click(point.x,point.y);
    const field=page.locator('#smartTextValue');await field.waitFor({state:'visible'});assert.equal(await field.inputValue(),before);
    await saveInlineText(page,after);await readerText(page,26,id,after);
  };
  try{
    await page.goto(pathToFileURL(readerPath).href);await readerTab(page,26);
    await readerText(page,26,'calculated','65');await readerText(page,26,'stored','65');
    const readOnlyPoint=await cellPoint('calculated',0,0);await page.mouse.click(readOnlyPoint.x,readOnlyPoint.y);
    assert.equal(await page.locator('[data-smart-inline-input]').count(),0,'aggregate results do not offer a misleading editing field');
    await edit('view',0,1,'40','50');await readerText(page,26,'original','50');await readerText(page,26,'calculated','75');await readerText(page,26,'stored','65');
    await readerHandle(page,26,'copy','trigger');await readerText(page,26,'stored','75');
    await edit('stored',0,0,'75','99');await readerText(page,26,'calculated','75');await readerText(page,26,'original','25');
    await edit('original',0,1,'25','30');await readerText(page,26,'view','30');await readerText(page,26,'calculated','80');await readerText(page,26,'stored','99');
    await readerHandle(page,26,'copy','trigger');await readerText(page,26,'stored','80');
    await readerTab(page,25);await readerTab(page,26);await readerText(page,26,'view','50');await readerText(page,26,'stored','80');
    await page.reload();await readerTab(page,26);await readerText(page,26,'view','40');await readerText(page,26,'calculated','65');await readerText(page,26,'stored','65');
    assert.equal(await page.locator('.tab-panel').nth(25).locator('[data-component-error]').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  }finally{await context.close();}
});


test('text operations demo compares and extracts connected strings in the editor',async()=>app(async({page,run})=>{
  await importExample(page,run);await activate(run,27);
  assert.equal((await outputs(run,27,'same-result')).value,true);
  assert.equal((await outputs(run,27,'valid-result')).value,true);
  assert.deepEqual(await outputs(run,27,'capture'),{text:'1042',found:true});
  assert.deepEqual(await outputs(run,27,'range'),{text:'🚀',found:true});
  const enter=async(id,value)=>{
    await editorHandle(page,run,27,id,'entry');const field=page.locator('#smartTextValue');
    const before=await page.locator('[data-smart-inline-input]').getAttribute('data-submissions');
    await field.fill(value);await field.press('Enter');
    await page.waitForFunction(before=>Number(document.querySelector('[data-smart-inline-input]')?.dataset.submissions)>Number(before||0),before);
    await run('smartHitSettled');await field.press('Escape');
  };
  await enter('message','Order-7 🚀');
  assert.equal((await outputs(run,27,'same-result')).value,false);
  assert.equal((await outputs(run,27,'valid-result')).value,true);
  assert.deepEqual(await outputs(run,27,'capture'),{text:'7',found:true});
  assert.deepEqual(await outputs(run,27,'range'),{text:'',found:false});
  await enter('message','Missing');
  assert.equal((await outputs(run,27,'valid-result')).value,false);
  assert.deepEqual(await outputs(run,27,'capture'),{text:'',found:false});
  await enter('message','Order-1234 🌍');await enter('expected','ORDER-1234 🌍');
  assert.equal((await outputs(run,27,'same-result')).value,true);
  assert.equal((await outputs(run,27,'valid-result')).value,false);
  assert.deepEqual(await outputs(run,27,'capture'),{text:'1234',found:true});
  assert.deepEqual(await outputs(run,27,'range'),{text:'🌍',found:true});
}));

test('text operations demo updates matches and captures without network access in shipped HTML',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  const enter=async(id,value)=>{
    await readerHandle(page,27,id,'entry');const form=page.locator('[data-smart-inline-input]'),field=form.locator('#smartTextValue');
    await field.waitFor({state:'visible'});const before=Number(await form.getAttribute('data-submissions')||0);
    await field.fill(value);await field.press('Enter');
    // Enter starts an asynchronous Worker call; inspect the accepted value before opening another field.
    await page.waitForFunction(({form,before})=>Number(form.dataset.submissions)>before,{form:await form.elementHandle(),before});
    await readerText(page,27,id,value);await field.press('Escape');await field.waitFor({state:'detached'});
  };
  try{
    await page.goto(pathToFileURL(readerPath).href);await readerTab(page,27);
    await readerText(page,27,'same-result','ON');await readerText(page,27,'valid-result','ON');
    await readerText(page,27,'captured-label','1042');await readerText(page,27,'ranged-label','🚀');
    await enter('message','Order-7 🚀');
    await readerText(page,27,'same-result','OFF');await readerText(page,27,'valid-result','ON');
    await readerText(page,27,'captured-label','7');await readerText(page,27,'range-found','OFF');
    await enter('message','Missing');
    await readerText(page,27,'valid-result','OFF');await readerText(page,27,'capture-found','OFF');
    await enter('message','Order-1234 🌍');await enter('expected','ORDER-1234 🌍');
    await readerText(page,27,'same-result','ON');await readerText(page,27,'valid-result','OFF');
    await readerText(page,27,'captured-label','1234');await readerText(page,27,'ranged-label','🌍');
    await readerText(page,27,'capture-found','ON');await readerText(page,27,'range-found','ON');
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
