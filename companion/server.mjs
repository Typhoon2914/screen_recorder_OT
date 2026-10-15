import fs from 'node:fs/promises';
import path from 'node:path';
import {createNativeScheduler} from './scheduler.js';
import {createControlServer} from './control_server.js';
import {createObsProvider} from './provider.js';
const file=process.argv[2];if(!file)throw Error('Usage: node companion/server.mjs <paired-config.json>');
const config=JSON.parse(await fs.readFile(file,'utf8'));
const endpoint=new URL(config.endpoint);
if(process.platform!=='win32'||endpoint.protocol!=='ws:'||endpoint.hostname!=='127.0.0.1'||endpoint.username||endpoint.password)throw Error('Native Windows companion requires loopback OBS endpoint');
if(!path.isAbsolute(config.outputRoot)||!config.inputName||!config.window||!config.password)throw Error('Incomplete one-time native source configuration');
const directory=path.resolve(config.stateDirectory);await fs.mkdir(directory,{recursive:true});
const lockFile=path.join(directory,'server.lock');
// A live owner or unreadable/stale lock is never silently replaced.
const lock=await fs.open(lockFile,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
const stateFile=path.join(directory,'state.json');
const log=async(type,data={})=>{
  const row={at:new Date().toISOString(),type,...data};
  await fs.appendFile(path.join(directory,'events.jsonl'),JSON.stringify(row)+'\n');
  console.log(JSON.stringify(row));
};
const provider=createObsProvider(config,{log});
let server,timer,shuttingDown=false;
try{
  const scheduler=await createNativeScheduler({
    load:async()=>{try{return JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return null;}},
    persist:async state=>{await fs.writeFile(stateFile+'.tmp',JSON.stringify(state,null,2));await fs.rename(stateFile+'.tmp',stateFile);},
    record:job=>provider.record(job)
  });
  server=createControlServer({token:config.token,origin:config.origin,scheduler,onRequest:data=>log('control-request',data)});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(17653,'127.0.0.1',resolve);});
  await log('ready',{port:17653,phase:scheduler.snapshot().phase});
  timer=setInterval(()=>{if(!shuttingDown)scheduler.tick().catch(error=>log('scheduler-error',{message:error.message}));},1000);
  await new Promise(resolve=>{
    const stop=()=>{shuttingDown=true;clearInterval(timer);resolve();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    process.on('message',message=>{if(message?.type==='shutdown')stop();});
  });
  // Do not kill an active capture mid-write; allow its duration/stop/finalize.
  while(scheduler.snapshot().phase==='recording')await new Promise(resolve=>setTimeout(resolve,500));
}finally{
  clearInterval(timer);if(server)await new Promise(resolve=>server.close(resolve));
  await provider.disconnect().catch(()=>{});await lock.close();await fs.unlink(lockFile);
  if(process.connected)process.disconnect();
}
