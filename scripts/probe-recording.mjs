import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import ffprobe from 'ffprobe-static';
import assert from 'node:assert/strict';

const [file,expectedText]=process.argv.slice(2);
if(!file)throw Error('Usage: node scripts/probe-recording.mjs <media> [expectedSeconds]');
const result=spawnSync(ffprobe.path,['-v','error','-count_frames','-show_format','-show_streams','-of','json',file],{encoding:'utf8',maxBuffer:8*1024*1024});
assert.equal(result.status,0);assert.equal(result.stderr,'');
const probe=JSON.parse(result.stdout);
const video=probe.streams.find(s=>s.codec_type==='video');
const audio=probe.streams.find(s=>s.codec_type==='audio');
assert.ok(video && audio,'Expected both synthetic video and audio');
assert.ok(Number(video.nb_read_frames)>0 && Number(audio.nb_read_frames)>0);
assert.ok(Number(probe.format.size)>0);
if(expectedText)assert.ok(Math.abs(Number(probe.format.duration)-Number(expectedText))<2,'Unexpected media duration');
const endpointSkewSeconds=Number(video.duration)-Number(audio.duration);
if(Number.isFinite(endpointSkewSeconds))assert.ok(Math.abs(endpointSkewSeconds)<0.25,'Large audio/video endpoint skew');
let faststart=null;
if(file.endsWith('.mp4')){
  const bytes=await fs.readFile(file);const atoms=[];
  for(let offset=0;offset+8<=bytes.length;){
    let size=bytes.readUInt32BE(offset);const type=bytes.toString('ascii',offset+4,offset+8);
    if(size===1)size=Number(bytes.readBigUInt64BE(offset+8));
    if(size===0)size=bytes.length-offset;
    if(size<8)throw Error('Malformed MP4 atom');
    atoms.push({type,offset,size});offset+=size;
  }
  faststart=atoms.find(a=>a.type==='moov')?.offset < atoms.find(a=>a.type==='mdat')?.offset;
  assert.equal(faststart,true,'MP4 is not fast-start');
}
const report={file,passed:true,decodedAllFrames:true,endpointSkewSeconds,faststart,probe,limitations:['Endpoint agreement is not a perceptual lip-sync test']};
await fs.writeFile(file+'.probe.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({file,passed:true,decodedAllFrames:true,endpointSkewSeconds,faststart,frames:video.nb_read_frames,duration:probe.format.duration},null,2));
