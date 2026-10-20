// One Workspace settings component supplies presentation defaults and startup configuration.
// Execution mode and initial sketch are authoring settings, never live control inputs.
({
  apiVersion:2,
  settings:{executionMode:{type:'string',default:'active sketch',options:['active sketch','whole workspace'],label:'Execution mode'}},
  workspaceSettings:{title:'title',showTabs:'showTabs',showWiring:'showWiring',showSimulationControls:'showSimulationControls'},
  initState(){return {executionMode:'active sketch',initialSketchId:'',tabVisibility:[]};},
  initStyle(){return {w:330,h:184,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  _configuration(state){
    if(!['active sketch','whole workspace'].includes(state.executionMode))throw new Error('Choose Active sketch only or Whole workspace');
    if(typeof state.initialSketchId!=='string' || state.initialSketchId.length>100)throw new Error('Initial sketch must be a sketch ID of at most 100 characters');
    const entries=state.tabVisibility;
    if(!Array.isArray(entries) || entries.length>128)throw new Error('Tab visibility supports at most 128 sketches');
    const ids=new Set(),ports=new Set();
    for(const entry of entries){
      if(!entry || typeof entry!=='object' || Array.isArray(entry) || Object.keys(entry).some(key=>!['sketchId','visible','input'].includes(key)) ||
        typeof entry.sketchId!=='string' || !entry.sketchId || entry.sketchId.length>100 || ids.has(entry.sketchId) || typeof entry.visible!=='boolean' ||
        entry.input!==undefined && (typeof entry.input!=='string' || entry.input!=='' && !/^tab[A-Za-z0-9_]{1,27}$/.test(entry.input)))throw new Error('Each tab visibility entry needs a unique sketch ID, Boolean visibility and optional control input');
      ids.add(entry.sketchId);
      if(entry.input){if(ports.has(entry.input))throw new Error('Tab visibility control inputs must be unique');ports.add(entry.input);}
    }
    if(ports.size>28)throw new Error('At most 28 sketch tabs can have live visibility inputs');
    return entries;
  },
  inputs(state){
    const ports={title:{type:'string',default:'',label:'Default window title'},
      showTabs:{role:'control',type:'boolean',default:true,label:'Show tab bar'},
      showWiring:{role:'control',type:'boolean',default:false,label:'Show wiring'},
      showSimulationControls:{role:'control',type:'boolean',default:true,label:'Show simulation controls'}};
    for(const entry of this._configuration(state))if(entry.input)ports[entry.input]={role:'control',type:'boolean',default:entry.visible,label:'Show sketch tab'};
    return ports;
  },
  outputs:{},
  compute(inputs,state){
    const ports=this.inputs(state);
    if(typeof inputs.title!=='string' || inputs.title.length>2000)throw new Error('Window title must be text of at most 2000 characters');
    for(const [key,port] of Object.entries(ports))if(port.type==='boolean' && typeof inputs[key]!=='boolean')throw new Error(port.label+' must be Boolean');
    return {};
  },
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400){
    const content=String(value).replace(/\s+/g,' '),chars=typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(content),part=>part.segment):content?[content]:[];
    const units=char=>/[MWmw@#%]/.test(char)||char.codePointAt(0)>255?1.1:/[A-Z]/.test(char)?.88:.72;
    let text='',used=0;
    for(let i=0;i<chars.length;i++){
      const next=units(chars[i]),remaining=i<chars.length-1?1.1:0;
      if((used+next+remaining)*size>w){text+='…';break;}
      text+=chars[i];used+=next;
    }
    const font=(style.font||weight+' '+size+'px sans-serif').replace(/\d+(?:\.\d+)?px/,size+'px');
    return {type:'text',x,y,w,h,text,plainText:true,align:'left',font,color,strokeOn:false,editorOnly:true};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/330,h/184),pad=12*scale,name=(typeof io.name==='string'?io.name:'').trim()||'Workspace settings';
    const text=(value,y,size=11,color=style.textColor||'#334155',weight=400)=>this._text(value,pad,y*scale,w-pad*2,18*scale,size*scale,style,color,weight);
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#f8fafc',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash,editorOnly:true},text(name,12,13,style.textColor||'#334155',600)];
    if(io.error)children.push(text(io.error,44,11,'#92400e'),text('Application defaults apply',68,11,'#64748b'));
    else{
      const inputs={title:'',showTabs:true,showWiring:false,showSimulationControls:true,...io.inputs};
      children.push(text('Title: '+(inputs.title||'Workspace name'),42,12),text('Tab bar: '+(inputs.showTabs?'shown':'hidden')+' · Wiring: '+(inputs.showWiring?'shown':'hidden'),66),
        text('Simulation controls: '+(inputs.showSimulationControls?'shown':'hidden'),88),text(state.executionMode==='whole workspace'?'Execution: Whole workspace':'Execution: Active sketch only',110));
    }
    children.push(text('Defaults apply across all sketches',138,10,'#64748b'),text('Authoring only · one per workspace',158,10,'#64748b'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
