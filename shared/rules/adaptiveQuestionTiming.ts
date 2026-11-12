import type { PlayerAnswerRecord } from './timing';

/** Conservative pace rules, not a measure of mastery or reading ability. */
export const ADAPTIVE_QUESTION_TIMING = Object.freeze({
  minPacePercent: 60,
  maxPacePercent: 250,
  minimumAnswerMs: 6000,
  incorrectExtraPercent: 20,
  timeoutExtraPercent: 30,
  quickCorrectReductionPercent: 10,
  quickCorrectsToSpeedUp: 3,
  quickFraction: 0.40,
  slowFraction: 0.75,
});

export type TimingAdjustment = 'more-time' | 'less-time' | null;
export interface AdaptiveQuestionTimingState {
  readonly pacePercent: number;
  readonly quickCorrectCount: number;
  readonly lastAdjustment: TimingAdjustment;
}

export function createAdaptiveQuestionTimingState(): AdaptiveQuestionTimingState {
  return Object.freeze({ pacePercent: 100, quickCorrectCount: 0, lastAdjustment: null });
}

/** Reading is separate. Only the answer budget changes, for a future question. */
export function adaptiveQuestionWindowMs(baseWindowMs: number, readingMs: number,
  state: AdaptiveQuestionTimingState): number {
  return readingMs + Math.max(ADAPTIVE_QUESTION_TIMING.minimumAnswerMs,
    Math.round((baseWindowMs - readingMs) * state.pacePercent / 100));
}

/** Called once at resolution; basketball outcomes and the bot's answer are irrelevant. */
export function updateAdaptiveQuestionTiming(state: AdaptiveQuestionTimingState,
  answer: PlayerAnswerRecord | null, readingMs: number, answerWindowMs: number): AdaptiveQuestionTimingState {
  const cfg = ADAPTIVE_QUESTION_TIMING;
  let change = 0, quickCorrectCount = 0;
  const usedFraction = answer ? Math.max(0, answer.acceptedTimeMs - readingMs) /
    Math.max(1, answerWindowMs - readingMs) : 1;
  if (!answer) change = cfg.timeoutExtraPercent;
  else if (!answer.isCorrect || usedFraction >= cfg.slowFraction) change = cfg.incorrectExtraPercent;
  else if (usedFraction <= cfg.quickFraction) {
    quickCorrectCount = state.quickCorrectCount + 1;
    if (quickCorrectCount >= cfg.quickCorrectsToSpeedUp) {
      change = -cfg.quickCorrectReductionPercent;
      quickCorrectCount = 0;
    }
  }
  const pacePercent = Math.max(cfg.minPacePercent, Math.min(cfg.maxPacePercent, state.pacePercent + change));
  return Object.freeze({ pacePercent, quickCorrectCount,
    lastAdjustment: pacePercent > state.pacePercent ? 'more-time' : pacePercent < state.pacePercent ? 'less-time' : null });
}
