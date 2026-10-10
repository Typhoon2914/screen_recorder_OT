import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingFilename, createSaveSession, waitForDownload } from '../../src/automation/recording_safety.js';

test('filenames use local time, sanitize Windows characters and preserve a unique suffix', () => {
  const name = recordingFilename({title:' CON: lecture / algebra? ', date:new Date(2026,9,11,21,0), id:'abc-123', extension:'mp4'});
  assert.equal(name, '2026-10-11_21-00_CON-lecture-algebra_abc-123.mp4');
  assert.equal(/[<>:"/\\|?*]/.test(name), false);
});
test('filename rejects unsupported extensions and falls back to recording', () => {
  assert.throws(() => recordingFilename({extension:'exe'}));
  assert.match(recordingFilename({title:' ',id:'x',extension:'webm'}), /Recording_x.webm$/);
});
test('save session protects unsaved data and retains it after failure for retry', async () => {
  let attempts=0; const states=[];
  const session=createSaveSession({save:async()=>{if(++attempts===1)throw Error('disk full');return {id:9};},onState:s=>states.push(s)});
  session.begin(); assert.throws(()=>session.begin(), /busy/);
  session.finalize(new Blob(['video']), 'test.webm');
  await assert.rejects(session.retry(), /disk full/);
  assert.equal(session.state,'failed'); assert.throws(()=>session.begin(), /unsaved/);
  await session.retry(); assert.equal(session.state,'saved'); session.begin();
  assert.deepEqual(states,['recording','processing','saving','failed','saving','saved','recording']);
});
test('empty recordings fail without entering saved state', () => {
  const session=createSaveSession({save:async()=>{}});session.begin();
  assert.throws(()=>session.finalize(new Blob([]),'x.webm'),/empty/);
  assert.notEqual(session.state,'saved');
});
function downloadsFixture(item) {
  const listeners=new Set();
  return {listeners, api:{onChanged:{addListener:f=>listeners.add(f), removeListener:f=>listeners.delete(f)},search:async()=>[item]}};
}
test('download completion is verified by search, including completion before subscription', async()=>{
  const f=downloadsFixture({id:1,state:'complete',exists:true,fileSize:20});
  assert.equal((await waitForDownload(f.api,1)).id,1);assert.equal(f.listeners.size,0);
});
test('interrupted downloads and missing files are not successful saves', async()=>{
  for(const item of [{id:1,state:'interrupted',error:'FILE_NO_SPACE'},{id:1,state:'complete',exists:false,fileSize:20},{id:1,state:'complete',exists:true,fileSize:0}]){
    const f=downloadsFixture(item);await assert.rejects(waitForDownload(f.api,1));assert.equal(f.listeners.size,0);
  }
});
test('in-progress timeout does not permit a duplicate retry download', async()=>{
  const f=downloadsFixture({id:1,state:'in_progress'});
  await assert.rejects(waitForDownload(f.api,1,{timeoutMs:10}),/still pending/);assert.equal(f.listeners.size,0);
});
