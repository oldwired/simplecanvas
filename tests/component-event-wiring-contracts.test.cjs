const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function helper(name){
  const start=html.indexOf('  function '+name+'(');assert.notEqual(start,-1);
  const source=html.slice(start),next=/\n  (?:async )?(?:function |const |let )/.exec(source);
  return next?source.slice(0,next.index):source;
}
const api=vm.runInNewContext(['componentWiringModel','componentWireCompatibility','componentWireProposal','componentWireCreatesTableCycle'].map(helper).join('\n')+
  '\n({model:componentWiringModel,compatible:componentWireCompatibility,proposal:componentWireProposal,tableCycle:componentWireCreatesTableCycle})');
const item=(uid,extra={})=>({uid,type:'smart',componentApi:2,...extra});
const payload=(...types)=>({type:types.length===1?types[0]:'scalar',types,role:'control'});
const caps=(eventInputs={},eventOutputs={},extra={})=>({apiVersion:2,eventApi:1,inputs:{},outputs:{},eventInputs,eventOutputs,...extra});
const port=(model,uid,direction,name,kind='event')=>model.ports.find(p=>p.uid===uid&&p.direction===direction&&p.name===name&&p.kind===kind);

test('event and signal namespaces remain separate even when names and payload types overlap',()=>{
  const from=item('from'),to=item('to',{bindings:{submitted:{uid:'from',port:'submitted'}},eventBindings:{submitted:{uid:'from',port:'submitted'}}});
  const records=new Map([[from,{caps:caps({}, {submitted:payload('boolean')},{outputs:{submitted:{type:'boolean'}}})}],
    [to,{caps:caps({submitted:payload('boolean')},{},{inputs:{submitted:{type:'boolean'}}})}]]);
  const model=api.model([from,to],records,{}),event=port(model,'from','out','submitted'),signal=port(model,'from','out','submitted','flow'),target=port(model,'to','in','submitted');
  assert.notEqual(event.key,signal.key);assert.equal(model.edges.length,2);assert.notEqual(model.edges[0].key,model.edges[1].key);
  assert.ok(model.edges.every(edge=>!edge.broken));assert.equal(event.side,'bottom');assert.equal(target.side,'top');
  assert.equal(api.compatible(event,target).ok,true);assert.equal(api.compatible(target,event).ok,true);
  assert.equal(api.compatible(signal,target).ok,false);assert.equal(api.compatible(event,port(model,'to','in','submitted','flow')).ok,false);
});

test('event payload unions accept only declared types and keep fanout and reverse dragging available',()=>{
  const from=item('from'),to=item('to'),next=item('next');
  const sourceCaps=caps({}, {text:payload('string'),number:payload('number'),flag:payload('boolean'),clear:payload('none')});
  const targetCaps=caps({append:payload('string','number'),set:payload('string'),clear:payload('none')});
  const model=api.model([from,to,next],new Map([[from,{caps:sourceCaps}],[to,{caps:targetCaps}],[next,{caps:targetCaps}]]),{});
  for(const uid of ['to','next'])for(const direction of [false,true])for(const name of ['text','number','flag','clear']){
    const a=port(model,'from','out',name),b=port(model,uid,'in','append'),pair=direction?api.compatible(b,a):api.compatible(a,b);
    assert.equal(pair.ok,['text','number'].includes(name));
  }
  assert.equal(api.compatible(port(model,'from','out','clear'),port(model,'to','in','clear')).ok,true);
  assert.equal(api.compatible(port(model,'from','out','number'),port(model,'to','in','set')).ok,false);
});

test('invalid event connections remain visible and do not masquerade as signal connections',()=>{
  const source=item('source'),target=item('target',{eventBindings:{missing:{uid:'source',port:'text'},wrong:{uid:'source',port:'flag'},signal:{uid:'source',port:'ordinary'},gone:{uid:'deleted',port:'text'},unresolved:{uid:'source',port:'text',unresolved:true}}});
  const events=Object.fromEntries(['wrong','signal','gone','unresolved'].map(name=>[name,payload('string')]));
  const model=api.model([source,target],new Map([[source,{caps:caps({}, {text:payload('string'),flag:payload('boolean')},{outputs:{ordinary:{type:'string'}}})}],[target,{caps:caps(events)}]]),{});
  assert.equal(model.edges.length,5);assert.ok(model.edges.every(edge=>edge.broken&&edge.kind==='event'));
  const reasons=Object.fromEntries(model.edges.map(edge=>[edge.target.name,edge.reason]));
  assert.match(reasons.missing,/input.*no longer declared/i);assert.match(reasons.wrong,/payload/i);
  assert.match(reasons.signal,/event output.*declared/i);assert.match(reasons.gone,/missing/i);assert.match(reasons.unresolved,/unresolved/i);
});

test('event proposals change only event bindings and table-cycle checks ignore event edges',()=>{
  const original=item('a',{bindings:{value:{uid:'b',port:'value'}},inputValues:{text:'keep'},eventBindings:{append:{uid:'b',port:'submitted'},clear:{uid:'c',port:'clear'}}}),before=JSON.stringify(original);
  const proposal=api.proposal(original,'append','c','submitted','event');
  assert.deepEqual(plain(proposal),{eventBindings:{append:{uid:'c',port:'submitted'},clear:{uid:'c',port:'clear'}}});
  assert.deepEqual(plain(api.proposal(original,'append',null,null,'event')),{eventBindings:{clear:{uid:'c',port:'clear'}}});
  assert.equal(JSON.stringify(original),before);
  const b=item('b',{eventBindings:{append:{uid:'a',port:'submitted'}}});
  const both=caps({append:payload('string')},{submitted:payload('string')},{inputs:{value:{type:'number'},data:{type:'table'}},outputs:{value:{type:'number'}}});
  const model=api.model([original,b],new Map([[original,{caps:both}],[b,{caps:both}]]),{});
  assert.equal(api.tableCycle(model,port(model,'b','out','submitted'),port(model,'a','in','append')),false);
  assert.equal(api.tableCycle(model,port(model,'a','out','value','flow'),port(model,'b','in','value','flow')),true,'real signal feedback through table components remains denied');
  const onlyEvent=item('a');
  const eventModel=api.model([onlyEvent,b],new Map([[onlyEvent,{caps:both}],[b,{caps:both}]]),{});
  assert.equal(api.tableCycle(eventModel,port(eventModel,'b','out','value','flow'),port(eventModel,'a','in','value','flow')),false,'an event path never closes the signal dependency graph');
});

test('hybrid ports share one physical pin and ordinary bindings carry optional event delivery',()=>{
  const source=item('source'),target=item('target',{bindings:{text:{uid:'source',port:'value'}}});
  const hybrid=type=>({...payload(type),hybrid:true});
  const records=new Map([[source,{caps:caps({}, {value:hybrid('string')},{outputs:{value:{type:'string',event:true}}})}],
    [target,{caps:caps({text:hybrid('string')},{},{inputs:{text:{type:'string',event:true}}})}]]);
  let model=api.model([source,target],records,{});
  assert.equal(model.ports.length,2);assert.ok(model.ports.every(port=>port.kind==='flow'&&port.hybrid));
  assert.equal(model.edges.length,1);assert.equal(model.edges[0].kind,'flow');assert.equal(model.edges[0].events,true);
  assert.equal(api.compatible(model.ports[0],model.ports[1]).ok,true);
  assert.equal(api.compatible(model.ports[1],model.ports[0]).ok,true);
  target.eventModes={text:'value'};model=api.model([source,target],records,{});
  assert.equal(model.edges[0].events,false);assert.equal(model.edges[0].broken,false);
  assert.equal(model.ports.find(port=>port.direction==='in').eventsEnabled,false);
});

test('event-only commands use the shared hybrid pin, with the actual event payload type',()=>{
  const source=item('button'),target=item('extractor',{eventBindings:{reprocess:{uid:'button',port:'clicked'}}});
  const input={...payload('boolean','none'),hybrid:true};
  const records=new Map([[source,{caps:caps({}, {clicked:payload('none')})}],
    [target,{caps:caps({reprocess:input},{},{inputs:{reprocess:{type:'boolean',event:'command',role:'control'}}})}]]);
  let model=api.model([source,target],records,{});
  assert.equal(model.ports.filter(port=>port.uid==='extractor').length,1);
  assert.equal(model.edges[0].broken,false);assert.equal(model.edges[0].kind,'event');assert.equal(model.edges[0].type,'none');
  const inputPort=port(model,'extractor','in','reprocess','flow'),sourcePort=port(model,'button','out','clicked');
  assert.equal(api.compatible(inputPort,sourcePort).kind,'event');
  target.eventModes={reprocess:'value'};model=api.model([source,target],records,{});
  assert.equal(model.edges[0].broken,true);assert.match(model.edges[0].reason,/turned off/);
  assert.equal(api.compatible(port(model,'extractor','in','reprocess','flow'),port(model,'button','out','clicked')).ok,false);
});

test('changing a hybrid source replaces the other namespace instead of adding a second wire',()=>{
  const target=item('target',{bindings:{line:{uid:'text',port:'value'},append:{uid:'text',port:'submitted'}},eventBindings:{line:{uid:'custom',port:'line'},clear:{uid:'custom',port:'clear'}},inputValues:{line:'stored'}});
  const flow=api.proposal(target,'line','other','value','flow',true);
  assert.deepEqual(plain(flow),{bindings:{line:{uid:'other',port:'value'},append:{uid:'text',port:'submitted'}},inputValues:{},eventBindings:{clear:{uid:'custom',port:'clear'}}});
  const event=api.proposal(target,'line','other','line','event',true);
  assert.deepEqual(plain(event),{bindings:{append:{uid:'text',port:'submitted'}},eventBindings:{line:{uid:'other',port:'line'},clear:{uid:'custom',port:'clear'}}});
});
