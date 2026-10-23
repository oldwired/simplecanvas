const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createHttpExampleServer}=require('../tools/serve-http-example.cjs');

async function server(t,options){
  const instance=createHttpExampleServer(options);
  await new Promise((resolve,reject)=>{instance.once('error',reject);instance.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>{instance.closeAllConnections();instance.close(resolve);}));
  return 'http://127.0.0.1:'+instance.address().port;
}

test('example server enables CORS only for its deterministic JSON fixtures and supports delayed responses',async t=>{
  const base=await server(t);
  const response=await fetch(base+'/examples/http-reading.json?delay=35');
  assert.equal(response.headers.get('access-control-allow-origin'),'*');
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).value,72);
  const app=await fetch(base+'/index.html');assert.equal(app.status,200);assert.equal(app.headers.get('access-control-allow-origin'),null);
  assert.equal((await fetch(base+'/examples/http-reading.json?delay=10001')).status,400);
  const preflight=await fetch(base+'/examples/http-reading.json',{method:'OPTIONS'});assert.equal(preflight.status,204);
  assert.equal((await fetch(base+'/index.html',{method:'POST'})).status,405);
});

test('example server refuses symlinks outside its root and encoded traversal',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'http-example-server-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const publicRoot=path.join(directory,'public');await fs.mkdir(publicRoot);
  await fs.writeFile(path.join(directory,'private.txt'),'private');
  await fs.symlink(path.join(directory,'private.txt'),path.join(publicRoot,'escape.txt'));
  const base=await server(t,{directory:publicRoot});
  assert.equal((await fetch(base+'/escape.txt')).status,403);
  assert.equal((await fetch(base+'/%2e%2e%2fprivate.txt')).status,403);
});

test('example API produces changing readings and controlled failures without external services',async t=>{
  const base=await server(t);
  const first=await(await fetch(base+'/examples/api/reading')).json(),second=await(await fetch(base+'/examples/api/reading?name=Store')).json();
  assert.equal(first.sequence,1);assert.equal(second.sequence,2);assert.notEqual(first.value,second.value);assert.equal(second.name,'Store');
  const failure=await fetch(base+'/examples/api/reading?status=503');
  assert.equal(failure.status,503);assert.equal(failure.headers.get('access-control-allow-origin'),'*');
  assert.equal((await fetch(base+'/examples/api/reading?status=999')).status,400);
  assert.equal((await fetch(base+'/examples/api/reading',{method:'POST'})).status,405);
});

test('example POST validates JSON and honors in-memory idempotency keys',async t=>{
  const base=await server(t),url=base+'/examples/api/echo';
  const preflight=await fetch(url,{method:'OPTIONS',headers:{Origin:'null','Access-Control-Request-Method':'POST',
    'Access-Control-Request-Headers':'content-type,idempotency-key'}});
  assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-methods'),/POST/);
  assert.match(preflight.headers.get('access-control-allow-headers'),/Idempotency-Key/);
  const post=(body,key='')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
  assert.equal((await(await fetch(url)).json()).count,0);
  const first=await(await post({name:'Workshop',value:37},'first')).json();
  assert.equal(first.value,37);assert.equal(first.recordId,1);assert.equal(first.accepted,true);
  assert.deepEqual(await(await post({name:'Workshop',value:37},'first')).json(),first,'same key and body returns the original acceptance');
  assert.equal((await post({value:38},'first')).status,409);
  assert.equal((await(await fetch(url)).json()).count,1,'repeated or conflicting keys do not add a write');
  const fresh=await(await post({value:38})).json();assert.equal(fresh.recordId,2);
  assert.equal((await post({text:'x'.repeat(2001)})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"value":1e999}'})).status,400);
  assert.equal((await(await fetch(url)).json()).count,2);
});

test('example POST can acknowledge without a body and simulated delay does not postpone server acceptance',async t=>{
  const base=await server(t),url=base+'/examples/api/echo',options={method:'POST',headers:{'Content-Type':'application/json'},body:'{"value":9}'};
  const empty=await fetch(url+'?status=204',options);assert.equal(empty.status,204);assert.equal(await empty.text(),'');
  assert.equal((await(await fetch(url)).json()).count,1);
  const failed=await fetch(url+'?status=503',options);assert.equal(failed.status,503);
  assert.equal((await(await fetch(url)).json()).count,1,'simulated HTTP failure does not create a demo record');
  const response=fetch(url+'?delay=200',options);
  let observed;
  for(let attempt=0;attempt<50;attempt++){
    observed=await(await fetch(url)).json();if(observed.count===2)break;
    await new Promise(resolve=>setTimeout(resolve,2));
  }
  assert.equal(observed.count,2,'server acceptance can precede the response');assert.equal((await response).status,200);
});
