import test from 'node:test';
import assert from 'node:assert/strict';
import {alertForEvent,createTelegramAlerts} from '../../src/automation/telegram_alerts.js';

const lecture='Test Meeting';
const base={scheduleId:'f7733c05-25fd-4b37-b524-e1fa6e906093',scheduleName:lecture,occurrenceKey:'2026-11-13|01:00'};
const milestoneEvents=[
  'run_attempt','tab_located','teams_meeting_located','teams_prejoin_ready',
  'teams_join_clicked','teams_joined','recording_started',
  'recording_heartbeat','capture_stopped','saving','saved'
];
const botToken='123456789:ABCdefGHIjklMNOpqrSTUvwxYZ12345';
function storage(initial) {
  const data=structuredClone(initial);
  return {data,async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]));},
    async set(value){Object.assign(data,structuredClone(value));}};
}
test('every requested lifecycle milestone is a named, positive Telegram notification',()=>{
  for(const event of milestoneEvents){
    const alert=alertForEvent({...base,event});
    assert.ok(alert,event);
    assert.equal(alert.severity,'info',event);
    assert.match(alert.message,/Lecture: Test Meeting/);
    assert.equal(alert.message.includes(base.scheduleId),false,'Do not display internal schedule UUID');
  }
});
test('the heartbeat includes verified runtime details without claiming a saved file',()=>{
  const alert=alertForEvent({...base,event:'recording_heartbeat',elapsedMinutes:5,
    message:'Live audio/video tracks and recording session checked at minute five.'});
  assert.match(alert.message,/Recording still active/);
  assert.match(alert.message,/minute five/);
  assert.doesNotMatch(alert.message,/saved and verified/);
});
test('a restarted worker sends one notification per milestone, and separate timed heartbeats',async()=>{
  const messages=[];
  const local=storage({telegramAlerts:{enabled:true,token:botToken,chatId:'-1004456281408'}});
  const options={storage:local,now:()=>120000,fetchImpl:async(_url,request)=>{
    messages.push(JSON.parse(request.body).text);
    return {ok:true,json:async()=>({ok:true})};
  }};
  const alerts=createTelegramAlerts(options);
  for(const event of milestoneEvents)await alerts.enqueue({...base,event,heartbeatNumber:event==='recording_heartbeat'?1:undefined});
  await alerts.flush();
  const replacement=createTelegramAlerts(options);
  for(const event of milestoneEvents)await replacement.enqueue({...base,event,heartbeatNumber:event==='recording_heartbeat'?1:undefined});
  await replacement.flush();
  assert.equal(messages.length,milestoneEvents.length);
  await replacement.enqueue({...base,event:'recording_heartbeat',heartbeatNumber:5});
  await replacement.flush();
  assert.equal(messages.length,milestoneEvents.length+1);
});
