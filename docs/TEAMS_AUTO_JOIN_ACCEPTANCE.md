# Teams auto-join acceptance — 2026-10-17

Branch: `experiment/codex-full-build`. Experimental worktree only. No push,
merge, main/develop change, stable-extension change or normal-profile change.
Implementation is uncommitted at the end of this acceptance run.

## Outcome

**A real scheduled join → capture → stop → verified save passed in the authorized
tEST / General meeting.** Initial tab authorization was manual; no Join, Start,
Stop, sharing-picker or Download click occurred during the successful interval.
The current real lecture has not happened yet; its successful outcome is not
being claimed. This is conditional session-authorized automation, not permanent
capture permission or production qualification.

## Evidence (UTC; Cairo is UTC+03:00 on this date)

- Final test authorization: 14:44:59.270.
- Scheduled local minute: 17:47; one-minute alarm polling adds start latency.
- Adapter clicked Join with microphone/camera verified off: 14:47:34.893.
- Verified joined state: 14:47:37.067.
- Actual MediaRecorder start: 14:47:40.772; live video and audio tracks,
  startup audio peak -12.76 dBFS.
- Automatic stop: 14:48:40.772; both tracks ended.
- Saved/history: 14:48:41.076; capture saved event 14:48:41.088.
- Chrome download ID 2: complete, exists, 1,496,910 bytes.

Media validation: 59.942 seconds, H.264 1920x1080 (114 decoded frames), AAC
(2810 decoded frames). Full ffprobe frame counting completed without decoder
errors. Audio peak RMS -7.40 dBFS; 811 audio frames above -60 dBFS. Headless
Chrome played and sought to 29.9709 seconds without a media error.

**Warning retained:** the recorder reported a ten-second quiet interval and
saved history as `saved_with_warning`. This is not proof of continuously audible
speech or continuously moving presenter video. The tab video/audio and saving
checks passed; the quiet warning was not hidden or suppressed.

## First attempt and correction

The 17:43 attempt reached the correct prejoin screen, then safely refused to join
because Teams uses native checkbox inputs with `title` and `.checked`, not the
ARIA attributes in the initial fixture. Its evidence is preserved. A new browser
fixture reproduced this failure; the adapter was corrected to support native
input state, and the fixture passed. The test was disabled, the extension reloaded,
and a fresh authorization preceded the successful 17:47 attempt.

The first reload also exposed Chrome's Developer mode requirement; the user
enabled it in the isolated test profile. No permission or security prompt was
automatically accepted.

## Tonight's configuration

Verified at 14:54:27.942 UTC in the isolated Chrome for Testing profile:

- Team: CSE671 (PG2024) - Advanced Artificial Intelligence (43919).
- Channel: General; same designated Teams tab remains open on this channel.
- 2026-10-17 20:31, 119 minutes.
- 2026-10-17 22:30, 15 minutes.
- 2026-10-17 22:45, 15 minutes.
- All enabled, authorized-tab mode, auto-join on, 15-minute retry windows.
- All three have a currently valid session authorization; one-minute Chrome
  polling alarm exists. Recorder is idle. All acceptance schedules are disabled.
- Date-limited entries cannot repeat on a later Saturday.

The date limit was added after the real join test and has four focused automated
tests. Final suite: **207 passed, 0 failed**. Final build and syntax checks pass.
Real join/capture acceptance used the same join adapter and recording engine;
the newly date-limited actual lecture entries have not yet executed.

Read-only host checks: AC idle sleep and hibernation disabled; battery sleep
after 15 minutes. About 124 GiB free on C:, about 12.4 GiB physical RAM free at
inspection. These snapshots do not establish two-hour memory safety.

## Artifact locations (ignored, not committed)

- First attempt: `.test-artifacts/teams-auto-join-1792248021960/`.
- Successful attempt: `.test-artifacts/teams-auto-join-1792248284721/`.
- `events.jsonl`, `result.json`: runtime timeline and verified download.
- `teams-autojoin.mp4`: unchanged copy of the real saved download.
- `ffprobe.json`, `ffprobe-errors.txt`, `audio-levels.json`,
  `media-validation.json`: media evidence.
- `setup.png`, `joined-leave-control.png`, `recording-status.png`, `saved.png`,
  `tonight-ready.png`: real UI evidence; private target/history areas masked.
- `tonight-schedules.json`, `tonight-readiness.json`: sanitized final settings.
- `regression-final.txt`, `build-final.txt`: final automated verification.

The original recording remains in the user's Downloads directory. No profiles,
credentials, meeting URLs or generated recordings were added to tracked source.

## Remaining limits

Keep this Chrome instance, the exact Teams tab and the recorder tab running,
with the PC awake and online. Reauthorization is required after browser restart
or extension reload. Authentication, permissions or lobby admission can block
joining. English Teams selectors may change. Startup silence can block capture.
The scheduler retries only within the launch window. Actual start delays shift
duration deadlines; save/finalization gaps and overlapping schedules can defer
or miss overtime recordings. RAM-aware recovery, automatic leave, Messenger
ingestion, gapless segmentation and long-duration qualification remain deferred.
