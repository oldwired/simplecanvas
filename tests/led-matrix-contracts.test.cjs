const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const matrix=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples','led-matrix.js'),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
const rowInputs=(rows=Array(8).fill(0),enable=true)=>Object.fromEntries(rows.map((value,index)=>['r'+index,value]).concat([['enable',enable]]));
const columnInputs=(columns=Array(8).fill(0),enable=true)=>Object.fromEntries(columns.map((value,index)=>['c'+index,value]).concat([['enable',enable]]));
const booleanInputs=(rows=Array(8).fill(false),columns=Array(8).fill(false),enable=true)=>Object.fromEntries([
  ...rows.map((value,index)=>['row'+index,value]),...columns.map((value,index)=>['col'+index,value]),['enable',enable]
]);
const expected=rows=>Object.fromEntries([
  ...rows.map((value,index)=>['r'+index,value]),
  ...Array.from({length:8},(_,column)=>['c'+column,rows.reduce((byte,row,index)=>byte+((row&(128>>column))?128>>index:0),0)])
]);
const compute=(values,mode='rows')=>matrix.compute(values,{mode});
const draw=(values,mode='rows',extra={})=>{
  const style=matrix.initStyle(),state={mode};
  return matrix.children(state,style,style.w,style.h,false,{name:'Panel A',inputs:values,outputs:matrix.compute(values,state),...extra});
};
const active=children=>plain(children.filter(child=>child.type==='ellipse').map((led,index)=>led.fillColor==='#ef4444'?index:-1).filter(index=>index>=0));

test('LED matrix defaults to Boolean rows/columns with three typed input modes and both byte orientations',()=>{
  assert.equal(matrix.apiVersion,2);
  assert.deepEqual(plain(matrix.initState()),{mode:'boolean'});
  assert.deepEqual(plain(matrix.settings),{mode:{type:'string',default:'boolean',options:['boolean','rows','columns'],label:'Input mode'}});
  assert.deepEqual(plain(matrix.inputs({mode:'boolean'})),{
    ...Object.fromEntries(['row','col'].flatMap(prefix=>Array.from({length:8},(_,index)=>[prefix+index,{type:'boolean',default:false,...(prefix==='col'?{side:'top'}:{})}]))),
    enable:{role:'control',type:'boolean',default:true}
  });
  assert.deepEqual(plain(matrix.inputs({mode:'rows'})),{
    ...Object.fromEntries(Array.from({length:8},(_,index)=>['r'+index,{type:'number',default:0}])),enable:{role:'control',type:'boolean',default:true}
  });
  assert.deepEqual(plain(matrix.inputs({mode:'columns'})),{
    ...Object.fromEntries(Array.from({length:8},(_,index)=>['c'+index,{type:'number',default:0,side:'top'}])),enable:{role:'control',type:'boolean',default:true}
  });
  assert.deepEqual(plain(matrix.outputs),Object.fromEntries([
    ...Array.from({length:8},(_,index)=>['r'+index,{type:'number'}]),
    ...Array.from({length:8},(_,index)=>['c'+index,{type:'number',side:'bottom'}])
  ]));
  for(const mode of ['boolean','rows','columns'])assert.ok(Object.keys(matrix.inputs({mode})).length<=32);
  assert.equal(matrix.transition,undefined);assert.equal(matrix.refreshMs,undefined,'a static matrix needs no polling');
});

test('Boolean rows AND columns light exactly their intersections for every column mask',()=>{
  const rows=[true,false,true,true,false,false,true,false];
  for(let mask=0;mask<=255;mask++){
    const columns=Array.from({length:8},(_,column)=>(mask&(128>>column))!==0),values=booleanInputs(rows,columns);
    assert.deepEqual(plain(compute(values,'boolean')),expected(rows.map(on=>on?mask:0)));
    assert.deepEqual(plain(compute({...values,enable:false},'boolean')),expected(Array(8).fill(0)));
  }
  assert.deepEqual(plain(compute(booleanInputs(),'boolean')),expected(Array(8).fill(0)));
  assert.deepEqual(plain(compute(booleanInputs(Array(8).fill(true),Array(8).fill(true)),'boolean')),expected(Array(8).fill(255)));
});

test('row-byte mode accepts every byte and enable masks all sixteen outputs',()=>{
  for(let value=0;value<=255;value++){
    const rows=Array.from({length:8},(_,row)=>(value+row)%256),values=rowInputs(rows);
    assert.deepEqual(plain(compute(values)),expected(rows));
    assert.deepEqual(plain(compute({...values,enable:false})),expected(Array(8).fill(0)));
  }
});

test('column bytes transpose an asymmetric pattern and round-trip through row bytes',()=>{
  const rows=[128,96,16,8,4,2,1,129],columns=[129,64,64,32,16,8,4,3];
  const outputs={...Object.fromEntries(rows.map((value,index)=>['r'+index,value])),...Object.fromEntries(columns.map((value,index)=>['c'+index,value]))};
  assert.deepEqual(plain(compute(rowInputs(rows))),outputs);
  assert.deepEqual(plain(compute(columnInputs(columns),'columns')),outputs);
  for(let value=0;value<=255;value++){
    const source=Array.from({length:8},(_,column)=>(value+column*19)%256);
    const fromColumns=plain(compute(columnInputs(source),'columns'));
    assert.deepEqual(source,Array.from({length:8},(_,column)=>fromColumns['c'+column]));
    const fromRows=plain(compute(rowInputs(Array.from({length:8},(_,row)=>fromColumns['r'+row]))));
    assert.deepEqual(fromRows,fromColumns);
    assert.deepEqual(plain(compute(columnInputs(source,false),'columns')),expected(Array(8).fill(0)));
  }
});

test('all Boolean, row-byte, and column-byte pixels map left to right and top to bottom',()=>{
  for(let row=0;row<8;row++)for(let column=0;column<8;column++){
    const rows=Array(8).fill(0);rows[row]=128>>column;
    const columns=Array(8).fill(0);columns[column]=128>>row;
    const selectedRows=Array(8).fill(false),selectedColumns=Array(8).fill(false);selectedRows[row]=true;selectedColumns[column]=true;
    for(const [values,mode] of [[rowInputs(rows),'rows'],[columnInputs(columns),'columns'],[booleanInputs(selectedRows,selectedColumns),'boolean']]){
      assert.deepEqual(plain(compute(values,mode)),expected(rows));
      const children=draw(values,mode),leds=children.filter(child=>child.type==='ellipse');
      assert.equal(leds.length,64);assert.deepEqual(active(children),[row*8+column]);
      if(column>0)assert.ok(leds[row*8+column].x>leds[row*8+column-1].x);
      if(row>0)assert.ok(leds[row*8+column].y>leds[(row-1)*8+column].y);
    }
  }
});

test('all input modes reject malformed values even when disabled',()=>{
  for(const row of ['r0','r3','r7'])for(const value of [-1,256,1.5,NaN,Infinity,-Infinity,'1',true,null,undefined]){
    for(const enable of [true,false])assert.throws(()=>compute({...rowInputs(),[row]:value,enable}),/whole number from 0 to 255/);
  }
  for(const column of ['c0','c3','c7'])for(const value of [-1,256,1.5,NaN,Infinity,-Infinity,'1',true,null,undefined]){
    for(const enable of [true,false])assert.throws(()=>compute({...columnInputs(),[column]:value,enable},'columns'),new RegExp('column '+column+' must be a whole number from 0 to 255'));
  }
  for(const key of ['row0','row7','col0','col7'])for(const value of [0,1,'true',null,undefined]){
    for(const enable of [true,false])assert.throws(()=>compute({...booleanInputs(),[key]:value,enable},'boolean'),/must be Boolean/);
  }
  for(const [values,mode] of [[rowInputs(),'rows'],[columnInputs(),'columns'],[booleanInputs(),'boolean']]){
    for(const enable of [0,1,'true',null,undefined])assert.throws(()=>compute({...values,enable},mode),/enable must be Boolean/);
  }
  const missing=rowInputs();delete missing.r4;assert.throws(()=>compute(missing),/row r4/);
  const missingColumn=columnInputs();delete missingColumn.c4;assert.throws(()=>compute(missingColumn,'columns'),/column c4/);
});

test('switching modes cannot reinterpret incompatible old inputs or mutate stored state',()=>{
  for(const mode of ['',undefined,'scan',0])assert.throws(()=>matrix.inputs({mode}),/input mode/);
  assert.throws(()=>compute(rowInputs(),'boolean'),/row0 must be Boolean/);
  assert.throws(()=>compute(booleanInputs(),'rows'),/row r0/);
  assert.throws(()=>compute(rowInputs(),'columns'),/column c0/);
  assert.throws(()=>compute(columnInputs(),'rows'),/row r0/);
  assert.throws(()=>compute(booleanInputs(),'columns'),/column c0/);
  for(const [values,mode] of [[rowInputs([129,66,36,24,24,36,66,129]),'rows'],[columnInputs([128,96,16,8,4,2,1,129]),'columns'],[booleanInputs(Array(8).fill(true),Array(8).fill(true)),'boolean']]){
    const state={mode,sentinel:7},before=JSON.stringify({values,state});
    const first=plain(matrix.compute(values,state));matrix.compute({...values,enable:false},state);
    assert.deepEqual(plain(matrix.compute(values,state)),first);
    assert.equal(JSON.stringify({values,state}),before,'compute is pure and independent of other evaluations');
  }
});

test('captions and addressing labels adapt to each mode, while disabled data stays off',()=>{
  const rows=[129,66,36,24,24,36,66,129],children=draw(rowInputs(rows));
  assert.ok(children.some(child=>child.text==='Panel A'));assert.equal(active(children).length,16);
  for(const label of ['128','64','32','16','8','4','2','1','R0','R7'])assert.ok(children.some(child=>child.text===label));
  const columnView=draw(columnInputs([129,64,64,32,16,8,4,3]),'columns');
  assert.ok(columnView.some(child=>child.text==='8 × 8 · column bytes'));
  for(let column=0;column<8;column++){
    const label=columnView.find(child=>child.text==='C'+column);
    assert.ok(label,'column '+column+' has its top heading');
    assert.ok(label.y<matrix.initStyle().h*.21);
  }
  for(let row=0;row<8;row++){
    const label=columnView.find(child=>child.text===String(128>>row));
    assert.ok(label,'row '+row+' shows its vertical bit weight');
    assert.ok(label.x<matrix.initStyle().w*.13);
  }
  for(const [values,mode] of [[booleanInputs(),'boolean']]){
    const view=draw(values,mode);
    for(const label of ['C0','C7','R0','R7'])assert.ok(view.some(child=>child.text===label));
    assert.ok(view.some(child=>child.text==='On = row AND column'));
  }
  const disabled=draw(rowInputs(Array(8).fill(255),false));
  assert.equal(disabled.filter(child=>child.type==='ellipse' && child.fillColor==='#1e293b').length,64);
  assert.ok(disabled.some(child=>child.text==='Disabled'));
  const disabledColumns=draw(columnInputs(Array(8).fill(255),false),'columns');
  assert.equal(active(disabledColumns).length,0);assert.ok(disabledColumns.some(child=>child.text==='Disabled'));
  const style=matrix.initStyle(),invalidColumns=matrix.unavailableChildren({mode:'columns'},style,style.w,style.h,false,{error:'LED matrix column c0 must be a whole number from 0 to 255'});
  assert.ok(invalidColumns.some(child=>child.text==='Columns require whole numbers from 0 to 255'));
  const other=draw(rowInputs(Array(8).fill(255)),'rows',{name:'Panel B'});
  assert.equal(active(other).length,64);assert.ok(other.some(child=>child.text==='Panel B'));
  assert.deepEqual(plain(compute(rowInputs(rows))),expected(rows),'another panel cannot alter this panel’s rows');
});

test('unavailable matrices stay visibly distinct from legitimate all-off panels in all modes',()=>{
  const style=matrix.initStyle();
  for(const [values,mode] of [[rowInputs(Array(8).fill(255)),'rows'],[columnInputs(Array(8).fill(255)),'columns'],[booleanInputs(),'boolean']]){
    const state={mode},failed=matrix.unavailableChildren(state,style,style.w,style.h,false,{name:'Broken panel',inputs:values,
      outputs:compute(values,mode),error:'Input unavailable'});
    assert.ok(failed.some(child=>child.text==='Broken panel'));
    assert.equal(failed.filter(child=>child.type==='ellipse' && child.fillColor==='#78350f').length,64);
    assert.equal(failed.filter(child=>child.type==='ellipse' && ['#ef4444','#1e293b'].includes(child.fillColor)).length,0);
    const noIo=matrix.children(state,style,style.w,style.h,false);
    assert.equal(noIo.filter(child=>child.type==='ellipse' && child.fillColor==='#78350f').length,64);
  }

});
