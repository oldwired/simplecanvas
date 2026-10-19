// Signed elapsed duration between Unix millisecond timestamps; a day is exactly 24 hours.
// This is elapsed time, not a count of calendar boundaries in a timezone.
({
  apiVersion:2,
  settings:{showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs:{start:{type:'number',default:0},end:{type:'number',default:0},unit:{role:'control',type:'string',default:'seconds',options:['milliseconds','seconds','minutes','hours','days']}},
  outputs:{value:{type:'number'},valid:{role:'control',type:'boolean'}},
  initState(){return {showIndicators:true};},
  initStyle(){return {w:320,h:112,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs){
    if(typeof inputs.start!=='number' || typeof inputs.end!=='number')throw new Error('Start and end must be numbers of Unix milliseconds');
    const units={milliseconds:1,seconds:1000,minutes:60000,hours:3600000,days:86400000};
    if(typeof inputs.unit!=='string' || !Object.prototype.hasOwnProperty.call(units,inputs.unit))throw new Error('Choose milliseconds, seconds, minutes, hours or days');
    if(!Number.isFinite(inputs.start) || !Number.isFinite(inputs.end) || Math.abs(inputs.start)>8640000000000000 || Math.abs(inputs.end)>8640000000000000)return {value:0,valid:false};
    const value=(inputs.end-inputs.start)/units[inputs.unit];
    return {value:value===0?0:value,valid:true};
  },
  _number(value){return !Number.isFinite(value)?'—':Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(8)));},
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
    const scale=Math.min(w/320,h/112),pad=12*scale,available=!io.error && Number.isFinite(io.outputs?.value) && typeof io.outputs?.valid==='boolean';
    const name=(typeof io.name==='string'?io.name:'').trim()||'Date difference',valid=available?io.outputs.valid:null;
    const message=io.error?io.error:available?(valid?this._number(io.outputs.value):'Invalid timestamp'):'Input unavailable';
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600),
      this._text(message,pad,40*scale,w-pad*2,28*scale,(io.error?13:20)*scale,style,io.error?'#92400e':style.textColor||'#334155',600)];
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:89*scale,w:8*scale,h:8*scale,fill:true,fillColor:valid===null?'#fbbf24':valid?'#15803d':'#64748b',strokeOn:false});
      children.push(this._text((io.inputs?.unit||'seconds')+' · Valid: '+(valid===null?'—':String(valid)),pad+15*scale,84*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
