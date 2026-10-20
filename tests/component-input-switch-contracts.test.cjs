const {parseApp}=require('./helpers/app-source.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const context=vm.createContext({});
vm.runInContext(parseApp(html).declaration('nextComponentBooleanInput')+'\nthis.toggle=nextComponentBooleanInput;',context);
const record={caps:{inputs:{enabled:{type:'boolean',default:true}}}},handle={input:'enabled'};

test('Boolean switches change the actual unbound input literal and preserve independent input values',()=>{
  const item={componentApi:2,inputValues:{column:'Points'}},before=JSON.stringify(item);
  const next=context.toggle(item,handle,record);
  assert.deepEqual(JSON.parse(JSON.stringify(next)),{column:'Points',enabled:false});
  assert.equal(JSON.stringify(item),before,'validation prepares a change without mutating its owner');
  assert.equal(context.toggle({...item,inputValues:next},handle,record).enabled,true);
});

test('Boolean switches cannot override connections or write undeclared or differently typed inputs',()=>{
  const item={componentApi:2,inputValues:{enabled:true}};
  assert.throws(()=>context.toggle({...item,bindings:{enabled:{uid:'toggle',port:'value'}}},handle,record),/connected input/);
  assert.throws(()=>context.toggle({...item,componentApi:1},handle,record),/Boolean input/);
  assert.throws(()=>context.toggle(item,{input:'missing'},record),/Boolean input/);
  assert.throws(()=>context.toggle(item,handle,{caps:{inputs:{enabled:{type:'number'}}}}),/Boolean input/);
  assert.throws(()=>context.toggle({...item,inputValues:{enabled:'true'}},handle,record),/Boolean value/);
});
