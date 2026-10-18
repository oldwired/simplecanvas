const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const plain=value=>JSON.parse(JSON.stringify(value));
function load(name,globals={}){
  return vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'),globals);
}
function instance(component,initialInputs){
  let state=component.initState(),memory={},inputs={...initialInputs};
  return {component,get state(){return state;},get memory(){return memory;},
    step(now,changes={},historical=false){inputs={...inputs,...changes};const result=component.transition(inputs,state,memory,{now,historical});
      state=result.state;memory=result.memory;return {...plain(component.publish(state)),nextWakeAt:result.nextWakeAt};},
    set(patch){state={...state,...patch};}};
}

test('coalescing sources declare latest wakes while transport Delay retains queued deadlines',()=>{
  for(const name of ['pulse-generator','trigger','edge-pulse','random-integer','sample-hold-integer','sample-hold-boolean','live-clock','stopwatch','timer']){
    assert.equal(load(name).wakePolicy,'latest',name);
  }
  assert.notEqual(load('delay').wakePolicy,'latest');
});

test('historical inputs cannot expire Pulse, Trigger or Edge pulse phases before the current observation',()=>{
  const pulse=instance(load('pulse-generator'),{seconds:1,width:.1,enable:true});
  pulse.step(0);assert.deepEqual(pulse.step(1000),{value:true,nextWakeAt:1100});
  assert.deepEqual(pulse.step(1200,{},true),{value:true,nextWakeAt:1100});
  assert.deepEqual(pulse.step(1500),{value:false,nextWakeAt:2400});
  assert.deepEqual(pulse.step(1600,{enable:false},true),{value:false,nextWakeAt:null},'historical disable still takes effect');
  const trigger=instance(load('trigger'),{});trigger.step(0);trigger.set({press:1});
  assert.deepEqual(trigger.step(10),{value:true,nextWakeAt:110});
  assert.deepEqual(trigger.step(120,{},true),{value:true,nextWakeAt:110});
  assert.deepEqual(trigger.step(200),{value:false,nextWakeAt:210});
  const edge=instance(load('edge-pulse'),{value:false,edge:'rising',seconds:.1});
  edge.step(0);assert.deepEqual(edge.step(10,{value:true}),{value:true,nextWakeAt:110});
  assert.deepEqual(edge.step(120,{value:false},true),{value:true,nextWakeAt:110});
  assert.deepEqual(edge.step(130,{value:true},true),{value:true,nextWakeAt:110});
  assert.equal(edge.memory.pending,1,'a historical input edge is queued even when the old phase is overdue');
  assert.deepEqual(edge.step(200),{value:false,nextWakeAt:210});
  assert.deepEqual(edge.step(210),{value:true,nextWakeAt:310});
});

test('Random and Sample and Hold take one late sample, while historical configuration changes still apply',()=>{
  let draws=0;const math=Object.create(Math);math.random=()=>{draws++;return .5;};
  const random=instance(load('random-integer',{Math:math}),{min:0,max:10});
  random.step(0);assert.equal(draws,1);
  assert.deepEqual(random.step(2000,{},true),{value:5,nextWakeAt:1000});assert.equal(draws,1);
  assert.deepEqual(random.step(2500),{value:5,nextWakeAt:3500});assert.equal(draws,2);
  assert.deepEqual(random.step(2600,{min:8,max:8},true),{value:8,nextWakeAt:3600});assert.equal(draws,3);
  for(const [name,first,second] of [['sample-hold-integer',7,99],['sample-hold-boolean',false,true]]){
    const hold=instance(load(name),{value:first,seconds:1});hold.step(0);
    assert.deepEqual(hold.step(2000,{value:second},true),{value:first,nextWakeAt:1000});
    assert.deepEqual(hold.step(2500),{value:second,nextWakeAt:3500});
    assert.deepEqual(hold.step(2600,{seconds:.5,value:first},true),{value:first,nextWakeAt:3100});
  }
});

test('historical wall-clock observations preserve due deadlines until the current observation',()=>{
  const base=Date.parse('2026-10-17T12:00:00Z');let wall=base;
  class Clock extends Date{static now(){return wall;}}
  const live=instance(load('live-clock',{Date:Clock}),{timezone:'UTC'});
  assert.equal(live.step(0).nextWakeAt,1000);wall=base+1200;
  assert.deepEqual(live.step(1100,{},true),{second:false,minute:false,hour:false,halfDay:false,time:'12:00:00',nextWakeAt:1000});
  assert.deepEqual(live.step(1200),{second:true,minute:false,hour:false,halfDay:false,time:'12:00:01',nextWakeAt:1300});
  wall=base;const timer=instance(load('timer',{Date:Clock}),{run:false,reset:false});
  timer.set({unit:'seconds',duration:3});timer.step(0);assert.equal(timer.step(0,{run:true}).nextWakeAt,1000);
  wall=base+2200;assert.deepEqual(timer.step(1200,{},true),{tick:false,reached:false,nextWakeAt:1000});
  assert.equal(timer.state.remainingMs,3000,'historical propagation does not consume wall time');
  assert.deepEqual(timer.step(2200),{tick:false,reached:false,nextWakeAt:3000});assert.equal(timer.state.remainingMs,800);
  assert.deepEqual(timer.step(2300,{reset:true},true),{tick:false,reached:false,nextWakeAt:null});assert.equal(timer.state.remainingMs,3000);
});
