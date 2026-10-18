const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function source(type){return vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples','shift-register-'+type+'.js'),'utf8'),{});}
function plain(value){return JSON.parse(JSON.stringify(value));}
function stateFor(component,stages,fill){return {...component.initState(),stages,configuredStages:stages,cells:Array(stages).fill(fill)};}
function runtime(component,initial=component.initState()){
  let state=initial,memory=null;
  return {
    step(value,pulse=false,reset=false){
      const inputs={value,pulse,reset},before=JSON.stringify({state,memory,inputs});
      const next=component.transition(inputs,state,memory,{now:0});
      assert.equal(JSON.stringify({state,memory,inputs}),before,'transition leaves its arguments untouched');
      assert.notEqual(next.state.cells,state.cells,'new state owns its cell array');
      assert.equal(next.nextWakeAt,null,'shift register is edge-driven, without an autonomous timer');
      state=next.state;memory=next.memory;
      return plain(component.compute(inputs,state));
    },
    edit(patch){state={...state,...patch};},
    clearMemory(){memory=null;},
    reset(){state=component.dragEdit(state,'reset').state;},
    get state(){return plain(state);}
  };
}

for(const type of ['boolean','number']){
  const component=source(type),zero=type==='boolean'?false:0,one=type==='boolean'?true:1.5;
  test(type+' shift register declares 1–16 taps, final-value alias, and shifted-out data',()=>{
    assert.deepEqual(plain(component.settings),{stages:{type:'number',default:4,min:1,max:16,step:1,label:'Stages'}});
    assert.deepEqual(plain(component.inputs),{value:{type,...(type==='boolean'?{unknown:true}:{})},pulse:{type:'boolean',default:false},reset:{type:'boolean',default:false}});
    for(const stages of [1,4,16]){
      const state=stateFor(component,stages,zero),ports=plain(component.outputs(state)),outputs=plain(component.compute({value:one,pulse:false,reset:false},state));
      assert.deepEqual(Object.keys(ports),[...Array.from({length:stages},(_,i)=>'q'+i),'value','shiftedOut']);
      assert.ok(Object.values(ports).every(port=>port.type===type));
      assert.deepEqual(Object.keys(outputs),Object.keys(ports));
      assert.ok(Object.values(outputs).every(value=>value===zero));
    }
  });

  test(type+' shift moves all cells from the old snapshot and retains the ejected value',()=>{
    const rt=runtime(component),values=type==='boolean'?[true,false,true,true,false]:[1.5,-2.25,0,9,17];
    const expected=type==='boolean'?[[true,false,false,false],[false,true,false,false],[true,false,true,false],[true,true,false,true],[false,true,true,false]]:
      [[1.5,0,0,0],[-2.25,1.5,0,0],[0,-2.25,1.5,0],[9,0,-2.25,1.5],[17,9,0,-2.25]];
    rt.step(zero);
    for(let i=0;i<values.length;i++){
      rt.step(values[i],false);
      const output=rt.step(values[i],true);
      assert.deepEqual(rt.state.cells,expected[i]);
      for(let n=0;n<4;n++)assert.equal(output['q'+n],expected[i][n]);
      assert.equal(output.value,expected[i][3]);
      assert.equal(output.shiftedOut,i<4?zero:values[0]);
      assert.deepEqual(rt.step(zero,true),output,'input changes during high never shift or alter ejected data');
      assert.deepEqual(rt.step(one,false),output,'falling edges never shift or alter ejected data');
    }
  });

  test(type+' one-stage register samples on a rise and reports its previous value',()=>{
    const rt=runtime(component,stateFor(component,1,zero));
    rt.step(one,false);
    assert.deepEqual(rt.step(one,true),{q0:one,value:one,shiftedOut:zero});
    rt.step(zero,false);
    assert.deepEqual(rt.step(zero,true),{q0:zero,value:zero,shiftedOut:one});
    assert.deepEqual(rt.step(one,true),{q0:zero,value:zero,shiftedOut:one});
  });

  test(type+' restored or initially high pulse primes without shifting, preserving saved cells',()=>{
    const state={...component.initState(),cells:[one,zero,one,zero],shiftedOut:one};
    for(const initialPulse of [false,true]){
      const rt=runtime(component,{...state,cells:state.cells.slice()});
      assert.equal(rt.step(one,initialPulse).shiftedOut,one);
      assert.deepEqual(rt.state.cells,[one,zero,one,zero]);
      rt.clearMemory();rt.step(one,true);
      assert.deepEqual(rt.state.cells,[one,zero,one,zero]);
      rt.step(one,false);rt.step(one,true);
      assert.deepEqual(rt.state.cells,[one,one,zero,one]);
    }
    const a=runtime(component),b=runtime(component);a.step(one);b.step(one);
    a.step(one,true);b.step(one,false);
    assert.deepEqual(a.state.cells,[one,zero,zero,zero]);
    assert.deepEqual(b.state.cells,[zero,zero,zero,zero]);
  });

  test(type+' held reset clears every tap and shiftedOut; releasing high creates no edge',()=>{
    const rt=runtime(component,{...component.initState(),cells:[one,one,one,one],shiftedOut:one});
    rt.step(one,false);
    let output=rt.step(one,true,true);
    assert.ok(Object.values(output).every(value=>value===zero));
    assert.ok(Object.values(rt.step(one,false,true)).every(value=>value===zero));
    assert.ok(Object.values(rt.step(one,true,true)).every(value=>value===zero));
    assert.ok(Object.values(rt.step(one,true,false)).every(value=>value===zero));
    rt.step(one,false);rt.step(one,true);
    assert.deepEqual(rt.state.cells,[one,zero,zero,zero]);
    rt.reset();assert.deepEqual(rt.state.cells,[zero,zero,zero,zero]);
    output=rt.step(one,true);
    assert.ok(Object.values(output).every(value=>value===zero),'manual reset cannot replay the held pulse');
  });

  test(type+' changing stage count clears and re-primes even when transient memory was lost',()=>{
    const rt=runtime(component,{...component.initState(),cells:[one,one,one,one],shiftedOut:one});
    rt.step(one,false);rt.edit({stages:2});rt.clearMemory();
    const before=JSON.stringify(rt.state),pure=plain(component.compute({value:one,pulse:true,reset:false},rt.state));
    assert.deepEqual(pure,{q0:zero,q1:zero,value:zero,shiftedOut:zero});
    assert.equal(JSON.stringify(rt.state),before,'pure inspection normalizes without mutating saved state');
    assert.deepEqual(rt.step(one,true),pure);
    assert.equal(rt.state.configuredStages,2);
    rt.step(one,false);assert.equal(rt.step(one,true).q0,one);
    rt.edit({stages:16});rt.step(one,true);
    assert.equal(rt.state.cells.length,16);
    assert.ok(rt.state.cells.every(value=>value===zero));
    rt.step(one,false);rt.step(one,true);
    assert.equal(rt.state.cells[0],one);assert.ok(rt.state.cells.slice(1).every(value=>value===zero));
  });

  test(type+' cascading two 2-stage registers through old value snapshots equals one 4-stage register',()=>{
    const first=runtime(component,stateFor(component,2,zero)),second=runtime(component,stateFor(component,2,zero)),whole=runtime(component);
    const stream=type==='boolean'?[true,false,true,true,false,false,true,false,true]:[1.5,-2.25,0,17,Math.PI,-0.001,1e100,1e-100,42];
    let outputFirst=first.step(zero);second.step(outputFirst.value);whole.step(zero);
    for(const value of stream){
      outputFirst=first.step(value,false);second.step(outputFirst.value,false);whole.step(value,false);
      const sampled=outputFirst.value;
      outputFirst=first.step(value,true);
      const outputSecond=second.step(sampled,true),outputWhole=whole.step(value,true);
      assert.deepEqual([...first.state.cells,...second.state.cells],whole.state.cells);
      assert.equal(outputSecond.value,outputWhole.value);
      assert.equal(outputSecond.shiftedOut,outputWhole.shiftedOut);
    }
  });

  test(type+' invalid inputs, stored cells, and stage counts fail without coercion',()=>{
    const state=component.initState(),inputs={value:one,pulse:false,reset:false};
    const bad=type==='boolean'?[0,1,'true',null,undefined]:[Infinity,-Infinity,NaN,'1',true,null,undefined];
    for(const value of bad){
      assert.throws(()=>component.compute({...inputs,value},state),/requires/);
      assert.throws(()=>component.compute(inputs,{...state,cells:[value,zero,zero,zero]}),/state requires/);
      assert.throws(()=>component.compute(inputs,{...state,shiftedOut:value}),/state requires/);
    }
    for(const stages of [0,17,1.5,Infinity,'4'])assert.throws(()=>component.outputs({...state,stages}),/Stages must/);
    for(const cells of [[],Array(4),Array(17).fill(zero),[zero,zero,zero]])assert.throws(()=>component.compute(inputs,{...state,cells}),/state requires/);
    assert.throws(()=>component.compute({...inputs,pulse:1},state),/Boolean values/);
    assert.throws(()=>component.compute({...inputs,reset:0},state),/Boolean values/);
    assert.throws(()=>component.compute(inputs,{...state,configuredStages:0}),/state requires/);
    assert.deepEqual(plain(state),plain(component.initState()));
  });

  test(type+' stage arrays are independent across states, resets, transitions, and pure outputs',()=>{
    const a=component.initState(),b=component.initState(),input={value:one,pulse:false,reset:false};
    a.cells[0]=one;assert.equal(b.cells[0],zero);
    const next=component.transition(input,a,null,{now:0}),computed=component.compute(input,next.state);
    next.state.cells[0]=zero;assert.equal(a.cells[0],one);assert.equal(computed.q0,one);
    const reset=component.dragEdit(a,'reset').state;reset.cells[0]=one;assert.equal(a.cells[1],zero);
    assert.equal(b.cells[0],zero);
  });

  test(type+' rendering labels every tap and has readable routes for 1, 4, and 16 stages',()=>{
    const style=component.initStyle();
    for(const stages of [1,4,16]){
      const state=stateFor(component,stages,zero),inputs={value:one,pulse:false,reset:false},io={name:'Register bank',inputs,outputs:component.compute(inputs,state)};
      const children=component.children(state,style,style.w,style.h,false,io);
      assert.ok(children.some(child=>child.text==='Register bank'));
      assert.equal(children.filter(child=>child.type==='rect').length,stages);
      for(let i=0;i<stages;i++)assert.ok(children.some(child=>child.text==='Q'+i));
      assert.ok(children.some(child=>child.text?.startsWith('Q'+(stages-1)+' / value:')));
      assert.ok(children.some(child=>child.text?.startsWith('Shifted out:')));
      assert.ok(children.length<200,'bounded children count');
      assert.ok(children.some(child=>child.type==='line'&&child.x1<child.x2),'left-to-right stage arrows');
      if(stages===16)assert.ok(children.some(child=>child.type==='line'&&child.x1>style.w*.9&&child.x2<style.w*.1),'wrapped return route connects both rows');
      const hidden=component.children({...state,showIndicators:false},style,style.w,style.h,false,io);
      assert.equal(hidden.filter(child=>child.type==='ellipse').length,0);
      const unavailable=component.unavailableChildren(state,style,style.w,style.h,true,{name:'Register bank',error:'Missing input'});
      assert.equal(unavailable.filter(child=>child.type==='rect').length,stages);
      assert.ok(unavailable.some(child=>child.type==='ellipse'&&child.fillColor==='#fbbf24'));
      assert.ok(!unavailable.some(child=>child.type==='ellipse'&&child.fillColor==='#15803d'));
    }
    const handles=component.handles(component.initState(),style.w,style.h);
    assert.equal(handles.find(handle=>handle.id==='reset').editorOnly,undefined,'Reset works in reader');
    assert.equal(handles.find(handle=>handle.id==='indicators').editorOnly,true);
    for(const handle of handles)assert.equal(component.hitEdit(component.initState(),handle.x,handle.y,style.w,style.h),handle.id);
  });
}
