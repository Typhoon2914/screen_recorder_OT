import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeScheduler} from '../../companion/scheduler.js';
const schedule={id:'lecture',title:'Controlled lecture',weekdays:['Thursday'],time:'13:55',durationMinutes:1,launchWindowSeconds:120,enabled:true};
const when=new Date('2026-10-15T13:55:05');
async function fixture(options={}){
  const writes=[],calls=[];
  const scheduler=await createNativeScheduler({load:async()=>({schedules:[schedule],handled:[],history:[]}),persist:async state=>writes.push(structuredClone(state)),now:()=>when,record:async job=>{calls.push(job);return {verified:true,file:'C:/experiment/lecture.mp4',bytes:100,media:{duration:60}};},...options});
  return {scheduler,writes,calls};
}
test('native scheduler starts an idle due occurrence without a capture arm',async()=>{
  const h=await fixture();await h.scheduler.tick();assert.equal(h.calls.length,1);assert.equal(h.scheduler.snapshot().history[0].state,'saved');
});
test('native scheduler persists intent before starting and does not replay duplicates',async()=>{
  const h=await fixture();await h.scheduler.tick();await h.scheduler.tick();assert.equal(h.calls.length,1);assert.equal(h.writes[0].active.state,'starting');assert.equal(h.writes[0].handled.length,1);
});
test('native scheduler rejects unverified output instead of reporting saved',async()=>{
  const h=await fixture({record:async()=>({file:'empty.mp4',bytes:100})});await h.scheduler.tick();assert.equal(h.scheduler.snapshot().active.state,'failed');assert.equal(h.scheduler.snapshot().history[0].state,'failed');
});
test('native scheduler preserves an unresolved restart operation and never starts another',async()=>{
  const h=await fixture({load:async()=>({schedules:[schedule],handled:[],history:[],active:{id:'previous',state:'recording'}})});await h.scheduler.tick();assert.equal(h.calls.length,0);assert.equal(h.scheduler.snapshot().phase,'recovery_required');
});
test('native scheduler excludes overlapping concurrent polls',async()=>{
  let finish;const h=await fixture({record:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=h.scheduler.tick();await new Promise(resolve=>setImmediate(resolve));await h.scheduler.tick();
  finish({verified:true,file:'lecture.mp4',bytes:100});await pending;assert.equal(h.scheduler.snapshot().history.length,1);
});
test('native scheduler rejects schedules without bounded recording duration',async()=>{
  const h=await fixture();await assert.rejects(h.scheduler.sync([{...schedule,durationMinutes:undefined}]),/duration/i);
});
test('native scheduler keeps prior configuration if validation fails',async()=>{
  const h=await fixture();await assert.rejects(h.scheduler.sync([{...schedule,time:'bad'}]));assert.equal(h.scheduler.snapshot().schedules[0].time,'13:55');
});
test('native scheduler supports consecutive nonoverlapping occurrences',async()=>{
  let d=when;const h=await fixture({now:()=>d});await h.scheduler.tick();d=new Date('2026-10-22T13:55:05');await h.scheduler.tick();assert.equal(h.calls.length,2);
});
