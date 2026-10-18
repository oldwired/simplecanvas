const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const load=name=>new Function('return ('+fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8')+');')();
const controls=[['text-input',['one','two','two','three']],['number-input',[1,2,2,3]]];
function runtime(def,initial=def.initState(),runtimeId=''){
  let state=initial,memory={};
  return {
    get state(){return state;},get memory(){return memory;},
    configure(fields){state={...state,...fields};},
    submit(value){state=def.dragEdit(state,'entry',value,0,0,0,{}, {runtimeId}).state;return def.publish(state);},
    tick(now,historical=false,inputs={}){const result=def.transition(inputs,state,memory,{now,historical,runtimeId});state=result.state;memory=result.memory;return {...def.publish(state),nextWakeAt:result.nextWakeAt};}
  };
}

const armingDelay=file=>file==='text-input'?10:0;
function firstPulse(run,file,now=0){
  const first=run.tick(now);
  if(!armingDelay(file))return first;
  assert.equal(first.submitted,false);assert.equal(first.nextWakeAt,now+10);
  assert.equal(run.tick(now+9).submitted,false,'Text input arms for at least 10 ms');
  return run.tick(now+10);
}

test('input entry handles declare bounded typed metadata and literal named captions',()=>{
  for(const [file] of controls){
    const def=load(file),state=def.initState(),style=def.initStyle(),handle=def.handles(state,style.w,style.h)[0];
    assert.equal(def.apiVersion,2);assert.equal(def.wakePolicy,'latest');assert.deepEqual(def.inputs,file==='text-input'?{clear:{role:'control',type:'boolean',default:false}}:{});
    assert.equal(def.outputs.value.type,file==='text-input'?'string':'number');assert.equal(def.outputs.submitted.type,'boolean');
    assert.equal(handle.id,'entry');assert.equal(handle.kind,file==='text-input'?'text':'number');assert(!handle.editorOnly);
    assert.equal(def.hitEdit(state,handle.x,handle.y,style.w,style.h),'entry');
    const children=def.children(state,style,style.w,style.h,false,{name:'---\nLiteral title',inputs:{},outputs:def.publish(state)});
    assert(children.filter(child=>child.type==='text').every(child=>child.plainText===true));
    assert(children[0].text.includes('Literal title'));
    if(file==='text-input')assert.deepEqual({maxLength:handle.maxLength,required:handle.required,placeholder:handle.placeholder},{maxLength:2000,required:false,placeholder:''});
    else assert.deepEqual({min:handle.min,max:handle.max,step:handle.step},{min:0,max:100,step:1});
  }
});

test('text validation rejects invalid submissions before mutating the durable inbox',()=>{
  const def=load('text-input'),run=runtime(def);run.tick(0);run.configure({maxLength:8,required:true,placeholder:'Type here'});
  for(const value of ['', '   ', 'too much text', 'two\nlines', 12]){
    const before=JSON.stringify(run.state);assert.throws(()=>run.submit(value));assert.equal(JSON.stringify(run.state),before);
  }
  run.submit('  text  ');assert.equal(def.publish(run.state).value,'  text  ','accepted text is not trimmed');
  assert.throws(()=>def.handles({...run.state,placeholder:'x'.repeat(121)},320,160),/placeholder/);
  assert.throws(()=>def.handles({...run.state,maxLength:2001},320,160),/length/);
});

test('number input keeps real numbers and enforces bounds and its step grid',()=>{
  const def=load('number-input'),run=runtime(def);run.tick(0);
  for(const value of [-1,101,.5,Infinity,NaN,'12']){
    const before=JSON.stringify(run.state);assert.throws(()=>run.submit(value));assert.equal(JSON.stringify(run.state),before);
  }
  run.configure({min:-100,max:100,step:.001});
  run.submit(-12.5);run.submit(3.125);
  assert.equal(def.publish(run.state).value,3.125);assert.equal(typeof def.publish(run.state).value,'number');
  assert.throws(()=>run.submit(3.1255),/step/);
  for(const fields of [{min:2,max:1},{step:0},{step:-1},{min:-Number.MAX_VALUE,max:Number.MAX_VALUE}])assert.throws(()=>def.publish({...run.state,...fields}));
});

test('rapid distinct and identical submissions retain matching values on every rising edge',()=>{
  for(const [file,values] of controls){
    const def=load(file),run=runtime(def),rising=[],start=armingDelay(file);run.tick(0);
    run.submit(values[0]);let result=firstPulse(run,file);assert.equal(result.submitted,true);rising.push(result.value);
    for(let index=1;index<values.length;index++){
      run.submit(values[index]);result=run.tick(start+index);
      assert.equal(result.submitted,true);assert.equal(result.value,values[0],'new entries cannot replace the active pulse payload');
    }
    for(let index=1;index<values.length;index++){
      const low=run.tick(start+index*110-10);assert.equal(low.submitted,false);
      assert.equal(run.tick(start+index*110-1).submitted,false,'the low gap lasts at least 10 ms');
      result=run.tick(start+index*110);assert.equal(result.submitted,true);rising.push(result.value);
    }
    assert.deepEqual(rising,values);
    assert.equal(run.tick(start+430).submitted,false);assert.equal(run.tick(start+440).nextWakeAt,null);
    assert.equal(run.state.pending.length,0);assert.equal(run.state.values.length,1,'unreferenced payloads are discarded');
    assert(JSON.stringify(run.memory).length<4000);
  }
});

test('a primed paused component retains every accepted value until Step or Resume',()=>{
  for(const [file,values] of controls){
    const def=load(file),run=runtime(def);run.tick(0);
    for(const value of values)run.submit(value); // No transition while the document is paused.
    assert.equal(run.state.pending.length,4);assert.equal(def.publish(run.state).value,values[3]);assert.equal(def.publish(run.state).submitted,false);
    const rising=[],start=armingDelay(file);if(start)assert.equal(run.tick(0).submitted,false);
    for(let index=0;index<values.length;index++){
      if(index)assert.equal(run.tick(start+index*110-10).submitted,false);
      const output=run.tick(start+index*110);assert.equal(output.submitted,true);rising.push(output.value);
    }
    assert.deepEqual(rising,values);
  }
});

test('late and historical wakes keep distinct phases; restoring pending state never replays it',()=>{
  for(const [file,values] of controls){
    const def=load(file),run=runtime(def);run.tick(0);run.submit(values[0]);firstPulse(run,file);run.submit(values[1]);run.tick(armingDelay(file)+1);
    assert.equal(run.tick(1000,true).submitted,true,'historical replay does not expire a latest-policy pulse');
    assert.equal(run.tick(1000).submitted,false);assert.equal(run.memory.nextAt,1010);
    assert.equal(run.tick(1009).submitted,false);assert.equal(run.tick(1010).value,values[1]);
    run.submit(values[3]);
    const reopened=runtime(def,JSON.parse(JSON.stringify(run.state))),initial=reopened.tick(0);
    assert.equal(initial.value,values[3]);assert.equal(initial.submitted,false);assert.equal(initial.nextWakeAt,null);assert.deepEqual(reopened.state.pending,[]);
  }
});

test('encoded text limits and a full queue reject atomically while repeated payloads share storage',()=>{
  const def=load('text-input'),run=runtime(def);run.tick(0);const long='a'.repeat(2000);
  for(let index=0;index<64;index++)run.submit(long);
  assert.equal(run.state.pending.length,64);assert.deepEqual(run.state.values,[long]);assert(JSON.stringify(run.state).length<=4000);
  let before=JSON.stringify(run.state);assert.throws(()=>run.submit(long),/queue is full/);assert.equal(JSON.stringify(run.state),before);
  const other=runtime(def);other.tick(0);
  for(const value of ['"'.repeat(2000),'\\'.repeat(2000),'\u0000'.repeat(700)]){
    before=JSON.stringify(other.state);assert.throws(()=>other.submit(value),/too large/);assert.equal(JSON.stringify(other.state),before);
  }
  other.submit(long);firstPulse(other,'text-input');before=JSON.stringify(other.state);
  assert.throws(()=>other.submit('b'.repeat(2000)),/too large/);assert.equal(JSON.stringify(other.state),before,'active and queued distinct payloads share the bounded budget');
  other.tick(110);other.tick(120);other.submit('b'.repeat(2000));
  assert.equal(def.publish(other.state).value,'b'.repeat(2000),'an idle input can replace a long value without retaining the old payload');
});

test('accepted queued values are not revalidated against subsequently changed entry settings',()=>{
  const text=runtime(load('text-input'));text.tick(0);text.submit('accepted');text.configure({maxLength:1});assert.equal(text.tick(0).submitted,false);assert.equal(text.tick(10).value,'accepted');
  const number=runtime(load('number-input'));number.tick(0);number.submit(5);number.configure({min:10,max:20,step:2});assert.equal(number.tick(0).value,5);
  number.configure({press:Number.MAX_SAFE_INTEGER});number.submit(12);assert.equal(number.state.press,0);
});


test('a first submission while paused is owned by this runtime and survives its first Step',()=>{
  for(const [file,values] of controls){
    const def=load(file),run=runtime(def,def.initState(),'runtime-current');
    for(const value of values)run.submit(value); // The component has never had a transition.
    assert.equal(run.state.entryRuntime,'runtime-current');assert.equal(run.state.pending.length,4);
    const rising=[],start=armingDelay(file);if(start)assert.equal(run.tick(0).submitted,false);
    for(let index=0;index<values.length;index++){
      if(index)assert.equal(run.tick(start+index*110-10).submitted,false);
      const output=run.tick(start+index*110);assert.equal(output.submitted,true);rising.push(output.value);
    }
    assert.deepEqual(rising,values);
  }
});

test('new entries discard a restored inbox before queuing; restored actions never replay',()=>{
  for(const [file,values] of controls){
    const def=load(file),old=runtime(def,def.initState(),'runtime-old');old.tick(0);
    old.submit(values[0]);firstPulse(old,file);old.submit(values[1]);
    const stored=JSON.parse(JSON.stringify(old.state));
    const reopened=runtime(def,stored,'runtime-new');
    const before=JSON.stringify(stored);assert.throws(()=>reopened.submit(file==='text-input'?12:'12'));
    assert.equal(JSON.stringify(reopened.state),before,'a rejected entry cannot discard restored state');
    reopened.submit(values[3]);reopened.submit(values[3]);
    assert.equal(reopened.state.entryRuntime,'runtime-new');assert.equal(reopened.state.pending.length,2);
    assert.equal(reopened.state.submitted,false);assert.deepEqual(reopened.state.values,[values[3]]);
    const start=armingDelay(file);assert.equal(firstPulse(reopened,file).value,values[3]);assert.equal(reopened.tick(start+100).submitted,false);
    assert.equal(reopened.tick(start+110).value,values[3]);assert.equal(reopened.tick(start+210).submitted,false);
    assert.equal(reopened.tick(start+220).nextWakeAt,null);
    const untouched=runtime(def,stored,'runtime-other'),initial=untouched.tick(0);
    assert.equal(initial.value,values[1]);assert.equal(initial.submitted,false);assert.equal(initial.nextWakeAt,null);
    assert.deepEqual(untouched.state.pending,[]);assert.equal(untouched.state.entryRuntime,'runtime-other');
  }
});


test('Text input Clear cancels its active pulse and pending inbox without submitting',()=>{
  const def=load('text-input'),run=runtime(def,def.initState(),'clear-runtime');run.tick(0);
  run.configure({required:true});run.submit('active');assert.equal(firstPulse(run,'text-input').submitted,true);
  run.submit('queued');run.submit('queued');
  const cleared=run.tick(11,false,{clear:true});
  assert.deepEqual(cleared,{value:'',submitted:false,nextWakeAt:null});
  assert.deepEqual(run.state.values,['']);assert.deepEqual(run.state.pending,[]);assert.equal(run.memory.clear,true);
  assert.equal(run.state.entryRuntime,'clear-runtime');assert.equal(run.state.required,true);
  assert.throws(()=>run.submit(''),/Enter a value/,'Required still rejects a typed empty submission');
  assert.equal(run.tick(1000,false,{clear:true}).submitted,false,'cancelled pulses do not resume');
  run.submit('after clear');assert.equal(run.tick(1001,false,{clear:true}).value,'after clear','held Clear does not repeat');
  run.tick(1002,false,{clear:false});
  assert.deepEqual(run.tick(1003,false,{clear:true}),{value:'',submitted:false,nextWakeAt:null});
});

test('Text input initially high Clear only primes, including a first paused submission',()=>{
  const def=load('text-input'),saved={...def.initState(),values:['saved']};
  const restored=runtime(def,saved,'restored');
  assert.deepEqual(restored.tick(0,false,{clear:true}),{value:'saved',submitted:false,nextWakeAt:null});
  assert.equal(restored.memory.clear,true);
  restored.tick(1,false,{clear:false});assert.equal(restored.tick(2,false,{clear:true}).value,'');
  const fresh=runtime(def,def.initState(),'fresh');fresh.submit('first paused');
  assert.deepEqual(fresh.tick(0,false,{clear:true}),{value:'first paused',submitted:false,nextWakeAt:10});
  assert.deepEqual(fresh.tick(10,false,{clear:true}),{value:'first paused',submitted:true,nextWakeAt:110});
  assert.equal(fresh.memory.clear,true);
  assert.throws(()=>fresh.tick(11,false,{clear:1}),/Boolean/);
});

test('Text input Submitted can append its value to Memo and clear itself in the same round',()=>{
  const input=load('text-input'),memo=load('memo'),run=runtime(input,input.initState(),'feedback');
  let memoState=memo.initState(),memoMemory={};
  function round(now){
    // Both transitions observe one published snapshot before either state is committed.
    const snapshot=input.publish(run.state);
    const nextMemo=memo.transition({content:'',line:snapshot.value,set:false,append:snapshot.submitted,clear:false},memoState,memoMemory);
    const nextInput=run.tick(now,false,{clear:snapshot.submitted});
    memoState=nextMemo.state;memoMemory=nextMemo.memory;
    return nextInput;
  }
  round(0);
  for(const [index,value] of ['same','same','third'].entries()){
    const now=index*20;run.submit(value);assert.equal(round(now).submitted,false);
    assert.equal(round(now+10).submitted,true);
    assert.deepEqual(round(now+10),{value:'',submitted:false,nextWakeAt:null});
    round(now+10); // Observe the low signal before accepting another entry.
  }
  assert.deepEqual(memo.publish(memoState),{text:'same\nsame\nthird',lineCount:3});
  assert.equal(input.publish(run.state).value,'');assert.equal(run.state.pending.length,0);
});


test('Text input waits for a time boundary so a multi-round Clear can cancel the first pulse',()=>{
  const def=load('text-input'),run=runtime(def,def.initState(),'clear-chain');run.tick(0);
  run.submit('discard first');run.submit('discard second');
  for(let round=0;round<8;round++){
    const output=run.tick(0,false,{clear:false});
    assert.equal(output.submitted,false);assert.equal(output.nextWakeAt,10,'propagation rounds cannot start a pulse');
  }
  assert.equal(run.tick(9,false,{clear:false}).submitted,false);
  assert.equal(run.tick(10,true,{clear:false}).submitted,false,'historical rounds cannot expire the arming gap');
  assert.deepEqual(run.tick(10,false,{clear:true}),{value:'',submitted:false,nextWakeAt:null},'Clear takes priority even at the pulse deadline');
  assert.equal(run.tick(1000,false,{clear:true}).submitted,false);
  assert.deepEqual(run.state.pending,[]);
});

test('inline input geometry matches the drawn field and status hints are opt-in',()=>{
  for(const [file] of controls){
    const def=load(file),state=def.initState(),style=def.initStyle(),draw=next=>def.children(next,style,style.w,style.h,false,{name:'Entry',outputs:def.publish(next)});
    assert.equal(style.h,72);
    assert.equal(state.showSubmitted,false);assert.equal(state.showHints,false);
    const handle=def.handles(state,style.w,style.h,style)[0],rect=draw(state).find(child=>child.type==='rect');
    assert.deepEqual({...handle.inline,fontSize:undefined},{x:rect.x,y:rect.y,w:rect.w,h:rect.h,fontSize:undefined});
    assert.equal(handle.inline.y,24);assert.equal(handle.inline.h,48);assert.equal(handle.inline.fontSize,18);
    assert.equal(def.hitEdit(state,rect.x+1,rect.y+1,style.w,style.h),'entry');
    assert.equal(def.hitEdit(state,1,rect.y-1,style.w,style.h),null);
    assert.ok(!draw(state).some(child=>/Submitted:|Enter to submit/.test(child.text||'')));
    const detailed={...state,showHints:true,showSubmitted:true},small=def.handles(detailed,style.w,style.h,style)[0].inline;
    assert.ok(small.h<handle.inline.h);
    assert.ok(draw(detailed).some(child=>/Enter to submit.*Submitted: false/.test(child.text||'')));
    assert.equal(def.handles(state,style.w,style.h,{...style,fontSize:22})[0].inline.fontSize,22);
  }
});
