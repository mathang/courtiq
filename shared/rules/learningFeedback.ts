import type { QuestionItem } from '../content/question-schema';
import type { PlayerAnswerRecord } from './timing';

export interface StudentAnswerFeedback {
  status: 'correct' | 'incorrect' | 'unanswered';
  selectedOptionId: string | null;
  selectedOptionText: string | null;
  reason: string;
}

export interface StudentQuestionFeedback extends StudentAnswerFeedback {
  correctAnswerStreak: number;
  onFire: boolean;
}

export interface QuestionAnswerReview {
  questionStem: string;
  correctOptionText: string;
  explanation: string;
  sourceRef: string;
  topic: string;
  answer: StudentAnswerFeedback;
}

/** Private feedback from an accepted answer; callers control when it may be revealed. */
export function buildStudentAnswerFeedback(q: QuestionItem, answer: PlayerAnswerRecord | null): StudentAnswerFeedback {
  const selected = answer ? q.options.find(o => o.id === answer.optionId) : undefined;
  const status = !answer ? 'unanswered' : answer.isCorrect ? 'correct' : 'incorrect';
  return {
    status, selectedOptionId: selected?.id ?? null, selectedOptionText: selected?.text ?? null,
    reason: status === 'incorrect'
        ? q.optionFeedback?.[answer!.optionId] ?? q.explanation
        : q.explanation,
  };
}

/** Streaks are attached only after the duel resolves. */
export function buildStudentQuestionFeedback(q: QuestionItem, answer: PlayerAnswerRecord | null, streak: number, onFire: boolean): StudentQuestionFeedback {
  return { ...buildStudentAnswerFeedback(q, answer), correctAnswerStreak: streak, onFire };
}

export function buildQuestionAnswerReview(q: QuestionItem, answer: PlayerAnswerRecord): QuestionAnswerReview {
  return {
    questionStem: q.stem,
    correctOptionText: q.options.find(o => o.id === q.correctOptionId)?.text ?? '',
    explanation: q.explanation,
    sourceRef: q.sourceRef,
    topic: q.topic,
    answer: buildStudentAnswerFeedback(q, answer),
  };
}
