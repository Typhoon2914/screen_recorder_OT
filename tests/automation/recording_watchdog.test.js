import test from 'node:test';
import assert from 'node:assert/strict';
import {detectRecordingStalls} from '../../src/automation/recording_watchdog.js';
const now=Date.parse('2026-11-12T19:00:00Z');
const base={scheduleId:'lecture-a',occurrenceKey:'lecture-a|2026-11-12|20:00'};
const e=(state,seconds)=>({...base,state,at:new Date(now-seconds*1000).toISOString()});
test('warns when saving has no confirmation after three minutes',()=>{
 const warnings=detectRecordingStalls({events:[e('saving',181)],nowMs:now});
 assert.equal(warnings.length,1);
 assert.equal(warnings[0].event,'save_timeout');
});
test('does not warn before timeout or after a completed/failed save',()=>{
 assert.equal(detectRecordingStalls({events:[e('saving',179)],nowMs:now}).length,0);
 assert.equal(detectRecordingStalls({events:[e('saving',240),e('saved',120)],nowMs:now}).length,0);
 assert.equal(detectRecordingStalls({events:[e('saving',240),e('save_failed',120)],nowMs:now}).length,0);
});
test('warns when the active recording is long overdue for stop without a save',()=>{
 const active={...base,deadlineMs:now-181000};
 assert.equal(detectRecordingStalls({active,nowMs:now}).at(0).event,'recording_stalled');
 assert.equal(detectRecordingStalls({active:{...active,deadlineMs:now-170000},nowMs:now}).length,0);
});
test('silence and unchanged frames do not trigger watchdog',()=>{
 assert.equal(detectRecordingStalls({events:[e('audio_warning',240)],nowMs:now}).length,0);
});
