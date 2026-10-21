// Real Chromium rendering with mocked extension APIs. Not live Teams acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const page=await browser.newPage();
 await page.setContent(`
 <select id="authorizationSchedule"></select><select id="authorizationTarget"></select>
 <input id="authorizationReady" type="checkbox"><button id="authorizationRefresh">Refresh</button>
 <button id="authorizeTarget">Authorize</button><p id="authorizationStatus"></p><div id="authorizationList"></div>`);
 await page.evaluate(()=>{
  window.requests=[];
  window.response={ok:true,result:{state:'blocked',reason:'Expected Advanced AI / General; tab reports Test / General'}};
  window.chrome={
   storage:{local:{get:async()=>({automationSchedules:[]})},onChanged:{addListener:()=>{}}},
   tabs:{query:async()=>[]},
   runtime:{sendMessage:async message=>{
    window.requests.push(message);
    if(message.type==='TAB_CAPTURE_STATUS')return {ok:true,items:[
     {scheduleId:'lecture',title:'Lecture',available:true,tabId:7,currentUrl:'https://teams.cloud.microsoft/',schedule:{teamsAutoJoin:true}},
     {scheduleId:'manual',title:'Manual',available:true,tabId:8,currentUrl:'https://example.test/',schedule:{teamsAutoJoin:false}}
    ]};
    if(message.type==='TAB_CAPTURE_TEAMS_PREFLIGHT')return window.response;
    throw Error('Unexpected mutating request: '+message.type);
   }}
  };
 });
 const feedbackUrl='data:text/javascript;base64,'+Buffer.from(await fs.readFile('src/automation/setup_feedback.js','utf8')).toString('base64');
 await page.addScriptTag({type:'module',content:(await fs.readFile('src/scripts/tab_capture_ui.js','utf8')).replace('../automation/setup_feedback.js',feedbackUrl)});
 const check=page.getByRole('button',{name:'Check Teams readiness (no joining)',exact:true});
 await check.waitFor();
 assert.equal(await check.count(),1);
 assert.match(await page.locator('#authorizationList').innerText(),/does not verify auto-join/);
 await check.click();
 await page.waitForFunction(()=>document.getElementById('authorizationStatus').textContent.includes('Expected Advanced AI'));
 assert.match(await page.locator('#authorizationStatus').getAttribute('class'),/setupFeedback-error/);
 assert.match(await page.locator('#authorizationList .setupFeedback strong').innerText(),/Not ready/);
 assert.deepEqual((await page.evaluate(()=>window.requests)).filter(r=>r.type!=='TAB_CAPTURE_STATUS'),
  [{type:'TAB_CAPTURE_TEAMS_PREFLIGHT',scheduleId:'lecture'}]);
 await page.evaluate(()=>{window.response={ok:false,error:'Reauthorization required'};});
 await check.click();
 await page.waitForFunction(()=>document.getElementById('authorizationStatus').textContent.includes('Reauthorization required'));
 assert.equal(await check.isEnabled(),true);
 await page.evaluate(()=>{window.response={ok:true,result:{state:'waiting',reason:'Meeting has not started in the configured channel'}};});
 await check.click();
 await page.waitForFunction(()=>document.getElementById('authorizationStatus').textContent.includes('Setup confirmed'));
 assert.match(await page.locator('#authorizationList .setupFeedback').innerText(),/no meeting is available to join now/);
 assert.match(await page.locator('#authorizationStatus').getAttribute('class'),/setupFeedback-warning/);
 await page.locator('#authorizationRefresh').click();
 await page.waitForFunction(()=>document.getElementById('authorizationStatus').textContent.includes('Status refreshed'));
 assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.type==='TAB_CAPTURE_STATUS').at(-1).userInitiated),true);
 if(process.argv[2]){
  const out=path.resolve(process.argv[2]);await fs.mkdir(out,{recursive:true});
  await page.screenshot({path:path.join(out,'preflight-ui-fixture.png')});
 }
 console.log('PASS: readiness button targets exact schedule, reports mismatch and permission loss, and sends no join/start/authorization mutation. Mocked API fixture, not live acceptance.');
}finally{await browser.close();}
