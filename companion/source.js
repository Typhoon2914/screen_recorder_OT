import {randomUUID} from 'node:crypto';
// An empty, dedicated scene is a deliberate precondition. Never hide/remove
// someone else's sources or reuse a stale native process/audio binding.
export async function withFreshSource({rpc,config,run}){
  if((await rpc('GetProfileList')).currentProfileName!=='ScreenRecorderExperiment' ||
     (await rpc('GetSceneCollectionList')).currentSceneCollectionName!=='ScreenRecorderExperiment')throw Error('OBS experimental isolation check failed');
  if((await rpc('GetCurrentProgramScene')).currentProgramSceneName!==config.expectedScene)throw Error('Configured capture scene is not selected');
  if((await rpc('GetRecordStatus')).outputActive)throw Error('OBS already recording; refusing conflicting session');
  if((await rpc('GetSceneItemList',{sceneName:config.expectedScene})).sceneItems.length)throw Error('Dedicated native capture scene must be empty before a new job');
  const inputName='ScreenRecorderJob-'+randomUUID();
  const created=await rpc('CreateInput',{sceneName:config.expectedScene,inputName,inputKind:'window_capture',inputSettings:{window:config.window,priority:0,method:2,capture_audio:true,cursor:false,client_area:true},sceneItemEnabled:true});
  try{
    await rpc('SetSceneItemTransform',{sceneName:config.expectedScene,sceneItemId:created.sceneItemId,sceneItemTransform:{positionX:0,positionY:0,boundsType:'OBS_BOUNDS_SCALE_INNER',boundsWidth:1280,boundsHeight:720}});
    return await run(inputName);
  }finally{
    // Removing our own source releases native capture even after validation fails.
    await rpc('RemoveInput',{inputName});
  }
}
