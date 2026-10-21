import test from 'node:test';
import assert from 'node:assert/strict';
import {createSetupActions,readinessFeedback} from '../../src/automation/setup_feedback.js';
function fixture(){
 const logs=[],calls=[],schedule={id:'test',teamsAutoJoin:true};
 const authorization={
  status:async()=>[{scheduleId:'test',available:true}],
  check:async()=>{calls.push('check');return {tabId:7,schedule};},
  request:async()=>{calls.push('request');return {tabId:7};}
 };
 const joiner={inspect:async()=>{calls.push('inspect');return {state:'waiting',reason:'Meeting has not started in the configured channel'};}};
 const api={tabs:{update:async()=>calls.push('focus-tab'),get:async()=>({windowId:1})},windows:{update:async()=>calls.push('focus-window')}};
 return {logs,calls,authorization,joiner,run:createSetupActions({authorization,joiner,api,log:async e=>logs.push(e)})};
}
test('no meeting means setup confirmed but no current join target, not recording-ready',()=>{
 const feedback=readinessFeedback({state:'waiting',reason:'Meeting has not started in the configured channel'});
 assert.equal(feedback.tone,'warning');assert.match(feedback.title,/waiting for a meeting/);
 assert.match(feedback.message,/no meeting is available/);assert.match(feedback.message,/No joining or recording was tested/);
});
test('generic waiting cannot claim correct team and channel',()=>{
 const feedback=readinessFeedback({state:'waiting',reason:'Teams tab is loading'});
 assert.match(feedback.title,/Not ready/);assert.doesNotMatch(feedback.message,/channel.*confirmed/);
});
test('meeting found and joined feedback never claims media was tested',()=>{
 for(const state of ['channel_ready','joined']){
  const feedback=readinessFeedback({state});assert.equal(feedback.tone,'success');assert.match(feedback.message,/not.*test recording/);
 }
});
test('preflight records requested and outcome events without joining or requesting capture',async()=>{
 const h=fixture();const result=await h.run({type:'TAB_CAPTURE_TEAMS_PREFLIGHT',scheduleId:'test'});
 assert.deepEqual(h.calls,['check','inspect']);
 assert.deepEqual(h.logs.map(e=>e.event),['setup_started','setup_readiness']);
 assert.equal(h.logs[1].level,'warning');assert.equal(result.feedback.tone,'warning');
});
test('identity mismatch produces a red result and logged explanation',async()=>{
 const h=fixture();h.joiner.inspect=async()=>({state:'blocked',reason:'Expected team mismatch'});
 const result=await h.run({type:'TAB_CAPTURE_TEAMS_PREFLIGHT',scheduleId:'test'});
 assert.equal(result.feedback.tone,'error');assert.match(h.logs.at(-1).message,/Expected team mismatch/);
});
test('manual refresh is logged, automatic refresh is not',async()=>{
 const h=fixture();await h.run({type:'TAB_CAPTURE_STATUS'});assert.equal(h.logs.length,0);
 await h.run({type:'TAB_CAPTURE_STATUS',userInitiated:true,scheduleId:'test'});
 assert.deepEqual(h.logs.map(e=>e.event),['setup_started','setup_refreshed']);
 assert.match(h.logs[1].message,/does not check whether a meeting exists/);
});
test('refresh identifies the selected schedule authorization failure',async()=>{
 const h=fixture();h.authorization.status=async()=>[{scheduleId:'test',available:false,message:'Reauthorization required'}];
 await h.run({type:'TAB_CAPTURE_STATUS',userInitiated:true,scheduleId:'test'});
 assert.equal(h.logs.at(-1).level,'warning');assert.match(h.logs.at(-1).message,/Reauthorization required/);
});
test('prepare logs pending human authorization, never authorization success',async()=>{
 const h=fixture();await h.run({type:'TAB_CAPTURE_REQUEST_AUTH',scheduleId:'test',targetTabId:7});
 assert.deepEqual(h.calls,['request','focus-tab','focus-window']);
 assert.equal(h.logs.at(-1).event,'setup_authorization_pending');
 assert.match(h.logs.at(-1).message,/not complete yet/);
});
for(const type of ['TAB_CAPTURE_STATUS','TAB_CAPTURE_TEAMS_PREFLIGHT','TAB_CAPTURE_REQUEST_AUTH']){
 test(`${type} records failures as well as the attempt`,async()=>{
  const h=fixture(),fail=async()=>{throw Error('Permission expired');};
  h.authorization.status=fail;h.authorization.check=fail;h.authorization.request=fail;
  await assert.rejects(()=>h.run({type,userInitiated:true,scheduleId:'test'}),/Permission expired/);
  assert.deepEqual(h.logs.map(e=>e.event),['setup_started','setup_failed']);
  assert.equal(h.logs.at(-1).level,'error');
 });
}
