import fs from 'node:fs/promises';
import path from 'node:path';
import OBSWebSocket from 'obs-websocket-js';
import {validateScheduleList} from '../src/automation/schedule_store.js';
import {dueSchedules,getOccurrenceKey} from '../src/automation/scheduler.js';
import {recordWithObs} from './recording.js';

const configFile=process.argv[2];
if(!configFile)throw Error('Usage: node companion/run.mjs <config.json> [--execute]');
const config=JSON.parse(await fs.readFile(configFile,'utf8'));
validateScheduleList(config.schedules);
const endpoint=new URL(config.endpoint);
if(endpoint.protocol!=='ws:'||endpoint.hostname!=='127.0.0.1'||endpoint.username||endpoint.password)throw Error('Companion accepts loopback WebSocket endpoints only');
if(!process.argv.includes('--execute')){
  console.log(JSON.stringify({mode:'dry-run',schedules:config.schedules.length,willConnect:false,willRecord:false}));
}else{
  if(process.platform!=='win32')throw Error('This companion is Windows-only');
  if(!process.env.SCREEN_RECORDER_OBS_PASSWORD)throw Error('Set SCREEN_RECORDER_OBS_PASSWORD without logging it');
  if(!(Date.parse(config.readyUntil)>Date.now()))throw Error('A future readyUntil authorization is required');
  const directory=path.resolve(config.stateDirectory);await fs.mkdir(directory,{recursive:true});
  const lockPath=path.join(directory,'companion.lock');
  const lock=await fs.open(lockPath,'wx');
  const statePath=path.join(directory,'state.json');
  const controller=new AbortController();
  const quit=()=>controller.abort();process.on('SIGINT',quit);process.on('SIGTERM',quit);
  const sleep=ms=>new Promise(resolve=>{
    if(controller.signal.aborted)return resolve();
    const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};
    const timer=setTimeout(done,ms);controller.signal.addEventListener('abort',done,{once:true});
  });
  const obs=new OBSWebSocket();
  let state={handled:[],history:[]};
  const persist=async()=>{
    await fs.writeFile(statePath+'.tmp',JSON.stringify(state,null,2));await fs.rename(statePath+'.tmp',statePath);
  };
  try{
    try{state=JSON.parse(await fs.readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!Array.isArray(state.handled)||!Array.isArray(state.history))throw Error('Corrupt companion state; refusing replay');
    if(state.active)throw Error('Previous companion operation is unresolved; reconcile OBS and output before clearing state.active');
    await obs.connect(config.endpoint,process.env.SCREEN_RECORDER_OBS_PASSWORD,{rpcVersion:1});
    const rpc=async(name)=>{
      let timer;
      try{return await Promise.race([obs.call(name),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`OBS ${name} timed out; reconcile manually before retry`)),15000);})]);}
      finally{clearTimeout(timer);}
    };
    while(!controller.signal.aborted){
      const d=new Date();const now={date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,weekday:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()],time:d.toTimeString().slice(0,8)};
      const due=dueSchedules(config.schedules.filter(s=>s.enabled),now,{handledOccurrenceKeys:new Set(state.handled)});
      if(due.length){
        const schedule=due[0];const key=getOccurrenceKey(schedule,now);const durationMs=schedule.durationMinutes*60000;
        // Persist intent before starting: an ambiguous crash must not replay.
        state.handled=[...state.handled,key].slice(-1000);state.active={key,state:'starting'};await persist();
        try{
          const result=await recordWithObs({rpc,ready:Date.parse(config.readyUntil)>Date.now()+durationMs,durationMs,outputRoot:config.outputRoot,expectedScene:config.expectedScene,sleep});
          state.history=[{...result,key,at:new Date().toISOString()},...state.history].slice(0,100);
          state.active=null;await persist();console.log(JSON.stringify({state:'saved',bytes:result.bytes}));
        }catch(error){
          state.active={key,state:'failed',message:error.message};await persist();
          throw error; // Fail closed; no automatic retries after ambiguous OBS state.
        }
      }
      await sleep(15000);
    }
  }finally{
    await obs.disconnect().catch(()=>{});await lock.close();await fs.unlink(lockPath);
    process.off('SIGINT',quit);process.off('SIGTERM',quit);
  }
}
