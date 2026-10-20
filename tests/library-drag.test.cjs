const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');

// Only the served copy exposes the closure for fixtures and assertions. Placement
// starts with real browser pointer/keyboard input and keeps the production Workers.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await ({chromium,webkit}[engine]).launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});});
after(async()=>{if(browser)await browser.close();});

const rect={type:'rect',x:0,y:0,w:200,h:80,color:'#1e293b',fill:true,fillColor:'#eab308',size:2};
const producerScript=`({apiVersion:2,inputs:{},outputs:{value:{type:'number'}},
  initState(){return {n:7};},initStyle(){return {w:180,h:80,fillColor:'#dbeafe'};},
  compute(inputs,state){return {value:state.n};},
  children(state,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:style.fillColor}];}
})`;
const consumerScript=`({apiVersion:2,inputs:{value:{type:'number',default:0}},outputs:{value:{type:'number'}},
  initState(){return {};},initStyle(){return {w:100,h:60};},
  compute(inputs){return {value:inputs.value*2};},
  children(state,style,w,h,editing,io){return [{type:'text',x:0,y:0,w,h,text:'Value:'+io.outputs.value,strokeOn:false}];}
})`;
const smart=(uid,script,extra)=>({type:'smart',uid,x:20,y:10,w:40,h:30,
  color:'#1e293b',fillColor:'#ffffff',strokeOn:true,fill:false,textColor:'#1e293b',size:2,
  fontFamily:'sans',fontSize:12,font:'600 12px sans-serif',script,state:{},componentApi:2,
  group:'template-group',...extra});
const library={app:'SimpleCanvasShapeLibrary',version:2,workingCollection:['ordinary','connected'],shapes:[
  {id:'ordinary',name:'Grouped drawing',items:[{...rect,group:'template-group'},
    {...rect,type:'ellipse',x:230,y:20,w:50,h:40,group:'template-group'}]},
  {id:'connected',name:'Connected drawing',items:[{...rect,uid:'frame',group:'template-group'},
    smart('producer',producerScript,{state:{n:99}}),
    smart('consumer',consumerScript,{x:240,bindings:{value:{uid:'producer',port:'value'}}})]}
]};

async function app(fn,{contextOptions={}}={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000},...contextOptions});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.addInitScript(()=>{
      const NativeWorker=window.Worker;window.__workerStarts=0;
      window.Worker=class extends NativeWorker{constructor(...args){super(...args);window.__workerStarts++;}};
      // Register before the app's capture handlers, which consume an active drag.
      window.addEventListener('pointerdown',event=>{window.__dragPointer={id:event.pointerId,target:event.target};},true);
      window.addEventListener('pointerup',event=>{
        const box=document.querySelector('#canvas')?.getBoundingClientRect();
        if(box)window.__dropPoint={x:event.clientX-box.left,y:event.clientY-box.top};
      },true);
    });
    await page.route('http://library-drag.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://library-drag.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');
    await run(`shapeLibrary=normalizeShapeLibrary(${JSON.stringify(library)});
      for(const entry of shapeLibrary.shapes)entry.thumbnail={version:1,source:shapePreviewKey(entry.items,entry.datasets),png:builtInShapeLibrary[0].thumbnail.png};
      updateShapeLibraryUI();
      applySketchToActiveTab([{...${JSON.stringify(rect)},uid:'existing',x:1080,y:650}],{});
      setTool('select');selection=[0];render();save();`);
    await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}

async function thumbnail(page,source,name){
  if(await page.locator('#shapePicker').isHidden())await page.locator('#shapeLibBtn').click();
  if(source==='catalog'){
    if(await page.locator('#libraryBrowser').isHidden())await page.locator('#browseShapesBtn').click();
    await page.locator('#libraryCollection').selectOption('mine');
    await page.locator('#librarySearch').fill(name);
  }else if(await page.locator('#libraryBrowser').isVisible())await page.locator('#closeLibraryBrowserBtn').click();
  const button=page.locator(source==='catalog'?'#libraryBrowserGrid':'#shapeGrid')
    .getByRole('button',{name:'Place '+name,exact:true});
  await button.waitFor({state:'visible'});return button;
}
async function pressThumbnail(page,button){
  await button.scrollIntoViewIfNeeded();
  const origin=await button.boundingBox(),canvas=await page.locator('#canvas').boundingBox();
  await page.evaluate(()=>{window.__dropPoint=null;});
  await page.mouse.move(origin.x+origin.width/2,origin.y+origin.height/2);
  await page.mouse.down();
  return canvas;
}
async function beginDrag(page,button,x=750,y=430){
  const canvas=await pressThumbnail(page,button);
  await page.mouse.move(canvas.x+x,canvas.y+y,{steps:8});
  assert.equal(await page.locator('#libraryDragPreview').isVisible(),true,'drag displays placement feedback');
  assert.equal(await page.locator('#shapePicker').isHidden(),true,'active drag closes the picker so the canvas is reachable');
  return {x:canvas.x+x,y:canvas.y+y};
}
async function finishDrop(page,run){
  await page.mouse.up();await run('shapePlacementQueue');
  assert.equal(await page.locator('#libraryDragPreview').isVisible(),false,'finished drag removes its feedback');
  return page.evaluate(()=>window.__dropPoint);
}
async function assertCentered(run,indices,point){
  const box=await run(`unionBoxOf(${JSON.stringify(indices)}.map(index=>items[index]),false)`);
  assert.ok(Math.abs(box.x+box.w/2-point.x)<1,'drop centers the initialized shape at the pointer x');
  assert.ok(Math.abs(box.y+box.h/2-point.y)<1,'drop centers the initialized shape at the pointer y');
}
const drawingSnapshot='JSON.stringify({items,selection,undoStack,redoStack,tool:ui.tool,pending:ui.pendingShape})';

for(const source of ['working','catalog'])test(source+' first drag survives a library grid refresh after pressing its thumbnail',async()=>app(async({page,run})=>{
  const button=await thumbnail(page,source,'Grouped drawing');
  const canvas=await pressThumbnail(page,button),before=await run('items'),history=await run('undoStack.length');
  // Background library updates can repaint the grid after pointerdown but before
  // the pointer crosses the drag threshold. The definition itself has not changed.
  await run('updateShapeLibraryUI()');
  await page.mouse.move(canvas.x+750,canvas.y+430,{steps:8});
  assert.equal(await page.locator('#libraryDragPreview').isVisible(),true,'the first press still starts a drag');
  const point=await finishDrop(page,run);
  assert.equal(await run('items.length'),before.length+2);
  assert.equal(await run('undoStack.length'),history+1);
  await assertCentered(run,[1,2],point);
}));

test('a delayed text alignment during a drag cannot discard a library placement',async()=>app(async({page,run})=>{
  await run(`items[0]={type:'text',uid:'text',x:1040,y:650,w:260,h:60,text:'Alignment example',
    font:'600 24px sans-serif',fontFamily:'sans',fontSize:24,color:'#1e293b',align:'left'};
    selection=[0];render();save();
    const nativeTimeout=window.setTimeout;
    window.setTimeout=(callback,delay,...args)=>{
      if(delay===300){window.__finishAlignment=()=>callback(...args);return nativeTimeout(()=>{},60000);}
      return nativeTimeout(callback,delay,...args);
    };`);
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.click(canvas.x+1270,canvas.y+680);
  assert.equal(await page.evaluate(()=>typeof window.__finishAlignment),'function','real text click schedules alignment');
  await beginDrag(page,await thumbnail(page,'working','Connected drawing'));
  await page.evaluate(()=>window.__finishAlignment());
  assert.equal(await run('items[0].align'),'right','the preceding text edit still completes');
  const point=await finishDrop(page,run);
  assert.equal(await run('items.length'),4,'the same first drop adds the connected group');
  await assertCentered(run,[1,2,3],point);
  await run('undo()');
  assert.equal(await run('items.length'),1);assert.equal(await run('items[0].align'),'right','placement has its own Undo step');
  await run('undo()');assert.equal(await run('items[0].align'),'left','the preceding edit keeps its own Undo step');
}));

test('filtering a pressed catalog entry out still cancels its pending drag',async()=>app(async({page,run})=>{
  const button=await thumbnail(page,'catalog','Grouped drawing'),before=await run(drawingSnapshot);
  const canvas=await pressThumbnail(page,button);
  await run('librarySearch.value="Connected drawing";renderLibraryBrowser()');
  await page.mouse.move(canvas.x+750,canvas.y+430,{steps:8});await finishDrop(page,run);
  assert.equal(await run('libraryDrag'),null);
  assert.equal(await run(drawingSnapshot),before,'a replacement card for a different entry is never used');
}));

for(const source of ['working','catalog'])test(source+' thumbnail drag places an ordinary group once and preserves click placement',async()=>app(async({page,run})=>{
  const before=await run('items'),history=await run('undoStack.length'),definition=await run('JSON.stringify(shapeLibrary)');
  const button=await thumbnail(page,source,'Grouped drawing');
  await beginDrag(page,button);
  assert.deepEqual(await run('items'),before,'dragging does not commit before release');
  assert.equal(await run('undoStack.length'),history,'preview does not begin a history transaction');
  const point=await finishDrop(page,run),placed=await run('items');
  assert.equal(placed.length,3);assert.deepEqual(placed[0],before[0]);
  assert.ok(placed[1].group && placed[1].group===placed[2].group);
  assert.notEqual(placed[1].group,'template-group');
  assert.deepEqual(await run('selection'),[1,2]);
  assert.equal(await run('ui.tool'),'select');
  assert.equal(await run('undoStack.length'),history+1,'one drop creates one undo step');
  await assertCentered(run,[1,2],point);
  assert.equal(await run('JSON.stringify(shapeLibrary)'),definition,'dragging preserves definitions and pins');
  const canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.click(canvas.x+950,canvas.y+530);await run('shapePlacementQueue');
  assert.equal(await run('items.length'),3,'release click and later canvas clicks cannot place another copy');
  await run('undo()');assert.deepEqual(await run('items'),before,'one Undo removes the whole dropped group');
  await run('redo()');assert.deepEqual(await run('items'),placed,'one Redo restores the whole drop');

  await(await thumbnail(page,source,'Grouped drawing')).click();
  assert.equal(await run('ui.tool'),'shape','an ordinary click still arms click placement');
  await page.mouse.click(canvas.x+400,canvas.y+300);await run('shapePlacementQueue');
  assert.equal(await run('items.length'),5,'clicking then clicking the canvas still places once');
  assert.notEqual(await run('items[3].group'),placed[1].group);
}));

for(const source of ['working','catalog'])test(source+' drag initializes connected smart groups through the normal placement path',async()=>app(async({page,run})=>{
  const definition=await run('JSON.stringify(shapeLibrary)'),before=await run('items'),history=await run('undoStack.length');
  await beginDrag(page,await thumbnail(page,source,'Connected drawing'));
  assert.equal(await page.evaluate(()=>window.__workerStarts),0,'drag feedback uses cached previews without running scripts');
  assert.deepEqual(await run('items'),before);
  const point=await finishDrop(page,run),placed=await run('items'),group=placed.slice(1);
  assert.equal(group.length,3);assert.deepEqual(placed[0],before[0]);
  assert.ok(group.every(item=>item.group===group[0].group));assert.notEqual(group[0].group,'template-group');
  assert.equal(new Set(placed.map(item=>item.uid)).size,4,'every inserted item gets a fresh identity');
  assert.deepEqual(group[1].state,{n:7},'initState replaces the saved transient value');
  assert.equal(group[1].w,180);assert.equal(group[1].h,80);assert.equal(group[1].fillColor,'#dbeafe');
  assert.equal(group[2].w,100);assert.equal(group[2].h,60);
  assert.equal(group[2].bindings.value.uid,group[1].uid,'internal wiring follows the copied producer');
  await assertCentered(run,[1,2,3],point);
  await page.waitForFunction(uid=>__test.run(`smartChildrenCache.get(${JSON.stringify(uid)})?.kids.some(item=>item.text==='Value:14')`),group[2].uid);
  assert.equal(await run('undoStack.length'),history+1);
  assert.equal(await run('JSON.stringify(shapeLibrary)'),definition,'initialization does not mutate reusable definitions');
  await run('undo()');assert.deepEqual(await run('items'),before);
  await run('redo()');assert.deepEqual(await run('items'),placed);
}));

for(const source of ['working','catalog'])test(source+' drag cancellation and an outside drop leave the drawing and history untouched',async()=>app(async({page,run})=>{
  const before=await run(drawingSnapshot),definition=await run('JSON.stringify(shapeLibrary)');
  for(const cancel of ['outside','escape','pointercancel']){
    await beginDrag(page,await thumbnail(page,source,'Connected drawing'));
    if(cancel==='outside')await page.mouse.move(5,5,{steps:3});
    else if(cancel==='escape')await page.keyboard.press('Escape');
    else await page.evaluate(()=>window.__dragPointer.target.dispatchEvent(new PointerEvent('pointercancel',{
      pointerId:window.__dragPointer.id,pointerType:'mouse',bubbles:true})));
    await finishDrop(page,run);
    assert.equal(await run(drawingSnapshot),before,cancel+' does not mutate drawing, selection, or history');
    assert.equal(await run('JSON.stringify(shapeLibrary)'),definition,cancel+' leaves definitions and pins unchanged');
    assert.equal(await page.evaluate(()=>window.__workerStarts),0,cancel+' does not initialize a discarded smart shape');
    assert.equal(await run('Boolean(ui.pendingShape)'),false,cancel+' does not leave click placement armed');
    const canvas=await page.locator('#canvas').boundingBox();
    await page.mouse.click(canvas.x+950,canvas.y+530);await run('shapePlacementQueue');
    assert.equal(await run('items.length'),1,cancel+' cannot create a late copy on the next canvas click');
    await run('selection=[0];render()');
  }
}));

test('keyboard activation still arms the catalog thumbnail for click placement',async()=>app(async({page,run})=>{
  const button=await thumbnail(page,'catalog','Grouped drawing');await button.focus();await page.keyboard.press('Enter');
  assert.equal(await run('ui.tool'),'shape');assert.equal(await page.locator('#shapePicker').isVisible(),false);
  const canvas=await page.locator('#canvas').boundingBox();await page.mouse.click(canvas.x+750,canvas.y+430);
  await run('shapePlacementQueue');assert.equal(await run('items.length'),3);
}));

test('switching tabs during a drag cannot place into either document',async()=>app(async({page,run})=>{
  const original=await run('activeTabId'),before=await run('items'),history=await run('undoStack.length');
  await beginDrag(page,await thumbnail(page,'working','Connected drawing'));
  await run('newTab()');await finishDrop(page,run);
  assert.equal(await run('items.length'),0,'a stale drag cannot land in the newly active tab');
  await run(`activateTab(${JSON.stringify(original)})`);
  assert.deepEqual(await run('items'),before,'the original document also remains untouched');
  assert.equal(await run('undoStack.length'),history);
  assert.equal(await page.evaluate(()=>window.__workerStarts),0,'tab cancellation discards the drag before initialization');
}));

test('disabling the shape library during a drag discards the pending drop',async()=>app(async({page,run})=>{
  const before=await run(drawingSnapshot);
  await beginDrag(page,await thumbnail(page,'catalog','Connected drawing'));
  await run('features=Object.freeze({...features,shapeLibrary:false})');await finishDrop(page,run);
  assert.equal(await run(drawingSnapshot),before);
  assert.equal(await page.evaluate(()=>window.__workerStarts),0,'a disabled library cannot start component initialization');
}));

test('a missed mouse release cannot turn the next hover into a library drag',async()=>app(async({page,run})=>{
  const before=await run(drawingSnapshot),button=await thumbnail(page,'working','Connected drawing');
  const origin=await button.boundingBox(),canvas=await page.locator('#canvas').boundingBox();
  await page.mouse.move(origin.x+origin.width/2,origin.y+origin.height/2);
  // Seed the pending press left behind when its release occurs outside the browser.
  // The following real mouse move has buttons=0, as it does when the pointer returns.
  await button.dispatchEvent('pointerdown',{pointerId:1,pointerType:'mouse',isPrimary:true,
    button:0,buttons:1,clientX:origin.x+origin.width/2,clientY:origin.y+origin.height/2});
  await page.mouse.move(canvas.x+750,canvas.y+430,{steps:3});
  assert.equal(await page.locator('#libraryDragPreview').isVisible(),false);
  assert.equal(await run('libraryDrag'),null);
  assert.equal(await run(drawingSnapshot),before);
  assert.equal(await page.evaluate(()=>window.__workerStarts),0);
}));

for(const overlap of ['pending second press','active second drag','two pending drops','pending ordinary drop'])test('smart placements keep their order with '+overlap,async()=>app(async({page,run})=>{
  const before=await run('items'),history=await run('undoStack.length');
  const secondSmart=overlap!=='pending ordinary drop';
  // Delay the production queue itself, so the test controls overlap without slow or
  // timing-sensitive Worker scripts. Both accepted drops still run real initialization.
  await run('shapePlacementQueue=new Promise(resolve=>{window.__releaseShapePlacement=resolve;});true');
  await beginDrag(page,await thumbnail(page,'working','Connected drawing'),470,310);
  await page.mouse.up();const firstPoint=await page.evaluate(()=>window.__dropPoint);
  assert.deepEqual(await run('items'),before,'the first accepted drop waits for initialization');
  const secondButton=await thumbnail(page,'catalog',secondSmart?'Connected drawing':'Grouped drawing');
  let secondPoint;
  if(overlap==='pending second press'){
    const canvas=await pressThumbnail(page,secondButton);
    await run('window.__releaseShapePlacement();true');await run('shapePlacementQueue');
    assert.equal(await run('items.length'),4);
    assert.equal(await page.locator('#shapePicker').isVisible(),true,'finishing an accepted drop keeps the newly opened picker available');
    assert.equal(await page.locator('#libraryDragPreview').isVisible(),false,'a press below the threshold is still a pending gesture');
    await page.mouse.move(canvas.x+900,canvas.y+470,{steps:8});
    assert.equal(await page.locator('#libraryDragPreview').isVisible(),true,'the pending press can still become a drag');
    secondPoint=await finishDrop(page,run);
  }else{
    await beginDrag(page,secondButton,900,470);
    if(overlap==='active second drag'){
      await run('window.__releaseShapePlacement();true');await run('shapePlacementQueue');
      assert.equal(await run('items.length'),4,'the first queued group finishes while the next drag is active');
      assert.equal(await page.locator('#libraryDragPreview').isVisible(),true,'finishing an accepted drop preserves the next active drag');
      secondPoint=await finishDrop(page,run);
    }else{
      await page.mouse.up();secondPoint=await page.evaluate(()=>window.__dropPoint);
      assert.deepEqual(await run('items'),before,'both drops wait without opening a history transaction');
      await run('window.__releaseShapePlacement();true');await run('shapePlacementQueue');
    }
  }
  assert.equal(await run('items.length'),secondSmart?7:6,'both accepted groups are placed exactly once');
  await assertCentered(run,[1,2,3],firstPoint);await assertCentered(run,secondSmart?[4,5,6]:[4,5],secondPoint);
  assert.equal(await run('items[2].state.n'),7);
  assert.equal(await run('items[3].bindings.value.uid===items[2].uid'),true);
  if(secondSmart){
    assert.equal(await run('items[5].state.n'),7);
    assert.equal(await run('items[6].bindings.value.uid===items[5].uid'),true);
  }
  assert.notEqual(await run('items[1].group'),await run('items[4].group'));
  assert.equal(await run('undoStack.length'),history+2,'each accepted drop has its own Undo step');
  await run('undo()');assert.equal(await run('items.length'),4);await assertCentered(run,[1,2,3],firstPoint);
  await run('undo()');assert.deepEqual(await run('items'),before);
}));

test('Chromium touch holds drag from both library surfaces while quick swipes scroll',{
  skip:engine!=='chromium'?'Native touch injection uses Chromium CDP; physical iOS behavior is not covered':false
},async()=>app(async({page,run,context})=>{
  await run(`shapeLibrary=normalizeShapeLibrary({app:'SimpleCanvasShapeLibrary',version:2,
    shapes:Array.from({length:40},(_,index)=>({id:'touch-'+index,name:'Touch shape '+index,
      items:[{...${JSON.stringify(rect)},w:100,h:60}]}))});
    for(const entry of shapeLibrary.shapes)entry.thumbnail={version:1,source:shapePreviewKey(entry.items,entry.datasets),png:builtInShapeLibrary[0].thumbnail.png};
    updateShapeLibraryUI();applySketchToActiveTab([],{});setTool('select');selection=[];render();save();`);
  const session=await context.newCDPSession(page);
  const touch=(type,x,y)=>session.send('Input.dispatchTouchEvent',{
    type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:1}]
  });
  const open=async surface=>{
    if(await page.locator('#shapePicker').isHidden())await page.locator('#shapeLibBtn').click();
    if(surface==='catalog'){
      if(await page.locator('#libraryBrowser').isHidden())await page.locator('#browseShapesBtn').click();
      await page.locator('#libraryCollection').selectOption('mine');await page.locator('#librarySearch').fill('');
    }else if(await page.locator('#libraryBrowser').isVisible())await page.locator('#closeLibraryBrowserBtn').click();
  };
  for(const [index,surface] of ['working','catalog'].entries()){
    await open(surface);
    const selector=surface==='working'?'#shapeGrid':'#libraryBrowserGrid';
    const first=await page.locator(selector+' .shape-thumb').first().boundingBox();
    const canvas=await page.locator('#canvas').boundingBox();
    await touch('touchStart',first.x+first.width/2,first.y+first.height/2);
    await page.waitForTimeout(420); // The intentional touch hold must exceed 350 ms.
    assert.equal(await page.locator('#libraryDragPreview').isVisible(),true,surface+' hold starts drag');
    await touch('touchMove',canvas.x+230,canvas.y+480);await touch('touchEnd');await run('shapePlacementQueue');
    assert.equal(await run('items.length'),index+1,surface+' touch drop places exactly once');
    await assertCentered(run,[index],{x:230,y:480});
    assert.equal(await page.locator('#libraryDragPreview').isVisible(),false);

    await open(surface);
    const scroller=page.locator(surface==='working'?'#shapeGrid':'#libraryBrowser .library-results');
    await scroller.evaluate(element=>{element.scrollTop=0;});
    const beforeSwipe=await run(drawingSnapshot),start=await page.locator(selector+' .shape-thumb').nth(6).boundingBox();
    const x=start.x+start.width/2,y=start.y+start.height/2;
    await touch('touchStart',x,y);
    for(let step=1;step<=5;step++){
      await touch('touchMove',x,y-25*step);await page.waitForTimeout(20);
    }
    await touch('touchEnd');await page.waitForTimeout(120);
    assert.ok(await scroller.evaluate(element=>element.scrollTop)>0,surface+' quick swipe scrolls the native container');
    assert.equal(await page.locator('#libraryDragPreview').isVisible(),false);
    assert.equal(await run(drawingSnapshot),beforeSwipe,surface+' swipe does not place, arm placement, or change history');
    await page.locator('#shapeLibBtn').click();
  }
  await session.detach();
},{contextOptions:{viewport:{width:900,height:950},hasTouch:true,isMobile:true}}));
