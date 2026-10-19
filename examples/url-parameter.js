// Read one decoded URL parameter from the host's current query snapshot (opening URL plus explicit navigation updates).
// Each instance can choose a key and zero-based occurrence. Query data is never saved in state.
({
  apiVersion:2,
  queryParameters:true,
  settings:{showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs:{key:{role:'control',type:'string',default:'name'},index:{role:'control',type:'number',default:0},fallback:{type:'string',default:''}},
  outputs:{value:{type:'string'},found:{role:'control',type:'boolean'},count:{type:'number'}},
  initState(){return {showIndicators:true};},
  initStyle(){return {w:300,h:128,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state,context={}){
    for(const key of ['key','fallback'])if(typeof inputs[key]!=='string' || inputs[key].length>2000)throw new Error('Key and fallback must be strings of at most 2000 characters');
    if(!Number.isSafeInteger(inputs.index) || inputs.index<0 || inputs.index>127)throw new Error('Index must be a whole number from 0 to 127');
    const query=context.query??'';
    if(typeof query!=='string' || query.length>16000)throw new Error('URL query exceeds 16000 characters');
    const parameters=new URLSearchParams(query);
    if([...parameters].length>128)throw new Error('URL query exceeds 128 parameters');
    const values=parameters.getAll(inputs.key),found=inputs.index<values.length;
    const value=found?values[inputs.index]:inputs.fallback;
    if(value.length>2000)throw new Error('Parameter value exceeds 2000 characters');
    return {value,found,count:values.length};
  },
  _graphemes(value){return typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)].map(part=>part.segment):[value];},
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
    const scale=Math.min(w/300,h/128),pad=12*scale,available=!io.error && typeof io.outputs?.value==='string';
    const name=(typeof io.name==='string'?io.name:'').trim()||'URL parameter';
    const text=(value,y,size,color,weight)=>this._text(value,pad,y*scale,w-pad*2,25*scale,size*scale,style,color,weight);
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      text(name,12,13,undefined,600),text(io.error|| (available?(io.outputs.value||'(empty)'):'Input unavailable'),40,io.error?13:20,io.error?'#92400e':undefined,600),
      text('Key: '+(io.inputs?.key??'name')+' · index '+(io.inputs?.index??0),74,11,'#64748b')];
    if(state.showIndicators!==false)children.push(text(available?(io.outputs.found?'Found':'Fallback')+' · '+io.outputs.count+' matching parameter(s)':'Output: —',100,11,'#64748b'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
