const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
const source=()=>vm.runInNewContext(script),plain=value=>JSON.parse(JSON.stringify(value));
// Table outputs are declared by a formula: =OUTPUT(range,"port"[,"types" | "name:type,..."]).
const RESULTS='=OUTPUT(A2:C4,"Results","energy:number,price:number,cost:number")';
const sheet=(cells={},more={})=>({cols:6,rows:6,cells:{F1:RESULTS,...cells},...more});
const table=(def,state,inputs={},context={},port='Results')=>plain(def.compute(inputs,state,context)[port].table);

test('table output is optional and an explicit schema publishes blank cells as nulls',()=>{
  const def=source(),state=def.initState();assert.ok(script.length<=64000);
  assert.deepEqual(plain(def.outputs(state)),{});
  const enabled={...state,cells:{D1:'=OUTPUT(A1:B2,"Spreadsheet results","label:string,amount:number")'}};
  assert.deepEqual(plain(def.outputs(enabled)),{Spreadsheet_results:{type:'table'}});
  assert.deepEqual(table(def,enabled,{},{},'Spreadsheet_results'),{name:'Spreadsheet results',columns:[{key:'label',name:'label',type:'string'},{key:'amount',name:'amount',type:'number'}],rows:[[null,null],[null,null]]});
});

test('the first row names the columns and the column types follow the cells',()=>{
  const def=source(),state={cols:6,rows:6,cells:{A1:'Hall',B1:'kWh',C1:'Cost',A2:'Hall 1',B2:'120',C2:'=B2*0.3',A3:'Hall 2',B3:'80',C3:'=B3*0.3',
    E1:'=OUTPUT(A1:C3,"Energy costs")',E2:'=OUTPUT(A1:B3,"Usage")'}};
  assert.deepEqual(plain(def.outputs(state)),{Energy_costs:{type:'table'},Usage:{type:'table'}},'each range is its own named port');
  assert.deepEqual(table(def,state,{},{},'Energy_costs'),{name:'Energy costs',columns:[{key:'Hall',name:'Hall',type:'string'},
    {key:'kWh',name:'kWh',type:'number'},{key:'Cost',name:'Cost',type:'number'}],rows:[['Hall 1',120,36],['Hall 2',80,24]]});
  assert.throws(()=>def.compute({},{...state,cells:{...state.cells,B3:'many'}}),/E1: column kWh needs one value type/);
  // an empty column has no type to follow: the third argument supplies it
  const empty={cols:6,rows:6,cells:{A1:'Hall',B1:'Note',A2:'Hall 1',E1:'=OUTPUT(A1:B2,"Notes")'}};
  assert.throws(()=>def.compute({},empty),/column Note needs one value type/);
  assert.deepEqual(table(def,{...empty,cells:{...empty.cells,E1:'=OUTPUT(A1:B2,"Notes","string,string")'}},{},{},'Notes').rows,[['Hall 1',null]]);
  assert.throws(()=>def.compute({},{...state,cells:{...state.cells,B1:'=1+1'}}),/B1 needs a unique column name as text/);
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
  const def=source(),state=sheet({F1:'=OUTPUT(B3:D4," Report ","message:string,amount:number,ready:boolean")',B3:"'=SUM(A1:A2)",C3:'=INPUT("amount")*2',D3:'=INPUT("ready","boolean")',B4:"'",D4:'FALSE',A1:'=1/0'},
    {formats:{C3:'0.00'},aligns:{B3:'right'}}),before=JSON.stringify(state);
  assert.deepEqual(table(def,state,{amount:1.2345,ready:true},{},'Report'),{name:'Report',columns:[{key:'message',name:'message',type:'string'},{key:'amount',name:'amount',type:'number'},{key:'ready',name:'ready',type:'boolean'}],rows:[['=SUM(A1:A2)',2.469,true],['',null,false]]});
  assert.equal(JSON.stringify(state),before,'publishing never rewrites authored cells or layout');
});

test('result schema problems are reported by compute with the formula cell',()=>{
  const def=source();
  for(const formula of ['=OUTPUT(A2:C4,"")','=OUTPUT(A2:C4,"'+'x'.repeat(121)+'")','=OUTPUT(A2:C4,"r","value:number")',
    '=OUTPUT(A2:C4,"r","x:number,x:string,z:boolean")','=OUTPUT(A2:C4,"r","constructor:number,y:number,z:number")',
    '=OUTPUT(A2:C4,"r","x:date,y:number,z:number")','=OUTPUT(A2:C4,"r")'])
    assert.throws(()=>def.compute({},sheet({F1:formula})),/Table output in F1/,formula);
  assert.deepEqual(table(def,sheet({F1:'=OUTPUT(B3:B3,"Results","value:number")',B3:'7'})).rows,[[7]]);
});

test('an output name may be used once, and at most 32 outputs exist',()=>{
  const def=source();
  assert.throws(()=>def.compute({},sheet({E1:'=OUTPUT(4,"Results")'})),/Output Results/);
  assert.throws(()=>def.compute({},sheet({E1:'=OUTPUT(A2:C4,"Results","a:number,b:number,c:number")'})),/declared twice/);
  const cells=Object.fromEntries(Array.from({length:32},(_,i)=>[String.fromCharCode(65+i%6)+(1+Math.floor(i/6)),'=OUTPUT('+i+',"out'+i+'")']));
  assert.throws(()=>def.outputs(sheet({...cells,F6:RESULTS})),/at most 32 inputs and 32 outputs/);
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
  const def=source(),state=sheet({F1:'=OUTPUT(A2:A2,"Results","value:number")',A2:'=INPUT("value")'});
  for(const value of [Number.MAX_SAFE_INTEGER+1,1e308])assert.throws(()=>def.compute({value},state),/Table output in A2/);
  assert.equal(table(def,state,{value:.125}).rows[0][0],.125);
  const text=sheet({F1:'=OUTPUT(A2:A2,"Results","text:string")',A2:'=INPUT("message","string")'});
  assert.equal(table(def,text,{message:'x'.repeat(2000)}).rows[0][0].length,2000);
  assert.throws(()=>def.compute({message:'x'.repeat(2001)},text),/dataset limits/);
  const cells=Object.fromEntries(Array.from({length:90},(_,r)=>['A'+(r+1),'=INPUT("message","string")']));
  assert.throws(()=>def.compute({message:'\u0000'.repeat(2000)},{cols:2,rows:90,cells:{...cells,B1:'=OUTPUT(A1:A90,"Results","text:string")'}}),/storage limit/);
});

test('linked dataset results follow selected row order and the current bounded page without changing the source',()=>{
  const def=source(),data={name:'Selected',columns:[{key:'name',name:'Name',type:'string'},{key:'value',name:'Value',type:'number'}],rows:[['B',20],['A',10]],rowIndices:[1,0],rowCount:2};
  const state=sheet({F1:'=OUTPUT(A2:C3,"Results","name:string,value:number,doubled:number")',A2:'=INPUT("hidden")',C2:'=B2*2',C3:'=B3*2'},
    {source:'Dataset',dataRows:2,dataColumns:2}),before=JSON.stringify(data);
  assert.deepEqual(plain(def.inputs(state)),{data:{type:'table'},startRow:{type:'number',default:0}});
  assert.deepEqual(table(def,state,{startRow:0},{tables:{data}}).rows,[['B',20,40],['A',10,20]]);
  assert.deepEqual(table(def,state,{startRow:1},{tables:{data}}).rows,[['A',10,20],[null,null,0]]);
  assert.equal(JSON.stringify(data),before);assert.equal(state.rows,6);assert.equal(state.cells.C2,'=B2*2');
});
