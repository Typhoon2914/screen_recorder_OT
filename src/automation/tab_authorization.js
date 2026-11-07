// Grants are session-only hints. Chrome's actual permission and stream-ID call
// are authoritative; a stored record never grants capture permission.
const GRANTS='tabCaptureGrants', INTENT='tabCaptureAuthorizationIntent';
const origin=url=>new URL(url).origin;
const targetIdentity=s=>JSON.stringify([s.captureMode,s.targetUrl,s.teamsAutoJoin===true,s.teamsTeam || '',s.teamsChannel || '']);
const grantKey=id=>'schedule:'+id;
export function createTabAuthorization(chromeApi){
  const {storage,tabs,scripting,tabCapture}=chromeApi;
  const grants=async()=> (await storage.session.get(GRANTS))[GRANTS] || {};
  // The worker owns all grant mutations. Serialize read/modify/write operations
  // so revoking one tab cannot erase an authorization being added for another.
  let mutations=Promise.resolve();
  function mutate(task){const next=mutations.then(task);mutations=next.catch(()=>{});return next;}
  async function schedule(id){
    const list=(await storage.local.get('automationSchedules')).automationSchedules || [];
    const item=list.find(s=>s.id===id);
    if(!item || !item.enabled)throw Error('Schedule missing, disabled or cancelled');
    if(item.captureMode!=='tab' || !item.targetUrl)throw Error('Schedule is not configured for authorized tab capture');
    return item;
  }
  async function revokeStored(tabId,reason='Authorization expired'){
    const records=await grants();let changed=false;
    for(const [key,value] of Object.entries(records))if(value.tabId===tabId){delete records[key];changed=true;}
    if(changed){
      await storage.session.set({[GRANTS]:records});
      await storage.local.set({automationDiagnostic:{at:new Date().toISOString(),state:'needs_authorization',message:reason+'. Reauthorize the target tab.'}});
    }
  }
  const revoke=(...args)=>mutate(()=>revokeStored(...args));
  async function request(scheduleId,tabId){
    const s=await schedule(scheduleId),tab=await tabs.get(tabId);
    if(tab.url!==s.targetUrl || tab.status!=='complete')throw Error('Select the exact loaded target URL before authorizing');
    const pending=(await storage.session.get(INTENT))[INTENT];
    if(pending && pending.expiresAt>Date.now() && pending.scheduleId!==scheduleId){
      const previous=await schedule(pending.scheduleId).catch(()=>null);
      if(previous && targetIdentity(previous)===pending.targetIdentity)throw Error('Another schedule is awaiting its toolbar click. Complete that preparation first, or wait five minutes for it to expire. Existing authorizations are unchanged.');
    }
    await storage.session.set({[INTENT]:{scheduleId,tabId,targetUrl:s.targetUrl,targetIdentity:targetIdentity(s),expiresAt:Date.now()+300000}});
    return {tabId,title:tab.title,url:tab.url};
  }
  async function authorize(tab){
    const intent=(await storage.session.get(INTENT))[INTENT];
    if(!intent)return false;
    if(intent.expiresAt<Date.now()){await storage.session.remove(INTENT);throw Error('Authorization request expired; select the target again');}
    if(tab.id!==intent.tabId || tab.url!==intent.targetUrl)throw Error('Wrong target tab: select the requested tab and invoke the extension there');
    const s=await schedule(intent.scheduleId);
    if(targetIdentity(s)!==intent.targetIdentity)throw Error('Schedule target changed; request authorization again');
    // This succeeds only after the legitimate toolbar invocation grants access.
    await scripting.executeScript({target:{tabId:tab.id},func:()=>({url:location.href,readyState:document.readyState})});
    const record={scheduleId:s.id,targetIdentity:targetIdentity(s),tabId:tab.id,url:tab.url,origin:origin(tab.url),title:tab.title || '',at:new Date().toISOString()};
    await storage.session.set({[GRANTS]:{...await grants(),[grantKey(s.id)]:record}});
    await storage.session.remove(INTENT);
    const {tabCaptureAuthorizationEvents=[]}=await storage.local.get('tabCaptureAuthorizationEvents');
    await storage.local.set({tabCaptureAuthorizationEvents:[...tabCaptureAuthorizationEvents,{at:record.at,tabId:record.tabId}].slice(-100)});
    await storage.local.set({tabCaptureLastAuthorization:record,automationDiagnostic:{at:record.at,state:'authorized',message:'Target authorized for this browser session. Audio/video are checked at each start; silence is not assumed ready.'}});
    return true;
  }
  async function check(scheduleId){
    const s=await schedule(scheduleId),record=(await grants())[grantKey(s.id)];
    if(!record)throw Error('Reauthorization required: no session grant for this schedule target');
    if(record.scheduleId!==s.id || record.targetIdentity!==targetIdentity(s))throw Error('Reauthorization required: this schedule’s team/channel or capture target changed');
    try{
      const tab=await tabs.get(record.tabId);
      if(origin(tab.url)!==record.origin || (tab.pendingUrl && origin(tab.pendingUrl)!==record.origin))throw Error('Target origin changed');
      if(tab.status!=='complete')throw Error('Target is loading');
      const probe=await scripting.executeScript({target:{tabId:record.tabId},func:()=>({url:location.href,readyState:document.readyState})});
      if(origin(probe[0]?.result?.url)!==record.origin || probe[0]?.result?.readyState!=='complete')throw Error('Target document not ready');
      return {...record,title:tab.title || record.title,currentUrl:tab.url,schedule:s,available:true,mediaReadiness:'Checked on every capture; meeting admission is not inferred'};
    }catch(error){
      if(error.message==='Target is loading')throw error;
      // A failed check is conservative: never substitute a newly opened tab.
      await revoke(record.tabId,error.message);
      throw Error('Reauthorization required: '+error.message);
    }
  }
  async function prepare(scheduleId,consumerTabId){
    const record=await check(scheduleId);
    try{
      const streamId=await tabCapture.getMediaStreamId({targetTabId:record.tabId,consumerTabId});
      return {streamId,targetTabId:record.tabId,origin:record.origin};
    }catch(error){await revoke(record.tabId,error.message);throw Error('Reauthorization required: '+error.message);}
  }
  async function status(){
    const list=(await storage.local.get('automationSchedules')).automationSchedules || [];
    return Promise.all(list.filter(s=>s.captureMode==='tab').map(async s=>{
      try{const record=await check(s.id);return {...record,scheduleId:s.id,tabTitle:record.title,title:s.title || s.id};}
      catch(error){return {scheduleId:s.id,title:s.title || s.id,available:false,message:error.message};}
    }));
  }
  return {request:(...args)=>mutate(()=>request(...args)),authorize:(...args)=>mutate(()=>authorize(...args)),check,prepare,status,revoke};
}
