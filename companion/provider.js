import OBSWebSocket from 'obs-websocket-js';
import {recordWithObs} from './recording.js';
import {verifyNativeMedia} from './media.js';
import {recordingFilename} from '../src/automation/recording_safety.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {withFreshSource} from './source.js';
export function createObsProvider(config,{log=async()=>{}}={}){
  const obs=new OBSWebSocket();let connected=false,connecting=null,peak=0,lastSignal=0,inputName;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  obs.on('ConnectionClosed',()=>{connected=false;});
  obs.on('InputVolumeMeters',({inputs})=>{
    for(const input of inputs.filter(i=>i.inputName===inputName)){
      for(const channel of input.inputLevelsMul)peak=Math.max(peak,...channel);
      if(input.inputLevelsMul.some(channel=>channel.some(value=>value>.0001)))lastSignal=Date.now();
    }
  });
  async function connect(){
    if(connected)return;
    if(!connecting)connecting=obs.connect(config.endpoint,config.password,{rpcVersion:1,eventSubscriptions:65536})
      .then(()=>{connected=true;}).finally(()=>{connecting=null;});
    await connecting;
  }
  async function rpc(name,data){
    await connect();let timer;
    try{return await Promise.race([obs.call(name,data),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('OBS '+name+' timed out; reconcile before retry')),15000);})]);}
    finally{clearTimeout(timer);}
  }
  async function isolation(){
    if((await rpc('GetProfileList')).currentProfileName!=='ScreenRecorderExperiment' ||
       (await rpc('GetSceneCollectionList')).currentSceneCollectionName!=='ScreenRecorderExperiment')throw Error('OBS experimental isolation check failed');
  }
  async function sourceReady(){
    const settings=(await rpc('GetInputSettings',{inputName})).inputSettings;
    if(settings.window!==config.window || settings.priority!==0 || settings.capture_audio!==true)throw Error('Native capture target/settings differ from one-time configuration');
    const list=await rpc('GetInputPropertiesListPropertyItems',{inputName,propertyName:'window'});
    if(!list.propertyItems.some(item=>item.itemEnabled && item.itemValue===config.window))throw Error('Configured Chrome window is missing or closed');
    if(!(await rpc('GetSourceActive',{sourceName:inputName})).videoActive)throw Error('Native video source is inactive');
    if((await rpc('GetInputMute',{inputName})).inputMuted)throw Error('Native audio source is muted');
  }
  return {
    rpc,disconnect:()=>obs.disconnect(),
    async record(job){
      if((job.schedule.targetUrl || '')!==(config.targetUrl || ''))throw Error('Schedule URL does not match the configured native capture target');
      await isolation();
      return withFreshSource({rpc,config,run:async nameOfSource=>{
      inputName=nameOfSource;peak=0;lastSignal=0;
      await log('fresh-native-source-created',{jobId:job.id,inputName});
      await sourceReady();
      for(let n=0;n<20 && !lastSignal;n++)await sleep(500);
      if(!lastSignal)throw Error('No native audio signal; check the intended Chrome source');
      // OBS treats percent tokens specially in FilenameFormatting.
      const name=recordingFilename({title:job.schedule.title,date:new Date(job.at),id:job.id,extension:'mp4'}).slice(0,-4).replaceAll('%','-');
      await rpc('SetRecordDirectory',{recordDirectory:config.outputRoot});
      await rpc('SetProfileParameter',{parameterCategory:'Output',parameterName:'FilenameFormatting',parameterValue:name});
      const expectedSeconds=job.schedule.durationMinutes*60;
      const result=await recordWithObs({...config,ready:true,durationMs:expectedSeconds*1000,rpc:async(name)=>{
        const result=await rpc(name);
        if(['StartRecord','StopRecord'].includes(name))await log(name,{jobId:job.id,result});
        return result;
      },sleep:async ms=>{
        const end=Date.now()+ms;
        do{await sleep(Math.min(1000,Math.max(0,end-Date.now())));await sourceReady();}while(Date.now()<end);
      }});
      await log('verifying-media',{jobId:job.id,file:result.file});
      const media=await verifyNativeMedia(result.file,expectedSeconds);
      await fs.writeFile(result.file+'.probe.json',JSON.stringify(media,null,2));
      if(path.basename(result.file).replace(/\.mp4$/i,'')!==name)throw Error('OBS did not apply the unique lecture filename; output retained for review');
      await log('verified-save',{jobId:job.id,file:result.file,bytes:result.bytes,duration:media.duration});
      return {...result,verified:true,media,audioPeak:peak,meetingReadiness:'Requires already-joined meeting; not inferred from media'};
      }});
    }
  };
}
