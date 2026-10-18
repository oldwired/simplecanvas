const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));
const source=name=>vm.runInNewContext(fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8'),{});
const names=['sr-latch','d-latch','d-flip-flop','register-boolean','register-number','ring-counter','johnson-counter','decade-counter'];
function rig(component,state=component.initState()){
  let memory=null;
  const defaults=Object.fromEntries(Object.entries(component.inputs).filter(([,port])=>'default'in port).map(([key,port])=>[key,port.default]));
  return {
    step(patch={}){const inputs={...defaults,...patch},before=JSON.stringify({state,memory,inputs});const result=component.transition(inputs,state,memory,{now:0});assert.equal(JSON.stringify({state,memory,inputs}),before,'transition never mutates its snapshot');state=result.state;memory=result.memory;assert.equal(result.nextWakeAt,null);return plain(component.publish(state));},
    edit(patch){state={...state,...patch};},
    restore(){memory=null;},
    get state(){return plain(state);},
    outputs(){const before=JSON.stringify(state),output=plain(component.publish(state));assert.equal(JSON.stringify(state),before,'publishing is pure');return output;}
  };
}

test('three-state gate truth tables resolve controlling values and never treat X as truthy',()=>{
  const vals=[false,true,'X'];
  const and=(a,b)=>a===false||b===false?false:a==='X'||b==='X'?'X':true;
  const or=(a,b)=>a===true||b===true?true:a==='X'||b==='X'?'X':false;
  const not=a=>a==='X'?'X':!a;
  const expected={and,nand:(a,b)=>not(and(a,b)),or,nor:(a,b)=>not(or(a,b)),xor:(a,b)=>a==='X'||b==='X'?'X':a!==b,xnor:(a,b)=>a==='X'||b==='X'?'X':a===b};
  for(const [key,fn]of Object.entries(expected)){
    const c=source(key+'-gate');assert.ok(Object.values(c.inputs).every(p=>p.unknown===true));assert.equal(c.outputs.value.unknown,true);
    for(const a of vals)for(const b of vals)assert.equal(c.compute({a,b}).value,fn(a,b),`${key}(${a},${b})`);
  }
  for(const value of vals){assert.equal(source('not-gate').compute({value}).value,not(value));assert.equal(source('buffer').compute({value}).value,value);}
  const tri=source('tri-state-buffer');assert.equal(tri.compute({value:'X',enable:false}).value,null);assert.equal(tri.compute({value:'X',enable:true}).value,'X');assert.equal(tri.compute({value:false,enable:'X'}).value,'X');
});

test('SR latch starts unknown, holds, sets, resets, and remains unknown after a conflict',()=>{
  const c=source('sr-latch'),r=rig(c);assert.deepEqual(r.outputs(),{q:'X',notQ:'X',value:'X'});
  assert.equal(r.step().q,'X');assert.equal(r.step({set:true}).q,true);assert.equal(r.step().q,true);
  assert.deepEqual(r.step({reset:true}),{q:false,notQ:true,value:false});assert.equal(r.step().q,false);
  assert.deepEqual(r.step({set:true,reset:true}),{q:'X',notQ:'X',value:'X'});assert.equal(r.step().q,'X');
  assert.equal(r.step({set:true}).q,true);r.restore();assert.equal(r.step().q,true,'restoring a stored bit preserves it');
  assert.throws(()=>r.step({set:'X'}),/Invalid set/);
});

test('D latch follows only while enabled and reset overrides data and enable',()=>{
  const c=source('d-latch'),r=rig(c);assert.equal(r.step({d:true}).q,'X');assert.equal(r.step({d:true,enable:true}).q,true);
  assert.equal(r.step({d:false}).q,true);assert.equal(r.step({d:false,enable:true}).q,false);
  assert.equal(r.step({d:'X',enable:true}).q,'X');assert.equal(r.step({d:true,enable:true,reset:true}).q,false);
});

test('D flip-flop samples only observed rising edges, reset wins, restoring high invents no edge',()=>{
  const c=source('d-flip-flop'),r=rig(c);assert.equal(r.step({d:true,clock:true}).q,'X');assert.equal(r.step({d:false,clock:true}).q,'X');
  r.step({d:true,clock:false});assert.equal(r.step({d:true,clock:true}).q,true);assert.equal(r.step({d:false,clock:true}).q,true);
  r.step({d:false,clock:false});assert.equal(r.step({d:true,clock:true,reset:true}).q,false);
  assert.equal(r.step({d:true,clock:true}).q,false,'releasing reset while high does not create an edge');
  r.step({d:'X',clock:false});assert.equal(r.step({d:'X',clock:true}).q,'X');
  r.edit({value:true});r.restore();assert.equal(r.step({d:false,clock:true}).q,true);
});

for(const kind of ['boolean','number'])test(kind+' registers sample a shared edge from the old outputs, with reset and enable priority',()=>{
  const c=source('register-'+kind),zero=kind==='boolean'?false:0,one=kind==='boolean'?true:17.25;
  const a=rig(c,{...c.initState(),value:zero}),b=rig(c,{...c.initState(),value:zero});
  a.step({value:one});b.step({value:zero});
  const old=a.outputs().value;a.step({value:one,pulse:true});b.step({value:old,pulse:true});
  assert.equal(a.outputs().value,one);assert.equal(b.outputs().value,zero,'downstream receives the old value at the shared edge');
  a.step({value:zero,pulse:false});b.step({value:one,pulse:false});
  a.step({value:zero,pulse:true,enable:false});b.step({value:one,pulse:true});assert.equal(a.outputs().value,one);assert.equal(b.outputs().value,one);
  assert.equal(a.step({value:one,pulse:true,reset:true}).value,zero);
  assert.equal(a.step({value:one,pulse:true}).value,zero,'reset release does not recapture held high');
  assert.throws(()=>a.step({value:kind==='boolean'?1:Infinity}),/Invalid value/);
  if(kind==='boolean'){a.step({value:'X',pulse:false});assert.equal(a.step({value:'X',pulse:true}).value,'X');}
});

for(const [name,cycle]of [['ring-counter',4],['johnson-counter',8],['decade-counter',10]])test(name+' completes its cycle, pauses while disabled, and re-primes after restore',()=>{
  const c=source(name),r=rig(c);r.step();const samples=[r.outputs()];
  const stages=name==='decade-counter'?10:4;
  assert.deepEqual(Object.keys(c.outputs(r.state)).filter(key=>/^q\d+$/.test(key)),Array.from({length:stages},(_,index)=>'q'+index));
  for(let i=1;i<=cycle;i++){r.step({clock:false});samples.push(r.step({clock:true}));assert.equal(samples[i].position,i%cycle);}
  assert.deepEqual(samples[0],samples[cycle]);
  if(name==='johnson-counter')for(const sample of samples)assert.equal(sample.value,sample['q'+(stages-1)],'value aliases the last zero-based stage');
  if(name==='johnson-counter')assert.deepEqual(samples.map(s=>[0,1,2,3].map(i=>s['q'+i])),[
    [false,false,false,false],[true,false,false,false],[true,true,false,false],[true,true,true,false],[true,true,true,true],
    [false,true,true,true],[false,false,true,true],[false,false,false,true],[false,false,false,false]]);
  else for(const s of samples){const outputs=Object.entries(s).filter(([name])=>/^q\d+$/.test(name));assert.equal(outputs.filter(([,value])=>value).length,1);assert.equal(s['q'+s.position],true);if(name==='decade-counter')assert.equal(s.carry,s.position<5);}
  r.step({clock:false});assert.equal(r.step({clock:true,enable:false}).position,0);assert.equal(r.step({clock:true}).position,0);
  r.step({clock:false});assert.equal(r.step({clock:true}).position,1);r.restore();assert.equal(r.step({clock:true}).position,1);
  assert.equal(r.step({clock:true,reset:true}).position,0);assert.equal(r.step({clock:true}).position,0);
});

for(const name of ['ring-counter','johnson-counter'])test(name+' bounds dynamic ports and clears/re-primes when stage count changes',()=>{
  const c=source(name),r=rig(c);r.step();r.step({clock:true});r.edit({stages:16});
  const output=r.outputs();assert.equal(output.position,0);assert.equal(Object.keys(c.outputs(r.state)).filter(k=>/^q\d+$/.test(k)).length,16);
  assert.equal(r.step({clock:true}).position,0);r.step({clock:false});assert.equal(r.step({clock:true}).position,1);
  for(const stages of [1,16]){
    const edge=rig(c,{...c.initState(),stages,configuredStages:stages,position:0}),cycle=name==='johnson-counter'?2*stages:stages;
    const keys=Array.from({length:stages},(_,index)=>'q'+index);
    assert.deepEqual(Object.keys(c.outputs(edge.state)).filter(key=>/^q\d+$/.test(key)),keys);
    edge.step();
    for(let pulse=1;pulse<=cycle;pulse++){edge.step({clock:false});assert.equal(edge.step({clock:true}).position,pulse%cycle);}
    const style=c.initStyle(),children=c.children(edge.state,style,style.w,style.h,false,{outputs:edge.outputs()});
    assert.ok(children.some(child=>child.text==='Q0'));
    assert.ok(children.some(child=>child.text==='Q'+(stages-1)));
    assert.ok(!children.some(child=>child.text==='Q'+stages),'no one-past-last tap label');
  }
  for(const stages of [0,17,1.5,NaN])assert.throws(()=>c.outputs({...r.state,stages}),/Stages/);
});

test('new built-ins ship identical scripts and port metadata with finite named rendering',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');const start=html.indexOf('  const BUILTIN_LIBRARY_DEFINITIONS = '),end=html.indexOf('\n  const BUILTIN_LIBRARY_THUMBNAILS',start);
  const definitions=JSON.parse(html.slice(start,end).replace('  const BUILTIN_LIBRARY_DEFINITIONS = ','').trim().replace(/;$/,''));
  const keys=['srLatch','dLatch','dFlipFlop','registerBoolean','registerNumber','ringCounter','johnsonCounter','decadeCounter'];
  for(let i=0;i<names.length;i++){
    const name=names[i],c=source(name),definition=definitions.find(d=>d.key===keys[i]);assert.ok(definition,keys[i]);
    assert.equal(definition.items[0].script,fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8'));
    const state=c.initState(),style=c.initStyle(),ports=typeof c.outputs==='function'?c.outputs(state):c.outputs;
    assert.deepEqual(definition.ports,plain({inputs:c.inputs,outputs:ports}));assert.ok(Object.keys(ports).length<=32);
    const before=JSON.stringify(state),output=c.publish(state),children=c.children(state,style,style.w,style.h,true,{name:'A custom instance',inputs:{},outputs:output});
    assert.equal(JSON.stringify(state),before);assert.ok(children.some(child=>child.type==='text'&&child.text==='A custom instance'));
    for(const child of children)for(const [field,value]of Object.entries(child))if(typeof value==='number')assert.ok(Number.isFinite(value),name+' '+field);
    assert.deepEqual(plain(c.dragEdit(state,'reset').state).value,typeof state.value==='number'?0:'value'in state?false:undefined);
  }
});

test('Boolean shift storage can carry X and publish without current input while numeric storage remains finite',()=>{
  for(const kind of ['boolean','number']){
    const c=source('shift-register-'+kind),s=c.initState(),before=JSON.stringify(s);assert.deepEqual(plain(c.publish(s)),plain(c.compute({value:kind==='boolean'?true:7,pulse:false,reset:false},s)));assert.equal(JSON.stringify(s),before);
    if(kind==='boolean'){s.cells[0]='X';assert.equal(c.publish(s).q0,'X');assert.equal(c.outputs(s).q0.unknown,true);assert.equal(c.inputs.value.unknown,true);}
    else{s.cells[0]=Infinity;assert.throws(()=>c.publish(s),/finite numeric/);}
  }
});
