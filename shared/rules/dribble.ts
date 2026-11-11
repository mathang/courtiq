import { COURT_GEOMETRY } from "../config/balance";
import type { PlayerSimState } from "./matchStateMachine";
import { ease, smoothMotion, unit } from "./motionCurves";
import type { Vector3D } from "./shot";
import { getAirPose, STREET_MOVES } from "./streetMoves";

/** Wraps an angle in radians into [-PI, PI]. */
export function wrapAngleRad(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Exponentially damps `current` toward `target` across the shortest angular arc, bounded by athletic turn speed. */
export function stepAngleTowards(
  current: number,
  target: number,
  rate: number,
  dt: number,
  maxRadPerSec = 18,
): number {
  if (dt <= 0 || rate <= 0) return current;
  const rawStep = wrapAngleRad(target - current) * (1 - Math.exp(-rate * dt));
  const maxStep = maxRadPerSec * dt;
  return current + Math.max(-maxStep, Math.min(maxStep, rawStep));
}

/**
 * Computes coherent basketball body orientation from role, court geometry,
 * actual world velocity and movement input:
 * - Defenders stay squared/angled to the ball-handler while shuffling or retreating
 *   so lateral containment and rim retreat never turn their back on the shooter.
 * - Ball-handlers keep their chest open toward the basket on non-sprint retreats
 *   and lateral size-ups, while turning into full drives and sprints.
 */
export function computeBasketballFacingAngle(params: {
  self: PlayerSimState;
  opponent: PlayerSimState;
  isAttacker: boolean;
  normX: number;
  normZ: number;
  isMoving: boolean;
}): number {
  const { self: p, opponent, isAttacker, normX, normZ, isMoving } = params;
  const speed = Math.hypot(p.vx, p.vz);

  if (isAttacker) {
    if (p.streetMove) {
      return Math.atan2(p.moveForwardX, p.moveForwardZ);
    }
    const toHoop = Math.atan2(
      COURT_GEOMETRY.hoopX - p.x,
      COURT_GEOMETRY.hoopZ - p.z,
    );
    if (!isMoving && speed <= 0.5) {
      return toHoop;
    }
    const velWeight = unit((speed - 0.55) / 1.6);
    const rawX = normX * (1 - velWeight) + (speed > 0.05 ? p.vx / speed : normX) * velWeight;
    const rawZ = normZ * (1 - velWeight) + (speed > 0.05 ? p.vz / speed : normZ) * velWeight;
    const mag = Math.hypot(rawX, rawZ);
    if (mag < 1e-4) return toHoop;
    const dirX = rawX / mag;
    const dirZ = rawZ / mag;

    const hoopFwdX = Math.sin(toHoop);
    const hoopFwdZ = Math.cos(toHoop);
    const cosToHoop = dirX * hoopFwdX + dirZ * hoopFwdZ;
    const sideToHoop = dirX * -hoopFwdZ + dirZ * hoopFwdX;

    if (!p.isSprinting && cosToHoop < -0.1) {
      // Controlled retreat / size-up: back out while keeping eyes and chest open to the rim.
      return toHoop + sideToHoop * 0.52;
    }
    if (!p.isSprinting && cosToHoop < 0.35) {
      const driveBlend = unit((cosToHoop + 0.1) / 0.45);
      const sizeUpAngle = toHoop + sideToHoop * 0.85;
      const travelAngle = Math.atan2(dirX, dirZ);
      return sizeUpAngle + wrapAngleRad(travelAngle - sizeUpAngle) * driveBlend;
    }
    return Math.atan2(dirX, dirZ);
  }

  // Defender orientation: stay matched to the ball-handler through shuffles and retreats.
  const dx = opponent.x - p.x;
  const dz = opponent.z - p.z;
  const dist = Math.hypot(dx, dz);
  const toAttacker = dist > 1e-4 ? Math.atan2(dx, dz) : p.facingAngle;
  if (!isMoving && speed <= 0.45) {
    return toAttacker;
  }

  const velWeight = unit((speed - 0.5) / 1.5);
  const rawX = normX * (1 - velWeight) + (speed > 0.05 ? p.vx / speed : normX) * velWeight;
  const rawZ = normZ * (1 - velWeight) + (speed > 0.05 ? p.vz / speed : normZ) * velWeight;
  const mag = Math.hypot(rawX, rawZ);
  if (mag < 1e-4) return toAttacker;
  const dirX = rawX / mag;
  const dirZ = rawZ / mag;

  const attFwdX = Math.sin(toAttacker);
  const attFwdZ = Math.cos(toAttacker);
  const cosToAttacker = dirX * attFwdX + dirZ * attFwdZ;
  const lateralSlide = dirX * -attFwdZ + dirZ * attFwdX;

  if (p.isSprinting && dist >= 2.9 && cosToAttacker >= 0.15) {
    const travelAngle = Math.atan2(dirX, dirZ);
    const chaseBlend = Math.min(0.68, unit((dist - 2.9) / 1.8) * 0.68);
    return toAttacker + wrapAngleRad(travelAngle - toAttacker) * chaseBlend;
  }

  // Athletic defensive slide / drop-step hip angle while keeping chest on the shooter.
  const maxHipOpen = p.isSprinting ? 0.48 : 0.32;
  return toAttacker + lateralSlide * maxHipOpen;
}

/** Advances authoritative carrying-hand, protection, and dribble-blend state during Possession. */
export function stepDribbleState(
  p: PlayerSimState,
  defender: PlayerSimState,
  isMoving: boolean,
  deltaSec: number,
): void {
  p.dribbleHand ??= 1;
  p.dribbleSide ??= p.dribbleHand;
  p.moveStartSide ??= p.dribbleSide;
  p.handSwitchCooldownSec = Math.max(0, (p.handSwitchCooldownSec ?? 0) - deltaSec);

  const speed = Math.hypot(p.vx, p.vz);
  if (p.streetMove) {
    const u = unit(p.moveElapsedSec / STREET_MOVES[p.streetMove].duration);
    if (p.streetMove === "crossover" || p.streetMove === "eurostep") {
      p.dribbleSide =
        p.moveStartSide + (p.dribbleHand - p.moveStartSide) * smoothMotion(u);
    } else {
      p.dribbleSide +=
        (p.dribbleHand - p.dribbleSide) * (1 - Math.exp(-14 * deltaSec));
    }
  } else {
    if (speed > 0.9 && p.handSwitchCooldownSec <= 0) {
      const rightX = Math.cos(p.facingAngle);
      const rightZ = -Math.sin(p.facingAngle);
      const dxDef = defender.x - p.x;
      const dzDef = defender.z - p.z;
      const defDist = Math.hypot(dxDef, dzDef);
      const defSide = (dxDef * rightX + dzDef * rightZ) / Math.max(0.1, defDist);
      const velSide = (p.vx * rightX + p.vz * rightZ) / speed;

      let desiredHand: -1 | 1 = p.dribbleHand;
      if (defDist < 2.25 && Math.abs(defSide) > 0.2) {
        // Shield the live dribble with the body away from a closely shading defender.
        desiredHand = defSide > 0 ? -1 : 1;
      } else if (defDist > 2.15 && speed > 1.8 && Math.abs(velSide) > 0.5) {
        // Carry with the outside lead hand on uncontested perimeter/wing drives.
        desiredHand = velSide > 0 ? 1 : -1;
      }

      if (desiredHand !== p.dribbleHand) {
        p.dribbleHand = desiredHand;
        p.handSwitchCooldownSec = 0.44;
      }
    }
    p.dribbleSide +=
      (p.dribbleHand - p.dribbleSide) * (1 - Math.exp(-11.5 * deltaSec));
  }

  const targetBlend = isMoving || Boolean(p.streetMove) || speed > 0.48 ? 1 : 0;
  const prevBlend = p.dribbleBlend ?? targetBlend;
  const blendRate = targetBlend > prevBlend ? 18 : 11.5;
  p.dribbleBlend = prevBlend + (targetBlend - prevBlend) * (1 - Math.exp(-blendRate * deltaSec));
}

/** One shared bounce/hand path for solo, both online transports and the preview. */
export function dribbleBallPosition(p: PlayerSimState, elapsedSec: number) {
  const u = p.streetMove
    ? unit(p.moveElapsedSec / STREET_MOVES[p.streetMove].duration)
    : 0;
  const hasSteppedState = p.dribbleSide !== undefined || p.dribbleBlend !== undefined;
  const side = hasSteppedState
    ? (p.dribbleSide ?? p.dribbleHand ?? 1)
    : p.streetMove === "crossover" || p.streetMove === "eurostep"
      ? Math.cos(u * Math.PI) * p.moveSide
      : (p.dribbleHand ?? 1);
  const spinProgress = (moveU: number) => moveU * 0.65 + smoothMotion(moveU) * 0.35;
  const yaw =
    p.facingAngle +
    (p.streetMove === "spin" ? p.moveSide * spinProgress(u) * Math.PI * 2 : 0);
  const blend = hasSteppedState
    ? unit(p.dribbleBlend ?? (p.animState === "dribble" || p.streetMove ? 1 : 0))
    : p.animState === "dribble" || p.streetMove
      ? 1
      : 0;

  const forward = 0.31 + (0.28 - 0.31) * blend;
  const lateral = 0.2 + (0.34 - 0.2) * blend;
  const rawBounceY = Math.abs(Math.sin(elapsedSec * 7.5)) * 0.65 + 0.24;
  const euroCradle =
    p.streetMove === "eurostep" && u > 0.42
      ? smoothMotion((u - 0.42) / 0.5)
      : 0;
  const activeY = rawBounceY + (1.02 - rawBounceY) * euroCradle;
  const y = hasSteppedState
    ? 1.07 + (activeY - 1.07) * blend
    : p.animState === "dribble"
      ? rawBounceY
      : 1.07;

  return {
    x: p.x + Math.sin(yaw) * forward + Math.cos(yaw) * lateral * side,
    y,
    z: p.z + Math.cos(yaw) * forward - Math.sin(yaw) * lateral * side,
  };
}

/**
 * Smoothly gathers the basketball from its live dribble position through the
 * shooter's two-hand set pocket onto the authoritative pre-resolution flight curve.
 */
export function jumpShotGatherBallPosition(
  p: PlayerSimState,
  flightPos: Vector3D,
): Vector3D {
  const origin = p.dunkBallStart;
  if (!origin || p.finishElapsedSec >= 0.30) {
    return flightPos;
  }
  const raw = unit(p.finishElapsedSec / 0.30);
  const u = raw * 0.35 + smoothMotion(raw) * 0.65;
  const pose = getAirPose(p);
  const yaw = p.facingAngle;
  const pocket: Vector3D = {
    x: pose.x + Math.sin(yaw) * 0.24 + Math.cos(yaw) * 0.05,
    y: pose.y + 1.52,
    z: pose.z + Math.cos(yaw) * 0.24 - Math.sin(yaw) * 0.05,
  };
  const inv = 1 - u;
  return {
    x: inv * inv * origin.x + 2 * inv * u * pocket.x + u * u * flightPos.x,
    y: inv * inv * origin.y + 2 * inv * u * pocket.y + u * u * flightPos.y,
    z: inv * inv * origin.z + 2 * inv * u * pocket.z + u * u * flightPos.z,
  };
}
