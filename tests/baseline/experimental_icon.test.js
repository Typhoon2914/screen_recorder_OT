import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeExperimentIcons } from '../../scripts/experimental-icon.mjs';

test('experimental identity generates valid distinct PNG icons without touching source artwork', () => {
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'screen-recorder-lab-icon-'));
  try {
    writeExperimentIcons(output);
    for (const size of [16,32,48,128]) {
      const filename=path.join(output,'icons',`icon${size}.png`);
      const data=fs.readFileSync(filename);
      assert.deepEqual([...data.subarray(0,8)],[137,80,78,71,13,10,26,10]);
      assert.equal(data.readUInt32BE(16),size);
      assert.equal(data.readUInt32BE(20),size);
      assert.ok(data.length>100);
    }
  } finally {
    fs.rmSync(output,{recursive:true,force:true});
  }
});
