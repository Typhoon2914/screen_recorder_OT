import test from 'node:test';
import assert from 'node:assert/strict';
import {recorderOptions} from '../../src/automation/recording_options.js';
test('recording quality presets bound encoding rates without changing codecs',()=>{
  for(const [quality,rate] of [['economy',1000000],['standard',2500000],['high',5000000]])assert.deepEqual(recorderOptions('video/webm',quality),{mimeType:'video/webm',videoBitsPerSecond:rate,audioBitsPerSecond:128000});
});
test('unknown quality is rejected rather than silently changing encoder settings',()=>assert.throws(()=>recorderOptions('video/webm','invalid')));
