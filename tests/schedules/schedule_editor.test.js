import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScheduleConfig,updateSchedules} from '../../src/automation/schedule_store.js';
const base={id:'lecture',weekdays:['Sunday'],time:'21:00',launchWindowSeconds:120,enabled:true};
test('schedule editor accepts a titled timed Teams target',()=>{
  assert.doesNotThrow(()=>validateScheduleConfig({...base,title:'Algebra',durationMinutes:60,targetUrl:'https://teams.microsoft.com/l/meetup-join/example'}));
});
test('schedule editor rejects invalid duration, title and unsafe target URLs',()=>{
  for(const value of [{durationMinutes:0},{durationMinutes:1441},{durationMinutes:NaN},{title:42},{targetUrl:'javascript:alert(1)'},{targetUrl:'https://user:password@example.com/'},{targetUrl:'file:///secret'}]){
    assert.throws(()=>validateScheduleConfig({...base,...value}));
  }
});
test('legacy schedules remain valid without optional editor fields',()=>assert.doesNotThrow(()=>validateScheduleConfig(base)));
test('serialized schedule edits re-read storage and preserve unrelated concurrent edits',async()=>{
  let state={automationSchedules:[]},queue=Promise.resolve();
  const api={storage:{local:{get:async()=>structuredClone(state),set:async value=>{state=value;}}}};
  const locks={request:(_name,fn)=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;}};
  await Promise.all(['a','b'].map(id=>updateSchedules(api,items=>[...items,{...base,id}],locks)));
  assert.deepEqual(state.automationSchedules.map(s=>s.id),['a','b']);
});
