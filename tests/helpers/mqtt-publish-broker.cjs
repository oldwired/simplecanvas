// Controlled real WebSocket broker for explicit write tests; all listeners are loopback-only.
const http=require('node:http');
const {WebSocketServer,createWebSocketStream}=require('ws');
async function createPublishBroker(){
  const {Aedes}=await import('aedes');
  const broker=await Aedes.createBroker({heartbeatInterval:0});
  const server=http.createServer((request,response)=>{response.writeHead(404);response.end();});
  const sockets=new WebSocketServer({server,path:'/mqtt',maxPayload:65536});
  const publications=[],connections=[],held=new Set(),waiters=new Set();let nextGate=null,closed=false;
  broker.on('client',client=>connections.push(client.id));broker.on('clientError',()=>{});broker.on('connectionError',()=>{});
  broker.authorizePublish=(client,packet,done)=>{
    const call={clientId:client.id,topic:packet.topic,payload:packet.payload.toString(),qos:packet.qos,retain:packet.retain};
    publications.push(call);for(const waiter of [...waiters])if(waiter.topic===call.topic)waiter.finish(null,call);
    const gate=nextGate;nextGate=null;
    if(gate){gate.done=done;held.add(gate);gate.accepted(call);}else done();
  };
  sockets.on('connection',(socket,request)=>{const stream=createWebSocketStream(socket);stream.on('error',()=>{});socket.on('error',()=>{});broker.handle(stream,request);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const fixture={url:'ws://127.0.0.1:'+server.address().port+'/mqtt',publications,connections,
    holdNext(){
      if(nextGate)throw new Error('A publication is already reserved');
      const gate={};gate.received=new Promise(resolve=>{gate.accepted=resolve;});
      gate.release=(error)=>{if(gate.done){const done=gate.done;gate.done=null;held.delete(gate);done(error);}};
      nextGate=gate;return gate;
    },
    next(topic){
      const promise=new Promise((resolve,reject)=>{const waiter={topic,finish(error,value){clearTimeout(timer);waiters.delete(waiter);error?reject(error):resolve(value);}};
        const timer=setTimeout(()=>waiter.finish(new Error('No MQTT publish on '+topic)),10000);timer.unref?.();waiters.add(waiter);});
      promise.catch(()=>{});return promise;
    },
    publish(topic,payload,{retain=false}={}){return new Promise((resolve,reject)=>broker.publish({cmd:'publish',topic,payload:Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload)),qos:0,retain},error=>error?reject(error):resolve()));},
    dropClients(){for(const socket of sockets.clients)socket.terminate();},
    async close(){
      if(closed)return;closed=true;for(const gate of held)gate.release();for(const waiter of [...waiters])waiter.finish(new Error('Broker closed'));
      for(const socket of sockets.clients)socket.terminate();await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>broker.close(resolve));
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    }
  };return fixture;
}
module.exports={createPublishBroker};
