// One Sketch settings component overrides workspace presentation defaults for this sketch.
// Override flags are authoring settings. Values remain ordinary live inputs when overridden.
// This authoring block is omitted from exported drawings, including its unavailable-input preview.
({
  apiVersion:2,
  settings:{
    overrideTitle:{type:'boolean',default:false,label:'Override window title'},
    overrideShowTabs:{type:'boolean',default:false,label:'Override tab-bar visibility'},
    overrideShowWiring:{type:'boolean',default:false,label:'Override wiring visibility'},
    overrideShowSimulationControls:{type:'boolean',default:false,label:'Override simulation controls visibility'}
  },
  inputs:{
    title:{type:'string',default:'',label:'Window title'},
    showTabs:{role:'control',type:'boolean',default:true,label:'Show tab bar'},
    showWiring:{role:'control',type:'boolean',default:false,label:'Show wiring'},
    showSimulationControls:{role:'control',type:'boolean',default:true,label:'Show simulation controls'}
  },
  outputs:{},
  pageSettings:{title:'title',showTabs:'showTabs',showWiring:'showWiring',showSimulationControls:'showSimulationControls'},
  sketchSettingsOverrides:{title:'overrideTitle',showTabs:'overrideShowTabs',showWiring:'overrideShowWiring',showSimulationControls:'overrideShowSimulationControls'},
  initState(){return {overrideTitle:false,overrideShowTabs:false,overrideShowWiring:false,overrideShowSimulationControls:false};},
  initStyle(){return {w:300,h:160,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state=this.initState()){
    for(const key of Object.values(this.sketchSettingsOverrides))if(typeof state[key]!=='boolean')throw new Error('Each presentation override must be Boolean');
    if(typeof inputs.title!=='string' || inputs.title.length>2000)throw new Error('Window title must be text of at most 2000 characters');
    for(const key of ['showTabs','showWiring','showSimulationControls'])if(typeof inputs[key]!=='boolean')throw new Error(this.inputs[key].label+' must be Boolean');
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
    const scale=Math.min(w/300,h/160),pad=12*scale,name=(typeof io.name==='string'?io.name:'').trim()||'Sketch settings';
    const inputs={...Object.fromEntries(Object.entries(this.inputs).map(([key,port])=>[key,port.default])),...io.inputs};
    const text=(value,y,size=11,color=style.textColor||'#334155',weight=400)=>this._text(value,pad,y*scale,w-pad*2,18*scale,size*scale,style,color,weight);
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#f8fafc',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash,editorOnly:true},
      text(name,12,13,style.textColor||'#334155',600)];
    if(io.error){
      children.push(text(io.error,43,11,'#92400e'),text('Workspace defaults apply',67,11,'#64748b'));
    }else{
      children.push(text('Title: '+(state.overrideTitle?(inputs.title||'(empty)'):'inherit'),42,12),
        text('Tab bar: '+(state.overrideShowTabs?(inputs.showTabs?'shown':'hidden'):'inherit')+' · Wiring: '+(state.overrideShowWiring?(inputs.showWiring?'shown':'hidden'):'inherit'),66,10),
        text('Simulation controls: '+(state.overrideShowSimulationControls?(inputs.showSimulationControls?'shown':'hidden'):'inherit'),88));
    }
    children.push(text('Applied before this sketch is shown',114,10,'#64748b'),text('Authoring only · one per sketch',134,10,'#64748b'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
