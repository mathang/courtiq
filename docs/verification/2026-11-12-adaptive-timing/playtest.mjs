import {chromium} from '/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const base=process.env.COURTIQ_URL||'http://127.0.0.1:4173',out=process.env.REVIEW_OUT||'output/adaptive-timing/local';await fs.mkdir(out,{recursive:true});
const bank=(await Promise.all((await fs.readdir('content/approved-packs')).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await fs.readFile('content/approved-packs/'+f,'utf8')).questions))).flat();
const browser=await chromium.launch({headless:true,args:['--use-angle=metal']});const report={base,runs:[],errors:[],roomRequests:0};const assert=(v,m)=>{if(!v)throw Error(m);};
try{
 for(const [label,width,height,adaptive,preset,limit]of [
  ['adaptive',1440,900,true,'standard',32],['phone',390,844,true,'standard',2],['landscape',844,390,true,'standard',2],
  ['fixed',1440,900,false,'standard',2],['practice',390,844,true,'practice',2]]){
  const p=await browser.newPage({viewport:{width,height},hasTouch:width<900,acceptDownloads:true});p.on('pageerror',e=>report.errors.push(e.message));p.on('request',r=>{if(r.url().includes('/api/room'))report.roomRequests++;});
  const state=()=>p.evaluate(()=>JSON.parse(window.render_game_to_text())),step=ms=>p.evaluate(ms=>window.advanceTime(ms),ms),photo=async tag=>p.screenshot({path:out+'/'+label+'-'+tag+'.png'});
  await p.goto(base);await p.waitForFunction(()=>window.advanceTime&&JSON.parse(window.render_game_to_text()).playerModels.every(s=>s==='ready'));await step(0);
  await p.locator('#lobby-options > summary').click();assert(await p.locator('#chk-adaptive-timing').isChecked(),'Adaptation is not on by default');
  await p.locator('#chk-adaptive-timing').setChecked(adaptive);await p.selectOption('#select-room-preset',preset);await p.selectOption('#select-session-length','practice');await p.selectOption('#select-ai-difficulty','beginner');
  await p.locator('.adaptive-timing-option').scrollIntoViewIfNeeded();const control=await p.locator('.adaptive-timing-option').boundingBox();assert(control.height>=44,'Timing preference has no 44px label target');await photo('options');await p.locator('#lobby-options > summary').click();
  if(label==='phone')await p.click('#lobby-character-picker [data-character="1"]');await p.click('#btn-start-solo');await step(0);
  const enabled=adaptive&&preset!=='practice';assert((await state()).questionTiming.enabled===enabled,'Timing mode mismatch');
  const rounds=[];let round=0,expectedPace=100;
  while((await state()).phase!=='MatchEnd'&&round<limit){
   round++;const readyMs=(await state()).possessionCountdownMs??0;if(readyMs>0)await step(readyMs+20);
   await p.locator('body').click({position:{x:3,y:300}});let s=await state();
   if(s.attacker===0){await p.keyboard.press('Space');await step(20);}
   for(let t=0;t<20000&&(await state()).phase==='Possession';t+=100)await step(100);
   for(let t=0;t<2000&&(await state()).phase==='QuestionReady';t+=25)await step(25);
   s=await state();assert(s.phase==='Duel',label+' no question at '+round);
   const stem=(await p.locator('#q-stem-text').innerText()).trim(),q=bank.find(q=>q.stem===stem);assert(q,'Unknown course question');
   const reading=s.duel.readingMs,window=s.duel.answerWindowMs;
   assert(reading>=q.readingMs,'Authored reading protection shortened');
   assert(s.questionTiming.pacePercent===expectedPace,'Unexpected pace before question');
   const expectedWindow=enabled?reading+Math.max(6000,Math.round((12000-reading)*expectedPace/100)):preset==='practice'?60000:12000;
   assert(window===expectedWindow,'Wrong actual deadline: '+window+' expected '+expectedWindow);
   assert(await p.locator('#q-pace-badge').isVisible()===enabled,'Adaptive label mismatch');
   if(s.duel.elapsedMs<reading)assert(await p.locator('#btn-opt-0').isDisabled(),'Reading guard missing');
   for(let i=0;i<4;i++){
    await p.locator('#btn-opt-'+i).scrollIntoViewIfNeeded();const box=await p.locator('#btn-opt-'+i).boundingBox();assert(box.height>=44,'Answer below 44px');
    if(process.env.CHECK_HOST_BADGE==='1'){await p.locator('#nl-badge-frame[data-nl-ready="1"]').waitFor();const badge=await p.locator('#nl-badge-frame').boundingBox();assert(box.y+box.height<badge.y,'Answer overlaps badge');}
   }
   const panel=await p.locator('.question-panel').boundingBox();assert(panel.y>=0,'Question panel clipped above viewport');
   if(round===2||round===7){await p.locator('.question-panel').evaluate(e=>e.scrollTop=0);await photo('question-'+round);}
   await step(Math.max(0,reading-(await state()).duel.elapsedMs)+20);
   const kind=label==='adaptive'?(round===1?'wrong':round===2?'timeout':round===3?'slow':round===7?'medium':'quick'):(round===1?'wrong':'quick');
   if(kind!=='timeout'){
    if(kind==='slow'||kind==='medium')await step(Math.max(0,reading+Math.ceil((window-reading)*(kind==='slow'?.8:.55))-(await state()).duel.elapsedMs));
    const option=q.options.find(o=>kind==='wrong'?o.id!==q.correctOptionId:o.id===q.correctOptionId),opts=await p.locator('#q-options-grid .opt-text').allTextContents();
    await p.click('#btn-opt-'+opts.findIndex(t=>t.trim()===option.text));
    assert(await p.locator('#feedback-overlay').isVisible(),'Immediate answer feedback regressed');
   }
   for(let t=0;t<window+5000&&(await state()).phase!=='Feedback';t+=100)await step(100);
   s=await state();assert(s.phase==='Feedback','No resolved review');assert(s.duel.answerWindowMs===window,'Current deadline moved');
   const after=s.questionTiming.pacePercent;
   if(!enabled)assert(after===100,'Fixed/practice timing adapted');
   else if(label==='adaptive'&&round<=7)assert(after===[120,150,170,170,170,160,160][round-1],'Incorrect adaptive progression');
   else if(kind==='wrong')assert(after>expectedPace,'Wrong answer did not add time');
   assert(after>=60&&after<=250,'Pace outside bounds');
   const note=await p.locator('#fb-wait-status').innerText();
   if(after>expectedPace)assert(note==='Next question: more time','More-time notice missing');
   if(after<expectedPace)assert(note==='Next question: quicker pace','Quicker notice missing');
   if(round<=7)await photo('feedback-'+round);
   if(process.env.CHECK_HOST_BADGE==='1'){
    await p.locator('#btn-next-possession').scrollIntoViewIfNeeded();const box=await p.locator('#btn-next-possession').boundingBox(),badge=await p.locator('#nl-badge-frame').boundingBox();assert(box.height>=44&&box.y+box.height<badge.y,'Continue overlaps badge');
   }
   assert(!await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Horizontal overflow');
   rounds.push({round,question:q.id,kind,readingMs:reading,answerWindowMs:window,paceBefore:expectedPace,paceAfter:after,note});expectedPace=after;
   await p.click('#btn-next-possession');await step(0);
  }
  if(label==='adaptive'){
   assert((await state()).phase==='MatchEnd','Actual match did not finish');
   const download=async(id,file)=>{const [d]=await Promise.all([p.waitForEvent('download'),p.click(id)]);await d.saveAs(out+'/'+file);};
   await download('#btn-export-json','session.json');await download('#btn-export-csv','session.csv');
   const data=JSON.parse(await fs.readFile(out+'/session.json','utf8')),questions=data.events.filter(e=>e.questionId);
   assert(questions.length===rounds.length,'Export question count differs');
   for(let i=0;i<questions.length;i++){
    const timing=questions[i].questionTiming;assert(timing.adaptive&&timing.readingMs===rounds[i].readingMs&&timing.answerWindowMs===rounds[i].answerWindowMs,'Export lost actual timing');
   }
   const csv=await fs.readFile(out+'/session.csv','utf8');assert(csv.split('\n')[0].endsWith('readingMs,answerWindowMs,adaptiveQuestionTiming'),'CSV lacks timing columns');
   report.exports={actualTimingRecorded:true,questions:questions.length,json:true,csv:true};await photo('results');
   await p.click('#btn-results-play-again');await step(0);await p.click('#btn-start-solo');await step(0);
   assert((await state()).questionTiming.pacePercent===100,'New match retained previous pace');
  }
  report.runs.push({label,width,height,adaptive:enabled,rounds});
  await p.close();
 }
 assert(!report.errors.length,'Browser errors');assert(!report.roomRequests,'Solo opened a room');
 await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({base,runs:report.runs.map(r=>({label:r.label,rounds:r.rounds.length})),exports:report.exports,errors:report.errors,roomRequests:report.roomRequests}));
}catch(e){await fs.writeFile(out+'/failure.json',JSON.stringify({...report,error:e.message},null,2));throw e;}finally{await browser.close();}
