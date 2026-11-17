// Exploratory baseline play: normal inputs only. Captures screenshots + state at intervals.
import {chromium} from '/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const base=process.env.COURTIQ_URL||'http://127.0.0.1:4185',out=process.env.REVIEW_OUT||'output/opus55-review/baseline';
await fs.mkdir(out,{recursive:true});
const b=await chromium.launch({headless:true,args:['--use-angle=metal']});
const report={base,runs:[],errors:[]};
const views=(process.env.VIEWS||'desktop:1440x900,portrait:390x844,landscape:844x390').split(',').map(v=>{const[l,s]=v.split(':');const[w,h]=s.split('x').map(Number);return{label:l,width:w,height:h};});
try{
 for(const {label,width,height} of views){
  const touch=width<900;
  const p=await b.newPage({viewport:{width,height},hasTouch:touch,isMobile:touch&&width<height});
  p.on('pageerror',e=>report.errors.push(label+': '+e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(label+' console: '+m.text());});
  const state=()=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));const step=ms=>p.evaluate(ms=>window.advanceTime(ms),ms);
  let shot=0;const photo=async n=>{await p.screenshot({path:`${out}/${label}-${String(shot++).padStart(2,'0')}-${n}.png`});};
  await p.goto(base);await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).playerModels.every(x=>x==='ready'));
  await step(100);await photo('lobby');
  await p.click('#btn-start-solo');await step(0);await step(300);await photo('opening');
  let s=await state();
  const log=[];
  // Play 4 possessions with simple heuristics.
  for(let poss=0;poss<4;poss++){
   s=await state();
   const human=s.attacker===0;
   const rec={poss,human,events:[]};
   if(human){
    // Drive straight at the rim with sprint, try a trick midway, then press primary when in paint.
    await p.keyboard.down('KeyW');await p.keyboard.down('ShiftLeft');
    let t=0,minSep=99,tricked=false;
    for(;t<240;t++){
     await step(1000/60);s=await state();
     if(s.phase!=='Possession')break;
     const me=s.players[0],bot=s.players[1];const sep=Math.hypot(me.x-bot.x,me.z-bot.z);minSep=Math.min(minSep,sep);
     if(t%30===0)rec.events.push({t,me:[+me.x.toFixed(2),+me.z.toFixed(2)],bot:[+bot.x.toFixed(2),+bot.z.toFixed(2)],sep:+sep.toFixed(2),vel:me.vx!==undefined?[me.vx,me.vz]:undefined});
     if(t===20&&!tricked){await p.keyboard.press('KeyC');tricked=true;}
     if(t===45||t===90)await photo(`p${poss}-drive-${t}`);
     if(me.z<-1.6&&Math.abs(me.x)<2.4){await p.keyboard.press('Space');rec.events.push({t,primary:true,me:[me.x,me.z],sep});break;}
    }
    await p.keyboard.up('KeyW');await p.keyboard.up('ShiftLeft');
    rec.minSep=minSep;
    await step(300);s=await state();await photo(`p${poss}-after-primary`);rec.finish=s.players[0].finishKind;rec.phase=s.phase;
   }else{
    // Defend: chase between bot and hoop, press Space when bot is close & gathering.
    let t=0;
    for(;t<600;t++){
     s=await state();if(s.phase!=='Possession')break;
     const me=s.players[0],bot=s.players[1];const tx=bot.x*0.7,tz=bot.z+(-5.25-bot.z)*0.3;
     const dx=tx-me.x,dz=tz-me.z;const keys=[];if(dx>0.25)keys.push('KeyD');if(dx<-0.25)keys.push('KeyA');if(dz<-0.25)keys.push('KeyW');if(dz>0.25)keys.push('KeyS');
     for(const k of['KeyW','KeyA','KeyS','KeyD'])if(keys.includes(k))await p.keyboard.down(k);else await p.keyboard.up(k);
     await step(1000/60);
     const sep=Math.hypot(me.x-bot.x,me.z-bot.z);
     if(t%30===0)rec.events.push({t,me:[+me.x.toFixed(2),+me.z.toFixed(2)],bot:[+bot.x.toFixed(2),+bot.z.toFixed(2)],sep:+sep.toFixed(2),botMove:bot.streetMove,botFinish:bot.finishKind});
     if(t===60||t===150)await photo(`p${poss}-defend-${t}`);
     if(sep<1.6&&t%45===20){await p.keyboard.press('KeyC');rec.events.push({t,swipe:true,sep});}
    }
    for(const k of['KeyW','KeyA','KeyS','KeyD'])await p.keyboard.up(k);
    s=await state();rec.phase=s.phase;rec.botFinish=s.players[1].finishKind;
    await p.keyboard.press('Space');await step(200);await photo(`p${poss}-block-try`);
   }
   // Question
   for(let n=0;n<80&&(await state()).phase!=='Duel'&&(await state()).phase!=='Feedback';n++)await step(50);
   s=await state();
   if(s.phase==='Duel'){
    await photo(`p${poss}-duel-read`);
    await step(Math.max(0,s.duel.readingMs-s.duel.elapsedMs)+600);
    await photo(`p${poss}-duel-answer`);
    await p.click('#btn-opt-'+(poss%4));await step(50);await photo(`p${poss}-locked`);
   }
   for(let n=0;n<200&&(await state()).phase!=='Feedback';n++)await step(100);
   for(let n=0;n<60&&await p.locator('#btn-next-possession').isDisabled().catch(()=>true);n++)await step(100);
   await photo(`p${poss}-feedback`);rec.score=(await state()).score;
   await p.click('#btn-next-possession');await step(16);await photo(`p${poss}-countdown`);
   await step(2050);await photo(`p${poss}-live`);
   log.push(rec);
  }
  report.runs.push({label,log});await p.close();
 }
}finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await b.close();}
console.log(JSON.stringify(report).slice(0,4000));
