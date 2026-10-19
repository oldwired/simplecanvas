// Trim or change case without locale-dependent collation. Length counts visible characters or code points.
({
  apiVersion:2,
  settings:{characterMode:{type:'string',default:'visible characters',options:['visible characters','code points'],label:'Character counting'},showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs:{text:{type:'string',default:''},operation:{role:'control',type:'string',default:'trim',options:['trim','lowercase','uppercase']}},
  outputs:{text:{type:'string'},length:{type:'number'},empty:{role:'control',type:'boolean'}},
  initState(){return {characterMode:'visible characters',showIndicators:true};},
  initStyle(){return {w:300,h:128,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state={}){
    if(typeof inputs.text!=='string' || inputs.text.length>2000)throw new Error('Text must be a string of at most 2000 characters');
    let text;
    switch(inputs.operation){
      case 'trim':text=inputs.text.trim();break;
      case 'lowercase':text=inputs.text.toLowerCase();break;
      case 'uppercase':text=inputs.text.toUpperCase();break;
      default:throw new Error('Choose a supported text transformation');
    }
    if(text.length>2000)throw new Error('Output exceeds 2000 characters');
    const mode=state.characterMode===undefined?'visible characters':state.characterMode;
    if(!['visible characters','code points'].includes(mode))throw new Error('Choose visible characters or code points');
    if(mode==='visible characters' && (typeof Intl==='undefined' || typeof Intl.Segmenter!=='function'))throw new Error('Visible characters require Intl.Segmenter; choose code points in Edit');
    return {text,length:(mode==='code points'?Array.from(text):this._graphemes(text)).length,empty:text.length===0};
  },
  // Preview boundaries follow visible characters. Without Segmenter, keep the text whole.
  _graphemes(value){
    const text=String(value);
    return typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'
      ?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>part.segment)
      :text?[text]:[];
  },
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400){
    const units=char=>/[MWmw@#%]/.test(char)||char.codePointAt(0)>255?1.1:/[A-Z]/.test(char)?.88:.72;
    const chars=this._graphemes(String(value).replace(/\s+/g,' '));let text='',used=0;
    for(let i=0;i<chars.length;i++){
      const next=units(chars[i]),remaining=i<chars.length-1?1.1:0;
      if((used+next+remaining)*size>w){text+='…';break;}
      text+=chars[i];used+=next;
    }
    const font=(style.font||weight+' '+size+'px sans-serif').replace(/\d+(?:\.\d+)?px/,size+'px');
    return {type:'text',x,y,w,h,text,plainText:true,align:'left',font,color,strokeOn:false};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/300,h/128),pad=12*scale,available=!io.error && typeof io.outputs?.text==='string';
    const name=(typeof io.name==='string'?io.name:'').trim()||'Text transform';
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600)];
    const message=io.error?io.error:available?(io.outputs.text||'(empty)'):'Input unavailable';
    children.push(this._text(message,pad,40*scale,w-pad*2,28*scale,(io.error?13:20)*scale,style,io.error?'#92400e':style.textColor||'#334155',600));
    children.push(this._text((typeof io.inputs?.operation==='string'?io.inputs.operation:'trim')+' · '+(state.characterMode==='code points'?'code points':'visible characters'),pad,74*scale,w-pad*2,17*scale,11*scale,style,'#64748b'));
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:105*scale,w:8*scale,h:8*scale,fill:true,fillColor:available?'#2563eb':'#fbbf24',strokeOn:false});
      children.push(this._text(available?'Length: '+io.outputs.length+' · Empty: '+io.outputs.empty:'Output: —',pad+15*scale,100*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
