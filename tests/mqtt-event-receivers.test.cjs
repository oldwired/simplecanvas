const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseApp}=require('./helpers/app-source.cjs');
const app=parseApp(fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'));
const helpers=vm.runInNewContext(app.declarationsSource(['componentRuntimeBindings','componentEventBinding','componentHasEventReceivers'])+';({componentHasEventReceivers})',{
  componentWorkspace:scene=>scene[Symbol.for('simplecanvas.workspace')]
});
const has=helpers.componentHasEventReceivers;
function component(uid){return {type:'smart',componentApi:2,uid};}
function record(extra={}){return {caps:{apiVersion:2,eventApi:1,eventInputs:{},eventOutputs:{},...extra}};}
function fixture(){
  const source=component('source'),target=component('target'),scene=[source,target];
  const records=new Map([[source,record({eventOutputs:{value:{hybrid:true},json:{hybrid:true}}})],[target,record()]]);
  return {source,target,scene,records};
}
test('MQTT events need no queue for value-only displays or unconnected hybrid inputs',()=>{
  const f=fixture();f.target.bindings={value:{uid:'source',port:'value'}};
  assert.equal(has(f.scene,f.source,f.records,['value']),false);
  f.records.get(f.target).caps.eventInputs={line:{hybrid:true}};
  assert.equal(has(f.scene,f.source,f.records,['value']),false);
});
test('hybrid transform and Memo inputs receive unless Receive events is disabled',()=>{
  const f=fixture();f.records.get(f.target).caps.eventInputs={value:{hybrid:true}};
  f.records.get(f.target).caps.eventTransform={input:'value',outputs:['text'],reprocess:'reprocess'};
  f.target.bindings={value:{uid:'source',port:'value'}};
  assert.equal(has(f.scene,f.source,f.records,['value']),true);
  f.target.eventModes={value:'value'};assert.equal(has(f.scene,f.source,f.records,['value']),false);
  f.target.eventModes.value='both';assert.equal(has(f.scene,f.source,f.records,['value']),true);
});
test('explicit event bindings count while unresolved and non-emitted ports do not',()=>{
  const f=fixture();f.records.get(f.target).caps.eventInputs={append:{type:'string'}};
  f.target.eventBindings={append:{uid:'source',port:'json'}};
  assert.equal(has(f.scene,f.source,f.records,['value']),false);
  assert.equal(has(f.scene,f.source,f.records,['value','json']),true);
  f.target.eventBindings.append.unresolved=true;assert.equal(has(f.scene,f.source,f.records,['json']),false);
});
test('a value-only hop into a transform does not indirectly activate its event consumers',()=>{
  const f=fixture(),memo=component('memo');f.scene.push(memo);
  f.target.bindings={value:{uid:'source',port:'value'}};f.target.eventModes={value:'value'};
  f.records.set(f.target,record({eventInputs:{value:{hybrid:true}},eventOutputs:{text:{hybrid:true}},eventTransform:{input:'value',outputs:['text'],reprocess:'reprocess'}}));
  memo.bindings={line:{uid:'target',port:'text'}};f.records.set(memo,record({eventInputs:{line:{hybrid:true}}}));
  assert.equal(has(f.scene,f.source,f.records,['value']),false);
  delete f.target.eventModes;assert.equal(has(f.scene,f.source,f.records,['value']),true);
});
test('workspace Publish and generated remote Receive bindings are event receivers',()=>{
  const f=fixture();f.records.get(f.target).caps.workspaceEndpoint={direction:'publish',ports:{reading:{type:'number'}}};
  f.records.get(f.target).caps.eventInputs={reading:{hybrid:true}};f.target.bindings={reading:{uid:'source',port:'value'}};
  assert.equal(has(f.scene,f.source,f.records,['value']),true);
  f.records.get(f.target).caps.workspaceEndpoint={direction:'receive',ports:{reading:{type:'number'}}};
  f.records.get(f.target).caps.eventInputs={__remote_reading:{hybrid:true}};delete f.target.bindings;
  f.target.workspaceReceive={reading:{sketchId:'background',componentUid:'source',port:'value'}};
  f.scene[Symbol.for('simplecanvas.workspace')]={whole:true,sketchByUid:new Map([['source','background'],['target','dashboard']]),duplicates:new Set()};
  assert.equal(has(f.scene,f.source,f.records,['value']),true);
  f.scene[Symbol.for('simplecanvas.workspace')].whole=false;assert.equal(has(f.scene,f.source,f.records,['value']),false);
});
test('missing target/source records or duplicate identities conservatively keep delivery',()=>{
  const f=fixture();assert.equal(has(f.scene,f.source,null,['value']),true);
  f.records.delete(f.target);assert.equal(has(f.scene,f.source,f.records,['value']),true);
  f.records.set(f.target,record());f.records.delete(f.source);assert.equal(has(f.scene,f.source,f.records,['value']),true);
  f.records.set(f.source,record({eventOutputs:{value:{hybrid:true}}}));f.scene.push(component('source'));
  assert.equal(has(f.scene,f.source,f.records,['value']),true);
});

test('integration snapshots stay stable during a graph pass and refresh for the next pass',()=>{
  const capture=vm.runInNewContext(app.declaration('captureComponentIntegrationRead')+';captureComponentIntegrationRead');
  const item={},caps={mqttSource:{topic:'topic',path:'path',format:'json',valueType:'number'}};
  let value=1,calls=0;const read=()=>{calls++;return {available:true,value};};
  const pass=capture(read),inputs={topic:'room/value',path:'/value'};
  assert.equal(pass(item,caps,inputs).value,1);value=2;
  assert.equal(pass(item,caps,{...inputs}).value,1,'new network values cannot change later rounds of the accepted pass');
  assert.equal(calls,1);
  assert.equal(pass(item,caps,{...inputs,path:'/other'}).value,2,'a newly resolved request gets its own snapshot');
  assert.equal(capture(read)(item,caps,inputs).value,2,'the following evaluation catches up');
});
