// Framing probe: measures projected athlete height (px) and HUD height at fixed normal-input moments in 3 viewports.
import {chromium} from '/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const base=process.env.COURTIQ_URL||'http://127.0.0.1:4185',out=process.env.REVIEW_OUT||'output/opus55-review/framing-baseline';
await fs.mkdir(out,{recursive:true});
const b=await chromium.launch({headless:true,args:['--use-angle=metal']});const report={base,views:[],errors:[]};
const views=[['desktop',1440,900],['portrait',390,844],['landscape',844,390],['landscape-se',667,375]];
try{for(const [label,width,height] of views){
 const touch=width<900;const p=await b.newPage({viewport:{width,height},hasTouch:touch});p.on('pageerror',e=>report.errors.push(label+': '+e.message));
 const state=()=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));const step=ms=>p.evaluate(ms=>window.advanceTime(ms),ms);
 await p.goto(base);await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).playerModels.every(x=>x==='ready'));
 await p.click('#btn-start-solo');await step(0);
 const measure=async(tag)=>{const s=await state();const sub=s.presentation.camera.subjects;const hud=await p.locator('#hud-top').boundingBox();
  const h=i=>Math.round((sub[i*2].y-sub[i*2+1].y)*height);
  const r={tag,attackerPx:h(0),defenderPx:sub.length>=5?h(1):null,hoopY:Math.round(sub[sub.length-1].y*height),feetY:Math.round(sub[0].y*height),hudBottom:Math.round(hud.y+hud.height),hudHeight:Math.round(hud.height),camera:s.presentation.camera.mode};
  await p.screenshot({path:`${out}/${label}-${tag}.png`});return r;};
 await step(1200);const start=await measure('start');
 // normal input: drive a little at an angle so the camera reaches the 'drive' framing
 await p.keyboard.down('KeyW');await p.keyboard.down('KeyD');await step(450);await p.keyboard.up('KeyD');await step(250);const drive=await measure('drive');await p.keyboard.up('KeyW');
 report.views.push({label,width,height,start,drive});await p.close();
}}finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await b.close();}
console.log(JSON.stringify(report,null,1));
