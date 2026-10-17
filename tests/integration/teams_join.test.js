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
