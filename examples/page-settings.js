// One Page settings component controls the current tab's presentation through the host.
// Empty title restores the workspace title. The host applies settled values before revealing a tab.
// This authoring block is omitted from exported drawings, including its unavailable-input preview.
({
  apiVersion:2,
  inputs:{
    title:{type:'string',default:'',label:'Window title'},
    showTabs:{role:'control',type:'boolean',default:true,label:'Show tab bar'},
    showWiring:{role:'control',type:'boolean',default:false,label:'Show wiring'},
    showSimulationControls:{role:'control',type:'boolean',default:true,label:'Show simulation controls'}
  },
  outputs:{},
  pageSettings:{title:'title',showTabs:'showTabs',showWiring:'showWiring',showSimulationControls:'showSimulationControls'},
  initState(){return {};},
  initStyle(){return {w:300,h:160,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs){
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
    const scale=Math.min(w/300,h/160),pad=12*scale,name=(typeof io.name==='string'?io.name:'').trim()||'Page settings';
    const inputs={...Object.fromEntries(Object.entries(this.inputs).map(([key,port])=>[key,port.default])),...io.inputs};
    const text=(value,y,size=11,color=style.textColor||'#334155',weight=400)=>this._text(value,pad,y*scale,w-pad*2,18*scale,size*scale,style,color,weight);
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#f8fafc',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash,editorOnly:true},
      text(name,12,13,style.textColor||'#334155',600)];
    if(io.error){
      children.push(text(io.error,43,11,'#92400e'),text('Workspace defaults apply',67,11,'#64748b'));
    }else{
      children.push(text('Title: '+(inputs.title||'Workspace default'),42,12),
        text('Tab bar: '+(inputs.showTabs?'shown':'hidden')+' · Wiring: '+(inputs.showWiring?'shown':'hidden'),66),
        text('Simulation controls: '+(inputs.showSimulationControls?'shown':'hidden'),88));
    }
    children.push(text('Applied before this tab is shown',114,10,'#64748b'),text('Hidden in HTML export · one per tab',134,10,'#64748b'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
