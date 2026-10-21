// Isolated UI integration with a fake Chrome API; never touches user schedules.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const root=path.resolve('src'),artifacts=path.resolve('.test-artifacts','workspace-ui-'+Date.now());
await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const callbacks=[];
  window.testState={automationSchedules:[],automationActivityLog:[],automationRuns:{}};
  window.testMessages=[];window.testDownloads=[];
  window.chrome={
   storage:{onChanged:{addListener:fn=>callbacks.push(fn)},local:{
    get:async keys=>typeof keys==='string'?{[keys]:structuredClone(testState[keys])}:structuredClone(testState),
    set:async values=>{
     const changes={};for(const [key,value] of Object.entries(values)){changes[key]={oldValue:testState[key],newValue:value};testState[key]=structuredClone(value);}
     for(const fn of callbacks)fn(changes,'local');
    }
   }},
   tabs:{query:async()=>[{id:7,title:'Teams and Channels | tEST | General | Microsoft Teams',url:'https://teams.cloud.microsoft/'}],
    get:async()=>({id:7,title:'Teams and Channels | tEST | General | Microsoft Teams',url:'https://teams.cloud.microsoft/'})},
   runtime:{sendMessage:async message=>{
    testMessages.push(message);
    if(message.type==='TAB_CAPTURE_STATUS')return {ok:true,items:[]};
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
 await writeFile(path.join(artifacts,'result.json'),JSON.stringify({pass:true,scope:'Isolated mocked Chrome UI, no real schedules or meeting',checks:['once','weekly','prepare exact tab','cancel command','four tabs','live logs','export','keyboard navigation','mobile width'],errors},null,2));
 console.log('PASS: workspace UI fixtures. Screenshots and evidence: '+artifacts);
}finally{await browser.close();}
