# Experimental architecture and feasibility

## Capture decision

Chrome documents that tabCapture requires user invocation, such as invoking the extension action. Target-tab capture needs granted access. getMediaStreamId is short-lived and one-use, not a reusable permission token. Offscreen documents provide DOM/media execution, not capture authorization. An alarm plus offscreen page is therefore not a valid cold unattended design. References: [tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture), [offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

This implementation retains the existing recorder and explicit getDisplayMedia chooser. Arming holds the authorized stream for one schedule and target URL. A changed target, missing audio/video or dead stream fails closed. Meeting admission remains a human assertion, not a conclusion drawn from page loading. No capture-security bypass flags are used.

## Flow and state

1. Schedule UI validates and persists automationSchedules. Origin-wide Web Locks serialize read/modify/write edits.
2. The MV3 worker polls each minute. The controller fetches enabled schedules, serializes alarms, and checks occurrence/overlap state.
3. Configured target pages are opened if absent. Loading is not ready; complete loading still does not prove login/admission.
4. Addressed runtime messages reach extension documents. tabs.sendMessage is a content-script transport, so the real worker adapts the pure controller's injected transport.
5. The recorder starts an armed stream or requests approval. Pending duration context is persisted before dispatch to avoid immediate-start acknowledgment races.
6. A local timer and persisted worker deadline stop recording. Pausing does not extend wall-clock lecture duration.
7. Finalization stops tracks, creates media and remuxes MP4 fast-start. Remux failure retains original media with a visible warning.
8. IndexedDB holds one finalized recovery blob. The saver verifies Chrome download completion and nonzero existing file, then removes recovery and adds bounded history.

UI states include recording, paused, processing, saving, saved and failed. An origin-wide recorder lock prevents concurrent documents recording. Failed/unsaved media blocks replacement capture. In-progress retries reuse the download ID; interrupted/empty output can retry. Restart clears stale active automation and reports reauthorization. Worker suspension retains duration context; tab closure reports possible data loss.

## Windows fallback

OBS provides [WebSocket remote control](https://obsproject.com/kb/remote-control-guide), [per-application Windows audio capture](https://obsproject.com/kb/application-audio-capture-guide), and [portable configuration isolation](https://obsproject.com/kb/portable-mode).

The companion defaults to no-connect dry-run. Explicit execution requires loopback authenticated OBS, an experimental profile and collection, an exact scene, and a time-limited human readiness authorization. It never switches profiles or changes sources. It persists intent before starting, refuses an existing recording, stops its own requested capture, waits for outputActive=false, and verifies stable nonempty output within the configured directory. Ambiguous failures stop execution for reconciliation.

This is an independent scheduler, not native messaging. Do not enable both backends for one lecture. Live OBS, media quality, source selection and Teams admission need human-authorized acceptance. Output naming remains OBS configuration; native title-based renaming is not implemented.

## Resources

Live media remains buffered until stop. Finalization can hold multiple copies plus FFmpeg WASM memory. Durable recovery begins only after IndexedDB commits. A crash before then may lose recording data. Temporary FFmpeg files are removed and the worker is terminated after each remux, following measured retention in an earlier build. Transient finalization peaks still need lecture-scale profiling. No speculative streaming rewrite was made.
