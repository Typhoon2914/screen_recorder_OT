// Pure, testable signal-state tracker. Silence is not evidence that a professor left.
export const DEFAULT_SILENCE_SECONDS = 120;
export const SILENCE_OPTIONS_SECONDS = Object.freeze([30, 60, 120, 180, 300]);

export function normalizeSilenceSeconds(value) {
  const seconds = Number(value);
  return SILENCE_OPTIONS_SECONDS.includes(seconds) ? seconds : DEFAULT_SILENCE_SECONDS;
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
