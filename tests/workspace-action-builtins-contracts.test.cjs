const {parseApp}=require('./helpers/app-source.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const source=name=>vm.runInNewContext(fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8'));
const helper=parseApp(html).declaration;
function api(){
  const names=['componentPortName','componentScalar','normalizeComponentEventPorts','normalizeComponentEvents',
    'normalizeComponentHybridEvents','normalizeComponentActionDeclarations','normalizeComponentActionEvents',
    'normalizeSmartState','smartNumber','componentValue','normalizeComponentOutputs','transformComponentEvent'];
  return vm.runInNewContext(names.map(helper).join('\n')+'\n({'+names.join(',')+'})',{
    MAX_STATE_JSON:4000,isNum:value=>typeof value==='number' && Number.isFinite(value)
  });
}
function deliveryApi(){
  const names=['componentPortName','componentScalar','normalizeComponentEventPorts','normalizeComponentEvents',
    'normalizeComponentHybridEvents','normalizeComponentActionDeclarations','normalizeComponentActionEvents',
    'normalizeSmartState','smartNumber','componentValue','normalizeComponentOutputs','transformComponentEvent',
    'componentTableSnapshot','datasetReference','datasetOwnersOf','componentEventPayloadType','componentReplyEvents','componentEventBinding',
    'captureComponentActionIntent','smartCancelled','prepareComponentEventDelivery','componentWorkspace','componentRuntimeBindings',
    'workspaceEndpointCaps'];
  const datasets=html.slice(html.indexOf('// ---------- embedded datasets ----------'),html.indexOf('// End of embedded dataset contract.'));
  return vm.runInNewContext(datasets+'\n'+names.map(helper).join('\n')+'\n({'+names.join(',')+'})',{
    MAX_STATE_JSON:4000,isNum:value=>typeof value==='number' && Number.isFinite(value),
    componentRuntimeId:item=>'runtime-'+item.uid,
    componentViewIo:(item,io)=>({...io,name:item.componentName||'',runtimeId:'runtime-'+item.uid})
  });
}
function definitionCaps(def){
  const state=def.initState(),runtime=api(),inputs=typeof def.inputs==='function'?def.inputs(state):def.inputs;
  const caps={apiVersion:2,eventApi:def.eventApi,compute:typeof def.compute==='function',onEvent:typeof def.onEvent==='function',
    inputs,outputs:typeof def.outputs==='function'?def.outputs(state):def.outputs,
    eventInputs:runtime.normalizeComponentEventPorts(typeof def.eventInputs==='function'?def.eventInputs(state):def.eventInputs,'input'),
    eventOutputs:runtime.normalizeComponentEventPorts(typeof def.eventOutputs==='function'?def.eventOutputs(state):def.eventOutputs,'output'),
    dataActions:runtime.normalizeComponentActionDeclarations(typeof def.dataActions==='function'?def.dataActions(state):def.dataActions,inputs)};
  runtime.normalizeComponentHybridEvents(caps,def.eventTransform);
  caps.actionEvents=runtime.normalizeComponentActionEvents(def.actionEvents,caps);
  if(def.workspaceEndpoint)caps.workspaceEndpoint=def.workspaceEndpoint(state);
  return caps;
}

test('local action builtins declare event commands on their existing trigger inputs',()=>{
  for(const [name,triggers] of [
    ['capture-row',['capture']],['data-source',['replace','append','reload']],
    ['go-to-tab',['go']],['data-download',['csv','json']]
  ]){
    const def=source(name),caps=definitionCaps(def);
    assert.equal(def.eventApi,1,name);
    for(const trigger of triggers){
      const port=caps.inputs[trigger];
      assert.equal(port.type,'boolean',name+'.'+trigger+' keeps Boolean signals');
      assert.equal(port.default,false);
      assert.equal(port.event,'action');
      assert.ok(Object.values(caps.dataActions).some(action=>action.trigger===trigger));
      assert.equal(caps.eventInputs[trigger].hybrid,true);
    }
    assert.equal(def.onEvent,undefined,'the host captures and dispatches action requests');
    assert.equal(def.transition,undefined,'actions are not persisted in component scheduling state');
    for(const [key,port] of Object.entries(caps.inputs)){
      if(!triggers.includes(key))assert.equal(port.event,undefined,key+' is a captured value, not an action trigger');
    }
  }
});

test('Dataset completions distinguish file load, source replacement and append and keep their own payload contracts',()=>{
  const caps=definitionCaps(source('data-source'));
  assert.deepEqual(plain(caps.actionEvents),{
    importDataset:{success:'loaded',failure:'failed'},reloadDataset:{success:'loaded',failure:'failed'},
    replaceTable:{success:'replaced',failure:'failed'},appendTable:{success:'appended',failure:'failed'},
    syncTable:{success:'replaced',failure:'failed'}
  });
  for(const name of ['loaded','replaced','appended'])assert.deepEqual(plain(caps.eventOutputs[name].types),['number']);
  assert.deepEqual(plain(caps.eventOutputs.failed.types),['string']);
  const state=source('data-source').initState();
  assert.equal(state.allowReaderUpdates,false);
  assert.equal(state.allowReaderImport,false);
});

test('navigation reports the reached zero-based sketch and download reports preparation rather than disk success',()=>{
  const go=definitionCaps(source('go-to-tab')),download=definitionCaps(source('data-download'));
  assert.deepEqual(plain(go.actionEvents),{goToTab:{success:'arrived',failure:'failed'}});
  assert.deepEqual(plain(go.eventOutputs.arrived.types),['number']);
  assert.deepEqual(plain(download.actionEvents),{downloadTable:{success:'prepared',failure:'failed'}});
  assert.deepEqual(plain(download.eventOutputs.prepared.types),['string']);
  for(const format of ['csv','json'])assert.deepEqual(plain(download.dataActions[format]),{
    type:'downloadTable',input:'data',trigger:format,format,filename:'filename'
  });
  const def=source('data-download'),handles=plain(def.handles(def.initState(),320,150,def.initStyle(),{inputs:{filename:'chosen-name'}}));
  assert.equal(handles.length,2,'existing explicit click buttons remain available');
  assert.equal(handles[0].action.filename,'chosen-name','button handles still capture literal filenames');
});

test('JSON build fields update values quietly and Emit/Reprocess is its only event driver',()=>{
  const def=source('json-build'),caps=definitionCaps(def),state=def.initState();
  assert.deepEqual(plain(caps.eventTransform),{inputs:[],outputs:['text','valid'],reprocess:'reprocess'});
  assert.deepEqual(Object.keys(caps.eventInputs),['reprocess']);
  assert.equal(caps.inputs.reprocess.label,'Emit / Reprocess');
  const before=JSON.stringify(state);
  for(const field0 of ['first','second','second']){
    const result=def.compute({field0,field1:2.8,reprocess:true},state);
    assert.equal(result.text,JSON.stringify({name:field0,value:2.8}));
    assert.equal(result.events,undefined,'a redraw or field edit produces no event');
  }
  assert.equal(JSON.stringify(state),before);
});

test('JSON build emits one captured batch per command, preserves repeated identical messages, and ignores false commands',async()=>{
  const def=source('json-build'),caps=definitionCaps(def),runtime=api(),state=def.initState();
  const item={state,inputValues:{},bindings:{}},io={inputs:{field0:'Anna',field1:2.8,reprocess:false}};
  const call=async(_,hook,args)=>def[hook](...args);
  const emit=payload=>runtime.transformComponentEvent(item,caps,'reprocess',payload,state,io,call);
  const first=await emit(true),second=await emit(null),third=await emit(true);
  for(const result of [first,second,third]){
    assert.deepEqual(plain(result[Symbol.for('simplecanvas.events')]),[
      {port:'text',payload:'{"name":"Anna","value":2.8}'},{port:'valid',payload:true}
    ]);
    assert.equal(result[Symbol.for('simplecanvas.eventBatch')],true,'JSON and validity share the same origin');
    assert.equal(JSON.stringify(result),JSON.stringify(state),'event metadata is not persisted');
  }
  io.inputs.field0='Later';
  assert.equal(first[Symbol.for('simplecanvas.events')][0].payload,'{"name":"Anna","value":2.8}','captured JSON cannot drift after editing inputs');
  assert.equal((await emit(true))[Symbol.for('simplecanvas.events')][0].payload,'{"name":"Later","value":2.8}');
  assert.equal((await emit(false))[Symbol.for('simplecanvas.events')],undefined);
});

test('action commands accept scalar and payload-free occurrences while retaining Boolean false suppression',()=>{
  const caps=definitionCaps(source('capture-row'));
  assert.deepEqual(plain(caps.eventInputs.capture.types),['none','boolean','number','string']);
  assert.equal(caps.eventInputs.capture.action,true);assert.equal(caps.eventInputs.capture.command,true);
  const runtime=api();
  assert.throws(()=>runtime.normalizeComponentHybridEvents({
    inputs:{run:{type:'boolean',event:'action'}},outputs:{},eventInputs:{},eventOutputs:{},dataActions:{}
  }),/declared host action/);
  assert.throws(()=>runtime.normalizeComponentActionDeclarations({
    csv:{type:'downloadTable',input:'data',trigger:'csv',format:'xml'}
  },{data:{type:'table'},csv:{type:'boolean'}}),/CSV or JSON/);
});

const data=()=>({name:'Log',revision:3,columns:[
  {key:'label',name:'Label',type:'string'},{key:'value',name:'Value',type:'number'},{key:'active',name:'Active',type:'boolean'}
],rows:[['old',1,true]],rowIds:['r0'],nextRowId:1});
const item=(uid,extra={})=>({uid,type:'smart',componentApi:2,script:uid,state:{},bindings:{},inputValues:{},...extra});
const eventState=events=>Object.defineProperty({},Symbol.for('simplecanvas.events'),{value:events});

test('Text submit captures a row directly, retains identical occurrences, and stages actions outside persistent state',async()=>{
  const runtime=deliveryApi(),capture=source('capture-row'),caps=definitionCaps(capture);
  const input=item('input'),target=item('capture',{
    state:capture.initState(),bindings:{field0:{uid:'input',port:'value'}},eventBindings:{capture:{uid:'input',port:'value'}}
  }),scene=[input,target],before=JSON.stringify(scene);
  const records=new Map([
    [input,{caps:{apiVersion:2,eventApi:1,inputs:{},outputs:{value:{type:'string',event:true}},eventInputs:{},eventOutputs:{value:{types:['string'],type:'string',hybrid:true}}},io:{inputs:{},outputs:{value:'old'}}}],
    [target,{caps,io:{inputs:{data:{datasetId:'log'},capture:false,field0:'old',field1:2.8,field2:false},outputs:{}}}]
  ]);records.datasets={log:data()};
  const result=await runtime.prepareComponentEventDelivery(scene,input,eventState([
    {port:'value',payload:'same'},{port:'value',payload:'same'}
  ]),async()=>{throw new Error('Host action must not call script onEvent');},()=>true,records);
  const actions=result[Symbol.for('simplecanvas.actionIntents')];
  assert.equal(actions.length,2);assert.notEqual(actions[0],actions[1]);
  for(const action of actions){
    assert.equal(action.type,'appendRow');assert.equal(action.item,target);assert.equal(action.event,true);
    assert.equal(action.runtimeId,'runtime-capture');assert.equal(action.script,target.script);
    assert.equal(action.bindings,JSON.stringify(target.bindings));assert.equal(action.eventBindings,JSON.stringify(target.eventBindings));
    assert.deepEqual(plain(action.row),{label:'same',value:2.8,active:false});
    assert.equal(action.expectedRevision,3);assert.equal(action.error,undefined);
  }
  assert.notEqual(actions[0].origin,actions[1].origin);
  assert.equal(JSON.stringify(scene),before);assert.equal(result.size,1,'capturing actions does not fabricate receiver state edits');
});

test('action capture waits for related value calculations and keeps each occurrence’s companion values',async()=>{
  const runtime=deliveryApi(),capture=source('capture-row'),caps=definitionCaps(capture);
  const input=item('input'),multiply=item('multiply',{bindings:{value:{uid:'input',port:'value'}}}),target=item('capture',{
    state:capture.initState(),bindings:{field1:{uid:'multiply',port:'value'}},eventBindings:{capture:{uid:'input',port:'value'}}
  });
  const records=new Map([
    [input,{caps:{apiVersion:2,eventApi:1,inputs:{},outputs:{value:{type:'number',event:true}},eventInputs:{},eventOutputs:{value:{types:['number'],type:'number',hybrid:true}}},io:{inputs:{},outputs:{value:0}}}],
    [multiply,{caps:{apiVersion:2,compute:true,inputs:{value:{type:'number'}},outputs:{value:{type:'number'}}},io:{inputs:{value:0},outputs:{value:0}}}],
    [target,{caps,io:{inputs:{data:{datasetId:'log'},capture:false,field0:'sample',field1:0,field2:true},outputs:{}}}]
  ]);records.datasets={log:data()};
  const result=await runtime.prepareComponentEventDelivery([target,multiply,input],input,eventState([
    {port:'value',payload:3},{port:'value',payload:4}
  ]),async(target,hook,[inputs])=>{
    assert.equal(target,multiply);assert.equal(hook,'compute');return {value:inputs.value*2};
  },()=>true,records);
  assert.deepEqual(plain(result[Symbol.for('simplecanvas.actionIntents')].map(action=>action.row.value)),[6,8]);
});

test('false commands do nothing; zero and empty text still represent accepted action occurrences',async()=>{
  const runtime=deliveryApi(),go=source('go-to-tab'),target=item('go',{state:go.initState(),eventBindings:{go:{uid:'input',port:'value'}}});
  for(const [type,payload,expected] of [['boolean',false,0],['boolean',true,1],['number',0,1],['string','',1],['none',null,1]]){
    const input=item('input'),records=new Map([
      [input,{caps:{apiVersion:2,eventApi:1,eventInputs:{},eventOutputs:{value:{types:[type],type}}},io:{inputs:{},outputs:{}}}],
      [target,{caps:definitionCaps(go),io:{inputs:{page:2,parameters:'{"name":"Anna"}',go:false},outputs:{}}}]
    ]);
    const result=await runtime.prepareComponentEventDelivery([input,target],input,eventState([{port:'value',payload}]),async()=>{},()=>true,records);
    const actions=result[Symbol.for('simplecanvas.actionIntents')];assert.equal(actions.length,expected,type);
    if(expected){assert.equal(actions[0].page,2);assert.equal(actions[0].parametersText,'{"name":"Anna"}');}
  }
});

test('table actions capture complete independent rows and download names, while capture errors become failed intents',()=>{
  const runtime=deliveryApi(),pool={log:data(),incoming:{...data(),name:'Incoming',rows:[['new',5,false]],revision:1}};
  const def=source('data-source'),owner=item('owner',{state:def.initState()}),record={
    caps:{...definitionCaps(def),datasetOwner:'data'},
    io:{inputs:{data:{datasetId:'log'},source:{datasetId:'incoming'},replace:false,append:false,reload:false}}
  };
  const replace=runtime.captureComponentActionIntent(owner,'replace',record,pool);
  assert.equal(replace.error,undefined);assert.deepEqual(plain(replace.table.rows),[['new',5,false]]);
  pool.incoming.rows[0][0]='changed';assert.equal(replace.table.rows[0][0],'new');
  const download=source('data-download'),downloader=item('download'),downloadRecord={
    caps:definitionCaps(download),io:{inputs:{data:{datasetId:'log'},filename:'snapshot',csv:false,json:false}}
  };
  const prepared=runtime.captureComponentActionIntent(downloader,'csv',downloadRecord,pool);
  assert.equal(prepared.filename,'snapshot');assert.equal(prepared.filenameInput,'filename');assert.equal(prepared.format,'csv');
  downloadRecord.io.inputs.filename='later';pool.log.rows[0][1]=99;
  assert.equal(prepared.filename,'snapshot');assert.equal(prepared.table.rows[0][1],1);
  const broken=runtime.captureComponentActionIntent(owner,'replace',{...record,error:'Missing input'},pool);
  assert.equal(broken.error,'Missing input');assert.equal(broken.table,undefined);
});

test('Publish and Receive remain transparent to a reconverging event origin across sketches',async()=>{
  const runtime=deliveryApi(),publish=source('publish'),receive=source('receive');
  const input=item('input'),upper=item('upper',{bindings:{text:{uid:'input',port:'value'}}});
  const first=item('first',{state:publish.initState(),bindings:{value:{uid:'input',port:'value'}}});
  const second=item('second',{state:publish.initState(),bindings:{value:{uid:'upper',port:'text'}}});
  const left=item('left',{state:receive.initState(),workspaceReceive:{value:{sketchId:'services',componentUid:'first',port:'value'}}});
  const right=item('right',{state:receive.initState(),workspaceReceive:{value:{sketchId:'services',componentUid:'second',port:'value'}}});
  const compose=item('compose',{bindings:{a:{uid:'left',port:'value'},b:{uid:'right',port:'value'}}});
  const log=item('log',{eventBindings:{line:{uid:'compose',port:'text'}},state:{lines:[]}});
  const scene=[log,compose,right,left,second,first,upper,input],context={whole:true,
    sketchByUid:new Map([[first.uid,'services'],[second.uid,'services']]),duplicates:new Set()};
  Object.defineProperty(scene,Symbol.for('simplecanvas.workspace'),{value:context});
  const recvCaps=()=>runtime.workspaceEndpointCaps(definitionCaps(receive));
  const upperCaps={apiVersion:2,eventApi:1,compute:true,inputs:{text:{type:'string',event:true},reprocess:{type:'boolean',event:'command',default:false}},
    outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
  runtime.normalizeComponentHybridEvents(upperCaps,{input:'text',outputs:['text'],reprocess:'reprocess'});
  const composeCaps={apiVersion:2,eventApi:1,compute:true,inputs:{a:{type:'string',event:true},b:{type:'string',event:true},reprocess:{type:'boolean',event:'command',default:false}},
    outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
  runtime.normalizeComponentHybridEvents(composeCaps,{inputs:['a','b'],outputs:['text'],reprocess:'reprocess'});
  const records=new Map([
    [input,{caps:{apiVersion:2,eventApi:1,inputs:{},outputs:{value:{type:'string',event:true}},eventInputs:{},eventOutputs:{value:{types:['string'],hybrid:true}}},io:{outputs:{value:'old'}}}],
    [upper,{caps:upperCaps,io:{inputs:{text:'old',reprocess:false},outputs:{text:'OLD'}}}],
    [first,{caps:definitionCaps(publish),io:{inputs:{value:'old'},outputs:{value:'old'}}}],
    [second,{caps:definitionCaps(publish),io:{inputs:{value:'OLD'},outputs:{value:'OLD'}}}],
    [left,{caps:recvCaps(),io:{inputs:{__remote_value:'old'},outputs:{value:'old'}}}],
    [right,{caps:recvCaps(),io:{inputs:{__remote_value:'OLD'},outputs:{value:'OLD'}}}],
    [compose,{caps:composeCaps,io:{inputs:{a:'old',b:'OLD',reprocess:false},outputs:{text:'old|OLD'}}}],
    [log,{caps:{apiVersion:2,eventApi:1,onEvent:true,inputs:{},outputs:{},eventInputs:{line:{types:['string']}},eventOutputs:{}},io:{inputs:{},outputs:{}}}]
  ]);
  const changes=await runtime.prepareComponentEventDelivery(scene,input,eventState([{port:'value',payload:'hello'}]),async(target,hook,args)=>{
    if(target===upper){assert.equal(hook,'compute');return {text:args[0].text.toUpperCase()};}
    if(target===compose){assert.equal(hook,'compute');return {text:args[0].a+'|'+args[0].b};}
    if(target===log){assert.equal(hook,'onEvent');return {lines:[...args[2].lines,args[1]]};}
    throw new Error('Transparent connectors must not create separate script event occurrences');
  },()=>true,records);
  assert.deepEqual(plain(changes.get(log).lines),['hello|HELLO']);
  assert.equal(changes.has(first),false);assert.equal(changes.has(left),false);
});

test('event-only endpoints preserve scalar payloads and a disabled cross-sketch link delivers nothing',async()=>{
  const runtime=deliveryApi(),input=item('input'),publisher=item('publisher',{eventBindings:{value:{uid:'input',port:'value'}}}),
    receiver=item('receiver',{workspaceReceive:{value:{sketchId:'services',componentUid:'publisher',port:'value'}}}),
    target=item('target',{eventBindings:{go:{uid:'receiver',port:'value'}}});
  const eventPort={types:['none','boolean','number','string'],type:'scalar'};
  const records=new Map([
    [input,{caps:{apiVersion:2,eventApi:1,eventInputs:{},eventOutputs:{value:eventPort}},io:{inputs:{},outputs:{}}}],
    [publisher,{caps:{apiVersion:2,eventApi:1,compute:true,onEvent:true,workspaceEndpoint:{direction:'publish',ports:{value:{type:'event'}}},inputs:{},outputs:{},eventInputs:{value:eventPort},eventOutputs:{value:eventPort}},io:{inputs:{},outputs:{}}}],
    [receiver,{caps:{apiVersion:2,eventApi:1,compute:true,onEvent:true,workspaceEndpoint:{direction:'receive',ports:{value:{type:'event'}}},inputs:{},outputs:{},eventInputs:{__remote_value:eventPort},eventOutputs:{value:eventPort}},io:{inputs:{},outputs:{}}}],
    [target,{caps:definitionCaps(source('go-to-tab')),io:{inputs:{page:1,parameters:'{}',go:false},outputs:{}}}]
  ]);
  const scene=[input,publisher,receiver,target],context={whole:true,sketchByUid:new Map([['publisher','services']]),duplicates:new Set()};
  Object.defineProperty(scene,Symbol.for('simplecanvas.workspace'),{value:context});
  const run=()=>runtime.prepareComponentEventDelivery(scene,input,eventState([{port:'value',payload:0}]),async()=>{throw new Error('No script event boundary');},()=>true,records);
  assert.equal((await run())[Symbol.for('simplecanvas.actionIntents')].length,1);
  context.whole=false;
  assert.equal((await run())[Symbol.for('simplecanvas.actionIntents')].length,0);
});

test('independent connector rows allow a sequential path through one block but reject a true row cycle',async()=>{

 const runtime=deliveryApi(),create=(uid,extra={})=>({uid,type:'smart',componentApi:2,script:uid,state:{},inputValues:{},bindings:{},...extra});
 const input=create('input'),pub=create('pub',{bindings:{a:{uid:'input',port:'value'},b:{uid:'upper',port:'text'}}}),recv=create('recv',{workspaceReceive:{a:{sketchId:'same',componentUid:'pub',port:'a'},b:{sketchId:'same',componentUid:'pub',port:'b'}}}),upper=create('upper',{bindings:{text:{uid:'recv',port:'a'}}}),log=create('log',{eventBindings:{line:{uid:'recv',port:'b'}},state:{lines:[]}});
 const descriptors={a:{type:'string',event:true},b:{type:'string',event:true}},eventPorts={a:{types:['string'],hybrid:true},b:{types:['string'],hybrid:true}};
 const pcap={apiVersion:2,eventApi:1,compute:true,onEvent:true,workspaceEndpoint:{direction:'publish',ports:{a:{type:'string'},b:{type:'string'}}},inputs:descriptors,outputs:descriptors,eventInputs:eventPorts,eventOutputs:eventPorts};
 const rcap=runtime.workspaceEndpointCaps({...pcap,workspaceEndpoint:{direction:'receive',ports:{a:{type:'string'},b:{type:'string'}}}});
 const upperCaps={apiVersion:2,eventApi:1,compute:true,inputs:{text:{type:'string',event:true},reprocess:{type:'boolean',event:'command',default:false}},outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
 runtime.normalizeComponentHybridEvents(upperCaps,{input:'text',outputs:['text'],reprocess:'reprocess'});
 const records=new Map([[input,{caps:{apiVersion:2,eventApi:1,eventOutputs:{value:{types:['string'],hybrid:true}},outputs:{value:{type:'string',event:true}},inputs:{},eventInputs:{}},io:{outputs:{value:'old'}}}],[pub,{caps:pcap,io:{inputs:{a:'old',b:'OLD'},outputs:{a:'old',b:'OLD'}}}],[recv,{caps:rcap,io:{inputs:{__remote_a:'old',__remote_b:'OLD'},outputs:{a:'old',b:'OLD'}}}],[upper,{caps:upperCaps,io:{inputs:{text:'old',reprocess:false},outputs:{text:'OLD'}}}],[log,{caps:{apiVersion:2,eventApi:1,onEvent:true,eventInputs:{line:{types:['string']}},inputs:{},outputs:{},eventOutputs:{}},io:{inputs:{},outputs:{}}}]]);
 const scene=[input,pub,recv,upper,log];Object.defineProperty(scene,Symbol.for('simplecanvas.workspace'),{value:{whole:true,sketchByUid:new Map([['pub','same']]),duplicates:new Set()}});
 const next=Object.defineProperty({},Symbol.for('simplecanvas.events'),{value:[{port:'value',payload:'hello'}]});
 const call=async(target,fn,args)=>target===upper?{text:args[0].text.toUpperCase()}:{lines:[...args[2].lines,args[1]]};
 const changes=await runtime.prepareComponentEventDelivery(scene,input,next,call,()=>true,records);
 assert.deepEqual(plain(changes.get(log).lines),['HELLO']);
 // A real dependency returning to the same row is still a cycle.
 pub.eventBindings={a:{uid:'input',port:'value'}};
 pub.bindings.a={uid:'recv',port:'b'};
 await assert.rejects(runtime.prepareComponentEventDelivery(scene,input,next,call,()=>true,records),/dependency cycle/i);
});
