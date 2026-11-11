import { buildStudentQuestionFeedback, StudentQuestionFeedback } from './learningFeedback';
import { normaliseAppearancePreset } from '../config/appearance';
import { isDrivingInPaint } from './finishing';
import {
  computeBasketballFacingAngle,
  dribbleBallPosition,
  jumpShotGatherBallPosition,
  stepAngleTowards,
  stepDribbleState,
} from './dribble';
import { DefenseAction, DEFENSE_CONFIG, canStealBall, isDefenseAction, isStealRecovery } from './defense';
import { stepPlayerMotion, MotionTarget } from './contact';
import { DunkStyle, DUNK_STYLES, DUNK_TAKEOFF_SEC, DUNK_LABELS, isDunkStyle, dunkBallPosition, dunkReboundPosition } from './dunks';
import { canTriggerOrChainTrick, getAirPose, isStreetMove, STREET_MOVES, StreetMove } from './streetMoves';
import {
  AiDifficultyId,
  COURT_GEOMETRY,
  MOVEMENT_CONFIG,
  LEARNING_STREAK_CONFIG,
  ROOM_PRESETS,
  RoomPresetId,
  SESSION_LENGTH_PRESETS,
  SessionLengthId,
  STREET_FLOW_CONFIG,
} from '../config/balance';
import {
  createSeededRng,
  PublicDuelQuestion,
  QuestionItem,
  QuestionOption,
  QuestionPack,
  shuffleQuestionOptionsForPlayer,
  toPublicDuelQuestion,
} from '../content/question-schema';
import {
  AiBasketballBrainState,
  AiCommittedQuestionPlan,
  createAiBasketballBrainState,
  createAiQuestionPlanAtDuelStart,
  stepAiBasketballDecision,
} from './aiOpponent';
import {
  BlockEligibilitySnapshot,
  computeDistance2D,
  evaluateBlockEligibilityAtRelease,
} from './block';
import {
  advancePossessionAfterAttempt,
  buildPlayerLearningSummary,
  createInitialPossessionScoreState,
  MatchAttemptEvent,
  MatchRulesConfig,
  PlayerLearningSummary,
  PlayerSlot,
  PossessionScoreState,
} from './possession';
import {
  BallFlightState,
  captureShotReleaseSnapshot,
  createInitialBallFlightState,
  evaluateBallPosition,
  resolveAuthoritativeShot,
  ResolvedShotOutcome,
  ShotReleaseSnapshot,
  stepBallPostResolution,
  stepBallPreResolution,
  transitionBallToResolution,
  Vector3D,
} from './shot';
import {
  clamp,
  DuelConfig,
  DuelResolutionSummary,
  evaluateQuestionDuel,
  PlayerAnswerRecord,
  SubmissionValidationResult,
  validateAnswerSubmission,
} from './timing';

export type MatchPhase =
  | 'Lobby'
  | 'Possession'
  | 'QuestionReady'
  | 'Duel'
  | 'Resolution'
  | 'Feedback'
  | 'MatchEnd';

export type CharacterAnimState =
  | 'idle'
  | 'run'
  | 'dribble'
  | 'shoot'
  | 'block'
  | 'celebrate';

export interface PlayerSimState {
  slot: PlayerSlot;
  id: string;
  pseudonym: string;
  isAi: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  facingAngle: number;
  sprintStamina: number;
  isSprinting: boolean;
  sprintSettleRemainingMs: number;
  animState: CharacterAnimState;
  appearancePreset: number;
  streetMove: StreetMove | null;
  moveElapsedSec: number;
  moveCooldownSec: number;
  moveSide: number;
  moveForwardX: number;
  moveForwardZ: number;
  wrongFootSec: number;
  finishKind: 'jump' | 'dunk' | null;
  finishElapsedSec: number;
  finishResolutionSec: number;
  finishOutcome: 'basket' | 'miss' | 'block' | null;
  dunkStyle: DunkStyle;
  dunkBallStart: Vector3D | null;
  defenseAction: DefenseAction | null;
  defenseElapsedSec: number;
  defenseRecoverySec: number;
  defenseCooldownSec: number;
  defenseResult: 'miss' | 'steal' | 'timed-block' | 'jump' | null;
  defenseTargetX: number;
  defenseTargetZ: number;
  /** Style momentum is separate from the consecutive-correct learning Fire streak. */
  streetFlow: number;
  onFire: boolean;
  correctAnswerStreak: number;
  trickCombo: number;
  lastTrick: StreetMove | null;
  comboGraceSec: number;
  trickOverexposedSec: number;
  /** Authoritative input buffer across Solo, WebSocket, and HTTP rooms */
  bufferedTrick: StreetMove | null;
  bufferedTrickSec: number;
  bufferedFinish: 'shoot' | 'dunk' | null;
  bufferedFinishStyle: DunkStyle | null;
  bufferedFinishSec: number;
  bufferedDefense: DefenseAction | null;
  bufferedDefenseSec: number;
  /** Synced arcade callout banner for HUD/3D presentation */
  calloutText: string | null;
  calloutSec: number;
  /** Movement-only carry/plant continuity state (never alters score, RNG or question rules) */
  dribbleHand?: -1 | 1;
  dribbleSide?: number;
  moveStartSide?: number;
  dribbleBlend?: number;
  handSwitchCooldownSec?: number;
  plantSec?: number;
  plantDirX?: number;
  plantDirZ?: number;
}

export interface PlayerMoveInput {
  moveX: number; // -1..1
  moveZ: number; // -1..1
  sprint: boolean;
  shoot: boolean;
  trick?: StreetMove;
  defense?: DefenseAction;
  dunk?: boolean;
  dunkStyle?: DunkStyle;
}

export interface ActiveDuelState {
  duelId: string;
  possessionIndex: number;
  question: QuestionItem;
  displayedOptionsBySlot: [QuestionOption[], QuestionOption[]];
  publicQuestionsBySlot: [PublicDuelQuestion, PublicDuelQuestion];
  config: DuelConfig;
  releaseSnapshot: ShotReleaseSnapshot;
  elapsedRealMs: number;
  readyClients: [boolean, boolean];
  answersBySlot: [PlayerAnswerRecord | null, PlayerAnswerRecord | null];
  aiPlan: AiCommittedQuestionPlan | null;
  resolvedOutcome: ResolvedShotOutcome | null;
  physicalBlock: boolean;
  aiJumpAtMs: number | null;
}

export interface FeedbackBannerState {
  duelId: string;
  headline: string;
  subheadline: string;
  correctOptionId: string;
  correctOptionText: string;
  explanation: string;
  sourceRef: string;
  topic: string;
  week: number;
  outcome: 'basket' | 'miss' | 'block' | 'shot-clock-turnover' | 'steal-turnover';
  pointsAwarded: 0 | 2 | 3;
  finalProbability: number;
  remainingRealMs: number;
  questionStem?: string;
  learningBySlot?: [StudentQuestionFeedback, StudentQuestionFeedback];
  continueReady?: [boolean, boolean];
}

export interface MatchEngineOptions {
  matchId: string;
  mode: 'solo' | 'online';
  pack: QuestionPack;
  roomPresetId: RoomPresetId;
  sessionLengthId: SessionLengthId;
  aiDifficulty?: AiDifficultyId;
  customMaxPossessions?: number;
  player0: { id: string; pseudonym: string; appearancePreset?: number };
  player1: {
    id: string;
    pseudonym: string;
    isAi: boolean;
    appearancePreset?: number;
  };
  seed?: number;
}

export class AuthoritativeMatchEngine {
  public readonly matchId: string;
  public readonly mode: 'solo' | 'online';
  public readonly packId: string;
  public readonly packVersion: number;
  public readonly roomPresetId: RoomPresetId;
  public readonly sessionLengthId: SessionLengthId;
  public readonly aiDifficulty: AiDifficultyId;
  public readonly rules: MatchRulesConfig;

  public phase: MatchPhase = 'Lobby';
  public scoreState: PossessionScoreState;
  public players: [PlayerSimState, PlayerSimState];
  public movementClockRemainingMs: number;
  public possessionIndex = 0;

  public activeDuel: ActiveDuelState | null = null;
  public ballFlight: BallFlightState | null = null;
  public feedbackState: FeedbackBannerState | null = null;
  public attemptEvents: MatchAttemptEvent[] = [];

  private readonly approvedQuestions: readonly QuestionItem[];
  private usedQuestionIds = new Set<string>();
  private rng: () => number;
  private readonly dunkRng: () => number;
  private lastDunkStyle: DunkStyle | null = null;
  private aiBrain: AiBasketballBrainState;
  private questionReadyTimerMs = 0;

  constructor(options: MatchEngineOptions) {
    this.matchId = options.matchId;
    this.mode = options.mode;
    this.packId = options.pack.packId;
    this.packVersion = options.pack.packVersion;
    this.roomPresetId = options.roomPresetId;
    this.sessionLengthId = options.sessionLengthId;
    this.aiDifficulty = options.aiDifficulty ?? 'intermediate';

    const roomPreset = ROOM_PRESETS[this.roomPresetId];
    const sessionPreset = SESSION_LENGTH_PRESETS[this.sessionLengthId];

    this.rules = Object.freeze({
      targetScore: sessionPreset.targetScore,
      maxPossessionsPerPlayer:
        options.customMaxPossessions ?? sessionPreset.maxPossessionsPerPlayer,
      movementClockMs: roomPreset.movementClockMs,
    });

    this.approvedQuestions = Object.freeze(
      options.pack.questions.filter((q) => q.status === 'approved')
    );
    if (this.approvedQuestions.length === 0) {
      throw new Error(
        `Question pack "${this.packId}" has no approved questions.`
      );
    }

    this.rng =
      options.seed !== undefined
        ? createSeededRng(options.seed)
        : () => Math.random();
    // Style variety must not consume the question/answer/shot RNG stream.
    this.dunkRng = options.seed !== undefined ? createSeededRng(options.seed ^ 0x5d6a7b8c) : () => Math.random();
    this.aiBrain = createAiBasketballBrainState(this.rng);

    this.scoreState = createInitialPossessionScoreState(0);
    this.movementClockRemainingMs = this.rules.movementClockMs;

    this.players = [
      {
        slot: 0,
        id: options.player0.id,
        pseudonym: options.player0.pseudonym,
        isAi: false,
        x: COURT_GEOMETRY.attackerStart.x,
        z: COURT_GEOMETRY.attackerStart.z,
        vx: 0,
        vz: 0,
        facingAngle: COURT_GEOMETRY.attackerStart.facingAngle,
        sprintStamina: 1,
        isSprinting: false,
        sprintSettleRemainingMs: 0,
        animState: 'idle',
        appearancePreset: normaliseAppearancePreset(options.player0.appearancePreset),
        streetMove: null, moveElapsedSec: 0, moveCooldownSec: 0, moveSide: 1,
        moveForwardX: 0, moveForwardZ: -1, wrongFootSec: 0,
        finishKind: null, finishElapsedSec: 0, finishResolutionSec: -1,
        dunkStyle: 'tomahawk', dunkBallStart: null, finishOutcome: null,
        defenseAction: null, defenseElapsedSec: 0, defenseRecoverySec: 0, defenseCooldownSec: 0,
        defenseResult: null, defenseTargetX: 0, defenseTargetZ: 0,
        streetFlow: 0, onFire: false, correctAnswerStreak: 0, trickCombo: 0, lastTrick: null,
        comboGraceSec: 0, trickOverexposedSec: 0,
        bufferedTrick: null, bufferedTrickSec: 0,
        bufferedFinish: null, bufferedFinishStyle: null, bufferedFinishSec: 0,
        bufferedDefense: null, bufferedDefenseSec: 0,
        calloutText: null, calloutSec: 0,
      },
      {
        slot: 1,
        id: options.player1.id,
        pseudonym: options.player1.pseudonym,
        isAi: options.player1.isAi,
        x: COURT_GEOMETRY.defenderStart.x,
        z: COURT_GEOMETRY.defenderStart.z,
        vx: 0,
        vz: 0,
        facingAngle: COURT_GEOMETRY.defenderStart.facingAngle,
        sprintStamina: 1,
        isSprinting: false,
        sprintSettleRemainingMs: 0,
        animState: 'idle',
        appearancePreset: normaliseAppearancePreset(options.player1.appearancePreset, 1),
        streetMove: null, moveElapsedSec: 0, moveCooldownSec: 0, moveSide: 1,
        moveForwardX: 0, moveForwardZ: -1, wrongFootSec: 0,
        finishKind: null, finishElapsedSec: 0, finishResolutionSec: -1,
        dunkStyle: 'tomahawk', dunkBallStart: null, finishOutcome: null,
        defenseAction: null, defenseElapsedSec: 0, defenseRecoverySec: 0, defenseCooldownSec: 0,
        defenseResult: null, defenseTargetX: 0, defenseTargetZ: 0,
        streetFlow: 0, onFire: false, correctAnswerStreak: 0, trickCombo: 0, lastTrick: null,
        comboGraceSec: 0, trickOverexposedSec: 0,
        bufferedTrick: null, bufferedTrickSec: 0,
        bufferedFinish: null, bufferedFinishStyle: null, bufferedFinishSec: 0,
        bufferedDefense: null, bufferedDefenseSec: 0,
        calloutText: null, calloutSec: 0,
      },
    ];
  }

  private emitCallout(slot: PlayerSlot, text: string, durationSec = 1.35): void {
    const p = this.players[slot];
    p.calloutText = text;
    p.calloutSec = Math.max(p.calloutSec, durationSec);
  }

  private adjustStreetFlow(slot: PlayerSlot, delta: number, callout?: string): void {
    const p = this.players[slot];
    p.streetFlow = Number(clamp(p.streetFlow + delta, 0, 1).toFixed(4));
    if (callout) this.emitCallout(slot, callout, 1.3);
  }

  private updateLearningStreaks(): void {
    if (!this.activeDuel) return;
    for (const slot of [0, 1] as const) {
      const p = this.players[slot];
      const wasOnFire = p.onFire;
      p.correctAnswerStreak = this.activeDuel.answersBySlot[slot]?.isCorrect
        ? p.correctAnswerStreak + 1 : 0;
      p.onFire = p.correctAnswerStreak >= LEARNING_STREAK_CONFIG.correctAnswersToIgnite;
      if (!wasOnFire && p.onFire) this.emitCallout(slot, "🔥 ON FIRE! • 3 CORRECT IN A ROW", 3.5);
      else if (wasOnFire && !p.onFire) this.emitCallout(slot, 'STREAK ENDED • BUILD IT AGAIN', 2);
    }
  }

  public startMatch(): void {
    if (this.phase !== 'Lobby') {
      return;
    }
    this.setupPossessionPositions();
    this.phase = 'Possession';
  }

  private setupPossessionPositions(): void {
    const att = this.scoreState.currentAttacker;
    const def: PlayerSlot = att === 0 ? 1 : 0;

    this.players[att].x = COURT_GEOMETRY.attackerStart.x;
    this.players[att].z = COURT_GEOMETRY.attackerStart.z;
    this.players[att].vx = 0;
    this.players[att].vz = 0;
    this.players[att].facingAngle = COURT_GEOMETRY.attackerStart.facingAngle;
    this.players[att].isSprinting = false;
    this.players[att].sprintSettleRemainingMs = 0;
    this.players[att].animState = 'idle';

    this.players[def].x = COURT_GEOMETRY.defenderStart.x;
    this.players[def].z = COURT_GEOMETRY.defenderStart.z;
    this.players[def].vx = 0;
    this.players[def].vz = 0;
    this.players[def].facingAngle = COURT_GEOMETRY.defenderStart.facingAngle;
    this.players[def].isSprinting = false;
    this.players[def].sprintSettleRemainingMs = 0;
    this.players[def].animState = 'idle';

    for (const p of this.players) {
      p.streetMove = null; p.moveElapsedSec = 0; p.moveCooldownSec = 0;
      p.wrongFootSec = 0; p.finishKind = null; p.finishElapsedSec = 0; p.finishResolutionSec = -1;
      p.defenseAction = null; p.defenseElapsedSec = 0; p.defenseRecoverySec = 0; p.defenseCooldownSec = 0;
      p.defenseResult = null; p.dunkBallStart = null; p.finishOutcome = null;
      p.trickCombo = 0; p.lastTrick = null; p.comboGraceSec = 0; p.trickOverexposedSec = 0;
      p.bufferedTrick = null; p.bufferedTrickSec = 0;
      p.bufferedFinish = null; p.bufferedFinishStyle = null; p.bufferedFinishSec = 0;
      p.bufferedDefense = null; p.bufferedDefenseSec = 0;
      p.dribbleHand = 1; p.dribbleSide = undefined; p.moveStartSide = undefined; p.dribbleBlend = undefined;
      p.handSwitchCooldownSec = 0; p.plantSec = 0; p.plantDirX = 0; p.plantDirZ = 0;
    }
    this.movementClockRemainingMs = this.rules.movementClockMs;
    this.ballFlight = null;
    this.activeDuel = null;
    this.feedbackState = null;
    this.aiBrain = createAiBasketballBrainState(this.rng);
  }

  /**
   * Selects the next approved question without repeating questions within the match
   * unless all approved questions in the pack have already been used.
   */
  private selectNextQuestion(): QuestionItem {
    let pool: readonly QuestionItem[] = this.approvedQuestions.filter(
      (q) => !this.usedQuestionIds.has(q.id)
    );
    if (pool.length === 0) {
      this.usedQuestionIds.clear();
      pool = this.approvedQuestions;
    }
    const idx = Math.floor(this.rng() * pool.length);
    const chosen = pool[idx] ?? pool[0];
    this.usedQuestionIds.add(chosen.id);
    return chosen;
  }

  /**
   * Evaluates live block eligibility during the Possession phase so the UI can display
   * the subtle "Block available" indicator to the defender.
   */
  public getLiveBlockEligibility(): BlockEligibilitySnapshot {
    if (this.activeDuel) {
      return this.activeDuel.releaseSnapshot.blockEligibility;
    }
    const att = this.scoreState.currentAttacker;
    const def: PlayerSlot = att === 0 ? 1 : 0;
    return evaluateBlockEligibilityAtRelease({
      shooterPos: { x: this.players[att].x, z: this.players[att].z },
      defenderPos: { x: this.players[def].x, z: this.players[def].z },
      defenderFacingAngle: this.players[def].facingAngle,
      blockingDisabledByRule: this.players[def].defenseAction === 'swipe' || this.players[def].wrongFootSec > 0,
    });
  }

  /**
   * Steps the match simulation forward.
   * Uses separate clocks:
   * - realDeltaMs: real wall-clock delta (used for QuestionReady, Duel timers, Resolution, Feedback)
   * - Movement inputs only affect gameplay when phase === 'Possession'.
   */
  public step(
    realDeltaMs: number,
    inputsBySlot: [PlayerMoveInput, PlayerMoveInput]
  ): void {
    const clampedDeltaMs = clamp(realDeltaMs, 0, 250);
    const deltaSec = clampedDeltaMs / 1000;
    for (const p of this.players) {
      if (this.phase !== 'Lobby') {
        p.defenseElapsedSec += deltaSec;
        p.defenseRecoverySec = Math.max(0, p.defenseRecoverySec - deltaSec);
        p.defenseCooldownSec = Math.max(0, p.defenseCooldownSec - deltaSec);
        p.calloutSec = Math.max(0, p.calloutSec - deltaSec);
        if (p.calloutSec <= 0) p.calloutText = null;
        if (p.defenseRecoverySec <= 0) p.defenseAction = null;
      }
      if (p.finishKind && this.phase !== 'Possession' && this.phase !== 'Lobby') {
        p.finishElapsedSec += deltaSec;
        if (this.phase === 'Resolution' || this.phase === 'Feedback') p.finishResolutionSec += deltaSec;
      }
    }

    if (this.phase === 'Possession') {
      this.stepPossessionPhase(clampedDeltaMs, deltaSec, inputsBySlot);
      return;
    }

    if (this.phase === 'QuestionReady') {
      const def: PlayerSlot = this.scoreState.currentAttacker === 0 ? 1 : 0;
      if (inputsBySlot[def].defense === 'jump' || inputsBySlot[def].shoot) this.tryDefenseAction(def, 'jump');
      if (this.activeDuel?.aiJumpAtMs !== null && this.activeDuel?.aiJumpAtMs !== undefined &&
          this.questionReadyTimerMs >= this.activeDuel.aiJumpAtMs) {
        this.tryDefenseAction(def, 'jump'); this.activeDuel.aiJumpAtMs = null;
      }
      this.checkTimedDunkBlock();
      this.stepQuestionReadyPhase(clampedDeltaMs, deltaSec);
      return;
    }

    if (this.phase === 'Duel') {
      this.stepDuelPhase(clampedDeltaMs, deltaSec);
      return;
    }

    if (this.phase === 'Resolution') {
      this.stepResolutionPhase(clampedDeltaMs, deltaSec);
      return;
    }

    if (this.phase === 'Feedback') {
      this.stepFeedbackPhase(clampedDeltaMs);
      return;
    }
  }

  private stepPossessionPhase(
    deltaMs: number,
    deltaSec: number,
    inputsBySlot: [PlayerMoveInput, PlayerMoveInput]
  ): void {
    const att = this.scoreState.currentAttacker;
    const def: PlayerSlot = att === 0 ? 1 : 0;

    // Advance movement clock (Question time never consumes movement clock)
    this.movementClockRemainingMs = Math.max(
      0,
      this.movementClockRemainingMs - deltaMs
    );
    if (this.movementClockRemainingMs <= 0) {
      this.handleMovementClockTurnover();
      return;
    }

    // Compute AI input if slot 1 is AI
    const effectiveInputs: [PlayerMoveInput, PlayerMoveInput] = [
      inputsBySlot[0],
      inputsBySlot[1],
    ];
    if (this.players[1].isAi) {
      effectiveInputs[1] = stepAiBasketballDecision({
        brain: this.aiBrain,
        isAttacker: att === 1,
        aiPos: { x: this.players[1].x, z: this.players[1].z },
        opponentPos: { x: this.players[0].x, z: this.players[0].z },
        movementClockRemainingMs: this.movementClockRemainingMs,
        difficulty: this.aiDifficulty,
        deltaSec,
        self: this.players[1],
        opponent: this.players[0],
        ballPos: this.getBallPosition3D(),
        rng: this.rng,
      });
    }

    const defPlayer = this.players[def];
    defPlayer.bufferedDefenseSec = Math.max(0, defPlayer.bufferedDefenseSec - deltaSec);
    if (defPlayer.bufferedDefenseSec <= 0) defPlayer.bufferedDefense = null;

    if (effectiveInputs[def].defense || effectiveInputs[def].shoot) {
      const action = effectiveInputs[def].defense ?? 'jump';
      if (isDefenseAction(action)) {
        if (!this.tryDefenseAction(def, action)) {
          // Buffer defensive intent only when near cooldown end (never bypasses 1.0s missed-swipe freeze)
          if (defPlayer.defenseRecoverySec <= 0.18 && defPlayer.defenseCooldownSec <= STREET_FLOW_CONFIG.inputBufferWindowSec) {
            defPlayer.bufferedDefense = action;
            defPlayer.bufferedDefenseSec = STREET_FLOW_CONFIG.inputBufferWindowSec;
          }
        }
      }
    } else if (defPlayer.bufferedDefense && defPlayer.bufferedDefenseSec > 0) {
      if (this.tryDefenseAction(def, defPlayer.bufferedDefense)) {
        defPlayer.bufferedDefense = null;
        defPlayer.bufferedDefenseSec = 0;
      }
    }

    const motionTargets: [MotionTarget, MotionTarget] = [
      { x: 0, z: 0, response: MOVEMENT_CONFIG.braking },
      { x: 0, z: 0, response: MOVEMENT_CONFIG.braking },
    ];
    const normInputs: [
      { normX: number; normZ: number; isMoving: boolean },
      { normX: number; normZ: number; isMoving: boolean },
    ] = [
      { normX: 0, normZ: 0, isMoving: false },
      { normX: 0, normZ: 0, isMoving: false },
    ];
    // Update both players' movement intentions before resolving shared body contact.
    for (const slot of [0, 1] as const) {
      const p = this.players[slot];
      const inp = effectiveInputs[slot];
      const isAttacker = slot === att;
      const opponent = this.players[slot === 0 ? 1 : 0];

      p.moveCooldownSec = Math.max(0, p.moveCooldownSec - deltaSec);
      p.wrongFootSec = Math.max(0, p.wrongFootSec - deltaSec);
      p.plantSec = Math.max(0, (p.plantSec ?? 0) - deltaSec);
      p.comboGraceSec = Math.max(0, p.comboGraceSec - deltaSec);
      p.trickOverexposedSec = Math.max(0, p.trickOverexposedSec - deltaSec);
      p.bufferedTrickSec = Math.max(0, p.bufferedTrickSec - deltaSec);
      if (p.bufferedTrickSec <= 0) p.bufferedTrick = null;
      p.bufferedFinishSec = Math.max(0, p.bufferedFinishSec - deltaSec);
      if (p.bufferedFinishSec <= 0) {
        p.bufferedFinish = null;
        p.bufferedFinishStyle = null;
      }

      if (p.streetMove) {
        p.moveElapsedSec += deltaSec;
        if (p.moveElapsedSec >= STREET_MOVES[p.streetMove].duration) {
          p.streetMove = null;
        }
      }
      if (!p.streetMove && p.comboGraceSec <= 0 && !p.finishKind) {
        p.trickCombo = 0;
        if (p.moveCooldownSec <= 0) {
          p.lastTrick = null;
        }
      }

      if (isAttacker && isStreetMove(inp.trick)) {
        const sameActiveOrRecent =
          inp.trick === p.streetMove || (!p.streetMove && inp.trick === p.lastTrick && p.moveCooldownSec > 0);
        if (sameActiveOrRecent) {
          const defenderReadyOrSwiping =
            opponent.wrongFootSec <= 0 &&
            (opponent.defenseRecoverySec <= 0 ||
              (opponent.defenseAction === 'swipe' && opponent.defenseResult === null));
          // Anti-spam counterplay: mashing the same trick right in a close defender's chest exposes the handle
          if (
            (!p.streetMove || p.moveElapsedSec > 0.25) &&
            computeDistance2D(p, opponent) < 1.32 &&
            defenderReadyOrSwiping
          ) {
            p.trickOverexposedSec = STREET_FLOW_CONFIG.overexposedDurationSec;
            this.emitCallout(slot, 'BALL EXPOSED!', 0.95);
          }
        } else {
          p.bufferedTrick = inp.trick;
          p.bufferedTrickSec = STREET_FLOW_CONFIG.inputBufferWindowSec;
        }
      }

      if (isAttacker && p.bufferedTrick && p.bufferedTrickSec > 0) {
        const nextTrick = p.bufferedTrick;
        const check = canTriggerOrChainTrick(p, nextTrick);
        if (check.allowed) {
          p.bufferedTrick = null;
          p.bufferedTrickSec = 0;
          p.moveStartSide = p.dribbleSide ?? p.dribbleHand ?? 1;
          if (nextTrick === 'crossover' || nextTrick === 'eurostep') {
            p.dribbleHand = (p.dribbleHand ?? 1) === 1 ? -1 : 1;
            p.handSwitchCooldownSec = STREET_MOVES[nextTrick].duration + 0.35;
          }
          p.streetMove = nextTrick;
          p.lastTrick = nextTrick;
          p.moveElapsedSec = 0;
          p.trickCombo = check.isChain
            ? Math.min(STREET_FLOW_CONFIG.maxTrickChain, p.trickCombo + 1)
            : 1;
          p.comboGraceSec = STREET_MOVES[nextTrick].duration + STREET_FLOW_CONFIG.comboGraceSec;
          p.moveCooldownSec = STREET_FLOW_CONFIG.baseMoveCooldownSec;
          p.sprintStamina = clamp(p.sprintStamina - check.cost, 0, 1);

          const dx = COURT_GEOMETRY.hoopX - p.x;
          const dz = COURT_GEOMETRY.hoopZ - p.z;
          const d = Math.hypot(dx, dz) || 1;
          p.moveForwardX = dx / d;
          p.moveForwardZ = dz / d;
          const lateral = inp.moveX * -p.moveForwardZ + inp.moveZ * p.moveForwardX;
          const fallbackSide: -1 | 1 =
            (nextTrick === 'crossover' || nextTrick === 'eurostep') && p.dribbleHand
              ? (-p.dribbleHand as -1 | 1)
              : (-p.moveSide as -1 | 1);
          p.moveSide = Math.abs(lateral) > 0.15 ? (Math.sign(lateral) as -1 | 1) : fallbackSide;

          const distToDef = computeDistance2D(p, opponent);
          // Greedy 3rd-chain right into an unshaken chest-to-chest defender exposes the ball!
          if (
            p.trickCombo >= STREET_FLOW_CONFIG.maxTrickChain &&
            distToDef < 1.15 &&
            opponent.wrongFootSec <= 0 &&
            opponent.defenseRecoverySec <= 0
          ) {
            p.trickOverexposedSec = STREET_FLOW_CONFIG.overexposedDurationSec;
            this.emitCallout(slot, 'OVERDRIBBLE — EXPOSED!', 1.05);
          } else {
            let brokeAnkles = false;
            if (distToDef < 2.55 && opponent.wrongFootSec <= 0) {
              const baseFreeze = nextTrick === 'spin' ? 0.44 : nextTrick === 'crossover' ? 0.36 : 0.32;
              opponent.wrongFootSec = baseFreeze + (check.isChain ? 0.08 : 0);
              brokeAnkles = true;
            }
            const flowGain =
              STREET_FLOW_CONFIG.flowCleanTrick +
              (check.isChain ? STREET_FLOW_CONFIG.flowComboStepBonus : 0) +
              (brokeAnkles ? STREET_FLOW_CONFIG.flowAnkleBreaker : 0);
            const comboLabel =
              p.trickCombo >= 3
                ? `3x SHOWTIME CHAIN!`
                : p.trickCombo === 2
                  ? `2x ${STREET_MOVES[nextTrick].label} CHAIN!`
                  : brokeAnkles
                    ? `ANKLE BREAKER!`
                    : undefined;
            this.adjustStreetFlow(slot, flowGain, comboLabel);
          }
        }
      }

      const safeX = Number.isFinite(inp.moveX) ? inp.moveX : 0;
      const safeZ = Number.isFinite(inp.moveZ) ? inp.moveZ : 0;
      const mag = Math.hypot(safeX, safeZ);
      const normX = mag > 1 ? safeX / mag : safeX;
      const normZ = mag > 1 ? safeZ / mag : safeZ;
      const isMoving = mag > 0.06;
      normInputs[slot] = { normX, normZ, isMoving };

      const canSprint =
        !isStealRecovery(p) &&
        inp.sprint &&
        isMoving &&
        (p.isSprinting
          ? p.sprintStamina > 0.02
          : p.sprintStamina >= MOVEMENT_CONFIG.minStaminaToStartSprint);

      if (canSprint) {
        p.isSprinting = true;
        const drainScale = p.onFire ? 0.82 : 1;
        p.sprintStamina = clamp(
          p.sprintStamina - MOVEMENT_CONFIG.sprintDrainPerSec * drainScale * deltaSec,
          0,
          1
        );
        p.sprintSettleRemainingMs = MOVEMENT_CONFIG.sprintSettleWindowMs;
      } else {
        p.isSprinting = false;
        p.sprintStamina = clamp(
          p.sprintStamina + MOVEMENT_CONFIG.sprintRegenPerSec * deltaSec,
          0,
          1
        );
        p.sprintSettleRemainingMs = Math.max(
          0,
          p.sprintSettleRemainingMs - deltaMs
        );
      }

      const baseSpeed = isAttacker
        ? MOVEMENT_CONFIG.dribbleSpeedMps
        : MOVEMENT_CONFIG.baseSpeedMps;
      const onFireSpeedMult = p.onFire ? LEARNING_STREAK_CONFIG.movementMultiplier : 1;
      const speed =
        baseSpeed * onFireSpeedMult * (p.isSprinting ? MOVEMENT_CONFIG.sprintMultiplier : 1);

      let targetX = normX * speed, targetZ = normZ * speed;
      if (p.streetMove) {
        const move = STREET_MOVES[p.streetMove];
        const u = p.moveElapsedSec / move.duration;
        const forward = p.streetMove === 'stepback' ? -1 : p.streetMove === 'crossover' ? 0.38 : 0.84;
        const side = p.streetMove === 'stepback' ? 0 : p.moveSide * (p.streetMove === 'eurostep' && u > 0.48 ? -0.74 : 0.74);
        const len = Math.hypot(forward, side);
        targetX = (p.moveForwardX * forward - p.moveForwardZ * side) / len * move.speed;
        targetZ = (p.moveForwardZ * forward + p.moveForwardX * side) / len * move.speed;
      }
      if (p.defenseAction === 'jump') {
        targetX *= DEFENSE_CONFIG.jumpSteeringMultiplier;
        targetZ *= DEFENSE_CONFIG.jumpSteeringMultiplier;
      }
      const currentSpeed = Math.hypot(p.vx, p.vz);
      const isHardCut =
        !isStealRecovery(p) &&
        !p.streetMove &&
        p.defenseAction !== 'jump' &&
        isMoving &&
        currentSpeed > 1.8 &&
        (p.vx * normX + p.vz * normZ) / currentSpeed < 0.2;
      if (isHardCut) {
        p.plantSec = Math.max(p.plantSec ?? 0, 0.16);
        p.plantDirX = normX;
        p.plantDirZ = normZ;
      } else if (!isStealRecovery(p) && !p.streetMove && p.defenseAction !== 'jump' && !isMoving && currentSpeed > 1.6) {
        p.plantSec = Math.max(p.plantSec ?? 0, 0.16);
        p.plantDirX = -p.vx / currentSpeed;
        p.plantDirZ = -p.vz / currentSpeed;
      }

      motionTargets[slot] = {
        x: targetX, z: targetZ,
        response:
          isMoving || p.streetMove
            ? isHardCut
              ? MOVEMENT_CONFIG.braking
              : MOVEMENT_CONFIG.acceleration
            : MOVEMENT_CONFIG.braking,
      };
    }

    stepPlayerMotion(this.players, motionTargets, deltaSec);

    for (const slot of [0, 1] as const) {
      const p = this.players[slot];
      const opponent = this.players[slot === 0 ? 1 : 0];
      const isAttacker = slot === att;
      const { normX, normZ, isMoving } = normInputs[slot];
      const actualSpeed = Math.hypot(p.vx, p.vz);

      if (p.defenseRecoverySec > 0) {
        p.animState = p.defenseAction === 'jump' ? 'block' : 'idle';
        if (p.defenseAction === 'jump') {
          const toAtt = Math.atan2(opponent.x - p.x, opponent.z - p.z);
          p.facingAngle = stepAngleTowards(p.facingAngle, toAtt, 14, deltaSec);
        }
      } else {
        const desiredFacing = computeBasketballFacingAngle({
          self: p,
          opponent,
          isAttacker,
          normX,
          normZ,
          isMoving,
        });
        const turnRate = p.streetMove ? 22 : isMoving ? 18 : 14;
        p.facingAngle = stepAngleTowards(
          p.facingAngle,
          desiredFacing,
          turnRate,
          deltaSec,
          p.streetMove ? 24 : 18,
        );
        const movingWorld = isMoving || Boolean(p.streetMove) || actualSpeed > 0.48;
        p.animState = movingWorld ? (isAttacker ? 'dribble' : 'run') : 'idle';
      }
    }

    stepDribbleState(this.players[att], this.players[def], normInputs[att].isMoving, deltaSec);

    const defender = this.players[def];
    if (defender.defenseAction === 'swipe' && defender.defenseResult === null &&
        defender.defenseElapsedSec >= DEFENSE_CONFIG.swipeContactSec) {
      if (canStealBall(defender, this.players[att], this.getBallPosition3D())) {
        defender.defenseResult = 'steal'; this.completeSteal(def); return;
      }
      defender.defenseResult = 'miss';
      this.emitCallout(def, 'MISSED SWIPE — FROZEN!', 0.95);
    }

    // Buffer shot/dunk input and fire immediately when neutral or at trick cancel window
    const attacker = this.players[att];
    if (effectiveInputs[att].shoot || effectiveInputs[att].dunk) {
      attacker.bufferedFinish = effectiveInputs[att].dunk ? 'dunk' : 'shoot';
      attacker.bufferedFinishStyle = isDunkStyle(effectiveInputs[att].dunkStyle)
        ? effectiveInputs[att].dunkStyle
        : attacker.bufferedFinishStyle;
      const cancelWait = attacker.streetMove
        ? Math.max(0, STREET_MOVES[attacker.streetMove].duration * STREET_FLOW_CONFIG.finishCancelFraction - attacker.moveElapsedSec)
        : 0;
      attacker.bufferedFinishSec = cancelWait + STREET_FLOW_CONFIG.inputBufferWindowSec;
    }
    if (attacker.bufferedFinish && attacker.bufferedFinishSec > 0 && attacker.defenseRecoverySec <= 0) {
      const canCancelTrickToFinish =
        !attacker.streetMove ||
        attacker.moveElapsedSec / STREET_MOVES[attacker.streetMove].duration >= STREET_FLOW_CONFIG.finishCancelFraction;
      if (canCancelTrickToFinish) {
        const finishInput: PlayerMoveInput = {
          ...effectiveInputs[att],
          shoot: attacker.bufferedFinish === 'shoot',
          dunk: attacker.bufferedFinish === 'dunk',
          dunkStyle: attacker.bufferedFinishStyle ?? effectiveInputs[att].dunkStyle,
        };
        attacker.bufferedFinish = null;
        attacker.bufferedFinishStyle = null;
        attacker.bufferedFinishSec = 0;
        this.initiateShotAttempt(finishInput);
      }
    }
  }

  /**
   * Initiates a shot from the current attacker:
   * - Automatically faces the attacker toward the basket
   * - Freezes block eligibility and shot release parameters
   * - Creates a unique duel ID and shuffles options independently for both players
   */
  public initiateShotAttempt(input?: PlayerMoveInput): void {
    if (this.phase !== 'Possession') {
      return;
    }

    const att = this.scoreState.currentAttacker;
    const def: PlayerSlot = att === 0 ? 1 : 0;
    const attacker = this.players[att];
    const defender = this.players[def];

    const ballAtGather = this.getBallPosition3D();
    const drivingInPaint = isDrivingInPaint(attacker);
    const activeCombo = attacker.streetMove || attacker.comboGraceSec > 0 ? attacker.trickCombo : 0;
    const wasStepback = attacker.streetMove === 'stepback' || attacker.lastTrick === 'stepback';

    // Automatic facing towards the basket when shooting (Section 4)
    attacker.facingAngle = Math.atan2(
      COURT_GEOMETRY.hoopX - attacker.x,
      COURT_GEOMETRY.hoopZ - attacker.z
    );
    attacker.vx = 0;
    attacker.vz = 0;
    defender.vx = 0;
    defender.vz = 0;
    attacker.animState = 'shoot';
    attacker.finishKind = drivingInPaint ? 'dunk' : 'jump';
    if (attacker.finishKind === 'dunk') {
      const styles = DUNK_STYLES.filter(style => style !== this.lastDunkStyle);
      attacker.dunkStyle = styles[Math.floor(this.dunkRng() * styles.length)];
      this.lastDunkStyle = attacker.dunkStyle;
    }
    attacker.dunkBallStart = ballAtGather;
    attacker.finishElapsedSec = 0; attacker.finishResolutionSec = -1; attacker.finishOutcome = null;
    attacker.streetMove = null;
    attacker.bufferedTrick = null; attacker.bufferedTrickSec = 0;
    attacker.bufferedFinish = null; attacker.bufferedFinishStyle = null; attacker.bufferedFinishSec = 0;
    defender.animState = 'idle';

    // Freeze block eligibility at release (Section 8)
    const blockEligibility = evaluateBlockEligibilityAtRelease({
      shooterPos: { x: attacker.x, z: attacker.z },
      defenderPos: { x: defender.x, z: defender.z },
      defenderFacingAngle: defender.facingAngle,
      blockingDisabledByRule: defender.defenseAction === 'swipe' || defender.wrongFootSec > 0,
    });

    const releasedWhileSprinting =
      (attacker.isSprinting || attacker.sprintSettleRemainingMs > 0) && !wasStepback;

    const comboTier = Math.min(STREET_FLOW_CONFIG.comboSetupBonus.length - 1, activeCombo);
    const setupBonus = STREET_FLOW_CONFIG.comboSetupBonus[comboTier] ?? 0;

    const releaseSnapshot = captureShotReleaseSnapshot({
      shooterPos: { x: attacker.x, z: attacker.z },
      defenderPos: { x: defender.x, z: defender.z },
      releasedWhileSprinting,
      blockEligibility,
      setupBonus,
      comboCount: activeCombo,
      onFire: attacker.onFire,
    });

    const question = this.selectNextQuestion();
    const roomPreset = ROOM_PRESETS[this.roomPresetId];
    const effectiveReadingMs = Math.max(roomPreset.readingMs, question.readingMs);
    const effectiveAnswerWindowMs = roomPreset.untimed
      ? roomPreset.answerWindowMs
      : Math.max(roomPreset.answerWindowMs, question.answerWindowMs);

    const optionsSlot0 = shuffleQuestionOptionsForPlayer(question, this.rng);
    const optionsSlot1 = shuffleQuestionOptionsForPlayer(question, this.rng);

    const duelId = `${this.matchId}-duel-${this.possessionIndex + 1}`;
    const duelConfig: DuelConfig = Object.freeze({
      duelId,
      questionId: question.id,
      validOptionIds: question.options.map((o) => o.id),
      correctOptionId: question.correctOptionId,
      readingMs: effectiveReadingMs,
      answerWindowMs: effectiveAnswerWindowMs,
      tieToleranceMs: roomPreset.tieToleranceMs,
      blockEligibility,
    });

    const aiPlan = this.players[1].isAi
      ? createAiQuestionPlanAtDuelStart({
          duelId,
          difficulty: this.aiDifficulty,
          question,
          effectiveReadingMs,
          effectiveAnswerWindowMs,
          rng: this.rng,
        })
      : null;

    this.activeDuel = {
      duelId,
      possessionIndex: this.possessionIndex,
      question,
      displayedOptionsBySlot: [optionsSlot0, optionsSlot1],
      publicQuestionsBySlot: [
        toPublicDuelQuestion(
          question,
          optionsSlot0,
          effectiveReadingMs,
          effectiveAnswerWindowMs
        ),
        toPublicDuelQuestion(
          question,
          optionsSlot1,
          effectiveReadingMs,
          effectiveAnswerWindowMs
        ),
      ],
      config: duelConfig,
      releaseSnapshot,
      elapsedRealMs: 0,
      readyClients: [this.mode === 'solo', this.mode === 'solo' || this.players[1].isAi],
      answersBySlot: [null, null],
      aiPlan,
      resolvedOutcome: null,
      physicalBlock: false,
      aiJumpAtMs: defender.isAi && attacker.finishKind === 'dunk' && blockEligibility.eligible && this.rng() < 0.72
        ? ({ beginner: 380, intermediate: 220, advanced: 120 }[this.aiDifficulty]) : null,
    };

    this.ballFlight = createInitialBallFlightState({
      shooterPos: { x: attacker.x, z: attacker.z },
      defenderPos: { x: defender.x, z: defender.z },
    });

    this.questionReadyTimerMs = 0;
    this.phase = 'QuestionReady';
  }

  public confirmClientDuelReady(slot: PlayerSlot, duelId: string): void {
    if (!this.activeDuel || this.activeDuel.duelId !== duelId) {
      return;
    }
    this.activeDuel.readyClients[slot] = true;
    // Phase transition is owned by stepQuestionReadyPhase after the gather completes.
  }

  private stepQuestionReadyPhase(realDeltaMs: number, realDeltaSec: number): void {
    const finisher = this.players[this.scoreState.currentAttacker];
    if (this.ballFlight) {
      if (finisher.finishKind === 'jump') {
        // Hold ballFlight at release point while the shooter gathers from live dribble to set point (0..0.18s)
        const prevElapsed = Math.max(0, finisher.finishElapsedSec - realDeltaSec);
        const postGatherSec =
          Math.max(0, finisher.finishElapsedSec - 0.18) - Math.max(0, prevElapsed - 0.18);
        if (postGatherSec > 0) {
          this.ballFlight = stepBallPreResolution(this.ballFlight, postGatherSec);
        }
      } else {
        this.ballFlight = stepBallPreResolution(this.ballFlight, realDeltaSec);
      }
    }
    this.questionReadyTimerMs += realDeltaMs;

    const bothReady =
      this.activeDuel !== null &&
      this.activeDuel.readyClients[0] &&
      this.activeDuel.readyClients[1];

    // Transition into Duel once initial release animation (~320ms) finishes and clients are ready (or bounded 800ms preload timeout)
    if (
      (bothReady && this.questionReadyTimerMs >= (this.players[this.scoreState.currentAttacker].finishKind === 'dunk' ? DUNK_TAKEOFF_SEC * 1000 : 320)) ||
      this.questionReadyTimerMs >= 1200
    ) {
      this.phase = 'Duel';
    }
  }

  private stepDuelPhase(realDeltaMs: number, realDeltaSec: number): void {
    if (!this.activeDuel) {
      return;
    }

    this.activeDuel.elapsedRealMs += realDeltaMs;
    if (this.ballFlight) {
      this.ballFlight = stepBallPreResolution(this.ballFlight, realDeltaSec);
    }

    // Check if AI opponent's pre-committed answer time has been reached
    if (
      this.players[1].isAi &&
      this.activeDuel.aiPlan &&
      this.activeDuel.answersBySlot[1] === null &&
      this.activeDuel.elapsedRealMs >= this.activeDuel.aiPlan.plannedAnswerTimeMs
    ) {
      this.submitAnswer({
        slot: 1,
        duelId: this.activeDuel.duelId,
        optionId: this.activeDuel.aiPlan.chosenOptionId,
        overrideElapsedMs: this.activeDuel.aiPlan.plannedAnswerTimeMs,
      });
    }

    // Resolve duel if deadline has elapsed
    if (this.activeDuel.elapsedRealMs >= this.activeDuel.config.answerWindowMs) {
      this.resolveCurrentDuel();
    }
  }

  /**
   * Validates and records a player's answer submission during the Duel phase.
   */
  public submitAnswer(params: {
    slot: PlayerSlot;
    duelId: string;
    optionId: string;
    overrideElapsedMs?: number;
  }): SubmissionValidationResult {
    if (this.phase !== 'Duel' || !this.activeDuel) {
      return { accepted: false, rejectionReason: 'wrong-duel-id' };
    }

    const elapsedMs =
      params.overrideElapsedMs ?? Math.round(this.activeDuel.elapsedRealMs);
    const player = this.players[params.slot];
    const existing = this.activeDuel.answersBySlot[params.slot];

    const validation = validateAnswerSubmission(
      this.activeDuel.config,
      existing,
      {
        duelId: params.duelId,
        playerId: player.id,
        optionId: params.optionId,
        elapsedMs,
      }
    );

    if (!validation.accepted || !validation.record) {
      return validation;
    }

    this.activeDuel.answersBySlot[params.slot] = validation.record;

    // If both players have now submitted their single locked answer, resolve immediately!
    if (
      this.activeDuel.answersBySlot[0] !== null &&
      this.activeDuel.answersBySlot[1] !== null
    ) {
      this.resolveCurrentDuel();
    }

    return validation;
  }

  private resolveCurrentDuel(): void {
    if (!this.activeDuel || this.phase !== 'Duel') {
      return;
    }

    const att = this.scoreState.currentAttacker;
    const def: PlayerSlot = att === 0 ? 1 : 0;
    const attackerAnswer = this.activeDuel.answersBySlot[att];
    const defenderAnswer = this.activeDuel.answersBySlot[def];

    const duelSummary: DuelResolutionSummary = evaluateQuestionDuel(
      this.activeDuel.config,
      attackerAnswer,
      defenderAnswer
    );

    const roomPreset = ROOM_PRESETS[this.roomPresetId];
    this.updateLearningStreaks();
    const frozenRelease = this.activeDuel.releaseSnapshot;
    const resolvedOutcome = resolveAuthoritativeShot({
      // Keep release geometry frozen; the just-resolved learning answer determines Fire.
      release: captureShotReleaseSnapshot({ ...frozenRelease, onFire: this.players[att].onFire }),
      duel: this.activeDuel.physicalBlock ? { ...duelSummary, shotBlocked: true, statusBannerText: 'TIMED SWAT! The defender met the dunk at take-off.' } : duelSummary,
      randomDraw: this.rng(),
      correctBaseBonus: roomPreset.correctBaseBonus,
      speedBonusWeight: roomPreset.speedBonusWeight,
    });

    this.activeDuel.resolvedOutcome = resolvedOutcome;
    this.players[att].finishOutcome = resolvedOutcome.outcome;

    if (this.ballFlight) {
      this.ballFlight = transitionBallToResolution(
        this.ballFlight,
        resolvedOutcome.outcome
      );
    }

    // Award Street Flow for SPX101 knowledge + speed & defensive blocks!
    if (duelSummary.attackerCorrect) {
      const knowledgeFlow =
        STREET_FLOW_CONFIG.flowCorrectAnswerBase +
        STREET_FLOW_CONFIG.flowCorrectAnswerSpeedWeight * duelSummary.attackerSpeedScore;
      this.adjustStreetFlow(att, knowledgeFlow);
    }
    if (duelSummary.defenderCorrect) {
      const defSpeedScore = defenderAnswer
        ? clamp(
            1 -
              (defenderAnswer.acceptedTimeMs - this.activeDuel.config.readingMs) /
                Math.max(1, this.activeDuel.config.answerWindowMs - this.activeDuel.config.readingMs),
            0,
            1
          )
        : 0;
      const defKnowledgeFlow =
        STREET_FLOW_CONFIG.flowCorrectAnswerBase +
        STREET_FLOW_CONFIG.flowCorrectAnswerSpeedWeight * defSpeedScore;
      this.adjustStreetFlow(def, defKnowledgeFlow);
    }

    if (resolvedOutcome.outcome === 'block') {
      this.players[def].animState = 'block';
      this.players[def].defenseAction = 'jump'; this.players[def].defenseElapsedSec = 0;
      this.players[def].defenseRecoverySec = 0.88;
      const dunkPose = getAirPose(this.players[att]);
      this.players[def].defenseTargetX = dunkPose.x; this.players[def].defenseTargetZ = dunkPose.z;
      this.adjustStreetFlow(
        def,
        this.activeDuel.physicalBlock
          ? STREET_FLOW_CONFIG.flowTimedBlock
          : STREET_FLOW_CONFIG.flowQuestionBlock,
        this.activeDuel.physicalBlock ? 'MONSTER SWAT!' : 'KNOWLEDGE BLOCK!'
      );
      this.adjustStreetFlow(att, -STREET_FLOW_CONFIG.flowTurnoverPenalty);
    } else if (resolvedOutcome.outcome === 'basket') {
      this.players[att].animState = 'celebrate';
      if (this.players[att].onFire) {
        if (this.players[att].correctAnswerStreak > LEARNING_STREAK_CONFIG.correctAnswersToIgnite) {
          this.emitCallout(att, '🔥 SHOWTIME BUCKET!', 1.8);
        }
        this.players[att].streetFlow = STREET_FLOW_CONFIG.onFireAfterMakeFlow;
      } else if (this.activeDuel.releaseSnapshot.comboCount >= 2 && duelSummary.attackerCorrect) {
        this.emitCallout(att, '⚡ BRAIN + BUCKET!', 1.6);
      }
    }

    this.players[att].finishResolutionSec = 0;
    this.phase = 'Resolution';
  }

  private stepResolutionPhase(_realDeltaMs: number, realDeltaSec: number): void {
    if (!this.ballFlight || !this.activeDuel?.resolvedOutcome) {
      return;
    }

    this.ballFlight = stepBallPostResolution(this.ballFlight, realDeltaSec);

    if (
      this.ballFlight.stage === 'recovery' &&
      this.ballFlight.recoveryElapsedSec >= 0.65
    ) {
      this.finalizeAttemptAndEnterFeedback();
    }
  }

  private finalizeAttemptAndEnterFeedback(): void {
    if (!this.activeDuel || !this.activeDuel.resolvedOutcome) {
      return;
    }

    const att = this.scoreState.currentAttacker;
    const def: PlayerSlot = att === 0 ? 1 : 0;
    const outcome = this.activeDuel.resolvedOutcome;
    const q = this.activeDuel.question;
    const correctOpt = q.options.find((o) => o.id === q.correctOptionId);

    const buildRecord = (slot: PlayerSlot) => {
      const ans = this.activeDuel!.answersBySlot[slot];
      const optText = ans
        ? q.options.find((o) => o.id === ans.optionId)?.text ?? null
        : null;
      const status: 'correct' | 'incorrect' | 'unanswered' = !ans
        ? 'unanswered'
        : ans.isCorrect
          ? 'correct'
          : 'incorrect';
      return {
        playerPseudonym: this.players[slot].pseudonym,
        role: (slot === att ? 'attacker' : 'defender') as 'attacker' | 'defender',
        selectedOptionId: ans?.optionId ?? null,
        selectedOptionText: optText,
        status,
        acceptedResponseTimeMs: ans?.acceptedTimeMs ?? null,
      };
    };

    const event: MatchAttemptEvent = Object.freeze({
      matchId: this.matchId,
      possessionIndex: this.possessionIndex,
      duelId: this.activeDuel.duelId,
      questionId: q.id,
      questionVersion: q.version,
      course: q.course,
      week: q.week,
      topic: q.topic,
      stem: q.stem,
      explanation: q.explanation,
      sourceRef: q.sourceRef,
      correctOptionId: q.correctOptionId,
      correctOptionText: correctOpt?.text ?? '',
      attackerSlot: att,
      defenderSlot: def,
      playerRecords: [buildRecord(0), buildRecord(1)] as const,
      shotLocation: { ...outcome.release.shooterPos },
      shotZone: outcome.release.zone,
      blockEligible: outcome.release.blockEligibility.eligible,
      basketballOutcome: outcome.outcome,
      pointsAwarded: outcome.pointsAwarded,
      finalShotProbability: outcome.finalProbability,
    });

    this.attemptEvents.push(event);
    this.possessionIndex += 1;

    // Score update happens ONCE during resolution (Section 19)
    this.scoreState = advancePossessionAfterAttempt(
      this.scoreState,
      this.rules,
      outcome.pointsAwarded
    );

    const headline =
      outcome.outcome === 'block'
        ? (this.activeDuel.physicalBlock ? 'DUNK SWATTED!' : 'SHOT BLOCKED!')
        : outcome.outcome === 'basket'
          ? `${this.players[att].finishKind === 'dunk' ? DUNK_LABELS[this.players[att].dunkStyle] + ' SLAM!' : 'SWISH!'} +${outcome.pointsAwarded} POINTS!`
          : 'RIM MISS — NO SCORE';

    const learningForSlot = (slot: PlayerSlot) => buildStudentQuestionFeedback(
      q, this.activeDuel!.answersBySlot[slot],
      this.players[slot].correctAnswerStreak, this.players[slot].onFire
    );
    this.feedbackState = {
      duelId: this.activeDuel.duelId,
      headline,
      subheadline: outcome.duel.statusBannerText,
      correctOptionId: q.correctOptionId,
      correctOptionText: correctOpt?.text ?? '',
      explanation: q.explanation,
      sourceRef: q.sourceRef,
      topic: q.topic,
      week: q.week,
      outcome: outcome.outcome,
      pointsAwarded: outcome.pointsAwarded,
      finalProbability: outcome.finalProbability,
      remainingRealMs: 0,
      questionStem: q.stem,
      learningBySlot: [learningForSlot(0), learningForSlot(1)],
      continueReady: [this.players[0].isAi, this.players[1].isAi],
    };

    this.players[att].animState = outcome.outcome === 'basket' ? 'celebrate' : 'idle';
    this.players[def].animState = outcome.outcome === 'block' ? 'celebrate' : 'idle';
    this.phase = 'Feedback';
  }

  private tryDefenseAction(slot: PlayerSlot, action: DefenseAction): boolean {
    if (slot === this.scoreState.currentAttacker || (this.phase !== 'Possession' && this.phase !== 'QuestionReady')) return false;
    if (action === 'swipe' && this.phase !== 'Possession') return false;
    const p = this.players[slot], target = this.players[this.scoreState.currentAttacker];
    if (p.defenseRecoverySec > 0 || p.defenseCooldownSec > 0 || p.wrongFootSec > 0 || p.sprintStamina < 0.12) return false;
    if (this.phase === 'QuestionReady' && this.questionReadyTimerMs > DEFENSE_CONFIG.blockWindowEndSec * 1000) return false;
    p.defenseAction = action; p.defenseElapsedSec = 0; p.defenseResult = null;
    p.defenseRecoverySec = action === 'swipe' ? DEFENSE_CONFIG.swipeRecoverySec : DEFENSE_CONFIG.jumpDurationSec;
    p.defenseCooldownSec = action === 'swipe' ? DEFENSE_CONFIG.swipeCooldownSec : DEFENSE_CONFIG.jumpCooldownSec;
    p.defenseTargetX = target.x; p.defenseTargetZ = target.z;
    if (action === 'jump') p.facingAngle = Math.atan2(target.x - p.x, target.z - p.z);
    p.sprintStamina -= 0.12; p.vx = 0; p.vz = 0; p.isSprinting = false;
    return true;
  }

  private checkTimedDunkBlock(): void {
    const duel = this.activeDuel;
    const defSlot: PlayerSlot = this.scoreState.currentAttacker === 0 ? 1 : 0;
    if (!duel || duel.physicalBlock || this.players[this.scoreState.currentAttacker].finishKind !== 'dunk') return;
    const d = this.players[defSlot];
    const time = this.questionReadyTimerMs / 1000;
    // A jump automatically faces the release point; proximity and court-side
    // positioning still matter, without requiring a second aiming input.
    const release = duel.releaseSnapshot;
    const jumpContest = evaluateBlockEligibilityAtRelease({
      shooterPos: release.shooterPos, defenderPos: release.defenderPos,
      defenderFacingAngle: Math.atan2(release.shooterPos.x - release.defenderPos.x, release.shooterPos.z - release.defenderPos.z),
      blockingDisabledByRule: d.wrongFootSec > 0,
    });
    if (jumpContest.eligible && d.defenseAction === 'jump' &&
        d.defenseElapsedSec >= DEFENSE_CONFIG.jumpActiveStartSec && d.defenseElapsedSec <= DEFENSE_CONFIG.jumpActiveEndSec &&
        time >= DEFENSE_CONFIG.blockWindowStartSec && time <= DEFENSE_CONFIG.blockWindowEndSec) {
      duel.physicalBlock = true; d.defenseResult = 'timed-block';
      this.emitCallout(defSlot, '🛡️ TIMED SWAT!', 1.6);
    }
  }

  private completeSteal(def: PlayerSlot): void {
    const oldAtt = this.scoreState.currentAttacker;
    this.handleMovementClockTurnover(true);
    this.feedbackState = null; this.activeDuel = null; this.ballFlight = null;
    this.movementClockRemainingMs = this.rules.movementClockMs;
    this.aiBrain = createAiBasketballBrainState(this.rng);
    this.players[oldAtt].wrongFootSec = 0.30;
    this.players[oldAtt].streetMove = null;
    this.players[oldAtt].trickCombo = 0;
    this.players[oldAtt].comboGraceSec = 0;
    this.players[oldAtt].trickOverexposedSec = 0;
    this.players[def].defenseRecoverySec = 0.22;
    this.adjustStreetFlow(def, STREET_FLOW_CONFIG.flowCleanSteal, '🖐️ COOKIE SNATCH!');
    this.adjustStreetFlow(oldAtt, -STREET_FLOW_CONFIG.flowTurnoverPenalty);
    for (const p of this.players) {
      p.finishKind = null; p.vx = 0; p.vz = 0;
      p.dribbleHand = 1; p.dribbleSide = undefined; p.moveStartSide = undefined; p.dribbleBlend = undefined;
      p.handSwitchCooldownSec = 0; p.plantSec = 0;
    }
    this.phase = this.scoreState.isMatchOver ? 'MatchEnd' : 'Possession';
  }

  private handleMovementClockTurnover(stolen = false): void {
    const att = this.scoreState.currentAttacker;
    const def: PlayerSlot = att === 0 ? 1 : 0;

    const event: MatchAttemptEvent = Object.freeze({
      matchId: this.matchId,
      possessionIndex: this.possessionIndex,
      duelId: `${this.matchId}-turnover-${this.possessionIndex + 1}`,
      questionId: '',
      questionVersion: 0,
      course: '',
      week: 0,
      topic: stolen ? 'Steal' : 'Shot Clock Violation',
      stem: '',
      explanation:
        stolen ? 'A clean swipe ends the attacking possession without affecting learning accuracy.' : 'A missed 15-second movement deadline counts as an empty possession.',
      sourceRef: 'CourtIQ Match Rules',
      correctOptionId: '',
      correctOptionText: '',
      attackerSlot: att,
      defenderSlot: def,
      playerRecords: [
        {
          playerPseudonym: this.players[0].pseudonym,
          role: (att === 0 ? 'attacker' : 'defender') as 'attacker' | 'defender',
          selectedOptionId: null,
          selectedOptionText: null,
          status: 'unanswered' as const,
          acceptedResponseTimeMs: null,
        },
        {
          playerPseudonym: this.players[1].pseudonym,
          role: (att === 1 ? 'attacker' : 'defender') as 'attacker' | 'defender',
          selectedOptionId: null,
          selectedOptionText: null,
          status: 'unanswered' as const,
          acceptedResponseTimeMs: null,
        },
      ] as const,
      shotLocation: null,
      shotZone: 'turnover',
      blockEligible: false,
      basketballOutcome: stolen ? 'steal-turnover' : 'shot-clock-turnover',
      pointsAwarded: 0,
      finalShotProbability: 0,
    });

    this.attemptEvents.push(event);
    this.possessionIndex += 1;

    this.scoreState = advancePossessionAfterAttempt(
      this.scoreState,
      this.rules,
      0
    );

    this.feedbackState = {
      duelId: event.duelId,
      headline: '15s MOVEMENT CLOCK EXPIRED',
      subheadline: 'Empty possession — ball turns over!',
      correctOptionId: '',
      correctOptionText: 'Release your shot before the 15s movement clock expires.',
      explanation:
        'Each possession provides 15 seconds of movement time to create space and release a shot.',
      sourceRef: 'CourtIQ Match Rules',
      topic: 'Movement Clock',
      week: 0,
      outcome: 'shot-clock-turnover',
      pointsAwarded: 0,
      finalProbability: 0,
      remainingRealMs: 2200,
    };

    this.phase = 'Feedback';
  }

  private stepFeedbackPhase(realDeltaMs: number): void {
    if (!this.feedbackState) {
      return;
    }
    // Learning explanations stay visible until both students are ready.
    // Non-question turnovers retain their brief automatic transition.
    if (this.feedbackState.learningBySlot) return;
    this.feedbackState.remainingRealMs = Math.max(
      0,
      this.feedbackState.remainingRealMs - realDeltaMs
    );
    if (this.feedbackState.remainingRealMs <= 0) {
      this.advanceFromFeedback();
    }
  }

  public acknowledgeFeedback(slot: PlayerSlot, duelId: string): void {
    if (this.phase !== 'Feedback' || !this.feedbackState || this.feedbackState.duelId !== duelId) return;
    if (!this.feedbackState.continueReady) { this.advanceFromFeedback(); return; }
    this.feedbackState.continueReady[slot] = true;
    if (this.feedbackState.continueReady.every(Boolean)) this.advanceFromFeedback();
  }

  public advanceFromFeedback(): void {
    if (this.phase !== 'Feedback') {
      return;
    }
    if (this.scoreState.isMatchOver) {
      this.phase = 'MatchEnd';
      return;
    }
    this.setupPossessionPositions();
    this.phase = 'Possession';
  }

  public getBallPosition3D(): Vector3D {
    const finisher = this.players[this.scoreState.currentAttacker];
    if (finisher.finishKind === 'dunk' && (this.phase === 'QuestionReady' || this.phase === 'Duel' || this.phase === 'Resolution')) {
      const pose = getAirPose(finisher);
      const r = finisher.finishResolutionSec;
      const outcome = this.activeDuel?.resolvedOutcome?.outcome;
      if (r < 0.30) {
        return dunkBallPosition(finisher, pose);
      }
      return dunkReboundPosition(finisher, pose, outcome);
    }
    if (this.ballFlight) {
      const flightPos = evaluateBallPosition(this.ballFlight);
      if (finisher.finishKind === 'jump' && this.phase === 'QuestionReady') {
        return jumpShotGatherBallPosition(finisher, flightPos);
      }
      return flightPos;
    }
    const att = this.scoreState.currentAttacker;
    const p = this.players[att];
    return dribbleBallPosition(p,(this.rules.movementClockMs-this.movementClockRemainingMs)/1000);
  }

  public getLearningSummaries(): [PlayerLearningSummary, PlayerLearningSummary] {
    return [
      buildPlayerLearningSummary(
        0,
        this.players[0].pseudonym,
        this.scoreState.scores[0],
        this.attemptEvents
      ),
      buildPlayerLearningSummary(
        1,
        this.players[1].pseudonym,
        this.scoreState.scores[1],
        this.attemptEvents
      ),
    ];
  }
}
