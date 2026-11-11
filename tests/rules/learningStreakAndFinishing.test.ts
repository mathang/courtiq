import { describe, expect, it } from 'vitest';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../shared/rules/matchStateMachine';
import { isDrivingInPaint } from '../../shared/rules/finishing';
import { DUNK_STYLES } from '../../shared/rules/dunks';
import { computeBaseShotProbability, computeShotBasketProbability } from '../../shared/rules/shot';
import { toPublicDuelQuestion, validateQuestionPack } from '../../shared/content/question-schema';

const N: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
function game(seed = 53) {
  const e = new AuthoritativeMatchEngine({ matchId: 'learning', mode: 'solo', pack: BUNDLED_QUESTION_PACKS[0], seed,
    roomPresetId: 'standard', sessionLengthId: 'practice', customMaxPossessions: 100,
    player0: { id: 'a', pseudonym: 'A' }, player1: { id: 'b', pseudonym: 'B', isAi: false } });
  e.startMatch(); return e;
}
function step(e: AuthoritativeMatchEngine, ms: number) { for (let t = 0; t < ms; t += 50) e.step(Math.min(50, ms - t), [N, N]); }
function open(e: AuthoritativeMatchEngine, blocked = false) {
  const att = e.scoreState.currentAttacker, def = att === 0 ? 1 : 0;
  Object.assign(e.players[att], { x: 0, z: -2, vx: 0, vz: -2 });
  Object.assign(e.players[def], { x: blocked ? 0 : 5, z: blocked ? -3.1 : 1, facingAngle: 0 });
  e.initiateShotAttempt({ ...N, shoot: true });
  const d = e.activeDuel!;
  e.confirmClientDuelReady(0, d.duelId); e.confirmClientDuelReady(1, d.duelId);
  while (e.phase === 'QuestionReady') step(e, 50);
  step(e, d.config.readingMs);
  return d;
}
function resolve(e: AuthoritativeMatchEngine, correct: [boolean | null, boolean | null] = [true, true], blocked = false) {
  const d = open(e, blocked), def = e.scoreState.currentAttacker === 0 ? 1 : 0;
  for (const slot of (blocked ? [def, 1 - def] : [0, 1]) as (0 | 1)[]) {
    if (correct[slot] === null) continue;
    const optionId = correct[slot] ? d.question.correctOptionId : d.question.options.find(o => o.id !== d.question.correctOptionId)!.id;
    expect(e.submitAnswer({ slot, duelId: d.duelId, optionId }).accepted).toBe(true);
    if (blocked) step(e, 500);
  }
  if (correct.includes(null)) step(e, d.config.answerWindowMs);
  for (let t = 0; t < 5000 && e.phase !== 'Feedback'; t += 50) step(e, 50);
  expect(e.phase).toBe('Feedback'); return d;
}
function next(e: AuthoritativeMatchEngine) {
  const id = e.feedbackState!.duelId; e.acknowledgeFeedback(0, id); e.acknowledgeFeedback(1, id);
  expect(e.phase).toBe('Possession');
}

describe('Automatic paint finishes and authoritative random variety', () => {
  it.each([
    [{ x: 0, z: -1, vx: 0, vz: -2 }, true],
    [{ x: 0, z: -3, vx: 0, vz: 0 }, false],
    [{ x: 0, z: -3, vx: 0, vz: 2 }, false],
    [{ x: 2.46, z: -3, vx: -2, vz: -2 }, false],
    [{ x: 0, z: -0.64, vx: 0, vz: -2 }, false],
    [{ x: 0, z: -5.8, vx: 0, vz: 2 }, true],
  ] as const)('uses blue-paint bounds and real velocity for %j', (p, expected) => {
    expect(isDrivingInPaint(p)).toBe(expected);
    const e = game(); Object.assign(e.players[0], p); e.players[1].x = 5;
    e.initiateShotAttempt({ ...N, shoot: true, dunk: true, dunkStyle: '360' });
    expect(e.players[0].finishKind).toBe(expected ? 'dunk' : 'jump');
  });
  it('chooses reproducible varied dunk styles without immediate repeats or trusting a client style hint', () => {
    const sequence = (seed: number) => {
      const e = game(seed), styles: string[] = [];
      for (let i = 0; i < 12; i++) {
        resolve(e, [false, false]);
        // Score state already alternated; the finishing player remains identifiable by finishKind.
        styles.push(e.players.find(p => p.finishKind === 'dunk')!.dunkStyle);
        next(e);
      }
      return styles;
    };
    const styles = sequence(71);
    expect(styles).toEqual(sequence(71)); expect(new Set(styles).size).toBeGreaterThanOrEqual(3);
    expect(styles.every((s, i) => DUNK_STYLES.includes(s as typeof DUNK_STYLES[number]) && (!i || s !== styles[i - 1]))).toBe(true);
  });
  it('ignores client style hints and leaves the shared question draw and shuffle unchanged by dunk selection', () => {
    for (let seed=1;seed<=8;seed++) {
      const a=game(seed), b=game(seed), jumper=game(seed);
      for (const e of [a,b,jumper]) { e.players[0].z=-2; e.players[1].x=5; }
      a.players[0].vz=b.players[0].vz=-2;
      a.initiateShotAttempt({...N,shoot:true,dunkStyle:'360'});
      b.initiateShotAttempt({...N,shoot:true,dunkStyle:'windmill'});
      jumper.initiateShotAttempt({...N,shoot:true});
      expect(a.players[0].dunkStyle).toBe(b.players[0].dunkStyle);
      expect(a.activeDuel!.publicQuestionsBySlot).toEqual(jumper.activeDuel!.publicQuestionsBySlot);
    }
  });
  it.each([1000 / 60, 1000 / 30, 50, 100])('keeps a simultaneous trick and primary finish buffered at a %sms step', dt => {
    const e = game(); e.players[0].z = -1.8; e.players[1].x = 5;
    e.step(dt, [{ ...N, moveZ: -1, trick: 'eurostep', shoot: true }, N]);
    for (let t = 0; t < 600 && e.phase === 'Possession'; t += dt) e.step(dt, [{ ...N, moveZ: -1 }, N]);
    expect(e.phase).toBe('QuestionReady'); expect(e.players[0].finishKind).toBe('dunk');
  });
});

describe('Learning-powered Fire and learner-paced explanations', () => {
  it('ignites independently after three correct answers, persists through basketball blocks, and ends on a wrong or unanswered question', () => {
    const e = game();
    for (let streak = 1; streak <= 3; streak++) {
      const d = resolve(e, [true, true], true);
      expect(d.resolvedOutcome!.outcome).toBe('block');
      expect(e.players.map(p => p.correctAnswerStreak)).toEqual([streak, streak]);
      expect(e.players.map(p => p.onFire)).toEqual([streak >= 3, streak >= 3]);
      next(e);
    }
    const d = resolve(e, [false, true]);
    expect(e.players.map(p => p.correctAnswerStreak)).toEqual([0, 4]);
    expect(e.players.map(p => p.onFire)).toEqual([false, true]);
    expect(d.resolvedOutcome!.release.onFire).toBe(true); // Slot 1 attacked and maintained their own streak.
    next(e); resolve(e, [true, null]);
    expect(e.players.map(p => p.correctAnswerStreak)).toEqual([1, 0]);
    expect(e.players[1].onFire).toBe(false);
  });
  it('applies +20 percentage points on the third correct answer and removes the bonus on the wrong answer, without leaking correctness early', () => {
    const e = game();
    for (let i = 0; i < 2; i++) { resolve(e); next(e); }
    const d = open(e), base = d.releaseSnapshot.baseProbability;
    e.submitAnswer({ slot: 0, duelId: d.duelId, optionId: d.question.correctOptionId });
    expect(e.players[0].onFire).toBe(false); expect(e.players[0].correctAnswerStreak).toBe(2);
    e.submitAnswer({ slot: 1, duelId: d.duelId, optionId: d.question.correctOptionId });
    expect(d.resolvedOutcome!.baseProbability).toBeCloseTo(base + 0.20, 5);
    expect(d.resolvedOutcome!.finalProbability).toBeLessThanOrEqual(0.95);
    step(e, 2500); next(e);
    const wrong = resolve(e, [false, false]);
    expect(wrong.resolvedOutcome!.baseProbability).toBeCloseTo(wrong.releaseSnapshot.baseProbability - 0.20, 5);
  });
  it('moves 20% faster without requiring sprint, while Street Flow alone never ignites Fire', () => {
    const a = game(), b = game(); b.players[0].onFire = true; b.players[0].correctAnswerStreak = 3;
    a.players[1].x = b.players[1].x = -5;
    for (let i = 0; i < 30; i++) { a.step(16, [{ ...N, moveX: 1 }, N]); b.step(16, [{ ...N, moveX: 1 }, N]); }
    expect(b.players[0].vx / a.players[0].vx).toBeCloseTo(1.2, 2);
    a.players[0].streetFlow = 1; a.step(16, [{ ...N, trick: 'spin' }, N]);
    expect(a.players[0].onFire).toBe(false);
  });
  it('keeps correct learning credit on a missed basket', () => {
    let sawMiss = false;
    for (let seed = 1; seed <= 40 && !sawMiss; seed++) {
      const e = game(seed), d = resolve(e);
      if (d.resolvedOutcome!.outcome === 'miss') {
        sawMiss = true; expect(e.players[0].correctAnswerStreak).toBe(1);
        expect(e.feedbackState!.learningBySlot![0].status).toBe('correct');
      }
    }
    expect(sawMiss).toBe(true);
  });
  it('preserves both learning streaks across a clean live steal', () => {
    const e=game();for(const p of e.players){p.onFire=true;p.correctAnswerStreak=3;}
    e.players[1].x=.32;e.players[1].z=e.players[0].z-.9;e.players[1].facingAngle=0;
    e.step(10,[N,{...N,defense:'swipe'}]);step(e,140);
    expect(e.scoreState.currentAttacker).toBe(1);
    expect(e.players.map(p=>p.correctAnswerStreak)).toEqual([3,3]);
    expect(e.players.every(p=>p.onFire)).toBe(true);
    expect(e.getLearningSummaries()[0].totalQuestions).toBe(0);
  });
  it('shows each student their selected option and specific misconception, waits for both confirmations, and ignores stale confirmations', () => {
    const e = game(); const d = resolve(e, [false, true]); const fb = e.feedbackState!;
    expect(fb.learningBySlot![0]).toMatchObject({ status: 'incorrect', selectedOptionId: d.answersBySlot[0]!.optionId,
      reason: d.question.optionFeedback![d.answersBySlot[0]!.optionId] });
    expect(fb.learningBySlot![1].status).toBe('correct');
    expect(fb.questionStem).toBe(d.question.stem); step(e, 20000); expect(e.phase).toBe('Feedback');
    e.acknowledgeFeedback(0, 'stale'); expect(fb.continueReady).toEqual([false, false]);
    e.acknowledgeFeedback(0, d.duelId); step(e, 10000); expect(e.phase).toBe('Feedback');
    expect(fb.continueReady).toEqual([true, false]); e.acknowledgeFeedback(1, d.duelId); expect(e.phase).toBe('Possession');
  });
  it('covers all 255 distractors in the 85 bundled questions and keeps every explanation out of public payloads', () => {
    let count = 0;
    for (const pack of BUNDLED_QUESTION_PACKS) for (const q of pack.questions) {
      const wrong = q.options.filter(o => o.id !== q.correctOptionId);
      expect(Object.keys(q.optionFeedback!).sort()).toEqual(wrong.map(o => o.id).sort());
      wrong.forEach(o => expect(q.optionFeedback![o.id].length).toBeGreaterThan(20)); count += wrong.length;
      const publicQ = toPublicDuelQuestion(q, q.options, q.readingMs, q.answerWindowMs);
      expect(publicQ).not.toHaveProperty('optionFeedback'); expect(publicQ).not.toHaveProperty('correctOptionId');
    }
    expect(count).toBe(255);
    const pack = BUNDLED_QUESTION_PACKS[0];
    expect(validateQuestionPack({ ...pack, questions: [{ ...pack.questions[0], optionFeedback: { unknown: 'wrong key' } }] }).valid).toBe(false);
    expect(validateQuestionPack({ ...pack, questions: [{ ...pack.questions[0], optionFeedback: [] }] }).valid).toBe(false);
  });
  it('adds a full Fire shooting bonus in every zone and keeps the final probability capped', () => {
    for (const zone of ['close', 'mid-range', 'three-pointer'] as const) for (const heavilyContested of [true, false]) {
      const params = { zone, heavilyContested, releasedWhileSprinting: true, setupBonus: 0.05 };
      expect(computeBaseShotProbability({ ...params, onFire: true }) - computeBaseShotProbability(params)).toBeCloseTo(.2, 6);
    }
    expect(computeShotBasketProbability({ baseProbability: .6, attackerCorrect: true, speedScore: 1 }).finalProbability).toBe(.95);
  });
});
