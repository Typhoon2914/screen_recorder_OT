# Authorized-tab capture architecture

This provider is experimental and has session preconditions, not permanent capture permission.

## Components

- Scheduler: existing weekly schedules and one-minute Chrome alarm. A `captureMode: "tab"` schedule requires HTTPS target URL and duration; missing mode remains manual/pre-armed.
- Authorization manager: `src/automation/tab_authorization.js`. A five-minute UI intent identifies the exact target tab. Only the legitimate extension toolbar invocation binds that tab/origin/configured URL. Grants live in `chrome.storage.session`, survive worker suspension, and are unavailable after browser restart/extension reload. Local history is never treated as permission.
- Capture adapter: `src/automation/tab_capture.js`. Each request gets a new one-use stream ID from Chrome for the exact target and recorder consumer. The adapter consumes it with getUserMedia, requires live video/audio, measures source levels and returns explicit idempotent release. Acquisition and audio-monitor resume are time-bounded; late streams are stopped.
- Recorder: unchanged MediaRecorder/format/bitrate pipeline plus provider selection. Rechecks schedule and target after media setup, before starting. Uses existing automatic stop, MP4 fast-start, recovery, download verification, history and unsaved protection.
- UI: explicit provider choice, exact target identity, session authorization eligibility, associated schedules and reauthorization warnings. The UI never claims that a stored grant proves current audio/meeting readiness.
- Diagnostics: bounded `captureEvents` records actual start/stop, ended tracks, measured audio level, saved filename/bytes, and failures. Stream capabilities are not persisted or logged.

## Identity and failure policy

No arbitrary target is accepted from a recorder message. The worker loads the persisted pending schedule, checks sender extension/document/consumer tab and occurrence, and resolves the session grant. It never chooses a replacement tab by URL. A schedule retarget invalidates its association; multiple schedules may share one explicitly selected tab for the same configured URL.

Same-origin navigation is permitted within that tab if permission and readiness still pass. This is not proof that a redirected page is still the correct lecture. Cross-origin navigation and closure revoke the grant and request a stop if recording. Transient loading rejects that readiness check but retains the grant for a later check. Failed permission checks revoke the grant and request reauthorization.

Authorized schedules do not focus or restore Chrome on dispatch. A local duration timer and persisted worker deadline remain responsible for stopping. Recorder closure/reload may lose in-progress memory chunks and is reported by the existing controller. Finalized unsaved data retains the existing IndexedDB/retry protection.

## Audio

Track presence is necessary but insufficient. The adapter measures 20 RMS samples over approximately two seconds; at least one must reach -70 dBFS. Invalid measurements, missing tracks, suspended monitor or silence fail startup. Very quiet audio or an intentionally silent lecture can therefore be rejected. This is conservative, not a diagnosis of autoplay failure in every case.

tabCapture suppresses local tab playback; the adapter restores it through the monitoring AudioContext for the capture lifetime. The context is closed when streams are released. Ten seconds of below-threshold audio during recording creates a visible warning; silence is not classified as a broken meeting and the recording continues. Ended tracks stop the recording.

The pure level validator also repairs the retained native experiment's missing export. Its tests stay in the full suite; no OBS process, installation or configuration is needed or changed.

## Required preconditions and limitations

Chrome must remain running; the authorized target tab must remain available; Chrome's permission must still be valid; the PC must not sleep; and the meeting must already be joined or use a separately verified joining workflow. No authentication, MFA, lobby or organizational restrictions are bypassed. No real Teams meeting is tested by synthetic acceptance.

Manual Start still uses getDisplayMedia and its chooser. A fresh tab provider never silently falls back to it. Old OBS/native experiments remain in the worktree, disabled in the isolated acceptance profile; they are not this architecture.

See [integrated acceptance](INTEGRATED_TAB_ACCEPTANCE.md) for what was actually executed, including failures. Unit mocks do not prove authorization or real audio/video.

## Platform references

Chrome documents user-invocation requirements and short-lived single-use stream IDs in the [tabCapture API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture). The successful repeated-capture behavior is demonstrated evidence for the tested Chrome version, not a promise of indefinite authorization on every version. The [storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) documents session storage lifetime, including clearing on browser restart or extension reload/update. Stored session metadata is an eligibility hint; the real capture API remains authoritative.
