import { createChromeAutomationController } from "./automation/chrome_controller.js";
import { loadEnabledSchedules } from "./automation/schedule_store.js";
import {createTabAuthorization} from "./automation/tab_authorization.js";
const tabAuthorization=createTabAuthorization(chrome);
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
  scheduledTargetProvider: id=>tabAuthorization.check(id)
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
    await tabAuthorization.authorize(tab);
    await openOrFocusRecorder();
  })().catch(async error=>{
    await chrome.storage.local.set({automationDiagnostic:{at:new Date().toISOString(),state:'needs_authorization',message:error.message}});
    await openOrFocusRecorder();
  });
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAutomationPolling().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.remove(['tabCaptureGrants','tabCaptureAuthorizationIntent']).catch(console.error);
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
  if(area==='local' && changes.automationSchedules)queueNative(()=>refreshNativeCompanion(chrome)).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message.recorderTabId!=null)return false;
  if(sender.id!==chrome.runtime.id)return false;
  if(message.type?.startsWith('TAB_CAPTURE_')){
    if(sender.tab?.url!==RECORDER_URL)return false;
    (async()=>{
      if(message.type==='TAB_CAPTURE_STATUS')return {ok:true,items:await tabAuthorization.status()};
      if(message.type==='TAB_CAPTURE_REQUEST_AUTH'){
        const target=await tabAuthorization.request(message.scheduleId,message.targetTabId);
        await chrome.tabs.update(target.tabId,{active:true});
        const tab=await chrome.tabs.get(target.tabId);
        await chrome.windows.update(tab.windowId,{focused:true});
        return {ok:true,target};
      }
      if(message.type==='TAB_CAPTURE_FORGET'){
        await revokeCapture(message.targetTabId,'Authorization cleared by user');return {ok:true};
      }
      if(['TAB_CAPTURE_PREPARE','TAB_CAPTURE_CHECK'].includes(message.type)){
        const {automationPendingRecording:pending,nativeCompanion}=await chrome.storage.local.get(['automationPendingRecording','nativeCompanion']);
        if(nativeCompanion?.enabled)throw Error('Disable the native experimental backend before using authorized tab capture');
        if(pending?.tabId!==sender.tab.id || pending?.scheduleId!==message.scheduleId || pending?.occurrenceKey!==message.occurrenceKey)throw Error('Scheduled request is no longer pending; capture cancelled');
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
  automationController.handleRuntimeMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});
