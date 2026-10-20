// Build a separate small application example, then export it through SimpleCanvas itself.
// Run: node tools/update-workspace-runtime-example.cjs
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {exportWorkspaceReader}=require('./update-example-workspace.cjs');
const root=path.join(__dirname,'..');
const copy=value=>JSON.parse(JSON.stringify(value));

function buildWorkspaceRuntimeExample({root:directory=root}={}){
  const scripts=new Map();
  function component(file,uid,name,x,y,options={}){
    if(!scripts.has(file)){
      const source=fs.readFileSync(path.join(directory,'examples',file),'utf8');
      const definition=vm.runInNewContext(source,{Intl,Date,Math},{timeout:1000});
      scripts.set(file,{source,definition});
    }
    const {source,definition}=scripts.get(file),state={...copy(definition.initState?.()||{}),...options.state};
    const style={w:280,h:100,fontSize:16,...copy(definition.initStyle?.()||{})};
    const ports=typeof definition.inputs==='function'?definition.inputs(state):definition.inputs||{};
    const values=Object.fromEntries(Object.entries(ports).filter(([,port])=>Object.hasOwn(port,'default')).map(([name,port])=>[name,copy(port.default)]));
    const result={type:'smart',uid,componentApi:2,componentName:name,x,y,color:'#64748b',size:1.5,fill:true,fillColor:'#ffffff',
      strokeOn:true,textColor:'#334155',fontFamily:'sans',fontSize:16,font:'16px sans-serif',...style,
      state,script:source,inputValues:{...values,...options.inputValues},...options};
    result.state=state;
    result.inputValues={...values,...options.inputValues};
    if(definition.datasetOwner)result.datasetOwner=definition.datasetOwner;
    if(definition.pageSettings)result.pageSettings=true;
    if(definition.workspaceSettings)result.workspaceSettings=true;
    if(definition.workspaceEndpoint){
      const endpoint=typeof definition.workspaceEndpoint==='function'?definition.workspaceEndpoint(state):definition.workspaceEndpoint;
      if(endpoint?.direction)result.workspaceEndpoint=endpoint.direction;
    }
    return result;
  }
  const text=(uid,value,x,y,w=1220,h=48,size=18)=>({type:'text',uid,text:value,x,y,w,h,size:1,color:'#334155',textColor:'#334155',
    fontFamily:'sans',fontSize:size,font:`${size}px sans-serif`,align:'left',strokeOn:false,fill:false,fillColor:'#ffffff'});
  const connect=(uid,port='value')=>({uid,port});
  const shared={datasetId:'workspace-stock',sketchId:'runtime-services'};
  const stock={name:'Fruit stock',columns:[{key:'fruit',name:'Fruit',type:'string'},{key:'quantity',name:'Quantity',type:'number'}],
    rows:[['Apples',12],['Oranges',8]]};
  const scratch={name:'Private scratch',columns:[{key:'note',name:'Note',type:'string'}],rows:[['Only offered in Services']]};
  const services=[
    text('runtime-services-title','Services · shared processing',40,24,1240,44,28),
    text('runtime-services-help','Hidden from the reader’s tab bar, but still running. Go to tab and ?page=0 can open this sketch.',40,76),
    component('workspace-settings.js','runtime-settings','Workspace defaults',40,146,{
      state:{executionMode:'whole workspace',initialSketchId:'runtime-dashboard',
        tabVisibility:[{sketchId:'runtime-services',visible:false},{sketchId:'runtime-dashboard',visible:true},{sketchId:'runtime-editor',visible:true}]},
      inputValues:{title:'Fruit stock · Workspace example',showTabs:true,showWiring:false,showSimulationControls:true},
    }),
    component('live-clock.js','runtime-clock','UTC clock',444,146,{w:190,h:260,inputValues:{timezone:'UTC'},state:{showIndicators:false}}),
    component('publish.js','runtime-publish-time','Publish time',740,146,{
      w:350,h:150,state:{endpoints:[
        {id:'value',name:'UTC time',type:'string',description:'The shared clock keeps advancing while Services is hidden.'},
        {id:'tick',name:'Second tick',type:'boolean',description:'A short signal at each new second.'},
      ]},
      bindings:{value:connect('runtime-clock','time'),tick:connect('runtime-clock','second')},
    }),
    component('data-source.js','runtime-stock-owner','Fruit stock · shared',40,390,{
      datasetShared:true,inputValues:{data:{datasetId:'workspace-stock'}},state:{allowReaderImport:true,allowReaderColumnChanges:false},
    }),
    component('data-source.js','runtime-private-owner','Private scratch · local',400,440,{
      datasetShared:false,inputValues:{data:{datasetId:'workspace-scratch'}},
    }),
    component('capture-row.js','runtime-capture','Capture submitted fruit',900,390,{
      state:{fields:'fruit:string\nquantity:number',allowReaderCapture:true},
      inputValues:{data:{datasetId:'workspace-stock'}},
      bindings:{field0:connect('runtime-receive-message'),field1:connect('runtime-receive-message','quantity')},
      eventBindings:{capture:connect('runtime-receive-message')},
    }),
    component('receive.js','runtime-receive-message','Receive submissions',40,620,{
      w:330,h:160,state:{endpoints:[
        {id:'value',name:'Fruit submitted',type:'string',description:'Each submission requests one captured row.'},
        {id:'quantity',name:'Quantity',type:'number',description:'Sampled when a fruit is submitted.'},
      ]},workspaceReceive:{
        value:{sketchId:'runtime-dashboard',componentUid:'runtime-publish-message',port:'value'},
        quantity:{sketchId:'runtime-dashboard',componentUid:'runtime-publish-message',port:'quantity'},
      },
    }),
    component('memo.js','runtime-service-log','Service log',400,650,{
      w:440,h:200,state:{logMode:true,maxLines:12,showCounts:true},inputValues:{showScrollbar:true},
      bindings:{line:connect('runtime-receive-message')},
    }),
    component('go-to-tab.js','runtime-service-home','Open dashboard',970,630,{inputValues:{page:1},state:{showIndicators:false}}),
    text('runtime-services-catalog-help','Fruit stock appears in the workspace catalog; scratch stays local. Each submission samples the fruit and quantity from two received endpoints.',740,550,520,72,16),
  ];
  const dashboard=[
    text('runtime-dashboard-title','Dashboard',40,24,1240,44,28),
    text('runtime-dashboard-help','The clock, records and service log live on Services. Submit a message, switch sketches, then inspect its log.',40,76),
    component('receive.js','runtime-dashboard-clock','Receive service time',40,146,{
      h:130,state:{endpoints:[
        {id:'value',name:'UTC time',type:'string',description:'A live value from the hidden Services sketch.'},
        {id:'tick',name:'Second tick',type:'boolean',description:'The clock’s short second pulse.'},
      ]},workspaceReceive:{
        value:{sketchId:'runtime-services',componentUid:'runtime-publish-time',port:'value'},
        tick:{sketchId:'runtime-services',componentUid:'runtime-publish-time',port:'tick'},
      },
    }),
    component('text-label.js','runtime-dashboard-time','Current UTC time',390,146,{
      w:330,h:86,fontSize:28,state:{showName:true},bindings:{value:connect('runtime-dashboard-clock')},
    }),
    component('status-indicator.js','runtime-dashboard-tick','Second tick',390,238,{
      w:240,h:66,fontSize:18,bindings:{value:connect('runtime-dashboard-clock','tick')},
    }),
    component('text-input.js','runtime-message','Message for Services',40,316,{
      w:390,h:128,state:{values:['Hello Services'],showSubmitted:false,showHints:false,placeholder:'Type a message, then press Enter'},
    }),
    component('number-control.js','runtime-quantity','Quantity',460,316,{
      w:220,h:128,state:{value:1},inputValues:{min:0,max:100,step:1},
    }),
    component('publish.js','runtime-publish-message','Publish submissions',720,316,{
      w:320,h:150,state:{endpoints:[
        {id:'value',name:'Fruit submitted',type:'string',description:'Current fruit plus one event for every accepted submission.'},
        {id:'quantity',name:'Quantity',type:'number',description:'Current quantity; editing it does not submit a fruit.'},
      ]},
      bindings:{value:connect('runtime-message'),quantity:connect('runtime-quantity')},
    }),
    component('data-table.js','runtime-dashboard-table','Shared fruit stock',40,486,{
      w:720,h:322,inputValues:{data:shared},state:{maxRows:6,maxColumns:2,showCounts:true},
    }),
    component('go-to-tab.js','runtime-open-editor','Edit stock',1070,146,{inputValues:{page:2},state:{showIndicators:false}}),
    component('go-to-tab.js','runtime-open-services','Inspect hidden Services',1070,320,{inputValues:{page:0},state:{showIndicators:false}}),
    text('runtime-dashboard-try','Try it\n1. Set Quantity, then submit “Pears” twice: two rows are captured.\n2. Open Services: both log lines arrived while it was hidden.\n3. Edit stock, then return: this table shows the same records.',850,530,430,230,18),
  ];
  const editor=[
    text('runtime-editor-title','Edit shared stock',40,24,1240,44,28),
    text('runtime-editor-help','Edit a cell or add a row. Dashboard and Services use this same Dataset. The window title overrides the workspace default.',40,76),
    component('data-table.js','runtime-stock-editor','Fruit stock · editable',40,166,{
      w:760,h:360,inputValues:{data:shared},state:{maxRows:8,maxColumns:2,editDataset:true,allowReaderEdit:true,showCounts:true},
    }),
    component('page-settings.js','runtime-editor-settings','Sketch presentation override',950,166,{
      state:{overrideTitle:true},inputValues:{title:'Edit fruit stock · Workspace example'},
    }),
    component('go-to-tab.js','runtime-editor-home','Back to dashboard',950,390,{inputValues:{page:1},state:{showIndicators:false}}),
    component('receive.js','runtime-editor-messages','Receive submissions',40,620,{
      w:330,state:{endpoints:[{id:'value',name:'Fruit submitted',type:'string',description:'Import only the endpoint needed here.'}]},
      workspaceReceive:{value:{sketchId:'runtime-dashboard',componentUid:'runtime-publish-message',port:'value'}},
    }),
    component('memo.js','runtime-editor-log','Messages received while elsewhere',410,600,{
      w:420,h:230,state:{logMode:true,maxLines:12,showCounts:true},inputValues:{showScrollbar:true},
      bindings:{line:connect('runtime-editor-messages')},
    }),
    text('runtime-editor-event-help','This second receiver gets the same submissions as Services.\nChanging tabs does not replay old events.',920,630,370,132,18),
  ];
  // Fixed sketch IDs are also used by endpoint, dataset and settings references above.
  return {app:'SimpleCanvasWorkspace',version:5,activeIndex:1,tabs:[
    {id:'runtime-services',name:'Services',items:services,datasets:{'workspace-stock':stock,'workspace-scratch':scratch},assets:{}},
    {id:'runtime-dashboard',name:'Dashboard',items:dashboard,datasets:{},assets:{}},
    {id:'runtime-editor',name:'Data editor',items:editor,datasets:{},assets:{}},
  ]};
}

async function updateWorkspaceRuntimeExample({root:directory=root,exportReader=exportWorkspaceReader,io=fs}={}){
  const examples=path.join(directory,'examples'),workspace=buildWorkspaceRuntimeExample({root:directory});
  const staging=io.mkdtempSync(path.join(examples,'.workspace-runtime-')),targets=['workspace-runtime.json','workspace-runtime.html'];
  const previous=targets.map(name=>{const target=path.join(examples,name);return io.existsSync(target)?io.readFileSync(target):null;});
  let keepRecovery=false;
  try{
    const stagedWorkspace=path.join(staging,targets[0]),stagedReader=path.join(staging,targets[1]);
    io.writeFileSync(stagedWorkspace,JSON.stringify(workspace,null,2)+'\n');
    await exportReader({root:directory,workspacePath:stagedWorkspace,readerPath:stagedReader,tabCount:workspace.tabs.length});
    if(!io.statSync(stagedReader).isFile() || !io.statSync(stagedReader).size)throw new Error('HTML export is empty');
    for(let index=0;index<targets.length;index++){
      const target=path.join(examples,targets[index]),current=io.existsSync(target)?io.readFileSync(target):null;
      if(previous[index]===null?current!==null:current===null || !current.equals(previous[index]))
        throw new Error('Workspace artifacts changed during export; generated files were not published');
      if(previous[index]!==null)io.writeFileSync(path.join(staging,'previous-'+targets[index]),previous[index]);
    }
    const published=[];
    try{
      for(const name of targets){io.renameSync(path.join(staging,name),path.join(examples,name));published.push(name);}
    }catch(error){
      const recovery=[];
      for(const name of published.reverse())try{
        const index=targets.indexOf(name),target=path.join(examples,name);
        if(previous[index]===null)io.unlinkSync(target);else io.renameSync(path.join(staging,'previous-'+name),target);
      }catch(failure){recovery.push(failure);}
      if(recovery.length){keepRecovery=true;throw new AggregateError([error,...recovery],'Publishing failed; recovery copies remain in '+staging);}
      throw error;
    }
    return {tabCount:workspace.tabs.length};
  }finally{if(!keepRecovery)io.rmSync(staging,{recursive:true,force:true});}
}

module.exports={buildWorkspaceRuntimeExample,updateWorkspaceRuntimeExample};
if(require.main===module)updateWorkspaceRuntimeExample()
  .then(({tabCount})=>console.log('Updated '+tabCount+' workspace-runtime sketches and offline HTML reader.'))
  .catch(error=>{console.error(error);process.exitCode=1;});
