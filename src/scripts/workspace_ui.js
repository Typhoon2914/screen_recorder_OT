import {safeLogText} from '../automation/activity_log.js';
const $=id=>document.getElementById(id);
const tabs=[...document.querySelectorAll('[role=tab]')];
function select(tab){
  for(const item of tabs){
    const active=item===tab;
    item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;
    $(item.getAttribute('aria-controls')).hidden=!active;
  }
  if(tab.id==='tab-logs' && $('followLogs').checked)$('activityLog').scrollTop=$('activityLog').scrollHeight;
}
for(const tab of tabs){
  tab.onclick=()=>select(tab);
  tab.onkeydown=event=>{
    const index=tabs.indexOf(tab);
    const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
    if(next!==null){event.preventDefault();select(tabs[next]);tabs[next].focus();}
  };
}
const native=$('nativeSettings');native.hidden=false;$('nativeSettingsHost').append(native);
let entries=[];
let scheduleNames={};
const entryText=e=>`${new Date(e.at).toLocaleString()} · ${e.level.toUpperCase()} · ${scheduleNames[e.scheduleId] || e.scheduleId?.slice(0,8) || 'Recorder'} · ${e.message}${e.nextRetryAt?' Next check: '+new Date(e.nextRetryAt).toLocaleTimeString():''}${e.expiresAt?' Retry window ends: '+new Date(e.expiresAt).toLocaleTimeString():''}`;
async function renderLogs(){
  const {automationActivityLog=[]}=await chrome.storage.local.get('automationActivityLog');
  const {automationSchedules=[]}=await chrome.storage.local.get('automationSchedules');
  scheduleNames=Object.fromEntries(automationSchedules.map(s=>[s.id,safeLogText(s.title || s.id)]));
  entries=automationActivityLog.map(e=>({...e,message:safeLogText(e.message),scheduleId:safeLogText(e.scheduleId)}));
  $('activityLog').replaceChildren(...entries.map(e=>{
    const row=document.createElement('li');row.className='log-'+e.level;row.textContent=entryText(e);return row;
  }));
  if(!entries.length){const row=document.createElement('li');row.textContent='No activity yet. Scheduled checks and recording events will appear here.';$('activityLog').append(row);}
  if($('followLogs').checked)$('activityLog').scrollTop=$('activityLog').scrollHeight;
}
$('copyLogs').onclick=async()=>{
  try{await navigator.clipboard.writeText(entries.map(entryText).join('\n'));$('logStatus').textContent='Logs copied.';}
  catch{$('logStatus').textContent='Clipboard unavailable. Use Export logs instead.';}
};
$('exportLogs').onclick=async()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,events:entries},null,2)],{type:'application/json'}));
  try{await chrome.downloads.download({url,filename:'screen-recorder-logs-'+Date.now()+'.json',saveAs:true});$('logStatus').textContent='Log export requested. Check Chrome downloads.';}
  catch(error){$('logStatus').textContent=error.message;}
  finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}
};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && (changes.automationActivityLog || changes.automationSchedules))renderLogs().catch(console.error);});
renderLogs().catch(console.error);
