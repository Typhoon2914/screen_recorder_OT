import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const out=path.resolve('.test-artifacts',`verification-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await fs.mkdir(out,{recursive:true});
const runs=[];
for(const args of [['--test'],['node_modules/vite/bin/vite.js','build']]){
  const result=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:10*1024*1024});
  const name=args[0]==='--test'?'tests':'build';
  await fs.writeFile(path.join(out,`${name}.txt`),(result.stdout || '')+(result.stderr || ''));
  runs.push({name,exitCode:result.status,error:result.error?.message});
}
const manifest=JSON.parse(await fs.readFile('dist/manifest.json','utf8'));
if(manifest.manifest_version!==3 || manifest.background.type!=='module')throw Error('Invalid manifest contract');
for(const permission of ['downloads','tabs','alarms','storage','activeTab','tabCapture','scripting'])if(!manifest.permissions.includes(permission))throw Error(`Missing permission ${permission}`);
for(const file of ['service_worker.js','automation/tab_authorization.js','automation/tab_capture.js','automation/native_client.js','automation/chrome_controller.js','automation/recording_duration.js','automation/recording_safety.js','automation/recording_options.js','automation/schedule_store.js','automation/scheduler.js','automation/commands.js','automation/recorder_bridge.js','automation/target_readiness.js']){
  const result=spawnSync(process.execPath,['--check',path.join('dist',file)],{encoding:'utf8'});
  runs.push({name:`syntax ${file}`,exitCode:result.status,error:result.stderr || undefined});
}
for(const file of ['ffmpeg/ffmpeg-core.js','ffmpeg/ffmpeg-core.wasm','pages/recorder.html','icons/icon48.png']){
  const stat=await fs.stat(path.join('dist',file));if(!stat.size)throw Error(`Empty artifact ${file}`);
}
const git={};
for(const [key,args] of Object.entries({branch:['branch','--show-current'],head:['rev-parse','HEAD'],status:['status','--short']})){
  const result=spawnSync('git',args,{encoding:'utf8'});
  git[key]={exitCode:result.status,output:result.stdout,error:result.stderr || undefined};
}
await fs.writeFile(path.join(out,'results.json'),JSON.stringify({runs,manifest,git},null,2));
console.log(JSON.stringify({out,runs},null,2));
if(runs.some(run=>run.exitCode!==0))process.exitCode=1;
