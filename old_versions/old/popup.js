// popup.js – Handles UI and shows debug messages

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const debugDiv = document.getElementById('debug');

function log(message) {
  console.log('[popup]', message);
  const p = document.createElement('p');
  p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  debugDiv.appendChild(p);
  debugDiv.scrollTop = debugDiv.scrollHeight;
}

// Update UI based on recording state
function updateUI(recording) {
  startBtn.disabled = recording;
  stopBtn.disabled = !recording;
  statusDiv.className = recording ? 'status recording' : 'status';
  statusDiv.textContent = recording ? '🔴 Recording...' : '⚪ Idle';
}

// Check current status when popup opens
async function checkStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'status' });
    updateUI(resp.isRecording);
    log(`Status check: ${resp.isRecording ? 'recording' : 'idle'}`);
  } catch (err) {
    log('Status check error: ' + err.message);
  }
}

// Start recording
startBtn.addEventListener('click', async () => {
  log('Start clicked');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'start' });
    if (resp.success) {
      log('Recording started');
      updateUI(true);
    } else {
      log('Start failed: ' + resp.error);
    }
  } catch (err) {
    log('Start error: ' + err.message);
  }
});

// Stop recording
stopBtn.addEventListener('click', async () => {
  log('Stop clicked');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'stop' });
    if (resp.success) {
      log('Stop command sent');
    } else {
      log('Stop failed: ' + resp.error);
    }
  } catch (err) {
    log('Stop error: ' + err.message);
  }
});

// Listen for messages from background/offscreen (broadcast to popup)
chrome.runtime.onMessage.addListener((msg) => {
  log('Received: ' + JSON.stringify(msg));

  if (msg.type === 'PROCESSING_START') {
    statusDiv.textContent = '⏳ Processing video...';
  } else if (msg.type === 'PROCESSING_DONE') {
    statusDiv.textContent = `✅ Saved: ${msg.filename}`;
    updateUI(false);
    setTimeout(() => statusDiv.textContent = '⚪ Idle', 3000);
  } else if (msg.type === 'PROCESSING_ERROR') {
    statusDiv.textContent = '❌ Processing error';
    log('Error: ' + msg.error);
    updateUI(false);
  }
});

// Initial check
checkStatus();