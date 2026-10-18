const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const dataset=html.slice(html.indexOf('// ---------- embedded datasets ----------'),html.indexOf('// End of embedded dataset contract.'));
const helpers=html.slice(html.indexOf('  function normalizeComponentDataAction('),html.indexOf('  async function openComponentDataAction('));
function declaration(name){
  const start=html.indexOf('  function '+name+'(');assert.ok(start>=0,name);
  const end=html.indexOf('\n  function ',start+3);return html.slice(start,end);
}
const context=vm.createContext({crypto});
vm.runInContext('const isNum=v=>typeof v==="number"&&Number.isFinite(v);\n'+dataset+'\n'+helpers+'\n'+
  ['componentPortName','smartNumber','componentTableSnapshot','validateSmartReply'].map(declaration).join('\n')+
  '\nthis.actions={normalizeComponentDataAction,validateSmartReply,validateDatasetReplacementSchema,prepareDatasetReplacement,retainDatasetTimelinePool,safeDataFilename,serializeComponentTable,componentTableSnapshot,parseDatasetText};',context);
const dialogStart=html.indexOf('  async function openComponentDataAction('),dialogEnd=html.indexOf('  // This function is shipped into HTML exports.',dialogStart);
vm.runInContext(html.slice(dialogStart,dialogEnd)+'\nthis.actions.openComponentDataAction=openComponentDataAction;',context);
const c=context.actions,plain=value=>JSON.parse(JSON.stringify(value));
const table={name:'Results',columns:[{key:'Name',name:'Display name',type:'string'},{key:'Points',name:'Points',type:'number'},{key:'Active',name:'Active',type:'boolean'}],rows:[['Möwe, "red"',2.5,true],['line\nnext',null,false],['<script>alert(1)</script>',-3,null]]};
const item={uid:'source',type:'smart',componentApi:2,inputValues:{data:{datasetId:'original'}}};
const action=(kind='importDataset')=>kind==='importDataset'?{type:kind,input:'data'}:{type:kind,input:'data',format:'csv',filename:'results'};

test('data action descriptors are a strict allowlist with named inputs and bounded filenames',()=>{
  assert.deepEqual(plain(c.normalizeComponentDataAction(action())),action());
  assert.deepEqual(plain(c.normalizeComponentDataAction(action('downloadTable'))),action('downloadTable'));
  for(const raw of [null,[],{}, {type:'fetch',input:'data'}, {...action(),url:'https://example.com'}, {...action(),input:'__proto__'},
    {...action(),input:'x.y'}, {...action('downloadTable'),format:'html'}, {...action('downloadTable'),filename:'x'.repeat(2001)}, {...action(),filename:'file'}])
    assert.throws(()=>c.normalizeComponentDataAction(raw),undefined,JSON.stringify(raw));
  assert.equal(c.normalizeComponentDataAction({...action('downloadTable'),filename:'x'.repeat(2000)}).filename.length,2000);
});

test('only API 2 validated action handles carry allowlisted host-owned action descriptors',()=>{
  const handle={id:'load',x:10,y:20,kind:'action',action:action()};
  const reply={ok:true,apiVersion:2,result:[handle]},message={method:'call',componentApi:2,fn:'handles',args:[{},100,60]};
  assert.deepEqual(plain(c.validateSmartReply(reply,message).result),[handle]);
  assert.throws(()=>c.validateSmartReply({...reply,apiVersion:1},{...message,componentApi:undefined}),/API 2/);
  assert.throws(()=>c.validateSmartReply({...reply,result:[{...handle,action:{type:'download',input:'data'}}]},message),/Invalid data action/);
  assert.throws(()=>c.validateSmartReply({...reply,result:[{...handle,inline:{x:0,y:0,w:20,h:20}}]},message),/inline/);
  assert.throws(()=>c.validateSmartReply({...reply,result:[handle,handle]},message),/duplicate/);
  assert.doesNotMatch(helpers,/\.click\(|showModal\(|fetch\(/,'descriptor, preparation, and serialization helpers perform no host actions');
});

test('replacement schema permits reordered and extra columns but rejects missing or changed types',()=>{
  const next={...table,columns:[table.columns[2],table.columns[0],table.columns[1],{key:'Race',name:'Race',type:'number'}],rows:[]};
  assert.doesNotThrow(()=>c.validateDatasetReplacementSchema(table,next));
  assert.throws(()=>c.validateDatasetReplacementSchema(table,{...table,columns:table.columns.slice(1)}),/Missing column "Name"/);
  assert.throws(()=>c.validateDatasetReplacementSchema(table,{...table,columns:table.columns.map(column=>column.key==='Points'?{...column,type:'string'}:column)}),/must remain number/);
});

test('replacement uses a fresh ID, retains other shared sources, and leaves prior scene/pool untouched',()=>{
  const second={...item,uid:'second'},items=[item,second],pool={original:table},before=JSON.stringify({items,pool});
  const next=c.prepareDatasetReplacement({item,items,pool},'data',{...table,rows:[['New',7,false]]});
  assert.notEqual(next.reference.datasetId,'original');assert.equal(next.items[1],second);
  assert.equal(next.items[0].inputValues.data.datasetId,next.reference.datasetId);
  assert.deepEqual(plain(next.pool.original),table);assert.deepEqual(plain(next.pool[next.reference.datasetId].rows),[['New',7,false]]);
  assert.equal(JSON.stringify({items,pool}),before);
  const unshared=c.prepareDatasetReplacement({item,items:[item],pool},'data',table);
  assert.deepEqual(Object.keys(unshared.pool),[unshared.reference.datasetId],'unreferenced replaced baseline is pruned');
  assert.throws(()=>c.prepareDatasetReplacement({item:{...item,bindings:{data:{uid:'other',output:'data'}}},items:[item],pool},'data',table),/unconnected/);
});

test('replacement enforces the reachable 16-dataset bound atomically',()=>{
  const pool=Object.fromEntries(Array.from({length:16},(_,i)=>['table'+i,table]));
  const items=Object.keys(pool).map((id,i)=>({uid:'source'+i,inputValues:{data:{datasetId:id}}}));
  const next=c.prepareDatasetReplacement({item:items[0],items,pool},'data',table);
  assert.equal(Object.keys(next.pool).length,16,'replacing an unshared source does not consume an extra slot');
  const shared=[...items,{uid:'shared',inputValues:{data:{datasetId:'table0'}}}],before=JSON.stringify({pool,shared});
  assert.throws(()=>c.prepareDatasetReplacement({item:items[0],items:shared,pool},'data',table),/16 datasets/);
  assert.equal(JSON.stringify({pool,shared}),before);
});

test('reader data retention keeps only current and committed inputs across repeated paused replacements',()=>{
  let current={...item,inputValues:{data:{datasetId:'original'}}},pool={original:table};
  const timeline={committedScene:[{item:current,snapshot:JSON.parse(JSON.stringify(current))}]};
  for(let step=0;step<25;step++){
    const next=c.prepareDatasetReplacement({item:current,items:[current],pool},'data',{...table,rows:[['New '+step,step,true]]});
    current=next.items[0];pool=c.retainDatasetTimelinePool([current],{...pool,...next.pool},timeline);
    assert.equal(Object.keys(pool).length,2,'intermediate replacement datasets are not retained');
    assert.deepEqual(plain(pool.original),table,'queued replay still has its original immutable data');
  }
  timeline.committedScene=[{item:current,snapshot:JSON.parse(JSON.stringify(current))}];
  pool=c.retainDatasetTimelinePool([current],pool,timeline);
  assert.deepEqual(Object.keys(pool),[current.inputValues.data.datasetId],'successful settlement releases the old baseline');
  const many=Array.from({length:33},(_,i)=>({inputValues:{data:{datasetId:'data'+i}}}));
  assert.throws(()=>c.retainDatasetTimelinePool(many,Object.fromEntries(many.map((row,i)=>['data'+i,table])),null),/two sketch data pools/);
});

test('CSV download writes keys, literal Unicode, escaped quotes and line breaks, with null empty cells',()=>{
  const csv=c.serializeComponentTable(table,'csv');
  assert.equal(csv,'Name,Points,Active\r\n"Möwe, ""red""",2.5,true\r\n"line\nnext",,false\r\n<script>alert(1)</script>,-3,\r\n');
  assert.deepEqual(plain(c.parseDatasetText(csv,'results.csv')).rows,table.rows);
  assert.equal(c.serializeComponentTable({...table,rows:[]},'csv'),'Name,Points,Active\r\n');
  assert.throws(()=>c.serializeComponentTable(table,'html'),/CSV or JSON/);
});

test('JSON download preserves scalar types and nulls, and selected order includes every selected row',()=>{
  const pool={original:table},snapshot=c.componentTableSnapshot({datasetId:'original',rows:[2,0]},pool);
  assert.deepEqual(JSON.parse(c.serializeComponentTable(snapshot,'json')),[{Name:'<script>alert(1)</script>',Points:-3,Active:null},{Name:'Möwe, "red"',Points:2.5,Active:true}]);
  assert.equal(c.serializeComponentTable({...table,rows:[]},'json'),'[]\n');
  const large={name:'Large',columns:[{key:'n',name:'n',type:'number'}],rows:Array.from({length:1000},(_,i)=>[i])};
  assert.equal(JSON.parse(c.serializeComponentTable(c.componentTableSnapshot({datasetId:'many'},{many:large}),'json')).length,1000);
});

test('download filenames retain readable names but cannot introduce paths or arbitrary extensions',()=>{
  assert.equal(c.safeDataFilename('Race results.csv','json'),'Race results.json');
  assert.equal(c.safeDataFilename('../../bad\\name\u0000?.exe','csv'),'_.._bad_name__.exe.csv');
  assert.equal(c.safeDataFilename('CON','csv'),'_CON.csv');
  assert.equal(c.safeDataFilename('...','json'),'results.json');
  assert.equal(c.safeDataFilename('x'.repeat(2000),'csv').length,104);
});


test('downloads refuse an unfinished stepped graph before opening a dialog or resolving row references',async()=>{
  for(const format of ['csv','json'])await assert.rejects(c.openComponentDataAction({type:'downloadTable',input:'data',format},{
    valid:()=>true,
    read:async()=>({caps:{apiVersion:2,inputs:{data:{type:'table'}}},settled:false})
  }),/Finish stepping or resume signals before downloading results/);
});
