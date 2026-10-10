// Pure state plus injected Chrome APIs: no capture permissions are implied here.
export function recordingFilename({title='', date=new Date(), id=crypto.randomUUID(), extension='webm'}={}) {
  if (!['mp4','webm'].includes(extension)) throw Error('Unsupported recording extension');
  const safe = title.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'-').replace(/[\s-]+/g,'-').replace(/^[. -]+|[. -]+$/g,'').slice(0,90) || 'Recording';
  const suffix=String(id).replace(/[^a-zA-Z0-9-]/g,'').slice(0,36);
  if (!suffix) throw Error('A unique recording id is required');
  const pad=n=>String(n).padStart(2,'0');
  const stamp=`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
  return `${stamp}_${safe}_${suffix}.${extension}`;
}

export function createSaveSession({save,onState=()=>{}}) {
  let state='idle', blob=null, filename=null;
  function change(next){state=next;onState(next);}
  return {
    get state(){return state;},
    get protected(){return !['idle','saved'].includes(state);},
    begin(){
      if(blob && state!=='saved')throw Error('An unsaved recording must be saved first');
      if(!['idle','saved'].includes(state))throw Error('Recorder is busy');
      blob=null;filename=null;change('recording');
    },
    cancel(){if(state==='recording' && !blob)change('idle');},
    finalize(value,name){
      if(!value?.size){change('failed');throw Error('Recording is empty');}
      blob=value;filename=name;change('processing');
    },
    async retry(){
      if(!blob)throw Error('No finalized recording to save');
      if(state==='saving')throw Error('Save is already in progress');
      if(state==='saved')return;
      change('saving');
      try { const result=await save(blob,filename);change('saved');return result; }
      catch(error){change('failed');throw error;}
    }
  };
}

export function waitForDownload(downloads,id,{timeoutMs=120000}={}) {
  return new Promise((resolve,reject)=>{
    let done=false, timer;
    const finish=(error,item)=>{
      if(done)return;done=true;clearTimeout(timer);downloads.onChanged.removeListener(changed);
      error?reject(error):resolve(item);
    };
    const inspect=async()=>{
      try {
        const [item]=await downloads.search({id});
        if(!item)return finish(Error('Download no longer exists'));
        if(item.state==='interrupted')return finish(Error(`Download interrupted: ${item.error || 'unknown error'}`));
        if(item.state==='complete'){
          if(item.exists===false || !(item.fileSize>0))return finish(Error('Downloaded file is missing or empty'));
          finish(null,item);
        }
      }catch(error){finish(error);}
    };
    const changed=delta=>{if(delta.id===id)void inspect();};
    downloads.onChanged.addListener(changed);
    timer=setTimeout(()=>finish(Error('Download still pending; retry checks the same download')),timeoutMs);
    void inspect();
  });
}

// Retain a pending id across timeout/retry so a slow download is never duplicated.
export function createVerifiedSaver(downloads,{onDownload=async()=>{},initialId=null}={}) {
  let pendingId=initialId, url=null;
  return async(blob,filename)=>{
    if(pendingId!==null){
      const [old]=await downloads.search({id:pendingId});
      if(!old || old.state==='interrupted' || (old.state==='complete' && (old.exists===false || !(old.fileSize>0))))pendingId=null;
    }
    if(pendingId===null){
      if(!url)url=URL.createObjectURL(blob);
      pendingId=await downloads.download({url,filename,saveAs:false,conflictAction:'uniquify'});
      await onDownload(pendingId);
    }
    const item=await waitForDownload(downloads,pendingId);
    URL.revokeObjectURL(url);url=null;pendingId=null;
    return item;
  };
}
