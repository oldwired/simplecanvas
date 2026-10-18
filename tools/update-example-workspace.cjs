// Refresh saved component source snapshots, then export the editable workspace through the app.
// Run after changing bundled components or runtime: node tools/update-example-workspace.cjs
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
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
  "demo-15-output": "status-indicator.js",
  "demo-16-entry": "text-input.js",
  "demo-16-label": "text-label.js",
  "demo-16-memo": "memo.js",
  "demo-16-set": "trigger.js",
  "demo-16-clear": "trigger.js",
  "demo-16-count": "value-label.js",
  "demo-16-number": "number-input.js",
  "demo-16-gauge": "gauge.js",
  "demo-17-source": "data-source.js",
  "demo-17-filter": "table-filter.js",
  "demo-17-boat": "text-input.js",
  "demo-17-table": "data-table.js",
  "demo-17-chart": "data-bar-chart.js",
  "demo-18-source": "data-source.js",
  "demo-18-reload": "trigger.js",
  "demo-18-aggregate": "table-aggregate.js",
  "demo-18-sort": "table-sort.js",
  "demo-18-table": "data-table.js",
  "demo-18-chart": "data-bar-chart.js",
  "demo-18-download": "data-download.js",
  "demo-19-manual": "dropdown.js",
  "demo-19-manual-index": "value-label.js",
  "demo-19-manual-key": "text-label.js",
  "demo-19-manual-text": "text-label.js",
  "demo-19-source": "data-source.js",
  "demo-19-table": "data-table.js",
  "demo-19-position": "number-control.js",
  "demo-19-automatic": "dropdown.js",
  "demo-19-automatic-text": "text-label.js",
  "demo-19-valid": "status-indicator.js",
  "demo-19-query": "text-input.js",
  "demo-19-lookup": "text-lookup.js",
  "demo-19-lookup-index": "value-label.js",
  "demo-19-lookup-key": "text-label.js",
  "demo-19-found": "status-indicator.js",
  "demo-20-amount": "number-control.js",
  "demo-20-enabled": "toggle.js",
  "demo-20-sheet": "spreadsheet.js",
  "demo-20-total": "value-label.js",
  "demo-20-active": "status-indicator.js",
  "demo-20-status": "text-label.js"
};

async function exportWorkspaceReader({root,workspacePath,readerPath,tabCount}){
  const {chromium,webkit}=require('playwright');
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
    await page.waitForFunction(count=>__example.run('tabs.length')===count,tabCount);
    const download=page.waitForEvent('download');await run('exportHtml()');
    const completed=await download,failure=await completed.failure();
    if(failure)throw new Error('HTML export failed: '+failure);
    fs.copyFileSync(await completed.path(),readerPath);
    if(errors.length)throw new Error(errors.join('\n'));
  }finally{await browser.close();}
}

// Both artifacts remain untouched until the real exporter has finished successfully. Renames
// publish prepared files on the same filesystem; a failed second rename restores the first file.
async function updateExampleWorkspace({root:directory=root,exportReader=exportWorkspaceReader,io=fs}={}){
  const examples=path.join(directory,'examples');
  const workspacePath=path.join(examples,'smart-components-workspace.json');
  const readerPath=path.join(examples,'smart-components-workspace.html');
  const previousWorkspace=io.readFileSync(workspacePath),previousReader=io.readFileSync(readerPath);
  const workspace=JSON.parse(previousWorkspace.toString('utf8'));
  for(const tab of workspace.tabs)for(const item of tab.items){
    if(item.type!=='smart')continue;
    if(!sources[item.uid])throw new Error('Add the source filename for '+item.uid+' to this generator');
    item.script=io.readFileSync(path.join(examples,sources[item.uid]),'utf8');
  }
  const staging=io.mkdtempSync(path.join(examples,'.smart-components-workspace-'));
  let preserveRecovery=false;
  try{
    const stagedWorkspace=path.join(staging,'workspace.json'),stagedReader=path.join(staging,'reader.html');
    io.writeFileSync(stagedWorkspace,JSON.stringify(workspace,null,2)+'\n');
    await exportReader({root:directory,workspacePath:stagedWorkspace,readerPath:stagedReader,tabCount:workspace.tabs.length});
    if(!io.statSync(stagedReader).isFile() || !io.statSync(stagedReader).size)throw new Error('HTML export is empty');
    if(!io.readFileSync(workspacePath).equals(previousWorkspace) || !io.readFileSync(readerPath).equals(previousReader))
      throw new Error('Workspace artifacts changed during export; generated files were not published');
    const backupWorkspace=path.join(staging,'previous-workspace.json'),backupReader=path.join(staging,'previous-reader.html');
    io.writeFileSync(backupWorkspace,previousWorkspace);io.writeFileSync(backupReader,previousReader);
    const replacements=[{source:stagedWorkspace,target:workspacePath,backup:backupWorkspace},
      {source:stagedReader,target:readerPath,backup:backupReader}],published=[];
    try{
      for(const replacement of replacements){io.renameSync(replacement.source,replacement.target);published.push(replacement);}
    }catch(error){
      const recoveryErrors=[];
      for(const replacement of published.reverse()){
        try{io.renameSync(replacement.backup,replacement.target);}catch(recoveryError){recoveryErrors.push(recoveryError);}
      }
      if(recoveryErrors.length){
        preserveRecovery=true;
        throw new AggregateError([error,...recoveryErrors],'Publishing failed; recovery copies were retained in '+staging);
      }
      throw error;
    }
    return {tabCount:workspace.tabs.length};
  }finally{
    if(!preserveRecovery)io.rmSync(staging,{recursive:true,force:true});
  }
}

module.exports={updateExampleWorkspace};
if(require.main===module)updateExampleWorkspace()
  .then(({tabCount})=>console.log('Updated '+tabCount+' editable tabs and offline HTML reader.'))
  .catch(error=>{console.error(error);process.exitCode=1;});
