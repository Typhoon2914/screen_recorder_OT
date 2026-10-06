# Testing approach

This project uses a test-first workflow for behavior changes.

For each change:

1. **Red** — write or update an automated test that describes the intended behavior and verify that it fails for the expected reason.
2. **Green** — make the smallest production-code change needed to make the test pass.
3. **Refactor** — improve structure only while the test suite remains green.

## Commands

Run the complete suite:

```bash
npm test
```

Run tests continuously while editing:

```bash
npm run test:watch
```

## Current testing boundary

Pure logic should be extracted into small modules that can be tested with Node's built-in test runner without a browser.

Browser/extension behavior that depends on Chrome APIs, MediaRecorder, getDisplayMedia, downloads, or real capture sessions should be covered by adapter-level tests where practical and by explicit manual integration scenarios when browser permission UI prevents reliable automation.

A production behavior change should not be implemented before its expected behavior has first been expressed as a test.
