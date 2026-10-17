// A 10 x 10 spreadsheet component (columns A-J, rows 1-10). In edit mode, click a cell to type a
// number, a label, or a formula starting with "=":
//   =A1+B2*2   =(A1-A2)/A3   =SUM(A1:A9)   =AVERAGE(B1:B5, 10)   =MIN(A1:C3)   =MAX(A1, B1)
//   =INPUT("energy")             reads an input port; connect it to any output in Inputs...
//   =OUTPUT(F10, "Total Energy") shows F10's value and publishes it as an output port
// Port names keep letters, digits and underscores ("Total Energy" becomes Total_Energy).
// Enter/Tab apply the cell and move down/right; Escape cancels. An empty entry clears the cell.
// Errors show as #DIV/0!, #REF!, #NAME?, #VALUE!, #CYCLE!, #N/A or #ERROR!. An output whose formula
// fails makes the component report that error. Row and column headers appear outside the sheet only
// in edit mode. Needs the host's kind:'text' handles with rect (in-place cell editing).
({
  apiVersion:2,
  _COLS:'ABCDEFGHIJ',
  _key(c,r){return this._COLS[c]+(r+1);},
  _port(name){
    let p=String(name).trim().replace(/[^A-Za-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64);
    if(!/^[A-Za-z]/.test(p))p=('p'+p).slice(0,64);
    return p;
  },

  // ---------- formula parser (no eval) ----------
  _tokens(src){
    const out=[],re=/\s*(?:(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|"([^"]*)"|([A-Za-z]+\d*)|([-+*\/(),:]))/y;
    let i=0;
    while(i<src.length){
      if(/^\s*$/.test(src.slice(i)))break;
      re.lastIndex=i;const m=re.exec(src);
      if(!m)throw {e:'#ERROR!'};
      i=re.lastIndex;
      if(m[1]!==undefined)out.push({t:'num',v:parseFloat(m[1])});
      else if(m[2]!==undefined)out.push({t:'str',v:m[2]});
      else if(m[3]!==undefined)out.push({t:'id',v:m[3].toUpperCase()});
      else out.push({t:m[4]});
    }
    return out;
  },
  _parse(src){
    const tk=this._tokens(src);let i=0;
    const peek=()=>tk[i],take=t=>{const x=tk[i];if(!x||(t&&x.t!==t))throw {e:'#ERROR!'};i++;return x;};
    const ref=v=>{const m=/^([A-Z])(\d+)$/.exec(v);if(!m)return null;const c=this._COLS.indexOf(m[1]),r=+m[2]-1;
      if(c<0||r<0||r>9)throw {e:'#REF!'};return {c,r};};
    const primary=()=>{
      const x=take();
      if(x.t==='num')return {k:'num',v:x.v};
      if(x.t==='str')return {k:'str',v:x.v};
      if(x.t==='(') {const e=expr();take(')');return e;}
      if(x.t==='-')return {k:'neg',a:primary()};
      if(x.t==='+')return primary();
      if(x.t==='id'){
        if(peek()&&peek().t==='('){
          take('(');const args=[];
          if(!(peek()&&peek().t===')'))do{args.push(arg());}while(peek()&&peek().t===','&&take(','));
          take(')');return {k:'fn',name:x.v,args};
        }
        const a=ref(x.v);if(!a)throw {e:'#NAME?'};
        return {k:'ref',...a};
      }
      throw {e:'#ERROR!'};
    };
    const arg=()=>{   // a range is only allowed directly as a function argument
      const save=i,x=peek();
      if(x&&x.t==='id'&&tk[i+1]&&tk[i+1].t===':'){
        const a=ref(x.v);i+=2;const y=take('id'),b=ref(y.v);
        if(!a||!b)throw {e:'#REF!'};
        return {k:'range',c1:Math.min(a.c,b.c),c2:Math.max(a.c,b.c),r1:Math.min(a.r,b.r),r2:Math.max(a.r,b.r)};
      }
      i=save;return expr();
    };
    const term=()=>{let a=primary();while(peek()&&(peek().t==='*'||peek().t==='/')){const op=take().t;a={k:op,a,b:primary()};}return a;};
    const expr=()=>{let a=term();while(peek()&&(peek().t==='+'||peek().t==='-')){const op=take().t;a={k:op,a,b:term()};}return a;};
    const tree=expr();if(i!==tk.length)throw {e:'#ERROR!'};
    return tree;
  },
  _walk(node,fn){
    if(!node||typeof node!=='object')return;
    fn(node);
    for(const k of ['a','b'])this._walk(node[k],fn);
    if(node.args)for(const x of node.args)this._walk(x,fn);
  },
  // Port names declared by the formulas, in cell order (deterministic from saved state).
  _ports(state){
    const ins=[],outs=[];
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){
      const src=(state.cells||{})[this._key(c,r)];
      if(typeof src!=='string'||src[0]!=='=')continue;
      let tree;try{tree=this._parse(src.slice(1));}catch(_){continue;}
      this._walk(tree,n=>{
        if(n.k!=='fn')return;
        const last=n.args[n.args.length-1];
        if(n.name==='INPUT'&&n.args.length===1&&last.k==='str'){const p=this._port(last.v);if(!ins.includes(p))ins.push(p);}
        if(n.name==='OUTPUT'&&n.args.length===2&&last.k==='str'){const p=this._port(last.v);if(!outs.some(o=>o.port===p))outs.push({port:p,cell:this._key(c,r)});}
      });
    }
    return {ins:ins.slice(0,32),outs:outs.slice(0,32)};
  },
  inputs(state){const m={};for(const p of this._ports(state).ins)m[p]={type:'number',default:0};return m;},
  outputs(state){const m={};for(const o of this._ports(state).outs)m[o.port]={type:'number'};return m;},

  // ---------- evaluation ----------
  // Every cell -> {v:number} | {t:text} | {e:error}; empty cells are absent.
  _sheet(state,inputs){
    const cells=state.cells||{},memo={},busy={};
    const cell=(c,r)=>{
      const k=this._key(c,r);
      if(memo[k])return memo[k];
      if(busy[k])return {e:'#CYCLE!'};
      const src=cells[k];
      if(typeof src!=='string'||src==='')return null;
      let res;
      if(src[0]!=='='){const n=Number(src.trim());res=src.trim()!==''&&Number.isFinite(n)?{v:n}:{t:src};}
      else{
        busy[k]=true;
        try{res={v:num(this._parse(src.slice(1)))};}catch(err){res={e:err&&err.e||'#ERROR!'};}
        busy[k]=false;
      }
      return memo[k]=res;
    };
    const valueOf=(c,r)=>{const x=cell(c,r);if(!x)return 0;if(x.e)throw {e:x.e};if(x.t!==undefined)throw {e:'#VALUE!'};return x.v;};
    const list=args=>{   // numbers for SUM/AVERAGE/MIN/MAX: ranges skip empty and text cells
      const out=[];
      for(const a of args){
        if(a.k==='range'){for(let r=a.r1;r<=a.r2;r++)for(let c=a.c1;c<=a.c2;c++){const x=cell(c,r);if(x&&x.e)throw {e:x.e};if(x&&x.v!==undefined)out.push(x.v);}}
        else out.push(num(a));
      }
      return out;
    };
    const num=n=>{
      switch(n.k){
        case 'num':return n.v;
        case 'str':throw {e:'#VALUE!'};
        case 'ref':return valueOf(n.c,n.r);
        case 'range':throw {e:'#VALUE!'};
        case 'neg':return -num(n.a);
        case '+':return num(n.a)+num(n.b);
        case '-':return num(n.a)-num(n.b);
        case '*':return num(n.a)*num(n.b);
        case '/':{const b=num(n.b);if(b===0)throw {e:'#DIV/0!'};return num(n.a)/b;}
        case 'fn':{
          const f=n.name,a=n.args;
          if(f==='SUM')return list(a).reduce((s,x)=>s+x,0);
          if(f==='AVERAGE'){const v=list(a);if(!v.length)throw {e:'#DIV/0!'};return v.reduce((s,x)=>s+x,0)/v.length;}
          if(f==='MIN'){const v=list(a);return v.length?Math.min(...v):0;}
          if(f==='MAX'){const v=list(a);return v.length?Math.max(...v):0;}
          if(f==='INPUT'){
            if(a.length!==1||a[0].k!=='str')throw {e:'#VALUE!'};
            const v=inputs?inputs[this._port(a[0].v)]:undefined;
            if(!Number.isFinite(v))throw {e:'#N/A'};
            return v;
          }
          if(f==='OUTPUT'){if(a.length!==2||a[1].k!=='str')throw {e:'#VALUE!'};return num(a[0]);}
          throw {e:'#NAME?'};
        }
      }
      throw {e:'#ERROR!'};
    };
    const all={};
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){
      const k=this._key(c,r),x=cell(c,r);
      if(!x)continue;
      all[k]=x.v!==undefined&&!Number.isFinite(x.v)?{e:'#NUM!'}:x;   // overflow such as 1e308*10
    }
    return all;
  },

  initState(){
    return {cells:{A1:'kWh',A2:'10',A3:'12.5',A4:'7',B1:'Price',B2:'0.3',B3:'0.3',B4:'0.32',
      C1:'Cost',C2:'=A2*B2',C3:'=A3*B3',C4:'=A4*B4',A6:'=SUM(A2:A4)',C6:'=SUM(C2:C4)',
      A7:'=AVERAGE(A2:A4)',A8:'=MAX(A2:A4)-MIN(A2:A4)',E1:'Extra',E2:'=INPUT("energy")',
      F1:'Total',F2:'=OUTPUT(A6+E2,"Total Energy")'}};
  },
  initStyle(){return {w:640,h:240,fontSize:12,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#64748b',textColor:'#1f2937',size:1};},
  compute(inputs,state){
    const sheet=this._sheet(state,inputs),out={};
    for(const o of this._ports(state).outs){
      const x=sheet[o.cell];
      if(!x||x.e||x.v===undefined)throw new Error('Output '+o.port+' in '+o.cell+': '+(x&&x.e||'no number'));
      out[o.port]=x.v;
    }
    return out;
  },

  // ---------- drawing and editing ----------
  // The ten by ten cells fill the whole box, so entering or leaving edit mode never moves them. Row and
  // column headers and the port note are drawn OUTSIDE the box and only while editing (editorOnly), so
  // no export, thumbnail or reader view shows them.
  _layout(w,h){
    const cw=w/10,rh=h/10,headH=Math.max(14,Math.min(24,rh*.8)),headW=Math.max(20,Math.min(40,cw*.45));
    return {cw,rh,headH,headW,px:Math.max(6,Math.min(18,Math.round(rh*.5)))};
  },
  _fmt(v){
    if(Object.is(v,-0))v=0;
    const a=Math.abs(v);
    if(a!==0&&(a>=1e9||a<1e-4))return v.toExponential(3);
    return String(Math.round(v*1e4)/1e4);
  },
  _draw(state,style,w,h,editing,inputs,errorNote){
    const L=this._layout(w,h),items=[],sheet=this._sheet(state,inputs),ports=this._ports(state);
    const ink=style.color||'#64748b',textInk=style.textColor||'#1f2937',grid='#cbd5e1';
    // Cells and headers follow the toolbar's font family and size; the size is capped by the row
    // height (L.px) so text never spills out of its cell.
    const family=['sans','serif','mono','cursive'].includes(style.fontFamily)?style.fontFamily:'sans';
    const cap=size=>Math.max(6,Math.round(Math.min(style.fontSize||L.px,size)));
    const label=(text,x,y,tw,th,align,color,bold,size)=>({type:'text',x,y,w:tw,h:th,text:String(text),align:align||'center',
      fontFamily:family,fontSize:cap(size||L.px),textColor:color||textInk,color:color||textInk,strokeOn:false,fill:false});
    const outCells=new Set(ports.outs.map(o=>o.cell));
    items.push({type:'rect',x:0,y:0,w,h,color:ink,size:1,strokeOn:false,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff'});
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){
      const k=this._key(c,r),x=sheet[k],src=(state.cells||{})[k]||'';
      const isIn=/INPUT\s*\(/i.test(src),isOut=outCells.has(k);
      if(isIn||isOut)items.push({type:'rect',x:c*L.cw,y:r*L.rh,w:L.cw,h:L.rh,fill:true,fillColor:isOut?'#dcfce7':'#dbeafe',strokeOn:false});
      if(!x)continue;
      const text=x.e||(x.t!==undefined?x.t:this._fmt(x.v)),numeric=x.v!==undefined;
      items.push(label(text,c*L.cw,r*L.rh,L.cw,L.rh,numeric?'right':'left',x.e?'#b91c1c':textInk,numeric&&isOut));
    }
    for(let i=1;i<10;i++){   // inner grid lines, then the outer frame on top
      items.push({type:'line',x1:i*L.cw,y1:0,x2:i*L.cw,y2:h,color:grid,size:1});
      items.push({type:'line',x1:0,y1:i*L.rh,x2:w,y2:i*L.rh,color:grid,size:1});
    }
    items.push({type:'rect',x:0,y:0,w,h,color:ink,size:style.size||1,strokeOn:style.strokeOn!==false,fill:false});
    if(editing){
      const head=(text,x,y,hw,hh)=>{
        items.push({type:'rect',x,y,w:hw,h:hh,fill:true,fillColor:'#f1f5f9',strokeOn:true,color:grid,size:1,editorOnly:true});
        items.push({...label(text,x,y,hw,hh,'center','#475569',true,Math.min(L.px,hh*.6)),editorOnly:true});
      };
      for(let c=0;c<10;c++)head(this._COLS[c],c*L.cw,-L.headH,L.cw,L.headH);
      for(let r=0;r<10;r++)head(r+1,-L.headW,r*L.rh,L.headW,L.rh);
      const note=errorNote||[ports.ins.length?'In: '+ports.ins.join(', '):'',ports.outs.length?'Out: '+ports.outs.map(o=>o.port).join(', '):''].filter(Boolean).join('   ');
      if(note)items.push({...label(note,0,h+2,w,Math.max(14,L.headH),'left',errorNote?'#92400e':'#475569',false,Math.min(12,L.px)),editorOnly:true});
    }
    return items;
  },
  children(state,style,w,h,editing,io={}){return this._draw(state,style,w,h,editing,io.inputs||{},'');},
  unavailableChildren(state,style,w,h,editing,io={}){
    const msg=typeof io.error==='string'&&io.error?io.error:'Unavailable';
    return this._draw(state,style,w,h,editing,null,msg.length>120?msg.slice(0,117)+'…':msg);
  },
  // One in-place text field per cell (the host lays it over `rect`; Enter/Tab move to the neighbour).
  handles(state,w,h){
    const L=this._layout(w,h),hs=[];
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){
      const k=this._key(c,r);
      hs.push({id:k,x:(c+.5)*L.cw,y:(r+.5)*L.rh,kind:'text',value:(state.cells||{})[k]||'',label:'Cell '+k,
        rect:{x:c*L.cw,y:r*L.rh,w:L.cw,h:L.rh}});
    }
    return hs;
  },
  hitEdit(state,x,y,w,h){
    const L=this._layout(w,h),c=Math.floor(x/L.cw),r=Math.floor(y/L.rh);
    return c>=0&&c<10&&r>=0&&r<10?this._key(c,r):null;
  },
  dragEdit(state,handle,value){
    if(!/^[A-J](10|[1-9])$/.test(handle)||typeof value!=='string')return {state};
    const cells={...(state.cells||{})},text=value.trim();
    if(text)cells[handle]=text;else delete cells[handle];
    const next={...state,cells};
    return {state:JSON.stringify(next).length>3900?state:next};   // keep within the 4,000-character state limit
  }
})
