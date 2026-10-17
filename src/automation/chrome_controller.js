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
import {prepareTarget} from './target_readiness.js';

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
  scheduledTargetProvider = null,
  nowProvider = defaultNowProvider,
  nowMsProvider = () => Date.now()
}) {
  if (!chromeApi) throw new Error("chromeApi is required.");
  if (!recorderUrl) throw new Error("recorderUrl is required.");
  let alarmQueue=Promise.resolve();

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
      [HANDLED_OCCURRENCES_KEY]: [...handled].slice(-1000)
    });
  }

  async function openOrFocusRecorder(background=false) {
    const tabs = await chromeApi.tabs.query({});
    const existing = tabs.find((tab) => tab.url === recorderUrl);

    if (existing?.id != null) {
      if(background)return existing;
      await chromeApi.tabs.update(existing.id, { active: true });

      if (existing.windowId != null) {
        await chromeApi.windows.update(existing.windowId, { focused: true });
      }

      return existing;
    }

    return chromeApi.tabs.create({ url: recorderUrl, ...(background?{active:false}:{}) });
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
    if(schedule.durationMinutes!=null)validateRecordingDuration(schedule.durationMinutes);
    if(schedule.captureMode==='tab'){
      if(!scheduledTargetProvider)throw Error('Authorized tab capture is unavailable');
      const target=await scheduledTargetProvider(schedule.id);
      if(target?.ready===false){
        await storeRecord('automationDiagnostic',{at:new Date(nowMsProvider()).toISOString(),state:'waiting_for_meeting',message:target.reason || 'Waiting for Teams to join within the configured start window'});
        return null;
      }
    }else if(schedule.targetUrl){
      const remembered=await loadRecord('automationTargetTabs') || {};
      const previous=remembered[schedule.id];
      const target=await prepareTarget(chromeApi.tabs,schedule.targetUrl,previous?.url===schedule.targetUrl?previous.tabId:null);
      if(target.tabId!=null)await storeRecord('automationTargetTabs',{...remembered,[schedule.id]:{url:schedule.targetUrl,tabId:target.tabId}});
      if(!target.ready)throw Error(`Capture target is not ready: ${target.reason}. Login, lobby and meeting admission require user verification.`);
    }
    const occurrenceKey = getOccurrenceKey(schedule, now);
    const tab = await openOrFocusRecorder(schedule.captureMode==='tab');

    if (tab?.id == null) {
      throw new Error("Recorder tab could not be opened.");
    }

    const message = parseAutomationCommand({
      type: AUTOMATION_COMMANDS.REQUEST_RECORDING,
      scheduleId: schedule.id,
      occurrenceKey,
      ...(schedule.captureMode==='tab'?{captureMode:'tab'}:{}),
      ...(schedule.title!=null?{title:schedule.title}:{}),
      ...(schedule.durationMinutes!=null?{durationMinutes:schedule.durationMinutes}:{}),
      ...(schedule.targetUrl?{targetUrl:schedule.targetUrl}:{})
    });

    // Older schedules without a duration retain their existing behavior.
    if (schedule.durationMinutes != null) {
      validateRecordingDuration(schedule.durationMinutes);
      await storeRecord(PENDING_RECORDING_KEY, {
        scheduleId: schedule.id,
        occurrenceKey,
        durationMinutes: schedule.durationMinutes,
        tabId: tab.id,
        requestedAtMs: nowMsProvider()
      });
    }

    try {
      const reply=await chromeApi.tabs.sendMessage(tab.id,message);
      if(reply?.ok===false)throw Error(`Recorder rejected the scheduled recording request: ${reply.error || 'not ready'}`);
    }catch(error){
      if(schedule.durationMinutes!=null)await storeRecord(PENDING_RECORDING_KEY,null);
      throw error;
    }

    handled.add(occurrenceKey);
    await persistHandledOccurrences(handled);

    return { tabId: tab.id, occurrenceKey };
  }

  async function processAlarm(alarm) {
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
      if(await loadRecord(ACTIVE_RECORDING_KEY)){
        await storeRecord('automationDiagnostic',{at:new Date(nowMsProvider()).toISOString(),state:'blocked',message:'Overlapping schedule deferred: another recording is active. It will expire after its launch window.'});
        break;
      }
      const pending=await loadRecord(PENDING_RECORDING_KEY);
      if(pending && nowMsProvider()-(pending.requestedAtMs || 0)<120000)break;
      if(pending)await storeRecord(PENDING_RECORDING_KEY,null);
      const result=await dispatchRecording(schedule,now,handled);
      if(result)dispatched.push(result);
    }

    return dispatched;
  }

  function handleAlarm(alarm){
    const result=alarmQueue.then(()=>processAlarm(alarm));
    alarmQueue=result.catch(()=>{});return result;
  }

  async function handleRecorderClosed(tabId,{includePending=true}={}){
    for(const key of includePending?[ACTIVE_RECORDING_KEY,PENDING_RECORDING_KEY]:[ACTIVE_RECORDING_KEY]){
      const record=await loadRecord(key);
      if(record?.tabId===tabId){
        await storeRecord(key,null);
        await storeRecord('automationDiagnostic',{at:new Date(nowMsProvider()).toISOString(),state:'failed',message:'Recorder tab closed or reloaded. Live recording data may be lost; reopen to recover finalized data.'});
      }
    }
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
        await storeRecord('automationDiagnostic',{at:new Date(nowMsProvider()).toISOString(),state:'failed',reason:command.reason,message:command.message});
        {
          const pending=await loadRecord(PENDING_RECORDING_KEY);
          if(pending?.tabId===sender.tab?.id)await storeRecord(PENDING_RECORDING_KEY,null);
          const active=await loadRecord(ACTIVE_RECORDING_KEY);
          if(active?.tabId===sender.tab?.id)await storeRecord(ACTIVE_RECORDING_KEY,null);
        }
        return { ok: true, type: command.type };

      default:
        return { ok: false, ignored: true, type: command.type };
    }
  }

  return {
    ensurePollingAlarm,
    handleRecorderClosed,
    handleAlarm,
    handleRuntimeMessage
  };
}
