// Select an embedded dataset for Data in Inputs. Rows remain in the document's dataset store.
({
  apiVersion:2,
  settings:{allowReaderImport:{type:'boolean',default:false,label:'Allow data replacement'}},
  inputs:{data:{type:'table'},reload:{type:'boolean',default:false}},
  dataActions:{reload:{type:'reloadDataset',input:'data',trigger:'reload'}},
  outputs:{data:{type:'table'},rowCount:{type:'number'}},
  initState(){return {allowReaderImport:false};},
  initStyle(){return {w:300,h:150,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1};},
  compute(inputs,state,context={}){
    const table=context.tables?.data;
    if(!inputs.data || typeof inputs.data.datasetId!=='string' || !table || !Number.isInteger(table.rowCount) || table.rowCount<0)throw new Error('Choose an embedded dataset in Inputs');
    return {data:inputs.data,rowCount:table.rowCount};
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
    const scale=Math.min(w/300,h/150),pad=12*scale,table=io.tables?.inputs?.data;
    const available=!io.error && table && Number.isInteger(io.outputs?.rowCount),text=(v,x,y,ww,hh,size,color,weight)=>this._text(v,x,y,ww,hh,size*scale,style,color,weight);
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size,dash:style.dash},
      text(io.name?.trim()||'Dataset',pad,pad,w-pad*2,22*scale,16,undefined,600)
    ];
    if(!available){children.push(text('Choose a dataset in Inputs',pad,h*.48,w-pad*2,22*scale,12,'#92400e'));return children;}
    const count=io.outputs.rowCount,columnCount=table.columns.length;
    children.push(text(table.name||'Embedded data',pad,43*scale,w-pad*2,20*scale,13));
    children.push(text(count+' '+(count===1?'row':'rows')+' · '+columnCount+' '+(columnCount===1?'column':'columns'),pad,72*scale,w-pad*2,25*scale,18,undefined,600));
    if(state.allowReaderImport===true){
      children.push({type:'rect',x:pad,y:h-40*scale,w:w-pad*2,h:28*scale,fill:true,fillColor:'#eef2ff',strokeOn:true,color:'#818cf8',size:1});
      children.push(text('Load data…',pad+10*scale,h-35*scale,w-pad*2-20*scale,20*scale,13,'#3730a3',600));
    }else children.push(text(table.columns.map(column=>column.name).join(' · '),pad,h-30*scale,w-pad*2,18*scale,11,'#64748b'));
    return children;
  },
  handles(state,w,h){return state.allowReaderImport===true?[{id:'loadData',kind:'action',x:w/2,y:h-26*Math.min(w/300,h/150),action:{type:'importDataset',input:'data'}}]:[];},
  hitEdit(state,x,y,w,h){const scale=Math.min(w/300,h/150);return state.allowReaderImport===true && x>=12*scale && x<=w-12*scale && y>=h-40*scale && y<=h-12*scale?'loadData':null;},
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
