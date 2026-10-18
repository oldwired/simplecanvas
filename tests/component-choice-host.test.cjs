const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const names=['smartNumber','componentPortName','componentTableSnapshot','normalizeComponentChoiceHandle','componentChoiceSnapshot','nextComponentChoiceInput','validateSmartReply'];
const scope=vm.createContext({isNum:v=>typeof v==='number' && Number.isFinite(v)});
const functions=names.map(name=>{const start=html.indexOf('  function '+name+'('),end=html.indexOf('\n  function ',start+3);assert.ok(start>=0 && end>start);return html.slice(start,end);});
const dataStart=html.indexOf('// ---------- embedded datasets ----------'),dataEnd=html.indexOf('// End of embedded dataset contract.');
// validateSmartReply is followed by declarations, so trim that final extraction at its exact end marker.
functions[functions.length-1]=html.slice(html.indexOf('  function validateSmartReply('),html.indexOf('  // ---------- Smart-shape children()'));
vm.runInContext(html.slice(dataStart,dataEnd)+'\n'+functions.join('\n')+'\nthis.api={normalizeComponentChoiceHandle,componentChoiceSnapshot,nextComponentChoiceInput,validateSmartReply};',scope);
const api=scope.api,plain=value=>JSON.parse(JSON.stringify(value));
const handle={id:'pick',kind:'choice',input:'select',value:0,options:[{value:0,label:'Idle'},{value:1,label:'Running'}],inline:{x:0,y:0,w:100,h:30},x:50,y:15};
const record={caps:{inputs:{select:{type:'number',default:0},data:{type:'table'}}},io:{inputs:{select:0,data:{datasetId:'rows'}}}};
const item={componentApi:2,inputValues:{keep:'unchanged'}};

test('choice metadata is API 2 only, bounded, unique, and declares either fixed options or a table',()=>{
  const validate=(patch={},version=2)=>api.validateSmartReply({ok:true,apiVersion:version,result:[{...handle,...patch}]},{fn:'handles',componentApi:version,args:[{},100,30]});
  assert.equal(validate().result[0].options.length,2);
  for(const patch of [{options:[{value:0,label:'A'},{value:0,label:'B'}]},{options:[{value:Infinity,label:'A'}]},{options:[{value:0,label:'x'.repeat(2001)}]},{table:{input:'data',labelColumn:''}},{options:undefined},{input:'__proto__'},{inline:undefined},{inline:{x:0,y:0,w:101,h:30}}])assert.throws(()=>validate(patch));
  assert.throws(()=>validate({},1),/API 2/);
  assert.throws(()=>validate({options:Array.from({length:1001},(_,i)=>({value:i,label:''}))}),/1000/);
  const table=validate({options:undefined,table:{input:'data',labelColumn:''}}).result[0];assert.deepEqual(plain(table.table),{input:'data',labelColumn:''});
});

test('choice literals preserve independent inputs and reject linked, stale, or invented choices',()=>{
  const original=JSON.stringify(item),snapshot=api.componentChoiceSnapshot(item,handle,record,{});
  assert.deepEqual(plain(api.nextComponentChoiceInput(item,handle,record,{},1,snapshot.signature)),{keep:'unchanged',select:1});assert.equal(JSON.stringify(item),original);
  assert.equal(api.nextComponentChoiceInput(item,handle,record,{},0,snapshot.signature).select,0,'literal zero selects the first option');
  assert.throws(()=>api.nextComponentChoiceInput(item,handle,record,{},2,snapshot.signature),/available option/);
  assert.throws(()=>api.nextComponentChoiceInput(item,{...handle,options:[{value:1,label:'Changed'}]},record,{},1,snapshot.signature),/choices changed/);
  assert.throws(()=>api.componentChoiceSnapshot({...item,bindings:{select:{uid:'source',port:'value'}}},handle,record,{}),/connected input/);
  assert.throws(()=>api.componentChoiceSnapshot(item,handle,{...record,caps:{inputs:{select:{type:'string'}}}},{}),/numeric input/);
  assert.throws(()=>api.componentChoiceSnapshot(item,{...handle,input:'missing'},record,{}),/numeric input/);
  assert.throws(()=>api.componentChoiceSnapshot(item,handle,{...record,error:'unavailable'},{}),/available numeric input/);
});

test('dataset choices use every selected row and full strings, and reject source changes while open',()=>{
  const text='beyond-preview-'.repeat(20),pool={rows:{name:'Choices',columns:[{key:'key',name:'Key',type:'string'},{key:'label',name:'Label',type:'string'}],rows:Array.from({length:40},(_,i)=>['key-'+i,i===39?text:i===2?null:'Choice '+i])}};
  const fromTable={...handle,options:undefined,table:{input:'data',labelColumn:'label'}};
  const snapshot=api.componentChoiceSnapshot(item,fromTable,record,pool);
  assert.equal(snapshot.options.length,40);assert.equal(snapshot.options[0].value,0);assert.equal(snapshot.options[39].value,39);assert.equal(snapshot.options[39].label,text);assert.equal(snapshot.options[2].label,'');
  assert.equal(api.nextComponentChoiceInput(item,fromTable,record,pool,39,snapshot.signature).select,39);
  pool.rows.rows[39][0]='new-key';assert.throws(()=>api.nextComponentChoiceInput(item,fromTable,record,pool,39,snapshot.signature),/choices changed/);
  const selected={...record,io:{inputs:{select:0,data:{datasetId:'rows',rows:[39,0]}}}};
  assert.deepEqual(plain(api.componentChoiceSnapshot(item,fromTable,selected,pool).options),[{value:0,label:text},{value:1,label:'Choice 0'}]);
  assert.throws(()=>api.componentChoiceSnapshot(item,{...fromTable,table:{input:'data',labelColumn:'missing'}},record,pool),/text column/);
});
