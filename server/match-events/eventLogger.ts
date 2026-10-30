import { AuthoritativeMatchStateSnapshot } from '../../shared/protocol/messages';
import { AuthoritativeMatchEngine } from '../../shared/rules/matchStateMachine';
import { PlayerSlot } from '../../shared/rules/possession';

/**
 * Builds a per-player authoritative snapshot.
 * Security invariant:
 * - Before duel resolution (QuestionReady / Duel), activeDuel.publicQuestion NEVER contains
 *   correctOptionId or explanation, and opponent's chosen optionId is hidden (only boolean opponentSubmitted is sent).
 * - Only in Feedback and MatchEnd are explanations and correctOptionId exposed.
 */
export function buildSanitizedSnapshotForSlot(
  engine: AuthoritativeMatchEngine,
  roomCode: string,
  slot: PlayerSlot
): AuthoritativeMatchStateSnapshot {
  const oppSlot: PlayerSlot = slot === 0 ? 1 : 0;
  const activeDuel =
    (engine.phase === 'QuestionReady' || engine.phase === 'Duel' || engine.phase === 'Resolution') &&
    engine.activeDuel
      ? {
          duelId: engine.activeDuel.duelId,
          publicQuestion: engine.activeDuel.publicQuestionsBySlot[slot],
          elapsedRealMs: Math.round(engine.activeDuel.elapsedRealMs),
          readingProtected:
            engine.phase === 'QuestionReady' ||
            engine.activeDuel.elapsedRealMs <
              engine.activeDuel.config.readingMs,
          yourSubmittedOptionId:
            engine.activeDuel.answersBySlot[slot]?.optionId ?? null,
          opponentSubmitted: engine.activeDuel.answersBySlot[oppSlot] !== null,
          physicalBlock: engine.activeDuel.physicalBlock,
          blockEligibleAtRelease:
            engine.activeDuel.releaseSnapshot.blockEligibility.eligible,
        }
      : null;

  const isMatchEnd = engine.phase === 'MatchEnd';

  return {
    matchId: engine.matchId,
    roomCode,
    yourSlot: slot,
    phase: engine.phase,
    rules: engine.rules,
    scoreState: engine.scoreState,
    movementClockRemainingMs: Math.round(engine.movementClockRemainingMs),
    players: [
      { ...engine.players[0] },
      { ...engine.players[1] },
    ],
    ballPosition: engine.getBallPosition3D(),
    liveBlockEligibility: engine.getLiveBlockEligibility(),
    activeDuel,
    feedbackState: engine.feedbackState ? { ...engine.feedbackState } : null,
    learningSummaries: isMatchEnd ? engine.getLearningSummaries() : null,
    attemptEvents: isMatchEnd ? [...engine.attemptEvents] : null,
  };
}
