// background.js – Manages the offscreen document and coordinates messages
let recordingState = {
  isRecording: false
};

// Ensure the offscreen document is created (or reuse existing one)
async function ensureOffscreen() {
  try {
    // First check if an offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({});
    const offscreen = existingContexts.find(c => c.contextType === 'OFFSCREEN_DOCUMENT');
    if (offscreen) {
      console.log('[background] Offscreen document already exists');
      return;
    }

    // No existing document, create one
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Screen recording'
    });
    console.log('[background] Offscreen document created');
  } catch (err) {
    // If error is because one already exists, ignore it
    if (err.message.includes('Only a single offscreen document may be created')) {
      console.log('[background] Offscreen document already exists (caught error)');
      return;
    }
    // Otherwise rethrow
    throw err;
  }
}

// Handle messages from popup and offscreen
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[background] received:', message);

  if (message.type === 'start') {
    ensureOffscreen()
      .then(() => {
        chrome.runtime.sendMessage({ type: 'START_RECORDING', target: 'offscreen' });
        recordingState.isRecording = true;
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error('[background] start error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // async response
  }

  if (message.type === 'stop') {
    try {
      chrome.runtime.sendMessage({ type: 'STOP_RECORDING', target: 'offscreen' });
      recordingState.isRecording = false;
      sendResponse({ success: true });
    } catch (err) {
      console.error('[background] stop error:', err);
      sendResponse({ success: false, error: err.message });
    }
  }

  if (message.type === 'status') {
    sendResponse({ isRecording: recordingState.isRecording });
  }

  // Handler for download requests from offscreen
  if (message.type === 'DOWNLOAD_RECORDING') {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[background] download error:', chrome.runtime.lastError);
        chrome.runtime.sendMessage({ type: 'PROCESSING_ERROR', error: chrome.runtime.lastError.message });
      } else {
        console.log('[background] download started, id:', downloadId);
        // Notify popup of success (blob URL will be cleaned up when offscreen document closes)
        chrome.runtime.sendMessage({ type: 'PROCESSING_DONE', filename: message.filename });
      }
    });
    sendResponse({ received: true });
    return true; // Keep the message channel open for async response
  }
});

console.log('[background] service worker started');