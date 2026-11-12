import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightCandidate,createTeamsPreflight} from '../../src/automation/teams_preflight.js';

const schedule={id:'class-1',enabled:true,captureMode:'tab',teamsAutoJoin:true,
  weekdays:['Thursday'],runDate:'2026-11-12',time:'10:00'};
const now={date:'2026-11-12',weekday:'Thursday',time:'09:52:00'};
function mock({state='waiting',busy=false,checkError=null}={}){
 const data={automationActiveRecording:busy?{id:'active'}:null};
 let reloads=0,inspections=0;
 const api={storage:{local:{
   async get(keys){const k=Array.isArray(keys)?keys:[keys];return Object.fromEntries(k.map(x=>[x,data[x]]));},
   async set(o){Object.assign(data,structuredClone(o));}
 }},tabs:{
   async get(id){return {id,url:'https://teams.microsoft.com/v2/',status:'complete'};},
   async reload(id){reloads++;assert.equal(id,3);}
 }};
 const authorize={async check(){if(checkError)throw Error(checkError);return {tabId:3,origin:'https://teams.microsoft.com'};}};
 const inspect=async()=>{inspections++;return {state}};
 return {api,authorize,inspect,data,reloads:()=>reloads,inspections:()=>inspections};
}
test('preflight only runs in the ten-minute window for enabled matching Teams schedules',()=>{
 assert.equal(preflightCandidate(schedule,now).remainingSeconds,480);
 assert.equal(preflightCandidate(schedule,{...now,time:'09:49:59'}),null);
 assert.equal(preflightCandidate(schedule,{...now,time:'10:00:00'}),null);
 assert.equal(preflightCandidate({...schedule,preflightRefresh:false},now),null);
 assert.equal(preflightCandidate({...schedule,teamsAutoJoin:false},now),null);
 assert.equal(preflightCandidate({...schedule,runDate:'2026-11-13'},now),null);
});
test('refreshes the same tab once and survives next poll/worker recreation',async()=>{
 const x=mock();const key=preflightCandidate(schedule,now);
 await createTeamsPreflight({...x,now:()=>new Date(0).toISOString()})(schedule,key);
 await createTeamsPreflight({...x,now:()=>new Date(0).toISOString()})(schedule,key);
 assert.equal(x.reloads(),1);
 assert.equal(x.inspections(),1);
 assert.equal(x.data.teamsPreflightRuns[key.occurrenceKey].state,'refreshed');
});
test('never refreshes when a meeting is visible, joined, or identity-blocked',async()=>{
 for(const state of ['channel_ready','joined','joining','prejoin','blocked','departed']){
  const x=mock({state});await createTeamsPreflight(x)(schedule,preflightCandidate(schedule,now));
  assert.equal(x.reloads(),0,state);
 }
});
test('active capture prevents refresh, authorization failure warns without reload',async()=>{
 const busy=mock({busy:true});const key=preflightCandidate(schedule,now);
 await createTeamsPreflight(busy)(schedule,key);
 assert.equal(busy.reloads(),0);
 const unavailable=mock({checkError:'Reauthorization required'});
 const events=[];
 await createTeamsPreflight({...unavailable,log:async e=>events.push(e)})(schedule,key);
 assert.equal(unavailable.reloads(),0);
 assert.equal(events[0].event,'preflight_attention');
});
