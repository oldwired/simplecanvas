const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchBrowser}=require('./helpers/browser.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').replace('\n})();','\nwindow.__test={run:source=>eval(source)};\n})();');
const engine=process.env.BROWSER_ENGINE||'chromium';let browser;
before(async()=>{browser=await launchBrowser({engine});});
after(async()=>{await browser?.close();});
async function app(fn){const context=await browser.newContext();try{const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://transition-events.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:html}));await page.goto('http://transition-events.test/index.html');
 const run=code=>page.evaluate(async code=>{await __test.run('appReady');return __test.run(code);},code);await run('appStarted');await fn(run);assert.deepEqual(errors,[]);
 }finally{await context.close();}}
const harness=`
 const make=(key,uid,extra={})=>({...clone(BUILTIN_LIBRARY_DEFINITIONS.find(def=>def.key===key).items[0]),uid,...extra});
 const owners=new Map();const call=(item,hook,args)=>{if(!owners.has(item))owners.set(item,createSmartExecution(item));return hook==='caps'?requestSmartCaps(item,owners.get(item),args[0]):requestSmartCall(item,hook,args,owners.get(item));};
 const timeline=createComponentTimeline(()=>0),close=()=>{for(const owner of owners.values())disposeSmartExecution(owner);};
`;
const receiver=`({apiVersion:2,eventApi:1,inputs:{},outputs:{},eventInputs:{receive:{types:['boolean','string']}},compute(){return {};},children(){return [];},onEvent(name,payload,state){return {state:{count:(state.count||0)+1,last:payload}};}})`;

test('completion captures true before self-reset and notifies once independent of drawing order',async()=>app(async run=>{
 for(const reverse of [false,true]){
 const result=await run(`(async()=>{${harness}
 const input=make('toggle','input'),count=make('counter','count',{inputValues:{direction:'down',start:2,threshold:2},bindings:{value:{uid:'input',port:'value'},reset:{uid:'count',port:'reached'}}}),
 log=make('memo','log',{script:${JSON.stringify(receiver)},state:{count:0},eventBindings:{receive:{uid:'count',port:'reached'}}});
 const list=${reverse?'[log,count,input]':'[input,count,log]'};try{
 for(const value of [false,true,false,true,false,true,false,true]){input.state.value=value;const graph=await settleComponentTimeline(list,call,()=>true,timeline);for(const record of graph.values())if(record.error)throw new Error(record.error);}
 const activity=takeComponentEventActivity(timeline),before=JSON.stringify(log.state);await settleComponentTimeline(list,call,()=>true,timeline);await evaluateComponentGraph(list,call);
 return {state:log.state,count:count.state,unchanged:before===JSON.stringify(log.state),outs:activity.filter(e=>e.direction==='out'&&e.uid==='count')};
 }finally{close();}})()`);
 assert.equal(result.state.count,2);assert.equal(result.state.last,true);assert.equal(result.count.count,2);assert.equal(result.unchanged,true);assert.equal(result.outs.length,2);
 }
}));

test('Step retains captured transition payload before a later input edit and cancellation commits nothing',async()=>app(async run=>{
 const result=await run(`(async()=>{${harness}
 const source=make('signalToEvent','source',{inputValues:{value:'baseline',trigger:false}}),log=make('memo','log',{script:${JSON.stringify(receiver)},state:{count:0},eventBindings:{receive:{uid:'source',port:'value'}}}),list=[source,log];
 try{
 await settleComponentTimeline(list,call,()=>true,timeline);source.inputValues={value:'old',trigger:true};await settleComponentTimeline(list,call,()=>true,timeline,{step:true});
 const pending=timeline.pendingEvents.length;source.inputValues.value='new';let valid=true;
 const cancellable=async(item,hook,args)=>{const reply=await call(item,hook,args);if(hook==='onEvent')valid=false;return reply;};
 let cancelled=false;try{await settleComponentTimeline(list,cancellable,()=>valid,timeline);}catch(e){cancelled=e.cancelled===true;}
 const afterCancel={...log.state},pendingAfterCancel=timeline.pendingEvents.length;
 await settleComponentTimeline(list,call,()=>true,timeline);const delivered={...log.state};
 await settleComponentTimeline(list,call,()=>true,timeline);const repeated=log.state.count;
 const fresh=createComponentTimeline(()=>0);await settleComponentTimeline(list,call,()=>true,fresh);
 return {pending,cancelled,afterCancel,pendingAfterCancel,delivered,repeated,reloaded:log.state.count};
 }finally{close();}})()`);
 assert.equal(result.pending,1);assert.equal(result.cancelled,true);assert.equal(result.afterCancel.count,0);assert.equal(result.pendingAfterCancel,1);
 assert.deepEqual(result.delivered,{count:1,last:'old'});assert.equal(result.repeated,1);assert.equal(result.reloaded,1);
}));

test('invalid transition emission is rejected before its state and activity commit',async()=>app(async run=>{
 const result=await run(`(async()=>{${harness}
 const source=make('signalToEvent','source',{state:{value:0},script:"({apiVersion:2,eventApi:1,inputs:{},outputs:{},eventOutputs:{done:{type:'number'}},compute(){return {};},children(){return [];},transition(inputs,state,memory){return {state:{value:1},memory:{},events:[{port:'done',payload:'wrong'}]};}})"});
 try{const graph=await settleComponentTimeline([source],call,()=>true,timeline);return {error:graph.get(source).error,state:source.state,activity:takeComponentEventActivity(timeline)};}finally{close();}})()`);
 assert.match(result.error,/Invalid transition event done/);assert.equal(result.state.value,0);assert.deepEqual(result.activity,[]);
}));

test('rejected completion rolls back event receivers while retaining accepted count and downstream signals',async()=>app(async run=>{
 const result=await run(`(async()=>{${harness}
 const input=make('toggle','input'),count=make('counter','count',{inputValues:{threshold:1},bindings:{value:{uid:'input',port:'value'}}}),
 downstream=make('counter','downstream',{bindings:{value:{uid:'count',port:'reached'}}}),
 log=make('memo','log',{script:${JSON.stringify(receiver)},state:{count:0},eventBindings:{receive:{uid:'count',port:'reached'}}}),
 fail=make('memo','fail',{script:${JSON.stringify(receiver.replace("return {state:{count:(state.count||0)+1,last:payload}};","throw new Error('Notification rejected');"))},state:{count:0},eventBindings:{receive:{uid:'count',port:'reached'}}});
 const list=[input,count,downstream,log,fail];try{
 await settleComponentTimeline(list,call,()=>true,timeline);input.state.value=true;let graph=await settleComponentTimeline(list,call,()=>true,timeline);
 const errors=takeComponentEventErrors(timeline),activity=takeComponentEventActivity(timeline);await settleComponentTimeline(list,call,()=>true,timeline);
 return {count:count.state.count,downstream:downstream.state.count,log:log.state.count,errors,activity,repeat:takeComponentEventErrors(timeline),sourceError:graph.get(count).error||''};
 }finally{close();}})()`);
 assert.equal(result.count,1);assert.equal(result.downstream,1);assert.equal(result.log,0);assert.equal(result.sourceError,'');
 assert.equal(result.errors.length,1);assert.equal(result.errors[0].uid,'count');assert.match(result.errors[0].message,/Notification rejected/);assert.deepEqual(result.activity,[]);assert.deepEqual(result.repeat,[]);
}));
