const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>browser?.close());
const keys=['httpSource','httpPost','mqttConfig','mqttSubscribe','mqttPublish'];

async function app(fn,{width=1440,height=1000}={}){
  const root=path.join(__dirname,'..'),html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
  const server=http.createServer((request,response)=>{response.writeHead(request.url==='/index.html'?200:404,{'Content-Type':'text/html'});response.end(request.url==='/index.html'?html:'');});
  const context=await browser.newContext({viewport:{width,height}}),errors=[],requests=[],sockets=[];
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('websocket',socket=>sockets.push(socket.url()));
    page.on('request',request=>{if(request.url().startsWith('https://sensor.invalid/'))requests.push(request.url());});
    await page.route('https://sensor.invalid/**',route=>route.fulfill({contentType:'application/json',body:'{"value":1}'}));
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run(`(async()=>{cancelGesture();items=${JSON.stringify(keys)}.map((key,index)=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid:key,componentName:'My '+key,x:50+(index%3)*370,y:70+Math.floor(index/3)*260}));
      items[0].inputValues.url='https://sensor.invalid/read';items[1].inputValues.url='https://sensor.invalid/write';items[2].inputValues.url='ws://127.0.0.1:65534/mqtt';
      items[3].inputValues.topic='readings/room';items[4].inputValues.topic='commands/room';
      for(const index of [3,4])items[index].mqttBinding={sketchId:activeTabId,componentUid:'mqttConfig'};
      datasets={};selection=[];editingSmartIdx=null;setTool('select');render();save();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);
    await fn({page,run,requests,sockets});assert.deepEqual(errors,[],'inspector interactions do not cause uncaught errors');assert.deepEqual(requests,[],'editing never sends HTTP requests');assert.deepEqual(sockets,[],'editing never opens MQTT connections');
  }finally{await context.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
async function open(page,run,key){
  await run(`selection=[items.findIndex(item=>item.uid===${JSON.stringify(key)})];openComponentBindings()`);
  await page.locator('#componentBindingsSave:enabled').waitFor();
}
async function port(page,run,name){
  const id=await run(`componentDialogSession.rows.find(row=>row.name===${JSON.stringify(name)}).input.id`);
  return page.locator('#'+id);
}
async function source(page,run,name){
  const id=await run(`componentDialogSession.rows.find(row=>row.name===${JSON.stringify(name)}).select.id`);
  return page.locator('#'+id);
}
async function expose(locator){
  // Reveal the actual disclosure controls before editing; hidden inapplicable fields stay hidden.
  for(let depth=0;depth<4;depth++){
    const summary=locator.locator('xpath=ancestor::details[not(@open)][1]/summary');
    if(!await summary.count())break;
    await summary.click();
  }
}
async function setting(page,name,value){
  const locator=page.locator('#component-setting-'+name);await expose(locator);await locator.focus();
  if(await locator.evaluate(node=>node.tagName==='SELECT'))await locator.selectOption(value);else{await locator.fill(value);await locator.blur();}
  await page.locator('#componentBindingsSave:enabled').waitFor();
}
async function save(page){await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});}

test('Phase 6 inspectors put connection setup first and fit narrow screens without hiding Save',()=>app(async({page,run})=>{
  for(const key of keys){
    await open(page,run,key);
    const primary=['mqttSubscribe','mqttPublish'].includes(key)?page.locator('#component-mqtt-config'):await port(page,run,'url');
    const bounds=await primary.boundingBox(),footer=await page.locator('.component-edit-footer').boundingBox();
    assert.ok(bounds && bounds.y+bounds.height<footer.y,key+' connection is visible before scrolling');
    assert.ok(await page.locator('#componentBindingsSave').isVisible());
    assert.equal(await page.locator('#componentBindingsDialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1),true,key+' dialog has no horizontal overflow');
    assert.equal(await page.locator('.component-edit-body').evaluate(body=>body.scrollWidth<=body.clientWidth+1),true,key+' body has no horizontal overflow');
    if(!['mqttSubscribe','mqttPublish'].includes(key))assert.equal(await page.locator('#'+await primary.getAttribute('id')+'-help').isVisible(),true,'connection hint is visible on initial render');
    assert.doesNotMatch(await page.locator('#componentBindingsDialog').innerText(),/Mode and size changes can reset stored values/);
    await page.locator('#componentBindingsCancel').click();
  }
},{width:390,height:844}));

test('HTTP automatic-refresh controls keep inactive settings and draft inputs through mode changes',()=>app(async({page,run})=>{
  await open(page,run,'httpSource');
  const url=await port(page,run,'url');await url.fill('https://sensor.invalid/next');
  const interval=await port(page,run,'interval');assert.equal(await interval.isVisible(),false);
  assert.equal(await page.locator('#component-setting-debounceSeconds').isVisible(),false);
  await setting(page,'polling','true');await (await port(page,run,'interval')).fill('17');await (await port(page,run,'interval')).blur();
  await setting(page,'refreshOnChange','true');
  assert.equal(await page.locator('#component-setting-refreshOnChange').evaluate(node=>node===document.activeElement),true,'mode changes preserve keyboard focus');
  await setting(page,'debounceSeconds','1.25');
  await setting(page,'polling','false');await setting(page,'refreshOnChange','false');
  assert.equal(await (await port(page,run,'interval')).isVisible(),false);assert.equal(await page.locator('#component-setting-debounceSeconds').isVisible(),false);
  await setting(page,'polling','true');await setting(page,'refreshOnChange','true');
  assert.equal(await (await port(page,run,'interval')).inputValue(),'17');assert.equal(await page.locator('#component-setting-debounceSeconds').inputValue(),'1.25');
  assert.equal(await (await port(page,run,'url')).inputValue(),'https://sensor.invalid/next');
  await save(page);const item=await run("items.find(item=>item.uid==='httpSource')");
  assert.equal(item.inputValues.interval,17);assert.equal(item.state.debounceSeconds,1.25);assert.equal(item.inputValues.url,'https://sensor.invalid/next');
}));

test('an unfinished HTTP polling interval stays visible for repair after polling is disabled',()=>app(async({page,run})=>{
  await open(page,run,'httpSource');await setting(page,'polling','true');await (await port(page,run,'interval')).fill('');
  await setting(page,'polling','false');
  const interval=await port(page,run,'interval');
  assert.equal(await interval.isVisible(),true,'turning polling off does not hide an invalid draft');assert.equal(await interval.inputValue(),'');
  await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsError').filter({hasText:'needs a finite number'}).waitFor();
  assert.equal(await interval.isVisible(),true,'the field remains reachable after validation');
  await interval.fill('12');await save(page);
  const item=await run("items.find(item=>item.uid==='httpSource')");assert.equal(item.state.polling,false);assert.equal(item.inputValues.interval,12);
}));

test('MQTT text mode hides unused JSON mapping but preserves its value and any explicit wire',()=>app(async({page,run})=>{
  await open(page,run,'mqttSubscribe');await (await port(page,run,'path')).fill('/room/value');await setting(page,'format','text');
  assert.equal(await (await port(page,run,'path')).isVisible(),false);await setting(page,'format','json');
  assert.equal(await (await port(page,run,'path')).inputValue(),'/room/value');
  const ref=JSON.stringify({uid:'httpSource',port:'json'});await (await source(page,run,'path')).selectOption(ref);await setting(page,'format','text');
  assert.equal(await (await source(page,run,'path')).isVisible(),true,'an ignored but wired mapping remains discoverable');await save(page);
  assert.deepEqual(await run("items.find(item=>item.uid==='mqttSubscribe').bindings.path"),{uid:'httpSource',port:'json'});
}));

test('HTTP body and MQTT payload support multiline drafts without changing the source on Cancel',()=>app(async({page,run})=>{
  for(const [key,name] of [['httpPost','body'],['mqttPublish','payload']]){
    await open(page,run,key);const before=await run(`JSON.stringify(items.find(item=>item.uid===${JSON.stringify(key)}))`),input=await port(page,run,name),text='{\n  "message": "Hello",\n  "value": 42\n}';
    assert.equal(await input.evaluate(node=>node.tagName),'TEXTAREA');await input.fill(text);
    await setting(page,'showIndicators','false');assert.equal(await (await port(page,run,name)).inputValue(),text);
    await page.locator('#componentBindingsCancel').click();assert.equal(await run(`JSON.stringify(items.find(item=>item.uid===${JSON.stringify(key)}))`),before);
    await open(page,run,key);await (await port(page,run,name)).fill(text);await save(page);
    assert.equal(await run(`items.find(item=>item.uid===${JSON.stringify(key)}).inputValues[${JSON.stringify(name)}]`),text);
  }
}));

test('credentials opened from Edit remain a draft until Save and are discarded with Cancel',()=>app(async({page,run})=>{
  for(const [key,mode] of [['httpSource','bearer'],['mqttConfig','mqtt']]){
    const secret='draft-secret-'+key;
    const editCredentials=async()=>{
      await page.locator('[data-integration-edit-credentials]').click();
      const dialog=page.locator('[data-integration-credentials]');await dialog.waitFor();
      await dialog.locator('[data-integration-auth]').selectOption(mode);
      if(mode==='mqtt')await dialog.locator('[data-integration-user]').fill('author');
      await dialog.locator('[data-integration-secret]').fill(secret);
      await dialog.locator('[data-integration-save]').click();await dialog.waitFor({state:'detached'});
    };
    await open(page,run,key);await editCredentials();
    assert.equal(await run(`!!editorIntegrationCredentials.get(items.find(item=>item.uid===${JSON.stringify(key)}))`),false,'credential dialog does not commit an Edit draft');
    await page.locator('#componentBindingsCancel').click();
    assert.equal(await run(`!!editorIntegrationCredentials.get(items.find(item=>item.uid===${JSON.stringify(key)}))`),false,'Cancel discards draft credentials');
    await open(page,run,key);await editCredentials();await save(page);
    assert.equal(await run(`editorIntegrationCredentials.get(items.find(item=>item.uid===${JSON.stringify(key)})).secret`),secret);
    assert.equal(await run(`JSON.stringify(items).includes(${JSON.stringify(secret)})`),false,'credentials never enter authored component state');
  }
}));

test('Edit requires reconfirming draft credentials when an HTTP or MQTT endpoint origin changes',()=>app(async({page,run})=>{
  for(const [key,mode,url] of [['httpSource','bearer','https://other.invalid/reading'],['mqttConfig','mqtt','ws://127.0.0.1:65533/mqtt']]){
    const before=await run(`JSON.stringify(items.find(item=>item.uid===${JSON.stringify(key)}))`),secret='origin-secret-'+key;
    await open(page,run,key);
    const credentials=async()=>{
      await page.locator('[data-integration-edit-credentials]').click();const dialog=page.locator('[data-integration-credentials]');await dialog.waitFor();
      await dialog.locator('[data-integration-auth]').selectOption(mode);
      if(mode==='mqtt')await dialog.locator('[data-integration-user]').fill('author');
      await dialog.locator('[data-integration-secret]').fill(secret);await dialog.locator('[data-integration-save]').click();await dialog.waitFor({state:'detached'});
    };
    await credentials();await (await port(page,run,'url')).fill(url);
    assert.match(await page.locator('[data-integration-credential-status]').textContent(),/URL changed/);
    await page.locator('#componentBindingsSave').click();
    await page.locator('#componentBindingsError').filter({hasText:'The URL changed after credentials were entered'}).waitFor();
    assert.equal(await page.locator('#componentBindingsDialog').isVisible(),true);
    assert.equal(await run(`JSON.stringify(items.find(item=>item.uid===${JSON.stringify(key)}))`),before,'rejected Save leaves authored state intact');
    assert.equal(await run(`!!editorIntegrationCredentials.get(items.find(item=>item.uid===${JSON.stringify(key)}))`),false,'rejected Save does not store credentials for the wrong origin');
    await credentials();await save(page);
    const credential=await run(`editorIntegrationCredentials.get(items.find(item=>item.uid===${JSON.stringify(key)}))`);
    assert.equal(credential.origin,new URL(url).origin);assert.equal(credential.secret,secret);
    assert.equal(await run(`JSON.stringify(items).includes(${JSON.stringify(secret)})`),false);
  }
}));

test('custom integration settings keep choice editors editable in Other configuration',()=>app(async({page,run})=>{
  await run(`(async()=>{const item=items.find(item=>item.uid==='httpSource');
    item.script='(()=>{const integration=('+item.script+');integration.settings.customChoices={type:"string",format:"choices",default:"[]",label:"Custom choices"};integration.settings.customCaption={type:"string",default:"Original",label:"Custom caption"};return integration;})()';
    item.state.customChoices=JSON.stringify([{text:'Original',key:'original'}]);item.state.customCaption='Original';
    editorComponentEvaluation=null;render();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);
  const before=await run("JSON.stringify(items.find(item=>item.uid==='httpSource'))");await open(page,run,'httpSource');
  const choices=page.locator('[data-integration-section="other"] [data-component-choices="customChoices"]');assert.equal(await choices.isVisible(),true);
  await choices.getByRole('textbox',{name:'Choice 0 text',exact:true}).fill('First edited choice');
  await choices.getByRole('button',{name:'Add choice',exact:true}).click();
  await choices.getByRole('textbox',{name:'Choice 1 text',exact:true}).fill('Second choice');
  await choices.getByRole('textbox',{name:'Choice 1 key',exact:true}).fill('second');
  await setting(page,'customCaption','Caption draft');await setting(page,'valueType','string');
  assert.equal(await choices.getByRole('textbox',{name:'Choice 0 text',exact:true}).inputValue(),'First edited choice');
  assert.equal(await page.locator('#component-setting-customCaption').inputValue(),'Caption draft');
  assert.equal(await run("JSON.stringify(items.find(item=>item.uid==='httpSource'))"),before,'custom drafts do not mutate the scene');
  await save(page);
  const state=await run("items.find(item=>item.uid==='httpSource').state");
  assert.deepEqual(JSON.parse(state.customChoices),[{text:'First edited choice',key:'original'},{text:'Second choice',key:'second'}]);assert.equal(state.customCaption,'Caption draft');
}));
