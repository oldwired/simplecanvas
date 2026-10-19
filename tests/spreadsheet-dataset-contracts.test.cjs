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

test('dataset ranges overlay empty header and body cells while formula cells stay independent',()=>{
  const def=source(),state=sheet({F1:'=INPUT("data",A1:C3,INPUT("startRow"))',D2:'=OUTPUT(B2*2,"doubled")',D3:'=OUTPUT(A1,"header")'});
  assert.deepEqual(plain(def.inputs(state)),{data:{type:'table'},startRow:{type:'number',default:0}});
  assert.deepEqual(plain(def.outputs(state)),{doubled:{type:'number'},header:{type:'string'}});
  assert.deepEqual(plain(def.compute({startRow:0},state,{tables:{data}})),{doubled:6,header:'Label'});
  const values=def._sheet(state,{startRow:0},{data});
  assert.equal(values.A1.t,'Label');assert.equal(values.A2.t,'First');assert.equal(values.B2.v,3);assert.equal(values.C2.b,true);
  const without=def.tableRanges(state,{cell:'F1',remove:true}).state;
  assert.equal(def.handles(without,552,168).find(h=>h.id==='A2').readOnly,undefined);
});

test('dataset grid pages through selected rows in order and keeps header names fixed',()=>{
  const def=source(),selected={...data,rows:[data.rows[1],data.rows[0]],rowIndices:[1,0],rowCount:2};
  const state=sheet({F1:'=INPUT("data",A1:C4,INPUT("startRow"))',D2:'=OUTPUT(B2,"value","number")',D3:'=OUTPUT(DATA("data",0,"label","string"),"first")'});
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
  const def=source(),state=sheet({F1:'=INPUT("data",A1:C5,INPUT("startRow"))',D1:'=ISBLANK(A4)',D2:'=COUNTA(A2:A5)',D3:'=COUNT(B2:B5)',D4:'=ISBLANK(A5)'});
  const values=def._sheet(state,{startRow:0},{data});
  assert.equal(values.A4,undefined);assert.equal(values.A5.t,'');assert.equal(values.D1.b,true);assert.equal(values.D2.v,3);
  assert.equal(values.D3.v,3);assert.equal(values.D4.b,false);
});

test('direct dataset output declarations stay stable across reloads and reject mismatched values',()=>{
  const def=source(),base=sheet({F1:'=INPUT("data",A1:C3,INPUT("startRow"))',D2:'=OUTPUT(B2,"result")'});
  assert.throws(()=>def.outputs(base),/ambiguous.*OUTPUT\(expression/);
  const explicit={...base,cells:{...base.cells,D2:'=OUTPUT(B2,"result","number")'}};
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
  assert.throws(()=>def.inputs(sheet({F1:'=INPUT("data",A1:C3)',D1:'=INPUT("data","string")'})),/conflicting table and string/);
  assert.throws(()=>def.outputs(sheet({A1:'=OUTPUT(1,"same")',A2:'=OUTPUT("text","same")'})),/Output same has conflicting types/);
  assert.doesNotThrow(()=>def.unavailableChildren(sheet({A1:'=INPUT("data")',A2:'=ROWS("data")'}),def.initStyle(),552,168,true,{error:'Conflicting inputs'}));
});

test('readonly dataset handles retain reference picking and actual text, while formulas remain editable',()=>{
  const def=source(),state=sheet({F1:'=INPUT("data",A1:C3,INPUT("startRow"))',D2:'=B2*2'}),io={inputs:{startRow:0},tables:{inputs:{data}}};
  const handles=def.handles(state,552,168,def.initStyle(),io),a=handles.find(h=>h.id==='A2'),d=handles.find(h=>h.id==='D2');
  assert.equal(a.value,'First');assert.equal(a.readOnly,true);assert.equal(a.ref,'A2');assert.equal(a.inline.mode,'edit');
  assert.equal(a.inline.references,true);assert.equal(d.readOnly,undefined);assert.equal(d.value,'=B2*2');
  assert.equal(def.dragEdit(state,'A2','changed',0,552,168).state,state);
  assert.equal(def.dragEdit(state,'fn:SUM:A2',0,0,552,168).state,state);
  assert.equal(def.dragEdit(state,'D2','=B2*3',0,552,168).state.cells.D2,'=B2*3');
  assert.equal(def.dragEdit(state,'nf2:A2',0,0,552,168).state.formats.A2,'0.0','read-only cells still allow display formatting');
});

test('structural edits move linked rectangles intact and block changes inside them',()=>{
  const def=source(),state=sheet({F1:'=INPUT("data",A1:C3)',D4:'5',E4:'=D4'});
  for(const op of ['cins1','cdel0','cdel1','rins2','rdel0','rdel2'])assert.equal(def.dragEdit(state,op,0,0,552,168).state,state,op);
  assert.equal(def._restructure(state,'c',1,1),state);
  const moved=def.dragEdit(state,'cins0',0,0,552,168).state;
  assert.equal(moved.cells.G1,'=INPUT("data",B1:D3)');
  assert.equal(def._sheet(moved,{},{data}).C2.v,3);
  const rowBefore=def.dragEdit(state,'rins0',0,0,552,168).state;
  assert.equal(rowBefore.cells.F2,'=INPUT("data",A2:C4)');
  assert.equal(def._sheet(rowBefore,{},{data}).B3.v,3);
  const expanded=def.dragEdit(state,'cins3',0,0,552,168);assert.equal(expanded.state.cols,7);assert.equal(expanded.state.cells.F4,'=E4');
  const rows=def.dragEdit(state,'rins3',0,0,552,168);assert.equal(rows.state.rows,7);assert.equal(rows.state.cells.E5,'=D5');
  const menu=def.contextMenu(state,10,35,552,168);
  assert.equal(menu.find(i=>i.id==='cdel0').disabled,true);assert.equal(menu.find(i=>i.id==='rins1').disabled,true);
  assert.equal(menu.find(i=>i.id==='cins0').disabled,false);
  assert.equal(menu.find(i=>i.label==='Insert function').disabled,true);
});

test('editable dataset import preserves value types and literal strings without executing formula text',()=>{
  const def=source(),rows=[['=OUTPUT(99,"attack")',1,true],['001',-2,false],['TRUE',null,null],["'literal",3,true],['',4,false],[' spaced ',5,true]],input=table(rows);
  const state=sheet({A1:'=INPUT("old")'},{source:'Dataset',dataRows:2,dataColumns:3,formats:{A1:'0.0'},aligns:{A1:'right'},weights:[2,1,1,1,1,1],extra:'preserved'});
  const imported=def.importTable(state,input,700,180),next=imported.state,values=def._sheet(next,{});
  assert.equal(next.source,undefined);assert.equal(next.cols,4);assert.equal(next.rows,8);assert.equal(next.extra,'preserved');
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
  const def=source(),state=sheet({F1:'=INPUT("data",A1:C3,INPUT("startRow"),1)',D2:'=B2*2'});
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
  const defaults=def.handles({...state,cells:{...state.cells,F1:state.cells.F1.replace(/,[12]\)$/,',0)')}},552,168,{},io).find(h=>h.id==='B2');
  assert.equal(defaults.readOnly,true);assert.equal(defaults.datasetCell,undefined);
  assert.equal(def.initState().editDataset,undefined);assert.equal(def.initState().allowReaderEdit,undefined);
});

test('only editable source cells can opt into HTML reader editing',()=>{
  const def=source(),state=sheet({F1:'=INPUT("data",A1:C5,INPUT("startRow"),2)'});
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
  const onlyReaderFlag=def.handles({...state,cells:{...state.cells,F1:state.cells.F1.replace(/,[12]\)$/,',0)')}},552,168,{}, {tables:{inputs:{data:live}}}).find(h=>h.id==='A2');
  assert.equal(onlyReaderFlag.editorOnly,true,'the reader flag alone does not authorize editing');
});

test('bound dataset handles expose lossless values and nullable cells without interpreting formula text',()=>{
  const def=source(),state=sheet({F1:'=INPUT("data",A1:C6,0,1)'});
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

test('invalid linked ranges report their declaration and never reserve repair cells',()=>{
  const def=source();
  for(const [cells,match] of [
    [{F1:'=INPUT("data",A1:C7)',F2:'=OUTPUT(SUM(B2:B6),"total")'},/F1:.*inside the grid/],
    [{F1:'=INPUT("data",A1:Z100)'},/F1:.*valid range/],
    [{A1:'=INPUT("data",A1:C3)'},/A1:.*outside table ranges/],
    [{F1:'=INPUT("data",A1:C3,0,3)'},/F1:.*fourth argument/],
    [{F1:'=INPUT("data",A1:C3)',B2:'=OUTPUT(5,"keep")'},/F1: B2.*move the range or clear/],
    [{F1:'=INPUT("left",A1:C3)',F2:'=INPUT("right",B2:D4)'},/table ranges overlap/],
    [{F1:'=INPUT("data",A1:C3'},/F1: invalid formula/],
    [{F1:'=INPUT("data",A1:C3)&"label"'},/F1:.*complete cell formula/],
  ]){
    const state=sheet(cells),before=JSON.stringify(state);
    assert.throws(()=>def.compute({},state),match);
    assert.match(def.configurationError(state),match,'caps can report the declaration error before checking stale saved assignments');
    assert.deepEqual(plain(def.inputs(state)),{},'bad declarations must not demand a source before reporting the error');
    assert.equal(def.handles(state,552,168).find(h=>h.id==='A1').readOnly,undefined);
    assert.equal(def.handles(state,552,168).find(h=>h.id==='B2').readOnly,undefined);
    assert.equal(def.dragEdit(state,'F1','',0,552,168).state.cells.F1,undefined);
    assert.equal(JSON.stringify(state),before);
  }
});

test('default Insert table function stays editable even when its range contains the declaration',()=>{
  const def=source(),created=def.dragEdit(def.initState(),'fn:INTABLE:A1',null,0,552,168).state;
  assert.match(created.cells.A1,/^=INPUT/);
  assert.equal(def.handles(created,552,168).find(h=>h.id==='A1').readOnly,undefined);
  assert.throws(()=>def.compute({startRow:0},created),/A1:.*outside table ranges/);
  const fixed=def.dragEdit(created,'A1','=INPUT("data",B1:D3)',0,552,168).state;
  assert.equal(def.configurationError(fixed),null);
  assert.deepEqual(plain(def.inputs(fixed)),{data:{type:'table'}});
  assert.equal(def._sheet(fixed,{},{data}).C2.v,3);
});

test('table range authoring places and relocates declarations without overwriting cells',()=>{
  const def=source(),state=sheet({F1:'keep',E2:'=2+3'}),before=JSON.stringify(state);
  const added=def.tableRanges(state,{kind:'input',name:'live "data"',range:'A1:C3',start:'INPUT("offset")',access:2});
  assert.equal(added.entries.length,1);
  assert.deepEqual(plain(added.entries[0]),{cell:'D1',kind:'input',name:'live "data"',range:'A1:C3',start:'INPUT("offset")',access:2,types:''});
  assert.equal(added.state.cells.D1,'=INPUT("live ""data""",A1:C3,INPUT("offset"),2)');
  assert.equal(JSON.stringify(state),before);
  const moved=def.tableRanges(added.state,{...added.entries[0],range:'B1:D3',start:'0',access:1});
  assert.equal(moved.entries[0].cell,'A1','the declaration moves outside its new range');
  assert.equal(moved.state.cells.D1,undefined);assert.equal(moved.state.cells.F1,'keep');assert.equal(moved.state.cells.E2,'=2+3');
  const removed=def.tableRanges(moved.state,{cell:'A1',remove:true});
  assert.equal(removed.entries.length,0);assert.deepEqual(plain(removed.state.cells),plain(state.cells));
  assert.throws(()=>def.tableRanges(state,{kind:'input',name:'data',range:'D1:F3',start:'0'}),/F1 lies in the table range/);
  assert.throws(()=>def.tableRanges(state,{kind:'input',name:'data',range:'A1:F6'}),/No empty cell/);
  assert.throws(()=>def.tableRanges(state,{kind:'input',name:'data',range:'A1:C99'}),/inside the grid/);
  assert.throws(()=>def.tableRanges(state,{cell:'F1',remove:true}),/declaration has changed/);
});

test('table range authoring creates typed output formulas and rejects duplicate ports',()=>{
  const def=source(),state=sheet({A1:'name',B1:'amount',A2:'First',B2:'2'});
  const added=def.tableRanges(state,{kind:'output',name:'Result table',range:'A1:B3',types:'2,number'});
  assert.equal(added.state.cells.C1,'=OUTPUT(A1:B3,"Result table",2,"number")');
  assert.deepEqual(plain(added.entries[0]),{cell:'C1',kind:'output',name:'Result table',range:'A1:B3',start:'0',access:0,types:'2,number'});
  assert.deepEqual(plain(def.compute({},added.state).Result_table.table.rows),[['First',2],[null,null]]);
  const mostlyEmpty=def.tableRanges(sheet({A1:'name'}),{kind:'output',name:'Empty',range:'A1:C3',types:'2,2,2'});
  assert.equal(mostlyEmpty.entries[0].cell,'D1','generated output declarations stay outside their published rectangle');
  assert.throws(()=>def.tableRanges(added.state,{kind:'output',name:'Result table',range:'A1:B3'}),/declared twice/);
  assert.throws(()=>def.tableRanges(state,{kind:'output',name:'Results',range:'A1:B3',types:'number,date'}),/one type per column/);
});
