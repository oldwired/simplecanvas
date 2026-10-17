// Refresh saved component source snapshots, then export the editable workspace through the app.
// Run after changing bundled components or runtime: node tools/update-example-workspace.cjs
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..');
const workspacePath=path.join(root,'examples','smart-components-workspace.json');
const readerPath=path.join(root,'examples','smart-components-workspace.html');
const sources={
  "demo-1-source": "number-control.js",
  "demo-1-gauge": "gauge.js",
  "demo-1-readout": "value-label.js",
  "demo-2-level": "number-control.js",
  "demo-2-compare": "compare.js",
  "demo-2-enabled": "toggle.js",
  "demo-2-gate": "and-gate.js",
  "demo-2-result": "status-indicator.js",
  "demo-3-source": "number-control.js",
  "demo-3-multiply": "math.js",
  "demo-3-limit": "clamp.js",
  "demo-3-scale": "range-map.js",
  "demo-3-gauge": "gauge.js",
  "demo-4-run": "toggle.js",
  "demo-4-clock": "pulse-generator.js",
  "demo-4-countdown": "counter.js",
  "demo-4-digit": "seven-segment-display.js",
  "demo-4-done": "status-indicator.js",
  "demo-4-reset": "trigger.js",
  "demo-5-send": "trigger.js",
  "demo-5-delay": "delay.js",
  "demo-5-delivered": "counter.js",
  "demo-5-inputNow": "status-indicator.js",
  "demo-5-afterDelay": "status-indicator.js",
  "demo-6-next": "trigger.js",
  "demo-6-reset": "trigger.js",
  "demo-6-selector": "stepped-selector-number.js",
  "demo-6-level": "gauge.js",
  "demo-6-value": "value-label.js",
  "demo-6-position": "value-label.js",
  "demo-7-data": "toggle.js",
  "demo-7-shift": "trigger.js",
  "demo-7-reset": "trigger.js",
  "demo-7-last": "status-indicator.js",
  "demo-7-first": "shift-register-boolean.js",
  "demo-7-second": "shift-register-boolean.js",
  "demo-8-odd-rows": "toggle.js",
  "demo-8-even-rows": "toggle.js",
  "demo-8-odd-cols": "toggle.js",
  "demo-8-even-cols": "toggle.js",
  "demo-8-crossings": "led-matrix.js",
  "demo-8-row-byte": "number-control.js",
  "demo-8-smiley": "led-matrix.js",
  "demo-9-run": "toggle.js",
  "demo-9-clock": "pulse-generator.js",
  "demo-9-countdown": "counter.js",
  "demo-9-digit": "seven-segment-display.js",
  "demo-9-cycles": "counter.js",
  "demo-10-clock": "pulse-generator.js",
  "demo-10-countdown": "counter.js",
  "demo-10-digit": "seven-segment-display.js",
  "demo-10-keep-going": "not-gate.js",
  "demo-10-reset": "trigger.js",
  "demo-11-restart": "trigger.js",
  "demo-11-stop": "sr-latch.js",
  "demo-11-enabled": "not-gate.js",
  "demo-11-clock": "pulse-generator.js",
  "demo-11-countdown": "counter.js",
  "demo-11-digit": "seven-segment-display.js",
  "demo-12-set": "toggle.js",
  "demo-12-reset": "toggle.js",
  "demo-12-sr": "sr-latch.js",
  "demo-12-nor-q": "nor-gate.js",
  "demo-12-nor-notq": "nor-gate.js",
  "demo-12-not-set": "not-gate.js",
  "demo-12-not-reset": "not-gate.js",
  "demo-12-nand-q": "nand-gate.js",
  "demo-12-nand-notq": "nand-gate.js",
  "demo-13-clock": "trigger.js",
  "demo-13-data": "toggle.js",
  "demo-13-reset": "trigger.js",
  "demo-13-number": "number-control.js",
  "demo-13-first": "d-flip-flop.js",
  "demo-13-second": "d-flip-flop.js",
  "demo-13-register": "register-number.js",
  "demo-14-clock": "trigger.js",
  "demo-14-reset": "trigger.js",
  "demo-14-ring": "ring-counter.js",
  "demo-14-johnson": "shift-register-boolean.js",
  "demo-14-invert": "not-gate.js",
  "demo-14-decade": "decade-counter.js",
  "demo-15-delay": "delay.js",
  "demo-15-invert": "not-gate.js",
  "demo-15-output": "status-indicator.js"
};

async function main(){
  const workspace=JSON.parse(fs.readFileSync(workspacePath,'utf8'));
  for(const tab of workspace.tabs)for(const item of tab.items){
    if(item.type!=='smart')continue;
    if(!sources[item.uid])throw new Error('Add the source filename for '+item.uid+' to this generator');
    item.script=fs.readFileSync(path.join(root,'examples',sources[item.uid]),'utf8');
  }
  fs.writeFileSync(workspacePath,JSON.stringify(workspace,null,2)+'\n');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
    .replace('\n})();','\nwindow.__example={run:source=>eval(source)};\n})();');
  const engine=process.env.BROWSER_ENGINE||'chromium';
  if(!['chromium','webkit'].includes(engine))throw new Error('Unsupported browser engine: '+engine);
  const browser=await ({chromium,webkit}[engine]).launch({headless:true,
    ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://example-generator.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://example-generator.test/index.html');
    const run=source=>page.evaluate(async source=>{await __example.run('appReady');return __example.run(source);},source);
    await run('appStarted');await run('pendingFileAction="openWorkspace"');
    await page.locator('#projectInput').setInputFiles(workspacePath);
    await page.waitForFunction(count=>__example.run('tabs.length')===count,workspace.tabs.length);
    const download=page.waitForEvent('download');await run('exportHtml()');
    fs.copyFileSync(await (await download).path(),readerPath);
    if(errors.length)throw new Error(errors.join('\n'));
    console.log('Updated '+workspace.tabs.length+' editable tabs and offline HTML reader.');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
