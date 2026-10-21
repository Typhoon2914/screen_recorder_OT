// Narrow Teams adapter: no credentials, permission dialogs, meeting creation,
// arbitrary tab selection, or authentication/lobby bypass. Uses activeTab access.
export const TEAMS_ORIGINS=['https://teams.cloud.microsoft','https://teams.microsoft.com'];
import {assertRunCurrent} from './run_state.js';
export function teamsJoinPageStep({team,channel,phase,inspectOnly=false,detectDeparture=false}){
  // Normalize rendering whitespace, not case or punctuation: different teams
  // must never be accepted just because their names are similar.
  const normalize=value=>String(value || '').replace(/\s+/gu,' ').trim();
  team=normalize(team);channel=normalize(channel);
  const visible=e=>e && e.getClientRects().length>0;
  const buttons=[...document.querySelectorAll('button')].filter(visible);
  const label=e=>(e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim();
  const checked=e=>e instanceof HTMLInputElement?e.checked:(e.getAttribute('aria-checked')==='true'?true:e.getAttribute('aria-checked')==='false'?false:null);
  const exact=name=>buttons.filter(e=>label(e)===name);
  const clickOne=(items)=>{if(items.length!==1 || items[0].disabled || items[0].getAttribute('aria-disabled')==='true')return false;items[0].click();return true;};
  if(exact('Leave').length===1){
    return ['joining','joined'].includes(phase)
      ?{state:'joined',ready:!inspectOnly,reason:'Joined through verified channel flow'}
      :{state:'blocked',reason:'Already in an unverified meeting. Leave it and return to the configured channel before setup.'};
  }
  // A previously verified meeting disappeared. Never click Join again for this
  // occurrence; this may be a deliberate departure or a disconnected meeting.
  const departureCandidate=detectDeparture && phase==='joined';
  const departed=()=>({state:'departed',ready:false,reason:'Meeting departure detected. This run will not rejoin automatically.'});
  const joinNow=exact('Join now');
  if(joinNow.length){
    if(departureCandidate)return departed();
    if(!['prejoin','joining'].includes(phase))return {state:'blocked',reason:'Unverified prejoin page; return to the configured channel'};
    if(inspectOnly)return {state:'prejoin',ready:false,reason:'Prejoin page detected. Read-only check did not click Join or change microphone/camera.'};
    const switches=[...document.querySelectorAll('[role="switch"]')].filter(visible);
    const camera=switches.filter(e=>/camera/i.test(label(e)));
    const mic=switches.filter(e=>/\bmic\b|microphone/i.test(label(e)));
    if(camera.length!==1 || mic.length!==1)return {state:'prejoin',reason:'Waiting for microphone and camera controls; browser permissions require a person'};
    for(const control of [camera[0],mic[0]]){
      if(checked(control)===true){control.click();return {state:'prejoin',reason:'Turning off microphone/camera before joining'};}
      if(checked(control)!==false)return {state:'blocked',reason:'Cannot verify microphone/camera are off'};
    }
    const audio=[...document.querySelectorAll('[role="radio"],input[type="radio"]')].filter(e=>visible(e)&&/Computer audio/i.test(label(e)));
    if(audio.length!==1 || checked(audio[0])!==true)return {state:'prejoin',reason:'Select Computer audio once; audio configuration needs user setup'};
    if(clickOne(joinNow))return {state:'joining',reason:'Join clicked with microphone and camera off'};
    return {state:'prejoin',reason:'Join button unavailable'};
  }
  const back=exact('Back to All teams');
  const header=back.length===1?(back[0].parentElement?.parentElement?.innerText || '').split('\n').map(normalize):[];
  // Teams can put the selection marker on the row, its link, or its label.
  // Require selection evidence; appearing in the list/title alone is not enough.
  const channelLabels=[...document.querySelectorAll('[data-tid^="channel-list-item-text-"]')].filter(visible);
  let selectedStyleSelectors;
  function hasTeamsSelectedStyle(row){
    // Observed Teams markup reports aria-selected=false even on the displayed
    // channel. Its matched atomic CSS rule uses this explicit selection token.
    // Do not depend on generated class names, hover/focus colors, or color alone.
    if(row.tagName!=='A' || row.getAttribute('data-is-focusable')!=='true' ||
       !row.querySelector('[data-tid="channel-list-item"]'))return false;
    if(!selectedStyleSelectors){
      selectedStyleSelectors=[];
      const scan=rules=>{
        for(const rule of rules){
          if(rule.selectorText && /^\.[\w-]+$/.test(rule.selectorText) &&
             /^var\(\s*--colorNeutralBackground4Selected\s*\)$/.test(rule.style?.getPropertyValue('background-color').trim() || '')){
            selectedStyleSelectors.push(rule.selectorText);
          }else if(rule.type===4 && matchMedia(rule.conditionText).matches){
            scan(rule.cssRules);
          }else if(rule.type===12 && CSS.supports(rule.conditionText)){
            scan(rule.cssRules);
          }else if(rule.constructor?.name==='CSSLayerBlockRule'){
            scan(rule.cssRules);
          }
        }
      };
      for(const sheet of document.styleSheets){
        if(sheet.disabled || (sheet.media.mediaText && !matchMedia(sheet.media.mediaText).matches))continue;
        try{scan(sheet.cssRules);}catch{/* Inaccessible CSS is not selection evidence. */}
      }
    }
    if(!selectedStyleSelectors.some(selector=>row.matches(selector)))return false;
    const style=getComputedStyle(row);
    const token=style.getPropertyValue('--colorNeutralBackground4Selected').trim();
    if(style.backgroundImage!=='none' || !token || !CSS.supports('color',token))return false;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d');
    if(!ctx)return false;
    const pixel=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
    const expected=pixel(token),actual=pixel(style.backgroundColor);
    return expected[3]===255 && expected.every((value,i)=>value===actual[i]);
  }
  const isSelected=e=>{
    const marker=e.closest('[aria-selected],[aria-current]');
    if(!marker || !visible(marker))return false;
    if(marker.getAttribute('aria-selected')==='true' || ['page','true'].includes(marker.getAttribute('aria-current')))return true;
    const row=e.closest('[role="treeitem"]');
    return marker===row && row.getAttribute('aria-selected')==='false' && hasTeamsSelectedStyle(row);
  };
  const selected=channelLabels.filter(isSelected).map(e=>normalize(e.textContent));
  // An accessible tree row may itself carry the channel name instead of a
  // separately marked label. Do not infer it from arbitrary descendant text.
  for(const row of document.querySelectorAll('[role="treeitem"][aria-selected="true"],[role="treeitem"][aria-current="page"],[role="treeitem"][aria-current="true"]')){
    if(visible(row) && !row.matches('[data-tid^="channel-list-item-text-"]') &&
       !row.querySelector('[data-tid^="channel-list-item-text-"]')){
      selected.push(normalize(row.getAttribute('aria-label')));
    }
  }
  const channelMatches=selected.length===1 && selected[0]===channel;
  const titleParts=normalize(document.title).split(' | ');
  const titleMatches=titleParts.length===4 && titleParts[0]==='Teams and Channels' && titleParts[1]===team && titleParts[2]===channel && titleParts[3]==='Microsoft Teams';
  const headerMatches=header.includes(team);
  if(headerMatches && channelMatches && titleMatches){
    if(departureCandidate)return departed();
    const join=exact('Join meeting in progress');
    if(join.length>1)return {state:'blocked',reason:'Multiple meeting join buttons; cannot select safely'};
    if(!join.length)return {state:'waiting',reason:'Meeting has not started in the configured channel'};
    if(inspectOnly)return {state:'channel_ready',ready:false,reason:'Team/channel verified; meeting Join button found. No meeting joined or capture tested by this check.'};
    if(clickOne(join))return {state:'prejoin',reason:'Opening the configured channel meeting'};
    return {state:'waiting',reason:'Meeting join button is not available yet'};
  }
  if(back.length || selected.length || titleParts.length===4){
    const display=value=>JSON.stringify(String(value || '').slice(0,200));
    const observed=titleParts.length===4?`${display(titleParts[1])} / ${display(titleParts[2])}`:'unrecognized Teams title';
    return {state:'blocked',reason:`Teams identity check failed. Expected ${display(team)} / ${display(channel)}; tab reports ${observed}. Checks: title=${titleMatches}, sidebar team=${headerMatches}, selected channel=${channelMatches} (count=${selected.length}; visible channel labels=${channelLabels.length}; selected names=${selected.slice(0,5).map(display).join(', ') || 'none'}). No Join click performed.`};
  }
  if(departureCandidate)return {state:'joined',ready:false,reason:'Meeting controls temporarily unavailable. No rejoin click performed; waiting to confirm meeting state.'};
  return {state:['prejoin','joining'].includes(phase)?phase:'waiting',reason:'Waiting for Teams, sign-in or lobby admission; no security prompts are bypassed'};
}

export function createTeamsJoiner(chromeApi,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxSteps=12,log=async()=>{}}={}){
  const key='teamsJoinSessions';
  const identity=s=>JSON.stringify([s.targetUrl,s.teamsTeam,s.teamsChannel,s.teamsAutoJoin]);
  async function checkTarget(schedule,target,occurrenceKey){
    if(!TEAMS_ORIGINS.includes(new URL(schedule.targetUrl).origin))throw Error('Unsupported Teams origin');
    await assertRunCurrent(chromeApi,schedule,occurrenceKey);
    const tab=await chromeApi.tabs.get(target.tabId);
    if(new URL(tab.url).origin!==new URL(schedule.targetUrl).origin || (tab.pendingUrl && new URL(tab.pendingUrl).origin!==new URL(schedule.targetUrl).origin))throw Error('Teams target origin changed; reauthorization required');
    return tab;
  }
  async function inspect(schedule,target,{detectDeparture=false}={}){
    const tab=await checkTarget(schedule,target);
    if(tab.status!=='complete')return {state:'waiting',ready:false,reason:'Teams tab is loading'};
    const sessions=(await chromeApi.storage.session.get(key))[key] || {};
    const record=sessions[target.tabId];
    const phase=record?.identity===identity(schedule)?record.phase:'channel';
    const results=await chromeApi.scripting.executeScript({target:{tabId:target.tabId},func:teamsJoinPageStep,args:[{team:schedule.teamsTeam,channel:schedule.teamsChannel,phase,inspectOnly:true,detectDeparture}]});
    const result=results?.[0]?.result;
    if(!result || !['waiting','prejoin','joining','joined','blocked','channel_ready','departed'].includes(result.state))throw Error('Invalid Teams readiness result');
    return {...result,ready:false};
  }
  async function ensure(schedule,target,{occurrenceKey,assertCurrent=async()=>{}}={}){
    if(!TEAMS_ORIGINS.includes(new URL(schedule.targetUrl).origin))throw Error('Unsupported Teams origin');
    const sessions=(await chromeApi.storage.session.get(key))[key] || {};
    let record=sessions[target.tabId];
    if(record?.identity!==identity(schedule))record={identity:identity(schedule),phase:'channel'};
    for(let i=0;i<maxSteps;i++){
      await assertCurrent();
      const tab=await checkTarget(schedule,target,occurrenceKey);
      await log({event:'teams_check',scheduleId:schedule.id,message:'Checking authorized Teams tab, team and channel before the next join step.'});
      if(tab.status!=='complete')return {ready:false,reason:'Teams tab is loading'};
      await checkTarget(schedule,target,occurrenceKey);
      await assertCurrent();
      const results=await chromeApi.scripting.executeScript({target:{tabId:target.tabId},func:teamsJoinPageStep,args:[{team:schedule.teamsTeam,channel:schedule.teamsChannel,phase:record.phase,detectDeparture:!!occurrenceKey && record.occurrenceKey===occurrenceKey}]});
      await checkTarget(schedule,target,occurrenceKey);
      const result=results?.[0]?.result;
      if(!result || !['waiting','prejoin','joining','joined','blocked','departed'].includes(result.state) || (result.ready===true && result.state!=='joined'))throw Error('Invalid Teams join page result');
      await log({event:'teams_'+result.state,scheduleId:schedule.id,level:result.state==='blocked'?'error':'info',message:result.reason || result.state});
      if(result.state==='departed')return {ready:false,departed:true,reason:result.reason};
      if(result.state==='blocked'){
        const diagnostic={at:new Date().toISOString(),state:'teams_blocked',scheduleId:schedule.id,message:result.reason || 'Teams joining blocked'};
        const {automationJoinEvents=[]}=await chromeApi.storage.local.get('automationJoinEvents');
        await chromeApi.storage.local.set({automationDiagnostic:diagnostic,automationJoinEvents:[...automationJoinEvents,diagnostic].slice(-100)});
        throw Error(diagnostic.message);
      }
      record={...record,occurrenceKey,phase:result.state==='waiting'?'channel':result.state,at:new Date().toISOString()};
      sessions[target.tabId]=record;await chromeApi.storage.session.set({[key]:sessions});
      const diagnostic={at:record.at,state:'teams_'+result.state,scheduleId:schedule.id,message:result.reason || result.state};
      const {automationJoinEvents=[]}=await chromeApi.storage.local.get('automationJoinEvents');
      await chromeApi.storage.local.set({automationDiagnostic:diagnostic,automationJoinEvents:[...automationJoinEvents,diagnostic].slice(-100)});
      if(result.state==='joined')return {ready:result.ready===true,reason:result.reason};
      if(result.state==='waiting')return {ready:false,reason:diagnostic.message};
      if(i+1<maxSteps)await sleep(1000);
    }
    return {ready:false,reason:'Waiting for Teams to join; lobby, permissions or sign-in may require a person'};
  }
  return {ensure,inspect};
}
