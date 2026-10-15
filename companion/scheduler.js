import {validateScheduleList} from '../src/automation/schedule_store.js';
import {dueSchedules,getOccurrenceKey} from '../src/automation/scheduler.js';
import {validateRecordingDuration} from '../src/automation/recording_duration.js';
import {randomUUID} from 'node:crypto';
function validate(schedules){
  validateScheduleList(schedules);
  if(schedules.length>100)throw Error('At most 100 native schedules are supported');
  for(const schedule of schedules)validateRecordingDuration(schedule.durationMinutes);
  return structuredClone(schedules);
}
export async function createNativeScheduler({load,persist,record,now=()=>new Date()}){
  let state=await load() || {schedules:[],handled:[],history:[]};
  validate(state.schedules);
  if(!Array.isArray(state.handled)||!Array.isArray(state.history))throw Error('Corrupt native state');
  state.phase=state.active?'recovery_required':'idle';
  let busy=false,writes=Promise.resolve();
  const save=()=>{const snapshot=structuredClone(state);const next=writes.then(()=>persist(snapshot));writes=next.catch(()=>{});return next;};
  return {
    snapshot:()=>structuredClone(state),
    async sync(schedules){state.schedules=validate(schedules);await save();},
    async tick(){
      if(busy || state.active)return;
      busy=true;
      try{
        const date=now();
        const parts={date:[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-'),weekday:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getDay()],time:date.toTimeString().slice(0,8)};
        const due=dueSchedules(state.schedules.filter(s=>s.enabled),parts,{handledOccurrenceKeys:new Set(state.handled)});
        if(!due.length)return;
        const schedule=due[0],occurrenceKey=getOccurrenceKey(schedule,parts);
        const job={id:randomUUID(),schedule,occurrenceKey,at:date.toISOString(),state:'starting'};
        state.handled=[...state.handled,occurrenceKey].slice(-1000);
        state.active=job;state.phase='recording';
        await save(); // Persist intent before any external recording side effect.
        try{
          const result=await record(job);
          if(result?.verified!==true || !(result.bytes>0) || !result.file)throw Error('Native output has not been verified');
          state.history=[{...job,...result,state:'saved',completedAt:now().toISOString()},...state.history].slice(0,100);
          state.active=null;state.phase='idle';await save();
        }catch(error){
          state.active={...job,state:'failed',message:error.message};state.phase='recovery_required';
          state.history=[state.active,...state.history].slice(0,100);await save();
        }
      }finally{busy=false;}
    }
  };
}
