const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{await browser?.close();});
async function app(fn){
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://simplecanvas.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('/index.html')?200:404,
      contentType:'text/html',body:route.request().url().endsWith('/index.html')?html:''}));
    await page.goto('http://simplecanvas.test/index.html');
    const run=code=>page.evaluate(async code=>{await __test.run('appReady');return __test.run(code);},code);
    await run('appStarted');
    const move=async(x,y,options)=>{const b=await page.locator('#canvas').boundingBox();await page.mouse.move(b.x+x,b.y+y,options);};
    const click=async(x,y)=>{await move(x,y);await page.mouse.down();await page.mouse.up();};
    await fn({page,run,move,click});
    assert.deepEqual(errors,[],'no uncaught pointer or keyboard errors');
  }finally{await context.close();}
}
const rect={type:'rect',uid:'box',x:100,y:100,w:120,h:80,size:2,color:'#334155',fill:true,fillColor:'#f1f5f9'};
const text={type:'text',uid:'text',x:100,y:100,w:300,h:80,size:2,color:'#000000',strokeOn:false,fill:false,
  textColor:'#000000',text:'Hello world',fontFamily:'sans',fontSize:24,font:'400 24px sans-serif',align:'center'};
const seed=scene=>`cancelGesture();items=${JSON.stringify(scene)};undoStack=[];redoStack=[];setTool('select');selection=[0];render();`;
const paste=page=>page.evaluate(()=>window.dispatchEvent(new ClipboardEvent('paste',{cancelable:true,bubbles:true,clipboardData:new DataTransfer()})));

test('pasting during a polygon draft is one undoable edit that survives autosave and reload',async()=>app(async({page,run,click})=>{
  await run(seed([rect])+`clipboard=clonesOf([0],false);clipboardAssets={};clipboardDatasets={};save();setTool('polygon');`);
  await click(400,300);await click(500,300);await click(500,400);
  assert.equal(await run('!!polyDraft'),true);
  await paste(page);
  assert.deepEqual(await run('({count:items.length,tool:ui.tool,draft:!!polyDraft,undo:undoStack.length})'),
    {count:2,tool:'select',draft:false,undo:1});
  await run('undo()');assert.equal(await run('items.length'),1);
  await run('redo();persistWorkspace()');
  await page.reload();assert.equal(await run('items.length'),2,'the pasted objects were saved without a later edit');
}));

test('mutating shortcuts and paste cannot replace the history transaction during a pointer drag',async()=>app(async({page,run,move})=>{
  for(const key of ['Delete','Backspace','[',']','ArrowRight','.','Control+d','Control+g','Control+z','p','n','Control+v']){
    await run(seed([rect])+`clipboard=clonesOf([0],false);clipboardAssets={};clipboardDatasets={};`);
    await move(160,140);await page.mouse.down();await move(210,140,{steps:3});
    const before=await run('JSON.stringify(historyBefore)');
    await page.keyboard.press(key);
    if(key==='Control+v')await paste(page);
    assert.equal(await run('JSON.stringify(historyBefore)'),before,key+' keeps the drag snapshot');
    assert.deepEqual(await run('[items.length,items[0].x,undoStack.length,ui.tool]'),[1,150,0,'select'],key);
    await move(260,140,{steps:3});await page.mouse.up();
    assert.equal(await run('items[0].x'),200);
    assert.equal(await run('undoStack.length'),1);
    await run('undo()');assert.equal(await run('items[0].x'),100,key+' preserves the full undo');
  }
}));

test('reordering during a rotated member drag never stores its temporary group encoding',async()=>app(async({page,run,move})=>{
  const members=[{...rect,uid:'a',x:300,y:200,w:80,h:60,group:'g',groupRotation:.5},
    {...rect,uid:'b',x:500,y:200,w:80,h:60,group:'g',groupRotation:.5}];
  await run(seed(members)+`enterGroupEdit('g',0);`);
  const start=await run('JSON.stringify(items)'),f=await run('worldFrameOf(items[0])');
  await move(f.cx,f.cy);await page.mouse.down();await move(f.cx+20,f.cy+10,{steps:3});
  assert.equal(await run('!!bakedGesture'),true);
  await page.keyboard.press(']');
  await move(f.cx+40,f.cy+20,{steps:3});await page.mouse.up();
  assert.deepEqual(await run('items.map(it=>[it.groupRotation,it.rotation||0])'),[[.5,0],[.5,0]]);
  assert.equal(await run('undoStack.length'),1);
  await run('undo()');assert.equal(await run('JSON.stringify(items)'),start);
}));

test('Delete during an anchor drag cannot remove the anchor beneath the pointer',async()=>app(async({page,run,move})=>{
  const polygon={type:'polygon',uid:'poly',closed:false,size:4,color:'#000000',fill:false,
    points:[{x:100,y:300},{x:200,y:200},{x:300,y:300},{x:400,y:200}]};
  await run(seed([polygon])+'pointEditIdx=0;render();');
  await move(400,200);await page.mouse.down();await move(410,210,{steps:3});
  await page.keyboard.press('Delete');
  assert.equal(await run('items[0].points.length'),4);
  await move(420,220,{steps:3});await page.mouse.up();
  assert.deepEqual(await run('items[0].points[3]'),{x:420,y:220});
  assert.equal(await run('undoStack.length'),1);
  await run('undo()');assert.deepEqual(await run('items[0].points'),polygon.points);
}));

test('gesture fencing preserves Shift constraints and Escape for an unfinished drawing',async()=>app(async({page,run,move})=>{
  await run(seed([rect]));
  await move(160,140);await page.mouse.down();await page.keyboard.down('Shift');
  await move(210,155,{steps:3});await page.mouse.up();await page.keyboard.up('Shift');
  assert.deepEqual(await run('[items[0].x,items[0].y]'),[150,100]);
  await run('setTool("rect")');await move(500,400);await page.mouse.down();await move(600,500,{steps:3});
  await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await run('items.length'),1);
  assert.equal(await run('undoStack.length'),1,'Escape does not commit the unfinished rectangle');
}));

test('a second press cancels deferred alignment before its new drag begins',async()=>app(async({page,run,move,click})=>{
  await run(seed([text]));await click(130,140);
  assert.equal(await run('alignClickTimer!==null'),true);
  await page.mouse.down();await move(170,140,{steps:3});
  assert.equal(await run('alignClickTimer'),null);
  await page.waitForTimeout(350); // prove the former 300 ms callback cannot mutate a live drag
  assert.deepEqual(await run('[items[0].align,undoStack.length,historyBefore!==null]'),['center',0,true]);
  await move(230,140,{steps:3});await page.mouse.up();
  assert.deepEqual(await run('[items[0].x,undoStack.length]'),[200,1]);
  await run('undo()');assert.deepEqual(await run('[items[0].x,items[0].align]'),[100,'center']);
}));

test('pending alignment is cancelled by deletion, a tool switch, Escape, or a tab switch',async()=>app(async({page,run,click})=>{
  for(const action of ['delete','tool','escape','tab']){
    await run(seed([text]));await click(130,140);
    assert.equal(await run('alignClickTimer!==null'),true,action);
    if(action==='delete')await page.keyboard.press('Delete');
    if(action==='tool')await page.keyboard.press('p');
    if(action==='escape')await page.keyboard.press('Escape');
    if(action==='tab')await run('newTab()');
    assert.equal(await run('alignClickTimer'),null,action);
    const snapshot=await run('JSON.stringify({items,undo:undoStack.length})');
    await page.waitForTimeout(350); // no delayed alignment history may arrive after the action
    assert.equal(await run('JSON.stringify({items,undo:undoStack.length})'),snapshot,action);
  }
}));

test('erasing a rotated grouped stroke retains its resize frame and every sibling position',async()=>app(async({page,run,move})=>{
  const stroke={type:'path',uid:'stroke',mode:'pen',size:4,color:'#000000',group:'g',groupRotation:.8,
    points:Array.from({length:21},(_,i)=>({x:200,y:100+i*10}))};
  const sibling={...rect,uid:'sibling',x:300,y:100,w:80,h:60,group:'g',groupRotation:.8};
  await run(seed([stroke,sibling])+`setTool('eraser');ui.size=8;`);
  const before=await run('JSON.stringify(items)'),corner=await run('toWorld(items[1],items[1].x,items[1].y)'),mid=await run('toWorld(items[0],200,200)');
  await move(mid.x,mid.y);await page.mouse.down();await page.mouse.up();
  assert.equal(await run('items.length'),3,'the stroke was split');
  assert.deepEqual(await run('items.map(it=>[it.groupRotation,it.rotation||0])'),[[.8,0],[.8,0],[.8,0]]);
  const after=await run(`(()=>{const it=items.find(it=>it.uid==='sibling');return toWorld(it,it.x,it.y);})()`);
  assert.ok(Math.hypot(after.x-corner.x,after.y-corner.y)<.03,'untouched sibling remains in place');
  await run('setTool("select");selection=items.map((it,i)=>i);render()');
  assert.equal(await run('resizePivotFor(selection).rotation'),.8);
  assert.equal(await run('undoStack.length'),1);
  await run('undo()');assert.equal(await run('JSON.stringify(items)'),before);
  await run('redo()');assert.deepEqual(await run('items.map(it=>it.groupRotation)'),[.8,.8,.8]);
}));

test('native font selects keep character keys while canvas tool shortcuts remain available',async()=>app(async({page,run,click})=>{
  await run(seed([text]));await page.locator('#fontFamily').focus();
  await page.keyboard.press('m');
  assert.equal(await page.locator('#fontFamily').inputValue(),'mono','native option type-ahead remains available');
  for(const key of ['p','r','t'])await page.keyboard.press(key);
  assert.equal(await run('ui.tool'),'select','typing in a native select never switches tools');
  await click(700,600);await page.keyboard.press('p');
  assert.equal(await run('ui.tool'),'pen');
}));
