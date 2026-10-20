// Read one typed value using JSON Pointer: empty selects the root; /items/0 selects the first item.
// Pointer keys escape ~ as ~0 and / as ~1. Found describes existence; Valid also requires the chosen type.
({
  apiVersion:2,
  eventApi:1,
  eventTransform:{input:'text',outputs:['value','found','valid'],reprocess:'reprocess'},
  settings:{resultType:{type:'string',default:'string',options:['string','number','boolean','JSON'],label:'Result type'},showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs:{reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'},text:{event:true,type:'string',default:'""'},pointer:{role:'control',type:'string',default:''}},
  outputs(state){
    if(!['string','number','boolean','JSON'].includes(state.resultType))throw new Error('Choose string, number, boolean, or JSON as result type');
    return {value:{event:true,type:state.resultType==='JSON'?'string':state.resultType},found:{event:true,role:'control',type:'boolean'},valid:{event:true,role:'control',type:'boolean'}};
  },
  initState(){return {resultType:'string',showIndicators:true};},
  initStyle(){return {w:300,h:128,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  _finite(value){
    const pending=[value];
    while(pending.length){
      const item=pending.pop();
      if(typeof item==='number' && !Number.isFinite(item))return false;
      if(item!==null && typeof item==='object')pending.push(...Object.values(item));
    }
    return true;
  },
  compute(inputs,state=this.initState()){
    this.outputs(state);
    for(const key of ['text','pointer'])if(typeof inputs[key]!=='string' || inputs[key].length>2000)throw new Error('JSON text and pointer must be strings of at most 2000 characters');
    const empty=state.resultType==='number'?0:state.resultType==='boolean'?false:'',missing={value:empty,found:false,valid:false};
    let value;
    try{value=JSON.parse(inputs.text);}catch{return missing;}
    if(!this._finite(value))return missing;
    if(inputs.pointer!==''){
      if(!inputs.pointer.startsWith('/') || /~(?:[^01]|$)/.test(inputs.pointer))return missing;
      for(const part of inputs.pointer.slice(1).split('/')){
        const key=part.replace(/~1/g,'/').replace(/~0/g,'~');
        if(value===null || typeof value!=='object' || Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key) || !Object.prototype.hasOwnProperty.call(value,key))return missing;
        value=value[key];
      }
    }
    if(state.resultType==='JSON')value=JSON.stringify(value);
    else if(typeof value!==state.resultType || state.resultType==='number' && !Number.isFinite(value))return {value:empty,found:true,valid:false};
    if(typeof value==='string' && value.length>2000)throw new Error('Output exceeds 2000 characters');
    return {value,found:true,valid:true};
  },
  // Preview boundaries follow visible characters. Without Segmenter, keep the text whole.
  _graphemes(value){
    const text=String(value);
    return typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'
      ?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>part.segment)
      :text?[text]:[];
  },
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400){
    const units=char=>/[MWmw@#%]/.test(char)||char.codePointAt(0)>255?1.1:/[A-Z]/.test(char)?.88:.72;
    const chars=this._graphemes(String(value).replace(/\s+/g,' '));let text='',used=0;
    for(let i=0;i<chars.length;i++){
      const next=units(chars[i]),remaining=i<chars.length-1?1.1:0;
      if((used+next+remaining)*size>w){text+='…';break;}
      text+=chars[i];used+=next;
    }
    const font=(style.font||weight+' '+size+'px sans-serif').replace(/\d+(?:\.\d+)?px/,size+'px');
    return {type:'text',x,y,w,h,text,plainText:true,align:'left',font,color,strokeOn:false};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/300,h/128),pad=12*scale,available=!io.error && typeof io.outputs?.valid==='boolean' && typeof io.outputs?.found==='boolean';
    const name=(typeof io.name==='string'?io.name:'').trim()||'JSON extract';
    const found=available?io.outputs.found:null,valid=available?io.outputs.valid:null,value=io.outputs?.value;
    const formatted=typeof value==='number' && Number.isFinite(value)?Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(8))):String(value??'');
    const message=io.error?io.error:!available?'Input unavailable':valid?(formatted||'(empty)'):found?'Value has a different type':'Not found or invalid JSON/pointer';
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600),
      this._text(message,pad,40*scale,w-pad*2,28*scale,(io.error||!valid?12:20)*scale,style,io.error?'#92400e':style.textColor||'#334155',600),
      this._text((io.inputs?.pointer||'Root')+' · '+state.resultType,pad,74*scale,w-pad*2,17*scale,11*scale,style,'#64748b')];
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:105*scale,w:8*scale,h:8*scale,fill:true,fillColor:valid===null?'#fbbf24':valid?'#15803d':'#64748b',strokeOn:false});
      children.push(this._text('Found: '+(found===null?'—':String(found))+' · Valid: '+(valid===null?'—':String(valid)),pad+15*scale,100*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
