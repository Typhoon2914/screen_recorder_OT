export const AUTOMATION_SCHEDULES_KEY = "automationSchedules";
import {validateRecordingDuration} from './recording_duration.js';
import {TEAMS_ORIGINS} from './teams_join.js';

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

  if(schedule.runDate!=null){
    const value=typeof schedule.runDate==='string' && /^\d{4}-\d{2}-\d{2}$/.test(schedule.runDate)?new Date(schedule.runDate+'T00:00:00Z'):null;
    if(!value || !Number.isFinite(value.getTime()) || value.toISOString().slice(0,10)!==schedule.runDate || !schedule.weekdays.includes([...WEEKDAYS][value.getUTCDay()]))throw Error('Invalid schedule date or weekday');
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

  if(schedule.durationMinutes!=null)validateRecordingDuration(schedule.durationMinutes);
  if(schedule.durationMinutes>1440)throw Error('Duration must not exceed 1440 minutes');
  if(schedule.captureMode!=null && !['manual','tab'].includes(schedule.captureMode))throw Error('Invalid capture mode');
  if(schedule.captureMode==='tab' && (!schedule.targetUrl || schedule.durationMinutes==null))throw Error('Authorized tab capture requires target URL and duration');
  if(schedule.teamsAutoJoin!=null && typeof schedule.teamsAutoJoin!=='boolean')throw Error('Invalid Teams auto-join flag');
  if(schedule.teamsAutoJoin){
    if(schedule.captureMode!=='tab' || !TEAMS_ORIGINS.includes(new URL(schedule.targetUrl).origin))throw Error('Teams joining requires an authorized Teams tab');
    for(const field of ['teamsTeam','teamsChannel'])if(typeof schedule[field]!=='string' || !schedule[field].trim() || schedule[field].length>200)throw Error('Teams team and channel names are required');
    if(!Number.isInteger(schedule.joinWaitMinutes) || schedule.joinWaitMinutes<1 || schedule.joinWaitMinutes>60)throw Error('Teams waiting time must be 1–60 minutes');
  }
  if(schedule.title!=null && (typeof schedule.title!=='string' || schedule.title.length>200))throw Error('Invalid lecture title');
  if(schedule.targetUrl){
    const url=new URL(schedule.targetUrl);
    if(url.protocol!=='https:' || url.username || url.password)throw Error('Target must be an HTTPS URL without credentials');
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

// Extension documents share this origin-wide lock. Always re-read inside it,
// so editing one schedule cannot overwrite concurrent changes to another.
export async function updateSchedules(chromeApi,mutate,locks=globalThis.navigator?.locks){
  if(!locks)throw Error('Schedule editing requires Web Locks support');
  return locks.request('screen-recorder-schedules',async()=>saveSchedules(chromeApi,mutate(await loadSchedules(chromeApi))));
}
