const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const plain=value=>JSON.parse(JSON.stringify(value));
const source=(name,globals={})=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'),globals);
const defaults=(def,state)=>Object.fromEntries(Object.entries(typeof def.inputs==='function'?def.inputs(state):def.inputs).map(([key,port])=>[key,port.default]));
function compute(name,input={},settings={}){
  const def=source(name),state={...def.initState(),...settings},inputs={...defaults(def,state),...input},before=JSON.stringify({inputs,state});
  const result=plain(def.compute(inputs,state));
  assert.equal(JSON.stringify({inputs,state}),before,'calculation leaves inputs and state unchanged');
  return result;
}
const compare=(text,comparison,operation='equals',settings={})=>compute('text-compare',{text,compare:comparison,operation},settings).value;
const extract=(text,input={},settings={})=>compute('text-extract',{text,...input},settings);

test('Number to text converts finite numbers without rounding, grouping or locale formatting',()=>{
  const def=source('number-to-text');
  assert.equal(def.apiVersion,2);
  assert.deepEqual(plain(def.inputs),{value:{type:'number',default:0}});
  assert.deepEqual(plain(def.outputs),{text:{type:'string'}});
  assert.equal(def.settings.showIndicators.default,true);assert.equal(def.initState().showIndicators,true);
  for(const [value,text] of [
    [0,'0'],[-0,'0'],[42,'42'],[-2.8,'-2.8'],[1234567.89,'1234567.89'],
    [.1+.2,'0.30000000000000004'],[Number.MAX_SAFE_INTEGER,'9007199254740991'],
    [Number.MAX_SAFE_INTEGER+1,'9007199254740992'],[1e21,'1e+21'],[1e-7,'1e-7'],
    [Number.MIN_VALUE,'5e-324'],[Number.MAX_VALUE,'1.7976931348623157e+308']
  ])assert.deepEqual(compute('number-to-text',{value}),{text},String(value));
  for(const value of [NaN,Infinity,-Infinity,'2.8',null,undefined,true,{}]){
    assert.throws(()=>def.compute({value},def.initState()),/finite number/i);
  }
});

test('text operations declare bounded primitive ports and configurable modes',()=>{
  const compare=source('text-compare'),extract=source('text-extract');
  for(const def of [compare,extract]){
    assert.equal(def.apiVersion,2);assert.equal(def.settings.caseSensitive.default,true);assert.equal(def.settings.showIndicators.default,true);
    assert.equal(def.initState().showIndicators,true);assert.equal(def.initState().caseSensitive,true);
  }
  assert.deepEqual(plain(compare.outputs),{value:{type:'boolean'}});
  assert.deepEqual(plain(compare.inputs),{text:{type:'string',default:''},compare:{type:'string',default:''},operation:{role:'control',type:'string',default:'equals',options:['equals','not equals','starts with','ends with','contains','matches regex']}});
  assert.deepEqual(plain(extract.outputs),{text:{type:'string'},found:{role:'control',type:'boolean'}});
  assert.deepEqual(plain(extract.inputs(extract.initState())),{text:{type:'string',default:''},start:{role:'control',type:'number',default:0},length:{role:'control',type:'number',default:1}});
  assert.deepEqual(plain(extract.inputs({mode:'regex match'})),{text:{type:'string',default:''},pattern:{role:'control',type:'string',default:''}});
  assert.deepEqual(plain(extract.inputs({mode:'regex capture'})),{text:{type:'string',default:''},pattern:{role:'control',type:'string',default:''},group:{role:'control',type:'number',default:0}});
  assert.throws(()=>extract.inputs({mode:'unsupported'}),/extraction mode/);
});

test('literal comparisons handle all operations, empty strings, and locale-neutral case folding',()=>{
  for(const [text,comparison,operation,expected] of [
    ['hello','hello','equals',true],['hello','Hello','equals',false],['hello','Hello','not equals',true],['hello','hello','not equals',false],
    ['hello','he','starts with',true],['hello','el','starts with',false],['hello','lo','ends with',true],['hello','el','ends with',false],
    ['hello','ell','contains',true],['hello','ell!','contains',false],['hello','.*','contains',false],
    ['','','equals',true],['hello','','starts with',true],['hello','','ends with',true],['hello','','contains',true],
    ['  hello','hello','equals',false],['hello\n','hello','equals',false]
  ])assert.equal(compare(text,comparison,operation),expected,JSON.stringify([text,comparison,operation]));
  for(const operation of ['equals','starts with','ends with','contains'])assert.equal(compare('Älpha','ÄLPHA',operation,{caseSensitive:false}),true,operation);
  assert.equal(compare('Älpha','ÄLPHA','not equals',{caseSensitive:false}),false);
  assert.equal(compare('ß','SS','equals',{caseSensitive:false}),false,'case folding is locale-neutral lowercase, not collation');
  assert.throws(()=>compare('a','a','unknown'),/supported text comparison/);
});

test('regex comparison requires the entire input, including trailing line terminators and alternatives',()=>{
  for(const [text,pattern,expected] of [
    ['order-123','order-\\d+',true],['xorder-123','order-\\d+',false],['order-123x','order-\\d+',false],
    ['a\n','a',false],['a\r\n','a$',false],['a\u2028','a',false],['a\n','a\\n',true],
    ['ab','a|ab',true],['a','ab|a',true],['abx','a|ab',false],['','',true],['a','',false],
    ['😀','.',true],['😀😀','.',false],['Ångström','\\p{L}+',true],['1','\\p{L}+',false]
  ])assert.equal(compare(text,pattern,'matches regex'),expected,JSON.stringify([text,pattern]));
  assert.equal(compare('ORDER-123','order-\\d+','matches regex'),false);
  assert.equal(compare('ORDER-123','order-\\d+','matches regex',{caseSensitive:false}),true);
  for(const pattern of ['[','(','\\','a)|(?:b'])assert.throws(()=>compare('ab',pattern,'matches regex'),/Invalid regular expression/,'validate raw pattern before full-match wrapping');
});

test('range extraction has predictable zero-based boundaries in code-point mode',()=>{
  for(const [text,start,length,expected] of [
    ['A😀BC',1,1,{text:'😀',found:true}],['A😀BC',2,2,{text:'BC',found:true}],['A😀BC',1,2000,{text:'😀BC',found:true}],
    ['abc',3,1,{text:'',found:true}],['abc',4,1,{text:'',found:false}],['abc',1,0,{text:'',found:true}],
    ['',0,1,{text:'',found:true}],['',1,0,{text:'',found:false}],['a\u0301',1,1,{text:'\u0301',found:true}]
  ])assert.deepEqual(extract(text,{start,length},{characterMode:'code points'}),expected,JSON.stringify([text,start,length]));
  for(const key of ['start','length'])for(const value of [-1,.5,NaN,Infinity,2001,'1',null])assert.throws(()=>extract('abc',{[key]:value}),/whole number from 0 to 2000/);
});

test('regex extraction returns the first whole match without retaining lastIndex across calls',()=>{
  const def=source('text-extract'),state={...def.initState(),mode:'regex match'},inputs={text:'x order-123; order-456',pattern:'order-\\d+'};
  for(let i=0;i<3;i++)assert.deepEqual(plain(def.compute(inputs,state)),{text:'order-123',found:true});
  assert.deepEqual(extract('abc',{pattern:'\\d+'},{mode:'regex match'}),{text:'',found:false});
  assert.deepEqual(extract('abc',{pattern:'^'},{mode:'regex match'}),{text:'',found:true});
  assert.deepEqual(extract('😀x',{pattern:'.'},{mode:'regex match'}),{text:'😀',found:true});
  assert.deepEqual(extract('ABC',{pattern:'abc'},{mode:'regex match'}),{text:'',found:false});
  assert.deepEqual(extract('ABC',{pattern:'abc'},{mode:'regex match',caseSensitive:false}),{text:'ABC',found:true});
  assert.deepEqual(extract('abc',{pattern:''},{mode:'regex match'}),{text:'',found:true});
});

test('regex capture is zero-based and distinguishes empty, missing, and unmatched optional captures',()=>{
  const capture=(text,pattern,group=0)=>extract(text,{pattern,group},{mode:'regex capture'});
  assert.deepEqual(capture('x order-123','(order)-(\\d+)'),{text:'order',found:true});
  assert.deepEqual(capture('x order-123','(order)-(\\d+)',1),{text:'123',found:true});
  assert.deepEqual(capture('b','(a)?b'),{text:'',found:false});
  assert.deepEqual(capture('b','(a*)b'),{text:'',found:true});
  assert.deepEqual(capture('cat','(\\d+)'),{text:'',found:false});
  assert.deepEqual(capture('abc','(?<first>a)(bc)',0),{text:'a',found:true});
  assert.throws(()=>capture('abc','abc'),/Capture group 0 does not exist/);
  assert.throws(()=>capture('abc','(abc)',1),/Capture group 1 does not exist/);
  for(const group of [-1,.1,NaN,Infinity,2001,'0',null])assert.throws(()=>capture('abc','(abc)',group),/Capture group must be a whole number/);
});

test('invalid patterns and oversized values are errors, while ordinary nonmatches are valid',()=>{
  for(const mode of ['regex match','regex capture']){
    assert.throws(()=>extract('a',{pattern:'('},{mode}),/Invalid regular expression/);
    assert.throws(()=>extract('a',{pattern:9},{mode}),/Pattern must be a string/);
    assert.throws(()=>extract('a',{pattern:'x'.repeat(2001)},{mode}),/at most 2000/);
  }
  for(const value of [null,12,{},'x'.repeat(2001)]){
    assert.throws(()=>compute('text-compare',{text:value}),/strings of at most 2000/);
    assert.throws(()=>compute('text-compare',{compare:value}),/strings of at most 2000/);
    assert.throws(()=>extract(value),/string of at most 2000/);
  }
  assert.equal(compare('x'.repeat(2000),'x'.repeat(2000)),true);
  assert.deepEqual(extract('x'.repeat(2000),{start:0,length:2000}),{text:'x'.repeat(2000),found:true});
  assert.throws(()=>source('text-extract').compute({text:''},{mode:'unsupported'}),/supported extraction mode/);
});

test('drawing and capability discovery never compile user-supplied regular expressions',()=>{
  const forbidden=function(){throw new Error('Regex must only run in compute');};
  for(const name of ['text-compare','text-extract']){
    const def=source(name,{RegExp:forbidden}),state={...def.initState(),mode:'regex capture'},style=def.initStyle();
    if(typeof def.inputs==='function')assert.ok(def.inputs(state).pattern);
    const io={name:'Literal <b>name</b>',inputs:{text:'abc',compare:'(',operation:'matches regex',pattern:'(',group:0},outputs:name==='text-compare'?{value:false}:{text:'<b>x</b>',found:true}};
    const before=JSON.stringify({state,style,io});
    for(const editing of [true,false]){
      const children=plain(def.children(state,style,style.w,style.h,editing,io));
      assert.ok(children.some(child=>child.text==='Literal <b>name</b>'),'show the component instance name');
      assert.ok(children.filter(child=>child.type==='text').every(child=>child.plainText===true),'names, output text and diagnostics remain literal');
      if(name==='text-extract')assert.ok(children.some(child=>child.text==='<b>x</b>'));
    }
    assert.equal(JSON.stringify({state,style,io}),before,'rendering leaves state, style and io unchanged');
    const failure=plain(def.unavailableChildren(state,style,style.w,style.h,false,{...io,error:'Invalid regular expression: <script>'}));
    assert.ok(failure.some(child=>child.text?.startsWith('Invalid regular expression:')));
    const hidden=plain(def.children({...state,showIndicators:false},style,style.w,style.h,false,io));
    assert.equal(hidden.some(child=>child.type==='ellipse'),false);
    assert.equal(hidden.some(child=>/^(Found|Output):/.test(child.text||'')),false);
    const styled={...style,fill:false,strokeOn:false,color:'#f00',size:4,dash:'dash',textColor:'#123456',font:'400 18px serif'};
    const children=plain(def.children(state,styled,style.w,style.h,false,io));
    assert.deepEqual(children[0],{type:'rect',x:0,y:0,w:style.w,h:style.h,fill:false,fillColor:'#ffffff',strokeOn:false,color:'#f00',size:4,dash:'dash'});
    assert.equal(children.find(child=>child.text==='Literal <b>name</b>').color,'#123456');
    assert.match(children.find(child=>child.type==='text').font,/serif$/);
  }
});

test('literal compare and range extraction do not depend on the regular expression constructor',()=>{
  const forbidden=function(){throw new Error('Unexpected regular expression construction');};
  const compare=source('text-compare',{RegExp:forbidden}),extract=source('text-extract',{RegExp:forbidden});
  assert.deepEqual(plain(compare.compute({text:'Alpha',compare:'ALPHA',operation:'equals'},{caseSensitive:false})),{value:true});
  assert.deepEqual(plain(extract.compute({text:'😀abc',start:0,length:1},{mode:'range'})),{text:'😀',found:true});
});
