const {parseApp}=require('./helpers/app-source.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const def=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../examples/url-parameter.js'),'utf8'),{URLSearchParams});
const plain=value=>JSON.parse(JSON.stringify(value));
const read=(query,overrides={})=>plain(def.compute({key:'name',index:0,fallback:'Guest',...overrides},def.initState(),{query}));
test('URL parameters decode Unicode, plus and escaped delimiters; preserve empty and repeated values',()=>{
  assert.equal(def.queryParameters,true);
  assert.deepEqual(read('?name=Zo%C3%AB+%26+co&name=second'),{value:'Zoë & co',found:true,count:2});
  assert.deepEqual(read('?name=first&name=second',{index:1}),{value:'second',found:true,count:2});
  assert.deepEqual(read('?name=first',{index:1}),{value:'Guest',found:false,count:1});
  assert.deepEqual(read('?name='),{value:'',found:true,count:1});
  assert.deepEqual(read('?name'),{value:'',found:true,count:1});
  assert.deepEqual(read('?Name=other'),{value:'Guest',found:false,count:0});
  assert.deepEqual(read(''),{value:'Guest',found:false,count:0});
  assert.deepEqual(read('?__proto__=literal',{key:'__proto__'}),{value:'literal',found:true,count:1});
  assert.deepEqual(read('?name=%3Cscript%3E%26%3D%2B'),{value:'<script>&=+',found:true,count:1});
  assert.deepEqual(read('?name=%ZZ'),{value:'%ZZ',found:true,count:1},'native forgiving URL decoding');
});
test('URL input is bounded and never changes saved state',()=>{
  const state=def.initState(),before=JSON.stringify(state);
  def.compute({key:'name',index:0,fallback:''},state,{query:'?name=not saved'});
  assert.equal(JSON.stringify(state),before);
  assert.throws(()=>read('?name='+'x'.repeat(2001)),/2000/);
  assert.throws(()=>read('x'.repeat(16001)),/16000/);
  assert.throws(()=>read('?'+Array(129).fill('a=b').join('&')),/128 parameters/);
  for(const index of [-1,.5,128,NaN,'0'])assert.throws(()=>read('',{index}),/Index/);
  assert.throws(()=>read('',{fallback:42}),/strings/);
});
test('URL parameter display uses literal text, custom names and optional status',()=>{
  const state=def.initState(),style=def.initStyle(),io={name:'Recipient',inputs:{key:'name',index:0},outputs:read('?name=Anna')};
  const children=plain(def.children(state,style,style.w,style.h,false,io));
  assert.ok(children.some(c=>c.text==='Recipient'));
  assert.ok(children.some(c=>c.text==='Anna'));
  assert.ok(children.filter(c=>c.type==='text').every(c=>c.plainText));
  assert.ok(children.some(c=>c.text?.startsWith('Found')));
  assert.ok(!def.children({...state,showIndicators:false},style,style.w,style.h,false,io).some(c=>c.text?.startsWith('Found')));
});

const appSource=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const queryBuilder=vm.runInNewContext('('+parseApp(appSource).declaration('prepareComponentNavigationQuery')+')',{URLSearchParams});
test('navigation parameters merge scalar fields, remove nulls, preserve unrelated values and set page',()=>{
  const query=queryBuilder(2,'{"name":"Anna & Zoë","score":2.5,"enabled":true,"remove":null}','?keep=yes&name=old&name=older&remove=x');
  assert.deepEqual([...new URLSearchParams(query)],[['keep','yes'],['name','Anna & Zoë'],['score','2.5'],['enabled','true'],['page','2']]);
  assert.equal(new URLSearchParams(queryBuilder(0,'{"__proto__":"literal"}','')).get('__proto__'),'literal');
  for(const text of ['[]','null','42','bad','{"page":1}','{"x":{}}','{"x":[]}','{"x":1e309}'])assert.throws(()=>queryBuilder(0,text,''),/Parameters|Parameter|parameter/);
  assert.throws(()=>queryBuilder(0,'{}','x'.repeat(16001)),/16000/);
  assert.throws(()=>queryBuilder(0,'{}','?'+Array.from({length:128},(_,i)=>'k'+i+'=1').join('&')),/128/);
});
