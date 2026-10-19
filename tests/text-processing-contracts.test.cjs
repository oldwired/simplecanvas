const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const plain=value=>JSON.parse(JSON.stringify(value));
const source=(name,globals={})=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'),globals);
const defaults=(def,state)=>Object.fromEntries(Object.entries(typeof def.inputs==='function'?def.inputs(state):def.inputs).map(([key,port])=>[key,port.default]));
function compute(name,input={},settings={}){
  const def=source(name),state={...def.initState(),...settings},inputs={...defaults(def,state),...input};
  const before=JSON.stringify({inputs,state}),result=plain(def.compute(inputs,state));
  assert.equal(JSON.stringify({inputs,state}),before,'computation leaves inputs and settings unchanged');
  return result;
}
const compose=(input,settings={})=>compute('text-compose',input,settings);
const transform=(text,operation='trim')=>compute('text-transform',{text,operation});
const replace=(text,search,replacement,settings={})=>compute('text-replace',{text,search,replacement},settings);

test('new text processors expose typed primitive ports and healthy defaults',()=>{
  for(const name of ['text-compose','text-transform','text-replace','text-selector']){
    const def=source(name),state=def.initState();
    assert.equal(def.apiVersion,2);assert.equal(def.settings.showIndicators.default,true);
    assert.equal(state.showIndicators,true);
    assert.equal(def.outputs.text.type,'string');
    assert.equal(compute(name).text,'');
  }
  const compose=source('text-compose'),state=compose.initState();
  assert.deepEqual(plain(compose.inputs(state)),{a:{type:'string',default:''},b:{type:'string',default:''},separator:{role:'control',type:'string',default:''}});
  const many=plain(compose.inputs({...state,inputCount:8,mode:'template'}));
  assert.deepEqual(Object.keys(many),['a','b','c','d','e','f','g','h','template']);
  assert.deepEqual(many.template,{role:'control',type:'string',default:'{a}{b}'});
  assert.deepEqual(plain(source('text-transform').outputs),{text:{type:'string'},length:{type:'number'},empty:{role:'control',type:'boolean'}});
  assert.deepEqual(plain(source('text-replace').outputs),{text:{type:'string'},count:{type:'number'}});
  assert.deepEqual(plain(source('text-selector').inputs),{a:{type:'string',default:''},b:{type:'string',default:''},select:{role:'control',type:'boolean',default:false}});
});

test('Text compose joins all configured slots including empty strings and preserves literal content',()=>{
  assert.deepEqual(compose({a:'A',b:'B'}),{text:'AB'});
  assert.deepEqual(compose({a:'A',b:'',c:'C',separator:' | '},{inputCount:3}),{text:'A |  | C'});
  assert.deepEqual(compose({a:'',b:'',separator:','}),{text:','});
  assert.deepEqual(compose({a:'😀',b:'$& {a}',separator:'\n'}),{text:'😀\n$& {a}'});
  assert.deepEqual(compose(Object.fromEntries('abcdefgh'.split('').map((key,i)=>[key,String(i)])),{inputCount:8}),{text:'01234567'});
  assert.deepEqual(compose({a:'x'.repeat(1000),b:'y'.repeat(1000)}),{text:'x'.repeat(1000)+'y'.repeat(1000)});
  assert.throws(()=>compose({a:'x'.repeat(1000),b:'y'.repeat(1000),separator:' '}),/Output exceeds 2000/);
});

test('Text compose templates support bounded literal substitutions, repeated inputs and escaped braces',()=>{
  const render=(template,inputs={},settings={})=>compose({a:'A',b:'B',template,...inputs},{mode:'template',...settings});
  assert.deepEqual(render('Temperature: {a} {b}',{a:'12.8',b:'°C'}),{text:'Temperature: 12.8 °C'});
  assert.deepEqual(render('{{{a}}} {{b}} {b} {a}'),{text:'{A} {b} B A'});
  assert.deepEqual(render('{a}',{a:'{b} $&',b:'never inserted'}),{text:'{b} $&'});
  assert.deepEqual(render('no placeholders'),{text:'no placeholders'});
  assert.deepEqual(render('{h}:{a}',{h:'H'},{inputCount:8}),{text:'H:A'});
  for(const template of ['{c}','{A}','{unknown}','{}','{a','a}','{a{b}','{'])assert.throws(()=>render(template),/placeholder|brace/i,template);
  assert.deepEqual(render('{a}{a}',{a:'x'.repeat(1000)}),{text:'x'.repeat(2000)});
  assert.throws(()=>render('{a}{a}{a}',{a:'x'.repeat(1000)}),/Output exceeds 2000/);
  for(const inputCount of [1,9,2.5,'2',NaN])assert.throws(()=>compose({}, {inputCount}),/whole number from 2 to 8/);
  assert.throws(()=>compose({}, {mode:'eval'}),/composition mode/);
});

test('Text transform trims or changes case and measures the resulting Unicode code points',()=>{
  assert.deepEqual(transform('  😀A\n'),{text:'😀A',length:2,empty:false});
  assert.deepEqual(transform(' \t\n\u00a0'),{text:'',length:0,empty:true});
  assert.deepEqual(transform('  ABC  ','lowercase'),{text:'  abc  ',length:7,empty:false});
  assert.deepEqual(transform('Straße','uppercase'),{text:'STRASSE',length:7,empty:false});
  assert.deepEqual(transform('İ','lowercase'),{text:'i\u0307',length:2,empty:false});
  assert.deepEqual(transform('a\u0301'),{text:'a\u0301',length:2,empty:false},'length counts code points, not grapheme clusters');
  assert.deepEqual(transform('ß'.repeat(1000),'uppercase'),{text:'SS'.repeat(1000),length:2000,empty:false});
  assert.throws(()=>transform('ß'.repeat(1001),'uppercase'),/Output exceeds 2000/);
  assert.throws(()=>transform('İ'.repeat(1001),'lowercase'),/Output exceeds 2000/);
  assert.throws(()=>transform('a','title case'),/text transformation/);
});

test('Text selector uses Boolean Select and validates both strings without mutating them',()=>{
  assert.deepEqual(compute('text-selector',{a:'Alpha',b:'Beta'}),{text:'Alpha'});
  assert.deepEqual(compute('text-selector',{a:'Alpha',b:'Beta',select:true}),{text:'Beta'});
  assert.deepEqual(compute('text-selector',{a:'',b:'<b>😀</b>',select:true}),{text:'<b>😀</b>'});
  for(const select of [0,1,'false',null,undefined])assert.throws(()=>compute('text-selector',{select}),/Select must be Boolean/);
  assert.throws(()=>compute('text-selector',{b:'x'.repeat(2001)}),/at most 2000/,'unselected input is still type checked');
});

test('literal replacement handles first/all, case, regex metacharacters and dollars literally',()=>{
  assert.deepEqual(replace('AaAa','Aa','!'),{text:'!!',count:2});
  assert.deepEqual(replace('AaAa','Aa','!',{occurrence:'first'}),{text:'!Aa',count:1});
  assert.deepEqual(replace('Aa aA','aa','!',{caseSensitive:false}),{text:'! !',count:2});
  assert.deepEqual(replace('Aa aA','aa','!'),{text:'Aa aA',count:0});
  assert.deepEqual(replace('[a].*+$[a].*+$','[a].*+$','$& $$ $1'),{text:'$& $$ $1$& $$ $1',count:2});
  assert.deepEqual(replace('😀😀','😀','x'),{text:'xx',count:2});
  assert.deepEqual(replace('İi','i','x',{caseSensitive:false}),{text:'İx',count:1},'native Unicode case-insensitive matching preserves source boundaries');
  assert.deepEqual(replace('abc','','x'),{text:'abc',count:0},'empty literal search is a healthy no-op');
  assert.deepEqual(replace('abc','z','x'),{text:'abc',count:0});
  assert.deepEqual(replace('aaaa','aa',''),{text:'',count:2});
});

test('regex replacement matches native JavaScript substitution semantics including empty and named captures',()=>{
  const fixtures=[
    ['abc abc','(a)(b)(c)'],['b b','(a)?(b)'],['a a','(a*)'],['abc','(?<first>a)(?<second>b)?'],
    ['b','(?<first>a)?b'],['abcdefghij','(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)'],
    ['😀ab','(?<=😀)(a)'],['abc','^|$'],['😀',''],['abc','(z)']
  ];
  const replacements=['$&','$$','$`',"$'",'$1/$2/$3','$0/$00/$01/$02/$09','$10/$11/$12/$99','$100/$101',
    '$<first>/$<second>/$<missing>/$<>','$<first', '$x/$', '[$&]:$1:$$', ''];
  for(const [text,search] of fixtures)for(const replacement of replacements)for(const occurrence of ['first','all']){
    let count=0;
    const flags=occurrence==='all'?'gu':'u';
    text.replace(new RegExp(search,flags),()=>{count++;return '';});
    const expected={text:text.replace(new RegExp(search,flags),replacement),count};
    assert.deepEqual(replace(text,search,replacement,{mode:'regex',occurrence}),expected,JSON.stringify({text,search,replacement,occurrence}));
  }
  assert.deepEqual(replace('ABC abc','abc','x',{mode:'regex',caseSensitive:false}),{text:'x x',count:2});
});

test('regex replacement advances by Unicode code point for empty matches and resets between calls',()=>{
  assert.deepEqual(replace('😀','',':',{mode:'regex'}),{text:':😀:',count:2});
  assert.deepEqual(replace('ab','(?=.)',':',{mode:'regex'}),{text:':a:b',count:2});
  assert.deepEqual(replace('','',':',{mode:'regex'}),{text:':',count:1});
  assert.deepEqual(replace('abc','^|$','',{mode:'regex'}),{text:'abc',count:2});
  assert.deepEqual(replace('abc','x','y',{mode:'regex'}),{text:'abc',count:0});
  const def=source('text-replace'),state={...def.initState(),mode:'regex'},input={text:'a a',search:'a',replacement:'x'};
  for(let i=0;i<3;i++)assert.deepEqual(plain(def.compute(input,state)),{text:'x x',count:2});
  assert.throws(()=>replace('a','(','x',{mode:'regex'}),/Invalid regular expression/);
});

test('replacement output is checked while expanding matches, prefixes and captures',()=>{
  assert.deepEqual(replace('a'.repeat(1000),'a','xy'),{text:'xy'.repeat(1000),count:1000});
  assert.throws(()=>replace('a'.repeat(1001),'a','xy'),/Output exceeds 2000/);
  assert.throws(()=>replace('a'.repeat(2000),'a','x'.repeat(2000)),/Output exceeds 2000/);
  assert.throws(()=>replace('a'.repeat(2000),'(a+)','$1$1',{mode:'regex'}),/Output exceeds 2000/);
  assert.throws(()=>replace('a'.repeat(2000),'a','$`',{mode:'regex'}),/Output exceeds 2000/);
  assert.throws(()=>replace('a'.repeat(2000),'a',"$'",{mode:'regex'}),/Output exceeds 2000/);
  assert.throws(()=>replace('a','a','x',{mode:'unknown'}),/matching mode/);
  assert.throws(()=>replace('a','a','x',{occurrence:'last'}),/first or all/);
});

test('all text processors validate typed strings and the 2000 UTF-16-unit boundary',()=>{
  const checks=[['text-compose','a'],['text-compose','b'],['text-compose','separator'],['text-transform','text'],['text-replace','text'],['text-replace','search'],['text-replace','replacement'],['text-selector','a'],['text-selector','b']];
  for(const [name,key] of checks)for(const value of [null,42,true,{},undefined,'😀'.repeat(1001)]){
    assert.throws(()=>compute(name,{[key]:value}),/string.*2000|strings.*2000/,name+' '+key);
  }
  assert.throws(()=>compose({template:'x'.repeat(2001)},{mode:'template'}),/at most 2000/);
  assert.deepEqual(transform('😀'.repeat(1000)),{text:'😀'.repeat(1000),length:1000,empty:false});
});

test('processors draw custom names, literal output and optional indicators without executing user regex',()=>{
  const forbidden=function(){throw new Error('User regular expressions must only run in compute');};
  for(const name of ['text-compose','text-transform','text-replace','text-selector']){
    const def=source(name,{RegExp:forbidden}),state=def.initState(),style=def.initStyle();
    const io={name:'Custom <b>name</b>',inputs:{search:'(',operation:'uppercase',select:true},outputs:{text:'<b>😀</b>',length:8,empty:false,count:2}};
    const before=JSON.stringify({state,style,io});
    if(typeof def.inputs==='function')assert.ok(def.inputs(state));
    for(const editing of [true,false]){
      const children=plain(def.children(state,style,style.w,style.h,editing,io));
      assert.ok(children.some(child=>child.text==='Custom <b>name</b>'));
      assert.ok(children.some(child=>child.text==='<b>😀</b>'));
      assert.ok(children.filter(child=>child.type==='text').every(child=>child.plainText===true));
      assert.ok(children.some(child=>child.type==='ellipse'));
    }
    assert.equal(JSON.stringify({state,style,io}),before);
    const hidden=plain(def.children({...state,showIndicators:false},style,style.w,style.h,false,io));
    assert.equal(hidden.some(child=>child.type==='ellipse'),false);
    assert.equal(hidden.some(child=>/^(Output|Length|Replacements|Selected):/.test(child.text||'')),false);
    const failure=plain(def.unavailableChildren(state,style,style.w,style.h,false,{...io,error:'Invalid regular expression: <script>'}));
    assert.ok(failure.some(child=>child.text?.startsWith('Invalid regular expression:')));
    const styled={...style,fill:false,strokeOn:false,color:'#f00',size:4,dash:'dash',textColor:'#123456',font:'400 18px serif'};
    const children=plain(def.children(state,styled,style.w,style.h,false,io));
    assert.deepEqual(children[0],{type:'rect',x:0,y:0,w:style.w,h:style.h,fill:false,fillColor:'#ffffff',strokeOn:false,color:'#f00',size:4,dash:'dash'});
    assert.equal(children.find(child=>child.text==='Custom <b>name</b>').color,'#123456');
    assert.match(children.find(child=>child.type==='text').font,/serif$/);
  }
});
