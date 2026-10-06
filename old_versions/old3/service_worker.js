chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "OPEN_RECORDER") {
    chrome.tabs.create({ url: chrome.runtime.getURL("recorder.html") });
    sendResponse({ ok: true });
  }
});
