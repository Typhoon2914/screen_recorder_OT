import test from 'node:test';
import assert from 'node:assert/strict';
import {createTeamsJoiner} from '../../src/automation/teams_join.js';
import {validateScheduleConfig} from '../../src/automation/schedule_store.js';
const base={id:'lecture',enabled:true,weekdays:['Saturday'],time:'20:31',launchWindowSeconds:900,durationMinutes:119,captureMode:'tab',targetUrl:'https://teams.cloud.microsoft/v2/channel/example',teamsAutoJoin:true,teamsTeam:'Advanced AI',teamsChannel:'General',joinWaitMinutes:15};
function harness(results){
 const local={automationSchedules:[{...base}]},session={},calls=[];
 const storage=data=>({get:async key=>({[key]:structuredClone(data[key])}),set:async v=>Object.assign(data,v)});
 const api={storage:{local:storage(local),session:storage(session)},tabs:{get:async()=>({id:7,url:base.targetUrl,status:'complete'})},scripting:{executeScript:async request=>{calls.push(request);return [{result:results.shift()}];}}};
 return {local,session,calls,api,joiner:createTeamsJoiner(api,{sleep:async()=>{},maxSteps:4})};
}
test('Teams join waits for meeting without recording',async()=>{const h=harness([{state:'waiting'}]);assert.equal((await h.joiner.ensure(base,{tabId:7})).ready,false);assert.equal(h.calls.length,1);});
test('Teams join advances through verified prejoin on exact tab',async()=>{const h=harness([{state:'prejoin'},{state:'joining'},{state:'joined',ready:true}]);assert.equal((await h.joiner.ensure(base,{tabId:7})).ready,true);assert.deepEqual(h.calls.map(c=>c.args[0].phase),['channel','prejoin','joining']);assert.ok(h.calls.every(c=>c.target.tabId===7));});
test('Teams join resumes from session state after suspension',async()=>{const h=harness([{state:'joining'}]);await createTeamsJoiner(h.api,{sleep:async()=>{},maxSteps:1}).ensure(base,{tabId:7});h.api.scripting.executeScript=async r=>{assert.equal(r.args[0].phase,'joining');return [{result:{state:'joined',ready:true}}];};assert.equal((await createTeamsJoiner(h.api).ensure(base,{tabId:7})).ready,true);});
test('Teams join rejects changed origin without injection',async()=>{const h=harness([]);h.api.tabs.get=async()=>({url:'https://example.com/',status:'complete'});await assert.rejects(()=>h.joiner.ensure(base,{tabId:7}),/origin/);assert.equal(h.calls.length,0);});
test('Teams join stops when schedule disabled',async()=>{const h=harness([]);h.local.automationSchedules[0].enabled=false;await assert.rejects(()=>h.joiner.ensure(base,{tabId:7}),/cancelled/);assert.equal(h.calls.length,0);});
test('Teams join stops when configuration changed',async()=>{const h=harness([]);h.local.automationSchedules[0].teamsTeam='Other';await assert.rejects(()=>h.joiner.ensure(base,{tabId:7}),/changed/);assert.equal(h.calls.length,0);});
test('Teams join cannot claim readiness on wrong channel',async()=>{const h=harness([{state:'blocked',reason:'Wrong team/channel'}]);await assert.rejects(()=>h.joiner.ensure(base,{tabId:7}),/Wrong team/);});
test('Teams join rejects invalid script results',async()=>{for(const result of [undefined,{state:'unknown'},{state:'waiting',ready:true}]){const h=harness([result]);await assert.rejects(()=>h.joiner.ensure(base,{tabId:7}),/Invalid/);}});
test('Teams schedule validation requires URL names and bounded retry',()=>{assert.doesNotThrow(()=>validateScheduleConfig(base));for(const v of [{targetUrl:'https://example.com/'},{teamsTeam:''},{teamsChannel:''},{captureMode:'manual'},{joinWaitMinutes:0},{joinWaitMinutes:61},{teamsAutoJoin:'yes'}])assert.throws(()=>validateScheduleConfig({...base,...v}));});
test('Legacy schedules remain valid without Teams joining',()=>assert.doesNotThrow(()=>validateScheduleConfig({id:'old',enabled:true,weekdays:['Saturday'],time:'20:31',launchWindowSeconds:120})));
test('blocked Teams checks retain a timestamped failure tied to the schedule',async()=>{
 const h=harness([{state:'blocked',reason:'Team mismatch: expected Advanced AI; observed Other'}]);
 await assert.rejects(()=>h.joiner.ensure(base,{tabId:7}),/Team mismatch/);
 assert.equal(h.local.automationJoinEvents.length,1);
 assert.equal(h.local.automationJoinEvents[0].scheduleId,base.id);
 assert.equal(h.local.automationJoinEvents[0].state,'teams_blocked');
 assert.match(h.local.automationJoinEvents[0].message,/observed Other/);
 assert.ok(Number.isFinite(Date.parse(h.local.automationJoinEvents[0].at)));
 assert.equal(h.session.teamsJoinSessions,undefined);
});
test('Teams preflight is read-only and uses the same authorized target and saved configuration',async()=>{
 const h=harness([{state:'channel_ready',ready:false,reason:'Channel verified; meeting available'}]);
 const before=structuredClone({local:h.local,session:h.session});
 const result=await h.joiner.inspect(base,{tabId:7});
 assert.equal(result.state,'channel_ready');
 assert.equal(result.ready,false);
 assert.equal(h.calls[0].target.tabId,7);
 assert.equal(h.calls[0].args[0].inspectOnly,true);
 assert.equal(h.calls[0].args[0].team,base.teamsTeam);
 assert.deepEqual({local:h.local,session:h.session},before);
});
test('Teams preflight refuses changed configuration and origin before injection',async()=>{
 for(const changed of ['configuration','origin']){
  const h=harness([]);
  if(changed==='configuration')h.local.automationSchedules[0].teamsTeam='Other';
  else h.api.tabs.get=async()=>({url:'https://example.com',status:'complete'});
  await assert.rejects(()=>h.joiner.inspect(base,{tabId:7}),/changed/);
  assert.equal(h.calls.length,0);
 }
});
test('Teams preflight does not inspect a disabled or loading tab',async()=>{
 const disabled=harness([]);disabled.local.automationSchedules[0].enabled=false;
 await assert.rejects(()=>disabled.joiner.inspect(base,{tabId:7}),/cancelled/);
 assert.equal(disabled.calls.length,0);
 const loading=harness([]);loading.api.tabs.get=async()=>({url:base.targetUrl,status:'loading'});
 assert.equal((await loading.joiner.inspect(base,{tabId:7})).state,'waiting');
 assert.equal(loading.calls.length,0);
});
test('Teams preflight rejects pending cross-origin navigation',async()=>{
 const h=harness([]);
 h.api.tabs.get=async()=>({url:base.targetUrl,pendingUrl:'https://example.com/',status:'complete'});
 await assert.rejects(()=>h.joiner.inspect(base,{tabId:7}),/origin changed/);
 assert.equal(h.calls.length,0);
});
test('Teams preflight cannot report actual recording readiness',async()=>{
 const h=harness([{state:'joined',ready:true}]);
 assert.equal((await h.joiner.inspect(base,{tabId:7})).ready,false);
 h.api.scripting.executeScript=async()=>[{result:{state:'invalid'}}];
 await assert.rejects(()=>h.joiner.inspect(base,{tabId:7}),/Invalid Teams readiness/);
});
test('blocked Teams diagnostics keep only the latest 100 events',async()=>{
 const h=harness([{state:'blocked',reason:'Identity mismatch'}]);
 h.local.automationJoinEvents=Array.from({length:100},(_,i)=>({message:String(i)}));
 await assert.rejects(()=>h.joiner.ensure(base,{tabId:7}),/Identity mismatch/);
 assert.equal(h.local.automationJoinEvents.length,100);
 assert.equal(h.local.automationJoinEvents[0].message,'1');
 assert.equal(h.local.automationJoinEvents.at(-1).message,'Identity mismatch');
});
