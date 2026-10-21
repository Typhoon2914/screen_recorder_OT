# Experimental Teams scheduled joining

This adapter joins a channel's existing meeting in the already authorized Teams
tab. It does not create meetings, use Messenger, open another capture target,
change Chrome permissions, or replace MediaRecorder/FFmpeg/saving.

## Setup

1. Open the intended team and channel in the Chrome profile containing
   Screen Recorder EXPERIMENT. Sign in manually.
2. In **Schedules > New schedule**, choose that Teams tab and click **Use this tab**.
3. Choose **Once** with a date, or **Weekly** with a weekday. Set local time
   and duration. Automatic Teams joining is the default for new schedules.
   Verify the displayed team/channel; exact names, provider and retry window
   remain available under Advanced. Existing schedules keep their settings.
4. Save, then click **Prepare recording** on its schedule card. Select the exact
   tab, confirm the channel, and click **Prepare selected Teams tab**. On that tab,
   click Chrome Extensions > Screen Recorder EXPERIMENT once.
5. Click **Check Teams readiness (no joining)** beside the authorized schedule.
   This checks the saved team/channel against that exact tab without joining,
   toggling controls, or requesting a capture stream. Authorization alone does
   not mean auto-join or recording will succeed. A "meeting has not started"
   result means there is no Join button yet; it is not a successful recording test.
6. Leave that tab on the configured channel. Keep Chrome, the recorder tab and
   the PC awake. Closing/restarting Chrome or reloading the extension requires
   authorization again. A prior manual recording is NOT this authorization.

All schedules with the identical target URL can share its session grant.
Do not navigate that tab to unrelated meetings. A different channel is rejected.

## Runtime behavior

The existing one-minute Chrome alarm checks due schedules. For opted-in Teams
schedules, the authorized target is checked before a bounded join attempt.
The adapter verifies the team header, selected channel and document title,
then clicks only the unique **Join meeting in progress** control. **Meet now**
is never clicked. It verifies microphone and camera switches are off and
Computer audio is selected before **Join now**. Only the verified join flow
reaching the meeting's **Leave** control permits capture to start.

The adapter performs at most twelve short steps per alarm, persisting its phase
in session storage for worker restarts. If no meeting exists, it retries on
subsequent alarms within the configured launch window. It does not mark an
occurrence handled until the existing recorder accepts it. Disabling/removing
or changing the schedule cancels further join steps.

Start-time, date, duration, provider and target changes invalidate an in-flight
attempt before further joining or recording. A final recorder-to-worker check
also verifies the start window and cancellation before MediaRecorder starts.
An acknowledgement arriving after cancellation requests stop/save.

**Cancel this run** is available during a pending attempt or active recording.
It cancels the occurrence's retries, surviving worker recreation without
disabling next week's occurrence. During recording it requests stop and save;
it does not click Teams Leave. Disable/delete/edit cancel pending attempts,
but do not interrupt a recording already in progress.

After a verified join, returning to a verified channel or prejoin page is logged
as **Meeting departure detected**, not proof of a Leave click. That occurrence
does not rejoin. Active meetings are checked on the one-minute scheduler poll;
departure detection is not instantaneous. Missing controls during a transient
render are not enough to declare departure. Sign-in and lobby prompts are never
bypassed.

Diagnostic events are kept locally in `automationJoinEvents` (latest 100),
alongside existing recording and saving diagnostics. They contain status and
schedule IDs, not credentials or meeting URLs. Blocked identity checks now
include the expected team/channel, the names from the tab title, and separate
title/sidebar/selection match results. These names remain in local extension
storage; review them before sharing diagnostics. Only rendering whitespace is
normalized; case, punctuation and different team names are not fuzzy-matched.

The **Logs** tab displays the separate `automationActivityLog` (latest 500
events), including checks, join phases, failures, pending retries with estimated
next-check/expiry times, cancellation, recording, stop, saving, and verified
download results. Copy/export operate on this sanitized activity log, not raw
storage. URLs, file paths and common credential forms are redacted. Schedule
IDs and team/channel names may remain; review before sharing.

The workspace is divided into **Schedules**, **Record now**, **History** and
**Logs**. Manual pre-armed screen/window capture remains an advanced alternative
under Record now; native settings are under Developer settings. The two capture
permission mechanisms are not interchangeable.

## Limits and safety

- English Teams web controls only; Teams UI changes can break selectors.
- The user must handle sign-in/MFA, browser permissions and lobby admission.
- No automatic leave, meeting creation, Messenger integration or native capture.
- Startup requires live audio and video tracks and a working audio monitor.
  Silent or very quiet samples produce a warning but do not delay recording;
  the stream remains open to capture later speech. Missing/ended tracks,
  permission errors and unavailable monitoring still block startup. Warnings
  remain in recording history; a successful join is not proof of audible audio
  or a saved file.
- Duration is measured from actual recording start, not the requested wall-clock
  end. Late joining can shift subsequent segments; existing overlap/save guards
  can defer or miss later schedules. No gapless segmentation claim.
- Live chunks still reside in memory. This change provides no new RAM/OOM or
  crash protection. Long-run engine qualification is outside this update.
- A meeting already open without this adapter's verified channel transition is
  rejected. Return to the intended channel before setup.
- Same-origin navigation may retain Chrome access, but is not permission to
  record an arbitrary other meeting. No automatic tab substitution is used.

## Silent-start policy verification (2026-10-20)

- `npm test`: 218 passed, zero failures.
- `node scripts/teams-join-dom-validation.mjs`: controlled browser DOM fixtures
  passed; these do not establish live Teams acceptance.
- `node scripts/silent-start-validation.mjs` uses real browser Web Audio and
  MediaRecorder with synthetic live audio/video. It verifies that silent
  startup emits a warning, recording starts, later sound survives encoding and
  decoding, and capture tracks are released on completion. Set `FFMPEG_PATH`
  when FFmpeg is not on PATH. Media and results remain in ignored
  `.test-artifacts/silent-start-*` directories.
- The synthetic test passed with initial decoded audio RMS 0 and later RMS
  approximately 0.2503. This does not test Chrome tab authorization, the
  scheduler, the extension download manager, or a live Teams meeting.
- A short real Teams scheduled silent-start check remains pending. Reload the
  experimental extension and reauthorize its exact Teams tab before that check.

## Validation

`node --test tests/integration/automation_lifecycle.test.js` covers rescheduling
during preparation, disable/delete between join steps, explicit cancellation,
expiry, late acknowledgements, next-week independence, sequential stop/save
guards, and bounded serialized logs. These are controlled tests.

`node scripts/workspace-ui-validation.mjs` exercises Once/Weekly, exact-tab
preparation, cancellation commands, four tabs, log updates/export, keyboard
navigation and mobile width using a fake Chrome API. Screenshots and evidence
are written to ignored `.test-artifacts/workspace-ui-*`.

`node scripts/browser-validation.mjs` loads the actual built extension in an
isolated Chromium profile. It exercises real alarms/runtime messages,
MediaRecorder, verified downloads, playback/seek and save-failure recovery.
Only the source chooser is replaced by synthetic audio/video; this is not
real Teams or Chrome capture authorization acceptance.

`node --test tests/integration/teams_join.test.js` checks state, cancellation,
origin, configuration and recovery contracts. The existing scheduler regression
includes waiting followed by one successful dispatch, not premature handling.

`node scripts/teams-join-dom-validation.mjs` tests selectors against controlled
HTML in real Chromium. These are fixtures, not real Teams acceptance.

`node scripts/teams-preflight-ui-validation.mjs` checks the read-only readiness
button in real Chromium with mocked extension APIs, including mismatch and
authorization-expiry reporting. It does not prove Teams joining or media capture.

`scripts/teams-auto-join-observe.mjs <artifact-directory> <isolated-profile>`
observes an already configured real scheduled test. It does not click Join,
trigger an alarm or start recording. Real acceptance must separately show the
join events, live capture, auto-stop, completed download and validated media.
