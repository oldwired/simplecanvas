const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','examples','page-settings.js'),'utf8');
const component=(globals={})=>vm.runInNewContext(source,globals);
const plain=value=>JSON.parse(JSON.stringify(value));
const defaults=def=>Object.fromEntries(Object.entries(def.inputs).map(([key,port])=>[key,port.default]));

test('Sketch settings declares four typed host properties with labelled inputs and no signal outputs',()=>{
  const def=component();
  assert.equal(def.apiVersion,2);
  assert.deepEqual(plain(def.pageSettings),{title:'title',showTabs:'showTabs',showWiring:'showWiring',showSimulationControls:'showSimulationControls'});
  assert.deepEqual(plain(def.inputs),{
    title:{type:'string',default:'',label:'Window title'},
    showTabs:{role:'control',type:'boolean',default:true,label:'Show tab bar'},
    showWiring:{role:'control',type:'boolean',default:false,label:'Show wiring'},
    showSimulationControls:{role:'control',type:'boolean',default:true,label:'Show simulation controls'}
  });
  assert.deepEqual(plain(def.outputs),{});
  assert.deepEqual(plain(def.initState()),{overrideTitle:false,overrideShowTabs:false,overrideShowWiring:false,overrideShowSimulationControls:false});
  assert.equal(def.dataActions,undefined,'presentation is a host capability, not a triggered action');
  assert.deepEqual(plain(def.compute(defaults(def))),{});
});

test('Sketch settings computation validates values without mutating inputs or accessing browser presentation',()=>{
  const def=component({document:{set title(value){throw new Error('Component must not set the host title');}}});
  for(const title of ['', 'Anna’s workspace', '<script>literal title</script>', 'x'.repeat(2000)]){
    for(const showTabs of [true,false])for(const showWiring of [true,false])for(const showSimulationControls of [true,false]){
      const inputs=Object.freeze({title,showTabs,showWiring,showSimulationControls}),before=JSON.stringify(inputs);
      assert.deepEqual(plain(def.compute(inputs)),{});
      assert.equal(JSON.stringify(inputs),before);
    }
  }
  for(const title of [null,undefined,42,true,{},'x'.repeat(2001),'😀'.repeat(1001)])assert.throws(()=>def.compute({...defaults(def),title}),/Window title must be text of at most 2000 characters/);
  for(const key of ['showTabs','showWiring','showSimulationControls'])for(const value of [null,undefined,0,1,'true','false',{}]){
    assert.throws(()=>def.compute({...defaults(def),[key]:value}),/must be Boolean/,key);
  }
});

test('Sketch settings authoring preview shows the instance name, current values and application scope',()=>{
  const def=component(),state={...def.initState(),overrideTitle:true,overrideShowTabs:true,overrideShowWiring:true,overrideShowSimulationControls:true},style=def.initStyle();
  const io={name:'Custom page',inputs:{title:'Welcome, Anna',showTabs:false,showWiring:true,showSimulationControls:false}};
  const before=JSON.stringify({state,style,io});
  for(const editing of [true,false]){
    const children=plain(def.children(state,style,style.w,style.h,editing,io)),texts=children.filter(child=>child.type==='text');
    assert.ok(children.length>0);
    assert.ok(children.every(child=>child.editorOnly===true),'the whole block is absent from the exported drawing');
    for(const text of ['Custom page','Title: Welcome, Anna','Tab bar: hidden · Wiring: shown','Simulation controls: hidden','Applied before this sketch is shown','Authoring only · one per sketch'])assert.ok(texts.some(child=>child.text===text),text);
    assert.ok(texts.every(child=>child.plainText===true));
  }
  assert.equal(JSON.stringify({state,style,io}),before);
  const preview=plain(def.children(def.initState(),style,style.w,style.h,false));
  for(const text of ['Sketch settings','Title: inherit','Tab bar: inherit · Wiring: inherit','Simulation controls: inherit'])assert.ok(preview.some(child=>child.text===text),text);
});

test('unavailable Sketch settings remains editor-only and describes fallback without presenting stale values',()=>{
  const def=component(),state=def.initState(),style=def.initStyle();
  for(const editing of [true,false]){
    const children=plain(def.unavailableChildren(state,style,style.w,style.h,editing,{name:'Presentation',inputs:{title:'Old title',showTabs:false},error:'Missing title source'}));
    assert.ok(children.every(child=>child.editorOnly===true));
    assert.ok(children.some(child=>child.text==='Presentation'));
    assert.ok(children.some(child=>child.text==='Missing title source'));
    assert.ok(children.some(child=>child.text==='Workspace defaults apply'));
    assert.equal(children.some(child=>child.text?.includes('Old title')),false);
  }
  assert.ok(def.unavailableChildren(state,style,style.w,style.h,false).some(child=>child.text==='Input unavailable'));
});

test('Sketch settings preview honors selected styles and treats user text literally',()=>{
  const def=component(),state={...def.initState(),overrideTitle:true},style={...def.initStyle(),fill:false,strokeOn:false,color:'#f00',size:4,dash:'dash',textColor:'#123456',font:'400 18px serif'};
  const children=plain(def.children(state,style,style.w,style.h,false,{name:'<b>Page</b>',inputs:{title:'<b>literal</b>'}}));
  assert.deepEqual(children[0],{type:'rect',x:0,y:0,w:300,h:160,fill:false,fillColor:'#f8fafc',strokeOn:false,color:'#f00',size:4,dash:'dash',editorOnly:true});
  const title=children.find(child=>child.text==='<b>Page</b>');
  assert.equal(title.color,'#123456');assert.equal(title.plainText,true);assert.match(title.font,/serif$/);
  assert.ok(children.some(child=>child.text==='Title: <b>literal</b>' && child.plainText));
});

test('Sketch settings preview clipping preserves visible characters and scales with the block',()=>{
  const def=component(),style=def.initStyle(),family='👨‍👩‍👧‍👦';
  assert.equal(def._text('A'+family+'BCD',0,0,31,20,10,style).text,'A'+family+'…');
  assert.equal(component({Intl:{}})._text(family+'BCD',0,0,5,20,10,style).text,'…');
  const children=plain(def.children(def.initState(),style,600,320,false));
  assert.equal(children[0].w,600);assert.equal(children[0].h,320);
  assert.equal(children.find(child=>child.text==='Sketch settings').y,24);
  assert.match(children.find(child=>child.text==='Sketch settings').font,/26px/);
});
