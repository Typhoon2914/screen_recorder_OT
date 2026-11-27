import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCapturedAudio} from '../../src/automation/tab_capture.js';
import {createTelegramAlerts,alertForEvent} from '../../src/automation/telegram_alerts.js';

const token='123456789:ABCdefGHIjklMNOpqrSTUvwxYZ12345';
function storage(initial={}){
  const data=structuredClone(initial);
  return {data,async get(keys){const list=Array.isArray(keys)?keys:[keys];return Object.fromEntries(list.map(k=>[k,data[k]]));},
    async set(value){Object.assign(data,structuredClone(value));}};
}
test('manual capture audio monitor measures actual samples, emits one silent and one resumed event without restoring playback',async()=>{
  const previous=globalThis.AudioContext,previousTimer=globalThis.setInterval,previousClear=globalThis.clearInterval;
  let callback,amplitude=0,playbackConnections=0,closed=false;
  const analyser={fftSize:16,connect(){},disconnect(){},getFloatTimeDomainData(data){data.fill(amplitude);}};
  const source={connect(target){if(target===destination)playbackConnections++;},disconnect(){}};
  const destination={};
  class FakeContext{
    state='running';destination=destination;
    createMediaStreamSource(){return source;}
    createAnalyser(){return analyser;}
    resume(){return Promise.resolve();}
    close(){closed=true;return Promise.resolve();}
  }
  globalThis.AudioContext=FakeContext;
  globalThis.setInterval=cb=>{callback=cb;return 99;};
  globalThis.clearInterval=()=>{};
  try{
    const events=[];
    const monitor=await inspectCapturedAudio({getAudioTracks:()=>[{}]},{restorePlayback:false,silenceSeconds:30,onAudioState:e=>events.push(e)});
    for(let n=0;n<40;n++)callback();
    assert.equal(events.length,1);
    assert.deepEqual(events[0],{state:'silent',durationSeconds:30});
    amplitude=0.05;callback();
    assert.deepEqual(events[1],{state:'resumed',durationSeconds:40});
    assert.equal(playbackConnections,0,'manual capture must not echo source audio to output');
    await monitor.close();
    assert.equal(closed,true);
  }finally{
    globalThis.AudioContext=previous;
    globalThis.setInterval=previousTimer;
    globalThis.clearInterval=previousClear;
  }
});
test('manual recording alerts go through the real Telegram enqueue and delivery flow exactly once per session',async()=>{
  const sent=[];
  const st=storage({telegramAlerts:{enabled:true,token,chatId:'12345'}});
  const notification=createTelegramAlerts({storage:st,now:()=>100_000,fetchImpl:async(url,opts)=>{
    sent.push(JSON.parse(opts.body));return {ok:true,json:async()=>({ok:true})};
  }});
  const first={event:'audio_silence_prolonged',sessionId:'session-1',title:'Manual class',audioSilenceCycle:1,message:'Audio is quiet'};
  assert.equal(alertForEvent(first).severity,'warning');
  await notification.enqueue(first);await notification.flush();
  await notification.enqueue(first);await notification.flush();
  await notification.enqueue({...first,event:'audio_resumed'});await notification.flush();
  await notification.enqueue({...first,audioSilenceCycle:2});await notification.flush();
  assert.equal(sent.length,3);
  assert.match(sent[0].text,/Manual class/);
  assert.match(sent[1].text,/audio detected again/i);
  assert.ok(sent.every(x=>x.chat_id==='12345'));
});
