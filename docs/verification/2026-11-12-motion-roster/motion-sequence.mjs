import {chromium} from '/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const base=process.env.COURTIQ_URL||'http://127.0.0.1:4173',out=process.env.REVIEW_OUT||'output/athlete-roster/sequence-compiled';
await fs.mkdir(out,{recursive:true});
const bank=(await Promise.all((await fs.readdir('content/approved-packs')).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await fs.readFile('content/approved-packs/'+f,'utf8')).questions))).flat();
const b=await chromium.launch({headless:true,args:['--use-angle=metal']}); const report={base,runs:[],errors:[]};
const assert=(v,m)=>{if(!v)throw Error(m);};
try {
 for(const [id,name,count,move,width,height] of [[0,'River',1,'crossover',1440,900],[1,'Sky',2,'spin',390,844]]) {
  const p=await b.newPage({viewport:{width,height},hasTouch:width===390});p.on('pageerror',e=>report.errors.push(e.message));
  const state=()=>p.evaluate(()=>JSON.parse(window.render_game_to_text())),step=ms=>p.evaluate(ms=>window.advanceTime(ms),ms),frames=[];
  async function photo(label){const s=await state(),file=`${name}-${label}.png`;await p.screenshot({path:out+'/'+file});frames.push({label,file,state:s});return s;}
  await p.goto(base);await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).playerModels.every(x=>x==='ready'));
  await p.click(`#lobby-character-picker [data-character="${id}"]`);await p.locator('#lobby-options > summary').click();await p.selectOption('#select-ai-difficulty','beginner');await p.selectOption('#select-session-length','practice');await p.locator('#lobby-options > summary').click();
  await p.click('#btn-start-solo');await step(0);await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).playerModels.every(x=>x==='ready'));
  for(let n=0;n<count;n++){await p.keyboard.press('KeyC');await step(50);}await step(500-count*50);
  assert((await state()).players[0].streetMove===move,'Trick selection failed');await photo('trick-entry');
  await step(150);await photo('trick-mid');
  // Steer back from the lateral trick burst, then attack the blue lane with normal keys.
  for(let n=0;n<90&&(await state()).players[0].streetMove;n++)await step(1000/60);
  let s=await state();const lateral=s.players[0].x>1.25?'KeyA':s.players[0].x < -1.25?'KeyD':null;
  if(lateral){await p.keyboard.down(lateral);for(let n=0;n<120;n++){await step(1000/60);s=await state();if(Math.abs(s.players[0].x)<1.25)break;}await p.keyboard.up(lateral);}
  await p.keyboard.down('KeyW');await p.keyboard.down('ShiftLeft');
  for(let n=0;n<180;n++){await step(1000/60);s=await state();assert(s.phase==='Possession','Possession interrupted before dunk');if(s.players[0].z < -1.25 && Math.abs(s.players[0].x)<2.44)break;}
  await photo('paint-drive');assert(s.players[0].z < -1.25 && s.players[0].z > -6.5 && Math.abs(s.players[0].x)<2.44,'Did not reach paint');
  await p.keyboard.down('Space');await step(1000/60);await p.keyboard.up('Space');await p.keyboard.up('KeyW');await p.keyboard.up('ShiftLeft');
  s=await photo('gather');assert(s.players[0].finishKind==='dunk','Primary action did not dunk');const style=s.players[0].dunkStyle;
  for(const [ms,label]of [[100,'gather-100'],[120,'takeoff-220'],[180,'takeoff-400'],[180,'flight-580']]){await step(ms);await photo(label);}
  for(let n=0;n<40&&(await state()).phase==='QuestionReady';n++)await step(25);
  await step(300);s=await photo('duel-hang');assert(s.phase==='Duel','No question duel');
  if(process.env.CHECK_HOST_BADGE==='1'){
   await p.locator('#nl-badge-frame[data-nl-ready="1"]').waitFor();
   for(let i=0;i<4;i++){const btn=p.locator('#btn-opt-'+i);await btn.scrollIntoViewIfNeeded();const box=await btn.boundingBox(),badge=await p.locator('#nl-badge-frame').boundingBox();assert(box.height>=44&&box.y+box.height<badge.y,'Answer overlaps hosting badge');}
   await photo('answers-clear');
  }
  const stem=(await p.locator('#q-stem-text').innerText()).trim();const q=bank.find(q=>q.stem===stem);
  assert(q,'Question missing');const correct=q.options.find(o=>o.id===q.correctOptionId).text;
  await step(Math.max(0,s.duel.readingMs-s.duel.elapsedMs)+50);const opts=await p.locator('#q-options-grid .opt-text').allTextContents();await p.click('#btn-opt-'+opts.findIndex(o=>o.trim()===correct));
  for(let n=0;n<120&&!['Resolution','Feedback'].includes((await state()).phase);n++)await step(100);
  s=await photo('resolution-entry');assert(s.phase==='Resolution','Missed landing sequence');
  for(let n=0;n<15;n++){await step(50);if(n%2===0)await photo('landing-'+n);if((await state()).phase==='Feedback')break;}
  for(let n=0;n<30&&(await state()).phase!=='Feedback';n++)await step(100);
  await photo('feedback');assert((await state()).phase==='Feedback','Feedback missing');await p.click('#btn-next-possession');await step(10);
  assert((await state()).attacker===1,'CourtBot did not receive possession');
  let botTravel=0,prev=(await state()).players[1];
  for(let n=0;n<180;n++){await step(50);s=await state();botTravel+=Math.hypot(s.players[1].x-prev.x,s.players[1].z-prev.z);prev=s.players[1];if(n%20===0)await photo('bot-'+n);if(s.phase!=='Possession')break;}
  assert(botTravel>1,'CourtBot did not move');assert(s.phase==='QuestionReady'||s.phase==='Duel','CourtBot did not finish its drive');
  report.runs.push({name,move,style,botTravelM:botTravel,botFinish:s.players[1].finishKind,frames});await p.close();
 }
 assert(!report.errors.length,report.errors.join(';'));await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({base,runs:report.runs.map(({frames,...x})=>({...x,frames:frames.length})),errors:report.errors}));
}catch(e){await fs.writeFile(out+'/failure.json',JSON.stringify({...report,error:e.message},null,2));throw e;}finally{await b.close();}
