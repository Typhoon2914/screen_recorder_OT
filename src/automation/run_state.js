// Scheduling identity is separate from the reusable tab authorization.
export function scheduleFingerprint(schedule){
  return JSON.stringify(['id','enabled','runDate','weekdays','time','durationMinutes',
    'launchWindowSeconds','captureMode','targetUrl','teamsAutoJoin','teamsTeam',
    'teamsChannel','joinWaitMinutes'].map(key=>schedule?.[key] ?? null));
}

export async function assertRunCurrent(api,schedule,occurrenceKey){
  const {automationSchedules=[]}=await api.storage.local.get('automationSchedules');
  const current=automationSchedules.find(item=>item.id===schedule.id);
  if(!current || current.enabled===false)throw Error('Run cancelled: schedule disabled or deleted');
  if(scheduleFingerprint(current)!==scheduleFingerprint(schedule))throw Error('Run cancelled: schedule changed; old attempt stopped');
  if(occurrenceKey){
    const {automationCancelledOccurrences=[]}=await api.storage.local.get('automationCancelledOccurrences');
    if(automationCancelledOccurrences.includes(occurrenceKey))throw Error('Run cancelled by user or meeting departure');
  }
  return current;
}
