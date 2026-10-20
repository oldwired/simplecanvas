// Replace literal text or native JavaScript regex matches inside compute's Worker budget.
// Replacement references follow JavaScript syntax; output is bounded while it is built.
({
  apiVersion:2,
  eventApi:1,
  eventTransform:{input:'text',outputs:['text','count'],reprocess:'reprocess'},
  settings:{mode:{type:'string',default:'literal',options:['literal','regex'],label:'Matching mode'},occurrence:{type:'string',default:'all',options:['all','first'],label:'Replace occurrences'},caseSensitive:{type:'boolean',default:true,label:'Case-sensitive matching'},showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs:{reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'},text:{event:true,type:'string',default:''},search:{role:'control',type:'string',default:''},replacement:{role:'control',type:'string',default:''}},
  outputs:{text:{event:true,type:'string'},count:{event:true,type:'number'}},
  initState(){return {mode:'literal',occurrence:'all',caseSensitive:true,showIndicators:true};},
  initStyle(){return {w:300,h:128,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state){
    for(const key of ['text','search','replacement'])if(typeof inputs[key]!=='string' || inputs[key].length>2000)throw new Error('Each input must be a string of at most 2000 characters');
    if(state.mode!=='literal' && state.mode!=='regex')throw new Error('Choose a supported matching mode');
    if(state.occurrence!=='all' && state.occurrence!=='first')throw new Error('Choose first or all occurrences');
    if(state.mode==='literal' && !inputs.search)return {text:inputs.text,count:0};
    const source=state.mode==='literal'?inputs.search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'):inputs.search;
    let pattern;
    try{pattern=new RegExp(source,state.caseSensitive===false?'giu':'gu');}
    catch(error){throw new Error('Invalid regular expression: '+error.message);}
    let text='',count=0,consumed=0,match;
    const append=value=>{if(text.length+value.length>2000)throw new Error('Output exceeds 2000 characters');text+=value;};
    while((match=pattern.exec(inputs.text))!==null){
      append(inputs.text.slice(consumed,match.index));count++;
      if(state.mode==='literal')append(inputs.replacement);
      else{
        // Expand substitution tokens, never the regex itself. Append each piece with the limit
        // checked first, so repeated captures/prefixes cannot allocate an unbounded result.
        const replacement=inputs.replacement;
        for(let i=0;i<replacement.length;){
          if(replacement[i]!=='$' || i+1===replacement.length){append(replacement[i++]);continue;}
          const next=replacement[i+1];
          if(next==='$'){append('$');i+=2;}
          else if(next==='&'){append(match[0]);i+=2;}
          else if(next==='`'){append(inputs.text.slice(0,match.index));i+=2;}
          else if(next==="'"){append(inputs.text.slice(match.index+match[0].length));i+=2;}
          else if(next==='<' && match.groups!==undefined && replacement.indexOf('>',i+2)!==-1){
            const end=replacement.indexOf('>',i+2),name=replacement.slice(i+2,end);
            append(Object.prototype.hasOwnProperty.call(match.groups,name)?match.groups[name]||'':'');i=end+1;
          }else if(next>='0' && next<='9'){
            let capture=Number(next),digits=1;
            const second=replacement[i+2];
            if(second>='0' && second<='9'){
              const pair=capture*10+Number(second);
              if(pair>0 && pair<match.length){capture=pair;digits=2;}
            }
            if(capture>0 && capture<match.length){append(match[capture]||'');i+=1+digits;}
            else{append('$');i++;}
          }else{append('$');i++;}
        }
      }
      consumed=match.index+match[0].length;
      if(state.occurrence==='first')break;
      // Native Unicode regex iteration requires an explicit code-point step for empty matches.
      if(match[0]==='')pattern.lastIndex+=inputs.text.codePointAt(pattern.lastIndex)>0xffff?2:1;
    }
    append(inputs.text.slice(consumed));
    return {text,count};
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
    const name=(typeof io.name==='string'?io.name:'').trim()||'Text replace';
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600)];
    const message=io.error?io.error:available?(io.outputs.text||'(empty)'):'Input unavailable';
    children.push(this._text(message,pad,40*scale,w-pad*2,28*scale,(io.error?13:20)*scale,style,io.error?'#92400e':style.textColor||'#334155',600));
    children.push(this._text(state.mode+' · '+state.occurrence+' · '+(state.caseSensitive===false?'ignore case':'case sensitive'),pad,74*scale,w-pad*2,17*scale,11*scale,style,'#64748b'));
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:105*scale,w:8*scale,h:8*scale,fill:true,fillColor:available?'#2563eb':'#fbbf24',strokeOn:false});
      children.push(this._text('Replacements: '+(available?io.outputs.count:'—'),pad+15*scale,100*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
