const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function runtime(){
  const scope=vm.createContext({TextEncoder,performance:{now:()=>0},datasets:{},smartCancelled:()=>Object.assign(new Error('Cancelled'),{cancelled:true}),
    normalizeSmartState:plain,smartNumber:v=>v,smartItemExecutions:new Map(),disposeSmartExecution:()=>{},componentRuntimeId:()=>1});
  const ranges=[['// ---------- embedded datasets ----------','// End of embedded dataset contract.'],
    ['  function validateDatasetReplacementSchema(','  function datasetCellValue('],
    ['  function componentScalar(','  function normalizeComponentSettings('],['  function componentGraphSignature(','  let editorComponentEvaluation=']];
  vm.runInContext(ranges.map(([a,b])=>html.slice(html.indexOf(a),html.indexOf(b))).join('\n')+
    '\nthis.api={datasetRevision,datasetRowIds,datasetCommand,normalizeDataTable,normalizeDatasets,remapDatasetSelections,createComponentTimeline,settleComponentTimeline};',scope);
  return scope.api;
}
const data={name:'Readings',columns:[{key:'name',name:'Name',type:'string'},{key:'value',name:'Value',type:'number'},{key:'on',name:'On',type:'boolean'}],rows:[['A',10,true],['B',20,false]]};

test('stored datasets preserve validated identities while pure tables remain plain',()=>{
  const api=runtime(),pool=api.normalizeDatasets({data});
  assert.deepEqual(plain(pool.data),data);assert.equal(api.datasetRevision(pool.data),0);assert.deepEqual(plain(api.datasetRowIds(pool.data)),['r0','r1']);
  const edited={...data,rowIds:['r2','r5'],revision:3,nextRowId:6};
  assert.deepEqual(plain(api.normalizeDatasets({data:edited}).data),edited);
  assert.deepEqual(plain(api.normalizeDataTable(edited)),data,'derived tables do not inherit editable source identity');
  for(const patch of [{rowIds:['r0','r0']},{rowIds:['r0']},{rowIds:['r0','bad']},{revision:-1},{nextRowId:1}])
    assert.throws(()=>api.normalizeDatasets({data:{...edited,...patch}}),/dataset row|dataset revision/i);
});

test('append creates one immutable revision, typed null defaults, and a stable identity',()=>{
  const api=runtime(),other={...data,name:'Other'},pool={data,other},before=JSON.stringify(pool);
  const next=api.datasetCommand(pool,{type:'append',datasetId:'data',row:{name:'C',value:30},expectedRevision:0});
  assert.deepEqual(plain(next.reference),{datasetId:'data'});assert.equal(next.rowId,'r2');assert.equal(next.table.revision,1);
  assert.deepEqual(plain(next.table.rows),[...data.rows,['C',30,null]]);assert.deepEqual(plain(next.table.rowIds),['r0','r1','r2']);
  assert.equal(next.pool.other,other,'unaffected table revisions remain shared');assert.equal(JSON.stringify(pool),before);
});

test('update and delete address row identities and remap stored filtered selections',()=>{
  const api=runtime(),first=api.datasetCommand({data},{type:'append',datasetId:'data',row:{name:'C'}});
  const selected=[{inputValues:{data:{datasetId:'data',rows:[2,0,1]}},signalState:{data:{datasetId:'data',rows:[0]}}}];
  const removed=api.datasetCommand(first.pool,{type:'delete',datasetId:'data',rowId:'r0',expectedRevision:1});
  api.remapDatasetSelections(selected,first.pool,removed.pool);
  assert.deepEqual(selected[0].inputValues.data.rows,[1,0]);assert.deepEqual(selected[0].signalState.data.rows,[]);
  const edited=api.datasetCommand(removed.pool,{type:'update',datasetId:'data',rowId:'r1',changes:{value:99,on:null},expectedRevision:2});
  assert.deepEqual(plain(edited.table.rows),[['B',99,null],['C',null,null]]);assert.deepEqual(plain(edited.table.rowIds),['r1','r2']);
  const appended=api.datasetCommand(edited.pool,{type:'append',datasetId:'data',row:{name:'D'}});
  assert.equal(appended.rowId,'r3','deleted row identities are never reused');
});

test('replace keeps the dataset identity but allocates new rows and validates the schema',()=>{
  const api=runtime(),first=api.datasetCommand({data},{type:'delete',datasetId:'data',rowId:'r0'});
  const replacement={...data,name:'New readings',rows:[['C',30,true]]};
  const next=api.datasetCommand(first.pool,{type:'replace',datasetId:'data',table:replacement,expectedRevision:1});
  assert.deepEqual(plain(next.reference),{datasetId:'data'});assert.deepEqual(plain(next.table.rowIds),['r2']);assert.equal(next.table.revision,2);
  const items=[{inputValues:{data:{datasetId:'data',rows:[0]}}}];api.remapDatasetSelections(items,first.pool,next.pool);
  assert.deepEqual(items[0].inputValues.data.rows,[],'old selections cannot silently select unrelated replacement rows');
  assert.throws(()=>api.datasetCommand(next.pool,{type:'replace',datasetId:'data',table:{...replacement,columns:replacement.columns.slice(1),rows:[[30,true]]}}),/Missing column/);
});

test('appendMany maps incoming columns by key and appends one atomic revision in selected order',()=>{
  const api=runtime(),pool={data},before=JSON.stringify(pool);
  const incoming={name:'Selection',columns:[data.columns[2],data.columns[0],data.columns[1]],rows:[[false,'D',40],[null,'C',30]]};
  const next=api.datasetCommand(pool,{type:'appendMany',datasetId:'data',table:incoming,expectedRevision:0});
  assert.deepEqual(plain(next.table.rows),[...data.rows,['D',40,false],['C',30,null]]);
  assert.deepEqual(plain(next.table.rowIds),['r0','r1','r2','r3']);assert.equal(next.table.revision,1);
  assert.equal(next.table.name,data.name);assert.deepEqual(plain(next.table.columns),data.columns);assert.equal(JSON.stringify(pool),before);
  for(const table of [
    {...incoming,columns:incoming.columns.slice(1),rows:[['C',30]]},
    {...incoming,columns:[...incoming.columns,{key:'extra',type:'string'}],rows:[[true,'C',30,'x']]},
    {...incoming,columns:incoming.columns.map(c=>c.key==='value'?{...c,type:'string'}:c),rows:[[true,'C','30']]},
    {...incoming,rows:Array.from({length:999},()=>[true,'C',30])},
  ]){
    assert.throws(()=>api.datasetCommand(pool,{type:'appendMany',datasetId:'data',table}));assert.equal(JSON.stringify(pool),before);
  }
});

test('conflicts and invalid commands leave the complete pool unchanged',()=>{
  const api=runtime(),pool={data},before=JSON.stringify(pool);
  for(const command of [
    {type:'append',row:{name:'C'},expectedRevision:1},{type:'append',row:{unknown:1}},{type:'append',row:{value:'30'}},
    {type:'update',rowId:'r8',changes:{value:1}},{type:'update',rowId:'r0',changes:{on:1}},{type:'delete',rowId:'r8'},
    {type:'replace',table:{...data,rows:Array.from({length:1001},()=>data.rows[0])}},
  ]){
    assert.throws(()=>api.datasetCommand(pool,{datasetId:'data',...command}));assert.equal(JSON.stringify(pool),before);
  }
});

test('historical scheduled transitions read the committed dataset revision before accepting an edit',async()=>{
  const api=runtime(),table={name:'Value',columns:[{key:'value',name:'Value',type:'number'}],rows:[[1]]};
  const original={data:table},changed=api.datasetCommand(original,{type:'update',datasetId:'data',rowId:'r0',changes:{value:99}}).pool;
  const item={type:'smart',uid:'sampler',componentApi:2,script:'sampler',state:{seen:[]},inputValues:{data:{datasetId:'data'}},bindings:{}};
  const call=async(item,hook,args)=>{
    if(hook==='caps')return {apiVersion:2,inputs:{data:{type:'table'}},outputs:{value:{type:'number'}},transition:true,publish:true,compute:true};
    if(hook==='publish')return {value:args[0].seen.at(-1)??0};
    if(hook==='compute')return {value:args[1].seen.at(-1)??0};
    const [inputs,state,memory,context]=args;
    return {state:{seen:[...state.seen,context.tables.data.rows[0][0]]},memory:{},nextWakeAt:context.now+1000};
  };
  const timeline=api.createComponentTimeline(()=>0);
  await api.settleComponentTimeline([item],call,()=>true,timeline,{datasets:original});
  timeline.elapsed=2500;
  await api.settleComponentTimeline([item],call,()=>true,timeline,{datasets:changed});
  assert.deepEqual(plain(item.state.seen),[1,1,1,99]);assert.equal(timeline.committedDatasets,changed);assert.equal(original.data.rows[0][0],1);
});
