// Narrow Teams adapter: no credentials, permission dialogs, meeting creation,
// arbitrary tab selection, or authentication/lobby bypass. Uses activeTab access.
export const TEAMS_ORIGINS=['https://teams.cloud.microsoft','https://teams.microsoft.com'];
export function teamsJoinPageStep({team,channel,phase,inspectOnly=false}){
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
  const joinNow=exact('Join now');
  if(joinNow.length){
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
  const selected=[...document.querySelectorAll('[role="treeitem"][aria-selected="true"] [data-tid^="channel-list-item-text-"]')].filter(visible);
  const channelMatches=selected.length===1 && normalize(selected[0].textContent)===channel;
  const titleParts=normalize(document.title).split(' | ');
  const titleMatches=titleParts.length===4 && titleParts[0]==='Teams and Channels' && titleParts[1]===team && titleParts[2]===channel && titleParts[3]==='Microsoft Teams';
  const headerMatches=header.includes(team);
  if(headerMatches && channelMatches && titleMatches){
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
    return {state:'blocked',reason:`Teams identity check failed. Expected ${display(team)} / ${display(channel)}; tab reports ${observed}. Checks: title=${titleMatches}, sidebar team=${headerMatches}, selected channel=${channelMatches} (count=${selected.length}). No Join click performed.`};
  }
  return {state:['prejoin','joining'].includes(phase)?phase:'waiting',reason:'Waiting for Teams, sign-in or lobby admission; no security prompts are bypassed'};
}

export function createTeamsJoiner(chromeApi,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxSteps=12}={}){
  const key='teamsJoinSessions';
  const identity=s=>JSON.stringify([s.targetUrl,s.teamsTeam,s.teamsChannel,s.teamsAutoJoin]);
  async function checkTarget(schedule,target){
    if(!TEAMS_ORIGINS.includes(new URL(schedule.targetUrl).origin))throw Error('Unsupported Teams origin');
    const current=((await chromeApi.storage.local.get('automationSchedules')).automationSchedules || []).find(s=>s.id===schedule.id);
    if(!current?.enabled)throw Error('Teams join cancelled: schedule disabled or removed');
    if(identity(current)!==identity(schedule))throw Error('Teams join cancelled: configuration changed');
    const tab=await chromeApi.tabs.get(target.tabId);
    if(new URL(tab.url).origin!==new URL(schedule.targetUrl).origin || (tab.pendingUrl && new URL(tab.pendingUrl).origin!==new URL(schedule.targetUrl).origin))throw Error('Teams target origin changed; reauthorization required');
    return tab;
  }
  async function inspect(schedule,target){
    const tab=await checkTarget(schedule,target);
    if(tab.status!=='complete')return {state:'waiting',ready:false,reason:'Teams tab is loading'};
    const sessions=(await chromeApi.storage.session.get(key))[key] || {};
    const record=sessions[target.tabId];
    const phase=record?.identity===identity(schedule)?record.phase:'channel';
    const results=await chromeApi.scripting.executeScript({target:{tabId:target.tabId},func:teamsJoinPageStep,args:[{team:schedule.teamsTeam,channel:schedule.teamsChannel,phase,inspectOnly:true}]});
    const result=results?.[0]?.result;
    if(!result || !['waiting','prejoin','joining','joined','blocked','channel_ready'].includes(result.state))throw Error('Invalid Teams readiness result');
    return {...result,ready:false};
  }
  async function ensure(schedule,target){
    if(!TEAMS_ORIGINS.includes(new URL(schedule.targetUrl).origin))throw Error('Unsupported Teams origin');
    const sessions=(await chromeApi.storage.session.get(key))[key] || {};
    let record=sessions[target.tabId];
    if(record?.identity!==identity(schedule))record={identity:identity(schedule),phase:'channel'};
    for(let i=0;i<maxSteps;i++){
      const tab=await checkTarget(schedule,target);
      if(tab.status!=='complete')return {ready:false,reason:'Teams tab is loading'};
      const results=await chromeApi.scripting.executeScript({target:{tabId:target.tabId},func:teamsJoinPageStep,args:[{team:schedule.teamsTeam,channel:schedule.teamsChannel,phase:record.phase}]});
      const result=results?.[0]?.result;
      if(!result || !['waiting','prejoin','joining','joined','blocked'].includes(result.state) || (result.ready===true && result.state!=='joined'))throw Error('Invalid Teams join page result');
      if(result.state==='blocked'){
        const diagnostic={at:new Date().toISOString(),state:'teams_blocked',scheduleId:schedule.id,message:result.reason || 'Teams joining blocked'};
        const {automationJoinEvents=[]}=await chromeApi.storage.local.get('automationJoinEvents');
        await chromeApi.storage.local.set({automationDiagnostic:diagnostic,automationJoinEvents:[...automationJoinEvents,diagnostic].slice(-100)});
        throw Error(diagnostic.message);
      }
      record={...record,phase:result.state==='waiting'?'channel':result.state,at:new Date().toISOString()};
      sessions[target.tabId]=record;await chromeApi.storage.session.set({[key]:sessions});
      const diagnostic={at:record.at,state:'teams_'+result.state,scheduleId:schedule.id,message:result.reason || result.state};
      const {automationJoinEvents=[]}=await chromeApi.storage.local.get('automationJoinEvents');
      await chromeApi.storage.local.set({automationDiagnostic:diagnostic,automationJoinEvents:[...automationJoinEvents,diagnostic].slice(-100)});
      if(result.state==='joined')return {ready:true};
      if(result.state==='waiting')return {ready:false,reason:diagnostic.message};
      if(i+1<maxSteps)await sleep(1000);
    }
    return {ready:false,reason:'Waiting for Teams to join; lobby, permissions or sign-in may require a person'};
  }
  return {ensure,inspect};
}
