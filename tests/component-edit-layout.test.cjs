const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');

// Use the real modal, fields, previews, and persistence. Expose only the fixture's
// app closure to seed a drawing and inspect state without driving unrelated UI.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});

async function app(viewport,fn){
  const context=await browser.newContext({viewport});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://component-edit.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://component-edit.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
async function builtins(run,specs){
  await run(`cancelGesture();applySketchToActiveTab(${JSON.stringify(specs)}.map((spec,index)=>{
    const base=clone(BUILTIN_LIBRARY_DEFINITIONS.find(entry=>entry.key===spec.key).items[0]);
    return {...base,x:80+index*350,y:140,uid:'edit-'+index,...spec,state:{...base.state,...spec.state}};
  }),{});selection=[];editingSmartIdx=null;setTool('select');render();`);
  await run('ensureEditorComponentGraph()');await run('save()');
}
async function openEdit(page,run,index=0){
  await run(`selection=[${index}];render()`);
  assert.match(await page.locator('#componentBindingsBtn').textContent(),/^Edit\s*[…\.]*$/);
  await page.locator('#componentBindingsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#componentBindingsDialog').open &&
    !document.querySelector('#componentBindingFields').disabled && !document.querySelector('#componentBindingsSave').disabled);
  assert.equal(await page.getByRole('dialog',{name:'Edit component',exact:true}).count(),1);
}
async function feedback(page,parts){
  await page.waitForFunction(parts=>{
    const output=document.querySelector('#componentOutputs');
    return output.getAttribute('aria-busy')!=='true' && parts.every(part=>output.textContent.includes(part));
  },parts,{timeout:10000});
}
async function snapshot(run){
  return run('({items,undo:undoStack,redo:redoStack,stored:JSON.parse(localStorage.getItem(docKey(activeTabId))).items})');
}
async function save(page){
  await page.locator('#componentBindingsSave').click();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
}
async function layout(page){
  return page.locator('#componentBindingsDialog').evaluate(dialog=>{
    const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const controls=['componentBindingsTitle','componentTypeName','componentBindingsCancel','componentBindingsSave'].map(id=>{
      const el=document.getElementById(id),r=rect(el),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {id,...r,visible:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,reachable:el===hit||el.contains(hit)};
    });
    const overflow=[dialog,...dialog.querySelectorAll('*')].filter(el=>{
      if(!el.getClientRects().length || getComputedStyle(el).overflowX==='auto' || getComputedStyle(el).overflowX==='scroll')return false;
      return el.clientWidth>0 && el.scrollWidth>el.clientWidth+2 && !['INPUT','SELECT','TEXTAREA'].includes(el.tagName);
    }).map(el=>({tag:el.tagName,id:el.id,className:el.className,client:el.clientWidth,scroll:el.scrollWidth}));
    return {dialog:rect(dialog),viewport:{width:innerWidth,height:innerHeight},controls,overflow};
  });
}
function assertLayout(result){
  assert.ok(result.dialog.x>=-1 && result.dialog.right<=result.viewport.width+1,'dialog fits viewport width');
  assert.ok(result.dialog.y>=-1 && result.dialog.bottom<=result.viewport.height+1,'dialog fits viewport height');
  assert.deepEqual(result.overflow,[],'modal contents do not cause horizontal overflow');
  for(const control of result.controls){
    assert.equal(control.visible,true,control.id+' stays in the viewport');
    assert.equal(control.reachable,true,control.id+' is not obscured by scrolling content');
  }
}
async function scrollContents(page,end){
  return page.locator('#componentBindingsDialog').evaluate((dialog,end)=>{
    const scrollables=[dialog,...dialog.querySelectorAll('*')].filter(el=>
      el.scrollHeight>el.clientHeight+2 && /auto|scroll/.test(getComputedStyle(el).overflowY));
    for(const el of scrollables)el.scrollTop=end?el.scrollHeight:0;
    return scrollables.length;
  },end);
}

for(const [name,viewport] of [['desktop',{width:1440,height:900}],['phone',{width:375,height:667}]]){
  test('Edit dialog keeps dense LED matrix fields usable on '+name,async()=>app(viewport,async({page,run})=>{
    await builtins(run,[{key:'ledMatrix'}]);await openEdit(page,run);
    for(const name of ['General','Configuration','Data inputs','Control inputs','Output preview']){
      assert.equal(await page.getByRole('heading',{name,exact:true}).isVisible(),true,name+' has a visible section heading');
    }
    assert.equal(await page.getByLabel('row0 (boolean)',{exact:true}).count(),1);
    assert.equal(await page.getByLabel('col7 (boolean)',{exact:true}).count(),1);
    assert.equal(await page.getByLabel('enable (boolean)',{exact:true}).count(),1);
    assertLayout(await layout(page));
    assert.ok(await scrollContents(page,true)>0,'dense inputs scroll within the modal');
    assertLayout(await layout(page));
    await page.getByLabel('enable value',{exact:true}).selectOption('false');
    await feedback(page,['r0 = 0']);assertLayout(await layout(page));
    await scrollContents(page,false);
    await page.getByLabel('Input mode',{exact:true}).selectOption('rows');
    await page.getByLabel('r7 value',{exact:true}).waitFor({state:'visible'});
    assert.equal(await page.getByLabel('col7 (boolean)',{exact:true}).count(),0,'mode change replaces obsolete controls');
    await page.getByLabel('r7 value',{exact:true}).fill('129');
    await page.getByLabel('enable value',{exact:true}).selectOption('true');
    await feedback(page,['r7 = 129']);assertLayout(await layout(page));
    await save(page);
    assert.equal(await run('items[0].state.mode'),'rows');
    assert.equal(await run('items[0].inputValues.r7'),129);
  }));
}

test('separate configuration and input sections preserve draft sources, literals, and name through Save and Cancel',async()=>app({width:1100,height:760},async({page,run})=>{
  await builtins(run,[{key:'constant',componentName:'External number',state:{value:42}},
    {key:'steppedSelectorNumber',componentName:'Original selector',inputValues:{in0:10,in1:20,in2:30,in3:40,pulse:false,reset:false}}]);
  const original=await snapshot(run);await openEdit(page,run,1);
  assert.equal(await page.locator('#componentTypeName').textContent(),'Stepped switch (number)');
  const name=page.locator('#componentBindingsDialog').getByLabel('Name',{exact:true}),channels=page.getByLabel('Channels',{exact:true});
  await name.fill('Edited selector');
  assert.equal(await page.locator('#componentTypeName').textContent(),'Stepped switch (number)','instance renaming preserves the component type');
  await page.getByLabel('in0 (number)',{exact:true}).selectOption({label:'External number · value'});
  await page.getByLabel('in1 value',{exact:true}).fill('73');
  await channels.fill('5');await channels.dispatchEvent('change');
  await page.getByLabel('in4 value',{exact:true}).waitFor({state:'visible'});
  assert.equal(await name.inputValue(),'Edited selector');
  assert.equal(await page.getByLabel('in0 (number)',{exact:true}).locator('option:checked').textContent(),'External number · value');
  assert.equal(await page.getByLabel('in1 value',{exact:true}).inputValue(),'73');
  await feedback(page,['value = 42']);
  assert.deepEqual(await snapshot(run),original,'draft layout updates do not mutate the drawing');
  await page.locator('#componentBindingsCancel').click();
  assert.deepEqual(await snapshot(run),original,'Cancel drops changes across all sections');
  await openEdit(page,run,1);
  assert.equal(await page.locator('#componentTypeName').textContent(),'Stepped switch (number)');
  assert.equal(await name.inputValue(),'Original selector');assert.equal(await channels.inputValue(),'4');
  await name.fill('Saved selector');
  await page.getByLabel('in0 (number)',{exact:true}).selectOption({label:'External number · value'});
  await page.getByLabel('in1 value',{exact:true}).fill('73');
  await channels.fill('5');await channels.dispatchEvent('change');
  await page.getByLabel('in4 value',{exact:true}).waitFor({state:'visible'});await save(page);
  assert.equal(await run('items[1].componentName'),'Saved selector');
  assert.equal(await run('items[1].state.channels'),5);
  assert.deepEqual(await run('items[1].bindings.in0'),{uid:'edit-0',port:'value'});
  assert.equal(await run('items[1].inputValues.in1'),73);
  assert.equal(await run('undoStack.length'),original.undo.length+1,'Save remains a single history step');
}));

test('simple components omit empty configuration and control sections and retain keyboard focus during previews',async()=>app({width:1000,height:720},async({page,run})=>{
  await builtins(run,[{key:'valueLabel'}]);const original=await snapshot(run);await openEdit(page,run);
  assert.equal(await page.getByRole('heading',{name:'Configuration',exact:true}).isVisible(),false);
  assert.equal(await page.getByRole('heading',{name:'Control inputs',exact:true}).isVisible(),false);
  const input=page.getByLabel('value value',{exact:true});
  await input.fill('6.25');await feedback(page,['value = 6.25']);
  assert.equal(await input.evaluate(el=>el===document.activeElement),true,'live output updates keep field focus');
  assertLayout(await layout(page));
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  assert.deepEqual(await snapshot(run),original,'Escape cancels a literal edit');
}));

test('editable choice lists fit a narrow inspector without hiding row actions',async()=>app({width:360,height:640},async({page,run})=>{
  await builtins(run,[{key:'dropdown'}]);await openEdit(page,run);
  const text=page.getByLabel('Choice 0 text',{exact:true});
  await text.fill('A much longer choice label that must stay inside its field');
  assertLayout(await layout(page));
  await page.getByRole('button',{name:'Move down choice 0',exact:true}).click();
  assert.equal(await page.getByLabel('Choice 1 text',{exact:true}).inputValue(),'A much longer choice label that must stay inside its field');
  await page.getByRole('button',{name:'Remove choice 2',exact:true}).click();
  assert.equal(await page.locator('[data-choice-row]').count(),2);
  assertLayout(await layout(page));
  await save(page);
  const choices=await run('JSON.parse(items[0].state.choices)');
  assert.equal(choices.length,2);assert.equal(choices[1].key,'idle');
}));

test('footer actions stay fixed through pending previews and errors, including field blur during Cancel',async()=>app({width:1100,height:900},async({page,run})=>{
  await builtins(run,[{key:'valueLabel'}]);const original=await snapshot(run);await openEdit(page,run);
  await feedback(page,['value =']);
  const buttons=async()=>Promise.all(['componentBindingsCancel','componentBindingsSave'].map(id=>page.locator('#'+id).boundingBox()));
  const positions=await buttons(),input=page.getByLabel('value value',{exact:true});
  const assertFixed=async state=>{
    const current=await buttons();
    for(let index=0;index<current.length;index++)for(const coordinate of ['x','y','width','height']){
      assert.ok(Math.abs(current[index][coordinate]-positions[index][coordinate])<.5,
        ['Cancel','Save'][index]+' '+coordinate+' stays fixed '+state);
    }
  };
  // Hold real evaluation replies to make the pending state deterministic instead
  // of depending on Worker speed. A new preview invalidates the earlier reply.
  await run(`(()=>{
    const inspect=inspectComponentGraph;
    inspectComponentGraph=async(list,valid,owners,pool)=>{
      const result=await inspect(list,valid,owners,pool);
      const value=list.find(item=>item.uid==='edit-0')?.inputValues?.value;
      if(value===13 || value===9)await new Promise(resolve=>{
        window.__releaseLayoutPreview??={};window.__releaseLayoutPreview[value]=resolve;
      });
      return result;
    };
  })()`);
  await input.fill('13');
  await page.waitForFunction(()=>typeof window.__releaseLayoutPreview?.[13]==='function');
  assert.equal(await page.locator('#componentOutputs').getAttribute('aria-busy'),'true');
  await assertFixed('while output is checking');
  await input.fill('');
  await page.waitForFunction(()=>document.querySelector('#componentBindingsError').textContent.includes('finite number'));
  await assertFixed('with a validation error');
  await page.evaluate(()=>window.__releaseLayoutPreview[13]());
  await input.fill('7');await feedback(page,['value = 7']);await assertFixed('after recovering from an error');
  await input.fill('9');
  // Preserve the physical pointer position while blur queues another preview.
  // An auto-height dialog used to move Cancel between pointerdown and pointerup.
  const cancel=positions[0],x=cancel.x+cancel.width/2,y=cancel.y+cancel.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.waitForFunction(()=>typeof window.__releaseLayoutPreview?.[9]==='function');
  await assertFixed('between pointerdown and pointerup');
  await page.mouse.up();
  await page.waitForFunction(()=>!document.querySelector('#componentBindingsDialog').open);
  await page.evaluate(()=>window.__releaseLayoutPreview[9]());
  assert.deepEqual(await snapshot(run),original,'blur-to-Cancel closes without saving the draft');
}));
