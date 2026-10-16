// Required numeric input; a missing connection remains unavailable, never zero.
// Configure the strict greater-than threshold and optional indicators in the editor.
// A blue input indicator means the numeric value is available, not that it is true.
({
  apiVersion:2,
  inputs:{value:{type:'number'}},
  outputs:{value:{type:'boolean'}},
  initState(){return {threshold:70,showIndicators:true};},
  initStyle(){return {w:260,h:180,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b'};},
  _threshold(state){return Number.isFinite(state.threshold)?state.threshold:70;},
  compute(inputs,state){return {value:inputs.value>this._threshold(state)};},
  unavailableChildren(state,style,w,h,editing,io){return this.children(state,style,w,h,false,io);},
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
    const scale=Math.min(w/260,h/180),font=size=>'600 '+size*scale+'px sans-serif';
    const left=w*.12,right=w*.88,cy=h*.49,indicator=8*scale;
    const textColor=style.textColor||style.color;
    const input=io.inputs?.value,output=io.outputs?.value;
    const hasInput=Number.isFinite(input),hasOutput=typeof output==='boolean';
    const children=[
      {type:'text',x:0,y:0,w,h:h*.16,...this._caption(io.name,'Compare',w,h*.16,{...style,fontSize:18*scale}),align:'center',color:textColor,strokeOn:false},
      {type:'rect',x:left,y:h*.19,w:right-left,h:h*.48,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      {type:'line',x1:w*.02,y1:cy,x2:left,y2:cy,color:style.color,size:style.size,strokeOn:style.strokeOn},
      {type:'line',x1:right,y1:cy,x2:w*.98,y2:cy,color:style.color,size:style.size,strokeOn:style.strokeOn},
      {type:'text',x:left,y:h*.25,w:w*.24,h:h*.12,text:'Input',align:'center',font:font(12),color:textColor,strokeOn:false},
      {type:'text',x:left,y:h*.38,w:w*.24,h:h*.16,text:hasInput?String(input):'—',align:'center',font:font(16),color:textColor,strokeOn:false},
      {type:'text',x:w*.36,y:h*.24,w:w*.28,h:h*.30,text:'>',align:'center',font:font(42),color:style.color,textColor:style.color,strokeOn:false},
      {type:'text',x:w*.64,y:h*.25,w:w*.24,h:h*.12,text:'Output',align:'center',font:font(12),color:textColor,strokeOn:false},
      {type:'text',x:w*.64,y:h*.38,w:w*.24,h:h*.16,text:hasOutput?String(output):'—',align:'center',font:font(16),color:textColor,strokeOn:false},
      {type:'text',x:left,y:h*.54,w:right-left,h:h*.12,text:'Threshold: '+this._threshold(state),align:'center',font:font(12),color:textColor,strokeOn:false}
    ];
    if(state.showIndicators!==false){
      for(const [x,color] of [[w*.045,hasInput?'#2563eb':'#fbbf24'],[w*.955,!hasOutput?'#fbbf24':output?'#15803d':'#64748b']]){
        children.push({type:'ellipse',x:x-indicator/2,y:cy-indicator/2,w:indicator,h:indicator,fill:true,fillColor:color,strokeOn:true,color:color==='#fbbf24'?'#b45309':'#ffffff',size:1});
      }
    }
    if(io.error || !hasInput || !hasOutput){
      const note=!io.error || /^Missing value or binding for /.test(io.error)?'Input required':'Input unavailable';
      children.push({type:'text',x:0,y:h*.73,w,h:h*.18,text:note,align:'center',font:font(12),color:'#92400e',textColor:'#92400e',strokeOn:false});
    }
    if(editing && hasInput && hasOutput && !io.error){
      for(const [x,label] of [[0,'Threshold − 1'],[w/2,'Threshold + 1']]){
        children.push({type:'rect',x:x+4,y:h*.72,w:Math.max(0,w/2-8),h:h*.12,fill:false,strokeOn:true,color:style.color,size:1,editorOnly:true});
        children.push({type:'text',x,y:h*.72,w:w/2,h:h*.12,text:label,align:'center',font:font(12),color:textColor,strokeOn:false,editorOnly:true});
      }
      children.push({type:'rect',x:4,y:h*.87,w:Math.max(0,w-8),h:h*.11,fill:false,strokeOn:true,color:style.color,size:1,editorOnly:true});
      children.push({type:'text',x:0,y:h*.87,w,h:h*.11,text:'Indicators: '+(state.showIndicators!==false?'on':'off'),align:'center',font:font(12),color:textColor,strokeOn:false,editorOnly:true});
    }
    return children;
  },
  handles(state,w,h){return [
    {id:'minus',x:w/4,y:h*.78,kind:'click',editorOnly:true},
    {id:'plus',x:w*.75,y:h*.78,kind:'click',editorOnly:true},
    {id:'indicators',x:w/2,y:h*.925,kind:'click',editorOnly:true}
  ];},
  hitEdit(state,x,y,w,h){
    if(x<0 || x>w)return null;
    if(y>=h*.87 && y<=h*.98)return 'indicators';
    return y>=h*.72 && y<=h*.84?(x<w/2?'minus':'plus'):null;
  },
  dragEdit(state,handle){
    if(handle==='indicators')return {state:{...state,showIndicators:state.showIndicators===false}};
    const threshold=this._threshold(state)+(handle==='plus'?1:handle==='minus'?-1:0);
    return {state:{...state,threshold:Number.isFinite(threshold)?threshold:this._threshold(state)}};
  }
})
