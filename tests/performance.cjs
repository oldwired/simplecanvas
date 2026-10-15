const fs=require('node:fs');
const cp=require('node:child_process');
const path=require('node:path');
const {chromium}=require('playwright');
const repo=path.join(__dirname,'..');
const baseline=process.argv[2] || 'b95efd1';
const script=fs.readFileSync(repo+'/examples/race-start-timer.js','utf8');
const fixture={type:'smart',x:20,y:20,w:330,h:200,color:'#000000',fillColor:'#dc2626',fill:false,strokeOn:false,textColor:'#000000',size:2,fontFamily:'sans',fontSize:12,font:'600 12px sans-serif',script,state:{}};
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const version of [baseline,'working']){
   const html=(version==='working'?fs.readFileSync(repo+'/index.html','utf8'):cp.execFileSync('git',['show',version+':index.html'],{cwd:repo,encoding:'utf8'})).replace('\n})();','\nwindow.run=source=>eval(source);\n})();');
   async function open(){
    const ctx=await browser.newContext({viewport:{width:1400,height:1000}}),page=await ctx.newPage();
    await page.route('http://bench.test/**',r=>r.fulfill({status:r.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://bench.test/index.html');
    await page.evaluate(()=>run('typeof appReady!=="undefined" ? appReady : Promise.resolve()'));
    return {ctx,page,run:code=>page.evaluate(code=>run(code),code)};
   }
   let {ctx,page,run}=await open();
   await run(`(async()=>{const it=${JSON.stringify(fixture)};it.state=await requestSmartCall(it,'initState',[])||{};items=Array.from({length:10},(_,i)=>({...clone(it),uid:'bench-'+i,x:20+(i%3)*360,y:20+Math.floor(i/3)*230}));setTool('select');selection=[];render();})()`);
   await page.waitForFunction(()=>run('smartChildrenCache.size===10 && smartInFlight.size===0'));
   await run('for(let n=0;n<10;n++)render()');
   const warmedMedianMs=await run(`(()=>{
    const times=[];
    for(let r=0;r<3;r++){const start=performance.now();for(let n=0;n<200;n++)render();times.push(performance.now()-start);}
    return times.sort((a,b)=>a-b)[1];
   })()`);
   const render=await run(`(()=>{
    const stringify=JSON.stringify,originalShapeOps=shapeOps,originalSig=smartSig;
    let jsonCalls=0,jsonChars=0,childBuilds=0,signatureChars=0;
    JSON.stringify=function(...args){const s=stringify(...args);jsonCalls++;jsonChars+=s?.length||0;return s;};
    shapeOps=function(it,...args){if(it.type!=='smart')childBuilds++;return originalShapeOps(it,...args);};
    smartSig=function(...args){const s=originalSig(...args);signatureChars+=s.length;return s;};
    const start=performance.now();for(let n=0;n<200;n++)render();const ms=performance.now()-start;
    JSON.stringify=stringify;shapeOps=originalShapeOps;smartSig=originalSig;
    return {frames:200,shapes:10,ms,jsonCalls,jsonChars,childBuilds,signatureChars};
   })()`);
   await ctx.close();({ctx,page,run}=await open());
   // Resolve synthetic PNG jobs in a batch: measure picker work independently of Worker/raster time.
   const preview=await run(`(async()=>{
    const c=document.createElement('canvas');c.width=c.height=128;const png=c.toDataURL();
    const normalize=normalizeItem,decode=atob,grid=renderShapeLibrary;
    let normalizations=0,pngDecodes=0,gridBuilds=0;
    normalizeItem=function(...args){normalizations++;return normalize(...args);};
    window.atob=function(...args){pngDecodes++;return decode(...args);};
    renderShapeLibrary=function(...args){gridBuilds++;return grid(...args);};
    let seq=0;createShapeThumbnail=()=>new Promise(resolve=>setTimeout(()=>resolve(png),seq++));
    shapeLibrary={shapes:Array.from({length:40},(_,i)=>({name:'Preview '+i,items:[{...${JSON.stringify(fixture)},state:{n:i}}]}))};
    shapeLibrary.shapes.forEach(t=>smartPreviewConsent.add(t));
    const start=performance.now();setShapePicker(true);
    await Promise.all(shapeLibrary.shapes.map(t=>shapePreviewJobs.get(t)));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const ms=performance.now()-start,generated={normalizations,pngDecodes,gridBuilds};
    for(let i=0;i<10;i++){setShapePicker(false);setShapePicker(true);}
    return {entries:40,ms,generated,warmReopens:10,totals:{normalizations,pngDecodes,gridBuilds}};
   })()`);
   console.log(JSON.stringify({version,render:{...render,warmedMedianMs},preview}));
   await ctx.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
