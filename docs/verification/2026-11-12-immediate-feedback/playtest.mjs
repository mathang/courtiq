import {chromium} from '/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const base=process.env.COURTIQ_URL||'http://127.0.0.1:4173';
const out=process.env.REVIEW_OUT||'output/pedagogy/local';await fs.mkdir(out,{recursive:true});
const bank=(await Promise.all((await fs.readdir('content/approved-packs')).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await fs.readFile('content/approved-packs/'+f,'utf8')).questions))).flat();
const b=await chromium.launch({headless:true,args:['--use-angle=metal']});
const report={base,flows:[],errors:[],roomRequests:0};const assert=(v,m)=>{if(!v)throw Error(m);};
try{
 for(const [width,height,label]of [[1440,900,'desktop'],[390,844,'phone'],[844,390,'landscape']]){
  const p=await b.newPage({viewport:{width,height},hasTouch:label!=='desktop'});
  p.on('pageerror',e=>report.errors.push(e.message));p.on('request',r=>{if(r.url().includes('/api/room'))report.roomRequests++;});
  const state=()=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));const step=ms=>p.evaluate(ms=>window.advanceTime(ms),ms);
  const photo=async name=>p.screenshot({path:out+'/'+label+'-'+name+'.png'});
  await p.goto(base);await p.waitForFunction(()=>window.advanceTime&&JSON.parse(window.render_game_to_text()).playerModels.every(s=>s==='ready'));await step(0);
  await p.locator('#lobby-options > summary').click();await p.selectOption('#select-ai-difficulty','beginner');await p.selectOption('#select-session-length','practice');await p.locator('#lobby-options > summary').click();
  await p.click('#btn-start-solo');await step(0);
  let round=0;const missedQuestions=new Set();
  while((await state()).phase!=='MatchEnd'&&round<(label==='desktop'?32:2)){
   round++;await p.locator('body').click({position:{x:3,y:300}});
   let s=await state();
   if(s.attacker===0){await p.keyboard.press('Space');await step(20);}
   for(let t=0;t<20000&&(await state()).phase==='Possession';t+=100)await step(100);
   for(let t=0;t<2000&&(await state()).phase==='QuestionReady';t+=25)await step(25);
   s=await state();assert(s.phase==='Duel',label+' question missing at round '+round);
   const stem=(await p.locator('#q-stem-text').innerText()).trim(),q=bank.find(q=>q.stem===stem);assert(q,'Question not found');
   assert(await p.locator('#feedback-overlay').isHidden(),'Feedback leaked before answer');
   if(s.duel.elapsedMs<s.duel.readingMs){
    assert(await p.locator('#btn-opt-0').isDisabled(),'Reading protection removed');
    await p.keyboard.press('Digit1');assert(await p.locator('#feedback-overlay').isHidden(),'Reading key revealed answer');
   }
   await step(Math.max(0,s.duel.readingMs-s.duel.elapsedMs)+20);
   const timeout=label==='desktop'&&round===4,late=label==='desktop'&&round===3;
   const wrong=label==='desktop'?(round===2||round===8):round===1;
   if(wrong||timeout)missedQuestions.add(q.id);
   const selected=q.options.find(o=>wrong?o.id!==q.correctOptionId:o.id===q.correctOptionId);
   if(late){for(let t=0;t<12000&&!(await state()).duel.submitted[1];t+=25)await step(25);assert((await state()).duel.submitted[1],'Bot did not answer first');}
   if(!timeout){
    const opts=await p.locator('#q-options-grid .opt-text').allTextContents();
    const idx=opts.findIndex(x=>x.trim()===selected.text);
    if(round===1&&label==='desktop')await p.keyboard.press('Digit'+(idx+1));else await p.locator('#btn-opt-'+idx).click();
    s=await state();assert(await p.locator('#feedback-overlay').isVisible(),'Immediate feedback absent');
    assert(await p.locator('#question-overlay').isHidden(),'Question/options repeat after answer');
    assert(s.learningReview.status===(wrong?'incorrect':'correct'),'Personal status wrong');
    assert(await p.locator('#fb-choice-reason').innerText()===(wrong?q.optionFeedback[selected.id]:q.explanation),'Teaching point incorrect');
    assert(await p.locator('#fb-correct-line').isVisible()===wrong,'Correct answer unnecessarily repeated or missing');
    assert(await p.locator('#fb-detail').evaluate(e=>!e.open),'Details opened without request');
    if(!late){assert(s.phase==='Duel'&&!s.duel.submitted[1],'Bot was not pending');assert(await p.locator('#btn-next-possession').isDisabled(),'Continue active before outcome');assert(!(await p.locator('#fb-wait-status').innerText()).includes('resolving'),'Pending status incorrect');}
    const text=await p.locator('.fb-learning-box').innerText();await photo('round-'+round+'-immediate');
    assert(!text.includes(stem),'Full question repeats by default');
    await p.locator('#fb-detail > summary').click();assert(await p.locator('#fb-question-text').innerText()===stem,'Question review missing');assert((await p.locator('#fb-source-ref').innerText()).includes(q.sourceRef),'Course source missing');
    await photo('round-'+round+'-detail');
    if(wrong)assert((await p.locator('#fb-your-answer').innerText()).includes(selected.text),'Chosen wrong answer missing');
    report.flows.push({viewport:label,round,question:q.id,wrong,late,immediatePhase:s.phase,botPending:!s.duel.submitted[1],visibleReviewWords:text.split(/\s+/).length});
   }
   for(let t=0;t<22000&&(await state()).phase!=='Feedback';t+=100)await step(100);
   s=await state();assert(s.phase==='Feedback','Final feedback missing');
   assert(await p.locator('#btn-next-possession').isEnabled(),'Continue still disabled');
   if(timeout){assert(s.learningReview.status==='unanswered','No-answer feedback wrong');assert(await p.locator('#fb-choice-reason').innerText()===q.explanation,'No-answer teaching point missing');await photo('timeout');}
   else assert(await p.locator('#fb-detail').evaluate(e=>e.open),'Opened details lost during bot/shot transition');
   if(label==='desktop'&&round>=5&&round<=8){assert(s.players[0].correctAnswerStreak===(round===8?0:round-4),'Fire streak incorrect');assert(s.players[0].onFire===(round===7),'Fire ignition/reset incorrect');}
   await step(15000);assert((await state()).phase==='Feedback','Review dismissed itself');
   if(!timeout)await p.locator('#fb-detail > summary').click();
   if(round<=4||round===7||round===8)await photo('round-'+round+'-final');
   if(process.env.CHECK_HOST_BADGE==='1'){
    const badge=p.locator('#nl-badge-frame[data-nl-ready="1"]');await badge.waitFor();
    await p.locator('#btn-next-possession').scrollIntoViewIfNeeded();
    const bb=await badge.boundingBox(),cb=await p.locator('#btn-next-possession').boundingBox();
    assert(cb.height>=44&&cb.y+cb.height<bb.y,'Continue overlaps hosting badge');
   }
   assert(!await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Horizontal overflow');
   await p.click('#btn-next-possession');await step(0);
   assert(await p.locator('#feedback-overlay').isHidden(),'Stale review survived Continue');
  }
  if(label==='desktop'){
   assert((await state()).phase==='MatchEnd','No actual end-of-match result');
   const items=p.locator('#res-review-list > details');assert(await items.count()>0,'Folded review list missing');
   assert(await items.evaluateAll(es=>es.every(e=>!e.open)),'Answers exposed before retrieval');
   assert((await items.first().innerText()).includes('Revisit')||(await items.first().innerText()).includes('Unanswered'),'Missed questions not first');
   await photo('results');await items.first().locator('summary').click();await photo('results-detail');
   const count=await p.locator('#btn-practice-missed').innerText();assert(count.includes('missed question'),'Retry count missing');
   await p.locator('#btn-practice-missed').scrollIntoViewIfNeeded();await p.click('#btn-practice-missed');await step(0);assert((await state()).phase==='Possession','Missed-question practice failed');
   await p.locator('body').click({position:{x:3,y:300}});await p.keyboard.press('Space');await step(20);for(let t=0;t<2000&&(await state()).phase==='QuestionReady';t+=25)await step(25);
   const retryStem=await p.locator('#q-stem-text').innerText(),retry=bank.find(q=>q.stem===retryStem.trim());
   assert(retry&&missedQuestions.has(retry.id),'Retry question was not one of this learner’s missed/unanswered items');
   await photo('retry');report.results={rounds:round,retryButton:count,retryQuestion:retry.id};
  }
  await p.close();
 }
 assert(!report.errors.length,'Page errors: '+report.errors.join(';'));assert(!report.roomRequests,'Solo made room requests');
 await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({base,flows:report.flows.length,results:report.results,errors:report.errors,roomRequests:report.roomRequests}));
}catch(e){await fs.writeFile(out+'/failure.json',JSON.stringify({...report,error:e.message},null,2));throw e;}finally{await b.close();}
