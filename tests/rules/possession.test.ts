import { describe, expect, it } from 'vitest';
import {
  advancePossessionAfterAttempt,
  createInitialPossessionScoreState,
  MatchRulesConfig,
} from '../../shared/rules/possession';

describe('Possession alternation, equal opportunities, and paired overtime (Section 11)', () => {
  const rules: MatchRulesConfig = {
    targetScore: 11,
    maxPossessionsPerPlayer: 10,
    movementClockMs: 15000,
  };

  it('alternates possession after every resolved attempt and preserves equal possessions before deciding a winner', () => {
    let state = createInitialPossessionScoreState(0);

    // Give Player 0 four 3-pointers (12 points) while Player 1 scores 2 points per turn
    for (let round = 1; round <= 3; round++) {
      state = advancePossessionAfterAttempt(state, rules, 3); // P0: 3, 6, 9
      expect(state.currentAttacker).toBe(1);
      expect(state.isMatchOver).toBe(false);

      state = advancePossessionAfterAttempt(state, rules, 2); // P1: 2, 4, 6
      expect(state.currentAttacker).toBe(0);
      expect(state.isMatchOver).toBe(false);
    }

    // Round 4: P0 hits a 3-pointer to reach 12 points (>= 11 targetScore)
    // Match must NOT end yet because P0 has had 4 possessions and P1 has only had 3!
    state = advancePossessionAfterAttempt(state, rules, 3);
    expect(state.scores).toEqual([12, 6]);
    expect(state.possessionsCompleted).toEqual([4, 3]);
    expect(state.isMatchOver).toBe(false);
    expect(state.currentAttacker).toBe(1);

    // P1 completes their 4th possession (scores 2 -> 8 points). Now possessions are equal (4 each), P0 wins!
    state = advancePossessionAfterAttempt(state, rules, 2);
    expect(state.possessionsCompleted).toEqual([4, 4]);
    expect(state.isMatchOver).toBe(true);
    expect(state.winner).toBe(0);
  });

  it('triggers paired overtime rounds when tied after equal possessions at maxPossessionsPerPlayer or targetScore', () => {
    const shortRules: MatchRulesConfig = {
      targetScore: 11,
      maxPossessionsPerPlayer: 2,
      movementClockMs: 15000,
    };

    let state = createInitialPossessionScoreState(0);
    // Round 1: both score 2
    state = advancePossessionAfterAttempt(state, shortRules, 2);
    state = advancePossessionAfterAttempt(state, shortRules, 2);
    // Round 2: both score 3 -> tied 5-5 after 2 possessions each (maxPossessionsPerPlayer reached!)
    state = advancePossessionAfterAttempt(state, shortRules, 3);
    state = advancePossessionAfterAttempt(state, shortRules, 3);

    expect(state.scores).toEqual([5, 5]);
    expect(state.possessionsCompleted).toEqual([2, 2]);
    expect(state.isMatchOver).toBe(false);
    expect(state.isOvertime).toBe(true);
    expect(state.overtimeRound).toBe(1);

    // Overtime pair 1: P0 scores 2 (7-5), P1 must still get their overtime possession!
    state = advancePossessionAfterAttempt(state, shortRules, 2);
    expect(state.isMatchOver).toBe(false);
    expect(state.currentAttacker).toBe(1);

    // P1 misses (0 pts) -> P0 wins 7-5 after equal overtime possessions (3 each)!
    state = advancePossessionAfterAttempt(state, shortRules, 0);
    expect(state.possessionsCompleted).toEqual([3, 3]);
    expect(state.isMatchOver).toBe(true);
    expect(state.winner).toBe(0);
  });
});
