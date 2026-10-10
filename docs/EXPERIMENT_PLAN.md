# Experimental acceptance plan

Baseline: local develop f239734bbe743fac3380ec49b3be53cc5b2d9e76, 99 passing tests.
All work belongs to experiment/codex-full-build in its isolated worktree.
The stable installation and normal Chrome profile are excluded.

## Gates

- Preserve existing recording and automation regressions.
- Test filename safety, verified downloads, retries and unsaved protection.
- Provide schedule management, observable state and explicit capture authorization.
- Validate synthetic recordings and browser UI separately from mocked tests.
- Report unavailable platform and Teams validation honestly.

## Capture boundary

Chrome tabCapture requires user invocation. Alarms and offscreen documents do
not grant capture permission. A retained, explicitly authorized stream can be
used later while its document and tracks remain alive, but this is not cold
unattended capture after browser restart. No permission-bypass flags or real
meeting joins are authorized.

References:
- https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- https://developer.chrome.com/docs/extensions/reference/api/offscreen

Acceptance requires a real nonempty media file, duration and stream checks,
playback and seeking, and verified saving; unit tests alone are insufficient.
