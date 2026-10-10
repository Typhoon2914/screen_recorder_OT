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

An alarm cannot authorize a fresh Chrome capture stream. Explicitly select a tab and arm one schedule beforehand; recording can then start without another Start click while that stream remains alive. Keep the recorder open and computer awake. Completion releases the stream; the next occurrence needs a fresh arm.

The optional local OBS companion uses native capture rather than Chrome's picker. It is **mock-tested, not live-validated**, needs an isolated OBS/source setup, and does not log in to Teams, join meetings or resolve lobbies. Neither path claims cold unattended end-to-end Teams operation.

The browser harness loads the real production extension in a fresh profile and encodes actual synthetic audio/video. It substitutes the picker boundary; it does **not** prove real tab capture permission or Teams readiness. Downloads, file decoding, duration, playback, seeking and screenshots are recorded under ignored .test-artifacts/.
