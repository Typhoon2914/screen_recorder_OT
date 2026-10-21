export function readinessFeedback(result){
  if(result.state==='channel_ready')return {tone:'success',title:'Meeting found — ready for the scheduled join',
    message:'The team, channel and tab authorization are confirmed. The scheduler can attempt to join at the scheduled time. This check did not join or test recording.'};
  if(result.state==='waiting' && (result.code==='meeting_absent' || result.reason==='Meeting has not started in the configured channel'))return {
    tone:'warning',title:'Setup confirmed — waiting for a meeting',
    message:'The correct team/channel and tab authorization are confirmed, but no meeting is available to join now. Keep this tab open. At the scheduled time, the scheduler will look for the meeting and retry within its configured start window. No joining or recording was tested.'};
  if(result.state==='joined')return {tone:'success',title:'Meeting joined — recording not tested',
    message:'The previously verified meeting is open and tab authorization is present. This check did not start or test recording.'};
  if(['prejoin','joining'].includes(result.state))return {tone:'warning',title:'Not ready yet — joining is incomplete',
    message:'Tab authorization is present, but meeting entry is not confirmed. Check Teams for setup, sign-in or lobby approval. This button does not join for you.'};
  if(result.state==='blocked')return {tone:'error',title:'Not ready — team/channel check failed',
    message:'The extension could not safely confirm the configured meeting location. Open the saved team and channel in the authorized tab, then check again. No Join button was clicked.'};
  if(result.state==='departed')return {tone:'warning',title:'Not ready — meeting departure detected',
    message:'The previous meeting is no longer open. This check did not rejoin or start recording.'};
  return {tone:'warning',title:'Not ready yet — Teams could not be confirmed',
    message:'Wait for Teams to finish loading and check for sign-in or lobby prompts, then check again. No joining or recording was tested.'};
}

// Shared by the trusted worker and controlled tests. Background refreshes do
// not flood the log; explicit user actions record both attempt and outcome.
export function createSetupActions({authorization,joiner,api,log}){
  const actions={TAB_CAPTURE_STATUS:'Refresh target/status',TAB_CAPTURE_TEAMS_PREFLIGHT:'Check Teams readiness',
    TAB_CAPTURE_REQUEST_AUTH:'Prepare selected Teams tab'};
  return async message=>{
    const action=actions[message.type];
    if(!action)throw Error('Unknown setup action');
    const visible=message.type!=='TAB_CAPTURE_STATUS' || message.userInitiated===true;
    if(visible)await log({event:'setup_started',scheduleId:message.scheduleId,message:action+' requested.'});
    try{
      if(message.type==='TAB_CAPTURE_STATUS'){
        const items=await authorization.status();
        const selected=items.find(item=>item.scheduleId===message.scheduleId);
        if(visible)await log({event:'setup_refreshed',scheduleId:message.scheduleId,
          level:selected && !selected.available?'warning':'info',
          message:`Target/status refreshed: ${items.filter(item=>item.available).length} of ${items.length} tab schedules have current authorization. ${selected && !selected.available?'Selected schedule is not ready: '+selected.message+'. ':''}This does not check whether a meeting exists or test recording.`});
        return {ok:true,items};
      }
      if(message.type==='TAB_CAPTURE_TEAMS_PREFLIGHT'){
        const target=await authorization.check(message.scheduleId);
        if(!target.schedule.teamsAutoJoin)throw Error('Automatic Teams joining is not enabled for this schedule');
        const result=await joiner.inspect(target.schedule,target);
        const feedback=readinessFeedback(result);
        await log({event:'setup_readiness',scheduleId:message.scheduleId,
          level:feedback.tone==='error'?'error':feedback.tone==='warning'?'warning':'info',
          message:`${feedback.title}. ${feedback.message}${result.reason?' Details: '+result.reason:''}`});
        return {ok:true,result,feedback};
      }
      const target=await authorization.request(message.scheduleId,message.targetTabId);
      await api.tabs.update(target.tabId,{active:true});
      const tab=await api.tabs.get(target.tabId);
      await api.windows.update(tab.windowId,{focused:true});
      await log({event:'setup_authorization_pending',scheduleId:message.scheduleId,
        message:'Preparation requested — authorization is not complete yet. On the selected Teams tab, click Extensions → Screen Recorder EXPERIMENT once. No meeting was joined and recording was not started.'});
      return {ok:true,target};
    }catch(error){
      if(visible)await log({event:'setup_failed',scheduleId:message.scheduleId,level:'error',message:action+' failed: '+error.message});
      throw error;
    }
  };
}
