import {loadSchedules,updateSchedules} from '../automation/schedule_store.js';
import {getNextRun} from '../automation/scheduler.js';
const $=id=>document.getElementById(id);
let schedules=[];
const report=error=>{$('scheduleStatus').textContent=error.message || String(error);};
$('scheduleEditor').after($('tabAuthorizationSetup'));
function repeatFields(){
  const once=$('repeatMode').value==='once';
  $('dateField').hidden=!once;$('runDate').required=once;
  $('weekdayField').hidden=once;
}
function channelSummary(){
  $('selectedChannelSummary').textContent=$('teamsTeam').value
    ?`${$('teamsTeam').value} → ${$('teamsChannel').value}`:'Choose a Teams channel tab, then Use this tab.';
}
function resetForm(){
  $('scheduleForm').reset();$('scheduleId').value='';
  $('runDate').value=nowParts().date;delete $('weekday').dataset.original;
  repeatFields();channelSummary();
}
$('repeatMode').onchange=repeatFields;
$('captureMode').onchange=()=>{if($('captureMode').value==='manual')$('teamsAutoJoin').checked=false;};
$('teamsTeam').oninput=channelSummary;$('teamsChannel').oninput=channelSummary;
$('newSchedule').onclick=()=>{resetForm();$('scheduleEditor').open=true;};
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
    channelSummary();
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
  const {automationRuns={}}=await chrome.storage.local.get('automationRuns');
  for(const s of schedules){
    if(s.enabled)$('armSchedule').add(new Option(s.title || s.id,s.id));
    const row=document.createElement('div');row.className='scheduleRow';
    const label=document.createElement('div');label.className='scheduleSummary';
    const next=getNextRun([s],nowParts());
    const title=document.createElement('strong');title.textContent=s.title || s.id;
    const timing=document.createElement('span');timing.textContent=`${s.runDate?'Once · '+s.runDate:'Weekly · '+s.weekdays.join(', ')} ${s.time} · ${s.durationMinutes || 'manual'} min`;
    const status=document.createElement('small');
    const run=automationRuns[s.id];
    status.textContent=`${s.teamsTeam || 'Manual target'} → ${s.teamsChannel || ''} · ${s.enabled?(next?'Next '+next.date+' '+next.time:'No future run'):'Disabled'}${run?' · Last run: '+run.state.replaceAll('_',' '):''}`;
    label.append(title,timing,status);
    row.append(label,button('Edit',()=>{
      $('scheduleId').value=s.id;$('lectureName').value=s.title || s.id;
      $('weekday').value=s.weekdays[0];$('scheduleTime').value=s.time;
      $('runDate').value=s.runDate || '';
      $('repeatMode').value=s.runDate?'once':'weekly';repeatFields();
      $('scheduleDuration').value=s.durationMinutes || 60;$('targetUrl').value=s.targetUrl || '';$('scheduleEnabled').checked=s.enabled;
      $('captureMode').value=s.captureMode || 'manual';
      $('teamsAutoJoin').checked=s.teamsAutoJoin===true;$('teamsTeam').value=s.teamsTeam || '';$('teamsChannel').value=s.teamsChannel || 'General';$('joinWaitMinutes').value=s.joinWaitMinutes || 15;
      $('scheduleStatus').textContent=s.weekdays.length>1?'Editing preserves the existing weekdays; changing weekday replaces them.':'';
      $('weekday').dataset.original=s.weekdays[0];
      channelSummary();$('scheduleEditor').open=true;
    }),button(s.enabled?'Disable':'Enable',async()=>{
      await updateSchedules(chrome,items=>items.map(item=>item.id===s.id?{...item,enabled:!item.enabled}:item));await render();
    }),button('Delete',async()=>{
      if(!confirm(`Delete schedule “${s.title || s.id}”?`))return;
      await updateSchedules(chrome,items=>items.filter(item=>item.id!==s.id));await render();
    }));
    if(s.captureMode==='tab')row.append(button('Prepare recording',async()=>{
      $('tabAuthorizationSetup').open=true;
      document.dispatchEvent(new CustomEvent('prepare-schedule',{detail:{scheduleId:s.id}}));
      $('tabAuthorizationSetup').scrollIntoView({block:'nearest'});
    }));
    if(['joining','retry_pending','starting','recording'].includes(run?.state))row.append(button('Cancel this run',async()=>{
      if(run?.state==='recording' && !confirm('Stop and save this recording, and cancel retries for this run?'))return;
      const result=await chrome.runtime.sendMessage({type:'AUTOMATION_CANCEL_RUN',scheduleId:s.id});
      if(!result?.ok)throw Error(result?.error || 'Cancellation failed');
      $('scheduleStatus').textContent='This occurrence is cancelled. Future weekly occurrences remain enabled.';
      await render();
    }));
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
    if($('repeatMode').value==='once'){
      if(!$('runDate').value)throw Error('Choose a date for a one-off recording');
      schedule.runDate=$('runDate').value;schedule.weekdays=[['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(schedule.runDate+'T00:00:00Z').getUTCDay()]];
    }else delete schedule.runDate;
    schedule.teamsAutoJoin=$('teamsAutoJoin').checked;
    schedule.teamsTeam=$('teamsTeam').value.trim();schedule.teamsChannel=$('teamsChannel').value.trim();
    schedule.joinWaitMinutes=Number($('joinWaitMinutes').value);
    if(schedule.teamsAutoJoin)schedule.launchWindowSeconds=schedule.joinWaitMinutes*60;
    await updateSchedules(chrome,items=>[...items.filter(s=>s.id!==id),schedule]);
    resetForm();$('scheduleEditor').open=false;await render();$('scheduleStatus').textContent='Schedule saved. Use Prepare recording to authorize/check its Teams tab.';
  }catch(error){report(error);}
});
$('cancelEdit').onclick=()=>{resetForm();$('scheduleEditor').open=false;};
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local' && ['automationSchedules','automationRuns','recordingHistory','automationDiagnostic'].some(key=>changes[key]))render().catch(report);
});
resetForm();
render().catch(report);
