// Set replaces the stored text; Append adds a line/block; Clear empties it. Triggers use rising edges.
// Empty storage has zero lines. Appending an empty line makes one explicitly stored blank line.
({
  apiVersion:2,
  settings:{
    showCounts:{type:'boolean',default:false,label:'Show counts'},
    showHints:{type:'boolean',default:false,label:'Show hints'},
    maxLines:{type:'number',default:100,min:1,max:1000,step:1,label:'Maximum lines'},
    maxLength:{type:'number',default:2000,min:1,max:2000,step:1,label:'Maximum length (UTF-16 units)'}
  },
  inputs:{content:{type:'string',default:''},line:{type:'string',default:''},set:{role:'control',type:'boolean',default:false},append:{role:'control',type:'boolean',default:false},clear:{role:'control',type:'boolean',default:false}},
  outputs:{text:{type:'string'},lineCount:{type:'number'}},
  initState(){return {text:'',lineCount:0,notice:'',maxLines:100,maxLength:2000,showCounts:false,showHints:false};},
  initStyle(){return {w:360,h:280,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _fits(text){
    // Reserve the longest status plus maximum configuration/count widths. JSON escapes count
    // toward the host's 4000-character state budget, even when the visible string is shorter.
    return JSON.stringify({text,lineCount:1000,notice:' '.repeat(160),maxLines:1000,maxLength:2000,showCounts:false,showHints:false}).length<=4000;
  },
  _state(state){
    if(!Number.isInteger(state.maxLines) || state.maxLines<1 || state.maxLines>1000)throw new Error('Maximum lines must be an integer from 1 to 1000');
    if(!Number.isInteger(state.maxLength) || state.maxLength<1 || state.maxLength>2000)throw new Error('Maximum characters must be an integer from 1 to 2000');
    if(typeof state.text!=='string' || state.text.length>2000 || /\r/.test(state.text) || !this._fits(state.text))throw new Error('Memo requires bounded, normalized stored text');
    const count=state.text===''?0:state.text.split('\n').length;
    if(!Number.isInteger(state.lineCount) || state.lineCount<0 || state.lineCount>1000 ||
      (state.lineCount!==count && !(state.text==='' && state.lineCount===1)))throw new Error('Memo line count must match its stored text');
    if(typeof state.notice!=='string' || state.notice.length>160)throw new Error('Memo requires a bounded status message');
    const stored={text:state.text,lineCount:state.lineCount,notice:state.notice,maxLines:state.maxLines,maxLength:state.maxLength,showCounts:state.showCounts===true,showHints:state.showHints===true};
    if(JSON.stringify(stored).length>4000)throw new Error('Memo state exceeds its storage budget');
    return stored;
  },
  _inputs(inputs){
    for(const key of ['content','line'])if(typeof inputs[key]!=='string' || inputs[key].length>2000)throw new Error('Memo '+key+' requires a string of at most 2000 characters');
    for(const key of ['set','append','clear'])if(typeof inputs[key]!=='boolean')throw new Error('Memo '+key+' trigger must be Boolean');
  },
  publish(state){const stored=this._state(state);return {text:stored.text,lineCount:stored.lineCount};},
  compute(inputs,state){this._inputs(inputs);return this.publish(state);},
  transition(inputs,state,memory){
    this._inputs(inputs);
    const next=this._state(state),observed={set:inputs.set,append:inputs.append,clear:inputs.clear};
    const primed=memory && ['set','append','clear'].every(key=>typeof memory[key]==='boolean');
    const rising=key=>primed && memory[key]===false && inputs[key];
    let text=next.text,lineCount=next.lineCount,edit=false;
    if(rising('clear')){text='';lineCount=0;edit=true;}
    else if(rising('set')){text=inputs.content.replace(/\r\n?/g,'\n');lineCount=text===''?0:text.split('\n').length;edit=true;}
    else if(rising('append')){
      const line=inputs.line.replace(/\r\n?/g,'\n');
      text=(lineCount>0?text+'\n':'')+line;lineCount+=line.split('\n').length;edit=true;
    }
    if(edit){
      if(lineCount>next.maxLines)next.notice='Line limit reached ('+next.maxLines+'). Previous text retained.';
      else if(text.length>next.maxLength)next.notice='Character limit reached ('+next.maxLength+'). Previous text retained.';
      else if(!this._fits(text))next.notice='Storage limit reached (escaped text). Previous text retained.';
      else {next.text=text;next.lineCount=lineCount;next.notice='';}
    }
    const reduced='Stored text exceeds the configured limit. Clear it or set shorter text.';
    if(!edit && (next.lineCount>next.maxLines || next.text.length>next.maxLength))next.notice=reduced;
    else if(!edit && next.notice===reduced)next.notice='';
    return {state:next,memory:observed,nextWakeAt:null};
  },
  // Preview boundaries follow visible characters. Without Segmenter, keep the text whole.
  _graphemes(value){
    const text=String(value);
    return typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'
      ?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>part.segment)
      :text?[text]:[];
  },
  _caption(name,fallback,w,h,style){
    const label=(typeof name==='string'?name:'').trim().replace(/\s+/g,' ')||fallback;
    const units=text=>this._graphemes(text).reduce((n,c)=>n+(/[MWmw@#%]/.test(c)||c.codePointAt(0)>255?1.1:/[A-Z]/.test(c)?.88:.72),0);
    const width=Math.max(1,w-16),base=Math.min(style.fontSize||20,h*.7);
    let size=Math.min(base,width/Math.max(1,units(label))),lines=[label];
    if(size<Math.min(12,base)){
      size=Math.min(base,12,Math.max(1,h-2)/2.4,width/1.1);lines=[];let rest=label;
      for(let row=0;row<2 && rest;row++){
        let line='';for(const c of this._graphemes(rest)){if(line && units(line+c)*size>width)break;line+=c;}
        if(line.length<rest.length && line.lastIndexOf(' ')>0)line=line.slice(0,line.lastIndexOf(' '));
        rest=rest.slice(line.length).trim();
        if(row===1 && rest){while(line && units(line+'…')*size>width)line=this._graphemes(line).slice(0,-1).join('');line+='…';}
        lines.push(line);
      }
    }
    return {text:lines.join('\n'),font:(style.font||'600 20px sans-serif').replace(/\d+(?:\.\d+)?px/,size+'px')};
  },
  _view(text,width,height,size){
    const unit=c=>/[MWmw@#%]/.test(c)||c.codePointAt(0)>255?1.1:/[A-Z]/.test(c)?.88:.72;
    const room=Math.max(1,width)/size,rows=[];
    for(const block of text.replace(/\t/g,'    ').split('\n')){
      let chars=this._graphemes(block);
      if(!chars.length)rows.push('');
      while(chars.length){
        let length=0,used=0,space=0;
        for(const c of chars){if(length && used+unit(c)>room)break;used+=unit(c);length++;if(/\s/.test(c))space=length;}
        if(length<chars.length && space>0)length=space;
        rows.push(chars.splice(0,length).join(''));
      }
    }
    const lineHeight=size*1.35,limit=Math.max(1,Math.min(80,Math.floor(height/lineHeight))),hidden=rows.length>limit;
    return {lines:rows.slice(-limit),lineHeight,hidden};
  },
  children(state,style,w,h,editing,io={}){
    const stored=this._state(state),scale=Math.min(1,w/360,h/280),pad=8*scale,header=18*scale;
    const size=Math.max(5,Math.min(style.fontSize||16,h*.25)),width=Math.max(1,w-pad*2),bodyY=pad+header+4*scale;
    const notice=stored.notice || (io.error?'Input unavailable; stored text retained':'');
    const hintNeeded=stored.showHints && this._view(stored.text,width,Math.max(1,h-bodyY-pad),size).hidden;
    const footer=notice?26*scale:stored.showCounts || hintNeeded?14*scale:0,bodyHeight=Math.max(1,h-bodyY-pad-footer);
    const font=(fontSize,weight=400)=>(style.font||weight+' '+fontSize+'px sans-serif').replace(/\d+(?:\.\d+)?px/,fontSize+'px');
    const text=(value,x,y,width,height,fontSize,color=style.textColor||'#334155')=>({type:'text',x,y,w:width,h:height,text:value,plainText:true,align:'left',font:font(fontSize),color,strokeOn:false});
    const children=[
      {type:'rect',x:0,y:0,w,h,fill:style.fill,fillColor:style.fillColor,strokeOn:style.strokeOn,color:style.color,size:style.size},
      {...text('',pad,pad,width,header,12*scale),...this._caption(io.name,'Memo',width,header,{...style,fontSize:12*scale})}
    ];
    const view=this._view(stored.text,width,bodyHeight,size);
    if(stored.lineCount===0 && stored.showHints)children.push(text('Empty memo',pad,bodyY,width,view.lineHeight,size,'#94a3b8'));
    else if(stored.lineCount>0)view.lines.forEach((line,index)=>children.push(text(line,pad,bodyY+index*view.lineHeight,width,view.lineHeight,size)));
    if(footer){
      const characterCount=typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'?this._graphemes(stored.text).length+' characters':stored.text.length+' UTF-16 units';
      const counts=stored.showCounts?stored.lineCount+' '+(stored.lineCount===1?'line':'lines')+' · '+characterCount:'';
      const hint=stored.showHints && view.hidden?'Showing latest text':'';
      const status=notice || [counts,hint].filter(Boolean).join(' · ');
      if(status)children.push({...text('',pad,h-pad-footer,width,footer,10*scale,notice?'#92400e':'#64748b'),
        ...this._caption(status,' ',width,footer,{...style,fontSize:10*scale,font:font(10*scale)})});
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
