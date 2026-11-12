import {chromium} from '/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const base=process.env.COURTIQ_URL||'http://127.0.0.1:5173',out=process.env.REVIEW_OUT||'output/athlete-roster/matches-local';await fs.mkdir(out,{recursive:true});
const bank=(await Promise.all((await fs.readdir('content/approved-packs')).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await fs.readFile('content/approved-packs/'+f,'utf8')).questions))).flat();
const browser=await chromium.launch({headless:true,args:['--use-angle=metal']});const report={base,errors:[],secrecyChecks:0,recoverySnapshots:[]};
const assert=(v,m)=>{if(!v)throw Error(m);};
let pages=[];report.lobbyEvents=[];
try{
 pages=await Promise.all([browser.newPage({viewport:{width:1440,height:900}}),browser.newPage({viewport:{width:390,height:844},hasTouch:true})]);
 for(const [i,p] of pages.entries()){
  p.on('pageerror',e=>report.errors.push(e.message));
  const inspect=msg=>{if(msg.type==='ERROR')report.errors.push(msg.message||msg.code);if(msg.type==='LOBBY_UPDATE'){report.lobbyEvents.push({page:i,lobby:msg.lobby});if(report.lobbyEvents.length>10)report.lobbyEvents.shift();}if(msg.type==='MATCH_SNAPSHOT'){const p=msg.snapshot.players[1];if(p.defenseAction==='swipe'&&p.defenseResult==='miss'&&p.defenseRecoverySec>0)report.recoverySnapshots.push({x:p.x,z:p.z,vx:p.vx,vz:p.vz,recovery:p.defenseRecoverySec});}if(msg.type==='DUEL_PRELOAD' || (msg.type==='MATCH_SNAPSHOT'&&['QuestionReady','Duel'].includes(msg.snapshot.phase))){const text=JSON.stringify(msg);assert(!text.includes('correctOptionId')&&!text.includes('optionFeedback')&&!text.includes('"explanation"'),'Answer explanation leaked online');report.secrecyChecks++;}};
  p.on('websocket',ws=>ws.on('framereceived',frame=>{try{inspect(JSON.parse(frame.payload.toString()));}catch(e){report.errors.push(e.message);}}));
  p.on('response',async r=>{if(r.url().includes('/api/room')){try{for(const m of (await r.json()).messages??[])inspect(m);}catch(e){report.errors.push(e.message);}}});
  if(base.includes('127.0.0.1'))await p.addInitScript(()=>{const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(url,protocols){super(String(url).endsWith('/ws')?'ws://127.0.0.1:8788/ws':url,protocols);}};});
  await p.goto(base);await p.waitForFunction(()=>window.render_game_to_text && JSON.parse(window.render_game_to_text()).playerModels.every(x=>x==='ready'));
  await p.fill('#input-pseudonym',i?'Student Two':'Student One');await p.click('#lobby-character-picker [data-character="'+(i?'0':'1')+'"]');await p.locator('#lobby-options > summary').click();await p.selectOption('#select-appearance',i?'3':'2');await p.locator('#lobby-options > summary').click();await p.click('#tab-online');
 }
 const [a,b]=pages;await a.click('#btn-create-room');await a.waitForFunction(()=>/^[A-Z2-9]{6}$/.test(document.getElementById('display-room-code')?.textContent.trim()));
 const code=(await a.locator('#display-room-code').innerText()).trim();await b.fill('#input-join-code',code);await b.click('#btn-join-room');
 await b.locator('#btn-toggle-ready').waitFor();await a.click('#btn-toggle-ready');await b.click('#btn-toggle-ready');
 const phase=async(p,name)=>p.waitForFunction(name=>JSON.parse(window.render_game_to_text()).phase===name,name,{timeout:30000});
 await Promise.all(pages.map(p=>phase(p,'Possession')));
 for(const p of pages){await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).playerModels.every(s=>s==='ready'));const s=await p.evaluate(()=>JSON.parse(window.render_game_to_text()));assert(JSON.stringify(s.characters)===JSON.stringify(['Sky','River']),'Different character choices lost');assert(JSON.stringify(s.players.map(p=>p.appearancePreset))===JSON.stringify([6,3]),'Palette/body choice lost');assert(s.players.every(p=>typeof p.plantSec==='number'),'Backend is running stale movement rules');}report.characterChoices=['Sky','River'];report.appearancePresets=[6,3];report.currentMovementBackend=true;
 // The shared trick key is an immediate defensive swipe, with a full missed-swipe movement freeze.
 const rooted=await b.evaluate(()=>JSON.parse(window.render_game_to_text()).players[1]);await b.keyboard.press('KeyC');await b.keyboard.down('KeyD');
 await new Promise((resolve,reject)=>{const start=Date.now(),t=setInterval(()=>{if(report.recoverySnapshots.length){clearInterval(t);resolve();}else if(Date.now()-start>8000){clearInterval(t);reject(Error('No authoritative missed-swipe snapshot'));}},25);});
 await b.keyboard.up('KeyD');assert(report.recoverySnapshots.every(p=>p.x===rooted.x&&p.z===rooted.z&&p.vx===0&&p.vz===0),'Missed swipe did not root defender');
 report.recoveryObservation='Authoritative WebSocket/HTTP snapshots while directional input is held; full one-second duration separately regression-tested';await b.screenshot({path:out+'/portrait-after-steal-attempt.png'});
 await b.keyboard.down('KeyA');await b.waitForFunction(()=>JSON.parse(window.render_game_to_text()).players[1].x < -2.4);await b.keyboard.up('KeyA');
 // A settled paint approach prevents capture/polling delay from carrying the actor beyond the hoop.
 await a.keyboard.down('KeyW');await a.waitForFunction(()=>JSON.parse(window.render_game_to_text()).players[0].z<0.65);await a.keyboard.up('KeyW');
 await a.waitForFunction(()=>{const p=JSON.parse(window.render_game_to_text()).players[0];return Math.hypot(p.vx,p.vz)<.1;});
 const approach=await a.evaluate(()=>JSON.parse(window.render_game_to_text()).players[0]);report.firstApproach={x:approach.x,z:approach.z,vx:approach.vx,vz:approach.vz};
 assert(Math.abs(approach.x)<=2.45&&approach.z<=-0.65&&approach.z> -4.8,'Test driver did not settle inside paint');
 await a.keyboard.down('KeyW');await a.keyboard.press('Space');
 await a.waitForFunction(()=>JSON.parse(window.render_game_to_text()).players[0].finishKind==='dunk');await a.keyboard.up('KeyW');report.skyDunk=true;
 for(let n=0;n<7;n++){await a.screenshot({path:out+'/Sky-finish-'+n+'.png'});await a.waitForTimeout(100);}
 await Promise.all(pages.map(p=>phase(p,'Duel')));
 const stems=await Promise.all(pages.map(p=>p.locator('#q-stem-text').innerText()));assert(stems[0]===stems[1],'Students got different questions');
 const q=bank.find(q=>q.stem===stems[0].trim());assert(q,'Unknown question');
 const choices=await Promise.all(pages.map(p=>p.locator('#q-options-grid .opt-text').allTextContents()));assert(JSON.stringify([...choices[0]].sort())===JSON.stringify([...choices[1]].sort()),'Choices differ');
 await Promise.all(pages.map(p=>p.waitForFunction(()=>!document.getElementById('btn-opt-0').disabled)));
 const wrong=q.options.find(o=>o.id!==q.correctOptionId),correct=q.options.find(o=>o.id===q.correctOptionId);
 await a.click('#btn-opt-'+choices[0].findIndex(t=>t.trim()===wrong.text));await b.click('#btn-opt-'+choices[1].findIndex(t=>t.trim()===correct.text));
 await Promise.all(pages.map(p=>phase(p,'Feedback')));
 const va=await a.locator('#fb-learning-verdict').innerText(),vb=await b.locator('#fb-learning-verdict').innerText();
 assert(va.includes('incorrect')&&vb.includes('correct')&&!vb.includes('incorrect'),'Per-student verdict wrong');
 assert((await a.locator('#fb-choice-reason').innerText())==='Why: '+q.optionFeedback[wrong.id],'Wrong-choice explanation missing');
 await a.screenshot({path:out+'/desktop-wrong-feedback.png'});await b.screenshot({path:out+'/portrait-correct-feedback.png'});
 await a.click('#btn-next-possession');await a.waitForFunction(()=>document.getElementById('btn-next-possession').disabled);
 await a.waitForTimeout(2400);assert(await b.locator('#feedback-overlay').isVisible(),'Other student could not finish reading');
 assert((await a.locator('#btn-next-possession').innerText()).includes('Waiting'),'Waiting acknowledgement missing');
 await b.locator('#btn-next-possession').scrollIntoViewIfNeeded();const box=await b.locator('#btn-next-possession').boundingBox();assert(box.height>=44,'Continue target too small');
 await b.click('#btn-next-possession');await Promise.all(pages.map(p=>phase(p,'Possession')));
 // A real drive into the blue paint followed by the same primary key: defender uses it to swat.
 // Attacker bumps into the neutral defender, keeping both bodies in contest range.
 await b.keyboard.down('KeyW');
 await b.waitForFunction(()=>JSON.parse(window.render_game_to_text()).players[1].z<0.65);
 await b.keyboard.up('KeyW');
 await b.waitForFunction(()=>JSON.parse(window.render_game_to_text()).players.every(p=>Math.hypot(p.vx,p.vz)<.1));
 const setup=await b.evaluate(()=>JSON.parse(window.render_game_to_text()).players);report.blockSetup=setup.map(p=>({x:p.x,z:p.z}));
 assert(setup[1].z<=-.65&&setup[1].z>-4.8&&Math.hypot(setup[1].x-setup[0].x,setup[1].z-setup[0].z)<=2.6,'Test driver failed paint/block setup');
 await a.keyboard.down('Space');await b.keyboard.down('KeyW');await b.keyboard.press('Space');
 await a.waitForFunction(()=>JSON.parse(window.render_game_to_text()).duel?.physicalBlock===true);
 await a.keyboard.up('Space');await b.keyboard.up('KeyW');await Promise.all(pages.map(p=>phase(p,'Duel')));
 if(base.includes('127.0.0.1')||process.env.CHECK_SWAT_LABEL==='1')for(const p of pages)assert((await p.locator('#q-contest-badge').innerText()).includes('Swat connected'),'Misleading swat label');
 const swat=await b.evaluate(()=>JSON.parse(window.render_game_to_text()));assert(swat.players[1].finishKind==='dunk','Paint drive did not dunk');
 await a.screenshot({path:out+'/desktop-primary-block.png'});await b.screenshot({path:out+'/portrait-primary-dunk.png'});
 report.primaryDunkAndBlock=true;report.riverDunk=true;
 report.sameQuestion=true;report.sameChoices=true;report.perStudentFeedback=true;report.missedSwipeFrozen=true;report.bothContinueRequired=true;report.question=q.id;
 assert(!report.errors.length,report.errors.join('; '));await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){const states=await Promise.all(pages.map(async(p,i)=>{await p.screenshot({path:out+'/failure-'+i+'.png'});return p.evaluate(()=>({state:JSON.parse(window.render_game_to_text()),lobby:document.getElementById('online-waiting-room')?.innerText,connection:document.getElementById('connection-banner')?.innerText}));}));await fs.writeFile(out+'/failure-report.json',JSON.stringify({...report,states,error:e.message},null,2));throw e;}finally{await browser.close();}
