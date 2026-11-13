import { describe, expect, it } from 'vitest';
import { AuthoritativeMatchEngine, type PlayerMoveInput } from '../../shared/rules/matchStateMachine';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { InputGuardController } from '../../client/game/input/controls';

const N: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
const active: PlayerMoveInput = { moveX: 1, moveZ: -1, sprint: true, shoot: true, trick: 'spin', defense: 'jump' };
function game(countdown = true, mode: 'solo' | 'online' = 'solo', bot = true) {
  const e = new AuthoritativeMatchEngine({ matchId: 'ready', mode, seed: 53, pack: BUNDLED_QUESTION_PACKS[0],
    roomPresetId: 'standard', sessionLengthId: 'practice', postFeedbackCountdown: countdown,
    adaptiveQuestionTiming: true, customMaxPossessions: 100,
    player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'b', pseudonym: 'B', isAi: bot } });
  e.startMatch(); return e;
}
function step(e: AuthoritativeMatchEngine, ms: number) {
  for (let t = 0; t < ms; t += 25) e.step(Math.min(25, ms - t), [N, N]);
}
function feedback(e: AuthoritativeMatchEngine) {
  const att = e.scoreState.currentAttacker, def = att === 0 ? 1 : 0;
  Object.assign(e.players[att], { x: 0, z: 0, vx: 0, vz: 0 }); e.players[def].x = 5;
  e.initiateShotAttempt({ ...N, shoot: true }); const d = e.activeDuel!;
  e.confirmClientDuelReady(0, d.duelId); e.confirmClientDuelReady(1, d.duelId);
  while (e.phase === 'QuestionReady') step(e, 25); step(e, d.config.readingMs);
  e.submitAnswer({ slot: 0, duelId: d.duelId, optionId: d.question.correctOptionId });
  if (!e.players[1].isAi) e.submitAnswer({ slot: 1, duelId: d.duelId, optionId: d.question.correctOptionId });
  for (let t = 0; t < 20000 && e.phase !== 'Feedback'; t += 25) step(e, 25);
  expect(e.phase).toBe('Feedback'); return d.duelId;
}
function next(e: AuthoritativeMatchEngine, id: string) {
  e.acknowledgeFeedback(0, id); if (e.phase === 'Feedback') e.acknowledgeFeedback(1, id);
}
const positions = (e: AuthoritativeMatchEngine) => e.players.map(p => ({ x: p.x, z: p.z, vx: p.vx, vz: p.vz, finish: p.finishKind, defense: p.defenseAction }));

describe('Two-second post-review preparation', () => {
  it('starts only after Continue, removes question/feedback, and preserves adaptive learning and scores', () => {
    const e = game(); expect(e.possessionCountdownRemainingMs).toBe(0);
    const id = feedback(e), score = structuredClone(e.scoreState), timing = e.getQuestionTimingState();
    step(e, 4000); expect(e.possessionCountdownRemainingMs).toBe(0); expect(e.phase).toBe('Feedback');
    next(e, id); expect(e.possessionCountdownRemainingMs).toBe(2000); expect(e.phase).toBe('Possession');
    expect(e.activeDuel).toBeNull(); expect(e.feedbackState).toBeNull();
    expect(e.scoreState).toEqual(score); expect(e.getQuestionTimingState()).toEqual(timing);
  });
  it.each([1000 / 60, 50, 250])('holds both players, the ball and shot clock for the full countdown at %sms per frame', dt => {
    const e = game(); next(e, feedback(e));
    const before = positions(e), ball = e.getBallPosition3D(), clock = e.movementClockRemainingMs, eventCount = e.attemptEvents.length;
    for (let t = 0; t < 2000; t += dt) {
      e.initiateShotAttempt(active); e.step(Math.min(dt, 2000 - t), [active, active]);
      expect(positions(e)).toEqual(before); expect(e.getBallPosition3D()).toEqual(ball);
      expect(e.movementClockRemainingMs).toBe(clock); expect(e.activeDuel).toBeNull();
    }
    expect(e.possessionCountdownRemainingMs).toBe(0); expect(e.attemptEvents).toHaveLength(eventCount);
    e.step(50, [{ ...N, moveX: -1 }, N]);
    expect(e.movementClockRemainingMs).toBe(clock - 50);
    expect(e.players[0].x).toBeLessThan(before[0].x); expect(positions(e)[1]).not.toEqual(before[1]);
  });
  it('does not restart from a repeated Continue or advance while paused at a zero step', () => {
    const e = game(), id = feedback(e); next(e, id); step(e, 700);
    e.acknowledgeFeedback(0, id); e.step(0, [N, N]); expect(e.possessionCountdownRemainingMs).toBe(1300);
  });
  it('also protects the human attack on the following possession', () => {
    const e = game(); next(e, feedback(e)); step(e, 2000);
    expect(e.scoreState.currentAttacker).toBe(1); next(e, feedback(e));
    expect(e.scoreState.currentAttacker).toBe(0); expect(e.possessionCountdownRemainingMs).toBe(2000);
  });
  it.each([[false, 'solo', true], [true, 'online', true], [true, 'solo', false]] as const)(
    'preserves the existing flow outside the opted-in solo game (%s %s %s)', (enabled, mode, bot) => {
      const e = game(enabled, mode, bot); next(e, feedback(e)); expect(e.possessionCountdownRemainingMs).toBe(0);
    });
  it('shows results at the end of the match without a countdown', () => {
    const e = game(), id = feedback(e); e.scoreState = { ...e.scoreState, isMatchOver: true };
    next(e, id); expect(e.phase).toBe('MatchEnd'); expect(e.possessionCountdownRemainingMs).toBe(0);
  });
});

describe('Preparation input guard', () => {
  it.each([true, false])('drops early keyboard/touch actions but keeps held movement ready (attacker=%s)', isAttacker => {
    const c = new InputGuardController();
    c.syncDuelContext({ phase: 'Possession', isAttacker, duelId: null, readingProtected: false, displayedOptions: [], gameplayLocked: true });
    c.handleKeyDown({ code: 'KeyA' }); c.handleKeyDown({ code: 'Space' }); c.handleKeyDown({ code: 'KeyC' });
    c.setTouchMove(0, -1); c.setTouchPrimary(true); c.triggerTouchTrick();
    expect(c.consumeMoveInput('Possession', 2000)).toEqual(N); expect(c.getTrickSelection()).toBeNull();
    c.setGameplayLocked(false); expect(c.consumeMoveInput('Possession', 16)).toEqual({ ...N, moveX: -1, moveZ: -1 });
    c.handleKeyUp({ code: 'Space' }); c.handleKeyDown({ code: 'Space' });
    const fresh = c.consumeMoveInput('Possession', 16);
    expect(isAttacker ? fresh.shoot : fresh.defense === 'jump').toBe(true);
    c.handleKeyUp({ code: 'KeyC' }); c.handleKeyDown({ code: 'KeyC' });
    const trick = c.consumeMoveInput('Possession', 500);
    expect(isAttacker ? trick.trick === 'crossover' : trick.defense === 'swipe').toBe(true);
  });
});
