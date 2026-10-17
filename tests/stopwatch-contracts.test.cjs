const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','examples','stopwatch.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));

function runtime(initial){
  let wall=1000,blockWallReads=false;
  class FixedDate extends Date{
    constructor(...args){super(...(args.length?args:[wall]));}
    static now(){if(blockWallReads)throw new Error('Unexpected wall-clock read');return wall;}
  }
  const component=vm.runInNewContext(source,{Date:FixedDate});
  let state=initial===undefined?component.initState():plain(initial),memory=null,inputs={run:false,reset:false};
  const style={...component.initStyle(),font:'24px sans-serif',color:'#64748b',textColor:'#334155'};
  return {
    component,style,
    step(at,run=inputs.run,reset=inputs.reset){
      wall=at;inputs={run,reset};
      const before=JSON.stringify({state,memory,inputs});
      const next=component.transition(inputs,state,memory,{now:0});
      assert.equal(JSON.stringify({state,memory,inputs}),before,'transition leaves its arguments untouched');
      assert.equal(next.nextWakeAt,null,'Stopwatch never schedules state updates while time passes');
      state=next.state;memory=next.memory;
      return plain(component.compute(inputs,state));
    },
    manual(at,handle){
      wall=at;const before=JSON.stringify({state,inputs});
      const next=component.dragEdit(state,handle,0,0,style.w,style.h,style,{inputs,outputs:component.compute(inputs,state),name:'Lap time'});
      assert.equal(JSON.stringify({state,inputs}),before,'manual controls leave their arguments untouched');
      assert.ok(next && next.state,'API2 manual controls return a state envelope');
      state=next.state;return plain(component.compute(inputs,state));
    },
    children(at,editing=false,name='Lap time'){
      wall=at;return plain(component.children(state,style,style.w,style.h,editing,{inputs,outputs:component.compute(inputs,state),name}));
    },
    setWall(at){wall=at;},
    blockWallReads(value){blockWallReads=value;},
    get state(){return plain(state);},
    get inputs(){return {...inputs};},
    get output(){return plain(component.compute(inputs,state));}
  };
}

test('Stopwatch declares run/reset inputs and elapsed seconds with a stopped initial state',()=>{
  const {component}=runtime();
  assert.equal(component.apiVersion,2);
  assert.deepEqual(plain(component.inputs),{run:{type:'boolean',default:false},reset:{type:'boolean',default:false}});
  assert.deepEqual(plain(component.outputs),{elapsed:{type:'number'}});
  assert.deepEqual(plain(component.initState()),{elapsedMs:0,startedAt:null,observedRun:false});
  assert.deepEqual(plain(component.compute({run:false,reset:false},component.initState())),{elapsed:0});
  assert.equal(component.refreshMs(component.initState()),0);
});

test('run edges start, pause, and resume an accumulated duration; held levels do not repeat commands',()=>{
  const rt=runtime();assert.deepEqual(rt.step(1000,false),{elapsed:0});
  assert.deepEqual(rt.step(1100,true),{elapsed:0});
  assert.equal(rt.state.startedAt,1100);assert.equal(rt.state.observedRun,true);
  assert.equal(rt.component.refreshMs(rt.state),100);
  const running=rt.state;
  assert.deepEqual(rt.step(2000,true),{elapsed:0});assert.deepEqual(rt.state,running,'a held run level does not create ticking state');
  assert.deepEqual(rt.step(2334,false),{elapsed:1.234});
  assert.deepEqual(rt.state,{elapsedMs:1234,startedAt:null,observedRun:false});
  assert.equal(rt.component.refreshMs(rt.state),0);
  assert.deepEqual(rt.step(5000,false),{elapsed:1.234});
  assert.deepEqual(rt.step(6000,true),{elapsed:1.234},'the last stopped total remains published during the next run');
  assert.deepEqual(rt.step(6250,false),{elapsed:1.484});
});

test('manual Start/Pause overrides a held run level until its next change',()=>{
  const rt=runtime();rt.step(1000,false);
  rt.manual(1100,'toggle');assert.equal(rt.state.startedAt,1100);assert.equal(rt.state.observedRun,false);
  rt.step(1400,false);assert.equal(rt.state.startedAt,1100,'run=false does not undo a manual Start');
  rt.step(1600,true);assert.equal(rt.state.startedAt,1100,'a Start command while already running does not restart the timestamp');
  assert.deepEqual(rt.manual(2100,'toggle'),{elapsed:1});
  assert.equal(rt.state.observedRun,true);
  rt.step(3000,true);assert.equal(rt.state.startedAt,null,'held run=true does not undo a manual Pause');
  assert.deepEqual(rt.step(3100,false),{elapsed:1},'a Pause command while already stopped preserves elapsed time');
  rt.manual(3200,'toggle');rt.step(3300,true);
  assert.equal(rt.state.startedAt,3200);
  assert.deepEqual(rt.step(4200,false),{elapsed:2});
});

test('manual Reset clears and stops without making a held run input restart',()=>{
  const rt=runtime();rt.step(1000,true);rt.manual(2250,'toggle');
  assert.deepEqual(rt.output,{elapsed:1.25});assert.equal(rt.state.observedRun,true);
  assert.deepEqual(rt.manual(3000,'reset'),{elapsed:0});
  assert.deepEqual(rt.state,{elapsedMs:0,startedAt:null,observedRun:true});
  rt.step(4000,true);assert.equal(rt.state.startedAt,null);
  rt.step(4100,false);rt.step(4200,true);assert.equal(rt.state.startedAt,4200);
});

test('held reset clears and stops, consumes run changes, and blocks manual Start',()=>{
  const rt=runtime();rt.step(1000,true);
  assert.deepEqual(rt.step(2000,true,true),{elapsed:0});
  assert.deepEqual(rt.state,{elapsedMs:0,startedAt:null,observedRun:true});
  rt.manual(2100,'toggle');assert.equal(rt.state.startedAt,null,'manual Start is inactive while reset is high');
  rt.step(2200,false,true);assert.equal(rt.state.observedRun,false);
  rt.step(2300,true,true);assert.equal(rt.state.observedRun,true);
  rt.manual(2400,'reset');assert.deepEqual(rt.output,{elapsed:0});
  rt.step(2500,true,false);assert.equal(rt.state.startedAt,null,'reset release alone does not start');
  rt.step(2600,false);rt.step(2700,true);assert.equal(rt.state.startedAt,2700);
  assert.deepEqual(rt.step(3200,false),{elapsed:0.5});
});

test('reloading running and manually overridden states preserves timestamps and the observed run level',()=>{
  for(const boundRun of [false,true]){
    const original=runtime();original.step(1000,boundRun);
    if(!boundRun)original.manual(1000,'toggle');
    const saved=original.state,reloaded=runtime(saved);
    assert.deepEqual(reloaded.step(3601000,boundRun),{elapsed:0});
    assert.deepEqual(reloaded.state,saved,'a reopened running instance retains its original wall timestamp');
    assert.ok(reloaded.children(3601000).some(child=>child.text==='01:00:00.000'));
    assert.deepEqual(reloaded.manual(3601234,'toggle'),{elapsed:3600.234});
  }
  const paused=runtime({elapsedMs:1234,startedAt:null,observedRun:true});
  assert.deepEqual(paused.step(5000,true),{elapsed:1.234});assert.equal(paused.state.startedAt,null);
  paused.step(6000,false);paused.step(7000,true);assert.equal(paused.state.startedAt,7000);
});

test('compute never reads wall time; the live visual readout advances without mutating saved state',()=>{
  const rt=runtime({elapsedMs:1007,startedAt:null,observedRun:false});
  rt.step(1000,true);const before=rt.state;
  rt.blockWallReads(true);
  assert.deepEqual(rt.output,{elapsed:1.007});
  rt.setWall(1000000);assert.deepEqual(rt.output,{elapsed:1.007});
  rt.blockWallReads(false);
  assert.ok(rt.children(2234).some(child=>child.text==='00:00:02.241'));
  assert.ok(rt.children(62000).some(child=>child.text==='00:01:02.007'));
  assert.deepEqual(rt.state,before,'presentation refreshes do not save elapsed ticks');
  assert.deepEqual(rt.step(62000,false),{elapsed:62.007});
  assert.ok(rt.children(999999).some(child=>child.text==='00:01:02.007'),'the stopped reading stays fixed');
});

test('elapsed duration is published at millisecond precision rather than tenths',()=>{
  for(const [duration,elapsed,reading] of [[1,0.001,'00:00:00.001'],[999,0.999,'00:00:00.999'],[1001,1.001,'00:00:01.001'],[3723456,3723.456,'01:02:03.456']]){
    const rt=runtime();rt.step(1000,true);
    assert.deepEqual(rt.step(1000+duration,false),{elapsed});
    assert.ok(rt.children(9999999).some(child=>child.text===reading),reading);
  }
});

test('Stopwatch instances and their command observations remain independent',()=>{
  const a=runtime(),b=runtime();a.step(1000,true);b.step(2000,true);
  assert.deepEqual(a.step(2500,false),{elapsed:1.5});
  assert.equal(b.state.startedAt,2000);assert.deepEqual(b.output,{elapsed:0});
  assert.deepEqual(b.manual(3000,'toggle'),{elapsed:1});
  a.manual(3100,'reset');assert.deepEqual(a.output,{elapsed:0});assert.deepEqual(b.output,{elapsed:1});
});

test('backward wall adjustments never subtract from previously accumulated time',()=>{
  const rt=runtime({elapsedMs:1234,startedAt:null,observedRun:false});rt.step(10000,true);
  assert.ok(rt.children(9000).some(child=>child.text==='00:00:01.234'));
  assert.deepEqual(rt.step(9000,false),{elapsed:1.234});
  rt.step(9500,true);assert.deepEqual(rt.step(10000,false),{elapsed:1.734});
});

test('non-Boolean inputs and malformed saved state are rejected without coercion',()=>{
  const {component}=runtime(),state=component.initState(),inputs={run:false,reset:false};
  for(const input of ['run','reset']){
    for(const value of [undefined,null,0,1,'false',{},[]]){
      assert.throws(()=>component.compute({...inputs,[input]:value},state),/must be Boolean/);
      assert.throws(()=>component.transition({...inputs,[input]:value},state,null,{now:0}),/must be Boolean/);
    }
  }
  const invalid=[
    ...[-1,0.5,Infinity,NaN,'0',Number.MAX_SAFE_INTEGER+1].map(elapsedMs=>({...state,elapsedMs})),
    ...[undefined,0.5,Infinity,NaN,'1000',Number.MAX_SAFE_INTEGER+1].map(startedAt=>({...state,startedAt})),
    ...[undefined,null,0,1,'false'].map(observedRun=>({...state,observedRun}))
  ];
  for(const badState of invalid){
    assert.throws(()=>component.compute(inputs,badState),/Invalid Stopwatch state/);
    assert.throws(()=>component.transition(inputs,badState,null,{now:0}),/Invalid Stopwatch state/);
    assert.throws(()=>component.dragEdit(badState,'toggle'),/Invalid Stopwatch state/);
  }
  assert.deepEqual(plain(state),{elapsedMs:0,startedAt:null,observedRun:false});
});

test('wall-clock timestamps and accumulated durations remain within the safe numeric range',()=>{
  for(const wall of [NaN,Infinity,-Infinity,0.5,Number.MAX_SAFE_INTEGER+1]){
    const rt=runtime();assert.throws(()=>rt.step(wall,true),/valid wall.clock time/);
  }
  const max=runtime({elapsedMs:Number.MAX_SAFE_INTEGER,startedAt:null,observedRun:false});
  max.step(1000,true);
  assert.throws(()=>max.step(1001,false),/elapsed time is outside the numeric range/);
  const stopped=runtime({elapsedMs:1000,startedAt:null,observedRun:false});
  stopped.blockWallReads(true);
  assert.deepEqual(stopped.step(0,false),{elapsed:1},'an unchanged stopped instance needs no wall clock');
  assert.deepEqual(stopped.manual(0,'reset'),{elapsed:0},'reset can clear a result without reading the clock');
});

test('manual controls work in readers and reset-high removes the Start/Pause interaction',()=>{
  const rt=runtime(),component=rt.component,style=rt.style,{w,h}=style;
  rt.step(1000,false);
  const io={inputs:rt.inputs,outputs:rt.output,name:'Lap time'};
  const handles=plain(component.handles(rt.state,w,h,style,io));
  assert.deepEqual(handles.map(handle=>handle.id),['toggle','reset']);
  assert.ok(handles.every(handle=>handle.editorOnly!==true),'operating controls remain usable in exported HTML');
  for(const handle of handles)assert.equal(component.hitEdit(rt.state,handle.x,handle.y,w,h,style,io),handle.id);
  assert.equal(component.hitEdit(rt.state,w/2,h*.2,w,h,style,io),null);
  const before=rt.state;rt.manual(1200,'unknown');assert.deepEqual(rt.state,before);

  rt.step(1300,true,true);
  const resetIo={inputs:rt.inputs,outputs:rt.output,name:'Lap time'};
  assert.deepEqual(plain(component.handles(rt.state,w,h,style,resetIo)).map(handle=>handle.id),['reset']);
  assert.equal(component.hitEdit(rt.state,w/4,h*.86,w,h,style,resetIo),null);
  assert.equal(component.hitEdit(rt.state,w*.75,h*.86,w,h,style,resetIo),'reset');
});

test('readout uses the instance name, shows the held published result, and stays recognizable when unavailable',()=>{
  const rt=runtime({elapsedMs:1007,startedAt:null,observedRun:false});rt.step(1000,true);
  const children=rt.children(2234,true,'  Boat   lap  ');
  assert.ok(children.some(child=>child.text==='Boat lap'));
  assert.ok(children.some(child=>child.text==='00:00:02.241'));
  assert.ok(children.some(child=>child.text==='Running · result: 1.007 s'));
  assert.ok(children.some(child=>child.text==='Pause'));
  assert.ok(children.some(child=>child.text==='Reset'));
  assert.ok(rt.children(2234,false,'').some(child=>child.text==='Stopwatch'),'unnamed instances have a useful fallback caption');

  function finite(value){
    if(typeof value==='number')assert.ok(Number.isFinite(value),'rendered geometry is finite');
    else if(value && typeof value==='object')Object.values(value).forEach(finite);
  }
  for(const [w,h] of [[300,160],[60,32],[600,160],[260,110]]){
    const io={inputs:rt.inputs,outputs:rt.output,name:'Lap time'};
    finite(rt.component.children(rt.state,rt.style,w,h,true,io));
    const unavailable=plain(rt.component.unavailableChildren(rt.state,rt.style,w,h,true,{...io,error:'Missing input'}));
    finite(unavailable);
    assert.ok(unavailable.some(child=>child.text==='--:--:--.---'));
    assert.ok(unavailable.some(child=>typeof child.text==='string' && child.text.replace(/\n/g,' ')==='Stopwatch unavailable'));
    assert.ok(!unavailable.some(child=>['Start','Pause','Reset'].includes(child.text)),'unavailable drawing has no active-looking operation buttons');
  }
});
