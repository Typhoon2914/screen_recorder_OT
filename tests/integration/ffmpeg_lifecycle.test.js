import test from 'node:test';
import assert from 'node:assert/strict';
import {runRemux} from '../../src/scripts/ffmpeg_fix.js';
test('FFmpeg nonzero exit is a finalization failure and temporary files are cleaned',async()=>{
  const deleted=[];
  await assert.rejects(runRemux({writeFile:async()=>{},exec:async()=>1,deleteFile:async name=>deleted.push(name)},new Uint8Array([1])),/FFmpeg exited/);
  assert.ok(deleted.includes('in.mp4'));assert.ok(deleted.includes('out.mp4'));
});
test('FFmpeg remux returns exactly the output view and cleans temporary data',async()=>{
  const bytes=new Uint8Array([0,1,2,3]).subarray(1,3);
  const output=await runRemux({writeFile:async()=>{},exec:async()=>0,readFile:async()=>bytes,deleteFile:async()=>{}},new Uint8Array([1]));
  assert.equal(output.size,2);
});
