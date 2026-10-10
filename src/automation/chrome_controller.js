import {
  dueSchedules,
  getOccurrenceKey
} from "./scheduler.js";
import {
  calculateStopDeadline,
  createRecordingStopCoordinator,
  validateRecordingDuration
} from "./recording_duration.js";
import {
  AUTOMATION_COMMANDS,
  parseAutomationCommand
} from "./commands.js";

export const AUTOMATION_POLL_ALARM = "screen-recorder-automation-poll";

const HANDLED_OCCURRENCES_KEY = "automationHandledOccurrenceKeys";
const PENDING_RECORDING_KEY = "automationPendingRecording";
const ACTIVE_RECORDING_KEY = "automationActiveRecording";
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

function defaultNowProvider() {
  const now = new Date();

  return {
    date: [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-"),
    weekday: WEEKDAYS[now.getDay()],
    time: [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join(":"),
    utcOffsetMinutes: -now.getTimezoneOffset()
  };
}

function normalizeHandledOccurrences(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

export function createChromeAutomationController({
  chromeApi,
  recorderUrl,
  schedules = [],
  schedulesProvider = null,
  nowProvider = defaultNowProvider,
  nowMsProvider = () => Date.now()
}) {
  if (!chromeApi) throw new Error("chromeApi is required.");
  if (!recorderUrl) throw new Error("recorderUrl is required.");

  async function ensurePollingAlarm() {
    await chromeApi.alarms.create(
      AUTOMATION_POLL_ALARM,
      { periodInMinutes: 1 }
    );
  }

  async function loadHandledOccurrences() {
    const stored = await chromeApi.storage.local.get(HANDLED_OCCURRENCES_KEY);
    return new Set(
      normalizeHandledOccurrences(stored?.[HANDLED_OCCURRENCES_KEY])
    );
  }

  async function persistHandledOccurrences(handled) {
    await chromeApi.storage.local.set({
      [HANDLED_OCCURRENCES_KEY]: [...handled]
    });
  }

  async function openOrFocusRecorder() {
    const tabs = await chromeApi.tabs.query({});
    const existing = tabs.find((tab) => tab.url === recorderUrl);

    if (existing?.id != null) {
      await chromeApi.tabs.update(existing.id, { active: true });

      if (existing.windowId != null) {
        await chromeApi.windows.update(existing.windowId, { focused: true });
      }

      return existing;
    }

    return chromeApi.tabs.create({ url: recorderUrl });
  }

  async function loadRecord(key) {
    const stored = await chromeApi.storage.local.get(key);
    return stored?.[key] ?? null;
  }

  async function storeRecord(key, value) {
    await chromeApi.storage.local.set({ [key]: value });
  }

  async function checkAutomaticStop() {
    const active = await loadRecord(ACTIVE_RECORDING_KEY);
    if (!active) return;

    const coordinator = createRecordingStopCoordinator({
      recordingId: active.recordingId,
      startedAtMs: active.startedAtMs,
      durationMinutes: active.durationMinutes,
      stopRequested: active.stopRequested
    });
    const dueStop = coordinator.poll(nowMsProvider());
    if (!dueStop) return;

    const command = parseAutomationCommand({
      type: AUTOMATION_COMMANDS.REQUEST_STOP,
      reason: dueStop.reason
    });

    // A failed delivery leaves the persisted deadline available for retry.
    const reply = await chromeApi.tabs.sendMessage(active.tabId, command);
    if (reply?.ok === false) {
      throw new Error("Recorder rejected the automatic stop command.");
    }
    await storeRecord(ACTIVE_RECORDING_KEY, {
      ...active, stopRequested: true
    });
  }

  async function dispatchRecording(schedule, now, handled) {
    const occurrenceKey = getOccurrenceKey(schedule, now);
    const tab = await openOrFocusRecorder();

    if (tab?.id == null) {
      throw new Error("Recorder tab could not be opened.");
    }

    const message = parseAutomationCommand({
      type: AUTOMATION_COMMANDS.REQUEST_RECORDING,
      scheduleId: schedule.id,
      occurrenceKey
    });

    const reply = await chromeApi.tabs.sendMessage(tab.id, message);
    if (reply?.ok === false) {
      throw new Error("Recorder rejected the scheduled recording request.");
    }

    // Older schedules without a duration retain their existing behavior.
    if (schedule.durationMinutes != null) {
      validateRecordingDuration(schedule.durationMinutes);
      await storeRecord(PENDING_RECORDING_KEY, {
        scheduleId: schedule.id,
        occurrenceKey,
        durationMinutes: schedule.durationMinutes,
        tabId: tab.id
      });
    }

    handled.add(occurrenceKey);
    await persistHandledOccurrences(handled);

    return { tabId: tab.id, occurrenceKey };
  }

  async function handleAlarm(alarm) {
    if (alarm?.name !== AUTOMATION_POLL_ALARM) return [];

    await checkAutomaticStop();

    const now = nowProvider();
    const currentSchedules = schedulesProvider
      ? await schedulesProvider()
      : schedules;
    const handled = await loadHandledOccurrences();
    const due = dueSchedules(currentSchedules, now, {
      handledOccurrenceKeys: handled
    });

    const dispatched = [];

    for (const schedule of due) {
      dispatched.push(
        await dispatchRecording(schedule, now, handled)
      );
    }

    return dispatched;
  }

  async function handleRuntimeMessage(message, sender = {}) {
    const command = parseAutomationCommand(message);

    switch (command.type) {
      case AUTOMATION_COMMANDS.RECORDING_STARTED: {
        const pending = await loadRecord(PENDING_RECORDING_KEY);
        if (pending &&
            pending.occurrenceKey === command.occurrenceKey &&
            pending.tabId === sender.tab?.id) {
          const startedAtMs = nowMsProvider();
          const deadlineMs = calculateStopDeadline(
            startedAtMs, pending.durationMinutes
          );
          await storeRecord(ACTIVE_RECORDING_KEY, {
            recordingId: command.recordingId,
            occurrenceKey: pending.occurrenceKey,
            tabId: pending.tabId,
            startedAtMs,
            durationMinutes: pending.durationMinutes,
            deadlineMs,
            stopRequested: false
          });
          await storeRecord(PENDING_RECORDING_KEY, null);
        }
        return { ok: true, type: command.type };
      }

      case AUTOMATION_COMMANDS.RECORDING_STOPPED: {
        const active = await loadRecord(ACTIVE_RECORDING_KEY);
        if (active?.recordingId === command.recordingId &&
            active.tabId === sender.tab?.id) {
          await storeRecord(ACTIVE_RECORDING_KEY, null);
        }
        return { ok: true, type: command.type };
      }

      case AUTOMATION_COMMANDS.AUTOMATION_ERROR:
        return { ok: true, type: command.type };

      default:
        return { ok: false, ignored: true, type: command.type };
    }
  }

  return {
    ensurePollingAlarm,
    handleAlarm,
    handleRuntimeMessage
  };
}
