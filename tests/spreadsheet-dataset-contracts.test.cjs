const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=()=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
const sheet=(cells={},more={})=>({cols:6,rows:6,cells,...more});
const table=(rows,columns=[{key:'label',name:'Label',type:'string'},{key:'value',name:'Value',type:'number'},{key:'flag',name:'Flag',type:'boolean'}])=>({columns,rows,rowCount:rows.length,rowIndices:rows.map((_,i)=>i)});
const data=table([['First',3,true],['Second',7,false],[null,null,null],['',0,true]]);

test('dataset grid overlays header and body cells without declaring covered formulas',()=>{
  const def=source(),state=sheet({A1:'=INPUT("hidden")',A2:'=OUTPUT(99,"hidden")',D2:'=OUTPUT(B2*2,"doubled")',D3:'=OUTPUT(A1,"header")'},
    {source:'Dataset',dataRows:2,dataColumns:3});
  assert.deepEqual(plain(def.inputs(state)),{data:{type:'table'},startRow:{type:'number',default:0}});
  assert.deepEqual(plain(def.outputs(state)),{doubled:{type:'number'},header:{type:'string'}});
  assert.deepEqual(plain(def.compute({startRow:0},state,{tables:{data}})),{doubled:6,header:'Label'});
  const values=def._sheet(state,{startRow:0},{data});
  assert.equal(values.A1.t,'Label');assert.equal(values.A2.t,'First');assert.equal(values.B2.v,3);assert.equal(values.C2.b,true);
  assert.equal(def._sheet({...state,source:'Cells'},{hidden:4}).A2.v,99,'hidden saved cells remain available when live mode is disabled');
});

test('dataset grid pages through selected rows in order and keeps header names fixed',()=>{
  const def=source(),selected={...data,rows:[data.rows[1],data.rows[0]],rowIndices:[1,0],rowCount:2};
  const state=sheet({D2:'=OUTPUT(B2,"value","number")',D3:'=OUTPUT(DATA("data",0,"label","string"),"first")'},
    {source:'Dataset',dataRows:3,dataColumns:3});
  assert.deepEqual(plain(def.compute({startRow:1},state,{tables:{data:selected}})),{value:3,first:'Second'});
  const values=def._sheet(state,{startRow:1},{data:selected});
  assert.equal(values.A1.t,'Label');assert.equal(values.A2.t,'First');assert.equal(values.A3,undefined);
  assert.equal(def._sheet(state,{startRow:-1},{data}).A2.e,'#VALUE!');
  assert.equal(def._sheet(state,{startRow:.5},{data}).A2.e,'#VALUE!');
});

test('dataset formulas read complete selected tables beyond drawing previews and preserve long text',()=>{
  const def=source(),long='x'.repeat(600),large=table(Array.from({length:80},(_,i)=>[i===79?long:'row '+i,i,i%2===0]));
  const state=sheet({A1:'=OUTPUT(SUM(COLUMN("source","value")),"sum")',A2:'=OUTPUT(ROWS("source"),"rows")',
    A3:'=OUTPUT(DATA("source",79,"label","string"),"last")',A4:'=OUTPUT(DATA("source",79,"value"),"value")'});
  assert.equal(def.tablePresentation,'full');
  assert.deepEqual(plain(def.inputs(state)),{source:{type:'table'}});
  assert.deepEqual(plain(def.compute({},state,{tables:{source:large}})),{sum:3160,rows:80,last:long,value:79});
  const children=def.children(state,def.initStyle(),552,168,false,{tables:{inputs:{source:large}}});
  assert.ok(children.some(child=>child.text===long));assert.ok(children.some(child=>child.text==='3160'));
});

test('multiple dataset ports work in ordinary Cells mode with typed scalar input ports',()=>{
  const def=source(),state=sheet({A1:'=OUTPUT(SUM(COLUMN("left","value"))+SUM(COLUMN("right","value")),"total")',
    A2:'=OUTPUT(DATA("right",INPUT("row"),"label","string")&INPUT("suffix","string"),"label")',
    A3:'=OUTPUT(DATA("left",0,"flag","boolean"),"flag")'});
  assert.deepEqual(plain(def.inputs(state)),{left:{type:'table'},right:{type:'table'},row:{type:'number',default:0},suffix:{type:'string',default:''}});
  assert.deepEqual(plain(def.compute({row:0,suffix:'!'},state,{tables:{left:data,right:table([['Other',12,false]])}})),{total:22,label:'Other!',flag:true});
});

test('dataset COLUMN has range semantics for nulls, counts, text and Boolean aggregates',()=>{
  const def=source(),state=sheet({A1:'=SUM(COLUMN("data","value"))',A2:'=AVERAGE(COLUMN("data","value"))',
    A3:'=COUNT(COLUMN("data","value"))',A4:'=COUNTA(COLUMN("data","label"))',A5:'=CONCAT(COLUMN("data","label"))',
    A6:'=AND(COLUMN("data","flag"))',B1:'=OR(COLUMN("data","flag"))',B2:'=PRODUCT(COLUMN("data","value"))',
    B3:'=COLUMN("data","value")',B4:'=IFERROR(DATA("data",2,"value"),-1)',B5:'=IFERROR(DATA("data",99,"value"),-2)',
    B6:'=IFERROR(SUM(COLUMN("data","missing")),-3)'});
  const values=def._sheet(state,{}, {data});
  assert.equal(values.A1.v,10);assert.equal(values.A2.v,10/3);assert.equal(values.A3.v,3);assert.equal(values.A4.v,3);
  assert.equal(values.A5.t,'FirstSecond');assert.equal(values.A6.b,false);assert.equal(values.B1.b,true);assert.equal(values.B2.v,0);
  assert.equal(values.B3.e,'#VALUE!');assert.equal(values.B4.v,-1);assert.equal(values.B5.v,-2);assert.equal(values.B6.v,-3);
  const empty=def._sheet(state,{}, {data:table([])});assert.equal(empty.A1.v,0);assert.equal(empty.A2.e,'#DIV/0!');assert.equal(empty.A3.v,0);assert.equal(empty.A4.v,0);
});

test('dataset null and missing grid cells remain blank and participate correctly in ISBLANK/COUNTA',()=>{
  const def=source(),state=sheet({D1:'=ISBLANK(A4)',D2:'=COUNTA(A2:A5)',D3:'=COUNT(B2:B5)',D4:'=ISBLANK(A5)'},
    {source:'Dataset',dataRows:4,dataColumns:3});
  const values=def._sheet(state,{startRow:0},{data});
  assert.equal(values.A4,undefined);assert.equal(values.A5.t,'');assert.equal(values.D1.b,true);assert.equal(values.D2.v,3);
  assert.equal(values.D3.v,3);assert.equal(values.D4.b,false);
});

test('direct dataset output declarations stay stable across reloads and reject mismatched values',()=>{
  const def=source(),base=sheet({D2:'=OUTPUT(B2,"result")'},{source:'Dataset',dataRows:2,dataColumns:3});
  assert.throws(()=>def.outputs(base),/ambiguous.*OUTPUT\(expression/);
  const explicit={...base,cells:{D2:'=OUTPUT(B2,"result","number")'}};
  assert.equal(def.outputs(explicit).result.type,'number');assert.equal(def.compute({startRow:0},explicit,{tables:{data}}).result,3);
  assert.throws(()=>def.compute({startRow:0},explicit,{tables:{data:table([['changed','text',true]])}}),/expected number, got string/);
  assert.equal(def.outputs(explicit).result.type,'number');
  assert.throws(()=>def.compute({},sheet({A1:'=OUTPUT(DATA("data",0,"label"),"result")'}),{tables:{data}}),/#VALUE!/);
  assert.throws(()=>def.compute({},sheet({A1:'=OUTPUT(INPUT("label","string"),"result")'})),/#N\/A/);
  assert.equal(def._sheet(sheet({A1:'=OUTPUT(TRUE,"bad","number")'}),{}).A1.e,'#VALUE!');
});

test('table and scalar port names cannot collide after sanitizing names',()=>{
  const def=source();
  assert.throws(()=>def.inputs(sheet({A1:'=SUM(COLUMN("same name","value"))+INPUT("same-name")'})),/Input same_name has conflicting table and number types/);
  assert.throws(()=>def.inputs(sheet({D1:'=INPUT("data","string")'},{source:'Dataset'})),/conflicting table and string/);
  assert.throws(()=>def.outputs(sheet({A1:'=OUTPUT(1,"same")',A2:'=OUTPUT("text","same")'})),/Output same has conflicting types/);
  assert.doesNotThrow(()=>def.unavailableChildren(sheet({A1:'=INPUT("data")',A2:'=ROWS("data")'}),def.initStyle(),552,168,true,{error:'Conflicting inputs'}));
});

test('readonly dataset handles retain reference picking and actual text, while formulas remain editable',()=>{
  const def=source(),state=sheet({D2:'=B2*2'},{source:'Dataset',dataRows:2,dataColumns:3}),io={inputs:{startRow:0},tables:{inputs:{data}}};
  const handles=def.handles(state,552,168,def.initStyle(),io),a=handles.find(h=>h.id==='A2'),d=handles.find(h=>h.id==='D2');
  assert.equal(a.value,'First');assert.equal(a.readOnly,true);assert.equal(a.ref,'A2');assert.equal(a.inline.mode,'edit');
  assert.equal(a.inline.references,true);assert.equal(d.readOnly,undefined);assert.equal(d.value,'=B2*2');
  assert.equal(def.dragEdit(state,'A2','changed',0,552,168).state,state);
  assert.equal(def.dragEdit(state,'fn:SUM:A2',0,0,552,168).state,state);
  assert.equal(def.dragEdit(state,'D2','=B2*3',0,552,168).state.cells.D2,'=B2*3');
  assert.equal(def.dragEdit(state,'nf2:A2',0,0,552,168).state.formats.A2,'0.0','read-only cells still allow display formatting');
});

test('structural edits cannot move the linked rectangle, but columns/rows beyond it remain editable',()=>{
  const def=source(),state=sheet({D4:'5',E4:'=D4'},{source:'Dataset',dataRows:2,dataColumns:3});
  for(const op of ['cins0','cdel1','rins2','rdel0'])assert.equal(def.dragEdit(state,op,0,0,552,168).state,state,op);
  assert.equal(def._restructure(state,'c',0,1),state);
  const expanded=def.dragEdit(state,'cins3',0,0,552,168);assert.equal(expanded.state.cols,7);assert.equal(expanded.state.cells.F4,'=E4');
  const rows=def.dragEdit(state,'rins3',0,0,552,168);assert.equal(rows.state.rows,7);assert.equal(rows.state.cells.E5,'=D5');
  const menu=def.contextMenu(state,10,35,552,168);
  assert.equal(menu.find(i=>i.id==='cdel0').disabled,true);assert.equal(menu.find(i=>i.id==='rins1').disabled,true);
  assert.equal(menu.find(i=>i.label==='Insert function').disabled,true);
});

test('editable dataset import preserves value types and literal strings without executing formula text',()=>{
  const def=source(),rows=[['=OUTPUT(99,"attack")',1,true],['001',-2,false],['TRUE',null,null],["'literal",3,true],['',4,false],[' spaced ',5,true]],input=table(rows);
  const state=sheet({A1:'=INPUT("old")'},{source:'Dataset',dataRows:2,dataColumns:3,formats:{A1:'0.0'},aligns:{A1:'right'},weights:[2,1,1,1,1,1],extra:'preserved'});
  const imported=def.importTable(state,input,700,180),next=imported.state,values=def._sheet(next,{});
  assert.equal(next.source,'Cells');assert.equal(next.cols,4);assert.equal(next.rows,8);assert.equal(next.extra,'preserved');
  assert.equal(next.formats,undefined);assert.equal(next.aligns,undefined);assert.equal(next.weights,undefined);
  assert.deepEqual(plain(imported.size),{w:400,h:240});
  assert.deepEqual(plain(def.inputs(next)),{});assert.deepEqual(plain(def.outputs(next)),{});
  assert.equal(values.A1.t,'Label');assert.equal(values.A2.t,rows[0][0]);assert.equal(values.A3.t,'001');assert.equal(values.A4.t,'TRUE');
  assert.equal(values.A5.t,"'literal");assert.equal(values.A6.t,'');assert.equal(values.A7.t,' spaced ');
  assert.equal(values.B2.v,1);assert.equal(values.C2.b,true);assert.equal(values.B4,undefined);assert.equal(values.C4,undefined);
  const modified=def.dragEdit(next,'B2','9',0,400,240).state;assert.equal(def._sheet(modified,{}).B2.v,9);assert.equal(input.rows[0][1],1);
  const formula=def.dragEdit(modified,'D2','=OUTPUT(B2*2,"result")',0,400,240).state;assert.equal(def.compute({},formula).result,18);
  assert.equal(def._fnInsert("'001",'LEN').text,'=LEN("001")');
  assert.equal(def._fnInsert("'=1+1",'UPPER').text,'=UPPER("=1+1")');
  const quoted=def._fnInsert("' a \"quote\" ",'UPPER').text;
  assert.equal(def._sheet(sheet({A1:quoted}),{}).A1.t,' A \"QUOTE\" ');
});

test('editable dataset import rejects truncation and oversized grids or state without changing state',()=>{
  const def=source(),state=def.initState(),before=JSON.stringify(state);
  assert.throws(()=>def.importTable(state,{...data,rowCount:99},552,168),/complete dataset/);
  assert.throws(()=>def.importTable(state,table(Array.from({length:99},()=>['a',1,true])),552,168),/does not fit/);
  assert.throws(()=>def.importTable(state,table(Array.from({length:50},()=>['a',1,true])),552,168),/does not fit/);
  assert.throws(()=>def.importTable(state,table([['x'.repeat(1999),1,true],['x'.repeat(1999),2,false]]),552,168),/storage limit/);
  assert.throws(()=>def.importTable(state,table([],Array.from({length:27},(_,i)=>({key:'c'+i,name:'c'+i,type:'string'}))),552,168),/does not fit/);
  assert.throws(()=>def.importTable(state,table([['x'.repeat(2000),1,true]]),552,168),/editable text limit/);
  assert.equal(def._sheet(def.importTable(state,table([['x'.repeat(1999),1,true]]),552,168).state,{}).A2.t.length,1999);
  assert.equal(JSON.stringify(state),before);
  const empty=def.importTable(state,table([]),552,168);assert.equal(empty.state.rows,2);assert.equal(empty.state.cols,4);assert.equal(def._sheet(empty.state,{}).A1.t,'Label');
});

test('literal quote cells stay strings through edit, output typing, import and structural moves',()=>{
  const def=source(),state=sheet({A1:"'TRUE",A2:"'001",A3:"'=2+3",B1:'=OUTPUT(A1,"text")',B2:'=LEN(A2)',B3:'=ISNUMBER(A2)'});
  assert.equal(def.outputs(state).text.type,'string');assert.equal(def.compute({},state).text,'TRUE');
  assert.equal(def._sheet(state,{}).B2.v,3);assert.equal(def._sheet(state,{}).B3.b,false);
  assert.equal(def.dragEdit(state,'A2',"' 001 ",0,552,168).state.cells.A2,"' 001 ");
  assert.equal(def._restructure(state,'c',0,1).cells.B3,"'=2+3");
});

test('spreadsheet remains within the script and handle limits',()=>{
  const def=source(),text=fs.readFileSync(path.join(__dirname,'..','examples','spreadsheet.js'),'utf8');assert.ok(text.length<=64000,text.length);
  const oneColumn=table(Array.from({length:98},(_,i)=>[i]),[{key:'n',name:'N',type:'number'}]);
  const imported=def.importTable(sheet(),oneColumn,552,168);assert.equal(imported.state.rows,99);assert.equal(imported.state.cols,1);assert.equal(imported.size.h,2000);
  const tiny=def.importTable(sheet({}, {cols:26,rows:1}),table([],[{key:'n',name:'N',type:'number'}]),20,20);
  assert.equal(tiny.size.w,20);
  assert.ok(def.handles(imported.state,100,1000).length<=128);assert.equal(def._sheet(imported.state,{}).A99.v,97);
});

test('bound dataset editing is opt-in and identifies source rows independently of selected order',()=>{
  const def=source(),state=sheet({D2:'=B2*2'},{source:'Dataset',dataRows:2,dataColumns:3,editDataset:true});
  const selected={...data,name:'Results',datasetId:'dataset-1',revision:7,editable:true,rows:[data.rows[1],data.rows[0]],rowCount:2,rowIndices:[1,0],rowIds:['stable-second','stable-first']};
  const io={inputs:{startRow:1},tables:{inputs:{data:selected}}},handles=def.handles(state,552,168,def.initStyle(),io);
  const bound=handles.find(h=>h.id==='B2');
  assert.deepEqual(plain(bound.datasetCell),{input:'data',datasetId:'dataset-1',rowId:'stable-first',column:'value',revision:7});
  assert.equal(bound.value,'3');assert.equal(bound.readOnly,false);assert.equal(bound.editorOnly,true);
  assert.equal(bound.kind,'text','nullable numeric data uses a text field; the host validates against the column type');
  assert.equal(bound.ref,'B2');assert.equal(bound.inline.mode,'edit');assert.equal(bound.inline.references,false,'dataset text is literal, not a formula editor');
  assert.match(bound.label,/Results.*row 1.*Value/);
  assert.equal(handles.find(h=>h.id==='B1').readOnly,true,'headers remain read-only');
  assert.equal(handles.find(h=>h.id==='B1').datasetCell,undefined);
  assert.equal(handles.find(h=>h.id==='B3').datasetCell,undefined,'no binding is offered beyond the selected rows');
  assert.equal(handles.find(h=>h.id==='D2').datasetCell,undefined,'formula cells remain local');
  assert.equal(handles.find(h=>h.id==='D2').inline.references,true);
  assert.equal(def.dragEdit(state,'B2','8',0,552,168).state,state,'the host owns source writes; dragEdit never writes a bound cell');
  const defaults=def.handles({...state,editDataset:false},552,168,{},io).find(h=>h.id==='B2');
  assert.equal(defaults.readOnly,true);assert.equal(defaults.datasetCell,undefined);
  assert.equal(def.initState().editDataset,false);assert.equal(def.initState().allowReaderEdit,false);
});

test('only editable source cells can opt into HTML reader editing',()=>{
  const def=source(),state=sheet({}, {source:'Dataset',editDataset:true,allowReaderEdit:true});
  const live={...data,datasetId:'dataset-1',revision:2,editable:true,rowIds:['r0','r1','r2','r3']};
  const handles=t=>def.handles(state,552,168,{}, {inputs:{startRow:0},tables:{inputs:{data:t}}});
  const body=handles(live).find(h=>h.id==='A2');assert.equal(body.editorOnly,false);assert.equal(body.readOnly,false);
  assert.equal(handles(live).find(h=>h.id==='A1').editorOnly,true);
  assert.equal(handles(live).find(h=>h.id==='D2').editorOnly,true,'local formulas never become reader-editable');
  for(const altered of [{editable:false},{rowIds:undefined},{datasetId:undefined},{revision:undefined},{revision:-1},{revision:'2'},{datasetId:'~derived-1'},{rowIds:['not a row id']},{columns:[]},{rows:[]}]){
    const result=handles({...live,...altered}).find(h=>h.id==='A2');
    assert.equal(result.readOnly,true);assert.equal(result.editorOnly,true);assert.equal(result.datasetCell,undefined);
  }
  const badPage=def.handles(state,552,168,{}, {inputs:{startRow:.5},tables:{inputs:{data:live}}}).find(h=>h.id==='A2');
  assert.equal(badPage.datasetCell,undefined);assert.equal(badPage.readOnly,true);
  const onlyReaderFlag=def.handles({...state,editDataset:false},552,168,{}, {tables:{inputs:{data:live}}}).find(h=>h.id==='A2');
  assert.equal(onlyReaderFlag.editorOnly,true,'the reader flag alone does not authorize editing');
});

test('bound dataset handles expose lossless values and nullable cells without interpreting formula text',()=>{
  const def=source(),state=sheet({}, {source:'Dataset',dataRows:5,dataColumns:3,editDataset:true});
  const live={...table([['=OUTPUT(99,"unsafe")',1.23456789,true],['001',0,false],['TRUE',null,null],['',1e-12,true],[' trailing ',3,true]]),
    datasetId:'dataset-1',revision:0,editable:true,rowIds:['a','b','c','d','e']};
  const hs=def.handles(state,552,168,{}, {tables:{inputs:{data:live}}}),get=id=>hs.find(h=>h.id===id);
  assert.equal(get('A2').value,'=OUTPUT(99,"unsafe")');assert.equal(get('A2').inline.references,false);
  assert.equal(get('A3').value,'001');assert.equal(get('A4').value,'TRUE');assert.equal(get('A5').value,'');assert.equal(get('A6').value,' trailing ');
  assert.equal(get('B2').value,'1.23456789');assert.equal(get('B5').value,'1e-12');
  assert.equal(get('C2').value,'TRUE');assert.equal(get('C3').value,'FALSE');
  assert.equal(get('B4').value,'');assert.equal(get('C4').value,'');assert.equal(get('B4').readOnly,false);
  assert.equal(get('B4').datasetCell.rowId,'c');assert.equal(get('B4').datasetCell.revision,0);
  assert.deepEqual(plain(def.outputs(state)),{});
});
