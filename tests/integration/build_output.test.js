import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import config from '../../vite.config.js';

test('build copy plugins honor the resolved output directory without writing live dist',t=>{
 const targets=[];
 t.mock.method(fs,'mkdirSync',target=>{targets.push(target);});
 t.mock.method(fs,'copyFileSync',(_source,target)=>{targets.push(target);});
 t.mock.method(fs,'cpSync',(_source,target)=>{targets.push(target);});
 const root=path.resolve('src');
 for(const outDir of ['../.test-artifacts/build-output-unit/dist',path.resolve('.test-artifacts/build-output-unit/absolute')]){
  targets.length=0;
  for(const plugin of config.plugins){
   assert.equal(typeof plugin.configResolved,'function');
   plugin.configResolved({root,build:{outDir}});
   plugin.closeBundle();
  }
  const expected=path.resolve(root,outDir);
  assert.ok(targets.some(target=>target===path.join(expected,'automation')));
  assert.ok(targets.some(target=>target===path.join(expected,'ffmpeg','ffmpeg-core.wasm')));
  assert.ok(targets.every(target=>target.startsWith(expected+path.sep)));
 }
});
