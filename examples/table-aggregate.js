// Aggregates selected rows into a bounded, runtime-only table. Saved datasets stay unchanged.
// Null numeric values are ignored; count counts all rows, and null is a distinct group.
({
  apiVersion:2,
  settings:{showSwitch:{type:'boolean',default:true,label:'Show on/off switch'}},
  inputs:{data:{type:'table'},enabled:{role:'control',type:'boolean',default:true},group:{role:'control',type:'string',default:'',columnOf:'data'},value:{role:'control',type:'string',default:'',columnOf:'data',columnType:'number'},operation:{role:'control',type:'string',default:'count',options:['count','sum','average','min','max']}},
  outputs:{data:{type:'table'},rowCount:{type:'number'}},
  initState(){return {showSwitch:true};},
  initStyle(){return {w:320,h:150,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1};},
  compute(inputs,state,context={}){
    const table=context.tables?.data;
    if(!inputs.data || typeof inputs.data.datasetId!=='string' || !table || !Array.isArray(table.columns) || !Array.isArray(table.rows) || table.rowCount!==table.rows.length)throw new Error('Aggregate requires a complete table input');
    if(typeof inputs.enabled!=='boolean')throw new Error('Enabled must be Boolean');
    if(!inputs.enabled)return {data:inputs.data,rowCount:table.rowCount};
    const operation=inputs.operation;
    if(!['count','sum','average','min','max'].includes(operation))throw new Error('Choose count, sum, average, min, or max');
    const group=inputs.group===''?-1:table.columns.findIndex(column=>column.key===inputs.group);
    if(inputs.group!=='' && group<0)throw new Error('Unknown group column: '+inputs.group);
    const value=operation==='count'?-1:table.columns.findIndex(column=>column.key===inputs.value && column.type==='number');
    if(operation!=='count' && value<0)throw new Error('Choose a numeric value column');
    const groups=new Map();
    if(group<0)groups.set(null,{count:0,numeric:0,sum:0,min:null,max:null});
    for(const row of table.rows){
      const key=group<0?null:row[group];
      if(!groups.has(key))groups.set(key,{count:0,numeric:0,sum:0,min:null,max:null});
      const entry=groups.get(key);entry.count++;
      const number=value<0?null:row[value];
      if(number!==null){
        if(typeof number!=='number' || !Number.isFinite(number))throw new Error('Aggregate values must be finite numbers');
        entry.numeric++;entry.sum+=number;entry.min=entry.min===null?number:Math.min(entry.min,number);entry.max=entry.max===null?number:Math.max(entry.max,number);
      }
    }
    const title=operation==='count'?'Count':operation[0].toUpperCase()+operation.slice(1)+' of '+table.columns[value].name;
    const columns=group<0?[]:[{key:'group',name:table.columns[group].name,type:table.columns[group].type}];
    columns.push({key:'result',name:title.slice(0,100),type:'number'});
    const rows=[...groups].map(([key,entry])=>{
      let result=operation==='count'?entry.count:operation==='sum'?entry.sum:operation==='average'?(entry.numeric?entry.sum/entry.numeric:null):entry[operation];
      if(result!==null && (!Number.isFinite(result) || Number.isInteger(result) && !Number.isSafeInteger(result)))throw new Error('Aggregate result exceeds the supported number range');
      return group<0?[result]:[key,result];
    });
    return {data:{table:{name:(table.name+' · '+title).slice(0,120),columns,rows}},rowCount:rows.length};
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
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/320,h/150),pad=12*scale,table=io.tables?.inputs?.data,inputs=io.inputs||{};
    const available=!io.error && table && Number.isInteger(io.outputs?.rowCount),text=(v,x,y,ww,hh,size,color,weight)=>this._text(v,x,y,ww,hh,size*scale,style,color,weight);
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size,dash:style.dash},text(io.name?.trim()||'Table aggregate',pad,pad,w-pad*2,22*scale,16,undefined,600)];
    if(!available){children.push(text(io.error||'Connect a table in Edit',pad,h*.43,w-pad*2,22*scale,12,'#92400e'));return children;}
    const group=table.columns.find(column=>column.key===inputs.group),summary=inputs.operation+' · '+(group?'by '+group.name:'all rows');
    children.push(text(inputs.enabled===false?'Bypassed · original rows':summary,pad,47*scale,w-pad*2,24*scale,14));
    children.push(text(io.outputs.rowCount+(inputs.enabled===false?' rows':' result rows'),pad,78*scale,w-pad*2,26*scale,20,undefined,600));
    if(state.showSwitch!==false){
      const enabled=inputs.enabled===true,linked=io.boundInputs?.includes('enabled')===true,switchX=w-pad-44*scale,switchY=h-31*scale;
      children.push(text((enabled?'On':'Bypass')+(linked?' · connected':''),pad,switchY+2*scale,w-pad*3-44*scale,18*scale,11,'#64748b'),
        {type:'rect',x:switchX,y:switchY,w:44*scale,h:20*scale,fill:true,fillColor:enabled?'#15803d':'#64748b',strokeOn:false},
        {type:'ellipse',x:switchX+(enabled?26:2)*scale,y:switchY+2*scale,w:16*scale,h:16*scale,fill:true,fillColor:linked?'#cbd5e1':'#ffffff',strokeOn:false});
    }
    return children;
  },
  handles(state,w,h,style={},io={}){
    if(state.showSwitch===false || io.error || typeof io.inputs?.enabled!=='boolean' || io.boundInputs?.includes('enabled'))return [];
    const scale=Math.min(w/320,h/150);
    return [{id:'enabled',kind:'boolean',input:'enabled',value:io.inputs.enabled,x:w-34*scale,y:h-21*scale}];
  },
  hitEdit(state,x,y,w,h,style={},io={}){
    if(!this.handles(state,w,h,style,io).length)return null;
    const scale=Math.min(w/320,h/150);return x>=w-60*scale && x<=w-8*scale && y>=h-35*scale && y<=h-7*scale?'enabled':null;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
