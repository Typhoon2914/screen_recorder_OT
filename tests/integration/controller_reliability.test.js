import test from 'node:test';
import assert from 'node:assert/strict';
import {createChromeAutomationController,AUTOMATION_POLL_ALARM} from '../../src/automation/chrome_controller.js';
function fixture(){
  const state={}, messages=[];let controller;
  const schedule={id:'a',weekdays:['Sunday'],time:'21:00',launchWindowSeconds:120,durationMinutes:60,title:'Lecture'};
  const chromeApi={storage:{local:{get:async k=>({[k]:state[k]}),set:async v=>Object.assign(state,v)}},tabs:{query:async()=>[{id:1,url:'recorder'}],update:async()=>{},sendMessage:async(id,message)=>{
    messages.push(message);
    if(message.type==='REQUEST_RECORDING')await controller.handleRuntimeMessage({type:'RECORDING_STARTED',recordingId:'r1',occurrenceKey:message.occurrenceKey},{tab:{id:1}});
    return {ok:true};
  }}};
  controller=createChromeAutomationController({chromeApi,recorderUrl:'recorder',schedules:[schedule,{...schedule,id:'b'}],nowProvider:()=>({date:'2026-10-11',weekday:'Sunday',time:'21:00:05'}),nowMsProvider:()=>10000});
  return {state,messages,controller};
}
test('immediate start acknowledgement cannot race pending duration persistence',async()=>{
  const h=fixture();await h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM});
  assert.equal(h.state.automationActiveRecording?.recordingId,'r1');
});
test('overlapping schedules do not replace the active recording',async()=>{
  const h=fixture();await h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM});
  assert.equal(h.messages.filter(m=>m.type==='REQUEST_RECORDING').length,1);
});
test('simultaneous alarms dispatch only once and preserve schedule metadata',async()=>{
  const h=fixture();await Promise.all([h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM}),h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM})]);
  assert.equal(h.messages.length,1);assert.equal(h.messages[0].title,'Lecture');assert.equal(h.messages[0].durationMinutes,60);
});
test('closing the recording tab clears stale active state and reports failure',async()=>{
  const h=fixture();await h.controller.handleAlarm({name:AUTOMATION_POLL_ALARM});
  await h.controller.handleRecorderClosed(1);
  assert.equal(h.state.automationActiveRecording,null);
  assert.match(h.state.automationDiagnostic.message,/closed/);
});
