// Real picker acceptance harness. Never substitutes capture, media, alarms,
// downloads, clocks or permission APIs. The human alone approves the picker.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const scenario=process.argv[2] || 'uninterrupted';
if(!['uninterrupted','source-reload','recorder-reload','browser-restart'].includes(scenario))throw Error('Unknown scenario');
const out=path.resolve('.test-artifacts',`real-capture-${scenario}-${new Date().toISOString().replace(/[:.]/g,'-')}`);
// Keep Chromium's nested LevelDB paths below legacy Windows path limits.
const profile=path.resolve('.test-artifacts',`rp-${Date.now().toString(36)}`);
await fs.mkdir(out,{recursive:true});
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const events=[];let context,page,source,server;
let inputFree=false;
const result={scenario,out,profile,status:'BLOCKED',captureSubstitution:false,permissionAutomation:false,limitations:['No Teams meeting is involved','Human must attest that keyboard and mouse were untouched during the measured interval','Source audio/video is synthetic; capture must be real Chrome tab sharing']};
async function log(type,data={}){
  const event={at:new Date().toISOString(),type,...data};events.push(event);
  await fs.appendFile(path.join(out,'events.jsonl'),JSON.stringify(event)+'\n');
  console.log(JSON.stringify(event));
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fixture=`<!doctype html><meta charset="utf-8"><title>CONTROLLED AV — REAL CAPTURE TEST</title>
<style>body{background:#102840;color:white;font:24px system-ui;margin:24px}button{font:24px system-ui;padding:12px}canvas{display:block;margin-top:20px}</style>
<h1>CONTROLLED AV — REAL CAPTURE TEST</h1><p>No camera, microphone, login or meeting. Capture this Chrome tab with tab audio.</p>
<button id="audio">Start test tone</button><span id="audioState"> Audio not started</span><canvas width="960" height="540"></canvas>
<script>
const c=document.querySelector('canvas'),g=c.getContext('2d');let frame=0;
function draw(){g.fillStyle='#143555';g.fillRect(0,0,960,540);g.fillStyle='#5bd9ac';g.fillRect((frame*6)%900,250,60,120);g.fillStyle='white';g.font='32px monospace';g.fillText('REAL TAB CAPTURE: '+frame++,30,80);g.fillText(new Date().toISOString(),30,135);requestAnimationFrame(draw)}draw();
let audio,osc,gain;document.querySelector('#audio').onclick=async()=>{if(!audio){audio=new AudioContext();osc=audio.createOscillator();gain=audio.createGain();gain.gain.value=.05;osc.frequency.value=440;osc.connect(gain).connect(audio.destination);osc.start()}await audio.resume();document.querySelector('#audioState').textContent=' Audio context: '+audio.state;document.querySelector('#audio').disabled=true};
</script>`;
async function attachObservers(){
  page.on('pageerror',error=>log('pageerror',{message:error.message}));
  page.on('console',message=>{if(['error','warning'].includes(message.type()))log('console',{level:message.type(),message:message.text()});});
  page.on('dialog',dialog=>{
    log('dialog',{type:dialog.type(),message:dialog.message()});
    // Reload confirmation is not a capture permission; never accept others.
    if(dialog.type()==='beforeunload' && !inputFree)dialog.accept();
  });
  await page.exposeFunction('acceptanceEvent',(type,data)=>log(type,data));
  await page.evaluate(()=>{
    chrome.alarms.onAlarm.addListener(alarm=>window.acceptanceEvent('chrome-alarm',{alarm}));
    chrome.storage.onChanged.addListener((changes,area)=>window.acceptanceEvent('storage-change',{area,changes}));
    chrome.downloads.onCreated.addListener(item=>window.acceptanceEvent('download-created',{item}));
    chrome.downloads.onChanged.addListener(delta=>window.acceptanceEvent('download-change',{delta}));
    chrome.runtime.onMessage.addListener(message=>{window.acceptanceEvent('runtime-message',{message});return false;});
  });
}
async function launch(){
  context=await chromium.launchPersistentContext(profile,{
    channel:'chromium',headless:false,viewport:{width:1440,height:1050},acceptDownloads:true,
    chromiumSandbox:true,
    ignoreDefaultArgs:['--disable-extensions','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--unsafely-disable-devtools-self-xss-warnings'],
    args:[`--disable-extensions-except=${path.resolve('dist')}`,`--load-extension=${path.resolve('dist')}`]
  });
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  result.browserVersion=context.browser()?.version();
  result.extensionId=new URL(worker.url()).host;
  source=await context.newPage();await source.goto(result.sourceUrl);
  await source.locator('#audio').click(); // Ordinary test-source playback, not capture permission.
  page=await context.newPage();await page.goto(`chrome-extension://${result.extensionId}/pages/recorder.html`);
  await page.waitForFunction(()=>!document.getElementById('startBtn').disabled || document.getElementById('detail').textContent.startsWith('Recovery check failed'));
  assert.equal(await page.locator('#startBtn').isDisabled(),false,await page.locator('#detail').textContent());
  await attachObservers();
  const cdp=await context.newCDPSession(page);
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});
  await log('browser-ready',{version:result.browserVersion,profile,captureAPI:await page.evaluate(()=>String(navigator.mediaDevices.getDisplayMedia))});
}
async function snapshot(){
  return page.evaluate(async()=>({
    status:document.getElementById('statusPill').textContent,
    detail:document.getElementById('detail').textContent,
    tracks:[...(document.getElementById('preview').srcObject?.getTracks() || [])].map(t=>({kind:t.kind,label:t.label,readyState:t.readyState,muted:t.muted,settings:t.getSettings()})),
    storage:await chrome.storage.local.get(['automationActiveRecording','automationPendingRecording','automationDiagnostic','recordingHistory'])
  }));
}
async function screenshot(name){await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});}
try{
  server=http.createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(fixture);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  result.sourceUrl=`http://127.0.0.1:${server.address().port}/`;
  await launch();
  // An enabled future schedule permits arming but cannot trigger while waiting
  // for the human. No target URL: the localhost source is manually selected.
  const future=new Date(Date.now()+86400000);
  const schedule={id:`real-${scenario}`,title:`Real Chrome capture ${scenario}`,enabled:true,
    weekdays:[['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][future.getDay()]],
    time:future.toTimeString().slice(0,5),durationMinutes:1,launchWindowSeconds:120};
  await page.evaluate(schedule=>chrome.storage.local.set({automationSchedules:[schedule]}),schedule);
  await page.locator('summary').click();await page.locator('#armSchedule').selectOption(schedule.id);
  await page.bringToFront();await screenshot('01-awaiting-human-authorization');
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({...result,reason:'Awaiting human capture authorization'},null,2));
  await log('awaiting-human-authorization',{instructions:'Check readiness, click Choose capture and arm, choose CONTROLLED AV Chrome tab, include tab audio, Share. Then leave keyboard/mouse untouched. Harness will schedule a future minute and wait for the real periodic alarm.'});
  await page.waitForFunction(()=>document.getElementById('detail').textContent.startsWith('Armed'),null,{timeout:15*60000});
  const armed=await snapshot();
  assert.ok(armed.tracks.some(t=>t.kind==='audio' && t.readyState==='live'));
  assert.ok(armed.tracks.some(t=>t.kind==='video' && t.readyState==='live' && t.settings.displaySurface==='browser'),'Must choose a Chrome tab, not a screen/window');
  await log('capture-authorized',{state:armed});await screenshot('02-authorized');
  if(scenario==='source-reload'){
    await source.reload();await source.locator('#audio').click();
    await log('source-tab-reloaded',{state:await snapshot()});
  }
  if(scenario==='recorder-reload'){
    await page.reload();await page.waitForFunction(()=>!document.getElementById('startBtn').disabled);
    // exposeFunction persists across document navigation; reinstall listeners only.
    await log('recorder-tab-reloaded',{state:await snapshot()});
  }
  if(scenario==='browser-restart'){
    await context.close();await log('browser-stopped');await launch();
    await log('browser-restarted',{state:await snapshot()});
  }
  // At least 60 seconds from setup. Do not synthesize an alarm or runtime request.
  const due=new Date(Math.ceil(Date.now()/60000)*60000+60000);
  schedule.weekdays=[['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][due.getDay()]];
  schedule.time=due.toTimeString().slice(0,5);
  await page.evaluate(schedule=>chrome.storage.local.set({automationSchedules:[schedule]}),schedule);
  const alarms=await page.evaluate(()=>chrome.alarms.getAll());
  assert.ok(alarms.some(a=>a.name==='screen-recorder-automation-poll'),'Production poll alarm must already exist');
  inputFree=true;
  await log('input-free-interval-begins',{scheduledFor:due.toISOString(),alarms});
  let previous='',started=false,saved=false;
  const deadline=due.getTime()+240000;
  while(Date.now()<deadline){
    const state=await snapshot();
    const key=JSON.stringify(state);
    if(key!==previous){await log('observed-state',{state});previous=key;}
    if(state.status==='Recording' && !started){started=true;await screenshot('03-actual-recording');}
    if(started && state.status==='saved'){
      saved=true;result.media=state.storage.recordingHistory?.[0]?.filename;
      await screenshot('04-automatic-save-verified');await log('automatic-save-complete',{media:result.media,state});break;
    }
    if(!started && Date.now()>due.getTime()+125000){await screenshot('03-no-automatic-start');break;}
    await sleep(500);
  }
  inputFree=false;await log('input-free-interval-ends',{started,saved});
  if(!saved){result.status='FAILED';result.reason='Scheduled occurrence did not complete automatic start/stop/save';result.finalState=await snapshot();}
  else{
    const probe=spawnSync(process.execPath,['scripts/probe-recording.mjs',result.media,'60'],{encoding:'utf8'});
    await fs.writeFile(path.join(out,'ffprobe-validation.txt'),probe.stdout+probe.stderr);
    assert.equal(probe.status,0,probe.stderr);
    const playback=await page.evaluate(async()=>{
      const v=document.getElementById('playbackVideo');await v.play();
      await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Seek timeout')),10000);v.addEventListener('seeked',()=>{clearTimeout(t);resolve();},{once:true});v.currentTime=30;});
      v.pause();return {time:v.currentTime,width:v.videoWidth,height:v.videoHeight};
    });
    assert.ok(playback.width>0 && playback.time>=29.5);
    result.status='VERIFIED';result.playback=playback;
    result.humanInputAttestation='Still requires confirmation from operator: no keyboard/mouse input during logged interval';
  }
}catch(error){
  result.reason=error.stack;
  result.status=events.some(e=>e.type==='capture-authorized')?'FAILED':'BLOCKED';
  await log('failure',{message:error.stack});
  if(page)await screenshot('blocked-or-failed').catch(()=>{});
}finally{
  inputFree=false;
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if(context)await context.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(result.status!=='VERIFIED')process.exitCode=2;
}
