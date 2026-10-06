import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

test("baseline: extension manifest preserves the current MV3 contract", () => {
  const manifest = readJson("src/public/manifest.json");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Screen Recorder");
  assert.equal(manifest.action.default_title, "Screen Recorder");
  assert.equal(manifest.action.default_popup, undefined);

  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["downloads", "tabs"].sort()
  );

  assert.deepEqual(manifest.background, {
    service_worker: "service_worker.js",
    type: "module"
  });

  const resources = manifest.web_accessible_resources[0].resources;
  assert.ok(resources.includes("ffmpeg/ffmpeg-core.js"));
  assert.ok(resources.includes("ffmpeg/ffmpeg-core.wasm"));

  assert.match(
    manifest.content_security_policy.extension_pages,
    /wasm-unsafe-eval/
  );
});

test("baseline: clicking the extension action opens or focuses one recorder tab", () => {
  const source = read("src/public/service_worker.js");

  assert.match(source, /chrome\.runtime\.getURL\("pages\/recorder\.html"\)/);
  assert.match(source, /chrome\.tabs\.query\(\{\}\)/);
  assert.match(source, /tabs\.find\(t => t\.url === RECORDER_URL\)/);
  assert.match(source, /chrome\.tabs\.update\(existing\.id, \{ active: true \}\)/);
  assert.match(source, /chrome\.windows\.update\(existing\.windowId, \{ focused: true \}\)/);
  assert.match(source, /chrome\.tabs\.create\(\{ url: RECORDER_URL \}\)/);
  assert.match(source, /chrome\.action\.onClicked\.addListener/);
});

test("baseline: recorder page exposes the controls used by the working UI", () => {
  const html = read("src/pages/recorder.html");

  for (const id of [
    "startBtn",
    "stopBtn",
    "statusPill",
    "timer",
    "formatLabel",
    "meta",
    "detail",
    "preview",
    "playbackPane",
    "playbackVideo",
    "downloadBtn"
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  assert.match(html, /href=["']\.\.\/styles\/recorder\.css["']/);
  assert.match(html, /src=["']\.\.\/scripts\/recorder\.js["']/);
});

test("baseline: recording starts through getDisplayMedia with video and capture audio", () => {
  const source = read("src/scripts/recorder.js");

  assert.match(source, /navigator\.mediaDevices\.getDisplayMedia\(/);
  assert.match(source, /video:\s*true/);
  assert.match(source, /audio:\s*\{\s*echoCancellation:\s*false,\s*noiseSuppression:\s*false\s*\}/s);
  assert.match(source, /new MediaRecorder\(stream, \{ mimeType \}\)/);
  assert.match(source, /mediaRecorder\.start\(\)/);
});

test("baseline: recorder keeps the current MIME preference order", () => {
  const source = read("src/scripts/recorder.js");

  const mp4 = source.indexOf('video/mp4;codecs="avc1.42E01E,mp4a.40.2"');
  const vp9 = source.indexOf("video/webm;codecs=vp9,opus");
  const vp8 = source.indexOf("video/webm;codecs=vp8,opus");
  const genericWebm = source.indexOf('return "video/webm"');

  assert.ok(mp4 >= 0);
  assert.ok(vp9 > mp4);
  assert.ok(vp8 > vp9);
  assert.ok(genericWebm > vp8);
});

test("baseline: recording waits for capture dimensions to settle before MediaRecorder starts", () => {
  const source = read("src/scripts/recorder.js");

  const delay = source.indexOf("await sleep(1000)");
  const stable = source.indexOf("await waitForStableDims(track)");
  const recorder = source.indexOf("new MediaRecorder(stream, { mimeType })");

  assert.ok(delay >= 0);
  assert.ok(stable > delay);
  assert.ok(recorder > stable);
});

test("baseline: ending browser sharing stops an active recording", () => {
  const source = read("src/scripts/recorder.js");

  assert.match(
    source,
    /track\?\.addEventListener\("ended",[\s\S]*mediaRecorder\?\.state === "recording"[\s\S]*mediaRecorder\.stop\(\)/
  );
});

test("baseline: MediaRecorder chunks are collected and processed on stop", () => {
  const source = read("src/scripts/recorder.js");

  assert.match(source, /mediaRecorder\.ondataavailable\s*=\s*\(e\)\s*=>\s*e\.data\.size\s*&&\s*chunks\.push\(e\.data\)/);
  assert.match(source, /mediaRecorder\.onstop\s*=\s*handleStop/);
  assert.match(source, /new Blob\(chunks, \{ type: mimeType \}\)/);
  assert.match(source, /stream\?\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
});

test("baseline: MP4 output is remuxed and falls back to the original on failure", () => {
  const source = read("src/scripts/recorder.js");

  assert.match(source, /ensureFFmpeg\(/);
  assert.match(source, /remuxMp4Faststart\(blob/);
  assert.match(source, /console\.warn\("ffmpeg fix failed, using original:"/);
  assert.match(source, /blob = new Blob\(chunks, \{ type: originalMime \}\)/);
});

test("baseline: completed recording switches to playback and downloads with Save As", () => {
  const source = read("src/scripts/recorder.js");

  assert.match(source, /URL\.createObjectURL\(blob\)/);
  assert.match(source, /showMode\("playback"\)/);
  assert.match(source, /playbackVideo\.src = blobURL/);
  assert.match(source, /chrome\.downloads\.download\(\{ url: blobURL, filename, saveAs: true \}\)/);
  assert.match(source, /screen_recording_\$\{Date\.now\(\)\}/);
});

test("baseline: stopping through the UI only stops when MediaRecorder is recording", () => {
  const source = read("src/scripts/recorder.js");

  assert.match(
    source,
    /function stopRecording\(\)[\s\S]*mediaRecorder\?\.state === "recording"[\s\S]*mediaRecorder\.stop\(\)/
  );
  assert.match(source, /stopBtn\.addEventListener\("click", stopRecording\)/);
});
