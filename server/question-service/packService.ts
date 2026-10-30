import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import {
  QuestionPack,
  validateQuestionPack,
} from '../../shared/content/question-schema';

export class ServerPackService {
  private packs = new Map<string, QuestionPack>();

  constructor() {
    for (const pack of BUNDLED_QUESTION_PACKS) {
      this.registerApprovedPack(pack);
    }
  }

  public registerApprovedPack(rawPack: unknown): QuestionPack {
    const validation = validateQuestionPack(rawPack);
    if (!validation.valid) {
      throw new Error(
        `Invalid question pack: ${validation.errors.join('; ')}`
      );
    }
    const pack = rawPack as QuestionPack;
    // Freeze deep enough to guarantee pack version and questions are immutable during matches
    this.packs.set(pack.packId, Object.freeze({ ...pack }));
    return pack;
  }

  public getPackOrThrow(packId: string): QuestionPack {
    const found = this.packs.get(packId) ?? BUNDLED_QUESTION_PACKS[0];
    if (!found) {
      throw new Error(`Question pack "${packId}" not found.`);
    }
    return found;
  }

  public listPacks(): Array<{
    packId: string;
    packVersion: number;
    title: string;
    course: string;
    approvedQuestionCount: number;
  }> {
    return Array.from(this.packs.values()).map((p) => ({
      packId: p.packId,
      packVersion: p.packVersion,
      title: p.title,
      course: p.course,
      approvedQuestionCount: p.questions.filter((q) => q.status === 'approved')
        .length,
    }));
  }
}
