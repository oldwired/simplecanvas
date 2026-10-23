const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {parseApp}=require('./helpers/app-source.cjs');
const root=path.join(__dirname,'..');
const names=['normalizeComponentMqttConfig','normalizeComponentMqttSource','componentMqttConfiguration','componentMqttSubscription','componentMqttTopicMatches','componentMqttPayload','createComponentMqttService'];
const app=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8'));
const source=app.declarationsSource(names);
function helpers(){return vm.runInNewContext(source+';({'+names.join(',')+'})',{
  console,URL,TextDecoder,TextEncoder,Uint8Array,Promise,Map,Set,WeakSet,Date,Math,setTimeout,clearTimeout,
  componentPortName:name=>typeof name==='string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(name),
  componentHttpValue:(parsed,pointer,type)=>{for(const raw of pointer?pointer.slice(1).split('/'):[]){const key=raw.replace(/~1/g,'/').replace(/~0/g,'~');if(!parsed||typeof parsed!=='object'||!Object.hasOwn(parsed,key))throw Error('The JSON pointer does not identify a value');parsed=parsed[key];}if(typeof parsed!==type || type==='number'&&!Number.isFinite(parsed))throw Error('Expected a finite number, boolean, or string');return parsed;}
});}
const configCaps={integrationApi:1,compute:true,inputs:{url:{type:'string'},clientId:{type:'string'}},outputs:{connected:{type:'boolean'},status:{type:'string'},error:{type:'string'}},mqttConfig:{url:'url',clientId:'clientId',startup:false}};
const sourceCaps={integrationApi:1,compute:true,inputs:{topic:{type:'string'},path:{type:'string'}},outputs:{value:{type:'number'},text:{type:'string'},json:{type:'string'},available:{type:'boolean'},stale:{type:'boolean'},error:{type:'string'},lastUpdated:{type:'number'},status:{type:'string'}},mqttSource:{topic:'topic',path:'path',format:'json',valueType:'number'}};
function fixture(extra={}){
  let active=true,enabled=true,time=1000;
  const clients=[],events=[],timers=new Map();let timerId=0;
  const config={uid:'config',script:'config'},subscriber={uid:'source',script:'source',mqttBinding:{sketchId:'tab',componentUid:'config'}};
  const records=new Map([[config,{caps:structuredClone(configCaps),io:{inputs:{url:'ws://localhost:8001/mqtt',clientId:''}}}],[subscriber,{caps:structuredClone(sourceCaps),io:{inputs:{topic:'readings/+',path:'/value'}}}]]);
  const api=helpers();
  const service=api.createComponentMqttService({enabled:()=>enabled,active:()=>active,now:()=>time,
    resolveConfig:(item,binding,scene)=>scene.find(candidate=>candidate.uid===binding?.componentUid),
    setTimeout:(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;},clearTimeout:id=>timers.delete(id),
    clientFactory:(url,options)=>{
      const client=new EventEmitter();Object.assign(client,{url,options,subscribed:[],unsubscribed:[],ended:false,connect(){this.emit('connect');},end(){this.ended=true;this.emit('close');},subscribe(topic,opts,callback){this.subscribed.push({topic,opts});callback(null,[{topic,qos:0}]);},unsubscribe(topic,callback){this.unsubscribed.push(topic);callback();}});clients.push(client);return client;
    },onMessage:(item,snapshot,context)=>events.push({item,snapshot,context}),...extra});
  const scene=[config,subscriber];
  const settle=()=>{service.reconcile(scene);for(const [item,record] of records)service.read(item,record.caps,record.io.inputs);service.observe(scene,records);};
  const connect=()=>{settle();service.connect(config,records.get(config));};
  const reading=()=>service.read(subscriber,records.get(subscriber).caps,records.get(subscriber).io.inputs);
  const send=(value,{client=clients.at(-1),topic='readings/one',retain=false,raw=false}={})=>{time++;client.emit('message',topic,new TextEncoder().encode(raw?value:JSON.stringify({value})),{retain});};
  return {api,service,config,subscriber,records,scene,clients,events,timers,settle,connect,reading,send,setActive:value=>{active=value;},setEnabled:value=>{enabled=value;},advance:ms=>{time+=ms;}};
}
test('MQTT capability and request validation bounds host operations',()=>{
  const h=helpers();assert.equal(h.normalizeComponentMqttConfig(configCaps.mqttConfig,configCaps).startup,false);
  assert.equal(h.normalizeComponentMqttSource(sourceCaps.mqttSource,sourceCaps).format,'json');
  assert.throws(()=>h.normalizeComponentMqttConfig({...configCaps.mqttConfig,other:true},configCaps));
  assert.throws(()=>h.normalizeComponentMqttSource({...sourceCaps.mqttSource,valueType:'table'},sourceCaps));
  for(const url of ['https://example.com','ws://user:secret@example.com','ws://example.com/#fragment'])assert.throws(()=>h.componentMqttConfiguration(configCaps,{url,clientId:''}));
  assert.throws(()=>h.componentMqttConfiguration(configCaps,{url:'ws://localhost',clientId:'x'.repeat(65)}));
  for(const topic of ['','a/#/b','a+','a/b#','a\u0000b'])assert.throws(()=>h.componentMqttSubscription(sourceCaps,{topic,path:''}));
  assert.equal(h.componentMqttTopicMatches('a/#','a'),true);assert.equal(h.componentMqttTopicMatches('a/+','a'),false);
  assert.equal(h.componentMqttTopicMatches('#','$SYS/count'),false);assert.equal(h.componentMqttTopicMatches('$SYS/#','$SYS/count'),true);
});
test('manual connect is detached, clean QoS0 and shared per Config',()=>{
  const f=fixture();f.settle();assert.equal(f.clients.length,0);assert.equal(f.reading().available,false);
  f.connect();assert.equal(f.clients.length,1);const client=f.clients[0];
  assert.equal(client.options.clean,true);assert.equal(client.options.reconnectPeriod,0);assert.equal(client.options.protocolVersion,4);assert.equal(client.options.queueQoSZero,false);
  assert.equal(client.subscribed.length,1);assert.equal(client.subscribed[0].opts.qos,0);
  const second={uid:'second',script:'source',mqttBinding:{sketchId:'tab',componentUid:'config'}};f.scene.push(second);f.records.set(second,structuredClone(f.records.get(f.subscriber)));f.settle();assert.equal(client.subscribed.length,2,'a new consumer requests the retained baseline using the existing socket');
  f.send(37);assert.equal(f.reading().value,37);assert.equal(f.service.read(second,f.records.get(second).caps,f.records.get(second).io.inputs).value,37);
  assert.equal(f.events.length,0);f.service.clear();
});
test('initial and retained readings establish state; repeated live values are captured events',()=>{
  const f=fixture();f.connect();f.send(10);assert.equal(f.events.length,0);f.send(20,{retain:true});assert.equal(f.events.length,0);
  f.send(20);f.send(20);assert.equal(f.events.length,2);assert.equal(f.events[0].snapshot.value,20);assert.equal(f.events[0].context.valid(),true);
  f.send(30);assert.equal(f.events[0].snapshot.value,20);
  f.records.get(f.subscriber).io.inputs.topic='other';f.settle();assert.equal(f.events[0].context.valid(),false);assert.equal(f.reading().available,false);
  f.send(50,{topic:'other'});assert.equal(f.events.length,3);f.service.clear();
});
test('draft config changes wait for Apply and explicit IDs cannot collide at a broker',()=>{
  const f=fixture();f.records.get(f.config).io.inputs.clientId='explicit';f.connect();
  f.records.get(f.config).io.inputs.url='ws://other.example/mqtt';f.settle();assert.equal(f.clients.length,1);assert.equal(f.clients[0].ended,false);
  f.service.connect(f.config,f.records.get(f.config));assert.equal(f.clients.length,2);assert.equal(f.clients[0].ended,true);
  const second={uid:'second-config',script:'config'};f.scene.push(second);const record=structuredClone(f.records.get(f.config));record.io.inputs.url='ws://other.example/another';f.records.set(second,record);f.settle();
  assert.throws(()=>f.service.connect(second,record),/client ID/);f.service.clear();
});
test('pause suspends with stale values, resume reconnects and re-primes first message',()=>{
  const f=fixture();f.connect();f.send(1);f.send(2);const event=f.events[0];
  f.setActive(false);f.service.suspend();assert.equal(f.clients[0].ended,true);assert.equal(f.reading().stale,true);assert.equal(f.reading().available,false);assert.equal(event.context.valid(),false);
  f.setActive(true);f.settle();assert.equal(f.clients.length,2);f.send(3);assert.equal(f.events.length,1);f.send(4);assert.equal(f.events.length,2);f.service.clear();
});
test('scope removal retires manual intent, leaving no reconnect or late delivery',()=>{
  const f=fixture();f.connect();f.send(1);const old=f.clients[0];f.service.reconcile([]);assert.equal(old.ended,true);assert.equal(f.service.size,0);
  f.send(99,{client:old});f.settle();assert.equal(f.clients.length,1);assert.equal(f.reading().available,false);f.service.clear();
});
test('reconnect uses bounded backoff and old socket messages cannot reach new snapshots',()=>{
  const f=fixture();f.connect();f.send(1);f.clients[0].emit('close');assert.equal(f.reading().stale,true);
  let timer=[...f.timers.values()][0];assert.equal(timer.delay,1000);f.timers.clear();timer.callback();assert.equal(f.clients.length,2);
  f.send(99,{client:f.clients[0]});assert.equal(f.reading().available,false);f.send(2);assert.equal(f.reading().value,2);assert.equal(f.events.length,0);f.service.clear();assert.equal(f.timers.size,0);
});
test('startup is reader-only and once per object lifetime, never replayed by observe',()=>{
  const f=fixture({startup:true});f.records.get(f.config).caps.mqttConfig.startup=true;f.settle();assert.equal(f.clients.length,1);f.settle();assert.equal(f.clients.length,1);
  f.service.disconnect(f.config);f.settle();assert.equal(f.clients.length,1);f.service.reconcile([]);f.settle();assert.equal(f.clients.length,1);f.service.clear();
  const editor=fixture();editor.records.get(editor.config).caps.mqttConfig.startup=true;editor.settle();assert.equal(editor.clients.length,0);editor.service.clear();
});
test('payload mapping and malformed or oversized messages preserve last known values as stale',()=>{
  const f=fixture();f.connect();f.send('broken',{raw:true});assert.equal(f.reading().status,'error');f.send(1);assert.equal(f.events.length,0);
  f.send('x'.repeat(2001),{raw:true});assert.equal(f.reading().available,false);assert.equal(f.reading().stale,true);assert.equal(f.reading().value,1);
  f.send(4);assert.equal(f.reading().value,4);assert.equal(f.events.length,1);
  const h=f.api;assert.equal(h.componentMqttPayload(new TextEncoder().encode(' false '),{format:'text',valueType:'boolean'}).value,false);
  assert.equal(h.componentMqttPayload(new TextEncoder().encode('2.8'),{format:'text',valueType:'number'}).value,2.8);
  for(const text of ['', 'Infinity', '0xff'])assert.throws(()=>h.componentMqttPayload(new TextEncoder().encode(text),{format:'text',valueType:'number'}));
  assert.throws(()=>h.componentMqttPayload(new Uint8Array([255]),{format:'text',valueType:'string'}));f.service.clear();
});
test('message flood stops the connection visibly and does not auto retry',()=>{
  const f=fixture();f.connect();for(let n=0;n<61;n++)f.send(n);assert.equal(f.clients[0].ended,true);
  assert.match(f.service.peek(f.config,configCaps).error,/limit/);assert.equal(f.timers.size,0);assert.equal(f.reading().available,false);f.service.clear();
});
test('disabled networking never opens a socket or returns a usable live value',()=>{
  const f=fixture();f.connect();f.send(1);f.setEnabled(false);f.settle();assert.equal(f.clients[0].ended,true);assert.equal(f.reading().available,false);assert.equal(f.reading().status,'disabled');assert.throws(()=>f.service.connect(f.config,f.records.get(f.config)),/disabled/);f.service.clear();
});
test('fresh default client IDs isolate identical Configs and independent document services',()=>{
  const a=fixture(),b=fixture();a.connect();b.connect();assert.notEqual(a.clients[0].options.clientId,b.clients[0].options.clientId);a.service.clear();b.service.clear();
});

test('stale pre-round probes withhold the old value after binding, literal or schema edits',()=>{
  for(const mutation of [f=>{f.subscriber.mqttBinding.componentUid='missing';},f=>{f.subscriber.inputValues={topic:'new/topic'};},f=>{f.subscriber.bindings={topic:{uid:'other',port:'value'}};},f=>{f.subscriber.state={valueType:'string'};}]){
    const f=fixture();f.connect();f.send(12);f.send(13);const event=f.events[0];mutation(f);
    assert.equal(f.service.read(f.subscriber,sourceCaps).available,false);
    assert.equal(f.service.peek(f.subscriber,sourceCaps).available,false);
    assert.equal(event.context.valid(),false);f.service.clear();
  }
});
test('an ordinary component cannot masquerade as Config and invalid references settle without churn',async()=>{
  let changes=0;const f=fixture({onChange:()=>changes++});
  f.records.set(f.config,{caps:{compute:true},io:{inputs:{}}});
  f.settle();await Promise.resolve();const before=changes;f.settle();await Promise.resolve();
  assert.equal(changes,before);assert.match(f.reading().error,/not an MQTT Config/);assert.equal(f.clients.length,0);f.service.clear();
});
test('Config view separates the committed connection URL from unapplied draft inputs',()=>{
  const f=fixture();f.connect();let current=f.service.read(f.config,configCaps,f.records.get(f.config).io.inputs);
  assert.equal(current.pending,false);assert.equal(current.connectedUrl,'ws://localhost:8001/mqtt');
  f.records.get(f.config).io.inputs.url='ws://second.example/mqtt';current=f.service.read(f.config,configCaps,f.records.get(f.config).io.inputs);
  assert.equal(current.pending,true);assert.equal(current.connectedUrl,'ws://localhost:8001/mqtt');f.service.clear();
});
test('credentials stay in the host client options and never enter source snapshots or events',()=>{
  const f=fixture({credentials:()=>({username:'private-user',password:'private-secret'})});f.connect();f.send(2);f.send(3);
  assert.equal(f.clients[0].options.password,'private-secret');
  assert.doesNotMatch(JSON.stringify(f.reading()),/private-/);assert.doesNotMatch(JSON.stringify(f.events),/private-/);f.service.clear();
});
test('vendored MQTT.js hash and embedded library exactly match the pinned browser build',()=>{
  const {mqttLibraryDeclaration}=require('../tools/update-mqtt-bundle.cjs');
  assert.equal(app.declaration('componentMqttClientLibrary'),mqttLibraryDeclaration(root));
});
test('reconnect preserves actionable credential-origin errors without exposing secrets',()=>{
  const f=fixture({credentials:()=>{throw Error('The broker changed. Set credentials for the new origin in Connection.');}});f.connect();
  assert.match(f.service.peek(f.config,configCaps).error,/broker changed/);assert.equal(f.clients.length,0);assert.equal(f.timers.size,1);f.service.clear();
});
test('connection cap is applied before opening a seventeenth transport',()=>{
  const f=fixture();f.connect();
  for(let index=1;index<16;index++){
    const item={uid:'config-'+index,script:'config'},record=structuredClone(f.records.get(f.config));f.scene.push(item);f.records.set(item,record);f.settle();f.service.connect(item,record);
  }
  const item={uid:'config-17',script:'config'},record=structuredClone(f.records.get(f.config));f.scene.push(item);f.records.set(item,record);f.settle();
  assert.throws(()=>f.service.connect(item,record),/16 MQTT/);assert.equal(f.clients.length,16);f.service.clear();
});
test('successive failed connects back off to thirty seconds and manual disconnect clears retries',()=>{
  const f=fixture({clientFactory:()=>{throw Error('private internal failure');}});f.connect();
  const delays=[];
  for(let index=0;index<7;index++){const [id,timer]=[...f.timers.entries()][0];delays.push(timer.delay);f.timers.delete(id);timer.callback();}
  assert.deepEqual(delays,[1000,2000,4000,8000,16000,30000,30000]);
  assert.doesNotMatch(f.service.peek(f.config,configCaps).error,/private/);f.service.disconnect(f.config);assert.equal(f.timers.size,0);f.service.clear();
});
test('oversized actual topics produce a recoverable source error without consuming the first valid baseline',()=>{
  const f=fixture();f.records.get(f.subscriber).io.inputs.topic='#';f.connect();
  f.send(1,{topic:'x'.repeat(2001)});assert.equal(f.reading().available,false);assert.match(f.reading().error,/topic output exceeds/);assert.equal(f.events.length,0);
  f.send(2,{topic:'valid'});assert.equal(f.reading().available,true);assert.equal(f.reading().topic,'valid');assert.equal(f.events.length,0);
  f.send(3,{topic:'valid'});assert.equal(f.events.length,1);f.service.clear();
});
test('self-contained MQTT wrapper includes the full upstream MIT license',()=>{
  const license=fs.readFileSync(path.join(root,'vendor/mqtt-LICENSE.md'),'utf8').trim();
  assert.ok(app.declaration('componentMqttClientLibrary').includes(license));
});
test('new and remapped consumers request retained readings without resetting existing event baselines',()=>{
  const f=fixture();f.connect();f.send(1,{retain:true});f.send(2);assert.equal(f.events.length,1);
  const second={uid:'second',script:'source',mqttBinding:{sketchId:'tab',componentUid:'config'}};
  f.scene.push(second);f.records.set(second,structuredClone(f.records.get(f.subscriber)));f.settle();
  assert.equal(f.clients.length,1);assert.equal(f.clients[0].subscribed.length,2);
  f.send(2,{retain:true});assert.equal(f.service.read(second,sourceCaps,f.records.get(second).io.inputs).value,2);assert.equal(f.events.length,1);
  f.settle();assert.equal(f.clients[0].subscribed.length,2,'unchanged observations do not re-subscribe');
  f.send(3);assert.equal(f.events.length,3,'both consumers now receive fresh live events');
  f.records.get(second).io.inputs.path='/other';f.settle();assert.equal(f.clients[0].subscribed.length,3);
  f.send('{"value":3,"other":7}',{raw:true,retain:true});assert.equal(f.service.read(second,sourceCaps,f.records.get(second).io.inputs).value,7);assert.equal(f.events.length,3);
  f.send('{"value":4,"other":8}',{raw:true});assert.equal(f.events.length,5);f.service.clear();
});
test('obsolete same-filter subscription acknowledgements cannot overwrite a replacement',()=>{
  const requests=[];let client;
  const f=fixture({clientFactory:()=>{
    client=new EventEmitter();client.connect=()=>client.emit('connect');client.end=()=>client.emit('close');client.unsubscribe=()=>{};
    client.subscribe=(topic,opts,callback)=>requests.push({topic,callback});return client;
  }});f.connect();assert.equal(requests.length,1);
  const second={uid:'second',script:'source',mqttBinding:{sketchId:'tab',componentUid:'config'}};
  f.scene.push(second);f.records.set(second,structuredClone(f.records.get(f.subscriber)));f.settle();assert.equal(requests.length,2);
  requests[0].callback(Error('denied'),[]);assert.equal(f.reading().error,'');
  requests[1].callback(null,[{topic:'readings/+',qos:0}]);f.send(7,{client,retain:true});assert.equal(f.reading().value,7);assert.equal(f.events.length,0);f.service.clear();
});
test('rejected Apply keeps the old connection and preserves the unapplied client-ID indicator',()=>{
  const f=fixture();f.records.get(f.config).io.inputs.clientId='first';f.connect();
  const second={uid:'second-config',script:'config'},record=structuredClone(f.records.get(f.config));record.io.inputs.clientId='second';
  f.scene.push(second);f.records.set(second,record);f.settle();f.service.connect(second,record);
  f.records.get(f.config).io.inputs.clientId='second';assert.throws(()=>f.service.connect(f.config,f.records.get(f.config)),/client ID/);
  assert.equal(f.clients[0].ended,false);assert.equal(f.service.read(f.config,configCaps,f.records.get(f.config).io.inputs).pending,true);f.service.clear();
});
