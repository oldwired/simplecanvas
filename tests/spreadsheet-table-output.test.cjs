const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
const source=()=>vm.runInNewContext(script),plain=value=>JSON.parse(JSON.stringify(value));
// Table outputs are declared by a formula: =OUTPUT(range,"port"[,"type,..."]). The range's first row
// names the columns as shown; names and inferred types are read when the sheet computes.
const HEAD={A1:'energy',B1:'price',C1:'cost'};
const RESULTS='=OUTPUT(A1:C4,"Results","number,number,number")';
const sheet=(cells={},more={})=>({cols:6,rows:6,cells:{...HEAD,F1:RESULTS,...cells},...more});
const table=(def,state,inputs={},context={},port='Results')=>plain(def.compute(inputs,state,context)[port].table);

test('table output is optional and given types publish blank cells as nulls',()=>{
  const def=source(),state=def.initState();assert.ok(script.length<=64000);
  assert.deepEqual(plain(def.outputs(state)),{});
  const enabled={...state,cells:{A1:'label',B1:'amount',D1:'=OUTPUT(A1:B3,"Spreadsheet results","string,number")'}};
  assert.deepEqual(plain(def.outputs(enabled)),{Spreadsheet_results:{type:'table'}});
  assert.deepEqual(table(def,enabled,{},{},'Spreadsheet_results'),{name:'Spreadsheet results',columns:[{key:'label',name:'label',type:'string'},{key:'amount',name:'amount',type:'number'}],rows:[[null,null],[null,null]]});
});

test('the first row names the columns as shown and the column types follow the values',()=>{
  const def=source(),state={cols:6,rows:6,cells:{A1:'Hall',B1:'kWh',C1:'="Cost "&"EUR"',A2:'Hall 1',B2:'120',C2:'=B2*0.3',A3:'Hall 2',B3:'80',C3:'=B3*0.3',
    E1:'=OUTPUT(A1:C3,"Energy costs")',E2:'=OUTPUT(A1:B3,"Usage")'}};
  assert.deepEqual(plain(def.outputs(state)),{Energy_costs:{type:'table'},Usage:{type:'table'}},'each range is its own named port');
  assert.deepEqual(table(def,state,{},{},'Energy_costs'),{name:'Energy costs',columns:[{key:'Hall',name:'Hall',type:'string'},
    {key:'kWh',name:'kWh',type:'number'},{key:'Cost EUR',name:'Cost EUR',type:'number'}],rows:[['Hall 1',120,36],['Hall 2',80,24]]},'a formula may name a column');
  assert.throws(()=>def.compute({},{...state,cells:{...state.cells,A3:'5'}}),/E1: column Hall mixes types/);
  // an empty column has no type to follow: the third argument supplies it
  const empty={cols:6,rows:6,cells:{A1:'Hall',B1:'Note',A2:'Hall 1',E1:'=OUTPUT(A1:B2,"Notes")'}};
  assert.throws(()=>def.compute({},empty),/column Note has no values/);
  assert.deepEqual(table(def,{...empty,cells:{...empty.cells,E1:'=OUTPUT(A1:B2,"Notes","string,string")'}},{},{},'Notes').rows,[['Hall 1',null]]);
  assert.throws(()=>def.compute({},{...state,cells:{...state.cells,B1:'Hall'}}),/B1 needs a unique column name/);
});

test('a dataset header keeps its column keys and names, and DATA/COLUMN accept the shown name or the key',()=>{
  const def=source(),agg={name:'Scores',columns:[{key:'group',name:'Class',type:'string'},{key:'result',name:'Sum of points',type:'number'}],rows:[['ORC',37],['IRC',22]]};
  const state={cols:6,rows:6,cells:{D1:'=INPUT("agg",A1:B3)',D2:'=OUTPUT(A1:B3,"Copy")',D3:'=DATA("agg",0,"Sum of points")',D4:'=DATA("agg",1,"result")',D5:'=SUM(COLUMN("agg","Sum of points"))'}};
  assert.deepEqual(table(def,state,{},{tables:{agg}},'Copy'),{name:'Copy',columns:[{key:'group',name:'Class',type:'string'},{key:'result',name:'Sum of points',type:'number'}],rows:[['ORC',37],['IRC',22]]});
  const cells=def._sheet(state,{},{agg});
  assert.deepEqual([cells.D3.v,cells.D4.v,cells.D5.v],[37,22,59]);
});

test('the range follows inserted and deleted columns and rows like any reference',()=>{
  const def=source(),state={cols:6,rows:6,cells:{A1:'Hall',B1:'kWh',A2:'Hall 1',B2:'120',A3:'Hall 2',B3:'80',D1:'=OUTPUT(A1:B3,"Usage")'}};
  const moved=def.dragEdit(state,'cins0',0,0,552,168).state;
  assert.equal(moved.cells.E1,'=OUTPUT(B1:C3,"Usage")');
  assert.deepEqual(table(def,moved,{},{},'Usage').rows,[['Hall 1',120],['Hall 2',80]]);
  const shorter=def.dragEdit(state,'rdel2',0,0,552,168).state;
  assert.deepEqual(table(def,shorter,{},{},'Usage').rows,[['Hall 1',120]]);
});

test('result cells emit exact evaluated scalars and nulls without formula or formatting metadata',()=>{
  const def=source(),state=sheet({F1:'=OUTPUT(B2:D4," Report ","string,number,boolean")',B2:'message',C2:'amount',D2:'ready',
    B3:"'=SUM(A1:A2)",C3:'=INPUT("amount")*2',D3:'=INPUT("ready","boolean")',B4:"'",D4:'FALSE',A5:'=1/0'},
    {formats:{C3:'0.00'},aligns:{B3:'right'}}),before=JSON.stringify(state);
  assert.deepEqual(table(def,state,{amount:1.2345,ready:true},{},'Report'),{name:'Report',columns:[{key:'message',name:'message',type:'string'},{key:'amount',name:'amount',type:'number'},{key:'ready',name:'ready',type:'boolean'}],rows:[['=SUM(A1:A2)',2.469,true],['',null,false]]});
  assert.equal(JSON.stringify(state),before,'publishing never rewrites authored cells or layout');
});

test('result schema problems are reported by compute with the formula cell',()=>{
  const def=source();
  for(const formula of ['=OUTPUT(A1:C4,"")','=OUTPUT(A1:C4,"'+'x'.repeat(121)+'")','=OUTPUT(A1:C4,"r","number")',
    '=OUTPUT(A1:C4,"r","date,number,number")','=OUTPUT(A1:C1,"r")'])
    assert.throws(()=>def.compute({},sheet({F1:formula})),/Table output in F1/,formula);
  assert.deepEqual(table(def,sheet({F1:'=OUTPUT(B2:B3,"Results")',B2:'value',B3:'7'})).rows,[[7]]);
});

test('an output name may be used once, and at most 32 outputs exist',()=>{
  const def=source();
  assert.throws(()=>def.compute({},sheet({E1:'=OUTPUT(4,"Results")'})),/Output Results/);
  assert.throws(()=>def.compute({},sheet({E1:'=OUTPUT(A1:C4,"Results","number,number,number")'})),/declared twice/);
  const cells=Object.fromEntries(Array.from({length:32},(_,i)=>[String.fromCharCode(65+i%6)+(2+Math.floor(i/6)),'=OUTPUT('+i+',"out'+i+'")']));
  assert.throws(()=>def.outputs({cols:6,rows:7,cells:{...cells,F7:'=OUTPUT(A1:B2,"t","number,number")'}}),/at most 32 inputs and 32 outputs/);
});

test('formula errors or mismatching value types reject the complete table with a cell address',()=>{
  const def=source(),state=sheet({A2:'1',B2:'2',C2:'=A2+B2',A3:'=1/0'});
  assert.throws(()=>def.compute({},state),/Table output in A3: #DIV\/0!/);
  for(const value of ["'3",'TRUE'])assert.throws(()=>def.compute({},sheet({...state.cells,A3:value})),/Table output in A3: expected number/);
  assert.throws(()=>def.compute({},sheet({...state.cells,A3:'=A3'})),/Table output in A3: #CYCLE!/);
  assert.throws(()=>def.compute({},sheet({...state.cells,A3:'=Z99'})),/Table output in A3: #REF!/);
  assert.deepEqual(table(def,sheet({...state.cells,A3:'=IFERROR(1/0,9)'})).rows,[[1,2,3],[9,null,null],[null,null,null]]);
});

test('table results enforce dataset value and storage limits before crossing the Worker bridge',()=>{
  const def=source(),state={cols:6,rows:6,cells:{A1:'value',A2:'=INPUT("value")',F1:'=OUTPUT(A1:A2,"Results","number")'}};
  for(const value of [Number.MAX_SAFE_INTEGER+1,1e308])assert.throws(()=>def.compute({value},state),/Table output in A2/);
  assert.equal(table(def,state,{value:.125}).rows[0][0],.125);
  const text={cols:6,rows:6,cells:{A1:'text',A2:'=INPUT("message","string")',F1:'=OUTPUT(A1:A2,"Results","string")'}};
  assert.equal(table(def,text,{message:'x'.repeat(2000)}).rows[0][0].length,2000);
  assert.throws(()=>def.compute({message:'x'.repeat(2001)},text),/dataset limits/);
  const cells=Object.fromEntries(Array.from({length:89},(_,r)=>['A'+(r+2),'=INPUT("message","string")']));
  assert.throws(()=>def.compute({message:'\u0000'.repeat(2000)},{cols:2,rows:90,cells:{...cells,A1:'text',B1:'=OUTPUT(A1:A90,"Results","string")'}}),/storage limit/);
});

test('a linked dataset range follows selected row order and the current page without changing the source',()=>{
  const def=source(),data={name:'Selected',columns:[{key:'name',name:'Name',type:'string'},{key:'value',name:'Value',type:'number'}],rows:[['B',20],['A',10]],rowIndices:[1,0],rowCount:2};
  const state={cols:6,rows:6,cells:{E1:'=INPUT("data",A1:B3,INPUT("startRow"))',C1:'doubled',C2:'=B2*2',C3:'=B3*2',F1:'=OUTPUT(A1:C3,"Results","string,number,number")'}},before=JSON.stringify(data);
  assert.deepEqual(plain(def.inputs(state)),{data:{type:'table'},startRow:{type:'number',default:0}});
  assert.deepEqual(table(def,state,{startRow:0},{tables:{data}}),{name:'Results',columns:[{key:'name',name:'Name',type:'string'},{key:'value',name:'Value',type:'number'},{key:'doubled',name:'doubled',type:'number'}],rows:[['B',20,40],['A',10,20]]});
  assert.deepEqual(table(def,state,{startRow:1},{tables:{data}}).rows,[['A',10,20],[null,null,0]]);
  assert.equal(JSON.stringify(data),before);assert.equal(state.cells.C2,'=B2*2');
});

test('type codes 0 automatic, 1 number, 2 string, 3 boolean work wherever a type is given',()=>{
  const def=source(),state={cols:6,rows:6,cells:{A1:'=INPUT("a",2)',A2:'=INPUT("b",3)',A3:'=INPUT("c",0)',A4:'=INPUT("d","boolean")',
    B1:'=OUTPUT(5,"o1",0)',B2:'=OUTPUT("x","o2",2)',B3:'=OUTPUT(1,"o3",1)',B4:'=DATA("t",0,"Note",2)'}};
  assert.deepEqual(plain(def.inputs(state)),{a:{type:'string',default:''},b:{type:'boolean',default:false},c:{type:'number',default:0},d:{type:'boolean',default:false},t:{type:'table'}});
  assert.deepEqual(plain(def.outputs(state)),{o1:{type:'number'},o2:{type:'string'},o3:{type:'number'}});
  const t={cols:6,rows:6,cells:{A1:'Hall',B1:'Note',C1:'n',A2:'H1',C2:'3',E1:'=OUTPUT(A1:C2,"t",2,2)'}};
  assert.deepEqual(table(def,t,{},{},'t').columns.map(c=>c.type),['string','string','number'],'missing codes are automatic');
  assert.throws(()=>def.compute({},{...t,cells:{...t.cells,E1:'=OUTPUT(A1:C2,"t",4)'}}),/types are 0 \(automatic\), 1 \(number\), 2 \(string\) or 3 \(boolean\)/);
  assert.throws(()=>def.compute({},{...t,cells:{...t.cells,E1:'=OUTPUT(A1:C2,"t",2,2,2,2)'}}),/E1/);
});
