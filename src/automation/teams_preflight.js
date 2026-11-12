import {getOccurrenceKey} from './scheduler.js';

// Conservative opt-in preflight. It never joins a meeting or grants capture access.
// Run no earlier than ten minutes before the scheduled local time.
export function preflightCandidate(schedule,now,{leadMinutes=10}={}){
  if(!schedule?.enabled || schedule.captureMode!=='tab' || schedule.teamsAutoJoin!==true || schedule.preflightRefresh===false)return null;
  if(!schedule.weekdays?.includes(now.weekday) || (schedule.runDate && schedule.runDate!==now.date))return null;
  const timeToSeconds=t=>{const [h,m,s=0]=String(t).split(':').map(Number);return h*3600+m*60+s;};
  const remaining=timeToSeconds(schedule.time)-timeToSeconds(now.time);
  if(!(remaining>0 && remaining<=leadMinutes*60))return null;
  return {scheduleId:schedule.id,occurrenceKey:getOccurrenceKey(schedule,now),remainingSeconds:remaining};
}

export function createTeamsPreflight({api,authorize,inspect,log=async()=>{},now=()=>new Date().toISOString()}){
  const key='teamsPreflightRuns';
  let serial=Promise.resolve();
  const enqueue=fn=>{const p=serial.then(fn);serial=p.catch(()=>{});return p;};
  return function run(schedule,context){
    return enqueue(async()=>{
      const {scheduleId,occurrenceKey}=context;
      const stored=(await api.storage.local.get(key))[key] || {};
      if(stored[occurrenceKey])return stored[occurrenceKey];
      // No refresh may happen during any active or pending recording.
      const busy=await api.storage.local.get(['automationActiveRecording','automationPendingRecording']);
      if(busy.automationActiveRecording || busy.automationPendingRecording)return {state:'skipped_busy'};
      const set=async(state,message='')=>{
        const existing=(await api.storage.local.get(key))[key] || {};
        const record={state,at:now(),scheduleId,message};
        await api.storage.local.set({[key]:{...Object.fromEntries(Object.entries(existing).slice(-100)),[occurrenceKey]:record}});
        return record;
      };
      let target;
      try{target=await authorize.check(scheduleId);}
      catch(error){
        await log({event:'preflight_attention',level:'warning',scheduleId,occurrenceKey,message:'Teams preflight needs authorization: '+error.message});
        return set('attention','Reauthorize this Teams tab');
      }
      let observed;
      try{observed=await inspect(schedule,target,{occurrenceKey});}
      catch(error){
        await log({event:'preflight_attention',level:'warning',scheduleId,occurrenceKey,message:'Cannot inspect Teams safely: '+error.message});
        return set('attention','Teams preflight inspection failed');
      }
      if(['joined','joining','prejoin','channel_ready'].includes(observed.state)){
        await log({event:'preflight_ready',scheduleId,occurrenceKey,message:'Teams already active or meeting visible. No refresh necessary; recording has not started.'});
        return set('ready',observed.state);
      }
      if(observed.state==='blocked' || observed.state==='departed'){
        await log({event:'preflight_attention',level:'warning',scheduleId,occurrenceKey,message:observed.reason || 'Teams page is blocked; not refreshing an unverified meeting'});
        return set('attention',observed.state);
      }
      if(observed.state!=='waiting')return set('attention','Unexpected Teams preflight state');
      // Record the intention *before* Chrome navigation. A worker restart must
      // never trigger a refresh loop. This may replace the document provenance.
      await set('refresh_requested','Teams channel had no meeting; refreshing the same tab once');
      try{
        const current=await api.tabs.get(target.tabId);
        if(current.id!==target.tabId || new URL(current.url).origin!==target.origin || current.status!=='complete')throw Error('Authorized Teams tab no longer ready');
        // Do not change URL, create a tab, or click Join. Capturing after reload
        // still requires Chrome to honor the original user-granted session.
        await api.tabs.reload(target.tabId);
        await log({event:'preflight_refreshed',scheduleId,occurrenceKey,message:'Refreshed the same authorized Teams tab before the lecture. Capture permission and meeting readiness will be checked again at recording time.'});
        return set('refreshed','Refreshed once');
      }catch(error){
        await log({event:'preflight_attention',level:'warning',scheduleId,occurrenceKey,message:'Teams preflight refresh failed: '+error.message});
        return set('attention','Teams refresh failed');
      }
    });
  };
}
