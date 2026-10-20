const {parseApp}=require('./helpers/app-source.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const helper=parseApp(html).declaration;
function fixture(){
  let now=1000,id=0;const timers=new Map();
  const source=['createComponentWireActivity','resetComponentWireActivity','componentWirePayloadPreview','commitComponentWireActivity','componentWireActivityRecord','componentWireActivityText','componentWireEventMode','componentWireEventDescription','decorateComponentWireActivity'].map(helper).join('\n');
  const api=vm.runInNewContext(source+'\n({create:createComponentWireActivity,reset:resetComponentWireActivity,commit:commitComponentWireActivity,record:componentWireActivityRecord,text:componentWireActivityText,mode:componentWireEventMode,description:componentWireEventDescription,decorate:decorateComponentWireActivity})',{
    Date:{now:()=>now},setTimeout:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimeout:key=>timers.delete(key)
  });
  return {api,timers,tick:ms=>{now+=ms;for(const [key,timer] of timers)if(timer.at<=now){timers.delete(key);timer.fn();}}};
}
const scene=()=>[{type:'smart',uid:'source'},{type:'smart',uid:'target'}];
const source={uid:'source',name:'value',direction:'out',kind:'flow',hybrid:true};
const target={uid:'target',name:'line',direction:'in',kind:'flow',hybrid:true,eventsEnabled:true};
const edge={source,target,kind:'flow',events:true};
const occurrence=payload=>[{direction:'out',uid:'source',port:'value',payload},{direction:'in',uid:'target',port:'line',sourceUid:'source',sourcePort:'value',payload}];

test('committed occurrences count repeated payloads and expose safe bounded inspection text',()=>{
  const {api}=fixture(),items=scene(),before=JSON.stringify(items);let redraws=0;const store=api.create(()=>redraws++);
  assert.equal(api.record(store,items,edge),null);assert.equal(store.scene,null);
  api.commit(store,items,occurrence('<img src=x onerror=alert(1)>\nHello'));api.commit(store,items,occurrence('<img src=x onerror=alert(1)>\nHello'));
  assert.equal(api.record(store,items,source).count,2);assert.equal(api.record(store,items,target).count,2);assert.equal(api.record(store,items,edge).count,2);
  assert.equal(api.record(store,items,edge).preview,'"<img src=x onerror=alert(1)>\\nHello"');
  assert.match(api.text(api.record(store,items,edge)),/^Events: 2 · Last payload: /);
  api.commit(store,items,occurrence('a'.repeat(5000)));assert.equal(api.record(store,items,edge).preview.length,243);
  assert.equal(JSON.stringify(items),before,'activity is never added to items');assert.equal(redraws,3);
});

test('activity expires once without clearing count, and reset cancels its timer and all retained payloads',()=>{
  const {api,timers,tick}=fixture(),items=scene();let redraws=0;const store=api.create(()=>redraws++),attrs={};
  const group={setAttribute:(name,value)=>attrs[name]=value};
  api.commit(store,items,occurrence(null));api.decorate(group,api.record(store,items,edge));assert.equal(attrs['data-event-active'],'true');assert.equal(attrs['data-event-count'],'1');assert.match(api.text(api.record(store,items,edge)),/No payload/);
  tick(650);api.decorate(group,api.record(store,items,edge));assert.equal(attrs['data-event-active'],'false');assert.equal(api.record(store,items,edge).count,1);assert.equal(redraws,2);assert.equal(timers.size,0);
  api.commit(store,items,occurrence(false));assert.equal(timers.size,1);api.reset(store,items);assert.equal(timers.size,0);assert.equal(api.record(store,items,edge),null);assert.equal(store.ports.size,0);assert.equal(store.edges.size,0);
});

test('activity does not leak between scenes, into value-only links, or across port namespaces',()=>{
  const {api}=fixture(),items=scene(),other=scene(),store=api.create();api.commit(store,items,occurrence(2.8));
  assert.equal(api.record(store,other,edge),null);assert.equal(api.record(store,items,{...edge,events:false}),null);
  assert.equal(api.record(store,items,{...source,hybrid:false}),null);
  assert.equal(api.record(store,items,{...target,eventsEnabled:false}),null);
  assert.equal(api.record(store,items,{...edge,broken:true}),null);
  api.commit(store,other,occurrence('new'));assert.equal(api.record(store,other,edge).count,1);assert.equal(api.record(store,items,edge),null);
});

test('muted hybrid inputs explain Receive events off without implying broken signal flow',()=>{
  const {api}=fixture(),off={...target,eventsEnabled:false};
  assert.equal(api.mode(edge),'events');assert.equal(api.mode({...edge,target:off,events:false}),'off');
  assert.equal(api.description(off),'Values only · Receive events off');assert.equal(api.description({...source,hybrid:false}),'Values only');
  assert.equal(api.description({...edge,kind:'event',events:false}),'Carries events');
});
