# Troubleshooting and limitations

| Symptom | Safe next step |
|---|---|
| Scheduled ready, waiting for Start | No valid armed stream; authorize the correct target manually. |
| UNATTENDED UNAVAILABLE / Reauthorization required | Select the exact target in the new authorization panel, then invoke the experimental extension on that target. Never authorize the normal-profile recorder by mistake. |
| Audio silent / below readiness threshold | Play the source and check mute/autoplay/meeting admission. A silent interval may be intentional; the application cannot distinguish this with certainty and refuses to claim audio readiness. |
| Source silent after navigation | Same-origin permission may survive while the new page's AudioContext/media is autoplay-blocked. Resume source playback legitimately; permission alone is insufficient. |
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
- Pre-armed streams do not survive restart/completion. Authorized-tab grants may support repeated fresh capture in the same browser session, but not browser restart. Live chunks are not a durable journal; a crash before finalization can lose media.
- Browser quota/policy eviction can remove recovery. Download-volume free-space probing is not available through this extension.
- Throttling/sleep may delay stop timers. Missed launch windows are not replayed.
- Authorized-tab identity is explicit. Audio levels are measured, but this is not speech recognition or proof of correct meeting admission. Below-threshold audio blocks startup; sustained silence during capture is a warning, not automatic evidence of failure.
- History is bounded and does not continuously verify files later moved/deleted.
- OBS is not live-validated. Readiness is a human lease; its output verification is stable nonzero size, not full media quality.
- Native messaging, desktop notifications, automatic companion configuration sync, native lecture-title renaming and one-click installation are not implemented.
- Ten minutes of low-complexity synthetic media is not a full Teams lecture.

Do not clear extension/recovery storage containing unsaved media. Never disable browser security or TLS validation to make a test pass.
