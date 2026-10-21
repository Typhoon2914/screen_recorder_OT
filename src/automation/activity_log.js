// Worker-owned bounded log. Never accept arbitrary event objects or page HTML.
export function safeLogText(value){
  return String(value ?? '').replace(/https?:\/\/[^\s"<>]+/gi,'[URL omitted]')
    .replace(/\bBearer\s+\S+/gi,'Bearer [redacted]')
    .replace(/(?:[A-Z]:\\|\/Users\/)[^\r\n]+/gi,'[path omitted]')
    .replace(/\b(token|password|authorization|secret)\s*[:=]\s*\S+/gi,'$1=[redacted]')
    .slice(0,1200);
}
export function createActivityLog(api,{now=()=>new Date().toISOString()}={}){
  let queue=Promise.resolve();
  return event=>{
    const task=queue.then(async()=>{
      const {automationActivityLog=[]}=await api.storage.local.get('automationActivityLog');
      const entry={at:now(),level:['warning','error'].includes(event.level)?event.level:'info',
        event:safeLogText(event.event),scheduleId:safeLogText(event.scheduleId),
        message:safeLogText(event.message)};
      for(const key of ['nextRetryAt','expiresAt'])if(Number.isFinite(Date.parse(event[key])))entry[key]=event[key];
      await api.storage.local.set({automationActivityLog:[...automationActivityLog,entry].slice(-500)});
      return entry;
    });
    queue=task.catch(()=>{});return task;
  };
}
