const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const definition=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
function runtime(){
  const scope=vm.createContext({TextEncoder,performance:{now:()=>0},datasets:{},smartCancelled:()=>Object.assign(new Error('Cancelled'),{cancelled:true}),normalizeSmartState:plain,smartNumber:v=>v,smartItemExecutions:new Map(),disposeSmartExecution:()=>{},componentRuntimeId:item=>item.uid});
  const ranges=[['// ---------- embedded datasets ----------','// End of embedded dataset contract.'],['  function componentScalar(','  function normalizeComponentSettings('],['  function componentGraphSignature(','  let editorComponentEvaluation='],['  function validateDatasetReplacementSchema(','  function datasetCellValue('],['  function prepareDatasetTableAction(','  function applyDatasetReferenceChanges(']];
  vm.runInContext(ranges.map(([a,b])=>html.slice(html.indexOf(a),html.indexOf(b))).join('\n')+'\nthis.api={normalizeComponentPorts,normalizeDatasetOwner,normalizeComponentActionDeclarations,runComponentEvaluation,settleComponentTimeline,createComponentTimeline,takeComponentDataActions,prepareDatasetTableAction,datasetCommand};',scope);return scope.api;
}
function caller(api,custom={}){return async(item,hook,args)=>{
  const def=custom[item.script]||definition(item.script),state=args[0];
  if(hook==='caps')return {apiVersion:2,compute:typeof def.compute==='function',publish:typeof def.publish==='function',transition:typeof def.transition==='function',datasetOwner:def.datasetOwner,
    inputs:api.normalizeComponentPorts(typeof def.inputs==='function'?def.inputs(state):def.inputs,'input'),outputs:api.normalizeComponentPorts(typeof def.outputs==='function'?def.outputs(state):def.outputs,'output'),dataActions:typeof def.dataActions==='function'?def.dataActions(state):def.dataActions};
  return def[hook](...args);
};}
const table={name:'Stored',columns:[{key:'name',name:'Name',type:'string'},{key:'value',name:'Value',type:'number'}],rows:[['Old',1]]};
const owner=(extra={})=>({type:'smart',componentApi:2,uid:'owner',script:'data-source',state:{allowReaderUpdates:false},bindings:{},inputValues:{data:{datasetId:'stored'},replace:false,append:false},...extra});
const sample=()=>({type:'smart',componentApi:2,uid:'sample',script:'sample',state:{value:4},bindings:{},inputValues:{}});
const sampleDef={inputs:{},outputs:{data:{type:'table'}},compute(inputs,state){return {data:{table:{...table,name:'Source',rows:[['Captured',state.value]]}}};}};
const reader={type:'smart',componentApi:2,uid:'reader',script:'reader',state:{},inputValues:{},bindings:{data:{uid:'owner',port:'data'}}};
const readerDef={inputs:{data:{type:'table'}},outputs:{count:{type:'number'}},compute(inputs,state,context){return {count:context.tables.data.rowCount};}};

const snapshotDef={inputs:{data:{type:'table'}},outputs:{data:{type:'table'}},compute(inputs,state,context){const t=context.tables.data;return {data:{table:{name:t.name,columns:t.columns,rows:t.rows}}};}};
function fixture({live=true,derived=true}={}){
  const api=runtime(),target=owner({state:{updateMode:live?'Live':'Manual',allowReaderUpdates:false},bindings:{source:{uid:derived?'derived':'upstream',port:'data'}}});
  const upstream=owner({uid:'upstream',inputValues:{data:{datasetId:'upstream'}},state:{updateMode:'Manual'}});
  const transform={type:'smart',componentApi:2,uid:'derived',script:'snapshot',state:{},inputValues:{},bindings:{data:{uid:'upstream',port:'data'}}};
  let items=[target,transform,upstream],pool={stored:plain(table),upstream:{...plain(table),rows:[['New',7]]}},timeline=api.createComponentTimeline(()=>0),records;
  const call=caller(api,{snapshot:snapshotDef});
  const evaluate=async options=>(records=await api.settleComponentTimeline(items,call,()=>true,timeline,{datasets:pool,...options}));
  return {api,target,upstream,transform,evaluate,get items(){return items;},get pool(){return pool;},get records(){return records;},get timeline(){return timeline;},
    actions:()=>Array.from(api.takeComponentDataActions(timeline)),command(command){pool=api.datasetCommand(pool,command).pool;},
    apply(intent,reader=false){pool=api.datasetCommand(pool,api.prepareDatasetTableAction(intent,records.get(intent.item),records.datasets,reader)).pool;},
    restore(){items=plain(items);timeline=api.createComponentTimeline(()=>0);}};
}

test('Live is explicit, restored scenes baseline, and enabling copies one settled source publication',async()=>{
  const f=fixture({live:false});await f.evaluate();assert.deepEqual(f.actions(),[]);f.target.state.updateMode='Live';await f.evaluate();
  const [intent]=f.actions();assert.equal(intent.type,'syncTable');assert.deepEqual(plain(intent.table.rows),[['New',7]]);f.apply(intent);await f.evaluate();assert.deepEqual(f.actions(),[]);
  assert.deepEqual(plain(f.pool.stored.rows),[['New',7]]);f.restore();await f.evaluate();assert.deepEqual(f.actions(),[]);
  const baseline=fixture();await baseline.evaluate();assert.deepEqual(baseline.actions(),[]);assert.deepEqual(baseline.pool.stored.rows,[['Old',1]]);
});

test('destination edits and presentation changes survive until the next upstream refresh, including identical data',async()=>{
  const f=fixture();await f.evaluate();f.command({type:'update',datasetId:'stored',rowId:'r0',changes:{name:'My edit',value:88}});await f.evaluate();assert.deepEqual(f.actions(),[]);
  f.target.state.cosmetic=true;f.upstream.componentName='Renamed';f.upstream.x=500;f.transform.state.cosmetic=true;await f.evaluate();assert.deepEqual(f.actions(),[]);
  const before=f.records.get(f.transform).io.outputs.data.datasetId;
  f.command({type:'replace',datasetId:'upstream',table:f.pool.upstream});await f.evaluate();const [intent]=f.actions();
  assert.equal(f.records.get(f.transform).io.outputs.data.datasetId,before,'identical derived content retains its immutable reference');
  assert.deepEqual(plain(intent.table.rows),[['New',7]]);f.apply(intent);await f.evaluate();assert.deepEqual(f.actions(),[]);assert.deepEqual(plain(f.pool.stored.rows),[['New',7]]);
});

test('a source rebind applies once while a reopened or undone Live scene establishes a new baseline',async()=>{
  const f=fixture();await f.evaluate();f.target.bindings.source={uid:'upstream',port:'data'};await f.evaluate();assert.equal(f.actions().length,1);await f.evaluate();assert.deepEqual(f.actions(),[]);
  f.restore();await f.evaluate();assert.deepEqual(f.actions(),[]);
});

test('Live captures exact settled rows, rejects stale target edits, and consumes permission failures without retrying',async()=>{
  const f=fixture({live:false});await f.evaluate();f.target.state.updateMode='Live';await f.evaluate();const [intent]=f.actions();
  assert.throws(()=>f.apply(intent,true),/disabled/);f.target.state.allowReaderUpdates=true;await f.evaluate();assert.deepEqual(f.actions(),[]);
  f.command({type:'replace',datasetId:'upstream',table:{...f.pool.upstream,rows:[['Later',99]]}});await f.evaluate();const [next]=f.actions();assert.deepEqual(plain(intent.table.rows),[['New',7]]);assert.deepEqual(plain(next.table.rows),[['Later',99]]);
  f.command({type:'update',datasetId:'stored',rowId:'r0',changes:{value:123}});await f.evaluate();assert.deepEqual(f.actions(),[]);assert.throws(()=>f.apply(next),/Dataset changed/);
  f.target.state.updateMode='Manual';await f.evaluate();assert.throws(()=>f.apply(intent),/disabled/);
});

test('unavailable sources and invalid schemas preserve stored data and do not create retry loops',async()=>{
  const f=fixture({live:false});await f.evaluate();f.target.state.updateMode='Live';f.target.bindings.source={uid:'missing',port:'data'};await f.evaluate();let actions=f.actions();assert.equal(actions.length,1);assert.match(actions[0].error,/Missing source/);assert.equal(f.records.get(f.target).error,undefined);
  for(let i=0;i<3;i++){await f.evaluate();assert.deepEqual(f.actions(),[]);}
  f.target.bindings.source={uid:'upstream',port:'data'};await f.evaluate();actions=f.actions();assert.equal(actions.length,1);f.apply(actions[0]);await f.evaluate();assert.deepEqual(f.actions(),[]);
  assert.deepEqual(plain(f.pool.stored.rows),[['New',7]]);
  const before=JSON.stringify(f.pool.stored);f.pool.upstream.columns[1].type='string';f.pool.upstream.rows[0][1]='bad';
  // A normalized replacement represents a new external publication even if its schema is incompatible with the destination.
  f.command({type:'update',datasetId:'upstream',rowId:'r0',changes:{value:'bad'}});await f.evaluate();actions=f.actions();assert.equal(actions.length,1);assert.throws(()=>f.apply(actions[0]),/must remain number/);assert.equal(JSON.stringify(f.pool.stored),before);await f.evaluate();assert.deepEqual(f.actions(),[]);
});

test('Live chains advance one owner publication at a time without a continuous update loop',async()=>{
  const f=fixture();const downstream=owner({uid:'downstream',state:{updateMode:'Live'},inputValues:{data:{datasetId:'last'}},bindings:{source:{uid:'owner',port:'data'}}});f.items.push(downstream);f.pool.last=plain(table);await f.evaluate();assert.deepEqual(f.actions(),[]);
  f.command({type:'replace',datasetId:'upstream',table:{...f.pool.upstream,rows:[['Chain',11]]}});await f.evaluate();let actions=f.actions();assert.equal(actions.length,1);assert.equal(actions[0].item.uid,'owner');f.apply(actions[0]);await f.evaluate();actions=f.actions();assert.equal(actions.length,1);assert.equal(actions[0].item.uid,'downstream');f.apply(actions[0]);await f.evaluate();assert.deepEqual(f.actions(),[]);assert.deepEqual(plain(f.pool.last.rows),[['Chain',11]]);
});

test('direct and multi-owner Live feedback is rejected while stored readers remain healthy',async()=>{
  for(const multiple of [false,true]){
    const f=fixture({live:false});if(multiple){f.upstream.bindings.source={uid:'owner',port:'data'};f.upstream.state.updateMode='Live';}else f.target.bindings.source={uid:'owner',port:'data'};
    await f.evaluate();f.target.state.updateMode='Live';await f.evaluate();const actions=f.actions();assert.ok(actions.length);for(const intent of actions)assert.match(intent.error,/feedback loops/);assert.equal(f.records.get(f.target).error,undefined);
    await f.evaluate();assert.deepEqual(f.actions(),[]);assert.deepEqual(f.pool.stored.rows,[['Old',1]]);
  }
});

test('paused Step waits for complete propagation before sampling once, and reopening never replays it',async()=>{
  const f=fixture();await f.evaluate();f.timeline.pausedByUser=true;f.command({type:'replace',datasetId:'upstream',table:{...f.pool.upstream,rows:[['Stepped',42]]}});
  await f.evaluate({step:true});assert.equal(f.actions().length,0);for(let i=0;f.timeline.pendingTime!==null&&i<10;i++)await f.evaluate({step:true});
  const [intent]=f.actions();assert.deepEqual(plain(intent.table.rows),[['Stepped',42]]);f.apply(intent);await f.evaluate();assert.deepEqual(f.actions(),[]);
  f.command({type:'update',datasetId:'stored',rowId:f.pool.stored.rowIds[0],changes:{value:71}});await f.evaluate({step:true});for(let i=0;f.timeline.pendingTime!==null&&i<10;i++)await f.evaluate({step:true});assert.deepEqual(f.actions(),[]);f.restore();await f.evaluate();assert.deepEqual(f.actions(),[]);assert.equal(f.pool.stored.rows[0][1],71);
});


test('first Inputs setup applies Live once after an unconfigured owner becomes valid',async()=>{
  const f=fixture({live:false});delete f.pool.stored;await f.evaluate();assert.match(f.records.get(f.target).error,/dataset is missing/);assert.equal(f.records.datasetOwners.has('stored'),false);assert.deepEqual(f.actions(),[]);
  f.pool.stored=plain(table);f.target.state.updateMode='Live';await f.evaluate();const actions=f.actions();assert.equal(actions.length,1);f.apply(actions[0]);await f.evaluate();assert.deepEqual(f.actions(),[]);assert.deepEqual(plain(f.pool.stored.rows),[['New',7]]);
});

test('Live and a manual pulse in the same settled instant are rejected without losing stored values',async()=>{
  const f=fixture();await f.evaluate();f.target.inputValues.append=true;f.command({type:'replace',datasetId:'upstream',table:f.pool.upstream});await f.evaluate();const actions=f.actions();assert.equal(actions.length,2);for(const action of actions)assert.throws(()=>f.apply(action),/only one Dataset source update/);assert.deepEqual(f.pool.stored.rows,[['Old',1]]);await f.evaluate();assert.deepEqual(f.actions(),[]);
});
