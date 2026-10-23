const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..');let browser;
before(async()=>{browser=await launchBrowser();});after(async()=>browser?.close());
async function app(fn,{viewport={width:1000,height:800}}={}){
  const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];
  const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
  try{
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('http://credentials-ux.test/**',route=>route.fulfill(route.request().url().endsWith('/index.html')?{contentType:'text/html',body:html}:{status:404,body:''}));
    await page.goto('http://credentials-ux.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');
    const open=async({mqtt=false,draft=false,name='Workshop service',existing=null,url=mqtt?'wss://broker.example.com/mqtt':'https://api.example.com/reading'}={})=>{
      await run(`window.fixtureItem={componentName:${JSON.stringify(name)}};window.fixtureStore=createIntegrationCredentialStore();window.fixtureChanged=0;window.fixtureResult=null;
        ${existing?`fixtureStore.set(fixtureItem,${JSON.stringify(existing)});`:''}
        void openIntegrationCredentials(fixtureItem,{caps:{${mqtt?'mqttConfig':'httpSource'}:{url:'url'}},io:{inputs:{url:${JSON.stringify(url)}}}},fixtureStore,{draft:${draft},changed:()=>fixtureChanged++}).then(value=>{fixtureResult=value;});`);
      const dialog=page.locator('[data-integration-credentials]');await dialog.waitFor();return dialog;
    };
    await fn({page,run,open});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}

test('HTTP credentials identify their destination and adapt authentication fields without exposing a saved token',()=>app(async({page,run,open})=>{
  const dialog=await open();assert.equal(await dialog.getAttribute('aria-labelledby'),'integration-credentials-title');
  await dialog.getByRole('heading',{name:'HTTP credentials'}).waitFor();assert.match(await dialog.textContent(),/Workshop service/);assert.match(await dialog.textContent(),/https:\/\/api.example.com/);
  assert.equal(await dialog.locator('[data-integration-user]').isVisible(),false);assert.equal(await dialog.locator('[data-integration-secret]').isVisible(),false);
  await dialog.getByLabel('Authentication',{exact:true}).selectOption('bearer');
  const token=dialog.getByLabel('Bearer token',{exact:true});await token.fill('a-private-token');assert.equal(await token.getAttribute('type'),'password');
  await dialog.getByRole('button',{name:'Show token',exact:true}).click();assert.equal(await token.getAttribute('type'),'text');
  assert.equal(await dialog.getByRole('button',{name:'Hide token',exact:true}).getAttribute('aria-pressed'),'true');
  await dialog.getByLabel('Authentication',{exact:true}).selectOption('basic');assert.equal(await dialog.locator('[data-integration-secret]').getAttribute('type'),'password');
  await dialog.getByLabel('Username',{exact:true}).fill('Anna');const password=dialog.getByLabel('Password',{exact:true});await password.fill('pässword');await password.press('Enter');await dialog.waitFor({state:'detached'});
  assert.deepEqual(await run('fixtureStore.get(fixtureItem)'),{auth:'basic',username:'Anna',secret:'pässword',origin:'https://api.example.com'});
  assert.equal(await run('fixtureChanged'),1);assert.equal(await run('fixtureResult'),true);
}));

test('MQTT credentials use broker-specific labels and allow the existing empty-password contract',()=>app(async({run,open})=>{
  const dialog=await open({mqtt:true,name:''});await dialog.getByRole('heading',{name:'MQTT credentials'}).waitFor();assert.match(await dialog.textContent(),/MQTT Config/);
  assert.deepEqual(await dialog.locator('[data-integration-auth] option').allTextContents(),['No authentication','Username and password']);
  await dialog.getByLabel('Authentication',{exact:true}).selectOption('mqtt');await dialog.getByLabel('Username',{exact:true}).fill('device');
  await dialog.getByLabel('Password',{exact:true}).press('Enter');await dialog.waitFor({state:'detached'});
  assert.deepEqual(await run('fixtureStore.get(fixtureItem)'),{auth:'mqtt',username:'device',secret:'',origin:'wss://broker.example.com'});
}));

test('credentials require an explicit nonempty URL instead of falling back to the editor origin',()=>app(async({page,run})=>{
  const errors=await run(`(async()=>{
    const errors=[],store=createIntegrationCredentialStore();
    for(const mqtt of [false,true])for(const url of ['', '   ', undefined, null, 123]){
      try{await openIntegrationCredentials({},{caps:{[mqtt?'mqttConfig':'httpSource']:{url:'url'}},io:{inputs:{url}}},store);errors.push('accepted');}
      catch(error){errors.push(error.message);}
    }
    return errors;
  })()`);
  assert.deepEqual(errors,[...Array(5).fill('Set a valid HTTP URL in Edit first'),...Array(5).fill('Set a valid WebSocket broker URL in Edit first')]);
  assert.equal(await page.locator('[data-integration-credentials]').count(),0);
}));

test('empty HTTP secrets keep the dialog open with actionable validation and Cancel leaves the store unchanged',()=>app(async({page,run,open})=>{
  const dialog=await open();await dialog.getByLabel('Authentication',{exact:true}).selectOption('bearer');await dialog.locator('[data-integration-save]').click();
  assert.equal(await dialog.getByRole('alert').textContent(),'Enter a bearer token.');assert.equal(await dialog.getByLabel('Bearer token',{exact:true}).evaluate(node=>node===document.activeElement),true);
  assert.equal(await run('fixtureStore.size'),0);assert.equal(await dialog.getByLabel('Bearer token',{exact:true}).getAttribute('aria-invalid'),'true');
  await dialog.getByLabel('Authentication',{exact:true}).selectOption('basic');await dialog.getByLabel('Username',{exact:true}).fill('invalid:name');await dialog.locator('[data-integration-save]').click();
  assert.equal(await dialog.getByRole('alert').textContent(),'An HTTP Basic username cannot contain a colon.');assert.equal(await dialog.getByLabel('Username',{exact:true}).evaluate(node=>node===document.activeElement),true);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await run('fixtureChanged'),0);assert.equal(await run('fixtureResult'),false);
}));

test('draft credentials explain Edit ownership and clearing authentication only changes the supplied store after acceptance',()=>app(async({run,open})=>{
  const existing={auth:'bearer',username:'',secret:'old-token',origin:'https://api.example.com'};
  let dialog=await open({draft:true,existing});await dialog.getByRole('button',{name:'Use in Edit',exact:true}).waitFor();assert.match(await dialog.locator('[data-integration-credential-note]').textContent(),/Canceling Edit discards/);
  await dialog.getByLabel('Authentication',{exact:true}).selectOption('none');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});assert.deepEqual(await run('fixtureStore.get(fixtureItem)'),existing);
  dialog=await open({draft:true,existing});await dialog.getByLabel('Authentication',{exact:true}).selectOption('none');await dialog.locator('[data-integration-save]').click();await dialog.waitFor({state:'detached'});assert.equal(await run('fixtureStore.size'),0);assert.equal(await run('fixtureChanged'),1);
}));

test('credentials remain keyboard-usable in a small viewport with long names and origins, and return focus on cancel',()=>app(async({page,open})=>{
  await page.locator('#menuBtn').focus();
  const dialog=await open({name:'A very long but recognizable workshop connection used for several sensor inputs',url:'https://a-very-long-workshop-service-hostname.example.com/reading'});
  await dialog.getByLabel('Authentication',{exact:true}).selectOption('basic');const password=dialog.getByLabel('Password',{exact:true});await password.focus();
  const geometry=await dialog.evaluate(node=>{const bounds=node.getBoundingClientRect(),button=node.querySelector('[data-integration-save]').getBoundingClientRect();return {x:bounds.x,y:bounds.y,right:bounds.right,bottom:bounds.bottom,buttonBottom:button.bottom,buttonTop:button.top,viewport:{w:innerWidth,h:innerHeight}};});
  assert.ok(geometry.x>=0&&geometry.y>=0&&geometry.right<=geometry.viewport.w&&geometry.bottom<=geometry.viewport.h);
  assert.ok(geometry.buttonTop>=0&&geometry.buttonBottom<=geometry.viewport.h,'save remains visible while the form scrolls');
  await password.fill('secret');await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#menuBtn').evaluate(node=>node===document.activeElement),true);
},{viewport:{width:360,height:480}}));

test('credential export keeps actions visible for a long list and only includes explicitly selected credentials',()=>app(async({page,run})=>{
  await run(`window.exportItems=Array.from({length:24},(_,index)=>({uid:'connection-'+index,componentName:'A long workshop connection name '+index}));
    window.exportStore=createIntegrationCredentialStore();for(const item of exportItems)exportStore.set(item,{auth:'bearer',username:'',secret:'private-'+item.uid,origin:'https://a-long-workshop-service.example.com'});
    window.exportResult='pending';void chooseIntegrationCredentialExport([{id:'sketch',name:'Workshop sensors',items:exportItems}],exportStore,'HTML').then(result=>{exportResult=result;});`);
  let dialog=page.locator('[data-integration-export]');await dialog.waitFor();await dialog.getByRole('heading',{name:'Credentials in HTML'}).waitFor();
  const checks=dialog.locator('[data-integration-include]');assert.equal(await checks.count(),24);
  assert.deepEqual(await checks.evaluateAll(nodes=>nodes.map(node=>node.checked)),Array(24).fill(false));
  assert.doesNotMatch(await dialog.textContent(),/private-connection/,'secret values are not displayed');
  const bounds=await dialog.evaluate(node=>{const d=node.getBoundingClientRect(),b=node.querySelector('[data-integration-export-continue]').getBoundingClientRect();return {left:d.left,right:d.right,top:d.top,bottom:d.bottom,buttonTop:b.top,buttonBottom:b.bottom,w:innerWidth,h:innerHeight};});
  assert.ok(bounds.left>=0&&bounds.right<=bounds.w&&bounds.top>=0&&bounds.bottom<=bounds.h);assert.ok(bounds.buttonTop>=0&&bounds.buttonBottom<=bounds.h);
  await checks.nth(0).check();await checks.nth(23).check();await dialog.locator('[data-integration-export-continue]').click();await dialog.waitFor({state:'detached'});
  const selected=await run('exportResult');assert.deepEqual(selected.map(value=>value.componentUid),['connection-0','connection-23']);assert.equal(selected[1].secret,'private-connection-23');
  await run(`void chooseIntegrationCredentialExport([{id:'sketch',name:'Workshop sensors',items:exportItems}],exportStore,'HTML').then(result=>{exportResult=result;});`);
  dialog=page.locator('[data-integration-export]');await dialog.waitFor();assert.deepEqual(await dialog.locator('[data-integration-include]').evaluateAll(nodes=>nodes.map(node=>node.checked)),Array(24).fill(false));
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await run('exportResult'),null);
},{viewport:{width:360,height:480}}));
