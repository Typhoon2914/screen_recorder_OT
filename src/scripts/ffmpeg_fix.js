import { buildFaststartRemuxArgs } from "./ffmpeg_args.js";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

let ffmpegInstance = null;
let ffmpegLoadPromise = null;

async function mustFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res;
}

export async function ensureFFmpeg(onLog) {
  if (ffmpegInstance) return ffmpegInstance;

  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      const ff = new FFmpeg();

      if (onLog) {
        ff.on("log", ({ message }) => onLog(message));
        ff.on("progress", ({ progress }) =>
          onLog(`progress:${Math.round(progress * 100)}%`)
        );
      }

      const coreURL = chrome.runtime.getURL("ffmpeg/ffmpeg-core.js");
      const wasmURL = chrome.runtime.getURL("ffmpeg/ffmpeg-core.wasm");

      // ✅ prove these are reachable
      await mustFetch(coreURL);
      await mustFetch(wasmURL);

      // ✅ surface real import/init errors
      try {
        await import(coreURL);
      } catch (e) {
        console.error("Direct import(coreURL) failed:", e);
        throw e;
      }

      try {
        await ff.load({ coreURL, wasmURL });
      } catch (e) {
        console.error("ff.load() failed:", e);
        throw e;
      }

      ffmpegInstance = ff;
      return ff;
    })();
  }

  try {return await ffmpegLoadPromise;}
  catch(error){ffmpegLoadPromise=null;throw error;}
}

export async function remuxMp4Faststart(inputBlob, onLog) {
  const ff = await ensureFFmpeg(onLog);
  return runRemux(ff,await fetchFile(inputBlob));
}

export async function runRemux(ff,bytes) {
  try {
    await ff.writeFile('in.mp4',bytes);
    const code=await ff.exec(buildFaststartRemuxArgs('in.mp4','out.mp4'));
    if(code!==0)throw Error(`FFmpeg exited with code ${code}`);
    const data=await ff.readFile('out.mp4');
    if(!data.length)throw Error('FFmpeg produced an empty file');
    return new Blob([data],{type:'video/mp4'});
  }finally{
    try{await ff.deleteFile('in.mp4');}catch{}
    try{await ff.deleteFile('out.mp4');}catch{}
  }
}
