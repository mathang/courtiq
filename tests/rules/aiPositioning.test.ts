import { describe, expect, it } from 'vitest';
import { createAiBasketballBrainState, stepAiBasketballDecision } from '../../shared/rules/aiOpponent';
import { AuthoritativeMatchEngine } from '../../shared/rules/matchStateMachine';
import { createInitialPossessionScoreState } from '../../shared/rules/possession';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
const neutral={moveX:0,moveZ:0,sprint:false,shoot:false};
function match(seed=7,difficulty:'beginner'|'intermediate'|'advanced'='intermediate'){
 const e=new AuthoritativeMatchEngine({matchId:`ai-${seed}`,mode:'solo',pack:BUNDLED_QUESTION_PACKS[0],roomPresetId:'standard',sessionLengthId:'quick',aiDifficulty:difficulty,player0:{id:'a',pseudonym:'Human'},player1:{id:'b',pseudonym:'CourtBot',isAi:true},seed});
 e.scoreState=createInitialPossessionScoreState(1);e.startMatch();return e;
}
function shotTime(e:AuthoritativeMatchEngine,dt=50){
 let t=0;while(e.phase==='Possession'&&t<14000){e.step(dt,[neutral,neutral]);t+=dt;}return t;
}
describe('CourtBot positioning and decisions',()=>{
 it('finishes a contested opportunity at the rim instead of shuffling until the clock expires',()=>{
  const e=match();e.players[1].x=0.7;e.players[1].z=-4;e.players[0].x=0.7;e.players[0].z=-2.9;
  expect(shotTime(e)).toBeLessThan(3500);expect(e.players[1].finishKind).toBe('dunk');
 });
 it('commits to one driving lane when crossing the centre line',()=>{
  const brain=createAiBasketballBrainState(()=>0.1);brain.wantsDunk=true;
  const params={brain,isAttacker:true,aiPos:{x:0.01,z:1},opponentPos:{x:0,z:-1},movementClockRemainingMs:14000,difficulty:'intermediate' as const,deltaSec:0.05,rng:()=>0.1};
  stepAiBasketballDecision(params);const lane=brain.targetSpot.x;
  stepAiBasketballDecision({...params,aiPos:{x:-0.01,z:0.9}});
  expect(Math.sign(brain.targetSpot.x)).toBe(Math.sign(lane));
 });
 it.each(['beginner','intermediate','advanced'] as const)('%s creates a shot against a stationary lane defender across multiple seeds',difficulty=>{
  for(let seed=1;seed<=12;seed++){
   const e=match(seed,difficulty);e.players[0].x=0;e.players[0].z=-1.8;
   expect(shotTime(e),`seed ${seed}`).toBeLessThan(6500);
   expect(e.activeDuel).not.toBeNull();
  }
 });
});

describe('CourtBot recovery and defensive judgement',()=>{
 it('routes sideways around a planted defender rather than pushing straight through',()=>{
  const brain=createAiBasketballBrainState(()=>0.1);
  const input=stepAiBasketballDecision({brain,isAttacker:true,aiPos:{x:0,z:2.6},opponentPos:{x:0,z:0.6},movementClockRemainingMs:14000,difficulty:'intermediate',deltaSec:0.05});
  expect(Math.abs(input.moveX)).toBeGreaterThan(0.2);
 });
 it('gets back out of the baseline area when the attacker moves to a wing',()=>{
  const e=match();e.scoreState=createInitialPossessionScoreState(0);
  e.players[1].x=0;e.players[1].z=-5.8;e.players[0].x=4;e.players[0].z=1.5;
  for(let t=0;t<2000;t+=50)e.step(50,[neutral,neutral]);
  expect(e.players[1].z).toBeGreaterThan(-3);expect(e.players[1].x).toBeGreaterThan(1.5);
 });
 it('only risks a swipe when the ball is reachable, facing the right way and defense is available',()=>{
  const e=match();const bot=e.players[1],human=e.players[0];bot.x=0;bot.z=0;bot.facingAngle=0;human.x=0;human.z=0.9;
  const params={isAttacker:false,aiPos:bot,opponentPos:human,movementClockRemainingMs:14000,difficulty:'intermediate' as const,deltaSec:0.05,self:bot,opponent:human,ballPos:{x:0,z:0.7,y:0.8},rng:()=>0.1};
  const intent=()=>{const brain=createAiBasketballBrainState(()=>0.1);brain.defenseTimerSec=0;return stepAiBasketballDecision({...params,brain});};
  expect(intent().defense).toBe('swipe');
  for(const field of ['defenseCooldownSec','defenseRecoverySec','wrongFootSec'] as const){bot[field]=1;expect(intent().defense).toBeUndefined();bot[field]=0;}
  bot.facingAngle=Math.PI;expect(intent().defense).toBeUndefined();bot.facingAngle=0;
  human.streetMove='spin';expect(intent().defense).toBeUndefined();human.streetMove=null;
  params.ballPos.x=2;expect(intent().defense).toBeUndefined();
 });
 it.each([16.667,50,100])('recovers and finishes without camping at a %sms simulation step',dt=>{
  const e=match(15);e.players[1].x=0;e.players[1].z=-5.8;e.players[0].x=0;e.players[0].z=-3.2;
  expect(shotTime(e,dt)).toBeLessThan(5000);expect(e.players[1].z).toBeGreaterThanOrEqual(-4.7);
 });
 it('chains a second distinct trick on advanced difficulty and punishes missed human swipes',()=>{
  const e=match(21,'advanced');
  const bot=e.players[1],human=e.players[0];
  bot.x=0.2;bot.z=0.8;bot.sprintStamina=1;
  human.x=0.2;human.z=-0.7;
  let maxCombo=0;
  for(let t=0;t<3600&&e.phase==='Possession';t+=16.667){
   e.step(16.667,[neutral,neutral]);
   maxCombo=Math.max(maxCombo,bot.trickCombo);
  }
  expect(maxCombo).toBeGreaterThanOrEqual(2);

  const brain=createAiBasketballBrainState(()=>0.95);
  expect(brain.wantsDunk).toBe(false);
  human.defenseResult='miss';
  human.defenseRecoverySec=0.85;
  const intent=stepAiBasketballDecision({
   brain,isAttacker:true,aiPos:{x:0,z:1.2},opponentPos:{x:0,z:-0.2},
   movementClockRemainingMs:12000,difficulty:'advanced',deltaSec:0.05,self:bot,opponent:human
  });
  expect(brain.wantsDunk).toBe(true);
  expect(intent.sprint).toBe(true);
 });
});
