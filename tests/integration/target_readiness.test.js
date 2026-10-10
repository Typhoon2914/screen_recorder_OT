import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTarget} from '../../src/automation/target_readiness.js';
test('missing target is opened once but is not reported ready',async()=>{
  const opened=[];const api={query:async()=>[],create:async v=>opened.push(v)};
  const result=await prepareTarget(api,'https://teams.microsoft.com/meeting');
  assert.equal(result.ready,false);assert.equal(result.reason,'target_opening');assert.equal(opened.length,1);
});
test('loading target is not ready and a complete page is not proof of meeting admission',async()=>{
  for(const status of ['loading','complete']){
    const result=await prepareTarget({query:async()=>[{id:9,status,url:'https://teams.microsoft.com/meeting'}]},'https://teams.microsoft.com/meeting');
    assert.equal(result.ready,status==='complete');assert.equal(result.meetingJoinedVerified,false);
  }
});
test('unsafe target URLs are rejected before browser access',async()=>{
  await assert.rejects(prepareTarget({},'javascript:alert(1)'));
});
test('a remembered redirect does not open another meeting tab on every poll',async()=>{
  let tabs=[],opens=0;
  const api={query:async()=>tabs,create:async()=>{opens++;tabs=[{id:9,status:'complete',url:'https://login.microsoftonline.com/'}];return {id:9};}};
  const first=await prepareTarget(api,'https://teams.microsoft.com/meeting');
  const second=await prepareTarget(api,'https://teams.microsoft.com/meeting',first.tabId);
  assert.equal(opens,1);assert.equal(second.reason,'target_redirected');assert.equal(second.ready,false);
});
