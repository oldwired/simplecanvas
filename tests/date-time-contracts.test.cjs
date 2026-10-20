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
  assert.equal(JSON.stringify({input,state}),before,'date tools leave inputs and settings unchanged');
  return plain(result);
}
const parse=text=>compute('date-parse',{text});
const format=(timestamp,timezone='UTC',mode='date and time')=>compute('date-format',{timestamp,timezone},{format:mode});
const difference=(start,end,unit='seconds')=>compute('date-difference',{start,end,unit});

test('date tools expose Unix-millisecond inputs, validity and explicit format/unit controls',()=>{
  const parser=source('date-parse'),formatter=source('date-format'),diff=source('date-difference');
  for(const def of [parser,formatter,diff]){
    assert.equal(def.apiVersion,2);
    assert.deepEqual(plain(def.outputs.valid),{role:'control',type:'boolean',event:true});
    assert.equal(def.initState().showIndicators,true);
    assert.equal(def.settings.showIndicators.type,'boolean');
  }
  assert.deepEqual(plain(parser.inputs),{reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'},text:{type:'string',default:'',event:true}});
  assert.deepEqual(plain(parser.outputs),{timestamp:{type:'number',event:true},valid:{role:'control',type:'boolean',event:true}});
  assert.deepEqual(plain(formatter.inputs),{reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'},timestamp:{type:'number',default:0,event:true},timezone:{role:'control',type:'string',default:'UTC'}});
  assert.deepEqual(plain(formatter.settings.format.options),['ISO (UTC)','date','time','date and time']);
  assert.deepEqual(plain(diff.inputs.unit.options),['milliseconds','seconds','minutes','hours','days']);
  assert.deepEqual(plain(formatter.compute({timestamp:0,timezone:'UTC'})),{text:'1970-01-01 00:00:00',valid:true});
});

test('ISO parse preserves offsets, milliseconds, signed epochs and date-only UTC midnight',()=>{
  for(const [text,timestamp] of [
    ['1970-01-01',0],['1970-01-01T00:00Z',0],['1970-01-01T00:00:00Z',0],
    ['1969-12-31T23:59:59.999Z',-1],['1970-01-01T00:00:00.1Z',100],['1970-01-01T00:00:00.12Z',120],
    ['1970-01-01T00:00:00.123Z',123],['1970-01-01T01:00:00+01:00',0],['1969-12-31T19:00:00-05:00',0],
    ['1970-01-01T05:45:00+05:45',0],['1970-01-01T00:00:00-00:00',0],
    ['2024-02-29',1709164800000],['2000-02-29T12:34:56Z',951827696000],
    ['0099-01-01',Date.parse('0099-01-01')],['0000-02-29',Date.parse('0000-02-29')],
    ['-000001-12-31T23:59:59.999Z',Date.parse('-000001-12-31T23:59:59.999Z')],
    ['+010000-01-01T00:00:00.000Z',253402300800000],
    ['+275760-09-13T00:00:00.000Z',8640000000000000],
    ['+275760-09-13T01:00:00+01:00',8640000000000000],
    ['-271821-04-20T00:00:00.000Z',-8640000000000000]
  ])assert.deepEqual(parse(text),{timestamp,valid:true},text);
  assert.equal(Object.is(source('date-parse').compute({text:'1970-01-01'}).timestamp,-0),false);
});

test('ISO parse rejects invalid calendar rollovers and timezone-free or locale-dependent dates',()=>{
  for(const text of [
    '', ' ', ' 2024-02-29', '2024-02-29\n', '2024-02-29\r\n', '2024-02-29 trailing',
    '2023-02-29','1900-02-29','2024-02-30','2024-04-31','2024-00-01','2024-13-01','2024-01-00','2024-01-32',
    '2024-2-1','02/29/2024','29.02.2024','February 29, 2024','2024','2024-02','2024-060',
    '2024-02-29T12:00','2024-02-29T12:00:00','2024-02-29 12:00:00Z','2024-02-29t12:00:00z',
    '2024-02-29T24:00:00Z','2024-02-29T23:60:00Z','2024-02-29T23:59:60Z','2024-02-29T12:00:00.1234Z',
    '2024-02-29T12:00.1Z','2024-02-29T12:00:00+01','2024-02-29T12:00:00+0100',
    '2024-02-29T12:00:00+24:00','2024-02-29T12:00:00-01:60','2024-02-29Z',
    '-000000-01-01','10000-01-01','+275760-09-13T00:00:00.001Z','-271821-04-19T23:59:59.999Z'
  ])assert.deepEqual(parse(text),{timestamp:0,valid:false},JSON.stringify(text));
  for(const text of [null,123,true,undefined,{},'x'.repeat(2001)])assert.throws(()=>source('date-parse').compute({text}),/string of at most 2000/);
});

test('format uses deterministic Gregorian date/time and explicit IANA zones across DST changes',()=>{
  for(const [text,zone,result] of [
    ['2024-03-31T00:59:59Z','Europe/Berlin','2024-03-31 01:59:59'],
    ['2024-03-31T01:00:00Z','Europe/Berlin','2024-03-31 03:00:00'],
    ['2024-10-27T00:30:00Z','Europe/Berlin','2024-10-27 02:30:00'],
    ['2024-10-27T01:30:00Z','Europe/Berlin','2024-10-27 02:30:00'],
    ['2024-01-01T00:00:00Z','America/New_York','2023-12-31 19:00:00'],
    ['2024-01-01T00:00:00Z','Asia/Kathmandu','2024-01-01 05:45:00'],
    ['2024-01-01T00:00:00Z','UTC','2024-01-01 00:00:00'],
    ['0000-01-01T00:00:00Z','UTC','0000-01-01 00:00:00'],
    ['-000001-01-01T00:00:00Z','UTC','-000001-01-01 00:00:00'],
    ['+010000-01-01T00:00:00Z','UTC','+010000-01-01 00:00:00']
  ])assert.deepEqual(format(Date.parse(text),zone),{text:result,valid:true},text+' '+zone);
  const timestamp=Date.parse('2024-03-31T01:02:03.456Z');
  assert.deepEqual(format(timestamp,'Europe/Berlin','date'),{text:'2024-03-31',valid:true});
  assert.deepEqual(format(timestamp,'Europe/Berlin','time'),{text:'03:02:03',valid:true});
  assert.deepEqual(format(timestamp,'Europe/Berlin','ISO (UTC)'),{text:'2024-03-31T01:02:03.456Z',valid:true});
  assert.deepEqual(format(0,' UTC '),{text:'1970-01-01 00:00:00',valid:true});
});

test('ISO formatting round-trips the complete native Date range and truncates submillisecond timestamps',()=>{
  for(const timestamp of [-8640000000000000,-62167219200000,-1,0,1,1711846923456,253402300800000,8640000000000000]){
    const result=format(timestamp,'UTC','ISO (UTC)');
    assert.equal(result.valid,true);
    assert.deepEqual(parse(result.text),{timestamp,valid:true});
  }
  assert.deepEqual(format(123.75,'UTC','ISO (UTC)'),{text:'1970-01-01T00:00:00.123Z',valid:true});
});

test('invalid dates/timezones publish empty text and false, while malformed settings and port types fail explicitly',()=>{
  for(const timestamp of [NaN,Infinity,-Infinity,8640000000000001,-8640000000000001])assert.deepEqual(format(timestamp),{text:'',valid:false});
  for(const zone of ['',' ','local','Not/AZone','Europe/DoesNotExist','<script>']){
    for(const mode of ['date and time','ISO (UTC)'])assert.deepEqual(format(0,zone,mode),{text:'',valid:false});
  }
  for(const timestamp of ['0',null,true,{},undefined])assert.throws(()=>format(timestamp),/number of Unix milliseconds/);
  for(const timezone of [123,null,true,{},undefined,'x'.repeat(2001)])assert.throws(()=>source('date-format').compute({timestamp:0,timezone}),/string of at most 2000/);
  for(const mode of ['locale',null,{},1])assert.throws(()=>format(0,'UTC',mode),/supported date format/);
  assert.deepEqual(format(0),{text:'1970-01-01 00:00:00',valid:true});
});

test('date difference is signed, preserves fractional precision and treats units as fixed elapsed duration',()=>{
  for(const [unit,divisor] of [['milliseconds',1],['seconds',1000],['minutes',60000],['hours',3600000],['days',86400000]]){
    assert.deepEqual(difference(1000.25,1234567.89,unit),{value:(1234567.89-1000.25)/divisor,valid:true});
    assert.deepEqual(difference(1234567.89,1000.25,unit),{value:(1000.25-1234567.89)/divisor,valid:true});
    assert.deepEqual(difference(0,0,unit),{value:0,valid:true});
  }
  const start=parse('2024-03-31T00:00:00+01:00').timestamp,end=parse('2024-04-01T00:00:00+02:00').timestamp;
  assert.deepEqual(difference(start,end,'hours'),{value:23,valid:true});
  assert.deepEqual(difference(start,end,'days'),{value:23/24,valid:true},'DST calendar day is 23 elapsed hours');
  assert.deepEqual(difference(-8640000000000000,8640000000000000,'days'),{value:200000000,valid:true});
});

test('difference validates timestamp bounds and explicit units without prototype-key lookups',()=>{
  for(const bad of [NaN,Infinity,-Infinity,8640000000000001,-8640000000000001]){
    assert.deepEqual(difference(bad,0),{value:0,valid:false});
    assert.deepEqual(difference(0,bad),{value:0,valid:false});
  }
  for(const bad of ['1',null,true,{},undefined])assert.throws(()=>difference(bad,0),/numbers of Unix milliseconds/);
  for(const unit of ['months','years','constructor','__proto__','toString',1,null,{},['seconds']])assert.throws(()=>difference(0,1,unit),/Choose milliseconds/);
});

test('date tools show instance names, plain text, optional indicators, errors and shared styles',()=>{
  for(const name of ['date-parse','date-format','date-difference']){
    const def=source(name),state=def.initState(),style=def.initStyle();
    const outputs=name==='date-parse'?{timestamp:123456789,valid:true}:name==='date-format'?{text:'2024-01-01 00:00:00',valid:true}:{value:.1+.2,valid:true};
    const io={name:'<b>Calendar</b>',inputs:{timezone:'UTC',unit:'seconds'},outputs};
    const children=plain(def.children(state,style,style.w,style.h,false,io));
    assert.ok(children.some(child=>child.text==='<b>Calendar</b>'));
    assert.ok(children.filter(child=>child.type==='text').every(child=>child.plainText===true));
    assert.ok(children.some(child=>child.type==='ellipse' && child.fillColor==='#15803d'));
    if(name==='date-difference')assert.ok(children.some(child=>child.text==='0.3'),'only the displayed duration is rounded');
    const hidden=plain(def.children({...state,showIndicators:false},style,style.w,style.h,false,io));
    assert.equal(hidden.some(child=>child.type==='ellipse'),false);
    assert.equal(hidden.some(child=>/Valid:/.test(child.text||'')),false);
    const failure=plain(def.unavailableChildren(state,style,style.w,style.h,false,{...io,error:'Configuration <error>'}));
    assert.ok(failure.some(child=>child.text==='Configuration <error>'));
    const customized={...style,fill:false,strokeOn:false,color:'#f00',size:4,dash:'dash',textColor:'#123456',font:'400 18px serif'};
    const styled=plain(def.children(state,customized,style.w,style.h,false,io));
    assert.deepEqual(styled[0],{type:'rect',x:0,y:0,w:style.w,h:style.h,fill:false,fillColor:'#ffffff',strokeOn:false,color:'#f00',size:4,dash:'dash'});
    assert.equal(styled.find(child=>child.text==='<b>Calendar</b>').color,'#123456');
    assert.match(styled.find(child=>child.type==='text').font,/serif$/);
  }
});
