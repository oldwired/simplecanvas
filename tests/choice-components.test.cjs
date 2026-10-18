const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const plain=value=>JSON.parse(JSON.stringify(value));
const source=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'));
const ref={datasetId:'choices'};
const local=entries=>JSON.stringify(entries);
const dataset=(rows,columns=[{key:'label',name:'Label',type:'string'},{key:'id',name:'ID',type:'string'}])=>({columns,rows,rowCount:rows.length,rowIndices:rows.map((_,i)=>i)});
function run(name,inputs={},patch={},table){
  const def=source(name),state={...def.initState(),...patch},ports=def.inputs(state);
  const defaults=Object.fromEntries(Object.entries(ports).filter(([,port])=>'default' in port).map(([key,port])=>[key,port.default]));
  return plain(def.compute({...defaults,...inputs},state,{tables:table?{data:table}:{}}));
}

 test('dropdown and text lookup use the same editable list and expose dataset inputs only when needed',()=>{
  const dropdown=source('dropdown'),lookup=source('text-lookup');
  assert.equal(dropdown.apiVersion,2);assert.equal(lookup.apiVersion,2);
  assert.equal(dropdown.initState().choices,lookup.initState().choices);
  assert.equal(dropdown.settings.choices.format,'choices');assert.equal(lookup.settings.choices.format,'choices');
  assert.deepEqual(plain(dropdown.inputs(dropdown.initState())),{select:{type:'number',default:0}});
  assert.deepEqual(plain(lookup.inputs(lookup.initState())),{text:{type:'string',default:''}});
  for(const def of [dropdown,lookup]){
    const ports=def.inputs({...def.initState(),source:'dataset'});
    assert.equal(ports.data.type,'table');
    for(const name of ['textColumn','keyColumn'])assert.deepEqual(plain(ports[name]),{type:'string',default:'',columnOf:'data',columnType:'string'});
    assert.throws(()=>def.inputs({...def.initState(),source:'wrong'}),/list or dataset/);
  }
});

test('dropdown maps zero-based positions to labels and optional stable keys',()=>{
  assert.deepEqual(run('dropdown'),{index:0,key:'idle',text:'Idle',valid:true});
  assert.deepEqual(run('dropdown',{select:1}),{index:1,key:'running',text:'Running',valid:true});
  assert.deepEqual(run('dropdown',{select:2}),{index:2,key:'stopped',text:'Stopped',valid:true});
  const choices=local([{text:'Repeated',key:'first'},{text:'Repeated',key:'second'},{text:''}]);
  assert.deepEqual(run('dropdown',{select:1},{choices}),{index:1,key:'second',text:'Repeated',valid:true});
  assert.deepEqual(run('dropdown',{select:2},{choices}),{index:2,key:'',text:'',valid:true});
});

test('invalid dropdown positions are unselected, without clamping to another row',()=>{
  for(const select of [-1,-2,3,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'2',null,undefined]){
    assert.deepEqual(run('dropdown',{select}),{index:-1,key:'',text:'',valid:false});
  }
  assert.deepEqual(run('dropdown',{select:0},{choices:'[]'}),{index:-1,key:'',text:'',valid:false});
});

test('text lookup finds the first duplicate label, preserves its key, and reports unknown text',()=>{
  assert.deepEqual(run('text-lookup',{text:'Idle'}),{index:0,key:'idle',found:true});
  assert.deepEqual(run('text-lookup',{text:'Stopped'}),{index:2,key:'stopped',found:true});
  assert.deepEqual(run('text-lookup',{text:'Missing'}),{index:-1,key:'',found:false});
  const choices=local([{text:'Repeat',key:'first'},{text:'Repeat',key:'second'},{text:''}]);
  assert.deepEqual(run('text-lookup',{text:'Repeat'},{choices}),{index:0,key:'first',found:true});
  assert.deepEqual(run('text-lookup',{text:''},{choices}),{index:2,key:'',found:true});
  assert.deepEqual(run('text-lookup',{text:''},{choices:'[]'}),{index:-1,key:'',found:false});
});

test('case and whitespace matching are exact by default and independently configurable',()=>{
  const choices=local([{text:'  RUNNING ',key:'running'},{text:'running',key:'other'}]);
  assert.deepEqual(run('text-lookup',{text:'running'},{choices}),{index:1,key:'other',found:true});
  assert.deepEqual(run('text-lookup',{text:'RUNNING'},{choices}),{index:-1,key:'',found:false});
  assert.deepEqual(run('text-lookup',{text:'RUNNING'},{choices,trim:true}),{index:0,key:'running',found:true});
  assert.deepEqual(run('text-lookup',{text:'  running '},{choices,caseSensitive:false}),{index:0,key:'running',found:true});
  assert.deepEqual(run('text-lookup',{text:' RuNnInG '},{choices,caseSensitive:false,trim:true}),{index:0,key:'running',found:true});
  assert.throws(()=>run('text-lookup',{text:2}),/requires a string/);
  assert.throws(()=>run('text-lookup',{text:'x'.repeat(2001)}),/2000 characters/);
});

test('editable lists enforce bounded well-formed entries and unique nonempty keys',()=>{
  for(const name of ['dropdown','text-lookup']){
    const cases=[['not json',/valid JSON/],['{}',/64 entries/],[local([null]),/Each list entry/],[local([{text:2}]),/Each list entry/],[local([{text:'A',key:2}]),/Each list entry/],[local([{text:'A',extra:'value'}]),/Each list entry/],[local(Array.from({length:65},()=>({text:''}))),/64 entries/],[local([{text:'x'.repeat(2001)}]),/2000 characters/],[local([{text:'A',key:'same'},{text:'B',key:'same'}]),/nonempty key must be unique/]];
    for(const [choices,message] of cases)assert.throws(()=>run(name,{}, {choices}),message);
    const choices=local([{text:'A'},{text:'B',key:''}]);
    assert.doesNotThrow(()=>run(name,{}, {choices}));
    assert.doesNotThrow(()=>run(name,{}, {choices:local([{text:'A',key:'X'},{text:'B',key:'x'}])}));
  }
});

test('dataset mapping uses all rows beyond the preview and respects selected row order',()=>{
  const rows=Array.from({length:40},(_,index)=>['Entry '+(index+1),'key-'+(index+1)]),table=dataset(rows);
  const state={source:'dataset'},inputs={data:ref,keyColumn:'id'};
  assert.deepEqual(run('dropdown',{...inputs,select:34},state,table),{index:34,key:'key-35',text:'Entry 35',valid:true});
  assert.deepEqual(run('text-lookup',{...inputs,text:'Entry 35'},state,table),{index:34,key:'key-35',found:true});
  const filtered={...table,rows:[rows[34],rows[0],rows[20]],rowCount:3,rowIndices:[34,0,20]};
  assert.deepEqual(run('dropdown',{...inputs,select:0},state,filtered),{index:0,key:'key-35',text:'Entry 35',valid:true});
  assert.deepEqual(run('text-lookup',{...inputs,text:'Entry 35'},state,filtered),{index:0,key:'key-35',found:true});
  assert.deepEqual(run('text-lookup',{...inputs,text:'Entry 2'},state,filtered),{index:-1,key:'',found:false});
  assert.deepEqual(rows[34],['Entry 35','key-35'],'source rows are never mutated');
});

test('dataset column selection defaults to the first string column and normalizes null cells',()=>{
  const columns=[{key:'score',name:'Score',type:'number'},{key:'label',name:'Label',type:'string'},{key:'id',name:'ID',type:'string'}];
  const table=dataset([[42,'Answer','answer'],[0,null,null]],columns),state={source:'dataset'},inputs={data:ref};
  assert.deepEqual(run('dropdown',inputs,state,table),{index:0,key:'',text:'Answer',valid:true});
  assert.deepEqual(run('dropdown',{...inputs,textColumn:'id',keyColumn:'label'},state,table),{index:0,key:'Answer',text:'answer',valid:true});
  assert.deepEqual(run('dropdown',{...inputs,select:1,keyColumn:'id'},state,table),{index:1,key:'',text:'',valid:true});
  assert.deepEqual(run('text-lookup',{...inputs,text:'',keyColumn:'id'},state,table),{index:1,key:'',found:true});
});

test('invalid dataset configuration fails clearly and empty datasets remain valid empty lists',()=>{
  const state={source:'dataset'},table=dataset([['A','a'],['B','b']]),inputs={data:ref};
  for(const name of ['dropdown','text-lookup']){
    assert.throws(()=>run(name,inputs,state),/complete dataset input/);
    assert.throws(()=>run(name,inputs,state,{...table,rows:table.rows.slice(0,1)}),/complete dataset input/);
    assert.throws(()=>run(name,{...inputs,textColumn:'missing'},state,table),/string column for the text/);
    assert.throws(()=>run(name,{...inputs,keyColumn:'missing'},state,table),/string column for the keys/);
    assert.throws(()=>run(name,inputs,state,dataset([[1]],[{key:'n',name:'N',type:'number'}])),/string column for the text/);
    assert.throws(()=>run(name,{...inputs,keyColumn:'id'},state,dataset([['A','x'],['B','x']])),/nonempty key must be unique/);
    assert.throws(()=>run(name,inputs,state,dataset([[3,'x']])),/Labels and keys must be text/);
  }
  assert.deepEqual(run('dropdown',inputs,state,dataset([])),{index:-1,key:'',text:'',valid:false});
  assert.deepEqual(run('text-lookup',inputs,state,dataset([])),{index:-1,key:'',found:false});
});

test('dropdown handles expose literal choices and a full-table descriptor, never a truncated preview',()=>{
  const def=source('dropdown'),state=def.initState(),style=def.initStyle(),io={inputs:{select:1},outputs:{index:1,valid:true},boundInputs:[]};
  const handle=plain(def.handles(state,280,78,style,io)[0]);
  assert.equal(handle.kind,'choice');assert.equal(handle.input,'select');assert.equal(handle.value,1);
  assert.deepEqual(handle.options,[{value:0,label:'Idle'},{value:1,label:'Running'},{value:2,label:'Stopped'}]);
  assert.ok(handle.inline.w>0 && handle.inline.h>0);
  assert.equal(def.handles(state,280,78,style,{})[0].value,-1,'an unavailable selection is distinct from the first row');
  assert.equal(def.handles(state,280,78,style,{inputs:{select:0}})[0].value,0,'the first row survives handle fallback');
  assert.equal(def.hitEdit(state,140,50,280,78,style,io),'select');assert.equal(def.hitEdit(state,140,10,280,78,style,io),null);
  const empty=plain(def.handles({...state,choices:local([{text:''}])},280,78,style,io)[0]);assert.equal(empty.options[0].label,'(empty)');
  const tableHandle=plain(def.handles({...state,source:'dataset'},280,78,style,{...io,inputs:{select:34,textColumn:'label'},tables:{inputs:{data:{rows:[['truncated']]}}}})[0]);
  assert.deepEqual(tableHandle.table,{input:'data',labelColumn:'label'});assert.equal('options' in tableHandle,false);
});

test('connected, hidden, and unavailable dropdowns cannot be manually changed',()=>{
  const def=source('dropdown'),state=def.initState(),style=def.initStyle();
  for(const [patch,io] of [[{}, {boundInputs:['select']}],[{showArrow:false},{}],[{}, {error:'Input unavailable'}]]){
    assert.deepEqual(plain(def.handles({...state,...patch},280,78,style,io)),[]);
    assert.equal(def.hitEdit({...state,...patch},140,50,280,78,style,io),null);
  }
});

test('views use instance names and plain text, while a hidden dropdown becomes a compact label',()=>{
  for(const name of ['dropdown','text-lookup']){
    const def=source(name),state=def.initState(),style=def.initStyle(),inputs=name==='dropdown'?{select:1}:{text:'Running'},outputs=run(name,inputs);
    const io={name:'My <label> & choice',inputs,outputs};
    const children=def.children(state,style,style.w,style.h,false,io),text=children.filter(item=>item.type==='text');
    assert.equal(text[0].text,io.name);assert.ok(text.every(item=>item.plainText===true));
    assert.ok(children.every(item=>Object.values(item).every(value=>typeof value!=='number' || Number.isFinite(value))));
    const unavailable=def.unavailableChildren(state,style,style.w,style.h,false,{...io,error:'Choose a column'});
    assert.ok(unavailable.some(item=>item.type==='text' && item.text.includes('Choose a column')));
    if(name==='dropdown'){
      const hidden=def.children({...state,showArrow:false},style,style.w,style.h,false,io);
      assert.ok(hidden.every(item=>item.type==='text'));assert.ok(hidden.some(item=>item.text==='Running'));
    }
  }
});
