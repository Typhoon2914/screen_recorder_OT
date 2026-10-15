# Screen Recorder — experimental build

This branch is **not the stable recorder** and is not ready for unattended Teams deployment. It adds verified automatic downloads, finalized-recording recovery, schedule editing, armed capture, quality controls and diagnostics. Manual recording remains available.

## Start here

Use Node 22.12+ (validated with Node 24.16.0 on Windows). In this worktree:

```powershell
npm ci
npm test
npm run build
npm run verify
```

Load **this worktree's dist** into a separate Chrome test profile. The extension is named **Screen Recorder EXPERIMENT**. Never replace the stable installation.

- [Windows installation and loading](docs/WINDOWS_EXPERIMENT.md)
- [Configuration](docs/CONFIGURATION.md)
- [Architecture and feasibility](docs/EXPERIMENT_ARCHITECTURE.md)
- [Tests and acceptance](docs/ACCEPTANCE.md)
- [Troubleshooting and limitations](docs/TROUBLESHOOTING.md)
- [Performance report](docs/PERFORMANCE.md)
- [Implementation summary](docs/IMPLEMENTATION_SUMMARY.md)

## Capture boundary

An alarm cannot grant capture permission to an uninvoked tab. The experimental **Authorized tab** provider instead uses one legitimate toolbar invocation for an exact target, then obtains a fresh one-use tabCapture stream for each schedule while that session grant remains usable. It releases all tracks between recordings. Chrome restart, target closure, cross-origin navigation or permission loss requires reauthorization. This is not permanent install-once authorization.

Manual getDisplayMedia and the existing pre-armed workflow remain available. The recorder, MediaRecorder, duration stop, FFmpeg fast-start, recovery vault and verified downloads are shared; Playwright is only a test controller, not the recording engine.

See [authorized-tab setup, architecture and limitations](docs/AUTHORIZED_TAB_CAPTURE.md) and [integrated acceptance evidence](docs/INTEGRATED_TAB_ACCEPTANCE.md). Real acceptance status must be read separately from passing unit tests.

The optional local OBS companion uses native capture rather than Chrome's picker. It is **mock-tested, not live-validated**, needs an isolated OBS/source setup, and does not log in to Teams, join meetings or resolve lobbies. Neither path claims cold unattended end-to-end Teams operation.

The browser harness loads the real production extension in a fresh profile and encodes actual synthetic audio/video. It substitutes the picker boundary; it does **not** prove real tab capture permission or Teams readiness. Downloads, file decoding, duration, playback, seeking and screenshots are recorded under ignored .test-artifacts/.
