const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser}=require('./helpers/browser.cjs');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
  .replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{if(browser)await browser.close();});

async function app(fn){
  const context=await browser.newContext({viewport:{width:1400,height:1000}});
  try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://spreadsheet-data-host.test/**',route=>route.fulfill({
      status:route.request().url().endsWith('index.html')?200:404,contentType:'text/html',body:html}));
    await page.goto('http://spreadsheet-data-host.test/index.html');
    const run=source=>page.evaluate(async source=>{await __test.run('appReady');return __test.run(source);},source);
    await run('appStarted');await fn({page,run,context});
    assert.deepEqual(errors,[],'no uncaught editor errors');
  }finally{await context.close();}
}
const inlineScript=`({apiVersion:2,
  outputs:{calls:{type:'number'},value:{type:'string'}},
  compute(inputs,state){return {calls:state.calls,value:state.value};},
  children(state,style,w,h){return [{type:'rect',x:0,y:0,w,h,fill:true,fillColor:'#ffffff'},
    {type:'text',x:0,y:42,w,h:20,text:'Calls:'+state.calls+' Value:'+state.value,strokeOn:false}];},
  handles(state){return [
    {id:'A1',kind:'text',value:'Locked cell',readOnly:true,x:40,y:16,ref:'A1',label:'A1',inline:{x:0,y:0,w:80,h:32,navigation:'horizontal',references:true}},
    {id:'B1',kind:'text',value:state.value,x:120,y:16,ref:'B1',label:'B1',inline:{x:80,y:0,w:80,h:32,mode:'edit',navigation:'horizontal',references:true}},
    {id:'C1',kind:'number',value:42,readOnly:true,min:0,max:10,x:200,y:16,label:'C1',inline:{x:160,y:0,w:80,h:32,navigation:'horizontal'}},
    {id:'D1',kind:'text',value:'=Literal dataset text',readOnly:true,x:280,y:16,ref:'D1',label:'D1',inline:{x:240,y:0,w:80,h:32,mode:'submit',references:true}}
  ];},
  hitEdit(state,x,y){return y>=0&&y<=32?['A1','B1','C1','D1'][Math.floor(x/80)]||null:null;},
  dragEdit(state,id,value){return {state:{...state,calls:state.calls+1,value:String(value)}};}
})`;
function item(script=inlineScript,extra={}){return {type:'smart',uid:'sheet',componentApi:2,componentName:'Sheet',script,
  state:{calls:0,value:'Initial'},x:100,y:100,w:320,h:64,fill:true,fillColor:'#ffffff',color:'#94a3b8',textColor:'#334155',
  strokeOn:true,size:1,fontFamily:'sans',fontSize:14,font:'400 14px sans-serif',...extra};}
async function seed(run,it=item(),pool={}){
  await run(`cancelGesture();datasets=normalizeDatasets(${JSON.stringify(pool)});items=[${JSON.stringify(it)}];
    selection=[];editingSmartIdx=null;setTool('select');render();save();`);
  await run('ensureEditorComponentGraph()');
}
async function clickEditor(page,run,id){
  const point=await run(`(async()=>{selection=[0];editingSmartIdx=0;render();const it=items[0];
    const handle=(await requestSmartCall(it,'handles',[it.state,it.w,it.h,smartResolvedStyle(it)])).find(h=>h.id===${JSON.stringify(id)});
    return {x:it.x+handle.x,y:it.y+handle.y};})()`);
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+point.x,box.y+point.y);
}
async function openReader(page,run,context){
  const download=page.waitForEvent('download');await run('exportHtml()');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-spreadsheet-data-'));
  context.on('close',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'document.html');fs.copyFileSync(await(await download).path(),file);
  const reader=await context.newPage(),errors=[],requests=[];
  reader.on('pageerror',error=>errors.push(error.message));
  reader.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await reader.goto(pathToFileURL(file).href);
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="0"]')?.dataset.smartReady==='true');
  return {reader,errors,requests};
}
async function clickReader(page,index){
  const point=await page.locator('[data-smart-index="0"]').evaluate((host,index)=>{
    const p=new DOMPoint(index*80+40,16).matrixTransform(host.firstElementChild.getScreenCTM());return {x:p.x,y:p.y};
  },index);
  await page.mouse.click(point.x,point.y);
}

test('the Worker declares validated table presentation and readonly inline handle metadata',async()=>app(async({run})=>{
  for(const [marker,expected] of [[undefined,'preview'],['preview','preview'],['full','full']]){
    const script='({apiVersion:2,'+(marker===undefined?'':'tablePresentation:'+JSON.stringify(marker)+',')+'children(){return [];}})';
    assert.equal((await run(`requestSmartCaps(${JSON.stringify(script)})`)).tablePresentation,expected);
  }
  for(const marker of [true,null,'all',24]){
    const script='({apiVersion:2,tablePresentation:'+JSON.stringify(marker)+',children(){return [];}})';
    assert.equal(await run(`requestSmartCaps(${JSON.stringify(script)})`),null);
  }
  await seed(run);
  const handles=await run('requestSmartCall(items[0],"handles",[items[0].state,320,64,{}])');
  assert.equal(handles[0].readOnly,true);assert.equal(handles[0].inline.mode,'edit');
  assert.equal(handles[1].readOnly,undefined);assert.equal(handles[2].readOnly,true);
  assert.equal(handles[3].inline.mode,'submit','an explicit interaction mode is preserved');
  for(const patch of [{readOnly:'yes'},{kind:'click',readOnly:true},{inline:null,readOnly:true}]){
    const descriptor={...handles[0],...patch};
    assert.equal(await run(`(()=>{try{validateSmartReply({ok:true,apiVersion:2,result:[${JSON.stringify(descriptor)}]},
      {method:'call',fn:'handles',componentApi:2,args:[{},320,64,{}]});return false;}catch{return true;}})()`),true);
  }
}));

test('full presentation retains complete selected inputs, output previews and the transfer budget',async()=>app(async({run})=>{
  const result=await run(`(()=>{
    const data={name:'Long table',columns:[{key:'label',type:'string'}],rows:Array.from({length:600},(_,i)=>[i+':'+ 'x'.repeat(300)])};
    const pool=normalizeDatasets({source:data}),ref={datasetId:'source',rows:[599,...Array.from({length:599},(_,i)=>i)]};
    const caps={inputs:{data:{type:'table'}},outputs:{data:{type:'table'}}};
    const preview=componentIo({data:ref},{data:ref},caps,pool),full=componentIo({data:ref},{data:ref},{...caps,tablePresentation:'full'},pool);
    const inputs=Object.fromEntries(Array.from({length:12},(_,i)=>['t'+i,ref])),ports=Object.fromEntries(Object.keys(inputs).map(k=>[k,{type:'table'}]));
    let error='';try{componentIo(inputs,{}, {inputs:ports,outputs:{},tablePresentation:'full'},pool);}catch(e){error=e.message;}
    return {previewRows:preview.tables.inputs.data.rows.length,previewLength:preview.tables.inputs.data.rows[0][0].length,
      fullRows:full.tables.inputs.data.rows.length,fullFirst:full.tables.inputs.data.rows[0][0],index:full.tables.inputs.data.rowIndices[0],
      outputRows:full.tables.outputs.data.rows.length,outputLength:full.tables.outputs.data.rows[0][0].length,error};
  })()`);
  assert.equal(result.previewRows,24);assert.equal(result.previewLength,160);
  assert.equal(result.fullRows,600);assert.equal(result.fullFirst,'599:'+ 'x'.repeat(300));assert.equal(result.index,599);
  assert.equal(result.outputRows,24);assert.equal(result.outputLength,160);assert.match(result.error,/2-million-character/);
}));

test('readonly fields select and navigate without writes, and remain formula reference targets',async()=>app(async({page,run})=>{
  await seed(run);const before=await run('undoStack.length');
  await clickEditor(page,run,'A1');let field=page.locator('#smartTextValue');await field.waitFor();
  assert.equal(await field.evaluate(input=>input.readOnly),true);
  assert.equal(await field.evaluate(input=>input.selectionEnd-input.selectionStart),11,'the full readonly value is selectable');
  await field.press('X');assert.equal(await field.inputValue(),'Locked cell');
  await field.evaluate(input=>{input.value='Changed outside the native editor';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await field.press('Enter');await field.waitFor({state:'detached'});
  assert.deepEqual(await run('items[0].state'),{calls:0,value:'Initial'});
  await clickEditor(page,run,'A1');await page.locator('#smartTextValue').press('Tab');
  field=page.getByRole('textbox',{name:'B1',exact:true});await field.waitFor();
  assert.equal(await field.evaluate(input=>input.readOnly),false,'leaving readonly restores editing');
  await field.fill('=SUM(');
  const box=await page.locator('#canvas').boundingBox();await page.mouse.click(box.x+140,box.y+116);
  assert.equal(await field.inputValue(),'=SUM(A1','a readonly cell can be picked into a formula');
  await field.press('End');await field.press(')');await field.press('Tab');
  await run('smartHitSettled');
  assert.deepEqual(await run('items[0].state'),{calls:1,value:'=SUM(A1)'});
  const number=page.locator('#smartNumberValue');await number.waitFor();
  assert.equal(await number.evaluate(input=>input.readOnly),true,'async completion preserves readonly on the destination');
  assert.equal(await number.inputValue(),'42');
  await number.press('Enter');await number.waitFor({state:'detached'});
  assert.deepEqual(await run('items[0].state'),{calls:1,value:'=SUM(A1)'});
  assert.equal(await run('undoStack.length'),before+1,'readonly navigation adds no history entries');
  await clickEditor(page,run,'D1');field=page.locator('#smartTextValue');await field.waitFor();
  assert.equal(await page.locator('[data-smart-inline-input] button:visible').count(),0);
  await field.evaluate(input=>{input.value='tampered';input.form.requestSubmit();});
  assert.equal(await run('items[0].state.calls'),1);
  await page.mouse.click(box.x+600,box.y+300);await field.waitFor({state:'detached'});
  assert.equal(await run('items[0].state.calls'),1);
}));

test('readonly fields and editable neighbours use the same offline HTML behavior',async()=>app(async({page,run,context})=>{
  await seed(run);const {reader,errors,requests}=await openReader(page,run,context);
  await clickReader(reader,0);let field=reader.locator('#smartTextValue');await field.waitFor();
  assert.equal(await field.evaluate(input=>input.readOnly),true);
  await field.evaluate(input=>{input.value='tampered';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await field.press('Tab');field=reader.getByRole('textbox',{name:'B1',exact:true});await field.waitFor();
  assert.equal(await field.evaluate(input=>input.readOnly),false);
  await field.fill('Reader value');await field.press('Tab');
  const number=reader.locator('#smartNumberValue');await number.waitFor();
  assert.equal(await number.evaluate(input=>input.readOnly),true);await number.press('Enter');await number.waitFor({state:'detached'});
  await reader.waitForFunction(()=>document.querySelector('[data-smart-index="0"]').textContent.includes('Calls:1 Value:Reader value'));
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('opening multiline saved text in a single-line edit field does not normalize it into state',async()=>app(async({page,run,context})=>{
  const value='First line\nSecond line\r\nThird line';
  await seed(run,item(inlineScript,{state:{calls:0,value}}));const history=await run('undoStack.length');
  await clickEditor(page,run,'B1');let field=page.locator('#smartTextValue');await field.waitFor();
  assert.equal(await field.inputValue(),'First lineSecond lineThird line','native inputs normalize newlines for display');
  await field.press('Enter');await field.waitFor({state:'detached'});
  assert.deepEqual(await run('items[0].state'),{calls:0,value});
  await clickEditor(page,run,'B1');await page.locator('#smartTextValue').press('Tab');
  await page.locator('#smartNumberValue').waitFor();await page.locator('#smartNumberValue').press('Escape');
  assert.deepEqual(await run('items[0].state'),{calls:0,value});assert.equal(await run('undoStack.length'),history);
  const {reader,errors,requests}=await openReader(page,run,context);
  await clickReader(reader,1);field=reader.locator('#smartTextValue');await field.waitFor();await field.press('Tab');
  await reader.locator('#smartNumberValue').waitFor();await reader.locator('#smartNumberValue').press('Escape');
  const rendered=await reader.locator('[data-smart-index="0"]').textContent();
  assert.match(rendered,/Calls:0/,'reader navigation also skips the state-writing hook');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));

test('complete table presentation reaches Workers and the offline renderer',async()=>app(async({page,run,context})=>{
  const script=`({apiVersion:2,tablePresentation:'full',inputs:{data:{type:'table'}},outputs:{data:{type:'table'},count:{type:'number'}},
    compute(inputs,state,context){return {data:inputs.data,count:context.tables.data.rowCount};},
    children(state,style,w,h,editing,io){const t=io.tables.inputs.data;return [{type:'text',x:0,y:0,w,h,
      text:t.rows.length+' rows; last: '+t.rows.at(-1)[0]+'; output preview: '+io.tables.outputs.data.rows.length,strokeOn:false}];}})`;
  const tail='Final '+ 'x'.repeat(200),pool={data:{name:'Complete table',columns:[{key:'value',type:'string'}],rows:[...Array.from({length:29},(_,i)=>['Row '+i]),[tail]]}};
  await seed(run,item(script,{inputValues:{data:{datasetId:'data'}}}),pool);
  const texts=await run(`(async()=>{const it=items[0],io=await resolveSmartComponentIo(it);return (await requestSmartCall(it,'children',[it.state,smartResolvedStyle(it),it.w,it.h,false,io])).map(k=>k.text);})()`);
  assert.deepEqual(texts,['30 rows; last: '+tail+'; output preview: 24']);
  const {reader,errors,requests}=await openReader(page,run,context);
  const rendered=await reader.locator('[data-smart-index="0"]').textContent();
  assert.equal(rendered.replace(/\s+/g,''),texts[0].replace(/\s+/g,''),'wrapped SVG text keeps every complete dataset value');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}));
