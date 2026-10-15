# Integrated authorized-tab acceptance — 2026-10-15

Result: **INTEGRATED UNATTENDED CAPTURE VERIFIED WITH SESSION PRECONDITIONS**. Two real, fresh scheduled recordings completed after one human toolbar authorization. This is not permanent capture permission, Teams acceptance, or a production-readiness claim.

Branch: `experiment/codex-full-build`. HEAD: `1724b46342f0eab9735d98432df5289d1aaa29f0`. Implementation is uncommitted; pre-existing local changes preserved. No push, merge, reset, main/develop changes, stable extension changes, or normal Chrome profile changes.

## Implementation

The dedicated tab authorization manager and capture adapter are separate from manual getDisplayMedia. Exact tab identity and current permission are checked before obtaining a fresh one-use stream ID. Scheduling uses the existing controller, recorder, duration stop, FFmpeg MP4 processing, verified download, history and recovery. UI shows associated schedules, target identity, eligibility and reauthorization requirements. There is no fallback to a replacement tab or capture picker.

Captured audio must pass measured readiness, not merely have a live track. Silent startup is rejected with an explicit ambiguity warning; sustained silence later is reported without declaring an otherwise intact stream broken. Streams and audio monitoring are released on stop/failure. Acquisition is time-bounded and late streams are stopped.

The native experiment's missing validateAudioLevels export was repaired by sharing the pure validator. All eight existing native-media tests pass unchanged. OBS was not used or changed.

## Automated gates

- Final `npm test`: **192 passed, 0 failed, 0 skipped**, exit 0.
- Production Vite build: PASS, exit 0, no build warnings/errors.
- All 13 packaged runtime syntax checks: PASS.
- `git diff --check`: PASS. Git emits Windows LF-to-CRLF notices; these are not Vite warnings.
- Existing synthetic browser regression: all five groups PASS, no errors (schedule persistence; manual capture/pause/resume/save/seek; changed-target rejection; pre-armed scheduled stop/save; injected failed-save protection/reload/retry).
- Original regression tests were preserved. New coverage includes exact-target authorization, session loss, permission loss, expiry, cancellation/retargeting, duplicate alarms, closure, audio readiness, resource release and acquisition timeout.

Final logs: `.test-artifacts/verification-2026-10-15T15-19-40-470Z/{tests.txt,build.txt,results.json}`.
Synthetic browser logs: `.test-artifacts/2026-10-15T14-57-05-725Z/results.json`.

Initial RED tests failed on the missing adapter and five missing runtime contracts. A timeout regression initially hung and was interrupted before timeout handling was added. The final suite above is green; no failed test was removed to obtain it.

## Real acceptance procedure

`node scripts/integrated-tab-acceptance.mjs` loaded the actual dist application in isolated Chrome for Testing 156.0.8078.4. The controlled HTTPS page supplied moving video and an audible tone. Schedules were configured through the application UI. The user invoked the extension toolbar action once on the selected target. No fake streams, capture API overrides, picker bypasses or permission-granting launch switches were used.

Real production Chrome alarms dispatched both occurrences. Neither scheduled start required a Start click, picker approval or any further human input. Stop, processing and download were automatic. All first-stream tracks ended before the second capture. The test window was minimized before the second occurrence; dispatch did not restore it.

Evidence root: `.test-artifacts/integrated-tab-1792076638204/`.

## Timeline

All timestamps below are UTC on 2026-10-15; Cairo was UTC+3.

| Event | UTC |
| --- | --- |
| Single toolbar authorization, target tab 1838398310 | 15:07:51.006 |
| Human no-input interval begins | 15:07:51.727 |
| First scheduled alarm | 15:09:58.848 |
| First MediaRecorder start | 15:10:02.472 |
| First stop, tracks ended | 15:11:02.473 |
| First verified automatic save | 15:11:02.822 |
| Test window minimized | 15:11:08.277 |
| Second scheduled alarm | 15:12:58.849 |
| Second MediaRecorder start | 15:13:02.400 |
| Second automatic stop | 15:14:02.409 |
| Second verified automatic save | 15:14:02.718 |
| Both media reviews complete; no-input interval ends | 15:14:09.382 |

The existing one-minute alarm polling means start is not exact to the scheduled second. Capture setup added approximately four seconds after each alarm. Both schedules were within their launch windows.

## Saved media

Both files have real video and audio, nonzero size, fast-start MP4 layout, successful full-frame decoding, audible measured audio, and successful Chrome playback/seek with changing video pixels. Both independent reviewer results are `passed: true`, `errors: []`, exit 0.

| File under evidence root | Duration | Bytes | Decoded video frames | Mean audio RMS | AV endpoint skew |
| --- | --- | --- | --- | --- | --- |
| `e8589831-b673-4066-bc60-77d4ba99c4b1.mp4` | 60.035 s | 5,059,138 | 1,801 | -30.993 dBFS | 0.090 s |
| `4a706f2c-2ab5-4c05-bf81-f2726abd4168.mp4` | 60.014 s | 5,490,450 | 1,954 | -30.995 dBFS | 0.067 s |

Test download routing uses GUID artifact names; production title/timestamp naming remains in the application. Endpoint skew is not a subjective speech/lip-sync test. The prior FFprobe filter crash on an older experimental file did not recur on either of these recordings.

## Negative cases and limitations of evidence

- Same-origin navigation: the new source AudioContext was observed suspended. The next real alarm reached capture but audio readiness failed at 15:17:00.907 with: `Audio is silent or below readiness threshold; silence may be intentional, muted, or blocked by autoplay. Play/check the source and retry.` No third recording or saved file was created. Successful capture permission does not overcome source autoplay restrictions.
- Cross-origin navigation: grant revoked at 15:17:02.141 with `Target navigated to another origin. Reauthorize the target tab.` No substitute tab was captured.
- Browser restart: UI showed UNATTENDED UNAVAILABLE. A real post-restart alarm at 15:19:05.884 failed with `Reauthorization required: no session grant for this schedule target`. Exactly two recording-start events and saved files remained.
- **Restart causality caveat:** cross-origin navigation revoked authorization before restart in this integrated sequence. Thus this run proves post-restart UI/fail-closed behavior, not restart as the isolated cause of revocation. The earlier standalone authorization probe tested restart separately; session-loss unit coverage also remains. Do not conflate those evidence types.
- **Final source caveat:** after the real run started, two small authorization-manager fixes preserved lecture titles separately from tab titles and retained a grant during transient loading. They passed the final automated gate but were not live-retested. The real-tested dist hashes are in `tested-build-manifest.json`; final dist differs only in `automation/tab_authorization.js`. The recorder/capture pipeline is unchanged.
- The first setup (`.test-artifacts/integrated-tab-1792076170587/`) was interrupted while waiting for human authorization after an intent expired during window-location assistance. No recording was claimed. The harness now refreshes pending intent during the wait, never the actual permission.

## Reliability scope

| Case | Evidence/status |
| --- | --- |
| Repeated fresh capture after one authorization; full stream release | Real integrated PASS |
| Automatic duration stop, MP4 finalization, completed save, AV integrity | Real integrated PASS |
| Chrome minimized | Real integrated PASS for second recording |
| Same-origin autoplay silence | Real integrated rejection PASS |
| Cross-origin navigation | Real integrated revocation PASS |
| Browser restart unavailable UI and rejected due alarm | Real integrated PASS, causality caveat above |
| Schedule disabled/removed/retargeted, duplicate alarm, tab closure, lost permission, expired intent | Automated tests PASS; not all exercised live |
| Manual recording, pause/resume, save failure, reload recovery/retry | Synthetic browser regression PASS; not real picker/disk-full proof |
| Unexpected recorder closure during capture, actual worker suspension, actual disk-full, extension update mid-recording | Not live-tested |
| Real Teams, joining/authentication/lobby, speech synchronization | NOT TESTED |
| Long lectures, CPU/RAM peaks, sleep/wake, Windows restart | NOT TESTED in this integration acceptance |

## Evidence inventory

Under the real evidence root:

- `results.json`, `checkpoint.json`, `events.jsonl`: statuses, timestamps and diagnostics.
- `tested-build-manifest.json`: SHA-256 hashes of the actual loaded application.
- `01-human-authorization-target.png`, `02-authorized-schedules.png`.
- `03-recording-1.png`, `03-recording-2.png`, `04-saved-1.png`, `04-saved-2.png`.
- `05-navigation-silence-rejected.png`, `06-restart-needs-authorization.png`.
- Each MP4 has `.probe.json`, `.ffprobe.txt`, `.review.json`, `.review-log.txt`, `.audio-decode.json`, `.video-decode.json`, `.playback.png`.
- Ten screenshots total including the two playback images.

## Required operating conditions

Chrome stays running; the exact authorized target remains available; authorization remains valid; the PC stays awake; audio is actually playing/available; the meeting is already joined or joined through a separately verified workflow. Reauthorize after browser restart/extension reload or permission loss. Silent content can be conservatively rejected by readiness checks.

The integrated extension is sufficient for the demonstrated session-scoped flow. Playwright is the acceptance controller, not the recording engine. OBS/native capture is not required for this demonstrated mode. Fully unattended operation across browser restarts with no renewed human authorization has NOT been delivered.
