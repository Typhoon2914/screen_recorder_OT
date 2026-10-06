# Chrome automation integration contract

Status: **RED-phase specification**. The browser integration described here is not implemented yet.

## Purpose

The automation core on `develop` is pure logic. This feature defines how that core should connect to Chrome without weakening the existing manual recorder behavior.

The integration has two adapters:

1. **Service-worker controller** — owns Chrome alarms, recorder-tab delivery, and duplicate occurrence persistence.
2. **Recorder bridge** — receives automation commands in the recorder page and reports recorder lifecycle events back to the service worker.

## Scheduled start flow

The desired flow is:

```text
Chrome alarm fires
    -> service worker evaluates schedules
    -> due occurrence found
    -> duplicate occurrence check
    -> recorder tab opened or focused
    -> REQUEST_RECORDING sent to recorder
    -> recorder shows that scheduled capture is waiting
    -> user performs the browser-required capture approval
    -> existing recording path starts
    -> RECORDING_STARTED reported back
```

The scheduled request must not pretend that `getDisplayMedia()` can be silently approved. The existing browser capture chooser remains a user-controlled boundary.

## Alarm contract

The service worker maintains one polling alarm:

`screen-recorder-automation-poll`

Initial polling cadence:

- once per minute

The alarm is ensured on extension installation and browser startup.

Unrelated alarms are ignored.

## Duplicate protection

Handled schedule occurrences are persisted through `chrome.storage.local`.

Storage key:

`automationHandledOccurrenceKeys`

An occurrence is persisted only after the recorder successfully receives `REQUEST_RECORDING`.

If message delivery fails, the occurrence remains unhandled so a later poll can retry.

## Recorder tab behavior

When an occurrence is due:

- if the recorder tab exists, activate it and focus its window;
- otherwise create the recorder tab;
- then send the validated `REQUEST_RECORDING` command to that tab.

The existing extension-button behavior must continue to work.

## Recorder bridge

The recorder bridge receives validated automation commands.

For `REQUEST_RECORDING`:

- remember the pending occurrence;
- surface a capture-approval request through an injected callback;
- do not silently invoke browser capture from background automation;
- duplicate requests for the same occurrence are idempotent.

For `REQUEST_STOP`:

- delegate to the recorder's existing stop behavior.

The bridge reports:

- `RECORDING_STARTED`
- `RECORDING_STOPPED`
- `AUTOMATION_ERROR`

through `chrome.runtime.sendMessage()`.

## Manifest changes expected in GREEN phase

The integration will require:

- `alarms`
- `storage`

in addition to the current permissions.

## Explicit non-goals for this feature

This feature does not yet define:

- schedule-editing UI;
- automatic stop timing/duration;
- native unattended capture;
- bypassing Chrome's screen-capture chooser;
- long-recording storage changes;
- recorder quality controls.

Those can be added as separate tested features after this start-path integration is green.
