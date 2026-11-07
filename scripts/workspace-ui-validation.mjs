// Isolated UI integration with a fake Chrome API; never touches user schedules.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const root=path.resolve('src'),artifacts=path.resolve('.test-artifacts','workspace-ui-'+Date.now());
const baseline=process.env.RENDER_BASELINE==='1'?execFileSync('git',['show','HEAD:src/scripts/schedule_ui.js']):null;
await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const callbacks=[];
  window.testState={automationSchedules:[],automationActivityLog:[],automationRuns:{}};
  window.testMessages=[];window.testDownloads=[];
  window.renderReads=[];window.holdRenderReads=false;
  window.chrome={
   storage:{onChanged:{addListener:fn=>callbacks.push(fn)},local:{
    get:async keys=>{
     const result=typeof keys==='string'?{[keys]:structuredClone(testState[keys])}:structuredClone(testState);
     if(holdRenderReads && (keys==='automationRuns' || Array.isArray(keys)&&keys.includes('automationRuns')))await new Promise(resolve=>renderReads.push(resolve));
     return result;
    },
    set:async values=>{
     const changes={};for(const [key,value] of Object.entries(values)){changes[key]={oldValue:testState[key],newValue:value};testState[key]=structuredClone(value);}
     for(const fn of callbacks)fn(changes,'local');
    }
   }},
   tabs:{query:async()=>[7,8].map(id=>({id,title:`Teams and Channels | ${id===7?'tEST':'Second team'} | General | Microsoft Teams`,url:'https://teams.cloud.microsoft/'})),
    get:async()=>({id:7,title:'Teams and Channels | tEST | General | Microsoft Teams',url:'https://teams.cloud.microsoft/'})},
   runtime:{sendMessage:async message=>{
    testMessages.push(message);
    if(message.type==='TAB_CAPTURE_STATUS')return {ok:true,items:testState.authorizationItems || []};
    if(message.type==='AUTOMATION_CANCEL_RUN'){
     await chrome.storage.local.set({automationRuns:{...testState.automationRuns,[message.scheduleId]:{state:'cancelled'}}});
    }
    return {ok:true};
   }},
   downloads:{download:async data=>{testDownloads.push(data);return 1;}}
  };
 });
 await page.route('https://recorder.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/ui-entry.js')return route.fulfill({contentType:'text/javascript',body:"import '/scripts/tab_capture_ui.js';import '/scripts/schedule_ui.js';import '/scripts/workspace_ui.js';"});
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep))return route.abort();
  try{
   let body=await readFile(file).catch(error=>{
    if(pathname.startsWith('/icons/'))return readFile(path.join(root,'public',pathname));
    throw error;
   });
   if(baseline && pathname==='/scripts/schedule_ui.js')body=baseline;
   if(pathname.endsWith('.html'))body=Buffer.from(body.toString().replace('../scripts/recorder.js','/ui-entry.js'));
   const contentType=pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.html')?'text/html':'image/png';
   await route.fulfill({contentType,body});
  }catch{await route.fulfill({status:404,body:'Not found'});}
 });
 await page.goto('https://recorder.test/pages/recorder.html');
 await page.getByRole('button',{name:'New schedule',exact:true}).click();
 await page.locator('#setupTeamsTab').selectOption('7');
 await page.getByRole('button',{name:'Use this tab',exact:true}).click();
 await page.locator('#lectureName').fill('UI acceptance');
 await page.locator('#runDate').fill('2026-10-21');
 await page.locator('#scheduleTime').fill('19:00');
 await page.locator('#scheduleDuration').fill('2');
 assert.equal(await page.locator('#weekdayField').isVisible(),false);
 await page.screenshot({path:path.join(artifacts,'schedule-editor.png'),fullPage:true});
 await page.getByRole('button',{name:'Save schedule',exact:true}).click();
 await page.waitForFunction(()=>testState.automationSchedules.length===1);
 const once=await page.evaluate(()=>testState.automationSchedules[0]);
 assert.equal(once.runDate,'2026-10-21');assert.equal(once.teamsTeam,'tEST');assert.equal(once.teamsAutoJoin,true);
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 await page.locator('#repeatMode').selectOption('weekly');
 assert.equal(await page.locator('#dateField').isVisible(),false);
 await page.locator('#weekday').selectOption('Sunday');
 await page.getByRole('button',{name:'Save schedule',exact:true}).click();
 await page.waitForFunction(()=>!testState.automationSchedules[0].runDate);
 assert.deepEqual(await page.evaluate(()=>testState.automationSchedules[0].weekdays),['Sunday']);
 await page.getByRole('button',{name:'Prepare recording',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#authorizationSchedule').value===testState.automationSchedules[0].id);
 await page.locator('#authorizationTarget').selectOption('7');
 await page.locator('#authorizationReady').check();
 await page.getByRole('button',{name:'Prepare selected Teams tab',exact:true}).click();
 assert.ok(await page.evaluate(()=>testMessages.some(m=>m.type==='TAB_CAPTURE_REQUEST_AUTH'&&m.targetTabId===7)));
 await page.evaluate(()=>chrome.storage.local.set({automationRuns:{[testState.automationSchedules[0].id]:{state:'retry_pending'}}}));
 await page.getByRole('button',{name:'Cancel this run',exact:true}).click();
 assert.ok(await page.evaluate(()=>testMessages.some(m=>m.type==='AUTOMATION_CANCEL_RUN')));
 // Force two render reads to complete out of order. The old renderer appended
 // duplicate/stale cards after competing storage notifications and UI renders.
 await page.evaluate(async()=>{
  holdRenderReads=true;
  await chrome.storage.local.set({automationSchedules:[{...testState.automationSchedules[0],title:'Stale title'}]});
  await chrome.storage.local.set({automationSchedules:[{...testState.automationSchedules[0],title:'Latest title'}]});
 });
 await page.waitForFunction(()=>renderReads.length>=2);
 await page.evaluate(()=>{holdRenderReads=false;renderReads.pop()();});
 await page.waitForFunction(()=>document.querySelector('#scheduleList').textContent.includes('Latest title'));
 await page.evaluate(()=>renderReads.splice(0).forEach(resolve=>resolve()));
 await page.waitForTimeout(100);
 assert.equal(await page.locator('.scheduleRow').count(),1);
 assert.equal(await page.locator('#armSchedule option').count(),2);
 assert.equal(await page.locator('#scheduleList').innerText().then(text=>text.includes('Stale title')),false);
 // Two schedules with the same URL show their different prepared tabs.
 await page.evaluate(async()=>{
  const a=testState.automationSchedules[0],b={...a,id:'second',title:'Second meeting',time:'20:00',teamsTeam:'Second team'};
  testState.authorizationItems=[{scheduleId:a.id,title:a.title,available:true,tabId:7,currentUrl:a.targetUrl,schedule:a},
   {scheduleId:b.id,title:b.title,available:true,tabId:8,currentUrl:b.targetUrl,schedule:b}];
  await chrome.storage.local.set({automationSchedules:[a,b]});
 });
 await page.waitForFunction(()=>document.querySelectorAll('.scheduleRow').length===2 && document.querySelector('[data-preparation-for="second"]').textContent.includes('Tab 8'));
 await page.locator('[data-schedule-id="second"]').getByRole('button',{name:'Prepare recording',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#authorizationSchedule').value==='second' && document.querySelector('#authorizationTarget').value==='8');
 assert.equal(await page.locator('#authorizationReady').isChecked(),false);
 await page.screenshot({path:path.join(artifacts,'two-prepared-schedules.png'),fullPage:true});
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('tab-readiness-result',{detail:{scheduleId:'second',result:{title:'Meeting found',at:Date.now()}}})));
 assert.match(await page.locator('[data-preparation-for="second"]').innerText(),/Meeting found/);
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('[data-schedule-id="second"]').getByRole('button',{name:'Delete',exact:true}).click();
 await page.waitForFunction(()=>testState.automationSchedules.length===1 && document.querySelectorAll('.scheduleRow').length===1);
 await page.waitForTimeout(100);
 assert.equal(await page.locator('#armSchedule option').count(),2);
 await page.screenshot({path:path.join(artifacts,'schedules.png'),fullPage:true});
 for(const [tab,panel] of [['Record now','recordPanel'],['History','historyPanel'],['Logs','logsPanel']]){
  await page.getByRole('tab',{name:tab,exact:true}).click();
  assert.equal(await page.locator('#'+panel).isVisible(),true);
  assert.equal(await page.locator('[role=tabpanel]:visible').count(),1);
 }
 await page.evaluate(()=>chrome.storage.local.set({automationActivityLog:[
  {at:'2026-10-20T19:00:00Z',level:'info',event:'teams_check',scheduleId:'test',message:'Checking authorized Teams tab and channel.'},
  {at:'2026-10-20T19:00:10Z',level:'warning',event:'retry_pending',scheduleId:'test',message:'Meeting absent. Waiting to retry.',nextRetryAt:'2026-10-20T19:01:10Z',expiresAt:'2026-10-20T19:05:00Z'}
 ]}));
 await page.waitForFunction(()=>document.querySelectorAll('#activityLog li').length===2);
 await page.getByRole('button',{name:'Export logs',exact:true}).click();
 assert.equal(await page.evaluate(()=>testDownloads.length),1);
 await page.screenshot({path:path.join(artifacts,'logs.png'),fullPage:true});
 await page.getByRole('tab',{name:'Logs',exact:true}).focus();
 await page.keyboard.press('Home');
 assert.equal(await page.locator('#schedulesPanel').isVisible(),true);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(artifacts,'mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 await writeFile(path.join(artifacts,'result.json'),JSON.stringify({pass:true,scope:'Isolated mocked Chrome UI, no real schedules or meeting',checks:['once','weekly','prepare exact tab','cancel command','out-of-order render race','two same-URL schedules show different authorized tabs','selection resets confirmation','delete without duplicate cards','four tabs','live logs','export','keyboard navigation','mobile width'],errors},null,2));
 console.log('PASS: workspace UI fixtures. Screenshots and evidence: '+artifacts);
}finally{await browser.close();}
