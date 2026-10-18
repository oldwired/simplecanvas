// A zero-based choice list. Keys remain stable when rows are reordered.
({
  apiVersion:2,
  settings:{source:{type:'string',default:'list',options:['list','dataset'],label:'Choices from'},choices:{type:'string',default:'[{"text":"Idle","key":"idle"},{"text":"Running","key":"running"},{"text":"Stopped","key":"stopped"}]',format:'choices',label:'Editable list'},showArrow:{type:'boolean',default:true,label:'Show dropdown'}},
  inputs(state){
    const ports={select:{type:'number',default:0}};
    return this._source(state)==='dataset'?{...ports,data:{type:'table'},textColumn:{type:'string',default:'',columnOf:'data',columnType:'string'},keyColumn:{type:'string',default:'',columnOf:'data',columnType:'string'}}:ports;
  },
  outputs:{index:{type:'number'},key:{type:'string'},text:{type:'string'},valid:{type:'boolean'}},
  initState(){return {source:'list',choices:'[{"text":"Idle","key":"idle"},{"text":"Running","key":"running"},{"text":"Stopped","key":"stopped"}]',showArrow:true};},
  initStyle(){return {w:280,h:78,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state,context={}){
    const entries=this._entries(inputs,state,context),index=inputs.select;
    if(!Number.isSafeInteger(index) || index<0 || index>=entries.length)return {index:-1,key:'',text:'',valid:false};
    return {index,key:entries[index].key,text:entries[index].text,valid:true};
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
  _field(w,h,style={}){
    const scale=Math.min(w/280,h/78),y=26*scale;
    return {x:0,y,w,h:Math.max(1,h-y),fontSize:Math.max(5,Math.min(style.fontSize||18,(h-y)*.42))};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/280,h/78),field=this._field(w,h,style),pad=10*scale,arrow=state.showArrow!==false;
    const valid=!io.error && io.outputs?.valid===true,linked=io.boundInputs?.includes('select')===true;
    const value=io.error?io.error:valid?io.outputs.text:'No selection';
    const children=[this._caption(io.name,'Dropdown',w,20*scale,style)];
    if(arrow)children.push({type:'rect',x:field.x,y:field.y,w:field.w,h:field.h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size||1.5,dash:style.dash});
    const inset=arrow?pad:0;
    children.push(this._text(value,inset,field.y+(field.h-field.fontSize*1.35)/2,w-inset*2-(arrow?24*scale:0),field.fontSize*1.35,field.fontSize,style,io.error?'#92400e':valid?style.textColor||'#334155':'#64748b'));
    if(arrow){
      const x=w-19*scale,y=field.y+field.h/2,color=linked?'#94a3b8':style.textColor||'#475569';
      children.push({type:'line',x1:x-5*scale,y1:y-2*scale,x2:x,y2:y+3*scale,strokeOn:true,color,size:1.6*scale},{type:'line',x1:x,y1:y+3*scale,x2:x+5*scale,y2:y-2*scale,strokeOn:true,color,size:1.6*scale});
    }
    return children;
  },
  handles(state,w,h,style={},io={}){
    if(state.showArrow===false || io.error || io.boundInputs?.includes('select'))return [];
    const inline=this._field(w,h,style),value=Number.isSafeInteger(io.outputs?.index)?io.outputs.index:Number.isSafeInteger(io.inputs?.select)?io.inputs.select:-1;
    const handle={id:'select',kind:'choice',input:'select',value,inline,x:inline.x+inline.w/2,y:inline.y+inline.h/2};
    if(this._source(state)==='dataset')handle.table={input:'data',labelColumn:io.inputs?.textColumn||''};
    else handle.options=this._entries({},state).map((entry,index)=>({value:index,label:entry.text||'(empty)'}));
    return [handle];
  },
  hitEdit(state,x,y,w,h,style={},io={}){
    if(!this.handles(state,w,h,style,io).length)return null;
    const field=this._field(w,h,style);return x>=field.x && x<=field.x+field.w && y>=field.y && y<=field.y+field.h?'select':null;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
