const {parseApp}=require('./helpers/app-source.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'..','examples','go-to-tab.js'),'utf8');
const def=vm.runInNewContext(script),plain=value=>JSON.parse(JSON.stringify(value));
const context=vm.createContext({}),appSource=parseApp(html);
for(const name of ['componentPortName','normalizeComponentActionDeclarations','normalizeComponentDataAction','prepareComponentTabNavigation','primeComponentNavigation']){
  vm.runInContext(appSource.declaration(name),context);
}
const record={caps:{apiVersion:2,inputs:plain(def.inputs),dataActions:plain(def.dataActions)},io:{inputs:{page:1,parameters:'{}',go:false}}};

test('navigation builtin exposes a zero-based target, Boolean rising trigger and released host button',()=>{
  assert.equal(def.apiVersion,2);
  assert.deepEqual(plain(def.inputs),{page:{type:'number',default:0},parameters:{type:'string',default:'{}'},go:{role:'control',type:'boolean',default:false,event:'action'}});
  assert.deepEqual(plain(def.outputs),{});
  assert.deepEqual(plain(def.compute({page:0,parameters:'{}',go:true})),{});
  assert.deepEqual(plain(def.dataActions),{go:{type:'goToTab',input:'page',parameters:'parameters',trigger:'go'}});
  const state=def.initState(),style=def.initStyle(),handles=plain(def.handles(state,style.w,style.h));
  assert.deepEqual(handles,[{id:'go',kind:'action',x:120,y:59,action:{type:'goToTab',input:'page',parameters:'parameters'}}]);
  assert.equal(def.hitEdit(state,120,59,240,120),'go');
  assert.equal(def.hitEdit(state,120,100,240,120),null);
  for(const page of [-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null])assert.throws(()=>def.compute({page,go:false}),/whole number starting at 0/);
  assert.throws(()=>def.compute({page:0,parameters:'{}',go:'true'}),/Boolean/);
  for(const parameters of [null,undefined,123,{},'x'.repeat(2001)])assert.throws(()=>def.compute({page:0,parameters,go:false}),/JSON text of at most 2000/);
});

test('navigation declarations and handles grant only a numeric local-tab action',()=>{
  assert.deepEqual(plain(context.normalizeComponentActionDeclarations(def.dataActions,def.inputs)),plain(def.dataActions));
  assert.deepEqual(plain(context.normalizeComponentDataAction({type:'goToTab',input:'page'})),{type:'goToTab',input:'page'});
  for(const action of [
    {type:'goToTab',input:'go',trigger:'go'}, {type:'goToTab',input:'page',trigger:'page'},
    {type:'goToTab',input:'missing',trigger:'go'}, {type:'goToTab',input:'page',trigger:'go',url:'https://example.com'},
    {type:'goToTab',input:'page',trigger:'go',parameters:'page'}, {type:'goToTab',input:'page',trigger:'go',parameters:'missing'}
  ])assert.throws(()=>context.normalizeComponentActionDeclarations({go:action},def.inputs),/numeric page input, Boolean trigger/);
  for(const action of [{type:'goToTab',input:'page',page:1},{type:'goToTab',input:'page',url:'https://example.com'},{type:'navigate',input:'page'}]){
    assert.throws(()=>context.normalizeComponentDataAction(action),/Invalid data action/);
  }
});

test('host navigation validates the declared capability and current export tab count',()=>{
  assert.equal(context.prepareComponentTabNavigation({type:'goToTab',input:'page',parameters:'parameters'},record,2),1);
  const pulse={type:'goToTab',input:'page',parameters:'parameters',name:'go',trigger:'go'};
  assert.equal(context.prepareComponentTabNavigation(pulse,record,2,0),0,'queued pulses keep their sampled target');
  for(const page of [-1,.5,2,999,NaN,Infinity,'1'])assert.throws(()=>context.prepareComponentTabNavigation(pulse,record,2,page),/tab index from 0 to 1/);
  assert.throws(()=>context.prepareComponentTabNavigation(pulse,record,1),/tab index from 0 to 0/);
  assert.throws(()=>context.prepareComponentTabNavigation({...pulse,trigger:'other'},record,2),/must be declared/);
  assert.throws(()=>context.prepareComponentTabNavigation({...pulse,parameters:undefined},record,2),/must be declared/);
  assert.throws(()=>context.prepareComponentTabNavigation(pulse,{...record,caps:{...record.caps,dataActions:{}}},2),/must be declared/);
  assert.throws(()=>context.prepareComponentTabNavigation(pulse,{...record,error:'Unavailable source'},2),/Unavailable source/);
});

test('activation re-primes navigation only and discards stale navigation requests',()=>{
  const reload={type:'reloadDataset'},navigation={type:'goToTab'};
  const timeline={dataActions:[reload,navigation],observations:new Map([['item',{actionReady:true,actionLevels:{go:{value:false}}}]])};
  context.primeComponentNavigation(timeline);assert.equal(timeline.navigationEpoch,1);
  assert.deepEqual(timeline.dataActions,[reload]);
  assert.equal(timeline.observations.get('item').actionReady,true,'other action baselines remain intact');
  context.primeComponentNavigation(timeline);assert.equal(timeline.navigationEpoch,2);
});

test('navigation visuals show custom names, optional indicators, plain text and selected styles',()=>{
  const state=def.initState(),style=def.initStyle(),io={name:'<b>Next</b>',inputs:{page:2,go:true}};
  const children=plain(def.children(state,style,240,120,false,io));
  assert.ok(children.some(child=>child.text==='<b>Next</b>'));
  assert.ok(children.some(child=>child.text==='Go to tab 2 →'));
  assert.ok(children.filter(child=>child.type==='text').every(child=>child.plainText));
  const hidden=plain(def.children({...state,showIndicators:false},style,240,120,false,io));
  assert.equal(hidden.some(child=>child.type==='ellipse'),false);
  assert.equal(hidden.some(child=>/^Go:/.test(child.text||'')),false);
  const failure=plain(def.unavailableChildren(state,style,240,120,false,{...io,error:'Invalid target'}));
  assert.ok(failure.some(child=>child.text==='Invalid target'));
  assert.equal(failure.some(child=>/^Go to tab 2/.test(child.text||'')),false);
  const custom=plain(def.children(state,{...style,fill:false,strokeOn:false,color:'#f00',size:4,dash:'dash',textColor:'#123456',font:'400 18px serif'},240,120,false,io));
  assert.equal(custom[0].strokeOn,false);assert.equal(custom[0].fill,false);assert.equal(custom[0].color,'#f00');assert.equal(custom[0].size,4);assert.equal(custom[0].dash,'dash');
  assert.equal(custom.find(child=>child.text==='<b>Next</b>').color,'#123456');
  assert.match(custom.find(child=>child.type==='text').font,/serif$/);
});

test('automatic navigation can hide its button and indicators while retaining an editor-only outline',()=>{
  const state={...def.initState(),showButton:false},style=def.initStyle();
  assert.equal(def.settings.showButton.default,true);
  const children=plain(def.children(state,style,240,120,true,{inputs:{page:1,go:true}}));
  assert.ok(children.length>0);assert.ok(children.every(child=>child.editorOnly));
  assert.equal(children.some(child=>child.type==='ellipse'),false);
  assert.deepEqual(plain(def.handles(state,240,120)),[]);
  assert.equal(def.hitEdit(state,120,59,240,120),null);
  assert.deepEqual(plain(def.compute({page:1,parameters:'{}',go:true},state)),{});
});
