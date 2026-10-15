// Read/decode an existing test recording; no capture or permission handling.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import ffprobe from 'ffprobe-static';
const file=path.resolve(process.argv[2]),name=path.basename(file),out=path.dirname(file);
assert.match(name,/^[a-zA-Z0-9_-]+\.(mp4|webm)$/,'Use a safe generated test basename');
try{await fs.appendFile(file+'.review-history.jsonl',(await fs.readFile(file+'.review.json','utf8'))+'\n');}catch(error){if(error.code!=='ENOENT')throw error;}
const report={file,at:new Date().toISOString(),samples:{},errors:[]};
for(const kind of ['audio','video']){
  const key=kind==='audio'?'lavfi.astats.Overall.RMS_level':'lavfi.signalstats.YDIF';
  const filter=kind==='audio'?'amovie='+name+',astats=metadata=1:reset=1':'movie='+name+',fps=2,signalstats';
  // Sequential decoding avoids the old bundled decoder's seek-point crash.
  const p=spawnSync(ffprobe.path,['-v','error','-f','lavfi','-i',filter,'-show_entries','frame_tags='+key,'-of','json'],{cwd:out,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:20*1024*1024});
  await fs.writeFile(file+'.'+kind+'-decode.json',p.stdout||'');
  if(p.status!==0 || p.stderr){report.errors.push({kind,exitCode:p.status,error:p.stderr||p.error?.message});continue;}
  const values=JSON.parse(p.stdout).frames.map(f=>Number(f.tags?.[key]));
  if(kind==='video')values.shift();
  report.samples[kind]={frames:values.length,finiteFrames:values.filter(Number.isFinite).length,min:Math.min(...values),max:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length};
}
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const browser=await chromium.launch({channel:'chromium',headless:true,chromiumSandbox:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  // Serve original saved bytes at one test origin, rather than weakening
  // file-URL canvas security. This is playback serving, not mocked capture.
  await page.route('https://saved-media.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Saved recording review</title><video style="width:100%" controls></video>'}));
  await page.goto('https://saved-media.invalid/review');
  // Blob media provides native range/seek behavior for the unchanged bytes.
  await page.evaluate(({data,type})=>{
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    document.querySelector('video').src=URL.createObjectURL(new Blob([bytes],{type}));
  },{data:(await fs.readFile(file)).toString('base64'),type:file.endsWith('.mp4')?'video/mp4':'video/webm'});
  await page.waitForSelector('video');
  report.playback=await page.evaluate(async()=>{
    const v=document.querySelector('video');v.muted=true;await v.play();
    const duration=v.duration,target=duration/2;
    await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Seek timed out')),10000);v.addEventListener('seeked',()=>{clearTimeout(t);resolve();},{once:true});v.currentTime=target;});
    v.pause();
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const g=canvas.getContext('2d',{willReadFrequently:true});g.drawImage(v,0,0,320,180);
    const first=g.getImageData(0,0,320,180).data;
    await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Second seek timed out')),10000);v.addEventListener('seeked',()=>{clearTimeout(t);resolve();},{once:true});v.currentTime=target+1.137;});
    g.drawImage(v,0,0,320,180);const second=g.getImageData(0,0,320,180).data;
    let difference=0;for(let i=0;i<first.length;i+=4)difference+=Math.abs(first[i]-second[i])+Math.abs(first[i+1]-second[i+1])+Math.abs(first[i+2]-second[i+2]);
    return {duration,time:v.currentTime,width:v.videoWidth,height:v.videoHeight,meanPixelDifference:difference/(320*180*3),error:v.error?.message||null};
  });
  assert.ok(report.playback.width>0 && report.playback.time>=report.playback.duration/2-.1 && report.playback.meanPixelDifference>.05);
  await page.screenshot({path:file+'.playback.png'});
}catch(error){report.errors.push({kind:'browser-playback',error:error.message});}
finally{await browser.close();}
report.passed=report.errors.length===0 && report.samples.audio?.mean>-60 && report.samples.video?.mean>.05;
await fs.writeFile(file+'.review.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
