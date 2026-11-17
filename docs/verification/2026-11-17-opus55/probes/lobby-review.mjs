import {chromium} from '/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const base=process.env.COURTIQ_URL||'http://127.0.0.1:5173',out=process.env.REVIEW_OUT||'output/solo-privacy/lobby-local';
await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true,args:['--use-angle=metal']});
const report={base,viewports:[],roomRequests:0,websockets:0,identityRequests:[],errors:[]};const assert=(x,m)=>{if(!x)throw Error(m);};
try{
 for(const [width,height]of [[1440,900],[768,1024],[390,844],[844,390]]){
  const p=await browser.newPage({viewport:{width,height},hasTouch:width<650});p.on('pageerror',e=>report.errors.push(e.message));
  p.on('websocket',ws=>{if(new URL(ws.url()).pathname==='/ws')report.websockets++;});p.on('request',r=>{if(r.url().includes('/api/room'))report.roomRequests++;if(r.postData()?.includes('SkyFox'))report.identityRequests.push(r.url());});
  await p.goto(base);await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).playerModels.every(s=>s==='ready'));await p.evaluate(()=>window.advanceTime(0));
  assert(await p.locator('#lobby-mode-tabs').isHidden(),'Mode chooser still visible');assert(await p.locator('#panel-online-actions').isHidden(),'Room panel visible');
  assert(await p.locator('#lobby-mode-tabs').evaluate(e=>e.inert&&e.hidden),'Parked mode chooser is interactive');
  assert(await p.locator('label[for="input-pseudonym"]').innerText()==='Nickname','Input still asks for a name');
  assert(await p.locator('#input-pseudonym').getAttribute('aria-describedby')==='nickname-privacy','Privacy reminder not associated');
  const privacy=await p.locator('#nickname-privacy').innerText();assert(privacy.includes("Don't use your full name, email, student number or other personal details."),'Privacy warning incomplete');
  const box=await p.locator('#nickname-privacy').boundingBox(),start=await p.locator('#btn-start-solo').boundingBox();
  assert(box.y>=0&&box.y+box.height<height-48,'Warning not readable without scrolling');assert(start.y>=0&&start.y+start.height<height-48,'Start requires scrolling');
  assert(!await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Horizontal overflow');
  await p.fill('#input-pseudonym','SkyFox');await p.click('#lobby-character-picker [data-character="1"]');
  // Even stale or synthetic events must not start networking in this release.
  await p.evaluate(()=>{document.getElementById('tab-online').click();document.getElementById('btn-create-room').click();document.getElementById('input-join-code').value='ABC234';document.getElementById('btn-join-room').click();});
  assert(await p.locator('#panel-online-actions').isHidden(),'Hidden events opened room controls');
  await p.screenshot({path:`${out}/lobby-${width}.png`});
  await p.locator('#lobby-options > summary').click();await p.selectOption('#select-ai-difficulty','beginner');await p.selectOption('#select-appearance','3');
  await p.locator('#lobby-teacher-tools > summary').click();await p.click('#btn-load-sample-pack-json');await p.click('#btn-validate-pack');
  assert((await p.locator('#pack-validation-output').innerText()).includes('Validated & Loaded'),'Teacher sample import failed');
  const imported=await p.locator('#select-pack').inputValue();assert(imported==='custom-spx101-pilot','Imported pack not selected');
  await p.locator('#lobby-options > summary').click();await p.focus('#btn-start-solo');await p.keyboard.press('Space');await p.evaluate(()=>window.advanceTime(0));
  const match=await p.evaluate(()=>JSON.parse(window.render_game_to_text()));assert(match.phase==='Possession'&&!match.players[0].finishKind,'Keyboard Start fired a shot');
  assert(match.players[0].pseudonym==='SkyFox'&&match.characters[0]==='Sky'&&match.players[0].appearancePreset===7,'Nickname/character choice lost');
  assert(match.features.multiplayer===false&&match.players[1].isAi===true,'Did not start solo-only match');
  await p.click('#btn-return-lobby');await p.evaluate(()=>window.advanceTime(0));assert(await p.locator('#lobby-mode-tabs').isHidden(),'Returning restored multiplayer');
  assert(await p.locator('#select-pack').inputValue()===imported,'Return lost custom pack');
  report.viewports.push({width,height,privacyVisible:true,startVisible:true,nativeKeyboardStart:true,teacherImport:true,characterAndNickname:true,multiplayerInertAfterReturn:true,overflow:false});await p.close();
 }
 const p=await browser.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>report.errors.push(e.message));await p.goto(base+'/player-lab.html');
 await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).asset==='ready');
 assert(await p.locator('#jersey-name').inputValue()==='HOOPSTER','Lab has a personal default');assert((await p.locator('#lab-nickname-privacy').innerText()).includes("Don't use your full name"),'Lab privacy reminder missing');
 await p.fill('#jersey-name','SkyFox');await p.click('#show-name');await p.waitForTimeout(150);await p.screenshot({path:out+'/lab-nickname.png'});await p.close();
 assert(report.roomRequests===0&&report.websockets===0,'Solo release attempted multiplayer networking');assert(!report.identityRequests.length,'Nickname sent in network request');assert(!report.errors.length,report.errors.join(';'));
 report.labNicknamePrivacy=true;await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){await fs.writeFile(out+'/failure.json',JSON.stringify({...report,error:e.message},null,2));throw e;}finally{await browser.close();}
