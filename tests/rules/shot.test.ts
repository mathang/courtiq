import { describe, expect, it } from 'vitest';
import {
  captureShotReleaseSnapshot,
  classifyShotZone,
  computeBaseShotProbability,
  computeShotBasketProbability,
  createInitialBallFlightState,
  evaluateBallPosition,
  resolveAuthoritativeShot,
  stepBallPreResolution,
  transitionBallToResolution,
} from '../../shared/rules/shot';
import { evaluateBlockEligibilityAtRelease } from '../../shared/rules/block';
import { computeSpeedScore, evaluateQuestionDuel } from '../../shared/rules/timing';
import { COURT_GEOMETRY } from '../../shared/config/balance';

describe('Shot probability & 4-stage slow-motion trajectory rules', () => {
  it('reproduces the NBA-informed open mid-range base and timing bonuses', () => {
    const baseMidRange = computeBaseShotProbability({
      zone: 'mid-range',
      defenderDistanceM: 2.6,
      releasedWhileSprinting: false,
    });
    expect(baseMidRange).toBe(0.1427);

    // Wrong or unanswered -> 12%
    const wrongProb = computeShotBasketProbability({
      baseProbability: baseMidRange,
      attackerCorrect: false,
      speedScore: 0.9,
    });
    expect(wrongProb.finalProbability).toBeCloseTo(0.1427, 4);

    // Correct at 3 seconds (R=2000ms, T=12000ms) -> S=0.9 -> 0.8077 (~79%)
    const s3 = computeSpeedScore(3000, 2000, 12000);
    expect(s3).toBeCloseTo(0.9, 4);
    const p3 = computeShotBasketProbability({
      baseProbability: baseMidRange,
      attackerCorrect: true,
      speedScore: s3,
    });
    expect(p3.finalProbability).toBeCloseTo(0.8077, 3);
    expect(Math.round(p3.finalProbability * 100)).toBe(81);

    // Correct at 7 seconds -> S=0.5 -> 0.6677 (~65%)
    const s7 = computeSpeedScore(7000, 2000, 12000);
    expect(s7).toBeCloseTo(0.5, 4);
    const p7 = computeShotBasketProbability({
      baseProbability: baseMidRange,
      attackerCorrect: true,
      speedScore: s7,
    });
    expect(p7.finalProbability).toBeCloseTo(0.6677, 3);
    expect(Math.round(p7.finalProbability * 100)).toBe(67);

    // Correct at 11 seconds -> S=0.1 -> 0.5277 (~51%)
    const s11 = computeSpeedScore(11000, 2000, 12000);
    expect(s11).toBeCloseTo(0.1, 4);
    const p11 = computeShotBasketProbability({
      baseProbability: baseMidRange,
      attackerCorrect: true,
      speedScore: s11,
    });
    expect(p11.finalProbability).toBeCloseTo(0.5277, 3);
    expect(Math.round(p11.finalProbability * 100)).toBe(53);
  });

  it('applies zone, defender distance and turbo at release modifiers', () => {
    expect(
      computeBaseShotProbability({
        zone: 'close',
        defenderDistanceM: 2.6,
        releasedWhileSprinting: false,
      })
    ).toBe(0.2237);

    expect(
      computeBaseShotProbability({
        zone: 'three-pointer',
        defenderDistanceM: 2.6,
        releasedWhileSprinting: false,
      })
    ).toBe(0.1171);

    expect(
      computeBaseShotProbability({
        zone: 'mid-range',
        defenderDistanceM: 1.2192,
        releasedWhileSprinting: true,
      })
    ).toBe(0.0327);

    // Clamped to minimum 3% when resolving shot basket probability
    const clampedLow = computeShotBasketProbability({
      baseProbability: 0.02,
      attackerCorrect: false,
      speedScore: 0,
    });
    expect(clampedLow.finalProbability).toBe(0.03);
  });

  it('classifies 2-point vs 3-point zones accurately around the 6.75m arc', () => {
    expect(classifyShotZone(1.9)).toEqual({ zone: 'close', pointValue: 2 });
    expect(classifyShotZone(4.5)).toEqual({ zone: 'mid-range', pointValue: 2 });
    expect(classifyShotZone(6.75)).toEqual({ zone: 'three-pointer', pointValue: 3 });
    expect(classifyShotZone(7.8)).toEqual({ zone: 'three-pointer', pointValue: 3 });
  });

  it('allows a valid block to override the shooting probability calculation', () => {
    const shooterPos = { x: 0, z: -1.5 };
    const defenderPos = { x: 0, z: -2.6 };
    const blockElig = evaluateBlockEligibilityAtRelease({
      shooterPos,
      defenderPos,
      defenderFacingAngle: 0, // Facing +Z towards shooter
    });
    expect(blockElig.eligible).toBe(true);

    const release = captureShotReleaseSnapshot({
      shooterPos,
      defenderPos,
      releasedWhileSprinting: false,
      blockEligibility: blockElig,
    });

    const duel = evaluateQuestionDuel(
      {
        duelId: 'duel-1',
        questionId: 'q1',
        validOptionIds: ['a', 'b', 'c', 'd'],
        correctOptionId: 'a',
        readingMs: 2000,
        answerWindowMs: 12000,
        tieToleranceMs: 200,
        blockEligibility: blockElig,
      },
      {
        playerId: 'p0',
        optionId: 'a',
        acceptedTimeMs: 4500,
        isCorrect: true,
        locked: true,
      },
      {
        playerId: 'p1',
        optionId: 'a',
        acceptedTimeMs: 3000,
        isCorrect: true,
        locked: true,
      }
    );

    expect(duel.shotBlocked).toBe(true);

    const outcome = resolveAuthoritativeShot({
      release,
      duel,
      randomDraw: 0.001, // Even with a 0.001 random draw, block overrides probability
    });
    expect(outcome.outcome).toBe('block');
    expect(outcome.pointsAwarded).toBe(0);
    expect(outcome.finalProbability).toBe(0);
  });

  it('maintains C0 position continuity (zero teleportation) and never reaches the rim during the question stage', () => {
    for (const outcome of ['basket', 'miss', 'block'] as const) {
      let state = createInitialBallFlightState({
        shooterPos: { x: 2.2, z: 0.5 },
        defenderPos: { x: 1.5, z: -0.6 },
      });

      // Step through release and a full 20-second slow-motion question window
      for (let i = 0; i < 200; i++) {
        state = stepBallPreResolution(state, 0.1);
        const pos = evaluateBallPosition(state);
        const distToRim = Math.hypot(
          pos.x - COURT_GEOMETRY.hoopX,
          pos.z - COURT_GEOMETRY.hoopZ
        );
        // Never reaches the rim during release or question stage
        expect(distToRim).toBeGreaterThan(1.0);
      }

      expect(state.stage).toBe('question');
      const posBeforeTransition = evaluateBallPosition(state);
      const transitioned = transitionBallToResolution(state, outcome);
      const posAfterTransition = evaluateBallPosition(transitioned);

      const jumpDistance = Math.hypot(
        posAfterTransition.x - posBeforeTransition.x,
        posAfterTransition.y - posBeforeTransition.y,
        posAfterTransition.z - posBeforeTransition.z
      );
      expect(jumpDistance).toBeLessThan(1e-6);
    }
  });
});
