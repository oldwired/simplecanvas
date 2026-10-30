const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const html=parseApp(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>browser?.close());
async function app(fn,contextOptions={}){
  const context=await browser.newContext({viewport:{width:1800,height:1000},...contextOptions}),errors=[];
  try{
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://text-overlap.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
    await page.goto('http://text-overlap.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
const rect=uid=>({type:'rect',uid,x:100,y:100,w:300,h:120,size:2,color:'#334155',fill:true,fillColor:'#e2e8f0',strokeOn:true});
const text=uid=>({type:'text',uid,x:100,y:100,w:300,h:120,size:2,color:'#334155',textColor:'#334155',strokeOn:false,fill:false,
  text:'Edit this label',fontFamily:'sans',fontSize:24,font:'24px sans-serif',align:'center'});
async function seed(run,scene){await run(`cancelGesture();items=${JSON.stringify(scene)};selection=[];setTool('select');undoStack=[];redoStack=[];render();`);}
async function point(page,x=230,y=160){const box=await page.locator('#canvas').boundingBox();return {x:box.x+x,y:box.y+y};}
async function click(page){const p=await point(page);await page.mouse.click(p.x,p.y);}
async function doubleClick(page){const p=await point(page);await page.mouse.dblclick(p.x,p.y);}

for(const selected of [false,true])test('overlapping text opens on '+(selected?'an already-selected':'a fresh')+' double-click',()=>app(async({page,run})=>{
  const scene=[rect('bottom'),rect('middle'),text('label')];await seed(run,scene);
  if(selected){await click(page);assert.deepEqual(await run('selectedUids()'),['label']);}
  await doubleClick(page);
  assert.equal(await run('editingTextIdx'),2);assert.equal(await page.locator('#textInput').inputValue(),'Edit this label');
  assert.deepEqual(await run('selectedUids()'),['label']);assert.deepEqual(await run('items'),scene);
  assert.equal(await run('pointEditIdx'),null,'the clicks must not convert a background shape');
  await page.locator('#textInput').fill('Edited label');await page.locator('#textInput').press('Enter');
  assert.equal(await run('items[2].text'),'Edited label');assert.deepEqual(await run('items.slice(0,2)'),scene.slice(0,2));
  assert.equal(await run('undoStack.length'),1);await run('undo()');assert.deepEqual(await run('items'),scene);
}));

test('single clicks cycle behind text, a drag moves the selected layer, and a covered text still opens',()=>app(async({page,run})=>{
  const scene=[rect('bottom'),text('label'),rect('top')];await seed(run,scene);
  for(const uid of ['top','label','bottom','top','label']){await click(page);assert.deepEqual(await run('selectedUids()'),[uid]);}
  let p=await point(page);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+20,p.y+10);await page.mouse.up();
  assert.deepEqual(await run('items'),[scene[0],{...scene[1],x:120,y:110},scene[2]]);
  assert.deepEqual(await run('selectedUids()'),['label']);
  // A scene edit resets cycling. Select the covered text again through ordinary clicks.
  await click(page);assert.deepEqual(await run('selectedUids()'),['top']);await click(page);assert.deepEqual(await run('selectedUids()'),['label']);
  await doubleClick(page);assert.equal(await run('editingTextIdx'),1);
  assert.deepEqual(await run('selectedUids()'),['label']);assert.equal(await run('pointEditIdx'),null);
}));

test('an overlapping table opens the clicked cell rather than the shape underneath',()=>app(async({page,run})=>{
  const table={type:'table',uid:'table',x:100,y:100,w:300,h:120,rows:2,cols:2,size:2,color:'#334155',fontFamily:'sans',fontSize:20,texts:[['A','B'],['C','D']]};
  await seed(run,[rect('background'),table]);const p=await point(page,320,190);await page.mouse.dblclick(p.x,p.y);
  assert.equal(await run('editingTextIdx'),1);assert.deepEqual(await run('editingCell'),{r:1,c:1});
  assert.equal(await page.locator('#textInput').inputValue(),'D');assert.equal(await run('pointEditIdx'),null);
}));

test('overlapping grouped text enters group editing before opening the text editor',()=>app(async({page,run})=>{
  const scene=[rect('background'),{...text('label'),group:'labels',groupRotation:0},{...rect('sibling'),x:650,group:'labels',groupRotation:0}];
  await seed(run,scene);await doubleClick(page);
  assert.equal(await run('editingGroupId'),'labels');assert.equal(await run('editingTextIdx'),null);assert.deepEqual(await run('selectedUids()'),['label']);
  await doubleClick(page);assert.equal(await run('editingTextIdx'),1);assert.equal(await run('editingGroupId'),'labels');
  assert.deepEqual(await run('items'),scene);
}));

test('overlapping text opens on a touch double-tap',()=>app(async({page,run})=>{
  await seed(run,[rect('bottom'),rect('middle'),text('label')]);
  let p=await point(page);await page.touchscreen.tap(p.x,p.y);p=await point(page);await page.touchscreen.tap(p.x+6,p.y+4);
  assert.equal(await run('editingTextIdx'),2);assert.deepEqual(await run('selectedUids()'),['label']);
  assert.equal(await page.locator('#textInput').inputValue(),'Edit this label');assert.equal(await run('pointEditIdx'),null);
},{hasTouch:true}));
