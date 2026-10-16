// Decimal digit decoder or individually driven seven-segment display.
// Segment order: a top, b upper-right, c lower-right, d bottom,
// e lower-left, f upper-left, g middle. Enable gates every segment and the decimal point.
({
  apiVersion:2,
  settings:{mode:{type:'string',default:'number',options:['number','segments'],label:'Input mode'}},
  inputs(state){
    const data=this._mode(state)==='number'?{value:{type:'number'}}:
      Object.fromEntries(Array.from('abcdefg',name=>[name,{type:'boolean',default:false}]));
    return {...data,decimalPoint:{type:'boolean',default:false},enable:{type:'boolean',default:true}};
  },
  outputs:{a:{type:'boolean'},b:{type:'boolean'},c:{type:'boolean'},d:{type:'boolean'},e:{type:'boolean'},f:{type:'boolean'},g:{type:'boolean'},decimalPoint:{type:'boolean'}},
  initState(){return {mode:'number'};},
  initStyle(){return {w:200,h:280,fontSize:18,fill:true,fillColor:'#0f172a',strokeOn:true,color:'#475569',textColor:'#334155',size:2};},
  _mode(state){
    if(!['number','segments'].includes(state.mode))throw new Error('Input mode must be number or segments');
    return state.mode;
  },
  _validate(inputs,state){
    if(this._mode(state)==='number'){
      if(!Number.isInteger(inputs.value) || inputs.value<0 || inputs.value>9)throw new Error('Seven-segment value must be an integer from 0 to 9');
    }else{
      for(const name of 'abcdefg')if(typeof inputs[name]!=='boolean')throw new Error('Segment '+name+' must be Boolean');
    }
    if(typeof inputs.decimalPoint!=='boolean' || typeof inputs.enable!=='boolean')throw new Error('Decimal point and enable must be Boolean');
  },
  compute(inputs,state){
    this._validate(inputs,state);
    const digit=this._mode(state)==='number'?['abcdef','bc','abdeg','abcdg','bcfg','acdfg','acdefg','abc','abcdefg','abcdfg'][inputs.value]:null;
    const outputs={};
    for(const name of 'abcdefg')outputs[name]=inputs.enable&&(digit===null?inputs[name]:digit.includes(name));
    return {...outputs,decimalPoint:inputs.enable&&inputs.decimalPoint};
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
  children(state,style,w,h,editing,io={}){
    const rawInputs=io.inputs||{},rawOutputs=io.outputs||{};
    let available=!io.error && [...'abcdefg','decimalPoint'].every(name=>typeof rawOutputs[name]==='boolean');
    if(available){try{this._validate(rawInputs,state);}catch{available=false;}}
    const outputs=available?rawOutputs:{},scale=Math.min(w/200,h/280);
    const text=(value,x,y,width,height,size,color=style.textColor||style.color)=>({type:'text',x,y,w:width,h:height,text:value,align:'center',font:'600 '+Math.max(4,size*scale)+'px sans-serif',color,textColor:color,strokeOn:false,fill:false});
    const children=[
      {...text('',w*.02,0,w*.96,h*.15,16),...this._caption(io.name,'Seven-segment display',w*.96,h*.15,{...style,fontSize:16*scale})},
      {type:'rect',x:w*.12,y:h*.19,w:w*.76,h:h*.76,fill:true,fillColor:style.fillColor||'#0f172a',strokeOn:style.strokeOn,color:style.color,size:style.size}
    ];
    const left=w*.25,right=w*.72,top=h*.28,middle=h*.55,bottom=h*.82,t=Math.min(w*.075,h*.04);
    const horizontal=y=>[
      {x:left+t*.60,y},{x:left+t*1.10,y:y-t*.50},{x:right-t*1.10,y:y-t*.50},
      {x:right-t*.60,y},{x:right-t*1.10,y:y+t*.50},{x:left+t*1.10,y:y+t*.50}
    ];
    const vertical=(x,y1,y2)=>[
      {x,y:y1+t*.60},{x:x+t*.50,y:y1+t*1.10},{x:x+t*.50,y:y2-t*1.10},
      {x,y:y2-t*.60},{x:x-t*.50,y:y2-t*1.10},{x:x-t*.50,y:y1+t*1.10}
    ];
    const segments={a:horizontal(top),b:vertical(right,top,middle),c:vertical(right,middle,bottom),
      d:horizontal(bottom),e:vertical(left,middle,bottom),f:vertical(left,top,middle),g:horizontal(middle)};
    for(const [name,points] of Object.entries(segments))children.push({type:'polygon',closed:true,points,fill:true,
      fillColor:outputs[name]===true?'#ef4444':'#243047',strokeOn:false});
    const diameter=Math.min(w*.055,h*.04);
    children.push({type:'ellipse',x:w*.81-diameter/2,y:h*.84-diameter/2,w:diameter,h:diameter,
      fill:true,fillColor:outputs.decimalPoint===true?'#ef4444':'#243047',strokeOn:false});
    if(!available){
      const message=typeof io.error==='string'?io.error:'';
      const note=/integer from 0 to 9/i.test(message)?'Integer 0–9 required':!message || /^Missing value or binding/.test(message)?'Input required':'Input unavailable';
      children.push({...text('',w*.14,h*.875,w*.72,h*.07,10,'#fbbf24'),...this._caption(note,'Input unavailable',w*.72,h*.07,{...style,fontSize:10*scale})});
    }else if(!rawInputs.enable)children.push(text('Disabled',w*.14,h*.875,w*.72,h*.07,10,'#94a3b8'));
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,inputs:{},outputs:{},error:io.error||'Input unavailable'});}
})
