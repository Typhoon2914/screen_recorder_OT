# Troubleshooting and limitations

| Symptom | Safe next step |
|---|---|
| Scheduled ready, waiting for Start | No valid armed stream; authorize the correct target manually. |
| Target opening/loading | Wait; verify login/admission yourself. Loading is not capture readiness. |
| Target changed | Disarm and reauthorize after checking the configured target. |
| Busy / unsaved | Finalize/save or retry the protected recording first. |
| Save failed / FILE_NO_SPACE | Free space, keep the page open, retry. Pending IDs are reused. |
| Recovery unavailable | Browser quota/policy prevented a durable copy. Do not close until saved. |
| Recovered recording | Verify/retry saving before starting another. |
| No audio | Share tab audio. A track's existence does not prove audible speech. |
| Fast-start warning | Original media retained; validate seeking before relying on it. |
| Another recorder owns session | Use the original recorder tab. |
| Companion profile/scene mismatch | Correct isolated setup, never the normal OBS configuration. |
| Companion unresolved state | Inspect OBS/output before clearing state.active; do not blindly replay. |
| Stale companion lock | Verify no process owns it before manually removing the lock. |

Remaining limitations:

- No cold unattended Chrome-only capture or automatic login/join/lobby handling.
- Exact target URL matching can reject Teams redirects. Loaded pages do not prove admission.
- Arming does not survive restart/completion. Live chunks are not a durable journal; a crash before finalization can lose media.
- Browser quota/policy eviction can remove recovery. Download-volume free-space probing is not available through this extension.
- Throttling/sleep may delay stop timers. Missed launch windows are not replayed.
- No reliable captured-tab-title discovery or speech-level audio-health detector.
- History is bounded and does not continuously verify files later moved/deleted.
- OBS is not live-validated. Readiness is a human lease; its output verification is stable nonzero size, not full media quality.
- Native messaging, desktop notifications, automatic companion configuration sync, native lecture-title renaming and one-click installation are not implemented.
- Ten minutes of low-complexity synthetic media is not a full Teams lecture.

Do not clear extension/recovery storage containing unsaved media. Never disable browser security or TLS validation to make a test pass.
