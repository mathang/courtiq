import { ShotZone } from '../config/balance';
import { CourtPoint2D } from './block';
import { ShotOutcomeKind } from './shot';

export type PlayerSlot = 0 | 1;

export interface MatchRulesConfig {
  readonly targetScore: number;
  readonly maxPossessionsPerPlayer: number;
  readonly movementClockMs: number;
}

export interface PossessionScoreState {
  readonly scores: readonly [number, number];
  readonly possessionsCompleted: readonly [number, number];
  readonly currentAttacker: PlayerSlot;
  readonly isOvertime: boolean;
  readonly overtimeRound: number;
  readonly isMatchOver: boolean;
  readonly winner: PlayerSlot | null;
}

export interface MatchAttemptEvent {
  readonly matchId: string;
  readonly possessionIndex: number;
  readonly duelId: string;
  readonly questionId: string;
  readonly questionVersion: number;
  readonly course: string;
  readonly week: number;
  readonly topic: string;
  readonly stem: string;
  readonly explanation: string;
  readonly sourceRef: string;
  readonly correctOptionId: string;
  readonly correctOptionText: string;
  readonly attackerSlot: PlayerSlot;
  readonly defenderSlot: PlayerSlot;
  readonly playerRecords: readonly [
    {
      readonly playerPseudonym: string;
      readonly role: 'attacker' | 'defender';
      readonly selectedOptionId: string | null;
      readonly selectedOptionText: string | null;
      readonly status: 'correct' | 'incorrect' | 'unanswered';
      readonly acceptedResponseTimeMs: number | null;
    },
    {
      readonly playerPseudonym: string;
      readonly role: 'attacker' | 'defender';
      readonly selectedOptionId: string | null;
      readonly selectedOptionText: string | null;
      readonly status: 'correct' | 'incorrect' | 'unanswered';
      readonly acceptedResponseTimeMs: number | null;
    }
  ];
  readonly shotLocation: CourtPoint2D | null;
  readonly shotZone: ShotZone | 'turnover';
  readonly blockEligible: boolean;
  readonly basketballOutcome: ShotOutcomeKind | 'shot-clock-turnover' | 'steal-turnover';
  readonly pointsAwarded: 0 | 2 | 3;
  readonly finalShotProbability: number;
  readonly questionTiming?: {
    readonly readingMs: number;
    readonly answerWindowMs: number;
    readonly adaptive: boolean;
  };
}

export interface TopicAccuracySummary {
  readonly topic: string;
  readonly week: number;
  readonly attempted: number;
  readonly correct: number;
  readonly accuracyPercent: number;
}

export interface PlayerLearningSummary {
  readonly playerSlot: PlayerSlot;
  readonly playerPseudonym: string;
  readonly basketballScore: number;
  readonly totalQuestions: number;
  readonly correctAnswers: number;
  readonly incorrectAnswers: number;
  readonly unansweredCount: number;
  readonly overallAccuracyPercent: number;
  readonly averageResponseTimeMs: number | null;
  readonly byTopic: readonly TopicAccuracySummary[];
  readonly missedQuestions: readonly {
    readonly questionId: string;
    readonly week: number;
    readonly topic: string;
    readonly stem: string;
    readonly selectedOptionText: string | null;
    readonly correctOptionText: string;
    readonly explanation: string;
    readonly sourceRef: string;
  }[];
}

export function createInitialPossessionScoreState(
  startingAttacker: PlayerSlot = 0
): PossessionScoreState {
  return Object.freeze({
    scores: [0, 0] as const,
    possessionsCompleted: [0, 0] as const,
    currentAttacker: startingAttacker,
    isOvertime: false,
    overtimeRound: 0,
    isMatchOver: false,
    winner: null,
  });
}

/**
 * Advances possession state after a resolved shot or movement-clock turnover.
 * Rules enforced (Section 11):
 * - Score updates once for the current attacker.
 * - Attacker's completed possession count increments by 1.
 * - Possession alternates after every resolved attempt.
 * - Equal possessions required before determining a winner:
 *   We evaluate victory only when both players have had an equal number of possessions
 *   (possessionsCompleted[0] === possessionsCompleted[1]).
 * - If at equal possessions either player has reached targetScore OR both reached maxPossessionsPerPlayer:
 *   - If scores differ, the higher score wins.
 *   - If tied, paired overtime possessions begin (preserving equal opportunity).
 */
export function advancePossessionAfterAttempt(
  state: PossessionScoreState,
  rules: MatchRulesConfig,
  pointsAwarded: 0 | 2 | 3
): PossessionScoreState {
  if (state.isMatchOver) {
    return state;
  }

  const att = state.currentAttacker;
  const def: PlayerSlot = att === 0 ? 1 : 0;

  const nextScores: [number, number] = [state.scores[0], state.scores[1]];
  nextScores[att] += pointsAwarded;

  const nextPossessions: [number, number] = [
    state.possessionsCompleted[0],
    state.possessionsCompleted[1],
  ];
  nextPossessions[att] += 1;

  const equalPossessionsNow = nextPossessions[0] === nextPossessions[1];
  let isMatchOver = false;
  let winner: PlayerSlot | null = null;
  let isOvertime = state.isOvertime;
  let overtimeRound = state.overtimeRound;

  if (equalPossessionsNow) {
    const someoneReachedTarget =
      nextScores[0] >= rules.targetScore || nextScores[1] >= rules.targetScore;
    const reachedMaxRegulation =
      nextPossessions[0] >= rules.maxPossessionsPerPlayer &&
      nextPossessions[1] >= rules.maxPossessionsPerPlayer;

    if (someoneReachedTarget || reachedMaxRegulation || isOvertime) {
      if (nextScores[0] > nextScores[1]) {
        isMatchOver = true;
        winner = 0;
      } else if (nextScores[1] > nextScores[0]) {
        isMatchOver = true;
        winner = 1;
      } else {
        // Tied after equal possessions -> Paired Overtime round!
        isOvertime = true;
        overtimeRound += 1;
      }
    }
  }

  return Object.freeze({
    scores: Object.freeze(nextScores),
    possessionsCompleted: Object.freeze(nextPossessions),
    currentAttacker: def,
    isOvertime,
    overtimeRound,
    isMatchOver,
    winner,
  });
}

/**
 * Computes separated basketball vs educational learning report for a player.
 * Note: Response speed is reported descriptively and never equated with mastery.
 */
export function buildPlayerLearningSummary(
  playerSlot: PlayerSlot,
  playerPseudonym: string,
  basketballScore: number,
  events: readonly MatchAttemptEvent[]
): PlayerLearningSummary {
  // Only include attempts that actually presented a question duel (exclude movement-clock turnovers before a shot)
  const duelEvents = events.filter(
    (e) => e.basketballOutcome !== 'shot-clock-turnover' && e.questionId !== ''
  );

  let correctAnswers = 0;
  let incorrectAnswers = 0;
  let unansweredCount = 0;
  const responseTimes: number[] = [];

  const topicMap = new Map<
    string,
    { topic: string; week: number; attempted: number; correct: number }
  >();
  const missedQuestions: PlayerLearningSummary['missedQuestions'][number][] = [];

  for (const ev of duelEvents) {
    const rec = ev.playerRecords[playerSlot];
    const topicKey = `${ev.week}:${ev.topic}`;
    const existing = topicMap.get(topicKey) ?? {
      topic: ev.topic,
      week: ev.week,
      attempted: 0,
      correct: 0,
    };
    existing.attempted += 1;

    if (rec.status === 'correct') {
      correctAnswers += 1;
      existing.correct += 1;
    } else if (rec.status === 'incorrect') {
      incorrectAnswers += 1;
    } else {
      unansweredCount += 1;
    }

    if (rec.acceptedResponseTimeMs !== null) {
      responseTimes.push(rec.acceptedResponseTimeMs);
    }

    if (rec.status !== 'correct') {
      missedQuestions.push({
        questionId: ev.questionId,
        week: ev.week,
        topic: ev.topic,
        stem: ev.stem,
        selectedOptionText: rec.selectedOptionText,
        correctOptionText: ev.correctOptionText,
        explanation: ev.explanation,
        sourceRef: ev.sourceRef,
      });
    }

    topicMap.set(topicKey, existing);
  }

  const totalQuestions = duelEvents.length;
  const overallAccuracyPercent =
    totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
  const averageResponseTimeMs =
    responseTimes.length > 0
      ? Math.round(
          responseTimes.reduce((acc, v) => acc + v, 0) / responseTimes.length
        )
      : null;

  const byTopic: TopicAccuracySummary[] = Array.from(topicMap.values())
    .sort((a, b) => a.week - b.week || a.topic.localeCompare(b.topic))
    .map((t) => ({
      topic: t.topic,
      week: t.week,
      attempted: t.attempted,
      correct: t.correct,
      accuracyPercent:
        t.attempted > 0 ? Math.round((t.correct / t.attempted) * 100) : 0,
    }));

  return {
    playerSlot,
    playerPseudonym,
    basketballScore,
    totalQuestions,
    correctAnswers,
    incorrectAnswers,
    unansweredCount,
    overallAccuracyPercent,
    averageResponseTimeMs,
    byTopic,
    missedQuestions,
  };
}
