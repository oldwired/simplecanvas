// Convert a finite number to its locale-independent text representation.
// Keep the numeric value's precision; display rounding belongs in numeric displays.
({
  apiVersion:2,
  settings:{showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs:{value:{type:'number',default:0}},
  outputs:{text:{type:'string'}},
  initState(){return {showIndicators:true};},
  initStyle(){return {w:300,h:112,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs){
    if(!Number.isFinite(inputs.value))throw new Error('Input must be a finite number');
    return {text:String(inputs.value)};
  },
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400){
    const units=char=>/[MWmw@#%]/.test(char)||char.codePointAt(0)>255?1.1:/[A-Z]/.test(char)?.88:.72;
    const chars=Array.from(String(value).replace(/\s+/g,' '));let text='',used=0;
    for(let i=0;i<chars.length;i++){
      const next=units(chars[i]),remaining=i<chars.length-1?1.1:0;
      if((used+next+remaining)*size>w){text+='…';break;}
      text+=chars[i];used+=next;
    }
    const font=(style.font||weight+' '+size+'px sans-serif').replace(/\d+(?:\.\d+)?px/,size+'px');
    return {type:'text',x,y,w,h,text,plainText:true,align:'left',font,color,strokeOn:false};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/300,h/112),pad=12*scale,available=!io.error && typeof io.outputs?.text==='string';
    const name=(typeof io.name==='string'?io.name:'').trim()||'Number to text';
    const message=io.error?io.error:available?'"'+io.outputs.text+'"':'Input unavailable';
    const size=io.error?13*scale:Math.min(20*scale,(w-pad*2)/Math.max(1,message.length*.85));
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600),
      this._text(message,pad,40*scale,w-pad*2,28*scale,size,style,io.error?'#92400e':style.textColor||'#334155',600)];
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:89*scale,w:8*scale,h:8*scale,fill:true,fillColor:available?'#2563eb':'#fbbf24',strokeOn:false});
      children.push(this._text('Number → text',pad+15*scale,84*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
