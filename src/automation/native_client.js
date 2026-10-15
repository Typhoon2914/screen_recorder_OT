// Only the paired loopback service is reachable. Never send OBS credentials.
export async function syncNativeCompanion({config,schedules,fetchImpl=fetch,extensionId=globalThis.chrome?.runtime?.id}){
  if(!/^[a-f0-9]{64}$/.test(config?.token || ''))throw Error('Native companion pairing token is required');
  if(!/^[a-p]{32}$/.test(extensionId || ''))throw Error('Native companion requires an extension identity');
  const request=async(path,options={})=>{
    const response=await fetchImpl('http://127.0.0.1:17653'+path,{
      ...options,headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json','X-Recorder-Extension':extensionId},
      signal:AbortSignal.timeout(10000)
    });
    if(!response.ok)throw Error('Native companion request failed ('+response.status+'); check pairing and local service');
    return response.json();
  };
  await request('/schedules',{method:'POST',body:JSON.stringify(config.enabled?schedules:[])});
  return request('/health');
}
export async function refreshNativeCompanion(chromeApi,fetchImpl=fetch){
  const {nativeCompanion,automationSchedules=[]}=await chromeApi.storage.local.get(['nativeCompanion','automationSchedules']);
  if(!nativeCompanion?.enabled)return false;
  try{
    const health=await syncNativeCompanion({config:nativeCompanion,schedules:automationSchedules,fetchImpl,extensionId:chromeApi.runtime.id});
    const {recordingHistory=[]}=await chromeApi.storage.local.get('recordingHistory');
    const nativeHistory=health.history.map(item=>({id:'native-'+item.id,backend:'native',filename:item.file || '',bytes:item.bytes || 0,state:item.state,at:item.completedAt || item.at,message:item.message}));
    await chromeApi.storage.local.set({
      nativeCompanionHealth:{phase:health.phase,active:health.active,at:new Date().toISOString()},
      automationDiagnostic:{at:new Date().toISOString(),state:health.phase,message:'Native companion: '+health.phase+(health.active?.message?' — '+health.active.message:'')},
      recordingHistory:[...nativeHistory,...recordingHistory.filter(item=>item.backend!=='native')].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,100)
    });
    return true;
  }catch(error){
    await chromeApi.storage.local.set({nativeCompanionHealth:{phase:'unreachable',at:new Date().toISOString()},automationDiagnostic:{at:new Date().toISOString(),state:'failed',message:error.message}});
    throw error; // Never silently fall back to a capture picker.
  }
}
