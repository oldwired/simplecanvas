// Stable sorting retains original row references. Empty cells always sort last.
({
  apiVersion:2,
  settings:{caseSensitive:{type:'boolean',default:false,label:'Case-sensitive text'},showSwitch:{type:'boolean',default:true,label:'Show on/off switch'}},
  inputs:{data:{type:'table'},enabled:{type:'boolean',default:true},column:{type:'string',default:'',columnOf:'data'},direction:{type:'string',default:'ascending',options:['ascending','descending']}},
  outputs:{data:{type:'table'},rowCount:{type:'number'}},
  initState(){return {caseSensitive:false,showSwitch:true};},
  initStyle(){return {w:320,h:150,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1};},
  compute(inputs,state,context={}){
    const table=context.tables?.data;
    if(!inputs.data || typeof inputs.data.datasetId!=='string' || !table || !Array.isArray(table.rows) || !Array.isArray(table.rowIndices) || table.rows.length!==table.rowIndices.length || table.rowCount!==table.rows.length)throw new Error('Sort requires a complete table input');
    if(typeof inputs.enabled!=='boolean')throw new Error('Enabled must be Boolean');
    if(!inputs.enabled)return {data:inputs.data,rowCount:table.rowCount};
    if(inputs.column==='')return {data:inputs.data,rowCount:table.rowCount};
    const index=table.columns.findIndex(column=>column.key===inputs.column);
    if(index<0)throw new Error('Unknown sort column: '+inputs.column);
    if(!['ascending','descending'].includes(inputs.direction))throw new Error('Choose ascending or descending order');
    const type=table.columns[index].type,sign=inputs.direction==='descending'?-1:1;
    const fold=value=>type==='string' && state.caseSensitive!==true?value.toLowerCase():value;
    const rows=table.rows.map((row,index)=>index).sort((a,b)=>{
      const x=table.rows[a][index],y=table.rows[b][index];
      if(x===null || y===null)return x===y?a-b:x===null?1:-1;
      const u=fold(x),v=fold(y);return u===v?a-b:(u<v?-1:1)*sign;
    }).map(index=>table.rowIndices[index]);
    return {data:{datasetId:inputs.data.datasetId,rows},rowCount:rows.length};
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
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size,dash:style.dash},text(io.name?.trim()||'Table sort',pad,pad,w-pad*2,22*scale,16,undefined,600)];
    if(!available){children.push(text(io.error||'Connect a table in Inputs',pad,h*.43,w-pad*2,22*scale,12,'#92400e'));return children;}
    const column=table.columns.find(column=>column.key===inputs.column),summary=column?column.name+' · '+inputs.direction:'Original row order';
    children.push(text(inputs.enabled===false?'Bypassed · original rows':summary,pad,47*scale,w-pad*2,24*scale,14));
    children.push(text(io.outputs.rowCount+' rows',pad,78*scale,w-pad*2,26*scale,20,undefined,600));
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
