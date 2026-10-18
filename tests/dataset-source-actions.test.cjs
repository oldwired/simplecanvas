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

test('Dataset ownership and source actions have explicit validated contracts',()=>{
  const api=runtime(),def=definition('data-source');assert.equal(def.datasetOwner,'data');assert.equal(def.settings.allowReaderUpdates.default,false);
  assert.equal(api.normalizeComponentPorts(def.inputs).source.optional,true);assert.equal(api.normalizeDatasetOwner('data',def.inputs),'data');
  for(const port of [{type:'number',optional:true},{type:'table',optional:1}])assert.throws(()=>api.normalizeComponentPorts({source:port}));
  assert.throws(()=>api.normalizeDatasetOwner('source',def.inputs));
  const actions=api.normalizeComponentActionDeclarations(def.dataActions(def.initState()),def.inputs);assert.deepEqual(plain(actions.replace),{type:'replaceTable',input:'data',source:'source',trigger:'replace'});
  assert.throws(()=>api.normalizeComponentActionDeclarations({replace:{...actions.replace,source:'replace'}},def.inputs));
});

test('a missing or invalid optional source never disables owned output and update pulses surface errors',async()=>{
  const api=runtime(),item=owner(),timeline=api.createComponentTimeline(),call=caller(api,{reader:readerDef}),options={datasets:{stored:table},timeline};
  let records=await api.runComponentEvaluation([item,reader],call,()=>true,options);
  assert.equal(records.get(item).error,undefined);assert.deepEqual(plain(records.get(reader).io.outputs),{count:1});assert.equal(records.datasetOwners.get('stored').uid,'owner');
  assert.equal(Object.keys(records.datasets).includes('datasetOwners'),false);
  item.inputValues.replace=true;records=await api.runComponentEvaluation([item,reader],call,()=>true,options);
  const [intent]=api.takeComponentDataActions(timeline);assert.match(intent.error,/Source table/);assert.equal(records.get(item).error,undefined);assert.equal(records.get(reader).io.outputs.count,1);
  assert.throws(()=>api.prepareDatasetTableAction(intent,records.get(item),records.datasets),/Source table/);
  item.bindings.source={uid:'missing',port:'data'};item.inputValues.replace=false;await api.runComponentEvaluation([item,reader],call,()=>true,options);
  item.inputValues.replace=true;records=await api.runComponentEvaluation([item,reader],call,()=>true,options);
  assert.equal(records.get(reader).io.outputs.count,1);assert.match(api.takeComponentDataActions(timeline)[0].error,/Missing source/);
});

test('Dataset → sort → its own Source is an explicit update path, not combinational table feedback',async()=>{
  const api=runtime(),item=owner({bindings:{source:{uid:'sort',port:'data'}}}),sort={type:'smart',componentApi:2,uid:'sort',script:'table-sort',state:{},bindings:{data:{uid:'owner',port:'data'}},inputValues:{column:'value',direction:'descending'}},timeline=api.createComponentTimeline(),call=caller(api);
  const options={datasets:{stored:{...table,rows:[['Low',1],['High',9]]}},timeline};
  let records=await api.runComponentEvaluation([sort,item],call,()=>true,options);for(const record of records.values())assert.equal(record.error,undefined);
  item.inputValues.replace=true;records=await api.runComponentEvaluation([sort,item],call,()=>true,options);
  const [intent]=api.takeComponentDataActions(timeline);assert.deepEqual(plain(intent.table.rows),[['High',9],['Low',1]]);
  const next=api.datasetCommand(options.datasets,api.prepareDatasetTableAction(intent,records.get(item),records.datasets));assert.deepEqual(plain(next.table.rows),[['High',9],['Low',1]]);
});

test('table actions snapshot derived source rows once and reader updates require their own permission',async()=>{
  const api=runtime(),item=owner({bindings:{source:{uid:'sample',port:'data'}}}),source=sample(),timeline=api.createComponentTimeline(),call=caller(api,{sample:sampleDef}),options={datasets:{stored:table},timeline};
  await api.runComponentEvaluation([item,source],call,()=>true,options);item.inputValues.append=true;
  await api.runComponentEvaluation([item,source],call,()=>true,options);source.state.value=99;
  const records=await api.runComponentEvaluation([item,source],call,()=>true,options),[intent]=api.takeComponentDataActions(timeline);
  assert.deepEqual(plain(intent.table.rows),[['Captured',4]]);assert.equal(records.get(item).io.tables.inputs.source.rows[0][1],99);
  const command=api.prepareDatasetTableAction(intent,records.get(item),records.datasets);assert.equal(command.type,'appendMany');
  assert.deepEqual(plain(api.datasetCommand(options.datasets,command).table.rows),[['Old',1],['Captured',4]]);
  item.state.allowReaderImport=true;assert.throws(()=>api.prepareDatasetTableAction(intent,records.get(item),records.datasets,true),/disabled/);
  item.state.allowReaderUpdates=true;assert.equal(api.prepareDatasetTableAction(intent,records.get(item),records.datasets,true).type,'appendMany');
});

test('simultaneous Replace and Append are rejected together without hiding stored outputs',async()=>{
  const api=runtime(),item=owner({bindings:{source:{uid:'sample',port:'data'}}}),source=sample(),timeline=api.createComponentTimeline(),call=caller(api,{sample:sampleDef}),options={datasets:{stored:table},timeline};
  await api.runComponentEvaluation([item,source],call,()=>true,options);item.inputValues.replace=item.inputValues.append=true;
  const records=await api.runComponentEvaluation([item,source],call,()=>true,options),intents=api.takeComponentDataActions(timeline);
  assert.equal(intents.length,2);for(const intent of intents)assert.throws(()=>api.prepareDatasetTableAction(intent,records.get(item),records.datasets),/either Replace or Append/);
  assert.equal(records.get(item).error,undefined);assert.equal(records.get(item).io.outputs.rowCount,1);assert.deepEqual(table.rows,[['Old',1]]);
});

test('initial-high, historical replay, held signals, and canceled settlement do not duplicate source writes',async()=>{
  const api=runtime(),item=owner({inputValues:{data:{datasetId:'stored'},source:{datasetId:'stored'},append:true}}),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{stored:table}};
  await api.settleComponentTimeline([item],call,()=>true,timeline,options);assert.equal(api.takeComponentDataActions(timeline).length,0);
  item.inputValues.append=false;await api.settleComponentTimeline([item],call,()=>true,timeline,options);item.inputValues.append=true;
  let valid=true;await assert.rejects(()=>api.settleComponentTimeline([item],async(...args)=>{const result=await call(...args);if(args[1]==='compute')valid=false;return result;},()=>valid,timeline,options),/Cancelled/);
  assert.equal(timeline.dataActions.length,0);await api.settleComponentTimeline([item],call,()=>true,timeline,options);assert.equal(api.takeComponentDataActions(timeline).length,1);
  await api.settleComponentTimeline([item],call,()=>true,timeline,options);assert.equal(api.takeComponentDataActions(timeline).length,0);
});

test('invalid or duplicated owners never grant editing authority',async()=>{
  const api=runtime(),call=caller(api,{broken:{...definition('data-source'),compute(){throw new Error('bad stored publisher');}}}),options={datasets:{stored:table}};
  for(const items of [[owner({script:'broken'})],[owner(),owner({uid:'duplicate'}),owner({uid:'third'})]]){
    const records=await api.runComponentEvaluation(items,call,()=>true,options);assert.equal(records.datasetOwners.size,0);for(const record of records.values())assert.ok(record.error);
  }
});

test('Replace refuses a newer target revision while AppendMany remains an atomic compatible append',async()=>{
  const api=runtime(),item=owner({inputValues:{data:{datasetId:'stored'},source:{datasetId:'stored'},replace:false,append:false}}),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{stored:table},timeline};
  await api.runComponentEvaluation([item],call,()=>true,options);item.inputValues.replace=true;
  let records=await api.runComponentEvaluation([item],call,()=>true,options);const [intent]=api.takeComponentDataActions(timeline);
  const changed=api.datasetCommand(options.datasets,{type:'append',datasetId:'stored',row:{name:'New',value:9}}).pool;
  records=await api.runComponentEvaluation([item],call,()=>true,{...options,datasets:changed});
  const command=api.prepareDatasetTableAction(intent,records.get(item),records.datasets);assert.throws(()=>api.datasetCommand(changed,command),/Dataset changed/);assert.equal(changed.stored.rows.length,2);
});

test('source changes settle before sampling an update, including a sequence of single-round steps',async()=>{
  for(const step of [false,true]){
    const api=runtime(),item=owner({bindings:{source:{uid:'sample',port:'data'}}}),source=sample(),timeline=api.createComponentTimeline(),call=caller(api,{sample:sampleDef}),options={datasets:{stored:table},timeline};
    await api.runComponentEvaluation([item,source],call,()=>true,options);source.state.value=17;item.inputValues.append=true;
    await api.runComponentEvaluation([item,source],call,()=>true,{...options,step});
    if(step){assert.equal(api.takeComponentDataActions(timeline).length,0);for(let i=0;timeline.pendingTime!==null&&i<10;i++)await api.runComponentEvaluation([item,source],call,()=>true,{...options,step});}
    const [intent]=api.takeComponentDataActions(timeline);assert.deepEqual(plain(intent.table.rows),[['Captured',17]]);assert.equal(intent.pendingSnapshot,undefined);
  }
});

test('action dependencies re-prime on a changed trigger definition without creating a table SCC',async()=>{
  const api=runtime(),item=owner({bindings:{source:{uid:'sample',port:'data'},append:{uid:'trigger',port:'value'}}}),source=sample(),trigger={type:'smart',componentApi:2,uid:'trigger',script:'off',state:{},bindings:{},inputValues:{}};
  const timeline=api.createComponentTimeline(),call=caller(api,{sample:sampleDef,off:{inputs:{},outputs:{value:{type:'boolean'}},compute:()=>({value:false})},on:{inputs:{},outputs:{value:{type:'boolean'}},compute:()=>({value:true})}}),options={datasets:{stored:table},timeline};
  await api.runComponentEvaluation([item,source,trigger],call,()=>true,options);trigger.script='on';
  const records=await api.runComponentEvaluation([item,source,trigger],call,()=>true,options);assert.equal(records.get(item).error,undefined);assert.equal(api.takeComponentDataActions(timeline).length,0);
});

test('owner metadata does not collide with valid dataset IDs and revokes authority after late failure',async()=>{
  const api=runtime(),item=owner({inputValues:{data:{datasetId:'datasetOwners'}}}),options={datasets:{datasetOwners:table}};
  let records=await api.runComponentEvaluation([item],caller(api),()=>true,options);assert.equal(records.datasets.datasetOwners.rows[0][0],'Old');assert.equal(records.datasetOwners.get('datasetOwners').uid,'owner');
  let calls=0;const def={...definition('data-source'),compute(inputs,state,context){if(++calls>1)throw new Error('Owner stopped');return {data:inputs.data,rowCount:context.tables.data.rowCount};}};
  const view={type:'smart',componentApi:2,uid:'view',script:'reader',state:{},bindings:{},inputValues:{data:{datasetId:'datasetOwners'}}};
  records=await api.runComponentEvaluation([item,view],caller(api,{'data-source':def,reader:readerDef}),()=>true,options);
  assert.match(records.get(item).error,/Owner stopped/);assert.equal(records.datasetOwners.size,0);assert.equal(records.get(view).io.tables.inputs.data.editable,false);
});

test('pending table snapshots share a two-million-character budget',async()=>{
  const api=runtime(),large={name:'Large',columns:[{key:'text',name:'Text',type:'string'}],rows:Array.from({length:200},()=>['x'.repeat(1900)])};
  const item=owner({inputValues:{data:{datasetId:'stored'},source:{datasetId:'source'},append:false}}),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{stored:{...large,rows:[]},source:large},timeline};
  await api.runComponentEvaluation([item],call,()=>true,options);
  for(let i=0;i<6;i++){item.inputValues.append=true;await api.runComponentEvaluation([item],call,()=>true,{...options,now:i});item.inputValues.append=false;await api.runComponentEvaluation([item],call,()=>true,{...options,now:i+.5});}
  const actions=api.takeComponentDataActions(timeline);assert.equal(actions.length,6);assert.equal(actions.filter(action=>action.table).length,5);assert.match(actions[5].error,/2-million-character/);
  assert.ok(actions.reduce((n,action)=>n+(action.table?JSON.stringify(action.table).length:0),0)<=2000000);
});

test('a paused Step keeps the accepted source instant when a later edit arrives before settlement',async()=>{
  const api=runtime(),item=owner({bindings:{source:{uid:'sample',port:'data'}}}),source=sample(),timeline=api.createComponentTimeline(()=>0),call=caller(api,{sample:sampleDef}),options={datasets:{stored:table}};
  await api.settleComponentTimeline([item,source],call,()=>true,timeline,options);timeline.pausedByUser=true;
  source.state.value=17;item.inputValues.append=true;
  await api.settleComponentTimeline([item,source],call,()=>true,timeline,{...options,step:true});assert.notEqual(timeline.pendingTime,null);assert.equal(timeline.dataActions[0].pendingSnapshot,true);
  source.state.value=99;timeline.elapsed=10;
  await api.settleComponentTimeline([item,source],call,()=>true,timeline,options);
  const [intent]=api.takeComponentDataActions(timeline);assert.deepEqual(plain(intent.table.rows),[['Captured',17]]);assert.equal(source.state.value,99);assert.equal(intent.runtimeId,'owner');
});

test('a full update queue preserves its 64 commands and surfaces one bounded error notice',async()=>{
  const api=runtime(),item=owner({inputValues:{data:{datasetId:'stored'},source:{datasetId:'stored'},append:false}}),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{stored:table},timeline};
  await api.runComponentEvaluation([item],call,()=>true,options);let records;
  for(let i=0;i<66;i++){item.inputValues.append=true;records=await api.runComponentEvaluation([item],call,()=>true,{...options,now:i});item.inputValues.append=false;await api.runComponentEvaluation([item],call,()=>true,{...options,now:i+.5});}
  assert.equal(records.get(item).error,undefined);assert.equal(records.get(item).io.outputs.rowCount,1);
  assert.equal(timeline.dataActions.length,64);assert.equal(timeline.dataActionErrors.length,1);
  const intents=api.takeComponentDataActions(timeline);assert.equal(intents.filter(intent=>intent.table).length,64);assert.match(intents.at(-1).error,/queue is full/);assert.equal(api.takeComponentDataActions(timeline).length,0);
});

test('a nonsettling owner loses write authority while a direct reader remains available',async()=>{
  const api=runtime(),item=owner({script:'unstable',bindings:{signal:{uid:'owner',port:'value'}},inputValues:{data:{datasetId:'stored'}}}),view={...reader,bindings:{},inputValues:{data:{datasetId:'stored'}}};let calls=0;
  const unstable={datasetOwner:'data',inputs:{data:{type:'table'},signal:{type:'boolean',default:false}},outputs:{data:{type:'table'},value:{type:'boolean'}},compute(inputs){return {data:inputs.data,value:!!(++calls%2)};}};
  const records=await api.runComponentEvaluation([item,view],caller(api,{unstable,reader:readerDef}),()=>true,{datasets:{stored:table}});
  assert.match(records.get(item).error,/did not settle/);assert.equal(records.datasetOwners.size,0);assert.equal(records.get(view).error,undefined);assert.equal(records.get(view).io.tables.inputs.data.editable,false);
});
