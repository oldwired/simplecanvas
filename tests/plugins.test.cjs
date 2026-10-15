const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const engine = process.env.BROWSER_ENGINE || 'chromium';
assert.ok(['chromium','webkit'].includes(engine), 'BROWSER_ENGINE must be chromium or webkit');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// Only the served test copy exposes state for fixture setup and history inspection.
const html = source.replace('\n})();', '\nwindow.__test = {run: source => eval(source)};\n})();');
const plugin = `window.SimpleCanvasPlugins = {init(api) {
  window.pluginAPI = api;
  window.pluginInitCount = (window.pluginInitCount || 0) + 1;
}};`;
const rectangle = (uid='rect') => ({type:'rect',uid,x:100,y:100,w:160,h:100,size:2,
  color:'#1f2937',strokeOn:true,fill:true,fillColor:'#ffd166'});
const sketch = items => ({app:'SimpleCanvas',version:3,items,assets:{}});
let browser;
before(async () => {
  browser = await ({chromium,webkit}[engine]).launch({headless:true,
    ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
});
after(async () => { if(browser) await browser.close(); });

async function app(fn, options={}){
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  try{
    if(options.init) await context.addInitScript(options.init);
    const page = await context.newPage(), requests=[], errors=[], logs=[], dialogs=[];
    let acceptDialogs=true;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if(['warning','error'].includes(message.type())) logs.push(message.text()); });
    page.on('dialog', dialog => { dialogs.push(dialog.message()); return acceptDialogs ? dialog.accept() : dialog.dismiss(); });
    await page.route('http://simplecanvas.test/**', async route => {
      const name=new URL(route.request().url()).pathname.slice(1);
      requests.push(name);
      if(name==='index.html') return route.fulfill({contentType:'text/html',body:html});
      if(name==='settings.json' && options.settings!==undefined){
        if(options.settingsDelay) await new Promise(resolve=>setTimeout(resolve,options.settingsDelay));
        return route.fulfill({contentType:'application/json',body:JSON.stringify(options.settings)});
      }
      if(name==='plugins.js' && options.plugin!==null){
        return route.fulfill({contentType:'text/javascript',body:options.plugin ?? plugin});
      }
      return route.fulfill({status:404,body:''});
    });
    await page.goto('http://simplecanvas.test/index.html');
    const run = code => page.evaluate(async code => { await window.__test.run('appReady'); return window.__test.run(code); }, code);
    await run('appStarted');
    if(options.plugin!==null && options.settings?.features?.plugins!==false) await page.waitForFunction(()=>window.pluginAPI);
    await fn({page,run,requests,logs,dialogs,setAcceptDialogs:value=>{acceptDialogs=value;}});
    assert.deepEqual(errors, [], 'plugin failures do not become uncaught application errors');
  } finally { await context.close(); }
}

async function drawRectangle(page){
  await page.locator('[data-tool="rect"]').click();
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvas.x+150,canvas.y+160);
  await page.mouse.down();
  await page.mouse.move(canvas.x+280,canvas.y+240);
  await page.mouse.up();
}

test('a missing optional plugin leaves the hosted application editable', async () => app(async ({page,run,requests}) => {
  assert.equal(await page.evaluate(()=>document.body.inert),false);
  await drawRectangle(page);
  assert.equal(await run('items.length'),1);
  assert.equal(await run('items[0].type'),'rect');
  await page.locator('#undo').click();
  assert.equal(await run('items.length'),0);
  assert.equal(requests.filter(name=>name==='plugins.js').length,1);
}, {plugin:null}));

test('settings can disable plugin loading and initialization', async () => app(async ({page,run,requests}) => {
  assert.equal(requests.includes('plugins.js'),false);
  assert.equal(await page.evaluate(()=>window.unwantedPluginInit || false),false);
  assert.equal(await page.locator('#settingsWarning').isVisible(),false);
  await drawRectangle(page);
  assert.equal(await run('items.length'),1);
}, {
  settings:{version:1,features:{plugins:false}},
  init:()=>{window.SimpleCanvasPlugins={init(){window.unwantedPluginInit=true;}};}
}));

test('initialization sees restored state after settings and catches an asynchronous rejection', async () => app(async ({page,run,requests,logs}) => {
  await page.waitForFunction(()=>window.pluginInitCount===1);
  assert.deepEqual(await page.evaluate(()=>window.pluginReadyState),{
    version:1,inert:false,title:'Integrated canvas',uids:['restored'],tab:'Sketch 1'
  });
  await page.waitForFunction(()=>window.pluginRejectionReached);
  assert.ok(logs.some(message=>message.includes('Deliberate plugin init rejection')));
  await drawRectangle(page);
  assert.equal(await run('items.length'),2);
  assert.equal(requests.filter(name=>name==='plugins.js').length,1);
  assert.equal(await page.evaluate(()=>window.pluginInitCount),1);
}, {
  settings:{version:1,title:'Integrated canvas',features:{shapeLibrary:false}},settingsDelay:100,
  init:()=>localStorage.setItem('simplecanvas:v1',JSON.stringify({version:3,items:[
    {type:'rect',uid:'restored',x:20,y:30,w:60,h:40,color:'#000000',size:2}
  ]})),
  plugin:`window.SimpleCanvasPlugins={async init(api){
    window.pluginAPI=api;window.pluginInitCount=(window.pluginInitCount||0)+1;
    window.pluginReadyState={version:api.version,inert:document.body.inert,title:document.title,
      uids:api.getSketch().items.map(item=>item.uid),tab:api.getActiveTab().name};
    await Promise.resolve();window.pluginRejectionReached=true;
    throw new Error('Deliberate plugin init rejection');
  }};`
}));

test('the sketch API commits text, returns detached data, and rejects invalid or stale replacements without data loss', async () => app(async ({page,run,dialogs,setAcceptDialogs}) => {
  const initial=sketch([rectangle(),{type:'text',uid:'text',x:100,y:320,w:200,h:40,size:2,
    color:'#000000',textColor:'#000000',strokeOn:false,text:'original',font:'28px Arial',fontSize:28}]);
  assert.equal(await page.evaluate(data=>pluginAPI.loadSketch(data),initial),true);
  await run("openText(1);textInput.value='committed through plugin';");
  const current=await page.evaluate(()=>pluginAPI.getSketch());
  assert.equal(current.app,'SimpleCanvas');assert.equal(current.version,3);
  assert.equal(current.items[1].text,'committed through plugin');
  assert.equal(await run('items[1].text'),'committed through plugin');
  const originalTab=await page.evaluate(()=>pluginAPI.getActiveTab());
  await page.evaluate(()=>{
    const data=pluginAPI.getSketch();data.items[0].x=9999;data.items.push({type:'invalid'});data.assets.injected='x';
    const tab=pluginAPI.getActiveTab();tab.id='changed';tab.name='changed';
  });
  assert.deepEqual(await page.evaluate(()=>pluginAPI.getSketch()),current);
  assert.deepEqual(await page.evaluate(()=>pluginAPI.getActiveTab()),originalTab);
  const history=await run('undoStack.length');
  const invalid=[
    {...sketch([rectangle('valid'),{type:'unknown'}])},
    {...sketch([{type:'image',id:'missing',x:0,y:0,w:30,h:30}])},
    {...sketch([rectangle('future')]),version:999},
    {app:'SimpleCanvasWorkspace',version:3,tabs:[{items:[rectangle('workspace')]}]}
  ];
  for(const data of invalid){
    assert.equal(await page.evaluate(data=>{try{pluginAPI.loadSketch(data,{confirmReplace:false});return false;}catch{return true;}},data),true);
    assert.deepEqual(await page.evaluate(()=>pluginAPI.getSketch()),current);
    assert.equal(await run('undoStack.length'),history);
  }
  setAcceptDialogs(false);
  assert.equal(await page.evaluate(data=>pluginAPI.loadSketch(data),sketch([rectangle('cancelled')])),false);
  assert.equal(dialogs.length,1);
  assert.deepEqual(await page.evaluate(()=>pluginAPI.getSketch()),current);
  assert.equal(await run('undoStack.length'),history);
  await run('newTab()');
  assert.equal(await page.evaluate(({data,tabId})=>{
    try{pluginAPI.loadSketch(data,{confirmReplace:false,tabId});return false;}catch{return true;}
  },{data:sketch([rectangle('late-response')]),tabId:originalTab.id}),true);
  assert.deepEqual(await run('items'),[]);
  await run(`activateTab(${JSON.stringify(originalTab.id)})`);
  assert.deepEqual(await page.evaluate(()=>pluginAPI.getSketch()),current);
}));

test('plugin replacements retain conflicting image assets through undo, redo, and reload', async () => app(async ({page,run,dialogs}) => {
  const fixture=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=20;const context=canvas.getContext('2d');
    context.fillStyle='red';context.fillRect(0,0,20,20);const red=canvas.toDataURL();
    context.fillStyle='blue';context.fillRect(0,0,20,20);const blue=canvas.toDataURL();
    const data=src=>({app:'SimpleCanvas',version:3,
      items:[{type:'image',uid:'image',id:'shared',x:100,y:100,w:20,h:20}],assets:{shared:src}});
    pluginAPI.loadSketch(data(red));pluginAPI.loadSketch(data(blue),{confirmReplace:false});
    return {red,blue};
  });
  const imageData=()=>page.evaluate(()=>{const data=pluginAPI.getSketch();return data.assets[data.items[0].id];});
  assert.equal(dialogs.length,0,'explicit replacement can skip the confirmation');
  assert.equal(await imageData(),fixture.blue);
  await page.locator('#undo').click();assert.equal(await imageData(),fixture.red);
  await page.locator('#redo').click();assert.equal(await imageData(),fixture.blue);
  await page.reload();await run('appReady');await page.waitForFunction(()=>window.pluginAPI);
  assert.equal(await imageData(),fixture.blue);
}));

test('change subscriptions cover drawing, undo, redo, import, and tabs while isolating listener failures', async () => app(async ({page,run,logs}) => {
  await page.evaluate(()=>{
    window.changes=[];window.tabChanges=[];
    pluginAPI.on('change',event=>{event.sketch.items.length=0;throw new Error('Deliberate listener failure');});
    pluginAPI.on('change',async()=>{throw new Error('Deliberate async listener failure');});
    window.stopChanges=pluginAPI.on('change',event=>changes.push(event));
    pluginAPI.on('tabchange',event=>tabChanges.push(event));
  });
  await run("save();setTool('select');");
  assert.equal(await page.evaluate(()=>changes.length),0,'saving and changing tools are not drawing changes');
  const originalTab=await page.evaluate(()=>pluginAPI.getActiveTab());
  await drawRectangle(page);
  await page.waitForFunction(()=>changes.length===1);
  assert.equal(await page.evaluate(()=>changes[0].sketch.items.length),1,'each listener receives an isolated snapshot');
  assert.equal(await page.evaluate(()=>changes[0].tabId),originalTab.id);
  await page.locator('#undo').click();await page.waitForFunction(()=>changes.length===2);
  assert.equal(await page.evaluate(()=>changes[1].sketch.items.length),0);
  await page.locator('#redo').click();await page.waitForFunction(()=>changes.length===3);
  const imported=sketch([rectangle('imported')]);
  await run(`importProject(new File([${JSON.stringify(JSON.stringify(imported))}],'imported.json'));`);
  await page.waitForFunction(()=>changes.length===4);
  assert.equal(await page.evaluate(()=>changes[3].sketch.items[0].uid),'imported');
  assert.equal(await page.evaluate(()=>changes[0].sketch.items[0].uid!==changes[3].sketch.items[0].uid),true,
    'previous event snapshots remain unchanged after later imports');
  await run('newTab()');
  await page.waitForFunction(()=>tabChanges.length===1);
  assert.notEqual(await page.evaluate(()=>tabChanges[0].tabId),originalTab.id);
  assert.equal(await page.evaluate(()=>changes.length),4,'tab activation does not claim an edit');
  const backgroundImage=await run(`
    const image=document.createElement('canvas');image.width=image.height=10;
    const source=image.toDataURL();importImage(source,null,${JSON.stringify(originalTab.id)});source;
  `);
  await page.waitForFunction(()=>changes.length===5);
  const backgroundChange=await page.evaluate(()=>changes[4]);
  assert.equal(backgroundChange.tabId,originalTab.id,'an image decoded after switching tabs reports its own destination');
  assert.deepEqual(backgroundChange.sketch.items.map(item=>item.type),['rect','image']);
  assert.equal(backgroundChange.sketch.assets[backgroundChange.sketch.items[1].id],backgroundImage);
  assert.deepEqual(await run('items'),[],'the background image leaves the active tab untouched');
  await page.evaluate(()=>{stopChanges();stopChanges();});
  await page.evaluate(data=>pluginAPI.loadSketch(data,{confirmReplace:false}),sketch([rectangle('unsubscribed')]));
  assert.equal(await page.evaluate(()=>changes.length),5);
  assert.deepEqual(await page.evaluate(async data=>{
    let calls=0;const listener=()=>{calls++;};
    const stopOld=pluginAPI.on('change',listener);
    pluginAPI.loadSketch(data,{confirmReplace:false});
    stopOld();
    const stopNew=pluginAPI.on('change',listener);
    stopOld();
    await Promise.resolve();const before=calls;
    data.items[0].uid='new-subscription';pluginAPI.loadSketch(data,{confirmReplace:false});
    await Promise.resolve();stopNew();
    return [before,calls];
  },sketch([rectangle('cancelled-delivery')])),[0,1],
  'resubscribing cannot revive queued events, and an old unsubscribe cannot remove the new subscription');
  assert.ok(logs.some(message=>message.includes('Deliberate listener failure')));
  assert.ok(logs.some(message=>message.includes('Deliberate async listener failure')));
}));

test('plugin menu actions use keyboard navigation, close on activation, and can be removed', async () => app(async ({page,logs}) => {
  await page.evaluate(()=>{
    window.removePluginMenu=pluginAPI.ui.addMenuItem({label:'Example integration',async onClick(){
      window.pluginMenuClicks=(window.pluginMenuClicks||0)+1;
      throw new Error('Deliberate menu failure');
    }});
  });
  await page.locator('#menuBtn').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');
  const item=page.getByRole('menuitem',{name:'Example integration',exact:true});
  assert.equal(await item.evaluate(element=>element===document.activeElement),true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.pluginMenuClicks===1);
  assert.equal(await page.locator('#menu').isHidden(),true);
  assert.equal(await page.locator('#menuBtn').evaluate(element=>element===document.activeElement),true);
  assert.ok(logs.some(message=>message.includes('Deliberate menu failure')));
  await page.evaluate(()=>{removePluginMenu();removePluginMenu();});
  assert.equal(await item.count(),0);
  await page.locator('#menuBtn').click();await page.keyboard.press('End');
  assert.equal(await page.getByRole('menuitem',{name:'Clear canvas',exact:true}).evaluate(element=>element===document.activeElement),true);
}));

test('actual standalone files work with and without a sibling plugins.js', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-plugins-'));
  try{
    for(const withPlugin of [false,true]){
      const folder=path.join(directory,withPlugin?'with-plugin':'html-only');fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder,'index.html'),source);
      if(withPlugin) fs.copyFileSync(path.join(__dirname,'..','examples','plugins.js'),path.join(folder,'plugins.js'));
      const context=await browser.newContext({viewport:{width:1280,height:900}});
      try{
        const page=await context.newPage(),errors=[],network=[],dialogs=[];
        page.on('pageerror',error=>errors.push(error.message));
        page.on('request',request=>{if(/^https?:/.test(request.url()))network.push(request.url());});
        page.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.accept();});
        await page.goto(pathToFileURL(path.join(folder,'index.html')).href);
        await page.waitForFunction(()=>!document.body.inert);
        await drawRectangle(page);
        assert.equal(await page.locator('#undo').isEnabled(),true,'drawing works from the actual local HTML');
        if(withPlugin){
          await page.locator('#menuBtn').click();
          await page.getByRole('menuitem',{name:'Plugin: sketch info…',exact:true}).click();
          assert.ok(dialogs.some(message=>message.includes('Objects: 1')));
          await page.locator('#menuBtn').click();
          const pending=page.waitForEvent('download');
          await page.getByRole('menuitem',{name:'Plugin: download snapshot…',exact:true}).click();
          const snapshot=JSON.parse(fs.readFileSync(await(await pending).path(),'utf8'));
          assert.equal(snapshot.app,'SimpleCanvas');assert.equal(snapshot.version,3);
          assert.deepEqual(snapshot.items.map(item=>item.type),['rect']);assert.deepEqual(snapshot.assets,{});
        }else assert.equal(await page.evaluate(()=>window.SimpleCanvasPlugins),undefined);
        assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
