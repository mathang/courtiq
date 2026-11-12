import { describe, expect, it } from 'vitest';
import { ADAPTIVE_QUESTION_TIMING as C, adaptiveQuestionWindowMs, createAdaptiveQuestionTimingState,
  updateAdaptiveQuestionTiming, type AdaptiveQuestionTimingState } from '../../shared/rules/adaptiveQuestionTiming';
import { AuthoritativeMatchEngine, type PlayerMoveInput } from '../../shared/rules/matchStateMachine';
import { createAiQuestionPlanAtDuelStart } from '../../shared/rules/aiOpponent';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { computeSpeedScore, type PlayerAnswerRecord } from '../../shared/rules/timing';
const N: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
const record = (isCorrect: boolean, acceptedTimeMs: number): PlayerAnswerRecord =>
  ({ playerId: 'a', optionId: 'x', isCorrect, acceptedTimeMs, locked: true });
const initial = createAdaptiveQuestionTimingState;

describe('Bounded adaptive answering pace', () => {
  it.each([[null, 130], [record(false, 2100), 120], [record(true, 10000), 120]] as const)(
    'adds time after timeout, even a quick wrong answer, or a slow correct answer (%j)', (answer, pace) => {
      const s = updateAdaptiveQuestionTiming(initial(), answer, 2000, 12000);
      expect(s).toMatchObject({ pacePercent: pace, quickCorrectCount: 0, lastAdjustment: 'more-time' });
      expect(adaptiveQuestionWindowMs(12000, 2000, s)).toBe(2000 + 10000 * pace / 100);
    });
  it('requires three consecutive quick correct answers before a small speed-up', () => {
    let s = initial();
    for (let n = 1; n <= 3; n++) {
      s = updateAdaptiveQuestionTiming(s, record(true, 4000), 2000, 12000);
      expect(s.pacePercent).toBe(n === 3 ? 90 : 100);
    }
    expect(s.quickCorrectCount).toBe(0); expect(s.lastAdjustment).toBe('less-time');
  });
  it('holds the pace for an ordinary correct answer and clears the quick-answer run', () => {
    let s = updateAdaptiveQuestionTiming(initial(), record(true, 3000), 2000, 12000);
    s = updateAdaptiveQuestionTiming(s, record(true, 8000), 2000, 12000);
    expect(s).toEqual(initial());
  });
  it('normalises response time against answer time after protected reading, including an extended window', () => {
    const a = { ...initial(), pacePercent: 150 };
    const quick = updateAdaptiveQuestionTiming(a, record(true, 9000), 3000, 18000);
    expect(quick.quickCorrectCount).toBe(1); // 6 / 15 seconds, exactly 40%.
    const late = updateAdaptiveQuestionTiming(a, record(true, 14500), 3000, 18000);
    expect(late.pacePercent).toBe(170);
  });
  it('stops at the support/pace bounds and never removes the protected reading time or six-second answer floor', () => {
    let slow = initial(), fast = initial();
    for (let n = 0; n < 100; n++) {
      slow = updateAdaptiveQuestionTiming(slow, null, 2000, 12000);
      fast = updateAdaptiveQuestionTiming(fast, record(true, 2000), 2000, 12000);
    }
    expect(slow.pacePercent).toBe(C.maxPacePercent); expect(fast.pacePercent).toBe(C.minPacePercent);
    expect(slow.lastAdjustment).toBeNull();
    expect(adaptiveQuestionWindowMs(12000, 2000, fast)).toBe(8000);
    expect(adaptiveQuestionWindowMs(31000, 30000, fast)).toBe(36000);
    expect(adaptiveQuestionWindowMs(12000, 2000, slow)).toBe(27000);
  });
  it('is immutable and does not consume randomness', () => {
    const s = initial(); const next = updateAdaptiveQuestionTiming(s, null, 2000, 12000);
    expect(s).toEqual(initial()); expect(Object.isFrozen(next)).toBe(true);
  });
});

function game(options: { adaptive?: boolean; mode?: 'solo' | 'online'; bot?: boolean; preset?: 'standard' | 'practice' } = {}) {
  const e = new AuthoritativeMatchEngine({ matchId: 'adaptive', mode: options.mode ?? 'solo',
    pack: BUNDLED_QUESTION_PACKS[0], seed: 53, customMaxPossessions: 100,
    adaptiveQuestionTiming: options.adaptive ?? true, roomPresetId: options.preset ?? 'standard', sessionLengthId: 'practice',
    player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'b', pseudonym: 'B', isAi: options.bot ?? true } });
  e.startMatch(); return e;
}
function step(e: AuthoritativeMatchEngine, ms: number) { for (let t = 0; t < ms; t += 25) e.step(Math.min(25, ms - t), [N, N]); }
function open(e: AuthoritativeMatchEngine) {
  const att = e.scoreState.currentAttacker, def = att === 0 ? 1 : 0;
  Object.assign(e.players[att], { x: 0, z: 0, vx: 0, vz: 0 }); e.players[def].x = 5;
  e.initiateShotAttempt({ ...N, shoot: true }); const d = e.activeDuel!;
  e.confirmClientDuelReady(0, d.duelId); e.confirmClientDuelReady(1, d.duelId);
  while (e.phase === 'QuestionReady') step(e, 25); step(e, d.config.readingMs); return d;
}
function finish(e: AuthoritativeMatchEngine, correct: boolean | null) {
  const d = open(e);
  if (correct !== null) {
    const optionId = correct ? d.question.correctOptionId : d.question.options.find(o => o.id !== d.question.correctOptionId)!.id;
    expect(e.submitAnswer({ slot: 0, duelId: d.duelId, optionId }).accepted).toBe(true);
  }
  // Two-human fixtures are explicitly submitted too, without relying on an AI.
  if (!e.players[1].isAi) e.submitAnswer({ slot: 1, duelId: d.duelId, optionId: d.question.correctOptionId });
  for (let n = 0; n < 2500 && e.phase !== 'Feedback'; n++) step(e, 25);
  expect(e.phase).toBe('Feedback'); return d;
}
function next(e: AuthoritativeMatchEngine) {
  const id = e.feedbackState!.duelId; e.acknowledgeFeedback(0, id);
  if (e.phase === 'Feedback') e.acknowledgeFeedback(1, id);
}

describe('Authoritative adaptive timing integration', () => {
  it('freezes each deadline and AI commitment, updating only the following question after one resolution', () => {
    const e = game(), d = open(e), config = structuredClone(d.config), ai = structuredClone(d.aiPlan);
    e.submitAnswer({ slot: 0, duelId: d.duelId, optionId: d.question.options.find(o => o.id !== d.question.correctOptionId)!.id });
    expect(e.getQuestionTimingState().pacePercent).toBe(100); expect(d.config).toEqual(config); expect(d.aiPlan).toEqual(ai);
    for (let n = 0; n < 700 && e.phase !== 'Feedback'; n++) step(e, 25);
    expect(e.getQuestionTimingState().pacePercent).toBe(120); expect(d.config).toEqual(config);
    expect(e.feedbackState!.timingAdjustment).toBe('more-time');
    step(e, 20000); expect(e.getQuestionTimingState().pacePercent).toBe(120);
    expect(e.attemptEvents[0].questionTiming).toEqual({ readingMs: 2000, answerWindowMs: 12000, adaptive: true });
    next(e); const nextDuel = open(e);
    expect(nextDuel.config.answerWindowMs).toBe(14000); expect(nextDuel.config.readingMs).toBe(2000);
    expect(nextDuel.publicQuestionsBySlot.every(q => q.answerWindowMs === 14000 && q.readingMs === 2000)).toBe(true);
    expect(JSON.stringify(nextDuel.publicQuestionsBySlot)).not.toContain('correctOptionId');
  });
  it('speeds up after three quick correct answers and grants extra time for the next unanswered question', () => {
    const e = game();
    for (let n = 0; n < 3; n++) { finish(e, true); next(e); }
    const d = finish(e, null); expect(d.config.answerWindowMs).toBe(11000);
    expect(e.getQuestionTimingState().pacePercent).toBe(120); expect(e.players[0].correctAnswerStreak).toBe(0);
    next(e); expect(open(e).config.answerWindowMs).toBe(14000);
  });
  it.each([
    { adaptive: false }, { mode: 'online' as const }, { mode: 'online' as const, bot: false },
    { bot: false }, { preset: 'practice' as const },
  ])('retains fixed selected timing when adaptation is unavailable or disabled (%j)', options => {
    const e = game(options); expect(e.adaptiveQuestionTiming).toBe(false);
    const d = finish(e, false); next(e); const second = open(e);
    expect(second.config.answerWindowMs).toBe(d.config.answerWindowMs); expect(e.getQuestionTimingState().pacePercent).toBe(100);
  });
  it('starts each match fresh and ignores shot-clock turnovers without a question', () => {
    const e = game(); finish(e, false); expect(e.getQuestionTimingState().pacePercent).toBe(120);
    const fresh = game(); expect(fresh.getQuestionTimingState().pacePercent).toBe(100);
    fresh.movementClockRemainingMs = 1; step(fresh, 25);
    expect(fresh.activeDuel).toBeNull(); expect(fresh.getQuestionTimingState().pacePercent).toBe(100);
  });
  it('uses the actual adapted answer budget for speed scoring', () => {
    expect(computeSpeedScore(8000, 2000, 14000)).toBe(0.5);
    expect(computeSpeedScore(8000, 2000, 12000)).toBe(0.4);
  });
  it('scales only the precommitted bot answer time; choice and accuracy draw are unchanged', () => {
    const base = { duelId: 'a', difficulty: 'beginner' as const, question: BUNDLED_QUESTION_PACKS[0].questions[0],
      effectiveReadingMs: 2000, effectiveAnswerWindowMs: 12000, rng: () => 0.5 };
    const normal = createAiQuestionPlanAtDuelStart(base);
    const slower = createAiQuestionPlanAtDuelStart({ ...base, effectiveAnswerWindowMs: 22000, answerTimeScale: 2 });
    expect(slower.chosenOptionId).toBe(normal.chosenOptionId); expect(slower.willAnswerCorrectly).toBe(normal.willAnswerCorrectly);
    expect(slower.plannedAnswerTimeMs - 2000).toBe((normal.plannedAnswerTimeMs - 2000) * 2);
  });
});
