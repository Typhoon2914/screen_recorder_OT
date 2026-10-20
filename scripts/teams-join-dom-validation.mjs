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
 console.log('PASS: real-browser DOM fixtures: absent meeting, correct channel, wrong channel, ambiguity, unverified prejoin, muted join, verified meeting. These are fixtures, not live acceptance.');
}finally{await browser.close();}
