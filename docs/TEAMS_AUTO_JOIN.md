# Experimental Teams scheduled joining

This adapter joins a channel's existing meeting in the already authorized Teams
tab. It does not create meetings, use Messenger, open another capture target,
change Chrome permissions, or replace MediaRecorder/FFmpeg/saving.

## Setup

1. Open the intended team and channel in Chrome for Testing. Sign in manually.
2. In **Schedule a lecture**, choose that Teams tab and click **Use this tab**.
3. Set weekday, local time and duration. Select **Authorized tab** and check
   **Join the channel meeting automatically**. Verify the exact team/channel
   names and the waiting window. Set **Only on this date** for a one-off
   recording. Without that date, schedules repeat weekly. Save.
4. Under step 2 select that schedule and exact tab; confirm it is the correct
   channel, then click **Authorize selected Teams tab**. On that Teams tab,
   click Chrome Extensions > Screen Recorder EXPERIMENT once.
5. Leave that tab on the configured channel. Keep Chrome, the recorder tab and
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

Diagnostic events are kept locally in `automationJoinEvents` (latest 100),
alongside existing recording and saving diagnostics. They contain status and
schedule IDs, not credentials or meeting URLs.

## Limits and safety

- English Teams web controls only; Teams UI changes can break selectors.
- The user must handle sign-in/MFA, browser permissions and lobby admission.
- No automatic leave, meeting creation, Messenger integration or native capture.
- Startup requires audible captured audio under the existing recorder policy.
  A quiet meeting can delay or prevent recording; a successful join is not
  proof of captured audio or a saved file.
- Duration is measured from actual recording start, not the requested wall-clock
  end. Late joining can shift subsequent segments; existing overlap/save guards
  can defer or miss later schedules. No gapless segmentation claim.
- Live chunks still reside in memory. This change provides no new RAM/OOM or
  crash protection. Two-hour recording safety remains unqualified.
- A meeting already open without this adapter's verified channel transition is
  rejected. Return to the intended channel before setup.
- Same-origin navigation may retain Chrome access, but is not permission to
  record an arbitrary other meeting. No automatic tab substitution is used.

## Validation

`node --test tests/integration/teams_join.test.js` checks state, cancellation,
origin, configuration and recovery contracts. The existing scheduler regression
includes waiting followed by one successful dispatch, not premature handling.

`node scripts/teams-join-dom-validation.mjs` tests selectors against controlled
HTML in real Chromium. These are fixtures, not real Teams acceptance.

`scripts/teams-auto-join-observe.mjs <artifact-directory> <isolated-profile>`
observes an already configured real scheduled test. It does not click Join,
trigger an alarm or start recording. Real acceptance must separately show the
join events, live capture, auto-stop, completed download and validated media.
