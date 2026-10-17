import {loadSchedules,updateSchedules} from '../automation/schedule_store.js';
import {getNextRun} from '../automation/scheduler.js';
const $=id=>document.getElementById(id);
let schedules=[];
const report=error=>{$('scheduleStatus').textContent=error.message || String(error);};
// Keep the primary schedule flow above manual controls; preserve all existing IDs.
const panel=document.querySelector('.schedulePanel');
document.querySelector('.grid').before(panel);
$('scheduleForm').after($('tabAuthorizationSetup'));
async function refreshTeamsTabs(){
  const previous=$('setupTeamsTab').value;
  $('setupTeamsTab').replaceChildren(new Option('Choose the Teams channel tab',''));
  for(const tab of await chrome.tabs.query({})){
    if(/^https:\/\/teams\.(cloud\.microsoft|microsoft\.com)\//.test(tab.url || ''))$('setupTeamsTab').add(new Option(tab.title || 'Teams',String(tab.id)));
  }
  $('setupTeamsTab').value=previous;
}
$('refreshTeamsTabs').onclick=()=>refreshTeamsTabs().catch(report);
$('useTeamsTab').onclick=async()=>{
  try{
    if(!$('setupTeamsTab').value)throw Error('Choose the intended Teams channel tab first');
    const tab=await chrome.tabs.get(Number($('setupTeamsTab').value));
    if(!/^https:\/\/teams\.(cloud\.microsoft|microsoft\.com)\//.test(tab.url || ''))throw Error('Selected tab is no longer Teams');
    $('targetUrl').value=tab.url;$('captureMode').value='tab';
    const parts=(tab.title || '').split(' | ');
    if(parts.length===4 && parts[0]==='Teams and Channels'){$('teamsTeam').value=parts[1];$('teamsChannel').value=parts[2];}
    $('scheduleStatus').textContent='Target selected. Check the exact team/channel names and save the schedule.';
  }catch(error){report(error);}
};
refreshTeamsTabs().catch(report);
async function nativeStatus(){
  const {nativeCompanion,nativeCompanionHealth}=await chrome.storage.local.get(['nativeCompanion','nativeCompanionHealth']);
  $('nativeEnabled').checked=nativeCompanion?.enabled===true;
  $('nativeStatus').textContent=nativeCompanion?.enabled?'Native: '+(nativeCompanionHealth?.phase || 'connecting'):'Native companion disabled';
}
$('nativeSave').onclick=async()=>{
  try{
    const result=await chrome.runtime.sendMessage({type:'SET_NATIVE_COMPANION',enabled:$('nativeEnabled').checked,token:$('nativeToken').value.trim()});
    if(!result?.ok)throw Error(result?.error || 'Native configuration failed');
    $('nativeToken').value='';await nativeStatus();
  }catch(error){$('nativeStatus').textContent=error.message;}
};
$('nativeRefresh').onclick=async()=>{
  const result=await chrome.runtime.sendMessage({type:'REFRESH_NATIVE_COMPANION'});
  if(!result?.ok)$('nativeStatus').textContent=result?.error || 'Native refresh failed';else await nativeStatus();
};
chrome.storage.onChanged.addListener(changes=>{if(changes.nativeCompanion || changes.nativeCompanionHealth)nativeStatus().catch(report);});
nativeStatus().catch(report);
function nowParts(){const d=new Date();return {date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,weekday:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()],time:d.toTimeString().slice(0,8)};}
function button(text,action){const b=document.createElement('button');b.className='btn';b.type='button';b.textContent=text;b.onclick=()=>Promise.resolve().then(action).catch(report);return b;}
async function render(){
  schedules=await loadSchedules(chrome);
  $('scheduleList').replaceChildren();
  const selected=$('armSchedule').value;
  $('armSchedule').replaceChildren(new Option('Select a schedule',''));
  for(const s of schedules){
    if(s.enabled)$('armSchedule').add(new Option(s.title || s.id,s.id));
    const row=document.createElement('div');row.className='scheduleRow';
    const label=document.createElement('span');
    const next=getNextRun([s],nowParts());
    label.textContent=`${s.title || s.id} · ${s.runDate || s.weekdays.join(', ')} ${s.time} · ${s.durationMinutes || 'manual'} min · ${s.enabled?(next?'Next '+next.date+' '+next.time:'No future run'):'Disabled'}`;
    row.append(label,button('Edit',()=>{
      $('scheduleId').value=s.id;$('lectureName').value=s.title || s.id;
      $('weekday').value=s.weekdays[0];$('scheduleTime').value=s.time;
      $('runDate').value=s.runDate || '';
      $('scheduleDuration').value=s.durationMinutes || 60;$('targetUrl').value=s.targetUrl || '';$('scheduleEnabled').checked=s.enabled;
      $('captureMode').value=s.captureMode || 'manual';
      $('teamsAutoJoin').checked=s.teamsAutoJoin===true;$('teamsTeam').value=s.teamsTeam || '';$('teamsChannel').value=s.teamsChannel || 'General';$('joinWaitMinutes').value=s.joinWaitMinutes || 15;
      $('scheduleStatus').textContent=s.weekdays.length>1?'Editing preserves the existing weekdays; changing weekday replaces them.':'';
      $('weekday').dataset.original=s.weekdays[0];
    }),button(s.enabled?'Disable':'Enable',async()=>{
      await updateSchedules(chrome,items=>items.map(item=>item.id===s.id?{...item,enabled:!item.enabled}:item));await render();
    }),button('Delete',async()=>{
      if(!confirm(`Delete schedule “${s.title || s.id}”?`))return;
      await updateSchedules(chrome,items=>items.filter(item=>item.id!==s.id));await render();
    }));
    if(s.targetUrl)row.append(button('Open target',()=>chrome.tabs.create({url:s.targetUrl})));
    $('scheduleList').append(row);
  }
  $('armSchedule').value=selected;
  const {recordingHistory=[]}=await chrome.storage.local.get('recordingHistory');
  const {automationDiagnostic}=await chrome.storage.local.get('automationDiagnostic');
  if(automationDiagnostic)$('automationDiagnostic').textContent=`${automationDiagnostic.at}: ${automationDiagnostic.message}`;
  $('historyList').replaceChildren();
  for(const item of recordingHistory){const p=document.createElement('p');p.textContent=`${item.at} · ${item.state} · ${item.filename} · ${item.bytes} bytes`;$('historyList').append(p);}
}
$('scheduleForm').addEventListener('submit',async event=>{
  event.preventDefault();
  try {
    const id=$('scheduleId').value || crypto.randomUUID();
    const existing=schedules.find(s=>s.id===id);
    const schedule={...existing,id,title:$('lectureName').value.trim(),weekdays:existing && $('weekday').value===$('weekday').dataset.original?existing.weekdays:[$('weekday').value],time:$('scheduleTime').value,durationMinutes:Number($('scheduleDuration').value),targetUrl:$('targetUrl').value.trim(),enabled:$('scheduleEnabled').checked,launchWindowSeconds:120};
    schedule.captureMode=$('captureMode').value;
    if($('runDate').value){schedule.runDate=$('runDate').value;schedule.weekdays=[['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(schedule.runDate+'T00:00:00Z').getUTCDay()]];}else delete schedule.runDate;
    schedule.teamsAutoJoin=$('teamsAutoJoin').checked;
    schedule.teamsTeam=$('teamsTeam').value.trim();schedule.teamsChannel=$('teamsChannel').value.trim();
    schedule.joinWaitMinutes=Number($('joinWaitMinutes').value);
    if(schedule.teamsAutoJoin)schedule.launchWindowSeconds=schedule.joinWaitMinutes*60;
    await updateSchedules(chrome,items=>[...items.filter(s=>s.id!==id),schedule]);
    $('scheduleForm').reset();$('scheduleId').value='';await render();$('scheduleStatus').textContent='Schedule saved';
  }catch(error){report(error);}
});
$('cancelEdit').onclick=()=>{$('scheduleForm').reset();$('scheduleId').value='';};
chrome.storage.onChanged.addListener(()=>render().catch(report));
render().catch(report);
