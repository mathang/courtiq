import { AuthoritativeMatchEngine } from '../../shared/rules/matchStateMachine';
import { PlayerSlot } from '../../shared/rules/possession';
import {
  computeBoundedServerAnswerTimeMs,
  SubmissionValidationResult,
} from '../../shared/rules/timing';

/**
 * Validates an online player's answer submission using the server's authoritative clock
 * and bounded RTT latency adjustment (never trusting arbitrary client-reported timestamps).
 */
export function validateOnlineDuelSubmission(params: {
  engine: AuthoritativeMatchEngine;
  slot: PlayerSlot;
  duelId: string;
  optionId: string;
  measuredRttMs: number;
}): SubmissionValidationResult {
  const { engine, slot, duelId, optionId, measuredRttMs } = params;

  if (engine.phase !== 'Duel' || !engine.activeDuel) {
    return { accepted: false, rejectionReason: 'wrong-duel-id' };
  }

  if (engine.activeDuel.duelId !== duelId) {
    return { accepted: false, rejectionReason: 'wrong-duel-id' };
  }

  const serverElapsedMs = Math.round(engine.activeDuel.elapsedRealMs);
  // Only apply bounded latency compensation once the reading protection window has passed on the server
  const adjustedElapsedMs =
    serverElapsedMs < engine.activeDuel.config.readingMs
      ? serverElapsedMs
      : computeBoundedServerAnswerTimeMs(
          serverElapsedMs,
          measuredRttMs,
          engine.activeDuel.config.readingMs,
          150
        );

  return engine.submitAnswer({
    slot,
    duelId,
    optionId,
    overrideElapsedMs: adjustedElapsedMs,
  });
}
