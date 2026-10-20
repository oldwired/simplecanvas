const {parseApp}=require('./helpers/app-source.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const helper=parseApp(html).declaration;
const api=vm.runInNewContext(['componentPortName','componentScalar','normalizeComponentEventPorts','normalizeComponentEvents','normalizeComponentActionEvents','componentActionEventState','componentReplyEvents'].map(helper).join('\n')+'\n({ports:normalizeComponentEventPorts,normalize:normalizeComponentActionEvents,state:componentActionEventState,events:componentReplyEvents})');
const plain=value=>JSON.parse(JSON.stringify(value));
const defs=Object.fromEntries(['data-source','capture-row'].map(name=>[name,vm.runInNewContext(fs.readFileSync(path.join(root,'examples',name+'.js'),'utf8'))]));
function caps(def){const state=def.initState();return {eventApi:def.eventApi,eventOutputs:api.ports(def.eventOutputs,'output'),inputs:typeof def.inputs==='function'?def.inputs(state):def.inputs,dataActions:typeof def.dataActions==='function'?def.dataActions(state):def.dataActions};}

test('Dataset and Capture row declare narrow host success/failure mappings with typed event outputs',()=>{
  for(const [name,operation,success] of [['data-source','importDataset','loaded'],['capture-row','appendRow','captured']]){
    const def=defs[name],record=caps(def),normalized=plain(api.normalize(def.actionEvents,record));
    assert.deepEqual(normalized,plain(def.actionEvents));
    assert.deepEqual(normalized[operation],{success,failure:'failed'});
    assert.equal(record.eventOutputs[success].type,'number');assert.equal(record.eventOutputs.failed.type,'string');
    assert.equal(Object.hasOwn(def.outputs,success),false,'completion is an occurrence, not a latched signal');
  }
});

test('action completion declarations cannot address unsupported actions, undeclared ports, wrong payload types or hybrid outputs',()=>{
  const good=caps(defs['data-source']);
  for(const mapping of [[],{download:{success:'loaded'}},{importDataset:{}},{importDataset:{success:'missing'}},{importDataset:{failure:'loaded'}},{importDataset:{success:'failed'}},{importDataset:{success:'loaded',url:'bad'}}])assert.throws(()=>api.normalize(mapping,good));
  assert.throws(()=>api.normalize({importDataset:{success:'loaded'}},{...good,eventApi:undefined}));
  assert.throws(()=>api.normalize({importDataset:{success:'loaded'}},{...good,inputs:{}}));
  assert.throws(()=>api.normalize({appendRow:{success:'loaded'}},good));
  assert.throws(()=>api.normalize({importDataset:{success:'loaded'}},{...good,eventOutputs:{...good.eventOutputs,loaded:{...good.eventOutputs.loaded,hybrid:true}}}));
  assert.deepEqual(plain(api.normalize(undefined,{})),{});
});

test('completion payloads carry exact row counts/indices and bounded failure text without persistence or mutation',()=>{
  const def=defs['capture-row'],record={...caps(def),actionEvents:def.actionEvents},item={state:{custom:1}},before=JSON.stringify(item);
  const completed=api.state(item,record,'appendRow','success',0);assert.deepEqual(plain(api.events(completed)),[{port:'captured',payload:0}]);
  assert.equal(JSON.stringify(completed),' {"custom":1}'.trim());assert.equal(JSON.stringify(item),before);
  const failed=api.state(item,record,'appendRow','failure',new Error('Too many rows'));assert.deepEqual(plain(api.events(failed)),[{port:'failed',payload:'Too many rows'}]);
  assert.equal(api.events(api.state(item,record,'appendRow','failure','x'.repeat(5000)))[0].payload.length,2000);
  assert.equal(api.state(item,record,'importDataset','success',5),null);
});

test('cancellation, stale responses and file-picker cancellation never become failure occurrences',()=>{
  const def=defs['data-source'],record={...caps(def),actionEvents:def.actionEvents},item={state:{}};
  for(const error of [{cancelled:true,message:'cancelled'},{stale:true,message:'changed'},{name:'AbortError',message:'picker canceled'}])assert.equal(api.state(item,record,'importDataset','failure',error),null);
});
