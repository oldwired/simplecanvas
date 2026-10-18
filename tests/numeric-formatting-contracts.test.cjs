const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const source=name=>vm.runInNewContext(fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8'),{}, {filename:name+'.js',timeout:1000});
const defaults=(def,state)=>Object.fromEntries(Object.entries(typeof def.inputs==='function'?def.inputs(state):def.inputs||{}).filter(([,port])=>Object.hasOwn(port,'default')).map(([key,port])=>[key,port.default]));
function draw(def,state,inputs,outputs,extra={}){
  const style={font:'400 18px sans-serif',color:'#64748b',textColor:'#334155',...def.initStyle()},io={name:'Precision',inputs,outputs,...extra};
  const before=JSON.stringify({state,inputs,outputs,extra});
  const children=def.children(state,style,style.w,style.h,false,io);
  assert.equal(JSON.stringify({state,inputs,outputs,extra}),before,'drawing must not rewrite the signal, state, or dataset');
  return children.filter(child=>child.type==='text').map(child=>child.text);
}
const artifact=(2.8*2/10)*100;

test('portable component formatters consistently use eight significant digits, exact integers and unavailable markers',()=>{
  const cases=[[.1+.2,'0.3'],[artifact,'56'],[1/3,'0.33333333'],[123.456789012,'123.45679'],[-123.456789012,'-123.45679'],[Number.MAX_SAFE_INTEGER,'9007199254740991'],[1e-100,'1e-100'],[Number.MIN_VALUE,'5e-324'],[Number.MAX_VALUE,'1.7976931e+308'],[-0,'0'],[NaN,'—'],[Infinity,'—'],[undefined,'—']];
  const names=fs.readdirSync(path.join(root,'examples')).filter(name=>name.endsWith('.js'));
  let checked=0;
  for(const name of names){
    const def=source(name.slice(0,-3));if(typeof def._number!=='function')continue;checked++;
    for(const [value,expected] of cases)assert.equal(def._number(value),expected,name+' formats '+value);
  }
  assert.ok(checked>=20,'portable numeric controls and table consumers are covered');
});

test('the numeric tools chain formats 56 percent while its computations keep the exact floating-point result',()=>{
  assert.equal(artifact,55.99999999999999);
  const math=source('math'),map=source('range-map'),gauge=source('gauge');
  const multiplied=math.compute({a:2.8,b:2,operation:'×'},math.initState()).value;
  const inputs={...defaults(map,map.initState()),value:multiplied,inMax:10,outMax:100};
  const mapped=map.compute(inputs,map.initState()),percentage=gauge.compute({value:mapped.value},gauge.initState());
  assert.equal(multiplied,5.6);assert.equal(mapped.value,artifact);assert.equal(percentage.percentage,artifact);
  assert.ok(draw(map,map.initState(),inputs,mapped).includes('56'));
  assert.ok(draw(gauge,gauge.initState(),{value:mapped.value},percentage).includes('56%'));
});

test('numeric sources, operators, selectors and stored numeric signals share display rounding only',()=>{
  const value=.1+.2,expected='0.3';
  const cases=[
    ['constant',{value},{}],['value-label',{}, {value}],['number-inverter',{}, {value}],
    ['math',{}, {a:.1,b:.2,operation:'+'}],['compare',{}, {value,b:.3,operation:'='}],
    ['clamp',{}, {value}],['number-function',{}, {value,operation:'abs'}],
    ['selector-number',{}, {a:value,b:0,select:false}],
    ['stepped-selector-number',{}, {in0:value}],['stepped-distributor-number',{}, {value}],
    ['register-number',{value},{value}],
    ['shift-register-number',{cells:[value,value,value,value],shiftedOut:value},{value}],
    ['number-input',{values:[value],min:0,max:1,step:.1},{}]
  ];
  for(const [name,patch,inputPatch] of cases){
    const def=source(name),state={...def.initState(),...patch},inputs={...defaults(def,state),...inputPatch};
    const before=JSON.stringify({state,inputs}),outputs=def.compute(inputs,state),labels=draw(def,state,inputs,outputs);
    assert.ok(labels.some(label=>label.includes(expected)),name+' displays the rounded value');
    assert.ok(labels.every(label=>!label.includes(String(value))),name+' does not display binary precision noise');
    assert.equal(JSON.stringify({state,inputs}),before,name+' keeps authored values');
    if(name==='compare')assert.equal(outputs.value,false,'comparison uses actual values, not matching rounded labels');
    else assert.ok(Object.values(outputs).some(output=>output===value||output===-value),name+' preserves exact values in outputs');
  }
});

test('number display keeps safe integers exact and does not turn tiny or huge finite numbers into zero or infinity',()=>{
  const def=source('value-label'),state=def.initState();
  for(const value of [Number.MAX_SAFE_INTEGER,Number.MIN_SAFE_INTEGER,123456789012345]){
    assert.ok(draw(def,state,{value},{value}).includes(String(value)),'safe integer '+value+' stays exact');
  }
  for(const value of [Number.MIN_VALUE,-Number.MIN_VALUE,1e-100,-1e-100,Number.MAX_VALUE,-Number.MAX_VALUE]){
    const labels=draw(def,state,{value},{value}),label=labels[1];
    assert.equal(typeof label,'string');assert.notEqual(Number(label),0,'nonzero '+value+' stays visible');
    assert.ok(Number.isFinite(Number(label)),'finite '+value+' has a finite representation');
    assert.equal(Math.sign(Number(label)),Math.sign(value));
    assert.equal(def.compute({value},state).value,value,'display range does not restrict signal range');
  }
  assert.ok(draw(def,state,{value:-0},{value:-0}).includes('0'),'negative zero is a display zero');
});

const dataset={name:'Exact numbers',datasetId:'precision',revision:3,editable:true,owner:{uid:'source',input:'data'},columns:[{key:'number',name:'Number',type:'number'},{key:'text',name:'Text',type:'string'}],rows:[[artifact,String(artifact)]],rowIndices:[0],rowIds:['r0'],rowCount:1};

test('Dataset editor and charts format numeric cells while retaining literal strings and raw edit values',()=>{
  const table=source('data-table'),state={...table.initState(),editDataset:true},inputs={data:{datasetId:'precision'},startRow:0,startColumn:0},outputs={rowCount:1};
  const labels=draw(table,state,inputs,outputs,{tables:{inputs:{data:dataset}}});
  assert.ok(labels.includes('56'));assert.ok(labels.includes(String(artifact)),'a numeric-looking string is not reformatted');
  const style=table.initStyle(),handles=table.handles(state,style.w,style.h,style,{inputs,outputs,tables:{inputs:{data:dataset}}});
  assert.equal(handles.find(handle=>handle.id==='cell-0-0').value,String(artifact),'editing exposes every stored digit');
  assert.equal(handles.find(handle=>handle.id==='cell-0-1').value,String(artifact));
  const chart=source('data-bar-chart'),chartInputs={data:inputs.data,category:'text',value:'number'};
  assert.ok(draw(chart,chart.initState(),chartInputs,{rowCount:1},{tables:{inputs:{data:dataset}}}).includes('56'));
  assert.equal(dataset.rows[0][0],artifact);
});

test('Spreadsheet general cells format values without changing authored cells, formulas, outputs, or explicit formats',()=>{
  const def=source('spreadsheet'),state={...def.initState(),cols:4,rows:3,
    cells:{D1:'=OUTPUT(A1:B1,"table","number:number,text:string")',A1:String(artifact),B1:"'"+String(artifact),A2:'=OUTPUT((2.8*2/10)*100,"result")',B2:'=A1>55.99999999999998',A3:'0.125'},formats:{A3:'0.00%'}};
  const before=JSON.stringify(state),outputs=def.compute({},state),labels=draw(def,state,{},outputs);
  assert.equal(outputs.result,artifact);assert.equal(outputs.table.table.rows[0][0],artifact);assert.equal(outputs.table.table.rows[0][1],String(artifact));
  assert.equal(def._sheet(state,{}).B2.b,true);
  assert.ok(labels.includes('56'));assert.ok(labels.includes(String(artifact)));assert.ok(labels.includes('12.50%'));
  const style=def.initStyle(),handles=def.handles(state,style.w,style.h,style,{});
  assert.equal(handles.find(handle=>handle.id==='A1').value,String(artifact));
  assert.equal(handles.find(handle=>handle.id==='A2').value,state.cells.A2);
  assert.equal(JSON.stringify(state),before);
});

test('Spreadsheet linked cells show rounded numbers but expose exact literal edits and copied values',()=>{
  const def=source('spreadsheet'),state={...def.initState(),source:'Dataset',dataColumns:2,dataRows:1,editDataset:true,allowReaderEdit:true},inputs={data:{datasetId:'precision'},startRow:0};
  const io={inputs,outputs:{},tables:{inputs:{data:dataset}}},style=def.initStyle();
  const labels=draw(def,state,inputs,{}, {tables:io.tables});assert.ok(labels.includes('56'));assert.ok(labels.includes(String(artifact)));
  const handles=def.handles(state,style.w,style.h,style,io),number=handles.find(handle=>handle.id==='A2');
  assert.equal(number.value,String(artifact));assert.equal(number.datasetCell.column,'number');
  assert.equal(def._literal(dataset.rows[0][0]),String(artifact));
  assert.equal(def._literal(dataset.rows[0][1]),"'"+String(artifact));
});

test('paused signal traces format numeric summaries without modifying stored outputs or literal text',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const declaration=name=>{const start=html.indexOf('  function '+name+'(');assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n  function ',start+3));};
  const status=vm.runInNewContext(['formatComponentNumber','componentTimelineNow','componentSimulationStatus'].map(declaration).join('\n')+'\ncomponentSimulationStatus');
  const outputs={value:artifact,text:String(artifact),count:Number.MAX_SAFE_INTEGER,ready:true,tiny:Number.MIN_VALUE};
  const timeline={elapsed:1250,active:false,pausedByUser:true,pendingTime:1250,rounds:2,trace:[{changes:[{name:'Trace',outputs}]}]},before=JSON.stringify(timeline);
  assert.equal(status(timeline),'1.250 s · round 2 · Trace: value=56, text=55.99999999999999, count=9007199254740991, ready=true, tiny=5e-324');
  assert.equal(JSON.stringify(timeline),before,'status display never changes the retained simulation trace');
  assert.equal(outputs.value,artifact);assert.equal(outputs.text,String(artifact));
  timeline.pendingTime=null;assert.match(status(timeline),/1\.250 s · settled · Trace: value=56/);
});

test('the original Chart template, built-in and demo library share decimal labels and retain stored values',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),marker='const BARCHART_EXAMPLE_SCRIPT = ';
  const start=html.indexOf(marker)+marker.length,end=html.indexOf('\n})`;',start)+5;
  const script=vm.runInNewContext(html.slice(start,end));
  const catalogStart=html.indexOf('const BUILTIN_LIBRARY_DEFINITIONS = '),arrayStart=html.indexOf('[',catalogStart);
  const catalog=JSON.parse(html.slice(arrayStart,html.indexOf('\n];',arrayStart)+2));
  const demo=JSON.parse(fs.readFileSync(path.join(root,'examples','demo-shapes-library.json'),'utf8'));
  assert.equal(catalog.find(entry=>entry.key==='chart').items[0].script.trim(),script.trim());
  assert.equal(demo.shapes.find(entry=>entry.id==='builtin:chart:1').items[0].script.trim(),script.trim());
  const def=vm.runInNewContext(script),state={values:[.1+.2,1.25,artifact]},before=JSON.stringify(state),style={...def.initStyle(),font:'400 12px sans-serif'};
  const labels=def.children(state,style,240,160,false).filter(child=>child.type==='text').map(child=>child.text);
  assert.deepEqual(Array.from(labels),['0.3','1.25','56']);assert.equal(JSON.stringify(state),before);
});
