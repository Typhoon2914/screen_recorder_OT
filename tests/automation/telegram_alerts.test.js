import test from 'node:test';
import assert from 'node:assert/strict';
import {alertForEvent,createTelegramAlerts,validateTelegramConfig} from '../../src/automation/telegram_alerts.js';

function fakeStorage(initial={}){
  const data=structuredClone(initial);
  return {data,
    async get(keys){
      const list=Array.isArray(keys)?keys:[keys];
      return Object.fromEntries(list.map(k=>[k,data[k]]));
    },
    async set(fields){Object.assign(data,structuredClone(fields));}
  };
}
const token='123456789:ABCdefGHIjklMNOpqrSTUvwxYZ12345';
const config={enabled:true,token,chatId:'123456789'};
test('credentials are validated and not included in alert content',()=>{
  assert.deepEqual(validateTelegramConfig(config),config);
  assert.throws(()=>validateTelegramConfig({...config,chatId:'any'}),/chat ID/);
  assert.throws(()=>validateTelegramConfig({...config,token:'bad'}),/bot token/);
  assert.equal(alertForEvent({event:'saved',scheduleId:'lecture-a',message:'https://example.com/link'}).message.includes('example.com'),false);
});
test('early absence of a meeting is not a failure alert',()=>{
  assert.equal(alertForEvent({event:'retry_pending',scheduleId:'a'}),null);
  assert.equal(alertForEvent({event:'recording_finished',scheduleId:'a'}),null);
  assert.equal(alertForEvent({event:'saved'}),null);
  assert.equal(alertForEvent({event:'retry_expired',scheduleId:'a'}).severity,'critical');
});
test('queues once, sends one message, persists sent state across service worker restarts',async()=>{
  let count=0;
  const storage=fakeStorage({telegramAlerts:config});
  const api={storage,now:()=>100_000,fetchImpl:async(url,options)=>{
    count++;assert.ok(url.endsWith('/sendMessage'));
    assert.equal(JSON.parse(options.body).chat_id,config.chatId);
    return {ok:true,json:async()=>({ok:true})};
  }};
  const first=createTelegramAlerts(api);
  const event={event:'recording_started',scheduleId:'class',occurrenceKey:'2026-11-11T10:00'};
  assert.equal(await first.enqueue(event),true);
  assert.equal(await first.enqueue(event),false);
  await first.flush();
  const restarted=createTelegramAlerts(api);
  assert.equal(await restarted.enqueue(event),false);
  await restarted.flush();
  assert.equal(count,1);
  assert.equal(storage.data.telegramDeliveryStatus.state,'sent');
});
test('failed sends persist for retry and do not lose queued critical alerts',async()=>{
  let time=100_000,attempt=0;
  const storage=fakeStorage({telegramAlerts:config});
  const notifier=createTelegramAlerts({storage,now:()=>time,fetchImpl:async()=>{
    attempt++;
    if(attempt===1)throw Error('network unavailable');
    return {ok:true,json:async()=>({ok:true})};
  }});
  await notifier.enqueue({event:'save_failed',scheduleId:'class',occurrenceKey:'event1'});
  await notifier.flush();
  assert.equal(storage.data.telegramAlertOutbox.length,1);
  assert.equal(storage.data.telegramDeliveryStatus.state,'retrying');
  time+=61_000;await notifier.flush();
  assert.equal(storage.data.telegramAlertOutbox.length,0);
  assert.equal(storage.data.telegramDeliveryStatus.state,'sent');
});
test('disabled configuration does not send or queue notifications',async()=>{
  let count=0;
  const storage=fakeStorage({telegramAlerts:{...config,enabled:false}});
  const notifier=createTelegramAlerts({storage,fetchImpl:async()=>{count++;throw Error('should not call');}});
  assert.equal(await notifier.enqueue({event:'save_failed',scheduleId:'class'}),false);
  await notifier.flush();
  assert.equal(count,0);
});
