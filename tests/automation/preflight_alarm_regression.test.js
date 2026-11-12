import test from 'node:test';
import assert from 'node:assert/strict';
import {createChromeAutomationController} from '../../src/automation/chrome_controller.js';

const schedule={id:'lab-test',enabled:true,captureMode:'tab',teamsAutoJoin:true,
  weekdays:['Friday'],time:'10:00',launchWindowSeconds:60,targetUrl:'https://teams.microsoft.com/v2/',
  teamsTeam:'tEST',teamsChannel:'General',joinWaitMinutes:15,durationMinutes:2};
const now={date:'2026-11-13',weekday:'Friday',time:'09:52:00'};

function setup({enabled=true}={}){
  const data={automationSchedules:enabled?[schedule]:[],automationActiveRecording:null,automationPendingRecording:null};
  const calls=[];
  const api={
    storage:{local:{
      async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]));},
      async set(value){Object.assign(data,structuredClone(value));}
    }},
    alarms:{async create(){}}
  };
  const preflight=async (_schedule,candidate)=>calls.push(candidate);
  const controller=createChromeAutomationController({
    chromeApi:api,recorderUrl:'chrome-extension://fixture/pages/recorder.html',
    schedulesProvider:async()=>enabled?[schedule]:[],preflight,
    nowProvider:()=>now,nowMsProvider:()=>Date.parse('2026-11-13T09:52:00Z')
  });
  return {controller,calls,data};
}

test('schedule change does not iterate a function or trigger page refresh',async()=>{
 const {controller,calls}=setup();
 await assert.doesNotReject(controller.schedulesChanged([schedule]));
 assert.equal(calls.length,0);
});
test('preflight only runs from scheduler alarm in the ten-minute window',async()=>{
 const {controller,calls}=setup();
 await controller.handleAlarm({name:'screen-recorder-automation-poll'});
 assert.equal(calls.length,1);
 assert.equal(calls[0].scheduleId,'lab-test');
 assert.equal(calls[0].remainingSeconds,480);
});
test('disabled or empty schedules do not invoke preflight',async()=>{
 const {controller,calls}=setup({enabled:false});
 await controller.handleAlarm({name:'screen-recorder-automation-poll'});
 assert.deepEqual(calls,[]);
});
