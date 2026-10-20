const acorn=require('acorn');
const eslintScope=require('eslint-scope');

const parse=source=>acorn.parse(source,{ecmaVersion:'latest',sourceType:'script',ranges:true,locations:true});

// HTML script boundaries are the browser's raw-text boundaries. Inside each script,
// declarations and injection positions come from the parser, never neighboring text.
function inlineScripts(html){
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(match=>! /\bsrc\s*=|\btype\s*=\s*["']?(?:application\/json|importmap)/i.test(match[1]))
    .map(match=>({source:match[2],offset:match.index+match[0].indexOf('>')+1}));
}
function parseApp(html){
  const scripts=inlineScripts(html).sort((a,b)=>b.source.length-a.source.length);
  const script=scripts[0];if(!script)throw new Error('No inline app script');
  const ast=parse(script.source);
  const call=ast.body.find(node=>node.type==='ExpressionStatement'&&node.expression.type==='CallExpression'&&
    ['FunctionExpression','ArrowFunctionExpression'].includes(node.expression.callee.type));
  const body=call?.expression.callee.body;
  if(body?.type!=='BlockStatement')throw new Error('Expected the app closure');
  const declarations=new Map(),functions=new Map();
  for(const node of body.body){
    if(node.type==='FunctionDeclaration'){declarations.set(node.id.name,script.source.slice(node.start,node.end));functions.set(node.id.name,node);}
    if(node.type==='VariableDeclaration')for(const entry of node.declarations){
      if(entry.id.type==='Identifier')declarations.set(entry.id.name,node.kind+' '+script.source.slice(entry.start,entry.end)+';');
      if(entry.id.type==='Identifier'&&['FunctionExpression','ArrowFunctionExpression'].includes(entry.init?.type))functions.set(entry.id.name,entry.init);
    }
  }
  const declaration=name=>{
    if(!declarations.has(name))throw new Error('App declaration not found: '+name);
    return declarations.get(name);
  };
  return {ast,source:script.source,declarations,declaration,
    declarationsSource:names=>names.map(declaration).join('\n'),
    inject:source=>{
      const position=script.offset+body.end-1;
      return html.slice(0,position)+'\n'+source+'\n'+html.slice(position);
    },
    instrumentFunction:(name,prefix)=>{
      const body=functions.get(name)?.body;
      if(body?.type!=='BlockStatement')throw new Error('App function not found: '+name);
      const position=script.offset+body.start+1;
      return html.slice(0,position)+'\n'+prefix+'\n'+html.slice(position);
    }};
}
function freeReferences(source){
  const ast=parse(source),scope=eslintScope.analyze(ast,{ecmaVersion:2022,sourceType:'script',optimistic:true,ignoreEval:true});
  return scope.globalScope.through.map(reference=>({name:reference.identifier.name,...reference.identifier.loc.start}));
}
module.exports={parse,inlineScripts,parseApp,freeReferences};
