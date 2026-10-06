import { remuxMp4Faststart, ensureFFmpeg } from "./ffmpeg_fix.js";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function setRecordingUI(on) {
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
  const mp4 = 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"';
  if (MediaRecorder.isTypeSupported(mp4)) return mp4;

  const webm1 = "video/webm;codecs=vp9,opus";
  const webm2 = "video/webm;codecs=vp8,opus";
  if (MediaRecorder.isTypeSupported(webm1)) return webm1;
  if (MediaRecorder.isTypeSupported(webm2)) return webm2;
  return "video/webm";
}

async function startRecording() {
  try {
    showMode("live");
    detail.textContent = "Opening chooser…";

    // show chooser immediately
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false }
    });

    mimeType = pickMimePreferMp4();
    fileExt = mimeType.includes("mp4") ? "mp4" : "webm";

    const track = stream.getVideoTracks()[0];

    detail.textContent = "Stabilizing…";
    await sleep(1000);
    await waitForStableDims(track);

    track?.addEventListener("ended", () => {
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    });

    preview.srcObject = stream;
    chunks = [];

    mediaRecorder = new MediaRecorder(stream, { mimeType });

    const actual = mediaRecorder.mimeType || mimeType;
    fileExt = actual.includes("mp4") ? "mp4" : "webm";
    formatLabel.textContent = actual;
    metaRight.textContent = actual;

    detail.textContent = "Recording…";
    mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mediaRecorder.onstop = handleStop;
    mediaRecorder.start();

    startedAt = Date.now();
    clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      timerEl.textContent = fmtTime(Date.now() - startedAt);
    }, 200);

    setRecordingUI(true);
  } catch (err) {
    console.error(err);
    alert("Could not start screen capture.\n" + err.message);
    setRecordingUI(false);
    detail.textContent = "—";
    showMode("live");
  }
}

async function handleStop() {
  clearInterval(timerHandle);

  const stream = preview.srcObject;
  stream?.getTracks().forEach((t) => t.stop());
  preview.srcObject = null;

  if (!chunks.length) {
    alert("❌ Nothing was captured.");
    setRecordingUI(false);
    detail.textContent = "—";
    showMode("live");
    return;
  }

  setRecordingUI(false);

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
      detail.textContent = "Fix failed (using original)";
      blob = new Blob(chunks, { type: originalMime });
      mimeType = originalMime;
      fileExt = originalMime.includes("mp4") ? "mp4" : "webm";
    }
  } else {
    detail.textContent = "Ready ✅";
  }

  const blobURL = URL.createObjectURL(blob);

  showMode("playback");
  playbackVideo.src = blobURL;

  const mb = (blob.size / (1024 * 1024)).toFixed(2);
  meta.textContent = `${mimeType} · ${mb} MB (was ${originalMB} MB)`;
  metaRight.textContent = `${mb} MB`;

  downloadBtn.disabled = false;
  downloadBtn.onclick = () => {
    const filename = `screen_recording_${Date.now()}.${fileExt}`;
    chrome.downloads.download({ url: blobURL, filename, saveAs: true });
    setTimeout(() => URL.revokeObjectURL(blobURL), 1500);
  };

  chunks = [];
}

function stopRecording() {
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

startBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);

setRecordingUI(false);
showMode("live");
detail.textContent = "—";
