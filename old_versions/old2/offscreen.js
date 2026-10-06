// offscreen.js – Uses VideoEncoder + mp4-muxer for perfect MP4
// Waits for first frame to get actual dimensions
// Bitrate reduced to 1 Mbps

if (typeof window.Mp4Muxer === 'undefined' || !window.Mp4Muxer.Muxer) {
  console.error('[offscreen] Mp4Muxer library not loaded!');
  throw new Error('Mp4Muxer library failed to load');
}
const Muxer = window.Mp4Muxer.Muxer;
const ArrayBufferTarget = window.Mp4Muxer.ArrayBufferTarget;
console.log('[offscreen] Muxer library loaded successfully');

let mediaStream = null;
let videoEncoder = null;
let audioEncoder = null;
let muxer = null;
let isRecording = false;

let muxerReady = false;
let firstVideoChunk = true;
let frameLogCounter = 0;

// Listen for messages from background
chrome.runtime.onMessage.addListener((message) => {
  console.log('[offscreen] received:', message);
  if (message.target !== 'offscreen') return;

  if (message.type === 'START_RECORDING') {
    if (isRecording) return;
    startRecording();
  } else if (message.type === 'STOP_RECORDING') {
    stopRecording();
  }
});

async function startRecording() {
  if (isRecording) return;
  isRecording = true;
  firstVideoChunk = true;
  frameLogCounter = 0;

  try {
    console.log('[offscreen] starting recording...');
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
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

    const videoTrack = mediaStream.getVideoTracks()[0];
    const audioTrack = mediaStream.getAudioTracks()[0];

    videoTrack.onended = () => {
      console.log('[offscreen] sharing stopped by user');
      stopRecording();
    };

    // Start capturing frames but pause after first frame to get dimensions
    const trackProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
    const videoReader = trackProcessor.readable.getReader();

    // Read the first frame to determine actual dimensions
    const firstFrameResult = await videoReader.read();
    if (firstFrameResult.done) {
      throw new Error('No video frames received');
    }
    const firstFrame = firstFrameResult.value;
    const width = firstFrame.codedWidth;
    const height = firstFrame.codedHeight;
    const frameRate = videoTrack.getSettings().frameRate || 30;

    console.log(`[offscreen] First frame dimensions: ${width}x${height}`);
    chrome.runtime.sendMessage({
      type: 'ACTUAL_FRAME_DIMENSIONS',
      width,
      height,
      frameRate
    });

    // Initialize mp4-muxer with actual frame dimensions
    console.log('[offscreen] Creating ArrayBufferTarget');
    const target = new ArrayBufferTarget();
    console.log(`[offscreen] Creating Muxer with dimensions: ${width}x${height}`);
    muxer = new Muxer({
      target: target,
      video: {
        codec: 'avc',
        width,
        height,
        frameRate
      },
      audio: audioTrack ? {
        codec: 'aac',
        sampleRate: 48000,
        numberOfChannels: 2
      } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    });
    console.log('[offscreen] Muxer created');

    // Set up video encoder with lower bitrate (1 Mbps)
    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (firstVideoChunk) {
          // Ensure decoderConfig and colorSpace exist
          if (!meta?.decoderConfig) {
            meta = {
              decoderConfig: {
                codec: 'avc1.64002a',
                description: null,
                colorSpace: {
                  primaries: 'bt709',
                  transfer: 'bt709',
                  matrix: 'bt709',
                  fullRange: false
                }
              }
            };
          } else if (!meta.decoderConfig.colorSpace) {
            meta.decoderConfig.colorSpace = {
              primaries: 'bt709',
              transfer: 'bt709',
              matrix: 'bt709',
              fullRange: false
            };
          }
          muxer.addVideoChunk(chunk, meta);
          firstVideoChunk = false;
        } else if (muxerReady) {
          muxer.addVideoChunk(chunk, meta);
        }
      },
      error: (e) => {
        console.error('[offscreen] VideoEncoder error:', e);
        chrome.runtime.sendMessage({ type: 'PROCESSING_ERROR', error: e.message });
      }
    });

    const videoConfig = {
      codec: 'avc1.64002a', // Level 5.1
      width,
      height,
      bitrate: 1_000_000,   // 1 Mbps (reduced from 2.5 Mbps)
      framerate: frameRate
    };
    console.log('[offscreen] Configuring video encoder with:', videoConfig);
    await videoEncoder.configure(videoConfig);

    // Audio encoder setup...
    if (audioTrack) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          if (muxerReady) {
            muxer.addAudioChunk(chunk, meta);
          }
        },
        error: (e) => {
          console.error('[offscreen] AudioEncoder error:', e);
          chrome.runtime.sendMessage({ type: 'PROCESSING_ERROR', error: e.message });
        }
      });

      await audioEncoder.configure({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000
      });
    }

    muxerReady = true;

    // Encode the first frame (which we already have)
    videoEncoder.encode(firstFrame);
    firstFrame.close();

    // Continue reading and encoding remaining frames
    const readVideoFrames = async () => {
      while (isRecording) {
        const { value: videoFrame, done } = await videoReader.read();
        if (done) break;
        if (!isRecording) {
          videoFrame.close();
          break;
        }

        // Log first few frames dimensions for verification (optional)
        if (frameLogCounter < 5) {
          console.log(`[offscreen] Frame #${frameLogCounter+1} dimensions: ${videoFrame.codedWidth}x${videoFrame.codedHeight}`);
          frameLogCounter++;
        }

        videoEncoder.encode(videoFrame);
        videoFrame.close();
      }
    };
    readVideoFrames();

    // Audio capture...
    if (audioTrack) {
      const audioProcessor = new MediaStreamTrackProcessor({ track: audioTrack });
      const audioReader = audioProcessor.readable.getReader();

      const readAudioFrames = async () => {
        while (isRecording) {
          const { value: audioData, done } = await audioReader.read();
          if (done) break;
          if (!isRecording) {
            audioData.close();
            break;
          }
          audioEncoder.encode(audioData);
          audioData.close();
        }
      };
      readAudioFrames();
    }

    console.log('[offscreen] Recording started successfully');
  } catch (err) {
    console.error('[offscreen] startRecording error:', err);
    isRecording = false;
    chrome.runtime.sendMessage({ type: 'PROCESSING_ERROR', error: err.message });
  }
}

async function stopRecording() {
  console.log('[offscreen] stopRecording called');
  if (!isRecording) return;
  isRecording = false;

  try {
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }

    if (videoEncoder) {
      await videoEncoder.flush();
      videoEncoder.close();
    }
    if (audioEncoder) {
      await audioEncoder.flush();
      audioEncoder.close();
    }

    muxerReady = false;
    console.log('[offscreen] Finalizing muxer');
    muxer.finalize();
    const buffer = muxer.target.buffer;
    console.log('[offscreen] Muxer finalized, buffer size:', buffer?.byteLength);

    const blob = new Blob([buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `recording-${timestamp}.mp4`;

    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_RECORDING',
      url,
      filename
    });

    console.log('[offscreen] download request sent to background');
    chrome.runtime.sendMessage({ type: 'PROCESSING_DONE', filename });
  } catch (err) {
    console.error('[offscreen] stopRecording error:', err);
    chrome.runtime.sendMessage({ type: 'PROCESSING_ERROR', error: err.message });
  }
}