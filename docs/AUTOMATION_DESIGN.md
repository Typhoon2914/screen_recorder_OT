# Automation design contract

Status: **test specification only**. Production automation is intentionally not implemented on this branch.

## Purpose

The recorder already works manually. Automation should be added without changing that known-good recording behavior until the automation contract is proven by tests.

The automation layer is split into three responsibilities:

1. **Scheduler** — decides when a configured recording occurrence is due.
2. **Automation state machine** — tracks the lifecycle of one scheduled recording attempt.
3. **Command contract** — defines the messages exchanged by future scheduler, extension, recorder, and any external/native helper.

## Scheduler contract

Schedules are weekly and use explicit local wall-clock values.

A schedule has, at minimum:

- stable `id`
- one or more `weekdays`
- local `time` in `HH:mm`
- a small `launchWindowSeconds`

The scheduler must:

- identify an occurrence as due at its configured local weekday/time;
- avoid early triggering;
- ignore other weekdays;
- support multiple independent schedules;
- calculate the nearest next occurrence;
- roll an already-passed occurrence to the next week;
- avoid accidental UTC conversion of local wall-clock input;
- generate a stable occurrence key;
- prevent the same occurrence from triggering twice;
- tolerate scheduler polling a few seconds after the exact start time;
- reject stale occurrences outside the launch window.

The pure scheduling layer should not know how recording is started. It only reports intent.

## Automation state machine

The initial contract uses these states:

- `IDLE`
- `DUE`
- `AWAITING_CAPTURE_APPROVAL`
- `RECORDING`
- `STOPPING`
- `COMPLETED`
- `ERROR`

Normal lifecycle:

```text
IDLE
  -> DUE
  -> AWAITING_CAPTURE_APPROVAL
  -> RECORDING
  -> STOPPING
  -> COMPLETED
```

Error behavior is explicit and machine-readable. A capture cancellation or permission failure must never be represented as a successful recording.

Duplicate or out-of-order commands must be idempotent or safely ignored rather than corrupting state.

## Command contract

The initial cross-component message types are:

- `REQUEST_RECORDING`
- `CAPTURE_READY`
- `RECORDING_STARTED`
- `REQUEST_STOP`
- `RECORDING_STOPPED`
- `AUTOMATION_ERROR`

Commands have validated payloads. Unknown command types and malformed known commands are rejected.

The occurrence identity travels with a recording request so repeated scheduler polling cannot start duplicate recordings.

## Browser capture boundary

The existing implementation uses `navigator.mediaDevices.getDisplayMedia()`.

That API is controlled by the browser. The scheduler may automatically decide that a recording is due and may open/focus the recorder, but the current design must not assume that ordinary extension JavaScript can silently bypass the browser's capture-source/permission UI.

Therefore the current state machine explicitly includes:

`AWAITING_CAPTURE_APPROVAL`

This keeps scheduling logic independent from whatever capture mechanism is chosen later.

If fully unattended capture is required, that requirement may need a native/helper capture path or another mechanism outside the current browser-only recorder. That decision is intentionally deferred until after the automation contract is tested.

## Development order

1. Keep the baseline regression suite green.
2. Add these automation tests in RED state.
3. Review and agree on the contract.
4. Implement the smallest scheduler/state/command modules needed to turn the tests green.
5. Re-run baseline tests and production build.
6. Add browser/service-worker integration tests.
7. Only after automation is stable, upgrade the recorder internals.

## Current branch expectation

This branch intentionally contains tests that reference production modules that do not exist yet:

- `src/automation/scheduler.js`
- `src/automation/state_machine.js`
- `src/automation/commands.js`

So:

- `npm run test:baseline` should remain green.
- `npm run test:automation` should be red until implementation begins.
