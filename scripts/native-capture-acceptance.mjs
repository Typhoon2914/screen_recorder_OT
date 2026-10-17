// Real native window/audio capture. No getDisplayMedia, fake media or picker.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import OBSWebSocket from 'obs-websocket-js';
import {recordWithObs} from '../companion/recording.js';
import {dueSchedules} from '../src/automation/scheduler.js';
import {verifyNativeMedia} from '../companion/media.js';
import {pathToFileURL} from 'node:url';
import {analyzeSyntheticMedia} from './native-signal-analysis.mjs';
const scenario=process.argv[2] || 'fresh';
if(!['fresh','restart','minimized','reload','extended','integrated','integrated-restart'].includes(scenario))throw Error('Unknown scenario');
const integrated=['integrated','integrated-restart','extended'].includes(scenario);
const minutes=scenario==='extended'?10:1;
const out=path.resolve('.test-artifacts','native-'+scenario+'-'+Date.now());
await fs.mkdir(out,{recursive:true});
const connection=JSON.parse(await fs.readFile('.test-artifacts/obs-connection.json','utf8'));
const obs=new OBSWebSocket();let context,server,companion,recorder,pairing;
const report={out,scenario,status:'FAILED',captureAuthorizationUsed:false,events:[]};
async function event(type,data={}){
  const row={at:new Date().toISOString(),type,...data};report.events.push(row);
  await fs.appendFile(path.join(out,'events.jsonl'),JSON.stringify(row)+'\n');console.log(JSON.stringify(row));
}
function sourceScript(){
  const canvas=document.querySelector('canvas'),g=canvas.getContext('2d');let n=0;
  function draw(){g.fillStyle='#173956';g.fillRect(0,0,960,540);g.fillStyle='#58ebbe';g.fillRect((n*7)%900,250,60,150);g.fillStyle='white';g.font='30px monospace';g.fillText('NATIVE WINDOW CAPTURE '+n++,20,70);g.fillText(new Date().toISOString(),20,125);requestAnimationFrame(draw)}draw();
  document.querySelector('button').onclick=async()=>{
    const a=new AudioContext(),o=a.createOscillator(),gain=a.createGain();globalThis.testAudio={context:a,oscillator:o,gain};o.frequency.value=440;gain.gain.value=.07;o.connect(gain).connect(a.destination);o.start();await a.resume();
    document.querySelector('button').disabled=true;document.querySelector('span').textContent='Controlled audio running';
  };
}
const html='<title>CONTROLLED NATIVE AV TEST</title><style>body{background:#173956;color:white;font:22px system-ui}canvas{display:block}button{font:22px system-ui}</style><h1>CONTROLLED NATIVE AV TEST</h1><button>Start controlled tone</button><span></span><canvas width="960" height="540"></canvas><script>('+sourceScript.toString()+')()</script>';
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const profile=path.resolve('.test-artifacts','np-'+Date.now().toString(36));
async function launch(){
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,chromiumSandbox:true,viewport:{width:1280,height:800},ignoreDefaultArgs:['--disable-extensions','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--unsafely-disable-devtools-self-xss-warnings'],args:integrated?['--disable-extensions-except='+path.resolve('dist'),'--load-extension='+path.resolve('dist')]:[]});
  const page=context.pages()[0];await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.getByRole('button').click();
  return page;
}
async function openRecorder(){
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  const next=context.waitForEvent('page');
  await worker.evaluate(id=>chrome.windows.create({url:'chrome-extension://'+id+'/pages/recorder.html'}),id);
  recorder=await next;await recorder.waitForSelector('#nativeSave');
  return id;
}
async function health(){
  const r=await fetch('http://127.0.0.1:17653/health',{headers:{Origin:pairing.origin,Authorization:'Bearer '+pairing.token}});
  if(!r.ok)throw Error('Companion health HTTP '+r.status);return r.json();
}
try{
  await obs.connect(connection.endpoint,connection.password,{rpcVersion:1,eventSubscriptions:65536});
  for(const [name,key] of [['GetProfileList','currentProfileName'],['GetSceneCollectionList','currentSceneCollectionName']])assert.equal((await obs.call(name))[key],'ScreenRecorderExperiment');
  assert.equal((await obs.call('GetRecordStatus')).outputActive,false,'Refuse existing recording');
  await obs.call('SetVideoSettings',{baseWidth:1280,baseHeight:720,outputWidth:1280,outputHeight:720,fpsNumerator:30,fpsDenominator:1});
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let page=await launch();
  const inputName='Controlled Chrome Window '+Date.now();
  // Only sources created by this harness, in the verified isolated collection.
  for(const input of (await obs.call('GetInputList')).inputs){
    if(input.inputName.startsWith('Controlled Chrome Window'))await obs.call('RemoveInput',{inputName:input.inputName});
  }
  if(!(await obs.call('GetInputList')).inputs.some(i=>i.inputName===inputName)){
    await obs.call('CreateInput',{sceneName:connection.expectedScene,inputName,inputKind:'window_capture',inputSettings:{},sceneItemEnabled:true});
  }
  const windows=await obs.call('GetInputPropertiesListPropertyItems',{inputName,propertyName:'window'});
  const candidates=windows.propertyItems.filter(i=>i.itemName.includes('CONTROLLED NATIVE AV TEST') && i.itemEnabled);
  assert.equal(candidates.length,1,'Must uniquely identify controlled Chrome window');
  const target=candidates[0];
  // A fresh native source avoids retaining an old process-loopback audio binding.
  // This never invokes a Chrome capture API or user permission prompt.
  await obs.call('SetInputSettings',{inputName,inputSettings:{window:target.itemValue,priority:0,method:2,capture_audio:true,cursor:false,client_area:true},overlay:true});
  const item=await obs.call('GetSceneItemId',{sceneName:connection.expectedScene,sourceName:inputName});
  await obs.call('SetSceneItemEnabled',{sceneName:connection.expectedScene,sceneItemId:item.sceneItemId,sceneItemEnabled:true});
  await obs.call('SetSceneItemTransform',{sceneName:connection.expectedScene,sceneItemId:item.sceneItemId,sceneItemTransform:{positionX:0,positionY:0,boundsType:'OBS_BOUNDS_SCALE_INNER',boundsWidth:1280,boundsHeight:720}});
  let audioPeak=0;
  obs.on('InputVolumeMeters',({inputs})=>{
    for(const input of inputs.filter(i=>i.inputName===inputName))for(const channel of input.inputLevelsMul)audioPeak=Math.max(audioPeak,...channel);
  });
  for(let n=0;n<20 && audioPeak<=.001;n++)await new Promise(resolve=>setTimeout(resolve,500));
  await event('one-time-native-source-configured',{target,inputSettings:await obs.call('GetInputSettings',{inputName}),source:await obs.call('GetSourceActive',{sourceName:inputName}),audioPeak,sourceAudio:await page.evaluate(()=>({state:globalThis.testAudio?.context.state,time:globalThis.testAudio?.context.currentTime,visibility:document.visibilityState}))});
  if(!integrated)assert.ok(audioPeak>0.001,'Native source has no audible test signal');
  else if(audioPeak<=.001)await event('setup-audio-warning',{message:'Preview meter has no signal; the fresh provider must independently pass its audio gate and saved-media analysis'});
  if(scenario==='restart'){await context.close();await event('chrome-closed');page=await launch();await event('chrome-restarted');}
  if(scenario==='reload'){await page.reload();await page.getByRole('button').click();await event('source-reloaded');}
  if(scenario==='minimized'){
    const cdp=await context.newCDPSession(page);const {windowId}=await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});
    await event('chrome-minimized');
  }
  const screenshot=await obs.call('GetSourceScreenshot',{sourceName:connection.expectedScene,imageFormat:'png',imageWidth:1280,imageHeight:720});
  await fs.writeFile(path.join(out,'01-native-preview.png'),Buffer.from(screenshot.imageData.split(',')[1],'base64'));
  const due=new Date(Math.ceil(Date.now()/60000)*60000+120000);
  const schedule={id:'native-'+scenario,title:'Native '+scenario,enabled:true,weekdays:[['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][due.getDay()]],time:due.toTimeString().slice(0,5),launchWindowSeconds:120,durationMinutes:minutes};
  if(integrated){
    // The one-time diagnostic source is torn down before scheduling. The
    // companion creates a NEW source only when the occurrence becomes due.
    await obs.call('RemoveInput',{inputName});
    for(let n=0;n<20 && (await obs.call('GetSceneItemList',{sceneName:connection.expectedScene})).sceneItems.length;n++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal((await obs.call('GetSceneItemList',{sceneName:connection.expectedScene})).sceneItems.length,0);
    await event('idle-native-capture-released',{inputs:(await obs.call('GetInputList')).inputs});
    const id=await openRecorder();
    pairing={...connection,inputName,window:target.itemValue,targetUrl:'',token:randomBytes(32).toString('hex'),origin:'chrome-extension://'+id,stateDirectory:path.join(out,'companion-state')};
    const configFile=path.join(out,'paired-config.json');
    await fs.writeFile(configFile,JSON.stringify(pairing,null,2),{mode:0o600});
    companion=spawn(process.execPath,['companion/server.mjs',configFile],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    companion.stdout.on('data',chunk=>fs.appendFile(path.join(out,'companion.stdout.log'),chunk));
    companion.stderr.on('data',chunk=>fs.appendFile(path.join(out,'companion.stderr.log'),chunk));
    for(let n=0;;n++){try{await health();break;}catch(error){if(n>=20)throw error;await new Promise(resolve=>setTimeout(resolve,250));}}
    await recorder.locator('#lectureName').fill(schedule.title);
    await recorder.locator('#weekday').selectOption(schedule.weekdays[0]);
    await recorder.locator('#scheduleTime').fill(schedule.time);
    await recorder.locator('#scheduleDuration').fill(String(minutes));
    await recorder.getByRole('button',{name:'Save schedule',exact:true}).click();
    await recorder.waitForFunction(()=>document.getElementById('scheduleStatus').textContent==='Schedule saved');
    await recorder.locator('#nativeToken').fill(pairing.token);
    await recorder.locator('#nativeEnabled').check();await recorder.locator('#nativeSave').click();
    await recorder.waitForFunction(()=>document.getElementById('nativeStatus').textContent==='Native: idle');
    await recorder.screenshot({path:path.join(out,'02-native-paired-schedule.png'),fullPage:true});
    if(scenario==='integrated-restart'){
      await context.close();await event('chrome-closed-after-pairing');
      page=await launch();await openRecorder();await event('chrome-restarted-with-persisted-native-config');
    }
    await event('extension-schedules-synced',{state:await health()});
  }
  await event('scheduled-idle-no-armed-capture',{scheduledFor:due.toISOString(),schedule,obs:await obs.call('GetRecordStatus'),sceneItems:integrated?(await obs.call('GetSceneItemList',{sceneName:connection.expectedScene})).sceneItems:undefined});
  await event('input-free-interval-begins');
  for(;;){
    const d=new Date(),now={date:d.toLocaleDateString('en-CA'),weekday:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()],time:d.toTimeString().slice(0,8)};
    if(dueSchedules([schedule],now).length)break;
    if(Date.now()>due.getTime()+125000)throw Error('Missed schedule');
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  await event('scheduled-trigger');
  let result;
  if(integrated){
    for(;;){
      const state=await health();
      if(state.phase==='recovery_required')throw Error(state.active?.message || 'Native recovery required');
      if(state.history[0]?.state==='saved'){result={...state.history[0]};break;}
      if(Date.now()>due.getTime()+(minutes+3)*60000)throw Error('Native integrated capture did not finish');
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    await recorder.waitForFunction(()=>document.getElementById('historyList').textContent.includes('saved'),null,{timeout:90000});
    await recorder.screenshot({path:path.join(out,'03-native-history.png'),fullPage:true});
  }else result=await recordWithObs({...connection,ready:true,durationMs:minutes*60000,rpc:async(name)=>{
    const result=await obs.call(name);
    if(['StartRecord','StopRecord'].includes(name))await event(name,{result});
    return result;
  }});
  await event('native-save-complete',{result});
  await event('input-free-interval-ends');
  // OBS hybrid MP4 intentionally indexes at EOF. Preserve the separate
  // extension fast-start validator; validate this backend's decode/seek contract.
  const probe=await verifyNativeMedia(result.file,minutes*60);
  await fs.writeFile(path.join(out,'media-validation.json'),JSON.stringify(probe,null,2));
  report.signal=await analyzeSyntheticMedia(result.file,probe.duration);
  await fs.writeFile(path.join(out,'signal-validation.json'),JSON.stringify(report.signal,null,2));
  assert.equal(report.signal.passed,true,'Saved controlled media must contain audible tone and moving video throughout sampled intervals');
  const review=await context.newPage();await review.goto(pathToFileURL(result.file).href);
  await review.waitForSelector('video');
  report.playback=await review.evaluate(async()=>{
    const v=document.querySelector('video');v.muted=true;await v.play();
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Seek timed out')),10000);v.addEventListener('seeked',()=>{clearTimeout(timer);resolve();},{once:true});v.currentTime=30;});
    v.pause();return {width:v.videoWidth,height:v.videoHeight,time:v.currentTime,duration:v.duration};
  });
  assert.ok(report.playback.width>0 && report.playback.time>=29.5);
  await review.screenshot({path:path.join(out,'02-recording-playback.png')});
  report.media=result.file;report.status='CAPTURE_VERIFIED';report.humanNoInputConfirmation='Required separately';report.audioPeak=audioPeak;
}catch(error){
  report.error=error.stack;
  if(recorder && !recorder.isClosed()){
    report.uiStatus=await recorder.locator('#nativeStatus').textContent().catch(()=>null);
    await recorder.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
  }
  await event('failure',{message:error.message,uiStatus:report.uiStatus});process.exitCode=1;
}
finally{
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({out,status:report.status,media:report.media,error:report.error},null,2));
  if(context)await context.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(companion?.connected){companion.send({type:'shutdown'});await new Promise(resolve=>companion.once('exit',resolve));}
  await obs.disconnect();
}
