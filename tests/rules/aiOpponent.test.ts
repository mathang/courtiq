import { describe, expect, it } from 'vitest';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { AuthoritativeMatchEngine } from '../../shared/rules/matchStateMachine';

describe('Solo match simulation & AI pre-committed question plan (Sections 12 & 19)', () => {
  it('completes an entire solo match against the computer without manual resets and without repeating questions', () => {
    const engine = new AuthoritativeMatchEngine({
      matchId: 'solo-test-match',
      mode: 'solo',
      pack: BUNDLED_QUESTION_PACKS[0],
      roomPresetId: 'standard',
      sessionLengthId: 'quick',
      aiDifficulty: 'intermediate',
      player0: { id: 'student-1', pseudonym: 'Alex' },
      player1: { id: 'ai-bot', pseudonym: 'CourtBot', isAi: true },
      seed: 1337,
    });

    engine.startMatch();
    expect(engine.phase).toBe('Possession');

    let safetyTicks = 0;
    const seenQuestionIds = new Set<string>();

    while (engine.phase !== 'MatchEnd' && safetyTicks < 20000) {
      safetyTicks++;

      if (engine.phase === 'Possession') {
        const isHumanAttacker = engine.scoreState.currentAttacker === 0;
        engine.step(100, [
          {
            moveX: 0,
            moveZ: isHumanAttacker ? -1 : 0,
            sprint: false,
            shoot: isHumanAttacker && engine.movementClockRemainingMs < 13500,
          },
          { moveX: 0, moveZ: 0, sprint: false, shoot: false },
        ]);
      } else if (engine.phase === 'QuestionReady') {
        engine.step(100, [
          { moveX: 0, moveZ: 0, sprint: false, shoot: false },
          { moveX: 0, moveZ: 0, sprint: false, shoot: false },
        ]);
      } else if (engine.phase === 'Duel' && engine.activeDuel) {
        // Verify AI plan was already committed at duel start before human answers
        expect(engine.activeDuel.aiPlan).not.toBeNull();
        seenQuestionIds.add(engine.activeDuel.question.id);

        engine.step(200, [
          { moveX: 0, moveZ: 0, sprint: false, shoot: false },
          { moveX: 0, moveZ: 0, sprint: false, shoot: false },
        ]);

        if (
          engine.phase === 'Duel' &&
          engine.activeDuel &&
          engine.activeDuel.elapsedRealMs >= engine.activeDuel.config.readingMs + 500 &&
          engine.activeDuel.answersBySlot[0] === null
        ) {
          engine.submitAnswer({
            slot: 0,
            duelId: engine.activeDuel.duelId,
            optionId: engine.activeDuel.question.correctOptionId,
          });
        }
      } else {
        engine.step(100, [
          { moveX: 0, moveZ: 0, sprint: false, shoot: false },
          { moveX: 0, moveZ: 0, sprint: false, shoot: false },
        ]);
      }
    }

    expect(engine.phase).toBe('MatchEnd');
    expect(engine.scoreState.isMatchOver).toBe(true);
    expect(
      engine.scoreState.possessionsCompleted[0]
    ).toBe(engine.scoreState.possessionsCompleted[1]);

    // Verify no question was repeated during the match
    expect(seenQuestionIds.size).toBe(engine.attemptEvents.length);

    // Verify separated learning summary
    const [p0Summary] = engine.getLearningSummaries();
    expect(p0Summary.totalQuestions).toBe(engine.attemptEvents.length);
    expect(p0Summary.overallAccuracyPercent).toBe(100);
  });
});
