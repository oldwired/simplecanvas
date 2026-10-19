// Extract a zero-based Unicode code-point range, the first regex match, or a zero-based capture group.
// Patterns have no / delimiters; all native regex evaluation runs inside compute's Worker budget.
({
  apiVersion:2,
  settings:{mode:{type:'string',default:'range',options:['range','regex match','regex capture'],label:'Extraction mode'},caseSensitive:{type:'boolean',default:true,label:'Case-sensitive matching'},showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs(state){
    const ports={text:{type:'string',default:''}};
    if(state.mode==='range')return {...ports,start:{role:'control',type:'number',default:0},length:{role:'control',type:'number',default:1}};
    if(state.mode==='regex match')return {...ports,pattern:{role:'control',type:'string',default:''}};
    if(state.mode==='regex capture')return {...ports,pattern:{role:'control',type:'string',default:''},group:{role:'control',type:'number',default:0}};
    throw new Error('Choose a supported extraction mode');
  },
  outputs:{text:{type:'string'},found:{role:'control',type:'boolean'}},
  initState(){return {mode:'range',caseSensitive:true,showIndicators:true};},
  initStyle(){return {w:300,h:128,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state){
    if(typeof inputs.text!=='string' || inputs.text.length>2000)throw new Error('Text must be a string of at most 2000 characters');
    if(state.mode==='range'){
      for(const key of ['start','length'])if(!Number.isSafeInteger(inputs[key]) || inputs[key]<0 || inputs[key]>2000)throw new Error((key==='start'?'Start':'Length')+' must be a whole number from 0 to 2000');
      const chars=Array.from(inputs.text);
      return {text:chars.slice(inputs.start,inputs.start+inputs.length).join(''),found:inputs.start<=chars.length};
    }
    if(state.mode!=='regex match' && state.mode!=='regex capture')throw new Error('Choose a supported extraction mode');
    if(typeof inputs.pattern!=='string' || inputs.pattern.length>2000)throw new Error('Pattern must be a string of at most 2000 characters');
    if(state.mode==='regex capture' && (!Number.isSafeInteger(inputs.group) || inputs.group<0 || inputs.group>2000))throw new Error('Capture group must be a whole number from 0 to 2000');
    let pattern;
    try{pattern=new RegExp(inputs.pattern,state.caseSensitive===false?'iu':'u');}
    catch(error){throw new Error('Invalid regular expression: '+error.message);}
    const match=pattern.exec(inputs.text);
    if(!match)return {text:'',found:false};
    if(state.mode==='regex match')return {text:match[0],found:true};
    if(inputs.group+1>=match.length)throw new Error('Capture group '+inputs.group+' does not exist; group 0 is the first capture');
    const captured=match[inputs.group+1];
    return {text:captured===undefined?'':captured,found:captured!==undefined};
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
    const scale=Math.min(w/300,h/128),pad=12*scale,available=!io.error && typeof io.outputs?.text==='string' && typeof io.outputs?.found==='boolean';
    const name=(typeof io.name==='string'?io.name:'').trim()||'Text extract',found=available?io.outputs.found:null;
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600)];
    const message=io.error?io.error:available?(found?(io.outputs.text||'(empty)'):'No match'):'Input unavailable';
    children.push(this._text(message,pad,40*scale,w-pad*2,28*scale,(io.error?13:20)*scale,style,io.error?'#92400e':style.textColor||'#334155',600));
    const detail=state.mode==='range'?'Range · zero-based':state.mode==='regex capture'?'Capture '+(Number.isSafeInteger(io.inputs?.group)?io.inputs.group:0)+' · '+(state.caseSensitive===false?'ignore case':'case sensitive'):'First match · '+(state.caseSensitive===false?'ignore case':'case sensitive');
    children.push(this._text(detail,pad,74*scale,w-pad*2,17*scale,11*scale,style,'#64748b'));
    if(state.showIndicators!==false){
      const color=found===null?'#fbbf24':found?'#15803d':'#64748b';
      children.push({type:'ellipse',x:pad,y:105*scale,w:8*scale,h:8*scale,fill:true,fillColor:color,strokeOn:false});
      children.push(this._text('Found: '+(found===null?'—':String(found)),pad+15*scale,100*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
