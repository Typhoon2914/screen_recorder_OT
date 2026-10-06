import { createChromeAutomationController } from "./automation/chrome_controller.js";

const RECORDER_URL = chrome.runtime.getURL("pages/recorder.html");
const AUTOMATION_SCHEDULES = [];

const automationController = createChromeAutomationController({
  chromeApi: chrome,
  recorderUrl: RECORDER_URL,
  schedules: AUTOMATION_SCHEDULES
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
  ensureAutomationPolling().catch(console.error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  automationController.handleAlarm(alarm).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  automationController.handleRuntimeMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});
