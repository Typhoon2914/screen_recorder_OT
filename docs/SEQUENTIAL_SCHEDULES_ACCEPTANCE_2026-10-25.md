# First batch: independent sequential schedules — 2026-10-25

Scope: existing `experiment/codex-full-build` worktree, based on `4786454`.
No installed Chrome extension was reloaded, no user schedules changed, and no
real meeting was joined. No simultaneous recording, auto-leave, native-backend
removal or segmented recording was added. No promotion or commit was performed.

## Changes

- Schedule rendering reads a local snapshot before changing the DOM and commits
  once. A version token discards stale, out-of-order refreshes. Storage events
  and edit/delete callbacks can no longer append the same rows twice.
- Authorization records are keyed by schedule ID, with an exact tab ID and
  saved target identity. Different tabs at the same Teams URL no longer replace
  each other's schedule bindings. There is no automatic tab substitution.
- Grant mutations are serialized. Revoking one tab preserves other tabs'
  bindings. Timing/title edits retain preparation; changing the saved capture
  target, team, channel or join mode requires fresh preparation.
- A second unfinished preparation cannot silently replace the toolbar request
  for another schedule. Finish its toolbar click first. Expired, deleted,
  disabled or retargeted requests do not block a new preparation.
- Schedule cards show their own authorization/tab and timestamped readiness
  result. Opening another schedule's preparation resets the target confirmation
  and selects its existing binding when present. Completed bindings are kept.
- Concurrent authorization status refresh requests are queued, including
  background changes arriving during a refresh.

## Automated and UI evidence

- `npm test`: **256 passed, zero failed**.
- Independent-tab tests cover identical URLs, worker recreation, legacy-grant
  rejection, explicit same-tab preparation, retargeting, closure, origin change,
  deletion of a pending preparation and concurrent revoke/authorization.
- Combined controller/joiner/authorization tests exercise two distinct bound
  targets in order, including a second schedule becoming due while the first
  is stopping/saving. Dispatch waits for completion; both runs finish once.
  These are controlled API tests, not actual media/Teams acceptance.
- `RENDER_BASELINE=1 node scripts/workspace-ui-validation.mjs` reproduces the
  original duplicate bug against HEAD's renderer: **2 cards instead of 1**.
  The same fixture passes against the changed renderer, including deletion,
  stale-title suppression, dropdown counts, and independent preparation labels.
- Latest passing UI artifacts:
  `.test-artifacts/workspace-ui-1792939021913/`.
- Read-only preflight UI, Teams DOM selector fixtures and actual-worker setup
  logging tests passed. Setup artifacts:
  `.test-artifacts/setup-actions-1792938837112/`.
- Experimental build succeeded. `dist/` and test artifacts remain ignored.

## Browser media acceptance

The new `scripts/sequential-schedules-browser-validation.mjs` runs a disposable
copy of the built extension in an isolated Chromium profile. Both synthetic
Teams pages have the same URL but different team identities. The real joiner
operates their local DOM, and the real scheduler/recorder/save flow handles two
one-minute recordings. Only this disposable manifest has fixture host access;
session grants and media acquisition are test doubles. No production permission
is granted or bypassed, and no real Teams service is accessed.

Earlier fixture attempts are preserved: the original production host policy
correctly denied script access; a subsequent run produced both files but failed
the zero-error assertion because the synthetic stream adapter closed its audio
context twice. The adapter now has idempotent cleanup, like a real track.

The older general browser regression also needed an evidence synchronization
fix: the saved status precedes the asynchronous history write. It now waits for
the scheduled run's own history entry and lifecycle completion instead of
occasionally probing the preceding manual file.

Final reruns passed:

- `.test-artifacts/sequential-schedules-1792939147288/result.json`: **PASS**.
  Both fixtures were joined through the real adapter; each distinct tab supplied
  its own synthetic media ID. Both runs stopped and saved, each file decoded
  audio/video frames, both durations were within the one-minute tolerance, and
  the first saved before the second attempt. Unexpected page errors: **0**.
- `.test-artifacts/2026-10-25T14-40-09-417Z/results.json`: **PASS**. Manual
  MP4/pause/resume/playback/seek, one-minute prearmed scheduled recording
  (**59.979 seconds**), target mismatch rejection, failed-save protection,
  finalized-media recovery after reload, retry save and lifecycle logs.
  Unexpected browser errors: **0**.

## Live acceptance and installation

1. When idle, reload **Screen Recorder EXPERIMENT**, then refresh its recorder
   page. Reloading during recording risks losing capture.
2. Existing schedules remain. Old URL-only authorizations intentionally do not
   migrate by guessing tab identity. Prepare **each** schedule again and finish
   its toolbar click before preparing the next schedule.
3. For different teams/channels, keep a separate tab on each configured channel.
   Verify both cards show their correct, independent tab IDs and check readiness.
4. Use two short non-overlapping schedules with sufficient time to save between
   them. Verify A joins, records and saves, then B does the same without further
   preparation or manual Join/Start clicks.
5. Export Logs and verify both files' video/audio and duration. Real Chrome
   activeTab/tabCapture permission and real Teams sequential joining remain
   **live acceptance pending** for this patch.

The app still supports only one active recording and leaves joined meetings
open. Real Teams may impose a handoff prompt when another call is still active;
fixture results do not establish that such a prompt can be handled. Auto-leave
is the separate next batch, not implied by this change.

Historical one-toolbar-click/URL-sharing acceptance reports and harnesses apply
to older builds. They must not be used as current independent-binding evidence.
