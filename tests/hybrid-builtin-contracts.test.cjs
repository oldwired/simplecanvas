const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..'),plain=value=>JSON.parse(JSON.stringify(value));
const source=name=>vm.runInNewContext(fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8'));
const transforms={
  'text-extract':['text',['text','found']], 'text-compare':['text',['value']],
  'text-replace':['text',['text','count']], 'text-transform':['text',['text','length','empty']],
  'text-to-number':['text',['value','valid']], 'number-to-text':['value',['text']],
  'number-function':['value',['value']], 'number-inverter':['value',['value']],
  clamp:['value',['value']], 'range-map':['value',['value']], compare:['value',['value']],
  math:['a',['value']],
  'json-extract':['text',['value','found','valid']], 'json-edit':['text',['text','valid']],
  'date-parse':['text',['timestamp','valid']], 'date-format':['timestamp',['text','valid']],
  'date-difference':['end',['value','valid']]
};

test('scalar transform definitions identify one driving input and an explicit Reprocess command',()=>{
  for(const [name,[input,resultPorts]] of Object.entries(transforms)){
    const def=source(name),state=def.initState(),inputs=typeof def.inputs==='function'?def.inputs(state):def.inputs,outputs=typeof def.outputs==='function'?def.outputs(state):def.outputs;
    assert.equal(def.eventApi,1,name);
    assert.deepEqual(plain(def.eventTransform),{input,outputs:resultPorts,reprocess:'reprocess'},name);
    assert.deepEqual(Object.keys(inputs).filter(key=>inputs[key].event===true),[input],name+' has one data-event driver');
    assert.deepEqual(plain(inputs.reprocess),{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'},name);
    assert.deepEqual(Object.keys(outputs).filter(key=>outputs[key].event===true),resultPorts,name);
    assert.equal(def.onEvent,undefined,name+' reuses compute instead of copying it into an event handler');
    assert.equal(def.transition,undefined,name+' stays a pure transform');
  }
});

test('Text compose accepts events on every active text input while formatting controls stay value-only',()=>{
  const def=source('text-compose');assert.equal(def.eventApi,1);
  for(const mode of ['join','template'])for(let count=2;count<=8;count++){
    const state={...def.initState(),mode,inputCount:count},inputs=def.inputs(state),drivers=Array.from('abcdefgh'.slice(0,count));
    assert.deepEqual(plain(def.eventTransform(state)),{inputs:drivers,outputs:['text'],reprocess:'reprocess'},mode+' with '+count+' inputs');
    assert.deepEqual(Object.keys(inputs).filter(key=>inputs[key].event===true),drivers);
    assert.deepEqual(plain(inputs.reprocess),{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'});
    assert.equal(inputs[mode==='join'?'separator':'template'].event,undefined,'formatting changes remain value-only');
    assert.equal(inputs['abcdefgh'[count]],undefined,'inactive text inputs are absent');
  }
  assert.equal(def.outputs.text.event,true);
  assert.equal(def.onEvent,undefined,'all input events reuse the pure computation');
  assert.equal(def.transition,undefined);
  for(const inputCount of [0,1,9,2.5,NaN])assert.throws(()=>def.eventTransform({...def.initState(),inputCount}),/whole number from 2 to 8/);
});

test('Reprocess is host metadata and does not change pure calculation results',()=>{
  for(const name of [...Object.keys(transforms),'text-compose']){
    const def=source(name),state=def.initState(),ports=typeof def.inputs==='function'?def.inputs(state):def.inputs;
    const inputs=Object.fromEntries(Object.entries(ports).map(([key,port])=>[key,port.default??(port.type==='number'?0:port.type==='boolean'?false:'')]));
    if(name==='math')inputs.b=1;
    const before=JSON.stringify({state,inputs}),normal=plain(def.compute(inputs,state)),explicit=plain(def.compute({...inputs,reprocess:true},state));
    assert.deepEqual(explicit,normal,name);assert.equal(JSON.stringify({state,inputs}),before,name+' is immutable');
    assert.equal(normal.events,undefined,name+' does not infer events from computation');
  }
});

test('extractor keeps zero-based start plus length semantics used by the hybrid demo',()=>{
  const def=source('text-extract'),state=def.initState();
  assert.deepEqual(plain(def.compute({text:'Hello World',start:2,length:3,reprocess:false},state)),{text:'llo',found:true});
  assert.deepEqual(plain(def.compute({text:'Another Test',start:2,length:3,reprocess:false},state)),{text:'oth',found:true});
  assert.deepEqual(plain(def.compute({text:'Another Test',start:3,length:5,reprocess:true},state)),{text:'ther ',found:true});
});

test('Memo has one typed Content/Line API and retains distinct sampled-value triggers',()=>{
  const def=source('memo');assert.equal(def.inputs.content.event,true);assert.equal(def.inputs.line.event,true);
  assert.equal(def.inputs.set.event,undefined);assert.equal(def.inputs.append.event,undefined);assert.equal(def.inputs.clear.event,'command');
  assert.equal(def.eventInputs,undefined);assert.equal(def.eventOutputs,undefined);
  let state=def.onEvent('content','first',def.initState()).state;
  state=def.onEvent('line','second',state).state;
  assert.equal(state.text,'first\nsecond');assert.equal(state.lineCount,2);
  assert.throws(()=>def.onEvent('line',2.8,state),/string/,'numeric events need an explicit converter');
  assert.equal(def.onEvent('clear',null,state).state.text,'');
});

test('Trigger publishes a true occurrence only for a completed press while retaining its pulse token',()=>{
  const def=source('trigger'),state=def.initState();assert.equal(def.outputs.value.event,true);
  const pressed=plain(def.dragEdit(state,'trigger'));assert.equal(pressed.state.press,state.press+1);
  assert.deepEqual(pressed.events,[{port:'value',payload:true}]);
  assert.equal(def.dragEdit(state,'indicators').events,undefined);
});
