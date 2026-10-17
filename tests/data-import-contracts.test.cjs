const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('// ---------- embedded datasets ----------'),end=html.indexOf('// End of embedded dataset contract.');
assert.ok(start>=0 && end>start,'the editor shares one extractable table-data contract');
const scope=vm.createContext({});
vm.runInContext(html.slice(start,end)+'\nthis.contract={parseDatasetText,inspectDatasetText,normalizeDataTable,normalizeDatasets,datasetReference,datasetsUsedBy};',scope);
const c=scope.contract,plain=value=>JSON.parse(JSON.stringify(value));
const csv=(text,options)=>plain(c.parseDatasetText(text,'results.csv',options));
const inspect=(text,options)=>plain(c.inspectDatasetText(text,'results.csv',options));
const json=(value)=>plain(c.parseDatasetText(typeof value==='string'?value:JSON.stringify(value),'results.json'));

test('CSV imports quoted cells, escaped quotes, multiline Unicode and typed nullable columns',()=>{
  const table=csv('\ufeffBoat,Points,Qualified,Notes\r\n"Möwe, 2",12.5,true,"line 1\r\nline ""2"""\r\nSkua,-3,false,\r\n');
  assert.deepEqual(table.columns.map(column=>[column.name,column.type]),[
    ['Boat','string'],['Points','number'],['Qualified','boolean'],['Notes','string']]);
  assert.deepEqual(table.rows,[['Möwe, 2',12.5,true,'line 1\nline "2"'],['Skua',-3,false,null]]);
  assert.equal(new Set(table.columns.map(column=>column.key)).size,4);
});

test('CSV column-wide inference preserves mixed text and missing cells without changing row order',()=>{
  const table=csv('Boat,Score,Note\nA,1,\nB,n/a,quoted\nC,3,\n');
  assert.equal(table.columns[1].type,'string');
  assert.deepEqual(table.rows,[['A','1',null],['B','n/a','quoted'],['C','3',null]]);
  const allEmpty=csv('Empty\n""\n');assert.equal(allEmpty.columns[0].type,'string');assert.deepEqual(allEmpty.rows,[[null]]);
});

test('CSV automatically detects semicolons while preserving quoted commas, multiline cells and decimal-comma text',()=>{
  const result=inspect('\ufeff"Boat, name";Points;Qualified;Notes\r\n"Möwe; 2";12.5;true;"line 1\r\nline ""2"", here"\r\nSkua;-3;false;\r\n');
  assert.equal(result.delimiter,';');assert.equal(result.ambiguous,false);
  assert.deepEqual(result.table.columns.map(column=>[column.name,column.type]),[
    ['Boat, name','string'],['Points','number'],['Qualified','boolean'],['Notes','string']]);
  assert.deepEqual(result.table.rows,[['Möwe; 2',12.5,true,'line 1\nline "2", here'],['Skua',-3,false,null]]);
  const decimal=inspect('Item;Price\nBread;1,25\nMilk;0,99');
  assert.equal(decimal.delimiter,';');assert.deepEqual(decimal.table.rows,[['Bread','1,25'],['Milk','0,99']]);
  assert.equal(decimal.table.columns[1].type,'string','delimiter detection does not perform locale number conversion');
  assert.equal(csv('Postal;Identifier;Decimal\n01234;9007199254740993;1.25').rows[0][0],'01234');
});

test('CSV detection ignores quoted delimiters and supports a header spanning multiple physical lines',()=>{
  const comma=inspect('"Name; alias",Notes\n"A; B","C; D"');
  assert.equal(comma.delimiter,',');assert.equal(comma.ambiguous,false);
  assert.deepEqual(comma.table.rows,[['A; B','C; D']]);
  const multiline=inspect('"Name,\nincluding a line";Points\nTern;3');
  assert.equal(multiline.delimiter,';');assert.equal(multiline.table.columns[0].name,'Name,\nincluding a line');
  const escaped=inspect('"Name ""quoted; label""",Points\nTern,3');
  assert.equal(escaped.delimiter,',');assert.equal(escaped.ambiguous,false);
  const single=inspect('"Name, with; punctuation"\n"A,B;C"');
  assert.equal(single.delimiter,',');assert.equal(single.ambiguous,false);
  assert.deepEqual(single.table.rows,[['A,B;C']]);
});

test('CSV and TSV automatically detect tabs and preserve quoted tabs, Unicode and nullable typed columns',()=>{
  const source='\ufeff"Boat, name; alias"\tPoints\tQualified\tNotes\r\n"Möwe\t2"\t12.5\ttrue\t"line 1\nline ""2"""\r\nSkua\t-3\tfalse\t';
  const result=inspect(source);
  assert.equal(result.delimiter,'\t');assert.equal(result.ambiguous,false);
  assert.deepEqual(result.table.columns.map(column=>[column.name,column.type]),[
    ['Boat, name; alias','string'],['Points','number'],['Qualified','boolean'],['Notes','string']]);
  assert.deepEqual(result.table.rows,[['Möwe\t2',12.5,true,'line 1\nline "2"'],['Skua',-3,false,null]]);
  const tsv=plain(c.inspectDatasetText(source,'Regatta.TSV'));
  assert.deepEqual(tsv,{...result,table:{...result.table,name:'Regatta'}});
  assert.deepEqual(csv(source,{delimiter:'\t'}),result.table);
  assert.deepEqual(plain(c.parseDatasetText(source,'Regatta.tsv',{delimiter:'\t'})),tsv.table);
  const quoted=inspect('"Name\talias",Points\nTern,3');
  assert.equal(quoted.delimiter,',');assert.equal(quoted.ambiguous,false);
  assert.equal(quoted.table.columns[0].name,'Name\talias');
});

test('tab detection uses full-file consistency and reports ambiguous separators in deterministic order',()=>{
  const all=inspect('Name,Points;Note\tPosition\nTern,3;late\t2\nSkua,7;early\t1');
  assert.equal(all.delimiter,',');assert.equal(all.ambiguous,true);
  const semi=inspect('Name;Note\tPosition\nTern;late\t2\nSkua;early\t1');
  assert.equal(semi.delimiter,';');assert.equal(semi.ambiguous,true);
  const tab=inspect('Name;Note\tPosition\nTern late\t2\nSkua early\t1');
  assert.equal(tab.delimiter,'\t');assert.equal(tab.ambiguous,false);
  const manual=inspect('Name;Note\tPosition\nTern;late\t2',{delimiter:'\t'});
  assert.equal(manual.delimiter,'\t');assert.equal(manual.ambiguous,false);
  assert.deepEqual(manual.table.rows,[['Tern;late',2]]);
  for(const source of ['A\tB\n1','A\tB\n1\t2\t3','A\tA\n1\t2','A\t\n1\t2','A\tB\n"unfinished\t2'])
    assert.throws(()=>inspect(source),undefined,source);
  const commaTSV=plain(c.inspectDatasetText('A,B\n1,2','result.tsv'));
  assert.equal(commaTSV.delimiter,',','the TSV extension also uses content detection');
});

test('ambiguous CSV detection reports both plausible multi-column interpretations and allows explicit override',()=>{
  const source='Name,Points;Note\nTern,3;late\nSkua,7;early';
  const automatic=inspect(source);
  assert.equal(automatic.delimiter,',');assert.equal(automatic.ambiguous,true);
  assert.deepEqual(automatic.table.columns.map(column=>column.name),['Name','Points;Note']);
  const semicolon=inspect(source,{delimiter:';'});
  assert.equal(semicolon.delimiter,';');assert.equal(semicolon.ambiguous,false);
  assert.deepEqual(semicolon.table.rows,[['Tern,3','late'],['Skua,7','early']]);
  assert.deepEqual(csv(source,{delimiter:';'}),semicolon.table,'the existing parser accepts the same override');
  assert.equal(inspect(source,{delimiter:','}).ambiguous,false);
  assert.deepEqual(inspect(source,{delimiter:'auto'}),automatic);
});

test('CSV auto-detection requires whole-file consistency and never repairs malformed multi-column input as one column',()=>{
  const semicolon=inspect('Name, alias;Points\nTern;3\nSkua;7');
  assert.equal(semicolon.delimiter,';');assert.equal(semicolon.ambiguous,false);
  const comma=inspect('Name; alias,Points\nTern,3\nSkua,7');
  assert.equal(comma.delimiter,',');assert.equal(comma.ambiguous,false);
  for(const source of [
    'A,B\n1','A,B\n1,2,3','A,B\n1,2\n3',
    'A;B\n1','A;B\n1;2;3','A;B\n1;2\n3',
    'A,B\n"unfinished,2','A;B\n"unfinished;2',
    'A,B\n"value"junk,2','A;B\n"value"junk;2',
    'A,A\n1,2','A;A\n1;2','A,\n1,2','A;\n1;2'
  ])assert.throws(()=>inspect(source),undefined,source);
  assert.equal(inspect('A,B\n1',{delimiter:';'}).table.columns.length,1,'an explicit override still follows exactly the selected delimiter');
});

test('single-column CSV and JSON inspection retain predictable delimiter metadata',()=>{
  const single=inspect('Name\nTern\nSkua');
  assert.equal(single.delimiter,',');assert.equal(single.ambiguous,false);
  assert.equal(single.table.columns.length,1);
  const result=plain(c.inspectDatasetText('[{"Name":"Tern"}]','boats.json',{delimiter:';'}));
  assert.equal(result.delimiter,null);assert.equal(result.ambiguous,false);
  assert.deepEqual(result.table,{...json([{Name:'Tern'}]),name:'boats'});
  for(const delimiter of ['|',':','comma'])assert.throws(()=>inspect('A,B\n1,2',{delimiter}));
});

test('semicolon CSV retains all source, row, column, cell and normalized storage limits',()=>{
  assert.equal(csv('A;B\n'+Array.from({length:1000},(_,i)=>i+';text').join('\n')).rows.length,1000);
  assert.throws(()=>csv('A;B\n'+Array.from({length:1001},(_,i)=>i+';text').join('\n')));
  const header=Array.from({length:32},(_,i)=>'C'+i).join(';');
  assert.equal(csv(header).columns.length,32);assert.throws(()=>csv(header+';extra'));
  assert.equal(csv('A;B\n'+('x'.repeat(2000))+';1').rows[0][0].length,2000);
  assert.throws(()=>csv('A;B\n'+('x'.repeat(2001))+';1'));
  assert.throws(()=>csv('A;B\n'+Array.from({length:300},()=>('x'.repeat(2000))+';1').join('\n')));
  assert.throws(()=>inspect('A;B\n'+'x'.repeat(1000000)));
});

test('JSON imports typed flat object records with stable union columns and null missing cells',()=>{
  const input=[{Boat:'Tern',Points:7.25,Qualified:true},{Qualified:false,Boat:'Skua',Notes:'late'},{Boat:'Möwe',Points:null}];
  const table=json(input);
  assert.deepEqual(table.columns.map(column=>[column.name,column.type]),[
    ['Boat','string'],['Points','number'],['Qualified','boolean'],['Notes','string']]);
  assert.deepEqual(table.rows,[['Tern',7.25,true,null],['Skua',null,false,'late'],['Möwe',null,null,null]]);
  const empty=json([{Note:null}]);assert.equal(empty.columns[0].type,'string');assert.deepEqual(empty.rows,[[null]]);
});

test('malformed CSV and unsupported JSON reject the full import rather than silently repairing data',()=>{
  for(const text of ['A,A\n1,2','A,\n1,2','A,B\n1','A,B\n1,2,3','A\n"unfinished','A\n"value"junk','A\nva"lue'])
    assert.throws(()=>csv(text),undefined,text);
  for(const input of [{a:1},[1,2],[[1,2]],[],[{}],[{a:{nested:true}}],[{a:[1,2]}],[{a:1},{a:'2'}],[{a:1},{a:false}]])
    assert.throws(()=>json(input),undefined,JSON.stringify(input));
  assert.throws(()=>json('[{"a":1e309}]'));
});

test('table imports enforce row, column and cell bounds before accepting data',()=>{
  const thousand=Array.from({length:1000},(_,index)=>({value:index}));
  assert.equal(json(thousand).rows.length,1000);assert.throws(()=>json([...thousand,{value:1000}]));
  const wide=Object.fromEntries(Array.from({length:32},(_,index)=>['field'+index,index]));
  assert.equal(json([wide]).columns.length,32);assert.throws(()=>json([{...wide,extra:33}]));
  assert.equal(json([{text:'x'.repeat(2000)}]).rows[0][0].length,2000);assert.throws(()=>json([{text:'x'.repeat(2001)}]));
  assert.throws(()=>json(Array.from({length:300},()=>({text:'x'.repeat(2000)}))),'normalized data budget rejects a too-large table');
  assert.throws(()=>csv('x'.repeat(1000001)),'source budget rejects a too-large file before parsing');
});

test('table normalization rejects invalid schemas, non-finite cells and type drift atomically',()=>{
  const table=json([{Boat:'Tern',Points:7}]);
  assert.deepEqual(plain(c.normalizeDataTable(table)),table);
  for(const changed of [
    {...table,rows:[['Tern']]},
    {...table,rows:[['Tern',Infinity]]},
    {...table,rows:[['Tern','7']]},
    {...table,rows:[['Tern',7,'extra']]},
    {...table,columns:[...table.columns,{...table.columns[0]}]},
    {...table,columns:[{...table.columns[0],type:'object'},table.columns[1]]}
  ])assert.throws(()=>c.normalizeDataTable(changed));
  assert.deepEqual(table,json([{Boat:'Tern',Points:7}]),'rejected validation does not mutate its original source');
});

test('dataset references are compact, typed, and reject malformed or duplicate row selections',()=>{
  const pool={results:json([{value:1},{value:2},{value:3}])};
  assert.deepEqual(plain(c.datasetReference({datasetId:'results'},pool)),{datasetId:'results'});
  assert.deepEqual(plain(c.datasetReference({datasetId:'results',rows:[2,0]},pool)),{datasetId:'results',rows:[2,0]});
  assert.deepEqual(plain(c.datasetReference({datasetId:'results',rows:[]},pool)),{datasetId:'results',rows:[]});
  for(const input of [null,'results',{}, {datasetId:''},{datasetId:7},{datasetId:'results',rows:[-1]},
    {datasetId:'results',rows:[1.5]},{datasetId:'results',rows:[0,0]},{datasetId:'results',rows:['0']},{datasetId:'results',rows:[3]},{datasetId:'missing'},
    {datasetId:'constructor'},{datasetId:'__proto__'},{datasetId:'results',extra:true}])
    assert.throws(()=>c.datasetReference(input,pool),undefined,JSON.stringify(input));
});


test('numeric-looking CSV identifiers and unsafe integers retain their exact source text',()=>{
  const table=csv('Postal,Identifier,Decimal\n01234,9007199254740993,1.25\n00500,9007199254740991,-0.5');
  assert.deepEqual(table.columns.map(column=>column.type),['string','string','number']);
  assert.deepEqual(table.rows,[['01234','9007199254740993',1.25],['00500','9007199254740991',-0.5]]);
  assert.throws(()=>json('[{"integer":9007199254740993}]'),'JSON rejects a number that cannot be kept exact');
});

test('dataset pools keep only referenced data on export and reject the entire invalid pool',()=>{
  const first=json([{value:1}]),second=json([{value:2}]),pool={first,second};
  const list=[{inputValues:{data:{datasetId:'second'}}},{inputValues:{value:2}},{signalState:{data:{datasetId:'second',rows:[0]}}}];
  assert.deepEqual(plain(c.datasetsUsedBy(list,pool)),{second});
  assert.deepEqual(plain(c.normalizeDatasets(pool)),pool);
  for(const changed of [{...pool,bad:{...first,rows:[[Infinity]]}},Object.fromEntries(Array.from({length:17},(_,index)=>['data'+index,first])),
    JSON.parse('{"__proto__":'+JSON.stringify(first)+'}')])assert.throws(()=>c.normalizeDatasets(changed));
  assert.deepEqual(pool,{first,second},'failed pool validation never mutates existing data');
});
