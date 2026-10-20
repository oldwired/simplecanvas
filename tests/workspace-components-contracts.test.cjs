const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const load=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
const defaults=(def,state)=>Object.fromEntries(Object.entries(typeof def.inputs==='function'?def.inputs(state):def.inputs).map(([key,port])=>[key,port.default]));

test('Workspace settings separates startup configuration from live presentation inputs',()=>{
  const def=load('workspace-settings'),state=def.initState(),ports=def.inputs(state);
  assert.deepEqual(plain(state),{executionMode:'active sketch',initialSketchId:'',tabVisibility:[]});
  assert.deepEqual(Object.keys(ports),['title','showTabs','showWiring','showSimulationControls']);
  assert.deepEqual(plain(def.workspaceSettings),{title:'title',showTabs:'showTabs',showWiring:'showWiring',showSimulationControls:'showSimulationControls'});
  for(const executionMode of ['active sketch','whole workspace'])assert.deepEqual(plain(def.compute(defaults(def,state),{...state,executionMode})),{});
  for(const key of ['executionMode','initialSketchId'])assert.equal(ports[key],undefined);
  assert.equal(def.transition,undefined);assert.equal(def.publish,undefined);assert.equal(def.dataActions,undefined);
});

test('Workspace tab visibility uses stable sketch IDs and optional independent live controls',()=>{
  const def=load('workspace-settings'),state={...def.initState(),initialSketchId:'dashboard',tabVisibility:[{sketchId:'services',visible:false},{sketchId:'dashboard',visible:true,input:'tab0'}]},before=JSON.stringify(state);
  assert.equal(def.inputs(state).tab0.default,true);assert.equal(def.inputs(state).tab0.role,'control');
  assert.deepEqual(plain(def.compute({...defaults(def,state),tab0:false},state)),{});
  assert.equal(JSON.stringify(state),before);
  for(const tabVisibility of [null,Array(129).fill({sketchId:'x',visible:true}),[{sketchId:'',visible:true}],[{sketchId:'s',visible:'false'}],[{sketchId:'s',visible:false},{sketchId:'s',visible:true}],[{sketchId:'s',visible:true,input:'title'}],[{sketchId:'s',visible:true,input:'tab0'},{sketchId:'d',visible:true,input:'tab0'}],Array.from({length:29},(_,i)=>({sketchId:'s'+i,visible:true,input:'tab'+i}))])assert.throws(()=>def.inputs({...state,tabVisibility}));
  assert.throws(()=>def.inputs({...state,executionMode:'anything'}));
  assert.throws(()=>def.inputs({...state,initialSketchId:1}));
  assert.throws(()=>def.compute({...defaults(def,state),tab0:1},state),/Boolean/);
});

test('Sketch overrides default to inheritance; explicit empty title remains an override',()=>{
  const def=load('page-settings'),state=def.initState(),inputs=defaults(def,state);
  assert.equal(Object.values(state).every(value=>value===false),true);
  assert.deepEqual(Object.keys(def.sketchSettingsOverrides),Object.keys(def.pageSettings));
  assert.deepEqual(plain(def.compute(inputs,state)),{});
  const inherited=def.children(state,def.initStyle(),300,160,false,{inputs}).filter(child=>child.type==='text').map(child=>child.text);
  assert.ok(inherited.includes('Sketch settings'));assert.ok(inherited.includes('Title: inherit'));
  const changed={...state,overrideTitle:true,overrideShowTabs:true};
  const explicit=def.children(changed,def.initStyle(),300,160,false,{inputs:{...inputs,title:'',showTabs:false}}).filter(child=>child.type==='text').map(child=>child.text);
  assert.ok(explicit.includes('Title: (empty)'));assert.ok(explicit.includes('Tab bar: hidden · Wiring: inherit'));
  assert.throws(()=>def.compute(inputs,{...state,overrideTitle:'false'}),/Boolean/);
});

test('Settings previews and unavailable previews remain authoring only',()=>{
  for(const name of ['page-settings','workspace-settings']){
    const def=load(name),state=def.initState(),style=def.initStyle();
    for(const method of ['children','unavailableChildren']){
      const children=def[method](state,style,style.w,style.h,false,{name:'<b>literal</b>',error:method==='unavailableChildren'?'Unavailable source':undefined});
      assert.ok(children.length);assert.ok(children.every(child=>child.editorOnly));
      assert.ok(children.some(child=>child.text==='<b>literal</b>' && child.plainText));
    }
    for(const title of [null,42,'x'.repeat(2001)])assert.throws(()=>def.compute({...defaults(def,state),title},state),/Window title/);
  }
});

const endpoint=(id,type='string',name=id)=>({id,type,name,description:''});
const endpointState=(...rows)=>({endpoints:rows});

test('Typed Publish and Receive preserve scalar values exactly with stable port IDs',()=>{
  const publish=load('publish'),receive=load('receive');
  for(const [type,value] of [['string',''],['string','Hello 👨‍👩‍👧‍👦'],['number',2.8],['number',0.1+0.2],['number',-0],['boolean',false],['boolean',true]]){
    const state=endpointState(endpoint('sample',type,'Latest sample'));
    assert.deepEqual(plain(publish.workspaceEndpoint(state)),{direction:'publish',ports:{sample:{type}}});
    assert.deepEqual(plain(receive.workspaceEndpoint(state)),{direction:'receive',ports:{sample:{type}}});
    assert.equal(publish.inputs(state).sample.event,true);assert.equal(receive.outputs(state).sample.event,true);
    assert.equal(publish.inputs(state).sample.label,'Latest sample');
    assert.ok(Object.is(publish.compute({sample:value},state).sample,value));
    assert.ok(Object.is(receive.compute({},state,{workspaceEndpoint:{sample:value}}).sample,value));
    assert.ok(Object.is(receive.compute({__remote_sample:value},state).sample,value));
    assert.deepEqual(plain(receive.inputs),{});
    for(const component of [publish,receive]){assert.equal(component.transition,undefined);assert.equal(component.publish,undefined);}
  }
});

test('Mixed endpoints independently expose scalar, table and event ports in one block',()=>{
  const publish=load('publish'),receive=load('receive'),rows=endpointState(endpoint('name'),endpoint('count','number'),endpoint('enabled','boolean'),endpoint('rows','table'),endpoint('done','event'));
  const table={datasetId:'records',sketchId:'services'},values={name:'Anna',count:3.5,enabled:false,rows:table};
  assert.deepEqual(Object.keys(publish.inputs(rows)),['name','count','enabled','rows']);
  assert.deepEqual(Object.keys(publish.outputs(rows)),['name','count','enabled','rows']);
  assert.deepEqual(Object.keys(publish.eventInputs(rows)),['done']);
  assert.deepEqual(Object.keys(receive.eventOutputs(rows)),['done']);
  assert.deepEqual(plain(publish.compute(values,rows)),values);
  assert.deepEqual(plain(receive.compute(Object.fromEntries(Object.entries(values).map(([key,value])=>['__remote_'+key,value])),rows)),values);
  assert.equal(publish.compute(values,rows).rows,table,'table values retain the reference');
  for(const component of [publish,receive])assert.deepEqual(plain(component.eventOutputs(rows).done.types),['none','boolean','number','string']);
});

test('Renaming and reordering endpoint rows preserve their port IDs and independent event routes',()=>{
  const publish=load('publish'),receive=load('receive'),state=endpointState(endpoint('left','string','First'),endpoint('right','number','Second'));
  const renamed=endpointState({...state.endpoints[1],name:'Renamed count'}, {...state.endpoints[0],name:'Renamed text'});
  for(const def of [publish,receive]){
    assert.deepEqual(Object.keys(def.outputs(renamed)),['right','left']);
    assert.equal(def.outputs(renamed).right.label,'Renamed count');
    assert.deepEqual(plain(def.workspaceEndpoint(renamed).ports),{right:{type:'number'},left:{type:'string'}});
  }
  assert.deepEqual(plain(publish.onEvent('left','captured',renamed).events),[{port:'left',payload:'captured'}]);
  assert.deepEqual(plain(receive.onEvent('__remote_right',12,renamed).events),[{port:'right',payload:12}]);
});

test('Receive never supplies stale or fabricated values for unresolved rows',()=>{
  const def=load('receive');
  for(const type of ['string','number','boolean']){
    const state=endpointState(endpoint('value',type));
    assert.throws(()=>def.compute({},state),/published endpoint/);
    for(const value of [undefined,{},[],NaN,Infinity,'x'.repeat(2001)])assert.throws(()=>def.compute({__remote_value:value},state));
  }
});

test('Endpoint rows are bounded and reject duplicate IDs, missing labels and invalid metadata',()=>{
  for(const name of ['publish','receive']){
    const def=load(name),base=def.initState();
    assert.equal(base.endpoints[0].id,'value');assert.equal(base.endpoints.length,1);
    for(const endpoints of [[],Array.from({length:17},(_,i)=>endpoint('row'+i)),[endpoint('x'),endpoint('x')]])assert.throws(()=>def.workspaceEndpoint({endpoints}));
    for(const id of ['', '1bad','has space','__proto__','constructor','prototype','x'.repeat(49)])assert.throws(()=>def.workspaceEndpoint(endpointState(endpoint(id))),/identifier/);
    for(const rowName of ['', '   ',null,'x'.repeat(65)])assert.throws(()=>def.workspaceEndpoint(endpointState(endpoint('id','string',rowName))),/name/);
    for(const type of ['object','any',null])assert.throws(()=>def.workspaceEndpoint(endpointState(endpoint('id',type))),/endpoint/);
    for(const description of [null,'x'.repeat(201)])assert.throws(()=>def.workspaceEndpoint(endpointState({...endpoint('id'),description})),/description/);
    assert.equal(Object.keys(def.workspaceEndpoint({endpoints:Array.from({length:16},(_,i)=>endpoint('row'+i))}).ports).length,16);
  }
});

test('Event-only rows forward scalar and payload-free occurrences without affecting other routes',()=>{
  for(const name of ['publish','receive']){
    const def=load(name),state=endpointState(endpoint('notice','event'),endpoint('other','event')),before=JSON.stringify(state);
    assert.deepEqual(plain(typeof def.inputs==='function'?def.inputs(state):def.inputs),{});assert.deepEqual(plain(def.outputs(state)),{});
    for(const payload of [null,false,true,0,2.8,'','same','same']){
      const result=def.onEvent(name==='publish'?'notice':'__remote_notice',payload,state);
      assert.deepEqual(plain(result.events),[{port:'notice',payload}]);assert.equal(result.state,state);
    }
    assert.equal(JSON.stringify(state),before);
    for(const payload of [undefined,NaN,Infinity,{},[],'x'.repeat(2001)])assert.throws(()=>def.onEvent(name==='publish'?'notice':'__remote_notice',payload,state),/payload/);
  }
});

test('Typed endpoint event payloads match their row and table rows cannot emit events',()=>{
  for(const name of ['publish','receive']){
    const def=load(name),state=endpointState(endpoint('count','number'),endpoint('rows','table')),prefix=name==='publish'?'':'__remote_';
    assert.equal(def.onEvent(prefix+'count',0,state).events[0].payload,0);
    for(const payload of [null,false,'3'])assert.throws(()=>def.onEvent(prefix+'count',payload,state),/declared type/);
    assert.throws(()=>def.onEvent(prefix+'rows',3,state),/declared type/);
    assert.throws(()=>def.onEvent('other',3,state),/Unknown/);
  }
});

test('Receive preview lists individual source paths literally and shows unavailable errors',()=>{
  const def=load('receive'),state=endpointState(endpoint('first'),endpoint('second','number')),style=def.initStyle();
  const children=def.children(state,style,320,136,false,{name:'Reader',workspaceSourceNames:{first:'Services / Values / Text',second:'Services / Values / Count'}});
  for(const text of ['Reader','Services / Values / Text','Services / Values / Count'])assert.ok(children.some(child=>child.text===text && child.plainText),text);
  const missing=def.unavailableChildren(state,style,320,136,false,{error:'Publisher deleted'});assert.ok(missing.some(child=>child.text==='Publisher deleted'));
});
