// Buttons, commands and rising signals request a captured table download.
// Prepared reports the filename once the result is ready; it does not claim the OS saved a file.
({
  apiVersion:2,
  eventApi:1,
  eventOutputs:{prepared:{type:'string'},failed:{type:'string'}},
  actionEvents:{downloadTable:{success:'prepared',failure:'failed'}},
  inputs:{data:{type:'table'},filename:{role:'control',type:'string',default:'results'},csv:{role:'control',type:'boolean',default:false,event:'action',label:'Prepare CSV'},json:{role:'control',type:'boolean',default:false,event:'action',label:'Prepare JSON'}},
  dataActions:{
    csv:{type:'downloadTable',input:'data',trigger:'csv',format:'csv',filename:'filename'},
    json:{type:'downloadTable',input:'data',trigger:'json',format:'json',filename:'filename'}
  },
  outputs:{rowCount:{type:'number'}},
  initState(){return {};},
  initStyle(){return {w:320,h:150,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1};},
  compute(inputs,state,context={}){
    const table=context.tables?.data;
    if(!table || !Number.isInteger(table.rowCount))throw new Error('Connect a table in Edit');
    return {rowCount:table.rowCount};
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
    const scale=Math.min(w/320,h/150),pad=12*scale;
    const text=(value,x,y,ww,hh,size,color,weight)=>this._text(value,x,y,ww,hh,size*scale,style,color,weight);
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size,dash:style.dash},
      text(io.name?.trim()||'Download table',pad,pad,w-pad*2,22*scale,16,undefined,600)
    ];
    if(io.error || !io.tables?.inputs?.data){children.push(text(io.error||'Connect a table in Edit',pad,55*scale,w-pad*2,22*scale,12,'#92400e'));return children;}
    children.push(text(io.outputs.rowCount+' rows ready to download',pad,49*scale,w-pad*2,24*scale,14));
    for(const [index,label] of ['↓ CSV','↓ JSON'].entries()){
      const x=pad+index*w/2,width=w/2-pad*1.5;
      children.push({type:'rect',x,y:h-51*scale,w:width,h:36*scale,fill:true,fillColor:'#eef2ff',strokeOn:true,color:'#818cf8',size:1});
      children.push(text(label,x+12*scale,h-44*scale,width-24*scale,22*scale,14,'#3730a3',600));
    }
    return children;
  },
  handles(state,w,h,style,io={}){
    return ['csv','json'].map((format,index)=>({id:format,kind:'action',x:w*(index?0.75:0.25),y:h-33*Math.min(w/320,h/150),
      action:{type:'downloadTable',input:'data',format,filename:io.inputs?.filename||'results'}}));
  },
  hitEdit(state,x,y,w,h){const scale=Math.min(w/320,h/150),pad=12*scale;if(y<h-51*scale || y>h-15*scale)return null;
    if(x>=pad && x<=w/2-pad/2)return 'csv';if(x>=w/2+pad && x<=w-pad/2)return 'json';return null;},
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
