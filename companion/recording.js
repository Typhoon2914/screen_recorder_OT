import path from 'node:path';
import {stat} from 'node:fs/promises';

// Injected RPC makes ownership and save guarantees testable without controlling
// any desktop application. The runner connects only after explicit --execute.
export async function recordWithObs({rpc,ready,durationMs,outputRoot,expectedScene,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),statFile=stat}){
  if(!ready)throw Error('Explicit meeting readiness authorization is required');
  if(!Number.isFinite(durationMs)||durationMs<=0||durationMs>86400000)throw Error('Invalid duration');
  if(!path.win32.isAbsolute(outputRoot) || !expectedScene)throw Error('An absolute output directory and expected scene are required');
  const profile=await rpc('GetProfileList');
  if(profile.currentProfileName!=='ScreenRecorderExperiment')throw Error('Refusing non-experimental OBS profile');
  const collection=await rpc('GetSceneCollectionList');
  if(collection.currentSceneCollectionName!=='ScreenRecorderExperiment')throw Error('Refusing non-experimental scene collection');
  const scene=await rpc('GetCurrentProgramScene');
  if(scene.currentProgramSceneName!==expectedScene)throw Error('Configured capture scene is not selected');
  if((await rpc('GetRecordStatus')).outputActive)throw Error('OBS is already recording; refusing ownership');
  await rpc('StartRecord');
  let stopped;
  try {await sleep(durationMs);}
  finally {stopped=await rpc('StopRecord');}
  // StopRecord acknowledgment is not evidence that the writer has flushed.
  let inactive=false;
  for(let attempt=0;attempt<30;attempt++){
    if(!(await rpc('GetRecordStatus')).outputActive){inactive=true;break;}
    await sleep(1000);
  }
  if(!inactive)throw Error('OBS did not finish stopping; output is unverified');
  const file=stopped.outputPath;
  if(typeof file!=='string')throw Error('OBS did not return an output path');
  const relative=path.win32.relative(outputRoot,file);
  if(relative.startsWith('..') || path.win32.isAbsolute(relative) || !relative)throw Error('OBS output is outside configured directory');
  const before=await statFile(file);await sleep(1000);const after=await statFile(file);
  if(!after.size || after.size!==before.size)throw Error('OBS output is empty or still changing');
  return {state:'saved',file,bytes:after.size};
}
