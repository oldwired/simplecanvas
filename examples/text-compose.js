// Join two to eight strings, or insert them into a literal template without evaluating code.
({
  apiVersion:2,
  eventApi:1,
  eventTransform(state){return {inputs:Object.keys(this.inputs(state)).filter(name=>name.length===1),outputs:['text'],reprocess:'reprocess'};},
  settings:{mode:{type:'string',default:'join',options:['join','template'],label:'Composition mode'},inputCount:{type:'number',default:2,min:2,max:8,step:1,label:'Number of text inputs'},showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs(state){
    if(!Number.isSafeInteger(state.inputCount) || state.inputCount<2 || state.inputCount>8)throw new Error('Number of text inputs must be a whole number from 2 to 8');
    const ports={reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'}};for(let i=0;i<state.inputCount;i++)ports['abcdefgh'[i]]={type:'string',default:'',event:true};
    if(state.mode==='join')ports.separator={role:'control',type:'string',default:''};
    else if(state.mode==='template')ports.template={role:'control',type:'string',default:'{a}{b}'};
    else throw new Error('Choose a supported composition mode');
    return ports;
  },
  outputs:{text:{event:true,type:'string'}},
  initState(){return {mode:'join',inputCount:2,showIndicators:true};},
  initStyle(){return {w:300,h:128,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state){
    const ports=this.inputs(state);
    for(const key of Object.keys(ports).filter(key=>key!=='reprocess'))if(typeof inputs[key]!=='string' || inputs[key].length>2000)throw new Error('Each input must be a string of at most 2000 characters');
    let text='';
    const append=value=>{if(text.length+value.length>2000)throw new Error('Output exceeds 2000 characters');text+=value;};
    const keys='abcdefgh'.slice(0,state.inputCount);
    if(state.mode==='join'){
      for(let i=0;i<keys.length;i++){if(i)append(inputs.separator);append(inputs[keys[i]]);}
    }else{
      const template=inputs.template;
      for(let i=0;i<template.length;){
        const char=template[i];
        if((char==='{' || char==='}') && template[i+1]===char){append(char);i+=2;}
        else if(char==='{'){
          const end=template.indexOf('}',i+1),key=end<0?'':template.slice(i+1,end);
          if(key.length!==1 || !keys.includes(key))throw new Error('Use placeholders {a} to {'+keys[keys.length-1]+'}; escape braces as {{ and }}');
          append(inputs[key]);i=end+1;
        }else if(char==='}')throw new Error('Escape a literal closing brace as }}');
        else{append(char);i++;}
      }
    }
    return {text};
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
    const name=(typeof io.name==='string'?io.name:'').trim()||'Text compose';
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600)];
    const message=io.error?io.error:available?(io.outputs.text||'(empty)'):'Input unavailable';
    children.push(this._text(message,pad,40*scale,w-pad*2,28*scale,(io.error?13:20)*scale,style,io.error?'#92400e':style.textColor||'#334155',600));
    children.push(this._text((state.mode==='template'?'Template':'Join')+' · '+state.inputCount+' hybrid inputs',pad,74*scale,w-pad*2,17*scale,11*scale,style,'#64748b'));
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:105*scale,w:8*scale,h:8*scale,fill:true,fillColor:available?'#2563eb':'#fbbf24',strokeOn:false});
      children.push(this._text('Output: '+(available?'ready':'—'),pad+15*scale,100*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
