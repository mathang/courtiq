import { BUNDLED_QUESTION_PACKS } from '../../../../content/packRegistry';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../../../shared/rules/matchStateMachine';
const N: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
for (const seed of [1000, 1007, 1014]) {
  const e = new AuthoritativeMatchEngine({ matchId: 'd' + seed, mode: 'solo', pack: BUNDLED_QUESTION_PACKS[0], seed, roomPresetId: 'standard', sessionLengthId: 'standard', aiDifficulty: 'advanced',
    player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'bot', pseudonym: 'CourtBot', isAi: true } });
  e.startMatch(); e.step(16, [{ ...N, shoot: true }, N]);
  let g = 0; while (e.phase !== 'Feedback' && g++ < 5000) e.step(50, [N, N]);
  const id = (e as any).feedbackState?.duelId; e.acknowledgeFeedback(0, id); e.acknowledgeFeedback(1, id);
  g = 0; while (e.phase !== 'Possession' && g++ < 5000) e.step(50, [N, N]);
  let t = 0; let lastMove: string | null = null;
  while (e.phase === 'Possession' && t < 15000) {
    const me = e.players[0], bot = e.players[1];
    const hx = -bot.x, hz = -5.25 - bot.z, hd = Math.hypot(hx, hz) || 1; const gap = Math.min(2.0, hd * 0.6);
    const tx = bot.x + hx / hd * gap, tz = bot.z + hz / hd * gap; const dx = tx - me.x, dz = tz - me.z; const d = Math.hypot(dx, dz);
    e.step(16.667, [d > 0.15 ? { moveX: dx / d, moveZ: dz / d, sprint: d > 1.5, shoot: false } : N, N]); t += 16.667;
    if (bot.streetMove !== lastMove && bot.streetMove) console.log(seed, Math.round(t), 'bot', bot.streetMove, 'dist', Math.hypot(me.x - bot.x, me.z - bot.z).toFixed(2), 'wf', me.wrongFootSec.toFixed(2), 'combo', bot.trickCombo);
    lastMove = bot.streetMove;
  }
  console.log(seed, 'release', e.players[1].finishKind, e.activeDuel?.releaseSnapshot.blockEligibility, 'wf', e.players[0].wrongFootSec.toFixed(2), 'def', e.players[0].defenseAction);
}
