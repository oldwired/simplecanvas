// Format Unix milliseconds without guessing a locale or the browser's local timezone.
// ISO output is always UTC; other formats use Gregorian calendar parts in the selected IANA zone.
({
  apiVersion:2,
  settings:{format:{type:'string',default:'date and time',options:['ISO (UTC)','date','time','date and time'],label:'Format'},showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs:{timestamp:{type:'number',default:0},timezone:{role:'control',type:'string',default:'UTC'}},
  outputs:{text:{type:'string'},valid:{role:'control',type:'boolean'}},
  initState(){return {format:'date and time',showIndicators:true};},
  initStyle(){return {w:320,h:112,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state=this.initState()){
    if(typeof inputs.timestamp!=='number')throw new Error('Timestamp must be a number of Unix milliseconds');
    if(typeof inputs.timezone!=='string' || inputs.timezone.length>2000)throw new Error('Timezone must be a string of at most 2000 characters');
    if(!['ISO (UTC)','date','time','date and time'].includes(state.format))throw new Error('Choose a supported date format');
    const invalid={text:'',valid:false};
    if(!Number.isFinite(inputs.timestamp) || Math.abs(inputs.timestamp)>8640000000000000 || !inputs.timezone.trim())return invalid;
    let formatter;
    try{formatter=new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn',{timeZone:inputs.timezone.trim(),era:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}
    catch(_){return invalid;}
    const date=new Date(inputs.timestamp);
    if(state.format==='ISO (UTC)')return {text:date.toISOString(),valid:true};
    const parts=Object.fromEntries(formatter.formatToParts(date).map(part=>[part.type,part.value]));
    const year=parts.era==='BC'?1-Number(parts.year):Number(parts.year);
    const yearText=year>=0 && year<=9999?String(year).padStart(4,'0'):(year<0?'-':'+')+String(Math.abs(year)).padStart(6,'0');
    const dateText=yearText+'-'+parts.month+'-'+parts.day,timeText=parts.hour+':'+parts.minute+':'+parts.second;
    return {text:state.format==='date'?dateText:state.format==='time'?timeText:dateText+' '+timeText,valid:true};
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
    const scale=Math.min(w/320,h/112),pad=12*scale,available=!io.error && typeof io.outputs?.text==='string' && typeof io.outputs?.valid==='boolean';
    const name=(typeof io.name==='string'?io.name:'').trim()||'Date format',valid=available?io.outputs.valid:null;
    const message=io.error?io.error:available?(valid?io.outputs.text:'Invalid date or timezone'):'Input unavailable';
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600),
      this._text(message,pad,40*scale,w-pad*2,28*scale,(io.error?13:16)*scale,style,io.error?'#92400e':style.textColor||'#334155',600)];
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:89*scale,w:8*scale,h:8*scale,fill:true,fillColor:valid===null?'#fbbf24':valid?'#15803d':'#64748b',strokeOn:false});
      const timezone=state.format==='ISO (UTC)'?'UTC':(io.inputs?.timezone||'UTC');
      children.push(this._text(timezone+' · Valid: '+(valid===null?'—':String(valid)),pad+15*scale,84*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
