// Filters retain references to original dataset rows; they never copy rows into saved state.
// A blank column passes all rows. Comparison values use the selected column's declared type.
({
  apiVersion:2,
  _number(value){return !Number.isFinite(value)?'—':Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(8)));},
  settings:{caseSensitive:{type:'boolean',default:false,label:'Case-sensitive text'}},
  inputs:{data:{type:'table'},column:{role:'control',type:'string',default:'',columnOf:'data'},operation:{role:'control',type:'string',default:'contains',options:['contains','=','≠','>','≥','<','≤','is empty','is not empty']},text:{role:'control',type:'string',default:''},number:{role:'control',type:'number',default:0},boolean:{role:'control',type:'boolean',default:true}},
  outputs:{data:{type:'table'},rowCount:{type:'number'}},
  initState(){return {caseSensitive:false};},
  initStyle(){return {w:320,h:150,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1};},
  compute(inputs,state,context={}){
    const table=context.tables?.data;
    if(!inputs.data || typeof inputs.data.datasetId!=='string' || !table || !Array.isArray(table.columns) || !Array.isArray(table.rows) || !Array.isArray(table.rowIndices) || table.rows.length!==table.rowIndices.length || table.rowCount!==table.rows.length)throw new Error('Filter requires a complete table input');
    if(typeof inputs.column!=='string')throw new Error('Column must be a column key');
    if(inputs.column==='')return {data:inputs.data,rowCount:table.rowCount};
    const index=table.columns.findIndex(column=>column.key===inputs.column);
    if(index<0)throw new Error('Unknown filter column: '+inputs.column);
    const type=table.columns[index].type,operation=inputs.operation;
    if(!['string','number','boolean'].includes(type))throw new Error('Unsupported column type');
    if(!['contains','=','≠','>','≥','<','≤','is empty','is not empty'].includes(operation))throw new Error('Unsupported filter operation');
    if(operation==='contains' && type!=='string')throw new Error('Contains requires a text column');
    if(['>','≥','<','≤'].includes(operation) && type!=='number')throw new Error('Ordered comparisons require a numeric column');
    const fold=value=>type==='string' && state.caseSensitive!==true?value.toLowerCase():value;
    const target=type==='string'?inputs.text:type==='number'?inputs.number:inputs.boolean;
    if(!['is empty','is not empty'].includes(operation) && (typeof target!==type || type==='number' && !Number.isFinite(target)))throw new Error('Filter value must match the selected column type');
    const rows=[];
    for(let r=0;r<table.rows.length;r++){
      const value=table.rows[r][index],empty=value===null || value==='';
      let match=false;
      if(operation==='is empty')match=empty;
      else if(operation==='is not empty')match=!empty;
      else if(value!==null){
        if(typeof value!==type || type==='number' && !Number.isFinite(value))throw new Error('Cell does not match its column type');
        const a=fold(value),b=fold(target);
        switch(operation){
          case 'contains':match=a.includes(b);break;
          case '=':match=a===b;break;
          case '≠':match=a!==b;break;
          case '>':match=a>b;break;
          case '≥':match=a>=b;break;
          case '<':match=a<b;break;
          case '≤':match=a<=b;break;
        }
      }
      if(match)rows.push(table.rowIndices[r]);
    }
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
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size,dash:style.dash},
      text(io.name?.trim()||'Table filter',pad,pad,w-pad*2,22*scale,16,undefined,600)
    ];
    if(!available){children.push(text(io.error||'Connect a table in Edit',pad,h*.43,w-pad*2,22*scale,12,'#92400e'));return children;}
    const column=table.columns.find(column=>column.key===inputs.column),target=column?.type==='number'?inputs.number:column?.type==='boolean'?inputs.boolean:inputs.text;
    const condition=column?column.name+' '+inputs.operation+(['is empty','is not empty'].includes(inputs.operation)?'':' '+(typeof target==='string'?'“'+target+'”':typeof target==='number'?this._number(target):target)):'All rows';
    children.push(text(condition,pad,47*scale,w-pad*2,24*scale,14));
    children.push(text(io.outputs.rowCount+' of '+table.rowCount+' rows',pad,84*scale,w-pad*2,26*scale,20,undefined,600));
    if(column?.type==='string' && state.caseSensitive!==true && !['is empty','is not empty'].includes(inputs.operation))children.push(text('Ignoring letter case',pad,h-26*scale,w-pad*2,16*scale,10,'#64748b'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
