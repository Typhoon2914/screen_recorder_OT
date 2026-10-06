const RECORDER_URL = chrome.runtime.getURL("pages/recorder.html");

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

chrome.action.onClicked.addListener(() => {
  openOrFocusRecorder().catch(console.error);
});