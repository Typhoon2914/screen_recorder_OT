// Authored-extension integration harness. Synthetic streams replace ONLY the
// browser chooser boundary. This does not validate capture permission or Teams.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import ffprobe from 'ffprobe-static';

const out=path.resolve('.test-artifacts',new Date().toISOString().replace(/[:.]/g,'-'));
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
await fs.mkdir(out,{recursive:true});
const extension=path.resolve('dist');
const errors=[];const results=[];
function probeMedia(file){
  const result=spawnSync(ffprobe.path,['-v','error','-count_frames','-show_format','-show_streams','-of','json',file],{encoding:'utf8'});
  assert.equal(result.status,0);assert.equal(result.stderr,'');
  const probe=JSON.parse(result.stdout);
  for(const stream of probe.streams)assert.ok(Number(stream.nb_read_frames)>0,'Every stream must decode');
  return probe;
}
const samples=[];
const resourceSamples=[];
let sampleTimer,resourceTimer;
function windowsResources(){
  if(process.platform!=='win32')return;
  const profile=path.join(out,'profile').replaceAll("'","''");
  const command=`$all=Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\"; $ids=@($all | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${profile}') } | ForEach-Object { [int]$_.ProcessId }); do { $next=@($all | Where-Object { $ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId }); $ids+= $next } while($next.Count -gt 0); if($ids.Count){ $procs=@(Get-Process -Id $ids -ErrorAction SilentlyContinue); [pscustomobject]@{WorkingSetBytes=($procs | Measure-Object WorkingSet64 -Sum).Sum; PrivateBytes=($procs | Measure-Object PrivateMemorySize64 -Sum).Sum; CpuSeconds=($procs | ForEach-Object {$_.TotalProcessorTime.TotalSeconds} | Measure-Object -Sum).Sum; Processes=$procs.Count} | ConvertTo-Json -Compress }`;
  const result=spawnSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true,timeout:8000});
  if(result.status===0 && result.stdout.trim())resourceSamples.push({at:Date.now(),...JSON.parse(result.stdout)});
}
const manualSeconds=Number(process.env.BENCHMARK_SECONDS || 6);
if(!Number.isFinite(manualSeconds)||manualSeconds<6||manualSeconds>7200)throw Error('Invalid benchmark duration');
const context=await chromium.launchPersistentContext(path.join(out,'profile'),{
  channel:'chromium',headless:true,viewport:{width:1440,height:1100},
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  acceptDownloads:true
});
try {
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId=new URL(worker.url()).host;
  const page=await context.newPage();
  page.on('dialog',dialog=>dialog.accept());
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
  const cdp=await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const sample=async phase=>{
    const {metrics}=await cdp.send('Performance.getMetrics');
    samples.push({phase,at:Date.now(),...Object.fromEntries(metrics.filter(m=>['JSHeapUsedSize','JSHeapTotalSize','TaskDuration'].includes(m.name)).map(m=>[m.name,m.value]))});
  };
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});
  await page.addInitScript(()=>{
    navigator.mediaDevices.getDisplayMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const ctx=canvas.getContext('2d');let n=0;
      const paint=()=>{ctx.fillStyle=n%2?'#183a65':'#205050';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='32px sans-serif';ctx.fillText('SYNTHETIC LECTURE '+n++,40,180);};
      paint();const timer=setInterval(paint,100);
      const stream=canvas.captureStream(10);
      const audio=new AudioContext();const osc=audio.createOscillator();const gain=audio.createGain();gain.gain.value=0.08;
      const dest=audio.createMediaStreamDestination();osc.connect(gain).connect(dest);osc.start();await audio.resume();
      stream.addTrack(dest.stream.getAudioTracks()[0]);
      const track=stream.getVideoTracks()[0];const stop=track.stop.bind(track);
      track.stop=()=>{clearInterval(timer);osc.stop();audio.close();stop();};
      return stream;
    };
  });
  await page.goto(`chrome-extension://${extensionId}/pages/recorder.html`);
  await page.waitForFunction(()=>!document.getElementById('startBtn').disabled);
  await page.screenshot({path:path.join(out,'01-idle.png'),fullPage:true});
  const date=new Date();
  await page.locator('#lectureName').fill('Synthetic scheduled lecture');
  await page.locator('#weekday').selectOption(['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getDay()]);
  await page.locator('#scheduleTime').fill(date.toTimeString().slice(0,5));
  await page.locator('#scheduleDuration').fill('1');
  await page.locator('#scheduleEnabled').uncheck();
  await page.getByRole('button',{name:'Save schedule',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('scheduleStatus').textContent==='Schedule saved');
  assert.match(await page.locator('#scheduleList').innerText(),/Synthetic scheduled lecture/);
  results.push({test:'schedule create and persist',passed:true});
  await page.screenshot({path:path.join(out,'02-schedule.png'),fullPage:true});
  await page.locator('#recordingTitle').fill('Synthetic manual capture');
  await page.locator('#startBtn').click();
  await page.waitForFunction(()=>document.getElementById('statusPill').textContent==='Recording');
  sampleTimer=setInterval(()=>sample('recording').catch(()=>{}),1000);
  windowsResources();resourceTimer=setInterval(windowsResources,5000);
  await page.waitForTimeout(manualSeconds*500);
  await page.locator('#pauseBtn').click();
  await page.waitForFunction(()=>document.getElementById('statusPill').textContent==='paused');
  await page.waitForTimeout(1000);await page.locator('#pauseBtn').click();
  await page.waitForTimeout(manualSeconds*500);
  await page.screenshot({path:path.join(out,'03-recording.png'),fullPage:true});
  const finalizeStarted=Date.now();
  await page.locator('#stopBtn').click();
  await page.waitForFunction(()=>document.getElementById('statusPill').textContent==='saved',{},{timeout:120000});
  const finalizationMs=Date.now()-finalizeStarted;
  clearInterval(sampleTimer);await sample('saved');
  clearInterval(resourceTimer);windowsResources();
  await page.screenshot({path:path.join(out,'04-saved.png'),fullPage:true});
  const manual=await page.evaluate(async()=>{const {recordingHistory}=await chrome.storage.local.get('recordingHistory');return recordingHistory[0];});
  const probe=probeMedia(manual.filename);
  assert.ok(probe.streams.some(s=>s.codec_type==='video'));assert.ok(probe.streams.some(s=>s.codec_type==='audio'));
  assert.ok(Number(probe.format.duration)>manualSeconds-1 && Number(probe.format.duration)<manualSeconds+6);
  await page.evaluate(async()=>{
    const v=document.getElementById('playbackVideo');await v.play();
    await new Promise(resolve=>{v.addEventListener('seeked',resolve,{once:true});v.currentTime=2;});v.pause();
    if(v.videoWidth!==640 || v.currentTime<1.9)throw Error('Playback or seek failed');
  });
  results.push({test:'manual synthetic capture, pause/resume, automatic verified save and seek',passed:true,file:manual.filename,probe,manualSeconds,finalizationMs});

  // Real alarm + service worker + runtime transport, using an explicitly armed
  // synthetic stream. No chooser or account authorization is inferred.
  await page.locator('#formatChoice').selectOption('webm');
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.locator('#scheduleTime').fill(new Date().toTimeString().slice(0,5));
  await page.getByRole('button',{name:'Save schedule',exact:true}).click();
  await page.getByRole('button',{name:'Enable',exact:true}).click();
  const scheduleId=await page.evaluate(async()=> (await chrome.storage.local.get('automationSchedules')).automationSchedules[0].id);
  await page.locator('summary').click();
  await page.locator('#armSchedule').selectOption(scheduleId);await page.locator('#readyCheck').check();
  await page.locator('#armBtn').click();
  await page.waitForFunction(()=>document.getElementById('detail').textContent.startsWith('Armed'));
  const recorderTabId=await page.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
  const mismatch=await worker.evaluate(args=>chrome.runtime.sendMessage({type:'REQUEST_RECORDING',occurrenceKey:'mismatch-test',scheduleId:args.scheduleId,recorderTabId:args.recorderTabId,targetUrl:'https://teams.microsoft.com/different'}),{scheduleId,recorderTabId});
  assert.equal(mismatch.ok,false);assert.match(mismatch.error,/target changed/);
  // This rejection is an expected negative-test diagnostic, not a capture error.
  const expectedError=errors.findIndex(message=>message.includes('target changed'));
  assert.ok(expectedError>=0);errors.splice(expectedError,1);
  results.push({test:'changed target rejected after arming',passed:true});
  await page.screenshot({path:path.join(out,'05-armed.png'),fullPage:true});
  await page.evaluate(()=>chrome.alarms.create('screen-recorder-automation-poll',{delayInMinutes:0.02,periodInMinutes:1}));
  await page.waitForFunction(()=>document.getElementById('statusPill').textContent==='Recording',{},{timeout:15000});
  await page.screenshot({path:path.join(out,'06-scheduled-recording.png'),fullPage:true});
  await page.waitForFunction(()=>document.getElementById('statusPill').textContent==='saved',{},{timeout:90000});
  const scheduled=await page.evaluate(async()=> (await chrome.storage.local.get('recordingHistory')).recordingHistory[0]);
  const scheduledProbe=probeMedia(scheduled.filename);
  assert.ok(scheduledProbe.streams.some(s=>s.codec_type==='video'));assert.ok(scheduledProbe.streams.some(s=>s.codec_type==='audio'));
  // WebM MediaRecorder may omit duration metadata; inspect last packet timestamps.
  const packets=JSON.parse(execFileSync(ffprobe.path,['-v','error','-show_packets','-show_entries','packet=pts_time','-of','json',scheduled.filename],{encoding:'utf8'}));
  const duration=Math.max(...packets.packets.map(p=>Number(p.pts_time)||0));
  assert.ok(duration>=58 && duration<=65,`Duration ${duration}`);
  await page.screenshot({path:path.join(out,'07-scheduled-saved.png'),fullPage:true});
  results.push({test:'armed synthetic scheduled capture, runtime messages, duration stop, verified save',passed:true,file:scheduled.filename,duration,probe:scheduledProbe});
  // Inject only the download failure boundary, not the recording implementation.
  await page.evaluate(()=>{chrome.downloads.download=async()=>{throw Error('TEST_FILE_NO_SPACE');};});
  await page.locator('#startBtn').click();
  await page.waitForFunction(()=>document.getElementById('statusPill').textContent==='Recording');
  await page.waitForTimeout(2000);await page.locator('#stopBtn').click();
  await page.waitForFunction(()=>document.getElementById('statusPill').textContent==='failed');
  assert.equal(await page.locator('#startBtn').isDisabled(),true);
  await page.screenshot({path:path.join(out,'08-save-failed-protected.png'),fullPage:true});
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('detail').textContent.startsWith('Recovered finalized recording'));
  assert.equal(await page.locator('#startBtn').isDisabled(),true);
  await page.locator('#downloadBtn').click();
  await page.waitForFunction(()=>document.getElementById('statusPill').textContent==='saved');
  await page.screenshot({path:path.join(out,'09-recovered-saved.png'),fullPage:true});
  results.push({test:'save failure protects recording; reload recovers finalized blob and retry verifies save',passed:true});
  assert.deepEqual(errors,[]);
} catch(error){
  results.push({test:'browser validation',passed:false,error:error.stack});
  const page=context.pages().at(-1);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
  process.exitCode=1;
} finally {
  clearInterval(sampleTimer);clearInterval(resourceTimer);
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({out,results,errors,samples,resourceSamples,limitations:['Synthetic chooser substitution is not real tab capture permission validation','No Teams meeting was joined','CDP heap excludes native and WASM memory; TaskDuration is main-thread CPU time, not whole-browser CPU','Windows process sums include shared working-set pages and sampling may miss short peaks']},null,2));
  console.log(JSON.stringify({out,results:results.map(({probe,...rest})=>rest),errors},null,2));
  await context.close();
}
