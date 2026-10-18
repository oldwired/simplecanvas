// A numeric source configured in the editor. Author-only buttons stay out of exports.
({
  apiVersion:2,
  inputs:{},
  outputs:{value:{type:'number'}},
  initState(){return {value:70};},
  initStyle(){return {w:220,h:110,fontSize:20,strokeOn:false};},
  _value(state){return Number.isFinite(state.value)?state.value:70;},
  compute(inputs,state){return {value:this._value(state)};},
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
  children(state,style,w,h,editing,io){
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      {type:'text',x:0,y:0,w,h:h*.26,...this._caption(io.name,'Constant',w,h*.26,style),align:'center',color:style.textColor,strokeOn:false},
      {type:'text',x:0,y:h*.28,w,h:h*.3,text:this._number(io.outputs.value),align:'center',font:style.font,color:style.textColor,strokeOn:false}
    ];
    if(editing)for(const [x,label] of [[0,'− 1'],[w/2,'+ 1']]){
      children.push({type:'rect',x:x+4,y:h*.68,w:Math.max(0,w/2-8),h:h*.28,fill:false,strokeOn:true,color:style.color,size:1,editorOnly:true});
      children.push({type:'text',x,y:h*.68,w:w/2,h:h*.28,text:label,align:'center',font:style.font,color:style.textColor,strokeOn:false,editorOnly:true});
    }
    return children;
  },
  handles(state,w,h){return [
    {id:'minus',x:w/4,y:h*.82,kind:'click',editorOnly:true},
    {id:'plus',x:w*.75,y:h*.82,kind:'click',editorOnly:true}
  ];},
  hitEdit(state,x,y,w,h){return y>=h*.68 && y<=h && x>=0 && x<=w?(x<w/2?'minus':'plus'):null;},
  dragEdit(state,handle){
    const value=this._value(state)+(handle==='plus'?1:handle==='minus'?-1:0);
    return {state:{...state,value:Number.isFinite(value)?value:this._value(state)}};
  }
})
