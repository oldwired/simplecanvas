const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const plain=value=>JSON.parse(JSON.stringify(value));
const source=(name,globals={})=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'),globals);
const events=result=>plain(result.events||[]);
const defaults=(def,state)=>Object.fromEntries(Object.entries(typeof def.inputs==='function'?def.inputs(state):def.inputs).map(([key,port])=>[key,port.default]));
function simulation(name,{state={},inputs={},globals={}}={}){
  const def=source(name,globals);let current={...def.initState(),...state},memory=null,values={...defaults(def,current),...inputs};
  return {
    def,
    step(at=0,patch={},context={}){
      values={...values,...patch};const before=JSON.stringify({current,memory,values});
      const result=def.transition(values,current,memory,{now:at,...context});
      assert.equal(JSON.stringify({current,memory,values}),before,name+' leaves transition arguments unchanged');
      current=result.state;memory=result.memory;return plain(result);
    },
    receive(payload,name='receive',context={}){
      const before=JSON.stringify(current),result=def.onEvent(name,payload,current,{inputs:values,...context});
      assert.equal(JSON.stringify(current),before,'event handler leaves its arguments unchanged');
      current=result.state;return plain(result);
    },
    edit(patch){current={...current,...patch};},
    restore(){memory=null;current=plain(current);},
    get state(){return plain(current);},
    get memory(){return plain(memory);},
    get output(){return plain(def.compute(values,current));}
  };
}

test('Dropdown and scalar selectors expose deliberate hybrid selection and Reprocess metadata',()=>{
  const dropdown=source('dropdown');
  assert.equal(dropdown.eventApi,1);assert.equal(dropdown.tablePresentation,'full');
  assert.deepEqual(plain(dropdown.eventTransform),{input:'select',outputs:['index','key','text','valid'],reprocess:'reprocess'});
  for(const source of ['list','dataset']){
    const inputs=dropdown.inputs({...dropdown.initState(),source});
    assert.equal(inputs.select.event,true);assert.equal(inputs.reprocess.event,'command');
    if(source==='dataset'){
      assert.equal(inputs.data.event,undefined,'table refresh is value-only');
      assert.equal(inputs.textColumn.event,undefined);assert.equal(inputs.keyColumn.event,undefined);
    }
  }
  for(const port of Object.values(dropdown.outputs))assert.equal(port.event,true);
  assert.equal(dropdown.onEvent,undefined,'selection events use the same pure computation as current values');
  for(const [name,output,type] of [['text-selector','text','string'],['selector-number','value','number'],['selector-boolean','value','boolean']]){
    const def=source(name);
    assert.equal(def.eventApi,1,name);
    assert.deepEqual(plain(def.eventTransform),{
      inputs:['a','b','select'],outputs:[output],reprocess:'reprocess',selection:{input:'select',choices:['a','b']}
    },name);
    for(const key of ['a','b','select'])assert.equal(def.inputs[key].event,true,name+'.'+key);
    assert.equal(def.inputs.reprocess.event,'command');assert.equal(def.outputs[output].type,type);assert.equal(def.outputs[output].event,true);
    assert.equal(def.transition,undefined,'pure selectors do not advance stored state');
  }
});

test('Dropdown computes complete datasets, preserves zero-based invalid selections, and never emits from compute',()=>{
  const def=source('dropdown'),state={...def.initState(),source:'dataset'};
  const table={columns:[{key:'label',type:'string'},{key:'key',type:'string'}],
    rows:Array.from({length:1000},(_,i)=>['Row '+i,'id-'+i]),rowCount:1000};
  const inputs={data:{datasetId:'choices'},textColumn:'label',keyColumn:'key',select:999,reprocess:false};
  const snapshot=JSON.stringify({state,table,inputs});
  assert.deepEqual(plain(def.compute(inputs,state,{tables:{data:table}})),{index:999,key:'id-999',text:'Row 999',valid:true});
  assert.deepEqual(plain(def.compute({...inputs,select:1000},state,{tables:{data:table}})),{index:-1,key:'',text:'',valid:false});
  assert.equal(JSON.stringify({state,table,inputs}),snapshot);
  assert.equal(def.compute(inputs,state,{tables:{data:table}}).events,undefined);
});

test('Signal → event captures every rising edge, including equal, empty, false, and fractional values',()=>{
  for(const [type,value,next] of [['string','','next'],['number',2.8,-3.5],['boolean',false,true]]){
    const rt=simulation('signal-to-event',{state:{type},inputs:{value,trigger:true}});
    assert.equal(rt.def.inputs(rt.state).value.event,undefined,'value connection itself does not emit');
    assert.equal(rt.def.outputs(rt.state).value.event,true);
    assert.deepEqual(events(rt.step()),[],'an initial high is only primed');
    assert.deepEqual(events(rt.step(1,{value:next})),[],'changing a held-high value is not an occurrence');
    rt.step(2,{trigger:false});
    assert.deepEqual(events(rt.step(3,{value,trigger:true})),[{port:'value',payload:value}]);
    assert.deepEqual(events(rt.step(4)),[]);
    rt.step(5,{trigger:false});
    assert.deepEqual(events(rt.step(6,{trigger:true})),[{port:'value',payload:value}],'identical captures remain separate occurrences');
    assert.deepEqual(rt.output,{value});
    rt.restore();assert.deepEqual(events(rt.step(7)),[],'reload does not replay a high trigger');
    assert.equal(rt.state.type,type);
  }
});

test('Signal → event type changes prime the edge and malformed scalar inputs fail atomically',()=>{
  const rt=simulation('signal-to-event',{inputs:{value:'x'}});
  rt.step();rt.edit({type:'number'});
  assert.deepEqual(events(rt.step(1,{trigger:true,value:2})),[],'changing type cannot fabricate a captured occurrence');
  rt.step(2,{trigger:false});assert.deepEqual(events(rt.step(3,{trigger:true})),[{port:'value',payload:2}]);
  const def=rt.def;
  for(const [type,value] of [['string','x'.repeat(2001)],['string',2],['number',NaN],['number',Infinity],['boolean',0]]){
    assert.throws(()=>def.compute({value,trigger:false},{...def.initState(),type}),/Value must be/);
  }
  assert.throws(()=>def.compute({value:'x',trigger:1},def.initState()),/Trigger must be Boolean/);
});

test('Event → pulse preserves every occurrence in a burst and supplies observable low gaps',()=>{
  const rt=simulation('event-to-pulse');
  assert.deepEqual(plain(rt.def.eventInputs.receive.types),['none','boolean','number','string']);
  rt.step(0);
  for(const payload of [null,false,'',2.8,'same','same'])rt.receive(payload);
  assert.equal(rt.state.queued,6);assert.equal(rt.output.value,false,'delivery queues before time advances');
  let at=0,highs=0;
  for(let i=0;i<6;i++){
    const high=rt.step(at);assert.equal(high.state.value,true);assert.equal(high.nextWakeAt,at+100);highs++;
    assert.equal(rt.step(at+99).state.value,true,'high retains its full width');
    const low=rt.step(at+100);assert.equal(low.state.value,false);assert.equal(low.nextWakeAt,at+110);
    assert.equal(rt.step(at+109).state.value,false,'consecutive events stay separated');
    at+=110;
  }
  assert.equal(highs,6);assert.equal(rt.state.queued,0);
  const done=rt.step(at);assert.equal(done.state.value,false);assert.equal(done.nextWakeAt,null);
  assert.equal(rt.state.press,6);
});

test('Event → pulse rejects the 65th pending event before accepting it, and recovers after draining',()=>{
  const rt=simulation('event-to-pulse');rt.step();
  for(let i=0;i<64;i++)rt.receive('same');
  const before=rt.state;
  assert.throws(()=>rt.receive('same'),/queue is full/);assert.deepEqual(rt.state,before,'rejection leaves accepted queue intact');
  rt.step(0);assert.equal(rt.state.queued,63);
  rt.receive(null);assert.equal(rt.state.queued,64,'one pulse in progress leaves one queue slot available');
  const next=rt.step(1);assert.equal(next.state.value,true);assert.equal(next.memory.pending,64);
  assert.throws(()=>rt.receive(false),/queue is full/);
});

test('Event → pulse restore clears transient work and historical time never races through pulse phases',()=>{
  const rt=simulation('event-to-pulse');rt.step();rt.receive(true);rt.receive(true);
  rt.step(0);assert.equal(rt.state.value,true);assert.equal(rt.state.queued,1);
  const historical=rt.step(1000,{}, {historical:true});
  assert.equal(historical.state.value,true,'historical replay does not consume an old deadline');
  const next=rt.step(1000);assert.equal(next.state.value,false);assert.equal(next.nextWakeAt,1010,'late evaluation still exposes a low interval');
  rt.restore();
  const restored=rt.step(2000);assert.equal(restored.state.value,false);assert.equal(restored.state.queued,0);assert.equal(restored.nextWakeAt,null);
  assert.equal(restored.memory.press,2,'saved token is the new baseline');
  rt.receive('new');assert.equal(rt.step(2001).state.value,true,'new occurrences work after restoring');
  assert.throws(()=>rt.receive({}),/Unsupported event payload/);
});

test('Event → pulse retains events accepted before its first transition only in the accepting runtime',()=>{
  const rt=simulation('event-to-pulse'),runtimeId='fresh-runtime';
  rt.receive('first','receive',{runtimeId});rt.receive('second','receive',{runtimeId});
  const first=rt.step(0,{}, {runtimeId});
  assert.equal(first.state.value,false,'initial low gives fresh downstream counters a baseline');
  assert.equal(first.state.queued,2);assert.equal(first.nextWakeAt,10);
  assert.equal(rt.step(10,{}, {runtimeId}).state.value,true);
  assert.equal(rt.state.queued,1);
  rt.step(110,{}, {runtimeId});assert.equal(rt.step(120,{}, {runtimeId}).state.value,true);
  rt.receive('pending','receive',{runtimeId});rt.restore();
  const restored=rt.step(200,{}, {runtimeId:'reloaded-runtime'});
  assert.equal(restored.state.value,false);assert.equal(restored.state.queued,0);assert.equal(restored.nextWakeAt,null);

  const copied=simulation('event-to-pulse',{state:{queued:64,press:64,eventRuntime:'old-runtime'}});
  copied.receive(false,'receive',{runtimeId:'new-runtime'});
  assert.equal(copied.state.queued,1,'a new accepted occurrence first discards a copied old queue');
  const primed=copied.step(0,{}, {runtimeId:'new-runtime'});
  assert.equal(primed.state.queued,1);assert.equal(primed.nextWakeAt,10);
  assert.equal(copied.step(10,{}, {runtimeId:'new-runtime'}).state.value,true);
});

test('Counter completion emits once per actual upward crossing and never for reset or threshold edits',()=>{
  const rt=simulation('counter',{inputs:{value:false,threshold:2}});
  assert.equal(rt.def.outputs.reached.event,true);
  assert.deepEqual(events(rt.step()),[]);
  assert.deepEqual(events(rt.step(1,{value:true})),[]);
  rt.step(2,{value:false});
  assert.deepEqual(events(rt.step(3,{value:true})),[{port:'reached',payload:true}]);
  assert.equal(rt.output.count,2);assert.equal(rt.output.reached,true);
  assert.deepEqual(events(rt.step(4)),[]);rt.step(5,{value:false});
  assert.deepEqual(events(rt.step(6,{value:true})),[],'further counts above the threshold are not repeated completions');
  assert.deepEqual(events(rt.step(7,{reset:true})),[]);assert.equal(rt.output.count,0);
  rt.step(8,{value:false,reset:false});
  assert.deepEqual(events(rt.step(9,{threshold:1,value:true})),[],'coincident threshold edit does not create a completion');
  rt.step(10,{reset:true});rt.step(11,{reset:false,value:false});
  assert.deepEqual(events(rt.step(12,{value:true})),[{port:'reached',payload:true}],'a new genuine counting cycle completes again');
  rt.restore();assert.deepEqual(events(rt.step(13)),[]);
});

test('Downcounter completes only when counting reaches zero, including after reset',()=>{
  const rt=simulation('counter',{inputs:{direction:'down',start:2,value:true}});
  assert.deepEqual(events(rt.step()),[]);assert.equal(rt.output.count,2);
  rt.step(1,{value:false});assert.deepEqual(events(rt.step(2,{value:true})),[]);
  rt.step(3,{value:false});assert.deepEqual(events(rt.step(4,{value:true})),[{port:'reached',payload:true}]);
  rt.step(5,{value:false});assert.deepEqual(events(rt.step(6,{value:true})),[],'zero clamp is not a new completion');
  rt.step(7,{reset:true});rt.step(8,{reset:false,value:false});rt.step(9,{value:true});rt.step(10,{value:false});
  assert.deepEqual(events(rt.step(11,{value:true})),[{port:'reached',payload:true}]);
  assert.deepEqual(events(rt.step(12,{start:0})),[],'configuration-to-zero changes only the signal');
});

function timer(){
  let wall=1000;
  class Clock extends Date{static now(){return wall;}}
  const rt=simulation('timer',{state:{unit:'seconds',duration:1,configuredUnit:'seconds',configuredDuration:1,remainingMs:1000},globals:{Date:Clock}});
  return {rt,step(at,inputs={},context={}){wall=at;return rt.step(at,inputs,context);}};
}
test('Timer emits completion at its observed deadline once and keeps its existing reached/tick signals',()=>{
  const {rt,step}=timer();assert.equal(rt.def.outputs.reached.event,true);
  assert.deepEqual(events(step(1000,{run:true})),[]);
  assert.deepEqual(events(step(1999)),[]);
  assert.deepEqual(events(step(2000)),[{port:'reached',payload:true}]);
  assert.equal(rt.output.reached,true);assert.equal(rt.output.tick,true);
  assert.deepEqual(events(step(2100)),[]);assert.equal(rt.output.tick,false);
  assert.deepEqual(events(step(5000)),[]);
  assert.deepEqual(events(step(6000,{reset:true})),[]);assert.equal(rt.output.reached,false);
  step(6100,{run:false,reset:false});step(6200,{run:true});
  assert.deepEqual(events(step(7200)),[{port:'reached',payload:true}]);
});

test('Timer restore, inactivity, reset/configuration, and historical replay never replay completion',()=>{
  {
    const {rt,step}=timer();step(1000,{run:true});rt.restore();
    assert.deepEqual(events(step(2000)),[]);assert.equal(rt.output.reached,true);
  }
  {
    const {rt,step}=timer();step(1000,{run:true});
    assert.deepEqual(events(step(5000,{}, {now:1100})),[],'inactivity pauses monotonic time and does not replay completion');
    assert.equal(rt.output.reached,true);
  }
  {
    const {rt,step}=timer();step(1000,{run:true});
    assert.deepEqual(events(step(5000)),[{port:'reached',payload:true}],'a delayed active observation still completes exactly once');
    assert.deepEqual(events(step(5001)),[]);
  }
  {
    const {rt,step}=timer();step(1000,{run:true});rt.edit({duration:0});
    assert.deepEqual(events(step(2000)),[]);assert.equal(rt.output.reached,true);
  }
  {
    const {rt,step}=timer();step(1000,{run:true});
    assert.deepEqual(events(step(2000,{reset:true})),[]);assert.equal(rt.output.reached,false);
  }
  {
    const {rt,step}=timer();step(1000,{run:true});
    assert.deepEqual(events(step(2000,{}, {historical:true})),[]);assert.equal(rt.output.reached,false);
    assert.deepEqual(events(step(2000)),[{port:'reached',payload:true}],'the current observation still observes a due completion once');
  }
});

for(const [name,type,values] of [
  ['stepped-selector-number','number',[11,22,33,44]],
  ['stepped-selector-boolean','boolean',[false,true,false,true]]
]){
  test(name+' forwards only the selected channel and samples on a real step or Reprocess',()=>{
    const inputs=Object.fromEntries(values.map((value,index)=>['in'+index,value]));
    const rt=simulation(name,{inputs:{...inputs,pulse:false,reset:false,reprocess:false}});
    assert.equal(rt.def.inputs({...rt.state,channels:16}).in15.event,true,'all existing channels remain available');
    assert.equal(rt.def.outputs(rt.state).value.event,true);assert.equal(rt.def.outputs(rt.state).value.type,type);
    assert.deepEqual(events(rt.step()),[]);
    assert.deepEqual(events(rt.receive(values[1],'in1')),[],'an unselected channel event is ignored');
    assert.deepEqual(events(rt.receive(values[0],'in0')),[{port:'value',payload:values[0]}]);
    assert.deepEqual(events(rt.step(1,{pulse:true})),[{port:'value',payload:values[1]}]);
    assert.equal(rt.state.position,1);
    assert.deepEqual(events(rt.step(2)),[],'a held pulse does not duplicate the occurrence');
    assert.deepEqual(events(rt.receive(null,'reprocess')),[{port:'value',payload:values[1]}]);
    assert.deepEqual(events(rt.receive(false,'reprocess')),[]);
    assert.deepEqual(events(rt.step(3,{reprocess:true})),[{port:'value',payload:values[1]}]);
    rt.step(4,{reprocess:false});
    assert.deepEqual(events(rt.step(5,{reprocess:true},{eventInputs:['reprocess']})),[],'event-bound Reprocess does not also sample its signal');
    assert.deepEqual(events(rt.step(6,{reset:true})),[]);assert.equal(rt.state.position,0);
    rt.restore();assert.deepEqual(events(rt.step(7,{reset:false})),[],'restored high levels only prime');
    rt.edit({channels:2});assert.deepEqual(events(rt.step(8)),[],'channel count change only primes');
  });
}

test('adapter drawing uses instance names and bounded plain-text values at normal and reduced sizes',()=>{
  for(const name of ['signal-to-event','event-to-pulse']){
    const def=source(name),state=def.initState(),style=def.initStyle();
    for(const scale of [1,.5,2]){
      const outputs=name==='signal-to-event'?{value:'<b>Live message</b>'}:{value:true};
      const children=def.children(state,style,style.w*scale,style.h*scale,false,{name:'My adapter',outputs});
      assert.ok(children.some(child=>child.type==='text' && child.text==='My adapter'));
      for(const child of children){
        for(const key of ['x','y','w','h'])if(key in child)assert.ok(Number.isFinite(child[key]) && child[key]>=0);
        if(child.type==='text')assert.equal(child.plainText,true);
      }
    }
  }
});
