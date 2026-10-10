import test from 'node:test';
import assert from 'node:assert/strict';
import {recordWithObs} from '../../companion/recording.js';
function fixture(overrides={}){
  const calls=[];let active=false;
  const rpc=async(name)=>{
    calls.push(name);
    if(name==='StopRecord')active=false;
    if(overrides[name])return overrides[name];
    if(name==='GetProfileList')return {currentProfileName:'ScreenRecorderExperiment'};
    if(name==='GetSceneCollectionList')return {currentSceneCollectionName:'ScreenRecorderExperiment'};
    if(name==='GetCurrentProgramScene')return {currentProgramSceneName:'SyntheticLecture'};
    if(name==='GetRecordStatus')return {outputActive:active};
    if(name==='StartRecord'){active=true;return {};}
    if(name==='StopRecord'){active=false;return {outputPath:'C:\\experiment\\lecture.mkv'};}
  };
  return {calls,options:{rpc,ready:true,durationMs:1000,outputRoot:'C:\\experiment',expectedScene:'SyntheticLecture',sleep:async()=>{},statFile:async()=>({size:1234})}};
}
test('companion refuses capture without explicit meeting readiness',async()=>{
  const h=fixture();await assert.rejects(recordWithObs({...h.options,ready:false}),/readiness/);assert.equal(h.calls.length,0);
});
test('companion never changes or records a normal OBS profile',async()=>{
  const h=fixture({GetProfileList:{currentProfileName:'Normal'}});await assert.rejects(recordWithObs(h.options),/profile/);assert.ok(!h.calls.includes('StartRecord'));
});
test('companion refuses an existing recording',async()=>{
  const h=fixture({GetRecordStatus:{outputActive:true}});await assert.rejects(recordWithObs(h.options),/already/);assert.ok(!h.calls.includes('StopRecord'));
});
test('companion stops its recording and verifies stable nonempty output before saved',async()=>{
  const h=fixture();const result=await recordWithObs(h.options);assert.equal(result.state,'saved');assert.equal(result.bytes,1234);
  assert.ok(h.calls.indexOf('StopRecord')>h.calls.indexOf('StartRecord'));
});
test('companion rejects files outside the configured output directory',async()=>{
  const h=fixture({StopRecord:{outputPath:'C:\\unrelated\\lecture.mkv'}});await assert.rejects(recordWithObs(h.options),/outside/);
});
test('companion never claims an empty output file was saved',async()=>{
  const h=fixture();await assert.rejects(recordWithObs({...h.options,statFile:async()=>({size:0})}),/empty/);
});
test('companion does not confuse StopRecord acknowledgment with completed flushing',async()=>{
  const h=fixture();let starts=false;
  const original=h.options.rpc;
  h.options.rpc=async name=>{if(name==='StartRecord')starts=true;if(name==='GetRecordStatus' && starts)return {outputActive:true};return original(name);};
  await assert.rejects(recordWithObs(h.options),/did not finish stopping/);
});
