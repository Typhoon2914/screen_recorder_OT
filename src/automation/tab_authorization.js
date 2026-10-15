// Grants are session-only hints. Chrome's actual permission and stream-ID call
// are authoritative; a stored record never grants capture permission.
const GRANTS='tabCaptureGrants', INTENT='tabCaptureAuthorizationIntent';
const origin=url=>new URL(url).origin;
export function createTabAuthorization(chromeApi){
  const {storage,tabs,scripting,tabCapture}=chromeApi;
  const grants=async()=> (await storage.session.get(GRANTS))[GRANTS] || {};
  async function schedule(id){
    const list=(await storage.local.get('automationSchedules')).automationSchedules || [];
    const item=list.find(s=>s.id===id);
    if(!item || !item.enabled)throw Error('Schedule missing, disabled or cancelled');
    if(item.captureMode!=='tab' || !item.targetUrl)throw Error('Schedule is not configured for authorized tab capture');
    return item;
  }
  async function revoke(tabId,reason='Authorization expired'){
    const records=await grants();let changed=false;
    for(const [key,value] of Object.entries(records))if(value.tabId===tabId){delete records[key];changed=true;}
    if(changed){
      await storage.session.set({[GRANTS]:records});
      await storage.local.set({automationDiagnostic:{at:new Date().toISOString(),state:'needs_authorization',message:reason+'. Reauthorize the target tab.'}});
    }
  }
  async function request(scheduleId,tabId){
    const s=await schedule(scheduleId),tab=await tabs.get(tabId);
    if(tab.url!==s.targetUrl || tab.status!=='complete')throw Error('Select the exact loaded target URL before authorizing');
    await storage.session.set({[INTENT]:{scheduleId,tabId,targetUrl:s.targetUrl,expiresAt:Date.now()+300000}});
    return {tabId,title:tab.title,url:tab.url};
  }
  async function authorize(tab){
    const intent=(await storage.session.get(INTENT))[INTENT];
    if(!intent)return false;
    if(intent.expiresAt<Date.now()){await storage.session.remove(INTENT);throw Error('Authorization request expired; select the target again');}
    if(tab.id!==intent.tabId || tab.url!==intent.targetUrl)throw Error('Wrong target tab: select the requested tab and invoke the extension there');
    const s=await schedule(intent.scheduleId);
    if(s.targetUrl!==intent.targetUrl)throw Error('Schedule target changed; request authorization again');
    // This succeeds only after the legitimate toolbar invocation grants access.
    await scripting.executeScript({target:{tabId:tab.id},func:()=>({url:location.href,readyState:document.readyState})});
    const record={tabId:tab.id,url:tab.url,origin:origin(tab.url),title:tab.title || '',at:new Date().toISOString()};
    await storage.session.set({[GRANTS]:{...await grants(),[s.targetUrl]:record}});
    await storage.session.remove(INTENT);
    const {tabCaptureAuthorizationEvents=[]}=await storage.local.get('tabCaptureAuthorizationEvents');
    await storage.local.set({tabCaptureAuthorizationEvents:[...tabCaptureAuthorizationEvents,{at:record.at,tabId:record.tabId}].slice(-100)});
    await storage.local.set({tabCaptureLastAuthorization:record,automationDiagnostic:{at:record.at,state:'authorized',message:'Target authorized for this browser session. Audio/video are checked at each start; silence is not assumed ready.'}});
    return true;
  }
  async function check(scheduleId){
    const s=await schedule(scheduleId),record=(await grants())[s.targetUrl];
    if(!record)throw Error('Reauthorization required: no session grant for this schedule target');
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
  return {request,authorize,check,prepare,status,revoke};
}
