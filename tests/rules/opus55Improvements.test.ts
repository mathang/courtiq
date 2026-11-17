import { describe, expect, it } from 'vitest';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../shared/rules/matchStateMachine';
import { evaluateBlockEligibilityAtRelease } from '../../shared/rules/block';
import { ANKLE_BREAK_CONFIG, trickWrongFootSec } from '../../shared/rules/defense';
import { classifyBlockAvailability, describeQuestionBlock, isDrivingIntoSetDefender } from '../../shared/rules/defensiveReads';
import { CourtCameraController, isShortLandscapeViewport } from '../../client/game/camera/courtCamera';

const N: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
function game(ai = false, seed = 31) {
  const e = new AuthoritativeMatchEngine({ matchId: 'opus55', mode: 'solo', pack: BUNDLED_QUESTION_PACKS[0], seed, roomPresetId: 'standard', sessionLengthId: 'standard',
    player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'b', pseudonym: 'B', isAi: ai } });
  e.startMatch(); return e;
}

describe('Readable defence: why a question block is or is not available', () => {
  const at = (shooter: { x: number; z: number }, defender: { x: number; z: number }, extra: Partial<Parameters<typeof evaluateBlockEligibilityAtRelease>[0]> = {}) =>
    evaluateBlockEligibilityAtRelease({ shooterPos: shooter, defenderPos: defender, defenderFacingAngle: Math.atan2(shooter.x - defender.x, shooter.z - defender.z), ...extra });

  it('names each frozen release reason instead of one generic "unavailable" line', () => {
    expect(classifyBlockAvailability(at({ x: 0, z: 0 }, { x: 0, z: -1.2 }))).toBe('eligible');
    expect(classifyBlockAvailability(at({ x: 0, z: 0 }, { x: 0, z: -3.5 }))).toBe('too-far');
    expect(classifyBlockAvailability(at({ x: 0, z: 0 }, { x: 0, z: 1.2 }))).toBe('beaten');
    expect(classifyBlockAvailability(at({ x: 0, z: 0 }, { x: 0, z: -1 }, { blockingDisabledByRule: true, disabledBy: 'off-balance' }))).toBe('off-balance');
    expect(classifyBlockAvailability(at({ x: 0, z: 0 }, { x: 0, z: -1 }, { blockingDisabledByRule: true, disabledBy: 'reaching' }))).toBe('reaching');
    expect(classifyBlockAvailability(at({ x: 0, z: 0 }, { x: 0, z: -1 }), true)).toBe('swat');
  });

  it('writes role-aware card copy and keeps the eligibility snapshot itself unchanged', () => {
    const far = at({ x: 0, z: 0 }, { x: 0, z: -3.5 });
    expect(describeQuestionBlock({ eligibility: far, physicalBlock: false, youAreAttacker: false })).toBe('📏 Too far to block (3.5m > 2.6m)');
    expect(describeQuestionBlock({ eligibility: far, physicalBlock: false, youAreAttacker: true })).toContain('Open shot');
    const broken = at({ x: 0, z: 0 }, { x: 0, z: -1 }, { blockingDisabledByRule: true, disabledBy: 'off-balance' });
    expect(describeQuestionBlock({ eligibility: broken, physicalBlock: false, youAreAttacker: false })).toContain('Off balance');
    expect(broken.eligible).toBe(false);
    expect(Object.isFrozen(broken)).toBe(true);
    for (const youAreAttacker of [true, false]) {
      for (const e of [far, broken, at({ x: 0, z: 0 }, { x: 0, z: -1.2 }), at({ x: 0, z: 0 }, { x: 0, z: 1.2 })]) {
        expect(describeQuestionBlock({ eligibility: e, physicalBlock: false, youAreAttacker }).length).toBeLessThanOrEqual(56);
      }
    }
  });

  it('records whether a live release was disabled by a swipe or by being wrong-footed', () => {
    const swiping = game();
    Object.assign(swiping.players[0], { x: 0, z: 0 }); Object.assign(swiping.players[1], { x: 0, z: -1, facingAngle: Math.PI });
    swiping.step(10, [N, { ...N, defense: 'swipe' }]); swiping.initiateShotAttempt();
    expect(swiping.activeDuel!.releaseSnapshot.blockEligibility.disabledBy).toBe('reaching');
    const broken = game();
    Object.assign(broken.players[0], { x: 0, z: 0 }); Object.assign(broken.players[1], { x: 0, z: -1, facingAngle: Math.PI, wrongFootSec: 0.3 });
    broken.initiateShotAttempt();
    expect(broken.activeDuel!.releaseSnapshot.blockEligibility.disabledBy).toBe('off-balance');
  });
});

describe('Ankle-breakers reward crowding risk, not mere proximity', () => {
  it('grades the trick freeze by spacing: full within steal reach, none beyond 2.55m', () => {
    expect(trickWrongFootSec('crossover', 1.0, false)).toBeCloseTo(0.36);
    expect(trickWrongFootSec('crossover', ANKLE_BREAK_CONFIG.fullFreezeWithinM, false)).toBeCloseTo(0.36);
    const mid = trickWrongFootSec('crossover', 2.0, false);
    expect(mid).toBeGreaterThan(0.1); expect(mid).toBeLessThan(0.25);
    expect(trickWrongFootSec('spin', 2.55, true)).toBe(0);
    expect(trickWrongFootSec('spin', 1.2, true)).toBeCloseTo(0.52);
  });

  it('only calls a full ANKLE BREAKER on a crowding defender', () => {
    const close = game(); close.players[1].z = close.players[0].z - 1.2;
    close.step(16, [{ ...N, trick: 'spin' }, N]);
    expect(close.players[1].wrongFootSec).toBeGreaterThan(0.4);
    const cushion = game(); cushion.players[1].z = cushion.players[0].z - 2.35;
    cushion.step(16, [{ ...N, trick: 'spin' }, N]);
    expect(cushion.players[1].wrongFootSec).toBeGreaterThan(0);
    expect(cushion.players[1].wrongFootSec).toBeLessThan(0.15);
    expect(cushion.players[0].calloutText ?? '').not.toContain('ANKLE BREAKER');
  });

  it('gives a wrong-footed defender a short settle window before the next trick can re-freeze them', () => {
    const e = game(); e.players[1].z = e.players[0].z - 1.2;
    e.step(16, [{ ...N, trick: 'crossover' }, N]);
    const def = e.players[1];
    for (let i = 0; i < 60 && def.wrongFootSec > 0; i++) e.step(16, [N, N]);
    expect(def.wrongFootSec).toBe(0);
    expect(def.balanceSettleSec).toBeGreaterThan(0.3);
    // Bring the defender back into the attacker's chest and start a fresh move at once
    // (cooldown cleared in setup so only the settle window is under test).
    Object.assign(def, { x: e.players[0].x, z: e.players[0].z - 1.1, vx: 0, vz: 0 });
    Object.assign(e.players[0], { moveCooldownSec: 0, comboGraceSec: 0, trickCombo: 0, lastTrick: null, streetMove: null, sprintStamina: 1 });
    e.step(16, [{ ...N, trick: 'spin' }, N]);
    expect(e.players[0].streetMove).toBe('spin');
    expect(def.wrongFootSec).toBe(0);
    for (let i = 0; i < 40; i++) e.step(16, [N, N]);
    expect(def.balanceSettleSec).toBe(0);
    // Once settled, the same spacing breaks them again.
    Object.assign(def, { x: e.players[0].x, z: e.players[0].z - 1.1, vx: 0, vz: 0 });
    Object.assign(e.players[0], { moveCooldownSec: 0, comboGraceSec: 0, trickCombo: 0, lastTrick: null, streetMove: null, sprintStamina: 1 });
    e.step(16, [{ ...N, trick: 'crossover' }, N]);
    expect(def.wrongFootSec).toBeGreaterThan(0.3);
  });
});

describe('Head-on coaching cue', () => {
  it('flags a live dribble driven straight into a set defender, but not an angled drive or a protected spin', () => {
    const e = game();
    const [att, def] = e.players;
    Object.assign(att, { x: 0, z: 0.9, vx: 0, vz: -6, facingAngle: Math.PI });
    Object.assign(def, { x: 0, z: 0, facingAngle: 0 });
    const ball = () => e.getBallPosition3D();
    expect(isDrivingIntoSetDefender(att, def, ball())).toBe(true);
    Object.assign(att, { vx: 5, vz: -1 });
    expect(isDrivingIntoSetDefender(att, def, ball())).toBe(false);
    Object.assign(att, { vx: 0, vz: -6 }); def.defenseRecoverySec = 0.5;
    expect(isDrivingIntoSetDefender(att, def, ball())).toBe(false);
    def.defenseRecoverySec = 0; att.streetMove = 'spin';
    expect(isDrivingIntoSetDefender(att, def, ball())).toBe(false);
    att.streetMove = null; Object.assign(att, { z: 2.4 });
    expect(isDrivingIntoSetDefender(att, def, ball())).toBe(false);
  });
});

describe('CourtBot hands scale with difficulty', () => {
  function botSwipe(seed: number, difficulty: 'beginner' | 'intermediate' | 'advanced', overexposed = false) {
    const e = new AuthoritativeMatchEngine({ matchId: `hands-${seed}`, mode: 'solo', pack: BUNDLED_QUESTION_PACKS[0], seed, roomPresetId: 'standard', sessionLengthId: 'standard', aiDifficulty: difficulty,
      player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'bot', pseudonym: 'CourtBot', isAi: true } });
    e.startMatch();
    Object.assign(e.players[0], { x: 0, z: 1.0, facingAngle: Math.PI });
    Object.assign(e.players[1], { x: 0, z: 0.1, facingAngle: 0 });
    if (overexposed) e.players[0].trickOverexposedSec = 0.5;
    (e as unknown as { aiBrain: { defenseTimerSec: number } }).aiBrain.defenseTimerSec = 0;
    for (let i = 0; i < 30 && e.players[1].defenseResult === null; i++) e.step(16, [N, N]);
    return { result: e.players[1].defenseResult, attacker: e.scoreState.currentAttacker, recovery: e.players[1].defenseRecoverySec };
  }
  it('connects at a seeded, difficulty-ordered rate and a miss roots CourtBot like any defender', () => {
    const rate = (d: 'beginner' | 'intermediate' | 'advanced') => {
      let steals = 0, swipes = 0;
      for (let seed = 1; seed <= 120; seed++) { const r = botSwipe(seed, d); if (r.result) swipes++; if (r.result === 'steal') steals++; }
      expect(swipes).toBe(120);
      return steals / swipes;
    };
    const [b, i, a] = [rate('beginner'), rate('intermediate'), rate('advanced')];
    expect(b).toBeGreaterThan(0.15); expect(b).toBeLessThan(0.45);
    expect(i).toBeGreaterThan(0.4); expect(i).toBeLessThan(0.7);
    expect(a).toBeGreaterThan(0.65); expect(a).toBeLessThan(0.95);
    const miss = Array.from({ length: 40 }, (_, k) => botSwipe(k + 1, 'beginner')).find(r => r.result === 'miss')!;
    expect(miss.attacker).toBe(0);
    expect(miss.recovery).toBeGreaterThan(0.8);
  });
  it('is deterministic per seed and always punishes an over-exposed handle', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(botSwipe(seed, 'intermediate')).toEqual(botSwipe(seed, 'intermediate'));
      expect(botSwipe(seed, 'beginner', true).result).toBe('steal');
    }
  });
});

describe('Phone-landscape framing', () => {
  function framedAttackerHeight(width: number, height: number) {
    const e = game();
    const cam = new CourtCameraController(width / height);
    cam.resize(width, height);
    const safeTop = 60 / height;
    for (let i = 0; i < 240; i++) cam.update({ phase: 'Possession', players: e.players, ballPos: e.getBallPosition3D(), attackerSlot: 0, reducedMotion: false, deltaSec: 1 / 60, safeTop });
    const s = cam.snapshot();
    return { px: (s.subjects[0].y - s.subjects[1].y) * height, subjects: s.subjects, safeTop };
  }
  it('classifies short wide screens only', () => {
    expect(isShortLandscapeViewport(844, 390)).toBe(true);
    expect(isShortLandscapeViewport(667, 375)).toBe(true);
    expect(isShortLandscapeViewport(1440, 900)).toBe(false);
    expect(isShortLandscapeViewport(390, 844)).toBe(false);
  });
  it.each([[844, 390], [667, 375]])('frames athletes at least 65px tall at %ix%i while every subject stays inside the safe band', (w, h) => {
    const r = framedAttackerHeight(w, h);
    expect(r.px).toBeGreaterThanOrEqual(65);
    for (const p of r.subjects) {
      expect(p.x).toBeGreaterThan(0.16); expect(p.x).toBeLessThan(0.84);
      expect(p.y).toBeGreaterThan(r.safeTop); expect(p.y).toBeLessThan(0.9);
    }
  });
});
