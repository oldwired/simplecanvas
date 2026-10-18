const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const plain=value=>JSON.parse(JSON.stringify(value));
const source=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'),{});
const columns=[{key:'boat',name:'Boat',type:'string'},{key:'points',name:'Points',type:'number'},{key:'qualified',name:'Qualified',type:'boolean'}];
const table={name:'Regatta results',columns,rows:[['Kestrel',12,true],['KESTREL',7,false],['Swift',-3,true],['',0,false],[null,null,null]],rowIndices:[0,1,2,3,4],rowCount:5};
const ref={datasetId:'regatta'};
const defaults=component=>Object.fromEntries(Object.entries(component.inputs).filter(([,port])=>Object.hasOwn(port,'default')).map(([key,port])=>[key,port.default]));
function compute(component,inputs,state=component.initState(),data=table){
  const before=JSON.stringify({inputs,state,data}),output=plain(component.compute(inputs,state,{tables:{data}}));
  assert.equal(JSON.stringify({inputs,state,data}),before,'computations leave rows, references, and state unchanged');
  assert.ok(JSON.stringify(state).length<4000,'saved state does not hold dataset contents');
  return output;
}
function draw(component,data=table,patch={}){
  const style={...component.initStyle(),...patch.style},state={...component.initState(),...patch.state},inputs={...defaults(component),data:ref,...patch.inputs};
  const outputs=patch.error?{}:compute(component,inputs,state,data);
  const before=JSON.stringify({state,style,inputs,outputs,data});
  const children=plain(component.children(state,style,style.w,style.h,false,{name:'My result',inputs,outputs,tables:{inputs:{data}},error:patch.error}));
  assert.equal(JSON.stringify({state,style,inputs,outputs,data}),before,'drawing leaves inputs and state unchanged');
  assert.ok(children.length<250,'drawing uses a bounded number of primitives');
  for(const child of children){
    for(const key of ['x','y','w','h','x1','y1','x2','y2','size'])if(key in child)assert.ok(Number.isFinite(child[key]),key+' is finite');
    if('w' in child)assert.ok(child.w>=0);if('h' in child)assert.ok(child.h>=0);
    if(child.type==='text'){assert.equal(child.plainText,true);assert.ok(child.text.length<=2000);}
  }
  return children;
}

test('data components declare compact table references and initialize bounded authoring settings',()=>{
  for(const name of ['data-source','table-filter','data-table','data-bar-chart']){
    const component=source(name);
    assert.equal(component.apiVersion,2);assert.deepEqual(plain(component.inputs.data),{type:'table'});
    assert.deepEqual(plain(component.outputs.rowCount),{type:'number'});
    if(['data-source','table-filter'].includes(name))assert.deepEqual(plain(component.outputs.data),{type:'table'});
    else assert.deepEqual(Object.keys(component.outputs),['rowCount']);
    const state=component.initState();assert.ok(JSON.stringify(state).length<200);
    for(const [key,setting] of Object.entries(component.settings||{}))assert.deepEqual(plain(state[key]),plain(setting.default));
  }
  assert.deepEqual(plain(source('table-filter').inputs.column),{type:'string',default:'',columnOf:'data'});
  assert.deepEqual(plain(source('data-bar-chart').inputs.category),{type:'string',default:'',columnOf:'data'});
  assert.deepEqual(plain(source('data-bar-chart').inputs.value),{type:'string',default:'',columnOf:'data',columnType:'number'});
});

test('Dataset publishes its whole owned reference and rejects a selected view as owned storage',()=>{
  const c=source('data-source');
  assert.deepEqual(compute(c,{data:ref}),{data:ref,rowCount:5});
  const selection={datasetId:'regatta',rows:[4,1]},subset={...table,rows:[table.rows[4],table.rows[1]],rowIndices:[4,1],rowCount:2};
  assert.throws(()=>compute(c,{data:selection},{},subset),/Choose an owned dataset/);
  assert.throws(()=>c.compute({data:ref},{},{}),/Choose an owned dataset/);
  assert.throws(()=>c.compute({data:null},{},{tables:{data:table}}),/Choose an owned dataset/);
});

test('a blank filter column passes its input through without copying or reordering rows',()=>{
  const c=source('table-filter'),input={...defaults(c),data:ref};
  assert.deepEqual(compute(c,input),{data:ref,rowCount:5});
  const selection={datasetId:'regatta',rows:[3,0]},subset={...table,rows:[table.rows[3],table.rows[0]],rowIndices:[3,0],rowCount:2};
  assert.deepEqual(compute(c,{...input,data:selection},c.initState(),subset),{data:selection,rowCount:2});
});

test('text filters use literal case-insensitive matching by default and retain original row indices',()=>{
  const c=source('table-filter'),input={...defaults(c),data:ref,column:'boat',text:'kEs'};
  assert.deepEqual(compute(c,input),{data:{datasetId:'regatta',rows:[0,1]},rowCount:2});
  assert.deepEqual(compute(c,{...input,operation:'=',text:'kestrel'}).data.rows,[0,1]);
  assert.deepEqual(compute(c,{...input,operation:'≠',text:'kestrel'}).data.rows,[2,3],'null is not silently coerced into a nonmatching string');
  assert.deepEqual(compute(c,{...input,text:'.*'}).data.rows,[],'Contains is not a regex');
  assert.deepEqual(compute(c,{...input,text:'Kest'}, {...c.initState(),caseSensitive:true}).data.rows,[0]);
  const subset={...table,rows:[table.rows[2],table.rows[0]],rowIndices:[2,0],rowCount:2};
  assert.deepEqual(compute(c,{...input,data:{datasetId:'regatta',rows:[2,0]},text:'e'},c.initState(),subset).data.rows,[0]);
});

test('numeric and Boolean filtering use typed controls without string coercion',()=>{
  const c=source('table-filter'),input={...defaults(c),data:ref,column:'points',operation:'≥',number:7,text:'-100'};
  for(const [operation,number,expected] of [['>',7,[0]],['≥',7,[0,1]],['<',0,[2]],['≤',0,[2,3]],['=',0,[3]],['≠',0,[0,1,2]]]){
    assert.deepEqual(compute(c,{...input,operation,number}).data.rows,expected);
  }
  assert.deepEqual(compute(c,{...input,column:'qualified',operation:'=',boolean:true}).data.rows,[0,2]);
  assert.deepEqual(compute(c,{...input,column:'qualified',operation:'≠',boolean:true}).data.rows,[1,3]);
  assert.throws(()=>compute(c,{...input,number:'7'}),/match the selected column type/);
  assert.throws(()=>compute(c,{...input,number:Infinity}),/match the selected column type/);
  assert.throws(()=>compute(c,{...input,column:'qualified',operation:'=',boolean:1}),/match the selected column type/);
});

test('empty filters distinguish absent cells and empty strings from zero and false',()=>{
  const c=source('table-filter'),input={...defaults(c),data:ref,operation:'is empty'};
  assert.deepEqual(compute(c,{...input,column:'boat'}).data.rows,[3,4]);
  assert.deepEqual(compute(c,{...input,column:'points'}).data.rows,[4]);
  assert.deepEqual(compute(c,{...input,column:'qualified'}).data.rows,[4]);
  assert.deepEqual(compute(c,{...input,column:'boat',operation:'is not empty'}).data.rows,[0,1,2]);
  assert.deepEqual(compute(c,{...input,column:'points',operation:'is not empty'}).data.rows,[0,1,2,3]);
});

test('invalid columns, operations, incompatible comparisons and partial compute snapshots fail explicitly',()=>{
  const c=source('table-filter'),input={...defaults(c),data:ref,column:'boat'};
  for(const [patch,error] of [[{column:'missing'},/Unknown filter column/],[{operation:'regex'},/Unsupported filter operation/],[{column:'points'},/Contains requires a text column/],[{operation:'>'},/Ordered comparisons require a numeric column/],[{column:'qualified',operation:'<'},/Ordered comparisons require a numeric column/]]){
    assert.throws(()=>compute(c,{...input,...patch}),error);
  }
  assert.throws(()=>compute(c,input,c.initState(),{...table,rowCount:100}),/complete table input/);
  assert.throws(()=>compute(c,input,c.initState(),{...table,rowIndices:[0]}),/complete table input/);
});

test('filtering all 1000 rows remains compact and changing one instance cannot affect another',()=>{
  const c=source('table-filter'),data={name:'Many rows',columns:[columns[1]],rows:Array.from({length:1000},(_,i)=>[i]),rowIndices:Array.from({length:1000},(_,i)=>i),rowCount:1000};
  const inputs={...defaults(c),data:{datasetId:'many'},column:'points',operation:'≥',number:995};
  assert.deepEqual(compute(c,inputs,c.initState(),data),{data:{datasetId:'many',rows:[995,996,997,998,999]},rowCount:5});
  const second=compute(c,{...inputs,number:0},c.initState(),data);assert.equal(second.rowCount,1000);assert.ok(JSON.stringify(second).length<5000);
  assert.deepEqual(compute(c,inputs,c.initState(),data).data.rows,[995,996,997,998,999]);
});

test('Data table presents literal cells, null markers, custom names and a complete row count',()=>{
  const c=source('data-table'),data={...table,rows:[['---',12,true],[null,null,null]],rowIndices:[0,4],rowCount:2};
  assert.deepEqual(compute(c,{data:ref},c.initState(),data),{rowCount:2});
  const children=draw(c,data),texts=children.filter(x=>x.type==='text').map(x=>x.text);
  for(const value of ['My result','Boat','Points','Qualified','---','12','true','—','2 rows'])assert.ok(texts.includes(value),value+' is rendered');
  const numeric=children.find(x=>x.text==='12');assert.equal(numeric.align,'right');
});

test('Data table bounds its visible rows and columns, and discloses truncation even when counts are off',()=>{
  const c=source('data-table'),data={name:'Wide',columns:Array.from({length:16},(_,i)=>({key:'c'+i,name:'Column '+i,type:'string'})),rows:Array.from({length:24},(_,r)=>Array.from({length:16},(_,i)=>r+':'+i)),rowIndices:Array.from({length:24},(_,i)=>i),rowCount:1000};
  // Presentation receives only a prefix; compute uses complete snapshots in production.
  const style=c.initStyle(),children=plain(c.children({maxRows:4,showCounts:false},style,style.w,style.h,false,{name:'Wide view',inputs:{data:ref},outputs:{rowCount:1000},tables:{inputs:{data}}}));
  assert.ok(children.some(child=>child.text==='Showing 4 of 1000 rows · 8 of 16 columns'));
  assert.ok(children.some(child=>child.text==='3:7'));assert.ok(!children.some(child=>child.text==='4:0' || child.text==='0:8'));
  assert.ok(children.length<70);
  const empty={...table,rows:[],rowIndices:[],rowCount:0};
  assert.ok(draw(c,empty).some(child=>child.text==='No matching rows'));
});

test('Dataset editor pages every supported row and column with bounded handles and literal stable-row edits',()=>{
  const c=source('data-table'),style=c.initStyle(),state={...c.initState(),editDataset:true,maxRows:1000,maxColumns:32};
  const data={name:'Large',datasetId:'large',revision:9,editable:true,columns:Array.from({length:32},(_,i)=>({key:'c'+i,name:'Column '+i,type:'string'})),rows:Array.from({length:1000},(_,r)=>Array.from({length:32},(_,i)=>r+':'+i)),rowIds:Array.from({length:1000},(_,i)=>'r'+i),rowCount:1000};
  const io={inputs:{data:{datasetId:'large'},startRow:996,startColumn:24},tables:{inputs:{data}},outputs:{rowCount:1000}};
  const children=plain(c.children(state,style,style.w,style.h,false,io)),handles=plain(c.handles(state,style.w,style.h,style,io));
  assert.ok(children.some(child=>child.text==='999:31'),'last row and column can be displayed');
  assert.ok(children.length<500);assert.ok(handles.length<=128);
  const last=handles.find(handle=>handle.id==='cell-3-7');
  assert.deepEqual(last.datasetCell,{input:'data',datasetId:'large',rowId:'r999',column:'c31',revision:9});
  assert.equal(last.inline.mode,'edit');assert.equal(last.inline.references,false);assert.equal(last.editorOnly,true);
  assert.equal(handles.some(handle=>handle.id==='addRow'),false,'a full dataset has no Add action');
  assert.equal(c.hitEdit(state,last.x,last.y,style.w,style.h,style,io),last.id);
  const firstIo={...io,inputs:{...io.inputs,startRow:0,startColumn:0}},first=plain(c.handles(state,style.w,style.h,style,firstIo));
  assert.equal(first.filter(handle=>handle.datasetCell).length,96,'at most twelve rows and eight columns are editable at once');
  assert.equal(first.find(handle=>handle.id==='startRow').options.at(-1).value,996);
  assert.equal(first.find(handle=>handle.id==='startColumn').options.at(-1).value,24);
  const compact=plain(c.children(state,style,330,270,false,{...io,tables:{inputs:{data:{...data,columns:data.columns.slice(0,2),rows:data.rows.map(row=>row.slice(0,2))}}},inputs:{...io.inputs,startRow:0,startColumn:0}}));
  assert.ok(compact.some(child=>child.text==='0:0' && parseFloat(child.font.split(' ')[1])>=11),'compact views keep text legible and show fewer rows');
});

test('Dataset editor defaults read-only, keeps paging available, and only edits owned current rows',()=>{
  const c=source('data-table'),style=c.initStyle(),data={...table,datasetId:'regatta',revision:3,editable:true,rowIds:['r8','r2','r4','r5','r6']};
  const io={inputs:{data:ref,startRow:0,startColumn:0},tables:{inputs:{data}},outputs:{rowCount:5}};
  assert.equal(c.tablePresentation,'full');assert.equal(c.initState().editDataset,false);assert.equal(c.initState().allowReaderEdit,false);
  assert.deepEqual(plain(c.handles(c.initState(),style.w,style.h,style,io)).map(h=>h.id),['startRow','startColumn']);
  const editing={...c.initState(),editDataset:true,allowReaderEdit:true};
  const selected={...io,inputs:{...io.inputs,data:{datasetId:'regatta',rows:[8,2,4,5,6]}},boundInputs:['startRow']};
  const handles=plain(c.handles(editing,style.w,style.h,style,selected));
  assert.equal(handles.some(h=>h.id==='startRow'||h.id==='addRow'),false,'bound page inputs and selected-view append have no manual control');
  assert.deepEqual(handles.find(h=>h.id==='delete-0').action,{type:'deleteDatasetRow',input:'data',datasetId:'regatta',revision:3,rowId:'r8'});
  assert.equal(handles.find(h=>h.id==='cell-0-0').editorOnly,false);
  assert.equal(handles.find(h=>h.id==='cell-0-0').value,'Kestrel');
  const readonly={...io,tables:{inputs:{data:{...data,editable:false}}}};
  assert.deepEqual(plain(c.handles(editing,style.w,style.h,style,readonly)).map(h=>h.id),['startRow','startColumn']);
  for(const bad of [-1,1.5,Infinity])assert.throws(()=>compute(c,{data:ref,startRow:bad}),/nonnegative integers/);
});

test('chart selects a numeric column, honors explicit keys, and rejects nonnumeric values',()=>{
  const c=source('data-bar-chart'),inputs={...defaults(c),data:ref};
  assert.deepEqual(compute(c,inputs),{rowCount:5});
  assert.deepEqual(plain(c._columns(inputs,table)),{category:0,value:1});
  assert.deepEqual(plain(c._columns({...inputs,category:'qualified',value:'points'},table)),{category:2,value:1});
  assert.throws(()=>compute(c,{...inputs,category:'missing'}),/Unknown chart category/);
  assert.throws(()=>compute(c,{...inputs,value:'boat'}),/numeric chart value/);
  assert.throws(()=>compute(c,inputs,c.initState(),{...table,columns:[columns[0]],rows:[['a']]}),/numeric chart value/);
});

test('chart uses a common zero baseline for positive and negative rows and never coerces null into zero',()=>{
  const c=source('data-bar-chart'),children=draw(c),baseline=children.find(child=>child.type==='line'),bars=children.filter(child=>child.type==='rect' && child.fillColor==='#2563eb');
  assert.equal(bars.length,3,'two positive and one negative value; zero and null have no bar');
  assert.equal(bars[0].x,baseline.x1);assert.equal(bars[1].x,baseline.x1);
  assert.ok(bars[2].x<baseline.x1);assert.ok(Math.abs(bars[2].x+bars[2].w-baseline.x1)<1e-9);
  assert.ok(Math.abs(bars[0].w/bars[1].w-12/7)<1e-9);
  assert.ok(children.some(child=>child.text==='0'));assert.ok(children.some(child=>child.text==='—'));
});

test('chart scales extreme finite values without overflowing coordinates or changing source values',()=>{
  const c=source('data-bar-chart');
  for(const values of [[Number.MAX_VALUE,-Number.MAX_VALUE],[Number.MIN_VALUE,-Number.MIN_VALUE],[0,0],[null,null]]){
    const data={...table,rows:values.map((value,index)=>['row'+index,value,false]),rowIndices:[0,1],rowCount:2};
    const children=draw(c,data),bars=children.filter(child=>child.type==='rect' && child.fillColor==='#2563eb');
    assert.ok(bars.every(bar=>bar.x>=0 && bar.x+bar.w<=c.initStyle().w));
  }
});

test('chart bounds visible bars, permits hiding values, and reports omitted rows',()=>{
  const c=source('data-bar-chart'),children=draw(c,table,{state:{maxBars:2,showValues:false}});
  assert.ok(children.some(child=>child.text==='Showing 2 of 5 rows'));assert.ok(!children.some(child=>child.text==='12' || child.text==='7'));
  const bars=children.filter(child=>child.type==='rect' && child.fillColor==='#2563eb');assert.equal(bars.length,2);
  const empty={...table,rows:[],rowIndices:[],rowCount:0};assert.ok(draw(c,empty).some(child=>child.text==='No matching rows'));
});

test('all data views render their custom name and recoverable missing-input guidance',()=>{
  for(const name of ['data-source','table-filter','data-table','data-bar-chart']){
    const c=source(name),children=draw(c,table,{error:'Dataset unavailable'});
    assert.ok(children.some(child=>child.text==='My result'));
    assert.ok(children.some(child=>/Inputs|unavailable/.test(child.text||'')));
    const style=c.initStyle(),unavailable=c.unavailableChildren(c.initState(),style,style.w,style.h,false,{name:'Missing'});
    assert.ok(unavailable.some(child=>child.text==='Missing'));
  }
});
