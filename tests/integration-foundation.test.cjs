const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseApp}=require('./helpers/app-source.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),app=parseApp(html);
const plain=value=>JSON.parse(JSON.stringify(value));
function runtime(){
  const scope=vm.createContext({URL,AbortController,TextEncoder,TextDecoder,Response,Headers,ReadableStream,setTimeout,clearTimeout,console,
    performance:{now:()=>0},datasets:{},smartCancelled:()=>Object.assign(new Error('Cancelled'),{cancelled:true}),
    normalizeSmartState:plain,smartNumber:v=>v,smartItemExecutions:new Map(),disposeSmartExecution:()=>{},componentRuntimeId:item=>item.uid,componentViewIo:(item,io)=>io});
  const ranges=[['// ---------- embedded datasets ----------','// End of embedded dataset contract.'],
    ['  function componentScalar(','  function normalizeComponentSettings('],['  function componentGraphSignature(','  let editorComponentEvaluation='],
    ['  function createComponentHttpCompletions(','  // Sensitive configuration']];
  vm.runInContext(ranges.map(([a,b])=>html.slice(html.indexOf(a),html.indexOf(b))).join('\n')+
    '\nthis.api={createComponentIntegrationService,createComponentHttpCompletions,normalizeComponentHttpSource,componentHttpConfiguration,componentHttpRequest,componentHttpValue,normalizeComponentActionDeclarations,normalizeComponentActionEvents,captureComponentActionIntent,prepareComponentEventDelivery,normalizeComponentHybridEvents,runComponentEvaluation,settleComponentTimeline,createComponentTimeline,takeComponentDataActions};',scope);
  return scope.api;
}
const api=runtime();
const outputs={value:{type:'number'},json:{type:'string'},available:{type:'boolean'},loading:{type:'boolean'},error:{type:'string'},lastUpdated:{type:'number'}};
const caps={apiVersion:2,integrationApi:1,compute:true,inputs:{url:{type:'string',default:'https://data.test/value'},path:{type:'string',default:'/value'}},outputs,
  httpSource:{url:'url',path:'path',valueType:'number',timeoutMs:1000}};
const item=(uid='source')=>({uid,type:'smart',script:'source script',componentApi:2,state:{},inputValues:{url:'https://data.test/value',path:'/value'}});
const record=(subject,type=caps)=>({caps:type,io:{inputs:{...subject.inputValues},outputs:{}}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const json=(value,options={})=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'},...options});
async function until(predicate){for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Condition did not settle');}

test('integration declarations and JSON pointers are bounded and typed',()=>{
  assert.deepEqual(plain(api.normalizeComponentHttpSource(caps.httpSource,caps)),{...caps.httpSource,method:'GET'});
  for(const source of [{...caps.httpSource,url:'missing'},{...caps.httpSource,timeoutMs:10},{...caps.httpSource,valueType:'table'},{...caps.httpSource,method:'POST'}])
    assert.throws(()=>api.normalizeComponentHttpSource(source,caps));
  assert.throws(()=>api.normalizeComponentHttpSource(caps.httpSource,{...caps,integrationApi:2}));
  assert.throws(()=>api.normalizeComponentHttpSource(caps.httpSource,{...caps,publish:true}));
  assert.equal(api.componentHttpValue({'a/b':{'~':4}},'/a~1b/~0','number'),4);
  assert.equal(api.componentHttpValue([4,9],'/1','number'),9);
  assert.throws(()=>api.componentHttpValue({},'/toString','string'));
  for(const url of ['javascript:alert(1)','file:///tmp/data.json','https://name:secret@data.test/'])
    assert.throws(()=>api.componentHttpRequest(caps,{url,path:'/value'},'https://app.test/'));
  assert.equal(api.componentHttpRequest(caps,{url:'./data.json',path:'/value'},'https://app.test/canvas/').url,'https://app.test/canvas/data.json');
});

test('manual requests launch independently, return immediately and only the newest completion publishes',async()=>{
  const requests=[],notifications=[],source=item(),other=item('other'),before=JSON.stringify(source);
  const service=api.createComponentIntegrationService({fetch:(url,options)=>{const pending=deferred();requests.push({url,options,...pending});return pending.promise;},
    now:()=>1234,onChange:(item,snapshot)=>notifications.push([item.uid,plain(snapshot)])});
  try{
    assert.throws(()=>service.start(source,record(source),{origin:'restoration'}),/explicit Refresh/);
    assert.equal(requests.length,0);
    const first=service.start(source,record(source),{origin:'user'});
    assert.equal(first.loading,true);assert.equal(typeof first.then,'undefined');
    service.start(other,record(other),{origin:'user'});service.start(source,record(source),{origin:'user'});
    assert.equal(requests.length,3);assert.equal(requests[0].options.signal.aborted,true);
    assert.equal(requests[2].options.credentials,'omit');assert.equal(requests[2].options.redirect,'error');
    requests[2].resolve(json({value:72}));requests[1].resolve(json({value:13}));
    await until(()=>service.read(source,caps,source.inputValues).available && service.read(other,caps,other.inputValues).available);
    requests[0].resolve(json({value:99}));await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(service.read(source,caps,source.inputValues).value,72);assert.equal(service.read(other,caps,other.inputValues).value,13);
    assert.equal(service.read(source,caps,source.inputValues).json,'{"value":72}');assert.equal(service.read(source,caps,source.inputValues).lastUpdated,1234);
    const revision=service.revision;
    assert.equal(service.peek(source,caps,source.inputValues).value,72);
    assert.equal(service.peek(source,caps,{...source.inputValues,path:'/draft'}).available,false);
    assert.equal(service.peek(source,{...caps,httpSource:{...caps.httpSource,valueType:'string'}},source.inputValues).available,false);
    assert.equal(service.peek(item('unseen'),caps,source.inputValues).available,false);
    assert.equal(service.revision,revision,'inspection neither creates sources nor changes the live configuration');
    assert.equal(service.read(source,caps,source.inputValues).value,72);
    assert.equal(JSON.stringify(source),before,'result and request handles never enter saved state');
    assert.equal(notifications.filter(([,snapshot])=>snapshot.available).length,2);
  }finally{service.dispose();}
});

test('scope removal, configuration edits, cancellation and restored identities reject late results',async()=>{
  const requests=[],service=api.createComponentIntegrationService({fetch:()=>{const pending=deferred();requests.push(pending);return pending.promise;}}),source=item();
  try{
    service.start(source,record(source),{origin:'user'});source.inputValues.path='/other';
    requests[0].resolve(json({value:12,other:41}));await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(service.read(source,caps,source.inputValues).available,false);
    service.start(source,record(source),{origin:'user'});service.reconcile([]);requests[1].resolve(json({other:43}));
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(service.read(source,caps,source.inputValues).available,false);
    service.start(source,record(source),{origin:'user'});service.cancel(source,'Credentials changed');requests[2].resolve(json({other:44}));
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(service.read(source,caps,source.inputValues).available,false);
    const restored=plain(source);assert.equal(service.read(restored,caps,restored.inputValues).available,false,'same saved UID cannot reuse the live source owner');
    assert.equal(requests.length,3,'reads and restoration never issue requests');
  }finally{service.dispose();}
});

test('bounded responses, invalid JSON, failed status and timeout expose safe errors',async()=>{
  const cases=[
    [()=>new Response('no',{status:503}),/HTTP 503/],
    [()=>new Response('html',{headers:{'content-type':'text/html'}}),/JSON content type/],
    [()=>new Response('{',{headers:{'content-type':'application/json'}}),/not valid JSON/],
    [()=>new Response('{"value":2,"unselected":1e999}',{headers:{'content-type':'application/json'}}),/finite/],
    [()=>json({value:'x'.repeat(2100)}),/2000 characters/],
    [()=>new Response(' '.repeat(65537),{headers:{'content-type':'application/json'}}),/64 KiB/],
    [()=>json({wrong:2}),/pointer/],
    [()=>json({value:'wrong'}),/matching number/],
    [()=>{throw new Error('secret-password https://private.test/?token=secret');},/HTTP request failed/]
  ];
  for(const [reply,expected] of cases){
    const source=item(),service=api.createComponentIntegrationService({fetch:async()=>reply()});
    try{service.start(source,record(source),{origin:'user'});await until(()=>!service.read(source,caps,source.inputValues).loading);
      const result=service.read(source,caps,source.inputValues);assert.equal(result.available,false);assert.match(result.error,expected);assert.doesNotMatch(JSON.stringify(result),/secret-password|token=secret/);
    }finally{service.dispose();}
  }
  const source=item(),timeoutCaps={...caps,httpSource:{...caps.httpSource,timeoutMs:100}},pending=deferred(),service=api.createComponentIntegrationService({fetch:()=>pending.promise});
  try{
    service.start(source,record(source,timeoutCaps),{origin:'user'});await until(()=>service.read(source,timeoutCaps,source.inputValues).status==='error');
    assert.match(service.read(source,timeoutCaps,source.inputValues).error,/timed out/);
    pending.resolve(json({value:88}));await new Promise(resolve=>setTimeout(resolve,10));assert.equal(service.read(source,timeoutCaps,source.inputValues).available,false);
  }finally{service.dispose();}
});

test('credential headers stay host-owned and never appear in source snapshots or saved state',async()=>{
  const source=item(),before=JSON.stringify(source);let captured;
  const service=api.createComponentIntegrationService({credentials:(item,request)=>{assert.equal(item,source);assert.equal(request.url,'https://data.test/value');return {Authorization:'Bearer session-secret'};},
    fetch:async(url,options)=>{captured=options;return json({value:4});}});
  try{
    service.start(source,record(source),{origin:'user'});await until(()=>service.read(source,caps,source.inputValues).available);
    assert.equal(captured.headers.Authorization,'Bearer session-secret');assert.doesNotMatch(JSON.stringify(service.read(source,caps,source.inputValues)),/session-secret/);assert.equal(JSON.stringify(source),before);
  }finally{service.dispose();}
});

test('pure inspection keeps a ready request whose URL comes from another component',async()=>{
  const source=item(),url={uid:'url',type:'smart',script:'url',componentApi:2,state:{}},inputs={url:'https://bound.test/feed',path:'/value'};
  source.inputValues={path:'/value'};source.bindings={url:{uid:'url',port:'value'}};
  const service=api.createComponentIntegrationService({fetch:async()=>json({value:42})});
  const call=async(subject,hook,args)=>{
    if(hook==='caps')return subject.uid==='source'?caps:{apiVersion:2,compute:true,inputs:{},outputs:{value:{type:'string'}}};
    if(subject.uid==='url')return {value:inputs.url};
    const live=args[2]?.source||{};
    return {value:live.available?live.value:0,json:live.json||'',available:!!live.available,loading:!!live.loading,error:live.error||'',lastUpdated:live.lastUpdated||0};
  };
  try{
    service.start(source,{caps,io:{inputs}},{origin:'user'});await until(()=>service.read(source,caps,inputs).available);
    const graph=await api.runComponentEvaluation([source,url],call,()=>true,{datasets:{},integrationSource:(item,caps,inputs)=>service.read(item,caps,inputs)});
    assert.equal(graph.get(source).io.outputs.value,42,'pre-round probing cannot mistake an unresolved bound URL for a configuration edit');
  }finally{service.dispose();}
});

test('concurrent requests are bounded and discarded response bodies are aborted',async()=>{
  const requests=[],service=api.createComponentIntegrationService({fetch:(url,options)=>{const pending=deferred();requests.push({...pending,options});return pending.promise;}});
  try{
    const sources=Array.from({length:17},(_,index)=>item('source-'+index));
    for(const source of sources.slice(0,16))service.start(source,record(source),{origin:'user'});
    assert.throws(()=>service.start(sources[16],record(sources[16]),{origin:'user'}),/16 HTTP requests/);
    assert.equal(requests.length,16);
    service.start(sources[0],record(sources[0]),{origin:'user'});
    assert.equal(requests[0].options.signal.aborted,true,'replacing a request does not consume another concurrency slot');
    requests[16].resolve(new Response('ignored',{headers:{'content-type':'text/html'}}));
    await until(()=>service.read(sources[0],caps,sources[0].inputValues).status==='error');
    assert.equal(requests[16].options.signal.aborted,true,'rejected bodies are stopped before an unbounded download');
    service.start(sources[16],record(sources[16]),{origin:'user'});assert.equal(requests.length,18);
  }finally{service.dispose();}
  assert.ok(requests.every(request=>request.options.signal.aborted));
});

test('disabled integrations expose stable status, reject starts and invalidate pending responses',async()=>{
  let enabled=false,calls=0;const source=item(),pending=deferred(),service=api.createComponentIntegrationService({enabled:()=>enabled,fetch:()=>{calls++;return pending.promise;}});
  try{
    const disabled=service.read(source,caps,source.inputValues);assert.equal(disabled.status,'disabled');assert.equal(disabled.available,false);
    assert.equal(service.read(source,caps,source.inputValues).revision,disabled.revision);
    assert.throws(()=>service.start(source,record(source),{origin:'user'}),/disabled/);assert.equal(calls,0);
    enabled=true;assert.equal(service.read(source,caps,source.inputValues).status,'idle');service.start(source,record(source),{origin:'user'});
    enabled=false;assert.equal(service.read(source,caps,source.inputValues).status,'disabled');pending.resolve(json({value:42}));await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(service.read(source,caps,source.inputValues).available,false);enabled=true;assert.equal(service.read(source,caps,source.inputValues).available,false);assert.equal(calls,1);
  }finally{service.dispose();}
});

test('transient source publication keeps status and unrelated branches live while data is unavailable',async()=>{
  const source=item(),consumer={uid:'consumer',type:'smart',script:'consumer',componentApi:2,state:{},bindings:{value:{uid:source.uid,port:'value'}}};
  const status={uid:'status',type:'smart',script:'status',componentApi:2,state:{},bindings:{loading:{uid:source.uid,port:'loading'}}};
  const other={uid:'other',type:'smart',script:'other',componentApi:2,state:{value:17}};
  const pending=deferred(),service=api.createComponentIntegrationService({fetch:()=>pending.promise});
  const call=async(subject,hook,args)=>{
    if(hook==='caps')return subject.uid==='source'?caps:subject.uid==='consumer'?{apiVersion:2,compute:true,inputs:{value:{type:'number'}},outputs:{value:{type:'number'}}}:
      subject.uid==='status'?{apiVersion:2,compute:true,inputs:{loading:{type:'boolean'}},outputs:{loading:{type:'boolean'}}}:{apiVersion:2,compute:true,inputs:{},outputs:{value:{type:'number'}}};
    if(subject.uid==='source'){
      const live=args[2]?.source||{};
      if(!live.available){assert.equal(live.value,undefined,'stale values must not reach compute');assert.equal(live.json,undefined,'stale JSON must not reach compute');}
      return {value:live.available?live.value:0,json:live.json||'',available:!!live.available,loading:!!live.loading,error:live.error||'',lastUpdated:live.lastUpdated||0};
    }
    return subject.uid==='other'?{value:args[1].value}:args[0];
  };
  const scene=[source,consumer,status,other],timeline=api.createComponentTimeline(()=>0),before=JSON.stringify(scene);
  const evaluate=()=>api.settleComponentTimeline(scene,call,()=>true,timeline,{datasets:{},integrationSource:(item,caps,inputs)=>service.read(item,caps,inputs)});
  try{
    let graph=await evaluate();assert.match(graph.get(consumer).error,/no current result/);assert.equal(graph.get(consumer).unknown,true,'a valid undriven binding may still be saved');assert.equal(graph.get(other).io.outputs.value,17);assert.equal(graph.get(status).io.outputs.loading,false);
    service.start(source,graph.get(source),{origin:'user'});graph=await evaluate();assert.equal(graph.get(status).io.outputs.loading,true);assert.match(graph.get(consumer).error,/loading/);
    pending.resolve(json({value:42}));await until(()=>service.read(source,caps,source.inputValues).available);
    graph=await evaluate();assert.equal(graph.get(consumer).io.outputs.value,42);assert.equal(graph.get(source).io.outputs.json,'{"value":42}');assert.equal(graph.get(status).io.outputs.loading,false);
    assert.equal(timeline.changed,false);assert.equal(JSON.stringify(scene),before);
    service.cancel(source,'Disconnected');graph=await evaluate();assert.match(graph.get(consumer).error,/Disconnected/);assert.equal(graph.get(source).io.source.value,42,'last-known snapshot is presentation-only');assert.equal(graph.get(source).io.outputs.value,undefined);
  }finally{service.dispose();}
});

for(const depth of [0,2])test('unavailable source data cannot be sampled through '+depth+' cached transforms',async()=>{
  const source=item(),transforms=Array.from({length:depth},(_,index)=>({uid:'transform-'+index,type:'smart',script:'transform',componentApi:2,state:{},bindings:{value:{uid:index?'transform-'+(index-1):source.uid,port:'value'}}}));
  const held={uid:'held',type:'smart',script:'held',componentApi:2,state:{value:0},inputValues:{sample:false},bindings:{value:{uid:transforms.at(-1)?.uid||source.uid,port:'value'}}};
  const service=api.createComponentIntegrationService({fetch:async()=>json({value:42})});
  const heldCaps={apiVersion:2,publish:true,transition:true,inputs:{value:{type:'number'},sample:{type:'boolean',default:false}},outputs:{value:{type:'number'}}};
  const call=async(subject,hook,args)=>{
    if(hook==='caps')return subject.uid==='source'?caps:subject.uid==='held'?heldCaps:{apiVersion:2,compute:true,inputs:{value:{type:'number'}},outputs:{value:{type:'number'}}};
    if(subject.uid==='source'){
      const live=args[2]?.source||{};
      return {value:live.available?live.value:0,json:live.json||'',available:!!live.available,loading:!!live.loading,error:live.error||'',lastUpdated:live.lastUpdated||0};
    }
    if(subject.uid!=='held')return args[0];
    if(hook==='publish')return {value:args[0].value};
    const [inputs,state,memory]=args;
    return {state:inputs.sample && !memory.sample?{value:inputs.value}:state,memory:{sample:inputs.sample}};
  };
  const scene=[held,...transforms.toReversed(),source],timeline=api.createComponentTimeline(()=>0);
  const evaluate=()=>api.settleComponentTimeline(scene,call,()=>true,timeline,{datasets:{},integrationSource:(item,caps,inputs)=>service.read(item,caps,inputs)});
  try{
    let graph=await evaluate();service.start(source,graph.get(source),{origin:'user'});
    await until(()=>service.read(source,caps,source.inputValues).available);graph=await evaluate();
    assert.equal(held.state.value,0);assert.equal(graph.get(source).io.outputs.value,42);
    service.cancel(source,'Disconnected');held.inputValues.sample=true;
    graph=await evaluate();
    assert.equal(held.state.value,0,'a new sample cannot use an unavailable prior publication');
    assert.equal(graph.get(held).io.outputs.value,0,'already stored output stays independent of unavailable input');
  }finally{service.dispose();}
});

const automatedCaps={...caps,inputs:{...caps.inputs,enabled:{type:'boolean',default:true},interval:{type:'number',default:1},refresh:{type:'boolean',default:false,event:'action'}},
  dataActions:{refresh:{type:'httpGet',trigger:'refresh'}},httpSource:{...caps.httpSource,method:'GET',automation:{enabled:'enabled',interval:'interval',polling:true,onChange:true,startup:true,debounceMs:300}}};
const postCaps={...caps,inputs:{...caps.inputs,body:{type:'string',default:'{}'},idempotencyKey:{type:'string',default:''},send:{type:'boolean',default:false,event:'action'}},outputs:{...outputs,httpStatus:{type:'number'}},
  dataActions:{send:{type:'httpPost',trigger:'send'}},httpSource:{...caps.httpSource,method:'POST',body:'body',idempotencyKey:'idempotencyKey'}};
const postItem=()=>({...item(),inputValues:{...item().inputValues,body:' {"value": 7} ',idempotencyKey:'request-7',send:false}});

test('HTTP automation, write actions and completion ports have explicit bounded contracts',()=>{
  assert.deepEqual(plain(api.normalizeComponentHttpSource(automatedCaps.httpSource,automatedCaps)),automatedCaps.httpSource);
  assert.deepEqual(plain(api.normalizeComponentHttpSource(postCaps.httpSource,postCaps)),postCaps.httpSource);
  for(const automation of [{enabled:'path'},{enabled:'enabled',polling:true},{enabled:'enabled',debounceMs:10001},{enabled:'enabled',startup:1}])
    assert.throws(()=>api.normalizeComponentHttpSource({...automatedCaps.httpSource,automation},automatedCaps));
  assert.throws(()=>api.normalizeComponentHttpSource({...postCaps.httpSource,automation:{}},postCaps));
  assert.throws(()=>api.normalizeComponentHttpSource(postCaps.httpSource,{...postCaps,outputs:{...postCaps.outputs,httpStatus:{type:'string'}}}));
  assert.deepEqual(plain(api.normalizeComponentActionDeclarations(postCaps.dataActions,postCaps.inputs,postCaps)),postCaps.dataActions);
  assert.throws(()=>api.normalizeComponentActionDeclarations(postCaps.dataActions,postCaps.inputs,automatedCaps),/method/);
  assert.throws(()=>api.normalizeComponentActionDeclarations({send:{type:'httpPost',trigger:'body'}},postCaps.inputs,postCaps),/Boolean/);
  const events={httpPost:{success:'completed',failure:'failed'}},declared={...postCaps,eventApi:1,eventOutputs:{completed:{types:['string']},failed:{types:['string']}}};
  assert.deepEqual(plain(api.normalizeComponentActionEvents(events,declared)),events);
  assert.throws(()=>api.normalizeComponentActionEvents(events,{...declared,eventOutputs:{...declared.eventOutputs,completed:{types:['number']}}}),/string/);
  for(const body of ['not json','{"bad":1e999}',JSON.stringify('x'.repeat(2000))])assert.throws(()=>api.componentHttpRequest(postCaps,{...postItem().inputValues,body}));
  for(const idempotencyKey of ['bad\r\nheader','x'.repeat(201),'ä'])assert.throws(()=>api.componentHttpRequest(postCaps,{...postItem().inputValues,idempotencyKey}),/Idempotency/);
});

test('GET automation requires Enabled and its selected mode; explicit Refresh stays available',async()=>{
  const source={...item(),inputValues:{...item().inputValues,enabled:false,interval:1,refresh:false}},requests=[];
  const service=api.createComponentIntegrationService({fetch:async(url,options)=>{requests.push(options);return json({value:1});}});
  try{
    for(const origin of ['signal','event','timer','change','startup'])assert.throws(()=>service.start(source,record(source,automatedCaps),{origin}),/disabled/);
    service.start(source,record(source,automatedCaps),{origin:'user'});await until(()=>service.read(source,automatedCaps,source.inputValues).available);
    source.inputValues.enabled=true;
    for(const origin of ['signal','event','timer','change','startup']){
      service.start(source,record(source,automatedCaps),{origin});await until(()=>service.read(source,automatedCaps,source.inputValues).available);
    }
    assert.equal(requests.length,6);
    const disabledMode={...automatedCaps,httpSource:{...automatedCaps.httpSource,automation:{...automatedCaps.httpSource.automation,polling:false,onChange:false,startup:false}}};
    for(const origin of ['timer','change','startup'])assert.throws(()=>service.start(source,record(source,disabledMode),{origin}),/not enabled/);
    source.inputValues.interval=.1;assert.throws(()=>service.start(source,record(source,automatedCaps),{origin:'timer'}),/interval/);
  }finally{service.dispose();}
});

test('POST freezes body and idempotency key, survives form edits, and never supersedes a pending write',async()=>{
  const source=postItem(),pending=deferred(),requests=[],completions=[];
  const service=api.createComponentIntegrationService({fetch:(url,options)=>{requests.push({url,options});return pending.promise;},onComplete:(item,snapshot,context)=>completions.push({item,snapshot,context})});
  const context={origin:'event',requestId:17};
  try{
    const captured=api.captureComponentActionIntent(source,'send',record(source,postCaps),{});
    const before=api.componentHttpConfiguration(source,postCaps);
    service.start(source,captured.record,context);
    source.inputValues.body='not valid JSON yet';source.inputValues.idempotencyKey='another key';source.inputValues.send=true;source.bindings={body:{uid:'new-form',port:'text'}};
    assert.equal(api.componentHttpConfiguration(source,postCaps),before,'body, key and trigger edits prepare the next command');
    assert.equal(service.read(source,postCaps,source.inputValues).loading,true);
    assert.throws(()=>service.start(source,captured.record,{origin:'user'}),/already in progress/);
    assert.equal(requests.length,1);assert.equal(requests[0].options.method,'POST');assert.equal(requests[0].options.body,'{"value":7}');
    assert.equal(requests[0].options.headers['Content-Type'],'application/json');assert.equal(requests[0].options.headers['Idempotency-Key'],'request-7');
    assert.equal(requests[0].options.signal.aborted,false);
    pending.resolve(json({value:7}));await until(()=>service.read(source,postCaps,source.inputValues).available);
    assert.equal(completions.length,1);assert.equal(completions[0].context.requestId,context.requestId);assert.equal(completions[0].snapshot.httpStatus,200);
    assert.equal(completions[0].context.matches(postCaps,source.inputValues),true,'completed POST still matches changed form contents');
    assert.equal(service.read(source,postCaps,source.inputValues).value,7);
    source.inputValues.path='/other';assert.equal(service.read(source,postCaps,source.inputValues).available,false,'mapping changes invalidate the response');
    for(const origin of ['timer','change','startup'])assert.throws(()=>service.start(source,captured.record,{origin}),/explicit Send/);
  }finally{service.dispose();}
});

test('POST 204/205 completes without data; response and mapping failures preserve HTTP status',async()=>{
  for(const status of [204,205]){
    const source=postItem(),completions=[],service=api.createComponentIntegrationService({fetch:async()=>new Response(null,{status}),onComplete:(item,snapshot)=>completions.push(snapshot)});
    try{
      service.start(source,record(source,postCaps),{origin:'user'});await until(()=>service.read(source,postCaps,source.inputValues).status==='ready');
      const result=service.read(source,postCaps,source.inputValues);assert.equal(result.available,false);assert.equal(result.value,undefined);assert.equal(result.json,'');assert.equal(result.httpStatus,status);
      assert.equal(completions.length,1);assert.equal(completions[0].status,'ready');
    }finally{service.dispose();}
  }
  for(const [response,status,error] of [[()=>json({other:9}),200,/pointer/],[()=>new Response('bad',{status:200,headers:{'content-type':'application/json'}}),200,/valid JSON/],[()=>new Response('no',{status:409}),409,/409/]]){
    const source=postItem(),completions=[],service=api.createComponentIntegrationService({fetch:async()=>response(),onComplete:(item,snapshot)=>completions.push(snapshot)});
    try{
      service.start(source,record(source,postCaps),{origin:'user'});await until(()=>service.read(source,postCaps,source.inputValues).status==='error');
      assert.equal(completions.length,1);assert.equal(completions[0].httpStatus,status);assert.match(completions[0].error,error);
    }finally{service.dispose();}
  }
});

test('completion fires once per accepted result or timeout and never for superseded or cancelled requests',async()=>{
  const source=item(),requests=[],completed=[],short={...caps,httpSource:{...caps.httpSource,timeoutMs:100}};
  const service=api.createComponentIntegrationService({fetch:()=>{const pending=deferred();requests.push(pending);return pending.promise;},onComplete:(item,snapshot,context)=>completed.push({snapshot,context})});
  try{
    service.start(source,record(source),{origin:'user',tag:'old'});service.start(source,record(source),{origin:'user',tag:'new'});
    requests[0].resolve(json({value:1}));requests[1].resolve(json({value:2}));await until(()=>completed.length===1);
    assert.equal(completed[0].context.tag,'new');
    service.start(source,record(source),{origin:'user',tag:'cancelled'});service.cancel(source);requests[2].resolve(json({value:3}));await new Promise(resolve=>setTimeout(resolve,10));assert.equal(completed.length,1);
    service.start(source,record(source,short),{origin:'user',tag:'timeout'});await until(()=>completed.length===2);requests[3].resolve(json({value:4}));
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(completed.length,2);assert.match(completed[1].snapshot.error,/timed out/);
  }finally{service.dispose();}
});

test('automatic HTTP feedback is rate bounded while manual requests and other instances remain usable',async()=>{
  let now=1000,calls=0;const source={...item(),inputValues:{...item().inputValues,enabled:true,interval:1}},other={...item('other'),inputValues:{...item().inputValues,enabled:true,interval:1}};
  const service=api.createComponentIntegrationService({now:()=>now,fetch:async()=>{calls++;return json({value:calls});}});
  const start=async(item,origin)=>{service.start(item,record(item,automatedCaps),{origin});await until(()=>service.read(item,automatedCaps,item.inputValues).available);};
  try{
    for(let i=0;i<30;i++)await start(source,'event');
    assert.throws(()=>service.start(source,record(source,automatedCaps),{origin:'event'}),/30 requests per 10 seconds/);assert.equal(calls,30);
    await start(source,'user');await start(other,'event');assert.equal(calls,32);
    now=11001;await start(source,'event');assert.equal(calls,33);
  }finally{service.dispose();}
});

test('HTTP signal capture waits for final graph values and Step settlement without issuing requests',async()=>{
  const source=postItem();source.inputValues.send=false;source.bindings={send:{uid:'trigger',port:'value'},body:{uid:'format',port:'value'}};
  const trigger={uid:'trigger',type:'smart',script:'trigger',componentApi:2,state:{value:false}},value={uid:'value',type:'smart',script:'value',componentApi:2,state:{value:1}};
  const format={uid:'format',type:'smart',script:'format',componentApi:2,state:{},bindings:{value:{uid:'value',port:'value'}}};
  const call=async(item,hook,args)=>{
    if(hook==='caps')return item===source?postCaps:item===trigger?{apiVersion:2,compute:true,inputs:{},outputs:{value:{type:'boolean'}}}:item===value?{apiVersion:2,compute:true,inputs:{},outputs:{value:{type:'number'}}}:{apiVersion:2,compute:true,inputs:{value:{type:'number'}},outputs:{value:{type:'string'}}};
    if(item===source)return {value:0,json:'',available:false,loading:false,error:'',lastUpdated:0,httpStatus:0};
    return {value:item===format?JSON.stringify({value:args[0].value}):args[1].value};
  };
  const scene=[source,format,trigger,value],timeline=api.createComponentTimeline(()=>0),options={timeline,datasets:{}};
  await api.runComponentEvaluation(scene,call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,0);
  trigger.state.value=true;value.state.value=23;
  await api.runComponentEvaluation(scene,call,()=>true,{...options,step:true});assert.equal(api.takeComponentDataActions(timeline).length,0);
  for(let i=0;i<10 && timeline.pendingTime!==null;i++)await api.runComponentEvaluation(scene,call,()=>true,{...options,step:true});
  const [intent]=api.takeComponentDataActions(timeline);assert.ok(intent);assert.equal(intent.provenance,'signal');assert.equal(intent.record.io.inputs.body,'{"value":23}');
  source.inputValues.body='next';value.state.value=99;assert.equal(intent.record.io.inputs.body,'{"value":23}','the accepted snapshot stays immutable');
  await api.runComponentEvaluation(scene,call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,0,'held true does not repeat');
});

test('HTTP event capture retains the occurrence body and provenance without changing component state',async()=>{
  const source=postItem();source.eventBindings={send:{uid:'editor',port:'text'}};source.bindings={body:{uid:'editor',port:'text'}};
  const editor={uid:'editor',type:'smart',script:'editor',componentApi:2,state:{text:'old'}};
  const targetCaps=plain({...postCaps,eventApi:1,eventInputs:{},eventOutputs:{}});api.normalizeComponentHybridEvents(targetCaps);
  const editorCaps={apiVersion:2,eventApi:1,compute:true,inputs:{},outputs:{text:{type:'string',event:true}},eventInputs:{},eventOutputs:{text:{types:['string'],hybrid:true}}};
  const records=new Map([[editor,{caps:editorCaps,io:{inputs:{},outputs:{text:'old'}}}],[source,{caps:targetCaps,io:{inputs:{...source.inputValues,body:'old'},outputs:{}}}]]);records.datasets={};
  const next={text:'{"value":8}'};Object.defineProperty(next,Symbol.for('simplecanvas.events'),{value:[{port:'text',payload:next.text}]});
  const before=JSON.stringify(source),changes=await api.prepareComponentEventDelivery([editor,source],editor,next,async()=>{throw new Error('HTTP actions do not call scripts');},()=>true,records);
  const [intent]=changes[Symbol.for('simplecanvas.actionIntents')];assert.equal(intent.provenance,'event');assert.equal(intent.record.io.inputs.body,'{"value":8}');assert.equal(JSON.stringify(source),before);
});

test('completion matching checks resolved endpoint inputs without discarding older completed occurrences for the same configuration',async()=>{
  const source={...item(),bindings:{url:{uid:'url-source',port:'text'}}},completed=[];
  const service=api.createComponentIntegrationService({fetch:async()=>json({value:4}),onComplete:(item,snapshot,context)=>completed.push(context)});
  const inputs={url:'https://data.test/first',path:'/value'},accepted={caps,io:{inputs}};
  try{
    service.start(source,accepted,{origin:'user',valid:()=>true});await until(()=>completed.length===1);
    const context=completed[0];assert.equal(context.matches(caps,inputs),true);
    assert.equal(context.matches(caps,{...inputs,url:'https://data.test/second'}),false,'resolved bound URL changed while raw binding stayed the same');
    assert.equal(context.matches(caps,{...inputs,path:'/other'}),false);
    service.start(source,accepted,{origin:'user',valid:()=>true});await until(()=>completed.length===2);
    assert.equal(context.matches(caps,inputs),true,'a later request must not erase an already completed identical occurrence');
    source.state.valueType='string';assert.equal(context.matches(caps,inputs),false,'configuration edits still invalidate the old occurrence');
  }finally{service.dispose();}
});

test('completion queue retains a response hidden during preparation and never repeats an accepted event after paint cancellation',async()=>{
  let paused=false,attempts=0,committed=0;const jobs=[],errors=[],cancelled=()=>Object.assign(new Error('Cancelled'),{cancelled:true});
  const queue=api.createComponentHttpCompletions({paused:()=>paused,enqueue:task=>jobs.push(task),error:message=>errors.push(message),
    async deliver(item,snapshot,context,accept){
      attempts++;
      if(attempts===1){paused=true;throw cancelled();}
      committed++;accept();paused=true;throw cancelled();
    }});
  queue.push({}, {status:'ready'}, {valid:()=>true});await jobs.shift()();
  assert.equal(attempts,1);assert.equal(committed,0);
  paused=false;queue.drain();await jobs.shift()();assert.equal(attempts,2);assert.equal(committed,1);
  paused=false;queue.drain();assert.equal(jobs.length,0,'a committed event is removed even if its later paint was cancelled');
  assert.deepEqual(errors,[]);
});

test('completion queue bounds visible preparation churn and drops invalid ownership without delivery',async()=>{
  const jobs=[],errors=[];let attempts=0;
  const queue=api.createComponentHttpCompletions({paused:()=>false,enqueue:task=>jobs.push(task),error:message=>errors.push(message),
    async deliver(){attempts++;throw Object.assign(new Error('Changing graph'),{cancelled:true});}});
  queue.push({}, {status:'ready'}, {valid:()=>false});await jobs.shift()();assert.equal(attempts,0);
  queue.push({}, {status:'ready'}, {valid:()=>true});await jobs.shift()();assert.equal(attempts,8);assert.equal(errors.length,1);
  queue.drain();assert.equal(jobs.length,0);
});

test('scheduled GET never supersedes an accepted request while explicit commands still can',async()=>{
  const source={...item(),inputValues:{...item().inputValues,enabled:true,interval:1}},requests=[],completed=[];
  const service=api.createComponentIntegrationService({fetch:(url,options)=>{const pending=deferred();requests.push({options,...pending});return pending.promise;},
    onComplete:(item,snapshot)=>completed.push(snapshot)});
  try{
    service.start(source,record(source,automatedCaps),{origin:'user'});
    for(const origin of ['timer','change','startup'])assert.equal(service.start(source,record(source,automatedCaps),{origin}).loading,true);
    assert.equal(requests.length,1);assert.equal(requests[0].options.signal.aborted,false);assert.equal(completed.length,0,'a skipped scheduled tick creates no failure occurrence');
    service.start(source,record(source,automatedCaps),{origin:'event'});assert.equal(requests.length,2);assert.equal(requests[0].options.signal.aborted,true);
    service.start(source,record(source,automatedCaps),{origin:'signal'});assert.equal(requests.length,3);assert.equal(requests[1].options.signal.aborted,true);
    requests[2].resolve(json({value:5}));await until(()=>completed.length===1);assert.equal(completed[0].value,5);
  }finally{service.dispose();}
});
