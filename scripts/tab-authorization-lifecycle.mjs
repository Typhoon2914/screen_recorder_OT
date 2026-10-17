import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const out=path.resolve('.test-artifacts','authorization-'+Date.now()),profile=path.resolve('.test-artifacts','az-'+Date.now().toString(36));
await fs.mkdir(out,{recursive:true});
const extension=path.resolve('scripts/fixtures/authorization-probe');
const report={out,profile,scope:'Real tabCapture API lifecycle; diagnostic MediaRecorder, not production engine',captureMocked:false,results:[],status:'AWAITING_USER_INVOCATION'};
const log=async(type,data={})=>{const row={at:new Date().toISOString(),type,...data};await fs.appendFile(path.join(out,'events.jsonl'),JSON.stringify(row)+'\n');console.log(JSON.stringify(row));};
const html='<!doctype html><title>AUTHORIZE THIS CONTROLLED TAB ONCE</title><style>body{background:#123;color:white;font:24px system-ui}button{font:22px system-ui}canvas{display:block}</style><h1>AUTHORIZE THIS CONTROLLED TAB ONCE</h1><p>In Chrome Extensions (puzzle icon), click Recorder Authorization Lifecycle Probe ONCE. Do not click the recorder extension in your regular Chrome.</p><button>Start test tone</button><span id="audio"></span><canvas width="960" height="540"></canvas><script>let c=document.querySelector("canvas"),g=c.getContext("2d"),n=0;function draw(){g.fillStyle="#135";g.fillRect(0,0,960,540);g.fillStyle="#5ea";g.fillRect(n++*5%900,180,60,200);g.fillStyle="white";g.font="24px monospace";g.fillText(new Date().toISOString(),20,60);requestAnimationFrame(draw)}draw();async function tone(){if(!window.a){window.a=new AudioContext();window.o=a.createOscillator();window.v=a.createGain();v.gain.value=.04;o.connect(v).connect(a.destination);o.start()}await a.resume();document.querySelector("#audio").textContent=a.state}document.querySelector("button").onclick=tone;tone().catch(()=>{});</script>';
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const sourceUrl='http://127.0.0.1:'+server.address().port;
let context,worker,source,recorder,id,targetTabId;
async function launch(restart=false){
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,chromiumSandbox:true,viewport:{width:1280,height:850},ignoreDefaultArgs:['--disable-extensions','--unsafely-disable-devtools-self-xss-warnings'],args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');id=new URL(worker.url()).host;
  recorder=await context.newPage();await recorder.goto('chrome-extension://'+id+'/recorder.html');
  const cdp=await context.newCDPSession(recorder);await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});
  await recorder.evaluate(async()=>{const tab=await chrome.tabs.getCurrent();await chrome.storage.local.set({consumerTabId:tab.id});});
  const opened=context.waitForEvent('page');
  const created=await recorder.evaluate(url=>chrome.tabs.create({url}),sourceUrl+(restart?'/restart':'/first'));
  targetTabId=created.id;source=await opened;await source.waitForLoadState();
  if(!restart)await source.getByRole('button').click(); // Source playback only, before authorization.
  await source.bringToFront();
}
async function waitResult(stage,timeout=60000){
  const end=Date.now()+timeout;
  for(;;){
    const stored=await recorder.evaluate(()=>chrome.storage.local.get(['results','fatal','invocations']));
    if(stored.fatal)throw Error(stored.fatal);
    const result=stored.results?.find(r=>r.stage===stage);
    if(result){
      report.invocations=stored.invocations;report.results.push(result);
      await log('attempt-result',result);await recorder.screenshot({path:path.join(out,stage+'.png'),fullPage:true});
      if(result.capture?.saved){
        const media=spawnSync(process.execPath,['scripts/probe-recording.mjs',result.capture.saved.file,'8'],{encoding:'utf8'});
        await fs.writeFile(path.join(out,stage+'-ffprobe.txt'),media.stdout+media.stderr);
        result.mediaValidationExit=media.status;
        assert.equal(media.status,0,'Saved media failed ffprobe: '+media.stderr);
        assert.ok(result.capture.releasedTracks.every(t=>t.readyState==='ended'));
      }
      await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));return result;
    }
    if(Date.now()>end)throw Error('Timed out waiting for '+stage);
    await new Promise(resolve=>setTimeout(resolve,500));
  }
}
async function alarmAttempt(stage){
  // Tab IDs returned by creation remain identifiable without a URL permission.
  // Querying URL metadata would itself fail once activeTab is revoked.
  assert.ok(targetTabId);
  await recorder.evaluate(async({stage,targetTabId})=>{
    await chrome.storage.local.set({nextAttempt:{stage,targetTabId}});
    await chrome.alarms.create('authorization-probe-'+stage,{when:Date.now()+10000});
  },{stage,targetTabId});
  await log('scheduled-without-new-invocation',{stage,targetTabId,sourceAudio:await source.evaluate(()=>({state:window.a?.state,time:window.a?.currentTime}))});
  return waitResult(stage);
}
try{
  await launch();report.browser=context.browser().version();report.extensionId=id;
  await source.screenshot({path:path.join(out,'awaiting-one-time-invocation.png')});
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));
  await log('awaiting-one-time-user-invocation',{out,title:await source.title(),extension:'Recorder Authorization Lifecycle Probe'});
  const first=await waitResult('initial-user-invocation',15*60000);
  assert.ok(first.capture?.saved,'Initial legitimate invocation did not produce saved media');
  await alarmAttempt('second-fresh-same-tab');
  await source.goto(sourceUrl+'/same-origin-navigation');
  await log('same-origin-navigation-no-click');
  await alarmAttempt('fresh-after-same-origin-navigation');
  await context.close();context=null;await log('browser-closed');
  await launch(true);await log('browser-restarted-no-invocation');
  await alarmAttempt('fresh-after-browser-restart');
  assert.equal(report.invocations,1,'Additional invocation invalidates the experiment');
  report.status='EXPERIMENT_COMPLETED';
}catch(error){report.status='BLOCKED_OR_FAILED';report.error=error.stack;process.exitCode=1;await log('failure',{message:error.message});}
finally{
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));
  await context?.close();await new Promise(resolve=>server.close(resolve));
  console.log(JSON.stringify({out,status:report.status,error:report.error},null,2));
}
