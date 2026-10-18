// Editable formula grid; dataset ranges (INPUT with a range) and typed dataset formula ports.
({
  apiVersion:2,
  _number(value){return !Number.isFinite(value)?'—':Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(8)));},
  tablePresentation:'full',
  _COLS:'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  _key(c,r){return this._COLS[c]+(r+1);},
  _dims(state){
    const n=(v,max)=>Number.isInteger(v)&&v>=1&&v<=max?v:10;
    const cols=n(state.cols,26),rows=n(state.rows,99),wt=state.weights;
    const weights=Array.isArray(wt)&&wt.length===cols&&wt.every(x=>Number.isFinite(x)&&x>=.01&&x<=200)?wt.slice():Array(cols).fill(1);
    return {cols,rows,weights};
  },
  _fits(cols,rows){return cols<=26&&rows<=99&&cols*rows+1+cols<=128;},
  // =INPUT("name",A1:C6[,start][,access]) in a cell outside the range declares a table
  // input and shows it there: the first row holds the column names, the rows below the records from start
  // (0-based). Access 1 writes cells back to a Dataset-owned table, 2 also in HTML, 0 (default) reads. Sheets saved with
  // the former Grid source: Dataset settings keep that area at A1 (input data, startRow).
  _rc:new WeakMap(),
  _regions(state){
    if(this._rc.has(state))return this._rc.get(state);
    const dims=this._dims(state),list=[];
    if(state.source==='Dataset'){
      const n=(v,f,max)=>Number.isInteger(v)&&v>=1&&v<=max?v:f;
      list.push({cell:null,port:'data',c1:0,r1:0,c2:Math.min(dims.cols,n(state.dataColumns,3,26))-1,r2:Math.min(dims.rows,n(state.dataRows,5,99)+1)-1,
        start:{k:'fn',name:'INPUT',args:[{k:'str',v:'startRow'}]},edit:state.editDataset===true,reader:state.allowReaderEdit===true});
    }
    for(const [k,src] of Object.entries(state.cells||{})){
      if(typeof src!=='string'||!/^=\s*INPUT\s*\(/i.test(src))continue;
      let n;try{n=this._parse(src.slice(1),dims);}catch{continue;}
      const a=n.k==='fn'&&n.name==='INPUT'?n.args:[],port=a[0]?.k==='str'?a[0].v:null;
      if(!port||a[1]?.k!=='range'||a.length>4)continue;
      const mode=!a[3]?0:a[3].k==='num'&&[0,1,2].includes(a[3].v)?a[3].v:-1;   // 0 read only, 1 edit, 2 edit also in HTML
      list.push({cell:k,port:this._port(port),c1:a[1].c1,r1:a[1].r1,c2:a[1].c2,r2:a[1].r2,start:a[2]||null,mode,edit:mode>=1,reader:mode===2});
    }
    this._rc.set(state,list);return list;
  },
  // A cell that only declares a table (INPUT(name,range,...) or OUTPUT(range,...)) stays blank; in edit
  // mode it shows a grey INPUT/OUTPUT marker.
  _tableCell(src){return typeof src!=='string'?'':/^=\s*INPUT\s*\([^,;]*[,;]\s*[A-Z]\d+\s*:\s*[A-Z]\d+/i.test(src)?'INPUT':/^=\s*OUTPUT\s*\(\s*[A-Z]\d+\s*:\s*[A-Z]\d+/i.test(src)?'OUTPUT':'';},
  _regionAt(state,c,r){return this._regions(state).find(g=>c>=g.c1&&c<=g.c2&&r>=g.r1&&r<=g.r2)||null;},
  _reserved(state,c,r){return !!this._regionAt(state,c,r);},
  // OUTPUT(A1:C4,"name"[,type,type,...]): the range's first row names the columns (as shown, so also a
  // dataset header or a formula), the rows below are the records. Names and types are read when the sheet
  // computes; optional type codes per column (0 automatic, 1 number, 2 string, 3 boolean) fix types.
  _rangeTable(n,ctx,at){
    const a=n.args,t=a[0],fail=m=>{throw new Error('Table output in '+at+': '+m);};
    const cols=t.c2-t.c1+1;
    if(a.length<2||a.length>2+cols||a[1].k!=='str'||!a[1].v.trim()||a[1].v.length>120)fail('use OUTPUT(A1:C4,"name"[,type per column])');
    if(t.r2<=t.r1)fail('the range needs a header row and record rows');
    const list=a.length===3&&a[2].k==='str'&&/[,;]/.test(a[2].v)?a[2].v.split(/[,;]/).map(v=>({k:'str',v})):a.slice(2);
    if(list.length>cols)fail('give at most one type per column');
    const types=Array.from({length:cols},(_,i)=>this._typeArg(list[i]));
    if(types.includes(null))fail('types are 0 (automatic), 1 (number), 2 (string) or 3 (boolean)');
    return {name:a[1].v.trim(),types,at,c1:t.c1,r1:t.r1,c2:t.c2,r2:t.r2,range:this._key(t.c1,t.r1)+':'+this._key(t.c2,t.r2)};
  },
  _resultTable(run,spec,state={},tables={}){
    const fail=m=>{throw new Error('Table output in '+spec.at+': '+m);},keys=new Set(),columns=[],rows=[];
    for(let c=spec.c1;c<=spec.c2;c++){
      const k=this._key(c,spec.r1),x=run.cell(c,spec.r1);
      if(x?.e)throw new Error('Table output in '+k+': '+x.e);
      const key=x?String(x.t!==undefined?x.t:x.b!==undefined?(x.b?'TRUE':'FALSE'):x.v).trim():'';
      if(!key||key.length>100||['__proto__','prototype','constructor'].includes(key)||keys.has(key))fail(k+' needs a unique column name');
      // a dataset header cell keeps its column's key and name, so a mirrored table keeps its schema
      const g=this._regionAt(state,c,spec.r1),src=g&&g.r1===spec.r1&&tables[g.port]?.columns?.[c-g.c1];
      keys.add(key);columns.push({key:src?src.key:key,name:src?src.name:key,type:spec.types[c-spec.c1]||null});
    }
    for(let r=spec.r1+1;r<=spec.r2;r++){
      const row=[];
      for(let c=spec.c1;c<=spec.c2;c++){
        const x=run.cell(c,r),key=this._key(c,r);
        if(x?.e)throw new Error('Table output in '+key+': '+x.e);
        const value=!x?null:x.t!==undefined?x.t:x.b!==undefined?x.b:x.v,type=columns[c-spec.c1].type;
        if(type&&value!==null&&typeof value!==type)throw new Error('Table output in '+key+': expected '+type+' within dataset limits');   // given types: report the source cell first
        row.push(value);
      }
      rows.push(row);
    }
    columns.forEach((col,i)=>{
      if(!col.type){
        const found=[...new Set(rows.map(row=>row[i]).filter(v=>v!==null).map(v=>typeof v))];
        if(found.length!==1)fail('column '+col.key+(found.length?' mixes types':' has no values')+'; give its type after the name, e.g. OUTPUT(A1:B4,"t",2,1) (1 number, 2 string, 3 boolean)');
        col.type=found[0];
      }
      rows.forEach((row,r)=>{const value=row[i],type=col.type;
        if(value!==null&&(typeof value!==type||type==='number'&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value))||type==='string'&&value.length>2000))
          throw new Error('Table output in '+this._key(spec.c1+i,spec.r1+1+r)+': expected '+type+' within dataset limits');});
    });
    const table={name:spec.name,columns,rows};
    if(JSON.stringify(table).length>500000)throw new Error('Table output exceeds the dataset storage limit');
    return {table};
  },
  _literal(value){return value==null?'':typeof value==='string'?"'"+value:typeof value==='boolean'?(value?'TRUE':'FALSE'):String(value);},
  importTable(state,table,w,h){
    if(!table||!Array.isArray(table.columns)||!Array.isArray(table.rows)||table.rowCount!==undefined&&table.rowCount!==table.rows.length)throw new Error('Import requires a complete dataset');
    let cols=table.columns.length,rows=table.rows.length+1;
    if(!cols||!this._fits(cols,rows))throw new Error('Dataset does not fit the editable grid (26 columns, 99 rows and 128 cell/width controls maximum). Filter it or use a live dataset instead.');
    const cells={},literal=value=>{const text=this._literal(value);if(text.length>2000)throw new Error('Dataset cell exceeds the editable text limit (2,000 characters including the literal marker). Use a live dataset instead.');return text;};
    table.columns.forEach((col,c)=>{cells[this._key(c,0)]=literal(col.name);});
    table.rows.forEach((row,r)=>table.columns.forEach((col,c)=>{const raw=literal(row[c]);if(raw)cells[this._key(c,r+1)]=raw;}));
    // Leave a formula row and column when the bounded grid has room.
    if(this._fits(cols+1,rows+1)){cols++;rows++;}
    else if(this._fits(cols,rows+1))rows++;
    else if(this._fits(cols+1,rows))cols++;
    const next={...state,cols,rows,cells};
    for(const key of ['source','dataRows','dataColumns','editDataset','allowReaderEdit'])delete next[key];
    for(const key of ['formats','aligns','weights'])delete next[key];
    if(JSON.stringify(next).length>3900)throw new Error('Dataset text exceeds the editable grid storage limit (4,000 characters). Filter it or use a live dataset instead.');
    const old=this._dims(state),L=this._layout(w,h,old);
    return {state:next,size:{w:Math.max(20,Math.min(2000,L.unit*cols)),h:Math.max(20,Math.min(2000,L.rh*rows))}};
  },
  _CAP_FONT:false,
  _cellPx(style,L){const t=style.fontSize||L.px;return Math.max(6,Math.round(this._CAP_FONT?Math.min(t,L.px):t));},
  _port(name){
    let p=String(name).trim().replace(/[^A-Za-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64);
    if(!/^[A-Za-z]/.test(p))p=('p'+p).slice(0,64);
    return p;
  },
  _bool(text){const t=String(text).trim().toUpperCase();return t==='TRUE'?true:t==='FALSE'?false:null;},

  _tokens(src){
    src=src.replace(/[“”„‟«»″]/g,'"').replace(/[‘’‚‛′]/g,"'");
    const out=[],re=/\s*(?:(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|"((?:[^"]|"")*)"|'((?:[^']|'')*)'|([A-Za-z]+\d*)|(<=|>=|<>|[-+*\/^&(),;:<>=]))/y;
    let i=0;
    while(i<src.length){
      if(/^\s*$/.test(src.slice(i)))break;
      const gone=/^\s*#REF!/i.exec(src.slice(i));
      if(gone){out.push({t:'referr'});i+=gone[0].length;continue;}
      re.lastIndex=i;const m=re.exec(src);
      if(!m)throw {e:'#ERROR!'};
      i=re.lastIndex;
      if(m[1]!==undefined)out.push({t:'num',v:parseFloat(m[1])});
      else if(m[2]!==undefined||m[3]!==undefined)out.push({t:'str',v:m[2]!==undefined?m[2].replace(/""/g,'"'):m[3].replace(/''/g,"'")});
      else if(m[4]!==undefined)out.push({t:'id',v:m[4].toUpperCase()});
      else out.push({t:m[5]===';'?',':m[5]});
    }
    return out;
  },
  _parse(src,dims){
    const tk=this._tokens(src);let i=0;
    const peek=()=>tk[i],take=t=>{const x=tk[i];if(!x||(t&&x.t!==t))throw {e:'#ERROR!'};i++;return x;};
    const ref=v=>{const m=/^([A-Z])(\d+)$/.exec(v);if(!m)return null;const c=this._COLS.indexOf(m[1]),r=+m[2]-1;
      return {c,r,invalid:c<0||c>=dims.cols||r<0||r>=dims.rows};};
    const primary=()=>{
      const x=take();
      if(x.t==='num')return {k:'num',v:x.v};
      if(x.t==='str')return {k:'str',v:x.v};
      if(x.t==='referr')return {k:'error',e:'#REF!'};
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
        return a.invalid?{k:'error',e:'#REF!'}:{k:'ref',c:a.c,r:a.r};
      }
      throw {e:'#ERROR!'};
    };
    const arg=()=>{   // a range is only allowed directly as a function argument
      const save=i,x=peek();
      if(x&&x.t==='id'&&tk[i+1]&&tk[i+1].t===':'){
        const a=ref(x.v);i+=2;const y=take('id'),b=ref(y.v);
        if(!a||!b||a.invalid||b.invalid)return {k:'error',e:'#REF!'};
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
  // A type argument: 0 automatic (''), 1 number, 2 string, 3 boolean, or the type's name; null if invalid.
  _typeArg(n){
    if(!n)return '';
    if(n.k==='num')return ['','number','string','boolean'][n.v]??null;
    const t=n.k==='str'?n.v.trim().toLowerCase():'';
    return ['number','string','boolean'].includes(t)?t:null;
  },
  _inputType(node){
    const a=node.args;
    if(!a.length||a.length>2||a[0].k!=='str')return null;
    const t=this._typeArg(a[1]);
    return t===''?'number':t;
  },
  _dataCall(node){
    const a=node.args,f=node.name;
    if(!['DATA','COLUMN','ROWS'].includes(f)||!a[0]||a[0].k!=='str')return null;
    if(f==='ROWS')return a.length===1?{port:this._port(a[0].v)}:null;
    const key=a[f==='DATA'?2:1];
    if(!key||key.k!=='str'||(f==='DATA'?(a.length<3||a.length>4):a.length!==2))return null;
    const type=this._typeArg(a[3]);
    return type===null?null:{port:this._port(a[0].v),key:key.v,type:type||'number'};
  },
  _outputType(node,ctx){
    const a=node.args;if(a.length<2||a.length>3||a[1].k!=='str')return null;
    const type=this._typeArg(a[2]);
    return type===''?this._typeOf(a[0],ctx):type;
  },
  _analysis(state){
    const dims=this._dims(state),cells={...(state.cells||{})};
    for(const g of this._regions(state))for(let r=g.r1;r<=g.r2;r++)for(let c=g.c1;c<=g.c2;c++)delete cells[this._key(c,r)];
    return {state,cells,dims,trees:new Map(),types:new Map(),typeBusy:new Set(),nodeTypes:new WeakMap(),inputCells:new Map(),inputBusy:new Set(),inputNodes:new WeakMap()};
  },
  _tree(k,ctx){
    if(ctx.trees.has(k))return ctx.trees.get(k);
    const src=ctx.cells[k];let tree;
    try{tree=this._parse(src.slice(1),ctx.dims);}catch(err){tree={k:'error',e:err&&err.e||'#ERROR!'};}
    ctx.trees.set(k,tree);return tree;
  },
  _hasInputs(node,ctx){
    if(ctx.inputNodes.has(node))return ctx.inputNodes.get(node);
    const cell=k=>{
      if(this._reserved(ctx.state,this._COLS.indexOf(k[0]),+k.slice(1)-1))return true;
      if(ctx.inputCells.has(k))return ctx.inputCells.get(k);
      if(ctx.inputBusy.has(k))return true;
      const src=ctx.cells[k];if(typeof src!=='string'||src[0]!=='=')return false;
      ctx.inputBusy.add(k);const result=this._hasInputs(this._tree(k,ctx),ctx);ctx.inputBusy.delete(k);
      ctx.inputCells.set(k,result);return result;
    };
    let result=false;
    if(node.k==='ref')result=cell(this._key(node.c,node.r));
    else if(node.k==='range'){
      for(let r=node.r1;r<=node.r2&&!result;r++)for(let c=node.c1;c<=node.c2&&!result;c++)result=cell(this._key(c,r));
    }else result=node.k==='fn'&&['INPUT','DATA','COLUMN','ROWS'].includes(node.name)||['a','b'].some(k=>node[k]&&this._hasInputs(node[k],ctx))||
      !!(node.args&&node.args.some(n=>this._hasInputs(n,ctx)));
    ctx.inputNodes.set(node,result);return result;
  },
  _staticValue(node,ctx){
    if(!node||this._hasInputs(node,ctx))return {known:false};
    if(!ctx.constants)ctx.constants=this._evaluator(ctx.state,{},ctx);
    try{return {known:true,value:ctx.constants.value(node)};}catch(err){return {known:true,error:err&&err.e||'#ERROR!'};}
  },
  _joinTypes(types){const live=[...new Set(types.filter(t=>t!=='error'))];return live.length===0?'error':live.length===1?live[0]:'mixed';},
  _typeOf(node,ctx){
    if(ctx.nodeTypes.has(node))return ctx.nodeTypes.get(node);
    const infer=()=>{
      switch(node.k){
        case 'error':return 'error';
        case 'num':case 'neg':case '+':case '-':case '*':case '/':case '^':return 'number';
        case 'str':case '&':return 'string';
        case 'bool':case 'cmp':return 'boolean';
        case 'ref':return this._cellType(this._key(node.c,node.r),ctx);
        case 'fn':{
          const f=node.name,a=node.args;
          if(['AND','OR','NOT','ISBLANK','ISNUMBER','ISTEXT','ISERROR'].includes(f))return 'boolean';
          if(['CONCAT','UPPER','LOWER','LEFT','RIGHT','MID'].includes(f))return 'string';
          if(f==='IFERROR'){
            if(a.length!==2)return 'error';
            const first=this._staticValue(a[0],ctx);
            if(first.known)return first.error?this._typeOf(a[1],ctx):typeof first.value;
            return this._joinTypes(a.map(n=>this._typeOf(n,ctx)));
          }
          if(f==='VLOOKUP'){
            const t=a[1],ci=a[2];if(!t||t.k!=='range'||!ci)return 'error';
            const index=this._staticValue(ci,ctx);let c1=t.c1,c2=t.c2;
            if(index.known){
              if(index.error||typeof index.value!=='number'||!Number.isFinite(index.value))return 'error';
              c1=c2=t.c1+Math.floor(index.value)-1;
              if(c1<t.c1||c1>t.c2)return 'error';
            }
            const types=[];
            for(let r=t.r1;r<=t.r2;r++)for(let c=c1;c<=c2;c++)types.push(this._cellType(this._key(c,r),ctx));
            return this._joinTypes(types);
          }
          if(f==='INPUT')return a[1]?.k==='range'?'string':this._inputType(node)||'error';
          if(f==='DATA')return this._dataCall(node)?.type||'error';
          if(f==='COLUMN')return 'mixed';
          if(f==='OUTPUT')return a[0]?.k==='range'?'string':this._outputType(node,ctx)||'error';
          if(f==='IF'){
            if(a.length<2||a.length>3)return 'error';
            const condition=this._staticValue(a[0],ctx);
            if(condition.known){
              if(condition.error||!['number','boolean'].includes(typeof condition.value))return 'error';
              return condition.value?this._typeOf(a[1],ctx):a[2]?this._typeOf(a[2],ctx):'boolean';
            }
            return this._joinTypes([this._typeOf(a[1],ctx),a[2]?this._typeOf(a[2],ctx):'boolean']);
          }
          return 'number';
        }
      }
      return 'error';
    };
    const type=infer();ctx.nodeTypes.set(node,type);return type;
  },
  _cellType(k,ctx){
    if(ctx.types.has(k))return ctx.types.get(k);
    const src=ctx.cells[k];let type;
    const g=this._regionAt(ctx.state,this._COLS.indexOf(k[0]),+k.slice(1)-1);if(g)return +k.slice(1)-1===g.r1?'string':'mixed';
    if(typeof src!=='string'||src==='')type='number';
    else if(src[0]==="'")type='string';
    else if(src[0]!=='=')type=this._bool(src)!==null?'boolean':Number.isFinite(Number(src.trim()))&&src.trim()!==''?'number':'string';
    else{
      if(ctx.typeBusy.has(k))return 'error';
      ctx.typeBusy.add(k);type=this._typeOf(this._tree(k,ctx),ctx);ctx.typeBusy.delete(k);
    }
    ctx.types.set(k,type);return type;
  },
  _ports(state){
    const ctx=this._analysis(state),{cells,dims}=ctx,ins=[],outs=[],problems=[];
    const add=(port,type,cell)=>{
      const prior=ins.find(x=>x.port===port);
      if(prior&&prior.type!==type)throw new Error('Input '+port+' has conflicting '+prior.type+' and '+type+' types');
      if(!prior)ins.push({port,type,cell});
    };
    const regions=this._regions(state);
    for(const g of regions){
      const at='Table INPUT in '+(g.cell||'A1')+': ';
      if(!g.cell){add('data','table','grid');add('startRow','number','grid');}else add(g.port,'table',g.cell);
      if(g.mode<0)problems.push(at+'the fourth argument must be 0 (read only), 1 (edit) or 2 (edit, also in HTML)');
      if(g.c2>=dims.cols||g.r2>=dims.rows||g.r2<=g.r1)problems.push(at+'the range needs a header row and record rows inside the grid');
      if(g.cell&&this._regionAt(state,this._COLS.indexOf(g.cell[0]),+g.cell.slice(1)-1))problems.push(at+'the formula must lie outside table ranges');
      if(regions.some(o=>o!==g&&o.c1<=g.c2&&g.c1<=o.c2&&o.r1<=g.r2&&g.r1<=o.r2))problems.push(at+'table ranges overlap');
      for(let r=g.r1;r<=g.r2;r++)for(let c=g.c1;c<=g.c2;c++){const k=this._key(c,r);if(g.cell&&(state.cells||{})[k])problems.push(at+k+' lies in the table range; clear it');}
    }
    for(let r=0;r<dims.rows;r++)for(let c=0;c<dims.cols;c++){
      const cell=this._key(c,r),src=cells[cell];
      if(typeof src!=='string'||src[0]!=='=')continue;
      const tree=this._tree(cell,ctx);
      this._walk(tree,n=>{
        if(n.k!=='fn')return;
        if(n.name==='INPUT'){
          const type=this._inputType(n);if(type)add(this._port(n.args[0].v),type,cell);
        }
        const data=this._dataCall(n);if(data)add(data.port,'table',cell);
        if(n.name==='OUTPUT'&&n.args[0]?.k==='range'){
          const port=this._port(n.args[1]?.k==='str'&&n.args[1].v.trim()?n.args[1].v:'table');let table=null;
          try{table=this._rangeTable(n,ctx,cell);}catch(err){problems.push(err.message);}
          if(outs.some(o=>o.port===port))problems.push('Output '+port+' is declared twice');
          else outs.push({port,type:'table',cell,table});
        }else if(n.name==='OUTPUT'){
          const type=this._outputType(n,ctx);
          if(type){const port=this._port(n.args[1].v),prior=outs.find(o=>o.port===port);
            if(prior&&prior.type!==type)throw new Error('Output '+port+' has conflicting types');
            if(!prior)outs.push({port,cell,expression:n.args[0],type});
          }
        }
      });
    }
    if(ins.length>32||outs.length>32)throw new Error('Spreadsheet supports at most 32 inputs and 32 outputs');
    return {ins,outs,problems};
  },
  inputs(state){const m={};for(const x of this._ports(state).ins)m[x.port]={type:x.type,...(x.type==='table'?{}:{default:x.type==='boolean'?false:x.type==='string'?'':0})};return m;},
  outputs(state){const m={};for(const o of this._ports(state).outs){
    if(o.type==='mixed')throw new Error('Output '+o.port+' in '+o.cell+': result type is ambiguous; use OUTPUT(expression,\"port\",\"number\"|\"string\"|\"boolean\") or one consistent value type');
    m[o.port]={type:o.type==='error'?'number':o.type};
  }return m;},

  _evaluator(state,inputs,ctx=this._analysis(state),tables={}){
    const {cells,dims}=ctx,memo={},busy={};let steps=0;
    const wrap=v=>typeof v==='boolean'?{b:v}:typeof v==='string'?{t:v}:Number.isFinite(v)?{v}:{e:'#NUM!'};
    const cell=(c,r)=>{
      const k=this._key(c,r);
      if(memo[k])return memo[k];
      if(busy[k])return {e:'#CYCLE!'};
      const g=this._regionAt(state,c,r);
      if(g){
        const table=tables[g.port];
        if(!table)return {e:'#N/A'};
        let start=0;
        if(g.start){busy[k]=true;try{start=val(g.start);}catch(err){start=NaN;}busy[k]=false;}
        if(!Number.isInteger(start)||start<0)return {e:'#VALUE!'};
        const value=r===g.r1?table.columns[c-g.c1]?.name:table.rows[start+r-g.r1-1]?.[c-g.c1];
        return value==null?null:wrap(value);
      }
      const src=cells[k];
      if(typeof src!=='string'||src===''||this._tableCell(src))return null;
      let res;
      if(src[0]==="'")res={t:src.slice(1)};
      else if(src[0]!=='='){
        const b=this._bool(src),n=Number(src.trim());
        res=b!==null?{b}:src.trim()!==''&&Number.isFinite(n)?{v:n}:{t:src};
      }else{
        busy[k]=true;
        try{res=wrap(val(this._tree(k,ctx)));}catch(err){res={e:err&&err.e||'#ERROR!'};}
        busy[k]=false;
      }
      return memo[k]=res;
    };
    const valueOf=(c,r)=>{const x=cell(c,r);if(!x)return 0;if(x.e)throw {e:x.e};return x.t!==undefined?x.t:x.b!==undefined?x.b:x.v;};
    const toNum=v=>{if(typeof v==='boolean')return v?1:0;if(typeof v!=='number')throw {e:'#VALUE!'};return v;};
    const toBool=v=>{if(typeof v==='boolean')return v;if(typeof v==='number')return v!==0;throw {e:'#VALUE!'};};
    const toText=v=>typeof v==='string'?v:typeof v==='boolean'?(v?'TRUE':'FALSE'):String(Number(v.toPrecision(15)));
    const round=(x,n,mode)=>{const f=Math.pow(10,n),y=Number((Math.abs(x)*f).toPrecision(15));
      return Math.sign(x)*(mode==='up'?Math.ceil(y):mode==='down'?Math.floor(y):Math.round(y))/f;};
    const digits=a=>a===undefined?0:Math.trunc(toNum(val(a)));
    const textArg=(a,dflt)=>a===undefined?dflt:toText(val(a));
    const tryVal=a=>{try{return {v:val(a)};}catch(err){return {e:err&&err.e||'#ERROR!'};}};
    const isRange=a=>a.k==='range'||a.k==='fn'&&a.name==='COLUMN';
    const dataFor=n=>{const call=this._dataCall(n);if(!call)throw {e:'#VALUE!'};const table=tables[call.port];if(!table)throw {e:'#N/A'};return {call,table};};
    const columnFor=n=>{const {call,table}=dataFor(n);let index=table.columns.findIndex(c=>c.key===call.key);if(index<0)index=table.columns.findIndex(c=>c.name===call.key);if(index<0)throw {e:'#N/A'};return {call,table,index};};
    const cellsIn=a=>{
      if(a.k!=='range'){const {table,index}=columnFor(a);return table.rows.map(row=>row[index]==null?null:wrap(row[index]));}
      const out=[];for(let r=a.r1;r<=a.r2;r++)for(let c=a.c1;c<=a.c2;c++)out.push(cell(c,r));return out;
    };
    const rangeValues=(a,keep)=>{
      const out=[];for(const x of cellsIn(a)){if(!x)continue;if(x.e)throw {e:x.e};
        const v=x.t!==undefined?x.t:x.b!==undefined?x.b:x.v;if(keep(v))out.push(v);}
      return out;
    };
    const numbers=args=>args.flatMap(a=>isRange(a)?rangeValues(a,v=>typeof v==='number'):[toNum(val(a))]);
    const booleans=args=>args.flatMap(a=>isRange(a)?rangeValues(a,v=>typeof v!=='string').map(toBool):[toBool(val(a))]);
    const val=n=>{
      if(++steps>50000)throw {e:'#LIMIT!'};
      switch(n.k){
        case 'error':throw {e:n.e};
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
          if(f==='DATA'){
            const {call,table,index}=columnFor(n),row=val(a[1]);
            if(!Number.isInteger(row)||row<0)throw {e:'#VALUE!'};
            const value=table.rows[row]?.[index];if(value==null)throw {e:'#N/A'};
            if(typeof value!==call.type)throw {e:'#VALUE!'};
            return value;
          }
          if(f==='COLUMN')throw {e:'#VALUE!'};
          if(f==='ROWS'){const {table}=dataFor(n);return table.rowCount;}
          if(f==='SUM')return numbers(a).reduce((s,x)=>s+x,0);
          if(f==='AVERAGE'){const v=numbers(a);if(!v.length)throw {e:'#DIV/0!'};return v.reduce((s,x)=>s+x,0)/v.length;}
          if(f==='MIN'){const v=numbers(a);return v.length?Math.min(...v):0;}
          if(f==='MAX'){const v=numbers(a);return v.length?Math.max(...v):0;}
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
          if(f==='COUNT')return a.reduce((n,x)=>n+(isRange(x)?cellsIn(x).filter(y=>y&&y.v!==undefined).length:x.k==='ref'?(cell(x.c,x.r)?.v!==undefined?1:0):typeof tryVal(x).v==='number'?1:0),0);
          if(f==='COUNTA')return a.reduce((n,x)=>n+(isRange(x)?cellsIn(x).filter(y=>y!==null).length:x.k==='ref'?(cell(x.c,x.r)!==null?1:0):1),0);
          if(f==='IFERROR'){if(a.length!==2)throw {e:'#VALUE!'};const r=tryVal(a[0]);return r.e?val(a[1]):r.v;}
          if(f==='ISBLANK'){if(a.length!==1)throw {e:'#VALUE!'};return a[0].k==='ref'?cell(a[0].c,a[0].r)===null:false;}
          if(f==='ISNUMBER'){if(a.length!==1)throw {e:'#VALUE!'};return typeof tryVal(a[0]).v==='number';}
          if(f==='ISTEXT'){if(a.length!==1)throw {e:'#VALUE!'};return typeof tryVal(a[0]).v==='string';}
          if(f==='ISERROR'){if(a.length!==1)throw {e:'#VALUE!'};return !!tryVal(a[0]).e;}
          if(f==='CONCAT')return a.map(x=>isRange(x)?cellsIn(x).map(y=>{if(!y)return '';if(y.e)throw {e:y.e};return toText(y.t!==undefined?y.t:y.b!==undefined?y.b:y.v);}).join(''):toText(val(x))).join('');
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
          if(f==='INPUT'&&a[1]?.k==='range'){const t=a[0]?.k==='str'&&tables[this._port(a[0].v)];if(!t)throw {e:'#N/A'};return t.name||this._port(a[0].v);}
          if(f==='INPUT'){
            const type=this._inputType(n);if(!type)throw {e:'#VALUE!'};
            const v=inputs?inputs[this._port(a[0].v)]:undefined;
            if(typeof v!==type||type==='number'&&!Number.isFinite(v))throw {e:'#N/A'};
            return v;
          }
          if(f==='OUTPUT'&&a[0]?.k==='range')return a[1]?.k==='str'?a[1].v.trim():'#VALUE!';
          if(f==='OUTPUT'){const type=this._outputType(n,ctx);if(!type)throw {e:'#VALUE!'};const value=val(a[0]);if(this._typeArg(a[2])&&typeof value!==type)throw {e:'#VALUE!'};return value;}
          throw {e:'#NAME?'};
        }
      }
      throw {e:'#ERROR!'};
    };
    return {value:val,cell,dims};
  },
  _sheet(state,inputs,tables={}){
    const run=this._evaluator(state,inputs,undefined,tables),all={};
    for(let r=0;r<run.dims.rows;r++)for(let c=0;c<run.dims.cols;c++){const k=this._key(c,r),x=run.cell(c,r);if(x)all[k]=x;}
    return all;
  },

  initState(){
    return {cols:6,rows:6,cells:{}};
  },
  initStyle(){return {w:552,h:168,fontSize:16,fill:true,fillColor:'#ffffff',strokeOn:true,color:'#94a3b8',textColor:'#1f2937',size:1};},
  compute(inputs,state,context={}){
    const run=this._evaluator(state,inputs,undefined,context.tables||{}),out={},ports=this._ports(state);
    if(ports.problems.length)throw new Error(ports.problems[0]);
    for(const o of ports.outs){
      if(o.table){out[o.port]=this._resultTable(run,o.table,state,context.tables||{});continue;}
      if(o.type==='mixed')throw new Error('Output '+o.port+' in '+o.cell+': result type is ambiguous; use OUTPUT(expression,\"port\",\"number\"|\"string\"|\"boolean\") or one consistent value type');
      let value;
      try{value=run.value(o.expression);}catch(err){throw new Error('Output '+o.port+' in '+o.cell+': '+(err&&err.e||'#ERROR!'));}
      if(typeof value!==o.type)throw new Error('Output '+o.port+' in '+o.cell+': expected '+o.type+', got '+typeof value);
      if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Output '+o.port+' in '+o.cell+': #NUM!');
      out[o.port]=value;
    }
    return out;
  },

  _layout(w,h,dims){
    const sum=dims.weights.reduce((a,b)=>a+b,0),unit=w/sum,xs=[],ws=[];
    let x=0;for(const wt of dims.weights){xs.push(x);ws.push(wt*unit);x+=wt*unit;}
    const colAt=px=>{for(let c=0;c<xs.length;c++)if(px<xs[c]+ws[c])return px<0?-1:c;return xs.length;};
    const rh=h/dims.rows,headH=Math.max(14,Math.min(24,rh*.8)),headW=Math.max(20,Math.min(40,unit*.45));
    return {unit,xs,ws,colAt,rh,headH,headW,hgap:8,px:Math.max(6,Math.min(18,Math.round(rh*.5)))};
  },
  _target(x,y,w,h,dims){
    const L=this._layout(w,h,dims),c=L.colAt(x),r=Math.floor(y/L.rh);
    const inCols=x>=0&&x<w,inRows=y>=0&&y<h;
    if(inCols&&y<0&&y>=-L.hgap-L.headH)return {col:c};   // the gap counts as the header
    if(inRows&&x<0&&x>=-L.hgap-L.headW)return {row:r};
    if(inCols&&inRows)return {col:c,row:r};
    return null;
  },
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
    ['Datasets',{INTABLE:['"data"','A1:C6','INPUT("startRow")','1'],DATA:['"data"','0','"column"'],COLUMN:['"data"','"column"'],ROWS:['"data"']}],
  ],
  _cellFormat(state,k){const f=(state.formats||{})[k];return this._FORMATS.some(([c])=>c&&c===f)?f:'';},
  _cellAlign(state,k){const a=(state.aligns||{})[k];return ['left','center','right'].includes(a)?a:'';},
  _fnArgs(name){for(const [,fns] of this._FN_GROUPS)if(fns[name])return fns[name];return null;},
  _fnInsert(src,name){
    const args=this._fnArgs(name).slice(),raw=(src||'')[0]==="'"?src:(src||'').trim();
    let first=null;
    if(raw[0]==='=')first=raw.slice(1).trim()||null;
    else if(raw[0]==="'")first='"'+raw.slice(1).replace(/"/g,'""')+'"';
    else if(raw)first=this._bool(raw)!==null||Number.isFinite(Number(raw))?raw:'"'+raw.replace(/"/g,'""')+'"';
    const filled=first!==null&&args.length?1:0;
    if(filled)args[0]=first;
    const head='='+(name==='INTABLE'?'INPUT':name)+'(',text=head+args.join(',')+')';
    if(filled<args.length){
      let at=head.length;for(let i=0;i<filled;i++)at+=args[i].length+1;
      const ph=args[filled],q=ph[0]==='"';
      return {text,select:[at+(q?1:0),at+ph.length-(q?1:0)]};
    }
    return {text,select:[text.length-1,text.length-1]};
  },
  contextMenu(state,x,y,w,h){
    const dims=this._dims(state),t=this._target(x,y,w,h,dims);
    if(!t)return [];
    const items=[],addCol=this._fits(dims.cols+1,dims.rows),addRow=this._fits(dims.cols,dims.rows+1);
    if(t.col!==undefined){
      items.push({id:'cins'+t.col,label:'Insert 1 column left',disabled:!addCol},
        {id:'cins'+(t.col+1),label:'Insert 1 column right',disabled:!addCol},
        {id:'cdel'+t.col,label:'Delete column',disabled:dims.cols<=1});
    }
    if(t.col!==undefined&&t.row===undefined)
      items.push({separator:true},{id:'colw'+t.col,label:'Column width\u2026',edit:{handle:'cw'+t.col}},
        {id:'cwreset'+t.col,label:'Reset column width',disabled:dims.weights[t.col]===1});
    if(t.col!==undefined&&t.row!==undefined)items.push({separator:true});
    if(t.row!==undefined){
      items.push({id:'rins'+t.row,label:'Insert 1 row above',disabled:!addRow},
        {id:'rins'+(t.row+1),label:'Insert 1 row below',disabled:!addRow},
        {id:'rdel'+t.row,label:'Delete row',disabled:dims.rows<=1});
    }
    if(t.col!==undefined&&t.row!==undefined){
      const cell=this._key(t.col,t.row),src=(state.cells||{})[cell]||'';
      items.push({separator:true},{label:'Insert function',disabled:this._reserved(state,t.col,t.row),items:this._FN_GROUPS.map(([group,fns])=>({label:group,
        items:Object.entries(fns).map(([name,args])=>{const ins=this._fnInsert(src,name);
          return {id:'fn:'+name+':'+cell,label:(name==='INTABLE'?'INPUT':name)+'('+args.join(', ')+')',edit:{handle:cell,select:ins.select}};})}))});
      const fc=this._cellFormat(state,cell),al=this._cellAlign(state,cell),tick=on=>on?'  \u2713':'';
      items.push({separator:true},{label:'Number format',items:this._FORMATS.map(([code,name],i)=>({id:'nf'+i+':'+cell,
        label:name+(code?'  '+this._fmtCode(code.endsWith('%')?.1235:1234.5678,code):'')+tick(code===fc)}))},
        {label:'Alignment',items:this._ALIGNS.map(([a,name])=>({id:'al:'+(a||'default')+':'+cell,label:name+tick(a===al)}))});
    }
    return items;
  },
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
  _fmt(v){return this._number(v);},
  _draw(state,style,w,h,editing,inputs,errorNote,tables={}){
    const dims=this._dims(state),L=this._layout(w,h,dims),items=[],sheet=this._sheet(state,inputs,tables),regions=this._regions(state);
    let ports={ins:[],outs:[],problems:[]};try{ports=this._ports(state);}catch(err){errorNote=errorNote||err.message;}
    errorNote=errorNote||ports.problems[0]||'';
    const ink=style.color||'#64748b',textInk=style.textColor||'#1f2937',grid='#cbd5e1';
    const family=['sans','serif','mono','cursive'].includes(style.fontFamily)?style.fontFamily:'sans';
    const cap=size=>Math.max(6,Math.round(Math.min(style.fontSize||L.px,size)));
    const label=(text,x,y,tw,th,align,color,bold,size)=>({type:'text',x,y,w:tw,h:th,text:String(text),align:align||'center',
      fontFamily:family,fontSize:size?cap(size):this._cellPx(style,L),textColor:color||textInk,color:color||textInk,strokeOn:false,fill:false});
    items.push({type:'rect',x:0,y:0,w,h,color:ink,size:1,strokeOn:false,fill:style.fill!==false,fillColor:style.fillColor||'#ffffff'});
    for(const g of regions)if(g.c2<dims.cols&&g.r1<dims.rows)items.push({type:'rect',x:L.xs[g.c1],y:g.r1*L.rh,w:L.xs[g.c2]+L.ws[g.c2]-L.xs[g.c1],h:L.rh,fill:true,fillColor:'#e2e8f0',strokeOn:false});
    for(let r=0;r<dims.rows;r++)for(let c=0;c<dims.cols;c++){
      const k=this._key(c,r),x=sheet[k],mark=editing&&!x&&this._tableCell((state.cells||{})[k]);
      if(mark)items.push({...label(mark,L.xs[c],r*L.rh,L.ws[c],L.rh,'left','#94a3b8'),editorOnly:true});
      if(!x)continue;
      const fc=this._cellFormat(state,k);
      const text=x.e||(x.t!==undefined?x.t:x.b!==undefined?(x.b?'TRUE':'FALSE'):this._fmtCode(x.v,fc));
      const align=this._cellAlign(state,k)||(x.v!==undefined?'right':x.b!==undefined?'center':'left');
      items.push(label(text,L.xs[c],r*L.rh,L.ws[c],L.rh,align,x.e?'#b91c1c':textInk));
    }
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
      const tag=x=>x.port+' ('+x.cell+(x.type==='number'?'':', '+(x.type==='boolean'?'bool':x.type))+')';
      const groups=errorNote?[{words:errorNote.split(/\s+/),comma:false}]:[ports.ins.length?['In:',...ports.ins.map(tag)]:null,ports.outs.length?['Out:',...ports.outs.map(tag)]:null].filter(Boolean).map(words=>({words,comma:true}));
      for(const g of regions.slice().reverse()){const t=tables[g.port];if(t)groups.unshift({words:('Table '+(t.name||g.port)+' ('+(g.cell||'A1')+'): '+(g.edit&&t.editable===true?'edit shared records':g.edit&&!t.owner?'read-only · no Dataset owner':'read-only')).split(/\s+/),comma:false});}
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
  children(state,style,w,h,editing,io={}){return this._draw(state,style,w,h,editing,io.inputs||{},'',io.tables?.inputs||{});},
  unavailableChildren(state,style,w,h,editing,io={}){
    const msg=typeof io.error==='string'&&io.error?io.error:'Unavailable';
    return this._draw(state,style,w,h,editing,null,msg.length>120?msg.slice(0,117)+'…':msg,io.tables?.inputs||{});
  },
  handles(state,w,h,style={},io={}){
    const dims=this._dims(state),L=this._layout(w,h,dims),hs=[],sheet=this._sheet(state,io.inputs||{},io.tables?.inputs||{});
    const fontSize=this._cellPx(style,L),run=this._evaluator(state,io.inputs||{},undefined,io.tables?.inputs||{});
    for(let r=0;r<dims.rows;r++)for(let c=0;c<dims.cols;c++){
      const k=this._key(c,r),g=this._regionAt(state,c,r),reserved=!!g,x=sheet[k],table=g&&io.tables?.inputs?.[g.port];
      let start=0;if(g?.start)try{start=run.value(g.start);}catch{start=NaN;}
      const index=g?start+r-g.r1-1:-1,column=table?.columns?.[c-(g?g.c1:0)],rowId=table?.rowIds?.[index];
      const bound=reserved&&r>g.r1&&g.edit&&table?.editable===true&&typeof table.datasetId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(table.datasetId)&&!['__proto__','prototype','constructor'].includes(table.datasetId)&&
        Number.isInteger(start)&&start>=0&&Array.isArray(table.rows?.[index])&&typeof rowId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(rowId)&&
        typeof column?.key==='string'&&['number','string','boolean'].includes(column.type)&&Number.isSafeInteger(table.revision)&&table.revision>=0;
      const value=reserved?(x?x.e||(x.t!==undefined?x.t:x.b!==undefined?(x.b?'TRUE':'FALSE'):String(x.v)):''):(state.cells||{})[k]||'';
      hs.push({id:k,x:L.xs[c]+L.ws[c]/2,y:(r+.5)*L.rh,kind:'text',value,
        label:bound?('Dataset '+(table.name||'data')+' · row '+index+' · '+(column.name||column.key)).slice(0,100):'Cell '+k,
        ...(reserved?{readOnly:!bound}:{}),...(bound?{datasetCell:{input:g.port,datasetId:table.datasetId,rowId,column:column.key,revision:table.revision}}:{}),
        inline:{x:L.xs[c],y:r*L.rh,w:L.ws[c],h:L.rh,fontSize,mode:'edit',navigation:'horizontal',references:!bound,
          ...(this._cellAlign(state,k)?{align:this._cellAlign(state,k)}:{})},ref:k,editorOnly:!bound||!g.reader});
    }
    for(let c=0;c<dims.cols;c++)hs.push({id:'cw'+c,x:L.xs[c]+L.ws[c]/2,y:-L.hgap-L.headH/2,kind:'number',
      value:Math.round(L.ws[c]),min:8,max:2000,step:1,editorOnly:true});
    hs.push({id:'headers',x:-L.hgap-L.headW/2,y:-L.hgap-L.headH/2,kind:'click',editorOnly:true});
    return hs;
  },
  hitEdit(state,x,y,w,h){
    const dims=this._dims(state),L=this._layout(w,h,dims),c=L.colAt(x),r=Math.floor(y/L.rh);
    if(c>=0&&c<dims.cols&&r>=0&&r<dims.rows)return this._key(c,r);
    const t=this._target(x,y,w,h,dims);
    return t?'headers':null;
  },
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
      if(this._reserved(state,c,r)||!this._fnArgs(name)||c<0||c>=dims.cols||r<0||r>=dims.rows)return {state};
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
    if(!cell||this._reserved(state,this._COLS.indexOf(cell[1]),+cell[2]-1)||this._COLS.indexOf(cell[1])>=dims.cols||+cell[2]<1||+cell[2]>dims.rows||typeof value!=='string')return {state};
    const cells={...(state.cells||{})},text=value[0]==="'"?value:value.trim();
    if(text)cells[handle]=text;else delete cells[handle];
    const next={...state,cells};
    return {state:JSON.stringify(next).length>3900?state:next};   // keep within the 4,000-character state limit
  }
})
