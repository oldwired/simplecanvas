// Boolean rows/columns light their intersections; row-byte mode uses bit 7 at the left.
// Disabling masks every displayed/output row to zero; invalid input is never treated as off.
({
  apiVersion:2,
  settings:{mode:{type:'string',default:'boolean',options:['boolean','rows'],label:'Input mode'}},
  inputs(state){
    const mode=this._mode(state),ports={};
    if(mode==='boolean'){
      for(let row=0;row<8;row++)ports['row'+row]={type:'boolean',default:false};
      for(let column=0;column<8;column++)ports['col'+column]={type:'boolean',default:false};
    }else for(let row=0;row<8;row++)ports['r'+row]={type:'number',default:0};
    return {...ports,enable:{type:'boolean',default:true}};
  },
  outputs:{r0:{type:'number'},r1:{type:'number'},r2:{type:'number'},r3:{type:'number'},r4:{type:'number'},r5:{type:'number'},r6:{type:'number'},r7:{type:'number'}},
  initState(){return {mode:'boolean'};},
  initStyle(){return {w:400,h:420,fontSize:18,fill:true,fillColor:'#ef4444',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _byte(value){return Number.isInteger(value) && value>=0 && value<=255;},
  _mode(state){
    if(!['boolean','rows'].includes(state.mode))throw new Error('LED matrix input mode must be boolean or rows');
    return state.mode;
  },
  _validate(inputs,state){
    const mode=this._mode(state);
    if(typeof inputs.enable!=='boolean')throw new Error('LED matrix enable must be Boolean');
    if(mode==='boolean'){
      for(const prefix of ['row','col'])for(let index=0;index<8;index++){
        if(typeof inputs[prefix+index]!=='boolean')throw new Error('LED matrix '+prefix+index+' must be Boolean');
      }
    }else{
      for(let row=0;row<8;row++)if(!this._byte(inputs['r'+row]))throw new Error('LED matrix row r'+row+' must be a whole number from 0 to 255');
    }
  },
  compute(inputs,state){
    this._validate(inputs,state);
    const mode=this._mode(state),outputs={};
    for(let row=0;row<8;row++){
      let value=0;
      if(mode==='boolean'){
        if(inputs['row'+row])for(let column=0;column<8;column++)if(inputs['col'+column])value+=128>>column;
      }else value=inputs['r'+row];
      outputs['r'+row]=inputs.enable?value:0;
    }
    return outputs;
  },
  _caption(name,fallback,w,h,style){
    const label=(typeof name==='string'?name:'').trim().replace(/\s+/g,' ')||fallback;
    const units=text=>Array.from(text).reduce((n,c)=>n+(/[MWmw@#%]/.test(c)||c.codePointAt(0)>255?1.1:/[A-Z]/.test(c)?.88:.72),0);
    const width=Math.max(1,w-16),base=Math.min(style.fontSize||20,h*.7);
    let size=Math.min(base,width/Math.max(1,units(label))),lines=[label];
    if(size<Math.min(12,base)){
      size=Math.min(base,12,Math.max(1,h-2)/2.4,width/1.1);lines=[];let rest=label;
      for(let row=0;row<2 && rest;row++){
        let line='';for(const c of rest){if(line && units(line+c)*size>width)break;line+=c;}
        if(line.length<rest.length && line.lastIndexOf(' ')>0)line=line.slice(0,line.lastIndexOf(' '));
        rest=rest.slice(line.length).trim();
        if(row===1 && rest){while(line && units(line+'…')*size>width)line=Array.from(line).slice(0,-1).join('');line+='…';}
        lines.push(line);
      }
    }
    return {text:lines.join('\n'),font:(style.font||'600 20px sans-serif').replace(/\d+(?:\.\d+)?px/,size+'px')};
  },
  children(state,style,w,h,editing,io={}){
    const inputs=io.inputs||{},outputs=io.outputs||{},scale=Math.min(w/400,h/420);
    let mode,available=!io.error;
    try{mode=this._mode(state);this._validate(inputs,state);}catch{available=false;}
    available=available && Array.from({length:8},(_,index)=>'r'+index).every(key=>this._byte(outputs[key]));
    const font=size=>'600 '+Math.max(5,size*scale)+'px sans-serif';
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor||style.color,textColor:style.textColor||style.color,strokeOn:false,fill:false});
    const children=[
      {...text('',w*.04,0,w*.92,h*.12,17,'left'),...this._caption(io.name,'LED matrix',w*.92,h*.12,{...style,fontSize:17*scale})},
      {type:'rect',x:w*.13,y:h*.21,w:w*.84,h:h*.70,fill:true,fillColor:'#0f172a',strokeOn:style.strokeOn,color:style.color,size:style.size}
    ];
    const left=w*.17,top=h*.24,dx=w*.76/8,dy=h*.64/8,diameter=Math.min(dx,dy)*.68;
    for(let column=0;column<8;column++)children.push(text(mode==='rows'?String(128>>column):'C'+column,left+column*dx,h*.145,dx,h*.055,10));
    for(let row=0;row<8;row++){
      const cy=top+(row+.5)*dy;
      children.push(text('R'+row,w*.02,cy-h*.0275,w*.09,h*.055,10));
      for(let column=0;column<8;column++){
        const on=available && (outputs['r'+row] & (128>>column))!==0,cx=left+(column+.5)*dx;
        children.push({type:'ellipse',x:cx-diameter/2,y:cy-diameter/2,w:diameter,h:diameter,
          fill:true,fillColor:available?(on?(style.fillColor||'#ef4444'):'#1e293b'):'#78350f',strokeOn:true,
          color:available?(on?'#fecaca':'#334155'):'#f59e0b',size:Math.max(.5,scale)});
      }
    }
    const error=typeof io.error==='string'?io.error:'';
    const description=mode==='boolean'?'On = row AND column':'8 × 8 · row bytes';
    const note=available?(inputs.enable?description:'Disabled'):
      /whole number from 0 to 255/.test(error)?'Rows require whole numbers from 0 to 255':/^Missing value or binding/.test(error)?'Input required':'Input unavailable';
    children.push({...text(note,w*.04,h*.93,w*.92,h*.055,10),color:available?(style.textColor||style.color):'#92400e',textColor:available?(style.textColor||style.color):'#92400e'});
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,inputs:{},outputs:{},error:io.error||'Input unavailable'});}
})
