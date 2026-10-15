export function validateAudioLevels(levels,thresholdDbfs=-70){
  if(!Array.isArray(levels) || levels.some(x=>typeof x!=='number' || Number.isNaN(x) || x===Infinity))throw Error('Invalid audio measurements');
  const peakDbfs=Math.max(...levels);
  if(!Number.isFinite(peakDbfs) || peakDbfs<thresholdDbfs)throw Error('Audio is silent or below readiness threshold; silence may be intentional, muted, or blocked by autoplay. Play/check the source and retry.');
  return {peakDbfs};
}

// Live source analysis, not a codec/track-presence proxy. No browser flags or
// forced source playback: suspended source contexts remain observable failures.
export async function inspectCapturedAudio(stream,{onSilence=()=>{}}={}){
  const context=new AudioContext(),source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();
  let timer;
  const close=async()=>{clearInterval(timer);source.disconnect();analyser.disconnect();await context.close();};
  try{
    source.connect(analyser);
    // tabCapture suppresses source playback; restore it while monitoring.
    source.connect(context.destination);
    let resumeTimer;
    try{await Promise.race([context.resume(),new Promise((_,reject)=>{resumeTimer=setTimeout(()=>reject(Error('Audio monitor resume timed out; readiness unknown')),3000);})]);}
    finally{clearTimeout(resumeTimer);}
    if(context.state!=='running')throw Error('Audio monitor is suspended; source readiness cannot be verified');
    const buffer=new Float32Array(analyser.fftSize);
    function measure(){analyser.getFloatTimeDomainData(buffer);let power=0;for(const v of buffer)power+=v*v;return 20*Math.log10(Math.sqrt(power/buffer.length));}
    const levels=[];
    for(let n=0;n<20;n++){await new Promise(r=>setTimeout(r,100));levels.push(measure());}
    const result=validateAudioLevels(levels);
    let quiet=0;
    timer=setInterval(()=>{quiet=measure()<-70?quiet+1:0;if(quiet===10)onSilence('No detectable audio for 10 seconds; may be intentional silence, mute, or autoplay restriction.');},1000);
    return {...result,close};
  }catch(error){await close();throw error;}
}

export async function acquireAuthorizedTab({streamId,getUserMedia=constraints=>navigator.mediaDevices.getUserMedia(constraints),inspect=inspectCapturedAudio,onSilence,timeoutMs=10000}){
  let expired=false,timer;
  const acquisition=Promise.resolve().then(()=>getUserMedia({
    audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:streamId}},
    video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:streamId}}
  })).then(stream=>{if(expired)stream.getTracks().forEach(t=>t.stop());return stream;});
  let stream;
  try{stream=await Promise.race([acquisition,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Tab capture acquisition timed out'));},timeoutMs);})]);}
  finally{clearTimeout(timer);}
  let monitor,released=false;
  async function release(){if(released)return;released=true;stream.getTracks().forEach(t=>t.stop());await monitor?.close?.();}
  try{
    if(!stream.getVideoTracks().some(t=>t.readyState==='live'))throw Error('Missing live video track');
    if(!stream.getAudioTracks().some(t=>t.readyState==='live'))throw Error('Missing live audio track');
    monitor=await inspect(stream,{onSilence});
    if(stream.getTracks().some(t=>t.readyState!=='live'))throw Error('Capture ended during readiness check');
    return {stream,peakDbfs:monitor.peakDbfs,release};
  }catch(error){await release();throw error;}
}
