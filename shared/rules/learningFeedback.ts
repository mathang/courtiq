import type { QuestionItem } from '../content/question-schema';
import type { PlayerAnswerRecord } from './timing';

export interface StudentQuestionFeedback {
  status: 'correct' | 'incorrect' | 'unanswered';
  selectedOptionId: string | null;
  selectedOptionText: string | null;
  reason: string;
  correctAnswerStreak: number;
  onFire: boolean;
}

/** Created only after resolution, from the authoritative submitted answer. */
export function buildStudentQuestionFeedback(q: QuestionItem, answer: PlayerAnswerRecord | null, streak: number, onFire: boolean): StudentQuestionFeedback {
  const selected = answer ? q.options.find(o => o.id === answer.optionId) : undefined;
  const status = !answer ? 'unanswered' : answer.isCorrect ? 'correct' : 'incorrect';
  return {
    status, selectedOptionId: selected?.id ?? null, selectedOptionText: selected?.text ?? null,
    reason: status === 'unanswered'
      ? 'No answer was submitted before the question closed. Read the reasoning below before the next attempt.'
      : status === 'incorrect'
        ? q.optionFeedback?.[answer!.optionId] ?? q.explanation
        : q.explanation,
    correctAnswerStreak: streak, onFire,
  };
}
