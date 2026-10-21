import test from 'node:test';
import assert from 'node:assert/strict';
import {createChromeAutomationController,AUTOMATION_POLL_ALARM} from '../../src/automation/chrome_controller.js';
import {createTeamsJoiner} from '../../src/automation/teams_join.js';
import {createActivityLog,safeLogText} from '../../src/automation/activity_log.js';
const alarm={name:AUTOMATION_POLL_ALARM};
const base={id:'test',enabled:true,weekdays:['Tuesday'],time:'19:00',durationMinutes:1,
 launchWindowSeconds:300,captureMode:'tab',targetUrl:'https://teams.cloud.microsoft/',
 teamsAutoJoin:true,teamsTeam:'tEST',teamsChannel:'General',joinWaitMinutes:5};
function fixture(){
 const state={automationSchedules:[structuredClone(base)]},messages=[],logs=[],session={};
 let clock=Date.parse('2026-10-20T19:00:00Z'),time='19:00:00',date='2026-10-20',target=async()=>({ready:true});
 const store=data=>({get:async key=>({[key]:structuredClone(data[key])}),set:async value=>Object.assign(data,structuredClone(value))});
 const api={storage:{local:store(state),session:store(session)},tabs:{
  query:async()=>[{id:3,url:'recorder'}],get:async()=>({id:7,url:base.targetUrl,status:'complete'}),
  sendMessage:async(id,message)=>{messages.push(message);return {ok:true};}
 }};
 const controller=createChromeAutomationController({chromeApi:api,recorderUrl:'recorder',
  schedulesProvider:async()=>state.automationSchedules.filter(s=>s.enabled),
  scheduledTargetProvider:(...args)=>target(...args),log:async event=>logs.push(event),
  nowProvider:()=>({date,weekday:'Tuesday',time}),nowMsProvider:()=>clock});
 return {api,state,session,messages,logs,controller,target:fn=>{target=fn;},advance:(seconds,newTime,newDate=date)=>{clock+=seconds*1000;time=newTime;date=newDate;}};
}
test('rescheduling while target preparation is in flight prevents dispatch',async()=>{
 const h=fixture();h.target(async()=>{h.state.automationSchedules[0].time='20:00';return {ready:true};});
 await h.controller.handleAlarm(alarm);
 assert.equal(h.messages.length,0);
 assert.ok(h.logs.some(e=>e.event==='attempt_cancelled'));
});
for(const action of ['disable','delete','time','duration']){
 test(`${action} invalidates a sleeping join before its next page click`,async()=>{
  const h=fixture();let calls=0;
  h.api.scripting={executeScript:async()=>{calls++;return [{result:{state:'prejoin'}}];}};
  const joiner=createTeamsJoiner(h.api,{sleep:async()=>{
   if(action==='disable')h.state.automationSchedules[0].enabled=false;
   if(action==='delete')h.state.automationSchedules=[];
   if(action==='time')h.state.automationSchedules[0].time='20:00';
   if(action==='duration')h.state.automationSchedules[0].durationMinutes=2;
  }});
  await assert.rejects(()=>joiner.ensure(base,{tabId:7},{occurrenceKey:'test|2026-10-20|19:00'}),/cancelled/i);
  assert.equal(calls,1);
 });
}
test('cancel this run interrupts an in-flight attempt and survives controller polling',async()=>{
 const h=fixture();let entered,release;
 const begun=new Promise(r=>entered=r),waiting=new Promise(r=>release=r);
 h.target(async()=>{entered();await waiting;return {ready:true};});
 const polling=h.controller.handleAlarm(alarm);await begun;
 await h.controller.cancelRun('test');release();await polling;
 await h.controller.handleAlarm(alarm);
 assert.equal(h.messages.length,0);
 assert.equal(h.state.automationSchedules[0].enabled,true);
 assert.deepEqual(h.state.automationCancelledOccurrences,['test|2026-10-20|19:00']);
});
test('retry logs identify next check and expiry, then expire without another join',async()=>{
 const h=fixture();let attempts=0;
 h.target(async()=>{attempts++;return {ready:false,reason:'Meeting absent'};});
 await h.controller.handleAlarm(alarm);
 const entry=h.logs.find(e=>e.event==='retry_pending');
 assert.equal(entry.nextRetryAt,'2026-10-20T19:01:00.000Z');
 assert.equal(entry.expiresAt,'2026-10-20T19:05:00.000Z');
 h.advance(360,'19:06:00');await h.controller.handleAlarm(alarm);
 assert.equal(attempts,1);assert.equal(h.state.automationRuns.test.state,'expired');
});
test('cancellation survives worker recreation but does not disable next week',async()=>{
 const h=fixture();h.target(async()=>({ready:false}));
 await h.controller.handleAlarm(alarm);await h.controller.cancelRun('test');
 const recreated=createChromeAutomationController({chromeApi:h.api,recorderUrl:'recorder',
  schedules:[base],scheduledTargetProvider:async()=>({ready:true}),
  nowProvider:()=>({date:'2026-10-20',weekday:'Tuesday',time:'19:00:00'})});
 await recreated.handleAlarm(alarm);
 assert.equal(h.messages.length,0);
 h.advance(7*86400,'19:00:00','2026-10-27');h.target(async()=>({ready:true}));
 await h.controller.handleAlarm(alarm);
 assert.equal(h.messages.filter(m=>m.type==='REQUEST_RECORDING').length,1);
});
test('start window expiring during target preparation prevents recording',async()=>{
 const h=fixture();h.target(async()=>{h.advance(301,'19:05:01');return {ready:true};});
 await h.controller.handleAlarm(alarm);
 assert.equal(h.messages.length,0);assert.equal(h.state.automationRuns.test.state,'expired');
});
test('a fast disable and re-enable still cancels the original pending attempt',async()=>{
 const h=fixture();h.target(async()=>({ready:false}));await h.controller.handleAlarm(alarm);
 await h.controller.schedulesChanged([{...base,enabled:false}]);
 await h.controller.handleAlarm(alarm);
 assert.equal(h.state.automationRuns.test.state,'cancelled');
 assert.equal(h.state.automationSchedules[0].enabled,true);
});
test('disabling a schedule does not interrupt recording already in progress',async()=>{
 const h=fixture();await h.controller.handleAlarm(alarm);
 await h.controller.handleRuntimeMessage({type:'RECORDING_STARTED',recordingId:'active',occurrenceKey:h.state.automationPendingRecording.occurrenceKey},{tab:{id:3}});
 h.state.automationSchedules[0].enabled=false;await h.controller.schedulesChanged();
 assert.equal(h.messages.filter(m=>m.type==='REQUEST_STOP').length,0);
 assert.equal(h.state.automationActiveRecording.recordingId,'active');
 await h.controller.cancelRun('test');
 assert.equal(h.messages.at(-1).reason,'run_cancelled');
});
test('schedule storage changes clear pending starts without stopping an existing recording',async()=>{
 const h=fixture();await h.controller.handleAlarm(alarm);
 h.state.automationSchedules[0].enabled=false;
 await h.controller.schedulesChanged();
 assert.equal(h.state.automationPendingRecording,null);
 assert.equal(h.state.automationRuns.test.state,'cancelled');
});
test('late recording acknowledgement after cancellation requests stop',async()=>{
 const h=fixture();await h.controller.handleAlarm(alarm);
 const occurrenceKey=h.state.automationPendingRecording.occurrenceKey;
 await h.controller.cancelRun('test');
 await h.controller.handleRuntimeMessage({type:'RECORDING_STARTED',recordingId:'late',occurrenceKey},{tab:{id:3}});
 assert.equal(h.messages.at(-1).type,'REQUEST_STOP');
 assert.equal(h.messages.at(-1).reason,'run_cancelled');
});
test('failed cancel-stop delivery remains pending and retries without waiting for duration',async()=>{
 const h=fixture();await h.controller.handleAlarm(alarm);
 await h.controller.handleRuntimeMessage({type:'RECORDING_STARTED',recordingId:'active',occurrenceKey:h.state.automationPendingRecording.occurrenceKey},{tab:{id:3}});
 const original=h.api.tabs.sendMessage;h.api.tabs.sendMessage=async()=>({ok:false});
 await assert.rejects(()=>h.controller.cancelRun('test'),/Stop delivery failed/);
 assert.equal(h.state.automationActiveRecording.cancelRequested,true);
 h.api.tabs.sendMessage=original;await h.controller.handleAlarm(alarm);
 assert.equal(h.messages.at(-1).reason,'run_cancelled');
});
test('a fast stop completion cannot resurrect stale active state',async()=>{
 const h=fixture();await h.controller.handleAlarm(alarm);
 await h.controller.handleRuntimeMessage({type:'RECORDING_STARTED',recordingId:'active',occurrenceKey:h.state.automationPendingRecording.occurrenceKey},{tab:{id:3}});
 h.api.tabs.sendMessage=async()=>{
  await h.controller.handleRuntimeMessage({type:'RECORDING_STOPPED',recordingId:'active'},{tab:{id:3}});
  return {ok:true};
 };
 h.advance(60,'19:01:00');await h.controller.handleAlarm(alarm);
 assert.equal(h.state.automationActiveRecording,null);
});
test('verified departure cancels occurrence instead of scheduling another join',async()=>{
 const h=fixture();h.target(async()=>({ready:false,departed:true}));
 await h.controller.handleAlarm(alarm);await h.controller.handleAlarm(alarm);
 assert.equal(h.messages.length,0);
 assert.equal(h.state.automationRuns.test.state,'cancelled');
 assert.ok(h.logs.some(e=>e.message.includes('departure')));
});
test('stop request and completed save flow are separate; next recording does not replace active',async()=>{
 const h=fixture();await h.controller.handleAlarm(alarm);
 await h.controller.handleRuntimeMessage({type:'RECORDING_STARTED',recordingId:'first',occurrenceKey:h.state.automationPendingRecording.occurrenceKey},{tab:{id:3}});
 h.state.automationSchedules.push({...base,id:'second',time:'19:01'});
 h.advance(60,'19:01:00');await h.controller.handleAlarm(alarm);
 assert.equal(h.messages.filter(m=>m.type==='REQUEST_RECORDING').length,1);
 assert.equal(h.state.automationActiveRecording.recordingId,'first');
 assert.ok(h.logs.some(e=>e.event==='stop_requested'));
 await h.controller.handleRuntimeMessage({type:'RECORDING_STOPPED',recordingId:'first'},{tab:{id:3}});
 await h.controller.handleAlarm(alarm);
 assert.equal(h.messages.filter(m=>m.type==='REQUEST_RECORDING').length,2);
 assert.equal(h.state.automationPendingRecording.scheduleId,'second');
});
test('activity logger serializes events, bounds storage and omits unsafe fields',async()=>{
 const h=fixture(),log=createActivityLog(h.api,{now:()=> '2026-10-20T19:00:00Z'});
 h.state.automationActivityLog=Array.from({length:499},(_,n)=>({message:String(n)}));
 await Promise.all([1,2,3].map(n=>log({event:'step',message:`event ${n} https://example.test/private?token=abc`,token:'must-not-store'})));
 const entries=h.state.automationActivityLog;
 assert.equal(entries.length,500);
 assert.deepEqual(entries.slice(-3).map(e=>e.message),[1,2,3].map(n=>`event ${n} [URL omitted]`));
 assert.ok(entries.every(e=>!('token' in e)));
 assert.equal(safeLogText('password=abc token:def'),'password=[redacted] token=[redacted]');
});
