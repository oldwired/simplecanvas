const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');

// Expose the served copy's closure to seed drawings and inspect persistence.
// Form edits, component evaluation, source selection, and Save/Cancel are real.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://component-inputs.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://component-inputs.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function seed(run,expression){
  await run(`cancelGesture();applySketchToActiveTab(${expression},{});selection=[];editingSmartIdx=null;setTool('select');render();`);
  await run('ensureEditorComponentGraph()');await run('save()');
}
async function builtins(run,specs){
  await seed(run,`${JSON.stringify(specs)}.map((spec,index)=>{
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key===spec.key).items[0]);
    return {...base,x:80+index*350,y:140,uid:'input-'+index,...spec,state:{...base.state,...spec.state}};
  })`);
}
async function openInputs(page,run,index=0){
  await run(`selection=[${index}];render()`);await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open &&
    !document.querySelector('#componentBindingFields').disabled && !document.querySelector('#componentBindingsSave').disabled);
}
async function feedback(page,parts){
  await page.waitForFunction(parts=>{
    const output=document.querySelector('#componentOutputs');
    return output.getAttribute('aria-busy')!=='true' && parts.every(part=>output.textContent.includes(part));
  },parts,{timeout:10000});
}
async function error(page,pattern){
  await page.waitForFunction(source=>new RegExp(source,'i').test(document.querySelector('#componentBindingsError').textContent),pattern.source);
  assert.match(await page.locator('#componentOutputs').textContent(),/unavailable/i,'invalid input clears the last successful output');
}
async function snapshot(run){
  return run('(async()=>{await persistWorkspace();const saved=await readSavedWorkspace();return {items,undo:undoStack,redo:redoStack,stored:saved.workspace.tabs.find(tab=>tab.id===activeTabId).document.items};})()');
}
async function saveInputs(page){
  await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
}
async function drawing(page,uid,text){
  await page.waitForFunction(({uid,text})=>__test.run(`smartChildrenCache.get(${JSON.stringify(uid)})?.kids.some(item=>item.text===${JSON.stringify(text)})`),{uid,text});
}

const mixedScript=`({apiVersion:2,
  inputs:{value:{type:'number',default:2},enabled:{type:'boolean',default:false},word:{type:'string',default:'original'}},
  outputs:{result:{type:'number'},summary:{type:'string'}},
  compute(inputs){
    if(inputs.value<0)throw new Error('Value must be nonnegative');
    if(!inputs.word.trim())throw new Error('Word must not be empty');
    return {result:inputs.value*(inputs.enabled?2:1),summary:inputs.word+':'+(inputs.enabled?'on':'off')};
  },
  children(state,style,w,h,editing,io){return [
    {type:'text',x:0,y:0,w,h,text:io.outputs.result+' / '+io.outputs.summary,strokeOn:false}];}
})`;
const mixed={type:'smart',uid:'mixed',x:100,y:120,w:300,h:90,script:mixedScript,componentApi:2,
  componentName:'Mixed inputs',state:{retained:7},inputValues:{value:2,enabled:false,word:'original'},
  color:'#000000',strokeOn:false,fontFamily:'sans',fontSize:18};

test('same-named sources have readable distinct choices and save the chosen UID without renaming instances',async()=>app(async({page,run})=>{
  await builtins(run,[
    {key:'numberControl',state:{value:11}},
    {key:'numberControl',state:{value:78}},
    {key:'constant',componentName:'Limit',state:{value:100}},
    {key:'valueLabel',inputValues:{value:5},x:850,y:450}
  ]);
  await drawing(page,'input-3','5');
  const original=await snapshot(run),names=original.items.map(item=>item.componentName);
  await openInputs(page,run,3);
  const source=page.getByLabel('value (number)',{exact:true});
  const labels=await source.locator('option').allTextContents();
  assert.ok(labels.includes('Number control #1 (left) · value'));
  assert.ok(labels.includes('Number control #2 (right) · value'));
  assert.ok(labels.includes('Limit · value'),'a unique source keeps its familiar label');
  assert.equal(new Set(labels).size,labels.length);
  await source.selectOption({label:'Number control #2 (right) · value'});
  await feedback(page,['value = 78']);
  assert.equal(await page.getByLabel('value value',{exact:true}).isHidden(),true);
  assert.deepEqual(await snapshot(run),original,'selecting a source previews without changing the drawing or saved history');
  await drawing(page,'input-3','5');
  await saveInputs(page);await drawing(page,'input-3','78');
  assert.deepEqual(await run('items[3].bindings'),{value:{uid:'input-1',port:'value'}});
  assert.deepEqual(await run('items.map(item=>item.componentName)'),names);
  await openInputs(page,run,3);
  assert.equal(await source.locator('option:checked').textContent(),'Number control #2 (right) · value');
  await source.selectOption({label:'Number control #1 (left) · value'});await feedback(page,['value = 11']);
  await page.locator('#componentBindingsCancel').click();
  assert.deepEqual(await run('items[3].bindings'),{value:{uid:'input-1',port:'value'}},'Cancel retains the previously saved source');
}));

test('number, Boolean, and string edits show live validation while Cancel stays pure and Save uses the current controls',async()=>app(async({page,run})=>{
  await seed(run,JSON.stringify([mixed]));await drawing(page,'mixed','2 / original:off');
  await openInputs(page,run);const before=await snapshot(run);
  const value=page.getByLabel('value value',{exact:true}),enabled=page.getByLabel('enabled value',{exact:true}),word=page.getByLabel('word value',{exact:true});
  await value.fill('7');await feedback(page,['result = 7','summary = original:off']);
  await enabled.selectOption('true');await feedback(page,['result = 14']);
  await word.fill('edited');const originalField=await word.elementHandle();
  await feedback(page,['summary = edited:on']);
  assert.equal(await word.evaluate(input=>document.activeElement===input),true,'background feedback preserves keyboard focus');
  assert.equal(await originalField.evaluate(input=>input.isConnected),true,'ordinary edits do not rebuild the input fields');
  await value.fill('');await error(page,/finite number/);
  assert.doesNotMatch(await page.locator('#componentOutputs').textContent(),/result = 14/);
  await value.fill('-1');await error(page,/nonnegative/);
  await value.fill('3.5');await feedback(page,['result = 7']);
  await word.fill('');await error(page,/Word must not be empty/);
  await word.fill('recovered');await feedback(page,['result = 7','summary = recovered:on']);
  assert.equal(await page.locator('#componentBindingsError').textContent(),'');
  assert.deepEqual(await snapshot(run),before,'previews never mutate instance state, autosave, undo, or redo');
  await drawing(page,'mixed','2 / original:off');
  await page.locator('#componentBindingsCancel').click();
  assert.deepEqual(await snapshot(run),before);
  await openInputs(page,run);
  assert.equal(await value.inputValue(),'2');assert.equal(await enabled.inputValue(),'false');assert.equal(await word.inputValue(),'original');
  await value.fill('4.5');await enabled.selectOption('true');await word.fill('saved');
  // Save during the debounce must validate these controls, never the last completed preview.
  await saveInputs(page);await drawing(page,'mixed','9 / saved:on');
  assert.deepEqual(await run('items[0].inputValues'),{value:4.5,enabled:true,word:'saved'});
  assert.deepEqual(await run('items[0].state'),{retained:7});
  assert.equal(await run('undoStack.length'),before.undo.length+1,'one Save is one undo step');
  await run('undo()');await drawing(page,'mixed','2 / original:off');
}));

test('late preview replies cannot replace newer edits or a reopened dialog',async()=>app(async({page,run})=>{
  await seed(run,JSON.stringify([mixed]));
  // Hold a completed real sandbox evaluation to model a delayed reply deterministically.
  await run(`(()=>{
    const inspect=inspectComponentGraph;
    inspectComponentGraph=async(list,valid,owners)=>{
      const graph=await inspect(list,valid,owners);
      if(list.find(item=>item.uid==='mixed')?.inputValues?.value===13){
        await new Promise(resolve=>{window.__releaseInputPreview=resolve;});
      }
      return graph;
    };
  })()`);
  await openInputs(page,run);const before=await snapshot(run);
  const value=page.getByLabel('value value',{exact:true});
  await value.fill('13');await page.waitForFunction(()=>typeof window.__releaseInputPreview==='function');
  assert.equal(await page.locator('#componentOutputs').getAttribute('aria-busy'),'true');
  await value.fill('8');await feedback(page,['result = 8']);
  await page.evaluate(async()=>{const release=window.__releaseInputPreview;delete window.__releaseInputPreview;release();await new Promise(requestAnimationFrame);});
  assert.match(await page.locator('#componentOutputs').textContent(),/result = 8/);
  assert.equal(await value.inputValue(),'8');
  await value.fill('13');await page.waitForFunction(()=>typeof window.__releaseInputPreview==='function');
  await page.locator('#componentBindingsCancel').click();await openInputs(page,run);
  await feedback(page,['result = 2','summary = original:off']);
  await page.evaluate(async()=>{const release=window.__releaseInputPreview;delete window.__releaseInputPreview;release();await new Promise(requestAnimationFrame);});
  assert.equal(await value.inputValue(),'2');assert.match(await page.locator('#componentOutputs').textContent(),/result = 2/);
  assert.deepEqual(await snapshot(run),before);
  await page.locator('#componentBindingsCancel').click();
}));

test('live feedback respects dynamic ports and inspects a stepped selector without advancing its state',async()=>app(async({page,run})=>{
  await builtins(run,[{key:'steppedSelectorNumber',state:{position:1},
    inputValues:{in0:10,in1:20,in2:30,in3:40,pulse:false,reset:false}}]);
  await openInputs(page,run);await feedback(page,['value = 20','position = 1']);const before=await snapshot(run);
  await page.getByLabel('pulse value',{exact:true}).selectOption('true');await feedback(page,['value = 20','position = 1']);
  await page.getByLabel('reset value',{exact:true}).selectOption('true');await feedback(page,['value = 20','position = 1']);
  assert.deepEqual(await snapshot(run),before,'previewed pulses and resets do not invoke transition');
  const channels=page.getByLabel('Channels',{exact:true});
  await channels.fill('3');await channels.dispatchEvent('change');
  await page.getByLabel('in2 value',{exact:true}).waitFor({state:'visible'});
  await feedback(page,['value = 10','position = 0']);
  assert.equal(await page.getByLabel('in3 value',{exact:true}).count(),0,'port fields match the draft configuration');
  await page.getByLabel('in0 value',{exact:true}).fill('77');await feedback(page,['value = 77']);
  await channels.fill('1');await channels.dispatchEvent('change');await error(page,/channels.*range/i);
  await channels.fill('5');await channels.dispatchEvent('change');
  await page.getByLabel('in4 value',{exact:true}).waitFor({state:'visible'});await feedback(page,['value = 77','position = 0']);
  assert.equal(await page.getByLabel('in4 value',{exact:true}).inputValue(),'0');
  assert.equal(await page.locator('#componentBindingsError').textContent(),'');
  assert.deepEqual(await snapshot(run),before,'dynamic port previews do not alter the saved configuration');
  await page.locator('#componentBindingsCancel').click();await openInputs(page,run);
  assert.equal(await channels.inputValue(),'4');assert.equal(await page.getByLabel('in3 value',{exact:true}).inputValue(),'40');
  await feedback(page,['value = 20','position = 1']);
  await page.locator('#componentBindingsCancel').click();
}));
