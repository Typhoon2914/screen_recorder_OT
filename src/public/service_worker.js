import { createChromeAutomationController } from "./automation/chrome_controller.js";
import { loadEnabledSchedules } from "./automation/schedule_store.js";

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
  schedulesProvider: () => loadEnabledSchedules(chrome)
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

chrome.action.onClicked.addListener(() => {
  openOrFocusRecorder().catch(console.error);
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAutomationPolling().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({automationActiveRecording:null,automationPendingRecording:null,automationDiagnostic:{at:new Date().toISOString(),state:'needs_authorization',message:'Browser restarted. Capture must be armed again. Missed occurrences are not replayed.'}}).catch(console.error);
  ensureAutomationPolling().catch(console.error);
});

chrome.tabs.onRemoved.addListener(tabId=>automationController.handleRecorderClosed(tabId).catch(console.error));

chrome.alarms.onAlarm.addListener((alarm) => {
  automationController.handleAlarm(alarm).catch(async error=>{
    console.error(error);
    await chrome.storage.local.set({automationDiagnostic:{at:new Date().toISOString(),state:'failed',message:error.message}});
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message.recorderTabId!=null)return false;
  if(sender.id!==chrome.runtime.id)return false;
  automationController.handleRuntimeMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});
