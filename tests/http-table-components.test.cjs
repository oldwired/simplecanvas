const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

for(const file of ['http-source.js','http-post.js']){
  const definition=()=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../examples',file),'utf8'),{Intl,Date});
  test(file+' offers a table response using the existing value wire without table events',()=>{
    const component=definition(),state={...component.initState(),valueType:'table'},before=JSON.stringify(state);
    const columns=[{key:'fruit',type:'string',name:'Fruit'},{key:'quantity',type:'number',name:'Quantity'}];
    const table={name:'Stock',columns,rows:[['Apples',4],['Pears',7]]};
    const source={available:true,value:table,json:'[{"fruit":"Apples","quantity":4},{"fruit":"Pears","quantity":7}]',jsonAvailable:true,status:'ready'};
    const ports=component.outputs(state),result=component.compute({},state,{source});
    assert.equal(component.settings.valueType.label,'Response type');
    assert.ok(component.settings.valueType.options.includes('table'));
    assert.equal(component.httpSource(state).valueType,'table');
    assert.equal(ports.value.type,'table');assert.equal(ports.value.label,'Table');
    assert.equal(Object.hasOwn(ports.value,'event'),false,'tables use value flow; Completed is the separate action event');
    assert.equal(ports.rowCount.type,'number');assert.equal(ports.jsonAvailable.type,'boolean');
    assert.equal(result.value.table,table);assert.equal(result.rowCount,2);
    assert.equal(result.json,source.json);assert.equal(result.jsonAvailable,true);
    assert.equal(JSON.stringify(state),before,'the source never saves a response into its authored state');
    const display=component.children(state,component.initStyle(),340,208,false,{outputs:result,tables:{outputs:{value:table}}});
    assert.ok(display.some(child=>child.text==='2 rows · 2 columns'));
    const full=component.children(state,component.initStyle(),340,208,false,{outputs:{...result,rowCount:1000},tables:{outputs:{value:{columns:Array(32)}}}});
    assert.ok(full.some(child=>child.text==='1000 rows · 32 columns'),'even the maximum counts fit on the card');
    const empty=component.compute({},state,{source:{...source,value:{...table,rows:[]}}});
    assert.equal(empty.rowCount,0);assert.equal(empty.available,true);
    assert.equal(empty.value.table.rows.length,0,'a successful typed empty table remains available');
  });

  test(file+' keeps a large table usable while its bounded JSON text is unavailable',()=>{
    const component=definition(),state={...component.initState(),valueType:'table'};
    const table={name:'Rows',columns:[{key:'text',name:'Text',type:'string'}],rows:[['a'.repeat(1500)],['b'.repeat(1500)]]};
    const result=component.compute({},state,{source:{available:true,value:table,status:'ready',json:'',jsonAvailable:false}});
    assert.equal(result.available,true);assert.equal(result.rowCount,2);assert.equal(result.value.table,table);
    assert.equal(result.jsonAvailable,false);assert.equal(result.json,'');
    const display=component.children(state,component.initStyle(),340,208,false,{outputs:result,tables:{outputs:{value:table}}});
    assert.ok(display.some(child=>child.text==='2 rows · 1 column'));
    assert.ok(display.some(child=>child.text==='JSON text exceeds 2,000 characters'));
    for(const source of [{},{status:'loading',loading:true},{status:'error',error:'Request failed',available:false}]){
      const unavailable=component.compute({},state,{source});
      assert.equal(Object.hasOwn(unavailable,'value'),false,'never fabricate an empty table while no table is available');
      assert.equal(unavailable.available,false);assert.equal(unavailable.jsonAvailable,false);
    }
  });

  test(file+' retains scalar response semantics and the existing manual controls',()=>{
    const component=definition(),initial=component.initState();
    for(const [valueType,value] of [['number',2.8],['string','Hello'],['boolean',true]]){
      const state={...initial,valueType},ports=component.outputs(state),json=JSON.stringify({value});
      const result=component.compute({},state,{source:{available:true,value,json,status:'ready'}});
      assert.equal(ports.value.type,valueType);assert.equal(ports.value.event,true);assert.equal(ports.json.event,true);
      assert.equal(Object.hasOwn(ports,'rowCount'),false);
      assert.equal(result.value,value);assert.equal(result.json,json);assert.equal(result.jsonAvailable,true);
    }
    const table={...initial,valueType:'table'};
    assert.deepEqual(Array.from(component.handles(table,340,208),handle=>handle.action.type),
      [file==='http-post.js'?'httpPost':'httpGet','httpCredentials']);
    assert.equal(component.hitEdit(table,70,168,340,208),file==='http-post.js'?'send':'refresh');
    assert.equal(component.hitEdit(table,250,168,340,208),'connection');
    assert.throws(()=>component.outputs({...initial,valueType:'object'}),/response type/);
  });
}
