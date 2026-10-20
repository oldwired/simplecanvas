// Refresh saved component source snapshots, then export the editable workspace through the app.
// Run after changing bundled components or runtime: node tools/update-example-workspace.cjs
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
// The editor enforces workspace-wide dataset identities on import. Canonical demo
// sources resolve collisions once so subsequent HTML exports need no random remaps.
function prepareExampleDatasetIdentities(workspace){
  const counts=new Map();
  for(const tab of workspace.tabs)for(const id of Object.keys(tab.datasets||{}))counts.set(id,(counts.get(id)||0)+1);
  if(![...counts.values()].some(count=>count>1))return;
  const reserved=new Set(counts.keys()),remaps=new Map();
  for(const tab of [...workspace.tabs].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
    const ids=new Map();remaps.set(tab.id,ids);
    for(const id of Object.keys(tab.datasets||{}).sort()){
      if(counts.get(id)===1){ids.set(id,id);continue;}
      const base='demo-data-'+tab.id+'-'+id;let next=base.slice(0,100),number=2;
      while(reserved.has(next)){const suffix='-'+number++;next=base.slice(0,100-suffix.length)+suffix;}
      reserved.add(next);ids.set(id,next);
    }
  }
  // Reuse the app's restricted walker, never traverse arbitrary component state,
  // strings or table cells looking for matching IDs.
  const {parseApp}=require('../tests/helpers/app-source.cjs'),vm=require('node:vm');
  const app=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8'));
  const eachDatasetReference=vm.runInNewContext('('+app.declaration('eachDatasetReference')+')');
  for(const tab of workspace.tabs){
    const own=remaps.get(tab.id);
    tab.datasets=Object.fromEntries(Object.entries(tab.datasets||{}).map(([id,table])=>[own.get(id),table]));
    eachDatasetReference(tab.items,reference=>{
      const mapped=remaps.get(reference.sketchId||tab.id)?.get(reference.datasetId);
      if(mapped)reference.datasetId=mapped;
    });
  }
}

async function exportWorkspaceReader({root,workspacePath,readerPath,tabCount}){
  const {launchBrowser}=require('../tests/helpers/browser.cjs');
  const {parseApp}=require('../tests/helpers/app-source.cjs');
  const html=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).inject('window.__example={run:source=>eval(source)};');
  const engine=process.env.BROWSER_ENGINE||'chromium';
  if(!['chromium','webkit'].includes(engine))throw new Error('Unsupported browser engine: '+engine);
  const browser=await launchBrowser({engine});
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
  // Keep importer-generated random IDs out of the reader. Once assigned, IDs follow
  // their sketches through renaming/reordering and remain stable on later builds.
  const sketchIds=new Set(workspace.tabs.map(tab=>tab.id).filter(Boolean));
  workspace.tabs.forEach((tab,index)=>{
    if(tab.id)return;
    const base='demo-sketch-'+(index+1);let id=base,suffix=2;
    while(sketchIds.has(id))id=base+'-'+suffix++;
    tab.id=id;sketchIds.add(id);
  });
  prepareExampleDatasetIdentities(workspace);
  for(const tab of workspace.tabs){
    if(typeof tab.name==='string')tab.name=tab.name.replace(/Page settings/g,'Sketch settings');
    for(const item of tab.items)for(const key of ['text','componentName'])if(typeof item[key]==='string')item[key]=item[key].replace(/Page settings/g,'Sketch settings');
  }
  for(const tab of workspace.tabs)for(const item of tab.items){
    if(item.type!=='smart')continue;
    if(typeof item.exampleSource!=='string' || !/^[a-z0-9-]+\.js$/.test(item.exampleSource))
      throw new Error('Set a valid exampleSource filename for '+item.uid);
    item.script=io.readFileSync(path.join(examples,item.exampleSource),'utf8');
    if(item.exampleSource==='data-source.js')item.datasetOwner='data';
    if(item.exampleSource==='page-settings.js'){
      item.componentName=item.componentName==='Page settings'?'Sketch settings':item.componentName;
      item.state={overrideTitle:true,overrideShowTabs:true,overrideShowWiring:true,overrideShowSimulationControls:true,...item.state};
    }
    if(item.uid==='demo-32-title')item.state.values=item.state.values.map(value=>value.replace(/Page settings/g,'Sketch settings'));
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

module.exports={updateExampleWorkspace,exportWorkspaceReader};
if(require.main===module)updateExampleWorkspace()
  .then(({tabCount})=>console.log('Updated '+tabCount+' editable tabs and offline HTML reader.'))
  .catch(error=>{console.error(error);process.exitCode=1;});
