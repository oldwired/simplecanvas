// A string display and pass-through. The canvas shows a wrapped preview; value stays complete.
({
  apiVersion:2,
  settings:{showName:{type:'boolean',default:false,label:'Show name'},showHints:{type:'boolean',default:false,label:'Show hints'}},
  inputs:{value:{type:'string',default:''}},
  outputs:{value:{type:'string'}},
  initState(){return {showName:false,showHints:false};},
  initStyle(){return {w:280,h:64,fontSize:18,fill:false,fillColor:'#ffffff',strokeOn:false,color:'#64748b',textColor:'#334155',size:2};},
  compute(inputs){
    if(typeof inputs.value!=='string' || inputs.value.length>2000)throw new Error('Text label requires a string of at most 2000 characters');
    return {value:inputs.value};
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
  _view(text,width,height,size){
    const unit=c=>/[MWmw@#%]/.test(c)||c.codePointAt(0)>255?1.1:/[A-Z]/.test(c)?.88:.72;
    const room=Math.max(1,width)/size,rows=[];
    for(const block of text.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n')){
      let chars=Array.from(block);
      if(!chars.length)rows.push('');
      while(chars.length){
        let length=0,used=0,space=0;
        for(const c of chars){if(length && used+unit(c)>room)break;used+=unit(c);length++;if(/\s/.test(c))space=length;}
        if(length<chars.length && space>0)length=space;
        rows.push(chars.splice(0,length).join(''));
      }
    }
    const lineHeight=size*1.35,limit=Math.max(1,Math.min(80,Math.floor(height/lineHeight))),hidden=rows.length>limit;
    return {lines:rows.slice(0,limit),lineHeight,hidden};
  },
  children(state,style,w,h,editing,io={}){
    const available=!io.error && typeof io.outputs?.value==='string',value=available?io.outputs.value:'';
    const boxed=style.strokeOn===true || style.fill===true,stroke=style.strokeOn===true?Math.max(0,style.size||0):0;
    const inset=boxed?Math.min(4+stroke/2,w/4,h/4):0,width=Math.max(1,w-inset*2),height=Math.max(1,h-inset*2);
    const size=Math.max(5,Math.min(style.fontSize||18,height)),caption=state.showName===true?Math.min(22,height*.35):0;
    const hintNeeded=state.showHints===true && available && (value==='' || this._view(value,width,Math.max(1,height-caption),size).hidden);
    const footer=hintNeeded?Math.min(14,height*.25):0,bodyHeight=Math.max(1,height-caption-footer),bodySize=Math.min(size,bodyHeight/1.35);
    const font=(fontSize,weight=400)=>(style.font||weight+' '+fontSize+'px sans-serif').replace(/\d+(?:\.\d+)?px/,fontSize+'px');
    const text=(value,x,y,width,height,fontSize,color=style.textColor||'#334155')=>({type:'text',x,y,w:width,h:height,text:value,plainText:true,align:'left',font:font(fontSize),color,strokeOn:false});
    const children=[];
    if(boxed)children.push({type:'rect',x:0,y:0,w,h,strokeOn:style.strokeOn===true,color:style.color,size:style.size,dash:style.dash,fill:style.fill===true,fillColor:style.fillColor});
    if(caption)children.push({...text('',inset,inset,width,caption,12),...this._caption(io.name,'Text label',width,caption,{...style,fontSize:12})});
    let status='';
    if(!available)children.push(text('Input unavailable',inset,inset+caption,width,Math.min(bodyHeight,size*1.35),Math.min(size,bodyHeight/1.35),'#92400e'));
    else if(value===''){
      status='Empty text';
    }else{
      const view=this._view(value,width,bodyHeight,bodySize);
      view.lines.forEach((line,index)=>children.push(text(line,inset,inset+caption+index*view.lineHeight,width,view.lineHeight,bodySize)));
      if(view.hidden)status='More text in output…';
    }
    if(footer && status)children.push(text(status,inset,inset+height-footer,width,footer,Math.min(10,footer/1.35),'#64748b'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
