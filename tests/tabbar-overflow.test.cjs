const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

// Only the editor fixture exposes its closure. Downloaded documents exercise the
// actual standalone reader, including its separate smart-component activation.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:720,height:900}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://tabbar-overflow.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://tabbar-overflow.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}

const names=Array.from({length:10},(_,index)=>`Drawing ${index+1}: a complete descriptive name`);
names[4]='<img src=x onerror="window.tabNameExecuted=true"> & literal name';
const rectangle={type:'rect',uid:'shape',x:80,y:80,w:160,h:100,size:2,color:'#1f2937',strokeOn:true,fill:true,fillColor:'#dbeafe'};
const smart={...rectangle,type:'smart',componentApi:2,state:{value:'Running tab'},script:`({apiVersion:2,
  inputs:{},outputs:{value:{type:'string'}},compute(inputs,state){return {value:state.value};},
  children(state,style,w,h,editing,io){return [{type:'text',x:0,y:0,w,h,text:io.outputs.value,strokeOn:false}];}
})`};
async function seed(run,{withSmart=false}={}){
  return run(`(()=>{
    const names=${JSON.stringify(names)};
    for(let index=0;index<names.length;index++){
      if(index)newTab();tabs[index].name=names[index];
      applySketchToActiveTab([${JSON.stringify(withSmart?smart:rectangle)}],{});
    }
    activateTab(tabs[0].id);renderTabs();saveTabList();return tabs.map(tab=>tab.id);
  })()`);
}
async function openExport(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-tabbar-')),file=path.join(directory,'document.html');
  fs.copyFileSync(await(await download).path(),file);
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  return {reader,errors,requests};
}
async function overflow(page,value=true){
  await page.waitForFunction(value=>document.querySelector('.tabbar').dataset.overflow===String(value),value);
  for(const selector of ['.tab-scroll-prev','.tab-scroll-next','.tab-list-toggle'])
    assert.equal(await page.locator(selector).isVisible(),value,selector+' only appears for overflow');
}
async function active(page,index,{focus=false}={}){
  await page.waitForFunction(({index,focus})=>{
    const tabs=[...document.querySelectorAll('.tab-select')],tab=tabs[index];
    return tab?.getAttribute('aria-selected')==='true'&&tab.classList.contains('active')&&
      (!focus||document.activeElement===tab)&&tabs.filter(tab=>tab.getAttribute('aria-selected')==='true').length===1;
  },{index,focus});
  const tab=page.locator('.tab-select').nth(index);
  assert.equal(await tab.getAttribute('role'),'tab');
  assert.equal(await tab.getAttribute('tabindex'),'0');
  await page.waitForFunction(tab=>{
    const port=document.querySelector('.tabbar-scroll').getBoundingClientRect(),box=tab.getBoundingClientRect();
    return box.left>=port.left-1&&box.right<=port.right+1;
  },await tab.elementHandle());
}

async function exerciseOverflow(page){
  await overflow(page);
  assert.equal(await page.locator('.tabbar-scroll').getAttribute('role'),'tablist');
  await active(page,0);
  assert.equal(await page.locator('.tab-scroll-prev').isDisabled(),true);
  assert.equal(await page.locator('.tab-scroll-next').isDisabled(),false);
  assert.equal(await page.locator('.tabbar-viewport').evaluate(el=>el.classList.contains('has-after')),true);
  await page.locator('.tab-scroll-next').click();
  await page.waitForFunction(()=>document.querySelector('.tabbar-scroll').scrollLeft>20);
  assert.equal(await page.locator('.tab-select.active').textContent(),names[0],'scrolling does not select another tab');
  assert.equal(await page.locator('.tab-scroll-prev').isDisabled(),false);
  assert.equal(await page.locator('.tabbar-viewport').evaluate(el=>el.classList.contains('has-before')),true);
  await page.locator('.tabbar-scroll').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  await page.waitForFunction(()=>document.querySelector('.tab-scroll-next').disabled);
  assert.equal(await page.locator('.tabbar-viewport').evaluate(el=>el.classList.contains('has-after')),false);
  const end=await page.locator('.tabbar-scroll').evaluate(el=>el.scrollLeft);
  await page.locator('.tab-scroll-prev').click();
  await page.waitForFunction(end=>document.querySelector('.tabbar-scroll').scrollLeft<end-20,end);

  await page.locator('.tab-list-toggle').click();
  assert.equal(await page.locator('.tab-list-toggle').getAttribute('aria-expanded'),'true');
  assert.deepEqual(await page.locator('.tab-list-item').allTextContents(),names,'All tabs exposes complete literal names');
  assert.equal(await page.locator('.tab-list-item').nth(0).getAttribute('aria-checked'),'true');
  assert.equal(await page.locator('.tab-list-item').nth(9).getAttribute('aria-checked'),'false');
  assert.equal(await page.locator('.tab-list-menu img').count(),0,'tab names cannot inject markup');
  assert.equal(await page.evaluate(()=>window.tabNameExecuted),undefined);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.tab-list-menu').isHidden(),true);
  assert.equal(await page.locator('.tab-list-toggle').getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('.tab-list-toggle').evaluate(el=>document.activeElement===el),true);

  await page.locator('.tab-list-toggle').click();
  await page.locator('.tab-list-item').nth(9).click();
  await active(page,9,{focus:true});
  assert.equal(await page.locator('.tab-list-menu').isHidden(),true);
  await page.keyboard.press('ArrowLeft');await active(page,8,{focus:true});
  await page.keyboard.press('ArrowRight');await active(page,9,{focus:true});
  await page.keyboard.press('Home');await active(page,0,{focus:true});
  await page.keyboard.press('End');await active(page,9,{focus:true});

  await page.locator('.tab-list-toggle').click();
  await page.keyboard.press('Home');
  assert.equal(await page.locator('.tab-list-item').nth(0).evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.tab-list-item').nth(1).evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('ArrowUp');await page.keyboard.press('End');
  assert.equal(await page.locator('.tab-list-item').nth(9).evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await active(page,0,{focus:true});

  await page.setViewportSize({width:320,height:900});await overflow(page);
  await page.keyboard.press('End');await active(page,9,{focus:true});
  await page.waitForFunction(()=>{
    const tab=document.querySelector('.tab-select.active'),row=tab.closest('.tab')||tab;
    const port=document.querySelector('.tabbar-scroll').getBoundingClientRect(),box=row.getBoundingClientRect();
    return box.left>=port.left-1&&box.right<=port.right+1;
  });
  assert.equal(await page.getByRole('button',{name:'All tabs',exact:true}).isVisible(),true,'the compact icon keeps its accessible name');
  await page.getByRole('button',{name:'All tabs',exact:true}).click();
  const menuBounds=await page.locator('.tab-list-menu').boundingBox();
  assert.ok(menuBounds.x>=0&&menuBounds.x+menuBounds.width<=320,'the complete menu fits the narrow viewport');
  assert.ok(menuBounds.y>=0&&menuBounds.y+menuBounds.height<=900,'the narrow menu remains on screen vertically');
  await page.locator('.tab-list-item').nth(0).click();await active(page,0,{focus:true});

  await page.setViewportSize({width:2400,height:900});await overflow(page,false);
  assert.equal(await page.locator('.tab-list-menu').isHidden(),true);
  assert.equal(await page.locator('.tabbar-viewport').evaluate(el=>el.classList.contains('has-before')||el.classList.contains('has-after')),false);
  await page.setViewportSize({width:720,height:900});await overflow(page);
  await active(page,0);
}

test('editor overflow controls reveal tabs, keep full names safe and support focused keyboard navigation',async()=>app(async({page,run})=>{
  await seed(run);await exerciseOverflow(page);
  const selected=await run('activeTabId');
  await page.locator('#canvas').click({position:{x:400,y:400}});
  await page.keyboard.press('ArrowRight');
  assert.equal(await run('activeTabId'),selected,'canvas arrow shortcuts do not navigate the tab bar');
}));

test('new and closed editor tabs remain visible and keyboard focus survives the rebuilt tab list',async()=>app(async({page,run})=>{
  const ids=await seed(run);await overflow(page);
  await run('newTab()');await active(page,10);
  await page.locator('.tab-select').nth(10).focus();
  await page.keyboard.press('ArrowLeft');await active(page,9,{focus:true});
  await page.locator('.tab').nth(9).locator('.tab-close').click();
  await active(page,9,{focus:true});
  assert.equal(await run(`tabs.some(tab=>tab.id===${JSON.stringify(ids[9])})`),false);
  await page.keyboard.press('Home');await active(page,0,{focus:true});
  await run('while(tabs.length>2)closeTab(tabs[tabs.length-1].id)');
  await overflow(page,false);
  await page.locator('.tab-select').nth(0).focus();await page.keyboard.press('ArrowRight');await active(page,1,{focus:true});
  await page.locator('.tab').nth(1).locator('.tab-close').click();
  assert.equal(await page.locator('.tabbar').isHidden(),true,'the final single drawing needs no tab bar');
}));

for(const withSmart of [false,true])test(`downloaded ${withSmart?'smart':'plain'} HTML has the same accessible overflow controls offline`,async()=>app(async({page,run,context})=>{
  await seed(run,{withSmart});const {reader,errors,requests}=await openExport(page,run,context);
  await exerciseOverflow(reader);
  await reader.locator('.tab-list-toggle').click();await reader.locator('.tab-list-item').nth(9).click();
  await active(reader,9,{focus:true});
  assert.equal(await reader.locator('.tab-panel').nth(9).isVisible(),true);
  assert.equal(await reader.locator('.tab-panel').nth(0).isHidden(),true);
  if(withSmart)await reader.waitForFunction(()=>document.querySelectorAll('.tab-panel')[9].querySelector('[data-smart-index]')?.dataset.smartReady==='true');
  await reader.keyboard.press('Home');await active(reader,0,{focus:true});
  assert.equal(await reader.locator('.tab-panel').nth(0).isVisible(),true);
  if(withSmart)await reader.waitForFunction(()=>document.querySelectorAll('.tab-panel')[0].querySelector('[data-smart-index]')?.dataset.smartReady==='true');
  assert.deepEqual(errors,[],'no uncaught offline-reader errors');assert.deepEqual(requests,[],'the export has no HTTP dependencies');
}));

test('choosing a reader tab cancels arrow scrolling without a later frame clipping the selection',async()=>app(async({page,run,context})=>{
  await seed(run);const {reader,errors}=await openExport(page,run,context);await overflow(reader);
  await reader.locator('.tab-scroll-next').click();
  await reader.waitForFunction(()=>document.querySelector('.tabbar-scroll').scrollLeft>0);
  const samples=await reader.evaluate(async()=>{
    document.querySelector('.tab-list-toggle').click();
    document.querySelectorAll('.tab-list-item')[9].click();
    const strip=document.querySelector('.tabbar-scroll'),tab=document.querySelector('.tab-select.active'),samples=[];
    // Observe every paint across the interrupted animation, rather than accepting an
    // instant reveal that an already queued scrolling frame can later overwrite.
    const until=performance.now()+250;
    do{
      await new Promise(requestAnimationFrame);
      const view=strip.getBoundingClientRect(),box=tab.getBoundingClientRect();
      samples.push(box.left>=view.left-1&&box.right<=view.right+1);
    }while(performance.now()<until);
    return samples;
  });
  assert.ok(samples.every(Boolean),'the selected tab stays completely visible after every paint');
  await active(reader,9,{focus:true});assert.deepEqual(errors,[]);
}));
