// One horizontal bar per row, with a shared zero baseline for positive and negative values.
// Blank Category/Value choose the first column and first numeric column respectively.
({
  apiVersion:2,
  _number(value){return !Number.isFinite(value)?'—':Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(8)));},
  settings:{maxBars:{type:'number',default:12,min:1,max:24,step:1,label:'Visible bars'},showValues:{type:'boolean',default:true,label:'Show values'}},
  inputs:{data:{type:'table'},category:{role:'control',type:'string',default:'',columnOf:'data'},value:{role:'control',type:'string',default:'',columnOf:'data',columnType:'number'}},
  outputs:{rowCount:{type:'number'}},
  initState(){return {maxBars:12,showValues:true};},
  initStyle(){return {w:600,h:360,fontSize:13,fill:true,fillColor:'#2563eb',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1};},
  _columns(inputs,table){
    const category=inputs.category===''?0:table.columns.findIndex(column=>column.key===inputs.category);
    const value=inputs.value===''?table.columns.findIndex(column=>column.type==='number'):table.columns.findIndex(column=>column.key===inputs.value);
    if(category<0)throw new Error('Unknown chart category column: '+inputs.category);
    if(value<0 || table.columns[value].type!=='number')throw new Error('Choose a numeric chart value column');
    return {category,value};
  },
  compute(inputs,state,context={}){
    const table=context.tables?.data;
    if(!table || !Array.isArray(table.columns) || !Number.isInteger(table.rowCount) || table.rowCount<0)throw new Error('Connect a table in Edit');
    this._columns(inputs,table);
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
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/600,h/360),pad=12*scale,table=io.tables?.inputs?.data;
    const text=(v,x,y,ww,hh,size,color,weight,align)=>this._text(v,x,y,ww,hh,size*scale,style,color,weight,align);
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:'#ffffff',strokeOn:style.strokeOn,color:style.color,size:style.size,dash:style.dash},
      text(io.name?.trim()||'Data bar chart',pad,pad,w-pad*2,25*scale,16,undefined,600)
    ];
    let selected,error=io.error;
    if(!error && table){try{selected=this._columns(io.inputs||{},table);}catch(caught){error=caught.message;}}
    if(error || !table || !selected){children.push(text(error||'Connect a table in Edit',pad,50*scale,w-pad*2,24*scale,13,'#92400e'));return children;}
    const {category,value}=selected,maxBars=Math.max(1,Math.min(24,Number.isInteger(state.maxBars)?state.maxBars:12));
    const bodyY=62*scale,bodyHeight=h-bodyY-40*scale,limit=Math.max(1,Math.floor(bodyHeight/(12*scale)));
    const rows=table.rows.slice(0,Math.min(maxBars,limit)),rowHeight=bodyHeight/Math.max(1,rows.length);
    const chartX=pad+100*scale,chartW=w-chartX-pad-(state.showValues!==false?78*scale:0);
    const values=rows.map(row=>row[value]).filter(v=>typeof v==='number' && Number.isFinite(v)),magnitude=Math.max(1,...values.map(v=>Math.abs(v)));
    const normalized=values.map(v=>v/magnitude),minimum=Math.min(0,...normalized),maximum=Math.max(0,...normalized),range=maximum-minimum||1;
    const xAt=v=>chartX+((v/magnitude-minimum)/range)*chartW,zero=xAt(0);
    children.push(text(table.columns[value].name,pad,38*scale,w-pad*2,16*scale,11,'#64748b'));
    children.push({type:'line',x1:zero,y1:bodyY,x2:zero,y2:bodyY+bodyHeight,color:'#94a3b8',size:Math.max(.5,scale),strokeOn:true});
    rows.forEach((row,index)=>{
      const y=bodyY+index*rowHeight,v=row[value],label=row[category]===null?'—':row[category];
      children.push(text(label,pad,y+rowHeight*.2,92*scale,rowHeight*.6,Math.min(12,rowHeight/(scale*1.7))));
      if(typeof v==='number' && Number.isFinite(v)){
        const x=xAt(v),barWidth=Math.abs(x-zero);
        if(barWidth>0)children.push({type:'rect',x:Math.min(zero,x),y:y+rowHeight*.18,w:barWidth,h:rowHeight*.64,fill:true,fillColor:style.fillColor||'#2563eb',strokeOn:false});
      }
      if(state.showValues!==false)children.push(text(v===null?'—':v,chartX+chartW+6*scale,y+rowHeight*.2,72*scale,rowHeight*.6,Math.min(11,rowHeight/(scale*1.7)),v===null?'#94a3b8':undefined,400,'right'));
    });
    if(table.rowCount===0)children.push(text('No matching rows',chartX,bodyY+12*scale,chartW,24*scale,13,'#64748b'));
    children.push(text(table.rowCount>rows.length?'Showing '+rows.length+' of '+table.rowCount+' rows':table.rowCount+' '+(table.rowCount===1?'row':'rows'),pad,h-25*scale,w-pad*2,17*scale,10,'#64748b'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
