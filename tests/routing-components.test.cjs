const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Deterministic source contracts complement the editor/Worker integration tests.
// No clock or browser is needed: switches advance only on observed rising edges.
function source(name){
  return vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'),{});
}
function plain(value){return JSON.parse(JSON.stringify(value));}
function inputsFor(component,state,overrides={}){
  const descriptors=typeof component.inputs==='function'?component.inputs(state):component.inputs;
  return Object.assign(Object.fromEntries(Object.entries(descriptors).filter(([,p])=>'default' in p).map(([name,p])=>[name,p.default])),overrides);
}
function runtime(component,initialState=component.initState()){
  let state=initialState,memory=null;
  return {
    step(overrides={}){
      const inputs=inputsFor(component,state,overrides),before=JSON.stringify({state,memory,inputs});
      const next=component.transition(inputs,state,memory,{now:0});
      assert.equal(JSON.stringify({state,memory,inputs}),before,'transition does not mutate its arguments');
      assert.equal(next.nextWakeAt,null,'routing does not schedule autonomous steps');
      state=next.state;memory=next.memory;
      return plain(component.compute(inputs,state));
    },
    setState(patch){state={...state,...patch};},
    clearMemory(){memory=null;},
    get state(){return plain(state);}
  };
}

for(const type of ['number','boolean']){
  const a=type==='number'?-17.25:false,b=type==='number'?83.5:true;
  test(type+' selector chooses A on false and B on true',()=>{
    const component=source('selector-'+type),state=component.initState();
    assert.deepEqual(plain(component.compute(inputsFor(component,state,{a,b}),state)),{value:a});
    assert.deepEqual(plain(component.compute(inputsFor(component,state,{a,b,select:true}),state)),{value:b});
    assert.throws(()=>component.compute({a,b,select:1},state),/Boolean selection/);
    assert.throws(()=>component.compute({a,b:type==='number'?NaN:1,select:false},state),/two/);
    assert.throws(()=>component.compute({a:undefined,b,select:true},state),/two/,'both data inputs must be available');
  });

  for(const role of ['selector','distributor']){
    const name='stepped-'+role+'-'+type,component=source(name),isDistributor=role==='distributor';
    const value=type==='number'?-42.5:true;
    const values={value,...Object.fromEntries(Array.from({length:16},(_,i)=>['in'+i,type==='number'?i+1:i%2===0]))};
    test(name+' creates exactly 2–16 typed channels and publishes its selected position',()=>{
      assert.deepEqual(plain(component.settings),{channels:{type:'number',default:4,min:2,max:16,step:1,label:'Channels'}});
      for(const channels of [2,4,16]){
        const state={...component.initState(),channels,configuredChannels:channels},inputPorts=component.inputs(state),outputPorts=component.outputs(state);
        assert.equal(Object.keys(inputPorts).length,isDistributor?3:channels+2);
        assert.equal(Object.keys(outputPorts).length,isDistributor?channels+1:2);
        for(let i=0;i<channels;i++){
          const port=isDistributor?outputPorts['out'+i]:inputPorts['in'+i];
          assert.equal(port.type,type);
          if(!isDistributor)assert.equal(port.default,type==='number'?0:false);
        }
        const rt=runtime(component,state),initial=rt.step(values);
        assert.equal(initial.position,0);
        assert.equal(isDistributor?initial.out0:initial.value,isDistributor?value:values.in0);
        assert.equal((isDistributor?outputPorts:inputPorts)[(isDistributor?'out':'in')+channels],undefined,'no one-past-last channel');
        rt.setState({position:channels-1});
        const last=rt.step(values);
        assert.equal(last.position,channels-1);
        assert.equal(isDistributor?last['out'+(channels-1)]:last.value,isDistributor?value:values['in'+(channels-1)]);
        assert.equal(rt.step({...values,pulse:true}).position,0,'last channel wraps to channel zero');
      }
      for(const channels of [1,17,2.5,NaN,Infinity,'4'])assert.throws(()=>component.compute(inputsFor(component,component.initState(),values),{...component.initState(),channels}),/Channels must/);
    });

    test(name+' steps once per rising edge, wraps, and never counts an initially high input',()=>{
      const rt=runtime(component),outputs=[];
      outputs.push(rt.step({...values,pulse:true}).position);
      outputs.push(rt.step({...values,pulse:true}).position);
      for(let n=0;n<5;n++){
        outputs.push(rt.step({...values,pulse:false}).position);
        outputs.push(rt.step({...values,pulse:true}).position);
        outputs.push(rt.step({...values,pulse:true}).position);
      }
      assert.deepEqual(outputs,[0,0,0,1,1,1,2,2,2,3,3,3,0,0,0,1,1]);
      assert.equal(rt.state.channels,4,'transition leaves the configured number of channels alone');
    });

    test(name+' holds reset at channel 0 and releasing reset during high does not step',()=>{
      const rt=runtime(component);rt.step({...values,pulse:false});
      assert.equal(rt.step({...values,pulse:true}).position,1);
      assert.equal(rt.step({...values,pulse:false,reset:true}).position,0);
      assert.equal(rt.step({...values,pulse:true,reset:true}).position,0);
      assert.equal(rt.step({...values,pulse:true,reset:false}).position,0);
      rt.step({...values,pulse:false});
      assert.equal(rt.step({...values,pulse:true}).position,1);
    });

    test(name+' preserves saved selection without replay on reload, copy, or undo',()=>{
      const saved={...component.initState(),position:2};
      for(const pulse of [false,true]){
        const rt=runtime(component,{...saved});
        assert.equal(rt.step({...values,pulse}).position,2);
        rt.clearMemory();
        assert.equal(rt.step({...values,pulse:true}).position,2);
        rt.step({...values,pulse:false});
        assert.equal(rt.step({...values,pulse:true}).position,3);
      }
      const first=runtime(component),second=runtime(component);
      first.step({...values,pulse:false});second.step({...values,pulse:false});
      assert.equal(first.step({...values,pulse:true}).position,1);
      assert.equal(second.step({...values,pulse:false}).position,0,'instances never share pulse memory or position');
    });

    test(name+' resets and re-primes when channel count changes even if runtime memory was cleared',()=>{
      const rt=runtime(component,{...component.initState(),position:2});
      rt.step({...values,pulse:false});
      rt.setState({channels:6});rt.clearMemory();
      const pure=plain(component.compute(inputsFor(component,rt.state,{...values,pulse:true}),rt.state));
      assert.equal(pure.position,0,'pure previews normalize changed settings before transition');
      assert.equal(rt.step({...values,pulse:true}).position,0);
      assert.equal(rt.state.configuredChannels,6);
      assert.equal(rt.step({...values,pulse:true}).position,0);
      rt.step({...values,pulse:false});assert.equal(rt.step({...values,pulse:true}).position,1);
      rt.setState({channels:2,position:5});
      assert.equal(rt.step({...values,pulse:false}).position,0);
      assert.equal(rt.step({...values,pulse:true}).position,1);
      rt.step({...values,pulse:false});assert.equal(rt.step({...values,pulse:true}).position,0);
    });

    test(name+' keeps the selected route live while holding position',()=>{
      const rt=runtime(component,{...component.initState(),position:1}),first=rt.step(values);
      if(isDistributor){
        assert.deepEqual(first,{out0:type==='number'?0:false,out1:value,out2:type==='number'?0:false,out3:type==='number'?0:false,position:1});
        const next=rt.step({...values,value:type==='number'?-0.125:false});
        assert.deepEqual(next,{out0:type==='number'?0:false,out1:type==='number'?-0.125:false,out2:type==='number'?0:false,out3:type==='number'?0:false,position:1});
      }else{
        assert.equal(first.value,values.in1);
        assert.equal(rt.step({...values,in1:type==='number'?300:true}).value,type==='number'?300:true);
        const defaults=rt.step({pulse:false});
        assert.equal(defaults.value,type==='number'?0:false,'unused channel connections are optional');
      }
    });

    test(name+' rejects invalid signals and malformed position without mutating state',()=>{
      const state=component.initState(),inputs=inputsFor(component,state,values),bad=type==='number'?Infinity:1;
      for(const patch of [{pulse:1},{reset:0},{[isDistributor?'value':'in0']:bad}])assert.throws(()=>component.compute({...inputs,...patch},state));
      for(const position of [-1,.5,NaN])assert.throws(()=>component.compute(inputs,{...state,position}),/position must/);
      assert.equal(component.compute(inputs,{...state,position:12}).position,0,'out-of-range saved positions are safely normalized');
      const before=JSON.stringify({state,inputs});
      component.compute(inputs,state);
      assert.equal(JSON.stringify({state,inputs}),before,'pure evaluation never mutates state or inputs');
    });
  }
}

test('routing sources render named switch contacts and optional indicators, including unavailable states',()=>{
  for(const name of ['selector-number','selector-boolean','stepped-selector-number','stepped-selector-boolean','stepped-distributor-number','stepped-distributor-boolean']){
    const component=source(name),state=component.initState(),style=component.initStyle(),numeric=name.endsWith('number');
    const inputs=inputsFor(component,state,{a:numeric?2:true,b:numeric?3:false,value:numeric?4:true});
    const io={name:'Chosen route',inputs,outputs:component.compute(inputs,state)},children=component.children(state,style,style.w,style.h,true,io);
    assert.ok(children.some(child=>child.type==='text'&&child.text==='Chosen route'),name+' displays instance name');
    assert.ok(children.some(child=>child.type==='line'&&child.x1!==child.x2&&child.y1!==child.y2),name+' has a slanted switch contact');
    assert.ok(children.some(child=>child.type==='ellipse'&&['#2563eb','#15803d','#64748b'].includes(child.fillColor)),name+' shows live input/output indicators');
    const hidden=component.children({...state,showIndicators:false},style,style.w,style.h,true,io);
    assert.ok(hidden.filter(child=>child.type==='ellipse').length<children.filter(child=>child.type==='ellipse').length,name+' allows hiding LEDs');
    const unavailable=component.unavailableChildren(state,style,style.w,style.h,true,{name:'Chosen route',error:'Component bindings contain a cycle'});
    assert.ok(unavailable.some(child=>child.type==='text'&&child.text==='Chosen route'));
    assert.ok(unavailable.some(child=>child.type==='text'&&child.text==='Input unavailable'));
    assert.ok(unavailable.some(child=>child.type==='ellipse'&&child.fillColor==='#fbbf24'));
    assert.ok(!unavailable.some(child=>child.type==='ellipse'&&child.fillColor==='#15803d'),'unavailable values never appear true');
    const handle=component.handles(state,style.w,style.h)[0];
    assert.equal(handle.editorOnly,true);
    assert.equal(component.hitEdit(state,handle.x,handle.y,style.w,style.h),'indicators');
    assert.equal(component.dragEdit(state,'indicators').state.showIndicators,false);
    if(name.startsWith('stepped')){
      const large={...state,channels:16,configuredChannels:16,position:15},largeInputs=inputsFor(component,large,{value:numeric?7:true});
      const largeChildren=component.children(large,style,style.w,style.h,false,{name:'Sixteen channels',inputs:largeInputs,outputs:component.compute(largeInputs,large)});
      assert.ok(largeChildren.some(child=>child.type==='text'&&child.text.startsWith('15:')));
      assert.ok(largeChildren.some(child=>child.text==='Channel 15 · 16 channels'),'caption distinguishes the zero-based index from the count');
      assert.ok(largeChildren.length<200,'maximum channel layout stays within primitive budget');
      const fallback=component.children({...state,position:state.channels},style,style.w,style.h,false,{});
      assert.ok(fallback.some(child=>child.text==='Channel 0 · 4 channels'),'one-past-last saved position renders channel zero while inputs are unavailable');
    }
  }
});
