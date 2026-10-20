// Refresh bundled source snapshots from the catalog's canonical examples/*.js files.
// This development tool does not add a runtime fetch or build requirement.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseApp}=require('../tests/helpers/app-source.cjs');
function refreshBuiltinDemo({root,app,previous,definitions,check}){
  const file=path.join(root,'examples','demo-shapes-library.json');
  if(!fs.existsSync(file))return;
  // Use the app's actual normalization and preview-key implementation. No component
  // scripts run here: they remain inert strings inside trusted repository fixtures.
  const helpers=['ITEM_TYPES','MAX_POINTS','MAX_SCRIPT','MAX_STATE_JSON','MAX_TEXT','DATA_LIMITS','FONTS','HEAD_STYLES',
    'isNum','isColor','norm','FILLABLE','DASHABLE','FONTABLE','isOpenPath','fontStr','familyOf','defaultUi','ui',
    'smartNumber','normalizeSmartState','componentPortName','normalizeComponentFields','normalizeItem',
    'eachDatasetReference','datasetsUsedBy','computeShapePreviewKey'];
  const normalize=vm.runInNewContext(app.declarationsSource(helpers)+';({normalizeItem,computeShapePreviewKey})');
  const thumbnails=vm.runInNewContext(app.declaration('BUILTIN_LIBRARY_THUMBNAILS')+';BUILTIN_LIBRARY_THUMBNAILS');
  const original=fs.readFileSync(file,'utf8'),library=JSON.parse(original);
  for(const entry of library.shapes){
    const index=previous.findIndex(definition=>'builtin:'+definition.key+':1'===entry.id);
    if(index<0)continue;
    const before=previous[index],after=definitions[index];
    if(['name','category','description','tags'].some(key=>JSON.stringify(entry[key])!==JSON.stringify(before[key])) ||
      !Array.isArray(entry.items) || entry.items.length!==before.items.length)continue;
    const normalized=entry.items.map((item,index)=>{
      const expected=before.items[index];
      // Whitespace-only source drift is safe to repair; an edited script, state,
      // style or geometry remains a custom snapshot, even with a built-in ID.
      const sameSource=item.type==='smart' && typeof item.script==='string' && item.script.trim()===expected.script?.trim();
      return normalize.normalizeItem(sameSource?{...item,script:expected.script}:item,{});
    });
    if(JSON.stringify(normalized)!==JSON.stringify(before.items.map(item=>normalize.normalizeItem(item,{}))))continue;
    entry.items=entry.items.map((item,index)=>item.type==='smart'?{...item,script:after.items[index].script}:item);
    const png=thumbnails[after.key];
    if(png)entry.thumbnail={version:1,source:normalize.computeShapePreviewKey(entry.items),png};
  }
  const updated=JSON.stringify(library,null,2)+'\n';
  if(check && updated!==original)throw new Error('Bundled demo library is stale; run node tools/update-builtin-catalog.cjs');
  return {file,updated};
}
function updateBuiltinCatalog({root=path.join(__dirname,'..'),check=false}={}){
  const file=path.join(root,'index.html'),html=fs.readFileSync(file,'utf8'),app=parseApp(html);
  const declaration=app.declaration('BUILTIN_LIBRARY_DEFINITIONS');
  const definitions=vm.runInNewContext(declaration+';BUILTIN_LIBRARY_DEFINITIONS');
  const previous=JSON.parse(JSON.stringify(definitions));
  for(const definition of definitions){
    const scripts=definition.items.filter(item=>item.type==='smart');
    if(!scripts.length)continue;
    if(scripts.length!==1 || !/^[a-z0-9-]+\.js$/.test(definition.source||''))throw new Error('Invalid source for '+definition.key);
    scripts[0].script=fs.readFileSync(path.join(root,'examples',definition.source),'utf8');
  }
  const replacement='const BUILTIN_LIBRARY_DEFINITIONS = '+JSON.stringify(definitions,null,2).replace(/<\/script/gi,'<\\/script')+';';
  if(check && replacement!==declaration)throw new Error('Bundled sources are stale; run node tools/update-builtin-catalog.cjs');
  const demo=refreshBuiltinDemo({root,app,previous,definitions,check});
  // A replacement callback preserves literal $&, $` and $' in component scripts.
  if(!check){
    if(replacement!==declaration)fs.writeFileSync(file,html.replace(declaration,()=>replacement));
    if(demo)fs.writeFileSync(demo.file,demo.updated);
  }
  return definitions.length;
}
module.exports={updateBuiltinCatalog};
if(require.main===module){
  try{console.log('Checked '+updateBuiltinCatalog({check:process.argv.includes('--check')})+' catalog entries.');}
  catch(error){console.error(error.message);process.exitCode=1;}
}
