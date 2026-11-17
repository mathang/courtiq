// Headless measurement of baseline offence/defence outcomes using the real engine and simple human-like policies.
// Run: npx tsx output/opus55-review/sim.ts
import { BUNDLED_QUESTION_PACKS } from '../../../../content/packRegistry';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../../../shared/rules/matchStateMachine';
import { isDrivingInPaint } from '../../../../shared/rules/finishing';
import type { AiDifficultyId } from '../../../../shared/config/balance';

const N: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
type Policy = 'straight' | 'trick-drive' | 'angle';
function runOffence(seed: number, diff: AiDifficultyId, policy: Policy) {
  const e = new AuthoritativeMatchEngine({ matchId: 'm' + seed, mode: 'solo', pack: BUNDLED_QUESTION_PACKS[0], seed, roomPresetId: 'standard', sessionLengthId: 'standard', aiDifficulty: diff,
    player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'bot', pseudonym: 'CourtBot', isAi: true } });
  e.startMatch();
  const dt = 1000 / 60; let t = 0; let tricked = false; let firstContactT: number | null = null;
  while (e.phase === 'Possession' && t < 15000) {
    const me = e.players[0], bot = e.players[1];
    const dx = 0 - me.x, dz = -5.25 - me.z, d = Math.hypot(dx, dz);
    let inp: PlayerMoveInput = { moveX: dx / d, moveZ: dz / d, sprint: true, shoot: false };
    if (policy === 'angle') inp = { moveX: me.z > -1 ? 0.6 : dx / d, moveZ: me.z > -1 ? -0.8 : dz / d, sprint: true, shoot: false };
    const sep = Math.hypot(me.x - bot.x, me.z - bot.z);
    if (firstContactT === null && sep < 1.45) firstContactT = t;
    if (policy === 'trick-drive' && !tricked && sep < 2.2 && t > 100) { inp = { ...inp, trick: 'crossover' }; tricked = true; }
    if (isDrivingInPaint(me) && me.z < -1.4) inp = { ...inp, shoot: true };
    e.step(dt, [inp, N]); t += dt;
  }
  const att = e.players[0];
  const outcome = e.phase === 'Possession' ? 'timeout' : (e.scoreState.currentAttacker === 1 && e.phase === 'Possession') ? 'turnover' : att.finishKind ?? (e.players[1].defenseResult === 'steal' ? 'steal' : e.phase);
  return { outcome: e.players[1].defenseResult === 'steal' ? 'steal' : outcome, t: Math.round(t), firstContactT };
}

function runDefence(seed: number, diff: AiDifficultyId, policy: 'stand' | 'mirror' | 'cushion') {
  const e = new AuthoritativeMatchEngine({ matchId: 'd' + seed, mode: 'solo', pack: BUNDLED_QUESTION_PACKS[0], seed, roomPresetId: 'standard', sessionLengthId: 'standard', aiDifficulty: diff,
    player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'bot', pseudonym: 'CourtBot', isAi: true } });
  // Make the bot attack first by giving the human's first possession away via a shot-clock: simpler — swap attacker directly is state patching;
  // instead we run the human possession to a quick shot, then answer nothing, continue.
  e.startMatch();
  const dt = 1000 / 60;
  // human shoots immediately from the top
  e.step(dt, [{ ...N, shoot: true }, N]);
  let guard = 0;
  while (e.phase !== 'Feedback' && guard++ < 5000) e.step(50, [N, N]);
  { const id = (e as any).feedbackState?.duelId; e.acknowledgeFeedback(0, id); e.acknowledgeFeedback(1, id); }
  guard = 0; while (e.phase !== 'Possession' && guard++ < 5000) e.step(50, [N, N]);
  let t = 0; let jumped = false; let minSep = 99;
  while (e.phase === 'Possession' && t < 15000) {
    const me = e.players[0], bot = e.players[1];
    let inp: PlayerMoveInput = N;
    if (policy !== 'stand') {
      const k = policy === 'cushion' ? 2.0 : 1.0; const hx = -bot.x, hz = -5.25 - bot.z, hd = Math.hypot(hx, hz) || 1; const gap = policy === 'cushion' ? Math.min(2.0, hd * 0.6) : Math.min(1.0, hd * 0.3); const tx = bot.x + hx / hd * gap, tz = bot.z + hz / hd * gap; void k; const dx = tx - me.x, dz = tz - me.z; const d = Math.hypot(dx, dz);
      inp = d > 0.15 ? { moveX: dx / d, moveZ: dz / d, sprint: d > 1.5, shoot: false } : N;
    }
    minSep = Math.min(minSep, Math.hypot(me.x - bot.x, me.z - bot.z));
    
    e.step(dt, [inp, N]); t += dt;
  }
  
  return { phase: e.phase, botFinish: e.players[1].finishKind, t: Math.round(t), minSep: +minSep.toFixed(2), block: e.activeDuel?.physicalBlock ?? null, eligible: e.activeDuel?.releaseSnapshot.blockEligibility?.reason ?? null };
}

const seeds = Array.from({ length: 60 }, (_, i) => 1000 + i * 7);
for (const diff of ['beginner', 'intermediate', 'advanced'] as AiDifficultyId[]) {
  for (const policy of ['straight', 'trick-drive', 'angle'] as Policy[]) {
    const r = seeds.map(s => runOffence(s, diff, policy));
    const tally: Record<string, number> = {}; for (const x of r) tally[x.outcome] = (tally[x.outcome] ?? 0) + 1;
    const steals = r.filter(x => x.outcome === 'steal');
    console.log('OFF', diff, policy, JSON.stringify(tally), 'meanStealT', steals.length ? Math.round(steals.reduce((a, b) => a + b.t, 0) / steals.length) : '-');
  }
  for (const policy of ['stand', 'mirror', 'cushion'] as const) {
    const r = seeds.map(s => runDefence(s, diff, policy));
    const tally: Record<string, number> = {}; for (const x of r) { const k = `${x.botFinish}|elig:${x.eligible}|blk:${x.block}`; tally[k] = (tally[k] ?? 0) + 1; }
    console.log('DEF', diff, policy, JSON.stringify(tally), 'meanT', Math.round(r.reduce((a, b) => a + b.t, 0) / r.length));
  }
}
