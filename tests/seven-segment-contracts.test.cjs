const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const component=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples','seven-segment-display.js'),'utf8'),{});
const plain=value=>JSON.parse(JSON.stringify(value));
function inputs(mode,values={}){
  return {...Object.fromEntries(Object.entries(component.inputs({mode})).filter(([,port])=>'default' in port).map(([name,port])=>[name,port.default])),...values};
}
function lit(outputs){return [...'abcdefg'].filter(name=>outputs[name]).join('');}

test('seven-segment display exposes only the selected input mode and fixed typed outputs',()=>{
  assert.deepEqual(plain(component.initState()),{mode:'number'});
  assert.deepEqual(plain(component.settings),{mode:{type:'string',default:'number',options:['number','segments'],label:'Input mode'}});
  assert.deepEqual(plain(component.inputs({mode:'number'})),{value:{type:'number'},decimalPoint:{type:'boolean',default:false},enable:{role:'control',type:'boolean',default:true}});
  const segmentPorts=plain(component.inputs({mode:'segments'}));
  assert.deepEqual(Object.keys(segmentPorts),[...'abcdefg','decimalPoint','enable']);
  for(const name of 'abcdefg')assert.deepEqual(segmentPorts[name],{type:'boolean',default:false});
  assert.deepEqual(Object.keys(component.outputs),[...'abcdefg','decimalPoint']);
  assert.ok(Object.values(component.outputs).every(port=>port.type==='boolean'));
  assert.equal(component.transition,undefined,'display is a pure combinational component');
  assert.equal(component.handles,undefined,'mode is authoring configuration, with no direct reader mutation');
});

test('decimal digits 0–9 light the conventional segment patterns',()=>{
  const expected=['abcdef','bc','abdeg','abcdg','bcfg','acdfg','acdefg','abc','abcdefg','abcdfg'];
  for(let value=0;value<=9;value++){
    const result=component.compute(inputs('number',{value}),{mode:'number'});
    assert.equal(lit(result),expected[value],'digit '+value);
    assert.equal(result.decimalPoint,false);
    assert.deepEqual(Object.keys(result),Object.keys(component.outputs));
    assert.ok(Object.values(result).every(value=>typeof value==='boolean'));
  }
});

test('individual segment inputs pass through independently, including the decimal point',()=>{
  assert.equal(lit(component.compute(inputs('segments'),{mode:'segments'})),'','unconnected segment defaults form a blank display');
  for(const name of [...'abcdefg','decimalPoint']){
    const result=component.compute(inputs('segments',{[name]:true}),{mode:'segments'});
    for(const output of [...'abcdefg','decimalPoint'])assert.equal(result[output],output===name);
  }
  assert.equal(lit(component.compute(inputs('segments',{a:true,d:true,g:true}),{mode:'segments'})),'adg');
});

test('enable blanks all outputs in both modes and re-enabling restores current inputs',()=>{
  for(const mode of ['number','segments']){
    const values=mode==='number'?{value:8}:{a:true,b:true,c:true,d:true,e:true,f:true,g:true};
    assert.ok(Object.values(component.compute(inputs(mode,{...values,enable:false,decimalPoint:true}),{mode})).every(value=>value===false));
    const enabled=component.compute(inputs(mode,{...values,enable:true,decimalPoint:true}),{mode});
    assert.equal(lit(enabled),'abcdefg');assert.equal(enabled.decimalPoint,true);
  }
  const digit=component.compute(inputs('number',{value:0,decimalPoint:true}),{mode:'number'});
  assert.equal(lit(digit),'abcdef');assert.equal(digit.decimalPoint,true);
});

test('numeric input rejects out-of-range, fractional, and coerced values, including while disabled',()=>{
  for(const value of [-1,10,100,1.5,NaN,Infinity,-Infinity,'3',true,null,undefined]){
    for(const enable of [false,true])assert.throws(()=>component.compute(inputs('number',{value,enable}),{mode:'number'}),/integer from 0 to 9/);
  }
  for(const mode of ['',null,undefined,'hex','boolean']){
    assert.throws(()=>component.inputs({mode}),/Input mode/);
    assert.throws(()=>component.compute(inputs('number',{value:2}),{mode}),/Input mode/);
  }
});

test('segment and control inputs remain strict Booleans',()=>{
  for(const mode of ['number','segments']){
    for(const name of ['enable','decimalPoint'])for(const value of [0,1,'true',null,undefined]){
      assert.throws(()=>component.compute(inputs(mode,{value:3,[name]:value}),{mode}),/must be Boolean/);
    }
  }
  for(const name of 'abcdefg')for(const value of [0,1,'false',null,undefined]){
    assert.throws(()=>component.compute(inputs('segments',{[name]:value}),{mode:'segments'}),/must be Boolean/);
  }
});

test('repeated computation and mode changes have no state, input, or output aliasing',()=>{
  const state={mode:'number'},input=inputs('number',{value:4}),before=JSON.stringify({state,input});
  const first=component.compute(input,state),second=component.compute(input,state);
  assert.deepEqual(plain(first),plain(second));assert.notEqual(first,second);
  first.a=true;assert.equal(second.a,false);
  assert.equal(JSON.stringify({state,input}),before);
  const segmentState={mode:'segments'},segmentInput=inputs('segments',{g:true});
  assert.equal(lit(component.compute(segmentInput,segmentState)),'g');
  assert.equal(lit(component.compute(input,state)),'bcfg','another mode/instance cannot contaminate digit decoding');
});

test('rendering uses seven red/dim polygons and an independently controlled decimal point',()=>{
  const state={mode:'number'},style=component.initStyle(),input=inputs('number',{value:2,decimalPoint:true});
  const children=component.children(state,style,style.w,style.h,false,{name:'Lap digit',inputs:input,outputs:component.compute(input,state)});
  assert.ok(children.some(child=>child.type==='text'&&child.text==='Lap digit'));
  const segments=children.filter(child=>child.type==='polygon');
  assert.equal(segments.length,7);
  assert.deepEqual(plain(segments.map(child=>child.fillColor==='#ef4444')),[true,true,false,true,true,false,true]);
  assert.ok(segments.every(child=>child.closed===true&&child.points.length===6));
  assert.equal(children.find(child=>child.type==='ellipse').fillColor,'#ef4444');
  const centers=segments.map(child=>({x:child.points.reduce((sum,p)=>sum+p.x,0)/6,y:child.points.reduce((sum,p)=>sum+p.y,0)/6}));
  const [a,b,c,d,e,f,g]=centers;
  assert.ok(a.y<g.y&&g.y<d.y,'a/g/d are the top/middle/bottom bars');
  assert.ok(b.x>g.x&&c.x>g.x&&e.x<g.x&&f.x<g.x,'b/c right, e/f left');
  assert.ok(b.y<g.y&&f.y<g.y&&c.y>g.y&&e.y>g.y,'upper/lower side bars match their names');
});

test('unavailable rendering cannot display a valid zero or stale illuminated segments',()=>{
  const state={mode:'number'},style=component.initStyle(),input=inputs('number',{value:8,decimalPoint:true});
  for(const error of ['Missing value or binding for value','Seven-segment value must be an integer from 0 to 9','Component bindings contain a cycle']){
    const children=component.unavailableChildren(state,style,style.w,style.h,false,{name:'Lap digit',inputs:input,outputs:component.compute(input,state),error});
    assert.equal(children.filter(child=>child.type==='polygon').length,7);
    assert.ok(!children.some(child=>child.fillColor==='#ef4444'));
    assert.ok(children.some(child=>child.type==='text'&&child.color==='#fbbf24'));
    assert.ok(children.some(child=>child.type==='text'&&child.text==='Lap digit'));
  }
  const disabled=inputs('number',{value:8,enable:false}),children=component.children(state,style,style.w,style.h,false,{inputs:disabled,outputs:component.compute(disabled,state)});
  assert.ok(children.some(child=>child.text==='Disabled'));
  assert.ok(!children.some(child=>child.fillColor==='#ef4444'));
});

test('segment geometry stays finite and inside the panel after resizing',()=>{
  const state={mode:'number'},style=component.initStyle(),input=inputs('number',{value:8});
  for(const [w,h] of [[200,280],[400,160],[20,30],[1,1]]){
    const children=component.children(state,style,w,h,false,{inputs:input,outputs:component.compute(input,state)});
    const panel=children.find(child=>child.type==='rect');
    for(const child of children.filter(child=>child.type==='polygon'))for(const point of child.points){
      assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
      assert.ok(point.x>=panel.x&&point.x<=panel.x+panel.w);
      assert.ok(point.y>=panel.y&&point.y<=panel.y+panel.h);
    }
    const dot=children.find(child=>child.type==='ellipse');
    assert.ok(dot.x>=panel.x&&dot.x+dot.w<=panel.x+panel.w);
    assert.ok(dot.y>=panel.y&&dot.y+dot.h<=panel.y+panel.h);
  }
});
