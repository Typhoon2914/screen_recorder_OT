// Actual production scheduler, no arm, Start click, picker automation or capture
// substitution. Only the controlled HTTPS media page is supplied as a fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const out=path.resolve('.test-artifacts','cold-'+Date.now());
const profile=path.resolve('.test-artifacts','cp-'+Date.now().toString(36));
await fs.mkdir(out,{recursive:true});
const report={out,profile,goal:'Fresh extension-only scheduled start/stop/save',status:'NOT_COMPLETED',sourceIsSynthetic:true,captureMocked:false,armed:false,recorderStartClicked:false,events:[]};
const log=async(type,data={})=>{
  const event={at:new Date().toISOString(),type,...data};report.events.push(event);
  await fs.appendFile(path.join(out,'events.jsonl'),JSON.stringify(event)+'\n');console.log(JSON.stringify(event));
};
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,chromiumSandbox:true,timezoneId:'Africa/Cairo',viewport:{width:1440,height:1050},ignoreDefaultArgs:['--disable-extensions','--unsafely-disable-devtools-self-xss-warnings'],args:['--disable-extensions-except='+path.resolve('dist'),'--load-extension='+path.resolve('dist')]});
let recorder;
try{
  const targetUrl='https://recorder-test.invalid/controlled-av';
  await context.route('https://recorder-test.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<title>CONTROLLED COLD SCHEDULE TEST</title><h1>Controlled audio/video fixture</h1><button>Play test tone</button><canvas width="960" height="540"></canvas><script>let n=0,c=document.querySelector("canvas"),g=c.getContext("2d");function draw(){g.fillStyle="#123456";g.fillRect(0,0,960,540);g.fillStyle="white";g.fillRect((n++*4)%900,100,60,200);requestAnimationFrame(draw)}draw();document.querySelector("button").onclick=async()=>{window.a=new AudioContext();window.o=a.createOscillator();window.v=a.createGain();v.gain.value=.03;o.connect(v).connect(a.destination);o.start();await a.resume();}</script>'}));
  const source=await context.newPage();await source.goto(targetUrl);await source.getByRole('button').click();
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;report.browser=context.browser().version();report.extensionId=id;
  recorder=await context.newPage();await recorder.goto('chrome-extension://'+id+'/pages/recorder.html');
  await recorder.waitForFunction(()=>!document.getElementById('startBtn').disabled);
  await recorder.exposeFunction('coldEvidence',log);
  await recorder.evaluate(()=>{
    chrome.alarms.onAlarm.addListener(alarm=>window.coldEvidence('actual-chrome-alarm',{alarm}));
    chrome.runtime.onMessage.addListener(message=>{window.coldEvidence('runtime-message',{message});return false;});
  });
  const due=new Date(Math.ceil(Date.now()/60000)*60000+60000);
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(due);
  const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',weekday:'long'}).format(due);
  await recorder.locator('#lectureName').fill('Cold extension-only acceptance');
  await recorder.locator('#weekday').selectOption(weekday);await recorder.locator('#scheduleTime').fill(time);
  await recorder.locator('#scheduleDuration').fill('1');await recorder.locator('#targetUrl').fill(targetUrl);
  await recorder.getByRole('button',{name:'Save schedule',exact:true}).click();
  await recorder.waitForFunction(()=>document.getElementById('scheduleStatus').textContent==='Schedule saved');
  const before=await recorder.evaluate(async()=>({alarms:await chrome.alarms.getAll(),config:await chrome.storage.local.get(['automationSchedules','nativeCompanion']),tracks:document.getElementById('preview').srcObject?.getTracks().length || 0}));
  assert.equal(before.tracks,0);assert.ok(!before.config.nativeCompanion?.enabled);
  assert.ok(before.alarms.some(a=>a.name==='screen-recorder-automation-poll'));
  await recorder.screenshot({path:path.join(out,'01-scheduled-unarmed.png'),fullPage:true});
  await log('no-recorder-input-interval-begins',{due:due.toISOString(),localTime:time,timeZone:'Africa/Cairo',before});
  await recorder.waitForFunction(()=>document.getElementById('detail').textContent.includes('Scheduled recording ready'),null,{timeout:due.getTime()-Date.now()+125000});
  await new Promise(resolve=>setTimeout(resolve,10000));
  report.final=await recorder.evaluate(async()=>({
    detail:document.getElementById('detail').textContent,status:document.getElementById('statusPill').textContent,
    tracks:document.getElementById('preview').srcObject?.getTracks().length || 0,
    storage:await chrome.storage.local.get(['automationPendingRecording','automationActiveRecording','automationTargetTabs','automationHandledOccurrenceKeys','recordingHistory']),
    downloads:await chrome.downloads.search({})
  }));
  await recorder.screenshot({path:path.join(out,'02-scheduler-waiting-for-approval.png'),fullPage:true});
  assert.ok(report.final.storage.automationPendingRecording);
  assert.ok(Object.values(report.final.storage.automationTargetTabs || {}).some(t=>t.url===targetUrl));
  assert.equal(report.final.tracks,0);assert.equal(report.final.downloads.length,0);
  report.status='BLOCKED_BY_CAPTURE_AUTHORIZATION';
  report.schedulerDispatched=true;report.targetIdentified=true;report.recordingStarted=false;report.saved=false;
  await log('no-recorder-input-interval-ends',{status:report.status,final:report.final});
}catch(error){report.status='UNEXPECTED_TEST_FAILURE';report.error=error.stack;process.exitCode=1;}
finally{
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({out,status:report.status,error:report.error},null,2));
  await context.close();
}
