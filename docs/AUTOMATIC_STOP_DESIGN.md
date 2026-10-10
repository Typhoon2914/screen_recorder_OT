# Scheduled recording automatic stop — RED contract

Feature: `feature/automatic-recording-stop`

This phase specifies automatic stopping without modifying existing working recorder behavior.

- A weekly schedule has a required `durationMinutes` positive integer.
- Duration begins at the actual `MediaRecorder.start()` event, **not** at the scheduled alarm or capture chooser.
- The stop coordinator computes a monotonic/idempotent deadline check from a start timestamp.
- A completed/early-stopped/ended recording must not trigger a later duplicate stop.
- Deadline state must be serializable so a new MV3 service worker can resume checking after suspension.
- A stop request uses the existing `REQUEST_STOP` command with reason `duration_elapsed`.
- Only one scheduled recording may be active in a coordinator at once.
- Node tests verify pure timing and lifecycle; Chrome alarm, message delivery, screen capture, and file downloads still need separate integration/real-browser tests.
- A future integration step must connect `RECORDING_STARTED` with a duration, save the deadline to `chrome.storage.local`, use an alarm to issue `REQUEST_STOP` to the correct recorder tab and clear it on terminal events.
- Do not rely on an in-memory `setTimeout` in an MV3 service worker to guarantee a delayed stop.
- If the browser is closed or the computer sleeps, wall-clock deadlines alone cannot guarantee exact stop timing; actual resume behavior must be tested.
- The extension still cannot bypass the browser capture chooser.

Tests in this branch are intentionally RED until the stop coordinator is implemented. No runtime change or release is included.
