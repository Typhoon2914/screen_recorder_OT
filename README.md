# Screen Recorder OT — source repository

Chrome MV3 screen/tab recorder with Teams scheduling, LAB Telegram notifications, verified download flow, and an optional native recording companion. **A passing test suite is regression evidence, not proof of successful live Teams recording.**

## Worktrees and release boundaries

This repository uses two local Git worktrees; they are **not** two unrelated repositories:

| Role | Local working tree | Branch | Installed unpacked extension |
| --- | --- | --- | --- |
| Stable, protected | `G:\\MyPersonalProjects\\screen_recorder_OT` | `main` | `G:\\MyPersonalProjects\\screen_recorder_OT\\dist` |
| Development/LAB | `G:\\MyPersonalProjects\\screen_recorder_OT_LAB` | `feature/lab-telegram-monitoring-control` | `G:\\MyPersonalProjects\\screen_recorder_OT_LAB\\dist-lab` |

`develop` is the intended integration branch. Feature branches are not production releases. Do not merge LAB into `main` or update Stable without explicit release approval.

**Important:** The default Vite build output is `dist`. Never use a default build as a way of updating either installed unpacked extension. Build into a disposable directory, inspect its manifest, preserve the installed LAB identity metadata, back up `dist-lab`, and reload LAB only when it is not recording or saving. The build guard intentionally refuses overwriting key-bearing installed manifests.

## Development and verification

In the LAB working tree:

```powershell
git fetch origin
git status --short
npm ci
npm test
npm run build -- --outDir ../.test-artifacts/ci-build
```

The build stays under `.test-artifacts` and must not be confused with the installed extension. Chrome live testing is a separate acceptance step and should verify Telegram delivery, actual captured audio/video, downloads, and Teams transitions.

## Repository map

- `src/automation/`: business logic and Chrome/Teams/Telegram adapters
- `src/scripts/`: recorder page, settings, and workspace UI controllers
- `src/pages/`, `src/styles/`, `src/public/`: UI and MV3 manifest
- `tests/`: unit, baseline, integration, and schedule regressions
- `scripts/`: disposable browser/recording test harnesses and build safety
- `companion/`: optional, separately configured native recording experiment
- `docs/`: architecture, acceptance evidence, setup and troubleshooting
- `old_versions/`: historical snapshots, not production entrypoints

For boundaries, retention, and source-of-truth guidance, see [repository layout](docs/REPOSITORY_LAYOUT.md).

## Capture limitations

The scheduled Authorized Tab provider needs a legitimate user toolbar grant to an exact target. Chrome restart, target closure, cross-origin navigation, or grant loss requires reauthorization. It does not provide permanent unattended browser capture. LAB silence monitoring measures **captured audio**, not the identity of the speaker. Telegram remote control and professor-specific presence detection are not implemented at this checkpoint.

See [authorized tab capture](docs/AUTHORIZED_TAB_CAPTURE.md), [Teams join](docs/TEAMS_AUTO_JOIN.md), [testing](docs/TESTING.md), and [real acceptance evidence](docs/JOIN_STATE_RECOVERY_ACCEPTANCE_2026-11-07.md).
