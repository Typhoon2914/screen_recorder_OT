import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioSilenceTracker,normalizeSilenceSeconds,normalizeShortWarningSeconds,normalizeHeartbeatMinutes,validateLabNotificationSettings} from '../../src/automation/audio_monitor.js';
import {alertForEvent} from '../../src/automation/telegram_alerts.js';

test('silence threshold is bounded to supported options',()=>{
  assert.equal(normalizeSilenceSeconds('60'),60);
  assert.equal(normalizeSilenceSeconds('9999'),120);
  assert.equal(normalizeSilenceSeconds(null),120);
  assert.equal(normalizeSilenceSeconds('31'),31);
  assert.equal(normalizeShortWarningSeconds('0'),0);
  assert.equal(normalizeHeartbeatMinutes('0'),0);
  assert.equal(normalizeHeartbeatMinutes('15'),15);
});
test('silent audio sends one warning, does not stop capture, and sends recovery once',()=>{
  const events=[];
  const monitor=createAudioSilenceTracker({silenceSeconds:30,onEvent:e=>events.push(e)});
  for(let i=0;i<45;i++)monitor.observe(-Infinity);
  assert.deepEqual(events,[{state:'silent',durationSeconds:30}]);
  monitor.observe(-30);
  assert.deepEqual(events[1],{state:'resumed',durationSeconds:45});
  monitor.observe(-20);
  assert.equal(events.length,2);
});
test('intermittent audio resets the counter and a second silence produces a new warning',()=>{
  const events=[];
  const monitor=createAudioSilenceTracker({silenceSeconds:30,onEvent:e=>events.push(e)});
  for(let i=0;i<29;i++)monitor.observe(-90);
  monitor.observe(-20);
  assert.equal(events.length,0);
  for(let i=0;i<30;i++)monitor.observe(-90);
  monitor.observe(-20);
  for(let i=0;i<30;i++)monitor.observe(-90);
  assert.deepEqual(events.map(e=>e.state),['silent','resumed','silent']);
});
test('Telegram distinguishes silence and recovery without asserting lecturer absence',()=>{
  const base={scheduleId:'algorithms',occurrenceKey:'2026-11-22'};
  const warning=alertForEvent({...base,event:'audio_silence_prolonged',message:'Audio quiet for 120s'});
  const resumed=alertForEvent({...base,event:'audio_resumed'});
  assert.equal(warning.severity,'warning');
  assert.equal(resumed.severity,'info');
  assert.doesNotMatch(warning.message,/professor (has )?left/i);
});

test('editable notification settings reject invalid inputs, allow disable, and retain custom times',()=>{
  assert.deepEqual(validateLabNotificationSettings({silenceSeconds:'37',shortWarningSeconds:'0',heartbeatMinutes:'17'}),
    {silenceSeconds:37,shortWarningSeconds:0,heartbeatMinutes:17});
  for(const input of [
    {silenceSeconds:'0',shortWarningSeconds:'10',heartbeatMinutes:'5'},
    {silenceSeconds:'30',shortWarningSeconds:'-1',heartbeatMinutes:'5'},
    {silenceSeconds:'30',shortWarningSeconds:'10',heartbeatMinutes:'2.5'},
    {silenceSeconds:'30',shortWarningSeconds:'10',heartbeatMinutes:'121'}
  ])assert.throws(()=>validateLabNotificationSettings(input),/whole number/);
});
