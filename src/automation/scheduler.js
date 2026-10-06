const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

function parseClock(value) {
  const parts = String(value).split(":").map(Number);
  const [hours = 0, minutes = 0, seconds = 0] = parts;

  if (
    parts.length < 2 ||
    parts.length > 3 ||
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 || hours > 23 ||
    minutes < 0 || minutes > 59 ||
    seconds < 0 || seconds > 59
  ) {
    throw new Error(`Invalid local time: ${value}`);
  }

  return (hours * 3600) + (minutes * 60) + seconds;
}

function parseLocalDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!match) throw new Error(`Invalid local date: ${date}`);

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function addLocalDays(date, days) {
  const { year, month, day } = parseLocalDate(date);
  const value = new Date(Date.UTC(year, month - 1, day + days));

  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function weekdayIndex(name) {
  const index = WEEKDAYS.indexOf(name);
  if (index < 0) throw new Error(`Invalid weekday: ${name}`);
  return index;
}

function validateSchedule(schedule) {
  if (!schedule?.id) throw new Error("Schedule id is required.");
  if (!Array.isArray(schedule.weekdays) || schedule.weekdays.length === 0) {
    throw new Error("Schedule weekdays are required.");
  }

  for (const weekday of schedule.weekdays) weekdayIndex(weekday);
  parseClock(schedule.time);
}

export function getOccurrenceKey(schedule, now) {
  validateSchedule(schedule);
  if (!now?.date) throw new Error("Current local date is required.");

  return `${schedule.id}|${now.date}|${schedule.time}`;
}

export function isRecordingDue(schedule, now, options = {}) {
  validateSchedule(schedule);

  if (!now?.weekday || !now?.time || !now?.date) {
    throw new Error("Current local date, weekday, and time are required.");
  }

  if (!schedule.weekdays.includes(now.weekday)) return false;

  const scheduledSeconds = parseClock(schedule.time);
  const nowSeconds = parseClock(now.time);
  const elapsedSeconds = nowSeconds - scheduledSeconds;
  const launchWindowSeconds = schedule.launchWindowSeconds ?? 60;

  if (elapsedSeconds < 0 || elapsedSeconds > launchWindowSeconds) return false;

  const handled = options.handledOccurrenceKeys;
  if (handled?.has(getOccurrenceKey(schedule, now))) return false;

  return true;
}

export function dueSchedules(schedules, now, options = {}) {
  return schedules.filter((schedule) => isRecordingDue(schedule, now, options));
}

export function getNextRun(schedules, now) {
  if (!Array.isArray(schedules) || schedules.length === 0) return null;
  if (!now?.date || !now?.weekday || !now?.time) {
    throw new Error("Current local date, weekday, and time are required.");
  }

  const currentWeekday = weekdayIndex(now.weekday);
  const currentSeconds = parseClock(now.time);
  let best = null;

  for (const schedule of schedules) {
    validateSchedule(schedule);
    const scheduledSeconds = parseClock(schedule.time);

    for (const weekday of schedule.weekdays) {
      const targetWeekday = weekdayIndex(weekday);
      let daysAhead = (targetWeekday - currentWeekday + 7) % 7;

      if (daysAhead === 0 && currentSeconds >= scheduledSeconds) {
        daysAhead = 7;
      }

      const candidate = {
        scheduleId: schedule.id,
        date: addLocalDays(now.date, daysAhead),
        weekday,
        time: schedule.time,
        sortKey: (daysAhead * 86400) + scheduledSeconds
      };

      if (!best || candidate.sortKey < best.sortKey) best = candidate;
    }
  }

  if (!best) return null;

  return {
    scheduleId: best.scheduleId,
    date: best.date,
    weekday: best.weekday,
    time: best.time
  };
}
