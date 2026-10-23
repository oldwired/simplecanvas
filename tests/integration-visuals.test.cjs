const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const files=['http-source.js','http-post.js','mqtt-config.js','mqtt-subscribe.js','mqtt-publish.js'];
const defs=new Map(files.map(file=>[file,vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','examples',file),'utf8'),{Intl,Date})]));
const render=(file,io={},state={})=>{const def=defs.get(file),style=def.initStyle();return def.children({...def.initState(),...state},style,style.w,style.h,true,io);};
const texts=children=>children.filter(child=>child.type==='text').map(child=>child.text);
const base={name:'Custom instance',inputs:{url:'https://example.test/api/reading',topic:'devices/reading',path:'/value'},outputs:{status:'ready',available:true,value:37,lastUpdated:42}};

test('integration cards preserve names and bounded readable geometry at ordinary, wide and narrow aspect ratios',()=>{
  const states=[base,{...base,outputs:{status:'error',error:'The request could not finish because this endpoint is unavailable. Check its address and try again.',stale:true}},
    {...base,outputs:{status:'disabled'}},{...base,outputs:{status:'cancelled',error:'The pending operation was cancelled.'}},
    {...base,outputs:{status:'sending',loading:true}},{...base,inputs:{},outputs:{status:'idle'}}];
  for(const [file,def] of defs){const style=def.initStyle();for(const [w,h] of [[style.w,style.h],[style.w*1.5,style.h],[style.w*.7,style.h],[style.w,style.h*1.4]]){
    for(const showIndicators of [true,false])for(const io of states){const state={...def.initState(),showIndicators},children=def.children(state,style,w,h,true,io);
      assert.ok(texts(children).includes('Custom instance'),file+' keeps instance identity');
      for(const child of children){assert.ok(child.x>=0 && child.y>=0 && child.x+child.w<=w+.001 && child.y+child.h<=h+.001,file+' keeps all display primitives in its bounds');}
      const labels=children.filter(child=>child.type==='text');
      for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
        const a=labels[i],b=labels[j],overlap=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>.01&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>.01;
        assert.equal(overlap,false,file+' text regions do not overlap: '+a.text+' / '+b.text);
      }
      for(const handle of def.handles?.(state,w,h)||[])assert.equal(def.hitEdit(state,handle.x,handle.y,w,h),handle.id,file+' button centers remain interactive');
    }
  }}
});

test('an unconfigured Subscribe is neutral setup guidance, while configured errors remain visible with details hidden',()=>{
  const def=defs.get('mqtt-subscribe.js'),setup=render('mqtt-subscribe.js',{inputs:{topic:''},outputs:{status:'error',error:'Use a topic or filter with + as a whole level and # only as its final level'}},{showIndicators:false});
  assert.ok(texts(setup).includes('Set up subscription'));assert.equal(setup.some(child=>child.type==='text'&&child.color==='#b91c1c'),false);
  for(const file of files){const children=render(file,{...base,outputs:{status:'error',error:'The endpoint could not be reached. Check the address and credentials before trying again.'}},{showIndicators:false});
    const errors=children.filter(child=>child.type==='text'&&child.color==='#b91c1c'&&child.y>=80);
    assert.equal(errors.length,2,file+' keeps two lines of actionable errors even when optional details are hidden');
    assert.ok(errors.every(child=>child.textColor==='#b91c1c'),file+' overrides inherited parent text color for errors in editor and HTML');
    assert.match(errors.map(child=>child.text).join(' '),/endpoint could not be reached/);
  }
});

test('integration operation states are explained independently of raw transport status keys',()=>{
  for(const file of files)assert.ok(texts(render(file,{...base,outputs:{status:'disabled'}})).includes('Network disabled'),file+' exposes disabled network execution');
  assert.ok(texts(render('mqtt-subscribe.js',{...base,outputs:{status:'suspended',stale:true}})).includes('Connection paused'));
  assert.ok(texts(render('mqtt-subscribe.js',{...base,outputs:{status:'disconnected'}})).includes('Disconnected'));
  assert.ok(texts(render('mqtt-subscribe.js',{...base,outputs:{status:'disconnected',stale:true}})).includes('Reading is stale'));
  assert.ok(texts(render('mqtt-publish.js',{...base,outputs:{status:'cancelled',error:'Cancelled before acknowledgement'}})).includes('Send cancelled'));
  for(const file of ['http-source.js','http-post.js'])assert.ok(texts(render(file,{...base,outputs:{status:'error',httpStatus:200,error:'The JSON pointer does not match a number'}})).includes('Response error'));
  const emptyPost=render('http-post.js',{...base,outputs:{status:'ready',available:false,httpStatus:204}});
  assert.ok(texts(emptyPost).includes('Sent'));assert.ok(emptyPost.some(child=>child.type==='ellipse'&&child.fillColor==='#15803d'),'an empty successful HTTP response has a success indicator');
});

test('credentials and connection actions have explicit readable labels and match their real actions',()=>{
  for(const file of ['http-source.js','http-post.js','mqtt-config.js'])assert.ok(texts(render(file,base)).includes('Credentials…'),file+' labels the credential dialog accurately');
  const config=io=>render('mqtt-config.js',{...base,outputs:{status:'connected',connected:true},...io});
  for(const [io,label] of [[{outputs:{status:'disconnected'}},'Connect'],[{},'Reconnect'],[{source:{pending:true}},'Apply'],[{outputs:{status:'reconnecting'}},'Retry']]){
    const button=config(io).find(child=>child.type==='text'&&child.text===label);assert.ok(button);assert.ok(parseFloat(button.font.match(/([\d.]+)px/)[1])>=12);
  }
  const controls=config({}).filter(child=>child.type==='rect'&&child.y>100);
  assert.equal(controls.length,3);assert.ok(controls.every(child=>child.h===40),'connection controls have consistent 40px targets');
  assert.ok(texts(render('http-post.js',{...base,outputs:{status:'loading',loading:true}})).includes('Sending…'));
  assert.ok(texts(render('mqtt-publish.js',{...base,outputs:{status:'sending',loading:true}})).includes('Sending…'));
  assert.ok(texts(render('http-source.js',{...base,outputs:{status:'loading',loading:true}})).includes('Refresh again'));
});
