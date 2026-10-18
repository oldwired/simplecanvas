const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');
const source=()=>vm.runInNewContext(script),plain=value=>JSON.parse(JSON.stringify(value));
const sheet=(cells={},more={})=>({cols:6,rows:6,cells,tableOutput:true,tableRange:'A2:C4',tableColumns:'energy:number\nprice:number\ncost:number',tableName:'Results',...more});
const table=(def,state,inputs={},context={})=>plain(def.compute(inputs,state,context).table.table);

test('table output is optional and enabling it on an empty sheet publishes blank cells',()=>{
  const def=source(),state=def.initState();assert.equal(state.tableOutput,false);assert.ok(script.length<=50000);
  assert.deepEqual(plain(def.outputs(state)),{});
  assert.deepEqual(plain(def.outputs({...state,tableRange:'bad',tableColumns:'bad',tableName:''})),{});
  const enabled={...state,tableOutput:true,tableRange:'A1:B2',tableColumns:'label:string\namount:number'};
  assert.deepEqual(plain(def.outputs(enabled)),{table:{type:'table'}});
  assert.deepEqual(table(def,enabled),{name:'Spreadsheet results',columns:[{key:'label',name:'label',type:'string'},{key:'amount',name:'amount',type:'number'}],rows:[[null,null],[null,null]]});
});

test('configured result cells emit exact evaluated scalars and nulls without formula or formatting metadata',()=>{
  const def=source(),state=sheet({B3:"'=SUM(A1:A2)",C3:'=INPUT("amount")*2',D3:'=INPUT("ready","boolean")',B4:"'",D4:'FALSE',A1:'=1/0'},
    {tableRange:' b3 : D4 ',tableColumns:'message:string\namount:number\nready:boolean',tableName:' Report ',formats:{C3:'0.00'},aligns:{B3:'right'}}),before=JSON.stringify(state);
  assert.deepEqual(table(def,state,{amount:1.2345,ready:true}),{name:'Report',columns:[{key:'message',name:'message',type:'string'},{key:'amount',name:'amount',type:'number'},{key:'ready',name:'ready',type:'boolean'}],rows:[['=SUM(A1:A2)',2.469,true],['',null,false]]});
  assert.equal(JSON.stringify(state),before,'publishing never rewrites authored cells or layout');
});

test('result schema and bounds are validated independently of current values',()=>{
  const def=source(),state=sheet();
  for(const patch of [{tableRange:''},{tableRange:'A0:B2'},{tableRange:'A1:AA2'},{tableRange:'C4:A2'},{tableRange:'A2:G4'},{tableRange:'A2:C7'},
    {tableColumns:''},{tableColumns:'value:number'},{tableColumns:'x:number\nx:string\nz:boolean'},
    {tableColumns:'constructor:number\ny:number\nz:number'},{tableColumns:'x:date\ny:number\nz:number'},
    {tableName:''},{tableName:'x'.repeat(121)}])assert.throws(()=>def.outputs({...state,...patch}),/Result/);
  assert.deepEqual(table(def,sheet({B3:'7'},{tableRange:'B3',tableColumns:'value:number'})).rows,[[7]]);
  const small={...state,rows:3};assert.throws(()=>def.outputs(small),/fit the grid/);assert.equal(small.rows,3,'output configuration never enlarges the sheet');
});

test('a scalar output called table conflicts only when table publication is enabled',()=>{
  const def=source(),state=sheet({E1:'=OUTPUT(4,"table")'});
  assert.throws(()=>def.outputs(state),/Output table is reserved/);assert.throws(()=>def.compute({},state),/Output table is reserved/);
  assert.deepEqual(plain(def.compute({}, {...state,tableOutput:false})),{table:4});
  const cells=Object.fromEntries(Array.from({length:32},(_,i)=>[String.fromCharCode(65+i%6)+(1+Math.floor(i/6)),'=OUTPUT('+i+',"out'+i+'")']));
  assert.throws(()=>def.outputs(sheet(cells)),/at most 32 inputs and 32 outputs/);
});

test('formula errors or mixed value types reject the complete table with a cell address',()=>{
  const def=source(),state=sheet({A2:'1',B2:'2',C2:'=A2+B2',A3:'=1/0'});
  assert.throws(()=>def.compute({},state),/Table output in A3: #DIV\/0!/);
  for(const value of ["'3",'TRUE'])assert.throws(()=>def.compute({},sheet({...state.cells,A3:value})),/Table output in A3: expected number/);
  assert.throws(()=>def.compute({},sheet({...state.cells,A3:'=A3'})),/Table output in A3: #CYCLE!/);
  assert.throws(()=>def.compute({},sheet({...state.cells,A3:'=Z99'})),/Table output in A3: #REF!/);
  assert.deepEqual(table(def,sheet({...state.cells,A3:'=IFERROR(1/0,9)'})).rows,[[1,2,3],[9,null,null],[null,null,null]]);
});

test('table results enforce dataset value and storage limits before crossing the Worker bridge',()=>{
  const def=source(),state=sheet({A2:'=INPUT("value")'},{tableRange:'A2',tableColumns:'value:number'});
  for(const value of [Number.MAX_SAFE_INTEGER+1,1e308])assert.throws(()=>def.compute({value},state),/Table output in A2/);
  assert.equal(table(def,state,{value:.125}).rows[0][0],.125);
  const text=sheet({A2:'=INPUT("message","string")'},{tableRange:'A2',tableColumns:'text:string'});
  assert.equal(table(def,text,{message:'x'.repeat(2000)}).rows[0][0].length,2000);
  assert.throws(()=>def.compute({message:'x'.repeat(2001)},text),/dataset limits/);
  const cells=Object.fromEntries(Array.from({length:90},(_,r)=>['A'+(r+1),'=INPUT("message","string")']));
  assert.throws(()=>def.compute({message:'\u0000'.repeat(2000)},sheet(cells,{cols:1,rows:90,tableRange:'A1:A90',tableColumns:'text:string'})),/storage limit/);
});

test('linked dataset results follow selected row order and the current bounded page without changing the source',()=>{
  const def=source(),data={name:'Selected',columns:[{key:'name',name:'Name',type:'string'},{key:'value',name:'Value',type:'number'}],rows:[['B',20],['A',10]],rowIndices:[1,0],rowCount:2};
  const state=sheet({A2:'=INPUT("hidden")',C2:'=B2*2',C3:'=B3*2'},
    {source:'Dataset',dataRows:2,dataColumns:2,tableColumns:'name:string\nvalue:number\ndoubled:number',tableRange:'A2:C3'}),before=JSON.stringify(data);
  assert.deepEqual(plain(def.inputs(state)),{data:{type:'table'},startRow:{type:'number',default:0}});
  assert.deepEqual(table(def,state,{startRow:0},{tables:{data}}).rows,[['B',20,40],['A',10,20]]);
  assert.deepEqual(table(def,state,{startRow:1},{tables:{data}}).rows,[['A',10,20],[null,null,0]]);
  assert.equal(JSON.stringify(data),before);assert.equal(state.rows,6);assert.equal(state.cells.C2,'=B2*2');
});
