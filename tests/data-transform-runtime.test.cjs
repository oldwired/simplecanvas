const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('http://data-transforms.test/**',route=>route.fulfill({status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://data-transforms.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function setup(run){
  const names=['table-aggregate','table-sort','data-table'],scripts=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8')]));
  await run(`window.dataScripts=${JSON.stringify(scripts)}; cancelGesture(); items=[]; datasets={results:parseDatasetText('Team,Points\\nB,4\\nA,2\\nB,3\\nA,1','results.csv')};
    items=['table-aggregate','table-sort','data-table'].map((key,index)=>({type:'smart',uid:'transform-'+index,script:window.dataScripts[key],componentApi:2,componentName:['Totals','Leaderboard','Scores'][index],x:60+index*430,y:120,w:index===2?420:320,h:index===2?300:150,state:index===1?{caseSensitive:false}:index===2?{maxRows:12,showCounts:true}:{},color:'#94a3b8',textColor:'#334155',fill:true,fillColor:'#ffffff',strokeOn:true,size:1,
    ...(index===0?{inputValues:{data:{datasetId:'results'},group:'Team',value:'Points',operation:'sum'}}:{}),
    ...(index===1?{inputValues:{column:'result',direction:'ascending'},bindings:{data:{uid:'transform-0',port:'data'}}}:{}),
    ...(index===2?{bindings:{data:{uid:'transform-1',port:'data'}}}:{})})); selection=[];setTool('select');render();save();`);
}

test('real Workers aggregate and sort data; replacing embedded content updates the displayed table',async()=>app(async({page,run})=>{
  await setup(run);
  await page.waitForFunction(()=>__test.run('editorComponentEvaluation?.records?.get(items[2])?.io.tables?.inputs?.data?.rows[0]?.[1]===3'));
  assert.deepEqual(await run('editorComponentEvaluation.records.get(items[2]).io.tables.inputs.data.rows'),[['A',3],['B',7]]);
  const original=await run('editorComponentEvaluation.records.get(items[0]).io.outputs.data.datasetId');
  await run("datasets={results:parseDatasetText('Team,Points\\nB,1\\nA,20','results.csv')};editorComponentEvaluation=null;render();");
  await page.waitForFunction(()=>__test.run('editorComponentEvaluation?.records?.get(items[2])?.io.tables?.inputs?.data?.rows[0]?.[1]===1'));
  assert.deepEqual(await run('editorComponentEvaluation.records.get(items[2]).io.tables.inputs.data.rows'),[['B',1],['A',20]]);
  assert.notEqual(await run('editorComponentEvaluation.records.get(items[0]).io.outputs.data.datasetId'),original);
  assert.deepEqual(await run('Object.keys(datasets)'),['results']);
  assert.equal(await run("JSON.stringify(makeDocument(items,assets,{},datasets)).includes('derived-')"),false);
}));

test('offline HTML reconstructs derived results, keeps embedded datasets isolated and renders all result rows',async()=>app(async({page,run,context})=>{
  await setup(run);
  await page.waitForFunction(()=>__test.run('editorComponentEvaluation?.records?.get(items[2])?.io.outputs.rowCount===2'));
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-transform-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'results.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];reader.on('pageerror',e=>errors.push(e.message));reader.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>document.querySelectorAll('[data-smart-ready="true"]').length===3);
  const display=await reader.locator('[data-smart-index="2"]').textContent();
  for(const text of ['Scores','Team','Sum of Points','A','B','3','7','2 rows'])assert.ok(display.includes(text),text+' shown');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
