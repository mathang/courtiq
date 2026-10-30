import w09PackJson from './approved-packs/spx101-w09-performance-analysis.json';
import w05PackJson from './approved-packs/spx101-w05-measurement-quality.json';
import {
  QuestionPack,
  validateQuestionPack,
} from '../shared/content/question-schema';

function assertValidPack(raw: unknown, label: string): QuestionPack {
  const result = validateQuestionPack(raw);
  if (!result.valid) {
    throw new Error(
      `Bundled question pack "${label}" failed validation:\n${result.errors.join('\n')}`
    );
  }
  return raw as QuestionPack;
}

export const BUNDLED_QUESTION_PACKS: readonly QuestionPack[] = Object.freeze([
  assertValidPack(w09PackJson, 'spx101-w09-performance-analysis'),
  assertValidPack(w05PackJson, 'spx101-w05-measurement-quality'),
]);

export function getBundledPackById(packId: string): QuestionPack | undefined {
  return BUNDLED_QUESTION_PACKS.find((p) => p.packId === packId);
}
