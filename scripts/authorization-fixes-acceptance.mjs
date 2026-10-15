// Focused live acceptance of title isolation and transient-loading grant retention.
// Real Chrome APIs, one human toolbar invocation; never seeds grants or mocks media.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const out=path.resolve('.test-artifacts','authorization-fixes-'+Date.now());
await fs.mkdir(out,{recursive:true});
const report={out,startedAt:new Date().toISOString(),status:'RUNNING',events:[],captureMocked:false,
 head:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),
 authorizationModuleSha256:createHash('sha256').update(await fs.readFile('dist/automation/tab_authorization.js')).digest('hex')};
async function log(type,data={}){
 const event={at:new Date().toISOString(),type,...data};report.events.push(event);
 await fs.appendFile(path.join(out,'events.jsonl'),JSON.stringify(event)+'\n');
 await fs.writeFile(path.join(out,'checkpoint.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(event));
}
const url='https://authorization-fixes.invalid/lecture';
const html=title=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><style>body{font:24px system-ui;background:#123;color:white}canvas{display:block}</style><h1>'+title+'</h1><p>Initial setup only: click Extensions → Screen Recorder EXPERIMENT once when asked.</p><button>Play controlled tone</button><canvas width="960" height="540"></canvas><script>const c=document.querySelector("canvas"),g=c.getContext("2d");let n=0;function draw(){g.fillStyle="#135";g.fillRect(0,0,960,540);g.fillStyle="#5eb";g.fillRect(n++*6%900,200,60,250);g.fillStyle="white";g.font="28px monospace";g.fillText(new Date().toISOString(),20,70);requestAnimationFrame(draw)}draw();window.audio=new AudioContext();const o=audio.createOscillator(),v=audio.createGain();v.gain.value=.04;o.connect(v).connect(audio.destination);o.start();document.querySelector("button").onclick=()=>audio.resume();</script>';
let context,page,source,heldRoute,holdNavigation=false;
const read=()=>page.evaluate(()=>chrome.storage.local.get(['automationSchedules','tabCaptureAuthorizationEvents','recordingHistory','captureEvents']));
const status=()=>page.evaluate(()=>chrome.runtime.sendMessage({type:'TAB_CAPTURE_STATUS'}));
const grants=()=>page.evaluate(()=>chrome.storage.session.get('tabCaptureGrants'));
async function poll(fn,timeout,label){
 const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,300));}
 throw Error('Timed out: '+label);
}
const time=d=>new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);
async function add(title,due){
 await page.locator('#lectureName').fill(title);
 await page.locator('#weekday').selectOption(new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',weekday:'long'}).format(due));
 await page.locator('#scheduleTime').fill(time(due));await page.locator('#scheduleDuration').fill('1');
 await page.locator('#targetUrl').fill(url);await page.locator('#captureMode').selectOption('tab');
 await page.getByRole('button',{name:'Save schedule',exact:true}).click();
 return poll(async()=>(await read()).automationSchedules?.find(s=>s.title===title),10000,'saved schedule');
}
try{
 context=await chromium.launchPersistentContext(path.join(out,'profile'),{channel:'chromium',headless:false,chromiumSandbox:true,timezoneId:'Africa/Cairo',viewport:{width:1440,height:1100},
  ignoreDefaultArgs:['--disable-extensions','--unsafely-disable-devtools-self-xss-warnings'],
  args:['--disable-extensions-except='+path.resolve('dist'),'--load-extension='+path.resolve('dist')]});
 report.browser=context.browser().version();
 await context.route('https://authorization-fixes.invalid/**',async route=>{
   if(holdNavigation && route.request().isNavigationRequest()){heldRoute=route;return;}
   await route.fulfill({contentType:'text/html',body:html('AUTHORIZE FIXES TEST TAB ONCE')});
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 source=await context.newPage();await source.goto(url);
 await source.getByRole('button',{name:'Play controlled tone'}).click();
 page=await context.newPage();await page.goto('chrome-extension://'+new URL(worker.url()).host+'/pages/recorder.html');
 await page.waitForFunction(()=>!document.getElementById('startBtn').disabled);
 const cdp=await context.newCDPSession(page);
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});
 await page.exposeFunction('acceptanceLog',log);
 await page.evaluate(()=>{
   chrome.alarms.onAlarm.addListener(alarm=>window.acceptanceLog('real-alarm',{alarm}));
   chrome.storage.onChanged.addListener((changes,area)=>{
     if(area==='local')for(const key of ['captureEvents','automationDiagnostic','recordingHistory'])
       if(changes[key])window.acceptanceLog('application-state',{key,value:changes[key].newValue});
   });
 });
 const first=await add('Lecture Alpha — not the tab title',new Date(Date.now()+30*60000));
 const second=await add('Lecture Beta — same authorized tab',new Date(Date.now()+40*60000));
 await page.locator('#authorizationSchedule').selectOption(first.id);
 await page.getByRole('button',{name:'Refresh target/status'}).click();
 const target=await page.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url),url);
 await poll(async()=>await page.locator('#authorizationTarget option').count()>1,10000,'target option');
 await page.locator('#authorizationTarget').selectOption(String(target.id));
 await page.locator('#authorizationReady').check();await page.locator('#authorizeTarget').click();
 await source.screenshot({path:path.join(out,'01-authorize-once.png')});
 await log('AWAITING_ONE_TOOLBAR_CLICK',{targetId:target.id,url});
 let refreshed=Date.now();
 await poll(async()=>{
   if((await read()).tabCaptureAuthorizationEvents?.length===1)return true;
   if(Date.now()-refreshed>240000){
     await page.evaluate(({scheduleId,targetTabId})=>chrome.runtime.sendMessage({type:'TAB_CAPTURE_REQUEST_AUTH',scheduleId,targetTabId}),{scheduleId:first.id,targetTabId:target.id});
     refreshed=Date.now();
   }
   return false;
 },15*60000,'human toolbar invocation');
 const before=await grants(),initial=await status();
 assert.equal(initial.ok,true);
 for(const s of [first,second]){
   const item=initial.items.find(x=>x.scheduleId===s.id);
   assert.equal(item.title,s.title);assert.equal(item.tabTitle,'AUTHORIZE FIXES TEST TAB ONCE');assert.equal(item.available,true);
 }
 await page.getByRole('button',{name:'Refresh target/status'}).click();
 await poll(async()=>{const text=await page.locator('#authorizationList').innerText();return text.includes(first.title)&&text.includes(second.title)&&!text.includes('UNATTENDED UNAVAILABLE');},10000,'distinct schedule labels');
 await page.screenshot({path:path.join(out,'02-distinct-lecture-titles.png'),fullPage:true});
 await log('TITLE_FIX_PASS',{items:initial.items.map(({title,tabTitle,tabId,available})=>({title,tabTitle,tabId,available}))});
 // Hold a real same-origin reload at the HTTP response, not a mocked tabs API.
 holdNavigation=true;
 const navigation=source.reload({timeout:90000}).then(()=>({ok:true}),error=>({error:error.message}));
 await poll(()=>heldRoute,10000,'held document request');
 const loadingTab=await poll(async()=>{const t=await page.evaluate(id=>chrome.tabs.get(id),target.id);return t.status==='loading'?{id:t.id,status:t.status,url:t.url,pendingUrl:t.pendingUrl}:false;},10000,'real Chrome loading state');
 const during=await status();assert.equal(during.ok,true);
 for(const item of during.items){assert.equal(item.available,false);assert.match(item.message,/Target is loading/);assert.doesNotMatch(item.message,/Reauthorization/);}
 assert.deepEqual(await grants(),before);
 await page.getByRole('button',{name:'Refresh target/status'}).click();
 await poll(async()=>(await page.locator('#authorizationList').innerText()).includes('Target is loading'),10000,'loading UI');
 await page.screenshot({path:path.join(out,'03-loading-grant-retained.png'),fullPage:true});
 await log('LOADING_GRANT_RETAINED',{tab:loadingTab,items:during.items});
 holdNavigation=false;await heldRoute.fulfill({contentType:'text/html',body:html('Reloaded source title — not lecture names')});heldRoute=null;
 assert.equal((await navigation).ok,true);
 await poll(async()=> (await page.evaluate(id=>chrome.tabs.get(id),target.id)).status==='complete',10000,'reload completion');
 const after=await status();assert.equal(after.ok,true);assert.deepEqual(await grants(),before);
 for(const s of [first,second]){
   const item=after.items.find(x=>x.scheduleId===s.id);
   assert.equal(item.available,true);assert.equal(item.title,s.title);assert.equal(item.tabTitle,'Reloaded source title — not lecture names');
 }
 assert.equal((await read()).tabCaptureAuthorizationEvents.length,1);
 await page.getByRole('button',{name:'Refresh target/status'}).click();
 await poll(async()=>!(await page.locator('#authorizationList').innerText()).includes('UNATTENDED UNAVAILABLE'),10000,'eligibility restored');
 await page.screenshot({path:path.join(out,'04-reloaded-grant-restored.png'),fullPage:true});
 await log('LOADING_FIX_PASS',{items:after.items.map(({title,tabTitle,tabId,available})=>({title,tabTitle,tabId,available})),authorizationCount:1});
 // Legitimate source playback after reload; this is NOT extension authorization.
 await source.getByRole('button',{name:'Play controlled tone'}).click();
 await poll(()=>source.evaluate(()=>audio.state==='running'),10000,'source audio playback');
 await log('SOURCE_PLAYBACK_RESUMED',{reason:'Controlled-page autoplay after navigation; not a capture authorization'});
 const due=new Date(Math.ceil(Date.now()/60000)*60000+60000);
 await page.locator('#scheduleList').getByRole('button',{name:'Edit',exact:true}).first().click();
 await page.locator('#scheduleTime').fill(time(due));
 await page.getByRole('button',{name:'Save schedule',exact:true}).click();
 await log('NO_INPUT_INTERVAL_BEGINS',{due:due.toISOString()});
 await poll(async()=>(await read()).captureEvents?.some(e=>e.state==='recording_started'),5*60000,'scheduled capture after reload');
 await page.screenshot({path:path.join(out,'05-scheduled-recording.png'),fullPage:true});
 const history=await poll(async()=>(await read()).recordingHistory?.find(h=>h.state==='saved'),150000,'automatic save');
 const final=await read();assert.equal(final.tabCaptureAuthorizationEvents.length,1);
 assert.ok(final.captureEvents.find(e=>e.state==='recording_stopped').tracks.every(t=>t.state==='ended'));
 assert.equal(final.captureEvents.filter(e=>e.state==='recording_started').length,1);
 for(const [script,args] of [['scripts/probe-recording.mjs',[history.filename,'60']],['scripts/review-capture-media.mjs',[history.filename]]]){
   const run=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
   await fs.writeFile(path.join(out,path.basename(script)+'.txt'),(run.stdout||'')+(run.stderr||''));
   assert.equal(run.status,0,script+' failed; see retained log');
 }
 report.media={file:history.filename,probe:JSON.parse(await fs.readFile(history.filename+'.probe.json','utf8')),review:JSON.parse(await fs.readFile(history.filename+'.review.json','utf8'))};
 assert.equal(report.media.review.passed,true);
 await page.screenshot({path:path.join(out,'06-saved-after-reload.png'),fullPage:true});
 await log('SCHEDULED_CAPTURE_AFTER_RELOAD_PASS',{file:history.filename,bytes:history.bytes,authorizationCount:1});
 report.status='BOTH_AUTHORIZATION_FIXES_VERIFIED_IN_REAL_CHROME';
}catch(error){report.status='FAILED_OR_BLOCKED';report.error=error.stack;process.exitCode=1;await log('failure',{message:error.message});
 if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
}finally{
 if(heldRoute)await heldRoute.abort().catch(()=>{});
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({out,status:report.status,error:report.error},null,2));await context?.close();
}
