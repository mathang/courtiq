import { dribbleBallPosition } from './dribble';
import { DefenseAction, DEFENSE_CONFIG, canStealBall, isDefenseAction } from './defense';
import { DunkStyle, DUNK_STYLES, DUNK_TAKEOFF_SEC, DUNK_RANGE_M, DUNK_LABELS, isDunkStyle, dunkBallPosition, dunkReboundPosition } from './dunks';
import { getAirPose, isStreetMove, STREET_MOVES, StreetMove } from './streetMoves';
import {
  AiDifficultyId,
  COURT_GEOMETRY,
  MOVEMENT_CONFIG,
  ROOM_PRESETS,
  RoomPresetId,
  SESSION_LENGTH_PRESETS,
  SessionLengthId,
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
        appearancePreset: options.player0.appearancePreset ?? 0,
        streetMove: null, moveElapsedSec: 0, moveCooldownSec: 0, moveSide: 1,
        moveForwardX: 0, moveForwardZ: -1, wrongFootSec: 0,
        finishKind: null, finishElapsedSec: 0, finishResolutionSec: -1,
        dunkStyle: 'tomahawk', dunkBallStart: null, finishOutcome: null,
        defenseAction: null, defenseElapsedSec: 0, defenseRecoverySec: 0, defenseCooldownSec: 0,
        defenseResult: null, defenseTargetX: 0, defenseTargetZ: 0,
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
        appearancePreset: options.player1.appearancePreset ?? 1,
        streetMove: null, moveElapsedSec: 0, moveCooldownSec: 0, moveSide: 1,
        moveForwardX: 0, moveForwardZ: -1, wrongFootSec: 0,
        finishKind: null, finishElapsedSec: 0, finishResolutionSec: -1,
        dunkStyle: 'tomahawk', dunkBallStart: null, finishOutcome: null,
        defenseAction: null, defenseElapsedSec: 0, defenseRecoverySec: 0, defenseCooldownSec: 0,
        defenseResult: null, defenseTargetX: 0, defenseTargetZ: 0,
      },
    ];
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

    if (effectiveInputs[def].defense || effectiveInputs[def].shoot) {
      const action = effectiveInputs[def].defense ?? 'jump';
      if (isDefenseAction(action)) this.tryDefenseAction(def, action);
    }
    // Update both players' movement
    for (const slot of [0, 1] as const) {
      const p = this.players[slot];
      const inp = effectiveInputs[slot];
      const isAttacker = slot === att;

      p.moveCooldownSec = Math.max(0, p.moveCooldownSec - deltaSec);
      p.wrongFootSec = Math.max(0, p.wrongFootSec - deltaSec);
      if (p.streetMove) {
        p.moveElapsedSec += deltaSec;
        if (p.moveElapsedSec >= STREET_MOVES[p.streetMove].duration) p.streetMove = null;
      }
      if (isAttacker && isStreetMove(inp.trick) && !p.streetMove && p.moveCooldownSec <= 0 &&
          p.sprintStamina >= STREET_MOVES[inp.trick].cost) {
        p.streetMove = inp.trick; p.moveElapsedSec = 0; p.moveCooldownSec = 0.95;
        p.sprintStamina -= STREET_MOVES[inp.trick].cost;
        const dx = COURT_GEOMETRY.hoopX - p.x, dz = COURT_GEOMETRY.hoopZ - p.z;
        const d = Math.hypot(dx, dz) || 1;
        p.moveForwardX = dx / d; p.moveForwardZ = dz / d;
        const lateral = inp.moveX * -p.moveForwardZ + inp.moveZ * p.moveForwardX;
        p.moveSide = Math.abs(lateral) > 0.1 ? Math.sign(lateral) : -p.moveSide;
        const opponent = this.players[def];
        // A well-timed move beats a nearby planted defender, once per cooldown.
        if (computeDistance2D(p, opponent) < 2.5 && opponent.wrongFootSec <= 0) {
          opponent.wrongFootSec = inp.trick === 'spin' ? 0.42 : 0.32;
        }
      }
      const safeX = Number.isFinite(inp.moveX) ? inp.moveX : 0;
      const safeZ = Number.isFinite(inp.moveZ) ? inp.moveZ : 0;
      const mag = Math.hypot(safeX, safeZ);
      const normX = mag > 1 ? safeX / mag : safeX;
      const normZ = mag > 1 ? safeZ / mag : safeZ;
      const isMoving = mag > 0.06;

      const canSprint =
        inp.sprint &&
        isMoving &&
        (p.isSprinting
          ? p.sprintStamina > 0.02
          : p.sprintStamina >= MOVEMENT_CONFIG.minStaminaToStartSprint);

      if (canSprint) {
        p.isSprinting = true;
        p.sprintStamina = clamp(
          p.sprintStamina - MOVEMENT_CONFIG.sprintDrainPerSec * deltaSec,
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
      const speed =
        baseSpeed * (p.isSprinting ? MOVEMENT_CONFIG.sprintMultiplier : 1);

      let targetX = normX * speed, targetZ = normZ * speed;
      if (p.streetMove) {
        const move = STREET_MOVES[p.streetMove];
        const u = p.moveElapsedSec / move.duration;
        const forward = p.streetMove === 'stepback' ? -1 : p.streetMove === 'crossover' ? 0.35 : 0.82;
        const side = p.streetMove === 'stepback' ? 0 : p.moveSide * (p.streetMove === 'eurostep' && u > 0.48 ? -0.72 : 0.72);
        const len = Math.hypot(forward, side);
        targetX = (p.moveForwardX * forward - p.moveForwardZ * side) / len * move.speed;
        targetZ = (p.moveForwardZ * forward + p.moveForwardX * side) / len * move.speed;
      }
      if (p.wrongFootSec > 0 || p.defenseRecoverySec > 0) { targetX = 0; targetZ = 0; }
      if (p.defenseRecoverySec > 0) { p.vx = 0; p.vz = 0; }
      const blend = 1 - Math.exp(-(isMoving || p.streetMove ? MOVEMENT_CONFIG.acceleration : MOVEMENT_CONFIG.braking) * deltaSec);
      p.vx += (targetX - p.vx) * blend;
      p.vz += (targetZ - p.vz) * blend;
      p.x = clamp(
        p.x + p.vx * deltaSec,
        COURT_GEOMETRY.minX,
        COURT_GEOMETRY.maxX
      );
      p.z = clamp(
        p.z + p.vz * deltaSec,
        COURT_GEOMETRY.minZ,
        COURT_GEOMETRY.maxZ
      );

      if (p.defenseRecoverySec > 0) {
        p.animState = p.defenseAction === 'jump' ? 'block' : 'idle';
      } else if (isMoving || p.streetMove) {
        const facing = p.streetMove ? Math.atan2(p.moveForwardX, p.moveForwardZ) : Math.atan2(normX, normZ);
        const turn = Math.atan2(Math.sin(facing - p.facingAngle), Math.cos(facing - p.facingAngle));
        p.facingAngle += turn * (1 - Math.exp(-18 * deltaSec));
        p.animState = isAttacker ? 'dribble' : 'run';
      } else {
        // Defender naturally faces attacker when stationary; attacker faces hoop
        if (!isAttacker) {
          const other = this.players[att];
          p.facingAngle = Math.atan2(other.x - p.x, other.z - p.z);
        } else {
          p.facingAngle = Math.atan2(
            COURT_GEOMETRY.hoopX - p.x,
            COURT_GEOMETRY.hoopZ - p.z
          );
        }
        p.animState = 'idle';
      }
    }

    // Simple player-to-player collision separation
    const p0 = this.players[0];
    const p1 = this.players[1];
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const dist = Math.hypot(dx, dz);
    if (dist < MOVEMENT_CONFIG.minPlayerSeparationM && dist > 1e-5) {
      const overlap = MOVEMENT_CONFIG.minPlayerSeparationM - dist;
      const nx = dx / dist, nz = dz / dist;
      const frozen0 = p0.defenseRecoverySec > 0, frozen1 = p1.defenseRecoverySec > 0;
      const weight0 = frozen0 ? 0 : frozen1 ? 1 : 0.5;
      const weight1 = frozen1 ? 0 : frozen0 ? 1 : 0.5;
      p0.x = clamp(p0.x - nx * overlap * weight0, COURT_GEOMETRY.minX, COURT_GEOMETRY.maxX);
      p0.z = clamp(p0.z - nz * overlap * weight0, COURT_GEOMETRY.minZ, COURT_GEOMETRY.maxZ);
      p1.x = clamp(p1.x + nx * overlap * weight1, COURT_GEOMETRY.minX, COURT_GEOMETRY.maxX);
      p1.z = clamp(p1.z + nz * overlap * weight1, COURT_GEOMETRY.minZ, COURT_GEOMETRY.maxZ);
    }

    const defender = this.players[def];
    if (defender.defenseAction === 'swipe' && defender.defenseResult === null &&
        defender.defenseElapsedSec >= DEFENSE_CONFIG.swipeContactSec) {
      if (canStealBall(defender, this.players[att], this.getBallPosition3D())) {
        defender.defenseResult = 'steal'; this.completeSteal(def); return;
      }
      defender.defenseResult = 'miss';
    }
    // Defense resolves before a same-tick shot; only the authoritative attacker may shoot.
    if ((effectiveInputs[att].shoot || effectiveInputs[att].dunk) && this.players[att].defenseRecoverySec <= 0) {
      this.initiateShotAttempt(effectiveInputs[att]);
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
    const distance = Math.hypot(COURT_GEOMETRY.hoopX - attacker.x, COURT_GEOMETRY.hoopZ - attacker.z);
    attacker.finishKind = distance <= DUNK_RANGE_M && (input?.dunk || attacker.isSprinting || attacker.streetMove === 'eurostep' || distance <= 1.8) ? 'dunk' : 'jump';
    attacker.dunkStyle = isDunkStyle(input?.dunkStyle) ? input.dunkStyle : DUNK_STYLES[this.possessionIndex % DUNK_STYLES.length];
    attacker.dunkBallStart = ballAtGather;
    attacker.finishElapsedSec = 0; attacker.finishResolutionSec = -1; attacker.finishOutcome = null;
    attacker.streetMove = null;
    defender.animState = 'idle';

    // Freeze block eligibility at release (Section 8)
    const blockEligibility = evaluateBlockEligibilityAtRelease({
      shooterPos: { x: attacker.x, z: attacker.z },
      defenderPos: { x: defender.x, z: defender.z },
      defenderFacingAngle: defender.facingAngle,
      blockingDisabledByRule: defender.defenseAction === 'swipe' || defender.wrongFootSec > 0,
    });

    const releasedWhileSprinting =
      attacker.isSprinting || attacker.sprintSettleRemainingMs > 0;

    const releaseSnapshot = captureShotReleaseSnapshot({
      shooterPos: { x: attacker.x, z: attacker.z },
      defenderPos: { x: defender.x, z: defender.z },
      releasedWhileSprinting,
      blockEligibility,
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
    if (this.ballFlight) {
      this.ballFlight = stepBallPreResolution(this.ballFlight, realDeltaSec);
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
    const resolvedOutcome = resolveAuthoritativeShot({
      release: this.activeDuel.releaseSnapshot,
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

    if (resolvedOutcome.outcome === 'block') {
      this.players[def].animState = 'block';
      this.players[def].defenseAction = 'jump'; this.players[def].defenseElapsedSec = 0;
      this.players[def].defenseRecoverySec = 0.88;
      const dunkPose = getAirPose(this.players[att]);
      this.players[def].defenseTargetX = dunkPose.x; this.players[def].defenseTargetZ = dunkPose.z;
    } else if (resolvedOutcome.outcome === 'basket') {
      this.players[att].animState = 'celebrate';
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

    const roomPreset = ROOM_PRESETS[this.roomPresetId];
    const headline =
      outcome.outcome === 'block'
        ? (this.activeDuel.physicalBlock ? 'DUNK SWATTED!' : 'SHOT BLOCKED!')
        : outcome.outcome === 'basket'
          ? `${this.players[att].finishKind === 'dunk' ? DUNK_LABELS[this.players[att].dunkStyle] + ' SLAM!' : 'SWISH!'} +${outcome.pointsAwarded} POINTS!`
          : 'RIM MISS — NO SCORE';

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
      remainingRealMs: roomPreset.explanationMs,
    };

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
    p.sprintStamina -= 0.12; p.vx = 0; p.vz = 0; p.isSprinting = false;
    return true;
  }

  private checkTimedDunkBlock(): void {
    const duel = this.activeDuel;
    if (!duel || duel.physicalBlock || this.players[this.scoreState.currentAttacker].finishKind !== 'dunk') return;
    const d = this.players[this.scoreState.currentAttacker === 0 ? 1 : 0];
    const time = this.questionReadyTimerMs / 1000;
    if (duel.releaseSnapshot.blockEligibility.eligible && d.defenseAction === 'jump' &&
        d.defenseElapsedSec >= 0.10 && d.defenseElapsedSec <= 0.60 &&
        time >= DEFENSE_CONFIG.blockWindowStartSec && time <= DEFENSE_CONFIG.blockWindowEndSec) {
      duel.physicalBlock = true; d.defenseResult = 'timed-block';
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
    this.players[def].defenseRecoverySec = 0.22;
    for (const p of this.players) { p.finishKind = null; p.vx = 0; p.vz = 0; }
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
    this.feedbackState.remainingRealMs = Math.max(
      0,
      this.feedbackState.remainingRealMs - realDeltaMs
    );
    if (this.feedbackState.remainingRealMs <= 0) {
      this.advanceFromFeedback();
    }
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
      return evaluateBallPosition(this.ballFlight);
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
