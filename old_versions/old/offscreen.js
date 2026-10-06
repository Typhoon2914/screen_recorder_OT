// offscreen.js – Does the actual recording and processing
import * as MP4Box from './mp4box.all.min.js';

let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let isRecording = false;

// Choose best MIME type
let mimeType = 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"';
let fileExt = 'mp4';
if (!MediaRecorder.isTypeSupported(mimeType)) {
  mimeType = 'video/webm;codecs=vp9,opus';
  fileExt = 'webm';
  console.log('[offscreen] using WebM fallback');
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message) => {
  console.log('[offscreen] received:', message);
  if (message.target !== 'offscreen') return;

  if (message.type === 'START_RECORDING') {
    if (isRecording) {
      console.log('[offscreen] recording already in progress, ignoring duplicate start');
      return;
    }
    startRecording();
  } else if (message.type === 'STOP_RECORDING') {
    stopRecording();
  }
});

async function startRecording() {
  if (isRecording) return; // extra safety
  isRecording = true;

  try {
    console.log('[offscreen] starting recording...');
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: {
        displaySurface: 'browser',
        frameRate: 30
      }
    });

    const videoTrack = stream.getVideoTracks()[0];
    videoTrack.onended = () => {
      console.log('[offscreen] sharing stopped by user');
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    };

    // Wait 1 second for banner to settle
    await new Promise(resolve => setTimeout(resolve, 1000));

    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      videoBitsPerSecond: 2500000
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      console.log('[offscreen] recording stopped, processing...');
      await processRecording();
      stopAllTracks();
      isRecording = false; // reset flag
    };

    mediaRecorder.start(1000);
    console.log('[offscreen] MediaRecorder started');
  } catch (err) {
    console.error('[offscreen] startRecording error:', err);
    isRecording = false; // reset on error (e.g., user cancelled)
    chrome.runtime.sendMessage({ type: 'PROCESSING_ERROR', error: err.message });
  }
}

function stopRecording() {
  console.log('[offscreen] stopRecording called, state=', mediaRecorder?.state);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    console.warn('[offscreen] no active recording to stop');
    isRecording = false;
  }
}

function stopAllTracks() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  isRecording = false;
}

async function processRecording() {
  if (recordedChunks.length === 0) {
    console.warn('[offscreen] no data recorded');
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: 'PROCESSING_START' });
    const originalBlob = new Blob(recordedChunks, { type: mimeType });
    let finalBlob = originalBlob;

    // Log which format we're using
    console.log(`[offscreen] final format will be: ${fileExt}`);

    if (fileExt === 'mp4') {
      console.log('[offscreen] remuxing with mp4box...');
      finalBlob = await remuxWithMP4Box(originalBlob);
      console.log('[offscreen] remuxing completed successfully');
    } else {
      console.log('[offscreen] using WebM, no remuxing needed');
    }

    const url = URL.createObjectURL(finalBlob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `recording-${timestamp}.${fileExt}`;

    // Notify popup about remux status (optional)
    chrome.runtime.sendMessage({ 
      type: 'REMUX_STATUS', 
      success: true, 
      format: fileExt 
    });

    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_RECORDING',
      url,
      filename
    });

    console.log('[offscreen] download request sent to background');
  } catch (err) {
    console.error('[offscreen] processing error:', err);
    chrome.runtime.sendMessage({ type: 'PROCESSING_ERROR', error: err.message });

    // Notify popup about remux failure
    chrome.runtime.sendMessage({ 
      type: 'REMUX_STATUS', 
      success: false, 
      error: err.message 
    });
  }
}

async function remuxWithMP4Box(blob) {
  return new Promise(async (resolve, reject) => {
    try {
      const arrayBuf = await blob.arrayBuffer();
      const mp4box = MP4Box.createFile(true); // keep data
      let fileProcessed = false;

      mp4box.onError = (e) => {
        console.error('[offscreen] MP4Box error:', e);
        reject(new Error(e));
      };

      mp4box.onReady = (info) => {
        if (fileProcessed) return;
        fileProcessed = true;
        try {
          // Create a DataStream and write the entire file into it
          const stream = new MP4Box.DataStream();
          stream.endianness = 1; // big endian
          mp4box.write(stream);
          // Extract the buffer (stream.position tells us how many bytes were written)
          const outputBuffer = stream.buffer.slice(0, stream.position);
          console.log('[offscreen] MP4Box onReady – remux successful');
          resolve(new Blob([outputBuffer], { type: 'video/mp4' }));
        } catch (genErr) {
          console.error('[offscreen] MP4Box generation error:', genErr);
          reject(genErr);
        }
      };

      arrayBuf.fileStart = 0;
      mp4box.appendBuffer(arrayBuf);
      mp4box.flush();
    } catch (err) {
      console.error('[offscreen] remuxWithMP4Box outer error:', err);
      reject(err);
    }
  });
}