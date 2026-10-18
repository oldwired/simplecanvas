const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const marker='  const BUILTIN_LIBRARY_DEFINITIONS = ',start=html.indexOf(marker)+marker.length;
const definitions=JSON.parse(html.slice(start,html.indexOf(';\n  const BUILTIN_LIBRARY_THUMBNAILS',start)));

test('every indexed built-in port family starts at zero with no gaps, including minimum and maximum channel counts',()=>{
  const audited=new Set();
  for(const entry of definitions){
    if(entry.items[0]?.componentApi!==2)continue;
    const definition=vm.runInNewContext(entry.items[0].script),initial=definition.initState(),states=[initial];
    for(const field of ['channels','stages'])if(definition.settings?.[field]){
      const {min,max}=definition.settings[field];states.push({...initial,[field]:min},{...initial,[field]:max});
    }
    if(entry.key==='ledMatrix')states.push({...initial,mode:'rows'});
    for(const state of states)for(const side of ['inputs','outputs']){
      const ports=typeof definition[side]==='function'?definition[side](state):definition[side],families=new Map();
      for(const name of Object.keys(ports||{})){
        const match=/^(in|out|q|row|col|r)(\d+)$/.exec(name);if(!match)continue;
        if(!families.has(match[1]))families.set(match[1],[]);families.get(match[1]).push(Number(match[2]));
      }
      for(const [prefix,indices] of families){
        audited.add(entry.key);indices.sort((a,b)=>a-b);
        assert.deepEqual(indices,Array.from({length:indices.length},(_,index)=>index),entry.key+' '+side+' '+prefix);
      }
    }
  }
  assert.equal(audited.size,10,'routing, registers, sequence counters, and the matrix were audited');
});

test('choice index zero is valid and missing results are unambiguously minus one',()=>{
  const dropdown=vm.runInNewContext(definitions.find(entry=>entry.key==='dropdown').items[0].script);
  const lookup=vm.runInNewContext(definitions.find(entry=>entry.key==='textLookup').items[0].script);
  const state=dropdown.initState();assert.equal(dropdown.inputs(state).select.default,0);
  const selected=dropdown.compute({select:0},state);assert.equal(selected.valid,true);assert.equal(selected.index,0);
  const found=lookup.compute({text:selected.text},lookup.initState());assert.equal(found.found,true);assert.equal(found.index,0);
  for(const select of [-1,3,.5]){const result=dropdown.compute({select},state);assert.equal(result.valid,false);assert.equal(result.index,-1);}
  const missing=lookup.compute({text:'Not in the list'},lookup.initState());assert.equal(missing.found,false);assert.equal(missing.index,-1);
});
