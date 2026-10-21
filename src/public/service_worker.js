import { createChromeAutomationController } from "./automation/chrome_controller.js";
import { loadEnabledSchedules } from "./automation/schedule_store.js";
import {createTabAuthorization} from "./automation/tab_authorization.js";
const tabAuthorization=createTabAuthorization(chrome);
import {createTeamsJoiner} from './automation/teams_join.js';
import {createActivityLog} from './automation/activity_log.js';
const log=createActivityLog(chrome);
const teamsJoiner=createTeamsJoiner(chrome,{log});
import {createSetupActions} from './automation/setup_feedback.js';
const setupAction=createSetupActions({authorization:tabAuthorization,joiner:teamsJoiner,api:chrome,log});
import {refreshNativeCompanion,syncNativeCompanion} from "./automation/native_client.js";
let nativeQueue=Promise.resolve();
function queueNative(task){
  const next=nativeQueue.then(task);nativeQueue=next.catch(()=>{});return next;
}

const RECORDER_URL = chrome.runtime.getURL("pages/recorder.html");

const automationController = createChromeAutomationController({
  // Extension documents receive runtime messages, not content-script tab messages.
  chromeApi: {...chrome,tabs:{...chrome.tabs,sendMessage:async(tabId,message)=>{
    let lastError;
    for(let attempt=0;attempt<10;attempt++){
      try {return await chrome.runtime.sendMessage({...message,recorderTabId:tabId});}
      catch(error){lastError=error;await new Promise(resolve=>setTimeout(resolve,200));}
    }
    throw lastError;
  }}},
  recorderUrl: RECORDER_URL,
  schedulesProvider: () => loadEnabledSchedules(chrome),
  log,
  monitorActive:async active=>{
    if(!active.schedule?.teamsAutoJoin)return null;
    const target=await tabAuthorization.check(active.scheduleId);
    const result=await teamsJoiner.inspect(active.schedule,target,{detectDeparture:true});
    return {departed:result.state==='departed'};
  },
  scheduledTargetProvider: async (id,run)=>{
    const target=await tabAuthorization.check(id);
    await automationController.assertCurrent(run.schedule,run.occurrenceKey);
    if(run.schedule.teamsAutoJoin)return {...target,...await teamsJoiner.ensure(run.schedule,target,{...run,assertCurrent:()=>automationController.assertCurrent(run.schedule,run.occurrenceKey)})};
    return target;
  }
});

async function openOrFocusRecorder() {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(t => t.url === RECORDER_URL);

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: RECORDER_URL });
}

function ensureAutomationPolling() {
  return automationController.ensurePollingAlarm();
}

chrome.action.onClicked.addListener(tab => {
  (async()=>{
    if(await tabAuthorization.authorize(tab))await log({event:'setup_authorized',message:'Teams tab authorization completed for this browser session. Check Teams readiness next; recording has not been tested.'});
    await openOrFocusRecorder();
  })().catch(async error=>{
    await log({event:'setup_authorization_failed',level:'error',message:'Toolbar authorization failed: '+error.message});
    await chrome.storage.local.set({automationDiagnostic:{at:new Date().toISOString(),state:'needs_authorization',message:error.message}});
    await openOrFocusRecorder();
  });
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAutomationPolling().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.remove(['tabCaptureGrants','tabCaptureAuthorizationIntent','teamsJoinSessions']).catch(console.error);
  chrome.storage.local.set({automationActiveRecording:null,automationPendingRecording:null,automationDiagnostic:{at:new Date().toISOString(),state:'needs_authorization',message:'Browser restarted. Reauthorize the target tab before unattended recording. Missed occurrences are not replayed.'}}).catch(console.error);
  ensureAutomationPolling().catch(console.error);
});

chrome.tabs.onRemoved.addListener(tabId=>automationController.handleRecorderClosed(tabId).catch(console.error));
async function revokeCapture(tabId,reason){
  await tabAuthorization.revoke(tabId,reason);
  await chrome.runtime.sendMessage({type:'TAB_CAPTURE_REVOKED',targetTabId:tabId,reason}).catch(()=>{});
}
chrome.tabs.onRemoved.addListener(tabId=>revokeCapture(tabId,'Target tab closed').catch(console.error));
chrome.tabs.onUpdated.addListener((tabId,change)=>{
  if(!change.url)return;
  (async()=>{
    const {tabCaptureGrants={}}=await chrome.storage.session.get('tabCaptureGrants');
    for(const grant of Object.values(tabCaptureGrants)){
      if(grant.tabId===tabId && new URL(change.url).origin!==grant.origin){
        await revokeCapture(tabId,'Target navigated to another origin');break;
      }
    }
  })().catch(console.error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  (async()=>{
    const {nativeCompanion}=await chrome.storage.local.get('nativeCompanion');
    if(nativeCompanion?.enabled){
      if(alarm.name==='screen-recorder-automation-poll')await queueNative(()=>refreshNativeCompanion(chrome));
      return;
    }
    await automationController.handleAlarm(alarm);
  })().catch(async error=>{
    console.error(error);
    await chrome.storage.local.set({automationDiagnostic:{at:new Date().toISOString(),state:'failed',message:error.message}});
  });
});

chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  if(changes.automationSchedules){
    automationController.schedulesChanged(changes.automationSchedules.newValue || []).catch(console.error);
    queueNative(()=>refreshNativeCompanion(chrome)).catch(console.error);
    const before=changes.automationSchedules.oldValue || [],after=changes.automationSchedules.newValue || [];
    for(const id of new Set([...before,...after].map(s=>s.id))){
      const old=before.find(s=>s.id===id),next=after.find(s=>s.id===id);
      if(JSON.stringify(old)!==JSON.stringify(next))log({event:'schedule_changed',scheduleId:id,
        message:!next?'Schedule deleted; pending attempts will be cancelled.':!next.enabled?'Schedule disabled; pending attempts will be cancelled. Active recording is not stopped by disabling.':'Schedule saved or edited. Old pending attempts are invalidated; only the new timing applies.'}).catch(console.error);
    }
  }
  if(changes.captureEvents){
    const old=new Set((changes.captureEvents.oldValue || []).map(event=>JSON.stringify(event)));
    for(const event of changes.captureEvents.newValue || []){
      if(old.has(JSON.stringify(event)))continue;
      const labels={recording_started:'MediaRecorder started.',capture_stopped:'Capture stopped. The file has not yet been saved.',saving:'Saving the finalized file; waiting for download verification.',saved:'Download completed and file verified.',save_failed:'Save failed; recording retained for retry.',audio_warning:'Audio warning.',capture_failed:'Capture startup failed.'};
      if(labels[event.state])log({event:event.state,scheduleId:event.scheduleId,
        level:/failed/.test(event.state)?'error':/warning/.test(event.state)?'warning':'info',
        message:labels[event.state]+(event.message?' '+event.message:'')}).catch(console.error);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message.recorderTabId!=null)return false;
  if(sender.id!==chrome.runtime.id)return false;
  if(['AUTOMATION_CANCEL_RUN','AUTOMATION_VALIDATE_START'].includes(message.type)){
    if(sender.tab?.url!==RECORDER_URL)return false;
    (async()=>{
      if(message.type==='AUTOMATION_CANCEL_RUN')return automationController.cancelRun(message.scheduleId);
      const {automationPendingRecording:pending}=await chrome.storage.local.get('automationPendingRecording');
      if(pending?.tabId!==sender.tab.id || pending?.scheduleId!==message.scheduleId || pending?.occurrenceKey!==message.occurrenceKey)throw Error('Run is no longer pending; start cancelled');
      await automationController.assertCurrent(pending.schedule,pending.occurrenceKey);
      return {ok:true};
    })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
  if(message.type?.startsWith('TAB_CAPTURE_')){
    if(sender.tab?.url!==RECORDER_URL)return false;
    (async()=>{
      if(['TAB_CAPTURE_STATUS','TAB_CAPTURE_TEAMS_PREFLIGHT','TAB_CAPTURE_REQUEST_AUTH'].includes(message.type))return setupAction(message);
      if(message.type==='TAB_CAPTURE_SETUP_ERROR'){
        if(!['prepare','refresh'].includes(message.action))throw Error('Unknown setup feedback action');
        await log({event:'setup_failed',scheduleId:message.scheduleId,level:'error',
          message:(message.action==='prepare'?'Prepare selected Teams tab':'Refresh target/status')+' could not proceed: '+String(message.error || 'Check your selection').slice(0,500)});
        return {ok:true};
      }
      if(message.type==='TAB_CAPTURE_FORGET'){
        await revokeCapture(message.targetTabId,'Authorization cleared by user');return {ok:true};
      }
      if(['TAB_CAPTURE_PREPARE','TAB_CAPTURE_CHECK'].includes(message.type)){
        const {automationPendingRecording:pending,nativeCompanion}=await chrome.storage.local.get(['automationPendingRecording','nativeCompanion']);
        if(nativeCompanion?.enabled)throw Error('Disable the native experimental backend before using authorized tab capture');
        if(pending?.tabId!==sender.tab.id || pending?.scheduleId!==message.scheduleId || pending?.occurrenceKey!==message.occurrenceKey)throw Error('Scheduled request is no longer pending; capture cancelled');
        await automationController.assertCurrent(pending.schedule,pending.occurrenceKey);
        const result=message.type==='TAB_CAPTURE_PREPARE'
          ?await tabAuthorization.prepare(message.scheduleId,sender.tab.id)
          :await tabAuthorization.check(message.scheduleId);
        return {ok:true,...result};
      }
      throw Error('Unknown tab capture request');
    })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
  if(message.type==='SET_NATIVE_COMPANION'){
    if(sender.tab?.url!==RECORDER_URL)return false;
    queueNative(async()=>{
      const {nativeCompanion:previous,automationSchedules=[]}=await chrome.storage.local.get(['nativeCompanion','automationSchedules']);
      const config={enabled:message.enabled===true,token:message.token || previous?.token || ''};
      if(config.enabled || previous?.enabled)await syncNativeCompanion({config,schedules:automationSchedules});
      await chrome.storage.local.set({nativeCompanion:config});
      if(config.enabled)await refreshNativeCompanion(chrome);
      return {ok:true};
    }).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
  if(message.type==='REFRESH_NATIVE_COMPANION'){
    if(sender.tab?.url!==RECORDER_URL)return false;
    queueNative(()=>refreshNativeCompanion(chrome)).then(()=>sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
  if(message.type==='RECORDER_DOCUMENT_READY'){
    if(sender.tab?.url!==RECORDER_URL)return false;
    automationController.handleRecorderClosed(sender.tab.id,{includePending:false})
      .then(()=>sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
  if(sender.tab?.url!==RECORDER_URL)return false;
  automationController.handleRuntimeMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});
