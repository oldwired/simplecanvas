const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const mqtt=require('mqtt');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createMqttExampleServer}=require('../tools/serve-mqtt-example.cjs');

async function serve(t,options){
  const example=await createMqttExampleServer({interval:0,...options});
  t.after(()=>example.close());
  await new Promise((resolve,reject)=>{example.server.once('error',reject);example.server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+example.server.address().port;
  return {...example,origin,url:origin.replace('http:','ws:')+'/mqtt'};
}
async function client(t,url){
  const client=mqtt.connect(url,{reconnectPeriod:0,connectTimeout:2000});
  t.after(()=>new Promise(resolve=>client.end(true,resolve)));
  await once(client,'connect');return client;
}
test('MQTT example serves retained baselines and changing live values over real WebSockets',{timeout:10000},async t=>{
  const example=await serve(t),connection=await client(t,example.url),messages=[];
  let ready;const baseline=new Promise(resolve=>ready=resolve);
  connection.on('message',(topic,payload,packet)=>{messages.push({topic,text:payload.toString(),retain:packet.retain});if(messages.length===3)ready();});
  await connection.subscribeAsync('simplecanvas/demo/#');
  await baseline;
  assert.ok(messages.some(message=>message.topic===example.topics.reading&&JSON.parse(message.text).value===35&&message.retain));
  const received=once(connection,'message');await example.publish(example.topics.reading,{value:72},{retain:true});await received;
  assert.ok(messages.some(message=>JSON.parse(message.topic===example.topics.reading?message.text:'{}').value===72&&!message.retain));
  assert.equal(example.stats.connections.length,1);assert.equal(example.stats.subscriptions.length,1);
  assert.equal((await fetch(example.origin+'/index.html')).status,200);
});
test('MQTT example rejects client writes outside its command topic and clears connections',{timeout:10000},async t=>{
  const example=await serve(t),connection=await client(t,example.url);
  const disconnect=once(connection,'close');connection.publish(example.topics.reading,'123');
  await disconnect;
  assert.equal(example.stats.disconnects.length,1);
});
test('MQTT example accepts a bounded command and replies separately from its broker acknowledgement',{timeout:10000},async t=>{
  const example=await serve(t),connection=await client(t,example.url),messages=[];
  connection.on('message',(topic,payload,packet)=>messages.push({topic,data:JSON.parse(payload),retain:packet.retain}));
  const initial=once(connection,'message');await connection.subscribeAsync(example.topics.reply);await initial;
  assert.equal(messages[0].data.sequence,0);assert.equal(messages[0].retain,true);
  const response=once(connection,'message');await connection.publishAsync(example.topics.command,'{"value":72}',{qos:1,retain:false});
  await response;assert.deepEqual(messages[1].data,{value:72,sequence:1,status:'Applied by demo device'});
  assert.equal(messages[1].retain,false);assert.equal(example.stats.commands.length,1);
});
test('MQTT example refuses retained, malformed and out-of-range commands',{timeout:10000},async t=>{
  const example=await serve(t);
  for(const [payload,retain] of [['{"value":20}',true],['not json',false],['{"value":101}',false],['{"value":3,"extra":true}',false]]){
    const connection=await client(t,example.url),closed=once(connection,'close');
    connection.publish(example.topics.command,payload,{retain});await closed;
  }
  assert.deepEqual(example.stats.commands,[]);
});
test('MQTT example refuses static-file traversal and symlinks outside its directory',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mqtt-static-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const publicRoot=path.join(directory,'public');await fs.mkdir(publicRoot);
  await fs.writeFile(path.join(directory,'private.txt'),'private');await fs.symlink(path.join(directory,'private.txt'),path.join(publicRoot,'escape.txt'));
  const example=await serve(t,{directory:publicRoot});
  assert.equal((await fetch(example.origin+'/escape.txt')).status,403);
  assert.equal((await fetch(example.origin+'/%2e%2e%2fprivate.txt')).status,403);
  assert.equal((await fetch(example.origin+'/',{method:'POST'})).status,405);
});
