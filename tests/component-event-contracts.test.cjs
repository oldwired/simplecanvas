const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function helper(name){
  const match=new RegExp('  (?:async )?function '+name+'\\(').exec(html);
  assert.ok(match,name+' is present');
  const source=html.slice(match.index),end=/\n  (?:async )?(?:function |const |let )/.exec(source);
  return end?source.slice(0,end.index):source;
}
function api(){
  const names=['componentPortName','componentScalar','normalizeComponentEventPorts','normalizeComponentEvents',
    'componentEventPayloadType','componentReplyEvents','componentEventBinding','normalizeComponentHybridEvents','transformComponentEvent','normalizeSmartState','smartNumber','componentValue','normalizeComponentOutputs','smartCancelled','prepareComponentEventDelivery'];
  return vm.runInNewContext(names.map(helper).join('\n')+'\n({'+names.join(',')+'})',{
    MAX_STATE_JSON:4000,isNum:value=>typeof value==='number' && Number.isFinite(value),
    componentViewIo:(item,io)=>({...io,name:item.componentName||'',runtimeId:'test',boundInputs:Object.keys(item.bindings||{})})
  });
}
const item=(uid,extra={})=>({type:'smart',componentApi:2,uid,script:'script-'+uid,state:{count:0},...extra});
const eventState=(count,events=[])=>Object.defineProperty({count},Symbol.for('simplecanvas.events'),{value:events});
function capabilities(inputs={},outputs={}){
  const normalize=api().normalizeComponentEventPorts;
  return {apiVersion:2,eventApi:1,onEvent:true,eventInputs:normalize(inputs,'input'),eventOutputs:normalize(outputs,'output')};
}
const ports={value:{type:'string'}};
const records=entries=>new Map(entries.map(([item,caps])=>[item,{caps,io:{inputs:{},outputs:{}}}]));

test('event declarations and emissions preserve types and reject malformed, unbounded, or ambiguous payloads',()=>{
  const {normalizeComponentEventPorts:normalize,normalizeComponentEvents:events}=api();
  assert.deepEqual(plain(normalize({append:{types:['string','number'],label:' Append ',side:'top'}},'input')),
    {append:{types:['string','number'],type:'scalar',role:'control',label:'Append',side:'top'}});
  assert.deepEqual(plain(events([{port:'tick',payload:null},{port:'value',payload:2.8},{port:'value',payload:2.8}])),
    [{port:'tick',payload:null},{port:'value',payload:2.8},{port:'value',payload:2.8}]);
  for(const descriptor of [{type:'table'},{types:[]},{types:['number','number']},{type:'string',types:['string']},{type:'string',label:''}])
    assert.throws(()=>normalize({value:descriptor},'input'));
  assert.throws(()=>normalize({value:{types:['string','number']}},'output'),/payload types/);
  assert.equal(Object.keys(normalize(Object.fromEntries(Array.from({length:32},(_,i)=>['e'+i,{type:'none'}])),'input')).length,32);
  assert.throws(()=>normalize(Object.fromEntries(Array.from({length:33},(_,i)=>['e'+i,{type:'none'}])),'input'),/32 event/);
  assert.throws(()=>normalize(Object.fromEntries(Array.from({length:17},(_,i)=>['e'+i,{type:'none'}])),'output'),/16 event/);
  for(const payload of [undefined,NaN,Infinity,{},[],()=>{},'x'.repeat(2001)])assert.throws(()=>events([{port:'value',payload}]));
  for(const value of [[{port:'value'}],[{port:'value',payload:1,extra:true}],Array(17).fill({port:'value',payload:null})])assert.throws(()=>events(value));
});

test('event propagation finishes each occurrence, keeps equal submissions, and stages receiver state without mutating the scene',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  const source=item('source'),first=item('first',{eventBindings:{value:{uid:'source',port:'value'}}}),
    second=item('second',{eventBindings:{value:{uid:'source',port:'value'}}}),
    child=item('child',{eventBindings:{value:{uid:'first',port:'value'}}});
  const scene=[source,first,second,child],before=JSON.stringify(scene),seen=[];
  const graph=records(scene.map(node=>[node,capabilities(ports,ports)]));
  const changes=await prepare(scene,source,eventState(1,[{port:'value',payload:'same'},{port:'value',payload:'same'}]),
    async(target,hook,[name,payload,state])=>{
      assert.equal(hook,'onEvent');assert.equal(name,'value');seen.push(target.uid+':'+payload);
      return eventState(state.count+1,target===first?[{port:'value',payload}]:[]);
    },()=>true,graph);
  assert.deepEqual(seen,['first:same','second:same','child:same','first:same','second:same','child:same']);
  for(const node of [first,second,child])assert.equal(changes.get(node).count,2,'each receiver sees its prior staged result');
  assert.equal(JSON.stringify(scene),before,'delivery only returns a proposal for the host to commit');
  assert.equal(JSON.stringify(changes.get(first)),'{"count":2}','events are transient metadata, not durable state');
});

test('one source event uses receiver declaration order and payload-free Clear accepts null',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),source=item('source'),target=item('target',{eventBindings:{append:{uid:'source',port:'value'},set:{uid:'source',port:'value'}}});
  const graph=records([[source,capabilities({},ports)],[target,capabilities({set:{type:'string'},append:{type:'string'}})]]),seen=[];
  await prepare([source,target],source,eventState(1,[{port:'value',payload:'x'}]),async(_,__,[name,___,state])=>{
    seen.push(name);return eventState(state.count+1);
  },()=>true,graph);
  assert.deepEqual(seen,['set','append']);
  source.eventBindings={};target.eventBindings={clear:{uid:'source',port:'value'}};
  const clearGraph=records([[source,capabilities({},{value:{type:'none'}})],[target,capabilities({clear:{type:'none'}})]]);
  let called=0;
  await prepare([source,target],source,eventState(1,[{port:'value',payload:null}]),async(_,__,[name,payload,state])=>{
    assert.equal(name,'clear');assert.equal(payload,null);called++;return state;
  },()=>true,clearGraph);assert.equal(called,1);
});

test('a receiver failure or invalid payload rejects the whole proposal without partial state changes',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),source=item('source'),a=item('a',{eventBindings:{value:{uid:'source',port:'value'}}}),
    b=item('b',{eventBindings:{value:{uid:'source',port:'value'}}}),scene=[source,a,b],before=JSON.stringify(scene);
  const graph=records(scene.map(node=>[node,capabilities(ports,ports)]));
  await assert.rejects(prepare(scene,source,eventState(1,[{port:'value',payload:'ok'}]),async(target,_,[__,___,state])=>{
    if(target===b)throw new Error('receiver failed');return eventState(state.count+1);
  },()=>true,graph),/receiver failed/);
  assert.equal(JSON.stringify(scene),before);
  for(const event of [{port:'missing',payload:'ok'},{port:'value',payload:42}]){
    let calls=0;
    await assert.rejects(prepare(scene,source,eventState(1,[event]),async()=>{calls++;},()=>true,graph),/Undeclared event|incompatible payload/);
    assert.equal(calls,0);assert.equal(JSON.stringify(scene),before);
  }
  graph.get(b).caps=capabilities({value:{type:'number'}},ports);
  await assert.rejects(prepare(scene,source,eventState(1,[{port:'value',payload:'text'}]),async(_,__,[___,____,state])=>eventState(state.count+1),()=>true,graph),/Incompatible event receiver/);
  assert.equal(JSON.stringify(scene),before);
});

test('affected event feedback fails visibly and leaves the scene untouched',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),source=item('source',{eventBindings:{value:{uid:'source',port:'value'}}}),scene=[source];
  const graph=records([[source,capabilities(ports,ports)]]),before=JSON.stringify(scene);let calls=0;
  await assert.rejects(prepare(scene,source,eventState(1,[{port:'value',payload:'again'}]),async(_,__,[___,payload,state])=>{
    calls++;return eventState(state.count+1,[{port:'value',payload}]);
  },()=>true,graph),/cycle|feedback|limit reached/i);
  assert.ok(calls<=128,'a cycle cannot keep executing indefinitely');assert.equal(JSON.stringify(scene),before);
});

test('changed scenes, scripts, state, or bindings cancel an in-flight event transaction',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  for(const change of ['valid','source-state','receiver-script','event-binding','signal-binding','event-mode']){
    const source=item('source'),target=item('target',{eventBindings:{value:{uid:'source',port:'value'}}}),scene=[source,target];
    const graph=records(scene.map(node=>[node,capabilities(ports,ports)]));let current=true;
    await assert.rejects(prepare(scene,source,eventState(1,[{port:'value',payload:'new'}]),async()=>{
      if(change==='valid')current=false;
      if(change==='source-state')source.state.count=10;
      if(change==='receiver-script')target.script='changed';
      if(change==='event-binding')target.eventBindings.value.port='other';
      if(change==='event-mode')target.eventModes={value:'value'};
      if(change==='signal-binding')target.bindings={value:{uid:'other',port:'x'}};
      return eventState(1);
    },()=>current,graph),error=>error.cancelled===true,change);
    assert.equal(target.state.count,0,'the stale receiver result never commits');
  }
});

test('unresolved sources never dispatch and duplicate component identities are rejected',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),source=item('source'),target=item('target',{eventBindings:{value:{uid:'source',port:'value',unresolved:true}}});
  const graph=records([[source,capabilities({},ports)],[target,capabilities(ports)]]);let calls=0;
  const next=eventState(1,[{port:'value',payload:'ignored'}]);
  const changes=await prepare([source,target],source,next,async()=>{calls++;},()=>true,graph);
  assert.equal(calls,0);assert.equal(changes.size,1);
  await assert.rejects(prepare([source,target,item('source')],source,next,async()=>{},()=>true,graph),/unavailable/);
});

test('hybrid declarations add event capability to ordinary scalar ports and validate pure transformation contracts',()=>{
  const {normalizeComponentHybridEvents:normalize}=api();
  const caps={compute:true,inputs:{text:{type:'string',event:true},start:{type:'number'},reprocess:{type:'boolean',event:'command'}},outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
  normalize(caps,{input:'text',outputs:['text'],reprocess:'reprocess'});
  assert.equal(caps.eventInputs.text.hybrid,true);assert.deepEqual(plain(caps.eventInputs.text.types),['string']);
  assert.equal(caps.eventInputs.reprocess.command,true);assert.deepEqual(plain(caps.eventInputs.reprocess.types),['none','boolean']);
  assert.equal(caps.eventInputs.start,undefined,'parameter input is value-only');assert.equal(caps.eventOutputs.text.hybrid,true);
  assert.deepEqual(plain(caps.eventTransform),{input:'text',outputs:['text'],reprocess:'reprocess'});
  assert.throws(()=>normalize({...caps,eventInputs:{text:{types:['string']}},eventOutputs:{}},undefined),/separate event port/);
  for(const patch of [{publish:true},{transition:true},{compute:false}]){
    const next={...caps,...patch,eventInputs:{},eventOutputs:{}};
    assert.throws(()=>normalize(next,{input:'text',outputs:['text'],reprocess:'reprocess'}),/pure compute/);
  }
});

test('multi-driver transforms declare distinct scalar event inputs and reject incomplete or ambiguous contracts',()=>{
  const {normalizeComponentHybridEvents:normalize}=api();
  const makeCaps=()=>({compute:true,inputs:{a:{type:'string',event:true},b:{type:'string',event:true},separator:{type:'string'},reprocess:{type:'boolean',event:'command'}},
    outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}});
  const descriptor={inputs:['a','b'],outputs:['text'],reprocess:'reprocess'},caps=makeCaps();
  normalize(caps,descriptor);
  assert.deepEqual(plain(caps.eventTransform),descriptor);
  assert.equal(caps.eventInputs.a.hybrid,true);assert.equal(caps.eventInputs.b.hybrid,true);
  assert.equal(caps.eventInputs.separator,undefined,'formatting parameters do not emit transform events');
  descriptor.inputs.reverse();
  assert.deepEqual(plain(caps.eventTransform.inputs),['a','b'],'normalization copies the declared driver list');
  const single=makeCaps();single.inputs.b.event=undefined;
  normalize(single,{inputs:['a'],outputs:['text'],reprocess:'reprocess'});
  assert.deepEqual(plain(single.eventTransform.inputs),['a'],'the plural form also allows a single driver');
  const invalid=[
    {inputs:[]},{inputs:'a'},{inputs:['a','a']},{inputs:['a','missing']},{inputs:['a','separator']},
    {inputs:['a','reprocess']},{inputs:['a',null]},{inputs:['a',{}]},{inputs:['a']},
    {input:'a',inputs:['a','b']},{inputs:Array.from({length:17},(_,i)=>'input'+i)}
  ];
  for(const patch of invalid)assert.throws(()=>normalize(makeCaps(),{inputs:['a','b'],outputs:['text'],reprocess:'reprocess',...patch}),undefined,JSON.stringify(patch));
  assert.throws(()=>normalize(makeCaps(),{outputs:['text'],reprocess:'reprocess'}),'a transform must choose one driver declaration form');
  for(const patch of [{publish:true},{transition:true},{compute:false}]){
    assert.throws(()=>normalize({...makeCaps(),...patch},{inputs:['a','b'],outputs:['text'],reprocess:'reprocess'}),/pure compute/);
  }
  const table=makeCaps();table.inputs.rows={type:'table'};
  normalize(table,{inputs:['a','b'],outputs:['text'],reprocess:'reprocess'});
  assert.equal(table.eventInputs.rows,undefined,'dataset side inputs supply values without triggering events');
  const tableOutput=makeCaps();tableOutput.outputs.rows={type:'table'};
  assert.throws(()=>normalize(tableOutput,{inputs:['a','b'],outputs:['text'],reprocess:'reprocess'}),/scalar driving inputs/,'transform results remain scalar');
  const additional=makeCaps();additional.eventInputs.other={types:['string'],type:'string'};
  assert.throws(()=>normalize(additional,{inputs:['a','b'],outputs:['text'],reprocess:'reprocess'}),'every event input must be a driver or the Reprocess command');
  const bounded=count=>{
    const drivers=Array.from({length:count},(_,i)=>'input'+i),caps=makeCaps();
    caps.inputs={...Object.fromEntries(drivers.map(name=>[name,{type:'string',event:true}])),reprocess:{type:'boolean',event:'command'}};
    return {caps,descriptor:{inputs:drivers,outputs:['text'],reprocess:'reprocess'}};
  };
  const limit=bounded(15);normalize(limit.caps,limit.descriptor);
  assert.equal(Object.keys(limit.caps.eventInputs).length,16,'pure transforms keep fifteen data drivers plus Reprocess');
  const over=bounded(16);assert.throws(()=>normalize(over.caps,over.descriptor),/scalar driving inputs/);
});

test('selector metadata validates distinct Boolean choices without widening the pure transform contract',()=>{
  const {normalizeComponentHybridEvents:normalize}=api();
  const makeCaps=()=>({compute:true,inputs:{a:{type:'string',event:true},b:{type:'string',event:true},select:{type:'boolean',event:true},reprocess:{type:'boolean',event:'command'}},
    outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}});
  const descriptor={inputs:['a','b','select'],outputs:['text'],reprocess:'reprocess',selection:{input:'select',choices:['a','b']}},caps=makeCaps();
  normalize(caps,descriptor);descriptor.selection.choices.reverse();
  assert.deepEqual(plain(caps.eventTransform.selection),{input:'select',choices:['a','b']},'normalization copies the declared choices');
  for(const selection of [null,{},[],{input:'select',choices:['a']},{input:'select',choices:['a','a']},{input:'select',choices:['a','missing']},
    {input:'select',choices:['a','select']},{input:'a',choices:['b','select']},{input:'select',choices:['a','b'],extra:1}]){
    assert.throws(()=>normalize(makeCaps(),{...descriptor,selection}),/Invalid event selector/,JSON.stringify(selection));
  }
});

test('selector events forward only selected data while Select and Reprocess explicitly sample the current selection',async()=>{
  const {normalizeComponentHybridEvents:normalize,transformComponentEvent:transform,componentReplyEvents:events}=api();
  const caps={compute:true,inputs:{a:{type:'string',event:true},b:{type:'string',event:true},select:{type:'boolean',event:true},reprocess:{type:'boolean',event:'command',default:false}},
    outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
  normalize(caps,{inputs:['a','b','select'],outputs:['text'],reprocess:'reprocess',selection:{input:'select',choices:['a','b']}});
  const target=item('selector'),io={inputs:{a:'A',b:'B',select:false,reprocess:false}};
  const compute=async(_,__,[inputs])=>({text:inputs.select?inputs.b:inputs.a});
  for(const [name,payload,related,expected] of [
    ['a','new A',{},'new A'],['b','new B',{},null],['select',true,{},'B'],
    ['select',false,{},'A'],['reprocess',null,{},'A'],['reprocess',false,{},null],
    ['a','new A',{b:'new B',select:true},'new B'],['b','new B',{a:'new A'},'new A']
  ]){
    const result=await transform(target,caps,name,payload,target.state,io,compute,related);
    assert.deepEqual(plain(events(result)),expected===null?[]:[{port:'text',payload:expected}],[name,payload,related].join(' / '));
  }
});

test('event transforms receive complete immutable dataset side-input snapshots and reject stale or truncated tables',async()=>{
  const {normalizeComponentHybridEvents:normalize,transformComponentEvent:transform,componentReplyEvents:events}=api();
  const caps={compute:true,inputs:{select:{type:'number',event:true},data:{type:'table'},reprocess:{type:'boolean',event:'command',default:false}},
    outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
  normalize(caps,{input:'select',outputs:['text'],reprocess:'reprocess'});
  const target=item('dropdown'),table={datasetId:'choices',columns:[{key:'text',type:'string'}],rows:Array.from({length:40},(_,i)=>['Row '+i]),rowCount:40};
  const io={inputs:{select:0,data:{datasetId:'choices'},reprocess:false},tables:{inputs:{data:table}}},before=JSON.stringify(io);
  let calls=0;
  const compute=async(_,hook,[inputs,__,context])=>{
    calls++;assert.equal(hook,'compute');assert.deepEqual(plain(context.tables.data),table);
    return {text:context.tables.data.rows[inputs.select][0]};
  };
  const reply=await transform(target,caps,'select',39,target.state,io,compute);
  assert.deepEqual(plain(events(reply)),[{port:'text',payload:'Row 39'}]);assert.equal(JSON.stringify(io),before);
  for(const broken of [
    {...io,tables:{}},
    {...io,tables:{inputs:{data:{...table,rows:table.rows.slice(0,24)}}}},
    {...io,tables:{inputs:{data:{...table,datasetId:'other'}}}}
  ])await assert.rejects(transform(target,caps,'select',39,target.state,broken,compute),/complete dataset snapshot/);
  assert.equal(calls,1,'unavailable snapshots never reach the component Worker');
});

test('multi-driver transform events replace only the arriving input and Reprocess samples all current values',async()=>{
  const {transformComponentEvent:transform,normalizeComponentHybridEvents:normalize,componentReplyEvents:events}=api();
  const caps={compute:true,inputs:{a:{type:'string',event:true},b:{type:'string',event:true},separator:{type:'string',default:' / '},reprocess:{type:'boolean',event:'command',default:false}},
    outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
  normalize(caps,{inputs:['a','b'],outputs:['text'],reprocess:'reprocess'});
  const target=item('compose'),io={inputs:{a:'current A',b:'current B',separator:' / ',reprocess:false}},before=JSON.stringify({state:target.state,io}),seen=[];
  const call=async(_,hook,[inputs])=>{
    assert.equal(hook,'compute');seen.push({...inputs});return {text:inputs.a+inputs.separator+inputs.b};
  };
  for(const [name,payload,text] of [
    ['a','submitted A','submitted A / current B'],
    ['b','submitted B','current A / submitted B'],
    ['b','submitted B','current A / submitted B'],
    ['reprocess',true,'current A / current B'],
    ['reprocess',null,'current A / current B']
  ]){
    const reply=await transform(target,caps,name,payload,target.state,io,call);
    assert.deepEqual(plain(events(reply)),[{port:'text',payload:text}]);
  }
  assert.equal(seen.length,5,'equal payloads remain separate occurrences');
  assert.equal(JSON.stringify({state:target.state,io}),before,'events do not alter the stored state or parameter snapshot');
  const ignored=await transform(target,caps,'reprocess',false,target.state,io,call);assert.equal(events(ignored).length,0);
  await assert.rejects(transform(target,caps,'separator','other',target.state,io,call),/Unknown transform event input/);
  await assert.rejects(transform(target,caps,'missing','other',target.state,io,call),/Unknown transform event input/);
  assert.equal(seen.length,5,'false commands and undeclared drivers do not call compute');
});

test('multi-driver composition forwards B events to Memo and recombines one A/B fanout occurrence',async()=>{
  const {prepareComponentEventDelivery:prepare,normalizeComponentHybridEvents:normalize}=api();
  const source=item('source'),compose=item('compose',{bindings:{b:{uid:'source',port:'value'}}}),
    memo=item('memo',{bindings:{line:{uid:'compose',port:'text'}}}),scene=[source,compose,memo];
  const sourceCaps={apiVersion:2,eventApi:1,inputs:{},outputs:{value:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};normalize(sourceCaps);
  const composeCaps={apiVersion:2,eventApi:1,compute:true,inputs:{a:{type:'string',event:true},b:{type:'string',event:true},separator:{type:'string',default:' / '},reprocess:{type:'boolean',event:'command',default:false}},
    outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
  normalize(composeCaps,{inputs:['a','b'],outputs:['text'],reprocess:'reprocess'});
  const memoCaps={apiVersion:2,eventApi:1,onEvent:true,inputs:{line:{type:'string',event:true}},outputs:{},eventInputs:{},eventOutputs:{}};normalize(memoCaps);
  const graph=records([[source,sourceCaps],[compose,composeCaps],[memo,memoCaps]]);
  graph.get(compose).io.inputs={a:'clock snapshot',b:'old text',separator:' / ',reprocess:false};
  const call=async(target,hook,args)=>{
    if(target===compose){
      assert.equal(hook,'compute');const [inputs]=args;return {text:inputs.a+inputs.separator+inputs.b};
    }
    assert.equal(hook,'onEvent');const [name,payload,state]=args;assert.equal(name,'line');
    return {...state,text:(state.text?state.text+'\n':'')+payload};
  };
  const before=JSON.stringify(scene);
  const submitted=await prepare(scene,source,eventState(1,[{port:'value',payload:'Hello'},{port:'value',payload:'Hello'}]),call,()=>true,graph);
  assert.equal(submitted.get(memo).text,'clock snapshot / Hello\nclock snapshot / Hello');
  assert.equal(JSON.stringify(scene),before);
  compose.bindings.a={uid:'source',port:'value'};
  const fanout=await prepare(scene,source,eventState(1,[{port:'value',payload:'Hello'}]),call,()=>true,graph);
  assert.equal(fanout.get(memo).text,'Hello / Hello','one root occurrence recombines all its arrivals before emitting');
  compose.eventModes={a:'value'};
  const valueOnly=await prepare(scene,source,eventState(1,[{port:'value',payload:'Hello'}]),call,()=>true,graph);
  assert.equal(valueOnly.get(memo).text,'Hello / Hello','disabling reception on A still samples the current source value when B drives the event');
});

function hybridCaps(drivers,outputNames=['text']){
  const caps={apiVersion:2,eventApi:1,compute:true,
    inputs:{...Object.fromEntries(drivers.map(name=>[name,{type:'string',event:true,default:''}])),
      reprocess:{type:'boolean',event:'command',default:false}},
    outputs:Object.fromEntries(outputNames.map(name=>[name,{type:'string',event:true}])),eventInputs:{},eventOutputs:{}};
  api().normalizeComponentHybridEvents(caps,{inputs:drivers,outputs:outputNames,reprocess:'reprocess'});
  return caps;
}
function hybridSourceCaps(outputNames=['value']){
  const caps={apiVersion:2,eventApi:1,inputs:{},
    outputs:Object.fromEntries(outputNames.map(name=>[name,{type:'string',event:true}])),eventInputs:{},eventOutputs:{}};
  api().normalizeComponentHybridEvents(caps);return caps;
}
function hybridMemoCaps(){
  const caps={apiVersion:2,eventApi:1,onEvent:true,inputs:{line:{type:'string',event:true}},outputs:{},eventInputs:{},eventOutputs:{}};
  api().normalizeComponentHybridEvents(caps);return caps;
}
function diamond(){
  const source=item('source'),
    short=item('short',{bindings:{value:{uid:'source',port:'value'}}}),
    longFirst=item('long-first',{bindings:{value:{uid:'source',port:'value'}}}),
    longSecond=item('long-second',{bindings:{value:{uid:'long-first',port:'text'}}}),
    compose=item('compose',{bindings:{a:{uid:'short',port:'text'},b:{uid:'long-second',port:'text'}}}),
    memo=item('memo',{bindings:{line:{uid:'compose',port:'text'}}}),
    scene=[source,short,longFirst,longSecond,compose,memo],seen=[];
  const graph=records([[source,hybridSourceCaps()],[short,hybridCaps(['value'])],
    [longFirst,hybridCaps(['value'])],[longSecond,hybridCaps(['value'])],
    [compose,hybridCaps(['a','b'])],[memo,hybridMemoCaps()]]);
  for(const branch of [short,longFirst])graph.get(branch).io={inputs:{value:'Bob|Paris',reprocess:false},outputs:{text:branch===short?'Bob':'Paris'}};
  graph.get(longSecond).io={inputs:{value:'Paris',reprocess:false},outputs:{text:'PARIS'}};
  graph.get(compose).io={inputs:{a:'Bob',b:'PARIS',reprocess:false},outputs:{text:'Bob / PARIS'}};
  graph.get(memo).io.inputs={line:'Bob / PARIS'};
  const call=async(target,hook,args)=>{
    if(target===memo){
      assert.equal(hook,'onEvent');const [name,payload,state]=args;assert.equal(name,'line');seen.push({target:target.uid,payload});
      return {...state,text:(state.text?state.text+'\n':'')+payload,count:state.count+1};
    }
    assert.equal(hook,'compute');const [inputs]=args;seen.push({target:target.uid,inputs:plain(inputs)});
    if(target===short)return {text:inputs.value.split('|')[0]};
    if(target===longFirst)return {text:inputs.value.split('|')[1]};
    if(target===longSecond)return {text:inputs.value.toUpperCase()};
    assert.equal(target,compose);return {text:inputs.a+' / '+inputs.b};
  };
  return {source,short,longFirst,longSecond,compose,memo,scene,graph,seen,call};
}

test('unequal event paths reconverge once with complete payloads regardless of scene order',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  const orders=[
    ['source','short','longFirst','longSecond','compose','memo'],
    ['memo','compose','longSecond','longFirst','short','source'],
    ['compose','short','memo','longSecond','source','longFirst'],
    ['longFirst','memo','source','compose','short','longSecond']
  ];
  for(const order of orders){
    const fixture=diamond(),scene=order.map(name=>fixture[name]),before=JSON.stringify(scene);
    const changes=await prepare(scene,fixture.source,eventState(1,[{port:'value',payload:'Anna|Berlin'}]),fixture.call,()=>true,fixture.graph);
    assert.equal(changes.get(fixture.memo).text,'Anna / BERLIN',order.join(','));
    assert.equal(changes.get(fixture.memo).count,1,'only one line is appended for the submission');
    assert.equal(fixture.seen.filter(entry=>entry.target==='compose').length,1,'Compose computes once after both affected paths finish');
    assert.equal(JSON.stringify(scene),before,'a complete event delivery remains an uncommitted proposal');
    assert.deepEqual(fixture.graph.get(fixture.compose).io.inputs,{a:'Bob',b:'PARIS',reprocess:false},'delivery does not mutate cached signal inputs');
  }
});

test('a pure transform can split one occurrence across output ports and recombine it once',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  const source=item('source'),split=item('split',{bindings:{value:{uid:'source',port:'value'}}}),
    compose=item('compose',{bindings:{a:{uid:'split',port:'name'},b:{uid:'split',port:'city'}}}),
    memo=item('memo',{bindings:{line:{uid:'compose',port:'text'}}}),scene=[memo,compose,source,split];
  const graph=records([[source,hybridSourceCaps()],[split,hybridCaps(['value'],['name','city'])],
    [compose,hybridCaps(['a','b'])],[memo,hybridMemoCaps()]]);
  graph.get(split).io.inputs={value:'Bob|Paris',reprocess:false};
  graph.get(compose).io.inputs={a:'Bob',b:'Paris',reprocess:false};
  let compositions=0;
  const changes=await prepare(scene,source,eventState(1,[{port:'value',payload:'Anna|Berlin'}]),async(target,hook,args)=>{
    if(target===split){assert.equal(hook,'compute');const [name,city]=args[0].value.split('|');return {name,city};}
    if(target===compose){assert.equal(hook,'compute');compositions++;return {text:args[0].a+' / '+args[0].b};}
    assert.equal(target,memo);assert.equal(hook,'onEvent');return {...args[2],text:args[1],count:args[2].count+1};
  },()=>true,graph);
  assert.equal(compositions,1);
  assert.deepEqual(plain(changes.get(memo)),{count:1,text:'Anna / Berlin'});
});

test('Reprocess root outputs retain their shared origin when the pure transform emits several ports',async()=>{
  const {prepareComponentEventDelivery:prepare,transformComponentEvent:transform}=api();
  const split=item('split'),compose=item('compose',{bindings:{a:{uid:'split',port:'name'},b:{uid:'split',port:'city'}}}),
    memo=item('memo',{bindings:{line:{uid:'compose',port:'text'}}}),scene=[memo,split,compose];
  const splitCaps=hybridCaps(['value'],['name','city']),graph=records([[split,splitCaps],[compose,hybridCaps(['a','b'])],[memo,hybridMemoCaps()]]);
  graph.get(split).io.inputs={value:'Anna|Berlin',reprocess:false};
  graph.get(compose).io.inputs={a:'Bob',b:'Paris',reprocess:false};
  let compositions=0;
  const call=async(target,hook,args)=>{
    if(target===split){assert.equal(hook,'compute');const [name,city]=args[0].value.split('|');return {name,city};}
    if(target===compose){assert.equal(hook,'compute');compositions++;return {text:args[0].a+' / '+args[0].b};}
    assert.equal(target,memo);return {...args[2],text:(args[2].text?args[2].text+'\n':'')+args[1],count:args[2].count+1};
  };
  const next=await transform(split,splitCaps,'reprocess',true,split.state,graph.get(split).io,call);
  const changes=await prepare(scene,split,next,call,()=>true,graph);
  assert.equal(compositions,1,'host-created transform emissions share their Reprocess root');
  assert.deepEqual(plain(changes.get(memo)),{count:1,text:'Anna / Berlin'});
});

test('distinct root occurrences complete separately even when payloads repeat or arrive in one reply',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),fixture=diamond();
  const submissions=['Anna|Berlin','Anna|Berlin','Chloe|Lyon'];
  const changes=await prepare(fixture.scene,fixture.source,eventState(1,submissions.map(payload=>({port:'value',payload}))),
    fixture.call,()=>true,fixture.graph);
  assert.equal(changes.get(fixture.memo).text,'Anna / BERLIN\nAnna / BERLIN\nChloe / LYON');
  assert.equal(changes.get(fixture.memo).count,3,'equal occurrences are not deduplicated or grouped by timing');
  assert.equal(fixture.seen.filter(entry=>entry.target==='compose').length,3);
  assert.deepEqual(fixture.seen.filter(entry=>entry.target==='memo').map(entry=>entry.payload),
    ['Anna / BERLIN','Anna / BERLIN','Chloe / LYON']);
});

test('custom onEvent emission entries form separate child occurrences and preserve equal bursts through reconvergence',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),fixture=diamond(),
    burst=item('burst',{eventBindings:{value:{uid:fixture.source.uid,port:'value'}}});
  const burstCaps=hybridSourceCaps();burstCaps.onEvent=true;burstCaps.eventInputs=api().normalizeComponentEventPorts(ports,'input');
  fixture.graph.set(burst,{caps:burstCaps,io:{inputs:{},outputs:{value:'old'}}});
  fixture.scene.splice(1,0,burst);
  for(const target of [fixture.short,fixture.longFirst])target.bindings.value={uid:burst.uid,port:'value'};
  const changes=await prepare(fixture.scene,fixture.source,eventState(1,[{port:'value',payload:'start'}]),async(target,hook,args)=>{
    if(target===burst){
      assert.equal(hook,'onEvent');
      return eventState(args[2].count+1,[{port:'value',payload:'Anna|Berlin'},{port:'value',payload:'Anna|Berlin'}]);
    }
    return fixture.call(target,hook,args);
  },()=>true,fixture.graph);
  assert.equal(changes.get(fixture.memo).text,'Anna / BERLIN\nAnna / BERLIN');
  assert.equal(changes.get(fixture.memo).count,2,'an explicit script burst is not deduplicated into its parent occurrence');
  assert.equal(fixture.seen.filter(entry=>entry.target==='compose').length,2);
});

test('independent sources append separate results using the other input current snapshot',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),name=item('name'),city=item('city'),
    compose=item('compose',{bindings:{a:{uid:name.uid,port:'value'},b:{uid:city.uid,port:'value'}}}),
    memo=item('memo',{bindings:{line:{uid:compose.uid,port:'text'}}}),scene=[name,city,compose,memo];
  const graph=records([[name,hybridSourceCaps()],[city,hybridSourceCaps()],[compose,hybridCaps(['a','b'])],[memo,hybridMemoCaps()]]);
  graph.get(compose).io.inputs={a:'Bob',b:'Paris',reprocess:false};
  const call=async(target,hook,args)=>{
    if(target===compose){assert.equal(hook,'compute');return {text:args[0].a+' / '+args[0].b};}
    assert.equal(target,memo);return {...args[2],text:(args[2].text?args[2].text+'\n':'')+args[1],count:args[2].count+1};
  };
  const first=await prepare(scene,name,eventState(1,[{port:'value',payload:'Anna'}]),call,()=>true,graph);
  assert.equal(first.get(memo).text,'Anna / Paris');
  for(const [target,state] of first)target.state=state;
  graph.get(compose).io.inputs={a:'Anna',b:'Paris',reprocess:false};
  const second=await prepare(scene,city,eventState(1,[{port:'value',payload:'Berlin'}]),call,()=>true,graph);
  assert.equal(second.get(memo).text,'Anna / Paris\nAnna / Berlin');
  assert.equal(second.get(memo).count,2,'separate user submissions remain distinct without waiting for all inputs');
});

test('same-origin pure value branches settle before an active sibling event samples their disabled companion input',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),source=item('source'),
    uppercase=item('uppercase',{bindings:{value:{uid:source.uid,port:'value'}}}),
    suffix=item('suffix',{bindings:{value:{uid:uppercase.uid,port:'text'}}}),
    compose=item('compose',{bindings:{a:{uid:source.uid,port:'value'},b:{uid:suffix.uid,port:'text'}},eventModes:{b:'value'}}),
    memo=item('memo',{bindings:{line:{uid:compose.uid,port:'text'}}});
  const valueCaps={apiVersion:2,compute:true,inputs:{value:{type:'string',default:''}},outputs:{text:{type:'string'}},eventInputs:{},eventOutputs:{}};
  const graph=records([[source,hybridSourceCaps()],[uppercase,valueCaps],[suffix,valueCaps],[compose,hybridCaps(['a','b'])],[memo,hybridMemoCaps()]]);
  graph.get(uppercase).io={inputs:{value:'old'},outputs:{text:'OLD'}};
  graph.get(suffix).io={inputs:{value:'OLD'},outputs:{text:'OLD!'}};
  graph.get(compose).io={inputs:{a:'old',b:'OLD!',reprocess:false},outputs:{text:'old / OLD!'}};
  for(const scene of [[source,uppercase,suffix,compose,memo],[memo,compose,suffix,uppercase,source]]){
    const seen=[],before=JSON.stringify(scene);
    const call=async(target,hook,args)=>{
      seen.push(target.uid);
      if(target===uppercase){assert.equal(hook,'compute');return {text:args[0].value.toUpperCase()};}
      if(target===suffix){assert.equal(hook,'compute');return {text:args[0].value+'!'};}
      if(target===compose){assert.equal(hook,'compute');return {text:args[0].a+' / '+args[0].b};}
      assert.equal(target,memo);return {...args[2],text:args[1],count:args[2].count+1};
    };
    const changes=await prepare(scene,source,eventState(1,[{port:'value',payload:'Hello'}]),call,()=>true,graph);
    assert.equal(changes.get(memo).text,'Hello / HELLO!','the disabled event input still supplies its updated value');
    assert.equal(changes.get(memo).count,1);
    assert.ok(seen.indexOf('suffix')<seen.indexOf('compose'),'pure companion values settle before sampling');
    assert.equal(JSON.stringify(scene),before);
  }
  delete compose.bindings.a;
  let received=0;
  await prepare([source,uppercase,suffix,compose,memo],source,eventState(1,[{port:'value',payload:'World'}]),async(target,hook,args)=>{
    if(target===uppercase)return {text:args[0].value.toUpperCase()};
    if(target===suffix)return {text:args[0].value+'!'};
    if(target===compose)return {text:args[0].a+' / '+args[0].b};
    received++;return args[2];
  },()=>true,graph);
  assert.equal(received,0,'a pure value path alone never dispatches an event to Memo');
});

test('a stored output supplies its published snapshot and breaks a companion-value feedback path',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),source=item('source'),
    stored=item('stored',{bindings:{value:{uid:'compose',port:'text'}}}),
    compose=item('compose',{bindings:{a:{uid:source.uid,port:'value'},b:{uid:stored.uid,port:'value'}},eventModes:{b:'value'}}),
    memo=item('memo',{bindings:{line:{uid:compose.uid,port:'text'}}}),scene=[memo,stored,compose,source];
  const storedCaps={apiVersion:2,publish:true,transition:true,inputs:{value:{type:'string',default:''}},
    outputs:{value:{type:'string'}},eventInputs:{},eventOutputs:{}};
  const graph=records([[source,hybridSourceCaps()],[stored,storedCaps],[compose,hybridCaps(['a','b'])],[memo,hybridMemoCaps()]]);
  graph.get(stored).io={inputs:{value:'old / STORED'},outputs:{value:'STORED'}};
  graph.get(compose).io.inputs={a:'old',b:'STORED',reprocess:false};
  const changes=await prepare(scene,source,eventState(1,[{port:'value',payload:'Hello'}]),async(target,hook,args)=>{
    assert.notEqual(target,stored,'event delivery must not advance stored state to settle a pure companion');
    if(target===compose){assert.equal(hook,'compute');return {text:args[0].a+' / '+args[0].b};}
    assert.equal(target,memo);return {...args[2],text:args[1],count:args[2].count+1};
  },()=>true,graph);
  assert.equal(changes.get(memo).text,'Hello / STORED');
  assert.equal(changes.has(stored),false,'the published state is only sampled');
});

test('an unrelated throwing value branch cannot reject an otherwise valid event occurrence',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  for(const reverse of [false,true]){
    const fixture=diamond(),broken=item('broken',{bindings:{value:{uid:fixture.source.uid,port:'value'}}});
    const caps={apiVersion:2,compute:true,inputs:{value:{type:'string',default:''}},outputs:{text:{type:'string'}},eventInputs:{},eventOutputs:{}};
    fixture.graph.set(broken,{caps,io:{inputs:{value:'old'},outputs:{}},error:'unrelated value failure'});
    fixture.scene.splice(1,0,broken);if(reverse)fixture.scene.reverse();
    let calls=0;
    const changes=await prepare(fixture.scene,fixture.source,eventState(1,[{port:'value',payload:'Anna|Berlin'}]),async(target,hook,args)=>{
      if(target===broken){calls++;throw new Error('unrelated value failure');}
      return fixture.call(target,hook,args);
    },()=>true,fixture.graph);
    assert.equal(changes.get(fixture.memo).text,'Anna / BERLIN');
    assert.equal(calls,0,'only pure value branches feeding event recipients participate in the occurrence');
    assert.equal(changes.has(broken),false);
  }
});

test('Compose can sample Memo text while its output appends to that same Memo without event feedback',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),source=item('source'),
    compose=item('compose',{bindings:{a:{uid:source.uid,port:'value'},b:{uid:'memo',port:'text'}},eventModes:{b:'value'}}),
    memo=item('memo',{state:{count:0,text:'existing'},bindings:{line:{uid:compose.uid,port:'text'}}}),
    scene=[memo,compose,source],memoCaps=hybridMemoCaps();
  memoCaps.compute=true;memoCaps.outputs={text:{type:'string'}};
  const graph=records([[source,hybridSourceCaps()],[compose,hybridCaps(['a','b'])],[memo,memoCaps]]);
  graph.get(memo).io={inputs:{line:'old / existing'},outputs:{text:'existing'}};
  graph.get(compose).io={inputs:{a:'old',b:'existing',reprocess:false},outputs:{text:'old / existing'}};
  let compositions=0;
  const changes=await prepare(scene,source,eventState(1,[{port:'value',payload:'Hello'}]),async(target,hook,args)=>{
    if(target===compose){assert.equal(hook,'compute');compositions++;return {text:args[0].a+' / '+args[0].b};}
    assert.equal(target,memo);
    if(hook==='compute')return {text:args[1].text};
    assert.equal(hook,'onEvent');return {...args[2],text:args[2].text+'\n'+args[1],count:args[2].count+1};
  },()=>true,graph);
  assert.equal(compositions,1);
  assert.deepEqual(plain(changes.get(memo)),{count:1,text:'existing\nHello / existing'});
  assert.equal(memo.state.text,'existing','the stored value changes only when the whole proposal commits');
});

test('onEvent plus compute outputs stay frozen for one origin and become visible to the next independent occurrence',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  for(const reverse of [false,true]){
    const source=item('source'),stored=item('stored',{state:{count:0,text:'old'},bindings:{line:{uid:source.uid,port:'value'}}}),
      compose=item('compose',{bindings:{a:{uid:source.uid,port:'value'},b:{uid:stored.uid,port:'text'}},eventModes:{b:'value'}}),
      memo=item('memo',{bindings:{line:{uid:compose.uid,port:'text'}}}),scene=[source,stored,compose,memo];
    if(reverse)scene.reverse();
    const storedCaps=hybridMemoCaps();storedCaps.compute=true;storedCaps.outputs={text:{type:'string'}};
    const graph=records([[source,hybridSourceCaps()],[stored,storedCaps],[compose,hybridCaps(['a','b'])],[memo,hybridMemoCaps()]]);
    graph.get(stored).io={inputs:{line:'old'},outputs:{text:'old'}};
    graph.get(compose).io={inputs:{a:'old',b:'old',reprocess:false},outputs:{text:'old / old'}};
    const changes=await prepare(scene,source,eventState(1,[{port:'value',payload:'first'},{port:'value',payload:'second'}]),async(target,hook,args)=>{
      if(target===stored){
        if(hook==='compute')return {text:args[1].text};
        assert.equal(hook,'onEvent');return {...args[2],text:args[1],count:args[2].count+1};
      }
      if(target===compose){assert.equal(hook,'compute');return {text:args[0].a+' / '+args[0].b};}
      assert.equal(target,memo);return {...args[2],text:(args[2].text?args[2].text+'\n':'')+args[1],count:args[2].count+1};
    },()=>true,graph);
    assert.equal(changes.get(memo).text,'first / old\nsecond / first','stored updates become companion values only for the following occurrence');
    assert.equal(changes.get(stored).text,'second');
    assert.equal(changes.get(stored).count,2);
  }
});

test('later independent occurrences refresh pure companions derived from updated stored outputs',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  for(const reverse of [false,true]){
    const source=item('source'),stored=item('stored',{state:{count:0,text:'old'},bindings:{line:{uid:source.uid,port:'value'}}}),
      uppercase=item('uppercase',{bindings:{value:{uid:stored.uid,port:'text'}}}),
      compose=item('compose',{bindings:{a:{uid:source.uid,port:'value'},b:{uid:uppercase.uid,port:'text'}},eventModes:{b:'value'}}),
      memo=item('memo',{bindings:{line:{uid:compose.uid,port:'text'}}}),scene=[source,stored,compose,memo,uppercase];
    if(reverse)scene.reverse();
    const storedCaps=hybridMemoCaps();storedCaps.compute=true;storedCaps.outputs={text:{type:'string'}};
    const valueCaps={apiVersion:2,compute:true,inputs:{value:{type:'string',default:''}},outputs:{text:{type:'string'}},eventInputs:{},eventOutputs:{}};
    const graph=records([[source,hybridSourceCaps()],[stored,storedCaps],[uppercase,valueCaps],[compose,hybridCaps(['a','b'])],[memo,hybridMemoCaps()]]);
    graph.get(stored).io={inputs:{line:'old'},outputs:{text:'old'}};
    graph.get(uppercase).io={inputs:{value:'old'},outputs:{text:'OLD'}};
    graph.get(compose).io={inputs:{a:'old',b:'OLD',reprocess:false},outputs:{text:'old / OLD'}};
    const changes=await prepare(scene,source,eventState(1,[{port:'value',payload:'first'},{port:'value',payload:'second'}]),async(target,hook,args)=>{
      if(target===stored){
        if(hook==='compute')return {text:args[1].text};
        return {...args[2],text:args[1],count:args[2].count+1};
      }
      if(target===uppercase){assert.equal(hook,'compute');return {text:args[0].value.toUpperCase()};}
      if(target===compose){assert.equal(hook,'compute');return {text:args[0].a+' / '+args[0].b};}
      assert.equal(target,memo);return {...args[2],text:(args[2].text?args[2].text+'\n':'')+args[1],count:args[2].count+1};
    },()=>true,graph);
    assert.equal(changes.get(memo).text,'first / OLD\nsecond / FIRST','derived companion values advance with the stored snapshot between occurrences');
    assert.equal(changes.get(stored).text,'second');
  }
});

test('custom child occurrences refresh pure companions from the parent stored-state update',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  for(const reverse of [false,true]){
    const source=item('source'),stored=item('stored',{state:{count:0,text:'old'},bindings:{line:{uid:source.uid,port:'value'}}}),
      uppercase=item('uppercase',{bindings:{value:{uid:stored.uid,port:'text'}}}),
      compose=item('compose',{eventBindings:{a:{uid:stored.uid,port:'accepted'}},bindings:{b:{uid:uppercase.uid,port:'text'}},eventModes:{b:'value'}}),
      memo=item('memo',{bindings:{line:{uid:compose.uid,port:'text'}}}),scene=[memo,source,compose,stored,uppercase];
    if(reverse)scene.reverse();
    const storedCaps=hybridMemoCaps();storedCaps.compute=true;storedCaps.outputs={text:{type:'string'}};
    storedCaps.eventOutputs=api().normalizeComponentEventPorts({accepted:{type:'string'}},'output');
    const valueCaps={apiVersion:2,compute:true,inputs:{value:{type:'string',default:''}},outputs:{text:{type:'string'}},eventInputs:{},eventOutputs:{}};
    const graph=records([[source,hybridSourceCaps()],[stored,storedCaps],[uppercase,valueCaps],[compose,hybridCaps(['a','b'])],[memo,hybridMemoCaps()]]);
    graph.get(stored).io={inputs:{line:'old'},outputs:{text:'old'}};
    graph.get(uppercase).io={inputs:{value:'old'},outputs:{text:'OLD'}};
    graph.get(compose).io={inputs:{a:'old',b:'OLD',reprocess:false},outputs:{text:'old / OLD'}};
    const changes=await prepare(scene,source,eventState(1,[{port:'value',payload:'first'},{port:'value',payload:'second'}]),async(target,hook,args)=>{
      if(target===stored){
        if(hook==='compute')return {text:args[1].text};
        return Object.assign(eventState(args[2].count+1,[{port:'accepted',payload:args[1]}]),{text:args[1]});
      }
      if(target===uppercase){assert.equal(hook,'compute');return {text:args[0].value.toUpperCase()};}
      if(target===compose){assert.equal(hook,'compute');return {text:args[0].a+' / '+args[0].b};}
      assert.equal(target,memo);return {...args[2],text:(args[2].text?args[2].text+'\n':'')+args[1],count:args[2].count+1};
    },()=>true,graph);
    assert.equal(changes.get(memo).text,'first / FIRST\nsecond / SECOND','each child starts after its parent stored outputs and derived values are current');
    assert.equal(changes.get(memo).count,2);
  }
});

test('a previously pruned pure value branch refreshes when a later independent event samples it',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  for(const reverse of [false,true]){
    const source=item('source'),uppercase=item('uppercase',{bindings:{value:{uid:source.uid,port:'value'}}}),
      suffix=item('suffix',{bindings:{value:{uid:uppercase.uid,port:'text'}}}),
      compose=item('compose',{bindings:{a:{uid:source.uid,port:'submit'},b:{uid:suffix.uid,port:'text'}},eventModes:{b:'value'}}),
      memo=item('memo',{bindings:{line:{uid:compose.uid,port:'text'}}}),scene=[source,compose,memo,uppercase,suffix];
    if(reverse)scene.reverse();
    const valueCaps={apiVersion:2,compute:true,inputs:{value:{type:'string',default:''}},outputs:{text:{type:'string'}},eventInputs:{},eventOutputs:{}};
    const graph=records([[source,hybridSourceCaps(['value','submit'])],[uppercase,valueCaps],[suffix,valueCaps],[compose,hybridCaps(['a','b'])],[memo,hybridMemoCaps()]]);
    graph.get(source).io.outputs={value:'old',submit:'old request'};
    graph.get(uppercase).io={inputs:{value:'old'},outputs:{text:'OLD'}};
    graph.get(suffix).io={inputs:{value:'OLD'},outputs:{text:'OLD!'}};
    graph.get(compose).io={inputs:{a:'old request',b:'OLD!',reprocess:false},outputs:{text:'old request / OLD!'}};
    let companionComputes=0;
    const events=[{port:'value',payload:'first'},{port:'submit',payload:'request-1'},{port:'value',payload:'second'},{port:'submit',payload:'request-2'}];
    const changes=await prepare(scene,source,eventState(1,events),async(target,hook,args)=>{
      if(target===uppercase){companionComputes++;assert.equal(hook,'compute');return {text:args[0].value.toUpperCase()};}
      if(target===suffix){companionComputes++;assert.equal(hook,'compute');return {text:args[0].value+'!'};}
      if(target===compose){assert.equal(hook,'compute');return {text:args[0].a+' / '+args[0].b};}
      assert.equal(target,memo);return {...args[2],text:(args[2].text?args[2].text+'\n':'')+args[1],count:args[2].count+1};
    },()=>true,graph);
    assert.equal(changes.get(memo).text,'request-1 / FIRST!\nrequest-2 / SECOND!');
    assert.equal(changes.get(memo).count,2,'value roots do not acquire events when their descendants later become relevant');
    assert.equal(companionComputes,4,'each two-step companion runs once for each requesting event');
  }
});

test('related branch arrivals use receiver port declaration order independent of branch length and scene order',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  for(const order of [
    ['source','line','contentFirst','contentSecond','receiver'],
    ['receiver','contentSecond','contentFirst','line','source'],
    ['line','receiver','source','contentFirst','contentSecond']
  ]){
    const source=item('source'),line=item('line',{bindings:{value:{uid:source.uid,port:'value'}}}),
      contentFirst=item('content-first',{bindings:{value:{uid:source.uid,port:'value'}}}),
      contentSecond=item('content-second',{bindings:{value:{uid:contentFirst.uid,port:'text'}}}),
      receiver=item('receiver',{bindings:{content:{uid:contentSecond.uid,port:'text'},line:{uid:line.uid,port:'text'}}});
    const members={source,line,contentFirst,contentSecond,receiver},scene=order.map(name=>members[name]),seen=[];
    const receiverCaps={apiVersion:2,eventApi:1,onEvent:true,inputs:{content:{type:'string',event:true},line:{type:'string',event:true}},outputs:{},eventInputs:{},eventOutputs:{}};
    api().normalizeComponentHybridEvents(receiverCaps);
    const graph=records([[source,hybridSourceCaps()],[line,hybridCaps(['value'])],[contentFirst,hybridCaps(['value'])],
      [contentSecond,hybridCaps(['value'])],[receiver,receiverCaps]]);
    for(const branch of [line,contentFirst,contentSecond])graph.get(branch).io.inputs={value:'old',reprocess:false};
    const changes=await prepare(scene,source,eventState(1,[{port:'value',payload:'Hello'}]),async(target,hook,args)=>{
      if(target===line)return {text:'line:'+args[0].value};
      if(target===contentFirst)return {text:'content:'+args[0].value};
      if(target===contentSecond)return {text:args[0].value};
      assert.equal(target,receiver);assert.equal(hook,'onEvent');const [name,payload,state]=args;seen.push(name);
      return {...state,count:state.count+1,text:name==='content'?payload:(state.text?state.text+'\n':'')+payload};
    },()=>true,graph);
    assert.deepEqual(seen,['content','line'],'arrival order follows the receiving component contract');
    assert.equal(changes.get(receiver).text,'content:Hello\nline:Hello',order.join(','));
    assert.equal(changes.get(receiver).count,2,'distinct commands remain distinct even when related');
  }
});

test('custom onEvent receivers sample related pure companion branches after those values settle',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  for(const reverse of [false,true]){
    const source=item('source'),upper=item('upper',{bindings:{value:{uid:source.uid,port:'value'}}}),
      suffix=item('suffix',{bindings:{value:{uid:upper.uid,port:'text'}}}),
      receiver=item('receiver',{bindings:{line:{uid:source.uid,port:'value'},parameter:{uid:suffix.uid,port:'text'}}}),
      scene=[source,receiver,upper,suffix];
    if(reverse)scene.reverse();
    const valueCaps={apiVersion:2,compute:true,inputs:{value:{type:'string',default:''}},outputs:{text:{type:'string'}},eventInputs:{},eventOutputs:{}};
    const receiverCaps={apiVersion:2,eventApi:1,onEvent:true,inputs:{line:{type:'string',event:true},parameter:{type:'string',default:''}},outputs:{},eventInputs:{},eventOutputs:{}};
    api().normalizeComponentHybridEvents(receiverCaps);
    const graph=records([[source,hybridSourceCaps()],[upper,valueCaps],[suffix,valueCaps],[receiver,receiverCaps]]);
    graph.get(upper).io={inputs:{value:'old'},outputs:{text:'OLD'}};
    graph.get(suffix).io={inputs:{value:'OLD'},outputs:{text:'OLD!'}};
    graph.get(receiver).io.inputs={line:'old',parameter:'OLD!'};
    const changes=await prepare(scene,source,eventState(1,[{port:'value',payload:'Hello'}]),async(target,hook,args)=>{
      if(target===upper){assert.equal(hook,'compute');return {text:args[0].value.toUpperCase()};}
      if(target===suffix){assert.equal(hook,'compute');return {text:args[0].value+'!'};}
      assert.equal(target,receiver);assert.equal(hook,'onEvent');return {...args[2],text:args[1]+' / '+args[3].inputs.parameter,count:args[2].count+1};
    },()=>true,graph);
    assert.deepEqual(plain(changes.get(receiver)),{count:1,text:'Hello / HELLO!'});
  }
});

test('pure Boolean companions preserve unknown values and can resolve false AND X without transporting X as an event',async()=>{
  const {prepareComponentEventDelivery:prepare,normalizeComponentHybridEvents:normalize}=api(),
    source=item('source'),unknown=item('unknown'),
    and=item('and',{bindings:{a:{uid:source.uid,port:'value'},b:{uid:unknown.uid,port:'value'}}}),
    receiver=item('receiver',{bindings:{line:{uid:source.uid,port:'value'},parameter:{uid:and.uid,port:'value'}}}),
    scene=[receiver,and,unknown,source];
  const sourceCaps={apiVersion:2,eventApi:1,inputs:{},outputs:{value:{type:'boolean',event:true}},eventInputs:{},eventOutputs:{}};
  const receiverCaps={apiVersion:2,eventApi:1,onEvent:true,inputs:{line:{type:'boolean',event:true},parameter:{type:'boolean',unknown:true}},outputs:{},eventInputs:{},eventOutputs:{}};
  normalize(sourceCaps);normalize(receiverCaps);
  const unknownCaps={apiVersion:2,publish:true,inputs:{},outputs:{value:{type:'boolean',unknown:true}},eventInputs:{},eventOutputs:{}};
  const andCaps={apiVersion:2,compute:true,inputs:{a:{type:'boolean',unknown:true},b:{type:'boolean',unknown:true}},
    outputs:{value:{type:'boolean',unknown:true}},eventInputs:{},eventOutputs:{}};
  const graph=records([[source,sourceCaps],[unknown,unknownCaps],[and,andCaps],[receiver,receiverCaps]]);
  graph.get(source).io.outputs={value:true};
  graph.get(unknown).io.outputs={value:'X'};
  graph.get(and).io={inputs:{a:true,b:'X'},outputs:{value:'X'}};
  graph.get(receiver).io.inputs={line:true,parameter:'X'};
  let computes=0;
  const changes=await prepare(scene,source,eventState(1,[{port:'value',payload:false}]),async(target,hook,args)=>{
    if(target===and){
      computes++;assert.equal(hook,'compute');assert.deepEqual(plain(args[0]),{a:false,b:'X'});
      return {value:args[0].a===false||args[0].b===false?false:'X'};
    }
    assert.equal(target,receiver);assert.equal(hook,'onEvent');
    return {...args[2],count:args[2].count+1,result:args[3].inputs.parameter};
  },()=>true,graph);
  assert.equal(computes,1);
  assert.deepEqual(plain(changes.get(receiver)),{count:1,result:false});
  await assert.rejects(prepare(scene,source,eventState(1,[{port:'value',payload:'X'}]),async()=>assert.fail('X must not be delivered as a Boolean event'),()=>true,graph),/incompatible payload/i);
});

test('a snapshot-only parameter neither blocks an event nor independently appends a result',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),source=item('source'),clock=item('clock'),
    compose=item('compose',{bindings:{a:{uid:'source',port:'value'},b:{uid:'clock',port:'value'}},eventModes:{b:'value'}}),
    memo=item('memo',{bindings:{line:{uid:'compose',port:'text'}}}),scene=[memo,clock,compose,source];
  const graph=records([[source,hybridSourceCaps()],[clock,hybridSourceCaps()],[compose,hybridCaps(['a','b'])],[memo,hybridMemoCaps()]]);
  graph.get(compose).io.inputs={a:'Old',b:'12:34:56',reprocess:false};
  const seen=[],call=async(target,hook,args)=>{
    seen.push(target.uid);
    if(target===compose){assert.equal(hook,'compute');return {text:args[0].a+' at '+args[0].b};}
    assert.equal(target,memo);return {...args[2],text:args[1],count:args[2].count+1};
  };
  const submission=await prepare(scene,source,eventState(1,[{port:'value',payload:'Hello'}]),call,()=>true,graph);
  assert.equal(submission.get(memo).text,'Hello at 12:34:56','the constant snapshot is sampled without awaiting a clock event');
  seen.length=0;
  const clockTick=await prepare(scene,clock,eventState(1,[{port:'value',payload:'12:34:57'}]),call,()=>true,graph);
  assert.equal(clockTick.size,1,'a value-only connection does not start downstream event processing');
  assert.equal(clockTick.has(memo),false);
  assert.equal(seen.includes('memo'),false,'value-only recalculation cannot append an event result');
});

test('Reprocess emits the current snapshot once without replaying earlier branch payloads',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),fixture=diamond(),trigger=item('trigger');
  fixture.compose.eventBindings={reprocess:{uid:trigger.uid,port:'value'}};
  fixture.scene.push(trigger);fixture.graph.set(trigger,{caps:capabilities({},{value:{type:'none'}}),io:{inputs:{},outputs:{}}});
  const changes=await prepare(fixture.scene,trigger,eventState(1,[{port:'value',payload:null}]),fixture.call,()=>true,fixture.graph);
  assert.equal(changes.get(fixture.memo).text,'Bob / PARIS');
  assert.equal(changes.get(fixture.memo).count,1);
  assert.deepEqual(fixture.seen.map(entry=>entry.target),['compose','memo'],'an explicit Reprocess does not replay upstream events');
});

test('a failing or stale branch rejects the complete reconverged proposal',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  for(const failure of ['compute-error','stale-source']){
    const fixture=diamond(),before=JSON.stringify(fixture.scene);
    await assert.rejects(prepare(fixture.scene,fixture.source,eventState(1,[{port:'value',payload:'Anna|Berlin'}]),async(target,hook,args)=>{
      if(target===fixture.longSecond){
        if(failure==='compute-error')throw new Error('long branch failed');
        fixture.source.state.count=99;
      }
      return fixture.call(target,hook,args);
    },()=>true,fixture.graph),error=>failure==='compute-error'?/long branch failed/.test(error.message):error.cancelled===true);
    assert.equal(fixture.memo.state.count,0,'Memo state is never partially committed');
    assert.equal(fixture.seen.filter(entry=>entry.target==='memo').length,0,'the receiver is not invoked with a partial composition');
    if(failure==='compute-error')assert.equal(JSON.stringify(fixture.scene),before);
  }
});

test('changes to a planned but not yet visited branch cancel the whole event occurrence',async()=>{
  const {prepareComponentEventDelivery:prepare}=api();
  for(const mutation of ['script','state','input-values']){
    const fixture=diamond();
    await assert.rejects(prepare(fixture.scene,fixture.source,eventState(1,[{port:'value',payload:'Anna|Berlin'}]),async(target,hook,args)=>{
      if(target===fixture.short){
        if(mutation==='script')fixture.longSecond.script='replaced while the short branch awaited';
        if(mutation==='state')fixture.longSecond.state.count=99;
        if(mutation==='input-values')fixture.longSecond.inputValues={reprocess:true};
      }
      return fixture.call(target,hook,args);
    },()=>true,fixture.graph),error=>error.cancelled===true,mutation);
    assert.equal(fixture.memo.state.count,0);
    assert.equal(fixture.seen.filter(entry=>entry.target==='memo').length,0,'a downstream edit cannot produce an event using stale capability records');
  }
});

test('replacing an unrelated scene member with a newly connected receiver cancels the old wiring snapshot',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),source=item('source'),
    target=item('target',{eventBindings:{value:{uid:source.uid,port:'value'}}}),unrelated=item('unrelated'),scene=[source,target,unrelated];
  const graph=records(scene.map(node=>[node,capabilities(ports,ports)]));
  await assert.rejects(prepare(scene,source,eventState(1,[{port:'value',payload:'new'}]),async(_,__,args)=>{
    scene[2]={...unrelated,eventBindings:{value:{uid:source.uid,port:'value'}}};
    return eventState(args[2].count+1);
  },()=>true,graph),error=>error.cancelled===true);
  assert.equal(target.state.count,0,'new scene membership must not silently omit a newly connected receiver');
});

test('unrelated event cycles do not block a valid occurrence, but an affected cycle fails atomically',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),fixture=diamond();
  const loopA=item('loop-a',{eventBindings:{value:{uid:'loop-b',port:'value'}}}),
    loopB=item('loop-b',{eventBindings:{value:{uid:'loop-a',port:'value'}}});
  fixture.scene.push(loopA,loopB);
  for(const node of [loopA,loopB])fixture.graph.set(node,{caps:capabilities(ports,ports),io:{inputs:{},outputs:{}}});
  const valid=await prepare(fixture.scene,fixture.source,eventState(1,[{port:'value',payload:'Anna|Berlin'}]),fixture.call,()=>true,fixture.graph);
  assert.equal(valid.get(fixture.memo).text,'Anna / BERLIN','a disconnected cycle is outside this occurrence');
  loopA.eventBindings.start={uid:fixture.source.uid,port:'value'};
  fixture.graph.get(loopA).caps=capabilities({value:{type:'string'},start:{type:'string'}},ports);
  const before=JSON.stringify(fixture.scene);
  await assert.rejects(prepare(fixture.scene,fixture.source,eventState(1,[{port:'value',payload:'Anna|Berlin'}]),async(target,hook,args)=>{
    if(target===loopA||target===loopB)return eventState(args[2].count+1,[{port:'value',payload:args[1]}]);
    return fixture.call(target,hook,args);
  },()=>true,fixture.graph),/cycle|feedback|limit reached/i);
  assert.equal(JSON.stringify(fixture.scene),before,'no unrelated successful branch may commit after a cycle failure');
});

test('reconvergence does not remove event transaction delivery and hop budgets',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),source=item('source'),scene=[source];
  const graph=records([[source,capabilities({},ports)]]);
  for(let index=0;index<65;index++){
    const target=item('target-'+index,{eventBindings:{a:{uid:'source',port:'value'},b:{uid:'source',port:'value'}}});
    scene.push(target);graph.set(target,{caps:capabilities({a:{type:'string'},b:{type:'string'}}),io:{inputs:{},outputs:{}}});
  }
  const before=JSON.stringify(scene);
  await assert.rejects(prepare(scene,source,eventState(1,[{port:'value',payload:'x'}]),async(_,__,args)=>eventState(args[2].count+1),()=>true,graph),/limit reached|budget/i);
  assert.equal(JSON.stringify(scene),before);
  const chain=[item('root')],chainGraph=records([[chain[0],capabilities({},ports)]]);
  for(let index=1;index<=18;index++){
    const node=item('hop-'+index,{eventBindings:{value:{uid:chain[index-1].uid,port:'value'}}});
    chain.push(node);chainGraph.set(node,{caps:capabilities(ports,ports),io:{inputs:{},outputs:{}}});
  }
  const chainBefore=JSON.stringify(chain);
  await assert.rejects(prepare(chain,chain[0],eventState(1,[{port:'value',payload:'x'}]),async(_,__,args)=>eventState(args[2].count+1,[{port:'value',payload:args[1]}]),()=>true,chainGraph),/limit reached|budget/i);
  assert.equal(JSON.stringify(chain),chainBefore);
});

test('pure companion recomputations share the bounded calculation budget with event receivers',async()=>{
  const {prepareComponentEventDelivery:prepare}=api(),source=item('source'),scene=[source],
    graph=records([[source,hybridSourceCaps()]]);
  const valueCaps={apiVersion:2,compute:true,inputs:{value:{type:'string',default:''}},outputs:{text:{type:'string'}},eventInputs:{},eventOutputs:{}};
  let previous=source,port='value';
  for(let index=0;index<17;index++){
    const target=item('value-'+index,{bindings:{value:{uid:previous.uid,port}}});
    scene.push(target);graph.set(target,{caps:valueCaps,io:{inputs:{value:'old'},outputs:{text:'old'}}});previous=target;port='text';
  }
  const receiver=item('receiver',{bindings:{line:{uid:source.uid,port:'value'},parameter:{uid:previous.uid,port:'text'}}}),
    receiverCaps={apiVersion:2,eventApi:1,onEvent:true,inputs:{line:{type:'string',event:true},parameter:{type:'string',default:''}},outputs:{},eventInputs:{},eventOutputs:{}};
  api().normalizeComponentHybridEvents(receiverCaps);scene.push(receiver);
  graph.set(receiver,{caps:receiverCaps,io:{inputs:{line:'old',parameter:'old'},outputs:{}}});
  const before=JSON.stringify(scene),events=Array.from({length:16},(_,index)=>({port:'value',payload:'new-'+index}));let calls=0;
  await assert.rejects(prepare(scene,source,eventState(1,events),async(target,hook,args)=>{
    calls++;
    if(target===receiver){assert.equal(hook,'onEvent');return eventState(args[2].count+1);}
    assert.equal(hook,'compute');return {text:args[0].value+'!'};
  },()=>true,graph),/calculation limit reached/i);
  assert.equal(calls,256,'value-only compute work cannot bypass the per-interaction call budget');
  assert.equal(JSON.stringify(scene),before,'exhaustion rejects the entire proposed update');
});

test('hybrid transform event chains use captured driver payloads and a fixed parameter snapshot without altering states',async()=>{
  const {prepareComponentEventDelivery:prepare,normalizeComponentHybridEvents:normalize}=api();
  const source=item('source'),extract=item('extract',{bindings:{text:{uid:'source',port:'value'}}}),memo=item('memo',{bindings:{line:{uid:'extract',port:'text'}}});
  const sourceCaps={apiVersion:2,eventApi:1,inputs:{},outputs:{value:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
  normalize(sourceCaps);
  const extractCaps={apiVersion:2,eventApi:1,compute:true,inputs:{text:{type:'string',event:true},start:{type:'number',default:2},length:{type:'number',default:3},reprocess:{type:'boolean',default:false,event:'command'}},outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
  normalize(extractCaps,{input:'text',outputs:['text'],reprocess:'reprocess'});
  const memoCaps={apiVersion:2,eventApi:1,onEvent:true,inputs:{line:{type:'string',event:true}},outputs:{},eventInputs:{},eventOutputs:{}};normalize(memoCaps);
  const graph=records([[source,sourceCaps],[extract,extractCaps],[memo,memoCaps]]);
  graph.get(extract).io.inputs={text:'old value',start:2,length:3,reprocess:false};
  const seen=[],before=JSON.stringify([source,extract,memo]);
  const changes=await prepare([source,extract,memo],source,eventState(1,[{port:'value',payload:'Hello World'},{port:'value',payload:'Another Test'}]),async(target,hook,args)=>{
    if(target===extract){assert.equal(hook,'compute');const [inputs]=args;seen.push({...inputs});return {text:inputs.text.slice(inputs.start,inputs.start+inputs.length)};}
    const [name,payload,state]=args;assert.equal(name,'line');return {...state,text:(state.text?state.text+'\n':'')+payload};
  },()=>true,graph);
  assert.deepEqual(seen.map(inputs=>inputs.text),['Hello World','Another Test']);
  assert.ok(seen.every(inputs=>inputs.start===2&&inputs.length===3));assert.equal(changes.get(memo).text,'llo\noth');
  assert.equal(JSON.stringify([source,extract,memo]),before);
  memo.eventModes={line:'value'};
  const ignored=await prepare([source,extract,memo],source,eventState(1,[{port:'value',payload:'Hello World'}]),async(target,hook,[inputs])=>{
    assert.equal(target,extract);assert.equal(hook,'compute');return {text:inputs.text.slice(2,5)};
  },()=>true,graph);assert.equal(ignored.has(memo),false,'value-only receiver retains the regular value connection without event delivery');
});

test('hybrid commands ignore false occurrences while true and payload-free occurrences execute once',async()=>{
  const {prepareComponentEventDelivery:prepare,normalizeComponentHybridEvents:normalize}=api();
  const source=item('source'),memo=item('memo',{bindings:{clear:{uid:'source',port:'value'}}});
  const sourceCaps={apiVersion:2,eventApi:1,inputs:{},outputs:{value:{type:'boolean',event:true}},eventInputs:{},eventOutputs:{}};normalize(sourceCaps);
  const memoCaps={apiVersion:2,eventApi:1,onEvent:true,inputs:{clear:{type:'boolean',event:'command'}},outputs:{},eventInputs:{},eventOutputs:{}};normalize(memoCaps);
  const graph=records([[source,sourceCaps],[memo,memoCaps]]);let called=0;
  for(const payload of [false,true,false,true])await prepare([source,memo],source,eventState(1,[{port:'value',payload}]),async(_,__,[name,payload,state])=>{
    assert.equal(name,'clear');assert.equal(payload,true);called++;return state;
  },()=>true,graph);
  assert.equal(called,2);
  sourceCaps.eventOutputs.click={types:['none'],type:'none'};memo.eventBindings={clear:{uid:'source',port:'click'}};
  await prepare([source,memo],source,eventState(1,[{port:'click',payload:null}]),async(_,__,[name,payload,state])=>{
    assert.equal(name,'clear');assert.equal(payload,null);called++;return state;
  },()=>true,graph);assert.equal(called,3);
});

test('Reprocess samples every current input, preserves equal emissions, and ignores a false command',async()=>{
  const {transformComponentEvent:transform,normalizeComponentHybridEvents:normalize,componentReplyEvents:events}=api();
  const caps={compute:true,inputs:{text:{type:'string',event:true},start:{type:'number',default:0},length:{type:'number',default:1},reprocess:{type:'boolean',default:false,event:'command'}},outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
  normalize(caps,{input:'text',outputs:['text'],reprocess:'reprocess'});
  const target=item('extract'),io={inputs:{text:'Another Test',start:3,length:5,reprocess:false}},seen=[];
  const call=async(_,hook,[inputs])=>{assert.equal(hook,'compute');seen.push({...inputs});return {text:inputs.text.slice(inputs.start,inputs.start+inputs.length)};};
  for(const payload of [true,null,true]){
    const reply=await transform(target,caps,'reprocess',payload,target.state,io,call);assert.deepEqual(plain(events(reply)),[{port:'text',payload:'ther '}]);
  }
  const reply=await transform(target,caps,'reprocess',false,target.state,io,call);assert.equal(events(reply).length,0);assert.equal(seen.length,3);
  assert.ok(seen.every(inputs=>JSON.stringify(inputs)===JSON.stringify(io.inputs)),'Reprocess uses one complete current snapshot');
});

test('transform events reject unavailable bound parameters instead of silently substituting defaults',async()=>{
  const {transformComponentEvent:transform,normalizeComponentHybridEvents:normalize}=api();
  const caps={compute:true,inputs:{text:{type:'string',event:true},start:{type:'number',default:0},length:{type:'number',default:3},mode:{type:'string',default:'range',options:['range']},reprocess:{type:'boolean',default:false,event:'command'}},outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{}};
  normalize(caps,{input:'text',outputs:['text'],reprocess:'reprocess'});
  const target=item('extract',{bindings:{start:{uid:'missing',port:'value'}}});let calls=0;
  const call=async(_,hook,[inputs])=>{assert.equal(hook,'compute');calls++;return {text:inputs.text.slice(inputs.start,inputs.start+inputs.length)};};
  await assert.rejects(transform(target,caps,'text','Hello World',target.state,{inputs:{length:3,mode:'range',reprocess:true}},call),/matching number/);
  assert.equal(calls,0,'broken bound parameter never reaches compute with a fabricated zero');
  target.bindings={};target.inputValues={start:2};
  const next=await transform(target,caps,'text','Hello World',target.state,{inputs:{reprocess:true}},call);
  assert.deepEqual(plain(api().componentReplyEvents(next)),[{port:'text',payload:'llo'}]);assert.equal(calls,1,'unbound literal and defaults remain available');
  await assert.rejects(transform(target,caps,'text','Hello World',target.state,{inputs:{start:2,length:3,mode:'unsupported'}},call),/Unsupported value for mode/);
  assert.equal(calls,1);
});
