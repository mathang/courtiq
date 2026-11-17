import { BUNDLED_QUESTION_PACKS } from '../../../../content/packRegistry';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../../../shared/rules/matchStateMachine';
import { canStealBall } from '../../../../shared/rules/defense';
const N: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
const e = new AuthoritativeMatchEngine({ matchId: 'trace', mode: 'solo', pack: BUNDLED_QUESTION_PACKS[0], seed: 5013, roomPresetId: 'standard', sessionLengthId: 'standard', aiDifficulty: 'intermediate',
  player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'bot', pseudonym: 'CourtBot', isAi: true } });
e.startMatch(); const dt = 1000 / 60;
for (let i = 0; i < 120 && e.phase === 'Possession' && e.scoreState.currentAttacker === 0; i++) {
  const t = i * dt; const inp = t < 300 ? N : { moveX: 0, moveZ: -1, sprint: true, shoot: false };
  e.step(dt, [inp, N]);
  const a = e.players[0], b = e.players[1], ball = e.getBallPosition3D();
  if (i % 3 === 0) console.log(Math.round(t), 'att', a.x.toFixed(2), a.z.toFixed(2), 'v', Math.hypot(a.vx, a.vz).toFixed(1), 'bot', b.x.toFixed(2), b.z.toFixed(2), 'sep', Math.hypot(a.x - b.x, a.z - b.z).toFixed(2), 'hand', a.dribbleHand, 'ballToDef', Math.hypot(ball.x - b.x, ball.z - b.z).toFixed(2), 'steal?', canStealBall(b, a, ball), 'def', b.defenseAction, b.defenseResult);
}
console.log('end', e.phase, 'attacker', e.scoreState.currentAttacker);
