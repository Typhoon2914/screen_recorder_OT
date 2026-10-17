// Deterministic operator for the unchanged production extension. No capture
// mocks, fake-device flags, permission overrides, native-picker clicks or OBS.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const humanPicker=process.argv.includes('--human-picker');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const out=path.resolve('.test-artifacts','browser-agent-'+Date.now()),profile=path.resolve('.test-artifacts','ba-'+Date.now().toString(36));
await fs.mkdir(out,{recursive:true});
const report={out,profile,status:'RUNNING',captureMocked:false,permissionOverrides:false,humanPickerMode:humanPicker,nativeAdapter:'Not configured',events:[]};
const log=async(type,data={})=>{
  const row={at:new Date().toISOString(),type,...data};report.events.push(row);
  await fs.appendFile(path.join(out,'events.jsonl'),JSON.stringify(row)+'\n');console.log(JSON.stringify(row));
};
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,chromiumSandbox:true,timezoneId:'Africa/Cairo',viewport:{width:1440,height:1000},ignoreDefaultArgs:['--disable-extensions','--unsafely-disable-devtools-self-xss-warnings'],args:['--disable-extensions-except='+path.resolve('dist'),'--load-extension='+path.resolve('dist')]});
let page;
async function snapshot(){
  return page.evaluate(async()=>({
    status:document.getElementById('statusPill').textContent,detail:document.getElementById('detail').textContent,
    tracks:[...(document.getElementById('preview').srcObject?.getTracks() || [])].map(t=>({kind:t.kind,readyState:t.readyState,settings:t.getSettings()})),
    storage:await chrome.storage.local.get(['automationPendingRecording','automationActiveRecording','recordingHistory','automationTargetTabs']),
    downloads:await chrome.downloads.search({})
  }));
}
try{
  const url='https://recorder-agent.invalid/controlled-av';
  await context.route('https://recorder-agent.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>CONTROLLED AV — BROWSER AGENT</title><style>body{background:#123;color:white;font:24px system-ui}canvas{display:block}</style><h1>CONTROLLED AV — BROWSER AGENT</h1><button>Start synthetic tone</button><span id="sound">Not playing</span><canvas width="960" height="540"></canvas><script>const c=document.querySelector("canvas"),g=c.getContext("2d");let n=0;function draw(){g.fillStyle="#135";g.fillRect(0,0,960,540);g.fillStyle="#5eb";g.fillRect(n++*6%900,200,60,250);g.fillStyle="white";g.font="28px monospace";g.fillText(new Date().toISOString(),20,70);requestAnimationFrame(draw)}draw();document.querySelector("button").onclick=async()=>{window.audio=new AudioContext();window.osc=audio.createOscillator();window.gain=audio.createGain();gain.gain.value=.04;osc.connect(gain).connect(audio.destination);osc.start();await audio.resume();document.querySelector("#sound").textContent=audio.state;}</script>'}));
  const source=await context.newPage();await source.goto(url);
  await source.getByRole('button',{name:'Start synthetic tone',exact:true}).click();
  await source.waitForFunction(()=>window.audio?.state==='running');
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId=new URL(worker.url()).host;report.browser=context.browser().version();report.extensionId=extensionId;
  page=await context.newPage();await page.goto('chrome-extension://'+extensionId+'/pages/recorder.html');
  await page.waitForFunction(()=>!document.getElementById('startBtn').disabled);
  page.on('pageerror',error=>log('page-error',{message:error.message}));
  page.on('dialog',dialog=>log('javascript-dialog',{type:dialog.type(),message:dialog.message()})); // Never accept a permission.
  await page.exposeFunction('agentEvidence',log);
  await page.evaluate(()=>{
    chrome.alarms.onAlarm.addListener(alarm=>window.agentEvidence('actual-alarm',{alarm}));
    chrome.downloads.onChanged.addListener(delta=>window.agentEvidence('actual-download-change',{delta}));
  });
  const cdp=await context.newCDPSession(page);
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});
  const matches=await page.evaluate(async url=>(await chrome.tabs.query({})).filter(t=>t.url===url),url);
  assert.equal(matches.length,1,'Refuse ambiguous target');report.target={id:matches[0].id,url};
  const due=new Date(Math.ceil(Date.now()/60000)*60000+60000);
  const localTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(due);
  const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',weekday:'long'}).format(due);
  await page.locator('#lectureName').fill('Browser agent controlled acceptance');
  await page.locator('#weekday').selectOption(weekday);await page.locator('#scheduleTime').fill(localTime);
  await page.locator('#scheduleDuration').fill('1');await page.locator('#targetUrl').fill(url);
  await page.getByRole('button',{name:'Save schedule',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('scheduleStatus').textContent==='Schedule saved');
  await page.screenshot({path:path.join(out,'01-schedule-configured.png'),fullPage:true});
  await log('waiting-for-production-scheduler',{due:due.toISOString(),localTime,target:report.target});
  await page.waitForFunction(()=>document.getElementById('detail').textContent.includes('Scheduled recording ready'),null,{timeout:due.getTime()-Date.now()+125000});
  const pending=await snapshot();
  assert.equal(Object.values(pending.storage.automationTargetTabs).find(t=>t.url===url)?.tabId,report.target.id);
  assert.equal(source.url(),url);assert.equal(await source.evaluate(()=>window.audio.state),'running');
  await log('normal-start-click',{before:pending});
  await page.locator('#startBtn').click({timeout:10000});
  await new Promise(resolve=>setTimeout(resolve,5000));
  report.afterClick=await snapshot();
  report.pageDialogCount=await page.getByRole('dialog').count();
  report.browserTargets=(await cdp.send('Target.getTargets')).targetInfos.map(t=>({type:t.type,url:t.url}));
  await page.screenshot({path:path.join(out,'02-after-normal-start-page-only.png'),fullPage:true});
  await log('after-start-observation',{state:report.afterClick,pageDialogCount:report.pageDialogCount});
  if(!humanPicker && report.afterClick.status!=='Recording'){
    report.status='BLOCKED_CAPTURE_PENDING';report.reason='Normal Start click completed, but no live capture. Native chooser is outside Playwright page DOM; appearance needs native observation or human confirmation.';
  }else{
    if(humanPicker){
      await log('awaiting-human-picker',{instructions:'Select CONTROLLED AV — BROWSER AGENT Chrome tab, include tab audio, then Share. This manual action does NOT count as unattended acceptance.'});
      await fs.writeFile(path.join(out,'checkpoint.json'),JSON.stringify(report,null,2));
    }
    await page.waitForFunction(()=>document.getElementById('statusPill').textContent==='Recording' && document.getElementById('preview').srcObject?.getTracks().filter(t=>t.readyState==='live').length>=2,null,{timeout:humanPicker?300000:15000});
    const started=await snapshot();
    assert.ok(started.tracks.some(t=>t.kind==='video'&&t.settings.displaySurface==='browser'));
    assert.ok(started.tracks.some(t=>t.kind==='audio'));
    await log('real-recording-started',{state:started});
    await page.screenshot({path:path.join(out,'03-real-recording.png'),fullPage:true});
    await page.waitForFunction(()=>document.getElementById('statusPill').textContent==='saved',null,{timeout:180000});
    report.final=await snapshot();report.file=report.final.storage.recordingHistory?.[0]?.filename;
    assert.ok(report.file);
    const probe=spawnSync(process.execPath,['scripts/probe-recording.mjs',report.file,'60'],{encoding:'utf8'});
    await fs.writeFile(path.join(out,'ffprobe.txt'),probe.stdout+probe.stderr);assert.equal(probe.status,0,probe.stderr);
    await page.screenshot({path:path.join(out,'04-auto-saved.png'),fullPage:true});
    report.status=humanPicker?'VERIFIED_WITH_MANUAL_PICKER':'UNATTENDED_CAPTURE_VERIFIED';
    await log('verified-save',{file:report.file,status:report.status});
  }
}catch(error){report.status='FAILED';report.error=error.stack;process.exitCode=1;await log('failure',{message:error.message});}
finally{
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({out,status:report.status,error:report.error},null,2));
  await context.close();
}
