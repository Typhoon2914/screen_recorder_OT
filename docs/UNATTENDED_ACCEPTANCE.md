# Unattended acceptance checkpoint — 2026-10-11

Branch: `experiment/codex-full-build`. Production code under test: commit
`08369b351888fa63bf9c8f584c4c257c14cfa6ac`. No production code changed in this
acceptance follow-up. Main, develop, the stable recorder and everyday Chrome
profile were not modified.

## Result at the human-authorization checkpoint

| Mode | Classification | Evidence / missing gate |
| --- | --- | --- |
| Real Chrome tab, pre-authorized armed session | BLOCKED | Isolated headed browser ready; human has not yet approved the real capture picker |
| Capture after source-tab reload | NOT TESTED | Requires a successful authorized session and a separate re-arm |
| Capture after recorder-tab reload | NOT TESTED | Requires real authorization before testing loss of the document-owned stream |
| Capture after browser restart | NOT TESTED | Requires real authorization before testing restart behavior |
| Cold Chrome capture without prior authorization | NOT TESTED | Not an implemented supported mode; do not infer permission from an alarm |
| Windows OBS companion | BLOCKED | No OBS executable found in checked standard locations, PATH, running processes or Windows uninstall/App Paths records; custom/portable location unknown |

No real recording has been produced at this checkpoint. There is no verified
media path, duration, stream result, scheduled-start result or save-completion
result to report. Previous canvas-stream injection tests are not used to satisfy
this acceptance gate.

## Actual observations

- Native computer-use helper initialization failed twice. The second error was
  `windows sandbox failed: helper_unknown_error: setup refresh had errors`.
  No capture permission was clicked or automated.
- 03:22:58 UTC: the first isolated headed run failed startup with
  `Recovery check failed; recording disabled: Internal error opening backing store for indexedDB.open.`
  The test then reported `page.waitForFunction: Timeout 30000ms exceeded.`
  The recorder failed closed rather than disabling recovery protection.
- 03:23:53 UTC: retry with a shorter isolated profile path succeeded in opening
  the recorder. A Windows Chromium/LevelDB path-length issue is suspected, not
  proven: launch settings were also tightened between attempts.
- Retry: Chrome for Testing `156.0.8078.4`; real
  `function getDisplayMedia() { [native code] }`. Chromium sandbox enabled;
  Playwright background timer/renderer throttling overrides removed. No fake
  media, auto-select source, permission grant or capture API replacement.
- 03:23:53 UTC: the real-picker harness reached `awaiting-human-authorization`.
  It starts a low-volume controlled tone and animated local tab, then waits up
  to 15 minutes for a human-approved **Chrome tab plus tab audio**.
- After authorization, it schedules a minute at least 60 seconds in the future,
  relies on the extension's existing periodic alarm (no injected alarm/request),
  and makes only passive reads/screenshots during start/record/stop/save.
  It records real alarm, runtime, storage and download events with UTC timestamps.
- Human confirmation that keyboard/mouse were untouched is required in addition
  to automated success. No claim of unattended acceptance until both are present.

## Resume the test

In the dedicated **Screen Recorder · EXPERIMENT** browser window:

1. Confirm readiness for the controlled source using the checkbox.
2. Click **Choose capture and arm**.
3. In Chrome's picker, choose **CONTROLLED AV — REAL CAPTURE TEST**, enable
   tab audio, then click **Share**. Do not select a desktop or unrelated tab.
4. Leave keyboard and mouse untouched until **Saved** (normally 3–4 minutes).
5. Confirm no input occurred, or report any error.

The pending run closes its own profile after completion or the 15-minute
authorization timeout. Rerun from this experimental worktree if it times out:

```powershell
node scripts/real-capture-acceptance.mjs uninterrupted
node scripts/real-capture-acceptance.mjs source-reload
node scripts/real-capture-acceptance.mjs recorder-reload
node scripts/real-capture-acceptance.mjs browser-restart
```

Each scenario needs its own human approval. Source reload resumes only the
controlled page's tone before the input-free interval; recorder reload and
browser restart do not re-arm. These latter cases test whether authorization
survives, not whether manually authorizing again works. All profiles and outputs
are under this worktree's ignored `.test-artifacts/`. The harness invokes
`scripts/probe-recording.mjs` after saving: full-frame decode, nonzero file,
audio and video streams, approximately 60 seconds, endpoint agreement, MP4
fast-start, followed by actual browser playback and seek. No such media check
has run successfully on real capture at this checkpoint.

## OBS missing requirements

No connection to an OBS service was attempted. Supply an existing executable
location if OBS is installed portably/custom, or install an isolated portable
OBS configuration. Before testing the companion it needs:

- profile and scene collection both named `ScreenRecorderExperiment`;
- a controlled-source scene and isolated output directory;
- authenticated loopback WebSocket, e.g. port 4457 (never expose its password);
- matching companion config and an explicit future readiness lease;
- verified video/audio routing. Then run a scheduled capture and ffprobe its
  output. Mocked RPC tests and file-size checks alone do not validate OBS capture.

## Architecture recommendation

No unattended mode is ready for production acceptance on current demonstrated
evidence. Retain supervised recording; treat armed Chrome capture as a candidate
awaiting the real-picker gate, not a proven unattended service. The current
implementation keeps the authorized stream in the recorder document; it does
not persist authorization across that document's destruction or browser exit.

Chrome tabCapture requires user invocation and its stream IDs are short-lived;
an offscreen document is not an authorization bypass. These are platform facts,
not results of this incomplete real-capture run:

- https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- https://developer.chrome.com/docs/extensions/reference/api/offscreen

OBS is an unvalidated fallback candidate, not a production recommendation. Its
portable-mode isolation guidance: https://obsproject.com/kb/portable-mode

## Evidence paths (relative to this worktree)

- Initial blocked run: `.test-artifacts/real-capture-uninterrupted-2026-10-11T03-22-26-466Z/`
  — `results.json`, `events.jsonl`, `blocked-or-failed.png`.
- Prepared real-capture retry: `.test-artifacts/real-capture-uninterrupted-2026-10-11T03-23-52-146Z/`
  — `results.json`, `events.jsonl`, `01-awaiting-human-authorization.png`.
  Later files/events, if present, supersede the pending checkpoint above.
- Dedicated retry profile: `.test-artifacts/rp-mv39e11u/`.
- Post-harness regression: `.test-artifacts/verification-2026-10-11T03-25-23-054Z/`
  — `tests.txt`, `build.txt`, `results.json`.

Regression: **133 passed, 0 failed**. Production build: **PASS**, no warnings or
errors. Ten packaged runtime syntax checks: **PASS**. Acceptance-harness syntax:
**PASS**. These results do not substitute for real capture acceptance.
