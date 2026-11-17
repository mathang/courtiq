// Idle attacker: how often does CourtBot steal from a ball-handler who has not moved yet?
import { BUNDLED_QUESTION_PACKS } from '../../../../content/packRegistry';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../../../shared/rules/matchStateMachine';
import type { AiDifficultyId } from '../../../../shared/config/balance';
const N: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
for (const diff of ['beginner', 'intermediate', 'advanced'] as AiDifficultyId[]) {
  const times: number[] = []; let n = 0;
  for (let i = 0; i < 100; i++) {
    const e = new AuthoritativeMatchEngine({ matchId: 'idle' + i, mode: 'solo', pack: BUNDLED_QUESTION_PACKS[0], seed: 9000 + i * 17, roomPresetId: 'standard', sessionLengthId: 'standard', aiDifficulty: diff,
      player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'bot', pseudonym: 'CourtBot', isAi: true } });
    e.startMatch(); let t = 0;
    while (t < 3000 && e.scoreState.currentAttacker === 0 && e.phase === 'Possession') { e.step(1000 / 60, [N, N]); t += 1000 / 60; }
    n++; if (e.scoreState.currentAttacker === 1) times.push(t);
  }
  times.sort((a, b) => a - b);
  console.log(diff, 'stolen within 3s while idle:', times.length + '/' + n, 'within 1.5s:', times.filter(t => t <= 1500).length, 'median ms', Math.round(times[Math.floor(times.length / 2)] ?? NaN));
}
