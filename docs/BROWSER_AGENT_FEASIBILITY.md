# Browser-agent capture feasibility — 2026-10-15

## Scope and decision

Experimental branch: `experiment/codex-full-build`; base HEAD `1724b46342f0eab9735d98432df5289d1aaa29f0`.
Tests used isolated Chrome for Testing 156.0.8078.4 profiles on Windows and synthetic moving canvas/tone sources. No Teams meeting, normal browser profile, stable extension, OBS setup, or production recorder code was changed by this experiment. FFprobe was used for media analysis, not capture.

**Fresh alarm-driven capture was demonstrated after one legitimate invocation on the same still-open tab, with the previous recording fully released. It failed after browser restart.** This is a narrower, more useful finding than saying every alarm capture is impossible. It is not install-once authorization or a production implementation.

Conditional recommendation: option 1, extension alone, with a small supported `tabCapture` acquisition adapter feeding the existing recording engine, if authorization once per target-tab/browser session is acceptable. This adapter is not implemented here. Keep Playwright as a deterministic acceptance-test controller. No evaluated architecture is yet proven to satisfy fresh unattended capture after browser restart without renewed human authorization. Do not promote a native desktop-click adapter to production without actual tests.

## Authorization experiment

The isolated probe requests `activeTab`, `tabCapture`, `scripting`, `alarms`, `storage`, and `downloads`; no host permissions or `tabs` permission. It independently tests script access and calls `tabCapture.getMediaStreamId`, then consumes each fresh stream ID in an extension page. No fake device, permission override, chooser bypass, or synthetic extension action is used.

The human clicked the probe's toolbar action exactly once. Each recording used a new MediaRecorder and stream; all tracks ended before the next attempt. Download completion, file existence and nonzero length were checked. This probe is diagnostic, not the production recording engine.

All timestamps below are UTC (Cairo was UTC+3).

| Stage | Actual start | Actual stop | Save complete | Media | Result |
| --- | --- | --- | --- | --- | --- |
| User invocation | 14:10:00.323 | 14:10:08.347 | 14:10:08.578 | 7.989920 s; 860,993 bytes | Video and audible tone verified |
| Fresh same-tab alarm | 14:10:19.781 | 14:10:27.784 | 14:10:27.892 | 7.964537 s; 939,190 bytes | Video and audible tone verified; no second action |
| Fresh after same-origin navigation | 14:10:39.543 | 14:10:47.546 | 14:10:47.653 | 7.967276 s; 868,565 bytes | Capture permission retained, but source audio suspended and recording silent |
| Browser restart, fresh alarm | 14:14:20.221 attempt | N/A | N/A | No media | Permission denied |

The action invocation count remained 1. Same-tab and same-origin script-access probes succeeded; the restart probe failed. These independent observations do not prove that the `activeTab` manifest permission alone can replace a user invocation.

Exact restart errors:

```text
Cannot access contents of the page. Extension manifest must request permission to access the respective host.
Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.
```

The restart reused the persistent isolated profile, but created a new controlled target tab with a retained numeric ID. This is a cold-browser/new-tab test, not proof of every session-restore configuration. Fresh uninvoked-tab denial was also independently observed in the earlier cold capture-boundary experiment.

The initial lifecycle harness failed in its restart leg because it tried to identify a tab by URL metadata no longer available after grant loss. That failure is preserved, not counted as a Chrome denial. Two restart harness retries also failed (navigation interception and polling). The final known-ID retest produced the actual API errors above. The corrected lifecycle harness has not been rerun end to end.

FFprobe decoded/count-checked all frames and found video/audio codec streams. Independent audio-level sampling confirmed approximately -31 dBFS tone for the first two files. Same-origin navigation created a suspended AudioContext; an encoded audio stream existed but contained silence. Moving-video samples passed in all three. No perceptual lip-sync or long-duration claim is made.

## Production recorder / Playwright experiment

`scripts/browser-agent-capture.mjs` loads the existing built extension in a fresh profile, prepares a synthetic audio/video tab, resolves its exact URL and tab ID, fills the existing schedule UI, and waits for the extension's actual periodic alarm. It then clicks the normal Start button with a deterministic selector.

Actual alarm and Start interaction occurred at 14:17:26 UTC. At 14:17:31, state was `Opening chooser…`, with zero live tracks and zero downloads. The page DOM had no dialog element. Page screenshots cannot show native browser chrome and are not proof that a picker is absent. The user subsequently confirmed completing the sharing chooser.

After the user's manual source/audio selection, live audio and browser-surface video were observed at 14:22:30.604 UTC. The existing one-minute duration logic stopped the recording; Chrome confirmed download completion at 14:23:31.040 UTC. Final state was saved, active recording was null and no preview tracks remained. No Stop or Download interaction was performed by the controller. This is a manual-picker control run, not unattended acceptance.

Saved file: `95db36dc-7ca9-4536-bf3e-e19dc6983d8d.mp4`, 4,684,780 bytes, 59.988 seconds, H.264 video and audio, 1,805 decoded video frames. FFprobe reported zero audio/video endpoint skew and MP4 fast-start. Chrome playback and seeking passed; two browser-decoded frames differed (mean RGB difference 3.10/255). All 2,812 analyzed audio frames had finite levels, mean approximately -30.99 dBFS. This confirms actual controlled audio and changing video, not just track labels.

An additional FFprobe lavfi video-signal diagnostic crashed with Windows exit 3221225477 (0xC0000005), both using seek-point sampling and sequential filtering. Ordinary full-frame probing and Chrome decoding passed. `review-capture-media.mjs` deliberately exits 1 while that decoder diagnostic remains failed; its report separately records successful audio and browser playback checks. Playback harness retries encountered file-origin canvas tainting and missing range support in a mocked transport; final playback uses the unchanged saved bytes in a same-origin Blob, with no security flags or fabricated capture. Earlier failures remain in the review history.

The existing recorder's lowercase `recording` status can appear before capture authorization succeeds. The harness requires uppercase `Recording` plus actual live audio/video tracks; status text alone is insufficient proof.

## Mode comparison

| Mode | Human input per occurrence | Chooser / source selection | Actual AV and automatic stop/save | Restart | Teams suitability |
| --- | --- | --- | --- | --- | --- |
| A. Existing pre-armed stream | Not while a valid armed stream remains live | Initial human chooser | Previously reported successful by user; not independently rerun in this experiment | Pre-armed stream cannot be assumed to survive | Conditional; live-stream lifetime and meeting readiness remain requirements |
| B. Fresh tabCapture after one invocation | None for tested repeat in the same authorized tab | No chooser on tested repeat; explicit target tab ID | Verified 8-second audible/moving recording and completed save using diagnostic probe | Tested fresh target denied | Promising within authorized session; not tested against Teams |
| C. Playwright normal Start | Human chooser still needed in observed run | Start click works; source selection handed to human | Verified 60-second audible/moving recording, automatic stop/save after manual selection | No supported persistent authorization established; production path not rerun after restart | Useful for page orchestration, not demonstrated unattended capture authorization |
| D. Playwright plus desktop adapter | Unknown; not validated | No adapter configured; native helper failed initialization | NOT TESTED | NOT TESTED | No reliability claim justified |

The available desktop-control helper failed with `helper_unknown_error: setup refresh had errors`. Its permission-prompt interaction rules also require human handoff. This is a limitation of this test environment, not proof that every separately configured desktop adapter is technically impossible. No coordinate-clicking workaround was attempted.

## Regression gates and known failures

- Existing tracked test baseline: **133 passed, 0 failed**.
- Full working-tree suite: **159 passed, 1 failed** (160 test-runner items), exit 1. The extra failure is pre-existing unfinished native-experiment work, preserved after the user stopped OBS work:

```text
tests/integration/native_media.test.js
SyntaxError: The requested module '../../companion/media.js' does not provide an export named 'validateAudioLevels'
```

- Production build: PASS, exit 0, no Vite warnings/errors.
- All 11 checked built JavaScript modules: syntax PASS.
- Existing dirty tracked changes were preserved. No commits, pushes or merges made by this experiment.
- Same-origin audio acceptance: FAIL (silent source after autoplay suspension).
- Browser restart authorization: DENIED, expected platform boundary for this tested scenario.
- Full unattended Playwright source selection: NOT VERIFIED.
- Additional FFprobe video-filter diagnostic: FAILED with process access violation; retained separately from the passing full-frame decode and browser playback.
- Teams, closed target, minimized/foreground-app switching, long recordings, OS restart and service-worker eviction: NOT TESTED in this experiment.

## Evidence index

All paths below are relative to this experimental worktree; `.test-artifacts` is ignored.

- `.test-artifacts/authorization-1792072894258/`: original result, timestamped events, screenshots, three WebM files, individual `.probe.json` reports and `decoded-signal-evidence.json`.
- Same-tab fresh recording: `e2b83a11-a1e7-4c38-8a4d-8b8e2cff6202.webm` in that directory.
- `.test-artifacts/authorization-restart-1792073649230/`: definitive restart result and screenshot.
- `.test-artifacts/browser-agent-1792073725928/`: production schedule, normal-Start observations, manual-picker control evidence and final result.
- That directory also contains the MP4, `.probe.json`, `.review.json`, `.review-history.jsonl`, decoded audio-level output, and a saved-media playback screenshot.
- `.test-artifacts/verification-2026-10-15T14-28-28-566Z/`: final full-suite output (159 pass, 1 fail), successful build output and 11 successful syntax results. Earlier gate: `verification-2026-10-15T14-05-29-566Z`.
- `.test-artifacts/cb-1792068670880/results.json`: earlier cold-tab authorization denials.
- `.test-artifacts/cold-1792068782163/results.json`: production cold scheduler awaiting capture approval.

## Reproduction

Run from the experimental worktree only, with its existing dependencies and isolated Chromium cache:

```powershell
node scripts/tab-authorization-lifecycle.mjs
# Invoke the probe toolbar action once when explicitly prompted.
node scripts/tab-authorization-restart.mjs .test-artifacts/authorization-1792072894258
node scripts/browser-agent-capture.mjs
# Optional human-picker control; does not count as unattended success:
node scripts/browser-agent-capture.mjs --human-picker
node scripts/review-capture-media.mjs .test-artifacts/browser-agent-1792073725928/95db36dc-7ca9-4536-bf3e-e19dc6983d8d.mp4
```

The restart command reuses an existing probe profile; do not run it while that profile is open. Browser-agent runs create fresh profiles and use the existing dist build. Synthetic test URLs are deliberately not Teams URLs.

## Primary references

- [Chrome tabCapture API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture): invocation requirement, target eligibility and one-use stream IDs.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab): temporary grants and navigation scope.
- [Screen Capture specification](https://www.w3.org/TR/screen-capture/): display-capture user selection and authorization model.
- [Playwright extension testing](https://playwright.dev/docs/chrome-extensions): isolated persistent contexts.
- [Playwright dialogs](https://playwright.dev/docs/dialogs): JavaScript dialogs; not an API for Chrome's native source chooser.

The observed repeat-capture behavior is empirical evidence for the tested Chrome version, not a guarantee across all future versions or Teams navigation flows.
