// A 10 x 10 spreadsheet component (columns A-J, rows 1-10). In edit mode, click a cell to type a
// number, TRUE/FALSE, a label, or a formula starting with "=":
//   =A1+B2*2   =(A1-A2)/A3   =SUM(A1:A9)   =AVERAGE(B1:B5, 10)   =MIN(A1:C3)   =MAX(A1, B1)
//   =A1>20   =A1<>B1   (= <> < > <= >=)   =AND(A1>0, B1)   =OR(...)   =NOT(B2)   =TRUE
//   =IF(A1>20, "hot", "ok")   =IF(B1, A1*2, 0)   (only the chosen branch is evaluated)
//   =VLOOKUP(A1, D1:F9, 2, FALSE)   exact match with FALSE/0, otherwise the largest key <= the
//                                value in an ascending first column (as in Excel)
//   Arguments may be separated by "," or ";"  (=IF(A1>20; "hot"; "ok"))
//   Text may use straight, typographic or single quotes: "x", „x“, “x”, 'x'
//   =INPUT("energy")             number input port; connect it to any output in Inputs...
//   =INPUT("door", "boolean")    Boolean input port ("number" is the default type)
//   =OUTPUT(F10, "Total Energy") shows F10's value and publishes it as an output port; its type
//                                (number, Boolean or text) follows the formula, e.g. OUTPUT(A1>20,"Alarm")
// Port names keep letters, digits and underscores ("Total Energy" becomes Total_Energy).
// Booleans count as 1/0 in arithmetic; SUM/AVERAGE/MIN/MAX ranges skip Booleans, text and empty cells.
// Enter/Tab apply the cell and move down/right; Escape cancels. An empty entry clears the cell.
// Errors show as #DIV/0!, #REF!, #NAME?, #VALUE!, #CYCLE!, #N/A or #ERROR!. An output whose formula
// fails makes the component report that error. Row and column headers appear outside the sheet only
// in edit mode. Cells are editable only in the editor; exported HTML recomputes but cannot edit.
// Needs the host's kind:'text' handles with rect (in-place cell editing).
({
  apiVersion:2,
  _COLS:'ABCDEFGHIJ',
  _key(c,r){return this._COLS[c]+(r+1);},
  _port(name){
    let p=String(name).trim().replace(/[^A-Za-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64);
    if(!/^[A-Za-z]/.test(p))p=('p'+p).slice(0,64);
    return p;
  },
  _bool(text){const t=String(text).trim().toUpperCase();return t==='TRUE'?true:t==='FALSE'?false:null;},

  // ---------- formula parser (no eval) ----------
  _tokens(src){
    // Typographic quotes (often inserted by keyboards or autocorrect) count as straight ones, and text
    // may also be written in single quotes: "x", „x“, “x”, 'x', ‚x‘ all mean the same string.
    src=src.replace(/[“”„‟«»″]/g,'"').replace(/[‘’‚‛′]/g,"'");
    const out=[],re=/\s*(?:(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|"([^"]*)"|'([^']*)'|([A-Za-z]+\d*)|(<=|>=|<>|[-+*\/(),;:<>=]))/y;
    let i=0;
    while(i<src.length){
      if(/^\s*$/.test(src.slice(i)))break;
      re.lastIndex=i;const m=re.exec(src);
      if(!m)throw {e:'#ERROR!'};
      i=re.lastIndex;
      if(m[1]!==undefined)out.push({t:'num',v:parseFloat(m[1])});
      else if(m[2]!==undefined||m[3]!==undefined)out.push({t:'str',v:m[2]!==undefined?m[2]:m[3]});
      else if(m[4]!==undefined)out.push({t:'id',v:m[4].toUpperCase()});
      else out.push({t:m[5]===';'?',':m[5]});   // ';' is accepted as an argument separator, like ','
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
        if(x.v==='TRUE'||x.v==='FALSE')return {k:'bool',v:x.v==='TRUE'};
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
    const sum=()=>{let a=term();while(peek()&&(peek().t==='+'||peek().t==='-')){const op=take().t;a={k:op,a,b:term()};}return a;};
    const CMP=['=','<>','<','>','<=','>='];
    const expr=()=>{let a=sum();while(peek()&&CMP.includes(peek().t)){const op=take().t;a={k:'cmp',op,a,b:sum()};}return a;};
    const tree=expr();if(i!==tk.length)throw {e:'#ERROR!'};
    return tree;
  },
  _walk(node,fn){
    if(!node||typeof node!=='object')return;
    fn(node);
    for(const k of ['a','b'])this._walk(node[k],fn);
    if(node.args)for(const x of node.args)this._walk(x,fn);
  },
  _inputType(node){   // INPUT("name") / INPUT("name","boolean"|"number"); null = malformed
    const a=node.args;
    if(!a.length||a.length>2||a[0].k!=='str')return null;
    if(a.length===1)return 'number';
    const t=a[1].k==='str'?a[1].v.trim().toLowerCase():'';
    return t==='number'||t==='boolean'?t:null;
  },
  // Static type of an expression -- port types must follow from saved state, not from live values.
  _typeOf(node,cells,seen){
    switch(node.k){
      case 'num':case 'neg':case '+':case '-':case '*':case '/':return 'number';
      case 'str':return 'string';
      case 'bool':case 'cmp':return 'boolean';
      case 'ref':return this._cellType(this._key(node.c,node.r),cells,seen);
      case 'fn':{
        const f=node.name;
        if(f==='AND'||f==='OR'||f==='NOT')return 'boolean';
        if(f==='VLOOKUP'){
          const t=node.args[1],ci=node.args[2];
          if(!t || t.k!=='range' || !ci || ci.k!=='num')return 'number';
          const col=t.c1+Math.floor(ci.v)-1,types=new Set();
          if(col<t.c1 || col>t.c2)return 'number';
          for(let r=t.r1;r<=t.r2;r++){const k=this._key(col,r);if(cells[k])types.add(this._cellType(k,cells,seen));}
          return types.size===1?[...types][0]:'number';
        }
        if(f==='INPUT')return this._inputType(node)||'number';
        if(f==='OUTPUT')return node.args[0]?this._typeOf(node.args[0],cells,seen):'number';
        if(f==='IF'){
          // The true branch decides the type; a false branch of another type fails at runtime.
          return node.args[1]?this._typeOf(node.args[1],cells,seen):'boolean';
        }
        return 'number';
      }
    }
    return 'number';
  },
  _cellType(k,cells,seen){
    const src=cells[k];
    if(typeof src!=='string'||src==='')return 'number';
    if(src[0]!=='='){
      if(this._bool(src)!==null)return 'boolean';
      return Number.isFinite(Number(src.trim()))&&src.trim()!==''?'number':'string';
    }
    if(seen[k])return 'number';
    seen[k]=true;
    try{return this._typeOf(this._parse(src.slice(1)),cells,seen);}catch(_){return 'number';}
    finally{delete seen[k];}
  },
  // Ports declared by the formulas, in cell order (deterministic from saved state).
  _ports(state){
    const cells=state.cells||{},ins=[],outs=[];
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){
      const src=cells[this._key(c,r)];
      if(typeof src!=='string'||src[0]!=='=')continue;
      let tree;try{tree=this._parse(src.slice(1));}catch(_){continue;}
      this._walk(tree,n=>{
        if(n.k!=='fn')return;
        if(n.name==='INPUT'){
          const type=this._inputType(n);
          if(type){const p=this._port(n.args[0].v);if(!ins.some(x=>x.port===p))ins.push({port:p,type});}
        }
        const last=n.args[n.args.length-1];
        if(n.name==='OUTPUT'&&n.args.length===2&&last.k==='str'){
          const p=this._port(last.v);
          if(!outs.some(o=>o.port===p))outs.push({port:p,cell:this._key(c,r),type:this._typeOf(n.args[0],cells,{})});
        }
      });
    }
    return {ins:ins.slice(0,32),outs:outs.slice(0,32)};
  },
  inputs(state){const m={};for(const x of this._ports(state).ins)m[x.port]={type:x.type,default:x.type==='boolean'?false:0};return m;},
  outputs(state){const m={};for(const o of this._ports(state).outs)m[o.port]={type:o.type};return m;},

  // ---------- evaluation ----------
  // Every cell -> {v:number} | {b:boolean} | {t:text} | {e:error}; empty cells are absent.
  _sheet(state,inputs){
    const cells=state.cells||{},memo={},busy={};
    const wrap=v=>typeof v==='boolean'?{b:v}:typeof v==='string'?{t:v}:Number.isFinite(v)?{v}:{e:'#NUM!'};
    const cell=(c,r)=>{
      const k=this._key(c,r);
      if(memo[k])return memo[k];
      if(busy[k])return {e:'#CYCLE!'};
      const src=cells[k];
      if(typeof src!=='string'||src==='')return null;
      let res;
      if(src[0]!=='='){
        const b=this._bool(src),n=Number(src.trim());
        res=b!==null?{b}:src.trim()!==''&&Number.isFinite(n)?{v:n}:{t:src};
      }else{
        busy[k]=true;
        try{res=wrap(val(this._parse(src.slice(1))));}catch(err){res={e:err&&err.e||'#ERROR!'};}
        busy[k]=false;
      }
      return memo[k]=res;
    };
    const valueOf=(c,r)=>{const x=cell(c,r);if(!x)return 0;if(x.e)throw {e:x.e};return x.t!==undefined?x.t:x.b!==undefined?x.b:x.v;};
    const toNum=v=>{if(typeof v==='boolean')return v?1:0;if(typeof v!=='number')throw {e:'#VALUE!'};return v;};
    const toBool=v=>{if(typeof v==='boolean')return v;if(typeof v==='number')return v!==0;throw {e:'#VALUE!'};};
    const rangeValues=(a,keep)=>{   // values of a range, skipping empty cells and anything keep() rejects
      const out=[];
      for(let r=a.r1;r<=a.r2;r++)for(let c=a.c1;c<=a.c2;c++){
        const x=cell(c,r);if(!x)continue;if(x.e)throw {e:x.e};
        const v=x.t!==undefined?x.t:x.b!==undefined?x.b:x.v;if(keep(v))out.push(v);
      }
      return out;
    };
    const numbers=args=>args.flatMap(a=>a.k==='range'?rangeValues(a,v=>typeof v==='number'):[toNum(val(a))]);
    const booleans=args=>args.flatMap(a=>a.k==='range'?rangeValues(a,v=>typeof v!=='string').map(toBool):[toBool(val(a))]);
    const val=n=>{
      switch(n.k){
        case 'num':case 'str':case 'bool':return n.v;
        case 'ref':return valueOf(n.c,n.r);
        case 'range':throw {e:'#VALUE!'};
        case 'neg':return -toNum(val(n.a));
        case '+':return toNum(val(n.a))+toNum(val(n.b));
        case '-':return toNum(val(n.a))-toNum(val(n.b));
        case '*':return toNum(val(n.a))*toNum(val(n.b));
        case '/':{const b=toNum(val(n.b));if(b===0)throw {e:'#DIV/0!'};return toNum(val(n.a))/b;}
        case 'cmp':{
          const a=val(n.a),b=val(n.b);
          if(n.op==='='||n.op==='<>'){
            const same=typeof a==='string'&&typeof b==='string'?a.toLowerCase()===b.toLowerCase():
              typeof a===typeof b?a===b:false;
            return n.op==='='?same:!same;
          }
          const x=toNum(a),y=toNum(b);
          return n.op==='<'?x<y:n.op==='>'?x>y:n.op==='<='?x<=y:x>=y;
        }
        case 'fn':{
          const f=n.name,a=n.args;
          if(f==='SUM')return numbers(a).reduce((s,x)=>s+x,0);
          if(f==='AVERAGE'){const v=numbers(a);if(!v.length)throw {e:'#DIV/0!'};return v.reduce((s,x)=>s+x,0)/v.length;}
          if(f==='MIN'){const v=numbers(a);return v.length?Math.min(...v):0;}
          if(f==='MAX'){const v=numbers(a);return v.length?Math.max(...v):0;}
          if(f==='AND'){if(!a.length)throw {e:'#VALUE!'};return booleans(a).every(Boolean);}
          if(f==='OR'){if(!a.length)throw {e:'#VALUE!'};return booleans(a).some(Boolean);}
          if(f==='NOT'){if(a.length!==1)throw {e:'#VALUE!'};return !toBool(val(a[0]));}
          if(f==='VLOOKUP'){
            if(a.length<3||a.length>4||a[1].k!=='range')throw {e:'#VALUE!'};
            const want=val(a[0]),t=a[1],ci=Math.floor(toNum(val(a[2])));
            const exact=a.length===4?!toBool(val(a[3])):false;
            if(ci<1)throw {e:'#VALUE!'};
            if(t.c1+ci-1>t.c2)throw {e:'#REF!'};
            const keyOf=r=>{const x=cell(t.c1,r);return !x||x.e?undefined:x.t!==undefined?x.t:x.b!==undefined?x.b:x.v;};
            const same=(k,v)=>typeof k==='string'&&typeof v==='string'?k.toLowerCase()===v.toLowerCase():k===v;
            let hit=-1;
            for(let r=t.r1;r<=t.r2;r++){
              const k=keyOf(r);
              if(k===undefined)continue;
              if(exact){if(same(k,want)){hit=r;break;}continue;}
              // approximate: last key <= wanted value before the first larger key (ascending first column)
              const cmp=typeof k==='number'&&typeof want==='number'?k-want:
                typeof k==='string'&&typeof want==='string'?k.toLowerCase().localeCompare(want.toLowerCase()):null;
              if(cmp===null)continue;
              if(cmp>0)break;
              hit=r;
            }
            if(hit<0)throw {e:'#N/A'};
            return valueOf(t.c1+ci-1,hit);
          }
          if(f==='IF'){
            if(a.length<2||a.length>3)throw {e:'#VALUE!'};
            return toBool(val(a[0]))?val(a[1]):a.length===3?val(a[2]):false;
          }
          if(f==='INPUT'){
            const type=this._inputType(n);if(!type)throw {e:'#VALUE!'};
            const v=inputs?inputs[this._port(a[0].v)]:undefined;
            if(type==='boolean'?typeof v!=='boolean':!Number.isFinite(v))throw {e:'#N/A'};
            return v;
          }
          if(f==='OUTPUT'){if(a.length!==2||a[1].k!=='str')throw {e:'#VALUE!'};return val(a[0]);}
          throw {e:'#NAME?'};
        }
      }
      throw {e:'#ERROR!'};
    };
    const all={};
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){const k=this._key(c,r),x=cell(c,r);if(x)all[k]=x;}
    return all;
  },

  initState(){
    return {cells:{A1:'kWh',A2:'10',A3:'12.5',A4:'7',B1:'Price',B2:'0.3',B3:'0.3',B4:'0.32',
      C1:'Cost',C2:'=A2*B2',C3:'=A3*B3',C4:'=A4*B4',A6:'=SUM(A2:A4)',C6:'=SUM(C2:C4)',
      A7:'=AVERAGE(A2:A4)',A8:'=MAX(A2:A4)-MIN(A2:A4)',E1:'Extra',E2:'=INPUT("energy")',
      F1:'Total',F2:'=OUTPUT(A6+E2,"Total Energy")'}};
  },
  initStyle(){return {w:640,h:240,fontSize:12,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#1f2937',size:1};},
  compute(inputs,state){
    const sheet=this._sheet(state,inputs),out={};
    for(const o of this._ports(state).outs){
      const x=sheet[o.cell];
      if(!x||x.e)throw new Error('Output '+o.port+' in '+o.cell+': '+(x&&x.e||'empty'));
      const v=x.t!==undefined?x.t:x.b!==undefined?x.b:x.v;
      if(typeof v!==o.type)throw new Error('Output '+o.port+' in '+o.cell+': expected '+o.type+', got '+typeof v);
      out[o.port]=v;
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
    items.push({type:'rect',x:0,y:0,w,h,color:ink,size:1,strokeOn:false,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff'});
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){
      const x=sheet[this._key(c,r)];
      if(!x)continue;
      const text=x.e||(x.t!==undefined?x.t:x.b!==undefined?(x.b?'TRUE':'FALSE'):this._fmt(x.v));
      const align=x.v!==undefined?'right':x.b!==undefined?'center':'left';   // numbers right, Booleans centered
      items.push(label(text,c*L.cw,r*L.rh,L.cw,L.rh,align,x.e?'#b91c1c':textInk));
    }
    // Cell borders and the outer frame both follow the toolbar's stroke color, width and dash
    // pattern; Stroke "None" hides all of them.
    if(style.strokeOn!==false){
      const line={color:ink,size:style.size||1,dash:style.dash||'solid'};
      for(let i=1;i<10;i++){
        items.push({type:'line',x1:i*L.cw,y1:0,x2:i*L.cw,y2:h,...line});
        items.push({type:'line',x1:0,y1:i*L.rh,x2:w,y2:i*L.rh,...line});
      }
      items.push({type:'rect',x:0,y:0,w,h,...line,strokeOn:true,fill:false});
    }
    if(editing){
      const head=(text,x,y,hw,hh)=>{
        items.push({type:'rect',x,y,w:hw,h:hh,fill:true,fillColor:'#f1f5f9',strokeOn:true,color:grid,size:1,editorOnly:true});
        items.push({...label(text,x,y,hw,hh,'center','#475569',true,Math.min(L.px,hh*.6)),editorOnly:true});
      };
      for(let c=0;c<10;c++)head(this._COLS[c],c*L.cw,-L.headH,L.cw,L.headH);
      for(let r=0;r<10;r++)head(r+1,-L.headW,r*L.rh,L.headW,L.rh);
      const note=errorNote||[ports.ins.length?'In: '+ports.ins.map(x=>x.port+(x.type==='boolean'?' (bool)':'')).join(', '):'',ports.outs.length?'Out: '+ports.outs.map(o=>o.port+(o.type!=='number'?' ('+(o.type==='boolean'?'bool':o.type)+')':'')).join(', '):''].filter(Boolean).join('   ');
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
  // editorOnly: cells are edited only in the editor. Exported HTML keeps recomputing from its inputs
  // but offers no way to change values or formulas.
  handles(state,w,h){
    const L=this._layout(w,h),hs=[];
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){
      const k=this._key(c,r);
      hs.push({id:k,x:(c+.5)*L.cw,y:(r+.5)*L.rh,kind:'text',value:(state.cells||{})[k]||'',label:'Cell '+k,
        rect:{x:c*L.cw,y:r*L.rh,w:L.cw,h:L.rh},editorOnly:true});
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
