const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','examples','timer.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const units={seconds:1000,minutes:60000};

function runtime({unit='seconds',duration=3,initial}={}){
  let wall=1000,blocked=false;
  class FixedDate extends Date{
    constructor(...args){super(...(args.length?args:[wall]));}
    static now(){if(blocked)throw new Error('Unexpected wall-clock read');return wall;}
  }
  const component=vm.runInNewContext(source,{Date:FixedDate});
  let state=initial?plain(initial):{...component.initState(),unit,duration,configuredUnit:unit,configuredDuration:duration,remainingMs:duration*units[unit]};
  let memory=null,inputs={run:false,reset:false};
  const style={...component.initStyle(),font:'12px sans-serif',color:'#64748b',textColor:'#334155'};
  return {
    component,style,
    step(at,run=inputs.run,reset=inputs.reset,now=at){
      wall=at;inputs={run,reset};const before=JSON.stringify({state,memory,inputs});
      const next=component.transition(inputs,state,memory,{now});
      assert.equal(JSON.stringify({state,memory,inputs}),before,'transition leaves its arguments untouched');
      assert.ok(next.nextWakeAt===null || Number.isFinite(next.nextWakeAt),'wake time is finite or absent');
      state=next.state;memory=next.memory;
      return {...plain(component.compute(inputs,state)),nextWakeAt:next.nextWakeAt};
    },
    manual(at,handle,lx=0,ly=0){
      wall=at;const before=JSON.stringify({state,inputs});
      const next=component.dragEdit(state,handle,lx,ly,style.w,style.h,style,{inputs,outputs:component.compute(inputs,state),name:'Tea timer'});
      assert.equal(JSON.stringify({state,inputs}),before,'manual controls leave their arguments untouched');
      assert.ok(next && next.state,'manual controls return the API2 state envelope');
      state=next.state;return plain(component.compute(inputs,state));
    },
    edit(patch){state={...state,...patch};},
    clearMemory(){memory=null;},
    setWall(at){wall=at;},
    blockWallReads(value){blocked=value;},
    children(editing=false,name='Tea timer'){
      return plain(component.children(state,style,style.w,style.h,editing,{inputs,outputs:component.compute(inputs,state),name}));
    },
    get output(){return plain(component.compute(inputs,state));},
    get state(){return plain(state);},
    get memory(){return plain(memory);},
    get inputs(){return {...inputs};}
  };
}

test('Timer declares configurable minutes/seconds, run/reset, and tick/reached outputs',()=>{
  const {component}=runtime();
  assert.equal(component.apiVersion,2);
  assert.deepEqual(plain(component.inputs),{run:{role:'control',type:'boolean',default:false},reset:{role:'control',type:'boolean',default:false}});
  assert.deepEqual(plain(component.outputs),{tick:{role:'control',type:'boolean'},reached:{role:'control',type:'boolean'}});
  assert.deepEqual(plain(component.settings.unit.options),['minutes','seconds']);
  assert.equal(component.settings.unit.default,'minutes');
  assert.equal(component.settings.duration.default,45);
  assert.equal(component.settings.duration.min,0);assert.equal(component.settings.duration.max,60);assert.equal(component.settings.duration.step,1);
  assert.deepEqual(plain(component.initState()),{
    unit:'minutes',duration:45,configuredUnit:'minutes',configuredDuration:45,remainingMs:2700000,
    endsAt:null,observedRun:false,tick:false,showIndicators:true
  });
  assert.equal(component.initStyle().fillColor,'#dc2626','the default dial retains its red wedge');
});

test('seconds mode counts down and emits a full 100 ms pulse at each unit boundary',()=>{
  const rt=runtime();
  assert.deepEqual(rt.step(1000,true),{tick:false,reached:false,nextWakeAt:2000});
  assert.equal(rt.state.endsAt,4000);
  assert.equal(rt.step(1999).tick,false);assert.equal(rt.state.remainingMs,2001);
  assert.deepEqual(rt.step(2000),{tick:true,reached:false,nextWakeAt:2100});
  assert.equal(rt.state.remainingMs,2000);
  assert.equal(rt.step(2099).tick,true);
  assert.deepEqual(rt.step(2100),{tick:false,reached:false,nextWakeAt:3000});
  assert.deepEqual(rt.step(3000),{tick:true,reached:false,nextWakeAt:3100});
  rt.step(3100);
  assert.deepEqual(rt.step(4000),{tick:true,reached:true,nextWakeAt:4100});
  assert.equal(rt.state.remainingMs,0);assert.equal(rt.state.endsAt,null);
  assert.deepEqual(rt.step(4100),{tick:false,reached:true,nextWakeAt:null},'the final high falls after the countdown has stopped');
  assert.deepEqual(rt.step(5000),{tick:false,reached:true,nextWakeAt:null},'held run=true never repeats a completed countdown');
});

test('minutes mode updates its visual snapshot each second but ticks only at whole minutes',()=>{
  const rt=runtime({unit:'minutes',duration:2});rt.step(1000,true);
  assert.equal(rt.state.endsAt,121000);
  assert.equal(rt.step(2000).tick,false);assert.equal(rt.state.remainingMs,119000);
  assert.equal(rt.step(60999).tick,false);assert.equal(rt.state.remainingMs,60001);
  assert.deepEqual(rt.step(61000),{tick:true,reached:false,nextWakeAt:61100});
  rt.step(61100);
  assert.equal(rt.step(120999).tick,false);
  assert.deepEqual(rt.step(121000),{tick:true,reached:true,nextWakeAt:121100});
  assert.deepEqual(rt.step(121100),{tick:false,reached:true,nextWakeAt:null});
});

test('pause/resume retains fractional-unit progress and a pause clears an active tick',()=>{
  const rt=runtime();rt.step(1000,true);
  assert.deepEqual(rt.step(1400,false),{tick:false,reached:false,nextWakeAt:null});
  assert.equal(rt.state.remainingMs,2600);assert.equal(rt.state.endsAt,null);
  rt.step(10000,true);assert.equal(rt.state.endsAt,12600);
  assert.equal(rt.step(10599).tick,false);
  assert.deepEqual(rt.step(10600),{tick:true,reached:false,nextWakeAt:10700},'600 ms completes the partially elapsed first unit');
  assert.deepEqual(rt.step(10650,false),{tick:false,reached:false,nextWakeAt:null});
  assert.equal(rt.state.remainingMs,1950);
  assert.deepEqual(rt.step(20000,false),{tick:false,reached:false,nextWakeAt:null});
});

test('manual Start/Pause wins until run changes, and Start at zero restarts once',()=>{
  const rt=runtime({duration:1});rt.step(1000,false);rt.manual(1100,'toggle');rt.step(1100,false);
  assert.equal(rt.state.endsAt,2100);
  rt.step(1200,true);assert.equal(rt.state.endsAt,2100,'Start while already running keeps its deadline');
  rt.manual(1400,'toggle');rt.step(1400,true);
  assert.equal(rt.state.endsAt,null);assert.equal(rt.state.remainingMs,700);
  rt.step(2000,true);assert.equal(rt.state.endsAt,null,'a held high input does not undo manual Pause');
  rt.step(2100,false);rt.step(2200,true);assert.equal(rt.state.endsAt,2900);
  rt.step(2900);rt.step(3000);assert.equal(rt.output.reached,true);
  rt.manual(4000,'toggle');rt.step(4000,true);
  assert.equal(rt.state.remainingMs,1000);assert.equal(rt.state.endsAt,5000);assert.equal(rt.output.reached,false);
  rt.step(5000);rt.step(5100);rt.step(10000,true);assert.equal(rt.state.endsAt,null);
});

test('held reset refills and stops, consumes run changes, and blocks manual Start',()=>{
  const rt=runtime();rt.step(1000,true);rt.step(2000);
  assert.deepEqual(rt.step(2050,true,true),{tick:false,reached:false,nextWakeAt:null});
  assert.equal(rt.state.remainingMs,3000);assert.equal(rt.state.endsAt,null);
  rt.manual(2100,'toggle');assert.equal(rt.state.endsAt,null);
  rt.step(2200,false,true);rt.step(2300,true,true);
  assert.equal(rt.state.observedRun,true);
  assert.deepEqual(rt.step(2400,true,false),{tick:false,reached:false,nextWakeAt:null},'reset release alone never starts');
  rt.step(2500,false);rt.step(2600,true);assert.equal(rt.state.endsAt,5600);
  rt.manual(2700,'reset');rt.step(2700,true);
  assert.equal(rt.state.remainingMs,3000);assert.equal(rt.state.endsAt,null);assert.equal(rt.state.observedRun,true);
});

test('changing duration or unit previews a full stopped timer and consumes the held run level',()=>{
  const rt=runtime();rt.step(1000,true);rt.step(2000);
  rt.edit({duration:5});const before=rt.state;
  assert.deepEqual(rt.output,{tick:false,reached:false});assert.deepEqual(rt.state,before,'pure configuration normalization does not mutate saved state');
  rt.clearMemory();assert.deepEqual(rt.step(2100,true),{tick:false,reached:false,nextWakeAt:null});
  assert.equal(rt.state.remainingMs,5000);assert.equal(rt.state.endsAt,null);assert.equal(rt.state.configuredDuration,5);
  rt.step(2200,false);rt.step(2300,true);assert.equal(rt.state.endsAt,7300);
  rt.edit({unit:'minutes'});rt.step(2400,true);
  assert.equal(rt.state.remainingMs,300000);assert.equal(rt.state.configuredUnit,'minutes');assert.equal(rt.state.endsAt,null);
  rt.edit({duration:0});assert.deepEqual(rt.output,{tick:false,reached:true});
  rt.step(2500,true);assert.equal(rt.state.remainingMs,0);assert.equal(rt.state.endsAt,null);
});

test('compute and drawing remain frozen until transition samples wall time',()=>{
  const rt=runtime();rt.step(1000,true);rt.step(1500);
  const state=rt.state,output=rt.output,children=rt.children();
  rt.setWall(999999);rt.blockWallReads(true);
  assert.deepEqual(rt.output,output);assert.deepEqual(rt.children(),children);assert.deepEqual(rt.state,state);
  rt.blockWallReads(false);rt.step(999999);
  assert.deepEqual(rt.output,{tick:false,reached:true});assert.equal(rt.state.remainingMs,0);
});

test('running reloads keep wall deadlines while fresh memory suppresses old or missed tick pulses',()=>{
  const original=runtime();original.step(1000,true);original.step(2000);
  assert.equal(original.state.tick,true);
  const saved=original.state,reloaded=runtime({initial:saved});
  assert.equal(reloaded.step(2500,true).tick,false);assert.equal(reloaded.state.endsAt,4000);assert.equal(reloaded.state.remainingMs,1500);
  const expired=runtime({initial:saved});
  assert.deepEqual(expired.step(10000,true),{tick:false,reached:true,nextWakeAt:null});
  assert.equal(expired.state.endsAt,null);assert.equal(expired.state.remainingMs,0);
  assert.deepEqual(expired.step(11000,true),{tick:false,reached:true,nextWakeAt:null});

  const manual=runtime();manual.step(1000,false);manual.manual(1200,'toggle');manual.step(1200,false);
  const manualReload=runtime({initial:manual.state});manualReload.step(2000,false);
  assert.equal(manualReload.state.endsAt,4200,'a held low input does not undo saved manual Start');
  manualReload.step(2100,true);manualReload.manual(2200,'toggle');manualReload.step(2200,true);
  const paused=runtime({initial:manualReload.state});
  paused.step(3000,true);assert.equal(paused.state.endsAt,null,'a held high input does not undo a saved paused override');
});

test('late wakes skip multiple unit crossings and lower an overdue high before another tick',()=>{
  const rt=runtime({duration:10});rt.step(1000,true);
  assert.equal(rt.step(4500).tick,false,'three missed unit boundaries are not replayed');
  assert.equal(rt.state.remainingMs,6500);
  assert.deepEqual(rt.step(5000),{tick:true,reached:false,nextWakeAt:5100});
  assert.equal(rt.step(7500).tick,false,'an overdue high falls before further ticks');
  assert.equal(rt.step(7501).tick,false,'a skipped tick is not replayed on an immediate reevaluation');
  assert.deepEqual(rt.step(8000),{tick:true,reached:false,nextWakeAt:8100});
  rt.step(8100);
  assert.deepEqual(rt.step(15000),{tick:false,reached:true,nextWakeAt:null},'late completion reaches zero without replaying missed unit ticks');
});

test('wall/document-time discontinuity resumes the current remaining time without a catch-up tick',()=>{
  const rt=runtime({duration:10});rt.step(1000,true,false,0);
  assert.equal(rt.step(2000,true,false,1000).tick,true);
  assert.equal(rt.step(5000,true,false,1100).tick,false,'time elapsed while the document clock was inactive');
  assert.equal(rt.state.remainingMs,6000);
  assert.equal(rt.step(6000,true,false,2100).tick,true,'ordinary ticks resume from the new baseline');
  assert.equal(rt.step(6100,true,false,2200).tick,false);
  assert.deepEqual(rt.step(12000,true,false,2300),{tick:false,reached:true,nextWakeAt:null});
});

test('zero duration is already reached and a 60-unit duration remains a full valid timer',()=>{
  for(const unit of ['seconds','minutes']){
    const zero=runtime({unit,duration:0});
    assert.deepEqual(zero.output,{tick:false,reached:true});
    assert.deepEqual(zero.step(1000,true),{tick:false,reached:true,nextWakeAt:null});
    zero.manual(1100,'toggle');zero.step(1100,true);
    assert.equal(zero.state.endsAt,null);assert.deepEqual(zero.output,{tick:false,reached:true});
    const full=runtime({unit,duration:60});full.step(1000,true);
    assert.equal(full.state.remainingMs,60*units[unit]);assert.equal(full.state.endsAt,1000+60*units[unit]);
    assert.deepEqual(full.output,{tick:false,reached:false});
  }
});

test('a late tick keeps its 100 ms width across completion without inventing a second rise',()=>{
  const rt=runtime({duration:2});rt.step(1000,true);
  assert.deepEqual(rt.step(2990),{tick:true,reached:false,nextWakeAt:3000});
  assert.deepEqual(rt.step(3000),{tick:true,reached:true,nextWakeAt:3090});
  assert.equal(rt.step(3089).tick,true);
  assert.deepEqual(rt.step(3090),{tick:false,reached:true,nextWakeAt:null});
});

test('a backward wall clock never increases remaining time or emits a phantom tick',()=>{
  const rt=runtime({duration:5});rt.step(1000,true);rt.step(2000);rt.step(2100);
  const remaining=rt.state.remainingMs;
  assert.equal(rt.step(1500,true,false,2200).tick,false);
  assert.equal(rt.state.remainingMs,remaining,'backward adjustment is capped at the saved snapshot');
  assert.equal(rt.step(1600,true,false,2300).tick,false);assert.equal(rt.state.remainingMs,remaining);
});

test('dragging the public dial hand sets 0–59 units, refills, stops, and consumes the run level',()=>{
  const rt=runtime({duration:45});rt.step(1000,true);rt.step(2000);
  const face=rt.children().find(child=>child.type==='ellipse' && child.strokeOn);
  const cx=face.x+face.w/2,cy=face.y+face.h/2;
  const io=()=>({inputs:rt.inputs,outputs:rt.output,name:'Tea timer'});
  const hand=rt.component.handles(rt.state,rt.style.w,rt.style.h,rt.style,io()).find(handle=>handle.id==='hand');
  assert.ok(hand);assert.equal(rt.component.hitEdit(rt.state,hand.x,hand.y,rt.style.w,rt.style.h,rt.style,io()),'hand');
  for(const [x,y,duration] of [[cx,cy-20,0],[cx-20,cy,15],[cx,cy+20,30],[cx+20,cy,45]]){
    rt.manual(2100,'hand',x,y);
    assert.equal(rt.state.duration,duration);assert.equal(rt.state.configuredDuration,duration);
    assert.equal(rt.state.remainingMs,duration*1000);assert.equal(rt.state.endsAt,null);
    assert.deepEqual(rt.output,{tick:false,reached:duration===0});
    rt.step(2100,true);assert.equal(rt.state.endsAt,null,'held run does not undo the duration edit');
  }
});

test('reader controls remain available; held reset blocks Start and dial dragging',()=>{
  const rt=runtime();rt.step(1000,false);
  const {component,style}=rt,{w,h}=style,io=()=>({inputs:rt.inputs,outputs:rt.output,name:'Tea timer'});
  const handles=plain(component.handles(rt.state,w,h,style,io()));
  assert.deepEqual(handles.map(handle=>handle.id),['hand','toggle','reset','indicators']);
  assert.ok(handles.filter(handle=>handle.id!=='indicators').every(handle=>handle.editorOnly!==true));
  assert.equal(handles.find(handle=>handle.id==='indicators').editorOnly,true);
  for(const handle of handles)assert.equal(component.hitEdit(rt.state,handle.x,handle.y,w,h,style,io()),handle.id);
  rt.step(1100,true,true);
  assert.deepEqual(plain(component.handles(rt.state,w,h,style,io())).map(handle=>handle.id),['reset','indicators']);
  const before=rt.state;rt.manual(1200,'hand',0,0);assert.deepEqual(rt.state,before);
  rt.manual(1200,'toggle');assert.deepEqual(rt.state,before);
  rt.manual(1200,'indicators');assert.equal(rt.state.showIndicators,false);
  assert.equal(rt.state.remainingMs,before.remainingMs);assert.equal(rt.state.endsAt,null);
});

test('invalid settings, Boolean inputs, saved state, clocks, and transient memory fail explicitly',()=>{
  const rt=runtime(),component=rt.component,state=rt.state,inputs=rt.inputs;
  for(const name of ['run','reset'])for(const value of [undefined,null,0,1,'false',{}]){
    assert.throws(()=>component.compute({...inputs,[name]:value},state),/must be Boolean/);
    assert.throws(()=>component.transition({...inputs,[name]:value},state,null,{now:0}),/must be Boolean/);
  }
  for(const unit of ['hours','second','',null,0])assert.throws(()=>component.compute(inputs,{...state,unit}),/Timer unit/);
  for(const duration of [-1,61,0.5,Infinity,NaN,'3'])assert.throws(()=>component.compute(inputs,{...state,duration}),/Timer duration/);
  const invalid=[
    ...[-1,0.5,3001,Infinity,NaN,'0'].map(remainingMs=>({...state,remainingMs})),
    ...[undefined,0.5,Infinity,NaN,'1000'].map(endsAt=>({...state,endsAt})),
    ...['observedRun','tick','showIndicators'].flatMap(key=>[undefined,0,'false',null].map(value=>({...state,[key]:value})))
  ];
  for(const badState of invalid)assert.throws(()=>component.compute(inputs,badState),/Invalid Timer state/);
  for(const wall of [NaN,Infinity,-Infinity,0.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>runtime().step(wall,true,false,0),/wall.clock time/);
  for(const now of [NaN,Infinity,-1,'0'])assert.throws(()=>runtime().step(1000,true,false,now),/monotonic time/);

  rt.step(1000,true);const memory=rt.memory;
  const malformed=[[],true,1,'memory',{...memory,wall:NaN},{...memory,now:-1},{...memory,endsAt:Infinity},
    {...memory,remainingMs:-1},{...memory,remainingMs:3600001},{...memory,unit:'hours'},{...memory,duration:61},
    {...memory,until:undefined},{...memory,until:Infinity},{...memory,until:memory.now}];
  for(const badMemory of malformed)assert.throws(()=>component.transition(rt.inputs,rt.state,badMemory,{now:1000}),/Invalid Timer scheduling memory/);
});

test('red dial snapshots retain reversed numbering, finite geometry, names, and an explicit unavailable state',()=>{
  const rt=runtime({duration:60});rt.step(1000,false);
  const normal=rt.children(false,'  Tea   timer  ');
  assert.ok(normal.some(child=>child.text==='Tea timer'));
  assert.ok(normal.some(child=>child.text==='60 Seconds left'));
  const wedge=normal.find(child=>child.type==='polygon' && child.fill);
  assert.ok(wedge);assert.equal(wedge.fillColor,'#dc2626');
  const arc=wedge.points.find(point=>point.arcTo).arcTo;
  assert.ok(arc.a2-arc.a1>Math.PI*1.99 && arc.a2-arc.a1<Math.PI*2,'a full-looking sweep avoids a degenerate full-circle arc');
  assert.deepEqual(normal.filter(child=>child.type==='text' && /^\d+$/.test(child.text)).map(child=>child.text),['0','55','50','45','40','35','30','25','20','15','10','5']);
  assert.equal(normal.filter(child=>child.type==='line').length,61,'60 dial marks and one hand remain visible');

  function finite(value){
    if(typeof value==='number')assert.ok(Number.isFinite(value),'rendered geometry is finite');
    else if(value && typeof value==='object')Object.values(value).forEach(finite);
  }
  for(const [w,h] of [[234,350],[80,120],[468,350]]){
    const io={inputs:rt.inputs,outputs:rt.output,name:'Tea timer'};
    finite(rt.component.children(rt.state,rt.style,w,h,true,io));
    const unavailable=plain(rt.component.unavailableChildren(rt.state,rt.style,w,h,true,{...io,error:'Missing input'}));
    finite(unavailable);
    assert.ok(unavailable.some(child=>child.text==='Timer unavailable'));
    assert.ok(!unavailable.some(child=>child.type==='polygon' && child.fill),'unavailable state never looks like an active remaining-time wedge');
    assert.equal(unavailable.filter(child=>child.type==='line').length,60,'unavailable state removes the hand');
    assert.ok(!unavailable.some(child=>['Start','Pause','Reset','Restart'].includes(child.text)));
  }
  const zero=runtime({duration:0});
  assert.ok(!zero.children().some(child=>child.type==='polygon' && child.fill));
});
