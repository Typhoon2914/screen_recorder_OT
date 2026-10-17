let busy=false;
async function attempt(stage,targetTabId,trigger){
  if(busy)throw Error('Probe already running');busy=true;
  const result={stage,targetTabId,trigger,at:new Date().toISOString(),before:await chrome.tabCapture.getCapturedTabs()};
  try{
    // Test the retained temporary grant separately from the capture invocation.
    try{
      result.activeTabProbe={allowed:true,result:await chrome.scripting.executeScript({target:{tabId:targetTabId},func:()=>({url:location.href,title:document.title})})};
    }catch(error){result.activeTabProbe={allowed:false,error:error.message};}
    const {consumerTabId}=await chrome.storage.local.get('consumerTabId');
    const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId,consumerTabId});
    result.streamIdIssued=true; // Do not log the opaque capability itself.
    result.capture=await chrome.runtime.sendMessage({type:'PROBE_RECORD',stage,streamId});
  }catch(error){result.error={name:error.name,message:error.message};}
  finally{
    result.after=await chrome.tabCapture.getCapturedTabs();result.finishedAt=new Date().toISOString();
    const {results=[]}=await chrome.storage.local.get('results');await chrome.storage.local.set({results:[...results,result]});busy=false;
  }
}
chrome.action.onClicked.addListener(tab=>{
  (async()=>{
    const {invocations=0}=await chrome.storage.local.get('invocations');
    await chrome.storage.local.set({invocations:invocations+1});
    if(invocations!==0)return;
    await chrome.storage.local.set({authorizedTargetId:tab.id});
    await attempt('initial-user-invocation',tab.id,'real-extension-action');
  })().catch(error=>chrome.storage.local.set({fatal:error.message}));
});
chrome.alarms.onAlarm.addListener(alarm=>{
  if(!alarm.name.startsWith('authorization-probe-'))return;
  (async()=>{
    const {nextAttempt}=await chrome.storage.local.get('nextAttempt');
    await attempt(nextAttempt.stage,nextAttempt.targetTabId,'real-chrome-alarm');
  })().catch(error=>chrome.storage.local.set({fatal:error.message}));
});
