const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('  function createComponentActionDispatcher(');
const end=html.indexOf('  function prepareComponentDownload(',start);
assert.ok(start>0 && end>start);
const warnings=[];
const scope=vm.createContext({console:{warn:(...args)=>warnings.push(args)}});
vm.runInContext(html.slice(start,end),scope);
const create=()=>scope.createComponentActionDispatcher();
const dispatch=(...args)=>scope.dispatchComponentActions(...args);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function settled(dispatcher){
  for(let attempt=0;attempt<1000;attempt++){
    if(!dispatcher.running)return;
    await new Promise(resolve=>setImmediate(resolve));
  }
  throw new Error('Dispatcher did not settle');
}
const host=(execute,extra={})=>({generation:()=>1,valid:()=>true,execute,...extra});

test('one accepted request executes once while equal data in separate occurrences stays distinct',async()=>{
  const dispatcher=create(),seen=[],a={value:'same'},b={value:'same'},owner=host(async intent=>seen.push(intent));
  dispatch(dispatcher,[a,a,b],owner);await settled(dispatcher);
  dispatch(dispatcher,[a,b],owner);await settled(dispatcher);
  assert.deepEqual(seen,[a,b]);
});

test('switching visible sketches does not cancel an accepted service request',async()=>{
  const dispatcher=create(),gate=deferred(),seen=[];
  let visible='dashboard';
  const owner=host(async(intent,current)=>{await gate.promise;if(current())seen.push({source:intent.sketch,visible});});
  dispatch(dispatcher,[{sketch:'services'}],owner);
  visible='editor';gate.resolve();await settled(dispatcher);
  assert.deepEqual(seen,[{source:'services',visible:'editor'}]);
});

test('workspace replacement cancels old work and queued intents without rejecting new-generation work',async()=>{
  const dispatcher=create(),gate=deferred(),seen=[],failures=[];let generation=1;
  const owner=host(async(intent,current)=>{
    if(intent.id==='pending')await gate.promise;
    if(current())seen.push(intent.id);
  },{generation:()=>generation,failure:async(_intent,error)=>failures.push(error.message)});
  dispatch(dispatcher,[{id:'pending'},{id:'old-queued'}],owner);
  generation=2;dispatch(dispatcher,[{id:'new'}],owner);
  gate.resolve();await settled(dispatcher);
  assert.deepEqual(seen,['new']);assert.deepEqual(failures,[]);
});

test('deleting the originating component invalidates accepted and queued requests',async()=>{
  const dispatcher=create(),gate=deferred(),seen=[],alive=new Set(['deleted','kept']);
  const owner=host(async(intent,current)=>{
    if(intent.id==='inflight')await gate.promise;
    if(current())seen.push(intent.id);
  },{valid:intent=>alive.has(intent.source)});
  dispatch(dispatcher,[{id:'inflight',source:'deleted'},{id:'queued',source:'deleted'},{id:'survivor',source:'kept'}],owner);
  alive.delete('deleted');gate.resolve();await settled(dispatcher);
  assert.deepEqual(seen,['survivor']);
});

test('reentrant completion requests stay ordered and are processed by the same queue',async()=>{
  const dispatcher=create(),seen=[];
  const owner=host(async intent=>{
    seen.push('start '+intent.id);
    if(intent.id==='first')dispatch(dispatcher,[{id:'completion'}],owner);
    await Promise.resolve();
    seen.push('end '+intent.id);
  });
  dispatch(dispatcher,[{id:'first'},{id:'second'}],owner);await settled(dispatcher);
  assert.deepEqual(seen,['start first','end first','start second','end second','start completion','end completion']);
});

test('genuine action failures report once, cancellation stays silent, and later requests continue',async()=>{
  const dispatcher=create(),seen=[],failures=[];
  const owner=host(async intent=>{
    if(intent.id==='bad')throw new Error('Column missing');
    if(intent.id==='cancel')throw Object.assign(new Error('Canceled'),{cancelled:true});
    seen.push(intent.id);
  },{failure:async(intent,error,current)=>{assert.equal(current(),true);failures.push([intent.id,error.message]);}});
  dispatch(dispatcher,[{id:'bad'},{id:'cancel'},{id:'good'}],owner);await settled(dispatcher);
  assert.deepEqual(failures,[['bad','Column missing']]);assert.deepEqual(seen,['good']);
});

test('queue capacity and recursively generated actions have bounded failure paths',async()=>{
  const full=create(),executed=[],failures=[];
  dispatch(full,Array.from({length:65},(_,id)=>({id})),host(async intent=>executed.push(intent.id),{
    failure:async(intent,error)=>failures.push([intent.id,error.message]),
  }));
  await settled(full);assert.equal(executed.length,64);
  assert.equal(failures.length,1);assert.match(failures[0][1],/64/);

  const cascade=create(),errors=[];let count=0;
  const owner=host(async()=>{count++;dispatch(cascade,[{id:count}],owner);},{
    failure:async(_intent,error)=>{
      errors.push(error.message);
      dispatch(cascade,[{id:'failure-handler'}],owner);
    },
  });
  dispatch(cascade,[{id:'start'}],owner);await settled(cascade);
  assert.equal(count,128);assert.equal(errors.length,1);assert.match(errors[0],/128/);
  assert.equal(cascade.queue.length,0);
});

test('a rejected failure receiver cannot strand later actions or overflow notifications',async()=>{
  const dispatcher=create(),seen=[];
  const owner=host(async intent=>{
    if(intent.id===0)throw new Error('Action failed');
    seen.push(intent.id);
  },{failure:async()=>{throw new Error('Failure receiver rejected');}});
  const before=warnings.length;
  dispatch(dispatcher,Array.from({length:65},(_,id)=>({id})),owner);await settled(dispatcher);
  assert.equal(seen.length,63);
  assert.equal(warnings.length-before,2,'both notification errors are contained and reported');
  assert.equal(dispatcher.queue.length,0);assert.equal(dispatcher.failures.length,0);
  dispatch(dispatcher,[{id:'later'}],owner);await settled(dispatcher);
  assert.equal(seen.at(-1),'later');
});

test('overflow notifications that request more actions remain bounded without recursive dispatch',async()=>{
  const dispatcher=create();let executions=0,notifications=0;
  const owner=host(async()=>{executions++;},{
    failure:async()=>{
      notifications++;
      dispatch(dispatcher,Array.from({length:65},()=>({})),owner);
    },
  });
  dispatch(dispatcher,Array.from({length:65},()=>({})),owner);await settled(dispatcher);
  assert.ok(executions<=128);assert.ok(notifications<=128);
  assert.equal(dispatcher.queue.length,0);assert.equal(dispatcher.failures.length,0);
});

test('a new workspace can dispatch while the old generation reports its cascade limit',async()=>{
  const dispatcher=create(),gate=deferred(),notifying=deferred(),seen=[];let generation=1;
  const owner=host(async intent=>{
    if(generation===1)dispatch(dispatcher,[{}],owner);
    else seen.push(intent.id);
  },{
    generation:()=>generation,
    failure:async(_intent,error)=>{
      assert.match(error.message,/128/);notifying.resolve();await gate.promise;
    },
  });
  dispatch(dispatcher,[{}],owner);await notifying.promise;
  generation=2;dispatch(dispatcher,[{id:'new workspace'}],owner);
  gate.resolve();await settled(dispatcher);
  assert.deepEqual(seen,['new workspace']);
});
