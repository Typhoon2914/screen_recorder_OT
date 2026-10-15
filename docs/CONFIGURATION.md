# Configuration and operation

## Manual capture

Choose an optional title, format and quality. Economy/standard/high target 1/2.5/5 Mbps video and 128 kbps audio; actual output varies. Uncheck audio only for intentional video-only manual capture. Click Start and choose the correct surface/audio in Chrome. Pause/resume is available; Stop or Alt+Shift+S finalizes and automatically saves.

Downloads use Chrome's configured folder, saveAs:false and collision uniquification. Policy/browser prompts may still intervene. Names contain local start time, scheduled or manual title and a UUID. Blank titles use Recording; capture-tab titles are not guessed because display capture does not reliably identify the source tab.

Keep the page open until Saved. Failed saving offers Retry. A pending download is checked before another is created.

## Weekly schedules

Add/edit/delete a lecture name, weekday, local time, duration (1–1440 minutes), optional HTTPS meeting URL and enabled flag. Embedded URL credentials are rejected. Next occurrence is shown. Existing multi-weekday schedules retain their weekdays unless the editor's weekday is changed.

Schedules use local wall time and a 120-second launch window. Missed windows are not replayed. Overlap is deferred only within that window and reported. DST and clock-change behavior require locale acceptance testing.

For **Authorized tab — fresh unattended capture**:

1. Save a schedule with this capture provider, an exact HTTPS target URL and duration. Existing schedules retain manual/pre-armed mode.
2. Open and join the target yourself. Complete sign-in/lobby admission and ensure audio is actually playing.
3. In the authorization panel select the schedule and the exact existing tab (ID, title and URL are shown). Confirm readiness, then select the target for toolbar authorization.
4. On that target tab click Chrome Extensions → Screen Recorder EXPERIMENT once. A UI button cannot substitute for this legitimate extension invocation.
5. Check the authorization list. Other enabled tab-mode schedules with the same configured URL share that exact tab grant. Scheduled starts recheck the grant and measure captured audio; they never select another tab or open a picker as fallback.
6. Keep Chrome running, the authorized tab available and the PC awake. Reauthorize after browser restart, extension reload, tab closure, cross-origin navigation or grant loss. Transient loading retains the grant: wait for the page to finish. For silent audio, check source playback/autoplay; this is not automatically permission loss. Saving releases streams, not a guarantee of future permission.

Disable/delete cancels future dispatches and is rechecked just before MediaRecorder starts. To stop an already running occurrence, use Stop; disabling a schedule is not a destructive discard operation. Keep the recorder open until Saved. The native experimental backend must be disabled for this browser provider.

For the existing **Manual / pre-armed capture** provider:

1. Open the target; log in and join manually, clearing any lobby.
2. Select the schedule in the arming panel and confirm readiness.
3. Choose capture and arm; select the correct tab and share audio.
4. Keep the recorder, target and browser alive. The start and duration stop then need no further Start click.

The app cannot prove you selected the right meeting. Target edits after arming are rejected. Stop sharing, restart, reload or completion ends authorization. Disarm releases an unused stream.

## Recovery and history

Finalized unsaved media is stored in IndexedDB. Reload offers Recover / retry save and blocks new recording. History retains 100 saved entries and warnings; it is not continuous verification of files later moved/deleted.

A crash between download creation and persisting its ID can cause a duplicate recovery save; unique names prevent overwriting. Quota failure leaves only the in-memory copy until saving completes.

## Companion

Copy companion/config.example.json into an ignored local location. Supply the isolated OBS scene, absolute output root, and schedules using the same schema. readyUntil is a future ISO timestamp covering the entire recording: a human's authorization that source, audio and admission were checked.

Dry-run: node companion/run.mjs companion/config.example.json.
Execution adds --execute and requires SCREEN_RECORDER_OBS_PASSWORD in the process environment. Never log or commit credentials, tokens or private meeting URLs. The companion neither launches Chrome nor joins meetings. Its configuration is separate from extension storage; do not run both for the same lecture.
