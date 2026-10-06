# Testing approach

The project is being developed in this order:

1. **Freeze the current working recorder behavior with characterization/regression tests.**
2. **Write tests for automation and scheduling before implementing them.**
3. **Implement automation and scheduling until those tests pass.**
4. **Only then upgrade/refactor the existing recording logic, test-first.**

This order is intentional. The current recorder is known to work, so its present behavior is treated as the compatibility baseline. Future work should make it obvious when an automation feature or recorder upgrade breaks something that worked before.

## Baseline regression suite

The current setup is characterized by automated tests covering:

- Manifest V3 extension contract and required permissions.
- Extension-button behavior that opens or focuses the recorder page.
- Existing recorder-page control IDs used by the UI.
- Screen capture through `getDisplayMedia()` with video and capture audio.
- Current MIME preference: MP4/H.264+A​​AC, then VP9/Opus, VP8/Opus, then generic WebM.
- The current stabilization delay/dimension check before recording starts.
- Stopping when browser sharing ends.
- MediaRecorder chunk collection and stop processing.
- MP4 remux/fallback behavior.
- Playback after recording.
- Chrome download flow with `saveAs: true`.
- The existing manual Stop button behavior.
- MP4 faststart FFmpeg arguments.
- A production Vite build.

Baseline tests live under `tests/baseline/` so they can stay green independently of intentionally failing feature tests.\n\nRun the regression tests plus a production build:

```bash
npm run test:baseline
```

Run the automated tests only:

```bash
npm test
```

Run tests continuously while editing:

```bash
npm run test:watch
```

## Development rule from this point forward

For a new behavior:

1. **Red** — write the expected test first and verify that the current implementation does not satisfy it.
2. **Green** — add the smallest implementation needed to satisfy the test.
3. **Regression** — run `npm run test:baseline` to make sure the original recorder still works according to its baseline contract.
4. **Refactor** — improve the implementation while keeping both the new tests and baseline tests green.

## Browser integration boundary

Some browser behaviors cannot be fully exercised by Node alone because Chrome owns the screen-selection/permission UI. Those behaviors should have two layers:

- automated contract/adapter tests where practical;
- explicit manual integration scenarios for real `getDisplayMedia()`, MediaRecorder, extension loading, and browser permission flows.

The automated baseline is not a substitute for the real-browser smoke test; it is the guardrail that tells us when code changes have altered the known-working setup.
