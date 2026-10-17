// Real Chrome API probe. No permissions, media or API calls are mocked.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>CONTROLLED COLD CAPTURE PROBE</title><h1>Controlled localhost Chrome capture authorization probe</h1><p>No extension action, capture picker, fake media or permission grant.</p>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const out=path.resolve('.test-artifacts', 'cb-'+Date.now());
const extension=path.join(out,'ext'),profile=path.join(out,'profile');
await fs.mkdir(extension,{recursive:true});
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Isolated capture authorization probe',version:'1.0',permissions:['tabCapture','activeTab','offscreen','tabs','alarms','storage'],background:{service_worker:'worker.js'},action:{default_title:'Do not invoke during cold-capture probe'}}));
await fs.writeFile(path.join(extension,'offscreen.html'),'<!doctype html><title>Capture probe offscreen document</title>');
function workerMain(){
  chrome.alarms.onAlarm.addListener(async alarm=>{
    if(alarm.name!=='cold-capture-probe')return;
    const {targetTabId}=await chrome.storage.local.get('targetTabId');
    const result={at:new Date().toISOString(),alarm,targetTabId,offscreen:await chrome.offscreen.hasDocument(),before:await chrome.tabCapture.getCapturedTabs()};
    try {await chrome.tabCapture.getMediaStreamId({targetTabId});result.streamIdIssued=true;}
    catch(error){result.streamIdIssued=false;result.error=error.message;}
    await chrome.storage.local.set({result});
  });
}
await fs.writeFile(path.join(extension,'worker.js'),'('+workerMain.toString()+')()');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const results=[];
try {
  for(const stage of ['fresh-profile','after-browser-restart']){
    const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,chromiumSandbox:true,ignoreDefaultArgs:['--disable-extensions','--unsafely-disable-devtools-self-xss-warnings'],args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
    try{
      const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      const page=await context.newPage();
      await page.goto('http://127.0.0.1:'+server.address().port+'/');
      await worker.evaluate(async()=>{
        await chrome.storage.local.remove('result');
        if(!await chrome.offscreen.hasDocument())await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA'],justification:'Verify whether an offscreen document changes cold capture authorization'});
        const target=(await chrome.tabs.query({})).filter(t=>t.title==='CONTROLLED COLD CAPTURE PROBE').at(-1);
        if(!target)throw Error('Controlled source missing');
        await chrome.storage.local.set({targetTabId:target.id});
        await chrome.alarms.create('cold-capture-probe',{when:Date.now()+3000});
      });
      let result;
      for(let n=0;n<60;n++){
        result=await worker.evaluate(async()=>(await chrome.storage.local.get('result')).result);
        if(result)break;
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      assert.ok(result,'No real alarm result');
      results.push({stage,browser:context.browser().version(),...result});
      await page.locator('body').evaluate((body,result)=>{const pre=document.createElement('pre');pre.textContent=JSON.stringify(result,null,2);body.append(pre);},result);
      await page.screenshot({path:path.join(out,stage+'.png'),fullPage:true});
      assert.equal(result.offscreen,true);assert.equal(result.before.length,0);
      assert.equal(result.streamIdIssued,false,'Unexpected success: investigate actual capture');
      assert.match(result.error,/invoked|activeTab|permission/i);
    }finally{await context.close();}
  }
}finally{
  await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({out,results},null,2));
  console.log(JSON.stringify({out,results},null,2));
}
