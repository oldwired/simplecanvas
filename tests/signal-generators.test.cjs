const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const plain=value=>JSON.parse(JSON.stringify(value));
const load=file=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',file),'utf8'));
const pulse=load('pulse-generator.js'),edge=load('edge-pulse.js');
function instance(component,inputs,saved){
  let state=saved||component.initState(),memory=null;
  return {
    step(now,changes={}){
      inputs={...inputs,...changes};
      const before=JSON.stringify({state,memory});
      const result=component.transition(inputs,state,memory,{now});
      assert.equal(JSON.stringify({state,memory}),before,'transition does not mutate its arguments');
      assert.ok(JSON.stringify(result.memory).length<=4000,'transient memory stays within the host budget');
      state=plain(result.state);memory=plain(result.memory);
      return plain({value:component.compute(inputs,state).value,nextWakeAt:result.nextWakeAt});
    },
    state:()=>plain(state),memory:()=>plain(memory),
    rePrime(){memory=null;}
  };
}
const pulseInputs={seconds:1,width:.1,enable:true};
const edgeInputs={value:false,edge:'rising',seconds:.1};

test('Pulse generator starts low and follows exact period and width boundaries',()=>{
  const p=instance(pulse,pulseInputs);
  assert.deepEqual(p.step(0),{value:false,nextWakeAt:1000});
  assert.deepEqual(p.step(999),{value:false,nextWakeAt:1000});
  assert.deepEqual(p.step(1000),{value:true,nextWakeAt:1100});
  assert.deepEqual(p.step(1099),{value:true,nextWakeAt:1100});
  assert.deepEqual(p.step(1100),{value:false,nextWakeAt:2000});
  assert.deepEqual(p.step(2000),{value:true,nextWakeAt:2100});
  const minimum=instance(pulse,{seconds:.02,width:.01,enable:true});
  assert.deepEqual(minimum.step(0),{value:false,nextWakeAt:20});
  assert.deepEqual(minimum.step(20),{value:true,nextWakeAt:30});
  assert.deepEqual(minimum.step(30),{value:false,nextWakeAt:40});
});

test('Pulse generator preserves high and low phases on late wakes without catch-up bursts',()=>{
  const p=instance(pulse,pulseInputs);
  p.step(0);
  assert.deepEqual(p.step(10000),{value:true,nextWakeAt:10100});
  assert.deepEqual(p.step(10000),{value:true,nextWakeAt:10100});
  assert.deepEqual(p.step(20000),{value:false,nextWakeAt:20900});
  assert.deepEqual(p.step(20000),{value:false,nextWakeAt:20900});
});

test('Pulse generator disable, changed timings, and restored state restart from low',()=>{
  const p=instance(pulse,pulseInputs);
  p.step(0);p.step(1000);
  assert.deepEqual(p.step(1010,{enable:false}),{value:false,nextWakeAt:null});
  assert.deepEqual(p.step(2000),{value:false,nextWakeAt:null});
  assert.deepEqual(p.step(3000,{enable:true}),{value:false,nextWakeAt:4000});
  assert.deepEqual(p.step(4000),{value:true,nextWakeAt:4100});
  assert.deepEqual(p.step(4001,{width:.2}),{value:false,nextWakeAt:5001});
  assert.deepEqual(p.step(4002,{seconds:2}),{value:false,nextWakeAt:6002});
  const restored=instance(pulse,pulseInputs,{value:true,showIndicators:false});
  assert.deepEqual(restored.step(0),{value:false,nextWakeAt:1000});
  assert.equal(restored.state().showIndicators,false);
  restored.step(1000);restored.rePrime();
  assert.deepEqual(restored.step(1050),{value:false,nextWakeAt:2050});
});

test('Pulse generator rejects impossible timings, bad state, and deadline overflow',()=>{
  for(const changes of [{seconds:.019},{seconds:3601},{seconds:NaN},{width:0},{width:.009},{width:1},{width:.995},{width:Infinity},{enable:1}]){
    assert.throws(()=>pulse.compute({...pulseInputs,...changes},pulse.initState()));
  }
  assert.doesNotThrow(()=>pulse.compute({seconds:.03,width:.02,enable:true},pulse.initState()),'decimal arithmetic allows exactly 10ms low');
  assert.throws(()=>pulse.compute(pulseInputs,{value:0}),/Boolean output/);
  assert.throws(()=>pulse.transition(pulseInputs,pulse.initState(),null,{now:-1}),/monotonic/);
  assert.throws(()=>pulse.transition(pulseInputs,pulse.initState(),null,{now:Number.MAX_VALUE}),/wake time/);
  assert.throws(()=>pulse.transition(pulseInputs,pulse.initState(),{phase:'high'},{now:0}),/scheduling memory/);
  assert.throws(()=>pulse.transition(pulseInputs,pulse.initState(),{...pulseInputs,phase:'idle',nextAt:null},{now:0}),/scheduling memory/);
});

test('Edge pulse primes an initial high and only triggers a later rising edge',()=>{
  const e=instance(edge,{...edgeInputs,value:true});
  assert.deepEqual(e.step(0),{value:false,nextWakeAt:null});
  assert.deepEqual(e.step(5),{value:false,nextWakeAt:null});
  assert.deepEqual(e.step(10,{value:false}),{value:false,nextWakeAt:null});
  assert.deepEqual(e.step(20,{value:true}),{value:true,nextWakeAt:120});
  assert.deepEqual(e.step(119),{value:true,nextWakeAt:120});
  assert.deepEqual(e.step(120),{value:false,nextWakeAt:130});
  assert.deepEqual(e.step(130),{value:false,nextWakeAt:null});
  assert.deepEqual(e.step(1000),{value:false,nextWakeAt:null},'a held level does not retrigger');
});

test('Edge pulse supports falling and either edges without initial phantom pulses',()=>{
  const falling=instance(edge,{...edgeInputs,edge:'falling'});
  assert.equal(falling.step(0).value,false);
  assert.equal(falling.step(1,{value:true}).value,false);
  assert.deepEqual(falling.step(2,{value:false}),{value:true,nextWakeAt:102});
  const either=instance(edge,{...edgeInputs,edge:'either'});
  either.step(0);
  assert.deepEqual(either.step(1,{value:true}),{value:true,nextWakeAt:101});
  assert.equal(either.step(2,{value:false}).value,true);
  assert.equal(either.memory().pending,1);
  assert.deepEqual(either.step(101),{value:false,nextWakeAt:111});
  assert.deepEqual(either.step(111),{value:true,nextWakeAt:211});
});

test('Edge pulse retains queued short transitions and exposes a low gap even on late wakes',()=>{
  const e=instance(edge,edgeInputs);
  e.step(0);e.step(1,{value:true});e.step(2,{value:false});e.step(3,{value:true});
  assert.equal(e.memory().pending,1);
  assert.deepEqual(e.step(10000),{value:false,nextWakeAt:10010});
  assert.deepEqual(e.step(10000),{value:false,nextWakeAt:10010});
  assert.deepEqual(e.step(10009),{value:false,nextWakeAt:10010});
  assert.deepEqual(e.step(10010),{value:true,nextWakeAt:10110});
  assert.deepEqual(e.step(20000),{value:false,nextWakeAt:20010});
  assert.deepEqual(e.step(20010),{value:false,nextWakeAt:null});
});

test('Edge pulse configuration changes and re-prime discard pending work',()=>{
  const e=instance(edge,edgeInputs);
  e.step(0);e.step(1,{value:true});e.step(2,{value:false});e.step(3,{value:true});
  assert.deepEqual(e.step(4,{seconds:.2}),{value:false,nextWakeAt:null});
  assert.equal(e.memory().pending,0);
  assert.deepEqual(e.step(5,{value:false,edge:'falling'}),{value:false,nextWakeAt:null},'changing mode primes the current level');
  e.step(6,{value:true});
  assert.equal(e.step(7,{value:false}).value,true);
  e.rePrime();
  assert.deepEqual(e.step(8),{value:false,nextWakeAt:null});
  const restored=instance(edge,{...edgeInputs,value:true},{value:true,showIndicators:false});
  assert.deepEqual(restored.step(0),{value:false,nextWakeAt:null});
  assert.equal(restored.state().showIndicators,false);
});

test('Edge pulse bounds the pending queue and reports overflow',()=>{
  const e=instance(edge,{...edgeInputs,seconds:1});
  e.step(0);e.step(1,{value:true});
  for(let i=0;i<64;i++){e.step(2+i*2,{value:false});e.step(3+i*2,{value:true});}
  assert.equal(e.memory().pending,64);
  assert.ok(JSON.stringify(e.memory()).length<300,'queue uses a bounded count rather than stored events');
  e.step(130,{value:false});
  assert.throws(()=>e.step(131,{value:true}),/queue is full/);
});

test('Edge pulse validates input, state, memory, and numeric deadlines',()=>{
  for(const changes of [{value:1},{edge:'both'},{seconds:0},{seconds:.009},{seconds:3601},{seconds:Infinity}]){
    assert.throws(()=>edge.compute({...edgeInputs,...changes},edge.initState()));
  }
  assert.throws(()=>edge.compute(edgeInputs,{value:null}),/Boolean output/);
  assert.throws(()=>edge.transition(edgeInputs,edge.initState(),null,{now:NaN}),/monotonic/);
  assert.throws(()=>edge.transition(edgeInputs,edge.initState(),{previous:false},{now:0}),/scheduling memory/);
  const e=instance(edge,edgeInputs);e.step(0);
  assert.throws(()=>e.step(Number.MAX_VALUE,{value:true}),/wake time/);
});

test('Signal generator instances hold independent schedules and compute stays pure',()=>{
  for(const [component,inputs] of [[pulse,pulseInputs],[edge,edgeInputs]]){
    const a=instance(component,inputs),b=instance(component,inputs);
    a.step(0);b.step(500);
    if(component===pulse){a.step(1000);assert.equal(a.state().value,true);assert.equal(b.step(1000).value,false);}
    else{a.step(1000,{value:true});assert.equal(a.state().value,true);assert.equal(b.step(1000).value,false);}
    const before=JSON.stringify(a.state());
    for(let n=0;n<3;n++)assert.equal(component.compute(inputs,a.state()).value,true);
    assert.equal(JSON.stringify(a.state()),before);
  }
});

test('Signal generator visuals use instance names, optional LEDs, and honest unavailable states',()=>{
  for(const [component,inputs] of [[pulse,pulseInputs],[edge,edgeInputs]]){
    const state=component.initState(),style=component.initStyle(),name='My signal';
    const children=component.children(state,style,style.w,style.h,true,{name,inputs,outputs:{value:true}});
    assert.ok(children.some(child=>child.text===name));
    assert.equal(children.filter(child=>child.type==='ellipse').length,2);
    assert.ok(children.some(child=>child.type==='ellipse' && child.fillColor==='#15803d'));
    assert.equal(component.children({...state,showIndicators:false},style,style.w,style.h,false,{name,inputs,outputs:{value:true}}).filter(child=>child.type==='ellipse').length,0);
    const unavailable=component.unavailableChildren(state,style,style.w,style.h,true,{name,error:'Missing value or binding'});
    assert.ok(unavailable.some(child=>child.text===name));
    assert.equal(unavailable.filter(child=>child.type==='ellipse' && child.fillColor==='#fbbf24').length,2);
    assert.ok(unavailable.some(child=>child.type==='polygon'),'symbol remains visible');
    assert.ok(unavailable.every(child=>!child.editorOnly),'unavailable previews do not offer a dead authoring control');
    assert.equal(component.dragEdit(state,'indicators').state.showIndicators,false);
    assert.equal(component.handles(state,style.w,style.h)[0].editorOnly,true);
  }
});
