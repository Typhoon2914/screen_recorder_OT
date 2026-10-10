# Schedule configuration contract

Status: **RED-phase specification**.

The automation scheduler and Chrome integration are already working as tested components, but the service worker currently receives an empty static schedule array. This feature replaces that temporary placeholder with validated schedules stored in `chrome.storage.local`.

## Storage model

Storage key:

`automationSchedules`

Each schedule contains:

- `id` — stable non-empty identifier
- `weekdays` — one or more English weekday names
- `time` — local wall-clock time in strict `HH:mm`
- `launchWindowSeconds` — positive integer launch window
- `enabled` — explicit boolean

Example:

```json
{
  "id": "example-lecture",
  "weekdays": ["Sunday"],
  "time": "20:50",
  "launchWindowSeconds": 120,
  "enabled": true
}
```

The example above is test data only and is not a real user schedule.

## Validation

Invalid schedules must never be silently fed into the scheduler.

Validation rejects:

- missing/blank IDs
- duplicate IDs
- missing or invalid weekdays
- invalid `HH:mm` times
- zero, negative, non-integer, or non-numeric launch windows
- non-boolean `enabled` values

Loading corrupted storage should fail explicitly instead of partially running an invalid schedule.

## Storage API

The intended module is:

`src/automation/schedule_store.js`

with these responsibilities:

- expose `AUTOMATION_SCHEDULES_KEY`
- validate one schedule
- validate a complete schedule list
- load schedules
- save schedules
- load only enabled schedules
- enable/disable a schedule by ID

Schedule editing UI is not part of this feature.

## Runtime behavior

The service worker must not capture the schedules only once at startup.

Instead, the Chrome automation controller receives an asynchronous `schedulesProvider`.

On each relevant automation alarm:

1. the provider is called;
2. enabled schedules are loaded from storage;
3. the normal scheduler evaluates them;
4. newly saved/disabled schedules therefore take effect without restarting the extension.

For backward compatibility and test isolation, the controller may continue to support the existing static `schedules` constructor option when no provider is supplied.

Unrelated Chrome alarms must not query schedule storage.

## Explicit non-goals

This feature does not yet add:

- an options/settings page;
- lecture duration or automatic stop time;
- browser capture bypass;
- native unattended recording;
- recorder memory/storage refactoring;
- hard-coded personal schedules.

Once this storage layer is green, a separate UI or seed/configuration feature can create the user's actual schedules.
