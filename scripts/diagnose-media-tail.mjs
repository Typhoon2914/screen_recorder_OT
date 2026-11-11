// Investigate audio/video end timestamps in an existing MP4 without modifying it.
// Usage: node scripts/diagnose-media-tail.mjs path/to/recording.mp4
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import ffprobe from "ffprobe-static";

const [filename] = process.argv.slice(2);
if (!filename) throw new Error("Usage: node scripts/diagnose-media-tail.mjs <recording.mp4>");
assert.ok(fs.existsSync(filename), "Recording does not exist");

function probe(args) {
  const p = spawnSync(ffprobe.path, ["-v", "error", ...args, "-of", "json", filename], {
    encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 128 * 1024 * 1024
  });
  if (p.status !== 0) throw new Error(p.stderr || p.error?.message || "ffprobe failed");
  return JSON.parse(p.stdout);
}

const info = probe(["-show_format", "-show_streams"]);
const frames = probe(["-show_frames", "-show_entries", "frame=media_type,stream_index,best_effort_timestamp_time,pkt_duration_time,duration_time"]).frames || [];

const streamReport = info.streams
  .filter(stream => stream.codec_type === "video" || stream.codec_type === "audio")
  .map(stream => {
    const relevant = frames.filter(frame => frame.stream_index === stream.index);
    const last = relevant.slice(-8).map(frame => ({
      timestamp: Number(frame.best_effort_timestamp_time),
      duration: frame.pkt_duration_time == null ? null : Number(frame.pkt_duration_time),
      frameDuration: frame.duration_time == null ? null : Number(frame.duration_time)
    }));
    const final = last.at(-1);
    const positiveDurations = last.map(x => x.duration ?? x.frameDuration).filter(x => Number.isFinite(x) && x > 0);
    return {
      type: stream.codec_type, codec: stream.codec_name, frameCount: relevant.length,
      streamStart: Number(stream.start_time), streamDuration: Number(stream.duration),
      nominalEnd: Number(stream.start_time) + Number(stream.duration),
      lastFrameTimestamp: final?.timestamp ?? null,
      lastFrameDuration: final?.duration ?? final?.frameDuration ?? null,
      lastFrames: last,
      lastFrameDurationKnown: positiveDurations.length > 0
    };
  });

const video = streamReport.find(s => s.type === "video");
const audio = streamReport.find(s => s.type === "audio");
console.log(JSON.stringify({
  file: filename,
  containerDuration: Number(info.format.duration),
  audioVideoNominalEndpointDifferenceSeconds: audio && video ? audio.nominalEnd - video.nominalEnd : null,
  streams: streamReport,
  interpretation: "Stream durations and last-frame timestamps are metadata, not a perceptual lip-sync test. Sparse or variable-frame-rate video can have a last-frame timestamp earlier than the audio tail. Examine final frame durations and playback before changing capture or remux logic."
}, null, 2));
