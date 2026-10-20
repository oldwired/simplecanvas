const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const plain=value=>JSON.parse(JSON.stringify(value));
const source=()=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples','memo.js'),'utf8'));
const defaults=c=>Object.fromEntries(Object.entries(c.inputs).map(([key,port])=>[key,port.default]));
const fields=state=>({text:state.text,lineCount:state.lineCount,scrollOffset:state.scrollOffset});
function operate(c,state,operation,payload){
  const before=JSON.stringify(state),next=c._operate(state,operation,payload);
  assert.equal(JSON.stringify(state),before,'commands never mutate the original state');
  assert.ok(JSON.stringify(next).length<=4000,'every result fits the host state budget');
  return next;
}

test('Memo log mode is opt-in and enabling it does not trim existing text until an Append',()=>{
  const c=source();
  assert.deepEqual(plain(c.settings.logMode),{type:'boolean',default:false,label:'Log mode'});
  assert.equal(c.initState().logMode,false);
  const original=operate(c,c.initState(),'set','one\ntwo\nthree');
  const configured={...original,maxLines:2,logMode:true,scrollOffset:4},before=JSON.stringify(configured);
  const primed=c.transition(defaults(c),configured,null,{now:0});
  assert.equal(JSON.stringify(configured),before);
  assert.deepEqual(fields(primed.state),fields(configured),'settings alone do not remove lines');
  assert.deepEqual(plain(c.publish(primed.state)),{text:'one\ntwo\nthree',lineCount:3});
  const appended=c.transition({...defaults(c),line:'four',append:true},primed.state,primed.memory,{now:1});
  assert.deepEqual(plain(c.publish(appended.state)),{text:'three\nfour',lineCount:2});
  assert.equal(appended.state.notice,'');
});

test('Log Append keeps the newest logical lines from normalized multiline blocks, including blank lines',()=>{
  const c=source();
  for(const [initial,maxLines,payload,expected,count] of [
    ['A\nB',3,'C\r\nD\rE','C\nD\nE',3],
    ['',3,'one\ntwo\nthree\nfour\n','three\nfour\n',3],
    ['a\nb',2,'','b\n',2],
    ['',1,'','',1],
    ['old',2,'\r\n\r','\n',2],
    ['',2,'\r\n','\n',2]
  ]){
    let state=operate(c,c.initState(),'set',initial);
    state={...state,logMode:true,maxLines};
    const result=c.onEvent('line',payload,state,{});
    assert.deepEqual(plain(c.publish(result.state)),{text:expected,lineCount:count});
    assert.equal(result.state.notice,'');
    assert.ok(JSON.stringify(result.state).length<=4000);
  }
  const oneBlank={...c.initState(),text:'',lineCount:1,maxLines:1,logMode:true,scrollOffset:0};
  assert.deepEqual(fields(operate(c,oneBlank,'append','')),{text:'',lineCount:1,scrollOffset:0});
});

test('Default Memo Append and every Set remain atomic when their blocks exceed the line limit',()=>{
  const c=source(),base={...operate(c,c.initState(),'set','one\ntwo'),maxLines:2,scrollOffset:4};
  const appended=operate(c,base,'append','three\nfour');
  assert.deepEqual(fields(appended),fields(base));assert.match(appended.notice,/Line limit reached/);
  const log={...base,logMode:true};
  const set=operate(c,log,'set','replacement\nhas\nthree');
  assert.deepEqual(fields(set),fields(log));assert.match(set.notice,/Line limit reached/);
  const cleared=operate(c,log,'clear');
  assert.deepEqual(fields(cleared),{text:'',lineCount:0,scrollOffset:-1});
  assert.equal(cleared.logMode,true);
});

test('Log Append checks character limits after eviction and rejects an oversized retained tail atomically',()=>{
  const c=source(),old='discarded old text\nkept';
  const base={...operate(c,c.initState(),'set',old),logMode:true,maxLines:2,maxLength:10,scrollOffset:old.indexOf('kept')};
  const accepted=operate(c,base,'append','new');
  assert.deepEqual(fields(accepted),{text:'kept\nnew',lineCount:2,scrollOffset:0});
  assert.equal(accepted.notice,'','discarded text does not count against the retained character budget');
  const rejected=operate(c,accepted,'append','too long for limit');
  assert.deepEqual(fields(rejected),fields(accepted),'failure does not leave the previously evicted candidate behind');
  assert.match(rejected.notice,/Character limit reached/);
  assert.deepEqual(plain(c.publish(rejected)),{text:'kept\nnew',lineCount:2});
});

test('Log Append checks escaped storage after eviction and leaves text and scroll intact on rejection',()=>{
  const c=source();let safe=0;
  while(safe<2000 && c._fits('\u0000'.repeat(safe+1)))safe++;
  assert.ok(safe>0 && safe<2000);
  const text='\u0000'.repeat(safe);
  const base={...operate(c,c.initState(),'set',text),logMode:true,maxLines:1,scrollOffset:3};
  const accepted=operate(c,base,'append',text);
  assert.deepEqual(fields(accepted),{text,lineCount:1,scrollOffset:0});
  assert.equal(accepted.notice,'','only the retained block consumes serialized storage');
  const rejected=operate(c,{...accepted,scrollOffset:3},'append',text+'\u0000');
  assert.deepEqual(fields(rejected),{text,lineCount:1,scrollOffset:3});
  assert.match(rejected.notice,/Storage limit reached/);
});

test('Log eviction anchors the same wrapped text through tabs and graphemes, clamping only evicted anchors',()=>{
  const c=source(),prefix='drop\t👨‍👩‍👧‍👦 extra discarded words\n',text=prefix+'retain a\u0308 🇩🇪\nlast';
  const expanded=text.replace(/\t/g,'    '),removed=prefix.replace(/\t/g,'    ').length;
  const base={...operate(c,c.initState(),'set',text),logMode:true,maxLines:3,scrollOffset:expanded.indexOf('retain')};
  const before=c._view(base.text,100,1,10,base.scrollOffset).lines[0];
  const next=operate(c,base,'append','newest');
  assert.equal(next.scrollOffset,base.scrollOffset-removed);
  assert.equal(c._view(next.text,100,1,10,next.scrollOffset).lines[0],before);
  assert.deepEqual(plain(c.publish(next)),{text:'retain a\u0308 🇩🇪\nlast\nnewest',lineCount:3});
  const evicted=operate(c,{...base,scrollOffset:3},'append','newest');
  assert.equal(evicted.scrollOffset,0);
  const following=operate(c,{...base,scrollOffset:-1},'append','newest');
  assert.equal(following.scrollOffset,-1);
  assert.equal(c._view(following.text,100,1,10,following.scrollOffset).lines.at(-1),'newest');
  const replaced=operate(c,next,'set','new text');
  assert.equal(replaced.scrollOffset,-1);
});
