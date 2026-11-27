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
let visibleEntries=[];
const sessionFilter=$('logSessionFilter');
sessionFilter.addEventListener('change',()=>renderVisibleLogs());
const entryText=e=>`${new Date(e.at).toLocaleString()} · ${e.level.toUpperCase()} · ${scheduleNames[e.scheduleId] || e.scheduleId?.slice(0,8) || 'Recorder'} · ${e.message}${e.nextRetryAt?' Next check: '+new Date(e.nextRetryAt).toLocaleTimeString():''}${e.expiresAt?' Retry window ends: '+new Date(e.expiresAt).toLocaleTimeString():''}`;
function renderVisibleLogs(){
  const selected=sessionFilter.value;
  const latest=[...entries].reverse().find(e=>e.sessionId)?.sessionId;
  visibleEntries=selected==='all'?entries:entries.filter(e=>e.sessionId===(selected==='latest'?latest:selected));
  $('activityLog').replaceChildren(...visibleEntries.map(e=>{
    const row=document.createElement('li');row.className='log-'+e.level;row.textContent=entryText(e);return row;
  }));
  if(!visibleEntries.length){const row=document.createElement('li');row.textContent='No events in this recording.';$('activityLog').append(row);}
  if($('followLogs').checked)$('activityLog').scrollTop=$('activityLog').scrollHeight;
}
async function renderLogs(){
  const {automationActivityLog=[]}=await chrome.storage.local.get('automationActivityLog');
  const {automationSchedules=[]}=await chrome.storage.local.get('automationSchedules');
  scheduleNames=Object.fromEntries(automationSchedules.map(s=>[s.id,safeLogText(s.title || s.id)]));
  entries=automationActivityLog.map(e=>({...e,message:safeLogText(e.message),scheduleId:safeLogText(e.scheduleId),sessionId:safeLogText(e.sessionId),title:safeLogText(e.title)}));
  const old=sessionFilter.value;
  const sessions=new Map();
  for(const e of entries){
    if(e.sessionId && !sessions.has(e.sessionId))sessions.set(e.sessionId,{title:e.title || scheduleNames[e.scheduleId] || 'Recording',at:e.at});
  }
  sessionFilter.replaceChildren(new Option('Latest recording','latest'),new Option('All activity','all'));
  for(const [id,meta] of [...sessions].reverse()){
    sessionFilter.add(new Option(meta.title+' · '+new Date(meta.at).toLocaleString(),id));
  }
  sessionFilter.value=[...sessions.keys()].includes(old)?old:(old==='all'?'all':'latest');
  renderVisibleLogs();
}
$('copyLogs').onclick=async()=>{
  try{await navigator.clipboard.writeText(visibleEntries.map(entryText).join('\n'));$('logStatus').textContent='Logs copied.';}
  catch{$('logStatus').textContent='Clipboard unavailable. Use Export logs instead.';}
};
$('exportLogs').onclick=async()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify({version:2,events:visibleEntries},null,2)],{type:'application/json'}));
  try{await chrome.downloads.download({url,filename:'screen-recorder-logs-'+Date.now()+'.json',saveAs:true});$('logStatus').textContent='Log export requested. Check Chrome downloads.';}
  catch(error){$('logStatus').textContent=error.message;}
  finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}
};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && (changes.automationActivityLog || changes.automationSchedules))renderLogs().catch(console.error);});
renderLogs().catch(console.error);
