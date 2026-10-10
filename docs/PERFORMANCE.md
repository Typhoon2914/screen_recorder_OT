# Performance benchmark report

Windows, Node 24.16.0, Chrome for Testing 156.0.8078.4, dedicated headless profiles.
Source: a changing 640×360 canvas at 10 fps plus a synthetic oscillator.
These are low-complexity synthetic measurements, not representative Teams lectures.

## Ten-minute test

Evidence: ../.test-artifacts/2026-10-10T23-19-11-671Z/results.json

| Measurement | Result |
|---|---:|
| Requested recording time | 600 seconds |
| MP4 duration | 600.174 seconds |
| File size | 39,901,783 bytes |
| Decoded video frames | 6,004 |
| Video/audio | H.264 / AAC |
| Audio duration | 600.156 seconds |
| A/V endpoint difference | 18 ms |
| Stop-to-saved time | 645 ms |
| Largest sampled JS heap | 3,092,552 bytes |
| Main-thread task CPU over capture | 3.549 seconds |

Full-file FFprobe decoding passed; moov precedes mdat (fast-start).
Playback and seeking passed in the browser. Endpoint agreement is not a
perceptual lip-sync test. JS heap excludes native/WASM/media buffers; it is NOT
total recording memory. Whole-browser CPU/RAM was not sampled in this long run.

## Matched one-minute Windows process samples

The harness queries only chrome.exe processes belonging to its unique profile
and descendants, every five seconds and after saving. Working-set sums can
double-count shared pages. Short finalization peaks may be missed.

| Measurement | Before FFmpeg worker release | After worker release |
|---|---:|---:|
| Initial private memory | 486.8 MiB | 483.5 MiB |
| Post-save / largest observed private memory | 705.0 MiB | 577.5 MiB |
| Largest observed summed working set | 863.3 MiB | 773.3 MiB |
| Aggregate process CPU | 3.578 s / 62.403 s | 4.641 s / 62.524 s |
| Number of samples | 14 | 14 |

Evidence directories:
- Before: ../.test-artifacts/2026-10-10T23-33-22-914Z
- After: ../.test-artifacts/2026-10-10T23-36-03-908Z

A single matched pair suggests reduced post-save retention (127.5 MiB), not a
statistically established improvement or a true peak-memory bound. Final code
terminates the FFmpeg worker after each remux. Latest stop-to-saved measurement
was 315 ms; the earlier short-run timer included sampling overhead, so it is not
a valid direct timing comparison.

Latest manual MP4: 61.296 seconds, 614 decoded video frames, audio present,
5 ms endpoint difference, fast-start. Requested 60 seconds includes test-control
and sampling latency. The independently timed scheduled WebM was 59.975 seconds,
602 decoded frames. Recovered failed-save WebM was 1.991 seconds and 22 frames.
All three files decoded without FFprobe errors.

## Responsiveness and scope

The UI remained operable for pause/resume, stop, schedule editing, arming and
recovery. There was no formal input-latency benchmark or perceptual A/V test.
No 60–120 minute 1080p Teams lecture was recorded. Do not extrapolate these
measurements to full-resolution lectures or constrained-memory machines.

## Memory tradeoffs

MediaRecorder buffering remains proportional to recording size. MP4 remuxing
and IndexedDB recovery can temporarily duplicate that data. Worker release
reduces retention, but does not solve long-capture buffering.

Candidates if lecture-scale tests demonstrate pressure:

| Approach | Benefit | Cost / limitation |
|---|---|---|
| Timesliced chunks to IndexedDB | Earlier recovery; bounded JS chunk list | Quota, transaction overhead, codec/chunk assembly and crash testing |
| Authorized File System Access writer | Stream directly to selected disk file | Up-front user permission; container finalization and recovery design |
| Native OBS companion | Native encoding/file writing outside WASM | Isolated installation/source configuration; new integration acceptance |

No architecture rewrite was justified solely by these limited measurements.
