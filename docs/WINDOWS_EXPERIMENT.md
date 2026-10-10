# Windows setup and extension loading

Use this experimental worktree only, with Node 22.12+ (tested: 24.16.0). Run npm ci, npm test and npm run build. Do not replace stable files or use the normal Chrome profile.

Keep automated browser binaries and profiles local:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH=Join-Path (Get-Location) '.test-artifacts\browser-cache'
$env:PLAYWRIGHT_SKIP_BROWSER_GC='1'
npx playwright install --no-shell chromium
npm run test:browser
```

The harness creates a fresh profile per run, without Teams credentials. For interactive testing, launch Chrome with a new dedicated user-data directory under .test-artifacts. In that profile only, open chrome://extensions, enable Developer mode and Load unpacked from this worktree's dist. Confirm Screen Recorder EXPERIMENT. Do not alter the stable extension or normal profile.

After building, reload only the experimental extension, never during an unsaved recording. Choose the synthetic capture target manually; do not automate security dialogs. Verify download behavior in the dedicated profile if policies require file prompts.

## Optional OBS fallback — manual setup

Use a separate [portable OBS installation](https://obsproject.com/kb/portable-mode), not normal OBS configuration. Create BOTH profile and scene collection named ScreenRecorderExperiment. Configure the exact expected scene, dedicated loopback WebSocket port (example 4457), and password. Set native window capture/application audio to the dedicated synthetic test Chrome instance. Validate these sources before authorized meeting use.

Set the OBS recording folder to outputRoot. Prefer a crash-tolerant container such as MKV and validate/remux before delivery. The companion does not change profile/scene/output settings. Only use --execute after human source/readiness confirmation. No scheduled task or native-messaging registry entry is installed. Locked-session behavior needs live testing.

## Tooling notes

The initial Playwright install used its shared cache and automatically removed unused Chromium/headless-shell v1208 caches. Installed Chrome profiles and the stable recorder were not touched, but those old test runtimes may need reinstallation by their owning Playwright version. Subsequent setup uses the local cache with garbage collection disabled.

Some CDN requests reported certificate-chain errors; retries succeeded without disabling TLS validation. The OBS client's transitive crypto-js dependency emits a maintenance deprecation warning. npm audit reports no known vulnerabilities at this checkpoint; keep the dependency chain under review.
