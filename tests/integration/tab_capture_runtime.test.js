import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createChromeAutomationController,AUTOMATION_POLL_ALARM} from '../../src/automation/chrome_controller.js';
import {validateScheduleConfig} from '../../src/automation/schedule_store.js';
const schedule={id:'a',enabled:true,captureMode:'tab',title:'Lecture',targetUrl:'https://example.test/meeting',durationMinutes:1,weekdays:['Thursday'],time:'18:00',launchWindowSeconds:120};
function harness({deny=false,waiting=false}={}){
 const state={},sent=[],focus=[];let checks=0;
 const api={storage:{local:{get:async key=>({[key]:state[key]}),set:async values=>Object.assign(state,values)}},
 tabs:{query:async()=>[{id:5,url:'chrome-extension://x/pages/recorder.html',windowId:7}],update:async(...args)=>focus.push(args),sendMessage:async(id,message)=>{sent.push(message);return {ok:true};}},
 windows:{update:async(...args)=>focus.push(args)}};
 const controller=createChromeAutomationController({chromeApi:api,recorderUrl:'chrome-extension://x/pages/recorder.html',schedules:[schedule],
 nowProvider:()=>({date:'2026-10-15',weekday:'Thursday',time:'18:00:05',utcOffsetMinutes:180}),
 scheduledTargetProvider:async id=>{checks++;assert.equal(id,'a');if(deny)throw Error('Reauthorization required');return {tabId:42,...(waiting && checks===1?{ready:false,reason:'Waiting for channel meeting'}:{})};}});
 return {controller,state,sent,focus,checks:()=>checks};
}
test('authorized scheduling keeps browser minimized/background and dispatches capture mode',async()=>{
 const h=harness();await h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM});
 assert.equal(h.checks(),1);assert.equal(h.focus.length,0);assert.equal(h.sent[0].captureMode,'tab');
});
test('duplicate alarms cannot dispatch a second authorized capture',async()=>{
 const h=harness();await Promise.all([h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM}),h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM})]);
 assert.equal(h.sent.length,1);
});
test('missing authorization does not silently fall back to target opening or manual capture',async()=>{
 const h=harness({deny:true});await assert.rejects(()=>h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM}),/Reauthorization/);assert.equal(h.sent.length,0);
});
test('schedule provider mode requires URL and bounded automatic duration',()=>{
 for(const bad of [{...schedule,targetUrl:''},{...schedule,durationMinutes:undefined},{...schedule,captureMode:'unknown'}])assert.throws(()=>validateScheduleConfig(bad),/capture|duration|target/i);
 assert.equal(validateScheduleConfig(schedule),schedule);
});
test('extension contract adds tab invocation permissions and separate capture provider',()=>{
 const manifest=JSON.parse(fs.readFileSync('src/public/manifest.json'));
 for(const name of ['activeTab','tabCapture','scripting'])assert.ok(manifest.permissions.includes(name));
 const source=fs.readFileSync('src/scripts/recorder.js','utf8');
 assert.match(source,/acquireAuthorizedTab/);assert.match(source,/navigator\.mediaDevices\.getDisplayMedia/);
 assert.match(source,/TAB_CAPTURE_PREPARE/);assert.match(source,/TAB_CAPTURE_CHECK/);
});
test('unexpected recorder closure clears active state and reports possible unsaved data loss',async()=>{
 const h=harness();h.state.automationActiveRecording={tabId:5,recordingId:'active'};
 h.state.recordingHistory=[{state:'saved',filename:'previous.mp4'}];
 await h.controller.handleRecorderClosed(5);
 assert.equal(h.state.automationActiveRecording,null);
 assert.match(h.state.automationDiagnostic.message,/closed or reloaded.*may be lost/);
 assert.equal(h.state.recordingHistory[0].filename,'previous.mp4');
});
test('unrelated tab closure does not clear an active recording',async()=>{
 const h=harness();h.state.automationActiveRecording={tabId:5,recordingId:'active'};
 await h.controller.handleRecorderClosed(42);assert.equal(h.state.automationActiveRecording.recordingId,'active');
});

test('scheduler waits for Teams without marking handled, then retries and records once',async()=>{
 const h=harness({waiting:true});
 assert.deepEqual(await h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM}),[]);
 assert.equal(h.sent.length,0);assert.equal(h.state.automationPendingRecording,undefined);
 assert.equal(h.state.automationHandledOccurrenceKeys,undefined);
 assert.equal(h.state.automationDiagnostic.state,'waiting_for_meeting');
 await h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM});
 await h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM});
 assert.equal(h.sent.length,1);
});
