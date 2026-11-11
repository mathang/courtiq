export type QuestionApprovalStatus = 'draft' | 'approved' | 'retired';
export type QuestionDifficultyLabel = 'beginner' | 'intermediate' | 'advanced';

export interface QuestionOption {
  readonly id: string;
  readonly text: string;
}

export interface QuestionItem {
  readonly id: string;
  readonly version: number;
  readonly course: string;
  readonly week: number;
  readonly topic: string;
  readonly learningOutcome: string;
  readonly stem: string;
  readonly options: readonly [
    QuestionOption,
    QuestionOption,
    QuestionOption,
    QuestionOption
  ];
  readonly correctOptionId: string;
  readonly explanation: string;
  /** Private option-specific misconceptions; never sent before resolution. */
  readonly optionFeedback?: Readonly<Record<string, string>>;
  readonly sourceRef: string;
  readonly difficulty: QuestionDifficultyLabel;
  readonly readingMs: number;
  readonly answerWindowMs: number;
  readonly shuffleRestricted?: boolean;
  readonly status: QuestionApprovalStatus;
}

export interface QuestionPack {
  readonly packId: string;
  readonly packVersion: number;
  readonly title: string;
  readonly course: string;
  readonly description: string;
  readonly approvedBy: string;
  readonly approvedAtIso: string;
  readonly questions: readonly QuestionItem[];
}

/**
 * Public question representation sent to clients BEFORE duel resolution.
 * Deliberately omits correctOptionId and explanation so no client can inspect the answer key.
 */
export interface PublicDuelQuestion {
  readonly id: string;
  readonly version: number;
  readonly course: string;
  readonly week: number;
  readonly topic: string;
  readonly learningOutcome: string;
  readonly stem: string;
  readonly options: readonly QuestionOption[];
  readonly readingMs: number;
  readonly answerWindowMs: number;
}

export interface PackValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly approvedQuestionCount: number;
}

/**
 * Validates a raw JSON object as a teacher-approved QuestionPack before play.
 * Rejects duplicate IDs, missing explanations, invalid correctOptionId, non-4 options,
 * or packs with no approved questions.
 */
export function validateQuestionPack(raw: unknown): PackValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return {
      valid: false,
      errors: ['Question pack must be a non-null JSON object.'],
      warnings: [],
      approvedQuestionCount: 0,
    };
  }

  const pack = raw as Record<string, unknown>;
  if (typeof pack.packId !== 'string' || pack.packId.trim().length === 0) {
    errors.push('Missing or invalid packId.');
  }
  if (typeof pack.packVersion !== 'number' || !Number.isInteger(pack.packVersion) || pack.packVersion < 1) {
    errors.push('packVersion must be a positive integer.');
  }
  if (typeof pack.title !== 'string' || pack.title.trim().length === 0) {
    errors.push('Missing or invalid pack title.');
  }
  if (typeof pack.course !== 'string' || pack.course.trim().length === 0) {
    errors.push('Missing or invalid course code.');
  }
  if (!Array.isArray(pack.questions) || pack.questions.length === 0) {
    errors.push('Question pack must contain a non-empty questions array.');
    return { valid: false, errors, warnings, approvedQuestionCount: 0 };
  }

  const seenQuestionIds = new Set<string>();
  let approvedCount = 0;

  pack.questions.forEach((item: unknown, idx: number) => {
    const label = `Question[${idx}]`;
    if (!item || typeof item !== 'object') {
      errors.push(`${label}: must be an object.`);
      return;
    }
    const q = item as Record<string, unknown>;
    const qId = typeof q.id === 'string' ? q.id.trim() : '';
    if (!qId) {
      errors.push(`${label}: missing non-empty id.`);
    } else if (seenQuestionIds.has(qId)) {
      errors.push(`${label} (${qId}): duplicate question ID "${qId}".`);
    } else {
      seenQuestionIds.add(qId);
    }

    const qRef = qId ? `${label} (${qId})` : label;

    if (typeof q.version !== 'number' || !Number.isInteger(q.version) || q.version < 1) {
      errors.push(`${qRef}: version must be a positive integer.`);
    }
    if (typeof q.course !== 'string' || q.course.trim().length === 0) {
      errors.push(`${qRef}: missing course.`);
    }
    if (typeof q.topic !== 'string' || q.topic.trim().length === 0) {
      errors.push(`${qRef}: missing topic.`);
    }
    if (typeof q.learningOutcome !== 'string' || q.learningOutcome.trim().length === 0) {
      errors.push(`${qRef}: missing learningOutcome.`);
    }
    if (typeof q.stem !== 'string' || q.stem.trim().length === 0) {
      errors.push(`${qRef}: missing question stem.`);
    }
    if (typeof q.explanation !== 'string' || q.explanation.trim().length === 0) {
      errors.push(`${qRef}: missing explanation.`);
    }
    if (typeof q.sourceRef !== 'string' || q.sourceRef.trim().length === 0) {
      errors.push(`${qRef}: missing sourceRef.`);
    }
    if (
      q.status !== 'draft' &&
      q.status !== 'approved' &&
      q.status !== 'retired'
    ) {
      errors.push(`${qRef}: status must be "draft", "approved", or "retired".`);
    }

    if (typeof q.readingMs !== 'number' || q.readingMs < 500 || q.readingMs > 30000) {
      errors.push(`${qRef}: readingMs must be between 500 and 30000.`);
    }
    if (
      typeof q.answerWindowMs !== 'number' ||
      typeof q.readingMs !== 'number' ||
      q.answerWindowMs <= q.readingMs
    ) {
      errors.push(`${qRef}: answerWindowMs must be greater than readingMs.`);
    }

    if (!Array.isArray(q.options) || q.options.length !== 4) {
      errors.push(`${qRef}: must have exactly 4 options.`);
    } else {
      const optIds = new Set<string>();
      const optTexts = new Set<string>();
      for (let i = 0; i < q.options.length; i++) {
        const opt = q.options[i] as Record<string, unknown> | undefined;
        if (!opt || typeof opt !== 'object') {
          errors.push(`${qRef}: option[${i}] must be an object.`);
          continue;
        }
        const oid = typeof opt.id === 'string' ? opt.id.trim() : '';
        const otext = typeof opt.text === 'string' ? opt.text.trim() : '';
        if (!oid) {
          errors.push(`${qRef}: option[${i}] missing id.`);
        } else if (optIds.has(oid)) {
          errors.push(`${qRef}: duplicate option ID "${oid}".`);
        } else {
          optIds.add(oid);
        }

        if (!otext) {
          errors.push(`${qRef}: option[${i}] missing text.`);
        } else if (optTexts.has(otext.toLowerCase())) {
          errors.push(`${qRef}: duplicate option text "${otext}".`);
        } else {
          optTexts.add(otext.toLowerCase());
        }

        if (
          !q.shuffleRestricted &&
          /\b(all|none) of the above\b/i.test(otext)
        ) {
          errors.push(
            `${qRef}: option "${otext}" uses position-dependent wording without shuffleRestricted=true.`
          );
        }
      }

      if (typeof q.correctOptionId !== 'string' || !optIds.has(q.correctOptionId)) {
        errors.push(
          `${qRef}: correctOptionId "${String(q.correctOptionId)}" does not match any of the 4 option IDs.`
        );
      }
      if (q.optionFeedback !== undefined) {
        if (!q.optionFeedback || typeof q.optionFeedback !== 'object' || Array.isArray(q.optionFeedback)) {
          errors.push(`${qRef}: optionFeedback must be an object keyed by option ID.`);
        } else {
          for (const [optionId, reason] of Object.entries(q.optionFeedback)) {
            if (!optIds.has(optionId)) errors.push(`${qRef}: optionFeedback has unknown option ID "${optionId}".`);
            if (typeof reason !== 'string' || !reason.trim() || reason.length > 400) {
              errors.push(`${qRef}: optionFeedback for "${optionId}" must contain 1–400 characters.`);
            }
          }
        }
      }
    }

    if (q.status === 'approved') {
      approvedCount++;
    }
  });

  if (approvedCount === 0) {
    errors.push('Question pack contains 0 approved questions.');
  } else if (approvedCount < 20) {
    warnings.push(
      `Pack has ${approvedCount} approved questions (recommended 40–60 for full classroom variety without repeats).`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    approvedQuestionCount: approvedCount,
  };
}

/**
 * Deterministic PRNG (Mulberry32) so shuffles and simulations can be seeded and reproduced in tests.
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffles a question's 4 options independently for a specific player while preserving stable option IDs.
 * Respects shuffleRestricted if set on the question.
 */
export function shuffleQuestionOptionsForPlayer(
  question: QuestionItem,
  rng: () => number = Math.random
): QuestionOption[] {
  const copy = question.options.map((o) => ({ id: o.id, text: o.text }));
  if (question.shuffleRestricted) {
    return copy;
  }
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Builds the pre-resolution question payload for a client.
 * Never includes correctOptionId or explanation.
 */
export function toPublicDuelQuestion(
  question: QuestionItem,
  displayedOptions: readonly QuestionOption[],
  effectiveReadingMs: number,
  effectiveAnswerWindowMs: number
): PublicDuelQuestion {
  return Object.freeze({
    id: question.id,
    version: question.version,
    course: question.course,
    week: question.week,
    topic: question.topic,
    learningOutcome: question.learningOutcome,
    stem: question.stem,
    options: displayedOptions.map((o) => Object.freeze({ id: o.id, text: o.text })),
    readingMs: effectiveReadingMs,
    answerWindowMs: effectiveAnswerWindowMs,
  });
}
