# Teams join-state recovery — 2026-11-07

## Scope and preservation

The user subsequently requested committing the current changes to a stable
branch before any further work. `stable/session-authorized-v1` is the local
checkpoint for that request, including the editor safeguard. This name does not
claim completion of the remaining live reliability checks below. No remote push
or promotion of main/develop is included in this checkpoint.

- Local branch: `feature/teams-join-state-recovery`, created from clean local
  commit `2b5c391` (sequential schedule/tab binding), descendant of the remote
  feature branch checkpoint `4786454`.
- No reset, stash, deletion, merge, push or promotion. Prior local work was
  already committed, contrary to the older handoff snapshot.
- Development and fixture artifacts stay in the experimental worktree. Existing
  user recordings, stable extension, main and develop are untouched.
- Initial builds used `.test-artifacts/join-recovery-build`, preserving the
  installed `dist` while recording status was unknown.

## Failure lifecycle and correction

The October 31 logs show Join clicked at 20:31:10, unavailable Join at 20:31:11,
identity rejection on the transitional Meeting join page at 20:31:13, then
repeated unverified-meeting failures. Capture was never requested.

1. `teamsJoinPageStep` returned `joining` after the verified Join now click.
2. During the next poll, a disabled Join button returned `prejoin`.
3. `createTeamsJoiner.ensure` persisted every returned phase in
   `chrome.storage.session.teamsJoinSessions[tabId]`, overwriting joining.
4. The transitional four-part title was treated as a channel identity mismatch.
   Its missing sidebar could not satisfy channel verification.
5. The controller retried the same occurrence on subsequent polling alarms.
   A visible Leave button with the saved prejoin phase was rejected as unverified.
   `dispatchRecording` never reached REQUEST_RECORDING.

The corrected adapter retains joining and does not click again while connecting.
It permits the observed same-channel Meeting join transition without using that
title alone as proof of readiness. The verified flow still requires Leave to
report joined. Different team/channel evidence invalidates saved trust.

Trust now includes schedule ID/fingerprint, occurrence, tab and Chrome document
ID. Injection into that same document is enforced by `chrome.scripting`.
Different occurrences, targets, configurations, legacy records or replacement
documents cannot inherit the verified join. The active-monitor call supplies
its occurrence key, and cancellation is checked again after page execution.
Departure is persisted before returning to the controller.

An additional replay gap was reproduced: a recording-start acknowledgement
could persist active recording before the original dispatch reply was lost,
without persisting the handled occurrence. After saving and recreation, that
occurrence could start again. The acknowledgement now writes active state and
handled identity together.

## Automated evidence

- `npm test`: **266 passed, zero failed**. Evidence:
  `.test-artifacts/join-recovery-tests.txt`.
- Syntax: **86** JavaScript/module files passed `node --check`.
- Production build command:
  `npm run build -- --outDir ../.test-artifacts/join-recovery-build` — passed.
- `git diff --check` — passed (Git reports normal LF/CRLF conversion notices).
- DOM regression: old adapter returned prejoin after Join; fixed adapter passes
  disabled/enabled remaining Join button, missing sidebar/transition title,
  wrong meeting, returning to channel and existing selector safeguards.
- Controller regression: lost start reply failed before the acknowledgement
  persistence change; it now prevents a second request after stop/recreation.
- Built-extension RED reproduction:
  `.test-artifacts/join-recovery-1794050358672/result.json` — expected failure,
  saved phase **prejoin** instead of **joining**, using adapter `2b5c391`.
- Initial built-extension GREEN:
  `.test-artifacts/join-recovery-1794050153401/result.json` — passed. Verified
  worker recreation during transition and recording, real alarm dispatch,
  exactly one start, **59.975 s** timed recording, cancellation while connecting,
  and **2.562 s** safely saved cancelled recording. Both files have nonzero,
  decodable video and audio frames.
- Existing recorder browser acceptance:
  `.test-artifacts/2026-11-07T11-17-36-929Z/results.json` — passed, zero errors.
  Manual MP4 capture/pause/resume/save/seek, changed-target rejection, prearmed
  scheduled capture (**59.979 s**), failed-save protection, finalized-blob
  recovery after reload, retry save and separate lifecycle logs.
- Final recovery browser acceptance:
  `.test-artifacts/join-recovery-1794050408794/result.json` — passed, zero page
  errors. Recovered timed recording **59.976 s**; cancelled recording **2.571 s**.
  Four fresh worker boots verified. Same-origin page replacement is rejected by
  Chrome document ID with no additional Join or recording request. The original
  document's trust cannot transfer to its replacement.
- Sequential browser acceptance:
  `.test-artifacts/sequential-schedules-1794050367294/result.json` — passed,
  two distinct authorized fixture tabs, two joins, sequential recordings,
  timed stops, verified audio/video files and zero page errors.
- Installed build prepared with `npm run build`. Before rebuilding, all **29**
  old dist files were copied and SHA-256 compared under
  `.test-artifacts/pre-join-recovery-dist-20261107T112224Z`. The rebuilt joiner,
  controller and service worker hashes match the isolated acceptance build.
  Regular Chrome still needs the user to reload the experimental extension.

The first recovery harness attempt timed out waiting for Playwright to emit a
new worker object. Chrome had resumed processing; the harness now verifies a
fresh per-boot identity in the disposable fixture worker instead. This did not
require weakening application checks. An intermediate baseline run also failed
on missing new provenance; the final RED run asserts the behavioral regression
first. All failed artifacts remain preserved.

## What is real, and what is simulated

Real in isolated Chromium: extension service worker, its actual onAlarm listener,
controller/join adapter, scripting, session/local persistence, runtime messaging,
MediaRecorder, stop/save, Chrome downloads and file decoding. CDP is used only
to control the disposable test browser's worker/download behavior.

Simulated: Teams pages, permission grants and source-media acquisition. A copy
of the extension receives fixture-host permission and a synthetic stream-ID
adapter. Canvas/Web Audio provide the source; Playwright is not the recording
engine. Production manifest and recorder engine are unchanged.

These results do not verify Chrome toolbar authorization, real Teams page
compatibility, lobby admission or real meeting audio. No live acceptance claim.

## Live acceptance gate

### First live retest: failed before Join now

The November 7 test at 13:30 did not pass. User screenshots show the actual
Teams prejoin page with Join now visible and microphone/camera off. The pasted
logs show the channel Join click at 13:30:18, then a rejection at 13:30:19 while
the old correct channel title remained but the sidebar had disappeared.
That rejection reset trust before prejoin finished loading. Subsequent retries
rejected Meeting join. No recording start occurred. The schedule was configured
for three minutes, not the one-minute duration suggested for acceptance.

Two missing transition cases were corrected:
- A verified prejoin/joining phase now tolerates the old exact team/channel
  title with no sidebar while Teams mounts the next page. This grants no
  readiness and cannot establish trust for a fresh/unverified session.
- Meeting join titles are classified before interpreting the title fields as
  a team and channel; Teams can retain the Teams and Channels prefix there.
  Different named meetings still block, including when Leave is present.

The new DOM regression failed before this correction (blocked instead of
prejoin). The browser fixture now delays prejoin for 2.5 seconds after removing
the sidebar and retains the exact observed title forms. Full automated suite
remains 266 passing. Final replay
`.test-artifacts/join-recovery-1794051309677/result.json` passed with zero page
errors: delayed channel-to-prejoin and joining transitions, four worker
recreations, exactly one timed recording (**59.983 s**), safe cancellation save
(**2.563 s**), and replacement-document rejection. The production dist adapter
was rebuilt and its hash compared with this isolated acceptance build. A new
live attempt still requires extension reload and fresh occurrence preparation.

### Latest live retest: recording and saving reported

At 13:38–13:40 the supplied readiness logs showed a saved configuration mismatch:
expected `Meeting join` / `Meeting in "General"`, observed `tEST` / `General`.
Authorization was present. This was not a failed automatic join attempt.
The schedule editor's Use this tab action accepted the prejoin title prefix as
a channel title and could overwrite the actual team/channel fields.

The UI regression reproduced that overwrite (tEST became Meeting join). The
editor now rejects non-channel title autofill when auto-join is selected and
preserves existing fields. Without auto-join, target selection remains allowed
without inventing team/channel names. Workspace UI validation passed at
`.test-artifacts/workspace-ui-1794051714557`; all 266 automated tests still pass.
This editor safeguard is built separately in `.test-artifacts/prejoin-editor-build`
and has not replaced the installed dist while the user prepares the next test.
The existing saved schedule requires explicit correction to tEST / General,
save, preparation/toolbar authorization, and a fresh readiness check. No user
schedule or recording was changed by development tools.

User confirmed the important lecture ended and the manual recording saved.
Both supported regular-Chrome control entry points currently fail at startup:
`windows sandbox failed: helper_unknown_error: setup refresh had errors`.
No regular Chrome UI action has been performed. Live testing needs user-assisted
setup until that control path works.

After correcting the saved team/channel, the user reported "recorded" and
"saved" for the next live test. This confirms the observed recording/save
outcome by user report. The final logs and media have not been independently
inspected. Audible later speech, exact duration, and one-start-only evidence
remain to be confirmed from playback/History/Logs. This report does not infer
those details from the short success message.

Next acceptance work: inspect that saved output, then test two non-overlapping
live schedules prepared together. The remaining live reliability cases include
disable/reschedule before start, cancel while retrying, manual departure without
rejoin, and cancel during recording with a safe save. Automated/fixture evidence
for these paths is recorded above and in the sequential-schedules report.

No promotion to develop/stable and no push/merge until that test passes and
the user approves the relevant Git action. Auto-leave, generic-tab UI, import/
export, RAM segmentation, branch pruning and unrelated features are deferred.
