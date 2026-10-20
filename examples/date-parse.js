// Parse ISO dates at UTC midnight, or ISO timestamps with an explicit Z/UTC offset.
// Calendar rollovers, locale-dependent dates, leap seconds and implicit local time are rejected.
({
  apiVersion:2,
  eventApi:1,
  eventTransform:{input:'text',outputs:['timestamp','valid'],reprocess:'reprocess'},
  settings:{showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs:{reprocess:{role:'control',type:'boolean',default:false,event:'command',label:'Reprocess'},text:{event:true,type:'string',default:''}},
  outputs:{timestamp:{event:true,type:'number'},valid:{event:true,role:'control',type:'boolean'}},
  initState(){return {showIndicators:true};},
  initStyle(){return {w:320,h:112,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs){
    if(typeof inputs.text!=='string' || inputs.text.length>2000)throw new Error('Date text must be a string of at most 2000 characters');
    const invalid={timestamp:0,valid:false};
    const match=/^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?(?![\s\S])/.exec(inputs.text);
    if(!match || match[1]==='-000000')return invalid;
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    const hour=Number(match[4]||0),minute=Number(match[5]||0),second=Number(match[6]||0);
    const leap=year%4===0 && (year%100!==0 || year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    if(month<1 || month>12 || day<1 || day>days[month-1] || hour>23 || minute>59 || second>59)return invalid;
    if(match[8] && match[8]!=='Z'){
      const hours=Number(match[8].slice(1,3)),minutes=Number(match[8].slice(4,6));
      if(hours>23 || minutes>59)return invalid;
    }
    // The validated ISO grammar has specified native parsing, including years 0000–0099.
    const timestamp=Date.parse(inputs.text);
    return Number.isFinite(timestamp) && Math.abs(timestamp)<=8640000000000000?{timestamp:timestamp===0?0:timestamp,valid:true}:invalid;
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
    const scale=Math.min(w/320,h/112),pad=12*scale,available=!io.error && Number.isFinite(io.outputs?.timestamp) && typeof io.outputs?.valid==='boolean';
    const name=(typeof io.name==='string'?io.name:'').trim()||'Date parse',valid=available?io.outputs.valid:null;
    const message=io.error?io.error:available?(valid?String(io.outputs.timestamp):'Invalid ISO date'):'Input unavailable';
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600),
      this._text(message,pad,40*scale,w-pad*2,28*scale,(io.error?13:19)*scale,style,io.error?'#92400e':style.textColor||'#334155',600)];
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:89*scale,w:8*scale,h:8*scale,fill:true,fillColor:valid===null?'#fbbf24':valid?'#15803d':'#64748b',strokeOn:false});
      children.push(this._text('Unix milliseconds · Valid: '+(valid===null?'—':String(valid)),pad+15*scale,84*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
