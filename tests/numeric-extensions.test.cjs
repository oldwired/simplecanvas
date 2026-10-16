const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'),{}, {filename:name+'.js',timeout:1000});
const inputs=(component,values={})=>Object.fromEntries(Object.entries(component.inputs).map(([name,port])=>[name,Object.hasOwn(values,name)?values[name]:port.default]));
const output=(component,values,state=component.initState())=>component.compute(inputs(component,values),state).value;
const style=component=>({color:'#64748b',textColor:'#334155',font:'600 20px sans-serif',size:2,...component.initStyle()});

function verifyGeometry(children,width,height){
  assert.ok(children.length>3,'component keeps a recognizable drawing');
  for(const child of children){
    for(const key of ['x','y','x1','y1','x2','y2','w','h','size']){
      if(Object.hasOwn(child,key))assert.ok(Number.isFinite(child[key]),`${child.type}.${key} must be finite`);
    }
    if(child.type==='text'){
      assert.equal(typeof child.text,'string');
      assert.ok(child.x>=0 && child.y>=0 && child.x+child.w<=width+.001 && child.y+child.h<=height+.001,'text stays inside the component');
      assert.match(child.font,/\d+(?:\.\d+)?px/);
    }
  }
}

test('Compare handles all six comparisons with two live operands and keeps its existing value input',()=>{
  const component=source('compare');
  assert.equal(component.inputs.value.type,'number');
  assert.equal(component.inputs.b.default,70);
  assert.equal(component.outputs.value.type,'boolean');
  for(const [operation,expected] of [
    ['>',[false,false,true]],['≥',[false,true,true]],['<',[true,false,false]],
    ['≤',[true,true,false]],['=',[false,true,false]],['≠',[true,false,true]]
  ]){
    for(const [i,value] of [69,70,71].entries())assert.equal(output(component,{value,b:70,operation}),expected[i],`${value} ${operation} 70`);
  }
  assert.equal(output(component,{value:71}),true);
  assert.equal(output(component,{value:71,b:72}),false);
  assert.throws(()=>output(component,{value:NaN}),/finite/);
  assert.throws(()=>output(component,{value:1,b:Infinity}),/finite/);
  assert.throws(()=>output(component,{value:1,operation:'==='}),/Unsupported/);
});

test('Number control uses bounds and a shared fractional step grid for output, slider, buttons, and direct entry',()=>{
  const component=source('number-control');
  assert.equal(output(component,{}),50);
  assert.equal(component.inputs.step.default,1);
  const config=inputs(component,{min:-20,max:40,step:.25}),s=style(component),w=s.w,h=s.h;
  const action=(state,handle,value=0)=>component.dragEdit(state,handle,value,0,w,h,s,{inputs:config,outputs:component.compute(config,state)}).state;
  assert.equal(component.compute(config,{value:.37}).value,.25);
  assert.equal(action({value:0},'plus').value,.25);
  assert.equal(action({value:0},'minus').value,-.25);
  assert.equal(action({value:0},'entry',12.38).value,12.5);
  assert.equal(action({value:0},'entry',200).value,40);
  assert.equal(action({value:0},'entry',-200).value,-20);
  const scale=Math.min(w/240,h/130),pad=Math.min(20*scale,w*.15);
  assert.equal(action({value:0},'value',pad).value,-20);
  assert.equal(action({value:0},'value',w-pad).value,40);
  assert.equal(action({value:0},'value',w/2).value,10);
  const handles=component.handles({value:0},w,h,s,{inputs:config,outputs:{value:0}});
  const entry=handles.find(handle=>handle.id==='entry');
  assert.equal(entry.kind,'number');
  assert.equal(entry.value,0);
  assert.equal(entry.min,-20);
  assert.equal(entry.max,40);
  assert.equal(entry.step,.25);
  assert.equal(component.hitEdit({value:0},entry.x,entry.y,w,h),'entry');
  assert.throws(()=>action({value:0},'entry',Infinity),/finite/);
});

test('Number control snaps decimal steps without accumulating drift and reaches bounds',()=>{
  const component=source('number-control'),s=style(component);
  let state={value:0};
  const config=inputs(component,{min:0,max:1,step:.1});
  for(let i=1;i<=10;i++){
    state=component.dragEdit(state,'plus',0,0,s.w,s.h,s,{inputs:config,outputs:component.compute(config,state)}).state;
    assert.equal(state.value,i/10);
  }
  assert.equal(output(component,{min:0,max:10,step:3},{value:10}),10,'maximum remains reachable even off the step grid');
  assert.equal(output(component,{min:42,max:42},{value:0}),42,'a collapsed range is a constant');
  assert.equal(output(component,{min:0,max:Number.MAX_VALUE,step:Number.MAX_VALUE},{value:Number.MAX_VALUE}),Number.MAX_VALUE);
  assert.equal(output(component,{min:0,max:1e-101,step:1e-102},{value:3e-102}),3e-102);
  for(const invalid of [{min:2,max:1},{step:0},{step:-1},{min:NaN},{max:Infinity},{step:NaN},{min:-Number.MAX_VALUE,max:Number.MAX_VALUE},{step:Number.MIN_VALUE}]){
    assert.throws(()=>output(component,invalid),/finite|Minimum|Step|range/);
  }
});

test('Math adds minimum and maximum without losing arithmetic validation',()=>{
  const component=source('math');
  assert.equal(output(component,{a:-3,b:8,operation:'min'}),-3);
  assert.equal(output(component,{a:-3,b:8,operation:'max'}),8);
  assert.equal(output(component,{a:8,b:3}),11);
  assert.equal(output(component,{a:8,b:3,operation:'−'}),5);
  assert.equal(output(component,{a:8,b:3,operation:'×'}),24);
  assert.equal(output(component,{a:8,b:2,operation:'÷'}),4);
  assert.throws(()=>output(component,{a:1,b:0,operation:'÷'}),/zero/);
  assert.throws(()=>output(component,{a:Number.MAX_VALUE,b:2,operation:'×'}),/overflow/);
  assert.throws(()=>output(component,{a:Infinity,b:2,operation:'min'}),/finite/);
});

test('Clamp enforces a live interval and reports invalid bounds',()=>{
  const component=source('clamp');
  assert.equal(output(component,{value:-10}),0);
  assert.equal(output(component,{value:50}),50);
  assert.equal(output(component,{value:150}),100);
  assert.equal(output(component,{value:0,min:-20,max:-5}),-5);
  assert.equal(output(component,{value:100,min:7,max:7}),7);
  assert.throws(()=>output(component,{value:1,min:2,max:1}),/Minimum/);
  assert.throws(()=>output(component,{value:Infinity}),/finite/);
});

test('Range map supports clamping, extrapolation, and an inverted output range',()=>{
  const component=source('range-map');
  assert.equal(output(component,{value:50}),.5);
  assert.equal(output(component,{value:150}),1);
  assert.equal(output(component,{value:-50}),0);
  assert.equal(output(component,{value:150,clamp:false}),1.5);
  assert.equal(output(component,{value:25,outMin:50,outMax:-50}),25);
  assert.equal(output(component,{value:-10,inMin:-20,inMax:20,outMin:0,outMax:100}),25);
  assert.equal(output(component,{value:50,outMin:7,outMax:7}),7);
  for(const config of [{inMin:1,inMax:1},{inMin:2,inMax:1},{inMin:NaN},{outMax:Infinity},{clamp:1},{inMin:-Number.MAX_VALUE,inMax:Number.MAX_VALUE},{outMin:-Number.MAX_VALUE,outMax:Number.MAX_VALUE},{value:Number.MAX_VALUE,inMax:.1,clamp:false}]){
    assert.throws(()=>output(component,{value:50,...config}),/minimum|finite|boolean|range|overflow/);
  }
});

test('Number function handles sign and all rounding modes with deliberate half-toward-positive-infinity rounding',()=>{
  const component=source('number-function');
  assert.equal(output(component,{value:-7.5}),7.5);
  assert.equal(output(component,{value:2.5,operation:'round'}),3);
  assert.equal(output(component,{value:-2.5,operation:'round'}),-2);
  assert.equal(output(component,{value:-2.1,operation:'floor'}),-3);
  assert.equal(output(component,{value:-2.1,operation:'ceil'}),-2);
  assert.equal(Object.is(output(component,{value:-.1,operation:'ceil'}),-0),false);
  assert.throws(()=>output(component,{value:Infinity}),/finite/);
  assert.throws(()=>output(component,{value:2,operation:'sqrt'}),/Unsupported/);
});

test('Every numeric component shows its instance name and stays recognizable when disconnected',()=>{
  for(const name of ['compare','number-control','math','clamp','range-map','number-function']){
    const component=source(name),s=style(component),state=component.initState();
    const resolved=inputs(component,{value:80,a:4,b:2}),outputs=component.compute(resolved,state);
    const io={name:'Workshop sensor',inputs:resolved,outputs};
    const children=component.children(state,s,s.w,s.h,true,io);
    verifyGeometry(children,s.w,s.h);
    assert.equal(children.find(child=>child.type==='text').text,'Workshop sensor');
    const unavailable=component.unavailableChildren(state,s,s.w,s.h,true,{name:'Workshop sensor',error:'Missing value or binding for value'});
    verifyGeometry(unavailable,s.w,s.h);
    assert.equal(unavailable.find(child=>child.type==='text').text,'Workshop sensor');
    assert.ok(unavailable.some(child=>child.type==='text' && child.text==='—'));
    if(name!=='number-control'){
      assert.ok(unavailable.some(child=>child.type==='ellipse' && child.fillColor==='#fbbf24'));
      const hidden=component.dragEdit(state,'indicators').state;
      assert.equal(hidden.showIndicators,false);
      assert.equal(component.children(hidden,s,s.w,s.h,false,io).filter(child=>child.type==='ellipse').length,0);
      assert.ok(component.handles(state,s.w,s.h,s,io).every(handle=>handle.editorOnly));
    }
  }
});
