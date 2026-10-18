const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','examples','live-clock.js'),'utf8');
const pulseNames=['second','minute','hour','halfDay'];
const plain=value=>JSON.parse(JSON.stringify(value));
const timestamp=value=>typeof value==='string'?Date.parse(value):value;
const pulses=outputs=>Object.fromEntries(pulseNames.map(name=>[name,outputs[name]]));
const low={second:false,minute:false,hour:false,halfDay:false};

// Wall time and active document time deliberately advance independently. This
// catches clocks that confuse a timezone boundary with their pulse duration.
function runtime(initial){
  let wall=Date.parse('2026-01-02T12:34:56.500Z');
  class FixedDate extends Date{
    constructor(...args){super(...(args.length?args:[wall]));}
    static now(){return wall;}
  }
  const component=vm.runInNewContext(source,{Date:FixedDate,Intl});
  let state=initial===undefined?component.initState():plain(initial),memory=null;
  let inputs={timezone:'local'};
  return {
    component,
    step(at,now=0,timezone=inputs.timezone){
      wall=timestamp(at);inputs={timezone};
      const before=JSON.stringify({inputs,state,memory});
      const next=component.transition(inputs,state,memory,{now});
      assert.equal(JSON.stringify({inputs,state,memory}),before,'transition leaves its arguments untouched');
      state=next.state;memory=next.memory;
      const output=plain(component.compute(inputs,state));
      assert.deepEqual(Object.keys(output).sort(),[...pulseNames,'time'].sort());
      assert.match(output.time,/^\d{2}:\d{2}:\d{2}$/);
      assert.ok(pulseNames.every(name=>typeof output[name]==='boolean'));
      assert.ok(next.nextWakeAt===null || Number.isFinite(next.nextWakeAt),'wake time is finite or absent');
      return {...output,nextWakeAt:next.nextWakeAt};
    },
    setWall(at){wall=timestamp(at);},
    clearMemory(){memory=null;},
    get state(){return plain(state);},
    get memory(){return plain(memory);},
    get inputs(){return {...inputs};}
  };
}

test('Live clock exposes one timezone input, four Boolean pulses, and a time string',()=>{
  const {component}=runtime();
  assert.equal(component.apiVersion,2);
  assert.deepEqual(plain(component.inputs),{timezone:{role:'control',type:'string',default:'local'}});
  assert.deepEqual(plain(component.outputs),{
    second:{role:'control',type:'boolean'},minute:{role:'control',type:'boolean'},hour:{role:'control',type:'boolean'},halfDay:{role:'control',type:'boolean'},time:{type:'string'}
  });
  assert.equal(typeof component.transition,'function');
  assert.equal(typeof component.compute,'function');
});

test('Live clock formats UTC, local, and IANA timezones as zero-padded 24-hour time',()=>{
  const at='2026-01-02T00:04:09.500Z';
  for(const [zone,expected] of [['UTC','00:04:09'],['Europe/Berlin','01:04:09'],['Asia/Kathmandu','05:49:09'],['America/New_York','19:04:09']]){
    const rt=runtime(),output=rt.step(at,0,zone);
    assert.equal(output.time,expected,zone);
    assert.deepEqual(pulses(output),low,'placement never emits a pulse');
  }
  const local=new Date(at),expected=[local.getHours(),local.getMinutes(),local.getSeconds()].map(value=>String(value).padStart(2,'0')).join(':');
  assert.equal(runtime().step(at,0,'local').time,expected);
});

test('Live clock starts and restores low, including exactly at noon or midnight',()=>{
  for(const at of ['2026-01-02T00:00:00.000Z','2026-01-02T12:00:00.000Z']){
    const fresh=runtime();
    assert.deepEqual(pulses(fresh.step(at,0,'UTC')),low);
    const restored=runtime({...fresh.state,time:'23:59:59',second:true,minute:true,hour:true,halfDay:true});
    assert.deepEqual(pulses(restored.step(at,100,'UTC')),low,'saved pulse values are not replayed');
    restored.clearMemory();
    assert.deepEqual(pulses(restored.step('2026-01-03T12:00:00.000Z',200,'UTC')),low,'a new execution establishes a fresh baseline');
  }
});

test('second, minute, hour, and half-day pulses follow their local boundaries',()=>{
  const fixtures=[
    ['2026-01-02T12:34:56.900Z','2026-01-02T12:34:57.000Z',{...low,second:true}],
    ['2026-01-02T12:34:59.900Z','2026-01-02T12:35:00.000Z',{...low,second:true,minute:true}],
    ['2026-01-02T12:59:59.900Z','2026-01-02T13:00:00.000Z',{...low,second:true,minute:true,hour:true}],
    ['2026-01-02T11:59:59.900Z','2026-01-02T12:00:00.000Z',{second:true,minute:true,hour:true,halfDay:true}],
    ['2026-01-02T23:59:59.900Z','2026-01-03T00:00:00.000Z',{second:true,minute:true,hour:true,halfDay:true}]
  ];
  for(const [before,at,expected] of fixtures){
    const rt=runtime();rt.step(before,0,'UTC');
    assert.deepEqual(pulses(rt.step(at,100,'UTC')),expected,at);
  }
  const nepal=runtime();nepal.step('2026-01-02T06:14:59.900Z',0,'Asia/Kathmandu');
  const noon=nepal.step('2026-01-02T06:15:00.000Z',100,'Asia/Kathmandu');
  assert.equal(noon.time,'12:00:00');
  assert.ok(pulseNames.every(name=>noon[name]),'a quarter-hour offset still reaches local noon');
});

test('boundary pulses last 100 ms of active document time without retriggering during the same second',()=>{
  const rt=runtime();rt.step('2026-01-02T11:59:59.900Z',0,'UTC');
  const high=rt.step('2026-01-02T12:00:00.000Z',100,'UTC');
  assert.ok(pulseNames.every(name=>high[name]));
  assert.equal(high.nextWakeAt,200,'the high phase schedules its falling edge');
  assert.ok(pulseNames.every(name=>rt.step('2026-01-02T12:00:00.050Z',150,'UTC')[name]));
  assert.ok(pulseNames.every(name=>rt.step('2026-01-02T12:00:00.099Z',199,'UTC')[name]));
  assert.deepEqual(pulses(rt.step('2026-01-02T12:00:00.100Z',200,'UTC')),low);
  assert.deepEqual(pulses(rt.step('2026-01-02T12:00:00.900Z',1000,'UTC')),low);
  assert.deepEqual(pulses(rt.step('2026-01-02T12:00:01.000Z',1100,'UTC')),{...low,second:true});
});

test('changing timezone re-primes every output and updates the displayed time',()=>{
  const rt=runtime();rt.step('2026-01-02T11:59:59.900Z',0,'UTC');
  assert.ok(pulseNames.every(name=>rt.step('2026-01-02T12:00:00.000Z',100,'UTC')[name]));
  const changed=rt.step('2026-01-02T12:00:00.025Z',125,'Europe/Berlin');
  assert.equal(changed.time,'13:00:00');assert.deepEqual(pulses(changed),low);
  assert.deepEqual(pulses(rt.step('2026-01-02T12:00:01.000Z',1100,'Europe/Berlin')),{...low,second:true});
});

test('separate clocks keep their timezone, sampled reading, and pulse state independent',()=>{
  const utc=runtime(),newYork=runtime();
  utc.step('2026-01-02T11:59:59.900Z',0,'UTC');
  newYork.step('2026-01-02T11:59:59.900Z',0,'America/New_York');
  const noon=utc.step('2026-01-02T12:00:00.000Z',100,'UTC');
  const morning=newYork.step('2026-01-02T12:00:00.000Z',100,'America/New_York');
  assert.equal(noon.time,'12:00:00');assert.equal(morning.time,'07:00:00');
  assert.equal(noon.halfDay,true);assert.equal(morning.halfDay,false);
  newYork.step('2026-01-02T12:00:00.100Z',200,'America/New_York');
  assert.equal(utc.component.compute(utc.inputs,utc.state).halfDay,true,'advancing one instance never lowers another instance’s pulse');
});

test('late wakes skip gaps, allow one observed second, and preserve a falling edge',()=>{
  const delayed=runtime();delayed.step('2026-01-02T12:34:56.900Z',0,'UTC');
  const late=delayed.step('2026-01-02T12:34:57.250Z',350,'UTC');
  assert.deepEqual(pulses(late),{...low,second:true},'one consecutive second can emit later than the boundary window');
  assert.equal(late.nextWakeAt,450,'a delayed emission still has a full 100 ms pulse');
  assert.deepEqual(pulses(delayed.step('2026-01-02T12:34:57.350Z',450,'UTC')),low);

  const rt=runtime();rt.step('2026-01-02T12:34:56.500Z',0,'UTC');
  assert.deepEqual(pulses(rt.step('2026-01-02T12:34:59.800Z',3300,'UTC')),low,'multi-second gaps are skipped');
  assert.deepEqual(pulses(rt.step('2026-01-02T12:34:59.900Z',3400,'UTC')),low);
  assert.deepEqual(pulses(rt.step('2026-01-02T12:35:00.050Z',3550,'UTC')),{...low,second:true,minute:true});
  assert.deepEqual(pulses(rt.step('2026-01-02T12:35:02.050Z',5550,'UTC')),low,'a late wake lowers the previous pulse before accepting another');
  assert.deepEqual(pulses(rt.step('2026-01-02T12:35:02.060Z',5560,'UTC')),low,'the skipped second is not immediately replayed');
  assert.deepEqual(pulses(rt.step('2026-01-02T12:35:03.000Z',6500,'UTC')),{...low,second:true});
  const missedNoon=runtime();missedNoon.step('2026-01-02T11:59:59.500Z',0,'UTC');
  const afterNoon=missedNoon.step('2026-01-02T12:00:01.100Z',1600,'UTC');
  assert.equal(afterNoon.time,'12:00:01');
  assert.deepEqual(pulses(afterNoon),low,'a sampled second after noon does not replay missed pulses');
});

test('compute and static children keep the settled snapshot without sampling or advancing wall time',()=>{
  const rt=runtime();rt.step('2026-01-02T12:34:56.900Z',0,'UTC');
  const {nextWakeAt,...expected}=rt.step('2026-01-02T12:34:57.000Z',100,'UTC');
  const state=rt.state,inputs=rt.inputs,before=JSON.stringify({state,inputs});
  rt.setWall('2027-07-15T23:00:00.000Z');
  assert.deepEqual(plain(rt.component.compute(inputs,state)),expected);
  const style={...rt.component.initStyle(),font:'14px sans-serif',color:'#64748b',textColor:'#334155'};
  const io={inputs,outputs:expected,name:'Station time'};
  const first=plain(rt.component.children(state,style,style.w,style.h,false,io));
  rt.setWall('2029-01-01T00:00:00.000Z');
  assert.deepEqual(plain(rt.component.children(state,style,style.w,style.h,false,io)),first);
  assert.equal(JSON.stringify({state,inputs}),before);
  assert.ok(first.some(child=>child.type==='text' && child.text===expected.time),'the visible reading matches the published string');
});

test('wall-clock discontinuities and inactive-document gaps re-prime without phantom pulses',()=>{
  const forward=runtime();forward.step('2026-01-02T11:59:59.900Z',0,'UTC');
  const jumped=forward.step('2026-01-03T12:00:00.000Z',100,'UTC');
  assert.equal(jumped.time,'12:00:00');assert.deepEqual(pulses(jumped),low);
  assert.deepEqual(pulses(forward.step('2026-01-03T12:00:01.000Z',1100,'UTC')),{...low,second:true});

  const backward=runtime();backward.step('2026-01-02T12:34:59.900Z',0,'UTC');
  assert.deepEqual(pulses(backward.step('2026-01-02T12:00:00.000Z',100,'UTC')),low);
  assert.deepEqual(pulses(backward.step('2026-01-02T12:00:01.000Z',1100,'UTC')),{...low,second:true});

  const smallBackward=runtime();smallBackward.step('2026-01-02T12:34:56.900Z',0,'UTC');
  assert.equal(smallBackward.step('2026-01-02T12:34:57.000Z',100,'UTC').second,true);
  assert.deepEqual(pulses(smallBackward.step('2026-01-02T12:34:56.999Z',101,'UTC')),low,'even a 1 ms backward adjustment lowers and re-primes');

  const resumed=runtime();resumed.step('2026-01-02T11:59:59.900Z',0,'UTC');
  assert.deepEqual(pulses(resumed.step('2026-01-02T12:00:05.000Z',100,'UTC')),low,'wall time elapsed while the document timeline was paused');
  assert.deepEqual(pulses(resumed.step('2026-01-02T12:00:06.000Z',1100,'UTC')),{...low,second:true});
});

test('DST changes use real elapsed time and the sampled local boundary fields',()=>{
  const fixtures=[
    ['Europe/Berlin','2026-03-29T00:59:59.900Z','2026-03-29T01:00:00.000Z','03:00:00',{...low,second:true,minute:true,hour:true}],
    ['Europe/Berlin','2026-10-25T00:59:59.900Z','2026-10-25T01:00:00.000Z','02:00:00',{...low,second:true,minute:true,hour:true}],
    ['Australia/Lord_Howe','2026-04-04T14:59:59.900Z','2026-04-04T15:00:00.000Z','01:30:00',{...low,second:true,minute:true}],
    ['Australia/Lord_Howe','2026-10-03T15:29:59.900Z','2026-10-03T15:30:00.000Z','02:30:00',{...low,second:true,minute:true}]
  ];
  for(const [zone,before,at,time,expected] of fixtures){
    const rt=runtime();rt.step(before,0,zone);const output=rt.step(at,100,zone);
    assert.equal(output.time,time,zone+' '+at);assert.deepEqual(pulses(output),expected,zone+' '+at);
  }
});

test('timezones and time contexts reject invalid input without coercion',()=>{
  for(const timezone of [null,0,true,{},'','Not/A_Timezone','x'.repeat(129)]){
    assert.throws(()=>runtime().step('2026-01-02T12:34:56.500Z',0,timezone),/timezone|time zone|string/i);
  }
  const {component}=runtime();
  assert.throws(()=>component.transition({timezone:undefined},component.initState(),null,{now:0}),/timezone|time zone|string/i);
  for(const now of [-1,Infinity,NaN,'0'])assert.throws(()=>runtime().step('2026-01-02T12:34:56.500Z',now,'UTC'),/time|clock/i);
  for(const at of [NaN,Infinity,-Infinity,8640000000000001])assert.throws(()=>runtime().step(at,0,'UTC'),/wall.clock time/i);
});

test('malformed saved readings, pulse flags, and scheduling memory fail explicitly',()=>{
  const rt=runtime();rt.step('2026-01-02T12:34:56.500Z',0,'UTC');
  const component=rt.component,inputs=rt.inputs,state=rt.state,memory=rt.memory;
  for(const time of ['',null,0,'24:00:00','00:60:00','00:00:60','1:02:03']){
    assert.throws(()=>component.compute(inputs,{...state,time}),/Invalid Live clock state/);
    assert.throws(()=>component.transition(inputs,{...state,time},memory,{now:10}),/Invalid Live clock state/);
  }
  for(const key of [...pulseNames,'showIndicators']){
    for(const value of [undefined,0,1,'false',null])assert.throws(()=>component.compute(inputs,{...state,[key]:value}),/Invalid Live clock state/);
  }
  const malformed=[[],true,1,'memory',
    {...memory,zone:null},{...memory,wall:Infinity},{...memory,epochSecond:memory.epochSecond+1},
    {...memory,now:-1},{...memory,now:NaN},{...memory,until:undefined},{...memory,until:Infinity},{...memory,until:memory.now}];
  for(const badMemory of malformed){
    assert.throws(()=>component.transition(inputs,state,badMemory,{now:10}),/Invalid Live clock scheduling memory/);
  }
  for(const fresh of [null,undefined,{}]){
    const next=component.transition(inputs,{...state,second:true},fresh,{now:10});
    assert.deepEqual(pulses(next.state),low,'absent scheduling memory establishes a fresh observation');
  }
});

test('unavailable readings remain recognizable and finite; indicator editing is authoring-only',()=>{
  const rt=runtime();rt.step('2026-01-02T12:34:56.500Z',0,'UTC');
  const component=rt.component,state=rt.state;
  const style={...component.initStyle(),font:'16px sans-serif',color:'#64748b',textColor:'#334155'};
  const outputs=plain(component.compute(rt.inputs,state));
  function finite(value){
    if(typeof value==='number')assert.ok(Number.isFinite(value),'rendered geometry is finite');
    else if(value && typeof value==='object')Object.values(value).forEach(finite);
  }
  for(const [w,h] of [[220,300],[44,60],[440,300],[180,208]]){
    const io={inputs:rt.inputs,outputs,name:'Long custom station name'};
    const available=plain(component.children(state,style,w,h,false,io));
    const unavailable=plain(component.unavailableChildren(state,style,w,h,true,{...io,error:'Invalid timezone'}));
    finite(available);finite(unavailable);
    assert.ok(available.some(child=>child.type==='text' && child.text===outputs.time));
    assert.ok(unavailable.some(child=>child.type==='text' && child.text==='--:--:--'));
    assert.ok(unavailable.some(child=>child.type==='text' && /Invalid timezone/.test(child.text.replace(/\n/g,' '))));
    assert.equal(unavailable.filter(child=>child.type==='line').length,12,'unavailable clock keeps tick marks but removes the hands');
    assert.ok(!unavailable.some(child=>child.editorOnly),'unavailable rendering does not advertise active editing controls');
    assert.ok(component.handles(state,w,h).every(handle=>handle.editorOnly===true));
  }
  const before=JSON.stringify(state),hidden=component.dragEdit(state,'indicators').state;
  assert.equal(hidden.showIndicators,false);assert.equal(JSON.stringify(state),before);
  assert.equal(component.dragEdit(hidden,'indicators').state.showIndicators,true);
  const hiddenChildren=component.children(hidden,style,220,300,false,{inputs:rt.inputs,outputs,name:'Station time'});
  assert.equal(hiddenChildren.filter(child=>child.type==='ellipse').length,1,'hiding indicators leaves the analog clock face');
});
