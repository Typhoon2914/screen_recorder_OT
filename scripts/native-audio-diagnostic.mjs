// Diagnostic only: compares two supported per-application audio source types.
// Never captures desktop/microphone audio and never declares unattended success.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import OBS from 'obs-websocket-js';
import {recordWithObs} from '../companion/recording.js';
import {analyzeSyntheticMedia} from './native-signal-analysis.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const out=path.resolve('.test-artifacts','audio-diagnostic-'+Date.now());
await fs.mkdir(out,{recursive:true});
const cfg=JSON.parse(await fs.readFile('.test-artifacts/obs-connection.json','utf8')),obs=new OBS();
let context,server;const report={out,acceptanceTest:false,stages:[]},owned=[];
try{
  await obs.connect(cfg.endpoint,cfg.password,{rpcVersion:1,eventSubscriptions:65536});
  if((await obs.call('GetProfileList')).currentProfileName!=='ScreenRecorderExperiment'||(await obs.call('GetSceneCollectionList')).currentSceneCollectionName!=='ScreenRecorderExperiment')throw Error('Isolation mismatch');
  if((await obs.call('GetRecordStatus')).outputActive)throw Error('OBS busy');
  if((await obs.call('GetSceneItemList',{sceneName:cfg.expectedScene})).sceneItems.length)throw Error('Scene must be empty');
  const html='<title>ISOLATED AUDIO DIAGNOSTIC</title><button>Play tone</button><canvas width="960" height="540"></canvas><script>let n=0,c=document.querySelector("canvas"),g=c.getContext("2d");setInterval(()=>{g.fillStyle="#102030";g.fillRect(0,0,960,540);g.fillStyle="white";g.fillRect((n++*10)%900,100,60,200)},100);document.querySelector("button").onclick=async()=>{window.a=new AudioContext();window.o=a.createOscillator();window.gain=a.createGain();gain.gain.value=.07;o.connect(gain).connect(a.destination);o.start();await a.resume();}</script>';
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  context=await chromium.launchPersistentContext(path.join(out,'chrome'),{channel:'chromium',headless:false,ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+path.resolve('dist'),'--load-extension='+path.resolve('dist')]});
  const page=context.pages()[0];await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button').click();
  const name='AudioDiagnostic-'+Date.now();owned.push(name);
  await obs.call('CreateInput',{sceneName:cfg.expectedScene,inputName:name,inputKind:'window_capture',inputSettings:{},sceneItemEnabled:true});
  const list=await obs.call('GetInputPropertiesListPropertyItems',{inputName:name,propertyName:'window'});
  const choices=list.propertyItems.filter(x=>x.itemEnabled&&x.itemName.includes('ISOLATED AUDIO DIAGNOSTIC'));
  if(choices.length!==1)throw Error('Ambiguous test source');
  const window=choices[0].itemValue;
  await obs.call('SetInputSettings',{inputName:name,inputSettings:{window,method:2,priority:0,capture_audio:true,cursor:false},overlay:true});
  let meters=[];
  obs.on('InputVolumeMeters',e=>{for(const i of e.inputs.filter(x=>owned.includes(x.inputName)))meters.push({at:Date.now(),name:i.inputName,levels:i.inputLevelsMul});});
  for(const stage of ['window-audio','separate-application-audio']){
    if(stage==='separate-application-audio'){
      await obs.call('SetInputSettings',{inputName:name,inputSettings:{capture_audio:false},overlay:true});
      const audio=name+'-audio';owned.push(audio);
      await obs.call('CreateInput',{sceneName:cfg.expectedScene,inputName:audio,inputKind:'wasapi_process_output_capture',inputSettings:{window,priority:0},sceneItemEnabled:true});
    }
    await new Promise(r=>setTimeout(r,3000));meters=[];
    await obs.call('SetProfileParameter',{parameterCategory:'Output',parameterName:'FilenameFormatting',parameterValue:'diagnostic-'+Date.now()+'-'+stage});
    const result=await recordWithObs({...cfg,ready:true,durationMs:10000,rpc:(n,d)=>obs.call(n,d)});
    const signal=await analyzeSyntheticMedia(result.file,10);
    report.stages.push({stage,...result,signal,meters});
    await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({stage,file:result.file,signal}));
  }
  await page.screenshot({path:path.join(out,'source.png')});
}catch(error){report.error=error.stack;process.exitCode=1;console.log(error.message);}
finally{
  for(const inputName of owned.reverse())await obs.call('RemoveInput',{inputName}).catch(()=>{});
  await context?.close();if(server)await new Promise(r=>server.close(r));await obs.disconnect();
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(out);
}
