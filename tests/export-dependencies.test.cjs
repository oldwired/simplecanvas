const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp,inlineScripts,freeReferences}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const {mqttLibraryDeclaration,updateMqttBundle}=require('../tools/update-mqtt-bundle.cjs');
const mqttLibrary=mqttLibraryDeclaration(root);
// These are platform globals, not editor helpers. Any new external dependency in a
// serialized function must either be supplied by the reader or consciously listed here.
const browserGlobals=new Set(`AbortController Array Blob Boolean DOMPoint Date Error Event Infinity Intl JSON Map Math MessageChannel MouseEvent Number Object Option PointerEvent Promise ResizeObserver Set String Symbol TextDecoder TextEncoder URL URLSearchParams Uint32Array WeakMap WeakSet WebSocket queueMicrotask btoa cancelAnimationFrame clearInterval clearTimeout console crypto document fetch getComputedStyle globalThis innerHeight innerWidth location matchMedia parseFloat parseInt performance requestAnimationFrame setInterval setTimeout undefined window`.split(' '));
function missingDependencies(source){
  // The pinned upstream browser bundle contains portable UMD/Node feature probes.
  // Verify it byte-for-byte, then audit our serialized helpers separately instead
  // of whitelisting its dormant globals for all application code.
  if(source.includes('function componentMqttClientLibrary(')){
    assert.ok(source.includes(mqttLibrary),'reader carries the exact checked vendor bundle');
    source=source.replace(mqttLibrary,'function componentMqttClientLibrary(){return {};}');
  }
  return freeReferences(source).filter(reference=>!browserGlobals.has(reference.name));
}
test('embedded MQTT client matches its pinned, checksum-verified vendor source',()=>{updateMqttBundle({root,check:true});});
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>{await browser?.close();});

test('scope contract checks dormant branches, respects lexical bindings, and ignores properties and script data',()=>{
  assert.deepEqual([...new Set(missingDependencies(`(()=>{const local=1;function test({value}){return local+value;}function dormant(){return missingEditorState.value;}const data='alsoMissing';return {property:test};})();`).map(value=>value.name))],['missingEditorState']);
  const app=parseApp(html),injected=app.inject('globalThis.__scopeContract=1;');
  assert.ok(parseApp(injected).source.includes('globalThis.__scopeContract=1;'));
  assert.ok(app.declaration('htmlSmartSource').startsWith('function htmlSmartSource('));
});

test('fresh HTML export and shipped demos declare every non-platform function dependency',async()=>{
  const context=await browser.newContext({viewport:{width:1400,height:1000}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://export-dependencies.test/**',route=>route.fulfill({contentType:'text/html',body:route.request().url().endsWith('index.html')?html:''}));
    await page.goto('http://export-dependencies.test/index.html');
    await page.locator('body:not([inert])').waitFor();
    const script='({apiVersion:2,inputs:{},outputs:{value:{type:"number"}},compute(){return {value:1};},children(){return [];}})';
    const data={app:'SimpleCanvasWorkspace',version:5,activeIndex:0,tabs:[{id:'contract-sketch',name:'Contract',version:5,items:[{type:'smart',uid:'contract',componentApi:2,script,state:{},x:20,y:20,w:100,h:80,color:'#000000',size:1}]}]};
    await page.locator('#menuBtn').click();const chosen=page.waitForEvent('filechooser');await page.locator('[data-act="openWorkspace"]').click();
    await(await chosen).setFiles({name:'contract.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
    await page.locator('.tab-select[data-tab-id="contract-sketch"]').waitFor({state:'attached'});
    await page.locator('#menuBtn').click();const download=page.waitForEvent('download');await page.locator('[data-act="html"]').click();
    const sources=[['fresh export',fs.readFileSync(await(await download).path(),'utf8')],
      ...['smart-components-workspace.html','workspace-runtime.html','http-integrations.html','mqtt-integrations.html'].map(name=>[name,fs.readFileSync(path.join(root,'examples',name),'utf8')])];
    for(const [name,document] of sources){
      const scripts=inlineScripts(document);assert.ok(scripts.length>0,name+' contains executable scripts');
      const missing=scripts.flatMap(script=>missingDependencies(script.source));
      assert.deepEqual(missing,[],name+' must supply dependencies even in unexecuted helper paths');
    }
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
