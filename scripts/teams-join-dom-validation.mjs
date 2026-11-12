// Controlled DOM fixtures exercise real browser selectors, NOT real Teams capture.
import assert from 'node:assert/strict';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.test-artifacts/browser-cache');
const {chromium}=await import('playwright');
const {teamsJoinPageStep}=await import('../src/automation/teams_join.js');
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const p=await browser.newPage();
 const context={team:'Test team',channel:'General',phase:'channel'};
 async function page(html){await p.setContent(html);await p.evaluate(()=>{window.clicked=[];document.querySelectorAll('button,[role=switch]').forEach(e=>e.onclick=()=>{window.clicked.push(e.id);if(e.hasAttribute('aria-checked'))e.setAttribute('aria-checked','false');});});}
 const channel=`<title>Teams and Channels | Test team | General | Microsoft Teams</title><div><div><button aria-label="Back to All teams">All teams</button></div>Test team</div><div role="treeitem" aria-selected="true"><span data-tid="channel-list-item-text-x">General</span></div>`;
 const legacyRow='<div role="treeitem" aria-selected="true"><span data-tid="channel-list-item-text-x">General</span></div>';
 // Reduced from the user's real Teams HTML and matched CSS rule. No private
 // channel IDs, participant details, or generated Griffel class names retained.
 const selectedStyle='<style>:root{--colorNeutralBackground4Selected:#333333}.selected-channel-token{background-color:var(--colorNeutralBackground4Selected)}</style>';
 const visualRow='<a role="treeitem" data-is-focusable="true" aria-selected="false" class="selected-channel-token"><div data-tid="channel-list-item"><span data-tid="channel-list-item-text-example">General</span></div></a>';
 await page(selectedStyle+channel.replace(legacyRow,visualRow)+'<button id="join" aria-label="Join meeting in progress">Join</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,{...context,inspectOnly:true})).state,'channel_ready','Teams marks the displayed channel false in ARIA but applies its selected-background token');
 assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
 await page(selectedStyle+channel.replace(legacyRow,visualRow)+'<button id="join" aria-label="Join meeting in progress">Join</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,{...context,phase:'joined',detectDeparture:true})).state,'departed');
 assert.deepEqual(await p.evaluate(()=>window.clicked),[],'departure never clicks Join again');
 assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'prejoin');
 assert.deepEqual(await p.evaluate(()=>window.clicked),['join']);
 for(const changed of [
  channel.replace('<title>Teams and Channels | Test team |','<title>Teams and Channels | Other team |'),
  channel.replace('Test team</div>','Other team</div>')
 ]){
  await page(selectedStyle+changed.replace(legacyRow,visualRow)+'<button id="join" aria-label="Join meeting in progress">Join</button>');
  assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'blocked');
  assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
 }
 for(const [styles,row] of [
  [selectedStyle,visualRow.replace('class="selected-channel-token"','style="background-color:#333333"')],
  [selectedStyle,visualRow.replace('aria-selected="false"','aria-selected="false" style="background-color:red"')],
  [selectedStyle.replace('.selected-channel-token{','.selected-channel-token:hover{'),visualRow],
  [selectedStyle,visualRow.replace('>General<','>Other<')],
  [selectedStyle,visualRow+visualRow.replace('>General<','>Other<')],
  [selectedStyle.replace('#333333','transparent'),visualRow]
 ]){
  await page(styles+channel.replace(legacyRow,row)+'<button id="join" aria-label="Join meeting in progress">Join</button>');
  assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'blocked');
  assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
 }
 for(const row of [
  '<div role="treeitem" aria-current="page"><span data-tid="channel-list-item-text-x">General</span></div>',
  '<div role="treeitem"><a aria-current="page"><span data-tid="channel-list-item-text-x">General</span></a></div>',
  '<div role="treeitem" aria-selected="true" data-tid="channel-list-item-text-x">General</div>',
  '<div role="treeitem"><div aria-selected="true"><span data-tid="channel-list-item-text-x">General</span></div></div>',
  '<div role="treeitem" aria-selected="true" aria-label="General"></div>'
 ]){
  await page(channel.replace(legacyRow,row)+'<button id="join" aria-label="Join meeting in progress">Join</button>');
  assert.equal((await p.evaluate(teamsJoinPageStep,{...context,inspectOnly:true})).state,'channel_ready',row);
  assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
  assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'prejoin',row);
  assert.deepEqual(await p.evaluate(()=>window.clicked),['join']);
 }
 for(const row of [
  '<div role="treeitem" aria-selected="false"><span data-tid="channel-list-item-text-x">General</span></div>',
  '<div role="treeitem"><span data-tid="channel-list-item-text-x">General</span></div>',
  '<div role="treeitem" aria-current="page"><span data-tid="channel-list-item-text-x">Other</span></div>',
  legacyRow+'<div role="treeitem" aria-current="page"><span data-tid="channel-list-item-text-y">Other</span></div>',
  '<div role="treeitem" aria-selected="true"><span aria-selected="false" data-tid="channel-list-item-text-x">General</span></div>'
 ]){
  await page(channel.replace(legacyRow,row)+'<button id="join" aria-label="Join meeting in progress">Join</button>');
  assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'blocked',row);
  assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
 }
 await page(channel+'<button id="create" aria-label="Meet now">Meet now</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'waiting');assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
 await page(channel+'<button id="join" aria-label="Join meeting in progress">Join</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'prejoin');assert.deepEqual(await p.evaluate(()=>window.clicked),['join']);
 await page(channel+'<button id="join" aria-label="Join meeting in progress">Join</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,{...context,inspectOnly:true})).state,'channel_ready');
 assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
 await page(channel.replaceAll('Test team','Test\u00a0team')+'<button id="join" aria-label="Join meeting in progress">Join</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'prejoin');
 await page(channel+'<button id="join" aria-label="Join meeting in progress">Join</button>');
 const mismatch=await p.evaluate(teamsJoinPageStep,{...context,team:'Other team',inspectOnly:true});
 assert.equal(mismatch.state,'blocked');
 assert.match(mismatch.reason,/Other team/);assert.match(mismatch.reason,/Test team/);
 assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
 await page(channel.replace('Test team</div>','Other team</div>')+'<button aria-label="Join meeting in progress">Join</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'blocked');
 await page(channel+'<button aria-label="Join meeting in progress">Join</button><button aria-label="Join meeting in progress">Join</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'blocked');
 await page('<button id="camera" role="switch" aria-label="Turn camera off" aria-checked="true">Camera</button><button id="mic" role="switch" aria-label="Mute mic" aria-checked="true">Mic</button><div role="radio" aria-label="Computer audio" aria-checked="true">Computer audio</div><button id="join">Join now</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'blocked');
 const prejoin={...context,phase:'prejoin'};
 assert.equal((await p.evaluate(teamsJoinPageStep,{...prejoin,inspectOnly:true})).state,'prejoin');
 assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
 assert.equal((await p.evaluate(teamsJoinPageStep,prejoin)).state,'prejoin');
 assert.equal((await p.evaluate(teamsJoinPageStep,prejoin)).state,'prejoin');
 assert.equal((await p.evaluate(teamsJoinPageStep,prejoin)).state,'joining');
 assert.deepEqual(await p.evaluate(()=>window.clicked),['camera','mic','join']);
 await page('<input role="switch" type="checkbox" title="Turn camera on (Ctrl+Shift+O)"><input role="switch" type="checkbox" title="Unmute mic (Ctrl+Shift+M)"><input type="radio" aria-label="Computer audio" checked><button id="join">Join now</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,prejoin)).state,'joining');
 await page('<button aria-label="Leave">Leave</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'blocked');
 assert.equal((await p.evaluate(teamsJoinPageStep,{...context,phase:'joining'})).ready,true);
 // October 31 regression: Teams keeps a disabled Join now button, then
 // replaces the channel sidebar with a four-part Meeting join title.
 const transitioning={...context,phase:'joining'};
 // November 7 live evidence: sidebar disappears before the old channel title
 // changes; the Meeting join title can retain the Teams and Channels prefix.
 for(const phase of ['prejoin','joining']){
  await page('<title>Teams and Channels | Test team | General | Microsoft Teams</title><p>Loading…</p>');
  assert.equal((await p.evaluate(teamsJoinPageStep,{...context,phase})).state,phase,'old verified title with no sidebar is a transition');
  await page('<title>Teams and Channels | Meeting join | Meeting in "General" | Microsoft Teams</title><p>Loading…</p>');
  assert.equal((await p.evaluate(teamsJoinPageStep,{...context,phase})).state,phase,'Meeting join is not the team name');
 }
 // November 12 live regression: Teams now uses the meeting TITLE instead of
 // 'Meeting in "General"'. The same trusted prejoin must advance to Join now.
 await page('<title>Teams and Channels | Meeting join | Test Meeting | Microsoft Teams</title><input role="switch" type="checkbox" title="Turn camera on (Ctrl+Shift+O)"><input role="switch" type="checkbox" title="Unmute mic (Ctrl+Shift+M)"><input type="radio" aria-label="Computer audio" checked><button id="now">Join now</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'blocked','meeting title alone never grants join trust');
 assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
 assert.equal((await p.evaluate(teamsJoinPageStep,{...context,phase:'prejoin'})).state,'joining','trusted channel click permits actual meeting-title prejoin');
 assert.deepEqual(await p.evaluate(()=>window.clicked),['now']);
 await page('<title>Teams and Channels | Meeting join | Test Meeting | Microsoft Teams</title><p>Loading…</p>');
 assert.equal((await p.evaluate(teamsJoinPageStep,{...context,phase:'prejoin'})).state,'prejoin','temporary titled loading is a trusted transition');
 await page('<title>Teams and Channels | Meeting join | Test Meeting | Microsoft Teams</title><button aria-label="Leave">Leave</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,{...context,phase:'joined'})).ready,true,'verified joined meeting may retain its title');
 for(const title of ['Teams and Channels | Test team | General | Microsoft Teams','Teams and Channels | Meeting join | Meeting in "General" | Microsoft Teams']){
  await page(`<title>${title}</title><p>Loading…</p>`);
  assert.equal((await p.evaluate(teamsJoinPageStep,context)).state,'blocked','loading title alone cannot establish verified provenance');
 }
 await page('<title>Teams and Channels | Meeting join | Meeting in "Other" | Microsoft Teams</title><button>Leave</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,transitioning)).state,'blocked','Leave cannot override a different channel title');
 for(const disabled of ['disabled','aria-disabled="true"','']){
  await page(`<button id="now" ${disabled}>Join now</button>`);
  assert.equal((await p.evaluate(teamsJoinPageStep,transitioning)).state,'joining','a completed Join click must not regress or click again');
  assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
 }
 await page('<title>Microsoft Teams | Meeting join | Meeting in "General" | Microsoft Teams</title><p>Connecting…</p>');
 assert.equal((await p.evaluate(teamsJoinPageStep,transitioning)).state,'joining','transition title is not a channel mismatch');
 await page('<title>Microsoft Teams | Meeting join | Meeting in "Other" | Microsoft Teams</title><p>Connecting…</p>');
 assert.equal((await p.evaluate(teamsJoinPageStep,transitioning)).state,'blocked','a different named meeting is still rejected');
 await page(channel.replaceAll('Test team','Other team'));
 assert.equal((await p.evaluate(teamsJoinPageStep,transitioning)).state,'blocked');
 await page(channel+'<button id="join" aria-label="Join meeting in progress">Join</button>');
 assert.equal((await p.evaluate(teamsJoinPageStep,transitioning)).state,'departed','returning to the channel after Join must not rejoin');
 assert.deepEqual(await p.evaluate(()=>window.clicked),[]);
 console.log('PASS: real-browser DOM fixtures: absent meeting, correct channel, wrong channel, ambiguity, unverified prejoin, muted join, verified meeting. These are fixtures, not live acceptance.');
}finally{await browser.close();}
