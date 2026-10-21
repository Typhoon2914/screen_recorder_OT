import { remuxMp4Faststart, ensureFFmpeg } from "./ffmpeg_fix.js";
import { createRecorderBridge } from "../automation/recorder_bridge.js";
import { recordingFilename, createSaveSession, createVerifiedSaver } from "../automation/recording_safety.js";
import { vault } from "./recording_vault.js";
import {recorderOptions} from '../automation/recording_options.js';
import {acquireAuthorizedTab} from '../automation/tab_capture.js';
import './tab_capture_ui.js';
import "./schedule_ui.js";
import "./workspace_ui.js";

const $ = (id) => document.getElementById(id);

/* DOM */
const startBtn = $("startBtn");
const stopBtn = $("stopBtn");

const statusPill = $("statusPill");
const timerEl = $("timer");

const formatLabel = $("formatLabel");
const meta = $("meta");
const metaRight = $("metaRight");
const detail = $("detail");

const videoTitle = $("videoTitle");
const preview = $("preview");

const playbackPane = $("playbackPane");
const playbackVideo = $("playbackVideo");
const downloadBtn = $("downloadBtn");

/* State */
let mediaRecorder = null;
let chunks = [];
let mimeType = "";
let fileExt = "";
let startedAt = 0;
let timerHandle = null;
let pendingAutomationRequest = null;
let activeAutomationRecordingId = null;
let armedStream = null;
let armedScheduleId = null;
let armedTargetUrl = '';
let captureStream = null;
let playbackURL = null;
let deadlineTimer = null;
let recordingTitle = '';
let recoveryRecord = null;
let initializationComplete = false;
let recordingWarnings=[];
let authorizedCapture=null;
let authorizedTargetId=null;
let recordingContext=null;
async function captureEvidence(state,fields={}){
  const {captureEvents=[]}=await chrome.storage.local.get('captureEvents');
  await chrome.storage.local.set({captureEvents:[...captureEvents,{at:new Date().toISOString(),state,...fields}].slice(-100)});
}
async function captureRequest(type,request){
  const result=await chrome.runtime.sendMessage({type,scheduleId:request.scheduleId,occurrenceKey:request.occurrenceKey});
  if(!result?.ok)throw Error(result?.error || 'Capture authorization check failed');
  return result;
}
let saveFile = createVerifiedSaver(chrome.downloads, {onDownload: persistDownloadId});
const saveSession = createSaveSession({save: (blob,name)=>saveFile(blob,name),onState:state=>{
  statusPill.textContent=state;
  startBtn.disabled=!['idle','saved'].includes(state);
  $('armBtn').disabled=startBtn.disabled;
  $('downloadBtn').disabled=state==='saving';
}});

async function persistDownloadId(downloadId) {
  if(recoveryRecord){recoveryRecord.downloadId=downloadId;await vault('put',recoveryRecord);}
}

async function saveFinalized() {
  try {
    captureEvidence('saving',{...recordingContext}).catch(console.warn);
    const item=await saveSession.retry();
    if(!item)return;
    detail.textContent=`Saved and verified: ${item.filename}`;
    if(recordingWarnings.length)detail.textContent+=` WARNING: ${recordingWarnings.join('; ')}`;
    downloadBtn.textContent='Saved';downloadBtn.disabled=true;
    // Save success is independent of history/cleanup failures.
    try {
      await vault('delete');recoveryRecord=null;
      const stored=await chrome.storage.local.get('recordingHistory');
      const history=Array.isArray(stored.recordingHistory)?stored.recordingHistory:[];
      await chrome.storage.local.set({recordingHistory:[{id:item.id,filename:item.filename,bytes:item.fileSize,state:recordingWarnings.length?'saved_with_warning':'saved',warnings:recordingWarnings,at:new Date().toISOString(),...recordingContext},...history].slice(0,100)});
      await captureEvidence('saved',{filename:item.filename,bytes:item.fileSize,...recordingContext});
    }catch(error){detail.textContent+=` (History/recovery cleanup failed: ${error.message})`;}
  }catch(error){
    detail.textContent=`Save failed: ${error.message}. Recording retained; retry below.`;
    captureEvidence('save_failed',{message:error.message,...recordingContext}).catch(console.warn);
    downloadBtn.textContent='Retry save';downloadBtn.disabled=false;
  }
}

async function armCapture() {
  if(!initializationComplete)throw Error('Recorder is initializing or another recorder tab owns the session');
  if(saveSession.protected)throw Error('Save the current recording first');
  const scheduleId=$('armSchedule').value;
  if(!scheduleId)throw Error('Choose a schedule to arm');
  if(!$('readyCheck').checked)throw Error('Confirm the meeting is joined and the shared target is correct');
  const {automationSchedules=[]}=await chrome.storage.local.get('automationSchedules');
  const schedule=automationSchedules.find(item=>item.id===scheduleId && item.enabled);
  if(!schedule)throw Error('Schedule is no longer enabled');
  const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:{echoCancellation:false,noiseSuppression:false}});
  if(!stream.getVideoTracks().length || !stream.getAudioTracks().length){stream.getTracks().forEach(t=>t.stop());throw Error('Scheduled capture requires video and shared tab audio');}
  armedStream?.getTracks().forEach(t=>t.stop());
  armedStream=stream;armedScheduleId=scheduleId;preview.srcObject=stream;
  armedTargetUrl=schedule.targetUrl || '';
  detail.textContent='Armed for the selected schedule only. Keep this tab open. Authorization ends when sharing stops.';
  stream.getVideoTracks()[0].addEventListener('ended',()=>{
    armedStream=null;armedScheduleId=null;
    detail.textContent='Capture authorization ended. Arm again before the schedule.';
    stopRecording();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function setRecordingUI(on) {
  $('pauseBtn').disabled=!on;
  $('pauseBtn').textContent='Pause';
  startBtn.disabled = on;
  stopBtn.disabled = !on;
  stopBtn.classList.toggle("inactive", !on);
  startBtn.textContent = on ? "⏺ Recording…" : "🎬 Start Recording";
  statusPill.textContent = on ? "Recording" : "Idle";
  if (!on) timerEl.textContent = "00:00";
}

function showMode(mode) {
  if (mode === "live") {
    videoTitle.textContent = "Live Preview";
    preview.classList.remove("hidden");
    playbackPane.classList.add("hidden");
    playbackVideo.removeAttribute("src");
    playbackVideo.load();
    metaRight.textContent = "";
  } else {
    videoTitle.textContent = "Playback";
    preview.classList.add("hidden");
    playbackPane.classList.remove("hidden");
  }
}

/* wait until track size stable */
function waitForStableDims(track, quietMS = 500) {
  return new Promise((resolve) => {
    let timer;
    const done = () => {
      track.removeEventListener("resize", onResize);
      const { width, height } = track.getSettings();
      resolve({ width, height });
    };
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMS);
    };
    track.addEventListener("resize", onResize);
    onResize();
  });
}

function pickMimePreferMp4() {
  const preferMp4=$('formatChoice').value!=='webm';
  // Chromium can change codec configuration across pause/resume. avc3 permits
  // in-band parameter sets; avc1 remains a fallback on older Chrome versions.
  const resilientMp4='video/mp4;codecs="avc3.42E01E,mp4a.40.2"';
  if(preferMp4 && MediaRecorder.isTypeSupported(resilientMp4))return resilientMp4;
  const mp4 = 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"';
  if (preferMp4 && MediaRecorder.isTypeSupported(mp4)) return mp4;

  const webm1 = "video/webm;codecs=vp9,opus";
  const webm2 = "video/webm;codecs=vp8,opus";
  if (MediaRecorder.isTypeSupported(webm1)) return webm1;
  if (MediaRecorder.isTypeSupported(webm2)) return webm2;
  return "video/webm";
}

function createRecordingId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `automation-${Date.now()}`;
}

async function startRecording() {
  if(!initializationComplete || saveSession.protected)return;
  const automationRequest = pendingAutomationRequest;

  try {
    saveSession.begin();
    recordingWarnings=[];
    recordingContext={mode:automationRequest?.captureMode==='tab'?'authorized-tab':automationRequest?'prearmed-or-picker':'manual',scheduleId:automationRequest?.scheduleId || null,occurrenceKey:automationRequest?.occurrenceKey || null};
    startBtn.disabled=true;
    recordingTitle=automationRequest?.title || $('recordingTitle').value || '';
    if(playbackURL){URL.revokeObjectURL(playbackURL);playbackURL=null;}
    showMode("live");
    detail.textContent = automationRequest?.captureMode==='tab'?"Checking authorized target and audio…":"Opening chooser…";

    // Fresh tab capture is separate from the manual/pre-armed provider.
    if(automationRequest?.captureMode==='tab'){
      if(armedStream)throw Error('Disarm the manual capture before using authorized tab capture');
      const prepared=await captureRequest('TAB_CAPTURE_PREPARE',automationRequest);
      authorizedTargetId=prepared.targetTabId;
      authorizedCapture=await acquireAuthorizedTab({streamId:prepared.streamId,onSilence:message=>{
        if(!recordingWarnings.includes(message))recordingWarnings.push(message);
        detail.textContent=message;captureEvidence('audio_warning',{message}).catch(console.warn);
      }});
      recordingContext.targetTabId=authorizedTargetId;
      recordingContext.audioPeakDbfs=authorizedCapture.peakDbfs;
      recordingContext.audioSilentAtStart=authorizedCapture.silentAtStart;
    }
    const stream = authorizedCapture?.stream || armedStream || await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false }
    });
    captureStream=stream;
    if(!stream.getVideoTracks().some(t=>t.readyState==='live'))throw Error('Capture has no live video track');
    if(automationRequest && !stream.getAudioTracks().some(t=>t.readyState==='live'))throw Error('Scheduled capture has no live audio track');
    if(!automationRequest && !$('includeAudio').checked){stream.getAudioTracks().forEach(track=>{stream.removeTrack(track);track.stop();});}

    mimeType = pickMimePreferMp4();
    fileExt = mimeType.includes("mp4") ? "mp4" : "webm";

    const track = stream.getVideoTracks()[0];

    detail.textContent = "Stabilizing…";
    await sleep(1000);
    await waitForStableDims(track);
    if(automationRequest?.durationMinutes!=null)await captureRequest('AUTOMATION_VALIDATE_START',automationRequest);
    if(automationRequest?.captureMode==='tab'){
      const checked=await captureRequest('TAB_CAPTURE_CHECK',automationRequest);
      if(checked.tabId!==authorizedTargetId)throw Error('Authorized target changed during capture setup');
      if(stream.getTracks().some(t=>t.readyState!=='live'))throw Error('Capture ended before recording began');
    }

    track?.addEventListener("ended", () => {
      recordingWarnings.push('Video sharing ended');
      if(mediaRecorder?.state==='paused')stopRecording();
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    });
    for(const audioTrack of stream.getAudioTracks())audioTrack.addEventListener('ended',()=>{
      recordingWarnings.push('Audio track ended during capture');
      detail.textContent='Audio track ended; recording will stop to avoid silent capture';stopRecording();
    });

    preview.srcObject = stream;
    chunks = [];

    mediaRecorder = new MediaRecorder(stream, recorderOptions(mimeType,$('quality').value));
    mediaRecorder.onerror=event=>{detail.textContent=`Capture failed: ${event.error?.message || 'encoder error'}`;stopRecording();};

    const actual = mediaRecorder.mimeType || mimeType;
    fileExt = actual.includes("mp4") ? "mp4" : "webm";
    formatLabel.textContent = actual;
    metaRight.textContent = actual;

    detail.textContent = "Recording…";
    mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mediaRecorder.onstop = handleStop;
    mediaRecorder.start();
    if(recordingWarnings.length)detail.textContent='Recording — '+recordingWarnings.join(' ');
    captureEvidence('recording_started',{...recordingContext,tracks:stream.getTracks().map(t=>({kind:t.kind,state:t.readyState}))}).catch(console.warn);
    if(!stream.getAudioTracks().length){recordingWarnings.push('Video only: no shared audio track');detail.textContent=recordingWarnings[0];}
    const duration=automationRequest?.durationMinutes;
    if(duration)deadlineTimer=setTimeout(stopRecording,duration*60000);

    if (automationRequest) {
      activeAutomationRecordingId = createRecordingId();
      pendingAutomationRequest = null;
      recorderBridge.clearPendingOccurrence(automationRequest.occurrenceKey);

      recorderBridge.notifyRecordingStarted({
        recordingId: activeAutomationRecordingId,
        occurrenceKey: automationRequest.occurrenceKey
      }).catch((error) => {
        console.warn("Could not report automation start:", error);
      });
    }

    startedAt = Date.now();
    clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      timerEl.textContent = fmtTime(Date.now() - startedAt);
      if(duration)timerEl.textContent+=` / ${duration}:00`;
    }, 200);

    setRecordingUI(true);
  } catch (err) {
    console.error(err);
    await authorizedCapture?.release();authorizedCapture=null;authorizedTargetId=null;
    captureStream?.getTracks().forEach(t=>t.stop());captureStream=null;
    armedStream=null;armedScheduleId=null;saveSession.cancel();

    if (automationRequest) {
      pendingAutomationRequest = null;
      recorderBridge.clearPendingOccurrence(automationRequest.occurrenceKey);

      recorderBridge.notifyAutomationError({
        reason: err?.name === "NotAllowedError"
          ? "capture_cancelled"
          : "capture_failed",
        message: err?.message || "Could not start screen capture."
      }).catch((reportError) => {
        console.warn("Could not report automation error:", reportError);
      });
    }

    if(!automationRequest)alert("Could not start screen capture.\n" + err.message);
    setRecordingUI(false);
    detail.textContent = "Capture failed: "+err.message;
    captureEvidence('capture_failed',{message:err.message,...recordingContext}).catch(console.warn);
    showMode("live");
    if(automationRequest)throw err;
  }
}

async function handleStop() {
  captureEvidence('capture_stopped',{...recordingContext}).catch(console.warn);
  clearInterval(timerHandle);
  clearTimeout(deadlineTimer);
  $('pauseBtn').disabled=true;

  const stream = preview.srcObject;
  stream?.getTracks().forEach((t) => t.stop());
  await authorizedCapture?.release();authorizedCapture=null;authorizedTargetId=null;
  captureEvidence('recording_stopped',{...recordingContext,tracks:(stream?.getTracks() || []).map(t=>({kind:t.kind,state:t.readyState}))}).catch(console.warn);
  preview.srcObject = null;
  captureStream=null;armedStream=null;armedScheduleId=null;

  if (!chunks.length) {
    if (activeAutomationRecordingId) {
      recorderBridge.notifyAutomationError({
        reason: "empty_recording",
        message: "The automated recording stopped without captured data."
      }).catch(console.warn);
      activeAutomationRecordingId = null;
    }

    alert("❌ Nothing was captured.");
    setRecordingUI(false);
    saveSession.cancel();
    detail.textContent = "Nothing was captured; capture must be authorized again.";
    showMode("live");
    return;
  }

  setRecordingUI(false);
  startBtn.disabled=true;
  statusPill.textContent='processing';

  let blob = new Blob(chunks, { type: mimeType });
  const originalMime = mimeType;
  const originalMB = (blob.size / (1024 * 1024)).toFixed(2);

  detail.textContent = "Preparing playback…";

  if ((originalMime || "").includes("mp4")) {
    try {
      detail.textContent = "Loading ffmpeg.wasm…";
      await ensureFFmpeg((msg) => {
        if (msg.startsWith("progress:"))
          detail.textContent = `Fixing… ${msg.split(":")[1]}`;
      });

      detail.textContent = "Fixing MP4 seek…";
      blob = await remuxMp4Faststart(blob, (msg) => {
        if (msg.startsWith("progress:"))
          detail.textContent = `Fixing… ${msg.split(":")[1]}`;
      });

      mimeType = "video/mp4";
      fileExt = "mp4";
      detail.textContent = "Fixed ✅";
    } catch (e) {
      console.warn("ffmpeg fix failed, using original:", e);
      recordingWarnings.push(`Fast-start processing failed; original media retained: ${e.message}`);
      detail.textContent = "Fix failed (using original)";
      blob = new Blob(chunks, { type: originalMime });
      mimeType = originalMime;
      fileExt = originalMime.includes("mp4") ? "mp4" : "webm";
    }
  } else {
    detail.textContent = "Ready ✅";
  }

  const blobURL = URL.createObjectURL(blob);
  playbackURL=blobURL;

  showMode("playback");
  playbackVideo.src = blobURL;

  const mb = (blob.size / (1024 * 1024)).toFixed(2);
  meta.textContent = `${mimeType} · ${mb} MB (was ${originalMB} MB)`;
  metaRight.textContent = `${mb} MB`;

  downloadBtn.disabled = false;
  const filename = recordingFilename({title:recordingTitle,date:new Date(startedAt),extension:fileExt});
  saveSession.finalize(blob,filename);
  recoveryRecord={blob,filename,downloadId:null,warnings:recordingWarnings};
  try {
    const estimate=await navigator.storage.estimate();
    if(estimate.quota && estimate.quota-estimate.usage<blob.size)throw Error('Insufficient browser storage for recovery copy');
    await vault('put',recoveryRecord);
  }catch(error){
    recordingWarnings.push(`Recovery copy unavailable: ${error.message}`);
    detail.textContent=`Recovery storage unavailable: ${error.message}. Keep this page open until saved.`;
  }
  downloadBtn.onclick=saveFinalized;
  await saveFinalized();

  if (activeAutomationRecordingId) {
    const finishedRecordingId = activeAutomationRecordingId;
    activeAutomationRecordingId = null;

    recorderBridge.notifyRecordingStopped({
      recordingId: finishedRecordingId
    }).catch((error) => {
      console.warn("Could not report automation stop:", error);
    });
  }

  chunks = [];
}

function stopRecording() {
  if (mediaRecorder?.state === 'paused') mediaRecorder.resume();
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

const recorderBridge = createRecorderBridge({
  chromeApi: chrome,
  async onCaptureApprovalRequired(request) {
    if(!initializationComplete)throw Error('Recorder not ready');
    if(saveSession.protected)throw Error('Recorder busy or unsaved recording protected');
    if(armedStream && armedScheduleId!==request.scheduleId)throw Error('Capture is armed for a different schedule');
    if(armedStream && armedTargetUrl!==(request.targetUrl || ''))throw Error('Schedule target changed after arming; authorize it again');
    if(pendingAutomationRequest && pendingAutomationRequest.occurrenceKey!==request.occurrenceKey)throw Error('A different scheduled capture is awaiting approval');
    pendingAutomationRequest = request;
    if(request.captureMode==='tab'){await startRecording();return;}
    if(armedStream && armedScheduleId===request.scheduleId && armedStream.getTracks().every(t=>t.readyState==='live')){
      await startRecording();return;
    }
    showMode("live");
    detail.textContent =
      "Scheduled recording ready — click Start Recording and approve capture.";

    if (!startBtn.disabled) startBtn.focus();
  },
  stopRecording() {
    stopRecording();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(sender.id!==chrome.runtime.id)return false;
  if(message.type==='TAB_CAPTURE_REVOKED' && message.targetTabId===authorizedTargetId){
    recordingWarnings.push(message.reason);
    detail.textContent=message.reason;stopRecording();return false;
  }
  if(message.recorderTabId==null)return false;
  chrome.tabs.getCurrent().then(tab=>{
    if(tab?.id!==message.recorderTabId)return;
  recorderBridge.handleCommand(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error.message });
    });
  });

  return true;
});

startBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);
$('armBtn').addEventListener('click',()=>armCapture().catch(error=>{detail.textContent=error.message;}));
$('disarmBtn').addEventListener('click',()=>{
  if(saveSession.protected){detail.textContent='Stop and save the active recording before disarming';return;}
  armedStream?.getTracks().forEach(t=>t.stop());armedStream=null;armedScheduleId=null;preview.srcObject=null;
  detail.textContent='Disarmed';
});
$('pauseBtn').addEventListener('click',()=>{
  if(mediaRecorder?.state==='recording'){mediaRecorder.pause();$('pauseBtn').textContent='Resume';statusPill.textContent='paused';}
  else if(mediaRecorder?.state==='paused'){mediaRecorder.resume();$('pauseBtn').textContent='Pause';statusPill.textContent='recording';}
});
document.addEventListener('keydown',event=>{if(event.altKey && event.shiftKey && event.code==='KeyS')stopRecording();});
window.addEventListener('beforeunload',event=>{if(saveSession.protected || armedStream){event.preventDefault();event.returnValue='';}});

setRecordingUI(false);
showMode("live");
detail.textContent = "—";
startBtn.disabled=true;
// Hold a browser-wide lock for this recorder document: a second tab cannot record.
if(!navigator.locks){detail.textContent='Recorder requires Web Locks support';}
else navigator.locks.request('screen-recorder-owner',{ifAvailable:true},async lock=>{
  if(!lock){detail.textContent='Another recorder tab owns this session. Close this tab.';return;}
  try {
    recoveryRecord=await vault('get');
    const reconciliation=await chrome.runtime.sendMessage({type:'RECORDER_DOCUMENT_READY'});
    if(reconciliation?.ok!==true)throw Error('Could not reconcile recorder state after loading');
    if(recoveryRecord?.blob?.size){
      recordingWarnings=recoveryRecord.warnings || [];
      saveFile=createVerifiedSaver(chrome.downloads,{onDownload:persistDownloadId,initialId:recoveryRecord.downloadId});
      saveSession.begin();saveSession.finalize(recoveryRecord.blob,recoveryRecord.filename);
      playbackURL=URL.createObjectURL(recoveryRecord.blob);showMode('playback');playbackVideo.src=playbackURL;
      downloadBtn.onclick=saveFinalized;downloadBtn.textContent='Recover / retry save';
      detail.textContent='Recovered finalized recording. Verify or retry its save before starting another.';
    }else startBtn.disabled=false;
    initializationComplete=true;
  }catch(error){detail.textContent=`Recovery check failed; recording disabled: ${error.message}`;}
  await new Promise(()=>{});
});
