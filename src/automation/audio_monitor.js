// Pure, testable signal-state tracker. Silence is not evidence that a professor left.
export const DEFAULT_SILENCE_SECONDS = 120;
// Invalid persisted values fall back to safe defaults, not unbounded timers.
export function validSeconds(value, minimum, maximum, fallback) {
  if(value === undefined || value === null || value === '')return fallback;
  const n=Number(value);
  return Number.isSafeInteger(n) && n>=minimum && n<=maximum ? n : fallback;
}
export const normalizeSilenceSeconds=value=>validSeconds(value,5,3600,120);
export const normalizeShortWarningSeconds=value=>validSeconds(value,0,120,10);
export const normalizeHeartbeatMinutes=value=>validSeconds(value,0,120,5);
export function validateLabNotificationSettings(input={}) {
  const fields=[
    ['silenceSeconds',5,3600],
    ['shortWarningSeconds',0,120],
    ['heartbeatMinutes',0,120]
  ];
  const result={};
  for(const [name,min,max] of fields){
    const value=String(input[name]??'').trim();
    if(!/^\d+$/.test(value) || Number(value)<min || Number(value)>max || !Number.isSafeInteger(Number(value)))
      throw Error(name+' must be a whole number between '+min+' and '+max);
    result[name]=Number(value);
  }
  return result;
}

export function createAudioSilenceTracker({
  thresholdDbfs = -70,
  silenceSeconds = DEFAULT_SILENCE_SECONDS,
  onEvent = () => {}
} = {}) {
  const limit = normalizeSilenceSeconds(silenceSeconds);
  let quietSeconds = 0;
  let notified = false;
  return {
    observe(dbfs) {
      if (typeof dbfs !== 'number' || Number.isNaN(dbfs)) return;
      if (dbfs < thresholdDbfs) {
        quietSeconds++;
        if (!notified && quietSeconds >= limit) {
          notified = true;
          onEvent({ state: 'silent', durationSeconds: quietSeconds });
        }
      } else {
        if (notified) onEvent({ state: 'resumed', durationSeconds: quietSeconds });
        quietSeconds = 0;
        notified = false;
      }
    },
    getState() { return { quietSeconds, notified, silenceSeconds: limit }; }
  };
}
