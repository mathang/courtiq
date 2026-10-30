import { describe, expect, it } from 'vitest';
import { InputGuardController } from '../../client/game/input/controls';
import { QuestionOption } from '../../shared/content/question-schema';

describe('Input & Accessibility Safeguards (Sections 4, 10 & 22)', () => {
  const shuffledOptions: QuestionOption[] = [
    { id: 'brand', text: 'Equipment brand' },
    { id: 'error', text: 'Measurement error' },
    { id: 'order', text: 'Name order' },
    { id: 'pref', text: 'Athlete preference' },
  ];

  it('prevents a held shoot key or pre-held answer key from submitting an answer', () => {
    const submissions: Array<{ duelId: string; optionId: string }> = [];
    const input = new InputGuardController(undefined, {
      onAnswer: (duelId, optionId) => submissions.push({ duelId, optionId }),
    });

    // In Possession phase, player holds Digit1 and presses Space to shoot
    input.syncDuelContext({
      phase: 'Possession',
      duelId: null,
      readingProtected: false,
      displayedOptions: [],
    });
    input.handleKeyDown({ code: 'Digit1' });
    input.handleKeyDown({ code: 'Space' });

    const move = input.consumeMoveInput('Possession');
    expect(move.shoot).toBe(true);

    // Question begins in protected reading period
    input.syncDuelContext({
      phase: 'Duel',
      duelId: 'duel-101',
      readingProtected: true,
      displayedOptions: shuffledOptions,
    });

    // Movement inputs must return 0 during Duel
    expect(input.consumeMoveInput('Duel')).toEqual({
      moveX: 0,
      moveZ: 0,
      sprint: false,
      shoot: false,
    });

    // Clicking or pressing an answer during reading period is blocked
    expect(input.trySelectDisplayedOptionIndex(1)).toBe(false);
    expect(submissions.length).toBe(0);

    // Reading period ends -> Answer buttons unlock
    input.syncDuelContext({
      phase: 'Duel',
      duelId: 'duel-101',
      readingProtected: false,
      displayedOptions: shuffledOptions,
    });

    // Autorepeat from held Space or held Digit1 must NOT submit an answer
    input.handleKeyDown({ code: 'Space', repeat: true });
    input.handleKeyDown({ code: 'Digit1', repeat: true });
    expect(submissions.length).toBe(0);

    // Even trying to trigger Digit1 while it was held from before unlock is blocked until keyup
    expect(input.trySelectDisplayedOptionIndex(0, 'Digit1')).toBe(false);

    // Releasing Digit1 and pressing Digit2 fresh selects shuffledOptions[1] ('error')
    input.handleKeyUp({ code: 'Digit1' });
    input.handleKeyDown({ code: 'Digit2', repeat: false });
    expect(submissions).toEqual([{ duelId: 'duel-101', optionId: 'error' }]);

    // Double clicks or pressing another option for the same duelId are ignored
    input.handleKeyDown({ code: 'Digit3', repeat: false });
    expect(input.trySelectDisplayedOptionIndex(2)).toBe(false);
    expect(submissions.length).toBe(1);
  });
});
