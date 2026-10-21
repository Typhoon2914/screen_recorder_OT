// Actual extension worker + UI, isolated profile, no Teams login or capture grant.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const out=path.resolve('.test-artifacts','setup-actions-'+Date.now()),extension=path.resolve('dist');
await mkdir(out,{recursive:true});
const context=await chromium.launchPersistentContext(path.join(out,'profile'),{
 channel:'chromium',headless:true,viewport:{width:1280,height:1000},
 args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
});
try{
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host,page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`chrome-extension://${id}/pages/recorder.html`);
 await page.locator('#tabAuthorizationSetup > summary').click();
 await page.locator('#authorizationRefresh').click();
 await page.waitForFunction(()=>document.getElementById('authorizationStatus').textContent.includes('Status refreshed'));
 await page.locator('#authorizeTarget').click();
 await page.waitForFunction(()=>document.getElementById('authorizationStatus').textContent.includes('Select a saved schedule'));
 await page.waitForFunction(async()=>((await chrome.storage.local.get('automationActivityLog')).automationActivityLog || []).some(e=>e.event==='setup_failed'));
 await page.evaluate(async()=>{
  await chrome.storage.local.set({automationSchedules:[{id:'setup-test',title:'Setup feedback test',enabled:true,
   weekdays:['Sunday'],time:'23:59',launchWindowSeconds:60,durationMinutes:1,captureMode:'tab',
   targetUrl:'https://teams.cloud.microsoft/',teamsAutoJoin:true,teamsTeam:'tEST',teamsChannel:'General',joinWaitMinutes:1}]});
  // Avoid a natural schedule firing in this isolated setup-only test.
  await chrome.alarms.clear('screen-recorder-automation-poll');
 });
 const target=await context.newPage();
 await target.route('https://teams.cloud.microsoft/**',route=>route.fulfill({contentType:'text/html',body:'<title>Teams and Channels | tEST | General | Microsoft Teams</title><p>Synthetic setup target, not a real meeting.</p>'}));
 await target.goto('https://teams.cloud.microsoft/');
 await page.locator('#authorizationRefresh').click();
 await page.locator('#authorizationSchedule').selectOption('setup-test');
 await page.waitForFunction(()=>document.querySelector('#authorizationTarget').options.length===2);
 const targetId=await page.locator('#authorizationTarget option').nth(1).getAttribute('value');
 await page.locator('#authorizationTarget').selectOption(targetId);
 await page.locator('#authorizationReady').check();
 await page.locator('#authorizeTarget').click();
 await page.waitForFunction(async()=>((await chrome.storage.local.get('automationActivityLog')).automationActivityLog || []).some(e=>e.event==='setup_authorization_pending'));
 await page.screenshot({path:path.join(out,'prepare-action-needed.png'),fullPage:true});
 const result=await page.evaluate(()=>chrome.runtime.sendMessage({type:'TAB_CAPTURE_TEAMS_PREFLIGHT',scheduleId:'setup-test'}));
 assert.equal(result.ok,false);assert.match(result.error,/Reauthorization/);
 const logs=await page.evaluate(async()=>(await chrome.storage.local.get('automationActivityLog')).automationActivityLog);
 for(const event of ['setup_started','setup_refreshed','setup_failed','setup_authorization_pending'])assert.ok(logs.some(e=>e.event===event));
 assert.ok(logs.some(e=>e.event==='setup_failed'&&e.message.includes('Check Teams readiness')));
 assert.ok(logs.some(e=>e.event==='setup_failed'&&e.message.includes('Select a saved schedule')));
 assert.equal(logs.some(e=>e.event==='setup_authorized'),false);
 assert.deepEqual(errors,[]);
 await page.getByRole('tab',{name:'Logs',exact:true}).click();
 await page.screenshot({path:path.join(out,'setup-action-logs.png'),fullPage:true});
 await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,scope:'Actual worker/UI; synthetic target; no capture permission or Teams meeting',logs,errors},null,2));
 console.log('PASS: actual extension setup actions and failure logging. Evidence: '+out);
}finally{await context.close();}
