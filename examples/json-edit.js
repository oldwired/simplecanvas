// Replace existing JSON values using 1–8 typed JSON Pointer paths; field0 is the first configured edit.
// Labels show paths; connection IDs stay positional so a same-slot path rename keeps its wiring.
// Each setting line is /path:string|number|boolean|json. Use :json to replace the root on its own.
// JSON is parsed and serialized again: untouched values remain, but whitespace formatting is not retained.
({
  apiVersion:2,
  settings:{fields:{type:'string',format:'lines',default:'/name:string',label:'Edits, in port order (JSON Pointer:type)'},showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  _fields(state){
    if(typeof state.fields!=='string' || state.fields.length>2000)throw new Error('Edits must fit within 2000 characters');
    const lines=state.fields.split(/\r?\n/).map(line=>line.trim()).filter(Boolean),paths=[];
    if(!lines.length || lines.length>8)throw new Error('Enter 1–8 edits, one JSON Pointer:type per line');
    return lines.map((line,index)=>{
      const at=line.lastIndexOf(':'),pointer=line.slice(0,at).trim(),type=line.slice(at+1).trim().toLowerCase();
      if(at<0 || pointer.length>100 || pointer!=='' && (!pointer.startsWith('/') || /~(?:[^01]|$)/.test(pointer)))throw new Error('Paths must be valid JSON Pointers of at most 100 characters; empty selects the root');
      if(!['string','number','boolean','json'].includes(type))throw new Error('Each edit must use string, number, boolean, or json');
      const parts=pointer===''?[]:pointer.slice(1).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~'));
      if(paths.some(path=>path.slice(0,Math.min(path.length,parts.length)).every((part,i)=>part===parts[i])))throw new Error('Edit paths must be unique and must not overlap; the root must be edited on its own');
      paths.push(parts);return {pointer,parts,type,port:'field'+index};
    });
  },
  inputs(state){
    const ports={text:{type:'string',default:'{"name":""}'}};
    for(const {pointer,type,port} of this._fields(state))ports[port]={label:pointer||'Root',type:type==='json'?'string':type,default:type==='number'?0:type==='boolean'?false:type==='json'?'null':''};
    return ports;
  },
  outputs:{text:{type:'string'},valid:{role:'control',type:'boolean'}},
  initState(){return {fields:'/name:string',showIndicators:true};},
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
    const fields=this._fields(state),invalid={text:'',valid:false};
    if(typeof inputs.text!=='string' || inputs.text.length>2000)throw new Error('JSON text must be a string of at most 2000 characters');
    for(const {pointer,type,port} of fields){
      const portType=type==='json'?'string':type;
      if(typeof inputs[port]!==portType || portType==='number' && !Number.isFinite(inputs[port]) || portType==='string' && inputs[port].length>2000)throw new Error('Edit '+(pointer||'Root')+' requires '+(portType==='string'?'a string of at most 2000 characters':portType==='number'?'a finite number':'a Boolean value'));
    }
    let object;
    try{object=JSON.parse(inputs.text);}catch{return invalid;}
    if(!this._finite(object))return invalid;
    const edits=[];
    for(const {parts,type,port} of fields){
      let value=inputs[port];
      if(type==='json'){
        try{value=JSON.parse(value);}catch{return invalid;}
        if(!this._finite(value))return invalid;
      }
      let parent=null,current=object,key=null;
      for(const part of parts){
        if(current===null || typeof current!=='object' || Array.isArray(current) && !/^(0|[1-9]\d*)$/.test(part) || !Object.prototype.hasOwnProperty.call(current,part))return invalid;
        parent=current;key=part;current=current[part];
      }
      edits.push({parent,key,value});
    }
    // Resolve and validate every replacement before changing the parsed document.
    for(const {parent,key,value} of edits){
      if(parent===null)object=value;
      else Object.defineProperty(parent,key,{value,writable:true,enumerable:true,configurable:true});
    }
    const text=JSON.stringify(object);
    if(text.length>2000)throw new Error('Output exceeds 2000 characters');
    return {text,valid:true};
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
    const scale=Math.min(w/300,h/128),pad=12*scale,available=!io.error && typeof io.outputs?.text==='string' && typeof io.outputs?.valid==='boolean';
    const name=(typeof io.name==='string'?io.name:'').trim()||'JSON edit',valid=available?io.outputs.valid:null;
    const message=io.error?io.error:!available?'Input unavailable':valid?io.outputs.text:'Invalid JSON or missing path';
    let detail='Configure edits in Edit';try{detail=this._fields(state).map(({pointer})=>pointer||'Root').join(' · ');}catch{}
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600),
      this._text(message,pad,40*scale,w-pad*2,28*scale,(io.error||!valid?12:18)*scale,style,io.error?'#92400e':style.textColor||'#334155',600),
      this._text(detail,pad,74*scale,w-pad*2,17*scale,11*scale,style,'#64748b')];
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:105*scale,w:8*scale,h:8*scale,fill:true,fillColor:valid===null?'#fbbf24':valid?'#15803d':'#64748b',strokeOn:false});
      children.push(this._text('Valid: '+(valid===null?'—':String(valid)),pad+15*scale,100*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
