// Optional system-broker fixture. Nothing is installed or started by the ordinary test suite.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const mqtt=require('mqtt');
const runFile=promisify(execFile);

async function unusedPort(){
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function createMosquitto({authenticated=false}={}){
  const binary=process.env.MOSQUITTO_BIN;
  if(!binary)throw new Error('Set MOSQUITTO_BIN to a Mosquitto executable with WebSocket support');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simplecanvas-mosquitto-'));
  const tcpPort=await unusedPort();let wsPort=await unusedPort();while(wsPort===tcpPort)wsPort=await unusedPort();
  const url='ws://127.0.0.1:'+wsPort+'/mqtt',credentials=authenticated?{username:'reader',password:'mosquitto-test-secret'}:{};
  let processHandle=null,publisher=null,log='';
  try{
    let auth='allow_anonymous true\n';
    if(authenticated){
      if(!process.env.MOSQUITTO_PASSWD)throw new Error('Set MOSQUITTO_PASSWD for the authenticated broker test');
      const passwordFile=path.join(directory,'passwords');
      await runFile(process.env.MOSQUITTO_PASSWD,['-b','-c',passwordFile,credentials.username,credentials.password]);
      auth='allow_anonymous false\npassword_file '+passwordFile+'\n';
    }
    const config=path.join(directory,'mosquitto.conf');
    fs.writeFileSync(config,'persistence false\nlog_dest stdout\nlog_type all\nconnection_messages true\n'+auth+
      'listener '+tcpPort+' 127.0.0.1\nprotocol mqtt\nlistener '+wsPort+' 127.0.0.1\nprotocol websockets\n');
    const fixture={url,credentials,get log(){return log;},get client(){return publisher;},
      browserConnections(){return [...log.matchAll(/New client connected[^\n]* as (sc[A-Za-z0-9]+)\b/g)].map(match=>match[1]);},
      async start(){
        if(processHandle)throw new Error('Mosquitto is already running');
        const child=spawn(binary,['-c',config,'-v'],{stdio:['ignore','pipe','pipe']});processHandle=child;
        child.stdout.on('data',data=>{log+=data;});child.stderr.on('data',data=>{log+=data;});
        const client=mqtt.connect('mqtt://127.0.0.1:'+tcpPort,{clientId:'fixture-publisher',protocolVersion:4,clean:true,reconnectPeriod:100,connectTimeout:1000,...credentials});publisher=client;
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>done(new Error('Mosquitto startup timed out:\n'+log)),10000);
          const connected=()=>done(),error=error=>done(error),exited=code=>done(new Error('Mosquitto exited '+code+':\n'+log));
          function done(error){clearTimeout(timer);client.off('connect',connected);child.off('error',errorHandler);child.off('exit',exited);error?reject(error):resolve();}
          const errorHandler=error;client.on('error',()=>{});client.once('connect',connected);child.once('error',errorHandler);child.once('exit',exited);
        });
      },
      publish(topic,payload,{retain=false}={}){
        if(!publisher?.connected)throw new Error('Test publisher is not connected');
        return new Promise((resolve,reject)=>publisher.publish(topic,typeof payload==='string'?payload:JSON.stringify(payload),{qos:1,retain},error=>error?reject(error):resolve()));
      },
      async stop(){
        const client=publisher;publisher=null;
        if(client)await new Promise(resolve=>client.end(true,{},resolve));
        const child=processHandle;processHandle=null;if(!child || child.exitCode!==null || child.signalCode!==null)return;
        await new Promise(resolve=>{const timeout=setTimeout(()=>child.kill('SIGKILL'),3000);child.once('exit',()=>{clearTimeout(timeout);resolve();});child.kill('SIGTERM');});
      },
      async close(){await fixture.stop();fs.rmSync(directory,{recursive:true,force:true});}
    };
    await fixture.start();return fixture;
  }catch(error){
    if(publisher)publisher.end(true);if(processHandle)processHandle.kill('SIGTERM');fs.rmSync(directory,{recursive:true,force:true});throw error;
  }
}
module.exports={createMosquitto};
