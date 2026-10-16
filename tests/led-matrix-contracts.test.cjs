const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const matrix=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples','led-matrix.js'),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
const rowInputs=(rows=Array(8).fill(0),enable=true)=>Object.fromEntries(rows.map((value,index)=>['r'+(index+1),value]).concat([['enable',enable]]));
const booleanInputs=(rows=Array(8).fill(false),columns=Array(8).fill(false),enable=true)=>Object.fromEntries([
  ...rows.map((value,index)=>['row'+(index+1),value]),...columns.map((value,index)=>['col'+(index+1),value]),['enable',enable]
]);
const expected=rows=>Object.fromEntries(rows.map((value,index)=>['r'+(index+1),value]));
const compute=(values,mode='rows')=>matrix.compute(values,{mode});
const draw=(values,mode='rows',extra={})=>{
  const style=matrix.initStyle(),state={mode};
  return matrix.children(state,style,style.w,style.h,false,{name:'Panel A',inputs:values,outputs:matrix.compute(values,state),...extra});
};
const active=children=>plain(children.filter(child=>child.type==='ellipse').map((led,index)=>led.fillColor==='#ef4444'?index:-1).filter(index=>index>=0));

test('LED matrix defaults to Boolean rows/columns with two separate typed input modes',()=>{
  assert.equal(matrix.apiVersion,2);
  assert.deepEqual(plain(matrix.initState()),{mode:'boolean'});
  assert.deepEqual(plain(matrix.settings),{mode:{type:'string',default:'boolean',options:['boolean','rows'],label:'Input mode'}});
  assert.deepEqual(plain(matrix.inputs({mode:'boolean'})),{
    ...Object.fromEntries(['row','col'].flatMap(prefix=>Array.from({length:8},(_,index)=>[prefix+(index+1),{type:'boolean',default:false}]))),
    enable:{type:'boolean',default:true}
  });
  assert.deepEqual(plain(matrix.inputs({mode:'rows'})),{
    ...Object.fromEntries(Array.from({length:8},(_,index)=>['r'+(index+1),{type:'number',default:0}])),enable:{type:'boolean',default:true}
  });
  assert.deepEqual(plain(matrix.outputs),Object.fromEntries(Array.from({length:8},(_,index)=>['r'+(index+1),{type:'number'}])));
  for(const mode of ['boolean','rows'])assert.ok(Object.keys(matrix.inputs({mode})).length<=32);
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

test('row-byte mode accepts every byte and enable masks all eight outputs',()=>{
  for(let value=0;value<=255;value++){
    const rows=Array.from({length:8},(_,row)=>(value+row)%256),values=rowInputs(rows);
    assert.deepEqual(plain(compute(values)),expected(rows));
    assert.deepEqual(plain(compute({...values,enable:false})),expected(Array(8).fill(0)));
  }
});

test('all Boolean and row-byte pixels map left to right and top to bottom',()=>{
  for(let row=0;row<8;row++)for(let column=0;column<8;column++){
    const rows=Array(8).fill(0);rows[row]=128>>column;
    const selectedRows=Array(8).fill(false),selectedColumns=Array(8).fill(false);selectedRows[row]=true;selectedColumns[column]=true;
    for(const [values,mode] of [[rowInputs(rows),'rows'],[booleanInputs(selectedRows,selectedColumns),'boolean']]){
      const children=draw(values,mode),leds=children.filter(child=>child.type==='ellipse');
      assert.equal(leds.length,64);assert.deepEqual(active(children),[row*8+column]);
      if(column>0)assert.ok(leds[row*8+column].x>leds[row*8+column-1].x);
      if(row>0)assert.ok(leds[row*8+column].y>leds[(row-1)*8+column].y);
    }
  }
});

test('all input modes reject malformed values even when disabled',()=>{
  for(const row of ['r1','r4','r8'])for(const value of [-1,256,1.5,NaN,Infinity,-Infinity,'1',true,null,undefined]){
    for(const enable of [true,false])assert.throws(()=>compute({...rowInputs(),[row]:value,enable}),/whole number from 0 to 255/);
  }
  for(const key of ['row1','row8','col1','col8'])for(const value of [0,1,'true',null,undefined]){
    for(const enable of [true,false])assert.throws(()=>compute({...booleanInputs(),[key]:value,enable},'boolean'),/must be Boolean/);
  }
  for(const [values,mode] of [[rowInputs(),'rows'],[booleanInputs(),'boolean']]){
    for(const enable of [0,1,'true',null,undefined])assert.throws(()=>compute({...values,enable},mode),/enable must be Boolean/);
  }
  const missing=rowInputs();delete missing.r5;assert.throws(()=>compute(missing),/row r5/);
});

test('switching modes cannot reinterpret incompatible old inputs or mutate stored state',()=>{
  for(const mode of ['',undefined,'scan',0])assert.throws(()=>matrix.inputs({mode}),/input mode/);
  assert.throws(()=>compute(rowInputs(),'boolean'),/row1 must be Boolean/);
  assert.throws(()=>compute(booleanInputs(),'rows'),/row r1/);
  for(const [values,mode] of [[rowInputs([129,66,36,24,24,36,66,129]),'rows'],[booleanInputs(Array(8).fill(true),Array(8).fill(true)),'boolean']]){
    const state={mode,sentinel:7},before=JSON.stringify({values,state});
    const first=plain(matrix.compute(values,state));matrix.compute({...values,enable:false},state);
    assert.deepEqual(plain(matrix.compute(values,state)),first);
    assert.equal(JSON.stringify({values,state}),before,'compute is pure and independent of other evaluations');
  }
});

test('captions and addressing labels adapt to each mode, while disabled data stays off',()=>{
  const rows=[129,66,36,24,24,36,66,129],children=draw(rowInputs(rows));
  assert.ok(children.some(child=>child.text==='Panel A'));assert.equal(active(children).length,16);
  for(const label of ['128','64','32','16','8','4','2','1','R1','R8'])assert.ok(children.some(child=>child.text===label));
  for(const [values,mode] of [[booleanInputs(),'boolean']]){
    const view=draw(values,mode);
    for(const label of ['C1','C8','R1','R8'])assert.ok(view.some(child=>child.text===label));
    assert.ok(view.some(child=>child.text==='On = row AND column'));
  }
  const disabled=draw(rowInputs(Array(8).fill(255),false));
  assert.equal(disabled.filter(child=>child.type==='ellipse' && child.fillColor==='#1e293b').length,64);
  assert.ok(disabled.some(child=>child.text==='Disabled'));
  const other=draw(rowInputs(Array(8).fill(255)),'rows',{name:'Panel B'});
  assert.equal(active(other).length,64);assert.ok(other.some(child=>child.text==='Panel B'));
  assert.deepEqual(plain(compute(rowInputs(rows))),expected(rows),'another panel cannot alter this panel’s rows');
});

test('unavailable matrices stay visibly distinct from legitimate all-off panels in all modes',()=>{
  const style=matrix.initStyle();
  for(const [values,mode] of [[rowInputs(Array(8).fill(255)),'rows'],[booleanInputs(),'boolean']]){
    const state={mode},failed=matrix.unavailableChildren(state,style,style.w,style.h,false,{name:'Broken panel',inputs:values,
      outputs:compute(values,mode),error:'Input unavailable'});
    assert.ok(failed.some(child=>child.text==='Broken panel'));
    assert.equal(failed.filter(child=>child.type==='ellipse' && child.fillColor==='#78350f').length,64);
    assert.equal(failed.filter(child=>child.type==='ellipse' && ['#ef4444','#1e293b'].includes(child.fillColor)).length,0);
    const noIo=matrix.children(state,style,style.w,style.h,false);
    assert.equal(noIo.filter(child=>child.type==='ellipse' && child.fillColor==='#78350f').length,64);
  }

});
