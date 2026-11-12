import {chromium} from '/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const base=process.env.COURTIQ_URL||'http://127.0.0.1:5173',out=process.env.REVIEW_OUT||'output/simple-learning/controls-local';await fs.mkdir(out,{recursive:true});
const bank=(await Promise.all((await fs.readdir('content/approved-packs')).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await fs.readFile('content/approved-packs/'+f,'utf8')).questions))).flat();
const browser=await chromium.launch({headless:true,args:['--use-angle=metal']});const report={base,controls:[],learning:[],errors:[]};
function assert(v,m){if(!v)throw Error(m);}
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.on('pageerror',e=>report.errors.push(e.message));
 const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text())),step=ms=>page.evaluate(ms=>window.advanceTime(ms),ms);
 await page.goto(base);await page.waitForFunction(()=>window.advanceTime && JSON.parse(window.render_game_to_text()).playerModels.every(x=>x==='ready'));await step(0);
 async function start(){if(await page.locator('#lobby-overlay').isHidden()){await page.click('#btn-return-lobby');await step(0);}await page.locator('#lobby-options > summary').click();await page.locator('#select-ai-difficulty').selectOption('beginner');await page.locator('#select-session-length').selectOption('practice');await page.locator('#lobby-options > summary').click();await page.click('#btn-start-solo');await step(0);await page.locator('body').click({position:{x:3,y:300}});}
 async function photo(name){await page.screenshot({path:out+'/'+name+'.png'});}
 for(const [count,move]of [[1,'crossover'],[2,'spin'],[3,'eurostep'],[4,'stepback']]){
  await start();
  for(let i=0;i<count;i++){await page.keyboard.press('KeyC');await step(50);}
  assert((await state()).trickSelection?.count===count,'Tap counter wrong');await photo('tap-selection-'+count);
  await step(500-count*50-1);assert((await state()).players[0].streetMove===null,'Trick fired early');await step(1);
  const s=await state();assert(s.players[0].streetMove===move,'Trick not selected: '+move);await step(120);await photo('move-'+move);report.controls.push({count,move,pass:true});
 }
 await start();await page.keyboard.press('Space');await step(20);assert((await state()).players[0].finishKind==='jump','Stationary shot became dunk');
 await photo('stationary-jumper');
 // Normal possessions and known course answers, without changing simulation state.
 await start();
 for(let round=1;round<=4;round++){
  let s=await state();if(s.attacker===0){await page.keyboard.press('Space');await step(20);}
  for(let t=0;t<18000&&(await state()).phase==='Possession';t+=100)await step(100);
  for(let t=0;t<1500&&(await state()).phase==='QuestionReady';t+=50)await step(50);
  s=await state();assert(s.phase==='Duel','No normal question');
  const stem=(await page.locator('#q-stem-text').innerText()).trim(),q=bank.find(x=>x.stem===stem);assert(q,'Question missing');
  await step(Math.max(0,s.duel.readingMs-s.duel.elapsedMs)+30);
  const wrong=round===4,option=q.options.find(o=>wrong?o.id!==q.correctOptionId:o.id===q.correctOptionId);
  const displayed=await page.locator('#q-options-grid .opt-text').allTextContents();
  await page.locator('#btn-opt-'+displayed.findIndex(x=>x.trim()===option.text)).click();
  for(let t=0;t<20000&&(await state()).phase!=='Feedback';t+=150)await step(150);
  s=await state();assert(s.phase==='Feedback','Feedback missing');
  const verdict=await page.locator('#fb-learning-verdict').innerText(),reason=await page.locator('#fb-choice-reason').innerText();
  assert(verdict.includes(wrong?'incorrect':'correct'),'Incorrect personal verdict');
  assert(s.players[0].correctAnswerStreak===(wrong?0:round),'Learning streak incorrect');
  assert(s.players[0].onFire===(round===3),'Fire incorrect');
  if(wrong)assert(reason==='Why: '+q.optionFeedback[option.id],'Wrong option rationale missing');
  await photo('learning-'+round);await step(15000);assert((await state()).phase==='Feedback','Feedback auto-dismissed');
  report.learning.push({round,question:q.id,selected:option.id,verdict,reason,streak:s.players[0].correctAnswerStreak,onFire:s.players[0].onFire,audio:s.audio.counts});
  await page.click('#btn-next-possession');await step(100);
  if(round===3){await page.keyboard.down('KeyD');await step(250);await page.keyboard.up('KeyD');await photo('on-fire-court');assert((await state()).players[0].onFire,'Basket reset Fire');}
 }
 // Two context-sensitive touch actions, plus sprint, remain usable in portrait and landscape.
 for(const [width,height,label]of [[390,844,'portrait'],[844,390,'landscape']]){
  await page.setViewportSize({width,height});await start();await page.click('#btn-open-settings');await page.locator('#chk-touch-overlay').check();await page.click('#btn-close-settings');await step(0);
  assert(await page.locator('.touch-action-buttons button').count()===3,'Extra touch actions remain');
  for(const id of ['btn-touch-trick','btn-touch-shoot']){const box=await page.locator('#'+id).boundingBox();assert(box && box.width>=44 && box.height>=44,'Touch target too small');assert(await page.locator('#'+id).isVisible(),'Touch action hidden');}
  await page.locator('#btn-touch-trick').dispatchEvent('pointerdown',{pointerId:7,pointerType:'touch',isPrimary:true});await step(500);assert((await state()).players[0].streetMove==='crossover','Touch trick failed');await photo(label+'-two-actions');
  assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Horizontal overflow');
 }
 assert(!report.errors.length,'Page errors');await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await browser.close();}
