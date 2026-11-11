import { DUNK_TAKEOFF_SEC, DUNK_FINISH_HAND, DUNK_HOLD_HEIGHT } from "./dunks";
import { COURT_GEOMETRY, STREET_FLOW_CONFIG } from "../config/balance";
import type { PlayerSimState } from "./matchStateMachine";
import { motionCurve, smoothMotion } from "./motionCurves";

export type StreetMove = "crossover" | "spin" | "eurostep" | "stepback";
export const STREET_MOVES: Record<
  StreetMove,
  { label: string; duration: number; speed: number; cost: number }
> = {
  crossover: { label: "CROSSOVER", duration: 0.34, speed: 10.1, cost: 0.15 },
  spin: { label: "SPIN MOVE", duration: 0.46, speed: 9.1, cost: 0.20 },
  eurostep: { label: "EUROSTEP", duration: 0.54, speed: 8.7, cost: 0.20 },
  stepback: { label: "STEP BACK", duration: 0.32, speed: 9.5, cost: 0.17 },
};
export function isStreetMove(value: unknown): value is StreetMove {
  return typeof value === "string" && Object.hasOwn(STREET_MOVES, value);
}

/**
 * Returns true if the player can legitimately chain into `nextTrick`:
 * - Either neutral with cooldown expired,
 * - Within post-move `comboGraceSec` for a DISTINCT trick below `maxTrickChain`,
 * - Or inside the late cancel window (`>= trickCancelFraction`) of a DIFFERENT active trick.
 * Never allows chaining the identical move back-to-back on cooldown (prevents single-button spam).
 */
export function canTriggerOrChainTrick(
  p: PlayerSimState,
  nextTrick: StreetMove,
): { allowed: boolean; isChain: boolean; cost: number } {
  const baseCost = STREET_MOVES[nextTrick].cost;
  const currentChain = p.streetMove || p.comboGraceSec > 0 ? p.trickCombo : 0;
  const chainMultiplier = 1 + Math.max(0, currentChain) * 0.12;
  const effectiveCost = Number((baseCost * chainMultiplier).toFixed(4));

  if (p.sprintStamina < effectiveCost) {
    return { allowed: false, isChain: false, cost: effectiveCost };
  }

  // Fresh neutral move off cooldown
  if (!p.streetMove && p.moveCooldownSec <= 0) {
    const continuingGrace = p.comboGraceSec > 0 && p.lastTrick !== null && p.lastTrick !== nextTrick && p.trickCombo < STREET_FLOW_CONFIG.maxTrickChain;
    return { allowed: true, isChain: continuingGrace, cost: effectiveCost };
  }

  // Distinct move chain during active move's cancel window
  if (
    p.streetMove &&
    p.streetMove !== nextTrick &&
    p.trickCombo < STREET_FLOW_CONFIG.maxTrickChain
  ) {
    const progress = p.moveElapsedSec / STREET_MOVES[p.streetMove].duration;
    if (progress >= STREET_FLOW_CONFIG.trickCancelFraction) {
      return { allowed: true, isChain: true, cost: effectiveCost };
    }
  }

  // Distinct move chain during brief post-move combo grace window (even while single-move cooldown is active)
  if (
    !p.streetMove &&
    p.comboGraceSec > 0 &&
    p.lastTrick !== null &&
    p.lastTrick !== nextTrick &&
    p.trickCombo < STREET_FLOW_CONFIG.maxTrickChain
  ) {
    return { allowed: true, isChain: true, cost: effectiveCost };
  }

  return { allowed: false, isChain: false, cost: effectiveCost };
}

// Shared by the authoritative ball position and the character rig: hands and ball
// follow the same take-off, suspended question moment, finish and landing.
export function getAirPose(p: PlayerSimState): {
  x: number;
  y: number;
  z: number;
  progress: number;
} {
  if (!p.finishKind) {
    const jump =
      p.defenseAction === "jump"
        ? Math.sin(Math.min(1, p.defenseElapsedSec / 0.88) * Math.PI) ** 2
        : 0;
    const dx = p.defenseTargetX - p.x;
    const dz = p.defenseTargetZ - p.z;
    const distance = Math.hypot(dx, dz);
    // The block lunge reaches towards the ball while leaving room for both
    // torsos. This changes presentation only; contest timing stays authoritative.
    const travel = (distance - 0.72) * jump;
    return {
      x: p.x + (distance > 1e-6 ? dx / distance : Math.sin(p.facingAngle)) * travel,
      y: jump * 1.25,
      z: p.z + (distance > 1e-6 ? dz / distance : Math.cos(p.facingAngle)) * travel,
      progress: jump,
    };
  }
  const t = p.finishElapsedSec;
  if (p.finishKind === "jump") {
    // Smooth NBA-style jump-shot lift & apex suspension during slow-motion Question Duel,
    // followed by a cushioned landing once resolution begins (finishResolutionSec >= 0).
    const rise = smoothMotion(Math.min(1, t / 0.34));
    const res = p.finishResolutionSec;
    const land = res < 0 ? 0 : smoothMotion(Math.min(1, res / 0.44));
    const liftHeight = p.lastTrick === "stepback" ? 0.64 : 0.56;
    const fadeDist = p.lastTrick === "stepback" ? 0.34 * rise * (1 - land * 0.35) : 0;
    const awayX = -Math.sin(p.facingAngle) * fadeDist;
    const awayZ = -Math.cos(p.facingAngle) * fadeDist;
    return {
      x: Math.min(COURT_GEOMETRY.maxX, Math.max(COURT_GEOMETRY.minX, p.x + awayX)),
      z: Math.min(COURT_GEOMETRY.maxZ, Math.max(COURT_GEOMETRY.minZ, p.z + awayZ)),
      y: liftHeight * rise * (1 - land),
      progress: res < 0 ? rise * 0.65 : 0.65 + land * 0.35,
    };
  }
  const r = p.finishResolutionSec;
  const takeoff = Math.min(1, t / DUNK_TAKEOFF_SEC);
  const finish = r < 0 ? 0 : Math.min(1, r / 0.3);
  const closeLaunch =
    Math.hypot(COURT_GEOMETRY.hoopX - p.x, COURT_GEOMETRY.hoopZ - p.z) < 0.8;
  const progress = closeLaunch
    ? smoothMotion(t / 0.22)
    : smoothMotion(takeoff) * 0.64 + smoothMotion(finish) * 0.36;
  const dx = COURT_GEOMETRY.hoopX - p.x;
  const dz = COURT_GEOMETRY.hoopZ - p.z;
  const landing = r < 0.3 ? 0 : smoothMotion((r - 0.3) / 0.48);
  const yaw = p.facingAngle + (p.dunkStyle === "reverse" ? Math.PI : 0);
  const handX =
    Math.cos(yaw) * DUNK_FINISH_HAND.x + Math.sin(yaw) * DUNK_FINISH_HAND.z;
  const handZ =
    -Math.sin(yaw) * DUNK_FINISH_HAND.x + Math.cos(yaw) * DUNK_FINISH_HAND.z;
  const elevationBoost = p.onFire ? 0.14 : p.trickCombo >= 2 ? 0.08 : 0;
  return {
    x: p.x + (dx - handX) * progress,
    z: p.z + (dz - handZ) * progress,
    y:
      (motionCurve(Math.min(t, DUNK_TAKEOFF_SEC), [
        [0, 0, 0],
        [0.1, -0.13, 0],
        [0.23, 0.58, 6.2],
        [0.48, 1.84 + elevationBoost * 0.6, 0],
        [DUNK_TAKEOFF_SEC, DUNK_HOLD_HEIGHT + elevationBoost, 0],
      ])) *
      (1 - landing),
    progress,
  };
}
