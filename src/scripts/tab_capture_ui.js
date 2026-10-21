import {readinessFeedback} from '../automation/setup_feedback.js';
const $=id=>document.getElementById(id);
let refreshing=false;
let queuedSchedule=null;
let queuedUserRefresh=false;
const readinessResults=new Map();
function displayFeedback(element,feedback){
  element.className='setupFeedback setupFeedback-'+feedback.tone;
  element.setAttribute('role','status');element.setAttribute('aria-live','polite');element.setAttribute('aria-atomic','true');
  const heading=document.createElement('strong');heading.textContent=feedback.title;
  const text=document.createElement('span');text.textContent=feedback.message;
  const time=document.createElement('small');time.textContent='Updated '+new Date(feedback.at || Date.now()).toLocaleTimeString();
  element.replaceChildren(heading,text,time);
  if(feedback.details){
    const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('p');
    summary.textContent='Technical details';body.textContent=feedback.details;details.append(summary,body);element.append(details);
  }
}
function feedback(tone,title,message,details){
  const result={tone,title,message,details,at:Date.now()};displayFeedback($('authorizationStatus'),result);return result;
}
async function send(type,data={}){
  const result=await chrome.runtime.sendMessage({type,...data});
  if(!result?.ok)throw Error(result?.error || 'Authorization request failed');
  return result;
}
async function refresh(userInitiated=false){
  if(refreshing){queuedUserRefresh ||= userInitiated;return;}refreshing=true;
  let statusReceived=false;
  try{
    if(userInitiated)feedback('info','Refreshing target/status…','Checking saved tab authorizations. This will not join a meeting or start recording.');
    const result=await send('TAB_CAPTURE_STATUS',{userInitiated,scheduleId:$('authorizationSchedule').value || undefined});
    statusReceived=true;
    const {automationSchedules=[]}=await chrome.storage.local.get('automationSchedules');
    const selected=queuedSchedule || $('authorizationSchedule').value;
    queuedSchedule=null;
    $('authorizationSchedule').replaceChildren(new Option('Select a tab-capture schedule',''));
    for(const s of automationSchedules.filter(s=>s.captureMode==='tab'&&s.enabled))$('authorizationSchedule').add(new Option(s.title || s.id,s.id));
    $('authorizationSchedule').value=selected;
    const s=automationSchedules.find(s=>s.id===$('authorizationSchedule').value);
    const previous=$('authorizationTarget').value;
    $('authorizationTarget').replaceChildren(new Option('Select the exact existing target tab',''));
    for(const tab of await chrome.tabs.query({})){
      if(s && tab.url===s.targetUrl)$('authorizationTarget').add(new Option(`Tab ${tab.id}: ${tab.title} — ${tab.url}`,String(tab.id)));
    }
    $('authorizationTarget').value=previous;
    $('authorizationList').replaceChildren();
    for(const item of result.items){
      const row=document.createElement('div');row.className='authorizationCard';
      row.textContent=item.available
        ?`${item.title}: session authorization present — tab ${item.tabId}, ${item.currentUrl}. This alone does not verify auto-join or recording; audio/video are checked at start.`
        :`${item.title}: UNATTENDED UNAVAILABLE — ${item.message}`;
      if(item.available){
        if(item.schedule?.teamsAutoJoin){
          const check=document.createElement('button');check.type='button';check.className='btn';check.textContent='Check Teams readiness (no joining)';
          const outcome=document.createElement('div');
          if(readinessResults.has(item.scheduleId))displayFeedback(outcome,readinessResults.get(item.scheduleId));
          check.onclick=async()=>{
            check.disabled=true;
            const busy=feedback('info','Checking Teams readiness…','Checking the authorized tab and meeting location. No joining or recording will occur.');
            displayFeedback(outcome,busy);
            try{
              const {result,feedback:workerFeedback}=await send('TAB_CAPTURE_TEAMS_PREFLIGHT',{scheduleId:item.scheduleId});
              const summary=workerFeedback || readinessFeedback(result);
              const value=feedback(summary.tone,item.title+' — '+summary.title,summary.message,result.reason);
              readinessResults.set(item.scheduleId,value);displayFeedback(outcome,value);outcome.scrollIntoView({block:'nearest'});
            }catch(error){
              const value=showError(error,'Readiness check failed');
              readinessResults.set(item.scheduleId,value);displayFeedback(outcome,value);outcome.scrollIntoView({block:'nearest'});
            }finally{check.disabled=false;}
          };
          row.append(check,outcome);
        }
        const clear=document.createElement('button');clear.type='button';clear.className='btn';clear.textContent='Revoke this tab';
        clear.onclick=()=>send('TAB_CAPTURE_FORGET',{targetTabId:item.tabId}).then(()=>refresh(true)).catch(showError);
        row.append(clear);
      }
      $('authorizationList').append(row);
    }
    if(userInitiated){
      const item=result.items.find(item=>item.scheduleId===$('authorizationSchedule').value);
      if(item && !item.available)feedback('error','Not ready — tab authorization unavailable',item.message+' Prepare this Teams tab again before unattended recording.');
      else feedback('info','Status refreshed — meeting readiness not checked',
        `${result.items.filter(item=>item.available).length} of ${result.items.length} tab schedules have current authorization. Use Check Teams readiness to check the team/channel and whether a meeting is available. No joining or recording was tested.`);
    }
  }catch(error){
    showError(error,'Status refresh failed');
    if(userInitiated && statusReceived)send('TAB_CAPTURE_SETUP_ERROR',{action:'refresh',error:error.message}).catch(console.warn);
  }finally{
    refreshing=false;
    if(queuedSchedule || queuedUserRefresh){const manual=queuedUserRefresh;queuedUserRefresh=false;refresh(manual);}
  }
}
document.addEventListener('prepare-schedule',event=>{queuedSchedule=event.detail.scheduleId;refresh();});
function showError(error,title='Setup action failed'){
  return feedback('error','Not ready — '+title,error.message+' No joining or recording was started by this action.');
}
$('authorizationSchedule').onchange=()=>refresh();
$('authorizationRefresh').onclick=()=>refresh(true);
$('authorizeTarget').onclick=async()=>{
  let sent=false;
  try{
    if(!$('authorizationSchedule').value)throw Error('Select a saved schedule first.');
    if(!$('authorizationReady').checked)throw Error('Confirm that this is the correct Teams channel/tab before authorization');
    const targetTabId=Number($('authorizationTarget').value);
    if(!targetTabId)throw Error('Select an exact target tab; no automatic substitution is allowed');
    feedback('warning','Action needed — click the extension on the Teams tab','Preparation is not authorization yet. On the selected Teams tab, click Extensions → Screen Recorder EXPERIMENT once. Do not click Start Recording. Then return here and check Teams readiness.');
    sent=true;
    await send('TAB_CAPTURE_REQUEST_AUTH',{scheduleId:$('authorizationSchedule').value,targetTabId});
  }catch(error){
    showError(error,'Preparation could not finish');
    if(!sent)send('TAB_CAPTURE_SETUP_ERROR',{action:'prepare',scheduleId:$('authorizationSchedule').value,error:error.message}).catch(console.warn);
  }
};
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local' && changes.tabCaptureLastAuthorization){
    readinessResults.clear();
    feedback('success','Tab authorized — check meeting readiness next','Chrome accepted authorization for this tab in this browser session. Use Check Teams readiness to verify the channel and meeting availability. Recording has not been tested.');
  }
  if((area==='session'&&changes.tabCaptureGrants)||(area==='local'&&changes.automationSchedules))readinessResults.clear();
  if((area==='session'&&changes.tabCaptureGrants)||(area==='local'&&(changes.automationSchedules||changes.tabCaptureLastAuthorization)))refresh();
});
setInterval(refresh,15000);
refresh();
