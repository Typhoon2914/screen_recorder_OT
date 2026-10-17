const $=id=>document.getElementById(id);
let refreshing=false;
async function send(type,data={}){
  const result=await chrome.runtime.sendMessage({type,...data});
  if(!result?.ok)throw Error(result?.error || 'Authorization request failed');
  return result;
}
async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
    const {automationSchedules=[]}=await chrome.storage.local.get('automationSchedules');
    const selected=$('authorizationSchedule').value;
    $('authorizationSchedule').replaceChildren(new Option('Select a tab-capture schedule',''));
    for(const s of automationSchedules.filter(s=>s.captureMode==='tab'&&s.enabled))$('authorizationSchedule').add(new Option(s.title || s.id,s.id));
    $('authorizationSchedule').value=selected;
    const s=automationSchedules.find(s=>s.id===$('authorizationSchedule').value);
    const previous=$('authorizationTarget').value;
    $('authorizationTarget').replaceChildren(new Option('Select the exact existing target tab',''));
    for(const tab of await chrome.tabs.query({})){
      if(s && tab.url===s.targetUrl)$('authorizationTarget').add(new Option(`Tab ${tab.id}: ${tab.title} — ${tab.url}`,String(tab.id)));
    }
    $('authorizationTarget').value=previous;
    const result=await send('TAB_CAPTURE_STATUS');
    $('authorizationList').replaceChildren();
    for(const item of result.items){
      const row=document.createElement('p');
      row.textContent=item.available
        ?`${item.title}: session authorization present — tab ${item.tabId}, ${item.currentUrl}. Unattended start eligible; audio/video checked at start.`
        :`${item.title}: UNATTENDED UNAVAILABLE — ${item.message}`;
      if(item.available){
        const clear=document.createElement('button');clear.type='button';clear.className='btn';clear.textContent='Revoke this tab';
        clear.onclick=()=>send('TAB_CAPTURE_FORGET',{targetTabId:item.tabId}).then(refresh).catch(showError);
        row.append(clear);
      }
      $('authorizationList').append(row);
    }
  }catch(error){showError(error);}finally{refreshing=false;}
}
function showError(error){$('authorizationStatus').textContent=error.message;}
$('authorizationSchedule').onchange=refresh;
$('authorizationRefresh').onclick=refresh;
$('authorizeTarget').onclick=async()=>{
  try{
    if(!$('authorizationReady').checked)throw Error('Confirm that this is the correct Teams channel/tab before authorization');
    const targetTabId=Number($('authorizationTarget').value);
    if(!targetTabId)throw Error('Select an exact target tab; no automatic substitution is allowed');
    $('authorizationStatus').textContent='Next: with the target tab selected, click Chrome Extensions → Screen Recorder EXPERIMENT once. This authorizes that tab for this browser session.';
    await send('TAB_CAPTURE_REQUEST_AUTH',{scheduleId:$('authorizationSchedule').value,targetTabId});
  }catch(error){showError(error);}
};
chrome.storage.onChanged.addListener((changes,area)=>{
  if((area==='session'&&changes.tabCaptureGrants)||(area==='local'&&(changes.automationSchedules||changes.tabCaptureLastAuthorization)))refresh();
});
setInterval(refresh,15000);
refresh();
