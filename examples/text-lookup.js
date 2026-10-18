// Zero-based reverse lookup uses the first matching row and the current table row order.
({
  apiVersion:2,
  settings:{source:{type:'string',default:'list',options:['list','dataset'],label:'Choices from'},choices:{type:'string',default:'[{"text":"Idle","key":"idle"},{"text":"Running","key":"running"},{"text":"Stopped","key":"stopped"}]',format:'choices',label:'Editable list'},caseSensitive:{type:'boolean',default:true,label:'Case-sensitive matching'},trim:{type:'boolean',default:false,label:'Ignore surrounding whitespace'}},
  inputs(state){
    const ports={text:{type:'string',default:''}};
    return this._source(state)==='dataset'?{...ports,data:{type:'table'},textColumn:{role:'control',type:'string',default:'',columnOf:'data',columnType:'string'},keyColumn:{role:'control',type:'string',default:'',columnOf:'data',columnType:'string'}}:ports;
  },
  outputs:{index:{type:'number'},key:{type:'string'},found:{role:'control',type:'boolean'}},
  initState(){return {source:'list',choices:'[{"text":"Idle","key":"idle"},{"text":"Running","key":"running"},{"text":"Stopped","key":"stopped"}]',caseSensitive:true,trim:false};},
  initStyle(){return {w:300,h:100,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state,context={}){
    const entries=this._entries(inputs,state,context);
    if(typeof inputs.text!=='string' || inputs.text.length>2000)throw new Error('Text lookup requires a string of at most 2000 characters');
    const match=value=>{value=state.trim===true?value.trim():value;return state.caseSensitive===false?value.toLowerCase():value;};
    const value=match(inputs.text),index=entries.findIndex(entry=>match(entry.text)===value);
    return index<0?{index:-1,key:'',found:false}:{index,key:entries[index].key,found:true};
  },
  _source(state){
    if(!['list','dataset'].includes(state.source))throw new Error('Choose a list or dataset source');
    return state.source;
  },
  _entries(inputs,state,context={}){
    let entries;
    if(this._source(state)==='list'){
      if(typeof state.choices!=='string' || state.choices.length>2000)throw new Error('The editable list must contain at most 2000 characters');
      try{entries=JSON.parse(state.choices);}catch{throw new Error('The editable list must contain valid JSON');}
      if(!Array.isArray(entries) || entries.length>64)throw new Error('The editable list must contain at most 64 entries');
      entries=entries.map(entry=>{
        if(!entry || typeof entry!=='object' || Array.isArray(entry) || Object.keys(entry).some(key=>!['text','key'].includes(key)) || typeof entry.text!=='string' || (entry.key!==undefined && typeof entry.key!=='string'))throw new Error('Each list entry needs text and an optional text key');
        return {text:entry.text,key:entry.key===undefined?'':entry.key};
      });
    }else{
      const table=context.tables?.data;
      if(!inputs.data || typeof inputs.data.datasetId!=='string' || !table || !Array.isArray(table.columns) || !Array.isArray(table.rows) || table.rowCount!==table.rows.length || table.rows.length>1000)throw new Error('A complete dataset input is required');
      if(typeof inputs.textColumn!=='string' || typeof inputs.keyColumn!=='string')throw new Error('Choose text columns for the labels and optional keys');
      const textIndex=inputs.textColumn===''?table.columns.findIndex(column=>column.type==='string'):table.columns.findIndex(column=>column.key===inputs.textColumn);
      if(textIndex<0 || table.columns[textIndex].type!=='string')throw new Error('Choose a string column for the text');
      const keyIndex=inputs.keyColumn===''?-1:table.columns.findIndex(column=>column.key===inputs.keyColumn);
      if(inputs.keyColumn!=='' && (keyIndex<0 || table.columns[keyIndex].type!=='string'))throw new Error('Choose a string column for the keys');
      entries=table.rows.map(row=>{
        if(!Array.isArray(row))throw new Error('Invalid dataset row');
        return {text:row[textIndex]===null?'':row[textIndex],key:keyIndex<0 || row[keyIndex]===null?'':row[keyIndex]};
      });
    }
    const keys=new Set();
    for(const entry of entries){
      if(typeof entry.text!=='string' || entry.text.length>2000 || typeof entry.key!=='string' || entry.key.length>2000)throw new Error('Labels and keys must be text of at most 2000 characters');
      if(entry.key && keys.has(entry.key))throw new Error('Each nonempty key must be unique: '+entry.key.slice(0,40));
      if(entry.key)keys.add(entry.key);
    }
    return entries;
  },
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400){
    const units=char=>/[MWmw@#%]/.test(char)||char.codePointAt(0)>255?1.1:/[A-Z]/.test(char)?.88:.72;
    const chars=Array.from(String(value).replace(/\s+/g,' '));let text='',used=0;
    for(let i=0;i<chars.length;i++){
      const next=units(chars[i]),remaining=i<chars.length-1?1.1:0;
      if((used+next+remaining)*size>w){text+='…';break;}
      text+=chars[i];used+=next;
    }
    return {type:'text',x,y,w,h,text,plainText:true,align:'left',font:weight+' '+size+'px sans-serif',color,strokeOn:false};
  },
  _caption(name,fallback,w,h,style){
    const label=(typeof name==='string'?name:'').trim().replace(/\s+/g,' ')||fallback;
    const units=text=>Array.from(text).reduce((n,c)=>n+(/[MWmw@#%]/.test(c)||c.codePointAt(0)>255?1.1:/[A-Z]/.test(c)?.88:.72),0);
    const size=Math.min(13,w/Math.max(1,units(label)),h/1.35);
    return {type:'text',x:0,y:0,w,h,text:label,plainText:true,align:'left',font:'600 '+Math.max(1,size)+'px sans-serif',color:style.textColor||'#334155',strokeOn:false};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/300,h/100),pad=10*scale,found=!io.error && io.outputs?.found===true;
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size||1.5,dash:style.dash},
      {...this._caption(io.name,'Text lookup',w-pad*2,18*scale,style),x:pad,y:pad}];
    const message=io.error?io.error:found?'Index '+io.outputs.index:'No match';
    children.push(this._text(message,pad,36*scale,w-pad*2,26*scale,18*scale,style,io.error?'#92400e':found?style.textColor||'#334155':'#64748b',600));
    const detail=io.error?'':found && io.outputs.key?'Key: '+io.outputs.key:'Text: '+(io.inputs?.text||'(empty)');
    if(detail)children.push(this._text(detail,pad,72*scale,w-pad*2,18*scale,11*scale,style,'#64748b'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
