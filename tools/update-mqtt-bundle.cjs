// MQTT.js is checked in and embedded in the app/reader: no CDN or runtime fetch.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {parseApp}=require('../tests/helpers/app-source.cjs');
const VERSION='5.16.1',SHA256='75873d04a6400bbbac093b3602caf06f44ed92ee032925e1f4f21c03eba05a4e';
function mqttLibraryDeclaration(root=path.join(__dirname,'..')){
  const source=fs.readFileSync(path.join(root,'vendor','mqtt-'+VERSION+'.min.js'),'utf8');
  const license=fs.readFileSync(path.join(root,'vendor','mqtt-LICENSE.md'),'utf8').trim();
  if(crypto.createHash('sha256').update(source).digest('hex')!==SHA256)throw new Error('MQTT.js vendor checksum mismatch');
  return 'function componentMqttClientLibrary(){\n'+
    '    if(componentMqttClientLibrary.cached)return componentMqttClientLibrary.cached;\n'+
    '    /* MQTT.js '+VERSION+' — full upstream license travels with every standalone document.\n'+
    license.replace(/\*\//g,'* /').replace(/<\/script/gi,'<\\/script')+'\n    */\n'+
    source.replace(/<\/script/gi,'<\\/script')+'\n'+
    '    return componentMqttClientLibrary.cached=mqtt;\n  }';
}
function updateMqttBundle({root=path.join(__dirname,'..'),check=false}={}){
  const file=path.join(root,'index.html'),html=fs.readFileSync(file,'utf8');
  const previous=parseApp(html).declaration('componentMqttClientLibrary'),next=mqttLibraryDeclaration(root);
  if(check && previous!==next)throw new Error('Bundled MQTT.js source is stale');
  if(!check && previous!==next)fs.writeFileSync(file,html.replace(previous,()=>next));
}
module.exports={mqttLibraryDeclaration,updateMqttBundle,VERSION,SHA256};
if(require.main===module){try{updateMqttBundle({check:process.argv.includes('--check')});console.log('Checked embedded MQTT.js '+VERSION);}catch(error){console.error(error.message);process.exitCode=1;}}
