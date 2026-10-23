const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {parseApp}=require('./helpers/app-source.cjs');
const app=parseApp(fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'));
const names=['normalizeComponentMqttPublish','componentMqttPublishConfiguration','componentMqttPublication','componentMqttConfiguration','componentMqttSubscription','componentMqttTopicMatches','componentMqttPayload','createComponentMqttService'];
const h=vm.runInNewContext(app.declarationsSource(names)+';({'+names.join(',')+'})',{
  console,URL,TextDecoder,TextEncoder,Promise,Map,Set,WeakSet,Date,Math,setTimeout,clearTimeout,
  componentPortName:name=>typeof name==='string' && /^[A-Za-z]\w*$/.test(name),componentHttpValue:()=>0
});
const plain=value=>JSON.parse(JSON.stringify(value));
const configCaps={integrationApi:1,compute:true,inputs:{url:{type:'string'},clientId:{type:'string'}},outputs:{connected:{type:'boolean'},status:{type:'string'},error:{type:'string'}},mqttConfig:{url:'url',clientId:'clientId',startup:false}};
const publishCaps={integrationApi:1,compute:true,inputs:{topic:{type:'string'},payload:{type:'string'},send:{type:'boolean'}},outputs:{loading:{type:'boolean'},status:{type:'string'},error:{type:'string'},lastPublished:{type:'number'}},mqttPublish:{topic:'topic',payload:'payload',format:'text',retain:false,timeoutMs:10000}};
function fixture(options={}){
  let active=true,enabled=true,time=1000,sequence=0;
  const timers=new Map(),clients=[],completions=[],changes=[];
  const config={uid:'config',script:'config'},publisher={uid:'publish',script:'publish',state:{format:'text'},mqttBinding:{sketchId:'tab',componentUid:'config'}};
  const records=new Map([[config,{caps:structuredClone(configCaps),io:{inputs:{url:'ws://localhost/mqtt',clientId:''}}}],[publisher,{caps:structuredClone(publishCaps),io:{inputs:{topic:'command/set',payload:'hello',send:false}}}]]);
  const scene=[config,publisher];
  const service=h.createComponentMqttService({now:()=>time,active:()=>active,enabled:()=>enabled,
    resolveConfig:(item,binding,list)=>list.find(candidate=>candidate.uid===binding?.componentUid),
    setTimeout:(callback,delay)=>{timers.set(++sequence,{callback,delay});return sequence;},clearTimeout:id=>timers.delete(id),
    onChange:(item,snapshot)=>changes.push({item,snapshot}),onComplete:(item,snapshot,context)=>completions.push({item,snapshot,context}),
    clientFactory:(url,args)=>{
      const client=new EventEmitter();let packetId=0;
      Object.assign(client,{url,args,connected:false,ended:false,sends:[],removed:[],subscribe(topic,opts,callback){callback(null,[{topic,qos:0}]);},unsubscribe(topic,callback){callback();},
        connect(){this.connected=true;this.emit('connect');},end(){this.connected=false;this.ended=true;this.emit('close');},
        publish(topic,payload,opts,callback){
          const packet={cmd:'publish',messageId:++packetId,topic,payload,...opts};this.sends.push({packet,callback});if(!options.deferPacket)this.emit('packetsend',packet);
        },
        removeOutgoingMessage(id){this.removed.push(id);this.sends.find(send=>send.packet.messageId===id)?.callback(Error('Message removed'));},
        ack(index=0,error=null){this.sends[index].callback(error,{cmd:'puback',messageId:this.sends[index].packet.messageId});}
      });clients.push(client);return client;
    },...options});
  const settle=()=>{service.reconcile(scene);for(const [item,record] of records)service.read(item,record.caps,record.io.inputs);service.observe(scene,records);};
  const connect=()=>{settle();service.connect(config,records.get(config));};
  const send=(item=publisher,context={origin:'user'})=>service.publish(item,records.get(item),context);
  const read=(item=publisher)=>service.read(item,records.get(item).caps,records.get(item).io.inputs);
  const fireTimer=delay=>{const [id,timer]=[...timers].find(([,timer])=>timer.delay===delay);timers.delete(id);timer.callback();};
  return {service,records,scene,config,publisher,clients,timers,completions,changes,settle,connect,send,read,fireTimer,advance:ms=>time+=ms,setActive:value=>active=value,setEnabled:value=>enabled=value};
}
test('MQTT Publish accepts only its bounded compute-only descriptor and a concrete topic/text or JSON payload',()=>{
  assert.deepEqual(plain(h.normalizeComponentMqttPublish(publishCaps.mqttPublish,publishCaps)),publishCaps.mqttPublish);
  for(const patch of [{qos:2},{retain:1},{timeoutMs:999},{timeoutMs:30001},{format:'binary'},{topic:'missing'}])assert.throws(()=>h.normalizeComponentMqttPublish({...publishCaps.mqttPublish,...patch},publishCaps));
  assert.throws(()=>h.normalizeComponentMqttPublish(publishCaps.mqttPublish,{...publishCaps,mqttConfig:{}}));
  for(const topic of ['', 'x/+', 'x/#','x\0y','x\ny','x'.repeat(2001)])assert.throws(()=>h.componentMqttPublication(publishCaps,{topic,payload:'x'}));
  assert.throws(()=>h.componentMqttPublication(publishCaps,{topic:'x',payload:'x'.repeat(2001)}));
  assert.deepEqual(plain(h.componentMqttPublication(publishCaps,{topic:'a/b',payload:''})),{topic:'a/b',payload:'',format:'text',retain:false,qos:1,timeoutMs:10000});
  const json={...publishCaps,mqttPublish:{...publishCaps.mqttPublish,format:'json',retain:true}};
  assert.equal(h.componentMqttPublication(json,{topic:'a',payload:' { "value": 3 } '}).payload,'{"value":3}');
  for(const payload of ['{broken','NaN','{"value":1e999}'])assert.throws(()=>h.componentMqttPublication(json,{topic:'a',payload}));
});
test('publication is detached and requires a Send origin; compute, observe, startup and restoration never publish',()=>{
  const f=fixture({startup:true});f.records.get(f.config).caps.mqttConfig.startup=true;f.settle();assert.equal(f.clients.length,1);assert.equal(f.clients[0].sends.length,0);
  for(const origin of [undefined,'timer','startup','change'])assert.throws(()=>f.send(f.publisher,{origin}),/explicit Send/);
  const before=JSON.stringify(f.publisher),snapshot=f.send();assert.equal(snapshot.status,'sending');assert.equal(snapshot.loading,true);assert.equal(f.completions.length,0);
  assert.deepEqual(plain(f.clients[0].sends[0].packet),{cmd:'publish',messageId:1,topic:'command/set',payload:'hello',qos:1,retain:false});
  f.settle();assert.equal(f.clients[0].sends.length,1);assert.equal(JSON.stringify(f.publisher),before);
  f.advance(4);f.clients[0].ack();assert.equal(f.read().status,'ready');assert.equal(f.read().lastPublished,1004);assert.equal(f.completions.length,1);assert.equal(f.completions[0].snapshot.payload,'hello');assert.equal(f.completions[0].context.valid(),true);assert.equal(f.timers.size,0);f.service.clear();
});
test('accepted topic and payload survive later literal and connected value changes and repeated equal sends stay distinct',()=>{
  const f=fixture();f.connect();f.send();const record=f.records.get(f.publisher);
  f.publisher.inputValues={topic:'next/topic',payload:'next'};record.io.inputs={topic:'next/topic',payload:'next',send:true};f.settle();
  assert.equal(f.read().loading,true);f.clients[0].ack();assert.equal(f.completions[0].snapshot.topic,'command/set');assert.equal(f.completions[0].snapshot.payload,'hello');
  assert.equal(f.completions[0].context.matches(record.caps,record.io.inputs),true);
  f.send();f.clients[0].ack(1);f.send();f.clients[0].ack(2);assert.deepEqual(f.completions.map(event=>event.snapshot.payload),['hello','next','next']);f.service.clear();
});
test('a busy publisher rejects another Send without changing its pending status or blocking a different publisher',()=>{
  const f=fixture();f.connect();f.send();assert.throws(()=>f.send(),/already in progress/);assert.equal(f.read().loading,true);assert.equal(f.read().error,'');
  const second={...structuredClone(f.publisher),uid:'second'};f.scene.push(second);f.records.set(second,structuredClone(f.records.get(f.publisher)));f.settle();f.send(second);
  assert.equal(f.clients.length,1);assert.equal(f.clients[0].sends.length,2);f.clients[0].ack(1);assert.equal(f.read(second).loading,false);assert.equal(f.read().loading,true);f.clients[0].ack();assert.equal(f.completions.length,2);f.service.clear();
});
test('disconnected or invalid-reference sends fail visibly and are never queued for a later Connect',()=>{
  const f=fixture();f.settle();assert.throws(()=>f.send(),/disconnected/);assert.match(f.read().error,/Nothing was queued/);assert.equal(f.clients.length,0);
  f.connect();assert.equal(f.clients[0].sends.length,0);f.publisher.mqttBinding.componentUid='missing';f.settle();assert.throws(()=>f.send(),/Config/);assert.equal(f.clients[0].sends.length,0);f.service.clear();
});
test('timeout reports an unknown outcome, removes its outgoing packet, and keeps shared subscribers connected',()=>{
  const f=fixture();f.connect();f.send();f.fireTimer(10000);assert.equal(f.read().status,'error');assert.match(f.read().error,/outcome unknown/);assert.deepEqual(f.clients[0].removed,[1]);assert.equal(f.clients[0].ended,false);
  assert.equal(f.completions.length,1);assert.equal(f.completions[0].context.valid(),true);f.clients[0].ack();assert.equal(f.completions.length,1);assert.equal(f.read().status,'error');
  f.send();f.clients[0].ack(1);assert.equal(f.read().status,'ready');assert.equal(f.clients[0].sends.length,2);f.service.clear();
});
test('a library-queued send is retired immediately and cannot capture a later identical packet identifier',()=>{
  const f=fixture({deferPacket:true});f.connect();assert.equal(f.send().status,'error');assert.equal(f.clients[0].ended,true);assert.equal(f.completions.length,1);
  assert.equal(f.clients[0].listenerCount('packetsend'),0);assert.throws(()=>f.send(),/disconnected/);
  f.fireTimer(1000);assert.equal(f.clients.length,2);assert.equal(f.clients[1].sends.length,0);
  f.clients[0].emit('packetsend',f.clients[0].sends[0].packet);f.clients[0].ack();assert.equal(f.completions.length,1);assert.deepEqual(f.clients[1].removed,[]);f.service.clear();
});
test('disconnect fails a pending send once, keeps the failure deliverable, and reconnect never replays it',()=>{
  const f=fixture();f.connect();f.send();f.service.disconnect(f.config);assert.equal(f.read().loading,false);assert.match(f.read().error,/outcome unknown/);
  assert.equal(f.completions.length,1);assert.equal(f.completions[0].context.valid(),true);f.clients[0].ack();assert.equal(f.completions.length,1);
  f.service.connect(f.config,f.records.get(f.config));assert.equal(f.clients[1].sends.length,0);assert.equal(f.completions[0].context.valid(),true);f.service.clear();
});
test('changing definitions or Config references cancels old completion without replaying or closing other known packets',()=>{
  for(const mutate of [f=>f.publisher.script='changed',f=>f.publisher.state.format='json',f=>f.publisher.mqttBinding.componentUid='different',f=>f.publisher.bindings={payload:{uid:'new',port:'text'}}]){
    const f=fixture();f.connect();f.send();mutate(f);f.settle();f.clients[0].ack();assert.equal(f.completions.length,0);assert.deepEqual(f.clients[0].removed,[1]);assert.equal(f.clients[0].ended,false);f.service.clear();
  }
});
test('deletion, whole-scope replacement, disabled networking and explicit invalidation retire accepted operations',()=>{
  for(const change of ['delete','clear','disabled','valid']){
    let valid=true;const f=fixture();f.connect();f.send(f.publisher,{origin:'event',valid:()=>valid});
    if(change==='delete'){f.scene.splice(1,1);f.records.delete(f.publisher);f.service.reconcile(f.scene);}
    if(change==='clear')f.service.clear();
    if(change==='disabled'){f.setEnabled(false);f.settle();}
    if(change==='valid')valid=false;
    f.clients[0].ack();assert.equal(f.completions.length,0,change);f.service.clear();assert.equal(f.timers.size,0);
  }
});
test('pausing stops the transport and publishes only the captured failure, never a resume replay',()=>{
  const f=fixture();f.connect();f.send();f.setActive(false);f.service.suspend();assert.equal(f.completions.length,1);assert.match(f.read().error,/outcome unknown/);
  f.setActive(true);f.settle();assert.equal(f.clients.length,2);assert.equal(f.clients[1].sends.length,0);f.service.clear();
});
test('the publisher cannot use a target whose current capabilities no longer declare MQTT Config',()=>{
  const f=fixture();f.connect();f.records.set(f.config,{caps:{compute:true},io:{inputs:{}}});f.settle();assert.equal(f.clients[0].ended,true);assert.throws(()=>f.send(),/Config/);assert.equal(f.clients[0].sends.length,0);f.service.clear();
});
test('a lost publisher capability cancels pending operations and readonly inspection shows no stale activity',()=>{
  const f=fixture();f.connect();f.send();const record=f.records.get(f.publisher);
  record.caps={compute:true};f.service.observe(f.scene,f.records);f.clients[0].ack();
  assert.equal(f.completions.length,0);assert.deepEqual(f.clients[0].removed,[1]);assert.equal(f.clients[0].ended,false);
  assert.equal(f.service.peek(f.publisher,record.caps).status,'idle');assert.equal(f.service.peek(f.publisher,publishCaps).loading,false);f.service.clear();
});
test('pending publications and triggered Send rate are bounded independently of response time',()=>{
  const f=fixture();f.connect();
  for(let index=0;index<16;index++){
    const item={...structuredClone(f.publisher),uid:'publisher-'+index};f.scene.push(item);f.records.set(item,structuredClone(f.records.get(f.publisher)));f.settle();f.send(item);
  }
  assert.throws(()=>f.send(),/16 MQTT/);f.clients[0].sends.forEach((_,index)=>f.clients[0].ack(index));
  for(let index=0;index<30;index++){f.send(f.publisher,{origin:'event'});f.clients[0].ack(16+index);}
  assert.throws(()=>f.send(f.publisher,{origin:'signal'}),/30 sends/);f.advance(10001);f.send(f.publisher,{origin:'event'});f.clients[0].ack(46);f.service.clear();
});
