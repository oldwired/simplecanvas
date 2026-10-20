const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const plain=value=>JSON.parse(JSON.stringify(value));
const source=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',name+'.js'),'utf8'),{});
function memo(initial){
  const component=source('memo');
  let state=initial?plain(initial):component.initState(),memory=null;
  let inputs=Object.fromEntries(Object.entries(component.inputs).map(([key,port])=>[key,port.default]));
  return {
    component,
    step(patch={}){
      inputs={...inputs,...patch};const before=JSON.stringify({state,memory,inputs});
      const next=component.transition(inputs,state,memory,{now:0});
      assert.equal(JSON.stringify({state,memory,inputs}),before,'transition leaves inputs, state and memory unchanged');
      assert.equal(next.nextWakeAt,null);assert.ok(JSON.stringify(next.state).length<=4000);assert.ok(JSON.stringify(next.memory).length<=4000);
      state=next.state;memory=next.memory;return plain(component.publish(state));
    },
    pulse(key,patch={}){this.step({[key]:false});return this.step({...patch,[key]:true});},
    edit(patch){state={...state,...patch};},
    restore(){state=plain(state);memory=null;},
    children(extra={}){
      const style=component.initStyle();
      return plain(component.children(state,style,style.w,style.h,false,{inputs,outputs:component.publish(state),name:'Session notes',...extra}));
    },
    get output(){const before=JSON.stringify(state),output=plain(component.publish(state));assert.equal(JSON.stringify(state),before);return output;},
    get state(){return plain(state);},
    get memory(){return plain(memory);}
  };
}

test('Text Label and Memo declare string ports, explicit trigger inputs, and bounded settings',()=>{
  const label=source('text-label'),r=memo();
  assert.equal(label.apiVersion,2);assert.equal(r.component.apiVersion,2);
  assert.deepEqual(plain(label.inputs),{value:{type:'string',default:''}});assert.deepEqual(plain(label.outputs),{value:{type:'string'}});
  assert.deepEqual(plain(label.initState()),{showName:false,showHints:false});
  assert.deepEqual(plain(r.component.inputs),{
    content:{type:'string',default:'',event:true},line:{type:'string',default:'',event:true},
    set:{role:'control',type:'boolean',default:false},append:{role:'control',type:'boolean',default:false},clear:{role:'control',type:'boolean',default:false,event:'command'},
    showScrollbar:{role:'control',type:'boolean',default:false,label:'Show scrollbar'}
  });
  assert.deepEqual(plain(r.component.outputs),{text:{type:'string'},lineCount:{type:'number'}});
  assert.deepEqual(r.state,{text:'',lineCount:0,notice:'',maxLines:100,maxLength:2000,showCounts:false,showHints:false,logMode:false,scrollOffset:-1});
  assert.equal(r.component.settings.showScrollbar,undefined,'Show scrollbar is one literal-or-connected input, not a duplicate setting');
  for(const [key,maximum,defaultValue]of [['maxLines',1000,100],['maxLength',2000,2000]]){
    const setting=r.component.settings[key];
    assert.equal(setting.type,'number');assert.equal(setting.default,defaultValue);assert.equal(setting.min,1);assert.equal(setting.max,maximum);assert.equal(setting.step,1);
  }
});

test('Text Label passes exact strings, including blanks, Unicode and Markdown-looking text',()=>{
  const c=source('text-label');
  for(const value of ['', ' ', '---\n# title\n**literal**', 'ä🎈\r\nhello\tworld', 'x'.repeat(2000)]){
    const inputs={value},before=JSON.stringify(inputs);
    assert.deepEqual(plain(c.compute(inputs)),{value});assert.equal(JSON.stringify(inputs),before);
  }
  for(const value of [undefined,null,false,123,'x'.repeat(2001)])assert.throws(()=>c.compute({value}),/string of at most 2000/);
});

test('Text Label is plain literal text with optional name and hints, while blank exports stay blank',()=>{
  const c=source('text-label'),style=c.initStyle(),draw=(value,error,state=c.initState(),editing=false)=>plain(c.children(state,style,style.w,style.h,editing,{name:'Latest message',outputs:{value},error}));
  assert.equal(style.w,280);assert.equal(style.h,64);assert.equal(style.fill,false);assert.equal(style.strokeOn,false);
  const blank=draw('');assert.deepEqual(blank,[]);
  assert.deepEqual(draw('',null,c.initState(),true),[],'editing mode cannot leak hints into an interactive reader');
  assert.ok(draw(undefined).some(item=>item.text==='Input unavailable'));
  assert.ok(draw('stale','Source missing').some(item=>item.text==='Input unavailable'));
  const value='---\n'+Array.from({length:30},(_,i)=>'Line '+i).join('\n'),visible=draw(value);
  assert.ok(!visible.some(item=>item.text==='Latest message'));assert.ok(visible.some(item=>item.text==='---'));
  assert.ok(visible.every(item=>item.type==='text' && item.plainText===true));
  assert.ok(!visible.some(item=>item.text==='More text in output…'));
  const detailed=draw(value,null,{showName:true,showHints:true});
  assert.ok(detailed.some(item=>item.text==='Latest message'));assert.ok(detailed.some(item=>item.text==='More text in output…'));
  assert.ok(draw('',null,{showHints:true}).some(item=>item.text==='Empty text'));
  assert.equal(c.compute({value}).value,value,'preview truncation never affects the output');
  assert.ok(c._view('A long sentence with words that wrap onto additional rows',90,100,16).lines.length>1);
  const styled=c.children({}, {...style,fontSize:22,font:'italic 22px serif'},280,64,false,{outputs:{value:'Custom style'}});
  assert.equal(styled[0].font,'italic 22px serif');
});

test('Memo first observation primes all triggers and never replays an initially high command',()=>{
  const r=memo();
  assert.deepEqual(r.step({set:true,append:true,clear:true,content:'replace',line:'append'}),{text:'',lineCount:0});
  assert.deepEqual(r.memory,{set:true,append:true,clear:true});
  assert.deepEqual(r.step({content:'changed',line:'changed'}),{text:'',lineCount:0});
  r.step({set:false,append:false,clear:false});
  assert.deepEqual(r.step({append:true,line:'first'}),{text:'first',lineCount:1});
});

test('Memo only edits on rising edges and appends identical strings for distinct pulses',()=>{
  const r=memo();r.step();
  assert.deepEqual(r.step({content:'unused',line:'same'}),{text:'',lineCount:0});
  assert.deepEqual(r.step({append:true}),{text:'same',lineCount:1});
  assert.deepEqual(r.step({line:'different',content:'still unused'}),{text:'same',lineCount:1});
  assert.deepEqual(r.pulse('append',{line:'same'}),{text:'same\nsame',lineCount:2});
  assert.deepEqual(r.pulse('append',{line:'same'}),{text:'same\nsame\nsame',lineCount:3});
  assert.deepEqual(r.output,{text:'same\nsame\nsame',lineCount:3});
});

test('Set replaces, Append adds a complete normalized block, and Clear empties the memo',()=>{
  const r=memo();r.step();
  assert.deepEqual(r.pulse('set',{content:'one\r\ntwo\rthree\n'}),{text:'one\ntwo\nthree\n',lineCount:4});
  assert.deepEqual(r.pulse('append',{line:'four\r\nfive'}),{text:'one\ntwo\nthree\n\nfour\nfive',lineCount:6});
  assert.deepEqual(r.pulse('set',{content:'replacement'}),{text:'replacement',lineCount:1});
  assert.deepEqual(r.pulse('clear'),{text:'',lineCount:0});
  assert.equal(r.state.notice,'');
});

test('simultaneous command edges use Clear then Set then Append priority',()=>{
  const r=memo();r.step();r.pulse('append',{line:'old'});r.step({append:false});
  assert.deepEqual(r.step({set:true,append:true,clear:true,content:'new',line:'line'}),{text:'',lineCount:0});
  assert.deepEqual(r.step({clear:false}),{text:'',lineCount:0},'consumed lower-priority edges do not replay later');
  r.step({set:false,append:false});
  assert.deepEqual(r.step({set:true,append:true}),{text:'new',lineCount:1});
  r.step({set:false,append:false,clear:true});
  assert.deepEqual(r.step({append:true,line:'after clear'}),{text:'after clear',lineCount:1},'held Clear does not suppress a later Append edge');
});

test('empty storage, explicit blank lines, and trailing newlines have distinct logical counts',()=>{
  const r=memo();r.step();
  assert.deepEqual(r.pulse('append',{line:''}),{text:'',lineCount:1});
  assert.ok(!r.children().some(item=>item.text==='Empty memo'),'one blank line is not empty storage');
  assert.deepEqual(r.pulse('append',{line:''}),{text:'\n',lineCount:2});
  assert.deepEqual(r.pulse('append',{line:'last\n'}),{text:'\n\nlast\n',lineCount:4});
  assert.deepEqual(r.pulse('set',{content:''}),{text:'',lineCount:0});
  assert.ok(!r.children().some(item=>item.text==='Empty memo'));r.edit({showHints:true});assert.ok(r.children().some(item=>item.text==='Empty memo'));
  assert.deepEqual(r.pulse('set',{content:'\n'}),{text:'\n',lineCount:2});
});

test('restoring state retains full text and primes a high trigger without duplication or clearing',()=>{
  const r=memo();r.step();r.pulse('append',{line:'saved'});const saved=r.state;
  r.restore();assert.deepEqual(r.step({append:true}),{text:'saved',lineCount:1});assert.deepEqual(r.state,saved);
  assert.deepEqual(r.pulse('append',{line:'saved'}),{text:'saved\nsaved',lineCount:2});
  for(const trigger of ['set','append','clear']){
    const restored=memo(r.state);
    assert.deepEqual(restored.step({[trigger]:true,content:'replacement',line:'extra'}),r.output);
  }
  const blank=memo({...saved,text:'',lineCount:1});
  assert.deepEqual(blank.step({append:true}),{text:'',lineCount:1},'the explicit empty line survives JSON persistence');
});

test('character limits reject the entire edit, consume the pulse, and allow a later valid replacement',()=>{
  const r=memo();r.edit({maxLength:5});r.step();
  assert.deepEqual(r.pulse('set',{content:'abcde'}),{text:'abcde',lineCount:1});
  assert.deepEqual(r.pulse('append',{line:''}),{text:'abcde',lineCount:1});assert.match(r.state.notice,/Character limit reached \(5\)/);
  assert.equal(r.memory.append,true);assert.equal(r.step({line:'x'}).text,'abcde');
  assert.deepEqual(r.pulse('set',{content:'replacement'}),{text:'abcde',lineCount:1});
  assert.deepEqual(r.pulse('set',{content:'ok'}),{text:'ok',lineCount:1});assert.equal(r.state.notice,'');
});

test('line limits count logical lines rather than visual wrapping and preserve rejected blocks',()=>{
  const r=memo();r.edit({maxLines:2});r.step();
  const wide='word '.repeat(100);
  assert.deepEqual(r.pulse('set',{content:wide}),{text:wide,lineCount:1});
  assert.deepEqual(r.pulse('append',{line:'second'}),{text:wide+'\nsecond',lineCount:2});
  assert.deepEqual(r.pulse('append',{line:'third\nfourth'}),{text:wide+'\nsecond',lineCount:2});assert.match(r.state.notice,/Line limit reached \(2\)/);
  assert.deepEqual(r.pulse('clear'),{text:'',lineCount:0});assert.equal(r.state.notice,'');
});

test('storage limits count JSON escapes and reserve room to report a rejected edit safely',()=>{
  const r=memo();r.step();
  let safe=0;while(r.component._fits('\u0000'.repeat(safe+1)))safe++;
  assert.ok(safe>0 && safe<2000,'control-character escapes exhaust JSON before the string port limit');
  const text='\u0000'.repeat(safe);
  assert.deepEqual(r.pulse('set',{content:text}),{text,lineCount:1});
  assert.deepEqual(r.pulse('set',{content:text+'\u0000'}),{text,lineCount:1});assert.match(r.state.notice,/Storage limit reached/);
  assert.ok(JSON.stringify(r.state).length<=4000);
  assert.deepEqual(r.pulse('append',{line:'\u0000'}),{text,lineCount:1});assert.ok(JSON.stringify(r.state).length<=4000);
  r.edit({maxLines:1000});r.step();assert.ok(JSON.stringify(r.state).length<=4000,'later larger settings fit the reserved budget');
  assert.equal(r.output.text,text);
  assert.deepEqual(r.pulse('clear'),{text:'',lineCount:0});
});

test('plain 2000-character text fits while escaped quotes and Unicode use their actual serialized size',()=>{
  const r=memo();r.step();const maximum='x'.repeat(2000);
  assert.deepEqual(r.pulse('set',{content:maximum}),{text:maximum,lineCount:1});
  assert.deepEqual(r.pulse('set',{content:'"'.repeat(2000)}),{text:maximum,lineCount:1});assert.match(r.state.notice,/Storage limit reached/);
  const emoji='🎈'.repeat(1000);
  assert.deepEqual(r.pulse('set',{content:emoji}),{text:emoji,lineCount:1});assert.equal(r.state.notice,'');
  assert.ok(JSON.stringify(r.state).length<=4000);
});

test('reducing settings retains stored text, warns, and lets Clear or a smaller Set recover',()=>{
  const r=memo();r.step();r.pulse('set',{content:'one\ntwo'});r.edit({maxLines:1,maxLength:3});
  assert.deepEqual(r.output,{text:'one\ntwo',lineCount:2},'publishing never truncates existing text after a setting change');
  assert.deepEqual(r.step(),{text:'one\ntwo',lineCount:2});assert.match(r.state.notice,/configured limit/);
  r.edit({maxLines:2,maxLength:7});r.step();assert.equal(r.state.notice,'');
  r.edit({maxLines:1,maxLength:3});r.step();
  assert.deepEqual(r.pulse('set',{content:'ok'}),{text:'ok',lineCount:1});assert.equal(r.state.notice,'');
  r.edit({maxLength:1});r.step();assert.deepEqual(r.pulse('clear'),{text:'',lineCount:0});
});

test('Memo publication needs no current inputs and rendering retains the tail when an input is unavailable',()=>{
  const r=memo();r.edit({showCounts:true,showHints:true});r.step();const value=Array.from({length:30},(_,i)=>i===29?'---':'Line '+i).join('\n');r.pulse('set',{content:value});
  assert.deepEqual(r.output,{text:value,lineCount:30});
  const children=r.children();assert.ok(children.some(item=>item.text==='Session notes'));assert.ok(children.some(item=>item.text==='---'));
  assert.ok(!children.some(item=>item.text==='Line 0'));assert.ok(children.some(item=>(item.text||'').includes('Showing latest text')));
  assert.ok(children.some(item=>/30 lines/.test(item.text||'')));assert.ok(children.filter(item=>item.type==='text').every(item=>item.plainText===true));
  const unavailable=r.children({error:'Disconnected input',inputs:{},outputs:{}});
  assert.ok(unavailable.some(item=>item.text==='---'));assert.match(unavailable.filter(item=>item.type==='text').map(item=>item.text).join(' '),/Input unavailable/);
  assert.deepEqual(r.output,{text:value,lineCount:30});
});

test('invalid input types, settings, or stored counts fail explicitly instead of coercing or discarding text',()=>{
  const c=source('memo'),state=c.initState(),defaults=Object.fromEntries(Object.entries(c.inputs).map(([key,port])=>[key,port.default]));
  for(const key of ['set','append','clear','showScrollbar'])for(const value of [0,1,'true','X',null])assert.throws(()=>c.transition({...defaults,[key]:value},state,null),/Boolean/);
  for(const key of ['content','line'])for(const value of [42,false,null,'x'.repeat(2001)])assert.throws(()=>c.transition({...defaults,[key]:value},state,null),/string of at most 2000/);
  for(const patch of [{maxLines:0},{maxLines:1001},{maxLines:1.5},{maxLength:0},{maxLength:2001},{maxLength:1.5},
    {text:'abc',lineCount:0},{text:'abc\nxyz',lineCount:1},{text:'',lineCount:2},{text:'a\rb',lineCount:1}])assert.throws(()=>c.publish({...state,...patch}));
  assert.deepEqual(plain(c.publish(state)),{text:'',lineCount:0});
});

test('Memo gives stored text most of its area and only reserves optional footer space on request',()=>{
  const r=memo();r.step();r.pulse('set',{content:Array.from({length:30},(_,i)=>'Line '+i).join('\n')});
  const defaultChildren=r.children(),defaultLines=defaultChildren.filter(item=>/^Line /.test(item.text||''));
  assert.equal(defaultChildren.filter(item=>item.type==='rect').length,1,'one border, no inset panel');
  assert.ok(defaultLines.length>=11,'compact header and padding leave room for text');
  assert.ok(defaultLines.every(item=>item.x===8 && item.w===344));
  assert.ok(!defaultChildren.some(item=>/characters|Showing latest|30 lines/.test(item.text||'')));
  r.edit({showCounts:true,showHints:true});const withFooter=r.children();
  assert.ok(withFooter.some(item=>/30 lines/.test(item.text||'')));
  assert.ok(withFooter.filter(item=>/^Line /.test(item.text||'')).length<defaultLines.length);
  r.edit({showCounts:false,showHints:false,maxLength:1});r.step();
  assert.ok(r.children().some(item=>/configured limit/.test(item.text||'')),'actual errors stay visible with all hints disabled');
});

test('Memo optional scrollbar reveals earlier wrapped text without changing contents or emitting events',()=>{
  const c=source('memo'),style=c.initStyle(),text=Array.from({length:40},(_,i)=>'Line '+i).join('\n'),io={inputs:{showScrollbar:true}};
  let state=c._operate(c.initState(),'set',text);
  assert.deepEqual(plain(c.handles(state,style.w,style.h,style)),[]);
  assert.equal(c._layout(state,style,style.w,style.h).scrollbar,null);
  const before=JSON.stringify(state),layout=c._layout(state,style,style.w,style.h,io),bar=layout.scrollbar;
  assert.ok(bar);assert.ok(layout.bodyWidth<layout.width);
  assert.ok(layout.view.lines.includes('Line 39'));
  assert.deepEqual(plain(c.handles(state,style.w,style.h,style,io)),[{id:'scroll',x:bar.x+bar.w/2,y:bar.thumbY+bar.thumbH/2}]);
  assert.equal(c.hitEdit(state,bar.x+bar.w/2,bar.y,style.w,style.h,style,io),'scroll');
  assert.equal(c.hitEdit(state,8,bar.y,style.w,style.h,style,io),null);
  const result=c.dragEdit(state,'scroll',bar.x+bar.w/2,bar.y,style.w,style.h,style,io);
  assert.deepEqual(Object.keys(result),['state'],'scrolling cannot emit events');
  assert.equal(JSON.stringify(state),before,'scrolling does not mutate the original state');
  assert.equal(result.state.scrollOffset,0);assert.deepEqual(plain(c.publish(result.state)),{text,lineCount:40});
  const atTop=c._layout(result.state,style,style.w,style.h,io);
  assert.equal(atTop.view.lines[0],'Line 0');assert.equal(atTop.scrollbar.thumbY,atTop.scrollbar.y);
  assert.ok(!atTop.view.lines.includes('Line 39'));
  assert.deepEqual(plain(c.publish(c.dragEdit(state,'unknown',0,0,style.w,style.h,style,io).state)),{text,lineCount:40});
  const short=c.initState();
  assert.deepEqual(plain(c.handles(short,style.w,style.h,style,io)),[],'no inactive scrollbar when all text fits');
});

test('Memo follows the tail, preserves earlier reading positions on append, and resets on Set or Clear',()=>{
  const c=source('memo'),style=c.initStyle(),text=Array.from({length:40},(_,i)=>'Line '+i).join('\n'),io={inputs:{showScrollbar:true}};
  const tail=c._operate(c.initState(),'set',text);
  const first=c._layout(tail,style,style.w,style.h,io),bar=first.scrollbar;
  const middle=c.dragEdit(tail,'scroll',bar.x,bar.y+bar.h*.25,style.w,style.h,style,io).state;
  assert.ok(middle.scrollOffset>0 && middle.scrollOffset<first.view.offsets[first.view.maxStart]);
  const oldTop=c._layout(middle,style,style.w,style.h,io).view.lines[0];
  const appended=c.onEvent('line','Newest line',middle,{}).state;
  assert.equal(appended.scrollOffset,middle.scrollOffset);
  assert.equal(c._layout(appended,style,style.w,style.h,io).view.lines[0],oldTop);
  const latest=c.onEvent('line','Newest line',tail,{}).state;
  assert.equal(latest.scrollOffset,-1);assert.equal(c._layout(latest,style,style.w,style.h,io).view.lines.at(-1),'Newest line');
  const end=c.dragEdit(appended,'scroll',bar.x,bar.y+bar.h,style.w,style.h,style,io).state;
  assert.equal(end.scrollOffset,-1,'dragging to the end restores automatic tail-follow');
  assert.equal(c._layout(c._operate(end,'append','Another line'),style,style.w,style.h,io).view.lines.at(-1),'Another line');
  for(const operation of ['set','clear'])assert.equal(c._operate(middle,operation,'Replacement').scrollOffset,-1);
  const rejected=c._operate({...middle,maxLength:1},'set','Rejected');
  assert.equal(rejected.scrollOffset,middle.scrollOffset,'a rejected command preserves the reading position');
});

test('Memo Show scrollbar control changes only presentation and retains the reading position',()=>{
  const r=memo();r.step();r.pulse('set',{content:Array.from({length:40},(_,i)=>'Line '+i).join('\n')});
  r.edit({scrollOffset:21});const before=r.output,style=r.component.initStyle();
  const view=showScrollbar=>r.component._layout(r.state,style,style.w,style.h,{inputs:{showScrollbar}});
  for(const value of [true,false,true]){
    assert.deepEqual(r.step({showScrollbar:value}),before);
    assert.equal(r.state.scrollOffset,21);assert.equal(Boolean(view(value).scrollbar),value);
  }
  assert.equal(view(true).view.lines[0],'Line 3');
  assert.equal(view(false).view.lines.at(-1),'Line 39');
  assert.ok(!Object.hasOwn(r.state,'showScrollbar'),'presentation control is not mirrored into component state');
});

test('Memo scrollbar geometry clamps after resizing and wrapping keeps whole graphemes',()=>{
  const c=source('memo'),style=c.initStyle(),graphemes=['👨‍👩‍👧‍👦','a\u0308','🇩🇪'],io={inputs:{showScrollbar:true}};
  const text=Array.from({length:30},()=>graphemes.join('')).join('\n');
  let state={...c._operate(c.initState(),'set',text),scrollOffset:8000};
  for(const [w,h] of [[360,280],[180,140],[720,900],[12,12]]){
    const before=JSON.stringify(state),L=c._layout(state,style,w,h,io);
    assert.equal(L.view.start,L.view.maxStart);assert.equal(JSON.stringify(state),before);
    if(L.scrollbar){
      const b=L.scrollbar;
      assert.ok(b.thumbY>=b.y && b.thumbY+b.thumbH<=b.y+b.h+1e-9);
      assert.ok(b.x>=0 && b.x+b.w<=w);
    }
    assert.ok(L.view.lines.every(line=>c._graphemes(line).every(value=>graphemes.includes(value))),'wrapping does not split emoji or combining marks');
  }
  const hiddenIo={inputs:{showScrollbar:false}};
  assert.equal(c._layout(state,style,360,280,hiddenIo).scrollbar,null);
  assert.deepEqual(plain(c.handles(state,360,280,style,hiddenIo)),[]);
  for(const scrollOffset of [-2,0.5,Infinity,8001,'0'])assert.throws(()=>c.publish({...state,scrollOffset}),/scroll position/);
});

test('Memo reserves scrollbar fields within the escaped-text storage limit',()=>{
  const c=source('memo'),style=c.initStyle(),io={inputs:{showScrollbar:true}};
  let safe=0;while(c._fits('\u0000'.repeat(safe+1)))safe++;
  const text='\u0000'.repeat(safe),state={...c._operate(c.initState(),'set',text),scrollOffset:8000,showCounts:true,showHints:true,maxLines:1000};
  const rejected=c._operate(state,'append','\u0000');
  assert.match(rejected.notice,/Storage limit reached/);assert.ok(JSON.stringify(rejected).length<=4000);
  const L=c._layout(rejected,style,80,140,io);
  const result=c.dragEdit(rejected,'scroll',L.scrollbar.x,L.scrollbar.y,80,140,style,io);
  assert.ok(JSON.stringify(result.state).length<=4000);
  assert.deepEqual(plain(c.publish(result.state)),{text,lineCount:1});
});

test('Text Label honors optional outline and fill styles while keeping plain text as the default',()=>{
  const c=source('text-label'),base=c.initStyle(),state=c.initState(),io={outputs:{value:'Outlined label'},name:'Optional caption'};
  assert.ok(c.children(state,base,base.w,base.h,false,io).every(item=>item.type==='text'));
  for(const [dash,size,color] of [['solid',1,'#ef4444'],['tight',4,'#16a34a'],['wide',8,'#2563eb']]){
    const style={...base,strokeOn:true,dash,size,color},children=plain(c.children(state,style,base.w,base.h,false,io));
    assert.deepEqual(children[0],{type:'rect',x:0,y:0,w:base.w,h:base.h,strokeOn:true,color,size,dash,fill:false,fillColor:'#ffffff'});
    const value=children.find(item=>item.type==='text');assert.equal(value.x,4+size/2);assert.equal(value.y,4+size/2);
    assert.equal(value.w,base.w-(4+size/2)*2);assert.equal(value.color,base.textColor,'outline color does not replace the selected text color');
  }
  const fillOnly=plain(c.children(state,{...base,fill:true,fillColor:'#fef08a'},base.w,base.h,false,io));
  assert.equal(fillOnly[0].fill,true);assert.equal(fillOnly[0].fillColor,'#fef08a');assert.equal(fillOnly[0].strokeOn,false);assert.equal(fillOnly[1].x,4);
  const detailed=plain(c.children({showName:true,showHints:true},{...base,strokeOn:true,size:4},base.w,base.h,false,{...io,outputs:{value:'long '.repeat(100)}}));
  assert.ok(detailed.filter(item=>item.type==='text').every(item=>item.x===6 && item.w===base.w-12),'name, content, and hints use the same inner bounds');
  const hint=detailed.find(item=>item.text==='More text in output…');assert.ok(hint.y+hint.h<=base.h-6);
  const body=detailed.filter(item=>item.type==='text' && item!==hint && item.text!=='Optional caption');assert.ok(body.every(item=>item.y+item.h<=hint.y),'wrapped text stays above its hint footer');
});
