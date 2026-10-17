// Validate a real saved Teams test file without synthetic-motion assumptions.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import ffprobe from 'ffprobe-static';
const out=path.resolve(process.argv[2]);
const result=JSON.parse(await fs.readFile(path.join(out,'result.json'),'utf8'));
assert.equal(result.download?.state,'complete');assert.equal(result.download?.exists,true);
const file=path.join(out,'teams-autojoin'+path.extname(result.download.filename));
await fs.copyFile(result.download.filename,file);
const report={at:new Date().toISOString(),file,bytes:(await fs.stat(file)).size,errors:[]};
assert.ok(report.bytes>0);
const probe=spawnSync(ffprobe.path,['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:10*1024*1024});
await fs.writeFile(path.join(out,'ffprobe.json'),probe.stdout || '{}');
await fs.writeFile(path.join(out,'ffprobe-errors.txt'),probe.stderr || '');
assert.equal(probe.status,0);assert.equal(probe.stderr,'');
const media=JSON.parse(probe.stdout);report.duration=Number(media.format.duration);
report.streams=media.streams.map(s=>({type:s.codec_type,codec:s.codec_name,width:s.width,height:s.height,frames:Number(s.nb_read_frames)}));
assert.ok(report.streams.some(s=>s.type==='video' && s.frames>1));
assert.ok(report.streams.some(s=>s.type==='audio' && s.frames>1));
assert.ok(report.duration>=55 && report.duration<=70,'One-minute test duration');
const signal=spawnSync(ffprobe.path,['-v','error','-f','lavfi','-i','amovie='+path.basename(file)+',astats=metadata=1:reset=1','-show_entries','frame_tags=lavfi.astats.Overall.RMS_level','-of','json'],{cwd:out,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:10*1024*1024});
assert.equal(signal.status,0);assert.equal(signal.stderr,'');
await fs.writeFile(path.join(out,'audio-levels.json'),signal.stdout);
const samples=JSON.parse(signal.stdout).frames.map(f=>Number(f.tags?.['lavfi.astats.Overall.RMS_level']));
report.audio={frames:samples.length,peakRmsDbfs:Math.max(...samples),framesAboveMinus60Dbfs:samples.filter(x=>x>-60).length};
assert.ok(report.audio.framesAboveMinus60Dbfs>0,'Decoded recording contains audible samples');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const p=await browser.newPage();await p.route('https://teams-playback.invalid/**',r=>r.fulfill({contentType:'text/html',body:'<title>Saved Teams recording validation</title><video controls muted></video>'}));await p.goto('https://teams-playback.invalid/');
 await p.evaluate(({data,type})=>{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));document.querySelector('video').src=URL.createObjectURL(new Blob([bytes],{type}));},{data:(await fs.readFile(file)).toString('base64'),type:file.endsWith('.mp4')?'video/mp4':'video/webm'});
 report.playback=await p.evaluate(async()=>{const v=document.querySelector('video');await v.play();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Seek timeout')),10000);v.addEventListener('seeked',()=>{clearTimeout(timer);resolve();},{once:true});v.currentTime=v.duration/2;});v.pause();return {duration:v.duration,time:v.currentTime,width:v.videoWidth,height:v.videoHeight,error:v.error?.message || null};});
 assert.equal(report.playback.error,null);assert.ok(report.playback.width>0 && report.playback.time>25);
}finally{await browser.close();}
report.passed=true;await fs.writeFile(path.join(out,'media-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
