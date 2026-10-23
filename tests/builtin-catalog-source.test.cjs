const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {updateBuiltinCatalog}=require('../tools/update-builtin-catalog.cjs');
const {parseApp}=require('./helpers/app-source.cjs');
test('catalog source metadata keeps every bundled script synchronized',()=>{
  assert.ok(updateBuiltinCatalog({check:true})>0);
});
test('catalog refresh preserves literal replacement tokens in authored scripts',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sc-catalog-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'examples'));
  const html='<script>(()=>{const BUILTIN_LIBRARY_DEFINITIONS = [{key:"test",source:"test.js",items:[{type:"smart",script:"old"}]}];})();</script>';
  const source='({children(){return [];},literal:"$& $` $\' </script>"})\n';
  fs.writeFileSync(path.join(root,'index.html'),html);fs.writeFileSync(path.join(root,'examples','test.js'),source);
  assert.throws(()=>updateBuiltinCatalog({root,check:true}),/stale/);
  updateBuiltinCatalog({root});assert.equal(updateBuiltinCatalog({root,check:true}),1);
  const declaration=parseApp(fs.readFileSync(path.join(root,'index.html'),'utf8')).declaration('BUILTIN_LIBRARY_DEFINITIONS');
  const definitions=JSON.parse(declaration.slice(declaration.indexOf('=')+1,-1));
  assert.equal(definitions[0].items[0].script,source);
});

test('catalog refresh repairs matching demo snapshots and preview keys without replacing customized entries',t=>{
  const repository=path.join(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'sc-catalog-demo-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'examples'));
  const html=fs.readFileSync(path.join(repository,'index.html'),'utf8'),app=parseApp(html);
  fs.writeFileSync(path.join(root,'index.html'),html);
  const declaration=app.declaration('BUILTIN_LIBRARY_DEFINITIONS');
  const definitions=JSON.parse(declaration.slice(declaration.indexOf('=')+1,-1));
  for(const source of new Set(definitions.map(definition=>definition.source).filter(Boolean)))
    fs.copyFileSync(path.join(repository,'examples',source),path.join(root,'examples',source));
  const canonical=JSON.parse(fs.readFileSync(path.join(repository,'examples','demo-shapes-library.json'),'utf8')).shapes.find(entry=>entry.id==='builtin:clock:1');
  const stale=structuredClone(canonical);stale.items[0].script=stale.items[0].script.trim();stale.thumbnail.source='old-key';
  const custom=structuredClone(canonical);custom.items[0].script+='\n// Author customization';custom.thumbnail.source='custom-key';
  const file=path.join(root,'examples','demo-shapes-library.json');
  fs.writeFileSync(file,JSON.stringify({shapes:[stale,custom]},null,2)+'\n');
  assert.throws(()=>updateBuiltinCatalog({root,check:true}),/demo library is stale/);
  updateBuiltinCatalog({root});assert.equal(updateBuiltinCatalog({root,check:true}),98);
  const updated=JSON.parse(fs.readFileSync(file,'utf8')).shapes;
  assert.deepEqual(updated[0],canonical);assert.deepEqual(updated[1],custom);
});
