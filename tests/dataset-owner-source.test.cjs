const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'..','examples','data-source.js'),'utf8');
const source=()=>vm.runInNewContext(script);
const plain=value=>JSON.parse(JSON.stringify(value));
const owned={name:'Saved readings',columns:[{key:'value',name:'Value',type:'number'}],rows:[[7]],rowCount:1};
const incoming={...owned,name:'Incoming readings',rows:[[25],[40]],rowCount:2};

test('Dataset declares one owner and separate optional source/apply inputs with explicit reader permission',()=>{
  const def=source();assert.equal(def.datasetOwner,'data');
  assert.deepEqual(plain(def.inputs),{data:{type:'table'},source:{type:'table',optional:true},replace:{role:'control',type:'boolean',default:false},append:{role:'control',type:'boolean',default:false},reload:{role:'control',type:'boolean',default:false}});
  assert.deepEqual(plain(def.dataActions(def.initState())),{
    reload:{type:'reloadDataset',input:'data',trigger:'reload'},
    replace:{type:'replaceTable',input:'data',source:'source',trigger:'replace'},
    append:{type:'appendTable',input:'data',source:'source',trigger:'append'},
    live:{type:'syncTable',input:'data',source:'source',enabled:false}
  });
  assert.deepEqual(plain(def.initState()),{updateMode:'Manual',allowReaderImport:false,allowReaderUpdates:false});
  assert.equal(def.settings.allowReaderUpdates.default,false);
});

test('Dataset publishes only owned rows and remains readable without incoming data',()=>{
  const def=source(),reference={datasetId:'saved'},state=def.initState(),before=JSON.stringify({owned,incoming});
  for(const inputs of [{data:reference},{data:reference,source:{datasetId:'incoming'},replace:true,append:true}]){
    assert.deepEqual(plain(def.compute(inputs,state,{tables:{data:owned,source:incoming}})),{data:reference,rowCount:1});
  }
  assert.equal(JSON.stringify({owned,incoming}),before,'computation cannot apply a source or mutate either table');
  assert.deepEqual(plain(def.compute({data:reference},state,{tables:{data:owned}})),{data:reference,rowCount:1});
  for(const data of [{datasetId:'~derived'},{datasetId:'saved',rows:[0]},{},null])assert.throws(()=>def.compute({data},state,{tables:{data:owned}}),/owned dataset/);
});

test('Dataset card distinguishes owned state from incoming proposals and keeps import controls independent',()=>{
  const def=source(),state={...def.initState(),allowReaderUpdates:true},io={name:'Archive',inputs:{data:{datasetId:'saved'}},outputs:{rowCount:1},tables:{inputs:{data:owned,source:incoming}}};
  const children=def.children(state,def.initStyle(),300,150,false,io),labels=children.filter(child=>child.type==='text').map(child=>child.text);
  assert.ok(labels.includes('Archive'));assert.ok(labels.includes('Owns: Saved readings'));assert.ok(labels.includes('1 row · 1 column'));
  assert.ok(labels.some(label=>label.startsWith('Incoming: 2 rows')));assert.deepEqual(plain(def.handles(state,300,150)),[]);
  const allowed={...state,allowReaderImport:true};assert.equal(def.handles(allowed,300,150)[0].action.type,'importDataset');
  assert.equal(def.hitEdit(allowed,150,124,300,150),'loadData');
});
