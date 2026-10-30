import { DefenseAction } from '../../../shared/rules/defense';
import { DunkStyle, DUNK_STYLES } from '../../../shared/rules/dunks';
import { isStreetMove, StreetMove } from '../../../shared/rules/streetMoves';
import { QuestionOption } from '../../../shared/content/question-schema';
import { MatchPhase, PlayerMoveInput } from '../../../shared/rules/matchStateMachine';

export interface KeyBindingsConfig {
  moveUp: string;
  moveDown: string;
  moveLeft: string;
  moveRight: string;
  sprint: string;
  shoot: string;
  dunk: string;
  dunkStyle: string;
  swipe: string;
  block: string;
  crossover: string;
  spin: string;
  eurostep: string;
  stepback: string;
  answer1: string;
  answer2: string;
  answer3: string;
  answer4: string;
  pause: string;
}

export const DEFAULT_KEY_BINDINGS: KeyBindingsConfig = {
  moveUp: 'KeyW',
  moveDown: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  sprint: 'ShiftLeft',
  shoot: 'Space', dunk: 'KeyR', dunkStyle: 'KeyV', swipe: 'KeyZ', block: 'KeyB',
  crossover: 'KeyC', spin: 'KeyQ', eurostep: 'KeyE', stepback: 'KeyX',
  answer1: 'Digit1',
  answer2: 'Digit2',
  answer3: 'Digit3',
  answer4: 'Digit4',
  pause: 'Escape',
};

/**
 * Pure, testable input state machine enforcing Section 4 & Section 22 input rules:
 * - Movement and shooting inputs stop affecting gameplay during a question.
 * - Answer buttons become active only after the protected reading period ends.
 * - A held shoot key or pre-held answer key must never accidentally select an answer.
 * - Each answer requires a fresh press/tap after the question becomes active.
 * - Keyboard autorepeat (repeat === true) cannot generate submissions.
 * - Duplicate submissions for the same duelId are ignored.
 * - Local button index 0..3 maps to the player's shuffled displayedOptions[index].id.
 */
export class InputGuardController {
  public bindings: KeyBindingsConfig;
  private downKeys = new Set<string>();
  private keysHeldBeforeAnswerActive = new Set<string>();
  private shootTriggeredFresh = false;
  private pendingTrick: StreetMove | undefined;
  private pendingDefense: DefenseAction | undefined;
  private pendingDunk = false;
  private phase: MatchPhase = 'Lobby';
  public dunkStyle: DunkStyle = 'tomahawk';

  private activeDuelId: string | null = null;
  private answerButtonsUnlocked = false;
  private submittedForDuelId: string | null = null;
  private displayedOptions: readonly QuestionOption[] = [];

  private touchVector = { x: 0, z: 0 };
  private touchSprint = false;
  private touchShootTriggered = false;

  private onAnswerCallback?: (duelId: string, optionId: string) => void;
  private onPauseToggleCallback?: () => void;

  constructor(
    bindings: KeyBindingsConfig = { ...DEFAULT_KEY_BINDINGS },
    callbacks?: {
      onAnswer?: (duelId: string, optionId: string) => void;
      onPauseToggle?: () => void;
    }
  ) {
    this.bindings = { ...bindings };
    this.onAnswerCallback = callbacks?.onAnswer;
    this.onPauseToggleCallback = callbacks?.onPauseToggle;
  }

  /**
   * Synchronizes the input guard with the current match phase and duel state.
   */
  public syncDuelContext(params: {
    phase: MatchPhase;
    duelId: string | null;
    readingProtected: boolean;
    displayedOptions: readonly QuestionOption[];
  }): void {
    this.phase = params.phase;
    if (params.duelId !== this.activeDuelId) {
      this.activeDuelId = params.duelId;
      this.answerButtonsUnlocked = false;
      this.displayedOptions = params.displayedOptions;
      // Snapshot all currently held keys so they require a fresh release + press
      this.keysHeldBeforeAnswerActive = new Set(this.downKeys);
    } else {
      this.displayedOptions = params.displayedOptions;
    }

    const nowUnlocked =
      params.phase === 'Duel' &&
      params.duelId !== null &&
      !params.readingProtected;

    if (nowUnlocked && !this.answerButtonsUnlocked) {
      // Transitioning from reading period to active answering:
      // Any key currently held down during reading period cannot trigger an answer without a fresh press!
      this.answerButtonsUnlocked = true;
      this.keysHeldBeforeAnswerActive = new Set(this.downKeys);
    } else if (!nowUnlocked) {
      this.answerButtonsUnlocked = false;
    }
  }

  public handleKeyDown(ev: {
    code: string;
    repeat?: boolean;
    preventDefault?: () => void;
  }): void {
    // Ignore keyboard autorepeat (Section 4 & 22)
    if (ev.repeat) {
      return;
    }
    // If key is already down without an intervening keyup, ignore duplicate keydown
    if (this.downKeys.has(ev.code)) {
      return;
    }

    this.downKeys.add(ev.code);

    if (ev.code === this.bindings.pause) {
      this.onPauseToggleCallback?.();
      return;
    }

    if (ev.code === this.bindings.swipe || ev.code === this.bindings.block) {
      ev.preventDefault?.();
      if (this.phase === 'Possession' || (this.phase === 'QuestionReady' && ev.code === this.bindings.block)) {
        this.pendingDefense = ev.code === this.bindings.swipe ? 'swipe' : 'jump';
      }
      return;
    }
    if (ev.code === this.bindings.dunkStyle && this.phase === 'Possession') { ev.preventDefault?.(); this.cycleDunkStyle(); return; }
    if (ev.code === this.bindings.dunk && this.phase === 'Possession') { ev.preventDefault?.(); this.pendingDunk = true; return; }
    // Prevent Space from activating focused HTML buttons accidentally
    if (ev.code === this.bindings.shoot || ev.code === 'Space') {
      ev.preventDefault?.();
      if (this.phase === 'QuestionReady') this.pendingDefense = 'jump';
      if (!this.answerButtonsUnlocked && this.activeDuelId === null) {
        this.shootTriggeredFresh = true;
      }
      return;
    }

    for (const move of ['crossover', 'spin', 'eurostep', 'stepback'] as const) {
      if (ev.code === this.bindings[move] && this.activeDuelId === null) {
        ev.preventDefault?.(); this.pendingTrick = move; return;
      }
    }
    // Check answer keys 1..4
    const answerSlotIndex = this.getAnswerIndexForKeyCode(ev.code);
    if (answerSlotIndex !== -1) {
      this.trySelectDisplayedOptionIndex(answerSlotIndex, ev.code);
    }
  }

  public handleKeyUp(ev: { code: string }): void {
    this.downKeys.delete(ev.code);
    this.keysHeldBeforeAnswerActive.delete(ev.code);
  }

  private getAnswerIndexForKeyCode(code: string): number {
    if (code === this.bindings.answer1 || code === 'Numpad1') return 0;
    if (code === this.bindings.answer2 || code === 'Numpad2') return 1;
    if (code === this.bindings.answer3 || code === 'Numpad3') return 2;
    if (code === this.bindings.answer4 || code === 'Numpad4') return 3;
    return -1;
  }

  /**
   * Attempts to submit an answer by displayed button index (0..3), mapping to stable optionId.
   * Returns true if the submission was accepted and emitted, false if blocked by safeguards.
   */
  public trySelectDisplayedOptionIndex(
    displayedIndex: number,
    sourceKeyCode?: string
  ): boolean {
    if (!this.answerButtonsUnlocked || !this.activeDuelId) {
      return false;
    }
    if (this.submittedForDuelId === this.activeDuelId) {
      return false;
    }
    if (
      sourceKeyCode &&
      this.keysHeldBeforeAnswerActive.has(sourceKeyCode)
    ) {
      return false;
    }
    const option = this.displayedOptions[displayedIndex];
    if (!option) {
      return false;
    }

    this.submittedForDuelId = this.activeDuelId;
    this.onAnswerCallback?.(this.activeDuelId, option.id);
    return true;
  }

  public reset(): void {
    this.downKeys.clear(); this.touchVector = { x: 0, z: 0 }; this.touchSprint = false;
    this.pendingTrick = undefined; this.pendingDefense = undefined; this.pendingDunk = false; this.shootTriggeredFresh = false; this.touchShootTriggered = false;
  }

  public cycleDunkStyle(): void {
    this.dunkStyle = DUNK_STYLES[(DUNK_STYLES.indexOf(this.dunkStyle) + 1) % DUNK_STYLES.length];
  }
  public triggerTouchDunk(): void { if (this.phase === 'Possession') this.pendingDunk = true; }
  public triggerTouchDefense(action: DefenseAction): void {
    if (this.phase === 'Possession' || (action === 'jump' && this.phase === 'QuestionReady')) this.pendingDefense = action;
  }

  public triggerTouchTrick(move: StreetMove): void {
    if (this.activeDuelId === null && isStreetMove(move)) this.pendingTrick = move;
  }

  public setTouchMove(x: number, z: number): void {
    this.touchVector.x = x;
    this.touchVector.z = z;
  }

  public setTouchSprint(active: boolean): void {
    this.touchSprint = active;
  }

  public triggerTouchShoot(): void {
    if (!this.answerButtonsUnlocked && this.activeDuelId === null) {
      this.touchShootTriggered = true;
    }
  }

  /**
   * Reads movement intentions for the current frame.
   * During a question (or any phase other than Possession), movement and shooting inputs
   * return zero so they never affect gameplay.
   */
  public consumeMoveInput(phase: MatchPhase): PlayerMoveInput {
    if (phase !== 'Possession') {
      const defense = phase === 'QuestionReady' && this.pendingDefense === 'jump' ? 'jump' as const : undefined;
      this.pendingDefense = undefined; this.pendingDunk = false;
      this.shootTriggeredFresh = false;
      this.touchShootTriggered = false;
      this.pendingTrick = undefined;
      return { moveX: 0, moveZ: 0, sprint: false, shoot: false, ...(defense ? { defense } : {}) };
    }

    let moveX = this.touchVector.x;
    let moveZ = this.touchVector.z;

    if (
      this.downKeys.has(this.bindings.moveUp) ||
      this.downKeys.has('ArrowUp')
    ) {
      moveZ -= 1;
    }
    if (
      this.downKeys.has(this.bindings.moveDown) ||
      this.downKeys.has('ArrowDown')
    ) {
      moveZ += 1;
    }
    if (
      this.downKeys.has(this.bindings.moveLeft) ||
      this.downKeys.has('ArrowLeft')
    ) {
      moveX -= 1;
    }
    if (
      this.downKeys.has(this.bindings.moveRight) ||
      this.downKeys.has('ArrowRight')
    ) {
      moveX += 1;
    }

    const sprint =
      this.touchSprint ||
      this.downKeys.has(this.bindings.sprint) ||
      this.downKeys.has('ShiftRight');

    const shoot = this.shootTriggeredFresh || this.touchShootTriggered;
    this.shootTriggeredFresh = false;
    this.touchShootTriggered = false;

    const trick = this.pendingTrick;
    this.pendingTrick = undefined;
    const defense = this.pendingDefense, dunk = this.pendingDunk;
    this.pendingDefense = undefined; this.pendingDunk = false;
    const dunkStyle = this.dunkStyle;
    if (shoot || dunk) this.cycleDunkStyle();
    return { moveX, moveZ, sprint, shoot, ...(trick ? { trick } : {}), ...(defense ? { defense } : {}),
      ...((shoot || dunk) ? { dunk, dunkStyle } : {}) };
  }
}
