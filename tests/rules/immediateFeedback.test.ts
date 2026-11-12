import { describe, expect, it } from 'vitest';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { AuthoritativeMatchEngine, type PlayerMoveInput } from '../../shared/rules/matchStateMachine';
import { buildStudentAnswerFeedback } from '../../shared/rules/learningFeedback';
import { toPublicDuelQuestion } from '../../shared/content/question-schema';

const N: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
function game(mode: 'solo' | 'online' = 'solo', bot = true) {
  const e = new AuthoritativeMatchEngine({ matchId: 'immediate', mode, seed: 53,
    pack: BUNDLED_QUESTION_PACKS[0], roomPresetId: 'standard', sessionLengthId: 'practice',
    player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'b', pseudonym: 'B', isAi: bot } });
  e.startMatch(); e.players[1].x = 5;
  e.initiateShotAttempt({ ...N, shoot: true });
  const d = e.activeDuel!;
  e.confirmClientDuelReady(0, d.duelId); e.confirmClientDuelReady(1, d.duelId);
  for (let n = 0; n < 100 && e.phase === 'QuestionReady'; n++) step(e, 25);
  expect(e.phase).toBe('Duel'); return e;
}
function step(e: AuthoritativeMatchEngine, ms: number) {
  for (let t = 0; t < ms; t += 25) e.step(Math.min(25, ms - t), [N, N]);
}
function answer(e: AuthoritativeMatchEngine, correct = true) {
  const d = e.activeDuel!;
  const optionId = correct ? d.question.correctOptionId : d.question.options.find(o => o.id !== d.question.correctOptionId)!.id;
  return e.submitAnswer({ slot: 0, duelId: d.duelId, optionId });
}

describe('Immediate solo answer review', () => {
  it('reveals nothing until a valid answer survives reading protection, ID and option validation', () => {
    const e = game(), d = e.activeDuel!;
    expect(e.getSoloAnswerReview()).toBeNull();
    expect(answer(e).rejectionReason).toBe('reading-period-protected');
    expect(e.getSoloAnswerReview()).toBeNull();
    step(e, d.config.readingMs);
    expect(e.submitAnswer({ slot: 0, duelId: 'stale', optionId: d.question.correctOptionId }).accepted).toBe(false);
    expect(e.submitAnswer({ slot: 0, duelId: d.duelId, optionId: 'invalid' }).accepted).toBe(false);
    expect(e.getSoloAnswerReview()).toBeNull();
  });

  it.each([true, false])('returns personal correctness and relevant reasoning while CourtBot is still deciding (correct=%s)', correct => {
    const e = game(), d = e.activeDuel!, plan = structuredClone(d.aiPlan);
    step(e, d.config.readingMs); expect(answer(e, correct).accepted).toBe(true);
    expect(e.phase).toBe('Duel'); expect(d.answersBySlot[1]).toBeNull();
    const review = e.getSoloAnswerReview()!;
    expect(review.answer.status).toBe(correct ? 'correct' : 'incorrect');
    expect(review.answer.reason).toBe(correct ? d.question.explanation : d.question.optionFeedback![d.answersBySlot[0]!.optionId]);
    expect(review.correctOptionText).toBe(d.question.options.find(o => o.id === d.question.correctOptionId)!.text);
    expect(d.aiPlan).toEqual(plan);
    expect(d.resolvedOutcome).toBeNull(); expect(e.feedbackState).toBeNull();
    expect(e.attemptEvents).toHaveLength(0); expect(e.players[0].correctAnswerStreak).toBe(0);
    expect(e.players[0].onFire).toBe(false); expect(e.scoreState.scores).toEqual([0, 0]);
    expect(answer(e, !correct).rejectionReason).toBe('duplicate-submission');
    expect(e.getSoloAnswerReview()).toEqual(review);
    step(e, d.config.answerWindowMs);
    expect(d.answersBySlot[1]!.optionId).toBe(plan!.chosenOptionId);
    expect(d.answersBySlot[1]!.acceptedTimeMs).toBe(plan!.plannedAnswerTimeMs);
  });

  it('also appears when CourtBot answered first and persists through resolution and learner-paced feedback', () => {
    const e = game(), d = e.activeDuel!;
    step(e, d.aiPlan!.plannedAnswerTimeMs + 25);
    expect(d.answersBySlot[1]).not.toBeNull(); expect(e.getSoloAnswerReview()).toBeNull();
    expect(answer(e).accepted).toBe(true); expect(e.phase).toBe('Resolution');
    const review = e.getSoloAnswerReview(); expect(review?.answer.status).toBe('correct');
    for (let n = 0; n < 200 && e.phase !== 'Feedback'; n++) step(e, 25);
    expect(e.phase).toBe('Feedback'); expect(e.getSoloAnswerReview()).toEqual(review);
    step(e, 20000); expect(e.phase).toBe('Feedback');
    e.acknowledgeFeedback(0, d.duelId); expect(e.getSoloAnswerReview()).toBeNull();
  });

  it('reading the review does not change RNG, the bot plan, learning credit or basketball results', () => {
    const a = game(), b = game();
    for (const e of [a, b]) { step(e, e.activeDuel!.config.readingMs); answer(e); }
    for (let n = 0; n < 100; n++) a.getSoloAnswerReview();
    for (const e of [a, b]) step(e, e.activeDuel!.config.answerWindowMs + 4000);
    expect(a.activeDuel!.resolvedOutcome).toEqual(b.activeDuel!.resolvedOutcome);
    expect(a.attemptEvents).toEqual(b.attemptEvents);
    expect(a.getLearningSummaries()).toEqual(b.getLearningSummaries());
  });

  it.each([['online', false], ['online', true], ['solo', false]] as const)('never provides early review in %s mode with bot=%s', (mode, bot) => {
    const e = game(mode, bot); step(e, e.activeDuel!.config.readingMs); answer(e);
    expect(e.getSoloAnswerReview()).toBeNull();
    const publicQuestion = JSON.stringify(e.activeDuel!.publicQuestionsBySlot);
    expect(publicQuestion).not.toContain('correctOptionId');
    expect(publicQuestion).not.toContain('explanation'); expect(publicQuestion).not.toContain('optionFeedback');
  });

  it('uses the actual custom question, falls back to its explanation and gives unanswered learners a teaching point', () => {
    const q = { ...BUNDLED_QUESTION_PACKS[0].questions[0], optionFeedback: undefined, explanation: 'A custom explanation.' };
    const wrong = q.options.find(o => o.id !== q.correctOptionId)!;
    const record = { playerId: 'a', optionId: wrong.id, acceptedTimeMs: 2500, isCorrect: false, locked: true } as const;
    expect(buildStudentAnswerFeedback(q, record).reason).toBe(q.explanation);
    expect(buildStudentAnswerFeedback(q, null)).toMatchObject({ status: 'unanswered', reason: q.explanation });
    expect(toPublicDuelQuestion(q, [...q.options], q.readingMs, q.answerWindowMs)).not.toHaveProperty('explanation');
  });
});
