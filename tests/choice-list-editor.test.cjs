const {parseApp}=require('./helpers/app-source.cjs');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {launchBrowser}=require('./helpers/browser.cjs');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const html=source.replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const contract=vm.createContext({});vm.runInContext(parseApp(source).declaration('parseComponentChoices')+'\nthis.parse=parseComponentChoices;',contract);
const engine=process.env.BROWSER_ENGINE||'chromium';let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{await browser?.close();});

test('local choice list validation preserves text, allows blank keys, and bounds stored configuration',()=>{
  const value=JSON.stringify([{text:'<Running>',key:'run'},{text:'',key:''},{text:'<Running>',key:''}]);
  assert.equal(JSON.stringify(contract.parse(value)),value);
  assert.equal(contract.parse('[]').length,0);
  for(const value of ['{}','null','bad','[null]',JSON.stringify([{text:'A',key:'a'},{text:'B',key:'a'}]),
    JSON.stringify([{text:'A',key:1}]),JSON.stringify([{text:'A',key:'a',action:'execute'}]),
    JSON.stringify(Array.from({length:65},()=>({text:'',key:''}))),JSON.stringify([{text:'x'.repeat(2000),key:''}])])
    assert.throws(()=>contract.parse(value));
});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://choice-list.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://choice-list.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');
    const script=fs.readFileSync(path.join(root,'examples/dropdown.js'),'utf8');
    await run(`window.choiceScript=${JSON.stringify(script)};cancelGesture();items=[];datasets={states:parseDatasetText('Text,Key\\nGreen,go\\nRed,stop','states.csv')};
      const def=eval('('+window.choiceScript+')');items=[{type:'smart',uid:'choice-editor',componentApi:2,componentName:'Operating mode',script:window.choiceScript,
        x:80,y:100,...def.initStyle(),state:def.initState(),inputValues:{select:0},bindings:{}}];selection=[0];setTool('select');render();save();`);
    await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');await fn({page,run});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
// Undo/Redo and dialog closure can replace a pending paint. Await the accepted
// graph through the host's bounded read retry; never replay the edit itself.
async function open(run,page){await run('selection=[0];openComponentBindings()');await page.locator('[data-component-choices="choices"]').waitFor();}
async function save(run,page){await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');}

test('editable choice rows validate live, preserve drafts, and save or cancel atomically with undo',async()=>app(async({page,run})=>{
  const original=await run('items[0].state.choices');await open(run,page);
  await page.getByRole('textbox',{name:'Choice 0 text',exact:true}).fill('Waiting');
  await page.getByRole('textbox',{name:'Choice 0 key',exact:true}).fill('running');
  await page.waitForFunction(()=>document.getElementById('componentBindingsError').textContent.includes('unique'));
  await page.getByRole('textbox',{name:'Choice 0 key',exact:true}).fill('waiting');
  await page.waitForFunction(()=>!document.getElementById('componentBindingsError').textContent);
  await page.getByRole('button',{name:'Add choice',exact:true}).click();
  await page.getByRole('textbox',{name:'Choice 3 text',exact:true}).fill('Finished');
  await page.getByRole('textbox',{name:'Choice 3 key',exact:true}).fill('finished');
  await page.getByRole('button',{name:'Move up choice 3',exact:true}).click();
  await page.getByRole('button',{name:'Remove choice 1',exact:true}).click();
  assert.equal(await run('items[0].state.choices'),original,'editing rows does not mutate the scene');
  await save(run,page);
  assert.deepEqual(JSON.parse(await run('items[0].state.choices')),[{text:'Waiting',key:'waiting'},{text:'Finished',key:'finished'},{text:'Stopped',key:'stopped'}]);
  assert.equal(await run('(async()=>(await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)).get(items[0]).io.outputs.text)()'),'Waiting');
  await run('undo()');await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');assert.equal(await run('items[0].state.choices'),original);
  await run('redo()');await run('resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)');const saved=await run('items[0].state.choices');
  await open(run,page);await page.getByRole('textbox',{name:'Choice 0 text',exact:true}).fill('Discard me');
  await page.locator('#componentBindingsCancel').click();assert.equal(await run('items[0].state.choices'),saved);
  await open(run,page);await page.getByRole('textbox',{name:'Choice 0 text',exact:true}).fill('x'.repeat(2000));
  await page.waitForFunction(()=>document.getElementById('componentBindingsError').textContent.includes('2,000'));
  await page.getByRole('textbox',{name:'Choice 0 text',exact:true}).fill('Recovered');await save(run,page);
  assert.equal(JSON.parse(await run('items[0].state.choices'))[0].text,'Recovered');
}));

test('switching between local choices and a dataset preserves the edited list and selects text/key columns',async()=>app(async({page,run})=>{
  await open(run,page);await page.getByRole('textbox',{name:'Choice 0 text',exact:true}).fill('Local draft');
  await page.locator('#component-setting-source').selectOption('dataset');
  await page.getByLabel('data dataset',{exact:true}).waitFor();
  await page.locator('#datasetFileInput-data').setInputFiles({name:'states.csv',mimeType:'text/csv',buffer:Buffer.from('Text,Key\nGreen,go\nRed,stop')});
  await page.getByLabel('textColumn value',{exact:true}).selectOption('Text');
  await page.getByLabel('keyColumn value',{exact:true}).selectOption('Key');await save(run,page);
  const output=await run('(async()=>(await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)).get(items[0]).io.outputs)()');
  assert.deepEqual(output,{index:0,key:'go',text:'Green',valid:true});
  assert.equal(JSON.parse(await run('items[0].state.choices'))[0].text,'Local draft');
  await open(run,page);await page.locator('#component-setting-source').selectOption('list');
  await page.getByLabel('data dataset',{exact:true}).waitFor({state:'detached'});await save(run,page);
  assert.equal(await run('(async()=>(await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true)).get(items[0]).io.outputs.text)()'),'Local draft');
  const saved=await run('makeDocument(items,assets,{},datasets)');assert.equal(saved.items[0].state.source,'list');
  assert.equal(JSON.parse(saved.items[0].state.choices)[0].text,'Local draft');assert.equal(saved.items[0].inputValues.select,0,'serialization preserves the selected first row');
}));
