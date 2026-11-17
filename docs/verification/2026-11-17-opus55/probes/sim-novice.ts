// Browser-like novice offence: sprint at the rim, tap trick once (fires after the 500ms tap window), then dunk in paint.
import { BUNDLED_QUESTION_PACKS } from '../../../../content/packRegistry';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../../../shared/rules/matchStateMachine';
import { isDrivingInPaint } from '../../../../shared/rules/finishing';
import type { AiDifficultyId } from '../../../../shared/config/balance';
const N: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
const tapAt = Number(process.env.TAP_MS ?? 333); const idle = Number(process.env.IDLE_MS ?? 0);
for (const diff of ['beginner', 'intermediate', 'advanced'] as AiDifficultyId[]) {
  let elig = 0, rel = 0; const tally: Record<string, number> = {}; const afterSteal: number[] = []; let afterStealElig = 0, afterStealN = 0;
  for (let i = 0; i < 80; i++) {
    const e = new AuthoritativeMatchEngine({ matchId: 'n' + i, mode: 'solo', pack: BUNDLED_QUESTION_PACKS[0], seed: 5000 + i * 13, roomPresetId: 'standard', sessionLengthId: 'standard', aiDifficulty: diff,
      player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'bot', pseudonym: 'CourtBot', isAi: true } });
    e.startMatch(); const dt = 1000 / 60; let t = 0; let stolenAt: number | null = null;
    while (t < 15000) {
      if (e.phase !== 'Possession') break;
      const me = e.players[0];
      if (e.scoreState.currentAttacker === 1) { // live turnover: human tries to recover goal-side
        if (stolenAt === null) stolenAt = t;
        const bot = e.players[1]; const hx = -bot.x, hz = -5.25 - bot.z, hd = Math.hypot(hx, hz) || 1; const tx = bot.x + hx / hd, tz = bot.z + hz / hd;
        const dx = tx - me.x, dz = tz - me.z, d = Math.hypot(dx, dz) || 1; e.step(dt, [{ moveX: dx / d, moveZ: dz / d, sprint: true, shoot: false }, N]); t += dt; continue;
      }
      const dx = 0 - me.x, dz = -5.25 - me.z, d = Math.hypot(dx, dz);
      const angle = process.env.POLICY === 'angle' && me.z > -1.2; let inp: PlayerMoveInput = t < idle ? N : angle ? { moveX: 0.62, moveZ: -0.78, sprint: true, shoot: false } : { moveX: dx / d, moveZ: dz / d, sprint: true, shoot: false };
      if (Math.abs(t - (tapAt + 500)) < dt / 2) inp = { ...inp, trick: 'crossover' };
      if (isDrivingInPaint(me) && me.z < -1.4) inp = { ...inp, shoot: true };
      e.step(dt, [inp, N]); t += dt;
    }
    if (stolenAt === null && e.activeDuel) { rel++; if (e.activeDuel.releaseSnapshot.blockEligibility.eligible) elig++; }
    const k = stolenAt !== null ? 'stolen' : e.players[0].finishKind ?? e.phase; tally[k] = (tally[k] ?? 0) + 1;
    if (stolenAt !== null && e.phase !== 'Possession') { afterSteal.push(t - stolenAt); afterStealN++; if (e.activeDuel?.releaseSnapshot.blockEligibility.eligible) afterStealElig++; }
  }
  afterSteal.sort((a, b) => a - b);
  console.log(diff, 'tap', tapAt, JSON.stringify(tally), 'botShotAfterSteal median ms', afterSteal[Math.floor(afterSteal.length / 2)] ?? '-', 'eligible', afterStealElig + '/' + afterStealN, 'humanReleaseContestable', elig + '/' + rel);
}
