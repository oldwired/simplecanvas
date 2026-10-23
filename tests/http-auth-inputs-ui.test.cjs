const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..');
const definitions=['http-source.js','http-post.js'].map(file=>{
  const script=fs.readFileSync(path.join(root,'examples',file),'utf8');
  return {file,script,definition:vm.runInNewContext(script,{Intl,Date})};
});
const plain=value=>JSON.parse(JSON.stringify(value));

test('HTTP authentication modes expose only the relevant credential control inputs',()=>{
  for(const {file,definition:def} of definitions){
    const base=def.inputs(def.initState()),ordinary=Object.keys(base);
    for(const authMode of ['session','none','bearer','basic']){
      const state={...def.initState(),authMode},ports=def.inputs(state),auth=def.httpSource(state).auth;
      const credentials=authMode==='bearer'?['token']:authMode==='basic'?['username','password']:[];
      assert.deepEqual(Object.keys(ports),[...ordinary,...credentials],file+' preserves its existing ports');
      assert.deepEqual(plain(auth),{mode:authMode,...Object.fromEntries(credentials.map(name=>[name,name]))});
      for(const name of credentials)assert.deepEqual(plain(ports[name]),{role:'control',type:'string',default:'',label:({token:'Bearer token',username:'Username',password:'Password'})[name]});
    }
    const state=def.initState();delete state.authMode;
    assert.equal(def.httpSource(state).auth.mode,'session');
  }
});

test('HTTP cards reserve Credentials for session mode and expand the action in input modes',()=>{
  for(const {file,definition:def} of definitions){
    const style=def.initStyle(),action=file==='http-source.js'?'refresh':'send';
    for(const authMode of ['session','none','bearer','basic']){
      const state={...def.initState(),authMode};
      const children=def.children(state,style,style.w,style.h,true,{inputs:{url:'https://example.test/read',token:'private-token',username:'private-name',password:'private-password'}});
      const labels=children.filter(child=>child.type==='text').map(child=>child.text),handles=def.handles(state,style.w,style.h);
      assert.equal(labels.includes('Credentials…'),authMode==='session');
      assert.deepEqual(plain(handles.map(handle=>handle.id)),authMode==='session'?[action,'connection']:[action]);
      for(const handle of handles)assert.equal(def.hitEdit(state,handle.x,handle.y,style.w,style.h),handle.id);
      if(authMode!=='session')assert.equal(def.hitEdit(state,style.w-20,style.h-38,style.w,style.h),action,'the expanded button is clickable across its width');
      assert.equal(labels.some(text=>/private-token|private-name|private-password/.test(text)),false,'cards do not print credential inputs');
    }
  }
});

let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>browser?.close());
test('HTTP Edit exposes credential wiring by authentication mode and explains normal persistence',async()=>{
  const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__authUi={run:source=>eval(source)};');
  const server=http.createServer((request,response)=>{response.writeHead(request.url==='/index.html'?200:404,{'Content-Type':'text/html'});response.end(request.url==='/index.html'?html:'');});
  const context=await browser.newContext({viewport:{width:1100,height:900}}),errors=[];
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    const run=source=>page.evaluate(async source=>{await __authUi.run('appReady');return __authUi.run(source);},source);
    const scripts=definitions.map(entry=>entry.script);
    await run(`(async()=>{cancelGesture();items=['httpSource','httpPost'].map((key,index)=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),script:${JSON.stringify(scripts)}[index],uid:key,state:{...BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0].state,authMode:'session'},x:50+index*400,y:100}));selection=[];editingSmartIdx=null;datasets={};setTool('select');render();save();await resolveAcceptedComponentGraph(ensureEditorComponentGraph,()=>true);})()`);
    for(let index=0;index<2;index++){
      await run(`selection=[${index}];openComponentBindings()`);await page.locator('#componentBindingsSave:enabled').waitFor();
      assert.equal(await page.locator('[data-integration-edit-credentials]').count(),1);
      const select=page.locator('#component-setting-authMode');
      assert.deepEqual(await select.locator('option').allTextContents(),['Session credentials','No authentication','Bearer token input','Basic auth inputs']);
      await select.selectOption('bearer');await page.locator('#componentBindingsSave:enabled').waitFor();
      assert.equal(await page.locator('[data-integration-edit-credentials]').count(),0);
      assert.equal(await page.locator('[data-integration-input="token"]').count(),1);
      assert.equal(await page.locator('[data-integration-input="username"]').count(),0);
      const input=async name=>page.locator('#'+await run(`componentDialogSession.rows.find(row=>row.name===${JSON.stringify(name)}).input.id`));
      await (await input('token')).fill('wired-token');
      assert.match(await page.locator('[data-integration-section="connection"]').innerText(),/normal workspace save and HTML export rules/);
      await select.selectOption('basic');await page.locator('#componentBindingsSave:enabled').waitFor();
      assert.equal(await page.locator('[data-integration-input="token"]').count(),0);
      await (await input('username')).fill('reader');await (await input('password')).fill('demo-password');
      await page.locator('#componentBindingsSave').click();await page.locator('#componentBindingsDialog').waitFor({state:'hidden'});
      const saved=await run(`items[${index}]`);assert.equal(saved.state.authMode,'basic');assert.equal(saved.inputValues.username,'reader');assert.equal(saved.inputValues.password,'demo-password');
      assert.equal(await run(`editorIntegrationCredentials.get(items[${index}])===undefined`),true,'ordinary inputs do not populate the session credential store');
    }
    assert.deepEqual(errors,[]);
  }finally{await context.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
