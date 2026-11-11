import {
  COURT_GEOMETRY,
  SHOT_BALANCE_CONFIG,
  LEARNING_STREAK_CONFIG,
  ShotZone,
} from '../config/balance';
import { BlockEligibilitySnapshot, CourtPoint2D, computeDistance2D } from './block';
import { clamp, DuelResolutionSummary } from './timing';

export interface ShotReleaseSnapshot {
  readonly shooterPos: CourtPoint2D;
  readonly defenderPos: CourtPoint2D;
  readonly distanceToHoopM: number;
  readonly zone: ShotZone;
  readonly pointValue: 2 | 3;
  readonly heavilyContested: boolean;
  readonly releasedWhileSprinting: boolean;
  readonly baseProbability: number;
  readonly setupBonus: number;
  readonly comboCount: number;
  readonly onFire: boolean;
  readonly blockEligibility: BlockEligibilitySnapshot;
}

export type ShotOutcomeKind = 'basket' | 'miss' | 'block';

export interface ResolvedShotOutcome {
  readonly outcome: ShotOutcomeKind;
  readonly pointsAwarded: 0 | 2 | 3;
  readonly finalProbability: number;
  readonly baseProbability: number;
  readonly accuracyBonus: number;
  readonly randomDraw: number;
  readonly release: ShotReleaseSnapshot;
  readonly duel: DuelResolutionSummary;
}

export function classifyShotZone(distanceToHoopM: number): {
  zone: ShotZone;
  pointValue: 2 | 3;
} {
  if (distanceToHoopM >= COURT_GEOMETRY.threePointRadiusM) {
    return { zone: 'three-pointer', pointValue: 3 };
  }
  if (distanceToHoopM <= COURT_GEOMETRY.closeRangeMaxM) {
    return { zone: 'close', pointValue: 2 };
  }
  return { zone: 'mid-range', pointValue: 2 };
}

/**
 * Computes base shooting probability B from court position, defensive contest, and sprint state.
 */
export function computeBaseShotProbability(params: {
  zone: ShotZone;
  heavilyContested: boolean;
  releasedWhileSprinting: boolean;
  setupBonus?: number;
  onFire?: boolean;
}): number {
  let base = SHOT_BALANCE_CONFIG.baseProbabilities[params.zone];
  if (params.heavilyContested) {
    base -= SHOT_BALANCE_CONFIG.heavilyContestedPenalty;
  }
  if (params.releasedWhileSprinting) {
    base -= SHOT_BALANCE_CONFIG.sprintingPenalty;
  }
  if (params.setupBonus && Number.isFinite(params.setupBonus)) {
    // Bounded setup bonus (max +0.08) rewards trick separation & Street Flow without guaranteeing scores
    base += clamp(params.setupBonus, 0, 0.08);
  }
  const normalBase = clamp(Number(base.toFixed(4)), 0.01, 0.42);
  return Number((normalBase + (params.onFire ? LEARNING_STREAK_CONFIG.shootingBonus : 0)).toFixed(4));
}

/**
 * Captures the immutable shot release snapshot at the instant the ball leaves the shooter's hands.
 */
export function captureShotReleaseSnapshot(params: {
  shooterPos: CourtPoint2D;
  defenderPos: CourtPoint2D;
  releasedWhileSprinting: boolean;
  blockEligibility: BlockEligibilitySnapshot;
  setupBonus?: number;
  comboCount?: number;
  onFire?: boolean;
}): ShotReleaseSnapshot {
  const distanceToHoopM = computeDistance2D(params.shooterPos, {
    x: COURT_GEOMETRY.hoopX,
    z: COURT_GEOMETRY.hoopZ,
  });
  const { zone, pointValue } = classifyShotZone(distanceToHoopM);
  const heavilyContested =
    params.blockEligibility.withinRange && params.blockEligibility.facingShooter;
  const setupBonus = clamp(params.setupBonus ?? 0, 0, 0.08);
  const baseProbability = computeBaseShotProbability({
    zone,
    heavilyContested,
    releasedWhileSprinting: params.releasedWhileSprinting,
    setupBonus,
    onFire: params.onFire,
  });

  return Object.freeze({
    shooterPos: { ...params.shooterPos },
    defenderPos: { ...params.defenderPos },
    distanceToHoopM,
    zone,
    pointValue,
    heavilyContested,
    releasedWhileSprinting: params.releasedWhileSprinting,
    baseProbability,
    setupBonus: Number(setupBonus.toFixed(4)),
    comboCount: params.comboCount ?? 0,
    onFire: Boolean(params.onFire),
    blockEligibility: params.blockEligibility,
  });
}

/**
 * Pure shot probability function from Section 7 of the specification:
 * P(basket) = clamp(B + C * (correctBaseBonus + speedBonusWeight * S), 0.03, 0.95)
 */
export function computeShotBasketProbability(params: {
  baseProbability: number;
  attackerCorrect: boolean;
  speedScore: number;
  correctBaseBonus?: number;
  speedBonusWeight?: number;
}): { finalProbability: number; accuracyBonus: number } {
  const C = params.attackerCorrect ? 1 : 0;
  const S = clamp(params.speedScore, 0, 1);
  const baseBonus = params.correctBaseBonus ?? SHOT_BALANCE_CONFIG.correctBaseBonus;
  const speedWeight = params.speedBonusWeight ?? SHOT_BALANCE_CONFIG.speedBonusWeight;

  const accuracyBonus = C * (baseBonus + speedWeight * S);
  const finalProbability = clamp(
    params.baseProbability + accuracyBonus,
    SHOT_BALANCE_CONFIG.minProbability,
    SHOT_BALANCE_CONFIG.maxProbability
  );

  return {
    finalProbability: Number(finalProbability.toFixed(4)),
    accuracyBonus: Number(accuracyBonus.toFixed(4)),
  };
}

/**
 * Resolves the authoritative basketball outcome once after the question duel completes.
 * A valid block overrides the probability calculation.
 */
export function resolveAuthoritativeShot(params: {
  release: ShotReleaseSnapshot;
  duel: DuelResolutionSummary;
  randomDraw: number;
  correctBaseBonus?: number;
  speedBonusWeight?: number;
}): ResolvedShotOutcome {
  if (params.duel.shotBlocked) {
    return Object.freeze({
      outcome: 'block',
      pointsAwarded: 0,
      finalProbability: 0,
      baseProbability: params.release.baseProbability,
      accuracyBonus: 0,
      randomDraw: params.randomDraw,
      release: params.release,
      duel: params.duel,
    });
  }

  const { finalProbability, accuracyBonus } = computeShotBasketProbability({
    baseProbability: params.release.baseProbability,
    attackerCorrect: params.duel.attackerCorrect,
    speedScore: params.duel.attackerSpeedScore,
    correctBaseBonus: params.correctBaseBonus,
    speedBonusWeight: params.speedBonusWeight,
  });

  const isBasket = params.randomDraw < finalProbability;

  return Object.freeze({
    outcome: isBasket ? 'basket' : 'miss',
    pointsAwarded: isBasket ? params.release.pointValue : 0,
    finalProbability,
    baseProbability: params.release.baseProbability,
    accuracyBonus,
    randomDraw: params.randomDraw,
    release: params.release,
    duel: params.duel,
  });
}

// ============================================================================
// Pure 4-Stage Slow-Motion Ball Trajectory Evaluator (Section 9)
// ============================================================================

export type BallFlightStage = 'release' | 'question' | 'resolution' | 'recovery';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface BallFlightState {
  stage: BallFlightStage;
  startPos: Vector3D;
  hoopPos: Vector3D;
  apexPos: Vector3D;
  defenderPos: Vector3D;
  /** Progress along initial pre-resolution curve in [0, 0.58] */
  preResolutionProgress: number;
  /** Locked 3D ball position when transitioning into resolution */
  resolutionStartPos: Vector3D | null;
  /** Locked 3D ball tangent/velocity direction when transitioning into resolution */
  resolutionStartTangent: Vector3D | null;
  outcome: ShotOutcomeKind | null;
  /** Elapsed time inside the resolution stage (seconds) */
  resolutionElapsedSec: number;
  /** Elapsed time inside the recovery stage (seconds) */
  recoveryElapsedSec: number;
  /** Total rotation angle in radians for visual backspin */
  spinAngleRad: number;
}

export function createInitialBallFlightState(params: {
  shooterPos: CourtPoint2D;
  defenderPos: CourtPoint2D;
}): BallFlightState {
  const startPos: Vector3D = {
    x: params.shooterPos.x,
    y: 2.15, // Release above shooter's head
    z: params.shooterPos.z,
  };
  const hoopPos: Vector3D = {
    x: COURT_GEOMETRY.hoopX,
    y: COURT_GEOMETRY.hoopY,
    z: COURT_GEOMETRY.hoopZ,
  };
  const dist = computeDistance2D(params.shooterPos, {
    x: COURT_GEOMETRY.hoopX,
    z: COURT_GEOMETRY.hoopZ,
  });
  const apexHeight = Math.max(4.4, 3.6 + dist * 0.28);
  const apexPos: Vector3D = {
    x: startPos.x * 0.45 + hoopPos.x * 0.55,
    y: apexHeight,
    z: startPos.z * 0.45 + hoopPos.z * 0.55,
  };

  return {
    stage: 'release',
    startPos,
    hoopPos,
    apexPos,
    defenderPos: {
      x: params.defenderPos.x,
      y: 2.35,
      z: params.defenderPos.z,
    },
    preResolutionProgress: 0,
    resolutionStartPos: null,
    resolutionStartTangent: null,
    outcome: null,
    resolutionElapsedSec: 0,
    recoveryElapsedSec: 0,
    spinAngleRad: 0,
  };
}

function evalQuadraticBezier(p0: Vector3D, p1: Vector3D, p2: Vector3D, t: number): Vector3D {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    z: u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
  };
}

function evalQuadraticBezierTangent(
  p0: Vector3D,
  p1: Vector3D,
  p2: Vector3D,
  t: number
): Vector3D {
  const u = 1 - t;
  return {
    x: 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
    y: 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
    z: 2 * u * (p1.z - p0.z) + 2 * t * (p2.z - p1.z),
  };
}

function evalCubicBezier(
  p0: Vector3D,
  p1: Vector3D,
  p2: Vector3D,
  p3: Vector3D,
  t: number
): Vector3D {
  const u = 1 - t;
  const u2 = u * u;
  const u3 = u2 * u;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: u3 * p0.x + 3 * u2 * t * p1.x + 3 * u * t2 * p2.x + t3 * p3.x,
    y: u3 * p0.y + 3 * u2 * t * p1.y + 3 * u * t2 * p2.y + t3 * p3.y,
    z: u3 * p0.z + 3 * u2 * t * p1.z + 3 * u * t2 * p2.z + t3 * p3.z,
  };
}

/**
 * Evaluates the current 3D position of the ball for any flight state.
 * Guarantees continuous transitions between Release -> Question -> Resolution -> Recovery.
 */
export function evaluateBallPosition(state: BallFlightState): Vector3D {
  const controlPt: Vector3D = {
    x: state.apexPos.x,
    y: state.apexPos.y + 1.25,
    z: state.apexPos.z,
  };

  if (state.stage === 'release' || state.stage === 'question') {
    const u = clamp(state.preResolutionProgress, 0, 0.58);
    return evalQuadraticBezier(state.startPos, controlPt, state.hoopPos, u);
  }

  const p0 =
    state.resolutionStartPos ??
    evalQuadraticBezier(
      state.startPos,
      controlPt,
      state.hoopPos,
      clamp(state.preResolutionProgress, 0, 0.58)
    );
  const tangent =
    state.resolutionStartTangent ??
    evalQuadraticBezierTangent(
      state.startPos,
      controlPt,
      state.hoopPos,
      clamp(state.preResolutionProgress, 0, 0.58)
    );

  const outcome = state.outcome ?? 'miss';
  const durationSec = outcome === 'block' ? 0.75 : 1.05;
  const t = clamp(state.resolutionElapsedSec / durationSec, 0, 1);

  if (outcome === 'basket') {
    const p1: Vector3D = {
      x: p0.x + tangent.x * 0.25,
      y: Math.max(p0.y + 0.35, state.hoopPos.y + 1.15),
      z: p0.z + tangent.z * 0.25,
    };
    const p2: Vector3D = {
      x: state.hoopPos.x,
      y: state.hoopPos.y + 0.9,
      z: state.hoopPos.z + 0.05,
    };
    const p3: Vector3D = {
      x: state.hoopPos.x,
      y: state.hoopPos.y - 0.15,
      z: state.hoopPos.z,
    };
    const pos = evalCubicBezier(p0, p1, p2, p3, t);
    if (state.stage === 'recovery') {
      const recT = clamp(state.recoveryElapsedSec / 0.85, 0, 1);
      const dropY = Math.max(0.24, p3.y - recT * recT * 2.9 + Math.sin(recT * Math.PI * 2) * 0.18);
      return {
        x: p3.x,
        y: dropY,
        z: p3.z + recT * 0.35,
      };
    }
    return pos;
  }

  if (outcome === 'miss') {
    const missSide = state.startPos.x >= 0 ? 0.26 : -0.26;
    const rimHit: Vector3D = {
      x: state.hoopPos.x + missSide,
      y: state.hoopPos.y + 0.06,
      z: state.hoopPos.z + 0.21,
    };
    const p1: Vector3D = {
      x: p0.x + tangent.x * 0.25,
      y: Math.max(p0.y + 0.25, state.hoopPos.y + 0.95),
      z: p0.z + tangent.z * 0.25,
    };
    const p2: Vector3D = {
      x: rimHit.x * 0.8,
      y: state.hoopPos.y + 0.75,
      z: rimHit.z + 0.15,
    };
    const pos = evalCubicBezier(p0, p1, p2, rimHit, t);
    if (state.stage === 'recovery') {
      const recT = clamp(state.recoveryElapsedSec / 0.85, 0, 1);
      const caromX = rimHit.x + (missSide > 0 ? 1.45 : -1.45) * recT;
      const caromZ = rimHit.z + 1.35 * recT;
      const caromY = Math.max(
        0.24,
        rimHit.y + Math.sin(recT * Math.PI) * 0.85 - recT * recT * 3.1
      );
      return { x: caromX, y: caromY, z: caromZ };
    }
    return pos;
  }

  // Block outcome: defender intercepts near current path and swats ball away from hoop
  const swatDirX = state.startPos.x >= 0 ? 1.8 : -1.8;
  const p1: Vector3D = {
    x: p0.x + swatDirX * 0.25,
    y: Math.max(1.6, p0.y - 0.35),
    z: p0.z + 0.65,
  };
  const p2: Vector3D = {
    x: p0.x + swatDirX * 0.65,
    y: 1.05,
    z: p0.z + 1.45,
  };
  const p3: Vector3D = {
    x: clamp(p0.x + swatDirX, COURT_GEOMETRY.minX + 0.5, COURT_GEOMETRY.maxX - 0.5),
    y: 0.24,
    z: clamp(p0.z + 2.1, COURT_GEOMETRY.minZ + 0.5, COURT_GEOMETRY.maxZ - 0.5),
  };
  const pos = evalCubicBezier(p0, p1, p2, p3, t);
  if (state.stage === 'recovery') {
    const recT = clamp(state.recoveryElapsedSec / 0.85, 0, 1);
    return {
      x: clamp(p3.x + swatDirX * 0.25 * recT, COURT_GEOMETRY.minX + 0.4, COURT_GEOMETRY.maxX - 0.4),
      y: 0.24 + Math.abs(Math.sin(recT * Math.PI * 2)) * 0.28 * (1 - recT),
      z: clamp(p3.z + 0.5 * recT, COURT_GEOMETRY.minZ + 0.4, COURT_GEOMETRY.maxZ - 0.4),
    };
  }
  return pos;
}

/**
 * Advances the pre-resolution ball flight (Release & Question stages).
 * Guarantees that preResolutionProgress asymptotically approaches 0.56 so the ball
 * stays suspended near its apex and NEVER reaches the rim before the question resolves.
 */
export function stepBallPreResolution(
  state: BallFlightState,
  realDeltaSec: number
): BallFlightState {
  const next = { ...state };
  if (next.stage === 'release') {
    // Release stage covers u from 0 -> 0.24 in ~0.35s real time
    next.preResolutionProgress = Math.min(0.24, next.preResolutionProgress + realDeltaSec * 0.68);
    next.spinAngleRad += realDeltaSec * 14;
    if (next.preResolutionProgress >= 0.24) {
      next.stage = 'question';
    }
    return next;
  }

  if (next.stage === 'question') {
    // Asymptotically approach 0.56 with gentle slow-motion drift so even a 60s window never hits the rim
    const remaining = 0.56 - next.preResolutionProgress;
    next.preResolutionProgress += remaining * (1 - Math.exp(-realDeltaSec * 0.14));
    next.spinAngleRad += realDeltaSec * 2.2;
  }
  return next;
}

/**
 * Transitions the ball smoothly from Question stage into Resolution stage
 * while locking exact current position and tangent to guarantee zero teleportation.
 */
export function transitionBallToResolution(
  state: BallFlightState,
  outcome: ShotOutcomeKind
): BallFlightState {
  const controlPt: Vector3D = {
    x: state.apexPos.x,
    y: state.apexPos.y + 1.25,
    z: state.apexPos.z,
  };
  const u = clamp(state.preResolutionProgress, 0, 0.58);
  const currentPos = evalQuadraticBezier(state.startPos, controlPt, state.hoopPos, u);
  const currentTangent = evalQuadraticBezierTangent(state.startPos, controlPt, state.hoopPos, u);

  return {
    ...state,
    stage: 'resolution',
    outcome,
    resolutionStartPos: currentPos,
    resolutionStartTangent: currentTangent,
    resolutionElapsedSec: 0,
    recoveryElapsedSec: 0,
  };
}

export function stepBallPostResolution(
  state: BallFlightState,
  realDeltaSec: number
): BallFlightState {
  const next = { ...state };
  const outcome = next.outcome ?? 'miss';
  const durationSec = outcome === 'block' ? 0.75 : 1.05;

  if (next.stage === 'resolution') {
    next.resolutionElapsedSec += realDeltaSec;
    next.spinAngleRad += realDeltaSec * 12;
    if (next.resolutionElapsedSec >= durationSec) {
      next.resolutionElapsedSec = durationSec;
      next.stage = 'recovery';
    }
    return next;
  }

  if (next.stage === 'recovery') {
    next.recoveryElapsedSec += realDeltaSec;
    next.spinAngleRad += realDeltaSec * 4;
  }
  return next;
}
