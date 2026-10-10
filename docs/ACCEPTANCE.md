# Test strategy and acceptance

## Automated gates

- npm test: original regressions plus saving, editor validation, FFmpeg lifecycle, races/overlap, target readiness and companion safety.
- npm run verify: tests/build logs, manifest, packaged assets and runtime syntax under .test-artifacts/verification-*.
- npm run test:browser: fresh-profile production extension, synthetic MP4/WebM, pause/resume, Chrome alarm/runtime delivery, duration stop, download verification, save failure and reload recovery.
- BENCHMARK_SECONDS=600 runs the longer synthetic case; clear the environment override for ordinary smoke tests.

Original baseline tests remain. Intended contracts were explicitly updated: experimental name, verified autosave instead of Save As, avc3-first MP4 after a browser-observed codec error, and bounded bitrate options. No failing tests were removed to obtain green results. RED gates and browser failures are recorded in this task's execution history and evidence.

## Human/live gates before deployment

- [ ] Real picker captures the correct synthetic tab with audio, without injection.
- [ ] Authorized Teams test meeting: login, lobby and source correctness verified.
- [ ] Missing targets, redirects, authentication expiry and lobby errors visible.
- [ ] Browser close/restart, extension reload and worker suspension tested live.
- [ ] Sleep/wake, DST, missed events and overlapping lectures tested live.
- [ ] 60–120 minute lecture at intended resolution, with speech/video sync.
- [ ] CPU/RAM peaks, free disk, finalization and responsiveness acceptable.
- [ ] Real destination downloads verified under applicable browser policy.
- [ ] Isolated OBS tested with real sources, stop flushing and failures.
- [ ] Companion output decoded and naming/export behavior accepted.

Synthetic stream substitution tests encoding/save integration, not capture permissions or Teams access. Companion tests are mocked RPC plus a no-connect dry-run. A green automated suite does not complete the unchecked gates.
