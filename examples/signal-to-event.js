// Capture the current value on each observed false-to-true Trigger edge.
// Initial/restored high levels and type changes prime the edge without emitting.
({
  apiVersion:2,
  eventApi:1,
  settings:{type:{type:'string',default:'string',options:['string','number','boolean'],label:'Value type'},
    showHints:{type:'boolean',default:true,label:'Show hints'}},
  inputs(state){
    const type=this._type(state);
    return {value:{type,default:type==='string'?'':type==='number'?0:false},
      trigger:{role:'control',type:'boolean',default:false}};
  },
  outputs(state){return {value:{type:this._type(state),event:true}};},
  initState(){return {type:'string',showHints:true};},
  initStyle(){return {w:280,h:116,fontSize:18,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#334155',size:1.5};},
  _type(state){
    if(!['string','number','boolean'].includes(state.type))throw new Error('Choose a text, number, or Boolean value type');
    return state.type;
  },
  _validate(inputs,state){
    const type=this._type(state),value=inputs.value;
    if(typeof value!==type || type==='number' && !Number.isFinite(value) || type==='string' && value.length>2000)
      throw new Error('Value must be '+(type==='string'?'text of at most 2000 characters':type==='number'?'a finite number':'Boolean'));
    if(typeof inputs.trigger!=='boolean')throw new Error('Trigger must be Boolean');
  },
  compute(inputs,state){this._validate(inputs,state);return {value:inputs.value};},
  transition(inputs,state,memory){
    this._validate(inputs,state);
    const emit=memory?.type===state.type && memory.previous===false && inputs.trigger;
    return {state,memory:{type:state.type,previous:inputs.trigger},nextWakeAt:null,
      ...(emit?{events:[{port:'value',payload:inputs.value}]}:{})};
  },
  _text(value,x,y,w,h,size,style,color=style.textColor||'#334155',weight=400){
    const text=String(value).replace(/\s+/g,' '),limit=Math.max(1,Math.floor(w/(size*.7)));
    const chars=typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'
      ?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>part.segment):text?[text]:[];
    return {type:'text',x,y,w,h,text:chars.length>limit?chars.slice(0,Math.max(0,limit-1)).join('')+'…':text,
      plainText:true,align:'left',font:weight+' '+size+'px sans-serif',color,strokeOn:false};
  },
  children(state,style,w,h,editing,io={}){
    const scale=Math.min(w/280,h/116),pad=12*scale,name=(io.name||'').trim()||'Signal → event';
    const value=io.error?io.error:io.outputs?.value;
    const display=typeof value==='number'?Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(8))):value===undefined?'Input unavailable':String(value);
    const children=[{type:'rect',x:0,y:0,w,h,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff',strokeOn:style.strokeOn!==false,color:style.color||'#94a3b8',size:style.size,dash:style.dash},
      this._text(name,pad,pad,w-pad*2,18*scale,13*scale,style,style.textColor||'#334155',600),
      this._text(display,pad,39*scale,w-pad*2,28*scale,io.error?12*scale:19*scale,style,io.error?'#92400e':style.textColor||'#334155',600)];
    if(state.showHints!==false)children.push(this._text('Trigger ↑ captures '+(state.type==='string'?'text':state.type),pad,83*scale,w-pad*2,19*scale,11*scale,style,'#64748b'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,editing,{...io,error:io.error||'Input unavailable'});}
})
