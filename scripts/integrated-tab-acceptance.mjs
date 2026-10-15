// Real integrated capture. No fake streams, permission overrides or Start clicks.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const out=path.resolve('.test-artifacts','integrated-tab-'+Date.now()),profile=path.join(out,'profile');
await fs.mkdir(out,{recursive:true});
const report={out,profile,startedAt:new Date().toISOString(),status:'RUNNING',events:[],media:[],captureMocked:false};
async function log(type,data={}){
 const event={at:new Date().toISOString(),type,...data};report.events.push(event);
 await fs.appendFile(path.join(out,'events.jsonl'),JSON.stringify(event)+'\n');console.log(JSON.stringify(event));
 await fs.writeFile(path.join(out,'checkpoint.json'),JSON.stringify(report,null,2));
}
const sourceUrl='https://integrated-capture.invalid/lecture';
const sourceHtml='<!doctype html><meta charset="utf-8"><title>AUTHORIZE INTEGRATED TEST TAB ONCE</title><style>body{font:24px system-ui;background:#123;color:white}canvas{display:block}</style><h1>AUTHORIZE INTEGRATED TEST TAB ONCE</h1><p>Click Chrome Extensions → Screen Recorder EXPERIMENT once when asked. Then leave the browser untouched.</p><button>Start controlled tone</button><span id="audioState"></span><canvas width="960" height="540"></canvas><script>let c=document.querySelector("canvas"),g=c.getContext("2d"),n=0;function draw(){g.fillStyle="#135";g.fillRect(0,0,960,540);g.fillStyle="#5eb";g.fillRect(n++*6%900,200,60,250);g.fillStyle="white";g.font="28px monospace";g.fillText(new Date().toISOString(),20,70);requestAnimationFrame(draw)}draw();window.audio=new AudioContext();let o=audio.createOscillator(),v=audio.createGain();v.gain.value=.04;o.connect(v).connect(audio.destination);o.start();audio.resume().catch(()=>{});document.querySelector("button").onclick=async()=>{await audio.resume();document.querySelector("#audioState").textContent=audio.state;};</script>';
let context,page,source,worker;
async function launch(){
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,chromiumSandbox:true,timezoneId:'Africa/Cairo',viewport:{width:1440,height:1100},
  ignoreDefaultArgs:['--disable-extensions','--unsafely-disable-devtools-self-xss-warnings'],
  args:['--disable-extensions-except='+path.resolve('dist'),'--load-extension='+path.resolve('dist')]});
 await context.route('https://integrated-capture.invalid/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:sourceHtml}));
 await context.route('https://other-capture.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<title>Different origin</title><h1>Do not capture this origin</h1>'}));
 worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 report.browser=context.browser().version();
 const id=new URL(worker.url()).host;
 source=await context.newPage();await source.goto(sourceUrl);
 await source.getByRole('button',{name:'Start controlled tone'}).click();
 page=await context.newPage();await page.goto('chrome-extension://'+id+'/pages/recorder.html');
 await page.waitForFunction(()=>!document.getElementById('startBtn').disabled);
 page.on('pageerror',error=>log('page-error',{message:error.message}));
 const cdp=await context.newCDPSession(page);
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});
 await page.exposeFunction('captureTestLog',log);
 await page.evaluate(()=>{
   chrome.alarms.onAlarm.addListener(alarm=>window.captureTestLog('real-alarm',{alarm}));
   chrome.storage.onChanged.addListener((changes,area)=>{
     if(area!=='local')return;
     for(const key of ['captureEvents','automationDiagnostic','recordingHistory'])if(changes[key])window.captureTestLog('application-state',{key,value:changes[key].newValue});
   });
 });
}
const read=()=>page.evaluate(()=>chrome.storage.local.get(['automationSchedules','recordingHistory','captureEvents','automationDiagnostic','tabCaptureAuthorizationEvents','automationActiveRecording']));
const time=date=>new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
const weekday=date=>new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',weekday:'long'}).format(date);
async function addSchedule(title,due){
 await page.locator('#lectureName').fill(title);await page.locator('#weekday').selectOption(weekday(due));
 await page.locator('#scheduleTime').fill(time(due));await page.locator('#scheduleDuration').fill('1');
 await page.locator('#targetUrl').fill(sourceUrl);await page.locator('#captureMode').selectOption('tab');
 await page.getByRole('button',{name:'Save schedule',exact:true}).click();
 await page.waitForFunction(title=>document.getElementById('scheduleList').textContent.includes(title),title);
 return (await read()).automationSchedules.find(s=>s.title===title);
}
async function poll(check,timeout,label){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,500));}
 throw Error('Timed out: '+label);
}
async function validate(file){
 const probe=spawnSync(process.execPath,['scripts/probe-recording.mjs',file,'60'],{encoding:'utf8',timeout:60000});
 await fs.writeFile(file+'.ffprobe.txt',probe.stdout+probe.stderr);assert.equal(probe.status,0,probe.stderr);
 const review=spawnSync(process.execPath,['scripts/review-capture-media.mjs',file],{encoding:'utf8',timeout:120000});
 await fs.writeFile(file+'.review-log.txt',review.stdout+review.stderr);
 const decoded=JSON.parse(await fs.readFile(file+'.review.json','utf8'));
 assert.ok(decoded.samples.audio?.mean>-60,'Actual tone required');
 assert.ok(decoded.playback?.meanPixelDifference>.05,'Actual changing video required');
 assert.equal(decoded.playback.error,null);
 return {file,probe:JSON.parse(await fs.readFile(file+'.probe.json','utf8')),review:decoded,extraReviewExit:review.status};
}
try{
 await launch();
 // Initial schedule exists for the explicit authorization UI; move its time
 // through the ordinary UI after the user invokes the action.
 const initialDue=new Date(Math.ceil(Date.now()/60000)*60000+15*60000);
 const first=await addSchedule('Integrated unattended A',initialDue);
 await page.locator('#authorizationSchedule').selectOption(first.id);
 await page.getByRole('button',{name:'Refresh target/status'}).click();
 const target=await page.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url),sourceUrl);
 await poll(async()=>await page.locator('#authorizationTarget option').count()>1,10000,'target option');
 await page.locator('#authorizationTarget').selectOption(String(target.id));await page.locator('#authorizationReady').check();
 await page.locator('#authorizeTarget').click();
 await source.screenshot({path:path.join(out,'01-human-authorization-target.png')});
 await log('AWAITING_ONE_TOOLBAR_CLICK',{target:{id:target.id,url:target.url},instructions:'On AUTHORIZE INTEGRATED TEST TAB ONCE, click Extensions → Screen Recorder EXPERIMENT once. No capture picker is needed.'});
 let intentRefreshed=Date.now();
 await poll(async()=>{
   if((await read()).tabCaptureAuthorizationEvents?.length===1)return true;
   if(Date.now()-intentRefreshed>240000){
     await page.evaluate(({scheduleId,targetTabId})=>chrome.runtime.sendMessage({type:'TAB_CAPTURE_REQUEST_AUTH',scheduleId,targetTabId}),{scheduleId:first.id,targetTabId:target.id});
     intentRefreshed=Date.now();await log('AUTHORIZATION_INTENT_REFRESHED');
   }
   return false;
 },15*60000,'human toolbar authorization');
 const firstDue=new Date(Math.ceil(Date.now()/60000)*60000+60000),secondDue=new Date(firstDue.getTime()+3*60000);
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#scheduleTime').fill(time(firstDue));
 await page.getByRole('button',{name:'Save schedule',exact:true}).click();
 await addSchedule('Integrated unattended B',secondDue);
 await page.screenshot({path:path.join(out,'02-authorized-schedules.png'),fullPage:true});
 await log('NO_INPUT_INTERVAL_BEGINS',{firstDue:firstDue.toISOString(),secondDue:secondDue.toISOString(),targetId:target.id});
 for(let n=1;n<=2;n++){
   await poll(async()=> (await read()).captureEvents?.filter(e=>e.state==='recording_started').length>=n,5*60000,'automatic recording '+n);
   await page.screenshot({path:path.join(out,'03-recording-'+n+'.png'),fullPage:true});
   await poll(async()=> (await read()).recordingHistory?.filter(h=>h.state==='saved').length>=n,150000,'automatic save '+n);
   const state=await read(),file=state.recordingHistory[0].filename;
   assert.equal(state.tabCaptureAuthorizationEvents.length,1);
   const stopped=state.captureEvents.filter(e=>e.state==='recording_stopped').at(-1);
   assert.ok(stopped.tracks.every(t=>t.state==='ended'));
   assert.equal(await page.evaluate(()=>document.getElementById('preview').srcObject),null);
   report.media.push(await validate(file));
   await page.screenshot({path:path.join(out,'04-saved-'+n+'.png'),fullPage:true});
   await log('INTEGRATED_RECORDING_VERIFIED',{number:n,file,streamFullyReleased:true});
   if(n===1){
     const win=await page.evaluate(async()=>(await chrome.tabs.getCurrent()).windowId);
     await page.evaluate(id=>chrome.windows.update(id,{state:'minimized'}),win);
     await log('TEST_WINDOW_MINIMIZED',{windowId:win});
   }
 }
 await log('NO_INPUT_INTERVAL_ENDS',{authorizedInvocations:(await read()).tabCaptureAuthorizationEvents.length});
 // Real navigation: no source-play button click, so autoplay silence is real.
 const navDue=new Date(Math.ceil(Date.now()/60000)*60000+60000);
 await page.evaluate(async()=>chrome.windows.update((await chrome.tabs.getCurrent()).windowId,{state:'normal'}));
 await addSchedule('Navigation silence negative test',navDue);
 await source.goto('https://integrated-capture.invalid/next');
 await log('SAME_ORIGIN_NAVIGATION',{audioState:await source.evaluate(()=>audio.state)});
 await poll(async()=> (await read()).captureEvents?.find(e=>e.state==='capture_failed' && /silent|suspended/i.test(e.message)),4*60000,'navigation audio rejection');
 assert.equal((await read()).recordingHistory.length,2);
 await page.screenshot({path:path.join(out,'05-navigation-silence-rejected.png'),fullPage:true});
 await source.goto('https://other-capture.invalid/');
 await poll(async()=> !(await page.evaluate(()=>chrome.storage.session.get('tabCaptureGrants'))).tabCaptureGrants?.[sourceUrl],10000,'cross-origin revoke');
 await log('CROSS_ORIGIN_REVOKED');
 const restartDue=new Date(Math.ceil(Date.now()/60000)*60000+60000);
 await addSchedule('Restart requires authorization',restartDue);
 await context.close();await log('BROWSER_CLOSED');await launch();
 await poll(async()=> (await page.locator('#authorizationList').innerText()).includes('UNATTENDED UNAVAILABLE'),15000,'reauthorization UI after restart');
 await page.screenshot({path:path.join(out,'06-restart-needs-authorization.png'),fullPage:true});
 await poll(async()=> (await read()).automationDiagnostic?.message?.includes('Reauthorization required'),4*60000,'restart due alarm rejected');
 const final=await read();assert.equal(final.recordingHistory.length,2);assert.equal(final.tabCaptureAuthorizationEvents.length,1);
 assert.equal(final.captureEvents.filter(e=>e.state==='recording_started').length,2);
 report.final=final;report.status='TWO_INTEGRATED_RECORDINGS_VERIFIED_WITH_SESSION_PRECONDITIONS';
 await log('RESTART_REJECTED_WITHOUT_CAPTURE',{diagnostic:final.automationDiagnostic});
}catch(error){report.status='FAILED_OR_BLOCKED';report.error=error.stack;process.exitCode=1;await log('failure',{message:error.message});if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,status:report.status,error:report.error},null,2));await context?.close();}
