// Compare text literally, or require a regular expression to match the entire input.
// Patterns are written without / delimiters. Regex evaluation stays inside compute's Worker budget.
({
  apiVersion:2,
  settings:{caseSensitive:{type:'boolean',default:true,label:'Case-sensitive matching'},showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs:{text:{type:'string',default:''},compare:{type:'string',default:''},operation:{role:'control',type:'string',default:'equals',options:['equals','not equals','starts with','ends with','contains','matches regex']}},
  outputs:{value:{type:'boolean'}},
  initState(){return {caseSensitive:true,showIndicators:true};},
  initStyle(){return {w:300,h:128,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state){
    if(typeof inputs.text!=='string' || inputs.text.length>2000 || typeof inputs.compare!=='string' || inputs.compare.length>2000)throw new Error('Text and comparison must be strings of at most 2000 characters');
    if(inputs.operation==='matches regex'){
      let pattern;
      try{
        const flags=state.caseSensitive===false?'iu':'u';
        new RegExp(inputs.compare,flags);
        pattern=new RegExp('^(?:'+inputs.compare+')(?![\\s\\S])',flags);
      }
      catch(error){throw new Error('Invalid regular expression: '+error.message);}
      return {value:pattern.test(inputs.text)};
    }
    const text=state.caseSensitive===false?inputs.text.toLowerCase():inputs.text,compare=state.caseSensitive===false?inputs.compare.toLowerCase():inputs.compare;
    switch(inputs.operation){
      case 'equals':return {value:text===compare};
      case 'not equals':return {value:text!==compare};
      case 'starts with':return {value:text.startsWith(compare)};
      case 'ends with':return {value:text.endsWith(compare)};
      case 'contains':return {value:text.includes(compare)};
      default:throw new Error('Choose a supported text comparison');
    }
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
    const scale=Math.min(w/300,h/128),pad=12*scale,available=!io.error && typeof io.outputs?.value==='boolean';
    const name=(typeof io.name==='string'?io.name:'').trim()||'Text compare',value=available?io.outputs.value:null;
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600)];
    const message=io.error?io.error:available?(value?'Match':'No match'):'Input unavailable';
    children.push(this._text(message,pad,40*scale,w-pad*2,28*scale,(io.error?13:22)*scale,style,io.error?'#92400e':style.textColor||'#334155',600));
    const operation=typeof io.inputs?.operation==='string'?io.inputs.operation:'equals';
    children.push(this._text(operation+' · '+(state.caseSensitive===false?'ignore case':'case sensitive'),pad,74*scale,w-pad*2,17*scale,11*scale,style,'#64748b'));
    if(state.showIndicators!==false){
      const color=value===null?'#fbbf24':value?'#15803d':'#64748b';
      children.push({type:'ellipse',x:pad,y:105*scale,w:8*scale,h:8*scale,fill:true,fillColor:color,strokeOn:false});
      children.push(this._text('Output: '+(value===null?'—':String(value)),pad+15*scale,100*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
