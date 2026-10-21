// Synthetic browser acceptance of the startup adapter and MediaRecorder.
// Not a Teams, Chrome authorization, scheduler, or download-manager test.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const ffprobe=(await import('ffprobe-static')).default;
const ffmpeg=process.env.FFMPEG_PATH || 'ffmpeg';
const artifactDir=path.resolve('.test-artifacts','silent-start-'+Date.now());
await mkdir(artifactDir,{recursive:true});
const source=await readFile(new URL('../src/automation/tab_capture.js',import.meta.url),'utf8');
const moduleUrl='data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const page=await browser.newPage();
 await page.setContent('<button id="start">Run synthetic silent-start test</button>');
 await page.evaluate(moduleUrl=>{
  document.querySelector('#start').onclick=()=>{
   // Create/resume from a real click; do not disable autoplay security.
   const sourceContext=new AudioContext();
   const resumed=sourceContext.resume();
   window.validation=(async()=>{
    await resumed;
    const {acquireAuthorizedTab}=await import(moduleUrl);
    const destination=sourceContext.createMediaStreamDestination();
    const oscillator=sourceContext.createOscillator(),gain=sourceContext.createGain();
    gain.gain.value=0;
    oscillator.connect(gain).connect(destination);oscillator.start();
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const ctx=canvas.getContext('2d');
    let frame=0;
    const paint=setInterval(()=>{
     ctx.fillStyle=frame++%2?'#164e63':'#155e75';ctx.fillRect(0,0,320,180);
     ctx.fillStyle='white';ctx.fillText('Synthetic frame '+frame,20,40);
    },100);
    const video=canvas.captureStream(10);
    const stream=new MediaStream([...video.getVideoTracks(),...destination.stream.getAudioTracks()]);
    let capture;
    try{
     const warnings=[];
     capture=await acquireAuthorizedTab({streamId:'synthetic-not-a-chrome-grant',
      getUserMedia:async()=>stream,onSilence:message=>warnings.push(message)});
     const recorder=new MediaRecorder(capture.stream,{mimeType:'video/webm;codecs=vp8,opus'});
     const chunks=[];
     recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
     const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=reject;});
     recorder.start(100);
     const started=recorder.state;
     await new Promise(resolve=>setTimeout(resolve,1200));
     gain.gain.value=.25;
     await new Promise(resolve=>setTimeout(resolve,2200));
     recorder.stop();await stopped;
     const bytes=Array.from(new Uint8Array(await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer()));
     await capture.release();
     return {bytes,warnings,started,silentAtStart:capture.silentAtStart,peakDbfs:capture.peakDbfs,
      tracksEnded:stream.getTracks().every(track=>track.readyState==='ended')};
    }finally{
     clearInterval(paint);stream.getTracks().forEach(track=>track.stop());
     await capture?.release();oscillator.stop();await sourceContext.close();
    }
   })();
  };
 },moduleUrl);
 await page.locator('#start').click();
 const result=await page.evaluate(()=>window.validation);
 const {bytes,...evidence}=result;
 assert.equal(evidence.started,'recording');
 assert.equal(evidence.silentAtStart,true);
 assert.equal(evidence.peakDbfs,null);
 assert.equal(evidence.warnings.length,1);
 assert.equal(evidence.tracksEnded,true);
 const media=path.join(artifactDir,'silent-then-tone.webm');
 await writeFile(media,Buffer.from(bytes));
 const probe=JSON.parse(execFileSync(ffprobe.path,['-v','error','-show_streams','-of','json',media],{windowsHide:true,encoding:'utf8'}));
 assert.ok(probe.streams.some(stream=>stream.codec_type==='video'));
 assert.ok(probe.streams.some(stream=>stream.codec_type==='audio'));
 const pcm=execFileSync(ffmpeg,['-v','error','-i',media,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{windowsHide:true,maxBuffer:4*1024*1024});
 function rms(from,to){
  const end=Math.min(Math.floor(to*48000),pcm.length/4),start=Math.floor(from*48000);
  assert.ok(end>start);let sum=0;
  for(let n=start;n<end;n++)sum+=pcm.readFloatLE(n*4)**2;
  return Math.sqrt(sum/(end-start));
 }
 evidence.initialRms=rms(.1,.7);
 evidence.laterRms=rms(1.8,2.8);
 assert.ok(evidence.initialRms<.0001,'initial encoded audio must be silent');
 assert.ok(evidence.laterRms>.05,'later tone must survive encoding and decoding');
 evidence.bytes=bytes.length;
 evidence.scope='Synthetic browser audio/video; not real Teams or Chrome tab authorization';
 await writeFile(path.join(artifactDir,'result.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({pass:true,artifactDir,...evidence},null,2));
}finally{await browser.close();}
