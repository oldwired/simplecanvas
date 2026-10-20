// Boolean-controlled two-way Boolean selector: false chooses A; true chooses B.
({
  apiVersion:2,
  eventApi:1,
  eventTransform:{inputs:['a','b','select'],outputs:['value'],reprocess:'reprocess',selection:{input:'select',choices:['a','b']}},
  inputs:{reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'},a:{event:true,type:'boolean'},b:{event:true,type:'boolean'},select:{role:'control',type:'boolean',default:false,event:true}},
  outputs:{value:{type:'boolean',event:true}},
  initState(){return {showIndicators:true};},
  initStyle(){return {w:300,h:210,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _valid(value){return typeof value==='boolean';},
  compute(inputs){
    if(!this._valid(inputs.a) || !this._valid(inputs.b))throw new Error('Selector requires two Boolean inputs');
    if(typeof inputs.select!=='boolean')throw new Error('Selector requires a Boolean selection input');
    return {value:inputs.select?inputs.b:inputs.a};
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
    const inputs=io.error?{}:io.inputs||{},outputs=io.error?{}:io.outputs||{},scale=Math.min(w/300,h/210);
    const available=this._valid(inputs.a)&&this._valid(inputs.b)&&typeof inputs.select==='boolean'&&this._valid(outputs.value);
    const label=value=>this._valid(value)?String(value):'—';
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:'600 '+Math.max(6,size*scale)+'px sans-serif',color:style.textColor||style.color,strokeOn:false,fill:false});
    const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true});
    const dot=(x,y)=>({type:'ellipse',x:x-3*scale,y:y-3*scale,w:6*scale,h:6*scale,fill:true,fillColor:style.fillColor||'#f8fafc',color:style.color,strokeOn:true,size:Math.max(1,scale)});
    const ay=h*.34,by=h*.65,cy=h*.49,selected=inputs.select===true?by:ay;
    const children=[
      {...text('',w*.04,0,w*.92,h*.18,16,'left'),...this._caption(io.name,'Selector',w*.92,h*.18,{...style,fontSize:16*scale})},
      text('A: '+label(inputs.a),w*.02,ay-h*.15,w*.28,h*.12,10),
      text('B: '+label(inputs.b),w*.02,by-h*.15,w*.28,h*.12,10),
      text('Output: '+label(outputs.value),w*.70,cy-h*.15,w*.28,h*.12,10),
      line(w*.02,ay,w*.39,ay),line(w*.02,by,w*.39,by),line(w*.64,cy,w*.98,cy),
      line(w*.64,cy,w*.40,selected),dot(w*.39,ay),dot(w*.39,by),dot(w*.64,cy),
      text('Select: '+(typeof inputs.select==='boolean'?String(inputs.select):'—'),w*.14,h*.73,w*.72,h*.10,11)
    ];
    if(state.showIndicators!==false){
      for(const [x,y,value] of [[w*.06,ay,inputs.a],[w*.06,by,inputs.b],[w*.94,cy,outputs.value],[w*.10,h*.78,inputs.select]]){
        const present=typeof value==='boolean'||Number.isFinite(value),radius=4*scale;
        children.push({type:'ellipse',x:x-radius,y:y-radius,w:radius*2,h:radius*2,fill:true,
          fillColor:present?(typeof value==='number'?'#2563eb':value?'#15803d':'#64748b'):'#fbbf24',strokeOn:true,color:present?'#f8fafc':'#b45309',size:Math.max(1,scale)});
      }
    }
    if(!available)children.push({...text(!io.error || /^Missing value or binding/.test(io.error)?'Inputs required':'Input unavailable',w*.04,h*.87,w*.92,h*.12,10),color:'#92400e'});
    else if(editing){
      children.push({type:'rect',x:w*.05,y:h*.88,w:w*.9,h:h*.09,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly:true});
      children.push({...text('Indicators: '+(state.showIndicators!==false?'on':'off'),w*.05,h*.88,w*.9,h*.09,10),editorOnly:true});
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,inputs:{},outputs:{},error:io.error||'Input unavailable'});},
  handles(state,w,h){return [{id:'indicators',x:w/2,y:h*.925,kind:'click',editorOnly:true}];},
  hitEdit(state,x,y,w,h){return x>=w*.05 && x<=w*.95 && y>=h*.88 && y<=h*.97?'indicators':null;},
  dragEdit(state,handle){return {state:handle==='indicators'?{...state,showIndicators:state.showIndicators===false}:state};}
})
