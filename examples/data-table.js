// View or edit shared dataset records. The host validates every write; drawing stays read-only.
({
  apiVersion:2,
  _number(value){return !Number.isFinite(value)?'—':Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(8)));},
  tablePresentation:'full',
  settings:{maxRows:{type:'number',default:12,min:1,max:12,step:1,label:'Visible rows'},maxColumns:{type:'number',default:8,min:1,max:8,step:1,label:'Visible columns'},showCounts:{type:'boolean',default:true,label:'Show row count'},editDataset:{type:'boolean',default:false,label:'Edit dataset records'},allowReaderEdit:{type:'boolean',default:false,label:'Allow reader edits'}},
  inputs:{data:{type:'table'},startRow:{role:'control',type:'number',default:0},startColumn:{role:'control',type:'number',default:0}},
  outputs:{rowCount:{type:'number'}},
  initState(){return {maxRows:12,maxColumns:8,showCounts:true,editDataset:false,allowReaderEdit:false};},
  initStyle(){return {w:720,h:440,fontSize:13,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1};},
  compute(inputs,state,context={}){
    const table=context.tables?.data;
    if(!table || !Number.isInteger(table.rowCount) || table.rowCount<0)throw new Error('Connect a table in Edit');
    for(const key of ['startRow','startColumn'])if(inputs[key]!==undefined && (!Number.isSafeInteger(inputs[key]) || inputs[key]<0))throw new Error('First row and first column must be nonnegative integers');
    return {rowCount:table.rowCount};
  },
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400,align='left'){
    const units=char=>/[MWmw@#%]/.test(char)||char.codePointAt(0)>255?1.1:/[A-Z]/.test(char)?.88:.72;
    const chars=Array.from((typeof value==='number'?this._number(value):String(value)).replace(/\s+/g,' '));let text='',used=0;
    for(let i=0;i<chars.length;i++){
      const next=units(chars[i]),remaining=i<chars.length-1?1.1:0;
      if((used+next+remaining)*size>w){text+='…';break;}
      text+=chars[i];used+=next;
    }
    return {type:'text',x,y,w,h,text,plainText:true,align,font:weight+' '+size+'px sans-serif',color,strokeOn:false};
  },
  _view(state,w,h,io){
    const scale=Math.min(1,w/360,h/240),pad=10*scale,table=io.tables?.inputs?.data;
    const bodyY=48*scale,header=36*scale,rowHeight=24*scale,footer=60*scale;
    const rowLimit=Math.max(1,Math.min(12,Number.isInteger(state.maxRows)?state.maxRows:12));
    const columnLimit=Math.max(1,Math.min(8,Number.isInteger(state.maxColumns)?state.maxColumns:8));
    const pageRows=Math.max(1,Math.min(rowLimit,Math.floor((h-bodyY-header-footer)/rowHeight)));
    const startRow=Math.max(0,Math.min(Math.max(0,(table?.rowCount||0)-1),Number.isSafeInteger(io.inputs?.startRow)?io.inputs.startRow:0));
    const startColumn=Math.max(0,Math.min(Math.max(0,(table?.columns.length||0)-1),Number.isSafeInteger(io.inputs?.startColumn)?io.inputs.startColumn:0));
    const editable=state.editDataset===true && table?.editable===true && !io.error;
    const numberWidth=38*scale,deleteWidth=editable?26*scale:0,width=w-pad*2;
    const columns=table?.columns.slice(startColumn,startColumn+columnLimit)||[],rows=table?.rows.slice(startRow,startRow+pageRows)||[];
    return {scale,pad,table,bodyY,header,rowHeight,pageRows,columnLimit,startRow,startColumn,editable,numberWidth,deleteWidth,width,columns,rows,
      cellWidth:(width-numberWidth-deleteWidth)/Math.max(1,columns.length),footerY:h-50*scale};
  },
  _pages(count,step,current,label){
    const starts=Array.from({length:Math.max(1,Math.ceil(count/step))},(_,index)=>index*step);
    if(!starts.includes(current)){if(starts.length>=1000)starts.pop();starts.push(current);}starts.sort((a,b)=>a-b);
    return starts.map(value=>({value,label:label+' '+value+(count>value+1?'–'+Math.min(count-1,value+step-1):'')}));
  },
  children(state,style,w,h,editing,io={}){
    const g=this._view(state,w,h,io),{scale,pad,table,bodyY,header,rowHeight,width}=g;
    const text=(v,x,y,ww,hh,size,color,weight,align)=>this._text(v,x,y,ww,hh,size*scale,style,color,weight,align);
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size,dash:style.dash},text(io.name?.trim()||'Dataset editor',pad,pad,w-pad*2,25*scale,16,undefined,600)];
    if(io.error || !table){children.push(text(io.error||'Connect a table in Edit',pad,bodyY,width,24*scale,13,'#92400e'));return children;}
    children.push({type:'rect',x:pad,y:bodyY,w:width,h:header,fill:true,fillColor:'#e2e8f0',strokeOn:false});
    children.push(text('#',pad+4*scale,bodyY+8*scale,g.numberWidth-8*scale,18*scale,11,'#64748b'));
    g.columns.forEach((column,index)=>{
      const x=pad+g.numberWidth+index*g.cellWidth+5*scale;
      children.push(text(column.name,x,bodyY+3*scale,g.cellWidth-10*scale,16*scale,12,undefined,600));
      children.push(text(column.type,x,bodyY+19*scale,g.cellWidth-10*scale,13*scale,9,'#64748b'));
    });
    g.rows.forEach((row,index)=>{
      const y=bodyY+header+rowHeight*index;
      if(index%2===1)children.push({type:'rect',x:pad,y,w:width,h:rowHeight,fill:true,fillColor:'#f1f5f9',strokeOn:false});
      children.push(text(g.startRow+index,pad+4*scale,y+4*scale,g.numberWidth-8*scale,rowHeight-8*scale,10,'#64748b'));
      g.columns.forEach((column,col)=>{
        const value=row[g.startColumn+col];
        children.push(text(value===null?'—':value,pad+g.numberWidth+col*g.cellWidth+5*scale,y+4*scale,g.cellWidth-10*scale,rowHeight-8*scale,12,value===null?'#94a3b8':undefined,400,column.type==='number'?'right':'left'));
      });
      if(g.editable)children.push({...text('×',w-pad-g.deleteWidth,y+2*scale,g.deleteWidth,rowHeight-4*scale,16,'#b91c1c',400,'center'),editorOnly:state.allowReaderEdit!==true});
    });
    if(table.rowCount===0)children.push(text('No matching rows',pad,bodyY+header+8*scale,width,24*scale,13,'#64748b'));
    for(const control of this._controls(state,w,h,io,g)){
      const box=control.inline||control.box;
      children.push({type:'rect',x:box.x,y:box.y,w:box.w,h:box.h,fill:true,fillColor:control.disabled?'#f8fafc':'#eef2ff',strokeOn:true,color:'#cbd5e1',size:1,editorOnly:control.editorOnly===true});
      children.push({...text(control.label,box.x+7*scale,box.y+5*scale,box.w-14*scale,box.h-10*scale,11,control.disabled?'#94a3b8':'#334155',400,'center'),editorOnly:control.editorOnly===true});
    }
    const more=table.rowCount>g.rows.length||table.columns.length>g.columns.length;
    if(state.showCounts!==false||more){
      const counts=table.rowCount>g.rows.length?'Showing '+g.rows.length+' of '+table.rowCount+' rows':table.rowCount+' '+(table.rowCount===1?'row':'rows');
      const columns=table.columns.length>g.columns.length?' · '+g.columns.length+' of '+table.columns.length+' columns':'';
      children.push(text(counts+columns,pad,h-19*scale,width,14*scale,10,'#64748b'));
    }
    return children;
  },
  _controls(state,w,h,io,g=this._view(state,w,h,io)){
    if(io.error||!g.table)return [];
    const controls=[],gap=8*g.scale,buttonHeight=26*g.scale,addWidth=g.editable?100*g.scale:0;
    const pageWidth=(g.width-addWidth-(addWidth?2:1)*gap)/2;
    for(const [index,key,count,step,start,label] of [[0,'startRow',g.table.rowCount,g.pageRows,g.startRow,'Rows'],[1,'startColumn',g.table.columns.length,g.columnLimit,g.startColumn,'Columns']]){
      const inline={x:g.pad+index*(pageWidth+gap),y:g.footerY,w:pageWidth,h:buttonHeight,fontSize:11*g.scale};
      const end=Math.min(Math.max(0,count-1),start+step-1),disabled=(io.boundInputs||[]).includes(key);
      controls.push({id:key,kind:'choice',input:key,value:io.inputs?.[key]??0,options:this._pages(count,step,io.inputs?.[key]??0,label),inline,x:inline.x+inline.w/2,y:inline.y+inline.h/2,label:(key==='startColumn'?'Cols':label)+' '+start+(end>start?'–'+end:'')+(disabled?' · linked':' ▾'),disabled});
    }
    if(g.editable){
      const box={x:w-g.pad-addWidth,y:g.footerY,w:addWidth,h:buttonHeight};
      const whole=io.inputs?.data?.rows===undefined,disabled=!whole||g.table.rowCount>=1000;
      controls.push({id:'addRow',kind:'action',x:box.x+box.w/2,y:box.y+box.h/2,box,label:'+ Record',disabled,editorOnly:state.allowReaderEdit!==true,action:{type:'appendDatasetRow',input:'data',datasetId:g.table.datasetId,revision:g.table.revision}});
    }
    return controls;
  },
  handles(state,w,h,style={},io={}){
    const g=this._view(state,w,h,io);if(io.error||!g.table||g.scale<1/11||g.cellWidth<1)return [];
    const handles=this._controls(state,w,h,io,g).filter(control=>!control.disabled).map(({label,disabled,box,...handle})=>handle);
    if(!g.editable)return handles;
    for(let row=0;row<g.rows.length;row++){
      const rowId=g.table.rowIds?.[g.startRow+row];if(!rowId)continue;
      const y=g.bodyY+g.header+row*g.rowHeight;
      g.columns.forEach((column,col)=>{
        const value=g.rows[row][g.startColumn+col],x=g.pad+g.numberWidth+col*g.cellWidth;
        handles.push({id:'cell-'+row+'-'+col,kind:'text',value:value===null?'':String(value),x:x+g.cellWidth/2,y:y+g.rowHeight/2,inline:{x,y,w:g.cellWidth,h:g.rowHeight,fontSize:12*g.scale,mode:'edit',align:column.type==='number'?'right':'left',references:false},datasetCell:{input:'data',datasetId:g.table.datasetId,rowId,column:column.key,revision:g.table.revision},editorOnly:state.allowReaderEdit!==true});
      });
      handles.push({id:'delete-'+row,kind:'action',x:w-g.pad-g.deleteWidth/2,y:y+g.rowHeight/2,editorOnly:state.allowReaderEdit!==true,action:{type:'deleteDatasetRow',input:'data',datasetId:g.table.datasetId,revision:g.table.revision,rowId}});
    }
    return handles;
  },
  hitEdit(state,x,y,w,h,style={},io={}){
    const g=this._view(state,w,h,io);
    for(const handle of this.handles(state,w,h,style,io)){
      const box=handle.inline;
      if(box&&x>=box.x&&x<=box.x+box.w&&y>=box.y&&y<=box.y+box.h)return handle.id;
      const halfW=handle.id==='addRow'?50*g.scale:g.deleteWidth/2;
      if(!box&&Math.abs(x-handle.x)<=halfW&&Math.abs(y-handle.y)<=g.rowHeight/2)return handle.id;
    }
    return null;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
