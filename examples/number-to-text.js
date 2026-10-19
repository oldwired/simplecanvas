// Convert a finite number to full-precision text, or deliberately format a fixed-decimal string.
// Formatting is output data; numeric calculations and the input value retain their precision.
({
  apiVersion:2,
  settings:{format:{type:'string',default:'full precision',options:['full precision','fixed decimals'],label:'Format'},decimals:{type:'number',default:2,min:0,max:20,step:1,label:'Decimal places (fixed)'},minimumIntegerDigits:{type:'number',default:1,min:1,max:20,step:1,label:'Minimum integer digits (fixed)'},decimalSeparator:{type:'string',default:'.',options:['.',','],label:'Decimal separator (fixed)'},showIndicators:{type:'boolean',default:true,label:'Show indicators'}},
  inputs:{value:{type:'number',default:0}},
  outputs:{text:{type:'string'}},
  initState(){return {format:'full precision',decimals:2,minimumIntegerDigits:1,decimalSeparator:'.',showIndicators:true};},
  initStyle(){return {w:300,h:112,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  compute(inputs,state=this.initState()){
    if(!Number.isFinite(inputs.value))throw new Error('Input must be a finite number');
    const format=state.format===undefined?'full precision':state.format;
    if(format==='full precision')return {text:String(inputs.value)};
    if(format!=='fixed decimals')throw new Error('Choose a supported number format');
    if(!Number.isInteger(state.decimals) || state.decimals<0 || state.decimals>20)throw new Error('Decimal places must be a whole number from 0 to 20');
    if(!Number.isInteger(state.minimumIntegerDigits) || state.minimumIntegerDigits<1 || state.minimumIntegerDigits>20)throw new Error('Minimum integer digits must be a whole number from 1 to 20');
    if(state.decimalSeparator!=='.' && state.decimalSeparator!==',')throw new Error('Choose a dot or comma decimal separator');
    const formatter=new Intl.NumberFormat('en-US-u-nu-latn',{useGrouping:false,minimumFractionDigits:state.decimals,maximumFractionDigits:state.decimals,minimumIntegerDigits:state.minimumIntegerDigits});
    let text=formatter.format(inputs.value);
    if(/^-0+(?:\.0+)?$/.test(text))text=text.slice(1);
    if(state.decimalSeparator===',')text=text.replace('.',',');
    return {text};
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
    const scale=Math.min(w/300,h/112),pad=12*scale,available=!io.error && typeof io.outputs?.text==='string';
    const name=(typeof io.name==='string'?io.name:'').trim()||'Number to text';
    const message=io.error?io.error:available?'"'+io.outputs.text+'"':'Input unavailable';
    const size=io.error?13*scale:Math.max(11*scale,Math.min(20*scale,(w-pad*2)/Math.max(1,message.length*.85)));
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,19*scale,13*scale,style,style.textColor||'#334155',600),
      this._text(message,pad,40*scale,w-pad*2,28*scale,size,style,io.error?'#92400e':style.textColor||'#334155',600)];
    if(state.showIndicators!==false){
      children.push({type:'ellipse',x:pad,y:89*scale,w:8*scale,h:8*scale,fill:true,fillColor:available?'#2563eb':'#fbbf24',strokeOn:false});
      children.push(this._text(state.format==='fixed decimals'?'Fixed · '+state.decimals+' decimal places':'Number → text · full precision',pad+15*scale,84*scale,w-pad*2-15*scale,18*scale,11*scale,style,'#64748b'));
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
