import test from 'node:test';
import assert from 'node:assert/strict';
import {syncNativeCompanion} from '../../src/automation/native_client.js';
const config={token:'a'.repeat(64),enabled:true},extensionId='b'.repeat(32);
test('native client authenticates Origin-less health requests and sends schedules only to loopback',async()=>{
  const calls=[];
  const result=await syncNativeCompanion({config,extensionId,schedules:[{id:'one'}],fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({phase:'idle'})};}});
  assert.equal(result.phase,'idle');assert.equal(calls.length,2);
  for(const call of calls){assert.ok(call.url.startsWith('http://127.0.0.1:17653/'));assert.equal(call.options.headers['X-Recorder-Extension'],extensionId);assert.equal(call.options.headers.Authorization,'Bearer '+config.token);}
  assert.deepEqual(JSON.parse(calls[0].options.body),[{id:'one'}]);
});
test('native client removes native schedules when disabled',async()=>{
  let posted;
  await syncNativeCompanion({config:{...config,enabled:false},extensionId,schedules:[{}],fetchImpl:async(url,options)=>{if(options.body)posted=JSON.parse(options.body);return {ok:true,json:async()=>({})};}});
  assert.deepEqual(posted,[]);
});
test('native client fails closed on local authentication failure',async()=>{
  await assert.rejects(syncNativeCompanion({config,extensionId,schedules:[],fetchImpl:async()=>({ok:false,status:403})}),/403/);
});
test('native client rejects absent identity before making a network request',async()=>{
  await assert.rejects(syncNativeCompanion({config,schedules:[],extensionId:''}),/identity/);
});
