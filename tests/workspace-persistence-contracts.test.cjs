const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function transferScope(){
  let uid=0;
  const scope=vm.createContext({
    clone:plain,newUid:()=>`copy-${++uid}`,BUILTIN_LIBRARY_DEFINITIONS:[],
    eachDatasetReference(list,visit){
      for(const item of list)for(const field of ['inputValues','signalState'])
        for(const value of Object.values(item[field]||{}))if(value && typeof value==='object' && typeof value.datasetId==='string')visit(value);
    },
    tabs:[],items:[],activeTabId:'a',tabDocument:()=>({items:[]}),
  });
  const start=html.indexOf('// ---------- workspace transfer identities ----------');
  const end=html.indexOf('// ---------- end workspace transfer identities ----------');
  assert.ok(start>0 && end>start);
  vm.runInContext(html.slice(start,end),scope);
  return scope;
}
const table={name:'Readings',columns:[{key:'reading',name:'Reading',type:'number'}],rows:[[1],[2]]};
const item=(uid,extra={})=>({type:'smart',componentApi:2,uid,state:{},...extra});
const entry=(id,items,datasets={})=>({id,name:id,items,datasets,assets:{},ui:{}});

test('duplicating a sketch rewires local components and self receivers but retains remote sources',()=>{
  const scope=transferScope(),source=entry('services',[
    item('publisher'),
    item('receiver',{workspaceReceive:{value:{sketchId:'services',componentUid:'publisher',port:'value'}},bindings:{value:{uid:'publisher',port:'value'}},
      eventBindings:{capture:{uid:'publisher',port:'submitted'}}}),
    item('external',{workspaceReceive:{value:{sketchId:'other',componentUid:'publisher',port:'value'}}}),
    item('broken',{bindings:{value:{uid:'missing',port:'value'}}}),
  ]);
  const before=plain(source);
  const [copy]=plain(scope.transferWorkspaceEntries([source],['services-copy'],{duplicate:true}));
  assert.deepEqual(source,before,'copying never changes the original or its consumers');
  const [publisher,receiver,external,broken]=copy.items;
  assert.notEqual(publisher.uid,'publisher');assert.equal(new Set(copy.items.map(item=>item.uid)).size,4);
  assert.deepEqual(receiver.workspaceReceive,{value:{sketchId:'services-copy',componentUid:publisher.uid,port:'value'}});
  assert.equal(receiver.bindings.value.uid,publisher.uid);
  assert.equal(receiver.eventBindings.capture.uid,publisher.uid);
  assert.deepEqual(external.workspaceReceive,{value:{sketchId:'other',componentUid:'publisher',port:'value'}});
  assert.equal(broken.bindings.value.unresolved,true);
});

test('duplicated owned datasets get independent identities while external datasets stay shared',()=>{
  const scope=transferScope(),source=entry('services',[
    item('owner',{datasetOwner:'data',datasetShared:true,inputValues:{data:{datasetId:'readings'}}}),
    item('view',{inputValues:{table:{datasetId:'readings',rows:[1]}}}),
    item('remote',{inputValues:{table:{datasetId:'readings',sketchId:'other',rows:[0]}}}),
  ],{readings:table});
  const [copy]=scope.transferWorkspaceEntries([source],['services-copy'],{duplicate:true});
  const id=Object.keys(copy.datasets)[0];
  assert.notEqual(id,'readings');
  assert.equal(copy.items[0].inputValues.data.datasetId,id);
  assert.equal(copy.items[1].inputValues.table.datasetId,id);
  assert.deepEqual(plain(copy.items[2].inputValues.table),{datasetId:'readings',sketchId:'other',rows:[0]});
  copy.datasets[id].rows[0][0]=999;
  assert.equal(source.datasets.readings.rows[0][0],1,'the duplicate owns its record copy');
  assert.equal(copy.items[0].datasetShared,true,'catalog discovery configuration travels with its owner');
});

test('whole-workspace transfer remaps dataset identities by owner even when source IDs collide',()=>{
  const scope=transferScope(),sources=[
    entry('a',[item('a-owner',{inputValues:{data:{datasetId:'data'}}})],{data:table}),
    entry('b',[
      item('b-owner',{inputValues:{data:{datasetId:'data'}}}),
      item('a-view',{inputValues:{table:{datasetId:'data',sketchId:'a'}}}),
      item('self-view',{inputValues:{table:{datasetId:'data',sketchId:'b'}}}),
      item('receiver',{workspaceReceive:{value:{sketchId:'a',componentUid:'a-owner',port:'value'}}}),
    ],{data:{...table,name:'Other'},unique:table}),
  ];
  const [a,b]=plain(scope.transferWorkspaceEntries(sources,['a-new','b-new'],{freshDatasets:false}));
  const aid=Object.keys(a.datasets)[0],bid=Object.keys(b.datasets)[0];
  assert.equal(aid,'data','whole-workspace replacement preserves noncolliding identities');
  assert.ok(b.datasets.unique,'unrelated imported dataset identities remain unchanged');
  assert.notEqual(aid,bid);
  assert.equal(a.items[0].inputValues.data.datasetId,aid);
  assert.equal(b.items[0].inputValues.data.datasetId,bid);
  assert.deepEqual(b.items[1].inputValues.table,{datasetId:aid,sketchId:'a-new'});
  assert.deepEqual(b.items[2].inputValues.table,{datasetId:bid},'self references use their local pool');
  assert.deepEqual(b.items[3].workspaceReceive,{value:{sketchId:'a-new',componentUid:'a-owner',port:'value'}});
});

test('single-sketch transfer preserves missing external references without matching names',()=>{
  const scope=transferScope(),source=entry('dashboard',[
    item('local'),
    item('receiver',{workspaceReceive:{value:{sketchId:'missing-services',componentUid:'provider',port:'value'}}}),
    item('table',{inputValues:{table:{datasetId:'missing-data',sketchId:'missing-services'}}}),
  ]);
  const [copy]=plain(scope.transferWorkspaceEntries([source],['destination']));
  assert.deepEqual(copy.items[1].workspaceReceive,source.items[1].workspaceReceive);
  assert.deepEqual(copy.items[2].inputValues.table,source.items[2].inputValues.table);
});

test('importing a second copy preserves the original IDs and remaps only imported collisions',()=>{
  const scope=transferScope(),source=entry('original',[
    item('publisher'),
    item('receiver',{workspaceReceive:{value:{sketchId:'original',componentUid:'publisher',port:'value'}},
      bindings:{value:{uid:'publisher',port:'value'}},eventBindings:{append:{uid:'publisher',port:'value'}}}),
    item('external',{workspaceReceive:{value:{sketchId:'services',componentUid:'publisher',port:'value'}}}),
  ]),before=plain(source);
  const [copy]=plain(scope.transferWorkspaceEntries([source],['imported'],{occupiedComponentIds:['publisher','receiver']}));
  assert.deepEqual(source,before);
  assert.notEqual(copy.items[0].uid,'publisher');assert.notEqual(copy.items[1].uid,'receiver');
  assert.equal(copy.items[2].uid,'external','non-conflicting identities are preserved');
  assert.equal(copy.items[1].bindings.value.uid,copy.items[0].uid);
  assert.equal(copy.items[1].eventBindings.append.uid,copy.items[0].uid);
  assert.deepEqual(copy.items[1].workspaceReceive,{value:{sketchId:'imported',componentUid:copy.items[0].uid,port:'value'}});
  assert.deepEqual(copy.items[2].workspaceReceive,{value:{sketchId:'services',componentUid:'publisher',port:'value'}});
});

test('whole-workspace import disambiguates per-sketch component IDs without redirecting receivers',()=>{
  const scope=transferScope(),sources=[
    entry('a',[item('publisher')]),
    entry('b',[item('publisher'),item('consumer',{
      bindings:{value:{uid:'publisher',port:'value'}},workspaceReceive:{value:{sketchId:'a',componentUid:'publisher',port:'value'}},
    })]),
    entry('c',[item('receiver',{workspaceReceive:{value:{sketchId:'b',componentUid:'publisher',port:'value'}}})]),
  ];
  const [a,b,c]=plain(scope.transferWorkspaceEntries(sources,['a','b','c']));
  assert.equal(a.items[0].uid,'publisher');assert.notEqual(b.items[0].uid,'publisher');
  assert.equal(b.items[1].bindings.value.uid,b.items[0].uid);
  assert.equal(b.items[1].workspaceReceive.value.componentUid,a.items[0].uid);
  assert.equal(c.items[0].workspaceReceive.value.componentUid,b.items[0].uid);
});

test('copying a group remaps its selected publishers and retains external endpoint identities',()=>{
  const scope=transferScope();
  const start=html.indexOf('  function remapComponentCopies('),end=html.indexOf('  function remapGroups(',start);
  vm.runInContext(html.slice(start,end),scope);
  scope.activeTabId='destination';
  const originals=[
    item('publisher',{workspaceEndpoint:'publish'}),
    item('receiver',{workspaceReceive:{value:{sketchId:'source',componentUid:'publisher',port:'value'}},bindings:{value:{uid:'publisher',port:'value'}}}),
    item('external',{workspaceReceive:{value:{sketchId:'services',componentUid:'remote-publisher',port:'value'}}}),
  ],copies=plain(originals);
  scope.remapComponentCopies(copies,originals.map(item=>item.uid));
  assert.deepEqual(plain(copies[1].workspaceReceive),{value:{sketchId:'destination',componentUid:copies[0].uid,port:'value'}});
  assert.equal(copies[1].bindings.value.uid,copies[0].uid);
  assert.deepEqual(copies[2].workspaceReceive,originals[2].workspaceReceive);
  assert.deepEqual(originals[1].workspaceReceive,{value:{sketchId:'source',componentUid:'publisher',port:'value'}});
});

test('multi-endpoint copies retain local and published port IDs across names, order, and missing ports',()=>{
  const scope=transferScope(),source=entry('services',[
    item('publisher',{state:{endpoints:[{id:'quantity',name:'Renamed quantity',type:'number'},{id:'value',name:'Renamed message',type:'string'}]}}),
    item('receiver',{state:{endpoints:[{id:'message',name:'Message',type:'string'},{id:'amount',name:'Quantity',type:'number'}]},
      workspaceReceive:{
        message:{sketchId:'services',componentUid:'publisher',port:'value'},
        amount:{sketchId:'services',componentUid:'publisher',port:'quantity'},
        deleted:{sketchId:'services',componentUid:'publisher',port:'deletedPort'},
        external:{sketchId:'external',componentUid:'other',port:'value'},
      }}),
  ]);
  const [copy]=plain(scope.transferWorkspaceEntries([source],['services-copy'],{duplicate:true}));
  assert.deepEqual(copy.items[1].workspaceReceive,{
    message:{sketchId:'services-copy',componentUid:copy.items[0].uid,port:'value'},
    amount:{sketchId:'services-copy',componentUid:copy.items[0].uid,port:'quantity'},
    deleted:{sketchId:'services-copy',componentUid:copy.items[0].uid,port:'deletedPort'},
    external:{sketchId:'external',componentUid:'other',port:'value'},
  },'deleted endpoint identities remain explicit rather than attaching to another row');
  assert.deepEqual(copy.items[0].state.endpoints,source.items[0].state.endpoints);
  const start=html.indexOf('  function remapComponentCopies('),end=html.indexOf('  function remapGroups(',start);
  vm.runInContext(html.slice(start,end),scope);scope.activeTabId='destination';
  const group=plain(source.items);scope.remapComponentCopies(group,source.items.map(item=>item.uid));
  for(const id of ['message','amount','deleted']){
    assert.equal(group[1].workspaceReceive[id].componentUid,group[0].uid);
    assert.equal(group[1].workspaceReceive[id].sketchId,'destination');
    assert.equal(group[1].workspaceReceive[id].port,source.items[1].workspaceReceive[id].port);
  }
  assert.deepEqual(group[1].workspaceReceive.external,source.items[1].workspaceReceive.external);
});

test('persisted Receive rows validate bounded port IDs and exact source identities atomically',()=>{
  const scope=vm.createContext({});
  const fieldsStart=html.indexOf('  function normalizeComponentFields('),fieldsEnd=html.indexOf('  function normalizeItem(',fieldsStart);
  const namesStart=html.indexOf('  function componentPortName('),namesEnd=html.indexOf('  function normalizeComponentPorts(',namesStart);
  vm.runInContext(html.slice(namesStart,namesEnd)+html.slice(fieldsStart,fieldsEnd),scope);
  const ref={sketchId:'services',componentUid:'publisher',port:'sourceValue'};
  const raw={workspaceReceive:{value:ref,quantity:{...ref,port:'quantity'}}},result={};
  scope.normalizeComponentFields(raw,result);
  assert.deepEqual(plain(result.workspaceReceive),raw.workspaceReceive);
  assert.notEqual(result.workspaceReceive.value,ref);
  const maximum=Object.fromEntries(Array.from({length:16},(_,i)=>['p'+i,{...ref}]));
  const maxResult={};scope.normalizeComponentFields({workspaceReceive:maximum},maxResult);
  assert.equal(Object.keys(maxResult.workspaceReceive).length,16);
  const boundary={};scope.normalizeComponentFields({workspaceReceive:{['x'.repeat(48)]:{...ref,port:'y'.repeat(48)}}},boundary);
  assert.equal(boundary.componentInvalid,undefined);
  for(const invalid of [
    ref,[],null,{'not-valid':ref},{value:{...ref,port:'x'.repeat(49)}},{['x'.repeat(49)]:ref},
    {value:{...ref,port:'constructor'}},{constructor:ref},{value:{...ref,sketchId:'__proto__'}},
    {value:{...ref,componentUid:''}},{value:{...ref,extra:true}},
    {...maximum,extra:ref},
  ]){
    const item={};scope.normalizeComponentFields({workspaceReceive:invalid},item);
    assert.equal(item.workspaceReceive,undefined);assert.match(item.componentInvalid,/endpoint reference/);
  }
  const empty={};scope.normalizeComponentFields({workspaceReceive:{}},empty);
  assert.deepEqual(plain(empty.workspaceReceive),{},'unconfigured rows need no fabricated reference');
});

test('settings references follow imported sketches and duplication omits the workspace singleton',()=>{
  const scope=transferScope(),settings=item('settings',{workspaceSettings:true,state:{
    initialSketchId:'b',tabVisibility:[{sketchId:'a',visible:false},{sketchId:'b',visible:true},{sketchId:'external',visible:false}],
  }});
  const [a]=plain(scope.transferWorkspaceEntries([entry('a',[settings]),entry('b',[])],['new-a','new-b']));
  assert.equal(a.items[0].state.initialSketchId,'new-b');
  assert.deepEqual(a.items[0].state.tabVisibility.map(tab=>tab.sketchId),['new-a','new-b','external']);
  const [duplicate]=plain(scope.transferWorkspaceEntries([entry('a',[settings,item('ordinary')])],['copy'],{duplicate:true}));
  assert.equal(duplicate.items.length,1);assert.notEqual(duplicate.items[0].uid,'ordinary');
  assert.throws(()=>scope.assertWorkspaceSettingsTransfer([entry('a',[settings]),entry('b',[settings])],null,true),/only one Workspace settings/);
});

test('identity validation rejects ambiguous transfers and keeps valid sketch IDs',()=>{
  const scope=transferScope();
  assert.equal(scope.validWorkspaceSketchId('tab-a'),true);
  for(const value of ['../x','__proto__','',null,123,'x'.repeat(101)])assert.equal(scope.validWorkspaceSketchId(value),false);
  assert.throws(()=>scope.transferWorkspaceEntries([entry('a',[]),entry('a',[])],['new-a','new-b']),/duplicate sketch IDs/);
  assert.throws(()=>scope.transferWorkspaceEntries([entry('a',[]),entry('b',[])],['same','same']),/destination sketch identities/);
  const [copy]=plain(scope.transferWorkspaceEntries([entry('a',[])],['a']));
  assert.equal(copy.id,'a');
});

function historyScope(){
  const documents=new Map([['b',{items:[item('b',{state:{value:2}})],datasets:{data:{...table,revision:0}}}]]);
  const scope=vm.createContext({
    ensureUids:list=>list,datasetsUsedBy:(_list,pool)=>({...pool}),
    tabs:[{id:'a'},{id:'b'}],activeTabId:'a',items:[item('a',{state:{value:1}})],datasets:{},
    undoStack:[],redoStack:[],workspaceHistoryEnabled:false,workspaceUndoStack:[],workspaceRedoStack:[],
    mode:'whole workspace',unsavedTabs:new Set(),tabDocument:id=>documents.get(id),
  });
  scope.workspaceExecutionMode=()=>scope.mode;
  const start=html.indexOf('  function historySnapshot('),end=html.indexOf('  const snap =',start);
  vm.runInContext(html.slice(start,end),scope);
  return {scope,documents};
}

test('one workspace history snapshot restores visible and hidden changes together',()=>{
  const {scope,documents}=historyScope(),before=scope.workspaceHistorySnapshot();
  assert.equal(before.sketchId,'a');assert.equal(before.workspace.length,1);
  scope.items[0].state.value=10;
  documents.get('b').items[0].state.value=20;
  documents.get('b').datasets={data:{...table,rows:[[99]],revision:1}};
  scope.restoreHistorySnapshot(before);
  assert.equal(scope.items[0].state.value,1);
  assert.equal(documents.get('b').items[0].state.value,2);
  assert.equal(documents.get('b').datasets.data.revision,0);
  assert.deepEqual([...scope.unsavedTabs].sort(),['a','b']);
});

test('history retains the current visible sketch and does not resurrect deleted sketches',()=>{
  const {scope,documents}=historyScope(),before=scope.workspaceHistorySnapshot();
  documents.set('a',{items:scope.items,datasets:scope.datasets});
  scope.activeTabId='b';scope.items=documents.get('b').items;scope.datasets=documents.get('b').datasets;
  scope.items[0].state.value=9;
  scope.restoreHistorySnapshot(before);
  assert.equal(scope.activeTabId,'b');assert.equal(scope.items[0].state.value,2);
  scope.tabs=[{id:'b'}];documents.delete('a');
  scope.restoreHistorySnapshot(before);
  assert.equal(documents.has('a'),false);
});

test('shared history survives execution-mode changes while active-only work stays local',()=>{
  const {scope}=historyScope();
  scope.mode='active sketch';
  assert.equal(scope.workspaceHistorySnapshot().workspace,undefined);
  scope.mode='whole workspace';
  assert.equal(scope.workspaceHistorySnapshot().workspace.length,1);
  scope.mode='active sketch';
  assert.equal(scope.workspaceHistorySnapshot().workspace.length,1,'Undoing a mode edit must not strand its Redo stack');
  const replacement=[];scope.redoStack=replacement;scope.syncWorkspaceHistory();
  assert.equal(scope.workspaceRedoStack,replacement,'direct gesture replacement of Redo remains aliased');
  scope.resetWorkspaceHistory();
  assert.equal(scope.workspaceHistoryEnabled,false);
});

test('accepted background dataset changes fold into a gesture baseline across sketch references',()=>{
  const scope=vm.createContext({activeTabId:'dashboard'});
  const dataStart=html.indexOf('// ---------- embedded datasets ----------'),dataEnd=html.indexOf('// End of embedded dataset contract.');
  const metadataStart=html.indexOf('  function workspaceDatasetPoolMetadata('),metadataEnd=html.indexOf('  function editorRuntimeDocuments(',metadataStart);
  const historyStart=html.indexOf('  function foldDatasetHistorySnapshot('),historyEnd=html.indexOf('  const snap =',historyStart);
  vm.runInContext(html.slice(dataStart,dataEnd)+html.slice(metadataStart,metadataEnd)+html.slice(historyStart,historyEnd),scope);
  const beforeTable={...table,rowIds:['r0','r1'],nextRowId:2,revision:0};
  const afterTable={...table,rows:[[2]],rowIds:['r1'],nextRowId:2,revision:1};
  const sourcePool={data:beforeTable};
  Object.defineProperty(sourcePool,Symbol.for('simplecanvas.datasetSketches'),{value:new Map([['data','services']])});
  const snapshot={
    sketchId:'dashboard',items:JSON.stringify([item('view',{x:10,inputValues:{data:{datasetId:'data',sketchId:'services',rows:[1]}}})]),datasets:{},
    workspace:[{id:'services',items:JSON.stringify([item('owner',{inputValues:{data:{datasetId:'data'}}})]),datasets:{data:beforeTable}}],
  };
  const unchanged=plain(snapshot),folded=plain(scope.foldDatasetHistorySnapshot(snapshot,'data',afterTable,'services',sourcePool));
  assert.deepEqual(snapshot,unchanged,'the accepted action retains its own original Undo snapshot');
  assert.equal(JSON.parse(folded.items)[0].x,10,'the gesture baseline geometry remains untouched');
  assert.deepEqual(JSON.parse(folded.items)[0].inputValues.data.rows,[0]);
  assert.equal(folded.workspace[0].datasets.data.revision,1);
  assert.deepEqual(folded.datasets,{},'remote data is never copied into the consumer sketch');
});

test('MQTT Config references follow workspace copies and preserve explicit external owners',()=>{
  const scope=transferScope(),source=entry('services',[
    item('broker'),item('local',{mqttBinding:{sketchId:'services',componentUid:'broker'}}),
    item('remote',{mqttBinding:{sketchId:'other',componentUid:'external'}})
  ]);
  const [copy]=plain(scope.transferWorkspaceEntries([source],['services-copy'],{duplicate:true}));
  assert.deepEqual(copy.items[1].mqttBinding,{sketchId:'services-copy',componentUid:copy.items[0].uid});
  assert.deepEqual(copy.items[2].mqttBinding,source.items[2].mqttBinding);
  const [moved,consumer]=plain(scope.transferWorkspaceEntries([source,entry('view',[item('reading',{mqttBinding:{sketchId:'services',componentUid:'broker'}})])],['imported-services','imported-view'],{occupiedComponentIds:['broker']}));
  assert.deepEqual(consumer.items[0].mqttBinding,{sketchId:'imported-services',componentUid:moved.items[0].uid});
  const [alone]=plain(scope.transferWorkspaceEntries([entry('view',[item('reading',{mqttBinding:{sketchId:'missing',componentUid:'broker'}})])],['view-copy']));
  assert.deepEqual(alone.items[0].mqttBinding,{sketchId:'missing',componentUid:'broker'},'an absent connection stays broken rather than binding by display name');
});

test('MQTT references normalize as bounded identities, independently of ordinary signal bindings',()=>{
  const scope=vm.createContext({componentPortName:name=>typeof name==='string' && /^[a-zA-Z]\w*$/.test(name),isNum:Number.isFinite,DATA_LIMITS:{rows:1000}});
  const start=html.indexOf('  function normalizeComponentFields('),end=html.indexOf('  function normalizeItem(',start);
  vm.runInContext(html.slice(start,end),scope);
  const result={};scope.normalizeComponentFields({mqttBinding:{sketchId:'services',componentUid:'broker'}},result);
  assert.deepEqual(plain(result),{mqttBinding:{sketchId:'services',componentUid:'broker'}});
  for(const ref of [null,[],{}, {sketchId:'__proto__',componentUid:'broker'}, {sketchId:'services',componentUid:''}, {sketchId:'services',componentUid:'broker',password:'secret'}]){
    const invalid={};scope.normalizeComponentFields({mqttBinding:ref},invalid);assert.match(invalid.componentInvalid,/Invalid MQTT/);
  }
});
