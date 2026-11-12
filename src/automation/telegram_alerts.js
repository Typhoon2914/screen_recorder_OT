import { safeLogText } from './activity_log.js';

export const TELEGRAM_OUTBOX_KEY = 'telegramAlertOutbox';
const RETRY_DELAYS_MS = [60_000, 180_000, 600_000, 1_800_000];

export function validateTelegramConfig(input) {
  const enabled = input?.enabled === true;
  const token = String(input?.token ?? '').trim();
  const chatId = String(input?.chatId ?? '').trim();
  if (enabled || token || chatId) {
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw Error('Invalid Telegram bot token');
    if (!/^-?\d{1,25}$/.test(chatId)) throw Error('Invalid Telegram chat ID');
  }
  return { enabled, token, chatId };
}

export function alertForEvent(entry) {
  if (!entry?.event) return null;
  const descriptions = {
    run_attempt: ['info','Scheduled attempt started'],
    tab_located: ['info','Authorized Teams tab located'],
    teams_meeting_located: ['info','Channel meeting located and opened'],
    teams_prejoin_ready: ['info','Teams pre-join controls detected'],
    teams_join_clicked: ['info','Clicked Join now; waiting for meeting admission'],
    teams_joined: ['info','Joined the verified Teams meeting'],
    recording_started: ['info','Recording started'],
    recording_heartbeat: ['info','Recording still active'],
    capture_stopped: ['info','Recording stopped; processing and save pending'],
    saving: ['info','Saving recording; awaiting download verification'],
    saved: ['info','Recording saved and verified'],
    capture_failed: ['critical','Recording capture failed'],
    save_failed: ['critical','Recording could not be saved'],
    retry_expired: ['critical','Lecture start window expired without a recording'],
    expired: ['critical','Lecture start window expired without a recording'],
    attempt_failed: ['warning','Recording start attempt failed; retry may follow'],
    retry_pending: ['warning','Meeting not ready; automatic retries are active'],
    setup_authorization_failed: ['warning','Capture authorization failed'],
    recorder_tab_closed: ['critical','Recorder tab closed during a scheduled run'],
    overlap_deferred: ['warning','Lecture delayed by another recording'],
    audio_warning: ['warning','Recording audio warning'],
    target_grant_lost: ['warning','Teams capture authorization lost'],
    scheduler_failed: ['critical','Recorder scheduler encountered an error'],
    preflight_attention: ['warning','Teams needs attention before lecture'],
    preflight_refreshed: ['info','Teams tab refreshed before lecture'],
    save_timeout: ['critical','Recording save is overdue'],
    recording_stalled: ['critical','Recording stop/save appears stalled']
  };
  const spec=descriptions[entry.event];
  if(!spec)return null;
  if(!entry.scheduleId && !['setup_authorization_failed','target_grant_lost','scheduler_failed'].includes(entry.event))return null;
  const [severity,title]=spec;
  const label=safeLogText(entry.scheduleName || entry.scheduleId || 'Recorder');
  const details=safeLogText(entry.message || '');
  return {severity,event:entry.event,scheduleId:String(entry.scheduleId||''),occurrenceKey:String(entry.occurrenceKey||''),
    message:(`Screen Recorder · ${severity.toUpperCase()}\n${title}\nLecture: ${label}${details?'\n'+details:''}`).slice(0,1500)};
}

export function createTelegramAlerts({storage,fetchImpl=fetch,now=()=>Date.now()}={}) {
  if(!storage?.get || !storage?.set)throw Error('Storage API required');
  let sequence=Promise.resolve();
  const serial=fn=>{const p=sequence.then(fn);sequence=p.catch(()=>{});return p;};
  const status=result=>storage.set({telegramDeliveryStatus:{at:new Date(now()).toISOString(),...result}});
  const configuration=async()=> (await storage.get('telegramAlerts')).telegramAlerts || {};
  async function send(config,message){
    const response=await fetchImpl(`https://api.telegram.org/bot${config.token}/sendMessage`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:config.chatId,text:message,disable_web_page_preview:true}),
      signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)throw Error(`Telegram API HTTP ${response.status}`);
    if((await response.json()).ok!==true)throw Error('Telegram API rejected message');
  }
  async function enqueue(entry){
    return serial(async()=>{
      const alert=alertForEvent(entry);if(!alert)return false;
      if((await configuration()).enabled!==true)return false;
      const data=await storage.get(['telegramAlertOutbox','telegramAlertDeliveredKeys']);
      const queue=data.telegramAlertOutbox || [],delivered=data.telegramAlertDeliveredKeys || [];
      const windowId=['attempt_failed','audio_warning','overlap_deferred','scheduler_failed'].includes(alert.event)?Math.floor(now()/600000):'once';
      const key=[alert.event,alert.scheduleId,alert.occurrenceKey||Math.floor(now()/3600000),
        alert.event==='recording_heartbeat' ? String(entry.heartbeatNumber || windowId) : windowId].join('|');
      if(delivered.includes(key)||queue.some(x=>x.key===key))return false;
      await storage.set({telegramAlertOutbox:[...queue,{key,alert,tries:0,nextAt:now()}].slice(-80)});
      return true;
    });
  }
  async function flush(){
    return serial(async()=>{
      const config=await configuration();if(config.enabled!==true)return;
      const data=await storage.get(['telegramAlertOutbox','telegramAlertDeliveredKeys']);
      const queue=data.telegramAlertOutbox || [],delivered=new Set(data.telegramAlertDeliveredKeys || []);
      let changed=false;
      for(let i=0;i<queue.length;i++){
        const item=queue[i];if(item.nextAt>now())continue;
        try{
          await send(config,item.alert.message);
          delivered.add(item.key);queue.splice(i--,1);changed=true;
          await status({state:'sent',event:item.alert.event});
        }catch(error){
          item.tries=(item.tries||0)+1;
          item.nextAt=now()+RETRY_DELAYS_MS[Math.min(item.tries-1,RETRY_DELAYS_MS.length-1)];
          if(item.tries>=5){queue.splice(i--,1);await status({state:'failed',message:'Telegram delivery failed after retries: '+safeLogText(error.message)});}
          else await status({state:'retrying',message:safeLogText(error.message)});
          changed=true;
        }
      }
      if(changed)await storage.set({telegramAlertOutbox:queue,telegramAlertDeliveredKeys:[...delivered].slice(-500)});
    });
  }
  async function testConnection(){
    const config=validateTelegramConfig(await configuration());
    if(!config.enabled)throw Error('Enable Telegram alerts before testing');
    try{await send(config,'Screen Recorder: Telegram alerts connected. This is a test message.');
      await status({state:'sent',event:'test'});return {ok:true};}
    catch(error){await status({state:'failed',message:safeLogText(error.message)});throw error;}
  }
  return {enqueue,flush,testConnection,configuration};
}
