const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const scope=vm.createContext({});
const start=html.indexOf('  function componentWorkspace(scene)'),end=html.indexOf('  function editorRuntimeDocuments(',start);
const dataStart=html.indexOf('// ---------- embedded datasets ----------'),dataEnd=html.indexOf('// End of embedded dataset contract.');
assert.ok(start>0 && end>start && dataStart>0 && dataEnd>dataStart);
vm.runInContext(html.slice(dataStart,dataEnd)+html.slice(start,end),scope);
const plain=value=>JSON.parse(JSON.stringify(value));
const table={name:'Table',columns:[{key:'value',name:'Value',type:'number'}],rows:[[1]]};
function documents(){
  return [
    {id:'services',name:'Services',items:[
      {type:'smart',componentApi:2,uid:'settings',workspaceSettings:true,state:{executionMode:'whole workspace',initialSketchId:'dashboard',tabVisibility:[{sketchId:'services',visible:false}]}},
      {type:'smart',componentApi:2,uid:'publisher',state:{endpoints:[{id:'value',name:'Value',type:'number'}]}},
    ],datasets:{records:table}},
    {id:'dashboard',name:'Dashboard',items:[
      {type:'smart',componentApi:2,uid:'receiver',workspaceReceive:{value:{sketchId:'services',componentUid:'publisher',port:'value'}}},
    ],datasets:{}},
  ];
}
const receiveCaps={workspaceEndpoint:{direction:'receive',ports:{value:{type:'number'}}},eventOutputs:{value:{types:['number'],hybrid:true}}};

test('whole-workspace context retains original component identities and qualified dataset ownership',()=>{
  const docs=documents(),context=scope.createWorkspaceRuntimeContext(docs,'dashboard',7);
  assert.equal(context.whole,true);assert.equal(context.scene.length,3);
  assert.equal(context.scene[1],docs[0].items[1]);assert.equal(context.scene[2],docs[1].items[0]);
  assert.equal(scope.componentWorkspace(context.scene),context);
  assert.equal(context.pool.records,table);assert.equal(context.sketchByUid.get('publisher'),'services');
  assert.deepEqual(plain(scope.datasetReference({datasetId:'records',sketchId:'services'},context.pool)),{datasetId:'records',sketchId:'services'});
  assert.throws(()=>scope.datasetReference({datasetId:'records',sketchId:'dashboard'},context.pool),/unavailable/);
});

test('navigation and presentation edits preserve the whole-workspace scene and its timer ownership',()=>{
  const docs=documents(),first=scope.createWorkspaceRuntimeContext(docs,'dashboard',7);
  docs[0].items[0].state.tabVisibility[0].visible=true;
  docs[0].name='Renamed services';
  const second=scope.createWorkspaceRuntimeContext(docs,'services',7,first);
  assert.equal(second,first);assert.equal(second.scene,first.scene);
  assert.equal(second.config.tabVisibility[0].visible,true);
  assert.equal(second.activeId,'services');assert.equal(second.documents[0].name,'Renamed services');
});

test('a new immutable dataset revision updates the pool without replacing the workspace scene',()=>{
  const docs=documents(),first=scope.createWorkspaceRuntimeContext(docs,'dashboard',7);
  const next={...table,rows:[[2]],revision:1};
  docs[0].datasets={records:next};
  const second=scope.createWorkspaceRuntimeContext(docs,'dashboard',7,first);
  assert.notEqual(second,first);assert.equal(second.scene,first.scene);
  assert.equal(second.pool.records,next);assert.equal(first.pool.records,table);
  assert.equal(scope.componentWorkspace(second.scene),second);
});

test('ordinary member changes preserve timers while history replacement and workspace generation reset scene ownership',()=>{
  const docs=documents(),first=scope.createWorkspaceRuntimeContext(docs,'dashboard',7);
  docs[1].items.push({type:'rect',uid:'new-drawing'});
  const added=scope.createWorkspaceRuntimeContext(docs,'dashboard',7,first);
  assert.equal(added.scene,first.scene);assert.equal(added.scene.length,4);
  docs[1].items.pop();
  const removed=scope.createWorkspaceRuntimeContext(docs,'dashboard',7,added);
  assert.equal(removed.scene,first.scene);assert.equal(removed.scene.length,3);
  docs[1].items=plain(docs[1].items);
  const restored=scope.createWorkspaceRuntimeContext(docs,'dashboard',7,removed);
  assert.notEqual(restored.scene,removed.scene);
  const generation=scope.createWorkspaceRuntimeContext(docs,'dashboard',8,restored);
  assert.notEqual(generation.scene,restored.scene);
});

test('active-only mode includes inactive workspace settings but excludes remote sources and records',()=>{
  const docs=documents();docs[0].items[0].state.executionMode='active sketch';
  const context=scope.createWorkspaceRuntimeContext(docs,'dashboard',7);
  assert.equal(context.whole,false);
  assert.ok(context.scene.includes(docs[0].items[0]));
  assert.ok(!context.scene.includes(docs[0].items[1]));
  assert.deepEqual(Object.keys(context.pool),[]);
  assert.equal(scope.componentRuntimeBindings(docs[1].items[0],receiveCaps,context.scene).__remote_value.unresolved,true);
  assert.throws(()=>scope.datasetReference({datasetId:'records',sketchId:'services'},context.pool),/missing/);
});

test('Receive resolves exact sketch/component identities and missing or ambiguous endpoints stay unresolved',()=>{
  const docs=documents(),context=scope.createWorkspaceRuntimeContext(docs,'dashboard');
  const receiver=docs[1].items[0];
  assert.deepEqual(plain(scope.componentRuntimeBindings(receiver,receiveCaps,context.scene)),{__remote_value:{uid:'publisher',port:'value'}});
  receiver.workspaceReceive.value.sketchId='renamed-by-hand';
  assert.equal(scope.componentRuntimeBindings(receiver,receiveCaps,context.scene).__remote_value.unresolved,true);
  receiver.workspaceReceive.value.sketchId='services';
  docs[1].items.push({type:'smart',componentApi:2,uid:'publisher'});
  const duplicate=scope.createWorkspaceRuntimeContext(docs,'dashboard');
  assert.equal(duplicate.duplicates.has('publisher'),true);
  assert.equal(scope.componentRuntimeBindings(receiver,receiveCaps,duplicate.scene).__remote_value.unresolved,true);
  docs[0].items.splice(1,1);docs[1].items.pop();
  const deleted=scope.createWorkspaceRuntimeContext(docs,'dashboard');
  assert.equal(scope.componentRuntimeBindings(receiver,receiveCaps,deleted.scene).__remote_value.unresolved,true);
});

test('dataset identity collisions are rejected and deleting the source sketch removes its data',()=>{
  const docs=documents();docs[1].datasets={records:table};
  assert.throws(()=>scope.createWorkspaceRuntimeContext(docs,'dashboard'),/identities must be unique/);
  docs[1].datasets={};
  docs[1].items.push(docs[0].items[0]);
  const deleted=scope.createWorkspaceRuntimeContext(docs.slice(1),'dashboard');
  assert.throws(()=>scope.datasetReference({datasetId:'records',sketchId:'services'},deleted.pool),/missing/);
});

test('workspace metadata follows graph snapshots and pool copies without being serialized',()=>{
  const docs=documents(),context=scope.createWorkspaceRuntimeContext(docs,'dashboard'),snapshot=plain(context.scene);
  scope.attachComponentWorkspace(snapshot,context);
  assert.equal(scope.componentWorkspace(snapshot),context);
  assert.equal(JSON.stringify(snapshot),JSON.stringify(context.scene));
  const pool=scope.workspaceDatasetPoolMetadata({...context.pool},context.pool);
  assert.deepEqual(plain(scope.datasetReference({datasetId:'records',sketchId:'services'},pool)),{datasetId:'records',sketchId:'services'});
  assert.equal(JSON.stringify(pool),JSON.stringify(context.pool));
});

test('Receive capabilities preserve independently typed scalar, event-only, and table channels',()=>{
  const scalar=plain(scope.workspaceEndpointCaps({apiVersion:2,outputs:{value:{type:'number'}},...receiveCaps}));
  assert.equal(scalar.inputs.__remote_value.internal,true);assert.equal(scalar.inputs.__remote_value.event,true);
  assert.deepEqual(scalar.eventInputs.__remote_value.types,['number']);assert.equal(scalar.eventTransform,undefined);
  const mixed=plain(scope.workspaceEndpointCaps({
    workspaceEndpoint:{direction:'receive',ports:{value:{type:'string'},submitted:{type:'event'},rows:{type:'table'}}},
    eventOutputs:{value:{types:['string'],hybrid:true},submitted:{types:['none','boolean','number','string']}},
  }));
  assert.deepEqual(mixed.inputs,{
    __remote_value:{type:'string',optional:true,event:true,internal:true},
    __remote_rows:{type:'table',internal:true},
  });
  assert.equal(mixed.eventInputs.__remote_value.hybrid,true);
  assert.equal(mixed.eventInputs.__remote_submitted.hybrid,false);
  assert.deepEqual(mixed.eventInputs.__remote_submitted.types,['none','boolean','number','string']);
  assert.equal(mixed.eventInputs.__remote_rows,undefined);assert.equal(mixed.eventTransform,undefined);
});

test('Receive rows map local port IDs to independent source ports without using names or row order',()=>{
  const docs=documents(),receiver=docs[1].items[0];
  receiver.workspaceReceive={
    count:{sketchId:'services',componentUid:'publisher',port:'quantity'},
    message:{sketchId:'services',componentUid:'publisher',port:'value'},
    missing:{sketchId:'services',componentUid:'publisher',port:'removed'},
  };
  const caps={workspaceEndpoint:{direction:'receive',ports:{message:{type:'string'},count:{type:'number'},missing:{type:'string'}}}};
  const context=scope.createWorkspaceRuntimeContext(docs,'dashboard');
  assert.deepEqual(plain(scope.componentRuntimeBindings(receiver,caps,context.scene)),{
    __remote_message:{uid:'publisher',port:'value'},
    __remote_count:{uid:'publisher',port:'quantity'},
    __remote_missing:{uid:'publisher',port:'removed'},
  },'a missing port remains an explicit missing-port reference for graph validation');
  delete receiver.workspaceReceive.count;
  assert.equal(scope.componentRuntimeBindings(receiver,caps,context.scene).__remote_count.unresolved,true);
});
