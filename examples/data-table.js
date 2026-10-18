// A bounded view of a connected table. Rendering never changes the data or its row count.
({
  apiVersion:2,
  settings:{maxRows:{type:'number',default:12,min:1,max:20,step:1,label:'Visible rows'},showCounts:{type:'boolean',default:true,label:'Show row count'}},
  inputs:{data:{type:'table'}},
  outputs:{rowCount:{type:'number'}},
  initState(){return {maxRows:12,showCounts:true};},
  initStyle(){return {w:600,h:360,fontSize:13,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1};},
  compute(inputs,state,context={}){
    const table=context.tables?.data;
    if(!table || !Number.isInteger(table.rowCount) || table.rowCount<0)throw new Error('Connect a table in Inputs');
    return {rowCount:table.rowCount};
  },
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400,align='left'){
    const units=char=>/[MWmw@#%]/.test(char)||char.codePointAt(0)>255?1.1:/[A-Z]/.test(char)?.88:.72;
    const chars=Array.from(String(value).replace(/\s+/g,' '));let text='',used=0;
    for(let i=0;i<chars.length;i++){
      const next=units(chars[i]),remaining=i<chars.length-1?1.1:0;
      if((used+next+remaining)*size>w){text+='…';break;}
      text+=chars[i];used+=next;
    }
    return {type:'text',x,y,w,h,text,plainText:true,align,font:weight+' '+size+'px sans-serif',color,strokeOn:false};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/600,h/360),pad=10*scale,table=io.tables?.inputs?.data,bodyY=44*scale;
    const text=(v,x,y,ww,hh,size,color,weight,align)=>this._text(v,x,y,ww,hh,size*scale,style,color,weight,align);
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size,dash:style.dash},
      text(io.name?.trim()||'Data table',pad,pad,w-pad*2,25*scale,16,undefined,600)
    ];
    if(io.error || !table){children.push(text('Connect a table in Inputs',pad,bodyY,w-pad*2,24*scale,13,'#92400e'));return children;}
    const columns=table.columns.slice(0,8),width=w-pad*2,cellWidth=width/Math.max(1,columns.length),rowHeight=22*scale;
    const maxRows=Math.max(1,Math.min(20,Number.isInteger(state.maxRows)?state.maxRows:12)),room=Math.max(0,Math.floor((h-bodyY-rowHeight-28*scale)/rowHeight));
    const rows=table.rows.slice(0,Math.min(maxRows,room)),hasMore=table.rowCount>rows.length || table.columns.length>columns.length;
    children.push({type:'rect',x:pad,y:bodyY,w:width,h:rowHeight,fill:true,fillColor:'#e2e8f0',strokeOn:false});
    columns.forEach((column,index)=>children.push(text(column.name,pad+index*cellWidth+5*scale,bodyY+3*scale,cellWidth-10*scale,rowHeight-6*scale,12,undefined,600)));
    rows.forEach((row,index)=>{
      const y=bodyY+rowHeight*(index+1);
      if(index%2===1)children.push({type:'rect',x:pad,y,w:width,h:rowHeight,fill:true,fillColor:'#f1f5f9',strokeOn:false});
      columns.forEach((column,col)=>children.push(text(row[col]===null?'—':row[col],pad+col*cellWidth+5*scale,y+3*scale,cellWidth-10*scale,rowHeight-6*scale,12,row[col]===null?'#94a3b8':undefined,400,column.type==='number'?'right':'left')));
    });
    if(table.rowCount===0)children.push(text('No matching rows',pad,bodyY+rowHeight+8*scale,width,24*scale,13,'#64748b'));
    if(state.showCounts!==false || hasMore){
      const counts=table.rowCount>rows.length?'Showing '+rows.length+' of '+table.rowCount+' rows':table.rowCount+' '+(table.rowCount===1?'row':'rows');
      const omitted=table.columns.length>columns.length?' · '+columns.length+' of '+table.columns.length+' columns':'';
      children.push(text(counts+omitted,pad,h-24*scale,width,16*scale,10,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
