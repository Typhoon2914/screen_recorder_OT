import {
  dueSchedules,
  getOccurrenceKey,
  isRecordingDue
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
import {scheduleFingerprint} from './run_state.js';

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
  monitorActive = null,
  log = async()=>{},
  nowProvider = defaultNowProvider,
  nowMsProvider = () => Date.now()
}) {
  if (!chromeApi) throw new Error("chromeApi is required.");
  if (!recorderUrl) throw new Error("recorderUrl is required.");
  let alarmQueue=Promise.resolve();
  let cancelQueue=Promise.resolve();
  let runQueue=Promise.resolve();
  const currentSchedules=()=>schedulesProvider?schedulesProvider():Promise.resolve(schedules);
  async function assertCurrent(schedule,occurrenceKey){
    const current=(await currentSchedules()).find(item=>item.id===schedule.id);
    if(!current || current.enabled===false || scheduleFingerprint(current)!==scheduleFingerprint(schedule))throw Error('Run cancelled: schedule disabled, deleted or changed');
    const cancelled=await loadRecord('automationCancelledOccurrences') || [];
    if(cancelled.includes(occurrenceKey))throw Error('Run cancelled; no retry will be made');
    if(occurrenceKey){
      const now=nowProvider();
      if(getOccurrenceKey(schedule,now)!==occurrenceKey || !isRecordingDue(schedule,now))throw Error('Run cancelled: start window expired');
    }
  }
  function runStatus(scheduleId,value){
    const task=runQueue.then(async()=>{
      const runs=await loadRecord('automationRuns') || {};
      if(runs[scheduleId]?.state==='cancelled' && runs[scheduleId].occurrenceKey===value.occurrenceKey &&
        ['joining','starting','retry_pending'].includes(value.state))return;
      await storeRecord('automationRuns',{...runs,[scheduleId]:value});
    });
    runQueue=task.catch(()=>{});return task;
  }
  async function retryStatus(schedule,occurrenceKey,expiresAt,message){
    await assertCurrent(schedule,occurrenceKey);
    const next=nowMsProvider()+60000;
    const state=next<=expiresAt?'retry_pending':'expired';
    const record={schedule,occurrenceKey,state,expiresAt,
      nextRetryAt:state==='retry_pending'?next:null,message};
    await runStatus(schedule.id,record);
    await log({event:state,scheduleId:schedule.id,level:'warning',
      message:state==='retry_pending'?`${message} Another attempt is planned at the next scheduler check.`:`${message} No retry remains within the start window.`,
      nextRetryAt:record.nextRetryAt?new Date(record.nextRetryAt).toISOString():undefined,expiresAt:new Date(expiresAt).toISOString()});
  }
  async function cancelRun(scheduleId,reason='Cancelled by user'){
    // Independent of the alarm queue: cancellation must interrupt a sleeping join.
    const task=cancelQueue.then(async()=>{
      const runs=await loadRecord('automationRuns') || {};
      const pending=await loadRecord(PENDING_RECORDING_KEY);
      const active=await loadRecord(ACTIVE_RECORDING_KEY);
      const schedule=(await currentSchedules()).find(s=>s.id===scheduleId);
      const occurrenceKey=(active?.scheduleId===scheduleId?active.occurrenceKey:null) ||
        (pending?.scheduleId===scheduleId?pending.occurrenceKey:null) ||
        runs[scheduleId]?.occurrenceKey || (schedule?getOccurrenceKey(schedule,nowProvider()):null);
      if(!occurrenceKey)throw Error('No run found to cancel');
      const cancelled=await loadRecord('automationCancelledOccurrences') || [];
      await storeRecord('automationCancelledOccurrences',[...new Set([...cancelled,occurrenceKey])].slice(-1000));
      await runStatus(scheduleId,{...runs[scheduleId],occurrenceKey,state:'cancelled',nextRetryAt:null,message:reason});
      // Invalidate permission to start before sending the asynchronous stop.
      if(pending?.scheduleId===scheduleId)await storeRecord(PENDING_RECORDING_KEY,null);
      await log({event:'run_cancelled',scheduleId,message:reason+'. Pending retries cancelled. Future weekly occurrences remain enabled.'});
      if(active?.scheduleId===scheduleId){
        await storeRecord(ACTIVE_RECORDING_KEY,{...active,cancelRequested:true});
        const reply=await chromeApi.tabs.sendMessage(active.tabId,{type:AUTOMATION_COMMANDS.REQUEST_STOP,reason:'run_cancelled'});
        if(reply?.ok===false)throw Error('Stop delivery failed; cancellation remains saved and stop will retry on the next scheduler check');
        const latest=await loadRecord(ACTIVE_RECORDING_KEY);
        if(latest?.recordingId===active.recordingId)await storeRecord(ACTIVE_RECORDING_KEY,{...latest,stopRequested:true});
        await log({event:'stop_requested',scheduleId,message:'Cancellation requested stop and save. Waiting for save confirmation.'});
      }
      return {ok:true,occurrenceKey};
    });
    cancelQueue=task.catch(()=>{});return task;
  }
  async function schedulesChanged(nextSchedules=null){
    const runs=await loadRecord('automationRuns') || {};
    for(const [id,run] of Object.entries(runs)){
      if(!['joining','retry_pending','starting'].includes(run.state))continue;
      try{
        // Use the actual change event, so a fast disable/re-enable cannot erase
        // the cancellation before this asynchronous listener reads storage.
        if(nextSchedules){
          const next=nextSchedules.find(s=>s.id===id);
          if(!next || next.enabled===false || scheduleFingerprint(next)!==scheduleFingerprint(run.schedule))throw Error('changed');
        }
        await assertCurrent(run.schedule,run.occurrenceKey);
      }
      catch{await cancelRun(id,'Schedule changed, disabled or deleted; old pending attempt stopped');}
    }
  }

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
    if (!active || active.stopRequested) return;

    const coordinator = createRecordingStopCoordinator({
      recordingId: active.recordingId,
      startedAtMs: active.startedAtMs,
      durationMinutes: active.durationMinutes,
      stopRequested: active.stopRequested
    });
    const dueStop = active.cancelRequested?{reason:'run_cancelled'}:coordinator.poll(nowMsProvider());
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
    const latest=await loadRecord(ACTIVE_RECORDING_KEY);
    if(latest?.recordingId===active.recordingId)await storeRecord(ACTIVE_RECORDING_KEY, {...latest,stopRequested:true});
    await log({event:'stop_requested',scheduleId:active.scheduleId,message:active.cancelRequested?'Cancelled run: stop/save requested again. Saving is not yet confirmed.':'Scheduled duration reached. Stop requested; saving is not yet confirmed.'});
  }

  async function dispatchRecording(schedule, now, handled) {
    const occurrenceKey = getOccurrenceKey(schedule, now);
    await assertCurrent(schedule,occurrenceKey);
    const seconds=value=>String(value).split(':').reduce((sum,part)=>sum*60+Number(part),0);
    const elapsed=seconds(now.time.length===5?now.time+':00':now.time)-seconds(schedule.time.length===5?schedule.time+':00':schedule.time);
    const expiresAt=nowMsProvider()+((schedule.launchWindowSeconds ?? 60)-elapsed)*1000;
    await runStatus(schedule.id,{schedule,occurrenceKey,state:'joining',expiresAt});
    await log({event:'run_attempt',scheduleId:schedule.id,message:'Scheduled attempt started. Checking authorization and meeting readiness.',expiresAt:new Date(expiresAt).toISOString()});
    await assertCurrent(schedule,occurrenceKey);
    if(schedule.durationMinutes!=null)validateRecordingDuration(schedule.durationMinutes);
    if(schedule.captureMode==='tab'){
      if(!scheduledTargetProvider)throw Error('Authorized tab capture is unavailable');
      const target=await scheduledTargetProvider(schedule.id,{schedule,occurrenceKey});
      await assertCurrent(schedule,occurrenceKey);
      if(target?.departed){await cancelRun(schedule.id,'Meeting departure detected; automatic rejoining stopped');return null;}
      if(target?.ready===false){
        await storeRecord('automationDiagnostic',{at:new Date(nowMsProvider()).toISOString(),state:'waiting_for_meeting',message:target.reason || 'Waiting for Teams to join within the configured start window'});
        await retryStatus(schedule,occurrenceKey,expiresAt,target.reason || 'Waiting for meeting');
        return null;
      }
    }else if(schedule.targetUrl){
      const remembered=await loadRecord('automationTargetTabs') || {};
      const previous=remembered[schedule.id];
      const target=await prepareTarget(chromeApi.tabs,schedule.targetUrl,previous?.url===schedule.targetUrl?previous.tabId:null);
      if(target.tabId!=null)await storeRecord('automationTargetTabs',{...remembered,[schedule.id]:{url:schedule.targetUrl,tabId:target.tabId}});
      if(!target.ready)throw Error(`Capture target is not ready: ${target.reason}. Login, lobby and meeting admission require user verification.`);
    }
    await assertCurrent(schedule,occurrenceKey);
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
    await assertCurrent(schedule,occurrenceKey);

    // Older schedules without a duration retain their existing behavior.
    if (schedule.durationMinutes != null) {
      validateRecordingDuration(schedule.durationMinutes);
      await storeRecord(PENDING_RECORDING_KEY, {
        scheduleId: schedule.id,
        schedule,
        occurrenceKey,
        durationMinutes: schedule.durationMinutes,
        tabId: tab.id,
        requestedAtMs: nowMsProvider()
      });
    }

    try {
      await assertCurrent(schedule,occurrenceKey);
      await runStatus(schedule.id,{schedule,occurrenceKey,state:'starting',expiresAt});
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
    const active=await loadRecord(ACTIVE_RECORDING_KEY);
    if(active && !active.stopRequested && monitorActive){
      const observed=await monitorActive(active).catch(async error=>{
        await log({event:'meeting_monitor_unavailable',scheduleId:active.scheduleId,level:'warning',message:'Could not check meeting departure this time. Recording is unchanged; the next scheduler poll will check again. '+error.message});
        return null;
      });
      if(observed?.departed)await cancelRun(active.scheduleId,'Meeting departure detected; stopping this run without rejoining');
    }

    const now = nowProvider();
    const currentSchedules = structuredClone(await (schedulesProvider?schedulesProvider():Promise.resolve(schedules)));
    const runs=await loadRecord('automationRuns') || {};
    for(const [id,run] of Object.entries(runs)){
      if(run.state==='retry_pending' && nowMsProvider()>run.expiresAt){
        await runStatus(id,{...run,state:'expired',nextRetryAt:null});
        await log({event:'retry_expired',scheduleId:id,level:'warning',message:'Start window expired. No further attempts for this occurrence.'});
      }
    }
    const handled = await loadHandledOccurrences();
    for(const key of await loadRecord('automationCancelledOccurrences') || [])handled.add(key);
    const due = dueSchedules(currentSchedules, now, {
      handledOccurrenceKeys: handled
    });

    const dispatched = [];

    for (const schedule of due) {
      if(await loadRecord(ACTIVE_RECORDING_KEY)){
        await storeRecord('automationDiagnostic',{at:new Date(nowMsProvider()).toISOString(),state:'blocked',message:'Overlapping schedule deferred: another recording is active. It will expire after its launch window.'});
        await log({event:'overlap_deferred',scheduleId:schedule.id,level:'warning',message:'Another recording is active or saving. This schedule will only retry while its start window remains open.'});
        break;
      }
      const pending=await loadRecord(PENDING_RECORDING_KEY);
      if(pending && nowMsProvider()-(pending.requestedAtMs || 0)<120000)break;
      if(pending)await storeRecord(PENDING_RECORDING_KEY,null);
      let result;
      try{result=await dispatchRecording(schedule,now,handled);}
      catch(error){
        const run=(await loadRecord('automationRuns') || {})[schedule.id];
        if(/cancelled/i.test(error.message)){
          if(run && run.state!=='cancelled')await runStatus(schedule.id,{...run,state:/expired/i.test(error.message)?'expired':'cancelled',nextRetryAt:null,message:error.message});
          await log({event:'attempt_cancelled',scheduleId:schedule.id,message:error.message});
          continue;
        }
        await log({event:'attempt_failed',level:'error',scheduleId:schedule.id,message:error.message});
        if(run?.expiresAt)await retryStatus(schedule,run.occurrenceKey,run.expiresAt,error.message).catch(()=>{});
        throw error;
      }
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
        const cancelled=await loadRecord('automationCancelledOccurrences') || [];
        if(cancelled.includes(command.occurrenceKey)){
          await chromeApi.tabs.sendMessage(sender.tab.id,{type:AUTOMATION_COMMANDS.REQUEST_STOP,reason:'run_cancelled'});
          await log({event:'late_start_stopped',level:'warning',message:'Start acknowledgement arrived after cancellation. Stop/save requested; no retry.'});
          return {ok:false,cancelled:true};
        }
        if (pending &&
            pending.occurrenceKey === command.occurrenceKey &&
            pending.tabId === sender.tab?.id) {
          if(pending.schedule){
            try{await assertCurrent(pending.schedule,pending.occurrenceKey);}
            catch{
              await storeRecord(PENDING_RECORDING_KEY,null);
              await chromeApi.tabs.sendMessage(sender.tab.id,{type:AUTOMATION_COMMANDS.REQUEST_STOP,reason:'schedule_changed'});
              return {ok:false,cancelled:true};
            }
          }
          const startedAtMs = nowMsProvider();
          const deadlineMs = calculateStopDeadline(
            startedAtMs, pending.durationMinutes
          );
          await storeRecord(ACTIVE_RECORDING_KEY, {
            scheduleId:pending.scheduleId,
            schedule:pending.schedule,
            recordingId: command.recordingId,
            occurrenceKey: pending.occurrenceKey,
            tabId: pending.tabId,
            startedAtMs,
            durationMinutes: pending.durationMinutes,
            deadlineMs,
            stopRequested: false
          });
          await storeRecord(PENDING_RECORDING_KEY, null);
          await runStatus(pending.scheduleId,{schedule:pending.schedule,occurrenceKey:pending.occurrenceKey,state:'recording'});
          await log({event:'recording_started',scheduleId:pending.scheduleId,message:'Recording started. Duration is measured from this actual start.'});
        }
        return { ok: true, type: command.type };
      }

      case AUTOMATION_COMMANDS.RECORDING_STOPPED: {
        const active = await loadRecord(ACTIVE_RECORDING_KEY);
        if (active?.recordingId === command.recordingId &&
            active.tabId === sender.tab?.id) {
          await storeRecord(ACTIVE_RECORDING_KEY, null);
          await runStatus(active.scheduleId,{occurrenceKey:active.occurrenceKey,state:'finished'});
          await log({event:'recording_finished',scheduleId:active.scheduleId,message:'Recorder finished its stop/save flow. Check the separate save result in History.'});
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
    handleRuntimeMessage,
    cancelRun,
    schedulesChanged,
    assertCurrent
  };
}
