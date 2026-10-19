const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const plain=value=>JSON.parse(JSON.stringify(value));
const source=(name,globals={})=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'),globals);
function compute(name,input={},settings={}){
  const def=source(name),state={...def.initState(),...settings},ports=typeof def.inputs==='function'?def.inputs(state):def.inputs;
  const inputs={...Object.fromEntries(Object.entries(ports).map(([key,port])=>[key,port.default])),...input};
  const before=JSON.stringify({inputs,state}),result=plain(def.compute(inputs,state));
  assert.equal(JSON.stringify({inputs,state}),before,'computation is pure');
  return result;
}
const extract=(text,pointer='',resultType='string')=>compute('json-extract',{text,pointer},{resultType});
const build=(fields,input={})=>compute('json-build',input,{fields});

test('JSON components declare typed ports and all configured builder inputs are independent',()=>{
  const extractDef=source('json-extract'),buildDef=source('json-build');
  assert.equal(extractDef.apiVersion,2);assert.equal(buildDef.apiVersion,2);
  assert.deepEqual(plain(extractDef.inputs),{text:{type:'string',default:'""'},pointer:{role:'control',type:'string',default:''}});
  for(const resultType of ['string','number','boolean','JSON'])assert.deepEqual(plain(extractDef.outputs({resultType})),{
    value:{type:resultType==='JSON'?'string':resultType},found:{role:'control',type:'boolean'},valid:{role:'control',type:'boolean'}
  });
  assert.deepEqual(plain(buildDef.inputs({fields:'name:string\ncount:number\nactive:boolean\nitems:json'})),{
    field0:{label:'name',type:'string',default:''},field1:{label:'count',type:'number',default:0},field2:{label:'active',type:'boolean',default:false},field3:{label:'items',type:'string',default:'null'}
  });
  assert.deepEqual(compute('json-build'),{text:'{"name":"","value":0}',valid:true});
  assert.deepEqual(compute('json-extract'),{value:'',found:true,valid:true});
  assert.throws(()=>extractDef.outputs({resultType:'object'}),/result type/);
});

test('JSON build labels follow field names while connection IDs remain stable for a same-slot rename',()=>{
  const def=source('json-build');
  const before=plain(def.inputs({fields:'name:string\namount:number'}));
  const after=plain(def.inputs({fields:'customer name:string\ntotal:number'}));
  assert.deepEqual(Object.keys(after),Object.keys(before));
  for(const key of Object.keys(before)){
    assert.equal(after[key].type,before[key].type);
    assert.equal(after[key].default,before[key].default);
  }
  assert.equal(after.field0.label,'customer name');
  assert.equal(after.field1.label,'total');
  const values={field0:'Anna',field1:42};
  assert.deepEqual(JSON.parse(build('name:string\namount:number',values).text),{name:'Anna',amount:42});
  assert.deepEqual(JSON.parse(build('customer name:string\ntotal:number',values).text),{'customer name':'Anna',total:42});
  const literal=plain(def.inputs({fields:'<b>name</b>:string\n__proto__:json'}));
  assert.equal(literal.field0.label,'<b>name</b>');
  assert.equal(literal.field1.label,'__proto__');
});

test('JSON extract strictly selects string, finite number, Boolean, or serialized JSON without coercion',()=>{
  const text='{"name":"A","value":2.8,"enabled":false,"empty":"","nil":null,"nested":{"a":[1,true]}}';
  assert.deepEqual(extract(text,'/name'),{value:'A',found:true,valid:true});
  assert.deepEqual(extract(text,'/value','number'),{value:2.8,found:true,valid:true});
  assert.deepEqual(extract(text,'/enabled','boolean'),{value:false,found:true,valid:true});
  assert.deepEqual(extract(text,'/empty'),{value:'',found:true,valid:true});
  assert.deepEqual(extract(text,'/nil','JSON'),{value:'null',found:true,valid:true});
  assert.deepEqual(extract(text,'/nested','JSON'),{value:'{"a":[1,true]}',found:true,valid:true});
  assert.deepEqual(extract(text,'/name','JSON'),{value:'"A"',found:true,valid:true});
  assert.deepEqual(extract('  "Root"  '),{value:'Root',found:true,valid:true});
  assert.deepEqual(extract('12.345','','number'),{value:12.345,found:true,valid:true});
  assert.deepEqual(extract('true','','boolean'),{value:true,found:true,valid:true});
  assert.deepEqual(extract(text,'/value'),{value:'',found:true,valid:false});
  assert.deepEqual(extract(text,'/name','number'),{value:0,found:true,valid:false});
  assert.deepEqual(extract(text,'/nil','boolean'),{value:false,found:true,valid:false});
  assert.deepEqual(extract(text,'/missing'),{value:'',found:false,valid:false});
  assert.deepEqual(extract(text,'/name/length','number'),{value:0,found:false,valid:false});
  assert.deepEqual(extract(text,'/nil/a'),{value:'',found:false,valid:false});
});

test('JSON Pointer supports zero-based arrays, empty object keys, and one-pass escaping',()=>{
  const text=JSON.stringify({items:[{title:'first'},{title:'second'}],'':{'':'empty'},'a/b':{'~key':'escaped'},'~1':'tilde one','01':'object key'});
  assert.deepEqual(extract(text,'/items/0/title'),{value:'first',found:true,valid:true});
  assert.deepEqual(extract(text,'/items/1/title'),{value:'second',found:true,valid:true});
  assert.deepEqual(extract(text,'//'),{value:'empty',found:true,valid:true});
  assert.deepEqual(extract(text,'/a~1b/~0key'),{value:'escaped',found:true,valid:true});
  assert.deepEqual(extract(text,'/~01'),{value:'tilde one',found:true,valid:true});
  assert.deepEqual(extract(text,'/01'),{value:'object key',found:true,valid:true});
  for(const pointer of ['/items/2','/items/01','/items/-1','/items/-','/items/length','/items/1.0','/items/+0','/items/1e0']){
    assert.deepEqual(extract(text,pointer),{value:'',found:false,valid:false},pointer);
  }
  for(const pointer of ['name','#/items/0','/~','/~2','/a~1b/~key'])assert.deepEqual(extract(text,pointer),{value:'',found:false,valid:false},pointer);
});

test('JSON extraction never traverses inherited properties but permits explicitly supplied JSON keys',()=>{
  for(const pointer of ['/__proto__','/constructor','/toString','/hasOwnProperty'])assert.deepEqual(extract('{}',pointer,'JSON'),{value:'',found:false,valid:false});
  const text='{"__proto__":{"name":"own data"},"constructor":42,"toString":"literal"}';
  assert.deepEqual(extract(text,'/__proto__/name'),{value:'own data',found:true,valid:true});
  assert.deepEqual(extract(text,'/constructor','number'),{value:42,found:true,valid:true});
  assert.deepEqual(extract(text,'/toString'),{value:'literal',found:true,valid:true});
});

test('invalid JSON and overflowing JSON numbers produce an invalid result with typed fallbacks',()=>{
  for(const text of ['', 'undefined','[1,]','{"a":1,}','{a:1}','NaN','Infinity','1e999','{"value":1e999}','[0,-1e999]']){
    for(const [resultType,value] of [['string',''],['JSON',''],['number',0],['boolean',false]])assert.deepEqual(extract(text,'',resultType),{value,found:false,valid:false},text);
  }
  assert.deepEqual(extract('1e-999','','number'),{value:0,found:true,valid:true});
});

test('JSON build escapes field names and strings, preserves nested values, and does not evaluate content',()=>{
  const input={field0:'A "quoted" line\n<script>\\',field1:2.8,field2:true,field3:'{"items":[null,false,3],"__proto__":{"polluted":true}}'};
  const result=build('label:string\nvalue:number\nactive:boolean\ndata:json',input);
  assert.equal(result.valid,true);
  assert.deepEqual(JSON.parse(result.text),{label:input.field0,value:2.8,active:true,data:JSON.parse(input.field3)});
  assert.equal({}.polluted,undefined);
  assert.deepEqual(build('constructor:string\n__proto__:json',{field0:'literal',field1:'{"ok":true}'}),{text:'{"constructor":"literal","__proto__":{"ok":true}}',valid:true});
  assert.deepEqual(build('a:b:string\n"quoted":string',{field0:'$& {a}',field1:''}),{text:'{"a:b":"$& {a}","\\"quoted\\"":""}',valid:true});
  assert.deepEqual(build('single:json',{field0:'[1,true,null,"a"]'}),{text:'{"single":[1,true,null,"a"]}',valid:true});
  const fields=Array.from({length:8},(_,i)=>'key'+i+':number').join('\n');
  assert.deepEqual(JSON.parse(build(fields,Object.fromEntries(Array.from({length:8},(_,i)=>['field'+i,i]))).text),Object.fromEntries(Array.from({length:8},(_,i)=>['key'+i,i])));
});

test('builder settings reject duplicates, excess fields, ambiguous types and excessive names',()=>{
  for(const fields of ['', '\n\n',Array.from({length:9},(_,i)=>'a'+i+':string').join('\n')])assert.throws(()=>build(fields),/1–8 fields/);
  for(const fields of ['a:string\na:number','a:string\n a :number',':string','name','x'.repeat(101)+':string'])assert.throws(()=>build(fields),/names must be unique/);
  for(const fields of ['name:text','name:object','name:','name:String[]'])assert.throws(()=>build(fields),/must use string, number, boolean, or json/);
  assert.throws(()=>build('a'.repeat(2001)),/2000 characters/);
  assert.deepEqual(build(' name : String \r\n\r\n value : NUMBER ',{field0:'A',field1:12}),{text:'{"name":"A","value":12}',valid:true});
});

test('builder invalid nested JSON is a recoverable signal but invalid typed inputs and oversized output are errors',()=>{
  for(const field0 of ['','undefined','{','[1,]','1e999','{"x":[-1e999]}'])assert.deepEqual(build('data:json',{field0}),{text:'',valid:false});
  for(const field0 of [null,undefined,3,true])assert.throws(()=>build('a:string',{field0}),/requires a string/);
  for(const field0 of [null,undefined,'3',NaN,Infinity,-Infinity])assert.throws(()=>build('a:number',{field0}),/requires a finite number/);
  for(const field0 of [null,undefined,'false',0,1])assert.throws(()=>build('a:boolean',{field0}),/requires a Boolean/);
  assert.throws(()=>build('a:json\nb:number',{field0:'invalid',field1:Infinity}),/finite number/,'all port types are checked before nested JSON parsing');
  assert.equal(build('a:string',{field0:'x'.repeat(1992)}).text.length,2000);
  assert.throws(()=>build('a:string',{field0:'x'.repeat(1993)}),/Output exceeds 2000/);
  assert.throws(()=>build('a:string',{field0:'\n'.repeat(1000)}),/Output exceeds 2000/,'escaping counts towards the string port limit');
});

test('string input bounds use UTF-16 units and JSON serialization expansion is checked',()=>{
  for(const [text,pointer] of [['"'+'x'.repeat(1999)+'"',''],['{}','x'.repeat(2001)],[null,''],['{}',null]])assert.throws(()=>extract(text,pointer),/strings of at most 2000/);
  assert.equal(extract('"'+'😀'.repeat(999)+'"').value,'😀'.repeat(999));
  assert.throws(()=>build('a:string',{field0:'😀'.repeat(1001)}),/at most 2000/);
  const loneSurrogates='"'+'\ud800'.repeat(400)+'"';
  assert.throws(()=>extract(loneSurrogates,'','JSON'),/Output exceeds 2000/,'JSON.stringify escapes lone surrogate units');
});

test('JSON visuals show custom names, literal text, optional indicators and style without parsing user JSON',()=>{
  const noParse={parse(){throw new Error('Rendering must not parse user JSON');},stringify:JSON.stringify};
  for(const name of ['json-extract','json-build']){
    const def=source(name,{JSON:noParse}),state=def.initState(),style=def.initStyle();
    const io={name:'Custom <b>name</b>',inputs:{text:'invalid',pointer:'/label'},outputs:{value:'<b>Hello</b>',text:'<b>Hello</b>',found:true,valid:true}};
    const before=JSON.stringify({state,style,io});
    for(const editing of [true,false]){
      const children=plain(def.children(state,style,style.w,style.h,editing,io));
      assert.ok(children.some(child=>child.text==='Custom <b>name</b>'));
      assert.ok(children.some(child=>child.text==='<b>Hello</b>'));
      assert.ok(children.filter(child=>child.type==='text').every(child=>child.plainText===true));
      assert.ok(children.some(child=>child.type==='ellipse'));
    }
    const hidden=plain(def.children({...state,showIndicators:false},style,style.w,style.h,false,io));
    assert.equal(hidden.some(child=>child.type==='ellipse'),false);
    assert.equal(hidden.some(child=>/^(Found|Valid):/.test(child.text||'')),false);
    const failure=plain(def.unavailableChildren(state,style,style.w,style.h,false,{...io,error:'Output exceeds 2000 characters'}));
    assert.ok(failure.some(child=>child.text?.startsWith('Output exceeds 2000')));
    assert.equal(JSON.stringify({state,style,io}),before);
    const styled={...style,fill:false,strokeOn:false,color:'#f00',size:4,dash:'dash',textColor:'#123456',font:'400 18px serif'};
    const children=plain(def.children(state,styled,style.w,style.h,false,io));
    assert.deepEqual(children[0],{type:'rect',x:0,y:0,w:style.w,h:style.h,fill:false,fillColor:'#ffffff',strokeOn:false,color:'#f00',size:4,dash:'dash'});
    assert.equal(children.find(child=>child.text==='Custom <b>name</b>').color,'#123456');
    assert.match(children.find(child=>child.type==='text').font,/serif$/);
  }
});

test('JSON and date preview clipping preserves complete emoji and combining-character clusters',()=>{
  const family='👨‍👩‍👧‍👦',accent='e\u0301';
  for(const name of ['json-extract','json-build','date-parse','date-format','date-difference']){
    const def=source(name),style=def.initStyle();
    assert.deepEqual(plain(def._graphemes('A'+family+accent)),['A',family,accent]);
    assert.equal(def._text('A'+family+'BCD',0,0,31,20,10,style).text,'A'+family+'…');
    const fallback=source(name,{Intl:{}});
    assert.deepEqual(plain(fallback._graphemes(family+accent)),[family+accent],'older engines keep previews whole instead of splitting a cluster');
  }
});
