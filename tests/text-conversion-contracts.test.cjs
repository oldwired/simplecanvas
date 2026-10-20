const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const plain=value=>JSON.parse(JSON.stringify(value));
const source=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'));
function compute(name,input,settings={}){
  const def=source(name),state={...def.initState(),...settings},before=JSON.stringify({input,state});
  const result=def.compute(input,state);
  assert.equal(JSON.stringify({input,state}),before,'conversion leaves inputs and settings unchanged');
  return plain(result);
}
const parse=(text,settings)=>compute('text-to-number',{text},settings);
const format=(value,settings)=>compute('number-to-text',{value},settings).text;
const fixed=(value,settings)=>format(value,{format:'fixed decimals',...settings});

test('text conversion ports, settings and direct-call defaults have stable contracts',()=>{
  const parser=source('text-to-number'),formatter=source('number-to-text');
  for(const def of [parser,formatter])assert.equal(def.apiVersion,2);
  assert.deepEqual(plain(parser.inputs),{reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'},text:{type:'string',default:'',event:true}});
  assert.deepEqual(plain(parser.outputs),{value:{type:'number',event:true},valid:{role:'control',type:'boolean',event:true}});
  assert.deepEqual(plain(formatter.inputs),{reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'},value:{type:'number',default:0,event:true}});
  assert.deepEqual(plain(formatter.outputs),{text:{type:'string',event:true}});
  assert.deepEqual(plain(parser.initState()),{decimalSeparator:'.',trimWhitespace:true,showIndicators:true});
  assert.deepEqual(plain(formatter.initState()),{format:'full precision',decimals:2,minimumIntegerDigits:1,decimalSeparator:'.',showIndicators:true});
  assert.deepEqual(plain(parser.compute({text:'12.5'})),{value:12.5,valid:true});
  assert.deepEqual(plain(formatter.compute({value:.1+.2})),{text:'0.30000000000000004'});
  assert.deepEqual(plain(formatter.compute({value:12.5},{showIndicators:true})),{text:'12.5'});
});

test('text to number accepts complete signed decimal and exponent notation without truncating precision',()=>{
  for(const [text,value] of [
    ['0',0],['-0',0],['+0.00',0],['0012',12],['-2.8',-2.8],['+12.5',12.5],['.5',.5],['-.5',-.5],['2.',2],
    ['1e3',1000],['-1.5E-2',-.015],['+2e+3',2000],['.2e2',20],['1.e2',100],['5e-324',Number.MIN_VALUE],
    ['1.7976931348623157e308',Number.MAX_VALUE],['0.30000000000000004',.1+.2],['9007199254740991',Number.MAX_SAFE_INTEGER],
    ['1e-999',0],['\t 12.5\n',12.5],['\u00a0-3\u00a0',-3]
  ])assert.deepEqual(parse(text),{value,valid:true},JSON.stringify(text));
  assert.equal(Object.is(source('text-to-number').compute({text:'-0'}).value,-0),false);
  assert.equal(Object.is(source('text-to-number').compute({text:'-1e-999'}).value,-0),false);
  assert.deepEqual(parse('0'.repeat(1999)+'1'),{value:1,valid:true});
});

test('text to number rejects partials, nonfinite values, grouping and empty input with valid=false',()=>{
  for(const text of ['', ' ', '12abc', '12 abc', '1 2', '0x12', '0b10', '0o10', 'NaN', 'Infinity', '-Infinity', '1e309',
    '-1e309', '.', '+', '-', '+.','1e','1e+','1e-','--2','+-2','1_000','1,000','1.2.3','١٢','１２','12\0','12\nabc']){
    assert.deepEqual(parse(text),{value:0,valid:false},JSON.stringify(text));
  }
  for(const text of [' 12','12 ','12\n','12\r\n','12\u2028','\t12','\u00a012'])assert.deepEqual(parse(text,{trimWhitespace:false}),{value:0,valid:false},JSON.stringify(text));
  assert.deepEqual(parse('12',{trimWhitespace:false}),{value:12,valid:true});
});

test('decimal separator is explicit and never infers grouping or the other locale',()=>{
  for(const [text,value] of [['12,5',12.5],[',5',.5],['1,',1],['-1,5E+2',-150],['1,000',1],['0012',12]]){
    assert.deepEqual(parse(text,{decimalSeparator:','}),{value,valid:true},text);
  }
  for(const text of ['12.5','1.000,5','1,000,000','1,2.3'])assert.deepEqual(parse(text,{decimalSeparator:','}),{value:0,valid:false},text);
});

test('parser configuration and input contract errors are visible and do not poison subsequent conversion',()=>{
  const def=source('text-to-number'),state=def.initState();
  for(const text of [null,123,NaN,true,{},undefined,'x'.repeat(2001)])assert.throws(()=>def.compute({text},state),/string of at most 2000 characters/);
  for(const decimalSeparator of ['auto',';',null,1])assert.throws(()=>def.compute({text:'12'},{...state,decimalSeparator}),/dot or comma/);
  for(const trimWhitespace of ['false',null,1])assert.throws(()=>def.compute({text:'12'},{...state,trimWhitespace}),/on or off/);
  assert.deepEqual(plain(def.compute({text:'12abc'},state)),{value:0,valid:false});
  assert.deepEqual(plain(def.compute({text:'12.5'},state)),{value:12.5,valid:true});
});

test('full precision formatting remains JavaScript String conversion across the finite range',()=>{
  for(const value of [0,-0,.1+.2,-2.8,Number.MAX_SAFE_INTEGER,Number.MIN_VALUE,-Number.MIN_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE,1e21,1e-7]){
    assert.equal(format(value),String(value));
    assert.equal(format(value,{decimals:0,minimumIntegerDigits:20,decimalSeparator:','}),String(value),'fixed options have no effect in full precision mode');
    assert.deepEqual(parse(format(value)),{value:value===0?0:value,valid:true},'finite values round-trip through the default converter');
  }
});

test('fixed formatting rounds only output text, pads integer digits and substitutes the decimal separator',()=>{
  for(const [value,settings,text] of [
    [12.345,{},'12.35'],[-12.345,{},'-12.35'],[1.005,{},'1.01'],[.1+.2,{},'0.30'],
    [7,{minimumIntegerDigits:4},'0007.00'],[-7,{minimumIntegerDigits:4},'-0007.00'],
    [12.5,{decimalSeparator:','},'12,50'],[-12.5,{decimalSeparator:',',minimumIntegerDigits:5},'-00012,50'],
    [9.99,{decimals:0},'10'],[-9.99,{decimals:0},'-10'],
    [9.999,{decimals:2,minimumIntegerDigits:3},'010.00'],[0,{decimals:20,minimumIntegerDigits:20},'00000000000000000000.00000000000000000000']
  ])assert.equal(fixed(value,settings),text,JSON.stringify([value,settings]));
  for(const value of [-0,-.001,-Number.MIN_VALUE])assert.equal(fixed(value,{minimumIntegerDigits:3}),'000.00');
  assert.equal(fixed(-.005),'-0.01','only a result rounded to zero loses its minus sign');
});

test('fixed formatting handles extreme finite numbers without switching to exponential notation',()=>{
  for(const value of [1e21,1e100,Number.MAX_VALUE,-Number.MAX_VALUE]){
    const text=fixed(value);
    assert.match(text,/^-?\d+\.\d{2}$/);
    assert.ok(text.length<2000,'formatted text remains inside the string port limit');
    assert.equal(text.includes('e'),false);
    assert.equal(text.includes(','),false);
  }
  assert.equal(fixed(1e21),'1000000000000000000000.00');
  assert.equal(fixed(Number.MIN_VALUE,{decimals:20}),'0.00000000000000000000');
  assert.equal(fixed(-Number.MIN_VALUE,{decimals:20}),'0.00000000000000000000');
  assert.equal(fixed(Number.MAX_VALUE,{decimals:20}).split('.')[0].length,309);
});

test('formatter rejects invalid modes, bounds, separators and nonnumeric input, then recovers',()=>{
  const def=source('number-to-text'),state={...def.initState(),format:'fixed decimals'};
  for(const value of [NaN,Infinity,-Infinity,'12',null,true,undefined,{}])assert.throws(()=>def.compute({value},state),/finite number/);
  for(const format of ['other',null,1])assert.throws(()=>def.compute({value:12},{...state,format}),/supported number format/);
  for(const decimals of [-1,21,.5,NaN,Infinity,null,'2'])assert.throws(()=>def.compute({value:12},{...state,decimals}),/whole number from 0 to 20/);
  for(const minimumIntegerDigits of [0,21,1.5,NaN,Infinity,null,'2'])assert.throws(()=>def.compute({value:12},{...state,minimumIntegerDigits}),/whole number from 1 to 20/);
  for(const decimalSeparator of ['auto',';',null,1])assert.throws(()=>def.compute({value:12},{...state,decimalSeparator}),/dot or comma/);
  assert.deepEqual(plain(def.compute({value:12.5},state)),{text:'12.50'});
});

test('conversion blocks show instance names, plain text, optional indicators and shared styles',()=>{
  for(const name of ['text-to-number','number-to-text']){
    const def=source(name),state=def.initState(),style=def.initStyle();
    const io={name:'<b>Converter</b>',outputs:name==='text-to-number'?{value:.1+.2,valid:true}:{text:'<b>0.30</b>'}};
    const children=plain(def.children(state,style,style.w,style.h,false,io));
    assert.ok(children.some(child=>child.text==='<b>Converter</b>'));
    assert.ok(children.filter(child=>child.type==='text').every(child=>child.plainText===true));
    if(name==='text-to-number')assert.ok(children.some(child=>child.text==='0.3'),'numeric preview rounds only its displayed value');
    else assert.ok(children.some(child=>child.text==='"<b>0.30</b>"'));
    const hidden=plain(def.children({...state,showIndicators:false},style,style.w,style.h,false,io));
    assert.equal(hidden.some(child=>child.type==='ellipse'),false);
    assert.equal(hidden.some(child=>/^(Valid:|Number →|Fixed ·)/.test(child.text||'')),false);
    const failure=plain(def.unavailableChildren(state,style,style.w,style.h,false,{...io,error:'Configuration <error>'}));
    assert.ok(failure.some(child=>child.text==='Configuration <error>'));
    const customized={...style,fill:false,strokeOn:false,color:'#f00',size:4,dash:'dash',textColor:'#123456',font:'400 18px serif'};
    const styled=plain(def.children(state,customized,style.w,style.h,false,io));
    assert.deepEqual(styled[0],{type:'rect',x:0,y:0,w:style.w,h:style.h,fill:false,fillColor:'#ffffff',strokeOn:false,color:'#f00',size:4,dash:'dash'});
    assert.equal(styled.find(child=>child.text==='<b>Converter</b>').color,'#123456');
    assert.match(styled.find(child=>child.type==='text').font,/serif$/);
  }
});
