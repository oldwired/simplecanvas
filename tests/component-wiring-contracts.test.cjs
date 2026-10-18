const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function helper(name){
  const start=html.indexOf('  function '+name+'(');assert.notEqual(start,-1,name+' is present');
  const remaining=html.slice(start),next=/\n  (?:async )?(?:function |const |let )/.exec(remaining);
  return next?remaining.slice(0,next.index):remaining;
}
function api(){
  return vm.runInNewContext(['componentWiringModel','componentWireCompatibility','componentWireProposal','componentWireCreatesTableCycle'].map(helper).join('\n')+
    '\n({componentWiringModel,componentWireCompatibility,componentWireProposal,componentWireCreatesTableCycle})');
}
const scalar=type=>({type,...(type==='table'?{}:{default:type==='number'?0:type==='boolean'?false:''})});
const item=(uid,patch={})=>({type:'smart',uid,componentApi:2,...patch});
const caps=(inputs={},outputs={},extra={})=>({apiVersion:2,inputs,outputs,...extra});
function records(entries,owners=[]){const map=new Map(entries);map.datasetOwners=new Map(owners);return map;}
const findPort=(model,uid,direction,name)=>model.ports.find(port=>port.uid===uid&&port.direction===direction&&port.name===name);

test('port presentation metadata validates explicit roles and sides without changing signal types',()=>{
  const normalize=vm.runInNewContext(['componentPortName','componentScalar','normalizeComponentPorts'].map(helper).join('\n')+'\nnormalizeComponentPorts');
  const declared={value:{type:'number',default:2.8},flag:{type:'boolean',role:'data',default:false},
    start:{type:'boolean',role:'control',default:false},column:{type:'boolean',side:'top',default:false}};
  const inputs=normalize(declared);
  assert.equal(inputs.value.role??'data','data');assert.equal(inputs.flag.role,'data');
  assert.equal(inputs.start.role,'control');assert.equal(inputs.column.side,'top');
  assert.equal(inputs.column.role??'data','data','a physical side override does not turn data into control');
  assert.equal(inputs.value.default,2.8,'placement metadata never rounds or converts values');
  for(const label of ['input','output'])for(const role of ['data','control'])for(const side of ['left','right','top','bottom']){
    const ports=normalize({value:{type:'number',role,side}},label);
    assert.deepEqual(plain(ports.value),{type:'number',role,side});
  }
  for(const role of ['',null,1,'signal','trigger'])assert.throws(()=>normalize({value:{type:'boolean',role}}),/role/i);
  for(const side of ['',null,1,'up','centre'])assert.throws(()=>normalize({value:{type:'boolean',side}}),/side/i);
});

test('data and control roles affect presentation only and do not restrict same-type wiring',()=>{
  const {componentWiringModel:model,componentWireCompatibility:compatible}=api(),a=item('a'),b=item('b');
  const input={flag:{type:'boolean',role:'data'},start:{type:'boolean',role:'control'},column:{type:'boolean',side:'top'}};
  const output={flag:{type:'boolean',role:'data'},tick:{type:'boolean',role:'control'},count:{type:'number',role:'control',side:'left'}};
  const drawing=model([a,b],records([[a,{caps:caps(input,output)}],[b,{caps:caps(input,output)}]]),{});
  for(const [direction,descriptors] of [['in',input],['out',output]])for(const [name,descriptor] of Object.entries(descriptors)){
    const port=findPort(drawing,direction==='in'?'b':'a',direction,name),role=descriptor.role||'data';
    assert.deepEqual(plain(port.descriptor),descriptor);assert.equal(port.role,role);
    assert.equal(port.side,descriptor.side||(role==='control'?(direction==='in'?'top':'bottom'):(direction==='in'?'left':'right')));
  }
  for(const from of ['flag','tick'])for(const to of ['flag','start','column']){
    const out=findPort(drawing,'a','out',from),input=findPort(drawing,'b','in',to);
    assert.equal(compatible(out,input).ok,true,from+' can drive '+to);assert.equal(compatible(input,out).ok,true,'reverse drag also works');
  }
  assert.equal(compatible(findPort(drawing,'a','out','count'),findPort(drawing,'b','in','start')).ok,false,'roles do not relax the declared signal type');
});

test('typed port compatibility is symmetric, permits numeric feedback, and rejects unavailable or equal directions',()=>{
  const {componentWiringModel:model,componentWireCompatibility:compatible}=api();
  const a=item('a'),b=item('b'),types=['number','boolean','string','table'],ports=Object.fromEntries(types.map(type=>[type,scalar(type)]));
  const drawing=model([a,b],records([[a,{caps:caps(ports,ports)}],[b,{caps:caps(ports,ports)}]]),{});
  for(const type of types){
    const out=findPort(drawing,'a','out',type),input=findPort(drawing,'b','in',type);
    assert.equal(compatible(out,input).ok,true,type);assert.equal(compatible(input,out).ok,true,type+' reverse');
    assert.equal(compatible(out,out).ok,false);assert.equal(compatible(input,input).ok,false);
    for(const other of types.filter(t=>t!==type))assert.equal(compatible(out,findPort(drawing,'b','in',other)).ok,false,type+' cannot transport '+other);
  }
  assert.equal(compatible(findPort(drawing,'a','in','number'),findPort(drawing,'a','out','number')).ok,true,'self-feedback has the same typed contract');
  assert.equal(compatible(null,findPort(drawing,'a','out','number')).ok,false);
  assert.equal(compatible({...findPort(drawing,'a','out','number'),connectable:false},findPort(drawing,'b','in','number')).ok,false);
});

test('model distinguishes proven ownership associations, transforms, incoming table publications, and literal record views',()=>{
  const {componentWiringModel:model}=api(),ref={datasetId:'records'},pool={records:{name:'Records'},derived:{name:'Computed'}};
  const owner=item('owner',{inputValues:{data:ref}}),viewer=item('viewer',{bindings:{data:{uid:'owner',port:'data'}}}),
    filter=item('filter',{bindings:{data:{uid:'owner',port:'data'}}}),output=item('output',{bindings:{data:{uid:'filter',port:'data'}}}),
    copy=item('copy',{inputValues:{data:{datasetId:'copy'}},bindings:{source:{uid:'owner',port:'data'}}}),
    literal=item('literal',{inputValues:{data:{datasetId:'records',rows:[3,1]}}});
  const table={data:scalar('table')},ownerCaps=caps({...table,source:{type:'table',optional:true}},table,{datasetOwner:'data',dataActions:{replace:{type:'replaceTable',input:'data',source:'source'}}});
  const rec=records([[owner,{caps:ownerCaps,io:{outputs:{data:ref}}}],[viewer,{caps:caps(table)}],
    [filter,{caps:caps(table,table),io:{outputs:{data:{datasetId:'records',rows:[1]}}}}],
    [output,{caps:caps(table)}],[copy,{caps:ownerCaps}],[literal,{caps:caps(table)}]],[['records',{uid:'owner',input:'data'}]]);
  const before=JSON.stringify([owner,viewer,filter,output,copy,literal,pool]),drawing=model([owner,viewer,filter,output,copy,literal],rec,pool),edge=uid=>drawing.edges.find(edge=>edge.target.uid===uid);
  assert.equal(edge('viewer').kind,'dataset');assert.equal(edge('filter').kind,'dataset');
  assert.equal(edge('output').kind,'flow','a transform publishes a directional result even if its row identities stay shared');
  assert.equal(edge('copy').kind,'flow','source refresh is an action input rather than a shared-edit association');
  assert.equal(edge('literal').kind,'dataset');assert.equal(edge('literal').binding,false);
  assert.deepEqual(plain(edge('literal').reference),{datasetId:'records',rows:[3,1]});
  assert.equal(findPort(drawing,'owner','in','data'),undefined,'owned storage is not exposed as an input');
  assert.equal(JSON.stringify([owner,viewer,filter,output,copy,literal,pool]),before,'model does not alter the scene or rows');
});

test('a declared owner output is never treated as owned storage without proof of its published dataset identity',()=>{
  const {componentWiringModel:model,componentWireCompatibility:compatible}=api();
  const owner=item('owner',{inputValues:{data:{datasetId:'original'}}}),bound=item('bound',{bindings:{data:{uid:'owner',port:'data'}}}),literal=item('literal',{inputValues:{data:{datasetId:'original'}}});
  const input={data:scalar('table')},rec=records([[owner,{caps:caps(input,input,{datasetOwner:'data'}),io:{outputs:{data:{datasetId:'different'}}}}],
    [bound,{caps:caps(input)}],[literal,{caps:caps(input)}]],[['original',{uid:'owner',input:'data'}]]);
  const drawing=model([owner,bound,literal],rec,{original:{name:'Original'},different:{name:'Different'}});
  assert.equal(drawing.edges.find(edge=>edge.target.uid==='bound').kind,'flow');
  const association=drawing.edges.find(edge=>edge.target.uid==='literal');
  assert.equal(association.kind,'dataset');assert.equal(association.source.direction,'dataset');assert.equal(association.source.connectable,false);
  assert.equal(compatible(association.source,association.target).ok,false,'synthetic storage anchors cannot create signal bindings');
});

test('broken connections remain visible with reasons for missing outputs, unresolved sources, duplicate IDs and changed types',()=>{
  const {componentWiringModel:model}=api(),source=item('source'),duplicate=item('source'),target=item('target',{bindings:{
    lost:{uid:'gone',port:'value'},removed:{uid:'ok',port:'missing'},unresolved:{uid:'ok',port:'value',unresolved:true},
    wrong:{uid:'ok',port:'value'},ambiguous:{uid:'source',port:'value'},old:{uid:'ok',port:'value'}}}),ok=item('ok');
  const ins={lost:scalar('number'),removed:scalar('number'),unresolved:scalar('number'),wrong:scalar('boolean'),ambiguous:scalar('number')};
  const rec=records([[source,{caps:caps({}, {value:scalar('number')})}],[duplicate,{caps:caps({}, {value:scalar('number')})}],
    [target,{caps:caps(ins)}],[ok,{caps:caps({}, {value:scalar('number')})}]]);
  const drawing=model([source,duplicate,target,ok],rec,{});
  assert.equal(drawing.edges.length,6);assert.ok(drawing.edges.every(edge=>edge.broken));
  const reasons=Object.fromEntries(drawing.edges.map(edge=>[edge.target.name,edge.reason]));
  assert.match(reasons.lost,/missing/i);assert.match(reasons.removed,/no longer declared/i);assert.match(reasons.unresolved,/unresolved/i);
  assert.match(reasons.wrong,/incompatible/i);assert.match(reasons.ambiguous,/ambiguous/i);assert.match(reasons.old,/input.*declared/i);
  assert.ok(drawing.ports.filter(port=>port.uid==='source').every(port=>!port.connectable));
});

test('unowned datasets and missing stored references are explicit references rather than fictional source components',()=>{
  const {componentWiringModel:model}=api(),target=item('target',{inputValues:{present:{datasetId:'present'},missing:{datasetId:'missing'}}});
  const drawing=model([target],records([[target,{caps:caps({present:scalar('table'),missing:scalar('table')})}]]),{present:{name:'Imported records'}});
  assert.equal(drawing.edges.length,0);assert.equal(drawing.references.length,2);
  assert.equal(drawing.references.find(ref=>ref.datasetId==='present').name,'Imported records');
  assert.equal(drawing.references.find(ref=>ref.datasetId==='present').missing,false);
  assert.equal(drawing.references.find(ref=>ref.datasetId==='missing').missing,true);
  assert.equal(drawing.issues.length,1);
});

test('table-cycle validation matches action-input exceptions and checks the replacement graph rather than the old link',()=>{
  const {componentWiringModel:model,componentWireCreatesTableCycle:cycle}=api(),a=item('a'),b=item('b',{bindings:{value:{uid:'a',port:'value'}}});
  const numeric=caps({value:scalar('number')},{value:scalar('number')}),tableAware=caps({value:scalar('number'),data:scalar('table')},{value:scalar('number')});
  let drawing=model([a,b],records([[a,{caps:numeric}],[b,{caps:numeric}]]),{});
  assert.equal(cycle(drawing,findPort(drawing,'b','out','value'),findPort(drawing,'a','in','value')),false);
  drawing=model([a,b],records([[a,{caps:numeric}],[b,{caps:tableAware}]]),{});
  assert.equal(cycle(drawing,findPort(drawing,'b','out','value'),findPort(drawing,'a','in','value')),true,'a table-bearing component makes the complete feedback SCC forbidden');
  assert.equal(cycle(drawing,findPort(drawing,'a','out','value'),findPort(drawing,'b','in','value')),false,'retaining the existing link is not a cycle');
  const owner=item('owner'),ownerCaps=caps({data:scalar('table'),source:scalar('table')},{data:scalar('table')},{datasetOwner:'data',dataActions:{replace:{type:'replaceTable',input:'data',source:'source'}}});
  drawing=model([owner],records([[owner,{caps:ownerCaps}]]),{});
  assert.equal(cycle(drawing,findPort(drawing,'owner','out','data'),findPort(drawing,'owner','in','source')),false,'explicit owner commands do not become combinational feedback');
});

test('connection proposals only change the selected assignment and never mutate unrelated binding metadata',()=>{
  const {componentWireProposal:proposal}=api(),original=item('target',{bindings:{other:{uid:'keep',port:'value'},value:{uid:'old',port:'value'}},inputValues:{text:'kept',value:123}}),before=JSON.stringify(original);
  const connected=proposal(original,'value','new','number');
  assert.deepEqual(plain(connected.bindings),{other:{uid:'keep',port:'value'},value:{uid:'new',port:'number'}});
  assert.equal(connected.inputValues.text,'kept');assert.equal(JSON.stringify(original),before);
  const disconnected=proposal(original,'value',null,null);assert.equal(disconnected.bindings.value,undefined);assert.equal(disconnected.inputValues.text,'kept');
  for(const [input,uid,port] of [['__proto__','new','value'],['value','new','constructor'],['value','','value']])assert.throws(()=>proposal(original,input,uid,port),/Invalid/);
});
