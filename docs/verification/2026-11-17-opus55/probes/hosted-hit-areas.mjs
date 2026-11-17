import {chromium} from '/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const url='https://courtiq-spx101.netlify.app';
const b=await chromium.launch({headless:true,args:['--use-angle=metal']});const report={url,fixture:false,views:[]};
try{for(const [width,height] of [[390,844],[844,390],[667,375]]){
 const p=await b.newPage({viewport:{width,height},hasTouch:true});
 await p.goto(url);await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).playerModels.every(x=>x==='ready'));
 await p.locator('#nl-badge-frame[data-nl-ready="1"]').waitFor();await p.click('#btn-start-solo');await p.evaluate(()=>window.advanceTime(16));
 const badge=await p.locator('#nl-badge-frame').boundingBox();const controls=[];
 for(const id of ['#touch-joystick-base','#btn-touch-shoot','#btn-touch-trick']){
  const box=await p.locator(id).boundingBox();if(!box||box.width<44||box.height<44||box.y+box.height>=badge.y)throw Error('Badge clearance/target failure '+width+' '+id);
  controls.push({id,box,clearancePx:Math.round((badge.y-box.y-box.height)*100)/100});
 }
 report.views.push({width,height,badge,controls});await p.close();
}
const room=await fetch(url+'/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const body=await room.json();if(room.status!==503||body.code!=='MULTIPLAYER_DISABLED')throw Error('Public multiplayer is not disabled');report.publicRoom={status:room.status,code:body.code};
await fs.writeFile('output/opus55-parent/production-badge-geometry.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await b.close();}
