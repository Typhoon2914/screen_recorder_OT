/* ------------------------------------------------------------------ */
/*  Screen-Recorder (Extension) – mimic old backend + preview/playback */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

/* ───── DOM -------------------------------------------------------- */
const startBtn = $("startBtn");
const stopBtn = $("stopBtn");

const statusPill = $("statusPill");
const timerEl = $("timer");

const formatLabel = $("formatLabel");
const meta = $("meta");
const metaRight = $("metaRight");

const videoTitle = $("videoTitle");
const preview = $("preview");

const playbackPane = $("playbackPane");
const playbackVideo = $("playbackVideo");
const downloadBtn = $("downloadBtn");

/* ───── State ------------------------------------------------------ */
let mediaRecorder = null;
let chunks = [];
let mimeType = "";
let fileExt = "";
let startedAt = 0;
let timerHandle = null;

/* UI helper (similar spirit to your old one) */
function setRecordingUI(on) {
  startBtn.disabled = on;
  stopBtn.disabled = !on;

  startBtn.classList.toggle("recording", on);
  stopBtn.classList.toggle("inactive", !on);

  startBtn.textContent = on ? "⏺ Recording…" : "🎬 Start Recording";
  statusPill.textContent = on ? "Recording" : "Idle";

  if (!on) timerEl.textContent = "00:00";
}

function showMode(mode) {
  // mode: "live" | "playback"
  if (mode === "live") {
    videoTitle.textContent = "Live Preview";
    preview.classList.remove("hidden");
    playbackPane.classList.add("hidden");

    // clear playback src (keeps memory down)
    playbackVideo.removeAttribute("src");
    playbackVideo.load();

    metaRight.textContent = "";
  } else {
    videoTitle.textContent = "Playback";
    preview.classList.add("hidden");
    playbackPane.classList.remove("hidden");
  }
}

/* ───── Wait until track size is stable (same as your old) ---------- */
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
    onResize(); // arm the first timer
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/* ───── Recording start -------------------------------------------- */
async function startRecording() {
  try {
    // Switch to live view immediately
    showMode("live");

    /* choose MIME (same logic as your old program) */
    const mp4 = 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"';
    if (MediaRecorder.isTypeSupported(mp4)) {
      mimeType = mp4;
      fileExt = "mp4";
    } else {
      const webm = "video/webm;codecs=vp9,opus";
      mimeType = MediaRecorder.isTypeSupported(webm)
        ? webm
        : "video/webm;codecs=vp8,opus";
      fileExt = "webm";
    }

    /* capture (no UI options; browser dialog handles it) */
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    const track = stream.getVideoTracks()[0];

    /* ✅ 1s delay so the “sharing” bar settles */
    await sleep(1000);

    /* wait until banner settles (your method) */
    await waitForStableDims(track);

    /* stop if user ends sharing from browser UI */
    track?.addEventListener("ended", () => {
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    });

    /* start recorder ************************************************ */
    preview.srcObject = stream;
    chunks = [];

    // Mimic old: DO NOT force bitrate (keeps sizes small like your old app)
    mediaRecorder = new MediaRecorder(stream, { mimeType });

    // Use actual recorder mime if it differs; base extension on actual
    const actual = mediaRecorder.mimeType || mimeType;
    fileExt = actual.includes("mp4") ? "mp4" : "webm";

    formatLabel.textContent = actual;
    metaRight.textContent = actual;

    mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mediaRecorder.onstop = handleStop;
    mediaRecorder.start(); // mimic old behavior (no timeslice)

    startedAt = Date.now();
    clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      timerEl.textContent = fmtTime(Date.now() - startedAt);
    }, 200);

    setRecordingUI(true);
  } catch (err) {
    console.error("❌ startRecording failed:", err);
    alert("Could not start screen capture.\n" + err.message);
    setRecordingUI(false);
    showMode("live");
  }
}

/* ───── Recording stop / processing -------------------------------- */
async function handleStop() {
  clearInterval(timerHandle);

  // Stop tracks + clear preview
  const stream = preview.srcObject;
  stream?.getTracks().forEach((t) => t.stop());
  preview.srcObject = null;

  if (!chunks.length) {
    alert("❌ Nothing was captured.");
    setRecordingUI(false);
    showMode("live");
    return;
  }

  const blob = new Blob(chunks, { type: mimeType });
  const blobURL = URL.createObjectURL(blob);

  // Switch to playback
  showMode("playback");
  playbackVideo.src = blobURL;

  const mb = (blob.size / (1024 * 1024)).toFixed(2);
  meta.textContent = `${mimeType} · ${mb} MB`;
  metaRight.textContent = `${mb} MB`;

  downloadBtn.onclick = () => {
    try {
      const filename = `screen_recording_${Date.now()}.${fileExt}`;
      chrome.downloads.download({ url: blobURL, filename, saveAs: true });
    } catch {
      const a = document.createElement("a");
      a.href = blobURL;
      a.download = `screen_recording.${fileExt}`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(blobURL), 1500);
  };

  setRecordingUI(false);
  chunks = [];
}

function stopRecording() {
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

/* ───── Wire-up ---------------------------------------------------- */
startBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);

// initial state
setRecordingUI(false);
showMode("live");