// Step on each false-to-true pulse, wrapping from N to 1; held reset selects 1.
// Fresh runtime memory primes a high pulse without stepping. Saved position survives reload.
// Channels are authoring settings; a changed channel count restarts at 1 and re-primes.
({
  apiVersion:2,
  settings:{channels:{type:'number',default:4,min:2,max:16,step:1,label:'Channels'}},
  inputs(state){
    return {value:{type:'number'},pulse:{type:'boolean',default:false},reset:{type:'boolean',default:false}};
  },
  outputs(state){const ports={};for(let i=1;i<=this._channels(state);i++)ports['out'+i]={type:'number'};return {...ports,position:{type:'number'}};},
  initState(){return {channels:4,configuredChannels:4,position:1,showIndicators:true};},
  initStyle(){return {w:320,h:280,fontSize:18,fill:true,fillColor:'#f8fafc',strokeOn:true,color:'#64748b',textColor:'#334155',size:2};},
  _channels(state){
    const channels=state.channels;
    if(!Number.isInteger(channels) || channels<2 || channels>16)throw new Error('Channels must be an integer from 2 to 16');
    return channels;
  },
  _position(state){
    const channels=this._channels(state);
    if(!Number.isInteger(state.position) || state.position<1)throw new Error('Switch position must be a positive integer');
    return state.configuredChannels!==channels || state.position>channels?1:state.position;
  },
  _valid(value){return Number.isFinite(value);},
  _validate(inputs,state){
    this._position(state);
    if(typeof inputs.pulse!=='boolean' || typeof inputs.reset!=='boolean')throw new Error('Pulse and reset must be Boolean values');
    if(!this._valid(inputs.value))throw new Error('Stepped distributor requires a numeric value');
  },
  transition(inputs,state,memory){
    this._validate(inputs,state);
    const channels=this._channels(state),changed=state.configuredChannels!==channels || memory?.channels!==channels;
    let position=this._position(state);
    if(inputs.reset)position=1;
    else if(!changed && memory?.previous===false && inputs.pulse)position=position%channels+1;
    return {state:{...state,configuredChannels:channels,position},memory:{channels,previous:inputs.pulse},nextWakeAt:null};
  },
  compute(inputs,state){
    this._validate(inputs,state);const position=this._position(state);
    const values={};for(let i=1;i<=this._channels(state);i++)values['out'+i]=i===position?inputs.value:0;
    return {...values,position};
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
    const inputs=io.error?{}:io.inputs||{},outputs=io.error?{}:io.outputs||{},scale=Math.min(w/320,h/280);
    const channels=Number.isInteger(state.channels)&&state.channels>=2&&state.channels<=16?state.channels:4;
    const position=Number.isInteger(outputs.position)?outputs.position:state.configuredChannels===channels&&state.position>=1&&state.position<=channels?state.position:1;
    const distributor=true;
    const available=!io.error && Number.isInteger(outputs.position) && (distributor?this._valid(inputs.value):this._valid(outputs.value));
    const label=value=>!this._valid(value)?'—':typeof value==='boolean'?String(value):String(value).length<=10?String(value):Number(value.toPrecision(4)).toString();
    const text=(value,x,y,width,height,size,align='center')=>({type:'text',x,y,w:width,h:height,text:value,align,font:'600 '+Math.max(6,size*scale)+'px sans-serif',color:style.textColor||style.color,strokeOn:false,fill:false});
    const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2,color:style.color,size:Math.max(1,1.5*scale),strokeOn:true});
    const dot=(x,y)=>({type:'ellipse',x:x-2.5*scale,y:y-2.5*scale,w:5*scale,h:5*scale,fill:true,fillColor:style.fillColor||'#f8fafc',color:style.color,strokeOn:true,size:Math.max(1,scale)});
    const row=i=>h*(.24+.43*(i-1)/(channels-1)),cy=h*.455,pivot=w*(distributor?.38:.64),contact=w*(distributor?.62:.40);
    const children=[
      {...text('',w*.04,0,w*.92,h*.15,16,'left'),...this._caption(io.name,'Stepped distributor',w*.92,h*.15,{...style,fontSize:16*scale})},
      line(pivot,cy,contact,row(position)),dot(pivot,cy),
      line(pivot,cy,w*(distributor?.28:.73),cy),
      text((distributor?'In: ':'Out: ')+label(distributor?inputs.value:outputs.value),w*(distributor?.01:.74),cy-h*.05,w*.25,h*.10,10),
      text('Channel '+position+' / '+channels,w*.08,h*.70,w*.84,h*.10,11),
      text('Pulse: '+(typeof inputs.pulse==='boolean'?String(inputs.pulse):'—'),w*.05,h*.80,w*.42,h*.06,9),
      text('Reset: '+(typeof inputs.reset==='boolean'?String(inputs.reset):'—'),w*.53,h*.80,w*.42,h*.06,9)
    ];
    const leds=[[w*(distributor?.31:.70),cy,distributor?inputs.value:outputs.value],[w*.065,h*.83,inputs.pulse],[w*.545,h*.83,inputs.reset]];
    for(let i=1;i<=channels;i++){
      const y=row(i),value=distributor?outputs['out'+i]:inputs['in'+i],size=Math.min(10,channels>8?8:10);
      children.push(line(contact,y,w*(distributor?.71:.31),y),dot(contact,y));
      children.push({...text(i+': '+label(value),w*(distributor?.74:.01),y-h*.035,w*.25,h*.07,size,distributor?'left':'right'),color:i===position?'#0369a1':style.textColor||style.color});
      leds.push([w*(distributor?.68:.34),y,value]);
    }
    if(state.showIndicators!==false){
      for(const [x,y,value] of leds){
        const present=typeof value==='boolean'||Number.isFinite(value),radius=Math.min(3.5*scale,h*.18/channels);
        children.push({type:'ellipse',x:x-radius,y:y-radius,w:radius*2,h:radius*2,fill:true,
          fillColor:present?(typeof value==='number'?'#2563eb':value?'#15803d':'#64748b'):'#fbbf24',strokeOn:true,color:present?'#f8fafc':'#b45309',size:Math.max(.5,scale*.7)});
      }
    }
    if(!available)children.push({...text(!io.error || /^Missing value or binding/.test(io.error)?'Input required':'Input unavailable',w*.04,h*.88,w*.92,h*.10,10),color:'#92400e'});
    else if(editing){
      children.push({type:'rect',x:w*.05,y:h*.88,w:w*.9,h:h*.09,fill:true,fillColor:'#e2e8f0',strokeOn:false,editorOnly:true});
      children.push({...text('Indicators: '+(state.showIndicators!==false?'on':'off'),w*.05,h*.88,w*.9,h*.09,10),editorOnly:true});
    }
    return children;
  },
  unavailableChildren(state,style,w,h,editing,io={}){return this.children(state,style,w,h,false,{...io,inputs:{},outputs:{},error:io.error||'Input unavailable'});},
  handles(state,w,h){return [{id:'indicators',x:w/2,y:h*.925,kind:'click',editorOnly:true}];},
  hitEdit(state,x,y,w,h){return x>=w*.05 && x<=w*.95 && y>=h*.88 && y<=h*.97?'indicators':null;},
  dragEdit(state,handle){return {state:handle==='indicators'?{...state,showIndicators:state.showIndicators===false}:state};}
})
