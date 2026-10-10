# Experimental implementation report

## Overall: PARTIALLY IMPLEMENTED

The extension has a tested automatic-save/recovery and armed-scheduling path,
but it is not a fully unattended Teams appliance. Real browser permission,
Teams admission and native OBS source validation require human participation
and an isolated live setup. No real meeting was joined.

## Git and isolation

- Branch: experiment/codex-full-build
- Worktree: C:\Users\TyphoonS PC\.codex\worktrees\screen-recorder-experiment\screen_recorder_OT
- Repository: Typhoon2914/screen_recorder_OT
- Baseline develop: f239734bbe743fac3380ec49b3be53cc5b2d9e76
- Primary checkout: G:\MyPersonalProjects\screen_recorder_OT, still clean on develop at that SHA.
- No push, merge, rebase, stable-installation or normal-profile changes.
- Implementation commits: bdc19d4 (save/recovery primitives), 29336b4 (UI/armed
  integration), 85efecf (reliability/resource cleanup), 419fc68 (companion/tooling).
- Final documentation commit and final HEAD are reported in the task handoff.
  Generated dist, browser profiles, diagnostics and synthetic media are ignored.

The initial Playwright installer cleaned two old shared test-browser caches;
see WINDOWS_EXPERIMENT.md. All subsequent browser runtime installs are local
with garbage collection disabled. This tooling side effect is not hidden.

## Completed

- Verified automatic downloads, unique sanitized names, interrupted/empty-file
  retry, in-progress ID reuse, explicit save state and unsaved protection.
- IndexedDB finalized-recording recovery, origin-wide recorder ownership and
  resource cleanup; recovery quota failures stay visible.
- Schedule create/edit/delete/enable, lecture title, day/time/duration/target,
  upcoming runs, persistent configuration and serialized edits.
- Explicit capture arming, target binding, missing/loading/redirected target
  handling, duplicate/overlap protection and duration stop.
- Manual capture preserved, MP4/WebM selection, pause/resume, bounded bitrate
  settings, manual audio selection, countdown, local stop shortcut and history.
- Start acknowledgment race, concurrent alarms, stale reload/closure ownership,
  terminal-error cleanup and FFmpeg exit/worker lifecycle fixes.
- Distinct experimental identity, source tests, real-extension synthetic browser
  harness, full-frame media probe, repeatable verification logs and guides.

## Partial / missing

- Armed capture is not cold unattended capture and must be reauthorized after
  completion/restart. Target loading is not automatic meeting readiness.
- OBS companion is mock-tested and dry-run validated, not live-validated. It is
  independent of extension schedules and does not join meetings or configure OBS.
- No automatic Teams login/admission/lobby handling, native messaging, companion
  schedule synchronization, native title renaming, desktop notifications or
  one-click Windows installation.
- Captured-tab titles are not guessed; configured title/date fallback is used.
- No speech-level audio-health detection or Downloads-volume free-space probe.
- Live chunks are not crash-durable; memory remains proportional to media size.
- Full-lecture performance, real capture permissions, locked desktop/sleep,
  browser update/restart and authenticated Teams behavior need acceptance tests.
- Recovered playback is available, but the original Format/Last file summary
  fields are not fully reconstructed after reload; verified history remains shown.

## Testing

- Final automated suite: **133 passed, 0 failed**, exit 0.
- Vite production build: PASS, no build warnings.
- Runtime syntax/manifest/packaged assets: PASS (10 runtime syntax checks).
- Final browser integration: **5 scenarios passed**, no unexpected console/page errors.
- Final browser run: 9 screenshots; 3 synthetic media files, all fully decoded.
- Ten-minute MP4 separately fully decoded: 600.174 seconds, video and audio,
  fast-start, playback and seeking verified.
- OBS: 7 mocked safety tests plus no-connect dry-run. No live OBS instance used.
- npm audit: zero known vulnerabilities. The OBS client emits a transitive
  crypto-js maintenance deprecation warning on installation.
- No actual Teams recordings, actual picker approval or perceptual sync tests.

The initial browser run failed on Chromium's avc1 pause/resume configuration
error. It was retained as evidence, corrected using supported avc3 preference,
and subsequent browser runs passed. New safety/race tests were exercised at RED
gates before their implementations. Baseline contracts were intentionally
updated rather than deleted or weakened.

## Reliability and recovery

Save errors retain media and block replacement. Reload recovers finalized
IndexedDB data and checks the old download ID before retrying. A download-ID
persistence crash window can still create a duplicate, but filenames prevent
overwriting. Stale active state is reconciled on reload/closure/restart.
Companion ambiguous operations persist failure and require manual reconciliation;
it does not blindly replay a recording.

Human requirements: choose/authorize the real capture source; verify Teams
login/admission and audible media; prepare an isolated OBS instance for native
tests; authorize a real test meeting; complete full-lecture acceptance.

## Evidence

All paths below are relative to this experimental worktree:

- Final unit/build/syntax: .test-artifacts/verification-2026-10-10T23-36-02-743Z/
  (tests.txt, build.txt, results.json)
- Final browser: .test-artifacts/2026-10-10T23-36-03-908Z/results.json
- Screenshots: same directory, 01-idle.png through 09-recovered-saved.png
- Final manual media: cd0d8b3a-5924-4213-95f2-d6f7e787ddfd.mp4
- Final scheduled media: 99e2a086-52a3-436a-bd15-0c1507684407.webm
- Final recovered media: e1d5f5f3-38ae-4c51-b30b-d1c6460be98b.webm
- Each final media file has an adjacent .probe.json with full-frame validation.
- Long run: .test-artifacts/2026-10-10T23-19-11-671Z/
  a751aa30-7737-4dac-89e9-760c71708060.mp4 and adjacent .probe.json
- Initial failed browser run: .test-artifacts/2026-10-10T23-13-53-312Z/
- Measured tradeoffs and limitations: PERFORMANCE.md

Browser test downloads use harness-generated on-disk names. Production requested
filenames contain titles/timestamps/UUIDs and are separately unit-tested.

## Changed files (42)

```text
.gitignore
README.md
companion/config.example.json
companion/recording.js
companion/run.mjs
docs/ACCEPTANCE.md
docs/CONFIGURATION.md
docs/EXPERIMENT_ARCHITECTURE.md
docs/EXPERIMENT_PLAN.md
docs/IMPLEMENTATION_SUMMARY.md
docs/PERFORMANCE.md
docs/TESTING.md
docs/TROUBLESHOOTING.md
docs/WINDOWS_EXPERIMENT.md
package-lock.json
package.json
scripts/browser-validation.mjs
scripts/probe-recording.mjs
scripts/verification.mjs
src/automation/chrome_controller.js
src/automation/recorder_bridge.js
src/automation/recording_options.js
src/automation/recording_safety.js
src/automation/schedule_store.js
src/automation/target_readiness.js
src/pages/recorder.html
src/public/manifest.json
src/public/service_worker.js
src/scripts/ffmpeg_fix.js
src/scripts/recorder.js
src/scripts/recording_vault.js
src/scripts/schedule_ui.js
src/styles/recorder.css
tests/automation/recording_options.test.js
tests/automation/recording_safety.test.js
tests/baseline/current_setup.test.js
tests/integration/controller_reliability.test.js
tests/integration/ffmpeg_lifecycle.test.js
tests/integration/target_readiness.test.js
tests/integration/windows_companion.test.js
tests/schedules/schedule_editor.test.js
vite.config.js
```
