import {chromium} from '/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const base=process.env.COURTIQ_URL||'http://127.0.0.1:4173',out=process.env.REVIEW_OUT||'output/possession-ready/local';await fs.mkdir(out,{recursive:true});
const bank=(await Promise.all((await fs.readdir('content/approved-packs')).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await fs.readFile('content/approved-packs/'+f,'utf8')).questions))).flat();
const browser=await chromium.launch({headless:true,args:['--use-angle=metal']});const report={base,runs:[],errors:[],roomRequests:0};const assert=(v,m)=>{if(!v)throw Error(m);};
try{
 for(const [label,width,height]of [['portrait',390,844],['landscape',844,390],['desktop',1440,900]]){
  const touch=label!=='desktop',p=await browser.newPage({viewport:{width,height},hasTouch:touch});p.on('pageerror',e=>report.errors.push(e.message));p.on('request',r=>{if(r.url().includes('/api/room'))report.roomRequests++;});
  const state=()=>p.evaluate(()=>JSON.parse(window.render_game_to_text())),step=ms=>p.evaluate(ms=>window.advanceTime(ms),ms),photo=tag=>p.screenshot({path:out+'/'+label+'-'+tag+'.png'});
  const tap=async id=>{if(touch){const b=await p.locator(id).boundingBox();assert(b,'Missing button '+id);await p.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await p.click(id);};
  const frozen=s=>JSON.stringify({players:s.players.map(p=>({x:p.x,z:p.z,vx:p.vx,vz:p.vz,finish:p.finishKind,defense:p.defenseAction})),ball:s.ball,clock:s.clockMs,score:s.score,attacker:s.attacker});
  async function review(){
   let s=await state();assert(!s.possessionCountdownMs,'Review helper started during countdown');
   if(s.phase==='Possession'&&s.attacker===0){if(touch)await tap('#btn-touch-shoot');else await p.keyboard.press('Space');await step(16);}
   for(let t=0;t<15000&&(await state()).phase==='Possession';t+=50)await step(50);
   for(let t=0;t<2000&&(await state()).phase==='QuestionReady';t+=25)await step(25);
   s=await state();assert(s.phase==='Duel','No question');const stem=(await p.locator('#q-stem-text').innerText()).trim(),q=bank.find(q=>q.stem===stem);assert(q,'Unknown question');
   await step(Math.max(0,s.duel.readingMs-s.duel.elapsedMs)+25);const correct=q.options.find(o=>o.id===q.correctOptionId),opts=await p.locator('#q-options-grid .opt-text').allTextContents();
   const option='#btn-opt-'+opts.findIndex(t=>t.trim()===correct.text);await p.locator(option).scrollIntoViewIfNeeded();await tap(option);
   assert(await p.locator('#feedback-overlay').isVisible(),'Immediate feedback missing');
   for(let t=0;t<30000&&(await state()).phase!=='Feedback';t+=100)await step(100);
   assert((await state()).phase==='Feedback','No final review');await tap('#btn-next-possession');
  }
  await p.goto(base);await p.waitForFunction(()=>window.advanceTime&&JSON.parse(window.render_game_to_text()).playerModels.every(s=>s==='ready'));await step(0);
  if(touch)await p.click('#lobby-character-picker [data-character="1"]');
  await p.locator('#lobby-options > summary').click();await p.selectOption('#select-ai-difficulty','beginner');await p.selectOption('#select-session-length','practice');await p.locator('#lobby-options > summary').click();await tap('#btn-start-solo');await step(0);
  assert((await state()).possessionCountdownMs===0,'Opening play unexpectedly delayed');
  const rounds=[];
  for(let round=1;round<=2;round++){
   await review();let s=await state();assert(s.possessionCountdownMs===2000,'Countdown did not start after review');
   assert(await p.locator('#feedback-overlay').isHidden()&&await p.locator('#question-overlay').isHidden(),'Question/review still visible');
   assert(await p.locator('#possession-countdown').isVisible(),'No visible countdown');
   assert(await p.locator('#possession-countdown-number').innerText()==='2','No 2');
   const role=s.attacker===0?'attack':'defend';assert((await p.locator('#possession-countdown-label').innerText()).endsWith(role),'Wrong role prompt');
   if(round===1)assert(role==='defend','First defensive handover missing');else assert(role==='attack','Human attacking handover missing');
   const before=frozen(s);await photo('round-'+round+'-2');
   if(round===1){
    await step(250);await p.click('#btn-open-settings');const paused=(await state()).possessionCountdownMs;await step(3000);
    assert((await state()).possessionCountdownMs===paused,'Settings consumed preparation time');await p.click('#btn-close-settings');
   }
   let joy;
   if(touch){
    assert(await p.locator('#touch-controls').isVisible(),'Phone controls not available to prepare');
    for(const id of ['#btn-touch-shoot','#btn-touch-trick']){assert(await p.locator(id).isDisabled(),'Action enabled during countdown');await tap(id);}
    joy=await p.locator('#touch-joystick-base').boundingBox();await p.mouse.move(joy.x+joy.width/2,joy.y+joy.height/2);await p.mouse.down();await p.mouse.move(joy.x+joy.width*.2,joy.y+joy.height/2);
   }else{
    await p.keyboard.down('KeyA');await p.keyboard.press('Space');await p.keyboard.press('KeyC');
   }
   await step((await state()).possessionCountdownMs-1000);assert(await p.locator('#possession-countdown-number').innerText()==='1','No 1');assert(frozen(await state())===before,'Players/ball/clock moved early');await photo('round-'+round+'-1');
   await step(999);assert((await state()).possessionCountdownMs>0&&frozen(await state())===before,'Started before two seconds');
   await step(1);s=await state();assert(s.possessionCountdownMs===0,'Countdown did not finish');assert(frozen(s)===before,'Movement used the final preparation frame');assert(await p.locator('#possession-countdown').isHidden(),'Countdown stayed visible');
   if(touch)assert(await p.locator('#btn-touch-shoot').isEnabled()&&await p.locator('#btn-touch-trick').isEnabled(),'Actions did not unlock');
   await step(100);s=await state();assert(s.players[0].x<JSON.parse(before).players[0].x,'Held preparation movement did not resume');assert(s.clockMs<JSON.parse(before).clock,'Clock stayed frozen');
   if(touch)await p.mouse.up();else await p.keyboard.up('KeyA');
   assert(s.players[0].defenseAction===null&&s.players[0].streetMove===null&&s.players[0].finishKind===null,'Early action leaked into live play');
   if(round===1){
    const action=label==='landscape'?'swipe':'jump';
    if(touch)await tap(action==='swipe'?'#btn-touch-trick':'#btn-touch-shoot');else await p.keyboard.press('Space');await step(16);
    assert((await state()).players[0].defenseAction===action,'Fresh defensive control failed');await photo('live-'+action);
   }else{
    if(touch)await tap('#btn-touch-shoot');else await p.keyboard.press('Space');await step(16);
    assert((await state()).phase==='QuestionReady','Fresh attacking action did not resume');
   }
   if(touch&&process.env.CHECK_HOST_BADGE==='1'){
    await p.locator('#nl-badge-frame[data-nl-ready="1"]').waitFor();const badge=await p.locator('#nl-badge-frame').boundingBox();
    for(const id of ['#touch-joystick-base','#btn-touch-shoot','#btn-touch-trick']){const b=await p.locator(id).boundingBox();assert(b.height>=44&&b.y+b.height<badge.y,'Touch control overlaps badge');}
   }
   assert(!await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Horizontal overflow');
   rounds.push({round,role,fullTwoSecondsFrozen:true,pauseChecked:round===1,heldMovementResumed:true,freshRoleActionVerified:true});
  }
  report.runs.push({label,width,height,rounds});await p.close();
 }
 assert(!report.errors.length,'Browser errors');assert(!report.roomRequests,'Unexpected room request');await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){await fs.writeFile(out+'/failure.json',JSON.stringify({...report,error:e.message},null,2));throw e;}finally{await browser.close();}
