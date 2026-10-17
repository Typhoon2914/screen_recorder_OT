// Run only after approval and signature verification of the official OBS ZIP.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const root=path.resolve('.test-artifacts/obs-portable/app');
await fs.access(path.join(root,'bin/64bit/obs64.exe'));
const config=path.join(root,'config/obs-studio');
// Never write an existing OBS configuration or normal user profile.
try{await fs.access(config);throw Error('OBS config already exists; refusing overwrite');}
catch(error){if(error.code!=='ENOENT')throw error;}
const output=path.resolve('.test-artifacts/native-recordings');
await fs.mkdir(output,{recursive:true});
await fs.mkdir(path.join(config,'basic/profiles/ScreenRecorderExperiment'),{recursive:true});
await fs.mkdir(path.join(config,'plugin_config/obs-websocket'),{recursive:true});
await fs.mkdir(path.join(config,'basic/scenes'),{recursive:true});
const password=randomBytes(32).toString('hex');
await fs.writeFile(path.join(root,'portable_mode.txt'),'');
await fs.writeFile(path.join(config,'global.ini'),'[General]\nFirstRun=true\nEnableAutoUpdates=false\n\n[Basic]\nProfile=ScreenRecorderExperiment\nProfileDir=ScreenRecorderExperiment\nSceneCollection=ScreenRecorderExperiment\nSceneCollectionFile=ScreenRecorderExperiment\n\n[BasicWindow]\nWarnBeforeStartingStream=true\n');
await fs.writeFile(path.join(config,'basic/profiles/ScreenRecorderExperiment/basic.ini'),'[General]\nName=ScreenRecorderExperiment\n\n[Output]\nMode=Simple\nFilenameFormatting=%CCYY-%MM-%DD_%hh-%mm-%ss\n\n[SimpleOutput]\nFilePath='+output.replaceAll('\\','/')+'\nRecFormat2=hybrid_mp4\nRecQuality=Small\nRecEncoder=x264\nVBitrate=2500\nABitrate=128\n\n[Video]\nBaseCX=1280\nBaseCY=720\nOutputCX=1280\nOutputCY=720\nFPSType=0\nFPSCommon=30\n\n[Audio]\nSampleRate=48000\nChannelSetup=Stereo\n');
await fs.writeFile(path.join(config,'basic/scenes/ScreenRecorderExperiment.json'),JSON.stringify({name:'ScreenRecorderExperiment',current_scene:'SyntheticLecture',current_program_scene:'SyntheticLecture',scene_order:[{name:'SyntheticLecture'}],sources:[{name:'SyntheticLecture',id:'scene',settings:{items:[]}}],groups:[]},null,2));
await fs.writeFile(path.join(config,'plugin_config/obs-websocket/config.json'),JSON.stringify({server_enabled:true,server_port:4457,auth_required:true,server_password:password,alerts_enabled:false,first_load:false},null,2));
const secrets=path.resolve('.test-artifacts/obs-connection.json');
await fs.writeFile(secrets,JSON.stringify({endpoint:'ws://127.0.0.1:4457',password,outputRoot:output,expectedScene:'SyntheticLecture',portableRoot:root},null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({portableRoot:root,outputRoot:output,connectionFile:secrets,passwordPrinted:false}));
