// Ask the host to open a zero-based workspace tab, by released button, Go event or rising signal.
// Computation never navigates. Loaded/high-at-activation signals only establish a baseline.
({
  apiVersion:2,
  eventApi:1,
  eventOutputs:{arrived:{type:'number'},failed:{type:'string'}},
  actionEvents:{goToTab:{success:'arrived',failure:'failed'}},
  settings:{showButton:{type:'boolean',default:true,label:'Show button'},showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs:{page:{type:'number',default:0},parameters:{type:'string',default:'{}'},go:{role:'control',type:'boolean',default:false,event:'action'}},
  outputs:{},
  dataActions:{go:{type:'goToTab',input:'page',parameters:'parameters',trigger:'go'}},
  initState(){return {showButton:true,showIndicators:true};},
  initStyle(){return {w:240,h:120,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs){
    if(!Number.isSafeInteger(inputs.page) || inputs.page<0)throw new Error('Tab index must be a whole number starting at 0');
    if(typeof inputs.parameters!=='string' || inputs.parameters.length>2000)throw new Error('Parameters must be JSON text of at most 2000 characters');
    if(typeof inputs.go!=='boolean')throw new Error('Go trigger must be Boolean');
    return {};
  },
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400){
    const units=char=>/[MWmw@#%]/.test(char)||char.codePointAt(0)>255?1.1:/[A-Z]/.test(char)?.88:.72;
    const content=String(value).replace(/\s+/g,' '),chars=typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(content),part=>part.segment):content?[content]:[];let text='',used=0;
    for(let i=0;i<chars.length;i++){
      const next=units(chars[i]),remaining=i<chars.length-1?1.1:0;
      if((used+next+remaining)*size>w){text+='…';break;}
      text+=chars[i];used+=next;
    }
    const font=(style.font||weight+' '+size+'px sans-serif').replace(/\d+(?:\.\d+)?px/,size+'px');
    return {type:'text',x,y,w,h,text,plainText:true,align:'left',font,color,strokeOn:false};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/240,h/120),pad=12*scale,name=(typeof io.name==='string'?io.name:'').trim()||'Go to tab';
    if(state.showButton===false)return [
      {type:'rect',x:0,y:0,w,h,fill:false,strokeOn:true,color:'#cbd5e1',size:1,dash:'dash',editorOnly:true},
      {...this._text(name+' · automatic',pad,pad,w-pad*2,19*scale,12*scale,style,'#64748b'),editorOnly:true}
    ];
    const available=!io.error && Number.isSafeInteger(io.inputs?.page) && io.inputs.page>=0;
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600)];
    if(!available){children.push(this._text(io.error||'Input unavailable',pad,46*scale,w-pad*2,26*scale,12*scale,style,'#92400e'));return children;}
    children.push({type:'rect',x:pad,y:39*scale,w:w-pad*2,h:40*scale,fill:true,fillColor:'#eef2ff',strokeOn:true,color:'#818cf8',size:1},
      this._text('Go to tab '+io.inputs.page+' →',pad+12*scale,49*scale,w-pad*2-24*scale,22*scale,15*scale,style,'#3730a3',600));
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:99*scale,w:8*scale,h:8*scale,fill:true,fillColor:io.inputs.go===true?'#15803d':'#94a3b8',strokeOn:false},
        this._text('Go: '+String(io.inputs.go===true)+' · first tab is 0',pad+15*scale,94*scale,w-pad*2-15*scale,18*scale,10*scale,style,'#64748b'));
    }
    return children;
  },
  handles(state,w,h){return state.showButton===false?[]:[{id:'go',kind:'action',x:w/2,y:59*Math.min(w/240,h/120),action:{type:'goToTab',input:'page',parameters:'parameters'}}];},
  hitEdit(state,x,y,w,h){const scale=Math.min(w/240,h/120),pad=12*scale;return state.showButton!==false && x>=pad && x<=w-pad && y>=39*scale && y<=79*scale?'go':null;},
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
