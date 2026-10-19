const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const plain=value=>JSON.parse(JSON.stringify(value));
const source=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'));
const sheet=(cells,cols=6,rows=6)=>({cols,rows,cells});

test('new spreadsheets start with an empty editable grid and no formula ports',()=>{
  const def=source('spreadsheet'),state=def.initState();
  assert.deepEqual(plain(state.cells),{});assert.equal(state.source,undefined);
  assert.deepEqual(plain(def.inputs(state)),{});assert.deepEqual(plain(def.outputs(state)),{});
  assert.deepEqual(plain(def.compute({},state)),{});assert.deepEqual(plain(def._sheet(state,{})),{});
  assert.ok(def.handles(state,552,168,def.initStyle()).filter(h=>h.kind==='text').every(h=>h.value===''));
  const linked=def.dragEdit(state,'D1','=INPUT("data",A1:C3,INPUT("startRow"),0)',0,552,168).state;
  assert.deepEqual(plain(def.inputs(linked)),{data:{type:'table'},startRow:{type:'number',default:0}},'an empty grid can bind data without deleting sample formulas');
});

test('table input formulas preserve authored cells and report ambiguous outputs until repaired',()=>{
  const def=source('spreadsheet'),previous={...def.initState(),cells:{D1:'=OUTPUT(A2,"result")'}},before=JSON.stringify(previous);
  assert.deepEqual(plain(def.outputs(previous)),{result:{type:'number'}});
  const linked=def.dragEdit(previous,'C1','=INPUT("data",A1:B4,0,0)',0,552,168).state;
  assert.throws(()=>def.outputs(linked),/ambiguous/);
  assert.equal(JSON.stringify(previous),before,'editing a declaration never discards existing formulas');
  assert.equal(linked.cells.D1,previous.cells.D1);
  const repaired=def.dragEdit(linked,'D1','=OUTPUT(A2,"result","number")',0,552,168).state;
  assert.equal(repaired.cells.C1,linked.cells.C1);
  assert.deepEqual(plain(def.outputs(repaired)),{result:{type:'number'}});
});

test('spreadsheet publishes each OUTPUT argument independently of its containing expression',()=>{
  const def=source('spreadsheet'),state=sheet({
    A1:'=OUTPUT(1,"one")+OUTPUT(2,"two")',
    A2:'=OUTPUT("Ready","label")&OUTPUT(TRUE,"ready")',
    A3:'=OUTPUT(OUTPUT(5,"inner")*2,"outer")',
    A4:'=IF(FALSE,OUTPUT(7,"declared"),99)',
    A5:'=OUTPUT(A1,"cell total")'
  });
  assert.deepEqual(plain(def.compute({},state)),{one:1,two:2,label:'Ready',ready:true,inner:5,outer:10,declared:7,cell_total:3});
  assert.equal(def._sheet(state,{}).A1.v,3);
  assert.equal(def.outputs(state).label.type,'string');
  assert.equal(def.outputs(state).ready.type,'boolean');
});

test('OUTPUT argument errors are reported with the port and originating cell',()=>{
  const def=source('spreadsheet');
  assert.throws(()=>def.compute({},sheet({A1:'=1+OUTPUT(1/0,"broken")'})),/Output broken in A1: #DIV\/0!/);
  assert.throws(()=>def.compute({},sheet({A1:'=OUTPUT(1e308*2,"huge")'})),/Output huge in A1: #NUM!/);
  assert.equal(def.compute({},sheet({A1:'=OUTPUT(4,"safe")+1/0'})).safe,4,'unrelated cell error does not replace a published argument');
});

test('deleted and out-of-bounds references are lazy errors that IF and IFERROR can catch',()=>{
  const def=source('spreadsheet');
  const state=def._restructure(sheet({A1:'8',B1:'=IFERROR(A1,0)',C1:'=IF(TRUE,3,A1)',D1:'=IF(FALSE,A1,4)',E1:'=ISERROR(A1)'},5,2),'c',0,-1);
  assert.equal(state.cells.A1,'=IFERROR(#REF!,0)');
  assert.deepEqual(plain(def._sheet(state,{})),{A1:{v:0},B1:{v:3},C1:{v:4},D1:{b:true}});
  const recovery=sheet({A1:'=OUTPUT(IFERROR(#REF!,"Recovered"),"result")',A2:'=IFERROR(Z99,7)',A3:'=IFERROR(SUM(Z1:Z2),8)',A4:'=#REF!'});
  assert.deepEqual(plain(def.compute({},recovery)),{result:'Recovered'});
  assert.equal(def.outputs(recovery).result.type,'string');
  assert.equal(def._sheet(recovery,{}).A2.v,7);
  assert.equal(def._sheet(recovery,{}).A3.v,8);
  assert.equal(def._sheet(recovery,{}).A4.e,'#REF!');
});

test('COUNT treats individual blank references like blank cells in ranges',()=>{
  const def=source('spreadsheet'),state=sheet({A2:'5',A3:'TRUE',A4:'text',A5:'=""',A6:'=1/0',
    B1:'=COUNT(A1,A2,A3,A4,A5,A6)',B2:'=COUNT(A1:A6)',B3:'=COUNT(A1+0,0)',B4:'=COUNTA(A1:A6)',B5:'=COUNTA(A1,A2,A3,A4,A5,A6)'});
  const values=def._sheet(state,{});
  assert.equal(values.B1.v,1);assert.equal(values.B2.v,1);assert.equal(values.B3.v,2);
  assert.equal(values.B4.v,5);assert.equal(values.B5.v,5);
});

test('VLOOKUP output typing resolves arithmetic and saved-cell column expressions',()=>{
  const def=source('spreadsheet'),state=sheet({A1:'alpha',A2:'beta',B1:'Alpha',B2:'Beta',C1:'TRUE',C2:'FALSE',
    D1:'1',D2:'=D1+1',E1:'=OUTPUT(VLOOKUP("beta",A1:C2,1+1,FALSE),"label")',
    E2:'=OUTPUT(VLOOKUP("alpha",A1:C2,D2,FALSE),"cell_index")',
    E3:'=OUTPUT(VLOOKUP("alpha",A1:C2,ROUND(D2+1,0),FALSE),"flag")'});
  assert.deepEqual(plain(def.outputs(state)),{label:{type:'string'},cell_index:{type:'string'},flag:{type:'boolean'}});
  assert.deepEqual(plain(def.compute({},state)),{label:'Beta',cell_index:'Alpha',flag:true});
  state.cells.D1='2';
  assert.equal(def.outputs(state).cell_index.type,'boolean','typing is fresh after a saved-state edit');
});

test('indeterminate lookup columns accept uniform types and reject mixed types explicitly',()=>{
  const def=source('spreadsheet'),uniform=sheet({A1:'1',A2:'2',B1:'10',B2:'20',
    C1:'=OUTPUT(VLOOKUP(2,A1:B2,INPUT("column"),FALSE),"value")'});
  assert.equal(def.outputs(uniform).value.type,'number');
  assert.equal(def.compute({column:2},uniform).value,20);
  const mixed=sheet({...uniform.cells,B1:'ten',B2:'twenty'});
  assert.throws(()=>def.outputs(mixed),/Output value in C1: result type is ambiguous/);
  assert.throws(()=>def.compute({column:2},mixed),/result type is ambiguous/);
  assert.throws(()=>def.outputs(sheet({A1:'one',A2:'two',B1:'text',B2:'1',C1:'=OUTPUT(VLOOKUP("one",A1:B2,2,FALSE),"mixed")'})),/ambiguous/);
});

test('branch type declarations follow saved conditions and reject live mixed-type results',()=>{
  const def=source('spreadsheet');
  assert.deepEqual(plain(def.outputs(sheet({A1:'=OUTPUT(IF(TRUE,"yes",1),"known")'}))),{known:{type:'string'}});
  assert.throws(()=>def.outputs(sheet({A1:'=OUTPUT(IF(INPUT("run","boolean"),"yes",1),"unknown")'})),/ambiguous/);
  assert.equal(def.outputs(sheet({A1:'=OUTPUT(IF(INPUT("run","boolean"),"yes",#REF!),"known")'})).known.type,'string');
  assert.equal(def.outputs(sheet({A1:'=OUTPUT(IFERROR(1/0,FALSE),"recovered")'})).recovered.type,'boolean');
});

test('lookup-chain analysis parses each formula once and memoizes repeated cell types',()=>{
  const def=source('spreadsheet'),cells={A1:'key',B1:'value'};
  for(let r=2;r<=35;r++){cells['A'+r]='key';cells['B'+r]='=VLOOKUP("key",A1:B'+(r-1)+',2,FALSE)';}
  cells.C35='=OUTPUT(B35,"result")';
  const state=sheet(cells,3,35),parse=def._parse,type=def._typeOf;let parses=0,types=0;
  def._parse=function(...args){parses++;return parse.apply(this,args);};
  def._typeOf=function(...args){types++;return type.apply(this,args);};
  assert.equal(def.outputs(state).result.type,'string');
  assert.equal(parses,35,'one parse per saved formula, including reused dependencies');
  assert.ok(types<2000,'type inference remains bounded across the shared dependency chain: '+types);
  assert.equal(def.compute({},state).result,'value');
});

test('formula cycles stay bounded and report the cycle through the output',()=>{
  const def=source('spreadsheet'),state=sheet({A1:'=B1',B1:'=A1',C1:'=OUTPUT(A1,"loop")'});
  assert.doesNotThrow(()=>def.outputs(state));
  assert.throws(()=>def.compute({},state),/Output loop in C1: #CYCLE!/);
  assert.equal(def._sheet(state,{}).A1.e,'#CYCLE!');
});

test('spreadsheet cell editing uses the shared inline edit contract with optional cell capabilities',()=>{
  const def=source('spreadsheet'),state={...def.initState(),aligns:{A1:'right'}};
  const handles=def.handles(state,552,168,def.initStyle()),cell=handles.find(h=>h.id==='A1');
  assert.equal(cell.inline.mode,'edit');assert.equal(cell.inline.navigation,'horizontal');assert.equal(cell.inline.references,true);
  assert.equal(cell.inline.align,'right');assert.equal(cell.inline.fontSize,16);assert.equal(cell.ref,'A1');assert.equal(cell.label,'Cell A1');
  for(const handle of handles)for(const old of ['rect','fontSize','align'])assert.equal(old in handle,false);
});

test('countdown title uses shared edit mode without spreadsheet navigation or references',()=>{
  const def=source('countdown-timer'),title=def.handles(def.initState(),240,340,def.initStyle()).find(h=>h.id==='title');
  assert.equal(title.inline.mode,'edit');assert.equal(title.inline.align,'center');
  assert.equal(title.inline.navigation,undefined);assert.equal(title.inline.references,undefined);
  for(const old of ['rect','fontSize','align'])assert.equal(old in title,false);
});
