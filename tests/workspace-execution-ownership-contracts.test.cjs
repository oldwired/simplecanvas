const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function declaration(name){
  const start=html.indexOf('  function '+name+'(');
  const end=html.slice(start+3).search(/\n  (?:async )?function /);
  assert.ok(start>=0 && end>=0,name);
  return html.slice(start,start+3+end);
}
function fixture(){
  const item={uid:'service',script:'source'},scope=vm.createContext({
    runtime:[item],items:[item],activeTabId:'services',smartExecutionSeq:0,
    smartItemExecutions:new WeakMap(),smartCacheOwners:new Map(),smartChildrenCache:new Map(),
    smartDrawingErrors:new Map(),smartHandlesCache:new Map(),smartInFlight:new Set(),smartHandlesInFlight:new Set(),
    smartBackoffUntil:new Map(),smartStyleCache:new WeakMap(),smartSignatureCache:new WeakMap(),smartPaintCache:new WeakMap(),
    clearSmartRetry(){},scheduleSmartRefresh(){},disposeSmartExecution(owner){if(owner)owner.active=false;},
  });
  scope.smartRuntimeScene=()=>scope.runtime;
  vm.runInContext(['createSmartExecution','smartExecutionCurrent','smartItemExecution','dropSmartCache'].map(declaration).join('\n'),scope);
  return {scope,item};
}
test('execution survives navigation and local paint-cache retirement while its runtime stays active',()=>{
  const {scope,item}=fixture(),owner=scope.smartItemExecution(item);
  scope.smartCacheOwners.set(item.uid,{item,script:item.script});
  scope.activeTabId='dashboard';scope.items=[];
  assert.equal(scope.smartExecutionCurrent(owner),true);
  scope.dropSmartCache(item.uid);
  assert.equal(scope.smartExecutionCurrent(owner),true);
  assert.equal(scope.smartItemExecution(item),owner);
  assert.equal(scope.smartCacheOwners.has(item.uid),false);
});
test('source deletion, replacement and script edits invalidate service execution',()=>{
  const {scope,item}=fixture(),owner=scope.smartItemExecution(item);
  scope.runtime.splice(0,1);
  assert.equal(scope.smartExecutionCurrent(owner),false);
  const replacement={...item};scope.runtime.push(replacement);
  assert.equal(scope.smartExecutionCurrent(owner),false);
  const current=scope.smartItemExecution(replacement);
  replacement.script='edited';
  assert.equal(scope.smartExecutionCurrent(current),false);
  assert.notEqual(scope.smartItemExecution(replacement),current);
});
test('a new runtime scene cancels old work even when it contains the same item object',()=>{
  const {scope,item}=fixture(),owner=scope.smartItemExecution(item);
  scope.runtime=[item];
  assert.equal(scope.smartExecutionCurrent(owner),false);
  const next=scope.smartItemExecution(item);
  assert.notEqual(next,owner);assert.equal(owner.active,false);
  assert.equal(scope.smartExecutionCurrent(next),true);
});
test('paint-cache retirement still disposes removed instances and changed scripts',()=>{
  for(const change of ['remove','edit']){
    const {scope,item}=fixture(),owner=scope.smartItemExecution(item);
    scope.smartCacheOwners.set(item.uid,{item,script:item.script});
    if(change==='remove')scope.runtime=[];else item.script='edited';
    scope.dropSmartCache(item.uid);
    assert.equal(owner.active,false);
  }
});
