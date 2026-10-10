export const AUTOMATION_SCHEDULES_KEY = "automationSchedules";

const WEEKDAYS = new Set([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
]);

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function requireChromeStorage(chromeApi) {
  if (!chromeApi?.storage?.local) {
    throw new Error("chrome.storage.local is required.");
  }
}

export function validateScheduleConfig(schedule) {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    throw new Error("Invalid schedule.");
  }

  if (typeof schedule.id !== "string" || schedule.id.trim() === "") {
    throw new Error("Schedule id is required.");
  }

  if (!Array.isArray(schedule.weekdays) || schedule.weekdays.length === 0) {
    throw new Error("At least one weekday is required.");
  }

  for (const weekday of schedule.weekdays) {
    if (!WEEKDAYS.has(weekday)) {
      throw new Error(`Invalid weekday: ${weekday}`);
    }
  }

  if (typeof schedule.time !== "string" || !TIME_PATTERN.test(schedule.time)) {
    throw new Error(`Invalid schedule time: ${schedule.time}`);
  }

  if (
    !Number.isInteger(schedule.launchWindowSeconds) ||
    schedule.launchWindowSeconds <= 0
  ) {
    throw new Error("Invalid launch window.");
  }

  if (typeof schedule.enabled !== "boolean") {
    throw new Error("Schedule enabled must be a boolean.");
  }

  return schedule;
}

export function validateScheduleList(schedules) {
  if (!Array.isArray(schedules)) {
    throw new Error("Schedule list must be an array.");
  }

  const seenIds = new Set();

  for (const schedule of schedules) {
    validateScheduleConfig(schedule);

    if (seenIds.has(schedule.id)) {
      throw new Error(`Duplicate schedule id: ${schedule.id}`);
    }

    seenIds.add(schedule.id);
  }

  return schedules;
}

export async function loadSchedules(chromeApi) {
  requireChromeStorage(chromeApi);

  const stored = await chromeApi.storage.local.get(AUTOMATION_SCHEDULES_KEY);
  const schedules = stored?.[AUTOMATION_SCHEDULES_KEY];

  if (schedules == null) return [];

  return validateScheduleList(schedules);
}

export async function saveSchedules(chromeApi, schedules) {
  requireChromeStorage(chromeApi);

  const validated = validateScheduleList(schedules);

  await chromeApi.storage.local.set({
    [AUTOMATION_SCHEDULES_KEY]: validated
  });

  return validated;
}

export async function loadEnabledSchedules(chromeApi) {
  const schedules = await loadSchedules(chromeApi);
  return schedules.filter((schedule) => schedule.enabled);
}

export async function setScheduleEnabled(chromeApi, scheduleId, enabled) {
  if (typeof enabled !== "boolean") {
    throw new Error("Schedule enabled must be a boolean.");
  }

  const schedules = await loadSchedules(chromeApi);
  const index = schedules.findIndex((schedule) => schedule.id === scheduleId);

  if (index < 0) {
    throw new Error(`Schedule not found: ${scheduleId}`);
  }

  const updated = schedules.map((schedule, currentIndex) =>
    currentIndex === index
      ? { ...schedule, enabled }
      : schedule
  );

  return saveSchedules(chromeApi, updated);
}
