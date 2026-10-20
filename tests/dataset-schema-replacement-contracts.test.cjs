const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function section(start,end){
  const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a,start);return html.slice(a,b);
}
function declaration(name){
  const start=html.indexOf('  function '+name+'(');assert.ok(start>=0,name);
  const end=html.slice(start+3).search(/\n  (?:async )?function /);
  assert.ok(end>=0,name+' end');return html.slice(start,start+3+end);
}
function runtime(){
  const scope=vm.createContext({});
  vm.runInContext([
    section('// ---------- embedded datasets ----------','// End of embedded dataset contract.'),
    declaration('validateDatasetReplacementSchema'),declaration('datasetOwnersOf'),
    declaration('prepareDatasetReplacement'),declaration('prepareDatasetTableAction'),
    declaration('datasetReplacementImpact'),declaration('validateDatasetReplacementGraph'),
    'this.api={datasetCommand,prepareDatasetReplacement,prepareDatasetTableAction,validateDatasetReplacementGraph};',
  ].join('\n'),scope);
  return scope.api;
}
const original={
  name:'Readings',
  columns:[{key:'name',name:'Name',type:'string'},{key:'value',name:'Value',type:'number'}],
  rows:[['A',10],['B',20]],rowIds:['r5','r11'],revision:7,nextRowId:12,
};
const replacement={
  name:'Locations',
  columns:[{key:'city',name:'City',type:'string'},{key:'active',name:'Active',type:'boolean'}],
  rows:[['Berlin',true],['Paris',false]],
};
function snapshot({state={},pool={stored:plain(original)},otherItems=[]}={}){
  const item={uid:'owner',componentApi:2,type:'smart',state,inputValues:{data:{datasetId:'stored'}}};
  Object.defineProperty(pool,Symbol.for('simplecanvas.datasetOwners'),{
    value:new Map([['stored',{uid:item.uid,input:'data',name:'Dataset'}]]),configurable:true,
  });
  return {item,items:[item,...otherItems],pool,record:{caps:{datasetOwner:'data'}}};
}

test('explicit column replacement retains dataset identity and creates fresh row identities in one immutable revision',()=>{
  const api=runtime(),untouched=plain(original),pool={stored:plain(original),other:untouched},before=JSON.stringify(pool);
  const next=api.datasetCommand(pool,{type:'replace',datasetId:'stored',table:replacement,replaceColumns:true,expectedRevision:7});
  assert.deepEqual(plain(next.reference),{datasetId:'stored'});
  assert.deepEqual(plain(next.table.columns),replacement.columns);assert.deepEqual(plain(next.table.rows),replacement.rows);
  assert.deepEqual(plain(next.table.rowIds),['r12','r13']);assert.equal(next.table.nextRowId,14);assert.equal(next.table.revision,8);
  assert.equal(next.pool.other,untouched);assert.equal(JSON.stringify(pool),before);
});

test('ordinary replacement remains schema preserving, including after a deliberate schema change',()=>{
  const api=runtime(),pool={stored:plain(original)},command={type:'replace',datasetId:'stored',table:replacement};
  assert.throws(()=>api.datasetCommand(pool,command),/Missing column/);
  assert.throws(()=>api.datasetCommand(pool,{...command,replaceColumns:false}),/Missing column/);
  const next=api.datasetCommand(pool,{...command,replaceColumns:true});
  assert.throws(()=>api.datasetCommand(next.pool,{type:'replace',datasetId:'stored',table:original}),/Missing column/);
  const reloaded=api.datasetCommand(next.pool,{...command,table:{...replacement,rows:[['London',null]]}});
  assert.deepEqual(plain(reloaded.table.rows),[['London',null]]);assert.equal(reloaded.table.revision,9);
});

test('deliberate replacement may change an existing column type without coercing its new values',()=>{
  const api=runtime(),pool={stored:plain(original)};
  const table={...original,columns:original.columns.map(column=>column.key==='value'?{...column,type:'string'}:column),rows:[['A','0010']]};
  assert.throws(()=>api.datasetCommand(pool,{type:'replace',datasetId:'stored',table}),/must remain number/);
  const next=api.datasetCommand(pool,{type:'replace',datasetId:'stored',table,replaceColumns:true});
  assert.equal(next.table.columns[1].type,'string');assert.equal(next.table.rows[0][1],'0010');
  assert.equal(original.columns[1].type,'number');assert.equal(original.rows[0][1],10);
});

test('column replacement is an explicit Boolean flag restricted to replace commands',()=>{
  const api=runtime(),pool={stored:plain(original)},before=JSON.stringify(pool);
  for(const replaceColumns of ['true','false',1,0,null,{},[]])
    assert.throws(()=>api.datasetCommand(pool,{type:'replace',datasetId:'stored',table:replacement,replaceColumns}));
  for(const command of [
    {type:'append',row:{name:'C',value:30}},
    {type:'appendMany',table:{...original,rows:[['C',30]]}},
    {type:'update',rowId:'r5',changes:{value:30}},
    {type:'delete',rowId:'r5'},
  ])for(const replaceColumns of [true,false])
    assert.throws(()=>api.datasetCommand(pool,{...command,datasetId:'stored',replaceColumns}),/Unsupported/);
  assert.equal(JSON.stringify(pool),before);
});

test('schema changes retain scalar, structure, size, and revision validation without partially changing the pool',()=>{
  const api=runtime(),pool={stored:plain(original)},before=JSON.stringify(pool);
  const large={name:'Large',columns:[{key:'text',name:'Text',type:'string'}],rows:Array.from({length:251},()=>['x'.repeat(2000)])};
  for(const table of [
    {...replacement,rows:[['Berlin','true']]},
    {...replacement,rows:[['Berlin']]},
    {...replacement,columns:[replacement.columns[0],replacement.columns[0]]},
    {...replacement,columns:[{key:'__proto__',type:'string'}],rows:[]},
    {...replacement,columns:Array.from({length:33},(_,i)=>({key:'c'+i,type:'string'})),rows:[]},
    {...replacement,rows:Array.from({length:1001},()=>['Berlin',true])},
    {...replacement,rows:[['x'.repeat(2001),true]]},
    large,
  ]){
    assert.throws(()=>api.datasetCommand(pool,{type:'replace',datasetId:'stored',table,replaceColumns:true}));
    assert.equal(JSON.stringify(pool),before);
  }
  assert.throws(()=>api.datasetCommand(pool,{type:'replace',datasetId:'stored',table:replacement,replaceColumns:true,expectedRevision:6}),/changed/);
  assert.equal(JSON.stringify(pool),before);
});

test('schema replacement also enforces the total sketch storage budget',()=>{
  const api=runtime(),large={name:'Large',columns:[{key:'text',name:'Text',type:'string'}],rows:Array.from({length:195},()=>['x'.repeat(2000)])};
  const pool={stored:plain(original),a:large,b:large,c:large,d:large},before=JSON.stringify(pool);
  const table={...large,rows:Array.from({length:245},()=>['y'.repeat(2000)])};
  assert.throws(()=>api.datasetCommand(pool,{type:'replace',datasetId:'stored',table,replaceColumns:true}),/2,000,000-character/);
  assert.equal(JSON.stringify(pool),before);
});

test('prepared column replacement preserves shared links, clears old row selections, and does not mutate the scene',()=>{
  const api=runtime(),consumer={uid:'consumer',bindings:{data:{uid:'owner',port:'data'}},inputValues:{source:{datasetId:'stored'}}};
  const selected={uid:'selection',inputValues:{data:{datasetId:'stored',rows:[1]}},signalState:{previous:{datasetId:'stored',rows:[0]}}};
  const current=snapshot({otherItems:[consumer,selected]}),before=JSON.stringify(current);
  const next=api.prepareDatasetReplacement(current,'data',replacement,true);
  assert.deepEqual(plain(next.items[1]),consumer);
  assert.deepEqual(plain(next.items[2].inputValues.data),{datasetId:'stored',rows:[]});
  assert.deepEqual(plain(next.items[2].signalState.previous),{datasetId:'stored',rows:[]});
  assert.deepEqual(plain(next.pool.stored.columns),replacement.columns);
  assert.equal(next.items[0].inputValues.data.datasetId,'stored');assert.equal(JSON.stringify(current),before);
});

test('reader column changes require the dedicated author permission while compatible data reloads do not',()=>{
  const api=runtime();
  for(const allowReaderColumnChanges of [undefined,false,'true',1]){
    const current=snapshot({state:{allowReaderImport:true,allowReaderColumnChanges}});
    assert.throws(()=>api.prepareDatasetReplacement(current,'data',replacement,true,true));
    assert.doesNotThrow(()=>api.prepareDatasetReplacement(current,'data',{...original,rows:[['C',30]]},false,true));
    assert.doesNotThrow(()=>api.prepareDatasetReplacement(current,'data',replacement,true,false),'editor author may deliberately replace columns');
  }
  const current=snapshot({state:{allowReaderImport:true,allowReaderColumnChanges:true}});
  assert.deepEqual(plain(api.prepareDatasetReplacement(current,'data',replacement,true,true).pool.stored.columns),replacement.columns);
  assert.throws(()=>api.prepareDatasetReplacement(current,'data',replacement,false,true),/Missing column/,'permission is not implicit consent');
});

test('column replacement still requires the whole dataset and its owning unconnected component',()=>{
  const api=runtime();
  for(const modify of [
    current=>{current.item.bindings={data:{uid:'elsewhere',port:'data'}};},
    current=>{current.item.inputValues.data.rows=[0];},
    current=>{current.record.caps.datasetOwner='other';},
    current=>{current.pool[Symbol.for('simplecanvas.datasetOwners')].set('stored',{uid:'other',input:'data'});},
    current=>{current.items=[];},
  ]){
    const current=snapshot({state:{allowReaderColumnChanges:true}});modify(current);
    assert.throws(()=>api.prepareDatasetReplacement(current,'data',replacement,true,true));
  }
});

test('source Replace and Live synchronization cannot silently opt into schema changes',()=>{
  const api=runtime();
  for(const type of ['replaceTable','syncTable']){
    const current=snapshot({state:{allowReaderColumnChanges:true,allowReaderUpdates:true}});
    const action={type,input:'data',source:'source',...(type==='syncTable'?{enabled:true}:{trigger:'replace'})};
    const record={caps:{datasetOwner:'data',dataActions:{replace:action}},io:{inputs:{data:{datasetId:'stored'}}}};
    const intent={...action,item:current.item,name:'replace',reference:{datasetId:'stored'},schema:JSON.stringify(original.columns),
      expectedRevision:7,table:replacement};
    const command=api.prepareDatasetTableAction(intent,record,current.pool,true);
    assert.equal(command.replaceColumns,undefined);
    assert.throws(()=>api.datasetCommand(current.pool,command),/Missing column/);
  }
});

function graphFixture(){
  const filter={uid:'filter',componentName:'Shared name',bindings:{data:{uid:'owner',port:'data'}}};
  const chart={uid:'chart',componentName:'Chart',bindings:{data:{uid:'filter',port:'data'}}};
  const editor={uid:'editor',componentName:'Editor',inputValues:{data:{datasetId:'stored'}}};
  const unrelated={uid:'unrelated',componentName:'Shared name',inputValues:{value:1}};
  const current=snapshot({otherItems:[chart,unrelated,editor,filter]});
  current.item.componentName='Dataset';
  current.graph=new Map(current.items.map(item=>[item,{io:{inputs:item.inputValues||{}}}]));
  const api=runtime(),proposal=api.prepareDatasetReplacement(current,'data',replacement,true);
  const candidate=errors=>new Map(proposal.items.map(item=>[item,errors[item.uid]?{error:errors[item.uid]}:{io:{inputs:{}}}]));
  return {api,current,proposal,candidate};
}

test('only deliberate column changes may leave directly attached and downstream consumers unavailable',()=>{
  const {api,current,proposal,candidate}=graphFixture();
  const graph=candidate({filter:'Unknown filter column: value',chart:'Input unavailable',editor:'Column unavailable'});
  assert.throws(()=>api.validateDatasetReplacementGraph(current,proposal,graph,false),/Input unavailable|Unknown filter column|Column unavailable/);
  const review=api.validateDatasetReplacementGraph(current,proposal,graph,true);
  assert.deepEqual(plain(review.consumers.map(consumer=>consumer.uid).sort()),['chart','editor','filter']);
  assert.equal(review.consumers.find(consumer=>consumer.uid==='filter').error,'Unknown filter column: value');
  assert.match(review.columns.join(' '),/Added: city, active/);assert.match(review.columns.join(' '),/Removed: name, value/);
});

test('the Dataset owner must remain valid after a deliberate column change',()=>{
  const {api,current,proposal,candidate}=graphFixture();
  assert.throws(()=>api.validateDatasetReplacementGraph(current,proposal,candidate({owner:'Required owned column missing',filter:'Unknown field'}),true),
    /Dataset: Required owned column missing/);
});

test('a shared display name cannot exempt an unrelated failure from replacement validation',()=>{
  const {api,current,proposal,candidate}=graphFixture();
  const graph=candidate({filter:'Unknown field',unrelated:'Unrelated computation failed'});
  assert.throws(()=>api.validateDatasetReplacementGraph(current,proposal,graph,true),/Shared name: Unrelated computation failed/);
  current.graph.get(current.items.find(item=>item.uid==='unrelated')).error='Existing unrelated error';
  assert.doesNotThrow(()=>api.validateDatasetReplacementGraph(current,proposal,graph,true),'a pre-existing unrelated error does not block replacement');
});

test('column impact includes type, display-name, and order changes even when consumers still compute',()=>{
  const {api,current}=graphFixture();
  const table={name:'Reordered',columns:[
    {...original.columns[1],type:'string'}, {...original.columns[0],name:'Display name'}, {key:'extra',name:'Extra',type:'boolean'},
  ],rows:[['0010','A',true]]};
  const proposal=api.prepareDatasetReplacement(current,'data',table,true),graph=new Map(proposal.items.map(item=>[item,{io:{inputs:{}}}]));
  const review=api.validateDatasetReplacementGraph(current,proposal,graph,true),changes=review.columns.join(' ');
  assert.match(changes,/Added: extra/);assert.match(changes,/value: number → string/);
  assert.match(changes,/Display names changed: name/);assert.match(changes,/Column order changed/);
  assert.equal(review.consumers.length,3);assert.equal(review.consumers.every(consumer=>consumer.error===null),true);
});
