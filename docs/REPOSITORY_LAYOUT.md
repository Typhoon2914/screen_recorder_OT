# Repository layout and LAB development policy

Updated 2026-11-27. This is an operational guide; do not infer live behavior from code/tests alone.

## Working source and installed extension are different things

- `main` is the protected production source checkpoint. It is not the LAB branch.
- `develop` is the integration branch.
- `feature/lab-telegram-monitoring-control` is the active LAB feature branch.
- `G:\\MyPersonalProjects\\screen_recorder_OT` is the main worktree. Its installed Stable extension loads from `dist`.
- `G:\\MyPersonalProjects\\screen_recorder_OT_LAB` is the linked LAB worktree. Its installed LAB extension loads from `dist-lab`.
- Git worktrees share history and repository-local exclude configuration, but have separate working files.
- Generated `dist-lab/`, `dist-lab-backup-*/`, and `.test-artifacts/` folders are local deployment/test artifacts, not uncommitted application features.

## Module ownership

| Area | Responsibility |
| --- | --- |
| `src/automation/chrome_controller.js` | Scheduled occurrence dispatch, cancellation, duration, active-run monitoring |
| `src/automation/teams_join.js` | Teams tab identity, join flow, conservative observed departure |
| `src/automation/tab_capture.js` and `audio_monitor.js` | Tab capture acquisition and captured-sound monitoring |
| `src/automation/telegram_alerts.js` | Outbound Telegram delivery, retries, deduplication |
| `src/automation/activity_log.js` | Bounded persistent activity log |
| `src/public/service_worker.js` | MV3 event wiring and dispatch |
| `src/scripts/recorder.js` | MediaRecorder, finalization, recording-specific monitoring |
| `src/scripts/telegram_ui.js` and `workspace_ui.js` | Telegram and workspace/log interface |
| `src/scripts/schedule_ui.js` | Schedule editor and configuration |
| `companion/` | Optional native experiment, separate from Chrome capture |

## Deployment and acceptance

1. Commit source changes only to LAB feature branch.
2. Run `npm test` and an isolated `npm run build -- --outDir ../.test-artifacts/ci-build`.
3. Review any changed manifest permissions, service worker behavior and test evidence.
4. When LAB is idle and has no unsaved recording, back up its installed `dist-lab` directory.
5. Deploy the reviewed LAB build to the **same** `dist-lab` directory, preserving extension identity metadata. Reload LAB only.
6. Test with an actual controlled Teams tab, actual audio, actual Telegram delivery, and a verified output file.
7. Leave Stable untouched until a separately approved release.

Do not delete untracked local backups through GitHub Desktop to make the Changes count disappear. Git ignores them once configured. A successful `git pull` updates source, not the loaded Chrome extension.

## Known acceptance boundary for future professor monitoring

The existing Teams join adapter has conservative generic departure detection. In `chrome_controller.js`, an active scheduled recording with verified departure can trigger `cancelRun()`, which requests stop. That is **not** professor-specific absence detection and is not the requested alert-and-continue behavior. Do not conflate the two.

A new participant monitor must distinguish **present**, **confirmed absent**, and **unknown**; use read-only Teams inspection, identity-matched evidence and conservative time thresholds. Being offscreen or inaudible does not prove absence. The monitor must never automatically stop recording on professor absence alone.

## Housekeeping rules

- Do not commit `dist/`, `dist-lab/`, `dist-lab-backup-*/`, dependency folders or test media.
- Keep `old_versions/` as historical reference until a separate archive/retirement change is approved.
- Keep new feature code within existing modules where sensible rather than creating many overlapping modules or branches.
- Prefer focused source commits and independently verifiable acceptance results.
