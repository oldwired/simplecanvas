// Import explicitly chosen workspace endpoints as local outputs.
// Stable endpoint IDs preserve connections when labels or row order change.
({
  apiVersion:2,
  eventApi:1,
  settings:{},
  initState(){return {endpoints:[{id:'value',name:'Value',type:'string',description:''}]};},
  initStyle(){return {w:320,h:100,fontSize:18,fill:true,fillColor:'#f0fdfa',strokeOn:true,color:'#5eead4',textColor:'#115e59',size:1.5};},
  _rows(state){
    if(!state || !Array.isArray(state.endpoints) || state.endpoints.length<1 || state.endpoints.length>16)throw new Error('Configure 1–16 endpoints');
    const ids=new Set();
    for(const row of state.endpoints){
      if(!row || typeof row!=='object' || Array.isArray(row) || Object.keys(row).some(key=>!['id','name','type','description'].includes(key)) ||
        typeof row.id!=='string' || !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(row.id) || ['constructor','prototype','__proto__'].includes(row.id) || ids.has(row.id))throw new Error('Endpoint IDs must be unique stable identifiers');
      if(typeof row.name!=='string' || !row.name.trim() || row.name.length>64)throw new Error('Endpoint name must contain 1–64 characters');
      if(!['string','number','boolean','table','event'].includes(row.type))throw new Error('Choose a text, number, Boolean, table, or event endpoint');
      if(typeof row.description!=='string' || row.description.length>200)throw new Error('Endpoint description must be text of at most 200 characters');
      ids.add(row.id);
    }
    return state.endpoints;
  },
  _value(value,row){
    if(row.type==='table'){
      if(!value || typeof value!=='object' || Array.isArray(value) || typeof value.datasetId!=='string')throw new Error(row.name+' requires a table input');
    }else if(typeof value!==row.type || row.type==='number' && !Number.isFinite(value) || row.type==='string' && value.length>2000)throw new Error(row.name+' must match its declared type');
    return value;
  },
  _event(payload,row){
    if(payload!==null && !['boolean','number','string'].includes(typeof payload) || typeof payload==='number' && !Number.isFinite(payload) || typeof payload==='string' && payload.length>2000)throw new Error('Unsupported event payload');
    if(row.type!=='event' && typeof payload!==row.type)throw new Error('Event payload must match its declared type');
  },
  _text(value,x,y,w,h,size,color,weight=400){
    const content=String(value).replace(/\s+/g,' '),chars=typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(content),part=>part.segment):Array.from(content);
    const limit=Math.max(1,Math.floor(w/(size*.7))),text=chars.length>limit?chars.slice(0,Math.max(0,limit-1)).join('')+'…':content;
    return {type:'text',x,y,w,h,text,plainText:true,align:'left',font:weight+' '+size+'px sans-serif',color,strokeOn:false};
  },
  workspaceEndpoint(state){return {direction:'receive',ports:Object.fromEntries(this._rows(state).map(row=>[row.id,{type:row.type}]))};},
  outputs(state){return Object.fromEntries(this._rows(state).filter(row=>row.type!=='event').map(row=>[row.id,{type:row.type,label:row.name,...(row.type==='table'?{}:{event:true})}]));},
  eventOutputs(state){return Object.fromEntries(this._rows(state).filter(row=>row.type==='event').map(row=>[row.id,{types:['none','boolean','number','string'],label:row.name,side:'right'}]));},
  inputs:{},
  compute(inputs,state,context={}){
    return Object.fromEntries(this._rows(state).filter(row=>row.type!=='event').map(row=>{
      const key='__remote_'+row.id,available=Object.hasOwn(inputs,key) || Object.hasOwn(context.workspaceEndpoint||{},row.id);
      if(!available)throw new Error('Choose a published endpoint for '+row.name+' in Edit; Whole workspace mode is required');
      return [row.id,this._value(Object.hasOwn(inputs,key)?inputs[key]:context.workspaceEndpoint[row.id],row)];
    }));
  },
  onEvent(name,payload,state){
    const row=this._rows(state).find(row=>'__remote_'+row.id===name);if(!row)throw new Error('Unknown remote event input');
    this._event(payload,row);return {state,events:[{port:row.id,payload}]};
  },
  children(state,style,w,h,editing,io={}){
    const rows=this._rows(state),baseH=64+rows.length*36,scale=Math.min(w/320,h/baseH),pad=12*scale,color=style.textColor||'#115e59';
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#f0fdfa',strokeOn:style.strokeOn!==false,color:style.color||'#5eead4',size:style.size,dash:style.dash},
      this._text((typeof io.name==='string'?io.name:'').trim()||'Receive',pad,10*scale,w-pad*2,20*scale,13*scale,color,600)];
    rows.forEach((row,index)=>{
      const y=(36+index*36)*scale,type=row.type==='string'?'text':row.type==='event'?'events':row.type;
      children.push(this._text(row.name+' · '+type,pad,y,w-pad*2,18*scale,12*scale,color,600));
      const detail=io.workspaceSourceNames?.[row.id]||'Choose a published endpoint';
      children.push(this._text(detail,pad,y+18*scale,w-pad*2,14*scale,9*scale,'#64748b'));
    });
    if(io.error)children.push(this._text(io.error,pad,h-19*scale,w-pad*2,15*scale,9*scale,'#92400e'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Published endpoint unavailable'});}
})
