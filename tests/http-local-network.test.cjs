const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const {createHttpExampleServer}=require('../tools/serve-http-example.cjs');
const root=path.join(__dirname,'..');

test('Run delegates browser local-network permission, remains isolated, and keeps a real pending GET responsive',{timeout:60000},async()=>{
  const server=createHttpExampleServer(),serve=server.listeners('request')[0];
  let release,observe;
  const requested=new Promise(resolve=>observe=resolve);
  server.removeAllListeners('request');
  server.on('request',(request,response)=>{
    if(request.url==='/examples/http-reading.json?hold=1'){
      release=()=>serve(request,response);observe({origin:request.headers.origin});
    }else serve(request,response);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port,engine=process.env.BROWSER_ENGINE||'chromium';
  let browser,context;
  try{
    browser=await launchBrowser();context=await browser.newContext({viewport:{width:1440,height:1050}});
    // This grants the native permission only in this test context. The app must still delegate it
    // to its opaque iframe, and the real endpoint must still satisfy browser CORS checks.
    if(engine==='chromium')await context.grantPermissions(['local-network-access'],{origin});
    const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
    await context.route(origin+'/index.html',route=>route.fulfill({contentType:'text/html',body:html}));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.goto(origin+'/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await run('pendingFileAction="openWorkspace"');
    await page.locator('#projectInput').setInputFiles(path.join(root,'examples/http-integrations.json'));
    await page.waitForFunction(()=>__test.run('items.some(item=>item.uid==="http-workshop")'));
    await run(`{
      const source=items.find(item=>item.uid==='http-workshop');
      source.inputValues.url+='?hold=1';source.state.timeoutSeconds=30;save();
    }`);
    await page.locator('#runPreviewBtn').click();await page.locator('#runPreviewPanel[data-state="ready"]').waitFor();
    const frameElement=page.locator('#runPreviewFrame');
    assert.doesNotMatch(await frameElement.getAttribute('sandbox'),/allow-same-origin/);
    assert.match(await frameElement.getAttribute('allow'),/local-network-access \*/);
    assert.match(await frameElement.getAttribute('allow'),/local-network \*/);
    assert.match(await frameElement.getAttribute('allow'),/loopback-network \*/);
    const frame=await(await frameElement.elementHandle()).contentFrame();
    // Component indices belong to a sketch. Other sketches may contain a different
    // component at the same index, even while their panels remain hidden.
    const sketch=frame.locator('.tab-panel[data-tab-id="http-reads"]');await sketch.waitFor({state:'visible'});
    await sketch.locator('[data-smart-index="2"][data-smart-ready="true"]').waitFor();
    await sketch.locator('[data-smart-index="2"]').getByText('Refresh',{exact:true}).click();
    let requestDeadline,received;
    try{received=await Promise.race([requested,new Promise((resolve,reject)=>{
      requestDeadline=setTimeout(()=>reject(new Error('The isolated preview did not reach the local endpoint')),15000);
    })]);}finally{clearTimeout(requestDeadline);}
    assert.deepEqual(received,{origin:'null'},'a real GET originates in the isolated preview');
    await sketch.getByText('Loading…',{exact:true}).waitFor();
    await sketch.locator('[data-smart-index="4"]').getByText('+ 1',{exact:true}).click();
    await sketch.locator('[data-smart-index="4"]').getByText('26',{exact:true}).waitFor();
    assert.equal(await sketch.getByText('Loading…',{exact:true}).count(),1,'interaction succeeds before the response is released');
    release();release=null;
    await sketch.locator('[data-smart-index="2"]').getByText('72',{exact:true}).waitFor();
    await sketch.locator('[data-smart-index="10"]').getByText('Workshop',{exact:true}).waitFor();
    await page.locator('#exitPreviewBtn').click();await page.locator('#runPreviewPanel').waitFor({state:'hidden'});
    assert.equal(await run('items.find(item=>item.uid==="http-local-control").state.value'),25,'Return discards preview interaction');
    assert.deepEqual(errors,[]);
  }finally{
    release?.();await context?.close();await browser?.close();
    await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
  }
});
