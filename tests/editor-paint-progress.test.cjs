const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
const html=parseApp(fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')).inject('window.__test={run:source=>eval(source)};');
let browser;
before(async()=>{browser=await launchBrowser();});
after(async()=>browser?.close());
async function app(fn){
  const context=await browser.newContext({viewport:{width:1500,height:1000}}),errors=[];
  try{
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://editor-paint.test/**',route=>route.fulfill(route.request().url().endsWith('/index.html')?{contentType:'text/html',body:html}:{status:404,body:''}));
    await page.goto('http://editor-paint.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run});assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
async function motion(page,kind){
  return page.evaluate(kind=>new Promise(resolve=>{
    const canvas=document.querySelector('#canvas'),box=canvas.getBoundingClientRect(),values=new Set(),states=new Set(),painted=new Set();let frame=0;
    const ctx=canvas.getContext('2d'),originalText=ctx.fillText;
    ctx.fillText=function(text,...args){if(/^\d+$/.test(String(text)))painted.add(String(text));return originalText.call(this,text,...args);};
    const tick=()=>{
      const value=20+frame%60;
      const point=kind==='slider'?{x:60+20+2*value,y:120+130*.55}:{x:300+value*3,y:250+value};
      canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:window.__paintPointerId,pointerType:'mouse',buttons:1,clientX:box.x+point.x,clientY:box.y+point.y,bubbles:true}));
      const snapshot=__test.run(`({state:items[0].state.value,width:items[0].w,kids:smartChildrenCache.get(items[0].uid)?.kids})`);
      values.add(snapshot.kids?.filter(k=>k.type==='text').map(k=>k.text).join('|'));
      states.add(kind==='slider'?snapshot.state:snapshot.width);
      if(++frame<90)requestAnimationFrame(tick);else{ctx.fillText=originalText;resolve({values:[...values],painted:[...painted],states:[...states]});}
    };
    requestAnimationFrame(tick);
  }),kind);
}
async function down(page,x,y){
  await page.evaluate(()=>document.querySelector('#canvas').addEventListener('pointerdown',event=>{window.__paintPointerId=event.pointerId;},{once:true,capture:true}));
  const box=await page.locator('#canvas').boundingBox();await page.mouse.move(box.x+x,box.y+y);await page.mouse.down();
}

test('editor slider paints intermediate values throughout continuous pointer movement',async()=>app(async({page,run})=>{
  await run(`cancelGesture();const make=(key,uid,x,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(d=>d.key===key).items[0]),uid,x,y:120,...extra});
    items=[make('numberControl','moving-control',60,{w:240,h:130,state:{value:10}}),make('valueLabel','live-display',400,{bindings:{value:{uid:'moving-control',port:'value'}}})];
    items[0].script=items[0].script.replace('children(state,style,w,h,editing,io={}){','children(state,style,w,h,editing,io={}){const until=performance.now()+35;while(performance.now()<until){}');
    setTool('select');selection=[0];editingSmartIdx=0;render();save();ensureEditorComponentGraph();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('moving-control')?.kids.some(k=>k.text==='10') && smartHandlesCache.has('moving-control')"));
  try{
    await down(page,100,191.5);const result=await motion(page,'slider');
    assert.ok(result.states.length>=4,'the control receives multiple pointer samples');
    assert.ok(result.values.length>=4,'the visible value repaints while moving: '+JSON.stringify(result));
    assert.ok(result.painted.length>=4,'intermediate values reach the canvas');
    const box=await page.locator('#canvas').boundingBox();await page.mouse.move(box.x+60+20+160,box.y+191.5);await page.mouse.up();await run('smartGestureQueue');
    await page.waitForFunction(()=>__test.run("smartChildrenCache.get('moving-control')?.kids.some(k=>k.text==='80') && smartChildrenCache.get('live-display')?.kids.some(k=>k.text==='80')"));
  }finally{await page.mouse.up();}
}));

test('editor resizing keeps a slow smart drawing visibly up to date during movement',async()=>app(async({page,run})=>{
  const script=`({children(s,style,w,h){const until=performance.now()+35;while(performance.now()<until){};return [{type:'rect',x:0,y:0,w,h,color:'#000',fill:true,fillColor:'#fff',size:2},{type:'text',x:10,y:10,w:w-20,h:35,text:String(w),font:'20px sans-serif',color:'#000'}];}})`;
  await run(`cancelGesture();items=[{type:'smart',uid:'resizing-control',script:${JSON.stringify(script)},state:{},x:60,y:120,w:240,h:130,color:'#000000',size:2}];setTool('select');selection=[0];editingSmartIdx=null;render();save();`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('resizing-control')?.kids.some(k=>k.text==='240')"));
  try{
    await down(page,300,250);const result=await motion(page,'resize');
    assert.ok(result.states.length>=4,'resize changes dimensions');
    assert.ok(result.values.length>=4,'the drawing resizes while moving: '+JSON.stringify(result));
    assert.ok(result.painted.length>=4,'intermediate dimensions reach the canvas');
    await page.mouse.up();
    await page.waitForFunction(()=>__test.run("smartChildrenCache.get('resizing-control')?.kids.some(k=>k.text===String(items[0].w)) && !smartInFlight.has('resizing-control')"));
    const width=await run('items[0].w');
    await run('undo()');
    await page.waitForFunction(()=>__test.run("items[0].w===240 && smartChildrenCache.get('resizing-control')?.kids.some(k=>k.text==='240')"));
    await run('redo()');
    await page.waitForFunction(width=>__test.run("items[0].w==="+width+" && smartChildrenCache.get('resizing-control')?.kids.some(k=>k.text===String(items[0].w))"),width);
  }finally{await page.mouse.up();}
}));

test('editor resize rejects completed frames when their state or style also became stale',async()=>app(async({page,run})=>{
  const script=`({children(s,style,w,h){return [{type:'rect',x:0,y:0,w,h,color:style.color,size:2},{type:'text',x:10,y:10,w:w-20,h:35,text:s.tag+':'+w,font:'20px sans-serif',color:style.color}];}})`;
  await run(`cancelGesture();items=[{type:'smart',uid:'guarded-resize',script:${JSON.stringify(script)},state:{tag:'initial'},x:60,y:120,w:240,h:130,color:'#000000',size:2}];setTool('select');selection=[0];render();save();
    const original=requestSmartSandbox;window.paintGate={hold:false};
    requestSmartSandbox=(message,subject,execution)=>{
      const reply=original(message,subject,execution);
      if(message.fn==='children' && subject?.uid==='guarded-resize' && paintGate.hold){
        paintGate.hold=false;return reply.then(async result=>{paintGate.waiting=true;await new Promise(resolve=>paintGate.release=()=>{paintGate.waiting=false;resolve();});return result;});
      }
      return reply;
    };`);
  await page.waitForFunction(()=>__test.run("smartChildrenCache.get('guarded-resize')?.kids.some(k=>k.text==='initial:240')"));
  const box=await page.locator('#canvas').boundingBox();
  try{
    await down(page,300,250);await run('paintGate.hold=true');await page.mouse.move(box.x+360,box.y+270);
    await page.waitForFunction(()=>window.paintGate.waiting);
    await run("items[0].state={tag:'changed'};items[0].color='#ff0000';paintGate.hold=true");
    await page.mouse.move(box.x+390,box.y+280);await run('paintGate.release()');
    await page.waitForFunction(()=>window.paintGate.waiting);
    assert.equal(await run("smartChildrenCache.get('guarded-resize').kids.find(k=>k.type==='text').text"),'initial:240','a size mismatch must not hide state/style staleness');
    await run('paintGate.release()');await page.mouse.up();
    await page.waitForFunction(()=>__test.run("smartChildrenCache.get('guarded-resize')?.kids.some(k=>k.text==='changed:330' && k.color==='#ff0000')"));
  }finally{await run('paintGate.release?.()');await page.mouse.up();}
}));
