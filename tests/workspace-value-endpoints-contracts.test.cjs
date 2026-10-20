const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const source=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'));
function runtime(){
  const scope=vm.createContext({TextEncoder,performance:{now:()=>0},datasets:{},smartCancelled:()=>Object.assign(new Error('Cancelled'),{cancelled:true}),
    normalizeSmartState:plain,smartNumber:v=>v,smartItemExecutions:new Map(),disposeSmartExecution:()=>{}});
  const ranges=[['// ---------- embedded datasets ----------','// End of embedded dataset contract.'],
    ['  function componentScalar(','  function normalizeComponentSettings('],['  function componentGraphSignature(','  let editorComponentEvaluation=']];
  vm.runInContext(ranges.map(([a,b])=>html.slice(html.indexOf(a),html.indexOf(b))).join('\n')+
    '\nthis.api={componentGraphModel,runComponentEvaluation,createComponentTimeline,settleComponentTimeline,takeComponentDataActions,createWorkspaceRuntimeContext,normalizeComponentPorts,normalizeComponentEventPorts,normalizeComponentHybridEvents};',scope);
  return scope.api;
}
const row=(id,type)=>({id,name:id,type,description:''});
function item(uid,definition,patch={}){
  return {type:'smart',componentApi:2,script:uid,uid,state:definition.initState?.()||{},bindings:{},inputValues:{},definition,...patch};
}
const table={name:'Stock',columns:[{key:'name',name:'Name',type:'string'}],rows:[['Apples']]};
function fixture(){
  const api=runtime(),publish=source('publish'),receive=source('receive');
  const origin=item('origin',{inputs:{},outputs:{value:{type:'string'}},compute:()=>({value:'hello'})});
  const publisher=item('publisher',publish,{state:{endpoints:[row('first','string'),row('last','string'),row('rows','table')]},
    inputValues:{rows:{datasetId:'stock'}},bindings:{first:{uid:'origin',port:'value'},last:{uid:'return',port:'middle'}}});
  const back=item('return',receive,{state:{endpoints:[row('middle','string')]},
    workspaceReceive:{middle:{sketchId:'b',componentUid:'forward',port:'middle'}}});
  const receiver=item('receiver',receive,{state:{endpoints:[row('first','string'),row('last','string'),row('rows','table')]},
    workspaceReceive:Object.fromEntries(['first','last','rows'].map(port=>[port,{sketchId:'a',componentUid:'publisher',port}]))});
  const upper=item('upper',{inputs:{value:{type:'string'}},outputs:{value:{type:'string'}},compute:inputs=>({value:inputs.value.toUpperCase()})},
    {bindings:{value:{uid:'receiver',port:'first'}}});
  const forward=item('forward',publish,{state:{endpoints:[row('middle','string')]},bindings:{middle:{uid:'upper',port:'value'}}});
  const sink=item('sink',{inputs:{text:{type:'string'},data:{type:'table'}},outputs:{text:{type:'string'}},compute:inputs=>({text:inputs.text})},
    {bindings:{text:{uid:'receiver',port:'last'},data:{uid:'receiver',port:'rows'}}});
  const settings=item('settings',{inputs:{},outputs:{},compute:()=>({})},{workspaceSettings:true,state:{executionMode:'whole workspace'}});
  const docs=[{id:'a',name:'A',items:[publisher,back,origin,settings],datasets:{stock:table}},
    {id:'b',name:'B',items:[sink,forward,upper,receiver],datasets:{}}];
  const context=api.createWorkspaceRuntimeContext(docs,'a');
  const call=async(item,hook,args)=>{
    const def=item.definition,read=name=>typeof def[name]==='function'?def[name](args[0]):def[name];
    if(hook!=='caps')return def[hook](...args);
    const caps={apiVersion:2,eventApi:def.eventApi,compute:!!def.compute,onEvent:!!def.onEvent,datasetOwner:def.datasetOwner,dataActions:read('dataActions'),
      inputs:api.normalizeComponentPorts(read('inputs'),'input'),outputs:api.normalizeComponentPorts(read('outputs'),'output'),
      eventInputs:api.normalizeComponentEventPorts(read('eventInputs'),'input'),eventOutputs:api.normalizeComponentEventPorts(read('eventOutputs'),'output')};
    api.normalizeComponentHybridEvents(caps,read('eventTransform'));
    if(def.workspaceEndpoint)caps.workspaceEndpoint=read('workspaceEndpoint');
    return caps;
  };
  return {api,context,call,publisher,receiver,back,forward,sink,upper,origin};
}

test('an acyclic value path can revisit independent connector rows, including an unrelated table row',async()=>{
  const {api,context,call,publisher,receiver,sink}=fixture();
  const model=await api.componentGraphModel(context.scene,call,()=>true,context.pool);
  assert.equal(model.groups.some(group=>group.cyclic),false,'component-level round trip has no row-level cycle');
  const timeline=api.createComponentTimeline(()=>0);
  for(let pass=0;pass<2;pass++){
    const records=await api.runComponentEvaluation(context.scene,call,()=>true,{datasets:context.pool,timeline});
    assert.equal(records.size,context.scene.length,'public graph still has exactly one record per component');
    for(const record of records.values())assert.equal(record.error,undefined);
    assert.deepEqual(plain(records.get(publisher).io.outputs),{first:'hello',last:'HELLO',rows:{datasetId:'stock'}});
    assert.deepEqual(plain(records.get(receiver).io.outputs),{first:'hello',last:'HELLO',rows:{datasetId:'stock'}});
    assert.equal(records.get(sink).io.outputs.text,'HELLO');
    assert.deepEqual(plain(records.get(sink).io.tables.inputs.data.rows),[['Apples']]);
  }
});

test('a missing connector row does not block independent scalar or table rows',async()=>{
  const {api,context,call,publisher,receiver}=fixture();
  publisher.bindings.first={uid:'missing',port:'value'};
  publisher.bindings.last=undefined;delete publisher.bindings.last;publisher.inputValues.last='still available';
  const records=await api.runComponentEvaluation(context.scene,call,()=>true,{datasets:context.pool});
  assert.match(records.get(receiver).outputErrors.first.error,/unavailable/);
  assert.equal(records.get(receiver).io.outputs.last,'still available');
  assert.deepEqual(plain(records.get(receiver).io.outputs.rows),{datasetId:'stock'});
  assert.equal(records.get(receiver).outputErrors.last,undefined);
});

test('a broken event-only import reports its own error while current values remain available',async()=>{
  const {api,context,call,receiver,sink}=fixture();
  receiver.state.endpoints.push(row('notice','event'));
  receiver.workspaceReceive.notice={sketchId:'a',componentUid:'missing',port:'notice'};
  const records=await api.runComponentEvaluation(context.scene,call,()=>true,{datasets:context.pool});
  assert.match(records.get(receiver).outputErrors.notice.error,/Published endpoint is missing/);
  assert.equal(records.get(sink).error,undefined);
  assert.equal(records.get(sink).io.outputs.text,'HELLO');
});

test('a genuine same-row table feedback cycle is rejected without poisoning the other endpoint rows',async()=>{
  const {api,context,call,publisher,receiver}=fixture();
  const sameSketch=receiver.definition,echo=item('echo',sameSketch,{state:{endpoints:[row('rows','table')]},
    workspaceReceive:{rows:{sketchId:'a',componentUid:'publisher',port:'rows'}}});
  context.documents[0].items.push(echo);context.scene.push(echo);context.sketchByUid.set('echo','a');
  publisher.bindings.rows={uid:'echo',port:'rows'};delete publisher.inputValues.rows;
  const model=await api.componentGraphModel(context.scene,call,()=>true,context.pool);
  assert.equal(model.groups.filter(group=>group.cyclic).length,1);
  const records=await api.runComponentEvaluation(context.scene,call,()=>true,{datasets:context.pool});
  assert.match(records.get(publisher).outputErrors.rows.error,/Table components cannot form feedback loops/);
  assert.equal(records.get(receiver).io.outputs.first,'hello');
  assert.equal(records.get(receiver).io.outputs.last,'HELLO');
});

test('an oscillating Boolean row still hits the feedback limit without faulting sibling rows',async()=>{
  const {api,context,call,publisher,receiver,back,forward,sink}=fixture();
  for(const node of [publisher,receiver,back,forward]){
    node.state.endpoints.push(row('loop','boolean'));node.signalState={loop:false};
  }
  publisher.bindings.loop={uid:'return',port:'loop'};
  receiver.workspaceReceive.loop={sketchId:'a',componentUid:'publisher',port:'loop'};
  back.workspaceReceive.loop={sketchId:'b',componentUid:'forward',port:'loop'};
  const invert=item('invert',{inputs:{value:{type:'boolean'}},outputs:{value:{type:'boolean'}},compute:inputs=>({value:!inputs.value})},
    {bindings:{value:{uid:'receiver',port:'loop'}},signalState:{value:false}});
  forward.bindings.loop={uid:'invert',port:'value'};
  context.documents[1].items.push(invert);context.scene.push(invert);context.sketchByUid.set('invert','b');
  const records=await api.runComponentEvaluation(context.scene,call,()=>true,{datasets:context.pool});
  assert.match(records.get(receiver).outputErrors.loop.error,/Feedback did not settle/);
  assert.equal(records.get(sink).error,undefined);
  assert.equal(records.get(sink).io.outputs.text,'HELLO');
  assert.deepEqual(plain(records.get(sink).io.tables.inputs.data.rows),[['Apples']]);
});

test('oversized combined connector table previews fall back to references without breaking healthy wires',async()=>{
  const {api,context,call,publisher,receiver,sink}=fixture();
  const ports=Array.from({length:14},(_,i)=>'table'+i),large={name:'Wide table',
    columns:Array.from({length:32},(_,i)=>({key:'c'+i,name:'Column '+i,type:'string'})),
    rows:Array.from({length:24},()=>Array.from({length:32},()=> 'x'.repeat(160)))};
  context.pool.stock=large;context.documents[0].datasets.stock=large;
  for(const node of [publisher,receiver])node.state.endpoints=[row('first','string'),row('last','string'),...ports.map(port=>row(port,'table'))];
  delete publisher.inputValues.rows;delete receiver.workspaceReceive.rows;
  for(const port of ports){
    publisher.inputValues[port]={datasetId:'stock'};
    receiver.workspaceReceive[port]={sketchId:'a',componentUid:'publisher',port};
  }
  sink.bindings.data.port=ports[0];
  const records=await api.runComponentEvaluation(context.scene,call,()=>true,{datasets:context.pool});
  assert.match(records.get(publisher).io.presentationWarning,/2-million-character/);
  assert.match(records.get(receiver).io.presentationWarning,/2-million-character/);
  for(const record of records.values())assert.equal(record.error,undefined);
  assert.equal(records.get(sink).io.outputs.text,'HELLO');
  assert.equal(records.get(sink).io.tables.inputs.data.rowCount,24);
  for(const port of ports)assert.deepEqual(plain(records.get(receiver).io.outputs[port]),{datasetId:'stock'});
});

test('healthy feedback rows retain their latest value across evaluations despite a broken sibling',async()=>{
  const {api,context,call,publisher}=fixture();
  publisher.state.endpoints.push(row('memory','boolean'));
  publisher.bindings.first={uid:'missing',port:'value'};
  publisher.bindings.memory={uid:'latch',port:'value'};
  publisher.signalState={memory:false,first:'stale'};
  const latch=item('latch',{inputs:{value:{type:'boolean',unknown:true},set:{type:'boolean',default:false}},
    outputs:{value:{type:'boolean',unknown:true}},compute:inputs=>({value:inputs.set?true:inputs.value})},
    {bindings:{value:{uid:'publisher',port:'memory'}},inputValues:{set:true},signalState:{value:false}});
  context.documents[0].items.push(latch);context.scene.push(latch);context.sketchByUid.set('latch','a');
  const timeline=api.createComponentTimeline(()=>0),options={datasets:context.pool,timeline};
  let records=await api.runComponentEvaluation(context.scene,call,()=>true,options);
  assert.match(records.get(publisher).outputErrors.first.error,/Missing source/);
  assert.equal(records.get(publisher).io.outputs.memory,true);
  assert.deepEqual(plain(publisher.signalState),{memory:true},'only healthy cyclic values enter persistent signal state');
  assert.equal(timeline.observations.get(publisher).outputs.memory,true);
  assert.equal(Object.hasOwn(timeline.observations.get(publisher).outputs,'first'),false);
  latch.inputValues.set=false;
  records=await api.runComponentEvaluation(context.scene,call,()=>true,options);
  assert.equal(records.get(publisher).outputErrors.memory,undefined);
  assert.equal(records.get(publisher).io.outputs.memory,true,'removing Set preserves the value captured while its sibling was broken');
  publisher.bindings.memory={uid:'missing',port:'value'};
  await api.runComponentEvaluation(context.scene,call,()=>true,options);
  assert.equal(publisher.signalState,undefined,'a failed row must not retain its old signal state');
  assert.equal(Object.hasOwn(timeline.observations.get(publisher).outputs,'memory'),false);
});

test('Live Dataset provenance ignores unrelated endpoint rows and prunes removed row publications',async()=>{
  const {api,context,call,publisher,receiver}=fixture(),definition=source('data-source');
  publisher.state.endpoints.push(row('clock','number'));publisher.inputValues.clock=0;
  const owned={...table,name:'Editable copy',rows:[['Edited locally']]};
  context.pool.target=owned;context.documents[1].datasets.target=owned;context.datasetSketches.set('target','b');
  const target=item('target-owner',definition,{state:{...definition.initState(),updateMode:'Live'},
    inputValues:{data:{datasetId:'target'}},bindings:{source:{uid:'receiver',port:'rows'}}});
  context.documents[1].items.push(target);context.scene.push(target);context.sketchByUid.set(target.uid,'b');
  const timeline=api.createComponentTimeline(()=>0),options={datasets:context.pool,timeline};
  let records=await api.runComponentEvaluation(context.scene,call,()=>true,options);
  assert.equal(records.get(target).error,undefined);
  assert.equal(api.takeComponentDataActions(timeline).length,0,'initial restore only establishes the Live source baseline');
  const tableKey='publisher\u0000rows',clockKey='publisher\u0000clock';
  const revision=timeline.publications.get(tableKey).revision,clockRevision=timeline.publications.get(clockKey).revision;
  publisher.inputValues.clock=1;
  await api.runComponentEvaluation(context.scene,call,()=>true,options);
  assert.equal(timeline.publications.get(tableKey).revision,revision);
  assert.ok(timeline.publications.get(clockKey).revision>clockRevision);
  assert.equal(api.takeComponentDataActions(timeline).length,0,'an unrelated clock must not overwrite edits in a Live Dataset');
  context.pool.stock={...table,rows:[['Actual source refresh']]};context.documents[0].datasets.stock=context.pool.stock;
  await api.runComponentEvaluation(context.scene,call,()=>true,options);
  const actions=api.takeComponentDataActions(timeline);
  assert.equal(actions.length,1);assert.equal(actions[0].type,'syncTable');
  assert.deepEqual(plain(actions[0].table.rows),[['Actual source refresh']]);
  publisher.state.endpoints=publisher.state.endpoints.filter(row=>row.id!=='clock');delete publisher.inputValues.clock;
  await api.runComponentEvaluation(context.scene,call,()=>true,options);
  assert.equal(timeline.publications.has(clockKey),false,'removed ports release their publication revisions');
  assert.equal(api.takeComponentDataActions(timeline).length,0,'removing an unrelated port does not refresh the source table');
  assert.equal(records.get(receiver).io.outputs.rows.datasetId,'stock');
});
