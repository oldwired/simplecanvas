const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseApp}=require('./helpers/app-source.cjs');
const app=parseApp(fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'));

function harness({startup=true}={}){
  let now=0,serial=0,active=true;
  const timers=new Map(),loading=new Set(),dispatched=[];
  const scope=vm.createContext({URL,
    setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout(id){timers.delete(id);}});
  vm.runInContext(app.declarationsSource(['componentHttpRequest','createComponentHttpScheduler'])+';this.create=createComponentHttpScheduler;',scope);
  const scheduler=scope.create({now:()=>now,baseUrl:'https://app.test/',startup,active:()=>active,
    loading:item=>loading.has(item),dispatch:(item,origin,current)=>dispatched.push({item,origin,current,at:now})});
  function advance(milliseconds){
    const end=now+milliseconds;let calls=0;
    for(;;){
      const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
      assert.ok(++calls<1000,'timer loop stays bounded');now=next[1].at;timers.delete(next[0]);next[1].fn();
    }
    now=end;
  }
  return {scheduler,loading,dispatched,advance,set active(value){active=value;},get now(){return now;},get timers(){return timers.size;}};
}
const item=(uid='source')=>({uid,script:'HTTP source'});
function record({url='/value',enabled=true,interval=1,loading=false,polling=false,onChange=false,startup=false,debounceMs=150,error}={}){
  return {error,caps:{integrationApi:1,httpSource:{method:'GET',url:'url',path:'path',valueType:'number',timeoutMs:10000,
    automation:{enabled:'enabled',interval:'interval',polling,onChange,startup,debounceMs}}},io:{inputs:{url,path:'/value',enabled,interval},outputs:{loading}}};
}
const observe=(h,source,value)=>h.scheduler.observe([source],new Map([[source,value]]));

test('HTTP change automation debounces bursts and ignores initial or unchanged graphs',()=>{
  const h=harness(),source=item();observe(h,source,record({onChange:true}));h.advance(1000);assert.equal(h.dispatched.length,0);
  observe(h,source,record({url:'/first',onChange:true}));h.advance(80);
  observe(h,source,record({url:'/second',onChange:true}));h.advance(80);
  observe(h,source,record({url:'/final',onChange:true}));h.advance(149);assert.equal(h.dispatched.length,0);
  h.advance(1);assert.equal(h.dispatched.length,1);assert.equal(h.dispatched[0].origin,'change');assert.equal(h.dispatched[0].current(),true);
  observe(h,source,record({url:'/final',onChange:true}));h.advance(1000);assert.equal(h.dispatched.length,1);
});

test('HTTP polling resumes after a full interval without replaying time spent paused',()=>{
  const h=harness(),source=item(),config=record({polling:true});observe(h,source,config);h.advance(500);
  h.active=false;h.scheduler.pause();h.advance(12000);assert.equal(h.dispatched.length,0);assert.equal(h.timers,0);
  h.active=true;observe(h,source,config);h.advance(999);assert.equal(h.dispatched.length,0);
  h.advance(1);assert.equal(h.dispatched.length,1);assert.equal(h.dispatched[0].origin,'timer');assert.equal(h.dispatched[0].at,13500);
  h.scheduler.pause();assert.equal(h.dispatched[0].current(),false,'already queued timer work loses its lease on pause');
});

test('queued HTTP timer work is invalidated by configuration, scope and enable changes',()=>{
  const h=harness(),source=item();observe(h,source,record({polling:true}));h.advance(1000);const first=h.dispatched[0];assert.equal(first.current(),true);
  observe(h,source,record({polling:true,url:'/new'}));assert.equal(first.current(),false);
  h.advance(1000);const second=h.dispatched[1];assert.equal(second.current(),true);
  observe(h,source,record({polling:true,url:'/new',enabled:false}));assert.equal(second.current(),false);h.advance(3000);assert.equal(h.dispatched.length,2);
  observe(h,source,record({polling:true,url:'/new'}));h.advance(1000);const third=h.dispatched[2];assert.equal(third.current(),true);
  h.scheduler.reconcile([]);assert.equal(third.current(),false);h.advance(3000);assert.equal(h.dispatched.length,3);
});

test('HTTP startup runs once per source session across scope leave/reentry and stays off in the authoring host',()=>{
  const h=harness(),source=item(),config=record({startup:true});observe(h,source,config);h.advance(1);
  assert.equal(h.dispatched.length,1);assert.equal(h.dispatched[0].origin,'startup');
  h.scheduler.reconcile([]);observe(h,source,config);h.advance(1000);assert.equal(h.dispatched.length,1);
  const other=item('other');observe(h,other,config);h.advance(1);assert.equal(h.dispatched.length,2);assert.equal(h.dispatched[1].item,other);
  other.script='Changed HTTP source';observe(h,other,config);h.advance(1);assert.equal(h.dispatched.length,3,'a changed script starts a new source configuration');
  const authoring=harness({startup:false});observe(authoring,source,config);authoring.advance(1000);assert.equal(authoring.dispatched.length,0);
});

test('HTTP polling never overlaps an accepted request and waits one interval after completion',()=>{
  const h=harness(),source=item(),config=record({polling:true});observe(h,source,config);h.advance(1000);assert.equal(h.dispatched.length,1);
  h.loading.add(source);observe(h,source,config);h.advance(5000);assert.equal(h.dispatched.length,1);assert.equal(h.timers,0);
  h.loading.delete(source);observe(h,source,config);h.advance(999);assert.equal(h.dispatched.length,1);
  h.advance(1);assert.equal(h.dispatched.length,2);assert.equal(h.dispatched[1].at,7000);
  observe(h,source,record({polling:true,interval:0}));h.advance(5000);assert.equal(h.dispatched.length,2,'an invalid interval never creates a fast timer');
});

test('queued automatic work cannot supersede a manual read that starts while the scheduler waits',()=>{
  const h=harness(),source=item(),config=record({polling:true});observe(h,source,config);h.advance(1000);
  const queued=h.dispatched[0];assert.equal(queued.current(),true);
  h.loading.add(source);assert.equal(queued.current(),false,'dispatch rechecks loading even before another graph is observed');
  observe(h,source,config);h.advance(5000);assert.equal(h.dispatched.length,1);
  h.loading.delete(source);observe(h,source,config);assert.equal(queued.current(),false,'completion must not revive the earlier timer lease');
  h.advance(999);assert.equal(h.dispatched.length,1);h.advance(1);assert.equal(h.dispatched.length,2);
  assert.equal(h.dispatched[1].current(),true);
});
