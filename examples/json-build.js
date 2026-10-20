// Build a JSON object from 1–8 named, typed fields; field0 is the first configured field.
// Labels show JSON keys; connection IDs stay positional so a same-slot rename keeps its wiring.
// Each setting line is name:string|number|boolean|json. A json field parses nested JSON from a string port.
// Field changes update the current JSON value. Emit/Reprocess deliberately captures one message.
({
  apiVersion:2,
  eventApi:1,
  eventTransform:{inputs:[],outputs:['text','valid'],reprocess:'reprocess'},
  settings:{fields:{type:'string',format:'lines',default:'name:string\nvalue:number',label:'Fields, in port order (name:type)'},showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  _fields(state){
    if(typeof state.fields!=='string' || state.fields.length>2000)throw new Error('Fields must fit within 2000 characters');
    const lines=state.fields.split(/\r?\n/).map(line=>line.trim()).filter(Boolean),keys=new Set();
    if(!lines.length || lines.length>8)throw new Error('Enter 1–8 fields, one name:type per line');
    return lines.map((line,index)=>{
      const at=line.lastIndexOf(':'),key=line.slice(0,at).trim(),type=line.slice(at+1).trim().toLowerCase();
      if(at<1 || !key || key.length>100 || keys.has(key))throw new Error('Field names must be unique and contain 1–100 characters');
      if(!['string','number','boolean','json'].includes(type))throw new Error('Field '+key+' must use string, number, boolean, or json');
      keys.add(key);return {key,type,port:'field'+index};
    });
  },
  inputs(state){
    const ports={reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Emit / Reprocess'}};
    for(const {key,type,port} of this._fields(state))ports[port]={label:key,type:type==='json'?'string':type,default:type==='number'?0:type==='boolean'?false:type==='json'?'null':''};
    return ports;
  },
  outputs:{text:{type:'string',event:true},valid:{role:'control',type:'boolean',event:true}},
  initState(){return {fields:'name:string\nvalue:number',showIndicators:true};},
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
    const fields=this._fields(state),object=Object.create(null);
    for(const {key,type,port} of fields){
      const portType=type==='json'?'string':type;
      if(typeof inputs[port]!==portType || portType==='number' && !Number.isFinite(inputs[port]) || portType==='string' && inputs[port].length>2000)throw new Error('Field '+key+' requires '+(portType==='string'?'a string of at most 2000 characters':portType==='number'?'a finite number':'a Boolean value'));
    }
    for(const {key,type,port} of fields){
      let value=inputs[port];
      if(type==='json'){
        try{value=JSON.parse(value);}catch{return {text:'',valid:false};}
        if(!this._finite(value))return {text:'',valid:false};
      }
      object[key]=value;
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
    const name=(typeof io.name==='string'?io.name:'').trim()||'JSON build',valid=available?io.outputs.valid:null;
    const message=io.error?io.error:!available?'Input unavailable':valid?io.outputs.text:'Invalid JSON field';
    let detail='Configure fields in Edit';try{detail=this._fields(state).map(({key,port})=>port+': '+key).join(' · ');}catch{}
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600),
      this._text(message,pad,40*scale,w-pad*2,28*scale,(io.error?12:18)*scale,style,io.error?'#92400e':style.textColor||'#334155',600),
      this._text(detail,pad,74*scale,w-pad*2,17*scale,11*scale,style,'#64748b')];
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:105*scale,w:8*scale,h:8*scale,fill:true,fillColor:valid===null?'#fbbf24':valid?'#15803d':'#64748b',strokeOn:false});
      children.push(this._text('Valid: '+(valid===null?'—':String(valid)),pad+15*scale,100*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
