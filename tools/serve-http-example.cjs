// Development-only server for the HTTP example. CORS is limited to its fixture/API endpoints.
// POST records and idempotency keys exist in memory only and are discarded on server restart.
// Run from any directory: node tools/serve-http-example.cjs [port]
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.join(__dirname,'..');
const fixtures=new Set(['/examples/http-reading.json','/examples/http-reading-alternate.json']);
const readPath='/examples/api/reading',writePath='/examples/api/echo';
const types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.md':'text/plain; charset=utf-8'};

function createHttpExampleServer({directory=root}={}){
  const base=path.resolve(directory),realBase=fs.realpath(base);
  let readSequence=0,writeSequence=0,lastWrite=null;
  const acceptedKeys=new Map();
  async function readJson(request){
    const chunks=[];let size=0;
    for await(const chunk of request){size+=chunk.length;if(size<=8192)chunks.push(chunk);}
    if(size>8192)throw new Error('JSON body exceeds 8192 bytes');
    const text=Buffer.concat(chunks).toString('utf8');
    if(text.length>2000)throw new Error('JSON body exceeds 2000 characters');
    const body=JSON.parse(text);
    if(!body || typeof body!=='object' || Array.isArray(body))throw new Error('Send a JSON object');
    const pending=[body];
    while(pending.length){const value=pending.pop();
      if(typeof value==='number' && !Number.isFinite(value))throw new Error('JSON numbers must be finite');
      if(value && typeof value==='object')pending.push(...Object.values(value));
    }
    return body;
  }
  return http.createServer(async(request,response)=>{
    try{
      const url=new URL(request.url,'http://localhost'),pathname=decodeURIComponent(url.pathname);
      const fixture=fixtures.has(pathname),api=pathname===readPath || pathname===writePath,example=fixture||api;
      response.setHeader('Cache-Control','no-store');
      if(example)response.setHeader('Access-Control-Allow-Origin','*');
      if(request.method==='OPTIONS' && example){
        response.writeHead(204,{'Access-Control-Allow-Methods':pathname===writePath?'GET, HEAD, POST, OPTIONS':'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers':'Content-Type, Idempotency-Key'});response.end();return;
      }
      if(!['GET','HEAD'].includes(request.method) && !(pathname===writePath && request.method==='POST')){
        response.writeHead(405);response.end('Method not allowed');return;
      }
      const delay=example && url.searchParams.has('delay')?Number(url.searchParams.get('delay')):0;
      const requestedStatus=example && url.searchParams.has('status')?Number(url.searchParams.get('status')):200;
      if(!Number.isFinite(delay) || delay<0 || delay>10000){response.writeHead(400);response.end('Delay must be 0–10000 milliseconds');return;}
      if(![200,204,205].includes(requestedStatus) && !(Number.isInteger(requestedStatus) && requestedStatus>=400 && requestedStatus<=599)){
        response.writeHead(400);response.end('Status must be 200, 204, 205 or 400–599');return;
      }
      const send=(body,status=200,type='application/json; charset=utf-8')=>{
        const content=typeof body==='string'?Buffer.from(body):body;
        const finish=()=>{
          if(response.destroyed)return;
          const empty=status===204||status===205;
          response.writeHead(status,{'Content-Type':type,...(empty?{}:{'Content-Length':content.length})});
          response.end(empty||request.method==='HEAD'?undefined:content);
        };
        if(delay){const timer=setTimeout(finish,delay);response.on('close',()=>clearTimeout(timer));}else finish();
      };
      if(example && requestedStatus>=400){send(JSON.stringify({error:'Example HTTP '+requestedStatus}),requestedStatus);return;}
      if(pathname===readPath){
        if(request.method==='GET')readSequence++;
        send(JSON.stringify({value:(35+Math.max(0,readSequence-1)*7)%101,name:url.searchParams.get('name')||'Workshop',sequence:readSequence}),requestedStatus);return;
      }
      if(pathname===writePath){
        if(request.method!=='POST'){send(JSON.stringify({count:writeSequence,last:lastWrite}));return;}
        if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']||'')){send(JSON.stringify({error:'Use Content-Type: application/json'}),415);return;}
        const body=await readJson(request),canonical=JSON.stringify(body),key=request.headers['idempotency-key']||'';
        if(typeof key!=='string' || key.length>200 || /[^\x20-\x7e]/.test(key)){send(JSON.stringify({error:'Invalid Idempotency-Key'}),400);return;}
        if(key && acceptedKeys.has(key)){
          const previous=acceptedKeys.get(key);
          if(previous.body!==canonical){send(JSON.stringify({error:'Idempotency key already used with a different body'}),409);return;}
          send(previous.response,previous.status);return;
        }
        lastWrite={...body,recordId:++writeSequence,accepted:true};
        const result=JSON.stringify(lastWrite);
        if(key){
          if(acceptedKeys.size>=256)acceptedKeys.delete(acceptedKeys.keys().next().value);
          acceptedKeys.set(key,{body:canonical,response:result,status:requestedStatus});
        }
        // Acceptance happens before any simulated delay: aborting the client cannot undo this write.
        send(result,requestedStatus);return;
      }
      const rawTarget=path.resolve(base,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
      if(!rawTarget.startsWith(base+path.sep)){response.writeHead(403);response.end('Forbidden');return;}
      const target=await fs.realpath(rawTarget),allowed=await realBase;
      if(!target.startsWith(allowed+path.sep)){response.writeHead(403);response.end('Forbidden');return;}
      const stat=await fs.stat(target);if(!stat.isFile()){response.writeHead(404);response.end('Not found');return;}
      send(await fs.readFile(target),requestedStatus,types[path.extname(target)]||'application/octet-stream');
    }catch(error){
      if(response.headersSent || response.destroyed)return;
      response.writeHead(error.code==='ENOENT'?404:400,{'Content-Type':'text/plain; charset=utf-8'});
      response.end(error.code==='ENOENT'?'Not found':'Invalid request');
    }
  });
}

module.exports={createHttpExampleServer};
if(require.main===module){
  const port=Number(process.argv[2]||8000);
  if(!Number.isInteger(port) || port<1 || port>65535){console.error('Port must be an integer from 1 to 65535');process.exitCode=1;}
  else{
    const server=createHttpExampleServer();
    server.on('error',error=>{console.error(error.message);process.exitCode=1;});
    server.listen(port,'127.0.0.1',()=>{
      console.log('Editor: http://127.0.0.1:'+port+'/index.html');
      console.log('HTTP example: http://127.0.0.1:'+port+'/examples/http-integrations.html');
      console.log('Changing reads: '+readPath+' · In-memory POST/echo: '+writePath);
      console.log('Add ?delay=2500 or ?status=503 to an example endpoint. POST records disappear on restart.');
    });
  }
}
