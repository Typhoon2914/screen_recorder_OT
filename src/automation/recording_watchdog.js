// Poll-based watchdog for failures not surfaced by recorder callbacks.
// Does not infer failure from a quiet audio track or an unchanging Teams slide.
export function detectRecordingStalls({active=null,events=[],nowMs=Date.now(),saveTimeoutMs=180000,stopGraceMs=180000}={}){
  const warnings=[];
  const byOccurrence=new Map();
  for(const e of events){
    if(!e?.scheduleId || !e?.occurrenceKey)continue;
    const key=e.scheduleId+'|'+e.occurrenceKey;
    if(!byOccurrence.has(key))byOccurrence.set(key,[]);
    byOccurrence.get(key).push(e);
  }
  for(const [key,list] of byOccurrence){
    const latestSaving=[...list].reverse().find(e=>e.state==='saving');
    if(!latestSaving)continue;
    const begun=Date.parse(latestSaving.at);
    if(!Number.isFinite(begun) || nowMs-begun<saveTimeoutMs)continue;
    const newer=list.filter(e=>Date.parse(e.at)>=begun);
    if(newer.some(e=>['saved','save_failed'].includes(e.state)))continue;
    warnings.push({event:'save_timeout',level:'error',scheduleId:latestSaving.scheduleId,occurrenceKey:latestSaving.occurrenceKey,
      message:'Recording save has not been verified for more than three minutes. Open History or the recorder tab; do not close it while recovery may still be possible.'});
  }
  if(active?.scheduleId && active?.occurrenceKey && Number.isFinite(active.deadlineMs) &&
     nowMs>active.deadlineMs+stopGraceMs){
    const related=byOccurrence.get(active.scheduleId+'|'+active.occurrenceKey) || [];
    if(!related.some(e=>['saving','saved','save_failed'].includes(e.state))){
      warnings.push({event:'recording_stalled',level:'error',scheduleId:active.scheduleId,occurrenceKey:active.occurrenceKey,
        message:'The recording is overdue for stop/save acknowledgement. Check the recorder and active media tracks.'});
    }
  }
  return warnings;
}
