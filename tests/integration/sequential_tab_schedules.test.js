import test from 'node:test';
import assert from 'node:assert/strict';
import {createTabAuthorization} from '../../src/automation/tab_authorization.js';
import {createChromeAutomationController,AUTOMATION_POLL_ALARM} from '../../src/automation/chrome_controller.js';
import {createTeamsJoiner} from '../../src/automation/teams_join.js';

const url='https://teams.cloud.microsoft/';
function fixture(){
  const schedule={enabled:true,captureMode:'tab',targetUrl:url,durationMinutes:1,
    weekdays:['Sunday'],runDate:'2026-10-25',launchWindowSeconds:300,teamsAutoJoin:true,teamsChannel:'General',joinWaitMinutes:5};
  const local={automationSchedules:[{...schedule,id:'a',title:'First',time:'19:00',teamsTeam:'Team A'},
    {...schedule,id:'b',title:'Second',time:'19:01',teamsTeam:'Team B'}]},session={};
  const tabs=new Map([41,42].map((id,i)=>[id,{id,url,status:'complete',title:i?'Team B':'Team A'}]));
  const calls=[],joins=[],messages=[],logs=[];
  const store=data=>({get:async key=>typeof key==='string'?{[key]:structuredClone(data[key])}:structuredClone(data),
    set:async value=>{await Promise.resolve();Object.assign(data,structuredClone(value));},remove:async key=>{delete data[key];}});
  const api={storage:{local:store(local),session:store(session)},tabs:{
    get:async id=>{if(!tabs.has(id))throw Error('No tab');return {...tabs.get(id)};},query:async()=>[{id:3,url:'recorder'}],
    sendMessage:async(id,message)=>{messages.push(message);return {ok:true};}},
    scripting:{executeScript:async options=>{
      const tab=tabs.get(options.target.tabId);if(!tab)throw Error('No tab');
      if(options.func.name==='teamsJoinPageStep'){
        joins.push({tabId:tab.id,team:options.args[0].team});
        assert.equal(options.args[0].team,tab.title);
        return [{result:{state:'joined',ready:true}}];
      }
      return [{result:{url:tab.url,readyState:'complete'}}];
    }},tabCapture:{getMediaStreamId:async options=>{calls.push(options);return 'stream-'+calls.length;}}};
  const manager=createTabAuthorization(api);
  const authorize=async(id,tabId)=>{await manager.request(id,tabId);await manager.authorize(tabs.get(tabId));};
  return {local,session,tabs,calls,joins,messages,logs,api,manager,authorize};
}
test('same-URL schedules retain independent exact tabs across preparation and worker recreation',async()=>{
  const h=fixture();await h.authorize('a',41);await h.authorize('b',42);
  const manager=createTabAuthorization(h.api);
  assert.equal((await manager.check('a')).tabId,41);assert.equal((await manager.check('b')).tabId,42);
  await manager.prepare('a',3);await manager.prepare('b',3);
  assert.deepEqual(h.calls.map(c=>c.targetTabId),[41,42]);
  assert.ok((await manager.status()).every(item=>item.available));
});
test('preparing another schedule never silently replaces an unfinished toolbar request',async()=>{
  const h=fixture();await h.manager.request('a',41);
  await assert.rejects(()=>h.manager.request('b',42),/Another schedule/);
  assert.equal(h.session.tabCaptureAuthorizationIntent.scheduleId,'a');
  await h.manager.authorize(h.tabs.get(41));await h.authorize('b',42);
  assert.equal((await h.manager.check('a')).tabId,41);
});
test('old URL-only grants are not guessed into new schedule bindings',async()=>{
  const h=fixture();h.session.tabCaptureGrants={[url]:{tabId:41,url,origin:new URL(url).origin}};
  for(const id of ['a','b'])await assert.rejects(()=>h.manager.check(id),/Reauthorization/);
  assert.equal(h.calls.length,0);
});
test('a deleted pending preparation does not block preparing another schedule',async()=>{
  const h=fixture();await h.manager.request('a',41);
  h.local.automationSchedules=h.local.automationSchedules.filter(s=>s.id!=='a');
  await h.authorize('b',42);assert.equal((await h.manager.check('b')).tabId,42);
});
test('repreparing one schedule onto another tab does not change the other binding',async()=>{
  const h=fixture();await h.authorize('a',41);await h.authorize('b',42);
  h.tabs.set(43,{...h.tabs.get(41),id:43});await h.authorize('a',43);
  assert.equal((await h.manager.check('a')).tabId,43);assert.equal((await h.manager.check('b')).tabId,42);
});
test('team/channel edits invalidate only the edited schedule; timing edits keep its binding',async()=>{
  const h=fixture();await h.authorize('a',41);await h.authorize('b',42);
  h.local.automationSchedules[0].time='20:00';assert.equal((await h.manager.check('a')).tabId,41);
  h.local.automationSchedules[0].teamsChannel='Different';
  await assert.rejects(()=>h.manager.check('a'),/target changed/);
  assert.equal((await h.manager.check('b')).tabId,42);
});
test('closed or cross-origin tab revokes only schedules bound to that tab',async()=>{
  for(const closed of [true,false]){
    const h=fixture();await h.authorize('a',41);await h.authorize('b',42);
    if(closed)h.tabs.delete(41);else h.tabs.get(41).url='https://other.test/';
    await assert.rejects(()=>h.manager.check('a'),/Reauthorization/);
    assert.equal((await h.manager.check('b')).tabId,42);
  }
});
test('concurrent revoke and authorize cannot lose an unrelated grant',async()=>{
  const h=fixture();await h.authorize('a',41);await h.manager.request('b',42);
  await Promise.all([h.manager.revoke(41),h.manager.authorize(h.tabs.get(42))]);
  await assert.rejects(()=>h.manager.check('a'),/Reauthorization/);
  assert.equal((await h.manager.check('b')).tabId,42);
});
test('two explicitly bound sequential schedules join/capture their own tabs and wait for first save flow',async()=>{
  const h=fixture();await h.authorize('a',41);await h.authorize('b',42);
  let seconds=0;
  const joiner=createTeamsJoiner(h.api);
  const controller=createChromeAutomationController({chromeApi:h.api,recorderUrl:'recorder',
    schedulesProvider:async()=>h.local.automationSchedules,log:async e=>h.logs.push(e),
    nowProvider:()=>({date:'2026-10-25',weekday:'Sunday',time:'19:'+String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}),
    nowMsProvider:()=>Date.parse('2026-10-25T19:00:00Z')+seconds*1000,
    scheduledTargetProvider:async(id,run)=>{
      const target=await h.manager.check(id);
      return {...target,...await joiner.ensure(target.schedule,target,run)};
    }});
  const poll=()=>controller.handleAlarm({name:AUTOMATION_POLL_ALARM});
  const start=async(id)=>{
    await h.manager.prepare(id,3);
    await controller.handleRuntimeMessage({type:'RECORDING_STARTED',recordingId:id,occurrenceKey:h.local.automationPendingRecording.occurrenceKey},{tab:{id:3}});
  };
  const saved=async id=>controller.handleRuntimeMessage({type:'RECORDING_STOPPED',recordingId:id},{tab:{id:3}});
  await poll();await start('a');
  seconds=60;await poll();
  assert.equal(h.messages.at(-1).type,'REQUEST_STOP');
  assert.equal(h.joins.length,1,'B must not join while A is still saving');
  await saved('a');seconds=65;await poll();await start('b');
  assert.deepEqual(h.joins,[{tabId:41,team:'Team A'},{tabId:42,team:'Team B'}]);
  assert.deepEqual(h.calls.map(c=>c.targetTabId),[41,42]);
  seconds=125;await poll();await saved('b');await poll();
  assert.deepEqual(h.messages.filter(m=>m.type==='REQUEST_RECORDING').map(m=>m.scheduleId),['a','b']);
  assert.equal(h.local.automationActiveRecording,null);
  assert.ok(['a','b'].every(id=>h.local.automationRuns[id].state==='finished'));
  assert.equal((await h.manager.check('a')).tabId,41);assert.equal((await h.manager.check('b')).tabId,42);
});
