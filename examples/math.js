// Ordered arithmetic on two required numbers. Choose the operation in Edit.
// Numeric indicators show availability, including zero; unavailable values stay blank.
({
  apiVersion:2,
  eventApi:1,
  eventTransform:{input:'a',outputs:['value'],reprocess:'reprocess'},
  inputs:{reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'},a:{event:true,type:'number'},b:{type:'number'},operation:{role:'control',type:'string',default:'+',options:['+','−','×','÷','min','max']}},
  outputs:{value:{event:true,type:'number'}},
  initState(){return {showIndicators:true};},
  initStyle(){return {w:300,h:180,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  compute(inputs){
    if(!Number.isFinite(inputs.a) || !Number.isFinite(inputs.b))throw new Error('Input values must be finite numbers');
    let value;
    switch(inputs.operation){
      case '+':value=inputs.a+inputs.b;break;
      case '−':value=inputs.a-inputs.b;break;
      case '×':value=inputs.a*inputs.b;break;
      case 'min':value=Math.min(inputs.a,inputs.b);break;
      case 'max':value=Math.max(inputs.a,inputs.b);break;
      case '÷':
        if(inputs.b===0)throw new Error('Division by zero');
        value=inputs.a/inputs.b;break;
      default:throw new Error('Unsupported operation');
    }
    if(!Number.isFinite(value))throw new Error('Calculation overflow');
    return {value};
  },
  _number(value){return !Number.isFinite(value)?'—':Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(8)));},
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
    const inputs=io.error?{}:io.inputs||{},outputs=io.error?{}:io.outputs||{},scale=Math.min(w/300,h/180);
    const font=size=>'600 '+Math.max(6,size*scale)+'px sans-serif';
    const label=value=>this._number(value);
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:font(size),color:style.textColor||style.color,strokeOn:false,fill:false});
    const operation=['+','−','×','÷','min','max'].includes(inputs.operation)?inputs.operation:null;
    const available=Number.isFinite(inputs.a)&&Number.isFinite(inputs.b)&&Number.isFinite(outputs.value)&&operation!==null;
    const title={...text('',w*.04,0,w*.92,h*.2,18,'left'),...this._caption(io.name,'Math',w*.92,h*.2,{...style,fontSize:18*scale})};
    const cy=h*.49,ay=h*.38,by=h*.65;
    const children=[
      title,
      {type:'line',x1:w*.02,y1:ay,x2:w*.30,y2:ay,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true},
      {type:'line',x1:w*.02,y1:by,x2:w*.30,y2:by,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true},
      {type:'line',x1:w*.69,y1:cy,x2:w*.98,y2:cy,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true},
      text('A: '+label(inputs.a),0,h*.25,w*.29,h*.12,10),
      text('B: '+label(inputs.b),0,h*.52,w*.29,h*.12,10),
      text('Output',w*.71,h*.22,w*.29,h*.12,10.5),
      text(label(outputs.value),w*.71,h*.35,w*.29,h*.12,10),
      {type:'rect',x:w*.30,y:h*.25,w:w*.39,h:h*.48,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      text(available?operation:'+ − × ÷',w*.30,h*.25,w*.39,h*.48,available?(operation.length>1?26:34):20)
    ];
    if(state.showIndicators!==false){
      const radius=4*scale;
      for(const [x,y,value] of [[w*.045,ay,inputs.a],[w*.045,by,inputs.b],[w*.955,cy,outputs.value]]){
        const present=Number.isFinite(value);
        children.push({type:'ellipse',x:x-radius,y:y-radius,w:radius*2,h:radius*2,fill:true,
          fillColor:present?'#2563eb':'#fbbf24',strokeOn:true,color:present?'#f8fafc':'#b45309',size:Math.max(1,scale)});
      }
    }
    if(io.error || !available){
      const error=typeof io.error==='string'?io.error:'';
      const note=/Division by zero/i.test(error)?'Calculation unavailable\nCannot divide by zero':
        /Calculation overflow|non.?finite/i.test(error)?'Calculation unavailable\nResult is outside the numeric range':
        /Unsupported operation/i.test(error)?'Calculation unavailable\nChoose an operation in Edit':
        !error || /^Missing value or binding/.test(error)?'Input required':'Input unavailable';
      children.push({...text(note,w*.04,h*.77,w*.92,h*.22,10.5),color:'#92400e'});
    }
    if(editing && available && !io.error){
      children.push({type:'rect',x:w*.05,y:h*.84,w:w*.9,h:h*.13,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly:true});
      children.push({...text('Indicators: '+(state.showIndicators!==false?'on':'off'),w*.05,h*.84,w*.9,h*.13,10.5),editorOnly:true});
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,inputs:{},outputs:{}});},
  handles(state,w,h){return [{id:'indicators',x:w/2,y:h*.905,kind:'click',editorOnly:true}];},
  hitEdit(state,x,y,w,h){return x>=w*.05 && x<=w*.95 && y>=h*.84 && y<=h*.97?'indicators':null;},
  dragEdit(state,handle){return {state:handle==='indicators'?{...state,showIndicators:state.showIndicators===false}:state};}
})
