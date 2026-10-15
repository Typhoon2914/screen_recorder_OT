import test from 'node:test';
import assert from 'node:assert/strict';
import {withFreshSource} from '../../companion/source.js';
function fixture(){
  const calls=[];
  const rpc=async(name,data)=>{
    calls.push({name,data});
    if(name==='GetProfileList')return {currentProfileName:'ScreenRecorderExperiment'};
    if(name==='GetSceneCollectionList')return {currentSceneCollectionName:'ScreenRecorderExperiment'};
    if(name==='GetCurrentProgramScene')return {currentSceneName:'SyntheticLecture',currentProgramSceneName:'SyntheticLecture'};
    if(name==='GetSceneItemList')return {sceneItems:[]};
    if(name==='GetRecordStatus')return {outputActive:false};
    if(name==='CreateInput')return {sceneItemId:1};
  };
  return {rpc,calls,config:{expectedScene:'SyntheticLecture',window:'Exact Chrome:class:chrome.exe'}};
}
test('native source is created fresh around each capture and removed afterward',async()=>{
  const f=fixture();let active;
  const value=await withFreshSource({...f,run:async name=>{active=name;return 7;}});
  assert.equal(value,7);assert.match(active,/^ScreenRecorderJob-/);
  assert.deepEqual(f.calls.find(c=>c.name==='CreateInput').data.inputSettings,{window:f.config.window,priority:0,method:2,capture_audio:true,cursor:false,client_area:true});
  assert.equal(f.calls.at(-1).name,'RemoveInput');
});
test('native source is cleaned up after recording failure',async()=>{
  const f=fixture();await assert.rejects(withFreshSource({...f,run:async()=>{throw Error('audio missing');}}),/audio missing/);
  assert.equal(f.calls.at(-1).name,'RemoveInput');
});
test('native source refuses an occupied scene without altering it',async()=>{
  const f=fixture(),rpc=async(n,d)=>n==='GetSceneItemList'?{sceneItems:[{sourceName:'Unowned'}]}:f.rpc(n,d);
  await assert.rejects(withFreshSource({...f,rpc,run:async()=>{}}),/must be empty/);
  assert.ok(!f.calls.some(c=>c.name==='CreateInput'));
});
test('native source refuses an already active recording',async()=>{
  const f=fixture(),rpc=async(n,d)=>n==='GetRecordStatus'?{outputActive:true}:f.rpc(n,d);
  await assert.rejects(withFreshSource({...f,rpc,run:async()=>{}}),/already recording/);
  assert.ok(!f.calls.some(c=>c.name==='CreateInput'));
});
test('native source never changes another profile',async()=>{
  const f=fixture(),rpc=async(n,d)=>n==='GetProfileList'?{currentProfileName:'Personal'}:f.rpc(n,d);
  await assert.rejects(withFreshSource({...f,rpc,run:async()=>{}}),/isolation/);
  assert.ok(!f.calls.some(c=>c.name==='CreateInput'));
});
