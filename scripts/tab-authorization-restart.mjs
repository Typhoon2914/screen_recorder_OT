// Resume the restart leg from an actual prior authorized run. No new invocation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const original=JSON.parse(await fs.readFile(path.join(process.argv[2],'results.json'),'utf8'));
assert.ok(original.results.some(r=>r.stage==='initial-user-invocation'&&r.capture?.saved));
const originalUrl=original.results[0].activeTabProbe.result[0].result.url;
const out=path.resolve('.test-artifacts','authorization-restart-'+Date.now());await fs.mkdir(out,{recursive:true});
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const extension=path.resolve('scripts/fixtures/authorization-probe');
const context=await chromium.launchPersistentContext(original.profile,{channel:'chromium',headless:false,chromiumSandbox:true,ignoreDefaultArgs:['--disable-extensions','--unsafely-disable-devtools-self-xss-warnings'],args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
const report={out,originalRun:original.out,profile:original.profile,newHumanInvocation:false,sourceIsSynthetic:true};
try{
  const url=new URL('/restart-verification',originalUrl).href;
  await context.route(new URL(originalUrl).origin+'/**',route=>route.fulfill({contentType:'text/html',body:'<title>CONTROLLED RESTART — NO AUTHORIZATION</title><h1>Restart check; do not invoke extension.</h1><canvas width="640" height="360"></canvas><script>let c=document.querySelector("canvas"),g=c.getContext("2d"),n=0;setInterval(()=>{g.fillStyle="#123";g.fillRect(0,0,640,360);g.fillStyle="white";g.fillRect(n++*5%600,100,40,100)},33);window.a=new AudioContext();window.o=a.createOscillator();window.v=a.createGain();v.gain.value=.04;o.connect(v).connect(a.destination);o.start();a.resume().catch(()=>{});</script>'}));
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host,recorder=await context.newPage();
  await recorder.goto('chrome-extension://'+id+'/recorder.html');
  const cdp=await context.newCDPSession(recorder);await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out});
  await recorder.evaluate(async()=>chrome.storage.local.set({consumerTabId:(await chrome.tabs.getCurrent()).id}));
  const opened=context.waitForEvent('page');
  const target=await recorder.evaluate(()=>chrome.tabs.create({url:'about:blank'}));
  const source=await opened;await source.goto(url);assert.equal(source.url(),url);
  report.before=await recorder.evaluate(()=>chrome.storage.local.get(['invocations']));
  const stage='restart-retest-known-tab-id-'+Date.now();
  await recorder.evaluate(async({stage,targetTabId})=>{
    for(const alarm of await chrome.alarms.getAll())if(alarm.name.startsWith('authorization-probe-'))await chrome.alarms.clear(alarm.name);
    await chrome.storage.local.set({nextAttempt:{stage,targetTabId}});
    await chrome.alarms.create('authorization-probe-'+stage,{when:Date.now()+10000});
  },{stage,targetTabId:target.id});
  for(let n=0;n<120;n++){
    report.after=await recorder.evaluate(()=>chrome.storage.local.get(['results','invocations']));
    report.result=report.after.results?.find(r=>r.stage===stage);
    if(report.result)break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(report.result,'No result from actual restart alarm');delete report.after.results;
  assert.equal(report.after.invocations,report.before.invocations);
  await recorder.locator('#evidence').evaluate((el,result)=>el.textContent=JSON.stringify(result,null,2),report.result);
  await recorder.screenshot({path:path.join(out,'restart-result.png'),fullPage:true});
  if(report.result.capture?.saved){
    const p=spawnSync(process.execPath,['scripts/probe-recording.mjs',report.result.capture.saved.file,'8'],{encoding:'utf8'});
    await fs.writeFile(path.join(out,'ffprobe.txt'),p.stdout+p.stderr);report.mediaValidationExit=p.status;
  }
  report.status='EXPERIMENT_COMPLETED';
}catch(error){report.status='FAILED';report.error=error.stack;process.exitCode=1;}
finally{await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();}
