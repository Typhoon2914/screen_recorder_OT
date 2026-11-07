// Built-extension integration in an isolated profile. All Teams responses are
// local fixtures. Grants and media acquisition are synthetic test boundaries:
// this does NOT validate Chrome permission, real Teams, or actual tab capture.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import ffprobe from 'ffprobe-static';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const out=path.resolve('.test-artifacts','sequential-schedules-'+Date.now());
await mkdir(out,{recursive:true});
const extension=path.join(out,'fixture-extension'),url='https://teams.cloud.microsoft/';
// Grant script access only in this disposable test copy, so the real joiner
// can operate routed local HTML without pretending activeTab was authorized.
// Neither source/dist manifest nor the installed user extension is changed.
await cp(path.resolve('dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
manifest.host_permissions.push('https://teams.cloud.microsoft/*');
await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest,null,2));
const context=await chromium.launchPersistentContext(path.join(out,'profile'),{
 channel:'chromium',headless:true,viewport:{width:1280,height:1000},acceptDownloads:true,
 args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
});
const report={scope:'Synthetic Teams DOM, test-copy host permission, seeded grants, synthetic media; real worker, joiner, scheduler, recorder, downloads',passed:false,files:[],errors:[]};
let recorderPage;
async function poll(check,timeout=240000){
 const end=Date.now()+timeout;
 while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,500));}
 throw Error('Timed out waiting for sequential capture/save');
}
try{
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const page=await context.newPage();recorderPage=page;page.on('pageerror',error=>report.errors.push(error.message));
 const cdp=await context.newCDPSession(page);
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});
 await page.addInitScript(()=>{
  window.syntheticCaptures=[];
  navigator.mediaDevices.getUserMedia=async constraints=>{
   const sourceId=constraints.video.mandatory.chromeMediaSourceId;
   syntheticCaptures.push(sourceId);
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
   const graphics=canvas.getContext('2d');let tick=0;
   const draw=()=>{graphics.fillStyle='#163b55';graphics.fillRect(0,0,640,360);graphics.fillStyle='white';graphics.font='24px monospace';graphics.fillText('Synthetic '+sourceId,20,90);graphics.fillText(String(tick++),20,150);};
   draw();const timer=setInterval(draw,100),stream=canvas.captureStream(10);
   const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain(),dest=audio.createMediaStreamDestination();
   gain.gain.value=.08;osc.connect(gain).connect(dest);osc.start();await audio.resume();
   stream.addTrack(dest.stream.getAudioTracks()[0]);
   const video=stream.getVideoTracks()[0],stop=video.stop.bind(video);let released=false;
   video.stop=()=>{if(released)return;released=true;clearInterval(timer);osc.stop();audio.close();stop();};
   return stream;
  };
 });
 await page.goto(`chrome-extension://${new URL(worker.url()).host}/pages/recorder.html`);
 await page.waitForFunction(()=>!document.getElementById('startBtn').disabled);
 await page.getByRole('tab',{name:'Record now',exact:true}).click();
 await page.locator('#formatChoice').selectOption('webm');
 const targets=[];
 for(const team of ['Fixture A','Fixture B']){
  const target=await context.newPage();targets.push(target);
  await target.route('https://teams.cloud.microsoft/**',route=>route.fulfill({contentType:'text/html',body:`
   <title>Teams and Channels | ${team} | General | Microsoft Teams</title>
   <div><div><button aria-label="Back to All teams">All teams</button></div>${team}</div>
   <div role="treeitem" aria-selected="true"><span data-tid="channel-list-item-text-x">General</span></div>
   <button id="join" aria-label="Join meeting in progress">Join</button>
   <script>window.joinClicks=0;document.querySelector('#join').onclick=()=>{
    window.joinClicks++;document.body.innerHTML='<button role="switch" aria-label="Camera" aria-checked="false">Camera</button><button role="switch" aria-label="Mic" aria-checked="false">Mic</button><button role="radio" aria-label="Computer audio" aria-checked="true">Computer audio</button><button id="now">Join now</button>';
    document.querySelector('#now').onclick=()=>{window.joinClicks++;document.body.innerHTML='<button>Leave</button>';};
   };</script>`}));
  await target.goto(url);
 }
 // Seed ONLY this isolated profile. No real authorization is inferred.
 await worker.evaluate(()=>{chrome.tabCapture.getMediaStreamId=async({targetTabId})=>'synthetic-'+targetTabId;});
 const setup=await page.evaluate(async url=>{
  await chrome.alarms.clear('screen-recorder-automation-poll');
  const tabs=(await chrome.tabs.query({})).filter(t=>t.url===url).sort((a,b)=>a.title.localeCompare(b.title));
  const now=new Date(),times=[new Date(now),new Date(now.getTime()+120000)];
  const schedules=tabs.map((tab,i)=>({id:'sequential-'+i,title:'Sequential '+(i+1),enabled:true,captureMode:'tab',targetUrl:url,
   durationMinutes:1,weekdays:[['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][times[i].getDay()]],
   runDate:`${times[i].getFullYear()}-${String(times[i].getMonth()+1).padStart(2,'0')}-${String(times[i].getDate()).padStart(2,'0')}`,
   time:times[i].toTimeString().slice(0,5),launchWindowSeconds:300,teamsAutoJoin:true,teamsTeam:i?'Fixture B':'Fixture A',teamsChannel:'General',joinWaitMinutes:5}));
  const grants=Object.fromEntries(schedules.map((s,i)=>['schedule:'+s.id,{scheduleId:s.id,
   targetIdentity:JSON.stringify([s.captureMode,s.targetUrl,true,s.teamsTeam,s.teamsChannel]),tabId:tabs[i].id,
   url,origin:new URL(url).origin,title:tabs[i].title,at:new Date().toISOString()}]));
  await chrome.storage.local.set({automationSchedules:schedules});
  await chrome.storage.session.set({tabCaptureGrants:grants});
  await chrome.alarms.create('screen-recorder-automation-poll',{delayInMinutes:.02,periodInMinutes:.5});
  return {schedules,tabs:tabs.map(t=>({id:t.id,title:t.title}))};
 },url);
 report.setup=setup;console.log('Two sequential schedules prepared in isolated fixture profile: '+out);
 for(let count=1;count<=2;count++){
  await poll(async()=>await page.evaluate(async count=>((await chrome.storage.local.get('recordingHistory')).recordingHistory || []).filter(h=>h.state==='saved').length>=count,count));
  console.log('Verified saved recording '+count+' of 2');
 }
 await poll(()=>page.evaluate(async()=>!(await chrome.storage.local.get('automationActiveRecording')).automationActiveRecording));
 const state=await page.evaluate(()=>chrome.storage.local.get(['recordingHistory','automationActivityLog','automationRuns','captureEvents']));
 assert.equal(state.recordingHistory.length,2);
 for(const file of state.recordingHistory){
  const probe=JSON.parse(execFileSync(ffprobe.path,['-v','error','-count_frames','-show_streams','-of','json',file.filename],{encoding:'utf8'}));
  assert.ok(probe.streams.some(s=>s.codec_type==='video'));assert.ok(probe.streams.some(s=>s.codec_type==='audio'));
  assert.ok(probe.streams.every(s=>Number(s.nb_read_frames)>0));
  const packets=JSON.parse(execFileSync(ffprobe.path,['-v','error','-show_packets','-show_entries','packet=pts_time','-of','json',file.filename],{encoding:'utf8'}));
  const duration=Math.max(...packets.packets.map(p=>Number(p.pts_time)||0));assert.ok(duration>=58&&duration<70,`Duration ${duration}`);
  report.files.push({filename:file.filename,duration,bytes:file.bytes});
 }
 assert.deepEqual(await page.evaluate(()=>syntheticCaptures),setup.tabs.map(t=>'synthetic-'+t.id));
 for(const target of targets)assert.equal(await target.evaluate(()=>joinClicks),2);
 const logs=state.automationActivityLog;
 assert.ok(logs.findIndex(e=>e.event==='saved'&&e.scheduleId==='sequential-0')<logs.findIndex(e=>e.event==='run_attempt'&&e.scheduleId==='sequential-1'));
 for(const s of setup.schedules){
  assert.equal(state.automationRuns[s.id].state,'finished');
  for(const event of ['teams_joined','recording_started','capture_stopped','saving','saved'])assert.ok(logs.some(e=>e.event===event&&e.scheduleId===s.id),s.id+' missing '+event);
 }
 assert.deepEqual(report.errors,[]);report.state=state;report.passed=true;
 await page.getByRole('tab',{name:'Logs',exact:true}).click();
 await page.screenshot({path:path.join(out,'sequential-logs.png'),fullPage:true});
 console.log('PASS: two synthetic Teams joins and scheduled recordings, distinct targets, timed stops and verified files. '+out);
}catch(error){
 report.error=error.stack;process.exitCode=1;console.error(error);
 if(recorderPage){
  report.failureState=await recorderPage.evaluate(()=>chrome.storage.local.get(null)).catch(()=>null);
  await recorderPage.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
 }
}
finally{await writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));await context.close();}
