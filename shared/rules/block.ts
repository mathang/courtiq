import { BLOCK_BALANCE_CONFIG, COURT_GEOMETRY } from '../config/balance';

export interface CourtPoint2D {
  x: number;
  z: number;
}

export interface BlockEvaluationInput {
  shooterPos: CourtPoint2D;
  defenderPos: CourtPoint2D;
  /** Angle in radians where facing vector is (sin(angle), cos(angle)) */
  defenderFacingAngle: number;
  blockingDisabledByRule?: boolean;
}

export interface BlockEligibilitySnapshot {
  readonly eligible: boolean;
  readonly distanceM: number;
  readonly withinRange: boolean;
  readonly facingShooter: boolean;
  readonly inContestPosition: boolean;
  readonly insideCourt: boolean;
  readonly reason:
    | 'eligible'
    | 'out-of-range'
    | 'not-facing-shooter'
    | 'poor-contest-angle'
    | 'out-of-bounds'
    | 'rule-disabled';
}

export function isInsidePlayableCourt(pt: CourtPoint2D): boolean {
  return (
    pt.x >= COURT_GEOMETRY.minX &&
    pt.x <= COURT_GEOMETRY.maxX &&
    pt.z >= COURT_GEOMETRY.minZ &&
    pt.z <= COURT_GEOMETRY.maxZ
  );
}

export function computeDistance2D(a: CourtPoint2D, b: CourtPoint2D): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/**
 * Evaluates and freezes defender block eligibility at the exact instant the shot is released.
 */
export function evaluateBlockEligibilityAtRelease(
  input: BlockEvaluationInput
): BlockEligibilitySnapshot {
  const distanceM = computeDistance2D(input.shooterPos, input.defenderPos);

  if (input.blockingDisabledByRule) {
    return Object.freeze({
      eligible: false,
      distanceM,
      withinRange: false,
      facingShooter: false,
      inContestPosition: false,
      insideCourt: true,
      reason: 'rule-disabled',
    });
  }

  const insideCourt =
    isInsidePlayableCourt(input.shooterPos) && isInsidePlayableCourt(input.defenderPos);

  if (!insideCourt) {
    return Object.freeze({
      eligible: false,
      distanceM,
      withinRange: false,
      facingShooter: false,
      inContestPosition: false,
      insideCourt: false,
      reason: 'out-of-bounds',
    });
  }

  const withinRange =
    distanceM <= BLOCK_BALANCE_CONFIG.maxBlockDistanceM + 1e-6 &&
    distanceM >= BLOCK_BALANCE_CONFIG.minBlockDistanceM;

  if (!withinRange) {
    return Object.freeze({
      eligible: false,
      distanceM,
      withinRange: false,
      facingShooter: false,
      inContestPosition: false,
      insideCourt: true,
      reason: 'out-of-range',
    });
  }

  // Vector from defender to shooter
  const toShooterX = (input.shooterPos.x - input.defenderPos.x) / Math.max(distanceM, 1e-6);
  const toShooterZ = (input.shooterPos.z - input.defenderPos.z) / Math.max(distanceM, 1e-6);

  const defForwardX = Math.sin(input.defenderFacingAngle);
  const defForwardZ = Math.cos(input.defenderFacingAngle);
  const facingDot = defForwardX * toShooterX + defForwardZ * toShooterZ;
  const facingShooter = facingDot >= BLOCK_BALANCE_CONFIG.minFacingDotProduct;

  if (!facingShooter) {
    return Object.freeze({
      eligible: false,
      distanceM,
      withinRange: true,
      facingShooter: false,
      inContestPosition: false,
      insideCourt: true,
      reason: 'not-facing-shooter',
    });
  }

  // Vector from shooter to hoop vs vector from shooter to defender
  const hoopDist = computeDistance2D(input.shooterPos, {
    x: COURT_GEOMETRY.hoopX,
    z: COURT_GEOMETRY.hoopZ,
  });
  let inContestPosition = true;
  if (hoopDist > 0.35) {
    const shooterToHoopX = (COURT_GEOMETRY.hoopX - input.shooterPos.x) / hoopDist;
    const shooterToHoopZ = (COURT_GEOMETRY.hoopZ - input.shooterPos.z) / hoopDist;
    const shooterToDefX = -toShooterX;
    const shooterToDefZ = -toShooterZ;
    const contestCos = shooterToHoopX * shooterToDefX + shooterToHoopZ * shooterToDefZ;
    inContestPosition = contestCos >= BLOCK_BALANCE_CONFIG.minContestPositionCos;
  }

  if (!inContestPosition) {
    return Object.freeze({
      eligible: false,
      distanceM,
      withinRange: true,
      facingShooter: true,
      inContestPosition: false,
      insideCourt: true,
      reason: 'poor-contest-angle',
    });
  }

  return Object.freeze({
    eligible: true,
    distanceM,
    withinRange: true,
    facingShooter: true,
    inContestPosition: true,
    insideCourt: true,
    reason: 'eligible',
  });
}
