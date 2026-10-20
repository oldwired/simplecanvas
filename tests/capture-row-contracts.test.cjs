const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'..','examples','capture-row.js'),'utf8');
const source=()=>vm.runInNewContext(script);
const plain=value=>JSON.parse(JSON.stringify(value));
const data={name:'Log',columns:[{key:'label',name:'Label',type:'string'},{key:'value',name:'Value',type:'number'},{key:'active',name:'Active',type:'boolean'}],rows:[]};
const snapshot=table=>({...table,rowCount:table.rows.length,rowIndices:table.rows.map((_,i)=>i)});
const ref={datasetId:'log'};
function runtime(){
  const ids=new WeakMap();let sequence=0;
  const componentRuntimeId=item=>{if(!ids.has(item))ids.set(item,'test-runtime-'+ ++sequence);return ids.get(item);};
  const scope=vm.createContext({TextEncoder,performance:{now:()=>0},datasets:{},smartCancelled:()=>Object.assign(new Error('Cancelled'),{cancelled:true}),
    normalizeSmartState:plain,smartNumber:v=>v,smartItemExecutions:new Map(),disposeSmartExecution:()=>{},componentRuntimeId});
  const ranges=[['// ---------- embedded datasets ----------','// End of embedded dataset contract.'],['  function componentScalar(','  function normalizeComponentSettings('],['  function componentGraphSignature(','  let editorComponentEvaluation=']];
  vm.runInContext(ranges.map(([a,b])=>html.slice(html.indexOf(a),html.indexOf(b))).join('\n')+
    '\nthis.api={runComponentEvaluation,settleComponentTimeline,createComponentTimeline,normalizeComponentOutputs,normalizeComponentPorts,normalizeComponentActionDeclarations,takeComponentDataActions,datasetCommand,componentRuntimeId};',scope);
  return scope.api;
}
function node(extra={}){return {uid:'capture',type:'smart',componentApi:2,script,state:source().initState(),bindings:{},
  inputValues:{data:ref,capture:false,field0:'First',field1:7,field2:true},...extra};}
function caller(api,custom={}){return async(item,hook,args)=>{
  const def=custom[item.script]||source(),state=args[0];
  if(hook==='caps')return {apiVersion:2,compute:typeof def.compute==='function',publish:typeof def.publish==='function',transition:typeof def.transition==='function',
    inputs:api.normalizeComponentPorts(typeof def.inputs==='function'?def.inputs(state):def.inputs,'input'),outputs:api.normalizeComponentPorts(typeof def.outputs==='function'?def.outputs(state):def.outputs,'output'),
    dataActions:typeof def.dataActions==='function'?def.dataActions(state):def.dataActions};
  return def[hook](...args);
};}

test('Capture row maps a bounded editable field list into stable scalar inputs and an append declaration',()=>{
  const def=source(),state=def.initState(),ports=plain(def.inputs(state));
  assert.equal(def.settings.fields.format,'lines');assert.equal(state.allowReaderCapture,false);
  assert.deepEqual(ports,{data:{type:'table'},capture:{role:'control',type:'boolean',default:false},field0:{type:'string',default:''},field1:{type:'number',default:0},field2:{type:'boolean',default:false}});
  assert.deepEqual(plain(def.dataActions(state)),{capture:{type:'appendRow',input:'data',trigger:'capture',fields:{label:'field0',value:'field1',active:'field2'}}});
  assert.equal(Object.keys(def.inputs({...state,fields:Array.from({length:24},(_,i)=>'column'+i+':number').join('\n')})).length,26);
  for(const fields of ['', 'same:number\nsame:string','value:date','constructor:string','no type',Array.from({length:25},(_,i)=>'x'+i+':number').join('\n')])assert.throws(()=>def.inputs({...state,fields}));
  assert.equal(def._fields({...state,fields:'  boat:name : string \r\n\nvalue:number '})[0].key,'boat:name');
});

test('Capture row requires a whole compatible table and never mutates it during computation',()=>{
  const def=source(),state=def.initState(),inputs=node().inputValues,before=JSON.stringify(data);
  assert.deepEqual(plain(def.compute(inputs,state,{tables:{data:snapshot(data)}})),{data:ref,rowCount:0});
  assert.equal(JSON.stringify(data),before);
  for(const patch of [{data:{datasetId:'~derived-1'}},{data:{datasetId:'log',rows:[]}},{field1:Infinity},{field1:Number.MAX_SAFE_INTEGER+1},{field0:7},{field2:'X'}])assert.throws(()=>def.compute({...inputs,...patch},state,{tables:{data:snapshot(data)}}));
  assert.throws(()=>def.compute(inputs,{...state,fields:'missing:number'},{tables:{data:snapshot(data)}}),/missing.*number/);
  assert.throws(()=>def.compute(inputs,{...state,fields:'value:string'},{tables:{data:snapshot(data)}}),/value.*string/);
  const children=def.children(state,def.initStyle(),320,150,false,{name:'Race log',inputs,outputs:{rowCount:0},tables:{inputs:{data:snapshot(data)}}});
  assert.ok(children.some(child=>child.text==='Race log'));assert.ok(children.some(child=>child.text==='0 rows'));
});

test('append declarations permit only scalar port mappings and reject extra effects',()=>{
  const api=runtime(),def=source(),state=def.initState(),ports=def.inputs(state),declaration=def.dataActions(state);
  assert.deepEqual(plain(api.normalizeComponentActionDeclarations(declaration,ports)),plain(declaration));
  const action=declaration.capture;
  for(const patch of [{fields:{}},{fields:[]},{fields:{value:'data'}},{fields:{value:'missing'}},{fields:{value:3}},{fields:{constructor:'field0'}},
    {fields:Object.fromEntries(Array.from({length:25},(_,i)=>['x'+i,'field1']))},{url:'https://example.invalid'},{type:'deleteRow'}])
    assert.throws(()=>api.normalizeComponentActionDeclarations({capture:{...action,...patch}},ports));
  assert.throws(()=>api.normalizeComponentActionDeclarations(declaration,{...ports,field2:{type:'boolean',unknown:true}}));
});

test('capture edges snapshot exact values and table revision; initial high, inspection and reload do not replay',async()=>{
  const api=runtime(),item=node(),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{log:{...data,revision:4,rowIds:[],nextRowId:0}}};
  item.inputValues.capture=true;await api.settleComponentTimeline([item],call,()=>true,timeline,options);
  assert.equal(api.takeComponentDataActions(timeline).length,0);
  item.inputValues.capture=false;await api.settleComponentTimeline([item],call,()=>true,timeline,options);
  item.inputValues.capture=true;await api.runComponentEvaluation([item],call,()=>true,options);
  assert.equal(timeline.dataActions.length,0,'pure graph inspection does not enqueue mutations');
  await api.settleComponentTimeline([item],call,()=>true,timeline,options);
  item.inputValues.field0='After pulse';item.inputValues.field1=99;item.inputValues.field2=false;
  await api.settleComponentTimeline([item],call,()=>true,timeline,options);
  const actions=api.takeComponentDataActions(timeline);assert.equal(actions.length,1);
  const intent=actions[0];assert.equal(intent.item,item);assert.equal(intent.type,'appendRow');
  assert.deepEqual(plain(intent.row),{label:'First',value:7,active:true});assert.deepEqual(plain(intent.reference),ref);
  assert.equal(intent.expectedRevision,4);assert.equal(intent.schema,JSON.stringify(data.columns));assert.equal(intent.script,script);assert.equal(intent.bindings,'{}');
  assert.equal(intent.runtimeId,api.componentRuntimeId(item));assert.equal(item.state.allowReaderCapture,false,'editor capture does not require HTML permission');
  assert.equal(api.takeComponentDataActions(timeline).length,0);
  const restored=api.createComponentTimeline();await api.settleComponentTimeline([plain(item)],call,()=>true,restored,options);assert.equal(api.takeComponentDataActions(restored).length,0);
});

test('multiple pending pulses retain their own samples and do not deduplicate against one target',async()=>{
  const api=runtime(),item=node(),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{log:data},timeline};
  await api.runComponentEvaluation([item],call,()=>true,options);
  for(const value of [10,20]){
    item.inputValues.capture=false;await api.runComponentEvaluation([item],call,()=>true,options);
    item.inputValues.capture=true;item.inputValues.field1=value;await api.runComponentEvaluation([item],call,()=>true,options);
  }
  const actions=api.takeComponentDataActions(timeline);assert.deepEqual(plain(actions.map(intent=>intent.row.value)),[10,20]);
  assert.equal(actions[0].expectedRevision,0);assert.equal(actions[1].expectedRevision,0);
  let pool={log:data};for(const intent of actions)pool=api.datasetCommand(pool,{type:'append',datasetId:intent.reference.datasetId,row:intent.row}).pool;
  assert.deepEqual(plain(pool.log.rows),[['First',10,true],['First',20,true]]);
});

test('historical replay and recovery from a failed capture input re-prime instead of appending',async()=>{
  const api=runtime(),item=node(),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{log:data},timeline};
  await api.runComponentEvaluation([item],call,()=>true,options);item.inputValues.capture=true;
  await api.runComponentEvaluation([item],call,()=>true,{...options,historical:true});await api.runComponentEvaluation([item],call,()=>true,options);
  assert.equal(api.takeComponentDataActions(timeline).length,0);
  item.inputValues.field1='bad';const failed=await api.runComponentEvaluation([item],call,()=>true,options);assert.ok(failed.get(item).error);
  item.inputValues.field1=3;await api.runComponentEvaluation([item],call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,0);
  item.inputValues.capture=false;await api.runComponentEvaluation([item],call,()=>true,options);item.inputValues.capture=true;
  await api.runComponentEvaluation([item],call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,1);
});

test('capture declaration cannot append to a row selection even when custom compute accepts it',async()=>{
  const api=runtime(),def=source(),state=def.initState(),item=node({script:'unchecked'}),timeline=api.createComponentTimeline();
  const custom={unchecked:{inputs:def.inputs(state),outputs:{},dataActions:def.dataActions(state),compute:()=>({})}},call=caller(api,custom),options={datasets:{log:data},timeline};
  item.inputValues.data={datasetId:'log',rows:[]};await api.runComponentEvaluation([item],call,()=>true,options);item.inputValues.capture=true;
  const records=await api.runComponentEvaluation([item],call,()=>true,options);assert.equal(records.get(item).error,undefined);
  const actions=api.takeComponentDataActions(timeline);assert.equal(actions.length,1,'the failed attempt reaches host completion handling');
  assert.match(actions[0].error,/whole embedded dataset/);assert.equal(actions[0].row,undefined);assert.deepEqual(data.rows,[]);
});

test('cancellation rolls back sampled actions and a saturated queue fails without leaking an extra row',async()=>{
  const api=runtime(),item=node(),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{log:data}};
  await api.settleComponentTimeline([item],call,()=>true,timeline,options);item.inputValues.capture=true;let valid=true;
  await assert.rejects(()=>api.settleComponentTimeline([item],async(...args)=>{const result=await call(...args);if(args[1]==='compute')valid=false;return result;},()=>valid,timeline,options),/Cancelled/);
  assert.equal(timeline.dataActions.length,0);await api.settleComponentTimeline([item],call,()=>true,timeline,options);assert.equal(api.takeComponentDataActions(timeline).length,1);
  let records;for(let i=0;i<65;i++){
    item.inputValues.capture=false;await api.runComponentEvaluation([item],call,()=>true,{...options,timeline});
    item.inputValues.capture=true;records=await api.runComponentEvaluation([item],call,()=>true,{...options,timeline});
  }
  assert.equal(timeline.dataActions.length,64);assert.match(records.get(item).error,/capture queue is full/);
});

function dispatchFixture(reader=false){
  const item=node(),timeline={dataActions:[]},calls=[],errors=[],entry={item},document={hidden:false,querySelector:()=>null};
  const scope=vm.createContext({Promise,items:[item],editorTimeline:timeline,timeline,activeTabId:'tab',epoch:1,entries:[entry],document,
    componentRuntimeId:()=> 'owned',takeComponentDataActions:t=>{const actions=t.dataActions;t.dataActions=[];return actions;},current:()=>true,
    smartGestureQueue:Promise.resolve(),gestureQueue:Promise.resolve(),toast:message=>errors.push(message),
    commitEditorDatasetCommand:async(intent,valid)=>{if(valid())calls.push(intent.row);},commitReaderDatasetCommand:async(intent,valid)=>{if(valid())calls.push(intent.row);}});
  const start=reader?'    function dispatchReaderComponentDataActions(':'  function dispatchEditorComponentDataActions(',end=reader?'    async function openReaderDataAction(':'  async function openEditorComponentDataAction(';
  vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end))+'\nthis.dispatch='+ (reader?'dispatchReaderComponentDataActions':'dispatchEditorComponentDataActions')+';',scope);
  return {item,timeline,scope,calls,errors,intent:value=>({type:'appendRow',item,runtimeId:'owned',script:item.script,bindings:'{}',row:{value}})};
}

test('editor dispatch preserves all sampled rows; stale source bindings cancel queued capture',async()=>{
  const f=dispatchFixture();f.timeline.dataActions=[f.intent(1),f.intent(2)];f.scope.dispatch(f.timeline,f.scope.items,'tab');await f.scope.smartGestureQueue;
  assert.deepEqual(f.calls,[{value:1},{value:2}]);
  let release;f.scope.smartGestureQueue=new Promise(resolve=>{release=resolve;});f.timeline.dataActions=[f.intent(3)];f.scope.dispatch(f.timeline,f.scope.items,'tab');
  f.item.bindings={data:{uid:'different',port:'data'}};release();await f.scope.smartGestureQueue;assert.equal(f.calls.length,2);assert.deepEqual(f.errors,[]);
});

test('reader dispatch requires explicit capture permission and never treats import permission as capture permission',async()=>{
  const f=dispatchFixture(true);f.item.state.allowReaderImport=true;f.timeline.dataActions=[f.intent(1)];f.scope.dispatch(f.timeline,f.scope.items,1);await f.scope.gestureQueue;assert.equal(f.calls.length,0);
  f.item.state.allowReaderCapture=true;f.timeline.dataActions=[f.intent(2)];f.scope.dispatch(f.timeline,f.scope.items,1);await f.scope.gestureQueue;assert.deepEqual(f.calls,[{value:2}]);
  let release;f.scope.gestureQueue=new Promise(resolve=>{release=resolve;});f.timeline.dataActions=[f.intent(3)];f.scope.dispatch(f.timeline,f.scope.items,1);
  f.item.state.allowReaderCapture=false;release();await f.scope.gestureQueue;assert.equal(f.calls.length,1);
});

test('reader capture failures show one replaceable visible notice and ignore cancelled work',async()=>{
  const f=dispatchFixture(true),notices=[];f.item.state.allowReaderCapture=true;
  f.scope.document.querySelector=()=>notices[0]||null;
  f.scope.document.createElement=()=>({dataset:{},style:{},setAttribute(name,value){this[name]=value;},remove(){notices.splice(notices.indexOf(this),1);}});
  f.scope.document.body={append:notice=>notices.push(notice)};
  let failure=new Error('Dataset row limit reached');f.scope.commitReaderDatasetCommand=async()=>{throw failure;};
  for(const message of ['Dataset row limit reached','Target dataset is no longer available']){
    failure=new Error(message);f.timeline.dataActions=[f.intent(1)];f.scope.dispatch(f.timeline,f.scope.items,1);await f.scope.gestureQueue;
    assert.equal(notices.length,1);assert.equal(notices[0].role,'alert');assert.equal(notices[0].textContent,message);
  }
  failure=Object.assign(new Error('Cancelled'),{cancelled:true});f.timeline.dataActions=[f.intent(2)];f.scope.dispatch(f.timeline,f.scope.items,1);await f.scope.gestureQueue;
  assert.equal(notices.length,1);assert.equal(notices[0].textContent,'Target dataset is no longer available');
});
