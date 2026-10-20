const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const source=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'));
const defaults=def=>Object.fromEntries(Object.entries(def.inputs).filter(([,p])=>'default' in p).map(([k,p])=>[k,p.default]));
const data={name:'Results',columns:[{key:'team',name:'Team',type:'string'},{key:'points',name:'Points',type:'number'},{key:'ready',name:'Ready',type:'boolean'}],rows:[['B',3,true],['a',2,false],['A',4,true],['B',null,false],[null,8,true],['',1,null],['a',2,false]]};
const ref={datasetId:'source'};
const snapshot=table=>({...table,rowCount:table.rows.length,rowIndices:table.rows.map((_,i)=>i)});
function compute(name,patch={},table=data,state){const def=source(name);return plain(def.compute({...defaults(def),data:ref,...patch},state||def.initState(),{tables:{data:snapshot(table)}}));}
function runtime(){
  const scope=vm.createContext({TextEncoder,performance:{now:()=>0},datasets:{},smartCancelled:()=>Object.assign(new Error('Cancelled'),{cancelled:true}),normalizeSmartState:plain,smartNumber:v=>v,smartItemExecutions:new Map(),disposeSmartExecution:()=>{}});
  const ranges=[['// ---------- embedded datasets ----------','// End of embedded dataset contract.'],['  function componentScalar(','  function normalizeComponentSettings('],['  function componentGraphSignature(','  let editorComponentEvaluation=']];
  const code=ranges.map(([a,b])=>html.slice(html.indexOf(a),html.indexOf(b))).join('\n');
  vm.runInContext(code+'\nthis.api={runComponentEvaluation,settleComponentTimeline,createComponentTimeline,normalizeComponentOutputs,normalizeComponentPorts,componentTableSnapshot,normalizeDatasets,datasetReference,normalizeComponentActionDeclarations,takeComponentDataActions};',scope);
  return scope.api;
}
function node(uid,name,bindings={},inputValues={}){return {uid,type:'smart',componentApi:2,script:name,state:source(name).initState(),bindings,inputValues};}
function caller(api,custom={}){return async(item,hook,args)=>{
  const def=custom[item.script]||source(item.script);
  if(hook==='caps')return {apiVersion:2,compute:typeof def.compute==='function',publish:typeof def.publish==='function',transition:typeof def.transition==='function',datasetOwner:def.datasetOwner,inputs:api.normalizeComponentPorts(def.inputs,'input'),outputs:api.normalizeComponentPorts(def.outputs,'output'),dataActions:typeof def.dataActions==='function'?def.dataActions(args[0]):def.dataActions};
  return def[hook](...args);
};}

test('sort is stable, typed, and puts null last in both directions',()=>{
  assert.deepEqual(compute('table-sort',{column:'points'}).data.rows,[5,1,6,0,2,4,3]);
  assert.deepEqual(compute('table-sort',{column:'points',direction:'descending'}).data.rows,[4,2,0,1,6,5,3]);
  assert.deepEqual(compute('table-sort',{column:'team'}).data.rows,[5,1,2,6,0,3,4]);
  assert.deepEqual(compute('table-sort',{column:'team'},data,{caseSensitive:true}).data.rows,[5,2,0,3,1,6,4]);
  assert.deepEqual(compute('table-sort',{column:'ready'}).data.rows,[1,3,6,0,2,4,5]);
  assert.deepEqual(compute('table-sort').data,ref);
  assert.throws(()=>compute('table-sort',{column:'missing'}),/Unknown sort column/);
});

test('sort preserves the incoming row IDs and does not mutate a filtered selection',()=>{
  const def=source('table-sort'),table={...snapshot(data),rows:[data.rows[6],data.rows[2],data.rows[1]],rowIndices:[6,2,1],rowCount:3};
  const before=JSON.stringify(table);
  const result=plain(def.compute({...defaults(def),data:{datasetId:'source',rows:[6,2,1]},column:'points'},def.initState(),{tables:{data:table}}));
  assert.deepEqual(result,{data:{datasetId:'source',rows:[6,1,2]},rowCount:3});assert.equal(JSON.stringify(table),before);
});

test('aggregate groups typed values, preserves group order, ignores null values and labels result columns',()=>{
  const before=JSON.stringify(data),sum=compute('table-aggregate',{group:'team',value:'points',operation:'sum'});
  assert.deepEqual(sum.data.table.rows,[['B',3],['a',4],['A',4],[null,8],['',1]]);
  assert.deepEqual(sum.data.table.columns,[{key:'group',name:'Team',type:'string'},{key:'result',name:'Sum of Points',type:'number'}]);
  assert.equal(sum.rowCount,5);assert.equal(JSON.stringify(data),before);
  assert.deepEqual(compute('table-aggregate',{group:'ready'}).data.table.rows,[[true,3],[false,3],[null,1]]);
  assert.deepEqual(compute('table-aggregate',{group:'team',operation:'average',value:'points'}).data.table.rows,[['B',3],['a',2],['A',4],[null,8],['',1]]);
  assert.deepEqual(compute('table-aggregate',{operation:'min',value:'points'}).data.table.rows,[[1]]);
  assert.deepEqual(compute('table-aggregate',{operation:'max',value:'points'}).data.table.rows,[[8]]);
});

test('empty and all-null aggregation semantics are explicit and overflowing sums fail',()=>{
  for(const [operation,result] of [['count',0],['sum',0],['average',null],['min',null],['max',null]]){
    assert.deepEqual(compute('table-aggregate',{operation,value:'points'},{...data,rows:[]}).data.table.rows,[[result]]);
  }
  assert.deepEqual(compute('table-aggregate',{group:'team'},{...data,rows:[]}).data.table.rows,[]);
  assert.deepEqual(compute('table-aggregate',{group:'team',operation:'sum',value:'points'},{...data,rows:[['B',null,false]]}).data.table.rows,[['B',0]]);
  assert.throws(()=>compute('table-aggregate',{operation:'sum',value:'team'}),/numeric value column/);
  assert.throws(()=>compute('table-aggregate',{group:'missing'}),/Unknown group column/);
  assert.throws(()=>compute('table-aggregate',{operation:'sum',value:'points'},{...data,rows:[['A',Number.MAX_SAFE_INTEGER,true],['A',1,true]]}),/number range/);
});

test('derived outputs are validated independently from compact input references and remain bounded',()=>{
  const api=runtime(),raw=compute('table-aggregate',{group:'team',value:'points',operation:'sum'});
  assert.deepEqual(plain(api.normalizeComponentOutputs(raw,{data:{type:'table'},rowCount:{type:'number'}})),raw);
  assert.throws(()=>api.normalizeComponentOutputs({data:raw.data},{data:{type:'number'}}),/table output/);
  assert.throws(()=>api.normalizeComponentOutputs({data:{table:{...data,rows:[[1,2,3]]}}}),/column type/);
  assert.throws(()=>api.normalizeComponentOutputs({data:{table:{...data,rows:Array.from({length:1001},()=>data.rows[0])}}}),/1000 rows/);
  const unicode={name:'Unicode',columns:[{key:'v',name:'V',type:'string'}],rows:Array.from({length:200},()=>['é'.repeat(1500)])};
  assert.throws(()=>api.normalizeComponentOutputs({data:{table:unicode}}),/byte transfer limit/);
});

test('aggregate → sort → table resolves ephemeral data without altering the embedded pool or scene',async()=>{
  const api=runtime(),nodes=[node('aggregate','table-aggregate',{}, {data:ref,group:'team',operation:'sum',value:'points'}),node('sort','table-sort',{data:{uid:'aggregate',port:'data'}},{column:'result',direction:'descending'}),node('table','data-table',{data:{uid:'sort',port:'data'}})];
  const pool={source:data},before=JSON.stringify({pool,nodes}),records=await api.runComponentEvaluation(nodes,caller(api),()=>true,{datasets:pool});
  for(const record of records.values())assert.equal(record.error,undefined);
  const output=records.get(nodes[2]).io.tables.inputs.data;
  assert.deepEqual(plain(output.rows),[[null,8],['a',4],['A',4],['B',3],['',1]]);
  assert.equal(output.rowCount,5);assert.equal(Object.keys(records.datasets).length,2);assert.equal(JSON.stringify({pool,nodes}),before);
  assert.notEqual(records.get(nodes[0]).io.outputs.data.datasetId,'source');
});

test('derived content updates use immutable IDs and re-evaluate all downstream consumers in any scene order',async()=>{
  const api=runtime(),aggregate=node('aggregate','table-aggregate',{}, {data:ref,operation:'sum',value:'points'}),sort=node('sort','table-sort',{data:{uid:'aggregate',port:'data'}},{column:'result'}),table=node('table','data-table',{data:{uid:'sort',port:'data'}}),nodes=[table,sort,aggregate];
  const timeline=api.createComponentTimeline(),call=caller(api),pool={source:data};
  let records=await api.runComponentEvaluation(nodes,call,()=>true,{datasets:pool,timeline});
  const id=records.get(aggregate).io.outputs.data.datasetId;
  assert.deepEqual(plain(records.get(table).io.tables.inputs.data.rows),[[20]]);
  pool.source={...data,rows:[['C',9,true]]};
  records=await api.runComponentEvaluation(nodes,call,()=>true,{datasets:pool,timeline});
  assert.notEqual(records.get(aggregate).io.outputs.data.datasetId,id);
  assert.deepEqual(plain(records.get(table).io.tables.inputs.data.rows),[[9]]);
  assert.equal(Object.keys(timeline.derivedTables).length,1);
});

test('paused step preserves derived tables between rounds and settling carries them to original items',async()=>{
  const api=runtime(),aggregate=node('aggregate','table-aggregate',{}, {data:ref,group:'team'}),table=node('table','data-table',{data:{uid:'aggregate',port:'data'}}),nodes=[table,aggregate],timeline=api.createComponentTimeline(),call=caller(api);
  let records;
  for(let i=0;i<8;i++){
    records=await api.settleComponentTimeline(nodes,call,()=>true,timeline,{datasets:{source:data},step:true});
    if(timeline.pendingTime===null)break;
  }
  assert.equal(timeline.pendingTime,null);assert.equal(timeline.active,false);
  assert.equal(records.get(table).error,undefined);assert.equal(records.get(table).io.outputs.rowCount,5);
  assert.equal(Object.keys(records.datasets).length,2);assert.equal(Object.keys(timeline.derivedTables).length,1);
  assert.equal(JSON.stringify(nodes).includes('derived-'),false,'derived refs never enter saved item state');
});

test('derived budget errors stay local, recover on input changes, and deleted producers release tables',async()=>{
  const api=runtime(),aggregate=node('aggregate','table-aggregate',{}, {data:ref,operation:'sum',value:'points'}),table=node('table','data-table',{data:{uid:'aggregate',port:'data'}}),nodes=[aggregate,table],timeline=api.createComponentTimeline(),call=caller(api);
  let records=await api.runComponentEvaluation(nodes,call,()=>true,{datasets:{source:data},timeline});
  assert.equal(records.get(table).error,undefined);
  const huge={...data,rows:[['A',Number.MAX_SAFE_INTEGER,true],['A',1,true]]};
  records=await api.runComponentEvaluation(nodes,call,()=>true,{datasets:{source:huge},timeline});
  assert.match(records.get(aggregate).error,/number range/);assert.match(records.get(table).error,/unavailable/);
  records=await api.runComponentEvaluation(nodes,call,()=>true,{datasets:{source:data},timeline});
  assert.equal(records.get(table).error,undefined);
  await api.runComponentEvaluation([],call,()=>true,{datasets:{source:data},timeline});
  assert.equal(Object.keys(timeline.derivedTables).length,0);
});

test('the derived pool rejects excess memory locally and releases removed producers before retrying',async()=>{
  const api=runtime(),large={name:'Large result',columns:[{key:'text',name:'Text',type:'string'}],rows:Array.from({length:200},()=>['x'.repeat(1900)])};
  const def={inputs:{},outputs:{data:{type:'table'}},compute:()=>({data:{table:large}})};
  const nodes=Array.from({length:6},(_,index)=>({uid:'generator-'+index,type:'smart',componentApi:2,script:'generate',state:{}}));
  const timeline=api.createComponentTimeline(),call=caller(api,{generate:def});
  let records=await api.runComponentEvaluation(nodes,call,()=>true,{datasets:{},timeline});
  assert.equal([...records.values()].filter(record=>!record.error).length,5);
  assert.match(records.get(nodes[5]).error,/runtime limit/);
  assert.ok(JSON.stringify(timeline.derivedTables).length<2000000);
  records=await api.runComponentEvaluation(nodes.slice(1),call,()=>true,{datasets:{},timeline});
  assert.equal(records.get(nodes[5]).error,undefined,'deleting a producer immediately frees its derived-table budget');
  assert.equal(Object.keys(timeline.derivedTables).length,5);
  nodes[1].script='replacement';
  records=await api.runComponentEvaluation(nodes.slice(1),caller(api,{generate:def,replacement:{...def,compute:()=>({data:{table:{...large,name:'Replacement'}}})}}),()=>true,{datasets:{},timeline});
  assert.equal(records.get(nodes[1]).error,undefined,'redefining a producer drops its now-invalid old output before applying the budget');
  assert.equal(Object.keys(timeline.derivedTables).length,5);
});

test('derived references use a runtime-only namespace that embedded imports cannot claim',async()=>{
  const api=runtime(),n=node('aggregate','table-aggregate',{}, {data:ref,operation:'count'}),timeline=api.createComponentTimeline(),call=caller(api);
  let records=await api.runComponentEvaluation([n],call,()=>true,{datasets:{source:data},timeline});
  const old=records.get(n).io.outputs.data.datasetId;
  assert.match(old,/^~derived-/);
  assert.throws(()=>api.normalizeDatasets({[old]:data}),/Invalid dataset ID/);
  assert.throws(()=>api.datasetReference({datasetId:old},{source:data}),/missing/);
  records=await api.runComponentEvaluation([n],call,()=>true,{datasets:{source:data},timeline});
  assert.equal(records.get(n).io.outputs.data.datasetId,old,'identical content keeps the same immutable reference');
});

test('immutable table versions prevent sorted aliases from emitting a spurious pulse into a latch',async()=>{
  for(const reverse of [false,true])for(const step of [false,true]){
    const api=runtime(),seen=[];
    const custom={
      generate:{inputs:{},outputs:{data:{type:'table'}},compute:(_,state)=>({data:{table:{name:'Generated',columns:[{key:'value',name:'Value',type:'number'}],rows:[[state.high?10:1],[2]]}}})},
      probe:{inputs:{data:{type:'table'}},outputs:{flag:{type:'boolean'}},compute:(inputs,state,context)=>{const first=context.tables.data.rows[0][0];seen.push(first);return {flag:first>5};}},
      latch:{inputs:{flag:{type:'boolean'}},outputs:{seen:{type:'boolean'}},publish:state=>({seen:!!state.seen}),transition:(inputs,state)=>({state:{seen:state.seen||inputs.flag},memory:{}})}
    };
    const generator={uid:'gen',type:'smart',componentApi:2,script:'generate',state:{high:false}},sort=node('sort','table-sort',{data:{uid:'gen',port:'data'}},{column:'value'}),probe={uid:'probe',type:'smart',componentApi:2,script:'probe',state:{},bindings:{data:{uid:'sort',port:'data'}}},latch={uid:'latch',type:'smart',componentApi:2,script:'latch',state:{seen:false},bindings:{flag:{uid:'probe',port:'flag'}}};
    const nodes=reverse?[latch,probe,sort,generator]:[generator,sort,probe,latch],timeline=api.createComponentTimeline(),call=caller(api,custom);
    await api.runComponentEvaluation(nodes,call,()=>true,{datasets:{},timeline});
    seen.length=0;generator.state={high:true};let records,retainedOldVersion=false;
    for(let round=0;round<10;round++){
      records=await api.runComponentEvaluation(nodes,call,()=>true,{datasets:{},timeline,step});
      retainedOldVersion ||= Object.keys(timeline.derivedTables).length>1;
      for(const record of records.values()){
        assert.equal(record.error,undefined);
        for(const [port,view] of Object.entries(record.io.tables?.inputs||{})){
          assert.deepEqual(plain(api.componentTableSnapshot(record.io.inputs[port],records.datasets).rows),plain(view.rows),'a paused input reference still resolves to exactly the rows consumed in that round');
        }
      }
      if(timeline.pendingTime===null)break;
    }
    assert.equal(timeline.pendingTime,null);assert.deepEqual([...new Set(seen)],[2],'the probe reuses the old result and only computes coherent new sorted data, never the unsorted 10');
    assert.equal(latch.state.seen,false,'there is no intermediate pulse to latch');
    assert.equal(records.get(probe).io.tables.inputs.data.rows[0][0],2);
    assert.equal(Object.keys(timeline.derivedTables).length,1,'old versions are released after downstream references advance');
    if(step)assert.equal(retainedOldVersion,true,'stepped propagation retains both versions until their last consumers advance');
  }
});

test('a Boolean feedback cycle cannot persist a derived table from a mixed-output component',async()=>{
  const api=runtime(),custom={mixed:{inputs:{loop:{type:'boolean',default:false}},outputs:{flag:{type:'boolean'},data:{type:'table'}},compute:()=>({flag:false,data:{table:data}})}};
  const node={uid:'mixed',type:'smart',componentApi:2,script:'mixed',state:{},bindings:{loop:{uid:'mixed',port:'flag'}}};
  const timeline=api.createComponentTimeline(),records=await api.runComponentEvaluation([node],caller(api,custom),()=>true,{datasets:{},timeline});
  assert.match(records.get(node).error,/Table components cannot form feedback loops/);
  assert.equal(node.signalState,undefined);assert.equal(Object.keys(timeline.derivedTables).length,0);
});

test('Sort and Aggregate bypass their transformation through one Boolean enabled input',()=>{
  for(const name of ['table-sort','table-aggregate']){
    const def=source(name),state=def.initState(),selection={datasetId:'source',rows:[6,0,3]},table={...snapshot(data),rows:[data.rows[6],data.rows[0],data.rows[3]],rowIndices:[6,0,3],rowCount:3};
    const before=JSON.stringify({state,selection,table});
    const inputs={...defaults(def),data:selection,enabled:false,column:'missing',group:'missing',value:'missing'};
    assert.equal(def.inputs.enabled.type,'boolean');assert.equal(def.inputs.enabled.default,true);
    assert.equal(def.settings.showSwitch.default,true);assert.equal(state.showSwitch,true);
    assert.deepEqual(plain(def.compute(inputs,state,{tables:{data:table}})),{data:selection,rowCount:3},name+' passes the exact incoming selection without applying invalid inactive settings');
    assert.equal(JSON.stringify({state,selection,table}),before);
    assert.throws(()=>def.compute({...inputs,enabled:true},state,{tables:{data:table}}),/Unknown (sort|group) column/);
    assert.throws(()=>def.compute({...inputs,enabled:'false'},state,{tables:{data:table}}),/Enabled must be Boolean/);
  }
});

test('transform switches mirror the actual input, hide on request, and become read-only when connected',()=>{
  for(const name of ['table-sort','table-aggregate']){
    const def=source(name),state=def.initState(),style=def.initStyle(),table=snapshot(data);
    const io={inputs:{...defaults(def),data:ref,enabled:true},outputs:{data:ref,rowCount:7},tables:{inputs:{data:table}},boundInputs:[]};
    const before=JSON.stringify(state);
    const handle=plain(def.handles(state,320,150,style,io)[0]);
    assert.deepEqual(handle,{id:'enabled',kind:'boolean',input:'enabled',value:true,x:286,y:129});
    assert.equal(def.hitEdit(state,handle.x,handle.y,320,150,style,io),'enabled');
    const off={...io,inputs:{...io.inputs,enabled:false}};
    assert.equal(def.handles(state,320,150,style,off)[0].value,false);
    assert.ok(def.children(state,style,320,150,false,off).some(child=>child.text==='Bypassed · original rows'));
    assert.ok(def.children(state,style,320,150,false,off).some(child=>child.text==='Bypass'));
    const linked={...off,boundInputs:['enabled']};
    assert.deepEqual(plain(def.handles(state,320,150,style,linked)),[]);
    assert.equal(def.hitEdit(state,handle.x,handle.y,320,150,style,linked),null);
    assert.ok(def.children(state,style,320,150,false,linked).some(child=>child.text==='Bypass · connected'));
    const hidden={...state,showSwitch:false};
    assert.deepEqual(plain(def.handles(hidden,320,150,style,off)),[]);
    assert.equal(def.hitEdit(hidden,handle.x,handle.y,320,150,style,off),null);
    assert.equal(def.children(hidden,style,320,150,false,off).some(child=>child.text==='Bypass'),false);
    assert.equal(JSON.stringify(state),before,'drawing and interaction discovery leave state untouched');
  }
});

const reloadNode=(extra={})=>({...node('dataset','data-source',{}, {data:ref,reload:false}),state:{allowReaderImport:true},...extra});
const reloadPorts={data:{type:'table'},reload:{type:'boolean'}};

test('reload declarations are a narrow validated capability, not generic script effects',()=>{
  const api=runtime(),declaration={reload:{type:'reloadDataset',input:'data',trigger:'reload'}};
  assert.deepEqual(plain(api.normalizeComponentActionDeclarations(declaration,reloadPorts)),declaration);
  for(const raw of [[],{reload:{type:'downloadTable',input:'data',trigger:'reload'}},{reload:{...declaration.reload,url:'https://example.invalid'}},{reload:{...declaration.reload,input:'reload'}},{reload:{...declaration.reload,trigger:'data'}},Object.fromEntries(Array.from({length:9},(_,i)=>['a'+i,declaration.reload]))])assert.throws(()=>api.normalizeComponentActionDeclarations(raw,reloadPorts));
});

test('reload edges commit once, stay outside saved state, and ignore initial-high or pure inspection',async()=>{
  const api=runtime(),item=reloadNode({inputValues:{data:ref,reload:true}}),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{source:data}};
  await api.settleComponentTimeline([item],call,()=>true,timeline,options);
  assert.deepEqual(plain(api.takeComponentDataActions(timeline)),[]);
  item.inputValues.reload=false;await api.settleComponentTimeline([item],call,()=>true,timeline,options);
  item.inputValues.reload=true;await api.runComponentEvaluation([item],call,()=>true,options);
  assert.equal(timeline.dataActions.length,0,'pure inspection cannot schedule an action');
  await api.settleComponentTimeline([item],call,()=>true,timeline,options);
  await api.settleComponentTimeline([item],call,()=>true,timeline,options);
  const actions=api.takeComponentDataActions(timeline);
  assert.equal(actions.length,1);assert.equal(actions[0].item,item);assert.deepEqual(plain({...actions[0],item:undefined}),{id:1,name:'reload',type:'reloadDataset',input:'data',trigger:'reload'});
  assert.equal(api.takeComponentDataActions(timeline).length,0,'re-reading cached committed results cannot replay a consumed action');
  assert.deepEqual(item.state,{allowReaderImport:true});assert.equal(JSON.stringify(item).includes('actionLevels'),false);
  const fresh=api.createComponentTimeline();await api.settleComponentTimeline([plain(item)],call,()=>true,fresh,options);
  assert.equal(api.takeComponentDataActions(fresh).length,0,'restored state with a high input is only a baseline');
});

test('reload opt-out, enabling an already-high input, and historical replay never reload',async()=>{
  const api=runtime(),item=reloadNode({state:{allowReaderImport:false}}),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{source:data},timeline};
  await api.runComponentEvaluation([item],call,()=>true,options);item.inputValues.reload=true;
  await api.runComponentEvaluation([item],call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,0);
  item.state.allowReaderImport=true;await api.runComponentEvaluation([item],call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,0);
  item.inputValues.reload=false;await api.runComponentEvaluation([item],call,()=>true,options);
  item.inputValues.reload=true;await api.runComponentEvaluation([item],call,()=>true,{...options,historical:true});
  await api.runComponentEvaluation([item],call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,0,'historical observations re-prime without emitting requests');
  item.inputValues.reload=false;await api.runComponentEvaluation([item],call,()=>true,options);
  item.inputValues.reload=true;await api.runComponentEvaluation([item],call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,1);
});

test('rewiring and unavailable-input recovery prime reload without a false edge',async()=>{
  const api=runtime(),custom={signal:{inputs:{},outputs:{value:{type:'boolean'}},compute:(inputs,state)=>{if(state.fail)throw new Error('Unavailable');return {value:state.value};}}};
  const signal=uid=>({uid,type:'smart',componentApi:2,script:'signal',state:{value:false}}),a=signal('a'),b=signal('b'),item=reloadNode({bindings:{reload:{uid:'a',port:'value'}}}),items=[a,b,item],timeline=api.createComponentTimeline(),call=caller(api,custom),options={datasets:{source:data},timeline};
  await api.runComponentEvaluation(items,call,()=>true,options);a.state.value=true;
  await api.runComponentEvaluation(items,call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,1);
  b.state.value=true;item.bindings.reload.uid='b';await api.runComponentEvaluation(items,call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,0);
  b.state.fail=true;await api.runComponentEvaluation(items,call,()=>true,options);b.state.fail=false;
  await api.runComponentEvaluation(items,call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,0);
  b.state.value=false;await api.runComponentEvaluation(items,call,()=>true,options);b.state.value=true;
  await api.runComponentEvaluation(items,call,()=>true,options);assert.equal(api.takeComponentDataActions(timeline).length,1);
});

test('a canceled settlement cannot leak a reload intent or advance its edge memory',async()=>{
  const api=runtime(),item=reloadNode(),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{source:data}};
  await api.settleComponentTimeline([item],call,()=>true,timeline,options);
  const before=JSON.stringify([...timeline.observations].map(([,o])=>o.actionLevels));item.inputValues.reload=true;
  let valid=true;
  await assert.rejects(()=>api.settleComponentTimeline([item],async(...args)=>{const value=await call(...args);if(args[1]==='compute')valid=false;return value;},()=>valid,timeline,options),/Cancelled/);
  assert.equal(timeline.dataActions.length,0);assert.equal(JSON.stringify([...timeline.observations].map(([,o])=>o.actionLevels)),before);
  await api.settleComponentTimeline([item],call,()=>true,timeline,options);assert.equal(api.takeComponentDataActions(timeline).length,1);
});

test('per-round detection retains a transient reload pulse until normal or stepped propagation settles',async()=>{
  for(const step of [false,true]){
    const api=runtime(),custom={pulse:{inputs:{run:{type:'boolean',default:false}},outputs:{value:{type:'boolean'}},publish:state=>({value:state.phase===1}),transition:(inputs,state)=>({state:{phase:!inputs.run?0:state.phase===0?1:2},memory:{},nextWakeAt:inputs.run&&state.phase===0?0:null})}};
    const pulse={uid:'pulse',type:'smart',componentApi:2,script:'pulse',state:{phase:0},inputValues:{run:false}},item=reloadNode({bindings:{reload:{uid:'pulse',port:'value'}}}),items=[pulse,item],timeline=api.createComponentTimeline(),call=caller(api,custom),options={datasets:{source:data}};
    await api.settleComponentTimeline(items,call,()=>true,timeline,options);pulse.inputValues.run=true;
    let held=false,records;
    for(let round=0;round<10;round++){
      records=await api.settleComponentTimeline(items,call,()=>true,timeline,{...options,step});
      if(timeline.pendingTime===null)break;
      if(timeline.dataActions.length)held=true;
      assert.equal(api.takeComponentDataActions(timeline).length,0,'pending stepped propagation cannot dispatch');
    }
    assert.equal(timeline.pendingTime,null);assert.equal(records.get(item).io.inputs.reload,false,'the pulse has already fallen at settlement');
    const actions=api.takeComponentDataActions(timeline);assert.equal(actions.length,1);assert.equal(actions[0].item,item);
    if(step)assert.equal(held,true);
    const fresh=api.createComponentTimeline();pulse.state={phase:0};
    await api.settleComponentTimeline(items,call,()=>true,fresh,options);
    assert.equal(api.takeComponentDataActions(fresh).length,0,'bootstrap pulses in a fresh graph do not perform file actions');
  }
});

test('pending reload requests are bounded and overflow is a recoverable component error',async()=>{
  const api=runtime(),item=reloadNode(),timeline=api.createComponentTimeline(),call=caller(api),options={datasets:{source:data},timeline};
  await api.runComponentEvaluation([item],call,()=>true,options);let records;
  for(let i=0;i<65;i++){
    item.inputValues.reload=false;await api.runComponentEvaluation([item],call,()=>true,options);
    item.inputValues.reload=true;records=await api.runComponentEvaluation([item],call,()=>true,options);
  }
  assert.equal(timeline.dataActions.length,64);assert.match(records.get(item).error,/reload queue is full/);
  assert.equal(api.takeComponentDataActions(timeline).length,64);
  records=await api.runComponentEvaluation([item],call,()=>true,options);assert.equal(records.get(item).error,undefined);assert.equal(api.takeComponentDataActions(timeline).length,0);
});
