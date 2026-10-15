import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlServer} from '../../companion/control_server.js';
const token='a'.repeat(64),origin='chrome-extension://'+'a'.repeat(32);
async function fixture(t){
  const writes=[],scheduler={snapshot:()=>({phase:'idle',history:[]}),sync:async value=>writes.push(value)};
  const server=createControlServer({token,origin,scheduler});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {url:'http://127.0.0.1:'+server.address().port,headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},writes};
}
test('native control requires a paired bearer token',async t=>{const h=await fixture(t);assert.equal((await fetch(h.url+'/health',{headers:{Origin:origin}})).status,401);});
test('native control accepts privileged extension GET without Origin only with paired id and token',async t=>{const h=await fixture(t);assert.equal((await fetch(h.url+'/health',{headers:{Authorization:'Bearer '+token,'X-Recorder-Extension':'a'.repeat(32)}})).status,200);});
test('native control rejects missing Origin and missing paired id even with token',async t=>{const h=await fixture(t);assert.equal((await fetch(h.url+'/health',{headers:{Authorization:'Bearer '+token}})).status,403);});
test('native control rejects untrusted web origins even with a valid token',async t=>{const h=await fixture(t);assert.equal((await fetch(h.url+'/health',{headers:{...h.headers,Origin:'https://evil.example'}})).status,403);});
test('native control reports health only to paired extension',async t=>{const h=await fixture(t);assert.equal((await (await fetch(h.url+'/health',{headers:h.headers})).json()).phase,'idle');});
test('native control persists schedule configuration through an authenticated request',async t=>{const h=await fixture(t);const r=await fetch(h.url+'/schedules',{method:'POST',headers:h.headers,body:'[]'});assert.equal(r.status,200);assert.deepEqual(h.writes,[[]]);});
test('native control rejects malformed requests without mutating schedules',async t=>{const h=await fixture(t);assert.equal((await fetch(h.url+'/schedules',{method:'POST',headers:h.headers,body:'{'})).status,400);assert.equal(h.writes.length,0);});
test('native control does not expose an arbitrary command endpoint',async t=>{const h=await fixture(t);assert.equal((await fetch(h.url+'/execute',{method:'POST',headers:h.headers,body:'{}'})).status,404);});
test('native control permits CORS preflight only for the paired extension',async t=>{const h=await fixture(t);const r=await fetch(h.url+'/health',{method:'OPTIONS',headers:{Origin:origin}});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),origin);});
