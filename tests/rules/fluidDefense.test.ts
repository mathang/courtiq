import { describe, expect, it } from 'vitest';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../shared/rules/matchStateMachine';
import { COURT_GEOMETRY, MOVEMENT_CONFIG } from '../../shared/config/balance';
import { resolvePlayerContact } from '../../shared/rules/contact';
const N: PlayerMoveInput = {moveX:0,moveZ:0,sprint:false,shoot:false};
function match(){const e=new AuthoritativeMatchEngine({matchId:'fluid',mode:'solo',pack:BUNDLED_QUESTION_PACKS[0],seed:15,roomPresetId:'standard',sessionLengthId:'standard',player0:{id:'a',pseudonym:'A'},player1:{id:'b',pseudonym:'B',isAi:false}});e.startMatch();return e;}
function advance(e:AuthoritativeMatchEngine,ms:number,a=N,b=N,dt=1000/60){for(let t=0;t<ms;t+=dt)e.step(Math.min(dt,ms-t),[a,b]);}

describe('Fluid defensive steering and body contact',()=>{
 it.each([1000/60,1000/30,100])('keeps a wrong-footed defender moving at a %sms step',dt=>{
  const e=match();e.players[0].x=-4;e.players[1].x=0;e.players[1].wrongFootSec=.44;
  advance(e,300,N,{...N,moveX:1},dt);
  expect(e.players[1].wrongFootSec).toBeGreaterThan(0);
  expect(e.players[1].x).toBeGreaterThan(1.3);
 });
 it.each([1000/60,1000/30,100])('lets a defender steer through a jump and landing recovery at a %sms step',dt=>{
  const e=match();e.players[0].x=-4;e.players[1].x=0;
  e.step(dt,[N,{...N,moveX:1,defense:'jump'}]);advance(e,300-dt,N,{...N,moveX:1},dt);
  expect(e.players[1].defenseAction).toBe('jump');expect(e.players[1].x).toBeGreaterThan(.95);
 });
 it('lets a defender bump a stationary ball-handler without becoming an invisible wall',()=>{
  const e=match();Object.assign(e.players[0],{x:0,z:0});Object.assign(e.players[1],{x:-1,z:0});
  advance(e,800,N,{...N,moveX:1});
  expect(e.players[0].x).toBeGreaterThan(.6);expect(e.players[1].x).toBeGreaterThan(0);
  expect(e.players[0].x-e.players[1].x).toBeGreaterThanOrEqual(.69999);
 });
 it('preserves sliding around a body instead of cancelling the movement vector',()=>{
  const e=match();Object.assign(e.players[0],{x:0,z:0});Object.assign(e.players[1],{x:-1,z:0});
  advance(e,700,N,{...N,moveX:1,moveZ:1});
  expect(e.players[1].z).toBeGreaterThan(2);expect(e.players[1].x).toBeGreaterThan(1);
 });
 it.each([1000/60,100,250])('prevents tunnelling and deep clipping during opposing pressure at a %sms step',dt=>{
  const e=match();Object.assign(e.players[0],{x:1,z:0});Object.assign(e.players[1],{x:-1,z:0});
  for(let t=0;t<1500;t+=dt){
   e.step(dt,[{...N,moveX:-1,sprint:true},{...N,moveX:1,sprint:true}]);
   expect(e.players[0].x-e.players[1].x).toBeGreaterThanOrEqual(.69999);
   expect(Math.abs(e.players[0].x)).toBeLessThan(1.1);
  }
 });
 it('separates coincident bodies at a corner without leaving the court or producing NaN',()=>{
  const e=match();for(const p of e.players)Object.assign(p,{x:COURT_GEOMETRY.maxX,z:COURT_GEOMETRY.maxZ});
  resolvePlayerContact(e.players[0],e.players[1],1/120);
  expect(Math.hypot(e.players[1].x-e.players[0].x,e.players[1].z-e.players[0].z)).toBeGreaterThanOrEqual(MOVEMENT_CONFIG.minPlayerSeparationM-MOVEMENT_CONFIG.contactCompressionM-1e-6);
  for(const p of e.players){expect(Number.isFinite(p.x+p.z+p.vx+p.vz)).toBe(true);expect(p.x).toBeLessThanOrEqual(COURT_GEOMETRY.maxX);expect(p.z).toBeLessThanOrEqual(COURT_GEOMETRY.maxZ);}
 });
 it('keeps the deliberate missed-swipe root and stops draining sprint while rooted',()=>{
  const e=match();Object.assign(e.players[1],{x:4,z:0,sprintStamina:.8});const before=e.players[1].x;
  e.step(10,[N,{...N,defense:'swipe',moveX:-1,sprint:true}]);advance(e,850,N,{...N,moveX:-1,sprint:true});
  expect(e.players[1].defenseResult).toBe('miss');expect(e.players[1].x).toBe(before);expect(e.players[1].isSprinting).toBe(false);expect(e.players[1].sprintStamina).toBeGreaterThanOrEqual(.68);
  advance(e,300,N,{...N,moveX:-1});expect(e.players[1].x).toBeLessThan(before-.3);
 });
 it('keeps court positions frozen during the shared question rather than changing teaching timing',()=>{
  const e=match();e.initiateShotAttempt({...N,shoot:true});const positions=e.players.map(p=>({x:p.x,z:p.z}));
  advance(e,4000,{...N,moveX:1},{...N,moveZ:1});
  expect(e.phase).toBe('Duel');expect(e.players.map(p=>({x:p.x,z:p.z}))).toEqual(positions);
 });
});
