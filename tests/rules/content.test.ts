import { describe, expect, it } from 'vitest';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import {
  createSeededRng,
  shuffleQuestionOptionsForPlayer,
  toPublicDuelQuestion,
  validateQuestionPack,
} from '../../shared/content/question-schema';

describe('Question pack validation & option shuffling (Sections 10 & 15)', () => {
  it('validates both bundled SPX101 approved packs (45 and 40 questions)', () => {
    expect(BUNDLED_QUESTION_PACKS.length).toBe(2);

    const w09 = BUNDLED_QUESTION_PACKS[0];
    const w09Val = validateQuestionPack(w09);
    expect(w09Val.valid).toBe(true);
    expect(w09Val.approvedQuestionCount).toBe(45);

    const w05 = BUNDLED_QUESTION_PACKS[1];
    const w05Val = validateQuestionPack(w05);
    expect(w05Val.valid).toBe(true);
    expect(w05Val.approvedQuestionCount).toBe(40);
  });

  it('rejects duplicate IDs, missing explanations, invalid correctOptionId, or non-4 options', () => {
    const invalidPack = {
      packId: 'bad-pack',
      packVersion: 1,
      title: 'Invalid Pack',
      course: 'SPX101',
      questions: [
        {
          id: 'q1',
          version: 1,
          course: 'SPX101',
          week: 9,
          topic: 'Topic',
          learningOutcome: 'LO',
          stem: 'Question 1?',
          options: [
            { id: 'a', text: 'Opt A' },
            { id: 'b', text: 'Opt B' },
            { id: 'c', text: 'Opt C' },
          ], // Only 3 options!
          correctOptionId: 'z', // Not in options!
          explanation: '', // Missing explanation!
          sourceRef: 'Ref',
          difficulty: 'beginner',
          readingMs: 2000,
          answerWindowMs: 12000,
          status: 'approved',
        },
        {
          id: 'q1', // Duplicate ID!
          version: 1,
          course: 'SPX101',
          week: 9,
          topic: 'Topic',
          learningOutcome: 'LO',
          stem: 'Question 2?',
          options: [
            { id: 'a', text: 'Opt A' },
            { id: 'b', text: 'Opt B' },
            { id: 'c', text: 'Opt C' },
            { id: 'd', text: 'All of the above' }, // Position-dependent wording without shuffleRestricted!
          ],
          correctOptionId: 'a',
          explanation: 'Valid explanation',
          sourceRef: 'Ref',
          difficulty: 'beginner',
          readingMs: 2000,
          answerWindowMs: 12000,
          status: 'approved',
        },
      ],
    };

    const res = validateQuestionPack(invalidPack);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('exactly 4 options'))).toBe(true);
    expect(res.errors.some((e) => e.includes('missing explanation'))).toBe(true);
    expect(res.errors.some((e) => e.includes('duplicate question ID'))).toBe(true);
    expect(res.errors.some((e) => e.includes('position-dependent wording'))).toBe(true);
  });

  it('shuffles option presentation independently per player while preserving stable option IDs and stripping answer keys', () => {
    const q = BUNDLED_QUESTION_PACKS[0].questions[0];
    const rng = createSeededRng(42);
    const p0Opts = shuffleQuestionOptionsForPlayer(q, rng);
    const p1Opts = shuffleQuestionOptionsForPlayer(q, rng);

    expect(p0Opts.map((o) => o.id).sort()).toEqual(
      q.options.map((o) => o.id).sort()
    );
    expect(p1Opts.map((o) => o.id).sort()).toEqual(
      q.options.map((o) => o.id).sort()
    );

    const pub = toPublicDuelQuestion(q, p0Opts, 2000, 12000);
    expect('correctOptionId' in (pub as unknown as Record<string, unknown>)).toBe(
      false
    );
    expect('explanation' in (pub as unknown as Record<string, unknown>)).toBe(
      false
    );
  });
});
