const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
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
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
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
  await page.waitForFunction(()=>__test.run('tabs.length===19 && tabs[0].name.startsWith("1")'));
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
  if(!['text','number'].includes(handle.kind))await run('smartHitSettled');
}
const outputs=(run,tab,id)=>run(`(async()=> (await resolveSmartComponentIo(items.find(item=>item.uid===${JSON.stringify(uid(tab,id))}))).outputs)()`);
async function waitState(page,tab,id,expression){
  await page.waitForFunction(({target,expression})=>__test.run(`(()=>{const state=items.find(item=>item.uid===${JSON.stringify(target)})?.state;return !!state && (${expression});})()`),{target:uid(tab,id),expression});
}

test('shipped workspace imports all nineteen tabs with valid local bindings and current component sources',async()=>app(async({page,run})=>{
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
  assert.equal(checked.length,19);
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
  assert.deepEqual(Object.keys(crossingOutputs),Array.from({length:8},(_,index)=>'r'+index));
  assert.deepEqual(Object.values(crossingOutputs),[170,0,170,0,170,0,170,0]);
  await editorHandle(page,run,8,'even-rows','toggle');await editorHandle(page,run,8,'even-cols','toggle');
  assert.deepEqual(Object.values(await outputs(run,8,'crossings')),Array(8).fill(255));
  await editorHandle(page,run,8,'row-byte','plus');assert.equal((await outputs(run,8,'smiley')).r0,61);

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

test('shipped offline HTML has nineteen working tabs and needs no HTTP dependencies',async()=>{
  assert.ok(fs.existsSync(readerPath),'the shipped HTML companion exists');
  const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  try{
    await page.goto(pathToFileURL(readerPath).href);assert.equal(await page.locator('.tab-select').count(),19);
    for(let tab=1;tab<=19;tab++){
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
