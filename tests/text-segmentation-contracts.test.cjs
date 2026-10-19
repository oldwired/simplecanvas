const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const plain=value=>JSON.parse(JSON.stringify(value));
const source=(name,globals={})=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'),globals);
const family='👩‍👩‍👧‍👦',flag='🇩🇪',accent='e\u0301',clusters=[family,flag,accent];

test('Text extract ranges select complete visible characters, with explicit code-point indexing available',()=>{
  const def=source('text-extract'),state=def.initState(),text=clusters.join('');
  assert.equal(state.characterMode,'visible characters');
  assert.deepEqual(plain(def.settings.characterMode.options),['visible characters','code points']);
  for(const [start,expected] of clusters.entries())assert.deepEqual(plain(def.compute({text,start,length:1},state)),{text:expected,found:true});
  assert.deepEqual(plain(def.compute({text,start:3,length:1},state)),{text:'',found:true});
  assert.deepEqual(plain(def.compute({text,start:4,length:1},state)),{text:'',found:false});
  assert.deepEqual(plain(def.compute({text,start:1,length:2},state)),{text:flag+accent,found:true});
  const points=Array.from(text);
  for(const [start,expected] of points.entries())assert.deepEqual(plain(def.compute({text,start,length:1},{...state,characterMode:'code points'})),{text:expected,found:true});
  assert.throws(()=>def.compute({text,start:0,length:1},{...state,characterMode:'letters'}),/visible characters or code points/);
});

test('Text transform length measures graphemes after transformation without normalizing input',()=>{
  const def=source('text-transform'),state=def.initState(),text=clusters.join('');
  assert.equal(state.characterMode,'visible characters');
  assert.deepEqual(plain(def.settings.characterMode.options),['visible characters','code points']);
  assert.deepEqual(plain(def.compute({text:' '+text+' ',operation:'trim'},state)),{text,length:3,empty:false});
  assert.deepEqual(plain(def.compute({text,operation:'trim'},{...state,characterMode:'code points'})),{text,length:Array.from(text).length,empty:false});
  assert.deepEqual(plain(def.compute({text:'İ',operation:'lowercase'},state)),{text:'i\u0307',length:1,empty:false});
  assert.throws(()=>def.compute({text,operation:'trim'},{...state,characterMode:'letters'}),/visible characters or code points/);
});

test('Segmenter is an explicit capability for visible-character calculations; code-point and regex modes remain available without it',()=>{
  for(const globals of [{Intl:{}},{Intl:undefined}]){
    const extract=source('text-extract',globals),transform=source('text-transform',globals);
    assert.throws(()=>extract.compute({text:accent,start:0,length:1},extract.initState()),/Intl.Segmenter; choose code points/);
    assert.throws(()=>transform.compute({text:accent,operation:'trim'},transform.initState()),/Intl.Segmenter; choose code points/);
    assert.deepEqual(plain(extract.compute({text:accent,start:0,length:1},{...extract.initState(),characterMode:'code points'})),{text:'e',found:true});
    assert.deepEqual(plain(transform.compute({text:accent,operation:'trim'},{...transform.initState(),characterMode:'code points'})),{text:accent,length:2,empty:false});
    assert.deepEqual(plain(extract.compute({text:family,pattern:'.'},{...extract.initState(),mode:'regex match'})),{text:'👩',found:true});
  }
  const replace=source('text-replace');
  assert.deepEqual(plain(replace.compute({text:accent,search:'.',replacement:'x'},{...replace.initState(),mode:'regex'})),{text:'xx',count:2},'regex stays native Unicode code-point semantics');
});

const previewNames=['text-extract','text-transform','text-compare','text-compose','text-replace','text-selector','text-lookup','text-to-number','number-to-text'];
test('text processor previews clip only at visible-character boundaries',()=>{
  const text=clusters.join(''),prefixes=['',family,family+flag,text];
  for(const name of previewNames){
    const def=source(name);
    for(const width of [1,15,24,30,44,100]){
      const rendered=def._text(text,0,0,width,20,10,{}).text;
      assert.ok(prefixes.includes(rendered.replace(/…$/,'')),name+' split a visible character: '+JSON.stringify(rendered));
    }
    const fallback=source(name,{Intl:{}});
    assert.equal(fallback._text(text,0,0,1,20,10,{}).text,'…','unsupported preview never slices inside a cluster');
  }
});

test('text entry previews, label wrapping and memo wrapping preserve complete emoji and accents',()=>{
  const text=clusters.join(''),prefixes=['',family,family+flag,text],input=source('text-input');
  for(const width of [1,15,24,30,44,100])assert.ok(prefixes.includes(input._preview(text,width,10).replace(/…$/,'')));
  for(const name of ['text-label','memo']){
    const def=source(name),view=plain(def._view(text,1,500,10));
    assert.deepEqual(view.lines,clusters,name+' wraps each complete visible character');
    assert.equal(view.lines.join(''),text);
  }
  for(const name of ['text-input','text-label','memo']){
    const def=source(name),text=family.repeat(12),caption=def._caption(text,'Fallback',30,30,{fontSize:12}).text.replace(/\n/g,'').replace(/…$/,'');
    assert.equal(caption.length%family.length,0,name+' caption clips complete graphemes');
  }
});

test('Memo counts visible characters while configured storage and input limits remain UTF-16 units',()=>{
  const text=clusters.join(''),memo=source('memo'),state={...memo.initState(),text,lineCount:1,showCounts:true},style=memo.initStyle();
  const children=memo.children(state,style,style.w,style.h,false,{});
  assert.ok(children.some(child=>child.text==='1 line · 3 characters'));
  assert.equal(memo.publish(state).text,text);
  const input=source('text-input');
  assert.match(input.settings.maxLength.label,/UTF-16/);
  assert.match(memo.settings.maxLength.label,/UTF-16/);
  assert.throws(()=>input._entry(family,{...input.initState(),maxLength:1}),/maximum length/);
  for(const name of ['text-extract','text-transform']){
    const def=source(name),inputs=name==='text-extract'?{text:'😀'.repeat(1001),start:0,length:1}:{text:'😀'.repeat(1001),operation:'trim'};
    assert.throws(()=>def.compute(inputs,def.initState()),/at most 2000/);
  }
});
