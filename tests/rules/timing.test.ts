import { describe, expect, it } from 'vitest';
import {
  DuelConfig,
  evaluateQuestionDuel,
  validateAnswerSubmission,
} from '../../shared/rules/timing';
import { evaluateBlockEligibilityAtRelease } from '../../shared/rules/block';

function makeDuelConfig(eligible: boolean): DuelConfig {
  const blockEligibility = evaluateBlockEligibilityAtRelease({
    shooterPos: { x: 0, z: 0 },
    defenderPos: { x: 0, z: eligible ? -1.3 : -3.5 },
    defenderFacingAngle: 0,
  });
  return {
    duelId: 'duel-test-1',
    questionId: 'spx101-w09-001',
    validOptionIds: ['error', 'brand', 'order', 'pref'],
    correctOptionId: 'error',
    readingMs: 2000,
    answerWindowMs: 12000,
    tieToleranceMs: 200,
    blockEligibility,
  };
}

describe('Exact question-duel rules & timing fairness (Sections 5 & 6)', () => {
  it('enforces protected reading period, deadline, valid option IDs, and one locked submission per player', () => {
    const cfg = makeDuelConfig(true);

    // Too early (during 2s reading period)
    const early = validateAnswerSubmission(cfg, null, {
      duelId: 'duel-test-1',
      playerId: 'p0',
      optionId: 'error',
      elapsedMs: 1500,
    });
    expect(early.accepted).toBe(false);
    expect(early.rejectionReason).toBe('reading-period-protected');

    // Stale duel ID
    const stale = validateAnswerSubmission(cfg, null, {
      duelId: 'duel-old-0',
      playerId: 'p0',
      optionId: 'error',
      elapsedMs: 3000,
    });
    expect(stale.accepted).toBe(false);
    expect(stale.rejectionReason).toBe('wrong-duel-id');

    // Past deadline
    const late = validateAnswerSubmission(cfg, null, {
      duelId: 'duel-test-1',
      playerId: 'p0',
      optionId: 'error',
      elapsedMs: 12001,
    });
    expect(late.accepted).toBe(false);
    expect(late.rejectionReason).toBe('past-deadline');

    // First valid wrong answer locks
    const firstWrong = validateAnswerSubmission(cfg, null, {
      duelId: 'duel-test-1',
      playerId: 'p0',
      optionId: 'brand',
      elapsedMs: 2500,
    });
    expect(firstWrong.accepted).toBe(true);
    expect(firstWrong.record?.isCorrect).toBe(false);
    expect(firstWrong.record?.locked).toBe(true);

    // Second submission attempt is rejected as duplicate
    const retry = validateAnswerSubmission(cfg, firstWrong.record!, {
      duelId: 'duel-test-1',
      playerId: 'p0',
      optionId: 'error',
      elapsedMs: 3200,
    });
    expect(retry.accepted).toBe(false);
    expect(retry.rejectionReason).toBe('duplicate-submission');
  });

  it('resolves all 9 duel situations from Section 5 accurately', () => {
    const eligibleCfg = makeDuelConfig(true);
    const outOfRangeCfg = makeDuelConfig(false);

    // 1. Attacker correct (4.0s); defender wrong (2.5s) -> Attacker earns bonus
    const s1 = evaluateQuestionDuel(
      eligibleCfg,
      { playerId: 'att', optionId: 'error', acceptedTimeMs: 4000, isCorrect: true, locked: true },
      { playerId: 'def', optionId: 'brand', acceptedTimeMs: 2500, isCorrect: false, locked: true }
    );
    expect(s1.ruleOutcome).toBe('attacker-correct-defender-wrong');
    expect(s1.shotBlocked).toBe(false);
    expect(s1.attackerSpeedScore).toBeCloseTo(0.8, 4);

    // 2. Attacker correct first (3.0s vs 4.5s) -> Attacker earns bonus; defender cannot block
    const s2 = evaluateQuestionDuel(
      eligibleCfg,
      { playerId: 'att', optionId: 'error', acceptedTimeMs: 3000, isCorrect: true, locked: true },
      { playerId: 'def', optionId: 'error', acceptedTimeMs: 4500, isCorrect: true, locked: true }
    );
    expect(s2.ruleOutcome).toBe('attacker-correct-first');
    expect(s2.shotBlocked).toBe(false);

    // 3. Eligible defender correct first outside tie tolerance (3.0s vs 3.5s) -> Shot is blocked
    const s3 = evaluateQuestionDuel(
      eligibleCfg,
      { playerId: 'att', optionId: 'error', acceptedTimeMs: 3500, isCorrect: true, locked: true },
      { playerId: 'def', optionId: 'error', acceptedTimeMs: 3000, isCorrect: true, locked: true }
    );
    expect(s3.ruleOutcome).toBe('eligible-defender-correct-first-block');
    expect(s3.shotBlocked).toBe(true);

    // 4. Defender correct first (3.0s vs 5.0s) but too far away -> No block; attacker earns bonus, defender still credited
    const s4 = evaluateQuestionDuel(
      outOfRangeCfg,
      { playerId: 'att', optionId: 'error', acceptedTimeMs: 5000, isCorrect: true, locked: true },
      { playerId: 'def', optionId: 'error', acceptedTimeMs: 3000, isCorrect: true, locked: true }
    );
    expect(s4.ruleOutcome).toBe('defender-correct-first-out-of-range');
    expect(s4.shotBlocked).toBe(false);
    expect(s4.defenderTooFarToBlock).toBe(true);
    expect(s4.attackerSpeedScore).toBeCloseTo(0.7, 4);
    expect(s4.defenderCorrect).toBe(true);

    // 5. Both correct within 200ms tie window (3.00s vs 3.15s) -> No block; attacker earns normal bonus
    const s5 = evaluateQuestionDuel(
      eligibleCfg,
      { playerId: 'att', optionId: 'error', acceptedTimeMs: 3150, isCorrect: true, locked: true },
      { playerId: 'def', optionId: 'error', acceptedTimeMs: 3000, isCorrect: true, locked: true }
    );
    expect(s5.ruleOutcome).toBe('both-correct-within-tie-window');
    expect(s5.shotBlocked).toBe(false);
    expect(s5.tiedCorrect).toBe(true);
    expect(s5.attackerSpeedScore).toBeGreaterThan(0.8);

    // 6 & 7. Both wrong -> No bonus, no block
    const s6 = evaluateQuestionDuel(
      eligibleCfg,
      { playerId: 'att', optionId: 'brand', acceptedTimeMs: 3000, isCorrect: false, locked: true },
      { playerId: 'def', optionId: 'order', acceptedTimeMs: 3500, isCorrect: false, locked: true }
    );
    expect(s6.ruleOutcome).toBe('attacker-wrong-defender-wrong');
    expect(s6.shotBlocked).toBe(false);
    expect(s6.attackerSpeedScore).toBe(0);

    // 8. Neither answers before deadline -> Low-probability shot resolves
    const s8 = evaluateQuestionDuel(eligibleCfg, null, null);
    expect(s8.ruleOutcome).toBe('neither-answered');
    expect(s8.shotBlocked).toBe(false);
    expect(s8.attackerSpeedScore).toBe(0);

    // 9. Attacker wrong (2.5s); eligible defender later correct (6.0s) -> Defender blocks before deadline
    const s9 = evaluateQuestionDuel(
      eligibleCfg,
      { playerId: 'att', optionId: 'brand', acceptedTimeMs: 2500, isCorrect: false, locked: true },
      { playerId: 'def', optionId: 'error', acceptedTimeMs: 6000, isCorrect: true, locked: true }
    );
    expect(s9.ruleOutcome).toBe('attacker-wrong-eligible-defender-blocks');
    expect(s9.shotBlocked).toBe(true);
  });
});
