import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffprobe from 'ffprobe-static';
const execute=promisify(execFile);
// Shared pure signal validator; retained native experiment coverage is not
// skipped. This import does not start or configure a native capture engine.
export {validateAudioLevels} from '../src/automation/tab_capture.js';
export function validateNativeProbe(probe,expectedSeconds){
  const duration=Number(probe.format?.duration),bytes=Number(probe.format?.size);
  if(!(bytes>0))throw Error('Native output file is empty');
  if(!Number.isFinite(expectedSeconds)||expectedSeconds<=0 || !Number.isFinite(duration) || Math.abs(duration-expectedSeconds)>Math.max(2,expectedSeconds*.01))throw Error('Native media duration does not match the recording');
  const video=probe.streams?.find(s=>s.codec_type==='video');
  const audio=probe.streams?.find(s=>s.codec_type==='audio');
  if(!video||!audio)throw Error('Native output requires video and audio streams');
  if(!(Number(video.nb_read_frames)>0 && Number(audio.nb_read_frames)>0 && video.width>0 && video.height>0))throw Error('Native media streams could not be decoded');
  return {duration,bytes,video,audio};
}
export async function verifyNativeMedia(file,expectedSeconds){
  const {stdout,stderr}=await execute(ffprobe.path,['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{windowsHide:true,maxBuffer:8*1024*1024,timeout:Math.max(120000,expectedSeconds*1000)});
  if(stderr.trim())throw Error('Native media decode errors: '+stderr.slice(0,1000));
  return validateNativeProbe(JSON.parse(stdout),expectedSeconds);
}
