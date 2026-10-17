// Read-only live acceptance observer. Does not invoke alarms, join or start.
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const out=path.resolve(process.argv[2]);
const setup=JSON.parse(await fs.readFile(path.join(out,'setup.json'),'utf8'));
const profile=path.resolve(process.argv[3]);
const port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0].trim();
const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
const recorder=browser.contexts()[0].pages().find(p=>p.url().startsWith('chrome-extension:') && p.url().includes('/pages/recorder.html'));
if(!recorder)throw Error('Experimental recorder is not open');
let previous='',last;
for(let i=0;i<300;i++){
 const state=await recorder.evaluate(async()=>{
   const local=await chrome.storage.local.get(['automationJoinEvents','automationDiagnostic','captureEvents','recordingHistory','automationActiveRecording','tabCaptureAuthorizationEvents']);
   const session=await chrome.storage.session.get('tabCaptureGrants');
   return {...local,grantCount:Object.keys(session.tabCaptureGrants || {}).length,pill:document.getElementById('statusPill').textContent};
 });
 last=state;
 const snapshot={at:new Date().toISOString(),...state};
 const serial=JSON.stringify(state);
 if(serial!==previous){
   await fs.appendFile(path.join(out,'events.jsonl'),JSON.stringify(snapshot)+'\n');
   console.log(JSON.stringify({at:snapshot.at,pill:state.pill,grants:state.grantCount,diagnostic:state.automationDiagnostic,join:state.automationJoinEvents?.at(-1)}));
   previous=serial;
 }
 const saved=state.recordingHistory?.find(h=>h.at>=setup.at && h.scheduleId===setup.scheduleId);
 if(saved){
   const downloads=await recorder.evaluate(async()=>chrome.downloads.search({limit:10,orderBy:['-startTime']}));
   const download=downloads.find(d=>d.startTime>=setup.at && d.filename?.includes('Auto-join'));
   await fs.writeFile(path.join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),setup,state,download:download?{id:download.id,state:download.state,exists:download.exists,fileSize:download.fileSize,filename:download.filename}:null},null,2));
   await recorder.screenshot({path:path.join(out,'saved.png'),fullPage:true,mask:[recorder.locator('#targetUrl'),recorder.locator('#authorizationTarget'),recorder.locator('#authorizationList'),recorder.locator('#historyList'),recorder.locator('#playbackPane')]});
   console.log('OBSERVED SAVED RESULT');process.exit(0);
 }
 await new Promise(r=>setTimeout(r,2000));
}
await fs.writeFile(path.join(out,'timeout.json'),JSON.stringify({setup,state:last},null,2));
console.error('Timed out without a matching saved recording');process.exit(1);
