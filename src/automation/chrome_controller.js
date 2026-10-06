import {
  dueSchedules,
  getOccurrenceKey
} from "./scheduler.js";
import {
  AUTOMATION_COMMANDS,
  parseAutomationCommand
} from "./commands.js";

export const AUTOMATION_POLL_ALARM = "screen-recorder-automation-poll";

const HANDLED_OCCURRENCES_KEY = "automationHandledOccurrenceKeys";
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
  nowProvider = defaultNowProvider
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

    await chromeApi.tabs.sendMessage(tab.id, message);

    handled.add(occurrenceKey);
    await persistHandledOccurrences(handled);

    return { tabId: tab.id, occurrenceKey };
  }

  async function handleAlarm(alarm) {
    if (alarm?.name !== AUTOMATION_POLL_ALARM) return [];

    const now = nowProvider();
    const handled = await loadHandledOccurrences();
    const due = dueSchedules(schedules, now, {
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

  async function handleRuntimeMessage(message) {
    const command = parseAutomationCommand(message);

    switch (command.type) {
      case AUTOMATION_COMMANDS.RECORDING_STARTED:
      case AUTOMATION_COMMANDS.RECORDING_STOPPED:
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
