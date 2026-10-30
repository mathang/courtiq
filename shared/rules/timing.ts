import { BlockEligibilitySnapshot } from './block';

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Calculates normalised speed score S in [0, 1]:
 * S = clamp(1 - (t - R) / (T - R), 0, 1)
 * Where:
 *  t = accepted answer time in ms since question reveal
 *  R = protected reading period in ms
 *  T = answer deadline in ms
 */
export function computeSpeedScore(
  acceptedTimeMs: number,
  readingMs: number,
  answerWindowMs: number
): number {
  if (answerWindowMs <= readingMs) {
    return 1;
  }
  const raw = 1 - (acceptedTimeMs - readingMs) / (answerWindowMs - readingMs);
  return clamp(raw, 0, 1);
}

/**
 * Bounded latency adjustment for online play:
 * Adjusts server-observed elapsed time by at most maxAdjustmentMs (default 150ms)
 * based on half of measured round-trip time, never trusting arbitrary client timestamps.
 */
export function computeBoundedServerAnswerTimeMs(
  serverElapsedMs: number,
  measuredRttMs: number,
  readingMs: number,
  maxAdjustmentMs = 150
): number {
  const oneWayEstimate = clamp(Math.max(0, measuredRttMs) * 0.5, 0, maxAdjustmentMs);
  return Math.max(readingMs, serverElapsedMs - oneWayEstimate);
}

export interface PlayerAnswerRecord {
  readonly playerId: string;
  readonly optionId: string;
  readonly acceptedTimeMs: number;
  readonly isCorrect: boolean;
  readonly locked: true;
}

export interface SubmissionValidationResult {
  readonly accepted: boolean;
  readonly rejectionReason?:
    | 'wrong-duel-id'
    | 'reading-period-protected'
    | 'past-deadline'
    | 'duplicate-submission'
    | 'invalid-option-id';
  readonly record?: PlayerAnswerRecord;
}

export interface DuelConfig {
  readonly duelId: string;
  readonly questionId: string;
  readonly validOptionIds: readonly string[];
  readonly correctOptionId: string;
  readonly readingMs: number;
  readonly answerWindowMs: number;
  readonly tieToleranceMs: number;
  readonly blockEligibility: BlockEligibilitySnapshot;
}

/**
 * Validates a single answer submission from a player.
 * - Rejects stale/wrong duel IDs
 * - Rejects submissions during the protected reading period (t < readingMs)
 * - Rejects late submissions after deadline (t > answerWindowMs)
 * - Rejects duplicate submissions (only the first valid submission counts)
 * - Rejects unknown option IDs
 */
export function validateAnswerSubmission(
  config: DuelConfig,
  existingRecord: PlayerAnswerRecord | null,
  submission: {
    duelId: string;
    playerId: string;
    optionId: string;
    elapsedMs: number;
  }
): SubmissionValidationResult {
  if (submission.duelId !== config.duelId) {
    return { accepted: false, rejectionReason: 'wrong-duel-id' };
  }
  if (existingRecord !== null) {
    return { accepted: false, rejectionReason: 'duplicate-submission' };
  }
  if (submission.elapsedMs < config.readingMs) {
    return { accepted: false, rejectionReason: 'reading-period-protected' };
  }
  if (submission.elapsedMs > config.answerWindowMs) {
    return { accepted: false, rejectionReason: 'past-deadline' };
  }
  if (!config.validOptionIds.includes(submission.optionId)) {
    return { accepted: false, rejectionReason: 'invalid-option-id' };
  }

  return {
    accepted: true,
    record: Object.freeze({
      playerId: submission.playerId,
      optionId: submission.optionId,
      acceptedTimeMs: submission.elapsedMs,
      isCorrect: submission.optionId === config.correctOptionId,
      locked: true,
    }),
  };
}

export type DuelRuleOutcomeType =
  | 'attacker-correct-defender-wrong'
  | 'attacker-correct-first'
  | 'eligible-defender-correct-first-block'
  | 'defender-correct-first-out-of-range'
  | 'both-correct-within-tie-window'
  | 'attacker-wrong-defender-wrong'
  | 'neither-answered'
  | 'attacker-wrong-eligible-defender-blocks'
  | 'attacker-wrong-defender-out-of-range';

export interface DuelResolutionSummary {
  readonly duelId: string;
  readonly ruleOutcome: DuelRuleOutcomeType;
  readonly shotBlocked: boolean;
  readonly defenderTooFarToBlock: boolean;
  readonly tiedCorrect: boolean;
  readonly attackerCorrect: boolean;
  readonly defenderCorrect: boolean;
  readonly attackerSpeedScore: number;
  readonly defenderSpeedScore: number;
  readonly attackerAnswer: PlayerAnswerRecord | null;
  readonly defenderAnswer: PlayerAnswerRecord | null;
  readonly statusBannerText: string;
}

/**
 * Resolves the exact question-duel rules from Section 5 of the specification:
 * - Attacker correct; defender wrong -> Attacker earns shooting bonus
 * - Attacker correct first -> Attacker earns bonus; defender cannot block this attempt
 * - Eligible defender correct first (outside tie tolerance) -> Shot is blocked
 * - Defender correct first but too far away -> No block; attacker can still answer and earn a bonus
 * - Both correct within the tie window -> No block; attacker earns their normal shooting bonus
 * - Attacker wrong -> No shooting bonus; their answer locks
 * - Defender wrong -> No block; their answer locks
 * - Neither answers before the deadline -> Low-probability shot resolves
 * - Attacker wrong; eligible defender later correct -> Defender blocks before the deadline
 */
export function evaluateQuestionDuel(
  config: DuelConfig,
  attackerAnswer: PlayerAnswerRecord | null,
  defenderAnswer: PlayerAnswerRecord | null
): DuelResolutionSummary {
  const attCorrect = attackerAnswer?.isCorrect === true;
  const defCorrect = defenderAnswer?.isCorrect === true;

  const attackerSpeedScore =
    attCorrect && attackerAnswer
      ? computeSpeedScore(
          attackerAnswer.acceptedTimeMs,
          config.readingMs,
          config.answerWindowMs
        )
      : 0;

  const defenderSpeedScore =
    defCorrect && defenderAnswer
      ? computeSpeedScore(
          defenderAnswer.acceptedTimeMs,
          config.readingMs,
          config.answerWindowMs
        )
      : 0;

  // Case 1: Both answered correctly
  if (attCorrect && defCorrect && attackerAnswer && defenderAnswer) {
    const timeDiff = attackerAnswer.acceptedTimeMs - defenderAnswer.acceptedTimeMs; // > 0 means defender was faster
    const absDiff = Math.abs(timeDiff);

    if (absDiff <= config.tieToleranceMs) {
      return {
        duelId: config.duelId,
        ruleOutcome: 'both-correct-within-tie-window',
        shotBlocked: false,
        defenderTooFarToBlock: false,
        tiedCorrect: true,
        attackerCorrect: true,
        defenderCorrect: true,
        attackerSpeedScore,
        defenderSpeedScore,
        attackerAnswer,
        defenderAnswer,
        statusBannerText: 'Tie within tolerance — Attacker keeps shooting bonus!',
      };
    }

    if (timeDiff > config.tieToleranceMs) {
      // Defender answered correctly strictly before attacker outside tie tolerance
      if (config.blockEligibility.eligible) {
        return {
          duelId: config.duelId,
          ruleOutcome: 'eligible-defender-correct-first-block',
          shotBlocked: true,
          defenderTooFarToBlock: false,
          tiedCorrect: false,
          attackerCorrect: true,
          defenderCorrect: true,
          attackerSpeedScore,
          defenderSpeedScore,
          attackerAnswer,
          defenderAnswer,
          statusBannerText: 'BLOCKED! Defender positioned well and answered first!',
        };
      } else {
        return {
          duelId: config.duelId,
          ruleOutcome: 'defender-correct-first-out-of-range',
          shotBlocked: false,
          defenderTooFarToBlock: true,
          tiedCorrect: false,
          attackerCorrect: true,
          defenderCorrect: true,
          attackerSpeedScore,
          defenderSpeedScore,
          attackerAnswer,
          defenderAnswer,
          statusBannerText: 'Correct—too far away to block. Attacker earns shooting bonus!',
        };
      }
    }

    // Attacker answered correctly strictly before defender
    return {
      duelId: config.duelId,
      ruleOutcome: 'attacker-correct-first',
      shotBlocked: false,
      defenderTooFarToBlock: false,
      tiedCorrect: false,
      attackerCorrect: true,
      defenderCorrect: true,
      attackerSpeedScore,
      defenderSpeedScore,
      attackerAnswer,
      defenderAnswer,
      statusBannerText: 'Attacker answered correctly first — Shooting bonus earned!',
    };
  }

  // Case 2: Attacker correct, defender wrong or unanswered
  if (attCorrect && !defCorrect) {
    return {
      duelId: config.duelId,
      ruleOutcome: 'attacker-correct-defender-wrong',
      shotBlocked: false,
      defenderTooFarToBlock: false,
      tiedCorrect: false,
      attackerCorrect: true,
      defenderCorrect: false,
      attackerSpeedScore,
      defenderSpeedScore: 0,
      attackerAnswer,
      defenderAnswer,
      statusBannerText: 'Attacker correct — Speed & knowledge boost shot accuracy!',
    };
  }

  // Case 3: Attacker wrong or unanswered, defender correct
  if (!attCorrect && defCorrect) {
    if (config.blockEligibility.eligible) {
      return {
        duelId: config.duelId,
        ruleOutcome: 'attacker-wrong-eligible-defender-blocks',
        shotBlocked: true,
        defenderTooFarToBlock: false,
        tiedCorrect: false,
        attackerCorrect: false,
        defenderCorrect: true,
        attackerSpeedScore: 0,
        defenderSpeedScore,
        attackerAnswer,
        defenderAnswer,
        statusBannerText: 'BLOCKED! Defender answered correctly in contesting position!',
      };
    } else {
      return {
        duelId: config.duelId,
        ruleOutcome: 'attacker-wrong-defender-out-of-range',
        shotBlocked: false,
        defenderTooFarToBlock: true,
        tiedCorrect: false,
        attackerCorrect: false,
        defenderCorrect: true,
        attackerSpeedScore: 0,
        defenderSpeedScore,
        attackerAnswer,
        defenderAnswer,
        statusBannerText: 'Correct—too far away to block. Low-probability shot continues!',
      };
    }
  }

  // Case 4: Neither answered before deadline
  if (attackerAnswer === null && defenderAnswer === null) {
    return {
      duelId: config.duelId,
      ruleOutcome: 'neither-answered',
      shotBlocked: false,
      defenderTooFarToBlock: false,
      tiedCorrect: false,
      attackerCorrect: false,
      defenderCorrect: false,
      attackerSpeedScore: 0,
      defenderSpeedScore: 0,
      attackerAnswer: null,
      defenderAnswer: null,
      statusBannerText: 'Time expired — Unboosted base-probability shot!',
    };
  }

  // Case 5: Both wrong (or one wrong, one unanswered)
  return {
    duelId: config.duelId,
    ruleOutcome: 'attacker-wrong-defender-wrong',
    shotBlocked: false,
    defenderTooFarToBlock: false,
    tiedCorrect: false,
    attackerCorrect: false,
    defenderCorrect: false,
    attackerSpeedScore: 0,
    defenderSpeedScore: 0,
    attackerAnswer,
    defenderAnswer,
    statusBannerText: 'No accuracy bonus — Base court-position shot!',
  };
}
