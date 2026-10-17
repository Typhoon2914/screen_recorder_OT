// Real extension/local HTTP handshake only. This is NOT a capture test.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const out=path.resolve('.test-artifacts','pair-'+Date.now());
await fs.mkdir(out,{recursive:true});
const context=await chromium.launchPersistentContext(path.join(out,'profile'),{channel:'chromium',headless:false,chromiumSandbox:true,ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+path.resolve('dist'),'--load-extension='+path.resolve('dist')]});
let child;const report={out,captureTest:false};
try{
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  const config={...JSON.parse(await fs.readFile('.test-artifacts/obs-connection.json','utf8')),inputName:'Pairing test only',window:'unused',token:randomBytes(32).toString('hex'),origin:'chrome-extension://'+id,stateDirectory:path.join(out,'state')};
  const configPath=path.join(out,'config.json');await fs.writeFile(configPath,JSON.stringify(config),{mode:0o600});
  child=spawn(process.execPath,['companion/server.mjs',configPath],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.on('data',data=>fs.appendFile(path.join(out,'server.log'),data));
  child.stderr.on('data',data=>fs.appendFile(path.join(out,'stderr.log'),data));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timed out')),10000);child.stdout.on('data',data=>{if(data.toString().includes('"type":"ready"')){clearTimeout(timer);resolve();}});});
  const page=await context.newPage();await page.goto('chrome-extension://'+id+'/pages/recorder.html');
  await page.locator('#nativeToken').fill(config.token);await page.locator('#nativeEnabled').check();await page.locator('#nativeSave').click();
  await page.waitForTimeout(2500);
  report.uiStatus=await page.locator('#nativeStatus').textContent();
  report.storage=await page.evaluate(async()=>{const s=await chrome.storage.local.get(['nativeCompanionHealth','automationDiagnostic']);return s;});
  await page.screenshot({path:path.join(out,'pairing.png'),fullPage:true});
  assert.equal(report.uiStatus,'Native: idle');
  report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{
  await context.close();
  if(child?.connected){child.send({type:'shutdown'});await new Promise(resolve=>child.once('exit',resolve));}
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
