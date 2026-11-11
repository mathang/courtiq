import { describe, expect, it } from 'vitest';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../shared/rules/matchStateMachine';
import { getAirPose, StreetMove } from '../../shared/rules/streetMoves';
import { COURT_GEOMETRY } from '../../shared/config/balance';
import { InputGuardController } from '../../client/game/input/controls';

const neutral: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
function game(ai = false) {
  const e = new AuthoritativeMatchEngine({ matchId: 'street-test', mode: 'solo', pack: BUNDLED_QUESTION_PACKS[0], roomPresetId: 'standard', sessionLengthId: 'quick',
    player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'b', pseudonym: 'B', isAi: ai }, seed: 27 });
  e.startMatch(); return e;
}
function step(e: AuthoritativeMatchEngine, n: number, input = neutral) {
  for (let i = 0; i < n; i++) e.step(1000 / 60, [input, neutral]);
}

describe('Street basketball movement and finishes', () => {
  it.each<StreetMove>(['crossover', 'spin', 'eurostep', 'stepback'])('%s creates space and cannot be retriggered every tick', (trick) => {
    const e = game();
    const start = { x: e.players[0].x, z: e.players[0].z };
    step(e, 1, { ...neutral, trick });
    expect(e.players[1].wrongFootSec).toBeGreaterThan(0);
    const stamina = e.players[0].sprintStamina;
    step(e, 12, { ...neutral, trick });
    expect(e.players[0].moveElapsedSec).toBeGreaterThan(0.15);
    expect(e.players[0].sprintStamina).toBeGreaterThan(stamina - 0.01);
    expect(Math.hypot(e.players[0].x - start.x, e.players[0].z - start.z)).toBeGreaterThan(1.2);
    expect(e.phase).toBe('Possession');
  });
  it('makes a step-back create a clean shot outside contest range', () => {
    const e = game();
    e.players[1].z = e.players[0].z - 3;
    expect(e.getLiveBlockEligibility().eligible).toBe(false);
    e.players[1].z = e.players[0].z - 1.1;
    expect(e.getLiveBlockEligibility().eligible).toBe(true);
    step(e, 1, { ...neutral, trick: 'stepback' }); step(e, 24);
    expect(e.getLiveBlockEligibility().eligible).toBe(false);
    step(e, 1, { ...neutral, shoot: true });
    expect(e.activeDuel?.releaseSnapshot.blockEligibility.eligible).toBe(false);
  });
  it('requires stamina and attacking possession; ignores invalid runtime move names', () => {
    const e = game(); e.players[0].sprintStamina = 0;
    e.step(16, [{ ...neutral, trick: 'spin' }, { ...neutral, trick: 'spin' }]);
    expect(e.players.map(p => p.streetMove)).toEqual([null, null]);
    e.step(16, [{ ...neutral, trick: '__proto__' as StreetMove }, neutral]);
    expect(e.players[0].streetMove).toBe(null);
  });
  it('keeps tricks inside the court, including collision separation at an edge', () => {
    for (const trick of ['crossover', 'spin', 'eurostep', 'stepback'] as const) {
      const e = game(); e.players[0].x = COURT_GEOMETRY.maxX; e.players[0].z = COURT_GEOMETRY.maxZ;
      step(e, 40, { ...neutral, moveX: 1, moveZ: 1, trick });
      for (const p of e.players) {
        expect(p.x).toBeLessThanOrEqual(COURT_GEOMETRY.maxX); expect(p.z).toBeLessThanOrEqual(COURT_GEOMETRY.maxZ);
        expect(Number.isFinite(p.x)).toBe(true);
      }
    }
  });
  it('takes off for a dunk, holds before the rim for the question, resolves and lands', () => {
    const e = game(); e.players[0].z = -3.4; e.players[0].vz = -2; e.players[0].isSprinting = true; e.players[1].x = 4;
    e.initiateShotAttempt();
    expect(e.players[0].finishKind).toBe('dunk');
    expect(getAirPose(e.players[0]).y).toBeCloseTo(0);
    step(e, 45);
    expect(getAirPose(e.players[0]).y).toBeGreaterThan(0.9);
    const ball = e.getBallPosition3D();
    expect(ball.y).toBeGreaterThan(3.0); expect(ball.z).toBeGreaterThan(COURT_GEOMETRY.hoopZ + 0.3);
    expect(e.scoreState.scores).toEqual([0, 0]);
    step(e, 140);
    const q = e.activeDuel!;
    for (const slot of [0, 1] as const) e.submitAnswer({ slot, duelId: q.duelId, optionId: q.question.correctOptionId });
    step(e, 10);
    expect(e.phase).toBe('Resolution');
    step(e, 60);
    expect(getAirPose(e.players[0]).y).toBe(0);
    expect(e.getBallPosition3D().y).toBeGreaterThanOrEqual(0.18);
    step(e, 120);
    expect(['Feedback', 'Possession']).toContain(e.phase);
    expect(e.attemptEvents).toHaveLength(1);
    expect(e.attemptEvents[0].shotZone).not.toBe('three-pointer');
  });
  it('keeps a far shot as a jump shot and drains no extra movement clock during a question', () => {
    const e = game(); e.initiateShotAttempt(); const clock = e.movementClockRemainingMs;
    expect(e.players[0].finishKind).toBe('jump'); step(e, 45);
    expect(e.movementClockRemainingMs).toBe(clock);
  });
  it('requires a fresh trick keypress, clears buffered tricks in duels and resets on blur', () => {
    const input = new InputGuardController();
    input.syncDuelContext({phase:'Possession',duelId:null,readingProtected:false,displayedOptions:[]});
    input.handleKeyDown({ code: 'KeyC' });
    expect(input.consumeMoveInput('Possession', 500).trick).toBe('crossover');
    input.handleKeyDown({ code: 'KeyC', repeat: true }); expect(input.consumeMoveInput('Possession').trick).toBeUndefined();
    input.handleKeyUp({ code: 'KeyC' }); input.handleKeyDown({ code: 'KeyC' });
    input.consumeMoveInput('Duel'); expect(input.consumeMoveInput('Possession').trick).toBeUndefined();
    input.handleKeyDown({ code: 'KeyW' }); input.reset(); expect(input.consumeMoveInput('Possession').moveZ).toBe(0);
  });
});
