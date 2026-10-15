import test from 'node:test';
import assert from 'node:assert/strict';
import {createTabAuthorization} from '../../src/automation/tab_authorization.js';
import {acquireAuthorizedTab,validateAudioLevels} from '../../src/automation/tab_capture.js';

function harness(){
  const local={automationSchedules:[{id:'a',enabled:true,captureMode:'tab',targetUrl:'https://example.test/meeting',durationMinutes:1}]},session={};
  let tab={id:42,url:'https://example.test/meeting',title:'Lecture',status:'complete'},denied=false;
  const calls=[];
  const storage=data=>({get:async key=>typeof key==='string'?{[key]:data[key]}:{...data},set:async value=>Object.assign(data,value),remove:async key=>{delete data[key];}});
  const api={storage:{local:storage(local),session:storage(session)},tabs:{get:async()=>{if(!tab)throw Error('No tab');return {...tab};},query:async()=>tab?[tab]:[]},
    scripting:{executeScript:async()=>{if(denied)throw Error('Cannot access contents');return [{result:{url:tab.url,readyState:'complete'}}];}},
    tabCapture:{getMediaStreamId:async options=>{calls.push(options);if(denied)throw Error('Extension has not been invoked');return 'fresh-'+calls.length;}}};
  return {local,session,calls,api,manager:createTabAuthorization(api),tab:value=>{tab=value;},deny:()=>{denied=true;}};
}
async function authorize(h){await h.manager.request('a',42);await h.manager.authorize({id:42,url:'https://example.test/meeting',title:'Lecture'});}
test('tab authorization requires explicit pending target and cannot authorize a different tab',async()=>{
  const h=harness();assert.equal(await h.manager.authorize({id:42}),false);
  await h.manager.request('a',42);await assert.rejects(()=>h.manager.authorize({id:43,url:'https://example.test/meeting'}),/target/i);
});
test('tab authorization issues fresh one-use IDs repeatedly for exact consumer and target',async()=>{
  const h=harness();await authorize(h);
  const a=await h.manager.prepare('a',5),b=await h.manager.prepare('a',5);
  assert.notEqual(a.streamId,b.streamId);assert.deepEqual(h.calls,[{targetTabId:42,consumerTabId:5},{targetTabId:42,consumerTabId:5}]);
});
test('tab authorization survives worker recreation, not an empty browser session',async()=>{
  const h=harness();await authorize(h);await createTabAuthorization(h.api).check('a');
  for(const key of Object.keys(h.session))delete h.session[key];
  await assert.rejects(()=>h.manager.prepare('a',5),/reauthor/i);
});
test('tab authorization allows same-origin navigation but rejects cross-origin navigation',async()=>{
  const h=harness();await authorize(h);h.tab({id:42,url:'https://example.test/next',status:'complete'});
  await h.manager.check('a');h.tab({id:42,url:'https://other.test/meeting',status:'complete'});
  await assert.rejects(()=>h.manager.check('a'),/reauthor|origin/i);
});
test('tab closure never substitutes another tab at the same URL',async()=>{
  const h=harness();await authorize(h);h.tab(null);await assert.rejects(()=>h.manager.check('a'),/reauthor|closed/i);assert.equal(h.calls.length,0);
});
test('disabled, removed or retargeted schedules cannot consume authorization',async()=>{
  const h=harness();await authorize(h);h.local.automationSchedules[0].enabled=false;
  await assert.rejects(()=>h.manager.prepare('a',5),/disabled|cancel/i);
  h.local.automationSchedules[0].enabled=true;h.local.automationSchedules[0].targetUrl='https://example.test/different';
  await assert.rejects(()=>h.manager.prepare('a',5),/reauthor/i);
  h.local.automationSchedules=[];await assert.rejects(()=>h.manager.check('a'),/cancel|missing/i);
});
test('expired Chrome permission is detected rather than trusting stored authorization',async()=>{
  const h=harness();await authorize(h);h.deny();await assert.rejects(()=>h.manager.prepare('a',5),/reauthor/i);
  assert.equal((await h.manager.status())[0].available,false);
});
test('multiple matching schedules reuse one explicit tab authorization; ambiguity is rejected',async()=>{
  const h=harness();await authorize(h);h.local.automationSchedules.push({...h.local.automationSchedules[0],id:'b'});
  await h.manager.prepare('b',5);
  await h.manager.revoke(42,'closed');await assert.rejects(()=>h.manager.check('b'),/reauthor/i);
});
test('signal validation rejects missing, silent and invalid samples, retains quiet speech',()=>{
  for(const samples of [[],[-Infinity],[-90,-80],[NaN],[Infinity]])assert.throws(()=>validateAudioLevels(samples),/silent|invalid/i);
  assert.equal(validateAudioLevels([-Infinity,-50,-40]).peakDbfs,-40);
});
function fakeStream(){const tracks=['audio','video'].map(kind=>({kind,readyState:'live',stop(){this.readyState='ended';}}));return {getTracks:()=>tracks,getVideoTracks:()=>tracks.filter(t=>t.kind==='video'),getAudioTracks:()=>tracks.filter(t=>t.kind==='audio')};}
test('tab adapter never calls a picker and fully releases tracks on readiness failure',async()=>{
  const stream=fakeStream();await assert.rejects(()=>acquireAuthorizedTab({streamId:'id',getUserMedia:async()=>stream,inspect:async()=>{throw Error('silent');}}),/silent/);
  assert.ok(stream.getTracks().every(t=>t.readyState==='ended'));
});
test('tab adapter validates both track types and returns explicit cleanup',async()=>{
  const stream=fakeStream();let closed=0;
  const capture=await acquireAuthorizedTab({streamId:'id',getUserMedia:async constraints=>{assert.equal(constraints.video.mandatory.chromeMediaSourceId,'id');return stream;},inspect:async()=>({peakDbfs:-30,close:async()=>{closed++;}})});
  await capture.release();await capture.release();assert.equal(closed,1);assert.ok(stream.getTracks().every(t=>t.readyState==='ended'));
});
test('tab adapter releases capture when audio track is absent',async()=>{
  const stream=fakeStream();stream.getAudioTracks=()=>[];
  await assert.rejects(()=>acquireAuthorizedTab({streamId:'id',getUserMedia:async()=>stream,inspect:async()=>({})}),/audio/i);
  assert.ok(stream.getTracks().every(t=>t.readyState==='ended'));
});
test('tab adapter times out a stuck acquisition and stops a late stream',async()=>{
  const stream=fakeStream();let resolve;
  await assert.rejects(()=>acquireAuthorizedTab({streamId:'id',timeoutMs:5,getUserMedia:()=>new Promise(r=>{resolve=r;}),inspect:async()=>({})}),/timed out/i);
  resolve(stream);await new Promise(r=>setTimeout(r,0));
  assert.ok(stream.getTracks().every(t=>t.readyState==='ended'));
});
test('authorization status identifies associated schedule separately from tab title',async()=>{
 const h=harness();h.local.automationSchedules[0].title='Math lecture';await authorize(h);
 const [status]=await h.manager.status();assert.equal(status.title,'Math lecture');assert.equal(status.tabTitle,'Lecture');
});
test('transient same-origin loading is unavailable without discarding a session grant',async()=>{
 const h=harness();await authorize(h);h.tab({id:42,url:'https://example.test/next',status:'loading'});
 await assert.rejects(()=>h.manager.check('a'),/loading/i);
 h.tab({id:42,url:'https://example.test/next',status:'complete'});assert.equal((await h.manager.check('a')).available,true);
});
test('actual stream-ID denial revokes the grant even when script access still works',async()=>{
 const h=harness();await authorize(h);
 h.api.tabCapture.getMediaStreamId=async()=>{throw Error('Extension has not been invoked');};
 await assert.rejects(()=>h.manager.prepare('a',5),/Reauthorization required.*not been invoked/);
 assert.equal((await h.manager.status())[0].available,false);
});
test('expired toolbar intent cannot grant capture and is cleared',async()=>{
 const h=harness();await h.manager.request('a',42);h.session.tabCaptureAuthorizationIntent.expiresAt=0;
 await assert.rejects(()=>h.manager.authorize({id:42,url:'https://example.test/meeting'}),/expired/);
 assert.equal(h.session.tabCaptureAuthorizationIntent,undefined);assert.equal(h.session.tabCaptureGrants,undefined);
});
test('a pending cross-origin navigation is rejected before capturing the old document',async()=>{
 const h=harness();await authorize(h);h.tab({id:42,url:'https://example.test/meeting',pendingUrl:'https://other.test/',status:'complete'});
 await assert.rejects(()=>h.manager.prepare('a',5),/origin/i);assert.equal(h.calls.length,0);
});
