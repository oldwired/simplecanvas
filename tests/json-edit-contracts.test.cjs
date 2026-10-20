const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const plain=value=>JSON.parse(JSON.stringify(value));
const source=(globals={})=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples','json-edit.js'),'utf8'),globals);
function edit(text='{"name":""}',fields='/name:string',values={}){
  const def=source(),state={...def.initState(),fields},ports=def.inputs(state);
  const inputs={...Object.fromEntries(Object.entries(ports).map(([key,port])=>[key,port.default])),text,...values};
  const before=JSON.stringify({inputs,state}),result=plain(def.compute(inputs,state));
  assert.equal(JSON.stringify({inputs,state}),before,'editing leaves its input strings and settings unchanged');
  return result;
}
const invalid={text:'',valid:false};

test('JSON edit declares JSON text, typed positional edit inputs, and validity output',()=>{
  const def=source();
  assert.equal(def.apiVersion,2);
  assert.deepEqual(plain(def.outputs),{text:{type:'string',event:true},valid:{role:'control',type:'boolean',event:true}});
  assert.deepEqual(plain(def.inputs({...def.initState(),fields:'/name:string\n/score:number\n/active:boolean\n/details:json'})),{
    reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'},
    text:{type:'string',default:'{"name":""}',event:true},
    field0:{label:'/name',type:'string',default:''},
    field1:{label:'/score',type:'number',default:0},
    field2:{label:'/active',type:'boolean',default:false},
    field3:{label:'/details',type:'string',default:'null'}
  });
  assert.deepEqual(edit(),{text:'{"name":""}',valid:true});
  const before=plain(def.inputs({fields:'/name:string\n/score:number'}));
  const after=plain(def.inputs({fields:'/customer/name:string\n/total:number'}));
  assert.deepEqual(Object.keys(after),Object.keys(before));
  for(const key of Object.keys(before)){
    assert.equal(before[key].type,after[key].type);
    assert.equal(before[key].default,after[key].default);
  }
  assert.equal(after.field0.label,'/customer/name');
  assert.equal(after.field1.label,'/total');
  assert.equal(def.inputs({fields:':json'}).field0.label,'Root');
});

test('JSON edit replaces configured values and preserves untouched nested data semantically',()=>{
  const text=' { "name": "Anna", "score": 10, "active": true, "details": null, "untouched": {"items":[1,null,false,"ok"]} } ';
  const result=edit(text,'/name:string\n/score:number\n/active:boolean\n/details:json',{
    field0:'Tester "quoted"\n<script>',field1:2.8,field2:false,field3:'{"nested":[true,4.5]}'
  });
  assert.equal(result.valid,true);
  assert.deepEqual(JSON.parse(result.text),{
    name:'Tester "quoted"\n<script>',score:2.8,active:false,details:{nested:[true,4.5]},untouched:{items:[1,null,false,'ok']}
  });
  assert.equal(result.text,JSON.stringify(JSON.parse(result.text)),'serialization deliberately removes original whitespace');
  assert.deepEqual(edit('{"value":"old"}','/value:number',{field0:42}),{text:'{"value":42}',valid:true},'replacement type need not match the old JSON value');
});

test('JSON edit handles root replacements, including primitive roots and explicit nested JSON',()=>{
  for(const [fields,field0,text] of [[':string','new','"new"'],[':number',0,'0'],[':boolean',false,'false'],[':json','[1,null,{"x":true}]','[1,null,{"x":true}]']]){
    assert.deepEqual(edit('null',fields,{field0}),{text,valid:true});
  }
  assert.deepEqual(edit('"old"',':json',{field0:'null'}),{text:'null',valid:true});
  assert.deepEqual(edit('invalid',':json',{field0:'{}'}),invalid,'root replacement still requires a valid input JSON document');
});

test('JSON edit follows zero-based array paths and escaped pointer keys without splitting literal names',()=>{
  const text=JSON.stringify({items:[{title:'first'},{title:'second'}],'':{'':'empty'},'a/b':{'~key':'old'},'~1':'old','01':'old'});
  const result=edit(text,'/items/0/title:string\n/items/1/title:string\n//:string\n/a~1b/~0key:string\n/~01:string\n/01:string',{
    field0:'A',field1:'B',field2:'blank key',field3:'escaped',field4:'tilde one',field5:'object index'
  });
  assert.equal(result.valid,true);
  assert.deepEqual(JSON.parse(result.text),{items:[{title:'A'},{title:'B'}],'':{'':'blank key'},'a/b':{'~key':'escaped'},'~1':'tilde one','01':'object index'});
  assert.deepEqual(edit('[10,20,30]','/1:number',{field0:99}),{text:'[10,99,30]',valid:true});
  for(const pointer of ['/items/2','/items/01','/items/-1','/items/-','/items/length','/items/1.0','/items/+0','/items/1e0','/items/9007199254740992']){
    assert.deepEqual(edit(text,pointer+':string',{field0:'no'}),invalid,pointer);
  }
});

test('missing or non-traversable targets invalidate the whole edit without creating paths or partial JSON',()=>{
  for(const pointer of ['/absent','/absent/deep','/nil/x','/name/length','/value/x','/items/0/absent']){
    assert.deepEqual(edit('{"keep":"old","name":"Anna","value":3,"nil":null,"items":[{}]}','/keep:string\n'+pointer+':number',{field0:'changed',field1:42}),invalid,pointer);
  }
  assert.deepEqual(edit('{"a":1,"b":2}','/a:number\n/b:json',{field0:9,field1:'invalid'}),invalid);
  assert.deepEqual(edit('null','/a:string'),invalid);
  assert.deepEqual(edit('"text"','/0:string'),invalid);
});

test('JSON edit only traverses own properties and safely replaces explicit prototype-related keys',()=>{
  for(const pointer of ['/__proto__','/constructor','/toString','/hasOwnProperty'])assert.deepEqual(edit('{}',pointer+':json',{field0:'{"polluted":true}'}),invalid,pointer);
  const result=edit('{"__proto__":{"name":"old"},"constructor":42,"toString":"old","plain":true}',
    '/__proto__/name:string\n/constructor:number\n/toString:string',{field0:'own data',field1:7,field2:'literal'});
  assert.deepEqual(JSON.parse(result.text),JSON.parse('{"__proto__":{"name":"own data"},"constructor":7,"toString":"literal","plain":true}'));
  assert.deepEqual(edit('{"__proto__":null}','/__proto__:json',{field0:'{"polluted":true}'}),{text:'{"__proto__":{"polluted":true}}',valid:true});
  assert.equal({}.polluted,undefined);
  assert.deepEqual(edit('{"__proto__":{}}','/__proto__/constructor:json',{field0:'{}'}),invalid,'nested inherited properties remain inaccessible');
});

test('configuration rejects malformed pointers, duplicate paths, and ancestor overlaps in either order',()=>{
  const def=source();
  for(const fields of ['','\n\n',Array.from({length:9},(_,i)=>'/a'+i+':string').join('\n')])assert.throws(()=>def.inputs({fields}),/1–8 edits/);
  for(const fields of ['name:string','#/a:string','/~:string','/~2:string','/a~1b/~key:string','/x'+'a'.repeat(99)+':string','/a'])assert.throws(()=>def.inputs({fields}),/valid JSON Pointers/);
  for(const fields of ['/a:text','/a:object','/a:','/a:String[]'])assert.throws(()=>def.inputs({fields}),/string, number, boolean, or json/);
  for(const fields of ['/a:string\n/a:number','/a:string\n/a/b:string','/a/b:string\n/a:string',':json\n/a:string','/a:string\n:string','/a~1b:string\n/a~1b/c:string']){
    assert.throws(()=>def.inputs({fields}),/unique and must not overlap/,fields);
  }
  for(const fields of [null,4,{},'x'.repeat(2001)])assert.throws(()=>def.inputs({fields}),/2000 characters/);
  assert.doesNotThrow(()=>def.inputs({fields:'/a:string\n/ab:string\n/a~1b:string\n/~01:string\n/~1:string'}),'similar text is not an ancestor relationship');
  assert.deepEqual(edit('{"a":"old","b":3}',' /a : String \r\n\r\n /b : NUMBER ',{field0:'new',field1:12}),{text:'{"a":"new","b":12}',valid:true});
  assert.equal(def.inputs({fields:'/'+'a'.repeat(99)+':string'}).field0.label.length,100);
  const eight=Object.fromEntries(Array.from({length:8},(_,i)=>['key'+i,i]));
  assert.equal(edit(JSON.stringify(eight),Object.keys(eight).map(key=>'/'+key+':number').join('\n')).valid,true);
});

test('invalid JSON or nonfinite parsed numbers anywhere produce an invalid result',()=>{
  for(const text of ['','undefined','[1,]','{"a":1,}','{a:1}','NaN','Infinity','1e999','{"a":1,"untouched":1e999}','[0,-1e999]']){
    assert.deepEqual(edit(text,':json',{field0:'{}'}),invalid,text);
  }
  for(const field0 of ['','undefined','{','[1,]','1e999','{"x":[-1e999]}'])assert.deepEqual(edit('{"a":null}','/a:json',{field0}),invalid,field0);
  assert.deepEqual(edit('{"a":0}','/a:json',{field0:'1e-999'}),{text:'{"a":0}',valid:true});
});

test('all typed inputs are checked before recoverable invalid-data results and no coercion is applied',()=>{
  for(const field0 of [null,undefined,3,true])assert.throws(()=>edit('{"a":0}','/a:string',{field0}),/requires a string/);
  for(const field0 of [null,undefined,'3',NaN,Infinity,-Infinity])assert.throws(()=>edit('{"a":0}','/a:number',{field0}),/requires a finite number/);
  for(const field0 of [null,undefined,'false',0,1])assert.throws(()=>edit('{"a":0}','/a:boolean',{field0}),/requires a Boolean/);
  for(const text of [null,undefined,3,'x'.repeat(2001)])assert.throws(()=>edit('{}','/a:number',{text,field0:1}),/JSON text must be a string/);
  assert.throws(()=>edit('invalid','/a:json\n/b:number',{field0:'invalid',field1:Infinity}),/finite number/);
  assert.throws(()=>edit('{}','/a:string',{field0:'x'.repeat(2001)}),/at most 2000/,'missing paths do not mask overlong input strings');
});

test('JSON edit enforces UTF-16 input and serialized output limits including escaping expansion',()=>{
  assert.equal(edit('{"a":""}','/a:string',{field0:'x'.repeat(1992)}).text.length,2000);
  assert.throws(()=>edit('{"a":""}','/a:string',{field0:'x'.repeat(1993)}),/Output exceeds 2000/);
  assert.throws(()=>edit('{"a":""}','/a:string',{field0:'\n'.repeat(1000)}),/Output exceeds 2000/);
  assert.throws(()=>edit('{"a":""}','/a:string',{field0:'😀'.repeat(1001)}),/at most 2000/);
  assert.equal(edit('null',':string',{field0:'😀'.repeat(999)}).text.length,2000);
  assert.throws(()=>edit('null',':string',{field0:'\ud800'.repeat(400)}),/Output exceeds 2000/,'lone surrogates are escaped by JSON.stringify');
});

test('JSON edit rendering shows instance names and pointer summaries, respects styles and optional indicators',()=>{
  const def=source({JSON:{parse(){throw new Error('Rendering must not parse JSON');},stringify:JSON.stringify}}),state={...def.initState(),fields:'/name:string\n/score:number'},style=def.initStyle();
  const io={name:'Custom <b>name</b>',inputs:{text:'invalid'},outputs:{text:'<b>Hello</b>',valid:true}},before=JSON.stringify({state,style,io});
  for(const editing of [true,false]){
    const children=plain(def.children(state,style,style.w,style.h,editing,io));
    assert.ok(children.some(child=>child.text==='Custom <b>name</b>'));
    assert.ok(children.some(child=>child.text==='<b>Hello</b>'));
    assert.ok(children.some(child=>child.text==='/name · /score'));
    assert.ok(children.filter(child=>child.type==='text').every(child=>child.plainText===true));
    assert.ok(children.some(child=>child.type==='ellipse'));
  }
  const hidden=plain(def.children({...state,showIndicators:false},style,style.w,style.h,false,io));
  assert.equal(hidden.some(child=>child.type==='ellipse'||/^Valid:/.test(child.text||'')),false);
  const unavailable=plain(def.unavailableChildren(state,style,style.w,style.h,false,{...io,error:'Output exceeds 2000 characters'}));
  assert.ok(unavailable.some(child=>child.text?.startsWith('Output exceeds 2000')));
  const invalidChildren=plain(def.children(state,style,style.w,style.h,false,{...io,outputs:invalid}));
  assert.ok(invalidChildren.some(child=>child.text==='Invalid JSON or missing path'));
  const styled={...style,fill:false,strokeOn:false,color:'#f00',size:4,dash:'dash',textColor:'#123456',font:'400 18px serif'};
  const children=plain(def.children(state,styled,style.w,style.h,false,io));
  assert.deepEqual(children[0],{type:'rect',x:0,y:0,w:style.w,h:style.h,fill:false,fillColor:'#ffffff',strokeOn:false,color:'#f00',size:4,dash:'dash'});
  assert.equal(children.find(child=>child.text==='Custom <b>name</b>').color,'#123456');
  assert.match(children.find(child=>child.type==='text').font,/serif$/);
  assert.equal(JSON.stringify({state,style,io}),before);
});

test('JSON edit preview clipping keeps emoji and combining clusters whole',()=>{
  const def=source(),style=def.initStyle(),family='👨‍👩‍👧‍👦',accent='e\u0301';
  assert.deepEqual(plain(def._graphemes('A'+family+accent)),['A',family,accent]);
  assert.equal(def._text('A'+family+'BCD',0,0,31,20,10,style).text,'A'+family+'…');
  assert.deepEqual(plain(source({Intl:{}})._graphemes(family+accent)),[family+accent]);
});
