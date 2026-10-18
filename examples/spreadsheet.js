// A spreadsheet component, 6 x 6 cells to start with. In edit mode, click a cell to type a number,
// TRUE/FALSE, a label, or a formula starting with "=". Right-click (Control+click on a Mac) a column
// header, a row header or a cell to insert or delete columns/rows from a context menu; on a cell the
// menu also offers "Insert function", which puts the function into the cell (wrapping a formula that
// is already there) and opens the cell with the first placeholder selected, plus "Number format" (how
// a numeric result is shown) and "Alignment" (Left, Center, Right, or Default: numbers right, Booleans
// centered, text left). The shape grows or shrinks by one cell, and formulas follow moved cells as in
// Excel (references to deleted cells become #REF!). Up to 26 columns; at most 128 cells and buttons.
//   =A1+B2*2   =(A1-A2)/A3   =SUM(A1:A9)   =AVERAGE(B1:B5, 10)   =MIN(A1:C3)   =MAX(A1, B1)
//   =A1>20   =A1<>B1   (= <> < > <= >=)   =AND(A1>0, B1)   =OR(...)   =NOT(B2)   =TRUE
//   =IF(A1>20, "hot", "ok")   =IF(B1, A1*2, 0)   (only the chosen branch is evaluated)
//   =A1^2   ="Total: "&B6   ROUND/ROUNDUP/ROUNDDOWN(x;n) INT ABS SIGN MOD SQRT POWER PI() PRODUCT
//   COUNT COUNTA (counts every non-empty cell, also "" and errors) IFERROR(x;alt) ISBLANK ISNUMBER
//   ISTEXT ISERROR  CONCAT LEN UPPER LOWER LEFT(t;n) RIGHT(t;n) MID(t;start;n)
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
// Enter applies the cell; Tab/Shift+Tab apply and move right/left; Escape cancels. An empty entry
// clears the cell. While typing a formula, click a cell (or drag across cells) to insert its reference.
// Errors show as #DIV/0!, #REF!, #NAME?, #VALUE!, #CYCLE!, #N/A or #ERROR!. An output whose formula
// fails makes the component report that error. Row and column headers appear outside the sheet only
// in edit mode. Cells are editable only in the editor; exported HTML recomputes but cannot edit.
// Needs the host's kind:'text' handles with rect (in-place cell editing).
({
  apiVersion:2,
  _COLS:'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  _key(c,r){return this._COLS[c]+(r+1);},
  // Sheets saved before rows/columns could change have no size in their state: they keep 10 x 10.
  _dims(state){
    const n=(v,max)=>Number.isInteger(v)&&v>=1&&v<=max?v:10;
    const cols=n(state.cols,26),rows=n(state.rows,99),wt=state.weights;
    // relative column widths, 1 = the normal width; kept in state only while some column differs
    const weights=Array.isArray(wt)&&wt.length===cols&&wt.every(x=>Number.isFinite(x)&&x>=.01&&x<=200)?wt.slice():Array(cols).fill(1);
    return {cols,rows,weights};
  },
  // The host allows at most 128 handles: one per cell, one for the header area, one width entry per column.
  _fits(cols,rows){return cols*rows+1+cols<=128;},
  // Cell text uses the toolbar font size. With _CAP_FONT on it is also limited to half the row height so
  // it never spills out of a cell; switched off for now because the silent limit surprised users.
  _CAP_FONT:false,
  _cellPx(style,L){const t=style.fontSize||L.px;return Math.max(6,Math.round(this._CAP_FONT?Math.min(t,L.px):t));},
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
    const out=[],re=/\s*(?:(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|"([^"]*)"|'([^']*)'|([A-Za-z]+\d*)|(<=|>=|<>|[-+*\/^&(),;:<>=]))/y;
    let i=0;
    while(i<src.length){
      if(/^\s*$/.test(src.slice(i)))break;
      const gone=/^\s*#REF!/i.exec(src.slice(i));   // a reference to a deleted cell
      if(gone){out.push({t:'referr'});i+=gone[0].length;continue;}
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
  _parse(src,dims){
    const tk=this._tokens(src);let i=0;
    const peek=()=>tk[i],take=t=>{const x=tk[i];if(!x||(t&&x.t!==t))throw {e:'#ERROR!'};i++;return x;};
    const ref=v=>{const m=/^([A-Z])(\d+)$/.exec(v);if(!m)return null;const c=this._COLS.indexOf(m[1]),r=+m[2]-1;
      if(c<0||c>=dims.cols||r<0||r>=dims.rows)throw {e:'#REF!'};return {c,r};};
    const primary=()=>{
      const x=take();
      if(x.t==='num')return {k:'num',v:x.v};
      if(x.t==='str')return {k:'str',v:x.v};
      if(x.t==='referr')throw {e:'#REF!'};
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
    const power=()=>{let a=primary();while(peek()&&peek().t==='^'){take();a={k:'^',a,b:primary()};}return a;};
    const term=()=>{let a=power();while(peek()&&(peek().t==='*'||peek().t==='/')){const op=take().t;a={k:op,a,b:power()};}return a;};
    const sum=()=>{let a=term();while(peek()&&(peek().t==='+'||peek().t==='-')){const op=take().t;a={k:op,a,b:term()};}return a;};
    const concat=()=>{let a=sum();while(peek()&&peek().t==='&'){take();a={k:'&',a,b:sum()};}return a;};
    const CMP=['=','<>','<','>','<=','>='];
    const expr=()=>{let a=concat();while(peek()&&CMP.includes(peek().t)){const op=take().t;a={k:'cmp',op,a,b:concat()};}return a;};
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
  _typeOf(node,cells,seen,dims){
    switch(node.k){
      case 'num':case 'neg':case '+':case '-':case '*':case '/':case '^':return 'number';
      case 'str':case '&':return 'string';
      case 'bool':case 'cmp':return 'boolean';
      case 'ref':return this._cellType(this._key(node.c,node.r),cells,seen,dims);
      case 'fn':{
        const f=node.name;
        if(['AND','OR','NOT','ISBLANK','ISNUMBER','ISTEXT','ISERROR'].includes(f))return 'boolean';
        if(['CONCAT','UPPER','LOWER','LEFT','RIGHT','MID'].includes(f))return 'string';
        if(f==='IFERROR')return node.args[0]?this._typeOf(node.args[0],cells,seen,dims):'number';
        if(f==='VLOOKUP'){
          const t=node.args[1],ci=node.args[2];
          if(!t || t.k!=='range' || !ci || ci.k!=='num')return 'number';
          const col=t.c1+Math.floor(ci.v)-1,types=new Set();
          if(col<t.c1 || col>t.c2)return 'number';
          for(let r=t.r1;r<=t.r2;r++){const k=this._key(col,r);if(cells[k])types.add(this._cellType(k,cells,seen,dims));}
          return types.size===1?[...types][0]:'number';
        }
        if(f==='INPUT')return this._inputType(node)||'number';
        if(f==='OUTPUT')return node.args[0]?this._typeOf(node.args[0],cells,seen,dims):'number';
        if(f==='IF'){
          // The true branch decides the type; a false branch of another type fails at runtime.
          return node.args[1]?this._typeOf(node.args[1],cells,seen,dims):'boolean';
        }
        return 'number';
      }
    }
    return 'number';
  },
  _cellType(k,cells,seen,dims){
    const src=cells[k];
    if(typeof src!=='string'||src==='')return 'number';
    if(src[0]!=='='){
      if(this._bool(src)!==null)return 'boolean';
      return Number.isFinite(Number(src.trim()))&&src.trim()!==''?'number':'string';
    }
    if(seen[k])return 'number';
    seen[k]=true;
    try{return this._typeOf(this._parse(src.slice(1),dims),cells,seen,dims);}catch(_){return 'number';}
    finally{delete seen[k];}
  },
  // Ports declared by the formulas, in cell order (deterministic from saved state).
  _ports(state){
    const cells=state.cells||{},ins=[],outs=[],dims=this._dims(state);
    for(let r=0;r<dims.rows;r++)for(let c=0;c<dims.cols;c++){
      const src=cells[this._key(c,r)];
      if(typeof src!=='string'||src[0]!=='=')continue;
      let tree;try{tree=this._parse(src.slice(1),dims);}catch(_){continue;}
      this._walk(tree,n=>{
        if(n.k!=='fn')return;
        if(n.name==='INPUT'){
          const type=this._inputType(n);
          if(type){const p=this._port(n.args[0].v);if(!ins.some(x=>x.port===p))ins.push({port:p,type,cell:this._key(c,r)});}
        }
        const last=n.args[n.args.length-1];
        if(n.name==='OUTPUT'&&n.args.length===2&&last.k==='str'){
          const p=this._port(last.v);
          if(!outs.some(o=>o.port===p))outs.push({port:p,cell:this._key(c,r),type:this._typeOf(n.args[0],cells,{},dims)});
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
    const cells=state.cells||{},memo={},busy={},dims=this._dims(state);
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
        try{res=wrap(val(this._parse(src.slice(1),dims)));}catch(err){res={e:err&&err.e||'#ERROR!'};}
        busy[k]=false;
      }
      return memo[k]=res;
    };
    const valueOf=(c,r)=>{const x=cell(c,r);if(!x)return 0;if(x.e)throw {e:x.e};return x.t!==undefined?x.t:x.b!==undefined?x.b:x.v;};
    const toNum=v=>{if(typeof v==='boolean')return v?1:0;if(typeof v!=='number')throw {e:'#VALUE!'};return v;};
    const toBool=v=>{if(typeof v==='boolean')return v;if(typeof v==='number')return v!==0;throw {e:'#VALUE!'};};
    const toText=v=>typeof v==='string'?v:typeof v==='boolean'?(v?'TRUE':'FALSE'):String(Number(v.toPrecision(15)));
    // Excel rounding: half away from zero; toPrecision(15) absorbs binary noise such as 1.005*100
    const round=(x,n,mode)=>{const f=Math.pow(10,n),y=Number((Math.abs(x)*f).toPrecision(15));
      return Math.sign(x)*(mode==='up'?Math.ceil(y):mode==='down'?Math.floor(y):Math.round(y))/f;};
    const digits=a=>a===undefined?0:Math.trunc(toNum(val(a)));
    const textArg=(a,dflt)=>a===undefined?dflt:toText(val(a));
    const tryVal=a=>{try{return {v:val(a)};}catch(err){return {e:err&&err.e||'#ERROR!'};}};
    const cellsIn=a=>{const out=[];for(let r=a.r1;r<=a.r2;r++)for(let c=a.c1;c<=a.c2;c++)out.push(cell(c,r));return out;};
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
        case '^':{const r=Math.pow(toNum(val(n.a)),toNum(val(n.b)));if(!Number.isFinite(r))throw {e:'#NUM!'};return r;}
        case '&':return toText(val(n.a))+toText(val(n.b));
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
          // rounding and arithmetic
          if(f==='ROUND'||f==='ROUNDUP'||f==='ROUNDDOWN'){if(a.length<1||a.length>2)throw {e:'#VALUE!'};
            return round(toNum(val(a[0])),digits(a[1]),f==='ROUNDUP'?'up':f==='ROUNDDOWN'?'down':'');}
          if(f==='INT'){if(a.length!==1)throw {e:'#VALUE!'};return Math.floor(toNum(val(a[0])));}
          if(f==='ABS'){if(a.length!==1)throw {e:'#VALUE!'};return Math.abs(toNum(val(a[0])));}
          if(f==='SIGN'){if(a.length!==1)throw {e:'#VALUE!'};return Math.sign(toNum(val(a[0])));}
          if(f==='MOD'){if(a.length!==2)throw {e:'#VALUE!'};const x=toNum(val(a[0])),y=toNum(val(a[1]));if(y===0)throw {e:'#DIV/0!'};return x-y*Math.floor(x/y);}
          if(f==='SQRT'){if(a.length!==1)throw {e:'#VALUE!'};const x=toNum(val(a[0]));if(x<0)throw {e:'#NUM!'};return Math.sqrt(x);}
          if(f==='POWER'){if(a.length!==2)throw {e:'#VALUE!'};const r=Math.pow(toNum(val(a[0])),toNum(val(a[1])));if(!Number.isFinite(r))throw {e:'#NUM!'};return r;}
          if(f==='PI'){if(a.length)throw {e:'#VALUE!'};return Math.PI;}
          if(f==='PRODUCT'){const v=numbers(a);return v.length?v.reduce((p,x)=>p*x,1):0;}
          // counting: COUNT counts numbers; COUNTA every non-empty cell, including "" results and errors
          if(f==='COUNT')return a.reduce((n,x)=>n+(x.k==='range'?cellsIn(x).filter(y=>y&&y.v!==undefined).length:typeof tryVal(x).v==='number'?1:0),0);
          if(f==='COUNTA')return a.reduce((n,x)=>n+(x.k==='range'?cellsIn(x).filter(y=>y!==null).length:x.k==='ref'?(cell(x.c,x.r)!==null?1:0):1),0);
          // errors and tests
          if(f==='IFERROR'){if(a.length!==2)throw {e:'#VALUE!'};const r=tryVal(a[0]);return r.e?val(a[1]):r.v;}
          if(f==='ISBLANK'){if(a.length!==1)throw {e:'#VALUE!'};return a[0].k==='ref'?cell(a[0].c,a[0].r)===null:false;}
          if(f==='ISNUMBER'){if(a.length!==1)throw {e:'#VALUE!'};return typeof tryVal(a[0]).v==='number';}
          if(f==='ISTEXT'){if(a.length!==1)throw {e:'#VALUE!'};return typeof tryVal(a[0]).v==='string';}
          if(f==='ISERROR'){if(a.length!==1)throw {e:'#VALUE!'};return !!tryVal(a[0]).e;}
          // text
          if(f==='CONCAT')return a.map(x=>x.k==='range'?cellsIn(x).map(y=>{if(!y)return '';if(y.e)throw {e:y.e};return toText(y.t!==undefined?y.t:y.b!==undefined?y.b:y.v);}).join(''):toText(val(x))).join('');
          if(f==='LEN'){if(a.length!==1)throw {e:'#VALUE!'};return toText(val(a[0])).length;}
          if(f==='UPPER'||f==='LOWER'){if(a.length!==1)throw {e:'#VALUE!'};const t=toText(val(a[0]));return f==='UPPER'?t.toUpperCase():t.toLowerCase();}
          if(f==='LEFT'||f==='RIGHT'){if(a.length<1||a.length>2)throw {e:'#VALUE!'};const t=textArg(a[0],''),k=a[1]===undefined?1:digits(a[1]);
            if(k<0)throw {e:'#VALUE!'};return f==='LEFT'?t.slice(0,k):k?t.slice(-k):'';}
          if(f==='MID'){if(a.length!==3)throw {e:'#VALUE!'};const t=textArg(a[0],''),st=digits(a[1]),k=digits(a[2]);
            if(st<1||k<0)throw {e:'#VALUE!'};return t.substr(st-1,k);}
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
    for(let r=0;r<dims.rows;r++)for(let c=0;c<dims.cols;c++){const k=this._key(c,r),x=cell(c,r);if(x)all[k]=x;}
    return all;
  },

  initState(){
    return {cols:6,rows:6,cells:{A1:'kWh',A2:'10',A3:'12.5',A4:'7',B1:'Price',B2:'0.3',B3:'0.3',B4:'0.32',
      C1:'Cost',C2:'=A2*B2',C3:'=A3*B3',C4:'=A4*B4',A6:'=SUM(A2:A4)',C6:'=SUM(C2:C4)',
      E1:'Extra',E2:'=INPUT("energy")',F1:'Total',F2:'=OUTPUT(A6+E2,"Total Energy")'}};
  },
  initStyle(){return {w:552,h:168,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#1f2937',size:1};},
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
  // The cells fill the whole box, so entering or leaving edit mode never moves them. Row and column
  // headers, the + / x buttons and the port note are drawn OUTSIDE the box and only while editing
  // (editorOnly), so no export, thumbnail or reader view shows them.
  _layout(w,h,dims){
    // unit: the width of a normal column; xs/ws: left edge and width of every column
    const sum=dims.weights.reduce((a,b)=>a+b,0),unit=w/sum,xs=[],ws=[];
    let x=0;for(const wt of dims.weights){xs.push(x);ws.push(wt*unit);x+=wt*unit;}
    const colAt=px=>{for(let c=0;c<xs.length;c++)if(px<xs[c]+ws[c])return px<0?-1:c;return xs.length;};
    const rh=h/dims.rows,headH=Math.max(14,Math.min(24,rh*.8)),headW=Math.max(20,Math.min(40,unit*.45));
    // hgap: headers stand off the sheet, so the host's selection outline (5 px out) runs between them
    return {unit,xs,ws,colAt,rh,headH,headW,hgap:8,px:Math.max(6,Math.min(18,Math.round(rh*.5)))};
  },
  // What a point in local coordinates refers to: a column header, a row header, a cell, or nothing.
  _target(x,y,w,h,dims){
    const L=this._layout(w,h,dims),c=L.colAt(x),r=Math.floor(y/L.rh);
    const inCols=x>=0&&x<w,inRows=y>=0&&y<h;
    if(inCols&&y<0&&y>=-L.hgap-L.headH)return {col:c};   // the gap counts as the header
    if(inRows&&x<0&&x>=-L.hgap-L.headW)return {row:r};
    if(inCols&&inRows)return {col:c,row:r};
    return null;
  },
  // Functions offered by "Insert function", grouped, with their argument placeholders.
  _FN_GROUPS:[
    ['Math',{SUM:['range'],AVERAGE:['range'],MIN:['range'],MAX:['range'],ROUND:['value','digits'],ROUNDUP:['value','digits'],
      ROUNDDOWN:['value','digits'],INT:['value'],ABS:['value'],SIGN:['value'],MOD:['value','divisor'],SQRT:['value'],
      POWER:['base','exponent'],PI:[],PRODUCT:['range']}],
    ['Logic',{IF:['condition','value_if_true','value_if_false'],AND:['condition1','condition2'],OR:['condition1','condition2'],
      NOT:['condition'],IFERROR:['value','value_if_error'],ISBLANK:['cell'],ISNUMBER:['value'],ISTEXT:['value'],ISERROR:['value']}],
    ['Count & lookup',{COUNT:['range'],COUNTA:['range'],VLOOKUP:['search_key','range','index','is_sorted']}],
    ['Text',{CONCAT:['text1','text2'],LEN:['text'],UPPER:['text'],LOWER:['text'],LEFT:['text','count'],RIGHT:['text','count'],
      MID:['text','start','count']}],
    ['Ports',{INPUT:['"name"'],OUTPUT:['value','"Name"']}],
  ],
  _cellFormat(state,k){const f=(state.formats||{})[k];return this._FORMATS.some(([c])=>c&&c===f)?f:'';},
  _cellAlign(state,k){const a=(state.aligns||{})[k];return ['left','center','right'].includes(a)?a:'';},
  _fnArgs(name){for(const [,fns] of this._FN_GROUPS)if(fns[name])return fns[name];return null;},
  // The cell text after inserting a function, and what to select for typing: the first remaining
  // placeholder (inside its quotes for a "name"), else the caret before ")". What the cell already
  // holds becomes the first argument: a formula is wrapped, a number/TRUE/FALSE kept, text quoted.
  _fnInsert(src,name){
    const args=this._fnArgs(name).slice(),raw=(src||'').trim();
    let first=null;
    if(raw[0]==='=')first=raw.slice(1).trim()||null;
    else if(raw)first=this._bool(raw)!==null||Number.isFinite(Number(raw))?raw:'"'+raw.replace(/"/g,'')+'"';
    const filled=first!==null&&args.length?1:0;
    if(filled)args[0]=first;
    const head='='+name+'(',text=head+args.join(',')+')';   // no spaces: arguments start right after ','
    if(filled<args.length){
      let at=head.length;for(let i=0;i<filled;i++)at+=args[i].length+1;
      const ph=args[filled],q=ph[0]==='"';
      return {text,select:[at+(q?1:0),at+ph.length-(q?1:0)]};
    }
    return {text,select:[text.length-1,text.length-1]};
  },
  // Right-click menu (host contextMenu hook): insert/delete for the clicked column and/or row. The ids
  // are handled by dragEdit like the former buttons: cinsN / rinsN insert AT index N, cdelN / rdelN delete.
  contextMenu(state,x,y,w,h){
    const dims=this._dims(state),t=this._target(x,y,w,h,dims);
    if(!t)return [];
    const items=[],addCol=this._fits(dims.cols+1,dims.rows),addRow=this._fits(dims.cols,dims.rows+1);
    if(t.col!==undefined){
      items.push({id:'cins'+t.col,label:'Insert 1 column left',disabled:!addCol},
        {id:'cins'+(t.col+1),label:'Insert 1 column right',disabled:!addCol},
        {id:'cdel'+t.col,label:'Delete column',disabled:dims.cols<=1});
    }
    if(t.col!==undefined&&t.row===undefined)   // on a column header: its width
      items.push({separator:true},{id:'colw'+t.col,label:'Column width\u2026',edit:{handle:'cw'+t.col}},
        {id:'cwreset'+t.col,label:'Reset column width',disabled:dims.weights[t.col]===1});
    if(t.col!==undefined&&t.row!==undefined)items.push({separator:true});
    if(t.row!==undefined){
      items.push({id:'rins'+t.row,label:'Insert 1 row above',disabled:!addRow},
        {id:'rins'+(t.row+1),label:'Insert 1 row below',disabled:!addRow},
        {id:'rdel'+t.row,label:'Delete row',disabled:dims.rows<=1});
    }
    if(t.col!==undefined&&t.row!==undefined){   // on a cell: insert a function into it
      const cell=this._key(t.col,t.row),src=(state.cells||{})[cell]||'';
      items.push({separator:true},{label:'Insert function',items:this._FN_GROUPS.map(([group,fns])=>({label:group,
        items:Object.entries(fns).map(([name,args])=>{const ins=this._fnInsert(src,name);
          return {id:'fn:'+name+':'+cell,label:name+'('+args.join(', ')+')',edit:{handle:cell,select:ins.select}};})}))});
      // the cell's current choice is ticked
      const fc=this._cellFormat(state,cell),al=this._cellAlign(state,cell),tick=on=>on?'  \u2713':'';
      items.push({label:'Number format',items:this._FORMATS.map(([code,name],i)=>({id:'nf'+i+':'+cell,
        label:name+(code?'  '+this._fmtCode(code.endsWith('%')?.1235:1234.5678,code):'')+tick(code===fc)}))},
        {label:'Alignment',items:this._ALIGNS.map(([a,name])=>({id:'al:'+(a||'default')+':'+cell,label:name+tick(a===al)}))});
    }
    return items;
  },
  // "Number format" entries: [code, name]. Codes are stored per cell in state.formats; Automatic
  // stores nothing. They change only how numbers are shown, never the value formulas compute with.
  _FORMATS:[['','Automatic'],['0','Integer'],['0.0','1 decimal'],['0.00','2 decimals'],['0.000','3 decimals'],
    ['#,##0','Thousands'],['#,##0.00','Thousands, 2 decimals'],['0%','Percent'],['0.00%','Percent, 2 decimals'],
    ['0.00E+0','Scientific']],
  _ALIGNS:[['left','Left'],['center','Center'],['right','Right'],['','Default']],
  _fmtCode(v,code){
    if(!code)return this._fmt(v);
    if(Object.is(v,-0))v=0;
    const dec=(/\.(0+)/.exec(code)||['',''])[1].length;
    if(code.endsWith('E+0')){
      const [m,e]=v.toExponential(dec).split('e');
      return m+'E'+(e[0]==='-'?e:'+'+e.replace('+',''));
    }
    const pct=code.endsWith('%'),n=pct?v*100:v;
    if(Math.abs(n)>=1e21)return this._fmt(v);   // toFixed switches to exponent form there
    let text=n.toFixed(dec);
    if(/^-0(\.0+)?$/.test(text))text=text.slice(1);
    if(code.startsWith('#,'))text=text.replace(/^(-?)(\d+)/,(all,sign,int)=>sign+int.replace(/\B(?=(\d{3})+(?!\d))/g,','));
    return text+(pct?'%':'');
  },
  _fmt(v){
    if(Object.is(v,-0))v=0;
    const a=Math.abs(v);
    if(a!==0&&(a>=1e9||a<1e-4))return v.toExponential(3);
    return String(Math.round(v*1e4)/1e4);
  },
  _draw(state,style,w,h,editing,inputs,errorNote){
    const dims=this._dims(state),L=this._layout(w,h,dims),items=[],sheet=this._sheet(state,inputs),ports=this._ports(state);
    const ink=style.color||'#64748b',textInk=style.textColor||'#1f2937',grid='#cbd5e1';
    // Cells and headers follow the toolbar's font family and size; the size is capped by the row
    // height (L.px) so text never spills out of its cell.
    const family=['sans','serif','mono','cursive'].includes(style.fontFamily)?style.fontFamily:'sans';
    const cap=size=>Math.max(6,Math.round(Math.min(style.fontSize||L.px,size)));
    const label=(text,x,y,tw,th,align,color,bold,size)=>({type:'text',x,y,w:tw,h:th,text:String(text),align:align||'center',
      fontFamily:family,fontSize:size?cap(size):this._cellPx(style,L),textColor:color||textInk,color:color||textInk,strokeOn:false,fill:false});
    items.push({type:'rect',x:0,y:0,w,h,color:ink,size:1,strokeOn:false,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff'});
    for(let r=0;r<dims.rows;r++)for(let c=0;c<dims.cols;c++){
      const x=sheet[this._key(c,r)];
      if(!x)continue;
      const k=this._key(c,r),fc=this._cellFormat(state,k);
      const text=x.e||(x.t!==undefined?x.t:x.b!==undefined?(x.b?'TRUE':'FALSE'):this._fmtCode(x.v,fc));
      // the cell's own alignment, else numbers right, Booleans centered, text left
      const align=this._cellAlign(state,k)||(x.v!==undefined?'right':x.b!==undefined?'center':'left');
      items.push(label(text,L.xs[c],r*L.rh,L.ws[c],L.rh,align,x.e?'#b91c1c':textInk));
    }
    // Cell borders and the outer frame both follow the toolbar's stroke color, width and dash
    // pattern; Stroke "None" hides all of them.
    if(style.strokeOn!==false){
      const line={color:ink,size:style.size||1,dash:style.dash||'solid'};
      for(let i=1;i<dims.cols;i++)items.push({type:'line',x1:L.xs[i],y1:0,x2:L.xs[i],y2:h,...line});
      for(let i=1;i<dims.rows;i++)items.push({type:'line',x1:0,y1:i*L.rh,x2:w,y2:i*L.rh,...line});
      items.push({type:'rect',x:0,y:0,w,h,...line,strokeOn:true,fill:false});
    }
    if(editing){
      const head=(text,x,y,hw,hh)=>{
        items.push({type:'rect',x,y,w:hw,h:hh,fill:true,fillColor:'#f1f5f9',strokeOn:true,color:grid,size:1,editorOnly:true});
        items.push({...label(text,x,y,hw,hh,'center','#475569',true,Math.min(L.px,hh*.6)),editorOnly:true});
      };
      for(let c=0;c<dims.cols;c++)head(this._COLS[c],L.xs[c],-L.hgap-L.headH,L.ws[c],L.headH);
      for(let r=0;r<dims.rows;r++)head(r+1,-L.hgap-L.headW,r*L.rh,L.headW,L.rh);
      // Ports listed below the x lane with their cells, e.g. "energy (E2)", "door (B5, bool)". Inputs and
      // outputs start on separate lines and are wrapped here, one text child per line with its own fixed
      // height, so a long list grows downward and is never clipped by the drawing's bounds.
      const tag=x=>x.port+' ('+x.cell+(x.type==='number'?'':', '+(x.type==='boolean'?'bool':x.type))+')';
      const groups=errorNote?[{words:errorNote.split(/\s+/),comma:false}]:[ports.ins.length?['In:',...ports.ins.map(tag)]:null,ports.outs.length?['Out:',...ports.outs.map(tag)]:null].filter(Boolean).map(words=>({words,comma:true}));
      const npx=Math.min(12,L.px),lineH=Math.ceil(npx*1.35),perLine=Math.max(8,Math.floor((w-12)/(npx*.62)));   // conservative glyph width
      const lines=[];
      for(const {words,comma} of groups){
        let line='';
        for(const [i,word] of words.entries()){
          const piece=!comma||i===0||i===words.length-1?word:word+',';
          const next=line?line+' '+piece:piece;
          if(line && next.length>perLine){lines.push(line);line=piece;}else line=next;
        }
        if(line)lines.push(line);
      }
      const top=h+6;
      lines.forEach((text,i)=>items.push({...label(text,0,top+i*lineH,w,lineH,'left',errorNote?'#92400e':'#475569',false,npx),editorOnly:true}));
    }
    return items;
  },
  children(state,style,w,h,editing,io={}){return this._draw(state,style,w,h,editing,io.inputs||{},'');},
  unavailableChildren(state,style,w,h,editing,io={}){
    const msg=typeof io.error==='string'&&io.error?io.error:'Unavailable';
    return this._draw(state,style,w,h,editing,null,msg.length>120?msg.slice(0,117)+'…':msg);
  },
  // One in-place text field per cell (the host lays it over `rect`; Tab moves to the neighbour).
  // editorOnly: cells are edited only in the editor. Exported HTML keeps recomputing from its inputs
  // but offers no way to change values or formulas.
  handles(state,w,h,style={}){
    const dims=this._dims(state),L=this._layout(w,h,dims),hs=[];
    const fontSize=this._cellPx(style,L);   // same size the cell text is drawn with
    for(let r=0;r<dims.rows;r++)for(let c=0;c<dims.cols;c++){
      const k=this._key(c,r);
      hs.push({id:k,x:L.xs[c]+L.ws[c]/2,y:(r+.5)*L.rh,kind:'text',value:(state.cells||{})[k]||'',label:'Cell '+k,
        rect:{x:L.xs[c],y:r*L.rh,w:L.ws[c],h:L.rh},ref:k,fontSize,...(this._cellAlign(state,k)?{align:this._cellAlign(state,k)}:{}),editorOnly:true});   // ref: pointing at it inserts 'B3'
    }
    // width entries, reached only through "Column width..." in the header menu (never hit directly)
    for(let c=0;c<dims.cols;c++)hs.push({id:'cw'+c,x:L.xs[c]+L.ws[c]/2,y:-L.hgap-L.headH/2,kind:'number',
      value:Math.round(L.ws[c]),min:8,max:2000,step:1,editorOnly:true});
    // One do-nothing handle for the headers (and the gap to the sheet): a left click there keeps edit
    // mode instead of counting as a click outside the shape. Right-click opens the context menu.
    hs.push({id:'headers',x:-L.hgap-L.headW/2,y:-L.hgap-L.headH/2,kind:'click',editorOnly:true});
    return hs;
  },
  hitEdit(state,x,y,w,h){
    const dims=this._dims(state),L=this._layout(w,h,dims),c=L.colAt(x),r=Math.floor(y/L.rh);
    if(c>=0&&c<dims.cols&&r>=0&&r<dims.rows)return this._key(c,r);
    const t=this._target(x,y,w,h,dims);
    return t?'headers':null;
  },
  // ---------- inserting and deleting columns/rows ----------
  // Moves cells and rewrites every formula's references, as Excel does: references at or past an
  // inserted index shift by one, ranges grow when the insertion is inside them; references to a deleted
  // column/row become #REF!, ranges shrink. axis: 'c' or 'r'; delta +1 inserts AT index, -1 deletes it.
  _restructure(state,axis,at,delta){
    const dims=this._dims(state),cells={};
    const move=i=>delta>0?(i>=at?i+1:i):(i===at?null:i>at?i-1:i);
    const parse=k=>{const m=/^([A-Z])(\d+)$/.exec(k);return m?{c:this._COLS.indexOf(m[1]),r:+m[2]-1}:null;};
    const shiftRef=(col,row)=>{
      const c=this._COLS.indexOf(col.toUpperCase()),r=+row-1;
      const n=axis==='c'?move(c):move(r);
      if(n===null)return null;
      return axis==='c'?this._COLS[n]+(r+1):col.toUpperCase()+(n+1);
    };
    const shiftRange=(c1,r1,c2,r2)=>{   // endpoints in letter/number form
      const a=axis==='c'?this._COLS.indexOf(c1.toUpperCase()):+r1-1,b=axis==='c'?this._COLS.indexOf(c2.toUpperCase()):+r2-1;
      const lo=Math.min(a,b),hi=Math.max(a,b);
      let nlo,nhi;
      if(delta>0){nlo=lo>=at?lo+1:lo;nhi=hi>=at?hi+1:hi;}
      else{if(lo===at&&hi===at)return null;nlo=lo>at?lo-1:lo;nhi=hi>=at?hi-1:hi;}
      const end=(c,r,i)=>axis==='c'?this._COLS[i]+r:c.toUpperCase()+(i+1);
      return end(c1,r1,nlo)+':'+end(c2,r2,nhi);
    };
    // rewrite references outside quoted text; strings keep their quotes as typed
    const quoted=/(["\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033][^"\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033]*["\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033]|['\u2018\u2019\u201A\u201B\u2032][^'\u2018\u2019\u201A\u201B\u2032]*['\u2018\u2019\u201A\u201B\u2032])/;
    const refRe=/(^|[^A-Za-z0-9_.])([A-Za-z])(\d+)(?:\s*:\s*([A-Za-z])(\d+))?(?![A-Za-z0-9_(])/g;
    const rewrite=src=>src[0]!=='='?src:'='+src.slice(1).split(quoted).map((part,i)=>i%2?part:part.replace(refRe,(all,pre,c1,r1,c2,r2)=>{
      if(c2!==undefined){const x=shiftRange(c1,r1,c2,r2);return pre+(x===null?'#REF!':x);}
      const x=shiftRef(c1,r1);return pre+(x===null?'#REF!':x);
    })).join('');
    for(const [k,src] of Object.entries(state.cells||{})){
      const pos=parse(k);if(!pos)continue;
      const n=axis==='c'?move(pos.c):move(pos.r);
      if(n===null)continue;   // the deleted column/row's own cells
      cells[axis==='c'?this._key(n,pos.r):this._key(pos.c,n)]=rewrite(src);
    }
    const next={...state,cells,cols:dims.cols+(axis==='c'?delta:0),rows:dims.rows+(axis==='r'?delta:0)};
    for(const prop of ['formats','aligns']){   // per-cell settings move with their cells
      if(!state[prop])continue;
      const out={};
      for(const [k,v] of Object.entries(state[prop])){
        const pos=parse(k);if(!pos)continue;
        const n=axis==='c'?move(pos.c):move(pos.r);
        if(n!==null)out[axis==='c'?this._key(n,pos.r):this._key(pos.c,n)]=v;
      }
      if(Object.keys(out).length)next[prop]=out;else delete next[prop];
    }
    if(axis==='c'&&Array.isArray(state.weights)){
      const wt=dims.weights.slice();
      if(delta>0)wt.splice(at,0,wt[Math.max(0,at-1)]);else wt.splice(at,1);
      if(wt.every(x=>x===1))delete next.weights;else next.weights=wt;
    }
    return next;
  },
  dragEdit(state,handle,value,ly,w,h){
    const dims=this._dims(state),op=/^([cr])(ins|del)(\d+)$/.exec(handle);
    if(op){
      const axis=op[1],add=op[2]==='ins',i=+op[3],count=axis==='c'?dims.cols:dims.rows;
      if(i>(add?count:count-1) || (!add && count<=1) || (add && !this._fits(dims.cols+(axis==='c'),dims.rows+(axis==='r'))))return {state};
      const next=this._restructure(state,axis,i,add?1:-1);
      if(JSON.stringify(next).length>3900)return {state};   // keep within the 4,000-character state limit
      // grow/shrink by one cell so the cells keep their size (the host keeps the top-left corner)
      const L=this._layout(w,h,dims),colPx=add?L.ws[Math.max(0,i-1)]:L.ws[i];
      return {state:next,size:axis==='c'?{w:w+(add?colPx:-colPx)}:{h:h+(add?L.rh:-L.rh)}};
    }
    const width=/^(cw|cwreset|colw)(\d+)$/.exec(handle);
    if(width){   // column width: the shape grows/shrinks by the difference, other columns keep theirs
      const c=+width[2];
      if(c>=dims.cols||width[1]==='colw')return {state};   // colw: only opens the width entry
      const L=this._layout(w,h,dims),px=width[1]==='cw'?Math.max(8,Math.min(2000,Number(value))):L.unit;
      if(!Number.isFinite(px))return {state};
      const wt=dims.weights.slice();wt[c]=width[1]==='cw'?px/L.unit:1;
      const next={...state};
      if(wt.every(x=>x===1))delete next.weights;else next.weights=wt.map(x=>Math.round(x*1e4)/1e4);
      return {state:next,size:{w:w-L.ws[c]+px}};
    }
    const fn=/^fn:([A-Z]+):([A-Z]\d+)$/.exec(handle);
    if(fn){   // "Insert function" from the context menu
      const [,name,k]=fn,c=this._COLS.indexOf(k[0]),r=+k.slice(1)-1;
      if(!this._fnArgs(name)||c<0||c>=dims.cols||r<0||r>=dims.rows)return {state};
      const next={...state,cells:{...(state.cells||{}),[k]:this._fnInsert((state.cells||{})[k],name).text}};
      return {state:JSON.stringify(next).length>3900?state:next};
    }
    const look=/^(?:nf(\d+)|al:(left|center|right|default)):([A-Z]\d+)$/.exec(handle);
    if(look){   // "Number format" / "Alignment" from the context menu
      const [,fi,al,k]=look,c=this._COLS.indexOf(k[0]),r=+k.slice(1)-1;
      if(c<0||c>=dims.cols||r<0||r>=dims.rows)return {state};
      const prop=fi!==undefined?'formats':'aligns';
      const v=fi!==undefined?(this._FORMATS[+fi]||[''])[0]:al==='default'?'':al;
      const map={...(state[prop]||{})};
      if(v)map[k]=v;else delete map[k];
      const next={...state};
      if(Object.keys(map).length)next[prop]=map;else delete next[prop];
      return {state:JSON.stringify(next).length>3900?state:next};
    }
    const cell=/^([A-Z])(\d+)$/.exec(handle);
    if(!cell||this._COLS.indexOf(cell[1])>=dims.cols||+cell[2]<1||+cell[2]>dims.rows||typeof value!=='string')return {state};
    const cells={...(state.cells||{})},text=value.trim();
    if(text)cells[handle]=text;else delete cells[handle];
    const next={...state,cells};
    return {state:JSON.stringify(next).length>3900?state:next};   // keep within the 4,000-character state limit
  }
})
