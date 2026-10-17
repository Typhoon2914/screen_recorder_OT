// Controlled moving-canvas/tone acceptance only, not a lecture-silence policy.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import ffprobe from 'ffprobe-static';
const execute=promisify(execFile);
export async function analyzeSyntheticMedia(file,duration){
  const cwd=path.dirname(path.resolve(file)),name='analysis-'+randomUUID()+'.mp4',link=path.join(cwd,name);
  // Generated safe basename avoids interpreting lecture titles as filter code.
  await fs.link(file,link);
  const samples=[];
  try{
    for(const second of [2,Math.floor(duration/2),Math.max(2,Math.floor(duration)-5)]){
      const sample={second};
      for(const kind of ['audio','video']){
        const filter=kind==='audio'?'amovie='+name+':seek_point='+second+',asetpts=PTS-STARTPTS,astats=metadata=1:reset=1':'movie='+name+':seek_point='+second+',setpts=PTS-STARTPTS,fps=2,signalstats';
        const key=kind==='audio'?'lavfi.astats.Overall.RMS_level':'lavfi.signalstats.YDIF';
        const {stdout,stderr}=await execute(ffprobe.path,['-v','error','-f','lavfi','-i',filter,'-show_entries','frame_tags='+key,'-read_intervals','%+2','-of','json'],{cwd,windowsHide:true,maxBuffer:1024*1024,timeout:60000});
        if(stderr.trim())throw Error('Synthetic signal decoder error: '+stderr.slice(0,500));
        const values=JSON.parse(stdout).frames.map(f=>Number(f.tags?.[key]));
        if(kind==='video')values.shift(); // First frame has no preceding comparison.
        sample[kind]={frames:values.length,min:Math.min(...values),max:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length};
      }
      sample.passed=sample.audio.mean>-60 && sample.video.mean>.05;
      samples.push(sample);
    }
    return {passed:samples.every(s=>s.passed),samples,scope:'Controlled continuous tone and moving canvas only'};
  }finally{await fs.unlink(link);}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const result=await analyzeSyntheticMedia(path.resolve(process.argv[2]),Number(process.argv[3]));
  await fs.writeFile(process.argv[2]+'.signal.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
