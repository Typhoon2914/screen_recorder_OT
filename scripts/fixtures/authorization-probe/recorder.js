chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || message.type!=='PROBE_RECORD')return false;
  record(message).then(respond).catch(error=>respond({error:{name:error.name,message:error.message}}));return true;
});
async function record({stage,streamId}){
  const result={stage},status=document.getElementById('status');let stream,objectUrl;
  try{
    status.textContent='Requesting real Chrome tab audio/video: '+stage;
    stream=await navigator.mediaDevices.getUserMedia({
      video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:streamId}},
      audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:streamId}}
    });
    document.getElementById('preview').srcObject=stream;
    result.startedAt=new Date().toISOString();result.tracks=stream.getTracks().map(t=>({kind:t.kind,readyState:t.readyState,settings:t.getSettings()}));
    if(!stream.getAudioTracks().length || !stream.getVideoTracks().length)throw Error('Missing actual audio/video track');
    const chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus'});
    const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=e=>reject(e.error);});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.start();
    status.textContent='Recording: '+stage;
    await new Promise(resolve=>setTimeout(resolve,8000));recorder.stop();await stopped;
    stream.getTracks().forEach(t=>t.stop());
    result.stoppedAt=new Date().toISOString();result.releasedTracks=stream.getTracks().map(t=>({kind:t.kind,readyState:t.readyState}));
    document.getElementById('preview').srcObject=null;
    const blob=new Blob(chunks,{type:recorder.mimeType});result.bytes=blob.size;
    objectUrl=URL.createObjectURL(blob);
    const id=await chrome.downloads.download({url:objectUrl,filename:stage+'.webm',saveAs:false,conflictAction:'uniquify'});
    for(let n=0;n<200;n++){
      const [item]=await chrome.downloads.search({id});
      if(item?.state==='interrupted')throw Error('Download interrupted: '+item.error);
      if(item?.state==='complete'){
        if(item.exists===false || !(item.fileSize>0))throw Error('Downloaded file is empty or absent');
        result.saved={file:item.filename,bytes:item.fileSize,at:new Date().toISOString()};break;
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!result.saved)throw Error('Download did not complete');
    status.textContent='Saved; all stream tracks released: '+stage;
  }catch(error){result.error={name:error.name,message:error.message};status.textContent=error.message;}
  finally{
    stream?.getTracks().forEach(t=>t.stop());if(objectUrl)URL.revokeObjectURL(objectUrl);
    document.getElementById('evidence').textContent=JSON.stringify(result,null,2);
  }
  return result;
}
