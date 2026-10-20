// A Capture event or rising Capture signal appends one sampled row to a whole embedded dataset.
// Fields are one columnKey:number|string|boolean entry per line. Unmapped columns stay empty.
({
  apiVersion:2,
  eventApi:1,
  eventOutputs:{captured:{type:'number'},failed:{type:'string'}},
  actionEvents:{appendRow:{success:'captured',failure:'failed'}},
  settings:{
    fields:{type:'string',format:'lines',default:'label:string\nvalue:number\nactive:boolean',label:'Fields (column:type)'},
    allowReaderCapture:{type:'boolean',default:false,label:'Allow capture in HTML export'}
  },
  _fields(state){
    if(typeof state.fields!=='string' || state.fields.length>2000)throw new Error('Fields must fit within 2,000 characters');
    const lines=state.fields.split(/\r?\n/).map(line=>line.trim()).filter(Boolean),keys=new Set();
    if(!lines.length || lines.length>24)throw new Error('Enter 1–24 fields, one column:type per line');
    return lines.map((line,index)=>{
      const at=line.lastIndexOf(':'),key=line.slice(0,at).trim(),type=line.slice(at+1).trim().toLowerCase();
      if(at<1 || !key || key.length>100 || ['__proto__','prototype','constructor'].includes(key) || keys.has(key))throw new Error('Each field needs a unique dataset column key');
      if(!['number','string','boolean'].includes(type))throw new Error('Field '+key+' must use number, string, or boolean');
      keys.add(key);return {key,type,port:'field'+index};
    });
  },
  inputs(state){
    const ports={data:{type:'table'},capture:{role:'control',type:'boolean',default:false,event:'action'}};
    for(const {port,type} of this._fields(state))ports[port]={type,default:type==='number'?0:type==='boolean'?false:''};
    return ports;
  },
  dataActions(state){return {capture:{type:'appendRow',input:'data',trigger:'capture',fields:Object.fromEntries(this._fields(state).map(field=>[field.key,field.port]))}};},
  outputs:{data:{type:'table'},rowCount:{type:'number'}},
  initState(){return {fields:'label:string\nvalue:number\nactive:boolean',allowReaderCapture:false};},
  initStyle(){return {w:320,h:150,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1};},
  compute(inputs,state,context={}){
    const table=context.tables?.data;
    if(!inputs.data || typeof inputs.data.datasetId!=='string' || inputs.data.datasetId.startsWith('~') || inputs.data.rows!==undefined ||
      !table || !Array.isArray(table.columns) || !Array.isArray(table.rows) || table.rowCount!==table.rows.length)throw new Error('Connect a whole embedded dataset; filtered and derived tables cannot capture rows');
    for(const {key,type,port} of this._fields(state)){
      const column=table.columns.find(column=>column.key===key);
      if(!column || column.type!==type)throw new Error('Field '+key+' needs a '+type+' dataset column');
      const value=inputs[port];
      if(typeof value!==type || type==='number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) || type==='string' && value.length>2000)throw new Error('Invalid value for '+key);
    }
    return {data:inputs.data,rowCount:table.rowCount};
  },
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400){
    const chars=Array.from(String(value).replace(/\s+/g,' '));let text='',used=0;
    for(let i=0;i<chars.length;i++){
      const next=/[MWmw@#%]/.test(chars[i])||chars[i].codePointAt(0)>255?1.1:/[A-Z]/.test(chars[i])?.88:.72;
      if((used+next+(i<chars.length-1?1.1:0))*size>w){text+='…';break;}
      text+=chars[i];used+=next;
    }
    return {type:'text',x,y,w,h,text,plainText:true,align:'left',font:weight+' '+size+'px sans-serif',color,strokeOn:false};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/320,h/150),pad=12*scale,table=io.tables?.inputs?.data;
    const text=(v,y,size,color,weight)=>this._text(v,pad,y*scale,w-pad*2,24*scale,size*scale,style,color,weight);
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size,dash:style.dash},
      text(io.name?.trim()||'Capture row',12,16,undefined,600)];
    if(io.error || !table || !Number.isInteger(io.outputs?.rowCount)){
      children.push(text(io.error||'Choose a dataset and map its columns in Edit',60,12,'#92400e'));return children;
    }
    children.push(text(table.name,43,13),text(io.outputs.rowCount+' '+(io.outputs.rowCount===1?'row':'rows'),73,22,undefined,600),
      text('Send Capture to add one row',116,11,'#64748b'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
