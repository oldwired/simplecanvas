// Development-only, loopback MQTT broker and static server. All telemetry is synthetic;
// client publishing is disabled. Runtime HTML uses its bundled client, not these packages.
// Run: node tools/serve-mqtt-example.cjs [port]
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {WebSocketServer,createWebSocketStream}=require('ws');
const root=path.join(__dirname,'..');
const topics={reading:'simplecanvas/demo/reading',status:'simplecanvas/demo/status'};
const types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png',
  '.svg':'image/svg+xml','.ico':'image/x-icon','.md':'text/plain; charset=utf-8'};

async function createMqttExampleServer({directory=root,interval=1000,authenticate}={}){
  const {Aedes}=await import('aedes');
  const broker=await Aedes.createBroker({maxClientsIdLength:128,heartbeatInterval:0});
  const base=await fs.realpath(path.resolve(directory));
  const stats={connections:[],disconnects:[],subscriptions:[]};
  if(authenticate)broker.authenticate=authenticate;
  broker.authorizePublish=(client,packet,done)=>done(new Error('This demonstration broker is read-only'));
  broker.on('client',client=>stats.connections.push(client.id));
  broker.on('clientDisconnect',client=>stats.disconnects.push(client.id));
  broker.on('subscribe',(subscriptions,client)=>stats.subscriptions.push({id:client.id,topics:subscriptions.map(sub=>sub.topic)}));
  broker.on('clientError',()=>{});
  broker.on('connectionError',()=>{});
  const server=http.createServer(async(request,response)=>{
    response.setHeader('Cache-Control','no-store');
    try{
      if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end('Method not allowed');return;}
      const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      const target=path.resolve(base,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
      if(!target.startsWith(base+path.sep)){response.writeHead(403);response.end('Forbidden');return;}
      const actual=await fs.realpath(target);
      if(!actual.startsWith(base+path.sep)){response.writeHead(403);response.end('Forbidden');return;}
      if(!(await fs.stat(actual)).isFile()){response.writeHead(404);response.end('Not found');return;}
      const content=await fs.readFile(actual);
      response.writeHead(200,{'Content-Type':types[path.extname(actual)]||'application/octet-stream','Content-Length':content.length});
      response.end(request.method==='HEAD'?undefined:content);
    }catch(error){
      if(!response.headersSent){response.writeHead(error.code==='ENOENT'?404:400);response.end(error.code==='ENOENT'?'Not found':'Invalid request');}
    }
  });
  const sockets=new WebSocketServer({server,path:'/mqtt',maxPayload:65536});
  sockets.on('error',()=>{}); // The HTTP server reports listen errors to its caller.
  sockets.on('connection',(socket,request)=>{
    const stream=createWebSocketStream(socket);stream.on('error',()=>{});socket.on('error',()=>{});
    broker.handle(stream,request);
  });
  const publish=(topic,payload,{retain=false,qos=0}={})=>new Promise((resolve,reject)=>{
    broker.publish({cmd:'publish',topic,payload:Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload)),qos,retain},error=>error?reject(error):resolve());
  });
  let sequence=0,closed=false;
  const tick=async()=>{
    await publish(topics.reading,{value:(35+sequence*7)%101,name:'Workshop',sequence},{retain:true});
    await publish(topics.status,sequence%2?'Reading updated':'Workshop online',{retain:true});
    sequence++;
  };
  await tick();
  const timer=interval>0?setInterval(()=>void tick().catch(()=>{}),interval):null;
  timer?.unref();
  return {server,broker,sockets,stats,topics,publish,tick,
    dropClients(){for(const socket of sockets.clients)socket.terminate();},
    async close(){
      if(closed)return;closed=true;clearInterval(timer);
      for(const socket of sockets.clients)socket.terminate();
      await new Promise(resolve=>sockets.close(resolve));
      await new Promise(resolve=>broker.close(resolve));
      await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
    }
  };
}
module.exports={createMqttExampleServer,topics};
if(require.main===module){
  const port=Number(process.argv[2]||8001);
  if(!Number.isInteger(port)||port<1||port>65535){console.error('Port must be an integer from 1 to 65535');process.exitCode=1;}
  else createMqttExampleServer().then(example=>{
    example.server.on('error',error=>{console.error(error.message);void example.close();process.exitCode=1;});
    example.server.listen(port,'127.0.0.1',()=>{
      console.log('Editor: http://127.0.0.1:'+port+'/index.html');
      console.log('MQTT example: http://127.0.0.1:'+port+'/examples/mqtt-integrations.html');
      console.log('Broker: ws://127.0.0.1:'+port+'/mqtt');
      console.log('Read-only topics: '+Object.values(topics).join(' · '));
    });
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void example.close());
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
