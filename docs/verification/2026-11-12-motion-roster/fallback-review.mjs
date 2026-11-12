import {chromium} from '/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const out='output/athlete-roster/fallback'; await fs.mkdir(out,{recursive:true});
const b=await chromium.launch({headless:true,args:['--use-angle=metal']});
const p=await b.newPage({viewport:{width:1440,height:900}}), errors=[];
p.on('pageerror',e=>errors.push(e.message));
try {
 await p.route('**/assets/player/athlete-sky.glb',route=>route.abort());
 await p.goto('http://127.0.0.1:5173');
 await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).playerModels.every(s=>s!=='loading'));
 await p.click('#lobby-character-picker [data-character="1"]');
 await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).playerModels[0]==='fallback');
 await p.click('#btn-start-solo'); await p.evaluate(()=>window.advanceTime(0));
 await p.keyboard.down('KeyD'); await p.evaluate(()=>window.advanceTime(300)); await p.keyboard.up('KeyD');
 const moved=await p.evaluate(()=>JSON.parse(window.render_game_to_text()));
 if(moved.players[0].x<=0||moved.characters[0]!=='Sky')throw Error('Selected fallback did not move');
 await p.keyboard.down('Space'); await p.evaluate(()=>window.advanceTime(1000/60)); await p.keyboard.up('Space');
 const shot=await p.evaluate(()=>JSON.parse(window.render_game_to_text()));
 if(shot.players[0].finishKind!=='jump')throw Error('Fallback did not shoot');
 await p.screenshot({path:out+'/fallback-shoot.png'});
 // A failed download must not poison the session-level asset cache.
 await p.unroute('**/assets/player/athlete-sky.glb');
 await p.click('#btn-return-lobby');
 await p.evaluate(()=>window.advanceTime(0));
 await p.locator('#lobby-character-picker').waitFor();
 await p.click('#lobby-character-picker [data-character="0"]');
 await p.evaluate(()=>window.advanceTime(0));
 await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).playerModels.every(s=>s==='ready'));
 await p.click('#lobby-character-picker [data-character="1"]');
 await p.evaluate(()=>window.advanceTime(0));
 await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).playerModels.every(s=>s==='ready'));
 if(errors.length)throw Error(errors.join(';'));
 await fs.writeFile(out+'/report.json',JSON.stringify({fallbackPlayable:true,failedAssetRetry:true,errors},null,2));
 console.log('Fallback play and retry PASS');
}finally{await b.close();}
