// Isolated extension acceptance: real Chrome alarms, worker termination/restart,
// storage, scripting, runtime messaging, MediaRecorder, stopping and downloads.
// Teams HTML, permission grants and source-media acquisition are fixtures.
// Playwright drives this test only; the production recorder records the streams.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import ffprobe from 'ffprobe-static';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const out=path.resolve('.test-artifacts','join-recovery-'+Date.now());
await mkdir(out,{recursive:true});
const extension=path.join(out,'fixture-extension'),origin='https://teams.cloud.microsoft';
await cp(path.resolve(process.env.RECORDER_TEST_DIST || 'dist'),extension,{recursive:true});
if(process.env.JOIN_RECOVERY_BASELINE==='1'){
 await writeFile(path.join(extension,'automation/teams_join.js'),execFileSync('git',['show','2b5c391:src/automation/teams_join.js'],{encoding:'utf8'}));
}
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
manifest.host_permissions.push(origin+'/*');
await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest,null,2));
// Persistent fixture boundary reinstalled on worker restart. No controller,
// clock, alarm listener, joiner, storage or recorder command is replaced.
await writeFile(path.join(extension,'fixture-media.js'),"chrome.tabCapture.getMediaStreamId=async({targetTabId})=>'synthetic-'+targetTabId;\nchrome.storage.session.set({fixtureBootId:crypto.randomUUID()});\n");
const workerPath=path.join(extension,'service_worker.js');
await writeFile(workerPath,"import './fixture-media.js';\n"+await readFile(workerPath,'utf8'));
const context=await chromium.launchPersistentContext(path.join(out,'profile'),{
 channel:'chromium',headless:true,viewport:{width:1280,height:1000},acceptDownloads:true,
 args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
});
const report={scope:'Real built extension and Chrome alarms/worker restart; fixture Teams, seeded grants, synthetic source media. Not live Teams acceptance.',baseline:process.env.JOIN_RECOVERY_BASELINE==='1',passed:false,files:[],checks:[],errors:[]};
let page,cdp;const versions=new Map();
async function poll(check,label,timeout=180000){
 const end=Date.now()+timeout;
 while(Date.now()<end){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,150));}
 throw Error('Timed out: '+label);
}
const local=()=>page.evaluate(()=>chrome.storage.local.get(null));
const session=()=>page.evaluate(()=>chrome.storage.session.get(null));
const fire=()=>page.evaluate(()=>chrome.alarms.create('screen-recorder-automation-poll',{delayInMinutes:.01,periodInMinutes:.5}));
async function restartWorker(){
 const version=await poll(()=>[...versions.values()].find(v=>v.scriptURL?.endsWith('/service_worker.js')&&v.runningStatus==='running'),'running worker version');
 const previous=(await session()).fixtureBootId;
 await cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId});
 await fire();
 const boot=await poll(async()=>{const id=(await session()).fixtureBootId;return id&&id!==previous?id:false;},'new worker boot identity',60000);
 report.checks.push('Chrome stopped worker '+version.versionId+'; fresh worker boot verified and real polling alarm scheduled');
 console.log('Verified worker restart: '+previous+' -> '+boot);
}
function fixture(team){return `<title>Teams and Channels | ${team} | General | Microsoft Teams</title>
 <div><div><button aria-label="Back to All teams">All teams</button></div>${team}</div>
 <div role="treeitem" aria-selected="true"><span data-tid="channel-list-item-text-x">General</span></div>
 <button id="join" aria-label="Join meeting in progress">Join</button><script>
 window.clicks=[];window.release=false;window.stage='channel';
 document.querySelector('#join').onclick=()=>{
  clicks.push('channel');stage='channel-loading';document.body.innerHTML='<p>Loading prejoin...</p>';
  setTimeout(()=>{stage='prejoin';document.title='Teams and Channels | Meeting join | Meeting in "General" | Microsoft Teams';document.body.innerHTML='<button role="switch" aria-label="Camera" aria-checked="false">Camera</button><button role="switch" aria-label="Mic" aria-checked="false">Mic</button><button role="radio" aria-label="Computer audio" aria-checked="true">Computer audio</button><button id="now">Join now</button>';
  document.querySelector('#now').onclick=()=>{
   clicks.push('now');stage='joining';document.querySelector('#now').disabled=true;
   document.title='Teams and Channels | Meeting join | Meeting in "General" | Microsoft Teams';
   setTimeout(()=>{document.body.innerHTML='<p>Connecting...</p>';stage='transition';},2500);
   const timer=setInterval(()=>{if(release){clearInterval(timer);stage='joined';document.body.innerHTML='<button>Leave</button>';document.title='Meeting in General';}},100);
  };},2500);
 };</script>`;}
async function schedule(id){
 const target=await context.newPage();
 const url=origin+'/fixture/'+id;
 await target.route(origin+'/**',r=>r.fulfill({contentType:'text/html',body:fixture('Fixture '+id)}));
 await target.goto(url);
 const setup=await page.evaluate(async({id,url})=>{
  await chrome.alarms.clear('screen-recorder-automation-poll');
  const tab=(await chrome.tabs.query({})).find(t=>t.url===url),now=new Date();
  const s={id,title:id,enabled:true,captureMode:'tab',targetUrl:url,durationMinutes:1,
   weekdays:[['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()]],
   runDate:`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`,
   time:now.toTimeString().slice(0,5),launchWindowSeconds:600,teamsAutoJoin:true,teamsTeam:'Fixture '+id,teamsChannel:'General',joinWaitMinutes:10};
  const {automationSchedules=[]}=await chrome.storage.local.get('automationSchedules');
  await chrome.storage.local.set({automationSchedules:[...automationSchedules,s]});
  const {tabCaptureGrants={}}=await chrome.storage.session.get('tabCaptureGrants');
  tabCaptureGrants['schedule:'+id]={scheduleId:id,targetIdentity:JSON.stringify([s.captureMode,url,true,s.teamsTeam,s.teamsChannel]),tabId:tab.id,url,origin:new URL(url).origin,title:tab.title,at:now.toISOString()};
  await chrome.storage.session.set({tabCaptureGrants});
  return {schedule:s,tabId:tab.id};
 },{id,url});
 await fire();return {...setup,target};
}
async function waitJoining(run){
 await poll(async()=> (await session()).teamsJoinSessions?.[run.tabId]?.phase==='joining','persisted joining');
 await poll(()=>run.target.evaluate(()=>stage==='transition'),'missing-sidebar transition');
}
async function waitRecording(id){await poll(async()=> (await local()).automationActiveRecording?.scheduleId===id,'recording '+id);}
async function waitSaved(id){
 const file=await poll(async()=> (await local()).recordingHistory?.find(h=>h.scheduleId===id&&/^saved/.test(h.state)),'saved '+id);
 await poll(async()=>!(await local()).automationActiveRecording,'completed save acknowledgement');
 const probe=JSON.parse(execFileSync(ffprobe.path,['-v','error','-count_frames','-show_streams','-of','json',file.filename],{encoding:'utf8'}));
 assert.ok(probe.streams.some(s=>s.codec_type==='video'));assert.ok(probe.streams.some(s=>s.codec_type==='audio'));
 assert.ok(probe.streams.every(s=>Number(s.nb_read_frames)>0));
 const packets=JSON.parse(execFileSync(ffprobe.path,['-v','error','-show_packets','-show_entries','packet=pts_time','-of','json',file.filename],{encoding:'utf8'}));
 const duration=Math.max(...packets.packets.map(p=>Number(p.pts_time)||0));
 report.files.push({id,filename:file.filename,bytes:file.bytes,duration});
 return duration;
}
const cancel=id=>page.evaluate(scheduleId=>chrome.runtime.sendMessage({type:'AUTOMATION_CANCEL_RUN',scheduleId}),id);
try{
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 cdp=await context.newCDPSession(page);
 cdp.on('ServiceWorker.workerVersionUpdated',({versions:list})=>{for(const v of list)versions.set(v.versionId,v);});
 await cdp.send('ServiceWorker.enable');
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});
 await page.addInitScript(()=>{
  window.syntheticCaptures=[];window.receivedCommands=[];
  navigator.mediaDevices.getUserMedia=async constraints=>{
   const id=constraints.video.mandatory.chromeMediaSourceId;syntheticCaptures.push(id);
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
   const ctx=canvas.getContext('2d');let tick=0;
   const draw=()=>{ctx.fillStyle='#163b55';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='24px monospace';ctx.fillText('Fixture '+id,20,90);ctx.fillText(String(tick++),20,150);};
   draw();const timer=setInterval(draw,100),stream=canvas.captureStream(10);
   const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain(),dest=audio.createMediaStreamDestination();
   gain.gain.value=.08;osc.connect(gain).connect(dest);osc.start();await audio.resume();stream.addTrack(dest.stream.getAudioTracks()[0]);
   const video=stream.getVideoTracks()[0],stop=video.stop.bind(video);let released=false;
   video.stop=()=>{if(released)return;released=true;clearInterval(timer);osc.stop();audio.close();stop();};
   return stream;
  };
 });
 await page.goto(`chrome-extension://${new URL(worker.url()).host}/pages/recorder.html`);
 await page.waitForFunction(()=>!document.getElementById('startBtn').disabled);
 await page.evaluate(()=>chrome.runtime.onMessage.addListener(m=>{if(m.recorderTabId!=null)receivedCommands.push(m);return false;}));
 await page.getByRole('tab',{name:'Record now',exact:true}).click();await page.locator('#formatChoice').selectOption('webm');
 console.log('Join recovery isolated browser artifacts: '+out);
 const recovered=await schedule('recovered');
 await waitJoining(recovered);
 // Exhaust the first attempt, then let a real alarm recreate controller/joiner.
 await poll(async()=> (await local()).automationRuns?.recovered?.state==='retry_pending','transition retry');
 assert.equal((await session()).teamsJoinSessions[recovered.tabId].phase,'joining');
 assert.equal((await session()).teamsJoinSessions[recovered.tabId].scheduleId,'recovered');
 assert.ok((await session()).teamsJoinSessions[recovered.tabId].documentId);
 await restartWorker();
 await recovered.target.evaluate(()=>{release=true;});
 await waitRecording('recovered');
 console.log('Recovered recording started');
 await restartWorker(); // active state and handled occurrence also survive
 await fire();
 const duration=await waitSaved('recovered');assert.ok(duration>=58&&duration<75,'one-minute duration: '+duration);
 console.log('Recovered recording saved: '+duration+' seconds');
 await fire();
 report.checks.push('Transition -> actual alarm/worker recreation -> exactly one recording -> timed stop/save');
 const cancelled=await schedule('cancel-transition');await waitJoining(cancelled);
 assert.equal((await cancel('cancel-transition')).ok,true);
 await cancelled.target.evaluate(()=>{release=true;});await restartWorker();
 await poll(async()=> (await local()).automationRuns?.['cancel-transition']?.state==='cancelled','persisted cancellation');
 // A real polling event must process after cancellation; a new due schedule
 // below proves the restarted worker ran, rather than relying on a sleep.
 const during=await schedule('cancel-recording');await waitJoining(during);
 await during.target.evaluate(()=>{release=true;});await waitRecording('cancel-recording');
 await new Promise(r=>setTimeout(r,2500));
 assert.equal((await cancel('cancel-recording')).ok,true);
 const cancelledDuration=await waitSaved('cancel-recording');assert.ok(cancelledDuration>0&&cancelledDuration<58);
 console.log('Cancelled recording saved: '+cancelledDuration+' seconds');
 await restartWorker();
 const replaced=await schedule('replaced-document');await waitJoining(replaced);
 await replaced.target.reload();await fire();
 await poll(async()=> (await local()).automationActivityLog?.some(e=>e.scheduleId==='replaced-document'&&e.event==='attempt_failed'),'replacement document rejected');
 assert.deepEqual(await replaced.target.evaluate(()=>clicks),[],'a replacement document cannot inherit the old Join click');
 assert.equal((await cancel('replaced-document')).ok,true);
 report.checks.push('Same-origin replacement document rejected by Chrome document identity; no Join or recording');
 // Query the actual command pipeline, history, counters and persistent state.
 const state=await local(),commands=await page.evaluate(()=>receivedCommands);
 for(const id of ['recovered','cancel-recording']){
  assert.equal(commands.filter(m=>m.type==='REQUEST_RECORDING'&&m.scheduleId===id).length,1,id+' start dispatched once');
  assert.equal(state.recordingHistory.filter(h=>h.scheduleId===id).length,1);
 }
 assert.equal(commands.filter(m=>m.type==='REQUEST_RECORDING'&&m.scheduleId==='cancel-transition').length,0);
 assert.equal(commands.filter(m=>m.type==='REQUEST_RECORDING'&&m.scheduleId==='replaced-document').length,0);
 assert.equal(state.recordingHistory.length,2);
 assert.deepEqual(await page.evaluate(()=>syntheticCaptures),[recovered,during].map(r=>'synthetic-'+r.tabId));
 for(const run of [recovered,cancelled,during])assert.deepEqual(await run.target.evaluate(()=>clicks),['channel','now']);
 assert.deepEqual(report.errors,[]);
 report.checks.push('Cancel while connecting survives worker restart with no recording','Cancel active recording stops and saves a decodable file','Repeated alarms and worker restart never duplicate Join clicks or recording requests');
 report.state=state;report.commands=commands;report.passed=true;
 console.log('PASS: '+report.checks.join('; '));
}catch(error){
 report.error=error.stack;process.exitCode=1;console.error(error);
 if(page){report.failureState=await local().catch(()=>null);report.failureSession=await session().catch(()=>null);await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}
}finally{await writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));await context.close();}
