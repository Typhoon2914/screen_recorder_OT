import {loadSchedules,updateSchedules} from '../automation/schedule_store.js';
import {getNextRun} from '../automation/scheduler.js';
const $=id=>document.getElementById(id);
let schedules=[];
const report=error=>{$('scheduleStatus').textContent=error.message || String(error);};
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
    label.textContent=`${s.title || s.id} · ${s.weekdays.join(', ')} ${s.time} · ${s.durationMinutes || 'manual'} min · ${s.enabled?'Next '+next.date+' '+next.time:'Disabled'}`;
    row.append(label,button('Edit',()=>{
      $('scheduleId').value=s.id;$('lectureName').value=s.title || s.id;
      $('weekday').value=s.weekdays[0];$('scheduleTime').value=s.time;
      $('scheduleDuration').value=s.durationMinutes || 60;$('targetUrl').value=s.targetUrl || '';$('scheduleEnabled').checked=s.enabled;
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
    await updateSchedules(chrome,items=>[...items.filter(s=>s.id!==id),schedule]);
    $('scheduleForm').reset();$('scheduleId').value='';await render();$('scheduleStatus').textContent='Schedule saved';
  }catch(error){report(error);}
});
$('cancelEdit').onclick=()=>{$('scheduleForm').reset();$('scheduleId').value='';};
chrome.storage.onChanged.addListener(()=>render().catch(report));
render().catch(report);
